// =========================================================
// Cache dans localStorage, partagé par les clients d'API (AniList, relais jeux…).
// Chaque entrée a une date d'expiration ; un préfixe sépare les caches entre eux.
// Une entrée expirée est gardée quelques jours : si l'API est saturée ou en panne,
// mieux vaut afficher des données un peu anciennes qu'une erreur.
// =========================================================

const GARDE = 3 * 86400_000; // durée pendant laquelle on garde une entrée expirée

// Petite fonction de hachage (djb2) pour avoir des clés de cache courtes.
export function hacher(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// `perime: true` : renvoie aussi une entrée expirée (données de secours)
export function lireCache(cle, { perime = false } = {}) {
  try {
    const entree = JSON.parse(localStorage.getItem(cle));
    if (entree && Date.now() < entree.expire + (perime ? GARDE : 0)) return entree.data;
  } catch { /* entrée illisible : on ignore */ }
  return undefined;
}

export function ecrireCache(cle, data, duree, prefixe) {
  const valeur = JSON.stringify({ expire: Date.now() + duree, data });
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // Stockage plein : on vide ce cache et on réessaie une fois
    viderCache(prefixe);
    try { localStorage.setItem(cle, valeur); } catch { /* tant pis */ }
  }
}

// `seulementExpires` : seulement les entrées expirées depuis plus longtemps que GARDE
export function viderCache(prefixe, { seulementExpires = false } = {}) {
  for (const cle of Object.keys(localStorage)) {
    if (!cle.startsWith(prefixe)) continue;
    if (seulementExpires && lireCache(cle, { perime: true }) !== undefined) continue;
    localStorage.removeItem(cle);
  }
}
