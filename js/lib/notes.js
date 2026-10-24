// =========================================================
// Notes perso et favoris : un seul système pour les animés, mangas, films, séries et jeux.
//
// Pour chaque œuvre : ma note sur 100, un petit avis (500 caractères max, seulement avec
// une note) et/ou un favori ❤️. Les notes d'AniList, RAWG/Metacritic et TMDB restent à côté.
//
// - Stockage local (localStorage) : ça marche sans compte et hors connexion.
// - Connecté : synchronisé avec la table Supabase "notes" (supabase/notes.sql), visible
//   par mes amis et les membres de mes groupes (règles RLS de la base).
// - Entre deux appareils, la modification la plus récente gagne (champ "maj").
//
// Une note vient de moi, mais celles des potes viennent de la base : notesValides()
// les vérifie avant tout affichage, et l'avis est toujours affiché comme du texte.
// =========================================================
import { SUPABASE_URL } from '../config.js';
import { idValide, imageValide } from './outils.js';
import { viderCache } from './cache.js';
import * as maListe from './ma-liste.js';

const CLE = 'radar:notes';
export const AVIS_MAX = 500;
export const TYPES_NOTES = ['anime', 'manga', 'film', 'serie', 'jeu'];
const comptesActifs = () => !SUPABASE_URL.includes('A-REMPLACER');
export const cleOeuvre = (type, id) => `${type}:${Number(id)}`;

// { utilisateur, items: { "anime:123": note }, supprimes: { "anime:123": maj } }
// note = { type, id, titre, image, note, avis, favori, noteLe, favoriLe, maj, synchro, modifiee }
// "synchro" : la ligne existe dans la base. Si elle n'y est plus, elle a été supprimée
// depuis un autre appareil : on la supprime ici aussi (au lieu de la renvoyer)…
// … sauf si elle a été modifiée ici depuis ("modifiee", jusqu'à son envoi) : la modification
// la plus récente gagne, elle est renvoyée.
function lire() {
  try {
    const d = JSON.parse(localStorage.getItem(CLE));
    if (d && typeof d.items === 'object' && d.items) return { utilisateur: d.utilisateur || null, items: d.items, supprimes: d.supprimes || {} };
  } catch { /* illisible : on repart de zéro */ }
  return { utilisateur: null, items: {}, supprimes: {} };
}

function ecrire(d) {
  const valeur = JSON.stringify(d);
  try {
    localStorage.setItem(CLE, valeur);
  } catch {
    viderCache('al:'); // stockage plein : les caches d'API passent après
    viderCache('jv2:');
    localStorage.setItem(CLE, valeur);
  }
  window.dispatchEvent(new CustomEvent('radar:notes'));
}

// ---------- Lecture ----------
export const toutes = () => Object.values(lire().items);
export const noteDe = (type, id) => lire().items[cleOeuvre(type, id)] || null;
export const favoris = (type) => toutes().filter((n) => n.favori && (!type || n.type === type));
export const notees = (type) => toutes().filter((n) => Number.isInteger(n.note) && (!type || n.type === type));

/** Adresse de la fiche d'une œuvre notée (même règle que Ma liste). */
export const lienNote = (n) => maListe.lienElement({ type: n.type, id: n.id });

// ---------- Écriture ----------
function nettoyer(n) {
  const note = Number.isInteger(n.note) && n.note >= 0 && n.note <= 100 ? n.note : null;
  const avis = note !== null && typeof n.avis === 'string' && n.avis.trim() ? n.avis.trim().slice(0, AVIS_MAX) : null;
  return { ...n, note, avis, favori: Boolean(n.favori) };
}

/**
 * Change ma note, mon avis et/ou mon favori pour une œuvre.
 * `oeuvre` = { type, id, titre, image } ; `changements` = { note?, avis?, favori? }.
 * Sans note ni favori, l'œuvre disparaît de mes notes. Renvoie la note enregistrée (ou null).
 */
