// =========================================================
// Page Potes : compte (email + mot de passe), groupes, amis, recommandations, activité.
//
// Sécurité : tout ce qui vient de la base (pseudos, noms de groupe, listes des potes,
// recommandations…) est affiché avec el() (nœuds texte + setAttribute), jamais
// avec innerHTML. Seuls les morceaux de HTML écrits en dur passent par gabarit().
// =========================================================
import * as compte from '../lib/compte.js';
import { TYPES, lienElement } from '../lib/ma-liste.js';
import * as notes from '../lib/notes.js';
import { imageReduite } from '../ui/cartes-jeux.js';
import { el, gabarit, ilYa, afficherErreur, uuidValide, couleurValide, imageValide } from '../lib/outils.js';
import { afficherNavigation } from '../ui/nav.js';
import { ICONES } from '../ui/icones.js';

afficherNavigation('potes');
document.documentElement.style.setProperty('--accent', '#6ec8ff');
const $ = (id) => document.getElementById(id);

const AVATARS = ['🎮', '⚔️', '🐉', '🦊', '🐺', '🌸', '🔥', '⚡', '🍜', '👾', '🎧', '🛸', '🌙', '🐱', '🦖', '🍀'];

const message = (texte) => (texte ? el('p', { class: 'message-notif' }, texte) : null);
const remplir = (conteneur, ...enfants) => conteneur.replaceChildren(...enfants.flat().filter(Boolean));
const pastillePote = (p) => el('span', { class: 'pote', title: p.pseudo }, el('i', {}, p.avatar), p.pseudo);
const icone = (nom) => gabarit(ICONES[nom]);

// =========================================================
// 1. Compte
// =========================================================
async function afficherCompte(texte = '') {
  const carte = $('carte-compte');

  if (!compte.comptesActifs()) {
    remplir(carte, el('p', {}, 'Les comptes ne sont pas encore configurés (js/config.js).'));
    return;
  }

  const utilisateur = await compte.utilisateur();
  if (!utilisateur) {
    afficherConnexion(texte);
    return;
  }

  // Mot de passe oublié : le lien de l'email nous connecte, il reste à choisir le nouveau
  if (new URLSearchParams(location.search).has('reinitialiser')) {
    afficherNouveauMotDePasse(texte);
    return;
  }
  await compte.verifierRattachement();

  const profil = await compte.monProfil();
  if (!profil) {
    afficherFormulaireProfil(texte, { pseudo: '', avatar: AVATARS[0] }, true);
    return;
  }

  remplir(carte,
    message(texte),
    el('div', { class: 'moi' },
      el('span', { class: 'avatar' }, profil.avatar),
      el('div', {}, el('b', {}, profil.pseudo), el('small', {}, utilisateur.email))),
    gabarit(`
      <div class="actions" style="margin-top:16px">
        <button type="button" class="bouton bouton-verre bouton-petit" id="modifier-profil">Modifier mon profil</button>
        <button type="button" class="bouton bouton-verre bouton-petit" id="deconnexion">Se déconnecter</button>
      </div>
      <button type="button" class="lien-discret lien-danger" id="supprimer-compte" style="margin-top:12px">Supprimer mon compte</button>
      <p class="mention">Ta liste et tes notifications sont liées à ton compte : connecte-toi sur un autre appareil pour les retrouver. Se déconnecter les efface de cet appareil (elles restent dans ton compte).</p>`));
  $('modifier-profil').addEventListener('click', () => afficherFormulaireProfil('', profil, false));
  $('deconnexion').addEventListener('click', async () => {
    const bouton = $('deconnexion');
    bouton.disabled = true;
    if (await compte.deconnexion()) location.reload();
    else bouton.disabled = false;
  });
  $('supprimer-compte').addEventListener('click', async () => {
    const reponse = prompt('Supprimer ton compte ? Ta liste, tes notes et favoris, tes amis, tes recommandations et tes messages seront effacés pour toujours. Tes groupes passeront au membre le plus ancien.\n\nTape SUPPRIMER pour confirmer :');
    if (reponse?.trim().toUpperCase() !== 'SUPPRIMER') return;
    const bouton = $('supprimer-compte');
    bouton.disabled = true;
    try {
      await compte.supprimerCompte();
      afficherConnexion('Ton compte et toutes tes données ont été supprimés.');
      ['groupe', 'amis', 'recommandations', 'gouts', 'suggestions', 'populaire', 'activite'].forEach((id) => { if ($(id)) $(id).hidden = true; });
    } catch (erreur) {
      bouton.disabled = false;
      afficherCompte(`⚠️ ${erreur.message}`);
    }
  });
  await afficherReste(profil);
}

