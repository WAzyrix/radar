// =========================================================
// Compte Radar (Supabase) : connexion email + mot de passe, profil, groupe de potes.
//
// À l'inscription, Supabase envoie un email de confirmation (une seule fois).
// Le mot de passe permet ensuite de se connecter partout, y compris dans
// l'appli iPhone installée (qui ne partage pas ses données avec Safari).
//
// Le compte est relié au "code perso" de la V2 : se connecter sur un nouvel appareil
// récupère automatiquement sa liste et ses notifications.
// =========================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, URL_RELAIS } from '../config.js';
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
  if (/rate limit|too many/i.test(message)) return 'Trop de demandes : attends quelques minutes et réessaie.';
  if (/invalid login credentials/i.test(message)) return 'Email ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) return "Confirme d'abord ton email : clique sur le lien reçu par mail (pense aux spams).";
  if (/already registered|already been registered/i.test(message)) return 'Un compte existe déjà avec cet email : connecte-toi.';
  if (/password should be|at least \d+ characters|weak password/i.test(message)) return 'Mot de passe trop faible : 8 caractères minimum, avec lettres et chiffres.';
  if (/valid email|invalid email|email address .* is invalid/i.test(message)) return 'Adresse email invalide.';
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

// Page vers laquelle renvoient les liens des emails (confirmation, mot de passe oublié)
const pagePotes = () => new URL('potes.html', location.href).href;

/** Crée un compte. Renvoie true si connecté tout de suite, false s'il faut confirmer l'email. */
export async function inscription(email, motDePasse) {
  if (motDePasse.length < 8) throw new Error('Mot de passe trop faible : 8 caractères minimum.');
  const data = verifier(await supabase().auth.signUp({ email: email.trim(), password: motDePasse, options: { emailRedirectTo: pagePotes() } }));
  if (data.session) await rattacherListe(data.user.id);
  return Boolean(data.session);
}

export async function connexion(email, motDePasse) {
  const data = verifier(await supabase().auth.signInWithPassword({ email: email.trim(), password: motDePasse }));
  await rattacherListe(data.user.id);
  return data.user;
}

export async function motDePasseOublie(email) {
  verifier(await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${pagePotes()}?reinitialiser=1` }));
}

export async function changerMotDePasse(motDePasse) {
  if (motDePasse.length < 8) throw new Error('Mot de passe trop faible : 8 caractères minimum.');
  verifier(await supabase().auth.updateUser({ password: motDePasse }));
}

/** Après un clic sur un lien d'email, la session arrive par l'adresse : on s'assure que la liste est reliée. */
export async function verifierRattachement() {
  const u = await utilisateur();
  if (u && sessionStorage.getItem('radar:rattache') !== u.id) {
    await rattacherListe(u.id);
    sessionStorage.setItem('radar:rattache', u.id);
  }
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

// ---------- Préférences d'affichage (visibles par moi seul : voir supabase/preferences.sql) ----------
/** Mes préférences enregistrées : objet, null si aucune, undefined si je ne suis pas connecté. */
export async function mesPreferences() {
  const u = await utilisateur();
  if (!u) return undefined;
  const ligne = verifier(await supabase().from('preferences').select('rattrapage_masque, maj').eq('user_id', u.id).maybeSingle());
  return ligne && { rattrapageMasque: ligne.rattrapage_masque, maj: Number(ligne.maj) };
}

export async function enregistrerPreferences({ rattrapageMasque, maj }) {
  const u = await utilisateur();
  if (!u) return;
  verifier(await supabase().from('preferences').upsert({ user_id: u.id, rattrapage_masque: rattrapageMasque, maj }));
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
  // Les listes viennent de la base : on écarte les éléments mal formés
  const listeDe = new Map(listes.map((l) => [l.user_id, Array.isArray(l.items) ? l.items.filter(maListe.itemValide) : []]));
  // RLS ne renvoie que les profils des membres de mes groupes : ce sont mes potes
  return profils.map((p) => ({ ...p, items: listeDe.get(p.id) || [] }));
}

/** Les potes qui suivent cet élément (pour afficher "3 potes suivent" sur une fiche). */
export async function potesQuiSuivent(type, id) {
  if (!(await utilisateur())) return [];
  return (await mesPotes()).filter((p) => p.items.some((i) => i.type === type && Number(i.id) === Number(id)));
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

// ---------- Chat de groupe ----------
export async function messages(groupeId, nombre = 100) {
  const lignes = verifier(await supabase().from('messages')
    .select('id, user_id, contenu, item, cree_le').eq('groupe_id', groupeId)
    .order('cree_le', { ascending: false }).limit(nombre));
  return lignes.reverse(); // du plus ancien au plus récent
}

export async function envoyerMessage(groupeId, { contenu, item }) {
  const u = await utilisateur();
  const message = verifier(await supabase().from('messages')
    .insert({ groupe_id: groupeId, user_id: u.id, contenu: contenu || null, item: item || null })
    .select('id, user_id, contenu, item, cree_le').single());
  // On prévient les autres membres (cloche + notif), sans attendre la réponse
  jeton().then((j) => fetch(`${URL_RELAIS}/chat/notifier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j}` },
    body: JSON.stringify({ groupe_id: groupeId }),
  })).catch(() => {});
  return message;
}

export async function supprimerMessage(id) {
  verifier(await supabase().from('messages').delete().eq('id', id));
}

/**
 * Écoute les nouveaux messages (et suppressions) du groupe en temps réel.
 * Supabase Realtime respecte les règles RLS : on ne reçoit que les messages de ses groupes.
 * Renvoie une fonction pour arrêter d'écouter.
 */
export function ecouterMessages(groupeId, { ajout, suppression }) {
  const canal = supabase().channel(`chat:${groupeId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `groupe_id=eq.${groupeId}` }, (e) => ajout(e.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (e) => suppression(e.old.id))
    .subscribe();
  return () => supabase().removeChannel(canal);
}
