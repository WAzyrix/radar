// =========================================================
// Petites fonctions utilitaires partagées par toutes les pages.
// =========================================================

// Échappe le texte avant de l'insérer dans du HTML (évite les injections).
// À utiliser pour TOUT texte qui vient d'une API ou d'un flux RSS.
export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

// Petit raccourci pour afficher une erreur dans un conteneur
export function afficherErreur(conteneur, erreur) {
  conteneur.innerHTML = `<div class="erreur">Oups : ${echapper(erreur.message)}</div>`;
}
