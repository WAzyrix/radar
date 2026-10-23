// =========================================================
// Ma liste : TOUT ce que je suis (animés, mangas, films, séries, jeux),
// au même endroit, synchronisé entre mes appareils grâce à un "code perso".
//
// - Stockage local (localStorage) : le site marche même hors connexion.
// - Synchronisation : la liste est aussi envoyée au relais Cloudflare, sous mon code.
//   C'est ce qui permet au relais de m'envoyer des notifications.
// - En cas de différence entre deux appareils, la version la plus récente gagne.
// =========================================================
import { URL_RELAIS } from '../config.js';

const CLE_LISTE = 'radar:liste';
const CLE_CODE = 'radar:code';
export const TYPES = {
  anime: { nom: 'Animés', un: 'Animé' },
  manga: { nom: 'Mangas', un: 'Manga' },
  serie: { nom: 'Séries', un: 'Série' },
  film: { nom: 'Films', un: 'Film' },
  jeu: { nom: 'Jeux', un: 'Jeu' },
};

// ---------- Lecture / écriture locale ----------
function lireLocal() {
  try {
    const liste = JSON.parse(localStorage.getItem(CLE_LISTE));
    if (liste?.items) return liste;
  } catch { /* liste illisible : on repart de zéro */ }
  return migrerAnciennesListes();
}

function ecrireLocal(liste) {
  localStorage.setItem(CLE_LISTE, JSON.stringify(liste));
  window.dispatchEvent(new CustomEvent('radar:liste'));
}

// Avant la V2, les animés suivis et les jeux étaient dans deux listes séparées
function migrerAnciennesListes() {
  const lireAncien = (cle) => { try { return JSON.parse(localStorage.getItem(cle)) || []; } catch { return []; } };
  const items = [
    ...lireAncien('radar:suivis').map((s) => ({ type: 'anime', id: s.id, titre: s.titre, image: s.image, couleur: s.couleur, ajouteLe: s.ajouteLe })),
    ...lireAncien('radar:jeux').map((j) => ({ type: 'jeu', id: j.id, titre: j.nom, image: j.image, sortie: j.sortie, statut: j.statut, ajouteLe: j.ajouteLe })),
  ];
  const liste = { maj: items.length ? Date.now() : 0, items };
  localStorage.setItem(CLE_LISTE, JSON.stringify(liste));
  localStorage.removeItem('radar:suivis');
  localStorage.removeItem('radar:jeux');
  return liste;
}

export const items = (type) => lireLocal().items.filter((i) => !type || i.type === type);
export const trouver = (type, id) => lireLocal().items.find((i) => i.type === type && i.id === id);

/** Ajoute ou met à jour un élément (même type + même id = même élément). */
export function enregistrer(element) {
  const liste = lireLocal();
  const existant = liste.items.find((i) => i.type === element.type && i.id === element.id);
  const nouveau = { ...existant, ...element, ajouteLe: existant?.ajouteLe || new Date().toISOString() };
  liste.items = [...liste.items.filter((i) => i !== existant), nouveau];
  liste.maj = Date.now();
  ecrireLocal(liste);
  envoyerPlusTard();
}

export function retirer(type, id) {
  const liste = lireLocal();
  liste.items = liste.items.filter((i) => !(i.type === type && i.id === id));
  liste.maj = Date.now();
  ecrireLocal(liste);
  envoyerPlusTard();
}

// ---------- Code perso ----------
export function codePerso() {
  let code = localStorage.getItem(CLE_CODE);
  if (!/^[a-f0-9]{32}$/.test(code || '')) {
    // 16 octets aléatoires = 32 caractères hexadécimaux : impossible à deviner
    code = [...crypto.getRandomValues(new Uint8Array(16))].map((o) => o.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(CLE_CODE, code);
  }
  return code;
}

/** Relie cet appareil à un autre code (celui de mon PC par exemple) : on récupère sa liste. */
export async function utiliserCode(code) {
  code = code.trim().toLowerCase().replace(/[^a-f0-9]/g, '');
  if (code.length !== 32) throw new Error('Le code doit faire 32 caractères (chiffres et lettres a à f).');
  const distante = await appel('GET', `/liste/${code}`);
  localStorage.setItem(CLE_CODE, code);
  // On fusionne : ce qui est sur l'autre appareil + ce qui est ici en plus
  const locale = lireLocal();
  const cle = (i) => `${i.type}:${i.id}`;
  const connus = new Set(distante.items.map(cle));
  ecrireLocal({ maj: Date.now(), items: [...distante.items, ...locale.items.filter((i) => !connus.has(cle(i)))] });
  await envoyer();
}

// ---------- Synchronisation avec le relais ----------
async function appel(methode, chemin, corps) {
  const reponse = await fetch(URL_RELAIS + chemin, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const json = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(json.erreur || `Erreur ${reponse.status}`);
  return json;
}
export { appel as appelRelais };

let minuteur;
function envoyerPlusTard() {
  clearTimeout(minuteur);
  minuteur = setTimeout(() => envoyer().catch(() => {}), 1500); // on regroupe les clics rapprochés
}

// Fonctions à appeler après chaque envoi (ex : copie de la liste pour mes potes, voir compte.js)
const apresEnvoi = [];
export const surEnvoi = (fonction) => apresEnvoi.push(fonction);

export async function envoyer() {
  const liste = lireLocal();
  await appel('PUT', `/liste/${codePerso()}`, liste);
  localStorage.setItem('radar:synchro', String(Date.now()));
  apresEnvoi.forEach((f) => f());
}

/** Au chargement d'une page : on récupère la version distante si elle est plus récente. */
export async function synchroniser() {
  const locale = lireLocal();
  const distante = await appel('GET', `/liste/${codePerso()}`);
  if (distante.maj > locale.maj) ecrireLocal(distante);
  else if (locale.maj > distante.maj) await envoyer();
  localStorage.setItem('radar:synchro', String(Date.now()));
}

export const derniereSynchro = () => Number(localStorage.getItem('radar:synchro')) || 0;
