// =========================================================
// Toutes les requêtes "métier" sur les animés.
// Les pages appellent ces fonctions, jamais directement l'API :
// si AniList change, il n'y a que ce fichier à modifier.
// =========================================================
import { anilist } from './anilist.js';
import { appeler } from '../lib/outils.js';
import { lireCache, ecrireCache } from '../lib/cache.js';

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

// Champs nécessaires pour afficher une affiche (fragment réutilisé partout)
// (recopiés dans scripts/collecte_anilist.py : changer les deux)
const CHAMPS_CARTE = 'id title{romaji english} coverImage{extraLarge large color} averageScore format seasonYear episodes genres status';

// ---------- Données pré-générées (data/anilist.json) ----------
// Tendances, mieux notés de la saison et calendrier sont récupérés toutes les heures par
// GitHub Actions (scripts/collecte_anilist.py) : l'accueil et le calendrier n'appellent plus
// AniList. Fichier absent ou vieux de plus de 3 h (collecte en panne) : on interroge AniList.
let pregenere;
function lirePregenere() {
  pregenere ??= appeler('data/anilist.json', { cache: 'no-cache' }, { service: 'le site', delai: 8000 })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && Date.now() - Date.parse(d.genere) < 3 * HEURE ? d : null))
    .catch(() => null);
  return pregenere;
}

// Une donnée en cache est dépassée si le "prochain épisode" qu'elle annonce est déjà sorti
const prochainsAJour = (medias) => medias.every((m) => !m?.nextAiringEpisode || m.nextAiringEpisode.airingAt * 1000 > Date.now());

// ---------- Accueil ----------

export function saisonActuelle(date = new Date()) {
  const saisons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  return { saison: saisons[Math.floor(date.getMonth() / 3)], annee: date.getFullYear() };
}

// Tendances + meilleurs de la saison, en UNE requête grâce aux alias GraphQL
export async function tendancesEtSaison() {
  const { saison, annee } = saisonActuelle();
  const d = await lirePregenere();
  if (d?.saison?.nom === saison && d.saison.annee === annee && d.tendances?.length) {
    return { tendances: d.tendances, saison: d.saison.medias, nomSaison: saison };
  }
  const data = await anilist(`query($saison:MediaSeason, $annee:Int){
    tendances: Page(perPage:20){ media(type:ANIME, sort:TRENDING_DESC, isAdult:false){ ${CHAMPS_CARTE} bannerImage description } }
    saison: Page(perPage:20){ media(type:ANIME, season:$saison, seasonYear:$annee, sort:SCORE_DESC, isAdult:false, popularity_greater:3000){ ${CHAMPS_CARTE} } }
  }`, { saison, annee }, { duree: HEURE });
  return { tendances: data.tendances.media, saison: data.saison.media, nomSaison: saison };
}

// ---------- Calendrier ----------

/**
 * Épisodes diffusés un jour donné (heure locale).
 * `decalage` = nombre de jours par rapport à aujourd'hui (-1 = hier, 0 = aujourd'hui…).
 * Attention : `airingAt` est l'heure de diffusion TV au JAPON (convertie ensuite dans
 * le fuseau du navigateur). Les sites de streaming VOSTFR publient un peu plus tard.
 */
export async function calendrierDuJour(decalage) {
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  debut.setDate(debut.getDate() + decalage);
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + 1);

  const a = Math.floor(debut / 1000);
  const b = Math.floor(fin / 1000);

  const d = await lirePregenere();
  if (d?.calendrier && d.calendrier.de <= a && d.calendrier.a >= b) {
    return d.calendrier.episodes.filter((e) => e.airingAt >= a && e.airingAt < b && !e.media.isAdult);
  }

  // Un jour chargé peut dépasser 50 épisodes : 3 pages de 50 en UNE requête (alias GraphQL)
  const page = (n) => `p${n}: Page(page:${n}, perPage:50){ pageInfo{ hasNextPage }
    airingSchedules(airingAt_greater:$a, airingAt_lesser:$b, sort:TIME){
      episode airingAt media{ id isAdult popularity episodes title{romaji english native} synonyms coverImage{large color} } } }`;
  const data = await anilist(`query($a:Int, $b:Int){ ${[1, 2, 3].map(page).join(' ')} }`,
    { a: a - 1, b }, { duree: 15 * MINUTE });
  const episodes = [];
  for (const n of [1, 2, 3]) {
    episodes.push(...data[`p${n}`].airingSchedules);
    if (!data[`p${n}`].pageInfo.hasNextPage) break;
  }
  return episodes.filter((e) => !e.media.isAdult);
}