function afficherConnexion(texte = '', email = '') {
  remplir($('carte-compte'),
    message(texte),
    gabarit(`
      <p>Connecte-toi pour retrouver ta liste partout, rejoindre tes potes et voir ce qu'ils suivent.</p>
      <form id="form-connexion" class="form-compte">
        <label class="etiquette" for="email">Email</label>
        <input class="champ" type="email" id="email" placeholder="ton@email.fr" autocomplete="email" required>
        <label class="etiquette" for="mdp">Mot de passe</label>
        <input class="champ" type="password" id="mdp" placeholder="8 caractères minimum" autocomplete="current-password" minlength="8" required>
        <div class="actions">
          <button class="bouton bouton-plein bouton-petit" data-action="connexion">Se connecter</button>
          <button class="bouton bouton-verre bouton-petit" data-action="inscription">Créer un compte</button>
        </div>
        <button type="button" class="lien-discret" id="oubli">Mot de passe oublié ?</button>
      </form>`));
  $('email').value = email;

  $('form-connexion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = e.submitter?.dataset.action || 'connexion';
    const adresse = $('email').value;
    const motDePasse = $('mdp').value;
    if (e.submitter) e.submitter.disabled = true;
    try {
      if (action === 'inscription') {
        const connecte = await compte.inscription(adresse, motDePasse);
        if (connecte) afficherCompte('Compte créé ✅');
        else afficherConnexion('Compte créé ✅ Clique sur le lien de confirmation reçu par email (pense aux spams), puis reviens te connecter ici.', adresse);
      } else {
        await compte.connexion(adresse, motDePasse);
        afficherCompte('Connecté ✅');
      }
    } catch (erreur) {
      afficherConnexion(`⚠️ ${erreur.message}`, adresse);
    }
  });

  $('oubli').addEventListener('click', async () => {
    const adresse = $('email').value.trim();
    if (!adresse) { afficherConnexion('Entre d\'abord ton email, puis reclique sur « Mot de passe oublié ? ».'); return; }
    try {
      await compte.motDePasseOublie(adresse);
      afficherConnexion('Email envoyé : clique sur le lien pour choisir un nouveau mot de passe.', adresse);
    } catch (erreur) {
      afficherConnexion(`⚠️ ${erreur.message}`, adresse);
    }
  });
}

// Arrivée depuis le lien "mot de passe oublié" : on choisit le nouveau
function afficherNouveauMotDePasse(texte = '') {
  remplir($('carte-compte'),
    message(texte),
    gabarit(`
      <p>Choisis ton nouveau mot de passe :</p>
      <form class="ligne-code" id="form-nouveau-mdp">
        <input class="champ" type="password" id="nouveau-mdp" autocomplete="new-password" minlength="8" placeholder="8 caractères minimum" required>
        <button class="bouton bouton-plein bouton-petit">Enregistrer</button>
      </form>`));
  $('form-nouveau-mdp').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await compte.changerMotDePasse($('nouveau-mdp').value);
      history.replaceState(null, '', location.pathname);
      afficherCompte('Mot de passe changé ✅');
    } catch (erreur) {
      afficherNouveauMotDePasse(`⚠️ ${erreur.message}`);
    }
  });
}

function afficherFormulaireProfil(texte, profil, premiereFois) {
  let avatar = profil.avatar;
  remplir($('carte-compte'),
    message(texte),
    el('p', {}, premiereFois ? 'Bienvenue ! Choisis un pseudo et un avatar : c\'est ce que verront tes potes.' : 'Modifie ton profil :'),
    gabarit(`
      <form id="form-profil">
        <label class="etiquette" for="pseudo" style="margin-top:14px">Pseudo</label>
        <input class="champ" id="pseudo" minlength="2" maxlength="24" required autocomplete="nickname">
        <span class="etiquette" style="margin-top:14px">Avatar</span>
        <div class="avatars">${AVATARS.map((a) => `<button type="button" data-avatar="${a}">${a}</button>`).join('')}</div>
        <div class="actions" style="margin-top:16px"><button class="bouton bouton-plein bouton-petit">Enregistrer</button></div>
      </form>`));
  $('pseudo').value = profil.pseudo;
  const boutons = $('form-profil').querySelectorAll('[data-avatar]');
  boutons.forEach((b) => b.classList.toggle('actif', b.dataset.avatar === avatar));

  $('form-profil').querySelector('.avatars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-avatar]');
    if (!b) return;
    avatar = b.dataset.avatar;
    boutons.forEach((x) => x.classList.toggle('actif', x === b));
  });
  $('form-profil').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await compte.enregistrerProfil({ pseudo: $('pseudo').value, avatar });
      afficherCompte(premiereFois ? 'Profil créé ✅ Rejoins ou crée ton groupe de potes ci-dessous.' : 'Profil mis à jour ✅');
    } catch (erreur) {
      afficherFormulaireProfil(`⚠️ ${erreur.message}`, { pseudo: $('pseudo').value, avatar }, premiereFois);
    }
  });
}

