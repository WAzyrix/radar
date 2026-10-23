// =========================================================
// Page Potes : compte (email + mot de passe), groupe, recommandations, activité.
// =========================================================
import * as compte from '../lib/compte.js';
import { TYPES } from '../lib/ma-liste.js';
import { echapper, ilYa, afficherErreur } from '../lib/outils.js';
import { afficherNavigation } from '../ui/nav.js';
import { ICONES } from '../ui/icones.js';

afficherNavigation('potes');
document.documentElement.style.setProperty('--accent', '#6ec8ff');
const $ = (id) => document.getElementById(id);

const AVATARS = ['🎮', '⚔️', '🐉', '🦊', '🐺', '🌸', '🔥', '⚡', '🍜', '👾', '🎧', '🛸', '🌙', '🐱', '🦖', '🍀'];

// Lien vers un élément de liste (animé, jeu, film…)
function lien(item) {
  if (item.type === 'anime' || item.type === 'manga') return `anime.html?id=${item.id}`;
  if (item.type === 'jeu') return `jeu.html?id=${item.id}`;
  return `https://www.themoviedb.org/${item.type === 'film' ? 'movie' : 'tv'}/${item.id}`;
}
const pastillePote = (p) => `<span class="pote" title="${echapper(p.pseudo)}"><i>${echapper(p.avatar)}</i>${echapper(p.pseudo)}</span>`;

// =========================================================
// 1. Compte
// =========================================================
async function afficherCompte(message = '') {
  const carte = $('carte-compte');
  const info = message ? `<p class="message-notif">${message}</p>` : '';

  if (!compte.comptesActifs()) {
    carte.innerHTML = '<p>Les comptes ne sont pas encore configurés (js/config.js).</p>';
    return;
  }

  const utilisateur = await compte.utilisateur();
  if (!utilisateur) {
    afficherConnexion(info);
    return;
  }

  // Mot de passe oublié : le lien de l'email nous connecte, il reste à choisir le nouveau
  if (new URLSearchParams(location.search).has('reinitialiser')) {
    afficherNouveauMotDePasse(info);
    return;
  }
  await compte.verifierRattachement();

  const profil = await compte.monProfil();
  if (!profil) {
    afficherFormulaireProfil(info, { pseudo: '', avatar: AVATARS[0] }, true);
    return;
  }

  carte.innerHTML = `
    ${info}
    <div class="moi"><span class="avatar">${echapper(profil.avatar)}</span><div><b>${echapper(profil.pseudo)}</b><small>${echapper(utilisateur.email)}</small></div></div>
    <div class="actions" style="margin-top:16px">
      <button type="button" class="bouton bouton-verre bouton-petit" id="modifier-profil">Modifier mon profil</button>
      <button type="button" class="bouton bouton-verre bouton-petit" id="deconnexion">Se déconnecter</button>
    </div>
    <p class="mention">Ta liste et tes notifications sont liées à ton compte : connecte-toi sur un autre appareil pour les retrouver.</p>`;
  $('modifier-profil').addEventListener('click', () => afficherFormulaireProfil('', profil, false));
  $('deconnexion').addEventListener('click', async () => {
    await compte.deconnexion();
    location.reload();
  });
  await afficherReste();
}

function afficherConnexion(info, email = '') {
  const carte = $('carte-compte');
  carte.innerHTML = `
    ${info}
    <p>Connecte-toi pour retrouver ta liste partout, rejoindre tes potes et voir ce qu'ils suivent.</p>
    <form id="form-connexion" class="form-compte">
      <label class="etiquette" for="email">Email</label>
      <input class="champ" type="email" id="email" value="${echapper(email)}" placeholder="ton@email.fr" autocomplete="email" required>
      <label class="etiquette" for="mdp">Mot de passe</label>
      <input class="champ" type="password" id="mdp" placeholder="8 caractères minimum" autocomplete="current-password" minlength="8" required>
      <div class="actions">
        <button class="bouton bouton-plein bouton-petit" data-action="connexion">Se connecter</button>
        <button class="bouton bouton-verre bouton-petit" data-action="inscription">Créer un compte</button>
      </div>
      <button type="button" class="lien-discret" id="oubli">Mot de passe oublié ?</button>
    </form>`;

  $('form-connexion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = e.submitter?.dataset.action || 'connexion';
    const email = $('email').value;
    const motDePasse = $('mdp').value;
    e.submitter.disabled = true;
    try {
      if (action === 'inscription') {
        const connecte = await compte.inscription(email, motDePasse);
        if (connecte) afficherCompte('Compte créé ✅');
        else afficherConnexion('<p class="message-notif">Compte créé ✅ Clique sur le lien de confirmation reçu par email (pense aux spams), puis reviens te connecter ici.</p>', email);
      } else {
        await compte.connexion(email, motDePasse);
        afficherCompte('Connecté ✅');
      }
    } catch (erreur) {
      afficherConnexion(`<p class="message-notif">⚠️ ${echapper(erreur.message)}</p>`, email);
    }
  });

  $('oubli').addEventListener('click', async () => {
    const email = $('email').value.trim();
    if (!email) { afficherConnexion('<p class="message-notif">Entre d\'abord ton email, puis reclique sur « Mot de passe oublié ? ».</p>'); return; }
    try {
      await compte.motDePasseOublie(email);
      afficherConnexion('<p class="message-notif">Email envoyé : clique sur le lien pour choisir un nouveau mot de passe.</p>', email);
    } catch (erreur) {
      afficherConnexion(`<p class="message-notif">⚠️ ${echapper(erreur.message)}</p>`, email);
    }
  });
}

