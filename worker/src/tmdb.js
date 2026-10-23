// =========================================================
// Films et séries : API TMDB (clé secrète TMDB_KEY), en français.
// Fiches, découverte (genres, filtres), tirage au hasard, calendrier des sorties.
// =========================================================

import { appelExterne } from './jeux.js';
import { Erreur400 } from './comptes.js';

const TMDB = 'https://api.themoviedb.org/3';
export const IMAGE_TMDB = 'https://image.tmdb.org/t/p/';
const JOUR = 86400_000;

export async function tmdb(env, chemin, params = {}) {
  if (!env.TMDB_KEY) throw new Error('Clé TMDB absente (wrangler secret put TMDB_KEY)');
  const url = new URL(TMDB + chemin);
  for (const [cle, valeur] of Object.entries({ language: 'fr-FR', ...params })) {
    if (valeur !== undefined && valeur !== '') url.searchParams.set(cle, valeur);
  }
  url.searchParams.set('api_key', env.TMDB_KEY);
  const reponse = await appelExterne(url, { cf: { cacheTtl: 3600, cacheEverything: true } }, 'TMDB');
  return reponse.json();
}

// "film" / "serie" (le vocabulaire du site) <-> "movie" / "tv" (celui de TMDB)
const CHEMIN = { film: 'movie', serie: 'tv' };
export function typeValide(type) {
  if (!CHEMIN[type]) throw new Erreur400('Type inconnu (film ou serie)');
  return type;
}

// Séries : talk-shows, infos, téléréalité et feuilletons quotidiens noient tout le reste
const GENRES_EXCLUS_SERIES = [10767, 10763, 10764, 10766];
const serieInteressante = (r) => !(r.genre_ids || []).some((g) => GENRES_EXCLUS_SERIES.includes(g));

const image = (chemin, taille) => (chemin ? `${IMAGE_TMDB}${taille}${chemin}` : null);
const arrondi = (note) => (note ? Math.round(note * 10) / 10 : null);
// Date à Paris (AAAA-MM-JJ), décalée de `jours`
const jourParis = (jours = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() + jours * JOUR));

/** Résultat de liste simplifié (même forme pour films et séries). */
function carte(r, type) {
  return {
    type,
    id: r.id,
    titre: r.title || r.name,
    titreOriginal: r.original_title || r.original_name,
    date: r.release_date || r.first_air_date || null,
    image: image(r.poster_path, 'w342'),
    fond: image(r.backdrop_path, 'w780'),
    note: arrondi(r.vote_average),
    votes: r.vote_count || 0,
    popularite: Math.round(r.popularity || 0),
    langue: r.original_language || null,
    genres: r.genre_ids || [],
    resume: (r.overview || '').slice(0, 300),
  };
}

/** Recherche de films ET de séries, résultats simplifiés. */
export async function rechercheTmdb(env, texte) {
  const data = await tmdb(env, '/search/multi', { query: texte.slice(0, 100), include_adult: 'false', region: 'FR' });
  return {
    resultats: data.results
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 12)
      .map((r) => carte(r, r.media_type === 'movie' ? 'film' : 'serie')),
  };
}

// ---------- Genres ----------
export async function genresTmdb(env) {
  const [films, series] = await Promise.all([tmdb(env, '/genre/movie/list'), tmdb(env, '/genre/tv/list')]);
  const simplifier = (liste) => liste.genres.map((g) => ({ id: g.id, nom: g.name }));
  return { film: simplifier(films), serie: simplifier(series) };
}

// ---------- Découvrir (filtres) ----------
// Paramètres du site -> paramètres TMDB. On n'accepte que des valeurs connues.
const TRIS = {
  popularite: { film: 'popularity.desc', serie: 'popularity.desc' },
  note: { film: 'vote_average.desc', serie: 'vote_average.desc' },
  recents: { film: 'primary_release_date.desc', serie: 'first_air_date.desc' },
};