// =========================================================
// 2. Groupes, amis, recommandations, populaire, activité (une fois connecté avec un profil)
// =========================================================
let monProfilCourant = null;
let portee = 'groupe'; // Populaire et activité : 'groupe' (le groupe actif) ou 'amis'
let categorieSuggestions = 'animes';
let derniersPotes = null; // pour réafficher Populaire/Activité quand on change de portée

async function afficherReste(profil) {
  monProfilCourant = profil;
  $('groupe').hidden = false;
  $('amis').hidden = false;
  await afficherSocial();
}

// Recharge groupes, potes et amis, puis réaffiche tout ce qui en dépend.
// `messages` : texte à afficher en haut de la carte Groupes et/ou Amis.
async function afficherSocial(messages = {}) {
  const [groupes, potes, amis, notesPotes] = await Promise.all([
    compte.mesGroupes().then((gs) => gs.filter((g) => uuidValide(g.id))),
    compte.mesPotes(),
    // amis.sql pas encore exécuté : les groupes marchent quand même
    compte.mesAmis().then((a) => a.filter((x) => uuidValide(x.id))).catch((erreur) => ({ erreur })),
    // notes.sql pas encore exécuté : null (les sections des notes restent masquées)
    compte.notesDesPotes().then(notes.notesValides).catch(() => null),
    notes.synchroniserNotes().catch(() => {}), // mes notes à jour pour la compatibilité
  ]);
  const parId = new Map(potes.map((p) => [p.id, p]));
  const listeAmis = Array.isArray(amis) ? amis : null;
  const groupe = compte.trouverGroupeActif(groupes);
  const amisAcceptes = (listeAmis || []).filter((a) => a.statut === 'ami').map((a) => parId.get(a.id)).filter(Boolean);

  afficherGroupe(groupes, groupe, parId, listeAmis, messages.groupe);
  afficherAmis(amis, parId, messages.amis);
  // Notes et favoris de chacun de mes potes
  const notesDe = new Map();
  for (const n of notesPotes || []) if (parId.has(n.auteur)) notesDe.set(n.auteur, [...(notesDe.get(n.auteur) || []), n]);
  derniersPotes = { groupe, parId, amisAcceptes, notesDe, notesActives: notesPotes !== null };
  afficherGouts();
  await Promise.all([afficherRecommandations(parId), afficherPotes()]);
}

// Formulaires « Rejoindre » et « Créer » (textes écrits en dur)
const FORMULAIRES_GROUPE = `
  <h3 style="margin-top:18px">Rejoindre un groupe</h3>
  <form class="ligne-code" id="form-rejoindre">
    <input class="champ" id="invitation" placeholder="Code d'invitation" required>
    <button class="bouton bouton-plein bouton-petit">Rejoindre</button>
  </form>
  <h3 style="margin-top:22px">Créer un groupe</h3>
  <form class="ligne-code" id="form-creer">
    <input class="champ" id="nom-groupe" placeholder="Nom du groupe (ex : Les otakus)" minlength="2" maxlength="40" required>
    <button class="bouton bouton-verre bouton-petit">Créer</button>
  </form>`;

function brancherFormulairesGroupe() {
  $('invitation').value = new URLSearchParams(location.search).get('invitation') || '';
  $('form-rejoindre').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await compte.rejoindreGroupe($('invitation').value);
      history.replaceState(null, '', location.pathname);
      afficherSocial({ groupe: 'Bienvenue dans le groupe 🎉' });
    } catch (erreur) {
      afficherSocial({ groupe: `⚠️ ${erreur.message}` });
    }
  });
  $('form-creer').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await compte.creerGroupe($('nom-groupe').value);
      afficherSocial({ groupe: 'Groupe créé ✅ Partage le lien d\'invitation à tes potes.' });
    } catch (erreur) {
      afficherSocial({ groupe: `⚠️ ${erreur.message}` });
    }
  });
}

