// =========================================================
// Anti-pause Supabase : l'offre gratuite met le projet en pause après 7 jours sans activité
// (il faut alors le relancer à la main, et le site perd ses comptes en attendant).
//
// Une fois par jour, la tâche horaire fait donc une lecture minimale :
//  - avec la clé PUBLIQUE (celle du site), jamais la clé service ;
//  - sur une table protégée par RLS : sans connexion, la base répond une liste vide,
//    mais c'est une vraie requête SQL (donc de l'activité) ;
//  - aucune écriture.
// =========================================================

const HEURE_UTC = 4; // un seul passage par jour : celui de 4 h 05 UTC

export function eveilDuJour(heureCron) {
  return new Date(heureCron).getUTCHours() === HEURE_UTC;
}

export async function reveillerSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_CLE_PUBLIQUE) return { ok: false, raison: 'SUPABASE_URL ou SUPABASE_CLE_PUBLIQUE absente (wrangler.toml)' };
  try {
    const reponse = await fetch(`${env.SUPABASE_URL}/rest/v1/recommandations?select=id&limit=1`, {
      headers: { apikey: env.SUPABASE_CLE_PUBLIQUE, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: reponse.ok, statut: reponse.status };
  } catch (erreur) {
    return { ok: false, raison: erreur.message };
  }
}