// ---------- Fiche ----------

export async function ficheAnime(id) {
  const data = await anilist(`query($id:Int){ Media(id:$id){
    id type format status episodes chapters volumes duration season seasonYear averageScore popularity genres siteUrl
    description bannerImage coverImage{extraLarge large color}
    title{romaji english native} synonyms
    externalLinks{ site url type language }
    streamingEpisodes{ title url site }
    startDate{year month day}
    studios(isMain:true){ nodes{ name } }
    nextAiringEpisode{ episode airingAt }
    trailer{ id site }
    relations{ edges{ relationType node{ id type format startDate{year month day} title{romaji english} coverImage{extraLarge large color} averageScore } } }
    recommendations(perPage:15, sort:RATING_DESC){ nodes{ mediaRecommendation{ ${CHAMPS_CARTE} } } }
    reviews(perPage:8, sort:RATING_DESC){ nodes{ id summary score rating ratingAmount siteUrl user{ name avatar{ medium } } } }
  } }`, { id }, { duree: 24 * HEURE, valide: (d) => prochainsAJour([d.Media]) });
  return data.Media;
}

// ---------- Épisodes sur les plateformes officielles (fiche : « Regarder les épisodes ») ----------
// Pour chaque saison : liens vers la série (externalLinks) et vers chaque épisode
// (streamingEpisodes, surtout Crunchyroll). 50 saisons au plus par requête.
export async function episodesStreaming(ids) {
  const data = await anilist(`query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids){
    id format episodes status nextAiringEpisode{ episode airingAt }
    externalLinks{ site url type language }
    streamingEpisodes{ title url site }
  } } }`, { ids: [...ids].sort((a, b) => a - b).slice(0, 50) }, { duree: 6 * HEURE, valide: (d) => prochainsAJour(d.Page.media) });
  return data.Page.media;
}

// ---------- Saisons d'une même série ----------

// Formats considérés comme des "saisons" (les films, OVA et spéciaux vont dans "Autour de l'œuvre")
export const FORMATS_SAISON = ['TV', 'TV_SHORT', 'ONA'];

// Date de début comparable (20240315) ; null si AniList ne la connaît pas encore
export const dateDebut = (d) => (d?.year ? d.year * 10000 + (d.month || 1) * 100 + (d.day || 1) : null);

const MAX_OEUVRES = 60; // garde-fou pour les très grandes franchises

// Plusieurs œuvres d'un coup (50 max), avec leurs liens préquelle/suite
// et de quoi remplir « Regarder les épisodes » (plus besoin d'une requête à part)
async function liensSaisons(ids) {
  const data = await anilist(`query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids){
    id format episodes status season seasonYear startDate{year month day} title{romaji english}
    nextAiringEpisode{ episode airingAt }
    externalLinks{ site url type language }
    streamingEpisodes{ title url site }
    relations{ edges{ relationType node{ id type } } } } } }`, { ids: [...ids].sort((a, b) => a - b) },
  { duree: 24 * HEURE, valide: (d) => prochainsAJour(d.Page.media) });
  return data.Page.media;
}

// Découverte de la chaîne préquelles/suites : les relations sur 3 niveaux en UNE requête
// (une franchise de 10 œuvres = 4 requêtes au lieu de 10)
const CHAMPS_CHAINE = 'id type format episodes startDate{year month day}';
const RELATIONS_3_NIVEAUX = [1, 2, 3].reduce((interieur) => `relations{ edges{ relationType node{ ${CHAMPS_CHAINE} ${interieur} } } }`, '');
const LIENS_CHAINE = ['PREQUEL', 'SEQUEL'];
const CLE_FRANCHISE = (id) => `al:franchise:${id}`;

