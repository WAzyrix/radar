// =========================================================
// Client de l'API GraphQL AniList : cache + respect de la limite de requêtes.
// Tous les appels à AniList passent par la fonction `anilist()` ci-dessous.
// =========================================================

const URL_API = 'https://graphql.anilist.co';

// AniList autorise 90 requêtes/minute normalement, mais seulement 30 en "mode dégradé"
// (c'est le cas en ce moment). On se limite à 25 pour garder une marge.
const LIMITE_PAR_MINUTE = 25;
const PREFIXE_CACHE = 'al:';

const historique = [];          // heures des dernières requêtes (pour le limiteur)
const enCours = new Map();      // requêtes identiques en cours -> on partage la même promesse

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Attend qu'un "créneau" se libère si on a déjà fait trop de requêtes dans la dernière minute.
async function attendreCreneau() {
  for (;;) {
    const maintenant = Date.now();
    while (historique.length && maintenant - historique[0] > 60_000) historique.shift();
    if (historique.length < LIMITE_PAR_MINUTE) { historique.push(maintenant); return; }
    await pause(60_000 - (maintenant - historique[0]) + 50);
  }
}

// Petite fonction de hachage (djb2) pour avoir des clés de cache courtes.
function hacher(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------- Cache dans localStorage ----------
function lireCache(cle) {
  try {
    const entree = JSON.parse(localStorage.getItem(cle));
    if (entree && Date.now() < entree.expire) return entree.data;
  } catch { /* entrée illisible : on ignore */ }
  return undefined;
}

function ecrireCache(cle, data, duree) {
  const valeur = JSON.stringify({ expire: Date.now() + duree, data });
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // Stockage plein : on vide notre cache AniList et on réessaie une fois
    viderCache();
    try { localStorage.setItem(cle, valeur); } catch { /* tant pis */ }
  }
}

export function viderCache({ seulementExpires = false } = {}) {
  for (const cle of Object.keys(localStorage)) {
    if (!cle.startsWith(PREFIXE_CACHE)) continue;
    if (seulementExpires && lireCache(cle) !== undefined) continue;
    localStorage.removeItem(cle);
  }
}
viderCache({ seulementExpires: true }); // ménage au chargement

/**
 * Envoie une requête GraphQL à AniList.
 * @param {string} query    la requête GraphQL
 * @param {object} variables  ses variables (mettre `undefined`, jamais `null`, pour un filtre vide)
 * @param {object} options  { duree: durée du cache en ms (0 = pas de cache) }
 */
export async function anilist(query, variables = {}, { duree = 10 * 60_000 } = {}) {
  const corps = JSON.stringify({ query, variables });
  const cle = PREFIXE_CACHE + hacher(corps);

  if (duree > 0) {
    const enCache = lireCache(cle);
    if (enCache !== undefined) return enCache;
    if (enCours.has(cle)) return enCours.get(cle);
  }

  const promesse = envoyer(corps).then((data) => {
    if (duree > 0) ecrireCache(cle, data, duree);
    return data;
  }).finally(() => enCours.delete(cle));

  if (duree > 0) enCours.set(cle, promesse);
  return promesse;
}

async function envoyer(corps, essai = 1) {
  await attendreCreneau();
  let reponse;
  try {
    reponse = await fetch(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corps,
    });
  } catch {
    throw new Error('Impossible de joindre AniList. Vérifie ta connexion.');
  }

  // Trop de requêtes : AniList dit combien de secondes attendre (Retry-After)
  if (reponse.status === 429 && essai < 3) {
    const attente = Number(reponse.headers.get('Retry-After')) || 30;
    await pause(attente * 1000);
    return envoyer(corps, essai + 1);
  }

  const json = await reponse.json().catch(() => ({}));
  if (!reponse.ok || json.errors) {
    const message = json.errors?.[0]?.message || `Erreur AniList (${reponse.status})`;
    throw new Error(message);
  }
  return json.data;
}