export function modifier(oeuvre, changements) {
  if (!TYPES_NOTES.includes(oeuvre.type) || !idValide(oeuvre.id)) throw new Error('Œuvre inconnue');
  const d = lire();
  const cle = cleOeuvre(oeuvre.type, oeuvre.id);
  const avant = d.items[cle] || { note: null, avis: null, favori: false };
  const maintenant = new Date().toISOString();
  const n = nettoyer({
    ...avant,
    ...changements,
    type: oeuvre.type,
    id: Number(oeuvre.id),
    titre: String(oeuvre.titre || avant.titre || '?').slice(0, 200),
    image: imageValide(oeuvre.image) || avant.image || null,
    maj: Date.now(),
  });
  if (n.note !== avant.note || n.avis !== avant.avis) n.noteLe = n.note === null ? null : maintenant;
  if (n.favori && !avant.favori) n.favoriLe = maintenant;
  if (!n.favori) n.favoriLe = null;

  if (n.note === null && !n.favori) {
    delete d.items[cle];
    if (avant.synchro) d.supprimes[cle] = n.maj; // à supprimer aussi dans la base
  } else {
    d.items[cle] = { ...n, modifiee: true };
    delete d.supprimes[cle];
  }
  ecrire(d);
  envoyerPlusTard();
  return d.items[cle] || null;
}

export const basculerFavori = (oeuvre) => modifier(oeuvre, { favori: !noteDe(oeuvre.type, oeuvre.id)?.favori });

// ---------- Notes venant de la base (les miennes, ou celles des potes) ----------
/** Ligne de la table "notes" -> note du site, ou null si elle est mal formée. */
export function depuisBase(r) {
  if (!r || !TYPES_NOTES.includes(r.type) || !idValide(r.oeuvre)) return null;
  const note = Number.isInteger(r.note) && r.note >= 0 && r.note <= 100 ? r.note : null;
  return {
    type: r.type,
    id: Number(r.oeuvre),
    titre: String(r.titre ?? '').slice(0, 200),
    image: imageValide(r.image),
    note,
    avis: note !== null && typeof r.avis === 'string' ? r.avis.slice(0, AVIS_MAX) : null,
    favori: r.favori === true,
    noteLe: typeof r.note_le === 'string' ? r.note_le : null,
    favoriLe: typeof r.favori_le === 'string' ? r.favori_le : null,
    maj: Number(r.maj) || 0,
    auteur: r.user_id,
  };
}

/** Notes des potes (lignes de la base) -> notes valides, sans les lignes inutiles. */
export const notesValides = (lignes) => (Array.isArray(lignes) ? lignes.map(depuisBase).filter((n) => n && (n.note !== null || n.favori)) : []);

// ---------- Synchronisation avec le compte ----------
let minuteur;
function envoyerPlusTard() {
  if (!comptesActifs()) return;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => synchroniserNotes().catch(() => { /* hors connexion : la prochaine fois */ }), 1200);
}

let synchroEnCours = null;
/** Fusionne mes notes locales et celles de mon compte. Sans compte : ne fait rien. */
export function synchroniserNotes() {
  synchroEnCours ??= synchroniser().finally(() => { synchroEnCours = null; });
  return synchroEnCours;
}

async function synchroniser() {
  if (!comptesActifs()) return false;
  const compte = await import('./compte.js');
  const u = await compte.utilisateur();
  if (!u) return false;
  const distantes = notesValides(await compte.mesNotes());

  const d = lire();
  // Un autre compte sur cet appareil : ses notes déjà synchronisées ne sont pas les miennes
  if (d.utilisateur && d.utilisateur !== u.id) {
    for (const [cle, n] of Object.entries(d.items)) if (n.synchro) delete d.items[cle];
    d.supprimes = {};
  }
  d.utilisateur = u.id;

  const aEnvoyer = [];
  const aSupprimer = [];
  const enBase = new Map(distantes.map((n) => [cleOeuvre(n.type, n.id), n]));
  for (const [cle, distante] of enBase) {
    const locale = d.items[cle];
    const majLocale = locale?.maj ?? d.supprimes[cle] ?? -1;
    if (majLocale > distante.maj) {
      if (locale) aEnvoyer.push(locale); else aSupprimer.push(distante);
    } else {
      const { auteur, ...propre } = distante;
      d.items[cle] = { ...propre, synchro: true };
      delete d.supprimes[cle];
    }
  }
  for (const [cle, locale] of Object.entries(d.items)) {
    if (enBase.has(cle)) continue;
    if (locale.synchro && !locale.modifiee) delete d.items[cle]; // supprimée depuis un autre appareil
    else aEnvoyer.push(locale);
  }

  await compte.enregistrerNotes(aEnvoyer);
  await compte.supprimerNotes(aSupprimer);
  for (const n of aEnvoyer) {
    const locale = d.items[cleOeuvre(n.type, n.id)];
    if (locale) { locale.synchro = true; delete locale.modifiee; }
  }
  d.supprimes = {};
  ecrire(d);
  return true;
}