/**
 * Toutes les saisons d'un animé, triées par date de diffusion (Saison 1, 2, 3…).
 * AniList relie les œuvres par "préquelle" / "suite" dans l'ORDRE DE L'HISTOIRE, pas de la
 * diffusion, et une œuvre peut avoir plusieurs suites (Dragon Ball Z -> GT ET Super).
 * On récupère donc TOUTE la chaîne préquelles/suites (toutes les branches, en traversant
 * films et OVA), sans jamais prendre les autres relations (histoires parallèles, spin-off,
 * autres versions…), puis on garde les saisons et on trie par date.
 * - découverte : 3 niveaux de relations par requête, 6 requêtes au plus (18 niveaux) ;
 * - la liste trouvée est gardée 24 h pour CHAQUE œuvre de la chaîne : ouvrir une autre saison
 *   de la même franchise ne coûte plus qu'une requête (les liens d'épisodes), ou zéro.
 */
export async function saisons(id) {
  let ids = lireCache(CLE_FRANCHISE(id));
  if (!Array.isArray(ids)) {
    ids = await decouvrirSaisons(id);
    for (const membre of ids.chaine) ecrireCache(CLE_FRANCHISE(membre), ids.saisons, 24 * HEURE, 'al:');
    ids = ids.saisons;
  }
  if (!ids.length) return [];
  // Les liens d'épisodes de toutes les saisons, en une requête (50 au plus par lot)
  const medias = [];
  for (let i = 0; i < ids.length; i += 50) medias.push(...await liensSaisons(ids.slice(i, i + 50)));
  const parId = new Map(medias.map((m) => [m.id, m]));
  return ids.map((x) => parId.get(x)).filter(Boolean);
}

/** { chaine: ids de toutes les œuvres reliées, saisons: ids des saisons dans l'ordre de diffusion } */
async function decouvrirSaisons(id) {
  // id -> { format, episodes, startDate, liens: [{ type, id }] | null (pas encore lus) }
  const noeuds = new Map();
  // AniList renvoie des relations VIDES pour une œuvre qui réapparaît plus bas dans l'arbre :
  // on fusionne les relations (jamais d'écrasement), et des relations vides en profondeur
  // veulent dire "pas encore lues" (seule l'œuvre demandée elle-même peut vraiment n'en avoir aucune).
  const noter = (m, demandee = false) => {
    const n = noeuds.get(m.id) || { id: m.id, liens: null };
    for (const champ of ['type', 'format', 'episodes', 'startDate']) if (m[champ] !== undefined) n[champ] = m[champ];
    noeuds.set(m.id, n);
    const edges = m.relations?.edges;
    if (edges && (edges.length || demandee)) {
      const connus = new Set((n.liens || []).map((l) => l.id));
      n.liens = [...(n.liens || []), ...edges
        .filter((e) => LIENS_CHAINE.includes(e.relationType) && e.node.type === 'ANIME' && !connus.has(e.node.id))
        .map((e) => ({ type: e.relationType, id: e.node.id }))];
      edges.forEach((e) => noter(e.node));
    }
  };
  // La chaîne vue depuis `id` (préquelles/suites seulement), dans la limite de MAX_OEUVRES
  const chaine = () => {
    const vus = new Set([id]);
    const file = [id];
    while (file.length && vus.size < MAX_OEUVRES) {
      for (const l of noeuds.get(file.shift())?.liens || []) if (!vus.has(l.id)) { vus.add(l.id); file.push(l.id); }
    }
    return [...vus];
  };

  for (let requete = 0; requete < 6; requete++) {
    // À lire : les œuvres de la chaîne dont on ne connaît pas encore les relations ou le format
    const aLire = chaine().filter((x) => !noeuds.get(x) || noeuds.get(x).liens === null).slice(0, 50);
    if (!aLire.length) break;
    const data = await anilist(`query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids){ ${CHAMPS_CHAINE} ${RELATIONS_3_NIVEAUX} } } }`,
      { ids: [...aLire].sort((a, b) => a - b) }, { duree: 24 * HEURE });
    data.Page.media.forEach((m) => noter(m, true));
    // Une œuvre introuvable ne doit pas être redemandée sans fin
    for (const x of aLire) {
      const n = noeuds.get(x);
      if (!n || n.liens === null) noeuds.set(x, { ...n, id: x, liens: [] });
    }
  }

  const membres = chaine().map((x) => noeuds.get(x)).filter(Boolean);
  // Lien préquelle/suite "dans le bon ordre" avec une autre œuvre de la chaîne :
  // une préquelle sortie avant, ou une suite sortie après (date inconnue : accepté).
  const dansLOrdre = (n) => (n.liens || []).some((l) => {
    const autre = noeuds.get(l.id);
    if (!autre) return false;
    const ici = dateDebut(n.startDate);
    const la = dateDebut(autre.startDate);
    return !ici || !la || (l.type === 'PREQUEL' ? la <= ici : la >= ici);
  });
  // Une saison : format série. Un seul épisode : seulement s'il s'inscrit dans l'ordre de diffusion.
  //  - "STEEL BALL RUN 1st STAGE" (1 épisode de 47 min, 2026) suit bien Stone Ocean (2022) : gardé ;
  //  - "MONSTERS: 103 Mercies Dragon Damnation" (1 épisode, 2024) est rangé par AniList comme
  //    "préquelle" de One Piece (1999) : histoire antérieure, sortie bien après. Ce n'est pas une
  //    saison : il va dans "Autour de l'œuvre".
  const estSaison = (n) => FORMATS_SAISON.includes(n.format) && (n.episodes !== 1 || dansLOrdre(n));
  // Date inconnue (saison annoncée) : en dernier
  const saisonsTriees = membres.filter(estSaison)
    .sort((a, b) => (dateDebut(a.startDate) ?? Infinity) - (dateDebut(b.startDate) ?? Infinity));
  return { chaine: membres.map((n) => n.id), saisons: saisonsTriees.map((n) => n.id) };
}

