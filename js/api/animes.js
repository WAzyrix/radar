// =========================================================
// Toutes les requêtes "métier" sur les animés.
// Les pages appellent ces fonctions, jamais directement l'API :
// si AniList change, il n'y a que ce fichier à modifier.
// =========================================================
import { anilist } from './anilist.js';

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

// Champs nécessaires pour afficher une affiche (fragment réutilisé partout)
const CHAMPS_CARTE = 'id title{romaji english} coverImage{extraLarge large color} averageScore format seasonYear episodes genres status';

// ---------- Accueil ----------

export function saisonActuelle(date = new Date()) {
  const saisons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  return { saison: saisons[Math.floor(date.getMonth() / 3)], annee: date.getFullYear() };
}

// Tendances + meilleurs de la saison, en UNE requête grâce aux alias GraphQL
export async function tendancesEtSaison() {
  const { saison, annee } = saisonActuelle();
  const data = await anilist(`query($saison:MediaSeason, $annee:Int){
    tendances: Page(perPage:20){ media(type:ANIME, sort:TRENDING_DESC, isAdult:false){ ${CHAMPS_CARTE} bannerImage description } }
    saison: Page(perPage:20){ media(type:ANIME, season:$saison, seasonYear:$annee, sort:SCORE_DESC, isAdult:false, popularity_greater:3000){ ${CHAMPS_CARTE} } }
  }`, { saison, annee }, { duree: 30 * MINUTE });
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

  const episodes = [];
  // Un jour chargé peut dépasser 50 épisodes : on lit plusieurs pages (4 maximum)
  for (let page = 1; page <= 4; page++) {
    const data = await anilist(`query($page:Int, $a:Int, $b:Int){ Page(page:$page, perPage:50){
      pageInfo{ hasNextPage }
      airingSchedules(airingAt_greater:$a, airingAt_lesser:$b, sort:TIME){
        episode airingAt media{ id isAdult popularity episodes title{romaji english native} synonyms coverImage{large color} } } } }`,
    { page, a: Math.floor(debut / 1000) - 1, b: Math.floor(fin / 1000) }, { duree: 15 * MINUTE });

    episodes.push(...data.Page.airingSchedules);
    if (!data.Page.pageInfo.hasNextPage) break;
  }
  return episodes.filter((e) => !e.media.isAdult);
}

// ---------- Fiche ----------

export async function ficheAnime(id) {
  const data = await anilist(`query($id:Int){ Media(id:$id){
    id type format status episodes chapters volumes duration season seasonYear averageScore popularity genres siteUrl
    description bannerImage coverImage{extraLarge color}
    title{romaji english native} synonyms
    externalLinks{ site url type }
    startDate{year month day}
    studios(isMain:true){ nodes{ name } }
    nextAiringEpisode{ episode airingAt }
    trailer{ id site }
    relations{ edges{ relationType node{ id type format title{romaji english} coverImage{extraLarge large color} averageScore } } }
    recommendations(perPage:15, sort:RATING_DESC){ nodes{ mediaRecommendation{ ${CHAMPS_CARTE} } } }
    reviews(perPage:8, sort:RATING_DESC){ nodes{ id summary score rating ratingAmount siteUrl user{ name avatar{ medium } } } }
  } }`, { id }, { duree: HEURE });
  return data.Media;
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
  { page, parPage, ...variablesFiltres(filtres) }, { duree: 30 * MINUTE });
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
  const a = Math.floor(depuis / 1000);
  const b = Math.floor(Date.now() / 1000);
  const sorties = [];
  let medias = [];

  for (let page = 1; page <= 5; page++) {
    const data = await anilist(`query($ids:[Int], $a:Int, $b:Int, $page:Int){
      suivis: Page(perPage:50){ media(id_in:$ids){ ${CHAMPS_CARTE} nextAiringEpisode{ episode airingAt } } }
      sorties: Page(page:$page, perPage:50){ pageInfo{ hasNextPage }
        airingSchedules(mediaId_in:$ids, airingAt_greater:$a, airingAt_lesser:$b, sort:TIME_DESC){ mediaId episode airingAt } }
    }`, { ids, a, b, page }, { duree: 15 * MINUTE });

    if (page === 1) medias = data.suivis.media;
    sorties.push(...data.sorties.airingSchedules);
    if (!data.sorties.pageInfo.hasNextPage) break;
  }
  return { medias, sorties };
}
