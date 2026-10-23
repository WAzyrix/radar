// =========================================================
// Films et séries : recherche TMDB via le relais (la clé TMDB reste chez Cloudflare).
// =========================================================
import { relais } from './relais.js';

export async function rechercheFilmsSeries(texte) {
  const { resultats } = await relais('/tmdb/recherche', { q: texte }, { duree: 6 * 3600_000 });
  return resultats;
}
