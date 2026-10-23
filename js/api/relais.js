// =========================================================
// Appels au relais Cloudflare (jeux, films, séries), avec cache dans le navigateur.
// =========================================================
import { URL_RELAIS } from '../config.js';
import { hacher, lireCache, ecrireCache, viderCache } from '../lib/cache.js';
import { appeler, messageStatut } from '../lib/outils.js';

// "jv2:" depuis le retrait de la clé RAWG des réponses : l'ancien cache "jv:" la contenait
const PREFIXE_CACHE = 'jv2:';
const HEURE = 3600_000;
viderCache('jv:');
viderCache(PREFIXE_CACHE, { seulementExpires: true });

export const relaisConfigure = () => !URL_RELAIS.includes('A-REMPLACER');

export async function relais(chemin, params = {}, { duree = HEURE } = {}) {
  if (!relaisConfigure()) throw new Error("Le relais n'est pas encore configuré (js/config.js).");
  const url = new URL(URL_RELAIS + chemin);
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur !== undefined && valeur !== '') url.searchParams.set(cle, valeur);
  }
  const cle = PREFIXE_CACHE + hacher(url.toString());
  if (duree > 0) {
    const enCache = lireCache(cle);
    if (enCache !== undefined) return enCache;
  }

  // Le relais interroge lui-même RAWG/Steam (jusqu'à 10 s chacun) : on lui laisse 20 s
  const reponse = await appeler(url, {}, { service: 'le relais', delai: 20_000 });
  const json = await reponse.json().catch(() => null);
  // Le relais renvoie ses erreurs en français dans "erreur"
  if (!reponse.ok) throw new Error(json?.erreur || messageStatut('le relais', reponse.status));
  if (!json || typeof json !== 'object') throw new Error('Réponse inattendue du relais. Réessaie dans un instant.');
  if (duree > 0) ecrireCache(cle, json, duree, PREFIXE_CACHE);
  return json;
}

