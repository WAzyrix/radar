// =========================================================
// Client de l'API GraphQL AniList : cache + respect de la limite de requêtes.
// Tous les appels à AniList passent par la fonction `anilist()` ci-dessous.
//
// AniList autorise 90 requêtes/minute par adresse IP, mais seulement 30 en "mode dégradé"
// (le cas en ce moment). Au-delà, il répond 429 ; si on insiste, son pare-feu (Cloudflare)
// bloque l'adresse une minute avec un 429 SANS en-têtes CORS : le navigateur n'y voit
// qu'un échec réseau (« Failed to fetch »). Et l'en-tête Retry-After n'est pas lisible en
// JavaScript (AniList ne l'expose pas) : seuls X-RateLimit-Remaining et X-RateLimit-Reset le sont.
//
// D'où :
//  - un limiteur PARTAGÉ entre les onglets et les pages (localStorage) : 25 requêtes/minute ;
//  - un état "bloqué jusqu'à…" partagé lui aussi : pendant un blocage, on n'envoie plus rien
//    (chaque essai prolongerait le blocage) ;
//  - en cas de blocage ou de panne : les données en cache, même expirées, si on en a ;
//    sinon une ErreurLimite, que les pages affichent avec un compte à rebours et un nouvel essai.
// =========================================================

import { hacher, lireCache, ecrireCache, viderCache } from '../lib/cache.js';
import { appeler, messageStatut } from '../lib/outils.js';

const URL_API = 'https://graphql.anilist.co';
const LIMITE_PAR_MINUTE = 25;       // 30 en mode dégradé : on garde une marge
const BLOCAGE = 60_000;             // durée du blocage d'AniList quand on dépasse
const ATTENTE_MAX = 4000;           // au-delà, on prévient plutôt que de faire patienter en silence
const PREFIXE_CACHE = 'al:';
const ETAT = 'radar:anilist';       // { h: heures des requêtes de la dernière minute, bloque: date }

const enCours = new Map();      // requêtes identiques en cours -> on partage la même promesse

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// En quittant la page, le navigateur annule les requêtes en cours : ce n'est pas un blocage
let pageQuittee = false;
addEventListener('beforeunload', () => { pageQuittee = true; });
addEventListener('pagehide', () => { pageQuittee = true; });
addEventListener('pageshow', () => { pageQuittee = false; }); // retour arrière (cache de navigation)

// AniList saturé : `reessaiDans` (secondes) sert au compte à rebours (afficherErreur)
export class ErreurLimite extends Error {
  constructor(ms) {
    const secondes = Math.max(1, Math.ceil(ms / 1000));
    super(`AniList est surchargé, réessaie dans ${secondes} secondes.`);
    this.name = 'ErreurLimite';
    this.service = 'AniList';
    this.reessaiDans = secondes;
  }
}

function lireEtat() {
  try {
    const etat = JSON.parse(localStorage.getItem(ETAT));
    if (etat && Array.isArray(etat.h)) return etat;
  } catch { /* illisible ou stockage indisponible : on repart de zéro */ }
  return { h: [], bloque: 0 };
}

function ecrireEtat(etat) {
  try { localStorage.setItem(ETAT, JSON.stringify(etat)); } catch { /* stockage plein : limiteur local seulement */ }
}

function bloquer(ms) {
  const etat = lireEtat();
  etat.bloque = Math.max(etat.bloque || 0, Date.now() + Math.min(Math.max(ms, 5000), 2 * BLOCAGE));
  ecrireEtat(etat);
}

// Réserve un créneau et renvoie 0, ou renvoie le temps à attendre (ms) avant de pouvoir envoyer
function reserverCreneau() {
  const maintenant = Date.now();
  const etat = lireEtat();
  if (etat.bloque > maintenant) return etat.bloque - maintenant;
  etat.h = etat.h.filter((t) => maintenant - t < 60_000 && t <= maintenant);
  if (etat.h.length >= LIMITE_PAR_MINUTE) return 60_000 - (maintenant - etat.h[0]) + 50;
  etat.h.push(maintenant);
  ecrireEtat(etat);
  return 0;
}

