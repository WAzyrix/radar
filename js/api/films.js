// =========================================================
// Films et séries : appels au relais Cloudflare, qui interroge TMDB
// (la clé TMDB reste chez Cloudflare). Même cache navigateur que pour les jeux.
// =========================================================
import { relais } from './relais.js';

const HEURE = 3600_000;

export async function rechercheFilmsSeries(texte) {
  const { resultats } = await relais('/tmdb/recherche', { q: texte }, { duree: 6 * HEURE });
  return resultats;
}

/** Genres TMDB en français : { film: [{ id, nom }], serie: [...] } */
export const genresFilms = () => relais('/tmdb/genres', {}, { duree: 7 * 24 * HEURE });

// Filtres de l'explorateur -> paramètres du relais
const parametres = (f = {}) => ({
  genres: f.genres?.length ? f.genres.join(',') : undefined,
  annee: f.annee || undefined,
  note: f.noteMin || undefined,
  plateforme: f.plateforme || undefined,
  tri: f.tri || undefined,
});

/** Découvrir des films ou des séries : { total, suite, resultats } */
export function decouvrirFilms(type, filtres, page = 1) {
  return relais('/tmdb/decouvrir', { type, ...parametres(filtres), page }, { duree: 6 * HEURE });
}

/** Un film ou une série au hasard parmi les plus populaires qui correspondent aux filtres. */
export async function filmAuHasard(type, filtres = {}) {
  const { resultat } = await relais('/tmdb/hasard', { type, ...parametres(filtres) }, { duree: 0 });
  return resultat;
}

/** Calendrier : films au cinéma en France / nouvelles séries. quand = 'avenir' | 'recentes' */
export async function sortiesFilms(type, quand = 'avenir') {
  const { resultats } = await relais('/tmdb/sorties', { type, quand }, { duree: 6 * HEURE });
  return resultats;
}

/** Séries qui ont un épisode cette semaine (nouvelles saisons comprises). */
export async function seriesEnCeMoment() {
  const { resultats } = await relais('/tmdb/en-ce-moment', {}, { duree: 6 * HEURE });
  return resultats;
}

export const ficheFilm = (type, id) => relais(`/tmdb/fiche/${type}/${id}`, {}, { duree: 12 * HEURE });