// Arrivée depuis le lien "mot de passe oublié" : on choisit le nouveau
function afficherNouveauMotDePasse(info = '') {
  $('carte-compte').innerHTML = `
    ${info}
    <p>Choisis ton nouveau mot de passe :</p>
    <form class="ligne-code" id="form-nouveau-mdp">
      <input class="champ" type="password" id="nouveau-mdp" autocomplete="new-password" minlength="8" placeholder="8 caractères minimum" required>
      <button class="bouton bouton-plein bouton-petit">Enregistrer</button>
    </form>`;
  $('form-nouveau-mdp').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await compte.changerMotDePasse($('nouveau-mdp').value);
      history.replaceState(null, '', location.pathname);
      afficherCompte('Mot de passe changé ✅');
    } catch (erreur) {
      afficherNouveauMotDePasse(`<p class="message-notif">⚠️ ${echapper(erreur.message)}</p>`);
    }
  });
}

function afficherFormulaireProfil(info, profil, premiereFois) {
  let avatar = profil.avatar;
  $('carte-compte').innerHTML = `
    ${info}
    <p>${premiereFois ? 'Bienvenue ! Choisis un pseudo et un avatar : c\'est ce que verront tes potes.' : 'Modifie ton profil :'}</p>
    <form id="form-profil">
      <label class="etiquette" for="pseudo" style="margin-top:14px">Pseudo</label>
      <input class="champ" id="pseudo" value="${echapper(profil.pseudo)}" minlength="2" maxlength="24" required autocomplete="nickname">
      <span class="etiquette" style="margin-top:14px">Avatar</span>
      <div class="avatars">${AVATARS.map((a) => `<button type="button" class="${a === avatar ? 'actif' : ''}" data-avatar="${a}">${a}</button>`).join('')}</div>
      <div class="actions" style="margin-top:16px"><button class="bouton bouton-plein bouton-petit">Enregistrer</button></div>
    </form>`;
  $('form-profil').querySelector('.avatars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-avatar]');
    if (!b) return;
    avatar = b.dataset.avatar;
    $('form-profil').querySelectorAll('[data-avatar]').forEach((x) => x.classList.toggle('actif', x === b));
  });
  $('form-profil').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await compte.enregistrerProfil({ pseudo: $('pseudo').value, avatar });
      afficherCompte(premiereFois ? 'Profil créé ✅ Rejoins ou crée ton groupe de potes ci-dessous.' : 'Profil mis à jour ✅');
    } catch (erreur) {
      afficherFormulaireProfil(`<p class="message-notif">⚠️ ${echapper(erreur.message)}</p>`, { pseudo: $('pseudo').value, avatar }, premiereFois);
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

async function afficherGroupe(message = '') {
  const carte = $('carte-groupe');
  const info = message ? `<p class="message-notif">${message}</p>` : '';
  const groupes = await compte.mesGroupes();
  const invitation = new URLSearchParams(location.search).get('invitation') || '';

  if (!groupes.length) {
    carte.innerHTML = `
      ${info}
      <p>Tu n'es dans aucun groupe. Rejoins celui de tes potes avec leur code d'invitation, ou crée le tien.</p>
      <h3 style="margin-top:18px">Rejoindre un groupe</h3>
      <form class="ligne-code" id="form-rejoindre">
        <input class="champ" id="invitation" value="${echapper(invitation)}" placeholder="Code d'invitation" required>
        <button class="bouton bouton-plein bouton-petit">Rejoindre</button>
      </form>
      <h3 style="margin-top:22px">Créer un groupe</h3>
      <form class="ligne-code" id="form-creer">
        <input class="champ" id="nom-groupe" placeholder="Nom du groupe (ex : Les otakus)" minlength="2" maxlength="40" required>
        <button class="bouton bouton-verre bouton-petit">Créer</button>
      </form>`;
    $('form-rejoindre').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await compte.rejoindreGroupe($('invitation').value);
        history.replaceState(null, '', location.pathname);
        afficherGroupe('Bienvenue dans le groupe 🎉');
      } catch (erreur) {
        afficherGroupe(`⚠️ ${echapper(erreur.message)}`);
      }
    });
    $('form-creer').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await compte.creerGroupe($('nom-groupe').value);
        afficherGroupe('Groupe créé ✅ Partage le lien d\'invitation à tes potes.');
      } catch (erreur) {
        afficherGroupe(`⚠️ ${echapper(erreur.message)}`);
      }
    });
    return;
  }

  const potes = await compte.mesPotes();
  const parId = new Map(potes.map((p) => [p.id, p]));
  carte.innerHTML = info + groupes.map((g) => {
    const lienInvitation = new URL(`potes.html?invitation=${g.invitation}`, location.href).href;
    const membres = g.membres.map((m) => parId.get(m.user_id)).filter(Boolean);
    return `
      <div class="groupe">
        <h3>${echapper(g.nom)} <small>${g.membres.length} membre${g.membres.length > 1 ? 's' : ''}</small></h3>
        <div class="potes">${membres.map(pastillePote).join('') || '<span class="mention" style="margin:0">Pour l\'instant, il n\'y a que toi : invite tes potes !</span>'}</div>
        <p class="mention">Code d'invitation : <code>${g.invitation}</code></p>
        <div class="actions" style="margin-top:10px">
          <button type="button" class="bouton bouton-plein bouton-petit" data-partager="${echapper(lienInvitation)}" data-nom="${echapper(g.nom)}">${ICONES.externe}Inviter des potes</button>
          <button type="button" class="bouton bouton-verre bouton-petit" data-quitter="${g.id}">Quitter</button>
        </div>
      </div>`;
  }).join('');

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