// ---------- Compatibilité de goûts ----------
export const CATEGORIES = {
  animes: { nom: 'Animés', types: ['anime', 'manga'] },
  jeux: { nom: 'Jeux', types: ['jeu'] },
  films: { nom: 'Films et séries', types: ['film', 'serie'] },
};
const categorieDe = (type) => Object.keys(CATEGORIES).find((c) => CATEGORIES[c].types.includes(type));

// Ce qu'une personne pense d'une œuvre, sur 100 : sa note, sinon 90 pour un favori
const valeur = (n) => (n.note !== null ? n.note : n.favori ? 90 : null);

/**
 * Compatibilité entre mes notes et celles d'un pote, sur les œuvres notées (ou mises en
 * favori) par les deux : 100 % = mêmes notes, 0 % = 50 points d'écart en moyenne.
 * Avec peu d'œuvres en commun, le résultat est ramené vers 50 % (on ne sait pas encore).
 * Renvoie { global, animes, jeux, films }, chacun { pourcent, communs } ou null.
 */
export function compatibilite(mes, siennes) {
  const chezLui = new Map(siennes.map((n) => [cleOeuvre(n.type, n.id), n]));
  const ecarts = { global: [], animes: [], jeux: [], films: [] };
  for (const n of mes) {
    const autre = chezLui.get(cleOeuvre(n.type, n.id));
    const a = valeur(n);
    const b = autre && valeur(autre);
    if (a === null || b === null || b === undefined) continue;
    const ecart = Math.abs(a - b);
    ecarts.global.push(ecart);
    ecarts[categorieDe(n.type)].push(ecart);
  }
  const resultat = {};
  for (const [cle, liste] of Object.entries(ecarts)) {
    if (!liste.length) { resultat[cle] = null; continue; }
    const brut = Math.max(0, 100 - 2 * (liste.reduce((s, e) => s + e, 0) / liste.length));
    const confiance = liste.length / (liste.length + 3);
    resultat[cle] = { pourcent: Math.round(50 + (brut - 50) * confiance), communs: liste.length };
  }
  return resultat;
}

/**
 * « Ce que tes potes les plus compatibles ont adoré et que tu n'as pas vu », par catégorie.
 * `potes` = [{ pote, notes, compat }] ; on garde les 3 plus compatibles (50 % et plus) et
 * leurs œuvres notées 80+ ou en favori, absentes de mes notes et de ma liste.
 */
export function suggestions(potes, mes, { parCategorie = 10 } = {}) {
  const connues = new Set([...mes.map((n) => cleOeuvre(n.type, n.id)), ...maListe.items().map((i) => cleOeuvre(i.type, i.id))]);
  const resultat = {};
  for (const categorie of Object.keys(CATEGORIES)) {
    const meilleurs = potes
      .filter((p) => (p.compat?.[categorie]?.pourcent ?? p.compat?.global?.pourcent ?? 0) >= 50)
      .sort((a, b) => (b.compat?.[categorie]?.pourcent ?? b.compat?.global?.pourcent ?? 0) - (a.compat?.[categorie]?.pourcent ?? a.compat?.global?.pourcent ?? 0))
      .slice(0, 3);
    const scores = new Map();
    for (const p of meilleurs) {
      const poids = (p.compat?.[categorie]?.pourcent ?? p.compat?.global?.pourcent) / 100;
      for (const n of p.notes) {
        const v = valeur(n);
        const cle = cleOeuvre(n.type, n.id);
        if (categorieDe(n.type) !== categorie || v === null || v < 80 || connues.has(cle)) continue;
        if (!scores.has(cle)) scores.set(cle, { oeuvre: n, score: 0, potes: [] });
        const s = scores.get(cle);
        s.score += poids * v;
        s.potes.push({ pote: p.pote, note: n.note, favori: n.favori });
      }
    }
    resultat[categorie] = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, parCategorie);
  }
  return resultat;
}

// ---------- Les « Adorés » des jeux deviennent des favoris (une seule fois) ----------
// Avant ce système, le coup de cœur d'un jeu était son statut « Adoré » (listes-jeux.js).
// Le statut reste (il veut maintenant dire « Terminé ») et le jeu passe en favori.
// (en fin de module : tout ce qu'utilise modifier() doit déjà être initialisé)
(function migrerAdores() {
  try {
    if (localStorage.getItem('radar:notes-adores')) return;
    for (const j of maListe.items('jeu').filter((x) => x.statut === 'adore' && idValide(x.id))) {
      if (!noteDe('jeu', j.id)?.favori) modifier({ type: 'jeu', id: j.id, titre: j.titre, image: j.image }, { favori: true });
    }
    localStorage.setItem('radar:notes-adores', '1');
  } catch { /* stockage indisponible : on réessaiera */ }
}());
