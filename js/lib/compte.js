// =========================================================
// Compte Radar (Supabase) : connexion email + mot de passe, profil, groupes de potes, amis.
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
import * as notifications from './notifications.js';

export const comptesActifs = () => !SUPABASE_URL.includes('A-REMPLACER');

let client;
export function supabase() {
  client ??= createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE, {
    auth: { persistSession: true, autoRefreshToken: true },
    // Délai maximum de 15 s par appel : une base lente ne laisse plus la page charger sans fin
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(15_000)].filter(Boolean)) }) },
  });
  return client;
}

// Supabase renvoie { data, error } : on transforme l'erreur en exception, avec un message en français
function verifier({ data, error }) {
  if (error) throw new Error(traduireErreur(error.message));
  return data;
}

function traduireErreur(message) {
  if (/timed? ?out|aborted/i.test(message)) return 'Les comptes (Supabase) mettent trop de temps à répondre. Réessaie dans un instant.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'Impossible de joindre les comptes (Supabase). Vérifie ta connexion.';
  if (/rate limit|too many/i.test(message)) return 'Trop de demandes : attends quelques minutes et réessaie.';
  if (/invalid login credentials/i.test(message)) return 'Email ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) return "Confirme d'abord ton email : clique sur le lien reçu par mail (pense aux spams).";
  if (/already registered|already been registered/i.test(message)) return 'Un compte existe déjà avec cet email : connecte-toi.';
  if (/password should be|at least \d+ characters|weak password/i.test(message)) return 'Mot de passe trop faible : 8 caractères minimum, avec lettres et chiffres.';
  if (/valid email|invalid email|email address .* is invalid/i.test(message)) return 'Adresse email invalide.';
  if (/Invitation inconnue/.test(message)) return "Ce code d'invitation n'existe pas.";
  if (/exclure_membre|nouvelle_invitation/.test(message)) return 'La modération n\'est pas encore activée : il faut exécuter supabase/moderation.sql dans Supabase.';
  if (/supprimer_mon_compte/.test(message)) return 'La suppression de compte n\'est pas encore activée : il faut exécuter supabase/comptes.sql dans Supabase.';
  if (/duplicate key.*pseudo|profils_pseudo/i.test(message)) return 'Ce pseudo est déjà pris.';
  if (/(relation|table).*notes|notes.*schema cache/i.test(message)) return 'Les notes ne sont pas encore activées : il faut exécuter supabase/notes.sql dans Supabase.';
  if (/(could not find the function|function .* does not exist).*(ami|amis)/i.test(message)) return "Les amis ne sont pas encore activés : il faut exécuter supabase/amis.sql dans Supabase.";
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

// ---------- Données de l'appareil : à qui sont-elles ? ----------
// Le code perso, la liste, les notes, les préférences et le groupe actif sont gardés dans le
// navigateur. "radar:proprietaire" dit à quel compte ils appartiennent ; absent = créés ici
// sans être connecté. Sur un appareil partagé, le compte suivant ne doit RIEN en hériter.
const CLE_PROPRIETAIRE = 'radar:proprietaire';
const DONNEES_DU_COMPTE = ['radar:code', 'radar:liste', 'radar:notes', 'radar:preferences', 'radar:groupe', 'radar:synchro', 'radar:adn-verifs', CLE_PROPRIETAIRE];

function proprietaireLocal() {
  const proprietaire = localStorage.getItem(CLE_PROPRIETAIRE);
  if (proprietaire) return proprietaire;
  // Avant "radar:proprietaire", seules les notes retenaient leur compte
  try { return JSON.parse(localStorage.getItem('radar:notes'))?.utilisateur || null; } catch { return null; }
}

/** Efface de ce navigateur tout ce qui appartient au compte (un nouveau code perso sera tiré). */
export function effacerDonneesLocales() {
  for (const cle of DONNEES_DU_COMPTE) localStorage.removeItem(cle);
  sessionStorage.removeItem('radar:rattache');
  window.dispatchEvent(new CustomEvent('radar:liste'));
  window.dispatchEvent(new CustomEvent('radar:notes'));
}

// Déjà connecté avant cette règle : les données de l'appareil sont celles de ce compte
utilisateur().then((u) => {
  if (u && !proprietaireLocal()) localStorage.setItem(CLE_PROPRIETAIRE, u.id);
}).catch(() => {});

/**
 * Se déconnecter : on envoie d'abord ce qui n'est pas encore parti (liste, notes), on coupe les
 * notifications de cet appareil, puis on efface tout ce qui appartient au compte.
 * Renvoie false si la personne a préféré rester connectée (modifications pas encore envoyées).
 */
export async function deconnexion() {
  const notes = await import('./notes.js');
  let envoye = true;
  try {
    await maListe.envoyer();
    await publierListe();
    await notes.synchroniserNotes();
  } catch {
    envoye = false;
  }
  if (!envoye && !confirm('Certaines modifications n\'ont pas pu être envoyées (connexion coupée ?). Elles seront perdues sur cet appareil. Te déconnecter quand même ?')) return false;
  await notifications.desactiver().catch(() => { /* notifications non prises en charge */ });
  await supabase().auth.signOut();
  effacerDonneesLocales();
  return true;
}

/**
 * Supprime mon compte et toutes mes données (supabase/comptes.sql) : d'abord ce que garde le
 * relais (liste, abonnements, cloche), puis le compte dans la base, puis cet appareil.
 * Mes groupes passent à leur membre le plus ancien.
 */
export async function supprimerCompte() {
  const u = await utilisateur();
  if (!u) throw new Error('Connexion requise');
  const ligne = verifier(await supabase().from('codes').select('code').eq('id', u.id).maybeSingle());
  const codes = new Set([ligne?.code, proprietaireLocal() === u.id ? maListe.codePerso() : null].filter(Boolean));
  for (const code of codes) await maListe.appelRelais('DELETE', `/donnees/${code}`);
  await notifications.desactiver().catch(() => { /* notifications non prises en charge */ });
  verifier(await supabase().rpc('supprimer_mon_compte'));
  await supabase().auth.signOut({ scope: 'local' }).catch(() => {});
  effacerDonneesLocales();
}

/**
 * Relie le compte au code perso :
 *  - données locales d'un AUTRE compte : effacées, jamais fusionnées ;
 *  - données créées ici sans être connecté : ajoutées au compte seulement si on le confirme ;
 *  - puis : le compte a déjà un code (créé sur un autre appareil) : cet appareil l'adopte
 *    et récupère la liste ; sinon on enregistre le code de cet appareil dans le compte.
 */
async function rattacherListe(userId) {
  const proprietaire = proprietaireLocal();
  if (proprietaire !== userId) {
    const elements = maListe.items().length;
    const notesLocales = (await import('./notes.js')).toutes().filter((n) => !n.synchro).length;
    const horsConnexion = !proprietaire && (elements || notesLocales);
    const garder = horsConnexion && confirm(`Ce navigateur contient des ajouts faits sans être connecté (${[
      elements && `${elements} élément${elements > 1 ? 's' : ''} de liste`,
      notesLocales && `${notesLocales} note${notesLocales > 1 ? 's' : ''} ou favori${notesLocales > 1 ? 's' : ''}`,
    ].filter(Boolean).join(' et ')}). Les ajouter à ton compte ?\n\nAnnuler : ils seront effacés de cet appareil.`);
    if (!garder) effacerDonneesLocales();
    localStorage.setItem(CLE_PROPRIETAIRE, userId);
  }
  const ligne = verifier(await supabase().from('codes').select('code').eq('id', userId).maybeSingle());
  if (ligne?.code && ligne.code !== maListe.codePerso()) {
    await maListe.utiliserCode(ligne.code);
  } else if (!ligne) {
    verifier(await supabase().from('codes').insert({ id: userId, code: maListe.codePerso() }));
  }
  await publierListe();
  import('./notes.js').then((n) => n.synchroniserNotes()).catch(() => { /* la prochaine page s'en chargera */ });
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

// ---------- Groupes de potes (on peut en avoir plusieurs) ----------
// Groupe actif : celui qu'on regarde dans Potes, qu'on ouvre dans Chat et qu'on
// propose en premier dans Recommander. Retenu dans le navigateur.
const CLE_GROUPE = 'radar:groupe';
export function groupeActif() {
  try { return localStorage.getItem(CLE_GROUPE); } catch { return null; }
}
export function choisirGroupe(id) {
  try { localStorage.setItem(CLE_GROUPE, id); } catch { /* stockage indisponible : on oublie le choix */ }
}
/** Le groupe actif parmi `groupes` (ou le premier si l'actif n'existe plus). */
export const trouverGroupeActif = (groupes) => groupes.find((g) => g.id === groupeActif()) || groupes[0] || null;

export async function mesGroupes() {
  const u = await utilisateur();
  if (!u) return [];
  return verifier(await supabase().from('groupes').select('id, nom, invitation, cree_par, membres(user_id)').order('cree_le'));
}

export async function creerGroupe(nom) {
  const groupe = verifier(await supabase().rpc('creer_groupe', { nom_groupe: nom }));
  if (groupe?.id) choisirGroupe(groupe.id);
  return groupe;
}

export async function rejoindreGroupe(invitation) {
  const id = verifier(await supabase().rpc('rejoindre_groupe', { code_invitation: invitation }));
  if (id) choisirGroupe(id);
  return id;
}

// Modération (supabase/moderation.sql) : réservée au créateur du groupe
export const exclureMembre = (groupeId, membreId) => rpc('exclure_membre', { groupe: groupeId, membre: membreId });
export const nouvelleInvitation = (groupeId) => rpc('nouvelle_invitation', { groupe: groupeId });

export async function quitterGroupe(groupeId) {
  const u = await utilisateur();
  verifier(await supabase().from('membres').delete().eq('groupe_id', groupeId).eq('user_id', u.id));
}

/** Mes potes (membres de mes groupes et amis, sans moi), avec leur profil et leur liste. */
export async function mesPotes() {
  const u = await utilisateur();
  if (!u) return [];
  const [profils, listes] = await Promise.all([
    supabase().from('profils').select('id, pseudo, avatar').neq('id', u.id).then(verifier),
    supabase().from('listes').select('user_id, items, maj').neq('user_id', u.id).then(verifier),
  ]);
  // Les listes viennent de la base : on écarte les éléments mal formés
  const listeDe = new Map(listes.map((l) => [l.user_id, Array.isArray(l.items) ? l.items.filter(maListe.itemValide) : []]));
  // RLS ne renvoie que les profils des membres de mes groupes et de mes amis : ce sont mes potes
  return profils.map((p) => ({ ...p, items: listeDe.get(p.id) || [] }));
}

/** Les potes qui suivent cet élément (pour afficher "3 potes suivent" sur une fiche). */
export async function potesQuiSuivent(type, id) {
  if (!(await utilisateur())) return [];
  return (await mesPotes()).filter((p) => p.items.some((i) => i.type === type && Number(i.id) === Number(id)));
}

/** Pseudo et avatar de mes potes (membres de mes groupes et amis, sans moi), sans leurs listes. */
export async function profilsPotes() {
  const u = await utilisateur();
  if (!u) return [];
  return verifier(await supabase().from('profils').select('id, pseudo, avatar').neq('id', u.id));
}

// ---------- Notes perso et favoris (supabase/notes.sql, voir lib/notes.js) ----------
// La RLS ne renvoie que mes lignes et celles de mes amis et des membres de mes groupes.
const COLONNES_NOTES = 'user_id, type, oeuvre, titre, image, note, avis, favori, note_le, favori_le, maj';

export async function mesNotes() {
  const u = await utilisateur();
  if (!u) return [];
  return verifier(await supabase().from('notes').select(COLONNES_NOTES).eq('user_id', u.id));
}

export async function enregistrerNotes(notes) {
  const u = await utilisateur();
  if (!u || !notes.length) return;
  verifier(await supabase().from('notes').upsert(notes.map((n) => ({
    user_id: u.id, type: n.type, oeuvre: n.id, titre: n.titre, image: n.image || null,
    note: n.note, avis: n.avis, favori: n.favori, maj: n.maj,
  }))));
}

export async function supprimerNotes(notes) {
  const u = await utilisateur();
  if (!u) return;
  const parType = new Map();
  for (const n of notes) parType.set(n.type, [...(parType.get(n.type) || []), n.id]);
  for (const [type, ids] of parType) {
    verifier(await supabase().from('notes').delete().eq('user_id', u.id).eq('type', type).in('oeuvre', ids));
  }
}

/**
 * Les notes et favoris de mes potes (les plus récents d'abord).
 * Supabase renvoie 1000 lignes au plus par requête : on lit page par page (tri stable,
 * pour ne rien sauter ni lire deux fois), jusqu'à 20 000 notes.
 */
const PAGE_NOTES = 1000;
export async function notesDesPotes() {
  const u = await utilisateur();
  if (!u) return [];
  const toutes = [];
  for (let debut = 0; debut < 20 * PAGE_NOTES; debut += PAGE_NOTES) {
    const page = verifier(await supabase().from('notes').select(COLONNES_NOTES).neq('user_id', u.id)
      .order('maj', { ascending: false }).order('user_id').order('type').order('oeuvre')
      .range(debut, debut + PAGE_NOTES - 1));
    toutes.push(...page);
    if (page.length < PAGE_NOTES) break;
  }
  return toutes;
}

/** Ce que mes potes pensent d'une œuvre (fiche : « Tes potes l'ont noté »). */
export async function notesSurOeuvre(type, id) {
  const u = await utilisateur();
  if (!u) return [];
  return verifier(await supabase().from('notes').select(COLONNES_NOTES)
    .eq('type', type).eq('oeuvre', Number(id)).neq('user_id', u.id));
}

// ---------- Amis (supabase/amis.sql), indépendants des groupes ----------
// Tout passe par des fonctions de la base : on ne peut ni s'accepter soi-même, ni voir
// le profil ou la liste de quelqu'un avant qu'il ait accepté.
const rpc = async (nom, args) => verifier(await supabase().rpc(nom, args));

/** Mes amis et mes demandes : [{ id, pseudo, avatar, statut: 'ami' | 'recue' | 'envoyee', depuis }] */
export async function mesAmis() {
  if (!(await utilisateur())) return [];
  return rpc('mes_amis');
}

/** Ajoute par pseudo ou code ami. Renvoie 'envoyee', 'acceptee', 'deja_demande' ou 'deja_amis'. */
export const demanderAmi = (pseudoOuCode) => rpc('demander_ami', { pseudo_ou_code: pseudoOuCode });
/** Ajoute un membre d'un de mes groupes (bouton dans Potes). */
export const demanderAmiMembre = (id) => rpc('demander_ami_membre', { autre: id });
export const accepterAmi = (id) => rpc('accepter_ami', { autre: id });
export const refuserAmi = (id) => rpc('refuser_ami', { autre: id });
/** Supprime un ami, ou annule une demande envoyée. */
export const supprimerAmi = (id) => rpc('supprimer_ami', { autre: id });
export const nouveauCodeAmi = () => rpc('nouveau_code_ami');

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

/** Supprime une recommandation reçue (supabase/dates-recommandations.sql). */
export async function supprimerRecommandation(id) {
  const lignes = verifier(await supabase().from('recommandations').delete().eq('id', id).select('id'));
  if (!lignes?.length) throw new Error('Suppression impossible pour le moment : il faut exécuter supabase/dates-recommandations.sql dans Supabase.');
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
    signal: AbortSignal.timeout(20_000),
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
