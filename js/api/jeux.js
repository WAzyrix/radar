// =========================================================
// Jeux vidéo : appels au relais Cloudflare (qui interroge RAWG et Steam).
// Même principe que pour AniList : cache dans le navigateur pour limiter les appels
// (RAWG gratuit = 20 000 requêtes par mois).
// =========================================================
import { URL_RELAIS } from '../config.js';
import { hacher, lireCache, ecrireCache, viderCache } from '../lib/cache.js';

const PREFIXE_CACHE = 'jv:';
const HEURE = 3600_000;
viderCache(PREFIXE_CACHE, { seulementExpires: true });

export const relaisConfigure = () => !URL_RELAIS.includes('A-REMPLACER');

async function relais(chemin, params = {}, { duree = HEURE } = {}) {
  if (!relaisConfigure()) throw new Error("Le relais jeux n'est pas encore configuré (js/config.js).");
  const url = new URL(URL_RELAIS + chemin);
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur !== undefined && valeur !== '') url.searchParams.set(cle, valeur);
  }
  const cle = PREFIXE_CACHE + hacher(url.toString());
  if (duree > 0) {
    const enCache = lireCache(cle);
    if (enCache !== undefined) return enCache;
  }

  let reponse;
  try {
    reponse = await fetch(url);
  } catch {
    throw new Error('Impossible de joindre le relais jeux. Vérifie ta connexion.');
  }
  const json = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(json.erreur || `Erreur du relais (${reponse.status})`);
  if (duree > 0) ecrireCache(cle, json, duree, PREFIXE_CACHE);
  return json;
}

// ---------- Dates ----------
const jourIso = (date) => date.toISOString().slice(0, 10);
function decaler(jours) {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return jourIso(d);
}

// ---------- Filtres de l'explorateur -> paramètres RAWG ----------
function parametres(f = {}) {
  return {
    search: f.texte?.trim() || undefined,
    genres: f.genres?.length ? f.genres.join(',') : undefined,
    parent_platforms: f.plateforme || undefined,
    metacritic: f.noteMin ? `${f.noteMin},100` : undefined,
    dates: f.annee ? `${f.annee}-01-01,${f.annee}-12-31` : undefined,
    // Avec une recherche texte, RAWG trie par pertinence si on ne précise pas d'ordre
    ordering: f.texte?.trim() ? undefined : (f.tri || '-added'),
    exclude_additions: 'true', // pas les DLC dans les résultats
  };
}

// ---------- Listes ----------

/** Jeux qui sortent dans les `jours` prochains jours, triés par date. */
export async function sortiesAVenir(jours = 180) {
  const data = await relais('/jeux', { dates: `${decaler(1)},${decaler(jours)}`, ordering: '-added', page_size: 40, exclude_additions: 'true' }, { duree: 6 * HEURE });
  return data.results.sort((a, b) => (a.released || '').localeCompare(b.released || ''));
}

/** Jeux sortis ces `jours` derniers jours, les plus suivis d'abord. */
export async function sortiesRecentes(jours = 45) {
  const data = await relais('/jeux', { dates: `${decaler(-jours)},${decaler(0)}`, ordering: '-added', page_size: 40, exclude_additions: 'true' }, { duree: 6 * HEURE });
  return data.results;
}

export async function explorerJeux(filtres, page = 1) {
  const data = await relais('/jeux', { ...parametres(filtres), page, page_size: 24 }, { duree: 6 * HEURE });
  return { total: data.count, suite: Boolean(data.next), jeux: data.results };
}

export async function rechercheRapideJeux(texte) {
  const data = await relais('/jeux', { search: texte, page_size: 4, exclude_additions: 'true' }, { duree: 6 * HEURE });
  return data.results;
}

export async function ficheJeu(id) {
  return relais(`/jeu/${id}`, {}, { duree: 12 * HEURE });
}

export async function jeuAuHasard(filtres = {}) {
  const { texte, ...sansTexte } = filtres;
  const data = await relais('/hasard', parametres(sansTexte), { duree: 0 });
  return data.jeu;
}
