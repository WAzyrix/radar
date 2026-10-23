// =========================================================
// Page Potes : compte (email + mot de passe), groupe, recommandations, activité.
//
// Sécurité : tout ce qui vient de la base (pseudos, noms de groupe, listes des potes,
// recommandations…) est affiché avec el() (nœuds texte + setAttribute), jamais
// avec innerHTML. Seuls les morceaux de HTML écrits en dur passent par gabarit().
// =========================================================
import * as compte from '../lib/compte.js';
import { TYPES, lienElement } from '../lib/ma-liste.js';
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
      <p class="mention">Ta liste et tes notifications sont liées à ton compte : connecte-toi sur un autre appareil pour les retrouver.</p>`));
  $('modifier-profil').addEventListener('click', () => afficherFormulaireProfil('', profil, false));
  $('deconnexion').addEventListener('click', async () => {
    await compte.deconnexion();
    location.reload();
  });
  await afficherReste();
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
// 2. Groupe, recommandations, populaire, activité (une fois connecté avec un profil)
// =========================================================
async function afficherReste() {
  $('groupe').hidden = false;
  await afficherGroupe();
}

async function afficherGroupe(texte = '') {
  const carte = $('carte-groupe');
  const groupes = (await compte.mesGroupes()).filter((g) => uuidValide(g.id));

  if (!groupes.length) {
    remplir(carte,
      message(texte),
      gabarit(`
        <p>Tu n'es dans aucun groupe. Rejoins celui de tes potes avec leur code d'invitation, ou crée le tien.</p>
        <h3 style="margin-top:18px">Rejoindre un groupe</h3>
        <form class="ligne-code" id="form-rejoindre">
          <input class="champ" id="invitation" placeholder="Code d'invitation" required>
          <button class="bouton bouton-plein bouton-petit">Rejoindre</button>
        </form>
        <h3 style="margin-top:22px">Créer un groupe</h3>
        <form class="ligne-code" id="form-creer">
          <input class="champ" id="nom-groupe" placeholder="Nom du groupe (ex : Les otakus)" minlength="2" maxlength="40" required>
          <button class="bouton bouton-verre bouton-petit">Créer</button>
        </form>`));
    $('invitation').value = new URLSearchParams(location.search).get('invitation') || '';
    $('form-rejoindre').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await compte.rejoindreGroupe($('invitation').value);
        history.replaceState(null, '', location.pathname);
        afficherGroupe('Bienvenue dans le groupe 🎉');
      } catch (erreur) {
        afficherGroupe(`⚠️ ${erreur.message}`);
      }
    });
    $('form-creer').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await compte.creerGroupe($('nom-groupe').value);
        afficherGroupe('Groupe créé ✅ Partage le lien d\'invitation à tes potes.');
      } catch (erreur) {
        afficherGroupe(`⚠️ ${erreur.message}`);
      }
    });
    return;
  }

  const potes = await compte.mesPotes();
  const parId = new Map(potes.map((p) => [p.id, p]));
  remplir(carte, message(texte), groupes.map((g) => {
    const lienInvitation = new URL('potes.html', location.href);
    lienInvitation.searchParams.set('invitation', g.invitation);
    const membres = g.membres.map((m) => parId.get(m.user_id)).filter(Boolean);
    const nb = g.membres.length;
    return el('div', { class: 'groupe' },
      el('h3', {}, g.nom, ' ', el('small', {}, `${nb} membre${nb > 1 ? 's' : ''}`)),
      el('div', { class: 'potes' }, membres.length
        ? membres.map(pastillePote)
        : el('span', { class: 'mention', style: { margin: '0' } }, 'Pour l\'instant, il n\'y a que toi : invite tes potes !')),
      el('p', { class: 'mention' }, 'Code d\'invitation : ', el('code', {}, g.invitation)),
      el('div', { class: 'actions', style: { 'margin-top': '10px' } },
        el('a', { class: 'bouton bouton-plein bouton-petit', href: `chat.html?groupe=${g.id}` }, icone('bulle'), 'Ouvrir le chat'),
        el('button', { type: 'button', class: 'bouton bouton-verre bouton-petit', 'data-partager': lienInvitation.href, 'data-nom': g.nom }, icone('externe'), 'Inviter des potes'),
        el('button', { type: 'button', class: 'bouton bouton-verre bouton-petit', 'data-quitter': g.id }, 'Quitter')));
  }));

  // onclick (et pas addEventListener) : un seul gestionnaire, même après un réaffichage
  carte.onclick = async (e) => {
    const partager = e.target.closest('[data-partager]');
    const quitter = e.target.closest('[data-quitter]');
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
    if (quitter && confirm('Quitter ce groupe ?')) {
      await compte.quitterGroupe(quitter.dataset.quitter);
      afficherGroupe('Tu as quitté le groupe.');
    }
  };

  await Promise.all([afficherRecommandations(parId), afficherPotes(potes)]);
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
      return el('a', { class: `reco ${r.vue ? '' : 'nouvelle'}`, href: lienElement(item) },
        image(item),
        el('div', {},
          el('small', {}, pastillePote(de), ` · ${ilYa(r.cree_le)}`),
          el('strong', {}, String(item.titre ?? '')),
          r.message ? el('p', {}, `« ${r.message} »`) : null));
    }))
    : gabarit('<div class="vide"><strong>Aucune recommandation pour l\'instant</strong>Tes potes peuvent t\'en envoyer depuis la fiche d\'un animé ou d\'un jeu.</div>'));
  // Elles sont maintenant vues
  compte.marquerVues(recos.filter((r) => !r.vue).map((r) => r.id)).catch(() => {});
}

function afficherPotes(potes) {
  if (!potes.length) return;

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
  $('populaire').hidden = !populaires.length;
  remplir($('liste-populaire'), populaires.map(({ item, potes: qui }) => el('a',
    { class: 'affiche', href: lienElement(item), style: { '--couleur': couleurValide(item.couleur) || '#1a1a24' } },
    el('div', { class: `affiche-image ${item.type === 'jeu' ? 'paysage' : ''}` },
      image(item),
      el('span', { class: 'affiche-etiquette' }, `${qui.map((p) => p.avatar).join('')} ${qui.length}`)),
    el('div', { class: 'affiche-titre' }, String(item.titre ?? '')),
    el('div', { class: 'affiche-sous' }, TYPES[item.type].un))));

  // Activité : les derniers ajouts de chacun
  const activite = potes
    .flatMap((p) => p.items.filter((i) => typeof i.ajouteLe === 'string' && i.ajouteLe).map((item) => ({ p, item })))
    .sort((a, b) => b.item.ajouteLe.localeCompare(a.item.ajouteLe))
    .slice(0, 20);
  $('activite').hidden = !activite.length;
  remplir($('liste-activite'), activite.map(({ p, item }) => el('li', {},
    el('a', { href: lienElement(item) },
      pastillePote(p), ' ', el('span', {}, 'a ajouté'), ' ', el('b', {}, String(item.titre ?? '')), ' ',
      el('small', {}, `${TYPES[item.type].un} · ${ilYa(item.ajouteLe)}`)))));
}

afficherCompte().catch((erreur) => afficherErreur($('carte-compte'), erreur));
