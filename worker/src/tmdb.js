// =========================================================
// Films et séries : API TMDB (clé secrète TMDB_KEY), en français.
// =========================================================

import { appelExterne } from './jeux.js';

const TMDB = 'https://api.themoviedb.org/3';
export const IMAGE_TMDB = 'https://image.tmdb.org/t/p/';

export async function tmdb(env, chemin, params = {}) {
  if (!env.TMDB_KEY) throw new Error('Clé TMDB absente (wrangler secret put TMDB_KEY)');
  const url = new URL(TMDB + chemin);
  for (const [cle, valeur] of Object.entries({ language: 'fr-FR', ...params })) url.searchParams.set(cle, valeur);
  url.searchParams.set('api_key', env.TMDB_KEY);
  const reponse = await appelExterne(url, { cf: { cacheTtl: 3600 } }, 'TMDB');
  return reponse.json();
}

/** Recherche de films ET de séries, résultats simplifiés. */
export async function rechercheTmdb(env, texte) {
  const data = await tmdb(env, '/search/multi', { query: texte.slice(0, 100), include_adult: 'false', region: 'FR' });
  return {
    resultats: data.results
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 12)
      .map((r) => ({
        type: r.media_type === 'movie' ? 'film' : 'serie',
        id: r.id,
        titre: r.title || r.name,
        titreOriginal: r.original_title || r.original_name,
        date: r.release_date || r.first_air_date || null,
        image: r.poster_path ? `${IMAGE_TMDB}w342${r.poster_path}` : null,
        fond: r.backdrop_path ? `${IMAGE_TMDB}w780${r.backdrop_path}` : null,
        note: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
        resume: (r.overview || '').slice(0, 300),
      })),
  };
}