async function afficherRecommandations(parId) {
  const recos = await compte.recommandationsRecues();
  $('recommandations').hidden = false;
  $('liste-recos').innerHTML = recos.length
    ? `<div class="recos">${recos.map((r) => {
      const de = parId.get(r.de) || { pseudo: 'Un ancien pote', avatar: '👤' };
      return `
        <a class="reco ${r.vue ? '' : 'nouvelle'}" href="${lien(r.item)}">
          ${r.item.image ? `<img src="${echapper(r.item.image)}" alt="" loading="lazy">` : ''}
          <div>
            <small>${pastillePote(de)} · ${ilYa(r.cree_le)}</small>
            <strong>${echapper(r.item.titre)}</strong>
            ${r.message ? `<p>« ${echapper(r.message)} »</p>` : ''}
          </div>
        </a>`;
    }).join('')}</div>`
    : '<div class="vide"><strong>Aucune recommandation pour l\'instant</strong>Tes potes peuvent t\'en envoyer depuis la fiche d\'un animé ou d\'un jeu.</div>';
  // Elles sont maintenant vues
  compte.marquerVues(recos.filter((r) => !r.vue).map((r) => r.id)).catch(() => {});
}

function afficherPotes(potes) {
  if (!potes.length) return;

  // Populaire : ce que suivent le plus de potes
  const compteur = new Map();
  for (const p of potes) {
    for (const item of p.items) {
      const cle = `${item.type}:${item.id}`;
      if (!compteur.has(cle)) compteur.set(cle, { item, potes: [] });
      compteur.get(cle).potes.push(p);
    }
  }
  const populaires = [...compteur.values()].sort((a, b) => b.potes.length - a.potes.length).slice(0, 15);
  $('populaire').hidden = !populaires.length;
  $('liste-populaire').innerHTML = populaires.map(({ item, potes: qui }) => `
    <a class="affiche" href="${lien(item)}" style="--couleur:${item.couleur || '#1a1a24'}">
      <div class="affiche-image ${item.type === 'jeu' ? 'paysage' : ''}">${item.image ? `<img src="${echapper(item.image)}" alt="" loading="lazy">` : ''}
        <span class="affiche-etiquette">${qui.map((p) => echapper(p.avatar)).join('')} ${qui.length}</span></div>
      <div class="affiche-titre">${echapper(item.titre)}</div>
      <div class="affiche-sous">${TYPES[item.type]?.un || ''}</div>
    </a>`).join('');

  // Activité : les derniers ajouts de chacun
  const activite = potes
    .flatMap((p) => p.items.filter((i) => i.ajouteLe).map((item) => ({ p, item })))
    .sort((a, b) => b.item.ajouteLe.localeCompare(a.item.ajouteLe))
    .slice(0, 20);
  $('activite').hidden = !activite.length;
  $('liste-activite').innerHTML = activite.map(({ p, item }) => `
    <li><a href="${lien(item)}">${pastillePote(p)} <span>a ajouté</span> <b>${echapper(item.titre)}</b> <small>${TYPES[item.type]?.un || ''} · ${ilYa(item.ajouteLe)}</small></a></li>`).join('');
}

afficherCompte().catch((erreur) => afficherErreur($('carte-compte'), erreur));
