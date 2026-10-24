// =========================================================
// Déclenche la collecte des actus (workflow GitHub Actions) depuis la tâche horaire.
//
// Pourquoi ? Le "schedule" de GitHub Actions est peu fiable : les runs planifiés
// sont souvent retardés, voire sautés. Le cron de Cloudflare, lui, est ponctuel :
// il demande à GitHub de lancer le workflow ("workflow_dispatch").
//
// On lui passe aussi les œuvres suivies (identifiants AniList, aucun code perso) : AniList et
// MangaUpdates bloquent Cloudflare, c'est donc la collecte qui les interroge pour le relais
// (scripts/collecte_suivis.py -> data/suivis.json, lu au passage suivant par verification.js).
//
// Secret : GITHUB_TOKEN, un jeton "fine-grained" limité au dépôt, avec la seule
// permission "Actions : lecture et écriture" (wrangler secret put GITHUB_TOKEN).
// =========================================================

const TAILLE_MAX_ENTREE = 60_000; // GitHub refuse plus de 65 535 caractères d'entrées au total

// Identifiants séparés par des virgules ("21,16498"), sans dépasser la moitié de la taille permise
function enTexte(ids) {
  let texte = '';
  for (const id of ids) {
    const suivant = texte ? `${texte},${id}` : String(id);
    if (suivant.length > TAILLE_MAX_ENTREE / 2) break;
    texte = suivant;
  }
  return texte;
}

/** suivis : { animes: [id…], mangas: [id…] } (oeuvresSuivies, verification.js), ou null. */
export async function lancerCollecte(env, suivis) {
  if (!env.GITHUB_TOKEN) return { lance: false, raison: 'Jeton absent (wrangler secret put GITHUB_TOKEN)' };
  const depot = env.GITHUB_DEPOT || 'wazyrix/radar';
  const workflow = env.GITHUB_WORKFLOW || 'actus.yml';
  const inputs = suivis && { animes: enTexte(suivis.animes), mangas: enTexte(suivis.mangas) };
  try {
    const reponse = await fetch(`https://api.github.com/repos/${depot}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'radar-relais', // obligatoire pour l'API GitHub
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', ...(inputs && { inputs }) }),
      signal: AbortSignal.timeout(10_000),
    });
    // 204 = accepté (sans contenu). 401 : jeton invalide ou expiré ; 403/404 : permission manquante.
    // 422 avec des entrées : le workflow en ligne ne les connaît pas encore (actus.yml pas encore
    // poussé) : on relance sans elles, la collecte reprendra les œuvres de son fichier précédent.
    if (reponse.status === 204) return { lance: true, ...(inputs && { suivis: { animes: suivis.animes.length, mangas: suivis.mangas.length } }) };
    if (reponse.status === 422 && inputs) return { ...(await lancerCollecte(env, null)), raisonSansSuivis: (await reponse.text()).slice(0, 200) };
    return { lance: false, raison: `GitHub a répondu ${reponse.status} : ${(await reponse.text()).slice(0, 200)}` };
  } catch (erreur) {
    return { lance: false, raison: erreur.message };
  }
}