// ---------- Recherche ----------

export async function rechercheRapide(texte) {
  const data = await anilist(`query($s:String){ Page(perPage:6){ media(search:$s, type:ANIME, isAdult:false, sort:SEARCH_MATCH){
    id title{romaji english} format seasonYear coverImage{medium color} } } }`, { s: texte }, { duree: HEURE });
  return data.Page.media;
}

// ---------- Explorer (genres + filtres) ----------

// Transforme nos filtres "lisibles" en variables AniList.
// Un filtre vide devient `undefined` : AniList l'ignore (alors qu'il refuse `null`).
function variablesFiltres(f) {
  const vide = (v) => (v === '' || v == null || (Array.isArray(v) && !v.length) ? undefined : v);
  return {
    search: vide(f.texte?.trim()),
    genres: vide(f.genres),
    tags: vide(f.tags),
    note: f.noteMin > 0 ? f.noteMin - 1 : undefined, // "greater" est strict : 70 -> >69
    statut: vide(f.statut),
    annee: f.annee ? Number(f.annee) : undefined,
    format: vide(f.format),
    // Avec une recherche texte, on trie par pertinence
    tri: f.texte?.trim() ? ['SEARCH_MATCH'] : [f.tri || 'POPULARITY_DESC'],
  };
}

const ARGS_FILTRES = '$search:String, $genres:[String], $tags:[String], $note:Int, $statut:MediaStatus, $annee:Int, $format:MediaFormat, $tri:[MediaSort]';
const FILTRES = 'type:ANIME, isAdult:false, search:$search, genre_in:$genres, tag_in:$tags, averageScore_greater:$note, status:$statut, seasonYear:$annee, format:$format, sort:$tri';

// Attention : AniList renvoie toujours un "total" de 5000 (valeur factice).
// On ne s'en sert donc pas ; seul `hasNextPage` est fiable.
export async function explorer(filtres, page = 1, parPage = 24) {
  const data = await anilist(`query($page:Int, $parPage:Int, ${ARGS_FILTRES}){
    Page(page:$page, perPage:$parPage){ pageInfo{ hasNextPage } media(${FILTRES}){ ${CHAMPS_CARTE} } } }`,
  { page, parPage, ...variablesFiltres(filtres) }, { duree: HEURE });
  return { suite: data.Page.pageInfo.hasNextPage, medias: data.Page.media };
}