function filtresTmdb(type, p) {
  const nombre = (cle, min, max) => {
    const v = Number(p.get(cle));
    return Number.isInteger(v) && v >= min && v <= max ? v : undefined;
  };
  const genres = (p.get('genres') || '').split(',').filter((g) => /^\d{1,6}$/.test(g)).slice(0, 5).join(',');
  const annee = nombre('annee', 1900, 2100);
  const noteMin = nombre('note', 1, 9);
  const plateforme = nombre('plateforme', 1, 100_000);
  const tri = TRIS[p.get('tri')] ? p.get('tri') : 'popularite';
  return {
    sort_by: TRIS[tri][type],
    with_genres: genres || undefined,
    // Note ou récents : on écarte les œuvres presque sans votes (sinon des inconnus à 10/10)
    'vote_count.gte': tri === 'note' ? 300 : tri === 'recents' || noteMin ? 30 : undefined,
    'vote_average.gte': noteMin,
    ...(type === 'film'
      ? { primary_release_year: annee, 'primary_release_date.lte': tri === 'recents' ? jourParis() : undefined }
      : { first_air_date_year: annee, 'first_air_date.lte': tri === 'recents' ? jourParis() : undefined }),
    without_genres: type === 'serie' && !genres ? GENRES_EXCLUS_SERIES.join(',') : undefined,
    with_watch_providers: plateforme,
    watch_region: plateforme ? 'FR' : undefined,
    include_adult: 'false',
  };
}

export async function decouvrir(env, type, params) {
  const page = Math.min(Math.max(Number(params.get('page')) || 1, 1), 500);
  const data = await tmdb(env, `/discover/${CHEMIN[type]}`, { ...filtresTmdb(type, params), page });
  return { total: data.total_results, suite: page < Math.min(data.total_pages, 500), resultats: data.results.map((r) => carte(r, type)) };
}

// ---------- Au hasard ----------
// On tire une page au hasard parmi les 25 premières (les 500 plus populaires qui
// correspondent aux filtres), puis une œuvre au hasard dans cette page.
export async function hasardTmdb(env, type, params) {
  const filtres = { ...filtresTmdb(type, params), sort_by: TRIS.popularite[type] };
  const premiere = await tmdb(env, `/discover/${CHEMIN[type]}`, { ...filtres, page: 1 });
  if (!premiere.results?.length) return { resultat: null };
  const page = 1 + Math.floor(Math.random() * Math.min(premiere.total_pages, 25));
  const liste = page === 1 ? premiere : await tmdb(env, `/discover/${CHEMIN[type]}`, { ...filtres, page });
  const choix = liste.results.length ? liste.results : premiere.results;
  return { resultat: carte(choix[Math.floor(Math.random() * choix.length)], type) };
}

// ---------- Calendrier des sorties ----------
// Films : sorties au cinéma en France (type 3 = salles, 2 = salles limitées).
// Séries : premières diffusions (nouvelles séries) ; les nouvelles saisons sont dans "En ce moment".
// Les 40 plus populaires de la période (2 pages), triées ensuite par date.
export async function sorties(env, type, quand) {
  const avenir = quand !== 'recentes';
  const [debut, fin] = avenir ? [jourParis(0), jourParis(120)] : [jourParis(-45), jourParis(0)];
  const params = type === 'film'
    ? { region: 'FR', with_release_type: '2|3', 'release_date.gte': debut, 'release_date.lte': fin, sort_by: 'popularity.desc' }
    : { 'first_air_date.gte': debut, 'first_air_date.lte': fin, sort_by: 'popularity.desc' };
  const pages = await Promise.all([1, 2].map((page) => tmdb(env, `/discover/${CHEMIN[type]}`, { ...params, page }).catch(() => ({ results: [] }))));
  const vus = new Set();
  const resultats = pages.flatMap((p) => p.results)
    .filter((r) => !vus.has(r.id) && vus.add(r.id))
    // Les sorties confidentielles (sans affiche, presque personne ne les attend) n'intéressent personne
    .filter((r) => r.poster_path && r.popularity >= (type === 'film' ? 7 : 4) && (type === 'film' || serieInteressante(r)))
    .map((r) => carte(r, type));
  // Films : la date de sortie FRANÇAISE (la date principale est souvent celle des États-Unis).
  // Une requête par film (40 au plus) : on reste sous la limite de 50 requêtes sortantes.
  if (type === 'film') {
    await Promise.all(resultats.map(async (f) => {
      const fr = dateSalleFrance(await tmdb(env, `/movie/${f.id}/release_dates`).catch(() => null));
      if (fr) f.date = fr;
    }));
  }
  return {
    resultats: resultats
      .filter((r) => r.date && r.date >= debut && r.date <= fin)
      .sort((a, b) => (avenir ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date))),
  };
}

function dateSalleFrance(dates) {
  const fr = dates?.results?.find((r) => r.iso_3166_1 === 'FR');
  const salle = fr?.release_dates?.filter((d) => d.type === 3 || d.type === 2).sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
  return salle?.release_date?.slice(0, 10) || null;
}

