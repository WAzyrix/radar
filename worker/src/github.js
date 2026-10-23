// =========================================================
// Déclenche la collecte des actus (workflow GitHub Actions) depuis la tâche horaire.
//
// Pourquoi ? Le "schedule" de GitHub Actions est peu fiable : les runs planifiés
// sont souvent retardés, voire sautés. Le cron de Cloudflare, lui, est ponctuel :
// il demande à GitHub de lancer le workflow ("workflow_dispatch").
//
// Secret : GITHUB_TOKEN, un jeton "fine-grained" limité au dépôt, avec la seule
// permission "Actions : lecture et écriture" (wrangler secret put GITHUB_TOKEN).
// =========================================================

export async function lancerCollecte(env) {
  if (!env.GITHUB_TOKEN) return { lance: false, raison: 'Jeton absent (wrangler secret put GITHUB_TOKEN)' };
  const depot = env.GITHUB_DEPOT || 'wazyrix/radar';
  const workflow = env.GITHUB_WORKFLOW || 'actus.yml';
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
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(10_000),
    });
    // 204 = accepté (sans contenu). 401 : jeton invalide ou expiré ; 403/404 : permission manquante.
    if (reponse.status === 204) return { lance: true };
    return { lance: false, raison: `GitHub a répondu ${reponse.status} : ${(await reponse.text()).slice(0, 200)}` };
  } catch (erreur) {
    return { lance: false, raison: erreur.message };
  }
}
