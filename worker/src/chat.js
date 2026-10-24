// =========================================================
// Chat de groupe : prévenir les autres membres d'un nouveau message
// (cloche + notification push), sans spammer.
//
// Le message lui-même est envoyé directement du site à Supabase ; le site appelle
// ensuite cette route. Le relais relit le dernier message de l'expéditeur dans
// Supabase (on ne fait pas confiance au texte envoyé par le navigateur).
// =========================================================
import { notifier, Erreur400 } from './comptes.js';
import { supabase, utilisateurConnecte } from './recommandations.js';
import { stockage } from './stockage.js';

// Au plus une notification par personne, par groupe, toutes les 10 minutes
const PAUSE_NOTIF = 10 * 60_000;

export async function notifierChat(env, requete, { groupe_id: groupeId } = {}) {
  const moi = await utilisateurConnecte(env, requete);
  if (!/^[0-9a-f-]{36}$/.test(groupeId || '')) throw new Erreur400('Groupe invalide');

  const [membres, [groupe], [message], [profil]] = await Promise.all([
    supabase(env, `membres?groupe_id=eq.${groupeId}&select=user_id`),
    supabase(env, `groupes?id=eq.${groupeId}&select=nom`),
    supabase(env, `messages?groupe_id=eq.${groupeId}&user_id=eq.${moi.id}&order=cree_le.desc&limit=1&select=contenu,item`),
    supabase(env, `profils?id=eq.${moi.id}&select=pseudo,avatar`),
  ]);
  if (!membres.some((m) => m.user_id === moi.id)) throw new Erreur400("Tu n'es pas dans ce groupe");
  if (!message) return { ok: true, prevenus: 0 };

  const apercu = message.item ? `a partagé ${message.item.titre}${message.contenu ? ` : ${message.contenu}` : ''}` : message.contenu;
  const autres = membres.map((m) => m.user_id).filter((id) => id !== moi.id);
  const codes = autres.length ? await supabase(env, `codes?id=in.(${autres.join(',')})&select=id,code`) : [];

  let prevenus = 0;
  for (const { id, code } of codes) {
    const cle = `chat:${groupeId}:${id}`;
    const dernier = Number(await stockage(env).get(cle)) || 0;
    if (Date.now() - dernier < PAUSE_NOTIF) continue;
    await stockage(env).put(cle, String(Date.now()), { expirationTtl: 3600 });
    await notifier(env, code, [{
      titre: `💬 ${profil?.pseudo || 'Un pote'} dans ${groupe?.nom || 'ton groupe'}`,
      corps: String(apercu).slice(0, 160),
      url: `${env.SITE}chat.html?groupe=${groupeId}`,
      image: message.item?.image || undefined,
    }]);
    prevenus += 1;
  }
  return { ok: true, prevenus };
}