// Un membre du groupe, avec « + Ami » en un clic (ou où on en est avec lui)
function pastilleMembre(p, statutAmi, amisActifs) {
  if (!amisActifs) return pastillePote(p);
  const action = {
    ami: () => el('span', { class: 'pote-statut' }, '✓ Ami'),
    envoyee: () => el('span', { class: 'pote-statut' }, 'Demande envoyée'),
    recue: () => el('button', { type: 'button', class: 'pote-action', 'data-accepter-ami': p.id }, 'Accepter'),
  }[statutAmi]?.() ?? el('button', { type: 'button', class: 'pote-action', 'data-ajouter-ami': p.id, title: `Ajouter ${p.pseudo} en ami` }, '+ Ami');
  return el('span', { class: 'pote-ligne' }, pastillePote(p), action);
}

function afficherGroupe(groupes, g, parId, amis, texte = '') {
  const carte = $('carte-groupe');

  if (!g) {
    remplir(carte,
      message(texte),
      gabarit(`<p>Tu n'es dans aucun groupe. Rejoins celui de tes potes avec leur code d'invitation, ou crée le tien.</p>${FORMULAIRES_GROUPE}`));
    brancherFormulairesGroupe();
    return;
  }

  const invitationDansLien = new URLSearchParams(location.search).has('invitation');
  const lienInvitation = new URL('potes.html', location.href);
  lienInvitation.searchParams.set('invitation', g.invitation);
  const membres = g.membres.map((m) => parId.get(m.user_id)).filter(Boolean);
  const statuts = new Map((amis || []).map((a) => [a.id, a.statut]));
  const nb = g.membres.length;

  remplir(carte,
    message(texte),
    // Plusieurs groupes : on passe de l'un à l'autre (le choix vaut aussi pour Chat et Recommander)
    groupes.length > 1
      ? el('nav', { class: 'segments', 'aria-label': 'Mes groupes', style: { 'margin-bottom': '18px' } },
        groupes.map((x) => el('button', { type: 'button', 'data-groupe': x.id, class: x.id === g.id ? 'actif' : null, 'aria-pressed': String(x.id === g.id) }, x.nom)))
      : null,
    el('div', { class: 'groupe' },
      el('h3', {}, g.nom, ' ', el('small', {}, `${nb} membre${nb > 1 ? 's' : ''}`)),
      el('div', { class: 'potes' }, membres.length
        ? membres.map((p) => pastilleMembre(p, statuts.get(p.id), Boolean(amis)))
        : el('span', { class: 'mention', style: { margin: '0' } }, 'Pour l\'instant, il n\'y a que toi : invite tes potes !')),
      el('p', { class: 'mention' }, 'Code d\'invitation : ', el('code', {}, g.invitation)),
      el('div', { class: 'actions', style: { 'margin-top': '10px' } },
        el('a', { class: 'bouton bouton-plein bouton-petit', href: `chat.html?groupe=${g.id}` }, icone('bulle'), 'Ouvrir le chat'),
        el('button', { type: 'button', class: 'bouton bouton-verre bouton-petit', 'data-partager': lienInvitation.href, 'data-nom': g.nom }, icone('externe'), 'Inviter des potes'),
        el('button', { type: 'button', class: 'bouton bouton-verre bouton-petit', 'data-quitter': g.id }, 'Quitter ce groupe'))),
    // Un autre groupe : ouvert d'office si on arrive avec un lien d'invitation
    el('details', { class: 'autre-groupe', open: invitationDansLien },
      el('summary', {}, icone('plus'), 'Créer ou rejoindre un autre groupe'),
      gabarit(FORMULAIRES_GROUPE)));
  brancherFormulairesGroupe();

  // onclick (et pas addEventListener) : un seul gestionnaire, même après un réaffichage
  carte.onclick = async (e) => {
    if (await actionAmi(e, 'groupe')) return;
    const choix = e.target.closest('[data-groupe]');
    const partager = e.target.closest('[data-partager]');
    const quitter = e.target.closest('[data-quitter]');
    if (choix) {
      compte.choisirGroupe(choix.dataset.groupe);
      afficherSocial();
    }
    if (partager) {
      const lienPartage = partager.dataset.partager;
      // Sur téléphone : feuille de partage (WhatsApp, Messages…) ; sinon on copie le lien
      if (navigator.share) {
        await navigator.share({ title: 'Radar', text: `Rejoins mon groupe « ${partager.dataset.nom} » sur Radar`, url: lienPartage }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(lienPartage);
        partager.textContent = 'Lien copié ✓';
      }
    }
    if (quitter && confirm(`Quitter le groupe « ${g.nom} » ?`)) {
      await compte.quitterGroupe(quitter.dataset.quitter);
      afficherSocial({ groupe: 'Tu as quitté le groupe.' });
    }
  };
}

// =========================================================
// 3. Amis (supabase/amis.sql) : indépendants des groupes
// =========================================================
const REPONSES_DEMANDE = {
  envoyee: 'Demande envoyée ✅ Vous serez amis dès qu\'elle sera acceptée.',
  acceptee: 'Vous êtes maintenant amis 🎉 (cette personne t\'avait déjà fait une demande).',
  deja_demande: 'Demande déjà envoyée : en attente de réponse.',
  deja_amis: 'Vous êtes déjà amis.',
};

// Boutons des cartes Groupes et Amis. Renvoie true si le clic concernait les amis.
async function actionAmi(e, carte) {
  const b = e.target.closest('[data-ajouter-ami], [data-accepter-ami], [data-refuser-ami], [data-retirer-ami], [data-annuler-ami]');
  if (!b) return false;
  const { ajouterAmi, accepterAmi, refuserAmi, retirerAmi, annulerAmi } = b.dataset;
  const pseudo = derniersPotes?.parId.get(retirerAmi)?.pseudo || 'cette personne';
  if (retirerAmi && !confirm(`Retirer ${pseudo} de tes amis ? Vous ne verrez plus vos listes respectives (sauf si vous êtes dans un même groupe).`)) return true;
  b.disabled = true;
  let texte;
  try {
    if (ajouterAmi) texte = REPONSES_DEMANDE[await compte.demanderAmiMembre(ajouterAmi)];
    if (accepterAmi) { await compte.accepterAmi(accepterAmi); texte = 'Demande acceptée 🎉'; }
    if (refuserAmi) { await compte.refuserAmi(refuserAmi); texte = 'Demande refusée.'; }
    if (retirerAmi) { await compte.supprimerAmi(retirerAmi); texte = 'Ami retiré.'; }
    if (annulerAmi) { await compte.supprimerAmi(annulerAmi); texte = 'Demande annulée.'; }
  } catch (erreur) {
    texte = `⚠️ ${erreur.message}`;
  }
  await afficherSocial({ [carte]: texte });
  return true;
}

const ligneAmi = (a, parId, ...boutons) => el('li', {},
  // Avant acceptation, la base ne renvoie que le pseudo (et l'avatar si c'est une demande reçue)
  pastillePote(parId.get(a.id) || { pseudo: a.pseudo, avatar: a.avatar || '👤' }),
  el('small', {}, ilYa(a.depuis)),
  el('span', { class: 'actions' }, ...boutons));
const boutonAmi = (texte, attribut, id, plein = false) => el('button',
  { type: 'button', class: `bouton ${plein ? 'bouton-plein' : 'bouton-verre'} bouton-petit`, [attribut]: id }, texte);

function afficherAmis(amis, parId, texte = '') {
  const carte = $('carte-amis');
  if (amis.erreur) {
    remplir(carte, el('p', { class: 'mention', style: { margin: '0' } }, amis.erreur.message));
    return;
  }
  const recues = amis.filter((a) => a.statut === 'recue');
  const envoyees = amis.filter((a) => a.statut === 'envoyee');
  const acceptes = amis.filter((a) => a.statut === 'ami');
  const code = monProfilCourant?.code_ami;
  $('resume-amis').textContent = recues.length ? `${recues.length} demande${recues.length > 1 ? 's' : ''} en attente` : '';

  remplir(carte,
    message(texte),
    gabarit(`
      <p>Tes amis voient ta liste et peuvent te recommander des titres, même sans groupe en commun. Rien n'est partagé tant qu'une demande n'a pas été acceptée.</p>
      <form class="ligne-code" id="form-ami">
        <input class="champ" id="pseudo-ami" placeholder="Pseudo ou code ami" minlength="2" maxlength="24" required autocomplete="off" aria-label="Pseudo ou code ami">
        <button class="bouton bouton-plein bouton-petit">Ajouter</button>
      </form>`),
    code ? el('p', { class: 'mention code-ami' }, 'Ton code ami : ', el('code', {}, code),
      el('button', { type: 'button', class: 'lien-discret', 'data-copier-code': code }, 'Copier'),
      el('button', { type: 'button', class: 'lien-discret', 'data-nouveau-code': '' }, 'Changer de code')) : null,
    recues.length ? [
      el('h3', { style: { 'margin-top': '22px' } }, 'Demandes reçues'),
      el('ul', { class: 'liste-amis' }, recues.map((a) => ligneAmi(a, parId,
        boutonAmi('Accepter', 'data-accepter-ami', a.id, true), boutonAmi('Refuser', 'data-refuser-ami', a.id)))),
    ] : null,
    el('h3', { style: { 'margin-top': '22px' } }, `Mes amis${acceptes.length ? ` (${acceptes.length})` : ''}`),
    acceptes.length
      ? el('ul', { class: 'liste-amis' }, acceptes.map((a) => ligneAmi(a, parId, boutonAmi('Retirer', 'data-retirer-ami', a.id))))
      : el('p', { class: 'mention', style: { margin: '6px 0 0' } }, 'Pas encore d\'amis. Ajoute quelqu\'un avec son pseudo ou son code ami, ou depuis un de tes groupes (« + Ami »).'),
    envoyees.length ? [
      el('h3', { style: { 'margin-top': '22px' } }, 'Demandes envoyées'),
      el('ul', { class: 'liste-amis' }, envoyees.map((a) => ligneAmi(a, parId, boutonAmi('Annuler', 'data-annuler-ami', a.id)))),
    ] : null);

  $('form-ami').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saisie = $('pseudo-ami').value.trim();
    let reponse;
    try {
      reponse = REPONSES_DEMANDE[await compte.demanderAmi(saisie)];
    } catch (erreur) {
      reponse = `⚠️ ${erreur.message}`;
    }
    afficherSocial({ amis: reponse });
  });

  carte.onclick = async (e) => {
    if (await actionAmi(e, 'amis')) return;
    const copier = e.target.closest('[data-copier-code]');
    if (copier) {
      await navigator.clipboard.writeText(copier.dataset.copierCode).catch(() => {});
      copier.textContent = 'Copié ✓';
    }
    if (e.target.closest('[data-nouveau-code]') && confirm('Changer de code ami ? L\'ancien ne marchera plus (tes amis actuels restent tes amis).')) {
      try {
        monProfilCourant = { ...monProfilCourant, code_ami: await compte.nouveauCodeAmi() };
        afficherSocial({ amis: 'Nouveau code ami ✅' });
      } catch (erreur) {
        afficherSocial({ amis: `⚠️ ${erreur.message}` });
      }
    }
  };
}

