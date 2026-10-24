// =========================================================
// Calendrier des chapitres de manga : data/chapitres.json, régénéré toutes les heures par
// GitHub Actions (scripts/collecte_chapitres.py, d'après MangaUpdates et AniList).
// =========================================================
import { appeler } from '../lib/outils.js';

let fichier;
/** { genere, jours: { "AAAA-MM-JJ": [chapitre…] }, avenir: [prévision…] } ; erreur si illisible. */
export function chargerChapitres() {
  fichier ??= appeler('data/chapitres.json', { cache: 'no-cache' }, { service: 'le site', delai: 8000 })
    .then((r) => {
      if (!r.ok) throw new Error(`Calendrier des scans indisponible (erreur ${r.status}).`);
      return r.json();
    })
    .catch((erreur) => { fichier = null; throw erreur; });
  return fichier;
}

// Date du jour (fuseau du navigateur) au format des clés du fichier : AAAA-MM-JJ
export const cleJour = (decalage = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return new Intl.DateTimeFormat('en-CA').format(d);
};