// Une page de 50 identifiants seulement (requête légère, gardée en cache)
async function pageIds(filtres, page) {
  const data = await anilist(`query($page:Int, ${ARGS_FILTRES}){
    Page(page:$page, perPage:50){ pageInfo{ hasNextPage } media(${FILTRES}){ id } } }`,
  { page, ...variablesFiltres(filtres) }, { duree: 30 * MINUTE });
  return { ids: data.Page.media.map((m) => m.id), suite: data.Page.pageInfo.hasNextPage };
}

/**
 * Tire un animé au hasard parmi ceux qui correspondent aux filtres.
 * AniList n'a pas de "random" et son total est faux, donc :
 *  1. on cherche la dernière page non vide (pages de 50, par dichotomie, 10 pages max
 *     = on pioche parmi les 500 plus populaires qui correspondent) ;
 *  2. on prend une page au hasard, puis un animé au hasard dedans.
 * Les pages d'identifiants sont en cache : les tirages suivants sont quasi instantanés.
 */
export async function auHasard(filtres = { noteMin: 65 }) {
  const f = { ...filtres, texte: '', tri: 'POPULARITY_DESC' };
  const premiere = await pageIds(f, 1);
  if (!premiere.ids.length) return null;

  let derniere = 1;
  if (premiere.suite) {
    let bas = 2;
    let haut = 10;
    while (bas < haut) {
      const milieu = Math.ceil((bas + haut) / 2);
      if ((await pageIds(f, milieu)).ids.length) bas = milieu; else haut = milieu - 1;
    }
    derniere = bas;
  }

  const { ids } = await pageIds(f, 1 + Math.floor(Math.random() * derniere));
  const id = ids[Math.floor(Math.random() * ids.length)];
  const data = await anilist(`query($id:Int){ Media(id:$id){ ${CHAMPS_CARTE} bannerImage description } }`, { id }, { duree: HEURE });
  return data.Media;
}

// ---------- Rattrapage ----------

/**
 * Pour une liste d'animés suivis : leurs infos à jour + les épisodes sortis depuis `depuis` (Date).
 */
export async function rattrapage(ids, depuis) {
  // Bornes arrondies (début au jour, fin au quart d'heure suivant) : sinon la requête change
  // à chaque seconde et le cache ne sert jamais
  const a = Math.floor(depuis / 86400_000) * 86400;
  const b = Math.ceil(Date.now() / (15 * MINUTE)) * 15 * 60;
  const maintenant = Date.now() / 1000;
  const sorties = [];
  const medias = [];

  // AniList renvoie 50 résultats au plus par page : lots de 50 œuvres, et jusqu'à 5 pages
  // d'épisodes par lot (une franchise suivie compte toutes ses saisons)
  for (let debut = 0; debut < ids.length; debut += 50) {
    const lot = ids.slice(debut, debut + 50);
    for (let page = 1; page <= 5; page++) {
      const data = await anilist(`query($ids:[Int], $a:Int, $b:Int, $page:Int){
        suivis: Page(perPage:50){ media(id_in:$ids){ ${CHAMPS_CARTE} nextAiringEpisode{ episode airingAt } } }
        sorties: Page(page:$page, perPage:50){ pageInfo{ hasNextPage }
          airingSchedules(mediaId_in:$ids, airingAt_greater:$a, airingAt_lesser:$b, sort:TIME_DESC){ mediaId episode airingAt } }
      }`, { ids: lot, a, b, page }, { duree: 15 * MINUTE });

      if (page === 1) medias.push(...data.suivis.media);
      sorties.push(...data.sorties.airingSchedules.filter((s) => s.airingAt <= maintenant));
      if (!data.sorties.pageInfo.hasNextPage) break;
    }
  }
  return { medias, sorties };
}