// Vignette d'un élément (animé, jeu, film…) d'une liste de pote ou d'une recommandation
function image(item) {
  const src = imageValide(item.image);
  return src ? el('img', { src, alt: '', loading: 'lazy' }) : null;
}

async function afficherRecommandations(parId) {
  const recos = await compte.recommandationsRecues();
  $('recommandations').hidden = false;
  remplir($('liste-recos'), recos.length
    ? el('div', { class: 'recos' }, recos.map((r) => {
      const item = r.item && typeof r.item === 'object' ? r.item : {};
      const de = parId.get(r.de) || { pseudo: 'Un ancien pote', avatar: '👤' };
      return el('div', { class: 'avec-retirer reco-bloc' },
        el('a', { class: `reco ${r.vue ? '' : 'nouvelle'}`, href: lienElement(item) },
          image(item),
          el('div', {},
            el('small', {}, pastillePote(de), ` · ${ilYa(r.cree_le)}`),
            el('strong', {}, String(item.titre ?? '')),
            r.message ? el('p', {}, `« ${r.message} »`) : null)),
        Number.isInteger(r.id) ? el('button', { type: 'button', class: 'retirer', 'data-supprimer-reco': r.id, title: 'Supprimer cette recommandation', 'aria-label': `Supprimer la recommandation de ${de.pseudo}` }, '×') : null);
    }))
    : gabarit('<div class="vide"><strong>Aucune recommandation pour l\'instant</strong>Tes potes peuvent t\'en envoyer depuis la fiche d\'un animé ou d\'un jeu.</div>'));
  // Elles sont maintenant vues
  compte.marquerVues(recos.filter((r) => !r.vue).map((r) => r.id)).catch(() => {});
}

