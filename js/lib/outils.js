// =========================================================
// Petites fonctions utilitaires partagées par toutes les pages.
// =========================================================

// Échappe le texte avant de l'insérer dans du HTML (évite les injections).
// À utiliser pour TOUT texte qui vient d'une API ou d'un flux RSS.
export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Crée un élément HTML sans jamais interpréter les données comme du HTML :
// les textes passent par des nœuds texte, les attributs par setAttribute.
// À utiliser pour tout ce qui vient de la base (pseudos, messages, listes des potes…).
//   el('a', { href: '…', class: 'pote', style: { '--couleur': '#ff0000' } }, 'texte', autreElement)
export function el(balise, attributs = {}, ...enfants) {
  const element = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs)) {
    if (valeur === undefined || valeur === null || valeur === false) continue;
    if (nom === 'style') for (const [propriete, v] of Object.entries(valeur)) element.style.setProperty(propriete, v);
    else element.setAttribute(nom, valeur === true ? '' : valeur);
  }
  element.append(...enfants.flat().filter((e) => e !== undefined && e !== null && e !== false && e !== ''));
  return element;
}

// Morceau de HTML écrit EN DUR dans le code (jamais de données) -> nœuds à insérer
export function gabarit(html) {
  const modele = document.createElement('template');
  modele.innerHTML = html;
  return modele.content;
}

// ---------- Validation des données venant de la base ----------
export const idValide = (id) => (Number.isInteger(id) && id > 0) || (typeof id === 'string' && /^\d{1,12}$/.test(id));
export const uuidValide = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');
export const couleurValide = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : null);
export const imageValide = (url) => (typeof url === 'string' && /^https:\/\//.test(url) ? url : null);

// Titre affiché : anglais s'il existe, sinon romaji.
export const titre = (media) => media.title.english || media.title.romaji;

// Note AniList (sur 100) -> "8,7"
export const note = (score) => (score ? (score / 10).toFixed(1).replace('.', ',') : '—');

// Le synopsis AniList contient un peu de HTML (<br>, <i>) : on garde juste le texte.
export function nettoyerSynopsis(html) {
  const avecRetours = (html || '').replace(/<br\s*\/?>/gi, '\n');
  const texte = new DOMParser().parseFromString(avecRetours, 'text/html').body.textContent;
  return texte.replace(/\n{3,}/g, '\n\n').trim();
}

// Pour comparer sans tenir compte des majuscules ni des accents
export const normaliser = (texte) => (texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const premiereMajuscule = (texte) => texte.charAt(0).toUpperCase() + texte.slice(1);

// ---------- Dates ----------
export const formatHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const formatJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
export const formatDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const relatif = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

// "il y a 3 h", "hier", "dans 2 jours"…
export function ilYa(date) {
  const secondes = (new Date(date) - Date.now()) / 1000;
  const unites = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unite, duree] of unites) {
    if (Math.abs(secondes) >= duree) return relatif.format(Math.round(secondes / duree), unite);
  }
  return "à l'instant";
}

// "2 j 5 h", "3 h 12 min"… à partir d'un timestamp Unix (secondes)
export function compteARebours(timestamp) {
  const secondes = Math.max(0, timestamp - Date.now() / 1000);
  const j = Math.floor(secondes / 86400);
  const h = Math.floor((secondes % 86400) / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  return j > 0 ? `${j} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Attend que l'utilisateur arrête de taper avant d'exécuter `fonction`
export function antiRebond(fonction, delai = 350) {
  let minuteur;
  return (...args) => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => fonction(...args), delai);
  };
}

// ---------- Réseau ----------
// Appel avec un délai maximum : un service qui ne répond pas ne laisse plus la page
// en chargement infini. `service` sert aux messages ("AniList", "le relais"…).
export async function appeler(url, options = {}, { service, delai = 15_000 } = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(delai) });
  } catch (erreur) {
    // `cause` garde l'erreur d'origine (TimeoutError, TypeError…) pour qui veut la distinguer
    if (erreur.name === 'TimeoutError') throw new Error(`${premiereMajuscule(service)} met trop de temps à répondre. Réessaie dans un instant.`, { cause: erreur });
    throw new Error(`Impossible de joindre ${service}. Vérifie ta connexion.`, { cause: erreur });
  }
}

// Code HTTP -> phrase compréhensible
export function messageStatut(service, statut) {
  if (statut === 404) return `Introuvable (${service} ne connaît pas cette page).`;
  if (statut === 429) return `${premiereMajuscule(service)} reçoit trop de demandes : réessaie dans une minute.`;
  if (statut >= 500) return `${premiereMajuscule(service)} est indisponible pour le moment (erreur ${statut}).`;
  return `${premiereMajuscule(service)} a refusé la demande (erreur ${statut}).`;
}

// Petit raccourci pour afficher une erreur dans un conteneur.
// Une TypeError vient d'une réponse dont la forme est inattendue (champ manquant…) :
// on n'affiche pas son message technique en anglais.
// Service saturé (erreur avec `reessaiDans`, en secondes) : compte à rebours, puis
// `reessayer()` est appelée toute seule (sauf si le conteneur a été vidé entre-temps).
export function afficherErreur(conteneur, erreur, { reessayer } = {}) {
  if (erreur?.reessaiDans && reessayer) {
    let reste = erreur.reessaiDans;
    const texte = el('div', { class: 'erreur', role: 'status' });
    const ecrire = () => {
      texte.textContent = erreur.texte?.(reste) ?? `${erreur.service} est surchargé, réessaie dans ${reste} seconde${reste > 1 ? 's' : ''}. Nouvel essai automatique…`;
    };
    ecrire();
    conteneur.replaceChildren(texte);
    const minuteur = setInterval(() => {
      if (!texte.isConnected) { clearInterval(minuteur); return; }
      reste -= 1;
      if (reste > 0) { ecrire(); return; }
      clearInterval(minuteur);
      reessayer();
    }, 1000);
    return;
  }
  const message = erreur instanceof TypeError ? 'les données reçues sont incomplètes. Réessaie un peu plus tard.' : erreur.message;
  conteneur.replaceChildren(el('div', { class: 'erreur' }, `Oups : ${message}`));
}
