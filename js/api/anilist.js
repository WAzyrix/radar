// =========================================================
// Client de l'API GraphQL AniList : cache + respect de la limite de requêtes.
// Tous les appels à AniList passent par la fonction `anilist()` ci-dessous.
// =========================================================

import { hacher, lireCache, ecrireCache, viderCache } from '../lib/cache.js';
import { appeler, messageStatut } from '../lib/outils.js';

const URL_API = 'https://graphql.anilist.co';

// AniList autorise 90 requêtes/minute normalement, mais seulement 30 en "mode dégradé"
// (c'est le cas en ce moment). On se limite à 25 pour garder une marge.
const LIMITE_PAR_MINUTE = 25;
const PREFIXE_CACHE = 'al:';

const historique = [];          // heures des dernières requêtes (pour le limiteur)
const enCours = new Map();      // requêtes identiques en cours -> on partage la même promesse

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Attend qu'un "créneau" se libère si on a déjà fait trop de requêtes dans la dernière minute.
async function attendreCreneau() {
  for (;;) {
    const maintenant = Date.now();
    while (historique.length && maintenant - historique[0] > 60_000) historique.shift();
    if (historique.length < LIMITE_PAR_MINUTE) { historique.push(maintenant); return; }
    await pause(60_000 - (maintenant - historique[0]) + 50);
  }
}

viderCache(PREFIXE_CACHE, { seulementExpires: true }); // ménage au chargement

/**
 * Envoie une requête GraphQL à AniList.
 * @param {string} query    la requête GraphQL
 * @param {object} variables  ses variables (mettre `undefined`, jamais `null`, pour un filtre vide)
 * @param {object} options  { duree: durée du cache en ms (0 = pas de cache) }
 */
export async function anilist(query, variables = {}, { duree = 10 * 60_000 } = {}) {
  const corps = JSON.stringify({ query, variables });
  const cle = PREFIXE_CACHE + hacher(corps);

  if (duree > 0) {
    const enCache = lireCache(cle);
    if (enCache !== undefined) return enCache;
    if (enCours.has(cle)) return enCours.get(cle);
  }

  const promesse = envoyer(corps).then((data) => {
    if (duree > 0) ecrireCache(cle, data, duree, PREFIXE_CACHE);
    return data;
  }).finally(() => enCours.delete(cle));

  if (duree > 0) enCours.set(cle, promesse);
  return promesse;
}

async function envoyer(corps, essai = 1) {
  await attendreCreneau();
  const reponse = await appeler(URL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: corps,
  }, { service: 'AniList' });

  // Trop de requêtes : AniList dit combien de secondes attendre (Retry-After)
  if (reponse.status === 429 && essai < 3) {
    const attente = Number(reponse.headers.get('Retry-After')) || 30;
    await pause(attente * 1000);
    return envoyer(corps, essai + 1);
  }

  const json = await reponse.json().catch(() => null);
  // AniList renvoie ses erreurs en anglais ("Not Found.") avec un code : on traduit le code
  const statut = json?.errors?.[0]?.status || (reponse.ok ? 0 : reponse.status);
  if (statut) throw new Error(statut === 404 ? 'Cet animé est introuvable sur AniList.' : messageStatut('AniList', statut));
  if (!json?.data || typeof json.data !== 'object') throw new Error("Réponse inattendue d'AniList. Réessaie dans un instant.");
  return json.data;
}