$('liste-recos').addEventListener('click', async (e) => {
  const bouton = e.target.closest('[data-supprimer-reco]');
  if (!bouton) return;
  bouton.disabled = true;
  try {
    await compte.supprimerRecommandation(Number(bouton.dataset.supprimerReco));
    bouton.closest('.reco-bloc').remove();
  } catch (erreur) {
    bouton.disabled = false;
    alert(erreur.message);
  }
});

// Populaire et activité : ce que suivent les membres du groupe actif, ou mes amis
function afficherPotes() {
  const { groupe, parId, amisAcceptes } = derniersPotes;
  const membres = groupe ? groupe.membres.map((m) => parId.get(m.user_id)).filter(Boolean) : [];
  const surAmis = !groupe || (portee === 'amis' && amisAcceptes.length > 0);
  const potes = surAmis ? amisAcceptes : membres;
  const ou = surAmis ? 'chez tes amis' : `dans « ${groupe.nom} »`;
  $('titre-populaire').textContent = `Populaire ${ou}`;
  $('titre-activite').textContent = `Activité ${ou}`;

  // Groupe actif ET amis : on choisit lesquels regarder
  const choix = Boolean(groupe && amisAcceptes.length);
  $('portee-potes').hidden = !choix;
  if (choix) {
    $('portee-potes').replaceChildren(
      el('button', { type: 'button', 'data-portee': 'groupe', class: surAmis ? null : 'actif' }, groupe.nom),
      el('button', { type: 'button', 'data-portee': 'amis', class: surAmis ? 'actif' : null }, 'Mes amis'));
  }

  // Populaire : ce que suivent le plus de potes (les listes sont déjà filtrées par compte.mesPotes)
  const compteur = new Map();
  for (const p of potes) {
    for (const item of p.items) {
      const cle = `${item.type}:${Number(item.id)}`;
      if (!compteur.has(cle)) compteur.set(cle, { item, potes: [] });
      compteur.get(cle).potes.push(p);
    }
  }
  const populaires = [...compteur.values()].sort((a, b) => b.potes.length - a.potes.length).slice(0, 15);
  // La section reste visible s'il y a un choix à faire (sinon on ne pourrait plus changer)
  $('populaire').hidden = !populaires.length && !choix;
  remplir($('liste-populaire'), populaires.length ? populaires.map(({ item, potes: qui }) => el('a',
    { class: 'affiche', href: lienElement(item), style: { '--couleur': couleurValide(item.couleur) || '#1a1a24' } },
    el('div', { class: `affiche-image ${item.type === 'jeu' ? 'paysage' : ''}` },
      image(item),
      el('span', { class: 'affiche-etiquette' }, `${qui.map((p) => p.avatar).join('')} ${qui.length}`)),
    el('div', { class: 'affiche-titre' }, String(item.titre ?? '')),
    el('div', { class: 'affiche-sous' }, TYPES[item.type].un)))
    : gabarit('<div class="vide"><strong>Rien pour l\'instant</strong>Leurs ajouts à Ma liste apparaîtront ici.</div>'));

  // Activité : les derniers ajouts, notes et favoris de chacun (dates posées par la base pour les notes)
  const date = (d) => (typeof d === 'string' && !Number.isNaN(Date.parse(d)) ? d : null);
  const activite = potes.flatMap((p) => [
    ...p.items.filter((i) => date(i.ajouteLe)).map((item) => ({ p, item, quand: item.ajouteLe, action: 'a ajouté' })),
    ...(derniersPotes.notesDe.get(p.id) || []).flatMap((n) => [
      date(n.noteLe) && n.note !== null ? { p, item: n, quand: n.noteLe, action: 'a noté', note: n.note } : null,
      date(n.favoriLe) && n.favori ? { p, item: n, quand: n.favoriLe, action: 'a mis en favori' } : null,
    ].filter(Boolean)),
  ])
    .sort((a, b) => Date.parse(b.quand) - Date.parse(a.quand))
    .slice(0, 25);
  $('activite').hidden = !activite.length;
  remplir($('liste-activite'), activite.map(({ p, item, action, note, quand }) => el('li', {},
    el('a', { href: lienElement(item) },
      pastillePote(p), ' ', el('span', {}, action), ' ', el('b', {}, String(item.titre ?? '')), ' ',
      note !== undefined ? el('b', { class: 'pastille accent' }, `${note}/100`) : null,
      action === 'a mis en favori' ? el('span', {}, '❤️') : null, ' ',
      el('small', {}, `${TYPES[item.type].un} · ${ilYa(quand)}`)))));
}