// ---------- En ce moment (séries : un épisode cette semaine, nouvelles saisons comprises) ----------
export async function enCeMoment(env) {
  const pages = await Promise.all([1, 2].map((page) => tmdb(env, '/tv/on_the_air', { page, timezone: 'Europe/Paris' }).catch(() => ({ results: [] }))));
  return {
    resultats: pages.flatMap((p) => p.results)
      .filter((r) => r.poster_path && r.vote_count >= 50 && serieInteressante(r))
      .map((r) => carte(r, 'serie')),
  };
}

// ---------- Fiche complète ----------
export async function ficheTmdb(env, type, id) {
  const film = type === 'film';
  const d = await tmdb(env, `/${CHEMIN[type]}/${id}`, {
    append_to_response: [film ? 'credits' : 'aggregate_credits', 'videos', 'watch/providers', 'recommendations', film ? 'release_dates' : 'content_ratings', 'external_ids'].join(','),
    include_video_language: 'fr,en,null',
  });
  const credits = film ? d.credits : d.aggregate_credits;
  const fournisseurs = d['watch/providers']?.results?.FR;
  const plateformes = (cle) => (fournisseurs?.[cle] || []).map((p) => ({ id: p.provider_id, nom: p.provider_name, logo: image(p.logo_path, 'w92') }));
  // Bande-annonce : en français d'abord, sinon en anglais (YouTube uniquement)
  const videos = (d.videos?.results || []).filter((v) => v.site === 'YouTube' && /^[\w-]{6,20}$/.test(v.key));
  const bandeAnnonce = videos.find((v) => v.type === 'Trailer' && v.iso_639_1 === 'fr') || videos.find((v) => v.type === 'Trailer') || videos.find((v) => v.type === 'Teaser');
  const classification = film
    ? d.release_dates?.results?.find((r) => r.iso_3166_1 === 'FR')?.release_dates?.find((x) => x.certification)?.certification
    : d.content_ratings?.results?.find((r) => r.iso_3166_1 === 'FR')?.rating;

  return {
    type,
    id: d.id,
    titre: d.title || d.name,
    titreOriginal: d.original_title || d.original_name,
    slogan: d.tagline || null,
    resume: d.overview || null,
    date: d.release_date || d.first_air_date || null,
    dateFrance: film ? dateSalleFrance(d.release_dates) : null,
    duree: film ? d.runtime || null : d.episode_run_time?.[0] || null,
    statut: d.status || null,
    genres: (d.genres || []).map((g) => g.name),
    note: arrondi(d.vote_average),
    votes: d.vote_count || 0,
    image: image(d.poster_path, 'w500'),
    fond: image(d.backdrop_path, 'w1280'),
    pays: (d.production_countries || d.origin_country || []).map((p) => p.iso_3166_1 || p).slice(0, 3),
    langue: d.original_language || null,
    classification: classification || null,
    imdb: d.external_ids?.imdb_id || d.imdb_id || null,
    // Équipe : réalisation (film) ou création (série), puis les 15 premiers rôles
    auteurs: film
      ? (credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name).slice(0, 3)
      : (d.created_by || []).map((c) => c.name).slice(0, 3),
    casting: (credits?.cast || []).slice(0, 15).map((c) => ({
      nom: c.name,
      role: c.character || c.roles?.[0]?.character || '',
      photo: image(c.profile_path, 'w185'),
    })),
    bandeAnnonce: bandeAnnonce ? { cle: bandeAnnonce.key, nom: bandeAnnonce.name } : null,
    regarder: fournisseurs ? {
      lien: fournisseurs.link || null, // page TMDB/JustWatch avec les liens directs
      // "ads" = abonnement moins cher avec publicités (Netflix Standard with Ads), pas gratuit
      abonnement: [...plateformes('flatrate'), ...plateformes('ads')],
      gratuit: plateformes('free'),
      location: plateformes('rent'),
      achat: plateformes('buy'),
    } : null,
    // Séries
    chaines: (d.networks || []).map((n) => n.name).slice(0, 3),
    nbSaisons: d.number_of_seasons || null,
    nbEpisodes: d.number_of_episodes || null,
    saisons: (d.seasons || []).filter((s) => s.season_number > 0).map((s) => ({
      numero: s.season_number, nom: s.name, episodes: s.episode_count, date: s.air_date, image: image(s.poster_path, 'w185'),
    })),
    prochainEpisode: episode(d.next_episode_to_air),
    dernierEpisode: episode(d.last_episode_to_air),
    recommandations: (d.recommendations?.results || []).filter((r) => r.poster_path).slice(0, 15).map((r) => carte(r, type)),
  };
}

const episode = (e) => (e ? { saison: e.season_number, numero: e.episode_number, nom: e.name, date: e.air_date } : null);