viderCache(PREFIXE_CACHE, { seulementExpires: true }); // ménage au chargement

/**
 * Envoie une requête GraphQL à AniList.
 * @param {string} query    la requête GraphQL
 * @param {object} variables  ses variables (mettre `undefined`, jamais `null`, pour un filtre vide)
 * @param {object} options  { duree: durée du cache en ms (0 = pas de cache),
 *                            valide: (data) => false si une donnée en cache est déjà dépassée }
 */
export async function anilist(query, variables = {}, { duree = 10 * 60_000, valide = () => true } = {}) {
  const corps = JSON.stringify({ query, variables });
  const cle = PREFIXE_CACHE + hacher(corps);

  if (duree > 0) {
    const enCache = lireCache(cle);
    if (enCache !== undefined && valide(enCache)) return enCache;
    if (enCours.has(cle)) return enCours.get(cle);
  }

  const promesse = envoyer(corps).then((data) => {
    if (duree > 0) ecrireCache(cle, data, duree, PREFIXE_CACHE);
    return data;
  }).catch((erreur) => {
    // Saturé, en panne ou injoignable : les données en cache, même expirées, plutôt qu'une erreur
    const secours = duree > 0 && !erreur.definitive ? lireCache(cle, { perime: true }) : undefined;
    if (secours !== undefined) return secours;
    throw erreur;
  }).finally(() => enCours.delete(cle));

  if (duree > 0) enCours.set(cle, promesse);
  return promesse;
}

async function envoyer(corps) {
  let attente = reserverCreneau();
  if (attente > 0 && attente <= ATTENTE_MAX) {
    await pause(attente);
    attente = reserverCreneau();
  }
  if (attente > 0) throw new ErreurLimite(attente);

  let reponse;
  try {
    reponse = await appeler(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corps,
    }, { service: 'AniList' });
  } catch (erreur) {
    // Échec réseau alors qu'on est connecté : presque toujours le blocage du pare-feu d'AniList
    // (429 sans CORS) ou une panne de son côté. On n'insiste pas pendant une minute.
    if (erreur.cause?.name === 'TypeError' && navigator.onLine !== false && !pageQuittee) {
      bloquer(BLOCAGE);
      throw new ErreurLimite(BLOCAGE);
    }
    throw erreur;
  }

  // X-RateLimit-Reset (date Unix) n'est envoyé qu'avec un 429
  const reset = Number(reponse.headers.get('X-RateLimit-Reset')) * 1000;
  if (reponse.status === 429) {
    const attenteReset = reset ? reset - Date.now() : BLOCAGE;
    bloquer(attenteReset);
    throw new ErreurLimite(attenteReset);
  }
  // Le compteur d'AniList compte TOUT ce qui sort de cette connexion (autres onglets, appareils…) :
  // presque épuisé, on s'arrête une minute avant de recevoir un 429
  const restant = reponse.headers.get('X-RateLimit-Remaining');
  if (restant !== null && Number(restant) <= 1) bloquer(BLOCAGE);

  const json = await reponse.json().catch(() => null);
  // AniList renvoie ses erreurs en anglais ("Not Found.") avec un code : on traduit le code
  const statut = json?.errors?.[0]?.status || (reponse.ok ? 0 : reponse.status);
  if (statut) {
    const erreur = new Error(statut === 404 ? 'Cet animé est introuvable sur AniList.' : messageStatut('AniList', statut));
    erreur.definitive = statut === 404 || statut === 400; // inutile de ressortir le cache
    throw erreur;
  }
  if (!json?.data || typeof json.data !== 'object') throw new Error("Réponse inattendue d'AniList. Réessaie dans un instant.");
  return json.data;
}