// Petite affiche cliquable (favoris d'un pote, suggestions)
function miniAffiche(n, detail) {
  const src = imageValide(n.type === 'jeu' ? imageReduite(n.image) : n.image);
  return el('a', { href: lienElement(n), title: n.titre },
    el('div', { class: 'vignette' }, src ? el('img', { src, alt: '', loading: 'lazy' }) : null),
    el('span', {}, n.titre),
    detail ? el('span', {}, detail) : null);
}

// ---------- Goûts en commun : compatibilité avec chaque pote + « Ses favoris » ----------
function afficherGouts() {
  const { parId, notesDe, notesActives } = derniersPotes;
  const mes = notes.toutes();
  const potes = [...parId.values()].map((pote) => {
    const siennes = notesDe.get(pote.id) || [];
    return { pote, notes: siennes, compat: notes.compatibilite(mes, siennes) };
  }).sort((a, b) => (b.compat.global?.pourcent ?? -1) - (a.compat.global?.pourcent ?? -1));

  $('gouts').hidden = !potes.length;
  if (!notesActives) {
    remplir($('liste-gouts'), el('p', { class: 'mention', style: { margin: '0' } }, 'Les notes ne sont pas encore activées : il faut exécuter supabase/notes.sql dans Supabase.'));
    $('suggestions').hidden = true;
    return;
  }
  remplir($('liste-gouts'), potes.map(({ pote, notes: siennes, compat }) => {
    const favoris = siennes.filter((n) => n.favori).sort((a, b) => String(b.favoriLe || '').localeCompare(String(a.favoriLe || '')));
    const nbNotes = siennes.filter((n) => n.note !== null).length;
    return el('article', { class: 'gout' },
      el('div', { class: 'gout-tete' },
        pastillePote(pote),
        el('div', { class: 'gout-pourcent', title: 'Compatibilité de goûts' },
          compat.global ? `${compat.global.pourcent} %` : '—',
          el('small', {}, compat.global ? `${compat.global.communs} œuvre${compat.global.communs > 1 ? 's' : ''} en commun` : 'rien en commun pour l\'instant'))),
      el('div', { class: 'gout-categories' }, Object.entries(notes.CATEGORIES).map(([cle, c]) =>
        el('span', { class: `pastille ${compat[cle] ? 'accent' : ''}`, title: compat[cle] ? `${compat[cle].communs} en commun` : 'Rien en commun' },
          `${c.nom} ${compat[cle] ? `${compat[cle].pourcent} %` : '—'}`))),
      el('p', { class: 'mention', style: { margin: '0' } }, `${nbNotes} note${nbNotes > 1 ? 's' : ''} · ${favoris.length} favori${favoris.length > 1 ? 's' : ''}`),
      favoris.length ? el('details', {},
        el('summary', {}, `Ses favoris (${favoris.length})`),
        el('div', { class: 'mini-affiches' }, favoris.slice(0, 24).map((n) => miniAffiche(n, TYPES[n.type].un)))) : null);
  }));
  afficherSuggestions(potes, mes);
}

