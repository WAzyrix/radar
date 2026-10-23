// =========================================================
// "Recommander à un pote" : enregistrement dans Supabase + notification immédiate.
//
// Passe par le relais (et pas directement du site vers Supabase) car il faut
// le code perso du destinataire pour lui envoyer la notification, et ce code
// est secret : seul le relais, avec la clé "service" de Supabase, peut le lire.
// =========================================================
import { notifier, Erreur400 } from './comptes.js';

// Requête à l'API REST de Supabase avec la clé "service" (droits complets : à garder secrète)
async function supabase(env, chemin, options = {}) {
  if (!env.SUPABASE_SERVICE) throw new Error('Clé Supabase absente (wrangler secret put SUPABASE_SERVICE)');
  const reponse = await fetch(`${env.SUPABASE_URL}/rest/v1/${chemin}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE,
      // Anciennes clés (jetons JWT "eyJ…") : aussi dans Authorization ; nouvelles clés "sb_secret_…" : apikey suffit
      ...(env.SUPABASE_SERVICE.startsWith('eyJ') ? { Authorization: `Bearer ${env.SUPABASE_SERVICE}` } : {}),
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!reponse.ok) throw new Error(`Supabase a répondu ${reponse.status}`);
  return reponse.status === 204 ? null : reponse.json();
}

// Qui est connecté ? On demande à Supabase de vérifier le jeton envoyé par le site.
async function utilisateurConnecte(env, requete) {
  const jeton = requete.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jeton) throw new Erreur400('Connexion requise');
  const reponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE, Authorization: `Bearer ${jeton}` },
  });
  if (!reponse.ok) throw new Erreur400('Session expirée : reconnecte-toi');
  return reponse.json();
}

const UUID = /^[0-9a-f-]{36}$/;

export async function recommander(env, requete, corps) {
  const moi = await utilisateurConnecte(env, requete);
  const { a, item, message } = corps || {};
  if (!UUID.test(a || '') || !item?.type || item.id === undefined || !item.titre) throw new Erreur400('Recommandation invalide');

  // Le destinataire doit être dans un de mes groupes
  const [mesGroupes, sesGroupes] = await Promise.all([
    supabase(env, `membres?user_id=eq.${moi.id}&select=groupe_id`),
    supabase(env, `membres?user_id=eq.${a}&select=groupe_id`),
  ]);
  const communs = new Set(mesGroupes.map((m) => m.groupe_id));
  if (!sesGroupes.some((m) => communs.has(m.groupe_id))) throw new Erreur400("Cette personne n'est pas dans tes groupes");

  const element = {
    type: String(item.type).slice(0, 10),
    id: item.id,
    titre: String(item.titre).slice(0, 200),
    image: String(item.image || '').slice(0, 500),
  };
  const texte = message ? String(message).slice(0, 280) : null;
  await supabase(env, 'recommandations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ de: moi.id, a, item: element, message: texte }),
  });

  // Notification au destinataire (s'il les a activées)
  const [[profil], [code]] = await Promise.all([
    supabase(env, `profils?id=eq.${moi.id}&select=pseudo,avatar`),
    supabase(env, `codes?id=eq.${a}&select=code`),
  ]);
  if (code?.code) {
    await notifier(env, code.code, [{
      titre: `${profil?.avatar || '🎁'} ${profil?.pseudo || 'Un pote'} te recommande ${element.titre}`,
      corps: texte || 'Ouvre Radar pour voir sa recommandation.',
      url: `${env.SITE}potes.html#recommandations`,
      image: element.image || undefined,
    }]);
  }
  return { ok: true };
}
