// =========================================================
// Compte Radar (Supabase) : connexion par code reçu par email, profil, groupe de potes.
//
// Connexion SANS mot de passe : on tape son email, on reçoit un code à 6 chiffres,
// on le recopie. (Un code plutôt qu'un lien : sur iPhone, un lien s'ouvrirait dans
// Safari et pas dans l'appli Radar installée, qui a ses propres données.)
//
// Le compte est relié au "code perso" de la V2 : se connecter sur un nouvel appareil
// récupère automatiquement sa liste et ses notifications.
// =========================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_CLE_PUBLIQUE } from '../config.js';
import * as maListe from './ma-liste.js';

export const comptesActifs = () => !SUPABASE_URL.includes('A-REMPLACER');

let client;
export function supabase() {
  client ??= createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

// Supabase renvoie { data, error } : on transforme l'erreur en exception, avec un message en français
function verifier({ data, error }) {
  if (error) throw new Error(traduireErreur(error.message));
  return data;
}

function traduireErreur(message) {
  if (/rate limit|too many/i.test(message)) return "Trop de demandes : attends quelques minutes avant de redemander un code.";
  if (/expired|invalid.*otp|token has expired|invalid/i.test(message)) return 'Code incorrect ou expiré. Redemande un code.';
  if (/Invitation inconnue/.test(message)) return "Ce code d'invitation n'existe pas.";
  if (/duplicate key.*pseudo|profils_pseudo/i.test(message)) return 'Ce pseudo est déjà pris.';
  return message;
}

// ---------- Connexion ----------
export async function utilisateur() {
  if (!comptesActifs()) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.user ?? null;
}

export async function envoyerCode(email) {
  verifier(await supabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } }));
}

export async function validerCode(email, code) {
  const data = verifier(await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' }));
  await rattacherListe(data.user.id);
  return data.user;
}

export async function deconnexion() {
  await supabase().auth.signOut();
}

/**
 * Relie le compte au code perso :
 *  - le compte a déjà un code (créé sur un autre appareil) : cet appareil l'adopte
 *    et récupère la liste (fusionnée avec ce qu'il y avait ici) ;
 *  - sinon : on enregistre le code de cet appareil dans le compte.
 */
async function rattacherListe(userId) {
  const ligne = verifier(await supabase().from('codes').select('code').eq('id', userId).maybeSingle());
  if (ligne?.code && ligne.code !== maListe.codePerso()) {
    await maListe.utiliserCode(ligne.code);
  } else if (!ligne) {
    verifier(await supabase().from('codes').insert({ id: userId, code: maListe.codePerso() }));
  }
  await publierListe();
}

// ---------- Profil ----------
export async function monProfil() {
  const u = await utilisateur();
  if (!u) return null;
  return verifier(await supabase().from('profils').select('*').eq('id', u.id).maybeSingle());
}

export async function enregistrerProfil({ pseudo, avatar }) {
  const u = await utilisateur();
  verifier(await supabase().from('profils').upsert({ id: u.id, pseudo: pseudo.trim(), avatar }));
}

// ---------- Ma liste, visible par mes potes ----------
// Copie de la liste dans Supabase à chaque envoi au relais (si je suis connecté)
export async function publierListe() {
  const u = await utilisateur();
  if (!u) return;
  verifier(await supabase().from('listes').upsert({ user_id: u.id, items: maListe.items(), maj: Date.now() }));
}
maListe.surEnvoi(() => publierListe().catch(() => { /* hors connexion : la prochaine fois */ }));

// ---------- Groupe de potes ----------
export async function mesGroupes() {
  const u = await utilisateur();
  if (!u) return [];
  return verifier(await supabase().from('groupes').select('id, nom, invitation, cree_par, membres(user_id)').order('cree_le'));
}

export async function creerGroupe(nom) {
  return verifier(await supabase().rpc('creer_groupe', { nom_groupe: nom }));
}

export async function rejoindreGroupe(invitation) {
  return verifier(await supabase().rpc('rejoindre_groupe', { code_invitation: invitation }));
}

export async function quitterGroupe(groupeId) {
  const u = await utilisateur();
  verifier(await supabase().from('membres').delete().eq('groupe_id', groupeId).eq('user_id', u.id));
}

/** Mes potes (membres de mes groupes, sans moi), avec leur profil et leur liste. */
export async function mesPotes() {
  const u = await utilisateur();
  if (!u) return [];
  const [profils, listes] = await Promise.all([
    supabase().from('profils').select('id, pseudo, avatar').neq('id', u.id).then(verifier),
    supabase().from('listes').select('user_id, items, maj').neq('user_id', u.id).then(verifier),
  ]);
  const listeDe = new Map(listes.map((l) => [l.user_id, l.items]));
  // RLS ne renvoie que les profils des membres de mes groupes : ce sont mes potes
  return profils.map((p) => ({ ...p, items: listeDe.get(p.id) || [] }));
}

/** Les potes qui suivent cet élément (pour afficher "3 potes suivent" sur une fiche). */
export async function potesQuiSuivent(type, id) {
  if (!(await utilisateur())) return [];
  return (await mesPotes()).filter((p) => p.items.some((i) => i.type === type && i.id === id));
}

// ---------- Recommandations ----------
export async function recommandationsRecues() {
  const u = await utilisateur();
  if (!u) return [];
  return verifier(await supabase().from('recommandations')
    .select('id, de, item, message, vue, cree_le').eq('a', u.id).order('cree_le', { ascending: false }).limit(20));
}

export async function marquerVues(ids) {
  if (ids.length) verifier(await supabase().from('recommandations').update({ vue: true }).in('id', ids));
}

/** Jeton de connexion, pour prouver au relais qui je suis (envoi d'une recommandation). */
export async function jeton() {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token;
}