// ---------- Bonus : ce que mes potes les plus compatibles ont adoré, par catégorie ----------
let dernieresSuggestions = null;
function afficherSuggestions(potes = dernieresSuggestions?.potes, mes = dernieresSuggestions?.mes) {
  dernieresSuggestions = { potes, mes };
  const parCategorie = notes.suggestions(potes, mes);
  const avecContenu = Object.keys(notes.CATEGORIES).filter((c) => parCategorie[c].length);
  $('suggestions').hidden = !avecContenu.length;
  if (!avecContenu.length) return;
  if (!avecContenu.includes(categorieSuggestions)) [categorieSuggestions] = avecContenu;
  $('categories-suggestions').replaceChildren(...avecContenu.map((c) => el('button',
    { type: 'button', 'data-categorie': c, class: c === categorieSuggestions ? 'actif' : null }, notes.CATEGORIES[c].nom)));
  remplir($('liste-suggestions'), parCategorie[categorieSuggestions].map(({ oeuvre, potes: qui }) => {
    const src = imageValide(oeuvre.type === 'jeu' ? imageReduite(oeuvre.image) : oeuvre.image);
    const detail = qui.map((q) => `${q.pote.avatar ?? ''} ${q.note !== null ? q.note : '❤️'}`).join(' · ');
    return el('a', { class: 'affiche', href: lienElement(oeuvre), style: { '--couleur': '#1a1a24' } },
      el('div', { class: `affiche-image ${oeuvre.type === 'jeu' ? 'paysage' : ''}` },
        src ? el('img', { src, alt: '', loading: 'lazy' }) : null,
        el('span', { class: 'affiche-etiquette' }, detail)),
      el('div', { class: 'affiche-titre' }, oeuvre.titre),
      el('div', { class: 'affiche-sous' }, TYPES[oeuvre.type].un));
  }));
}

$('categories-suggestions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-categorie]');
  if (!b) return;
  categorieSuggestions = b.dataset.categorie;
  afficherSuggestions();
});
// Une note changée sur un autre onglet ou appareil : la compatibilité suit
window.addEventListener('radar:notes', () => { if (derniersPotes) afficherGouts(); });

$('portee-potes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-portee]');
  if (!b) return;
  portee = b.dataset.portee;
  afficherPotes();
});

afficherCompte().catch((erreur) => afficherErreur($('carte-compte'), erreur));
