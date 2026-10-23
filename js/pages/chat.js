// =========================================================
// Chat de groupe : chat.html?groupe=<id>
// Messages en temps réel (Supabase Realtime), partage d'éléments de ma liste,
// suppression de ses propres messages.
//
// Sécurité : messages, pseudos et éléments partagés viennent de la base (ou du temps
// réel) : ils sont affichés avec el() (nœuds texte + setAttribute), jamais innerHTML.
// =========================================================
import * as compte from '../lib/compte.js';
import * as maListe from '../lib/ma-liste.js';
import { el, gabarit, formatHeure, formatDate, uuidValide, imageValide } from '../lib/outils.js';
import { afficherNavigation } from '../ui/nav.js';

afficherNavigation('chat');
document.documentElement.style.setProperty('--accent', '#6ec8ff');
const $ = (id) => document.getElementById(id);

let moi;
let groupe;
let profils = new Map();     // user_id -> { pseudo, avatar }
let fil = [];                // messages affichés
let arreterEcoute = () => {};

const vide = (html) => gabarit(`<div class="vide">${html}</div>`); // textes écrits en dur uniquement

// Texte du message : liens cliquables et retours à la ligne, sans jamais l'interpréter comme du HTML
function texteMessage(texte) {
  const p = el('p');
  String(texte).split('\n').forEach((ligne, i) => {
    if (i) p.append(el('br'));
    let fin = 0;
    for (const lienTrouve of ligne.matchAll(/https?:\/\/[^\s<>"]+/g)) {
      p.append(ligne.slice(fin, lienTrouve.index), el('a', { href: lienTrouve[0], target: '_blank', rel: 'noopener noreferrer' }, lienTrouve[0]));
      fin = lienTrouve.index + lienTrouve[0].length;
    }
    p.append(ligne.slice(fin));
  });
  return p;
}

// Élément partagé (animé, jeu…) : ignoré s'il est mal formé
function partage(item) {
  if (!maListe.itemValide(item)) return null;
  const image = imageValide(item.image);
  return el('a', { class: 'chat-partage', href: maListe.lienElement(item) },
    image ? el('img', { src: image, alt: '', loading: 'lazy' }) : null,
    el('div', {}, el('small', {}, maListe.TYPES[item.type].un), el('b', {}, String(item.titre ?? ''))));
}

function bulle(m, precedent) {
  const mien = m.user_id === moi.id;
  const auteur = profils.get(m.user_id) || { pseudo: 'Ancien membre', avatar: '👤' };
  const date = new Date(m.cree_le);
  const nouveauJour = !precedent || new Date(precedent.cree_le).toDateString() !== date.toDateString();
  // Messages consécutifs d'une même personne (moins de 5 min d'écart) : on n'affiche son nom qu'une fois
  const suite = !nouveauJour && precedent?.user_id === m.user_id && date - new Date(precedent.cree_le) < 5 * 60_000;
  const avecAuteur = !mien && !suite;

  return [
    nouveauJour ? el('div', { class: 'chat-jour' }, date.toDateString() === new Date().toDateString() ? "Aujourd'hui" : formatDate.format(date)) : null,
    el('div', { class: `message ${mien ? 'mien' : ''} ${suite ? 'suite' : ''}`, 'data-id': m.id },
      avecAuteur ? el('span', { class: 'message-avatar' }, auteur.avatar) : el('span', { class: 'message-avatar vide' }),
      el('div', { class: 'message-corps' },
        avecAuteur ? el('small', { class: 'message-auteur' }, auteur.pseudo) : null,
        el('div', { class: 'message-bulle' }, partage(m.item), m.contenu ? texteMessage(m.contenu) : null),
        el('small', { class: 'message-heure' }, formatHeure.format(date),
          mien ? [' · ', el('button', { type: 'button', 'data-supprimer': m.id }, 'Supprimer')] : null))),
  ];
}

function afficherFil({ defiler = true } = {}) {
  const zone = $('fil');
  const enBas = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 120;
  zone.replaceChildren(...(fil.length
    ? fil.flatMap((m, i) => bulle(m, fil[i - 1])).filter(Boolean)
    : [vide('Pas encore de message. Lance la discussion, ou partage un animé avec le bouton « + » !')]));
  // On descend en bas pour un nouveau message (sauf si on est en train de relire plus haut)
  if (defiler || enBas) zone.scrollTop = zone.scrollHeight;
}

// ---------- Envoi ----------
async function envoyer({ item } = {}) {
  const contenu = $('texte').value.trim();
  if (!contenu && !item) return;
  $('envoyer').disabled = true;
  try {
    const message = await compte.envoyerMessage(groupe.id, { contenu, item });
    if (!fil.some((m) => m.id === message.id)) fil.push(message);
    $('texte').value = '';
    ajusterHauteur();
    afficherFil();
  } catch (erreur) {
    alert(erreur.message);
  }
  $('envoyer').disabled = false;
  $('texte').focus();
}

// La zone de texte grandit avec le message (jusqu'à 5 lignes)
function ajusterHauteur() {
  const t = $('texte');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 130)}px`;
}

// ---------- Partager un élément de ma liste ----------
function ouvrirPartage() {
  const elements = maListe.items().filter(maListe.itemValide).reverse();
  const dialogue = el('dialog', { class: 'dialogue' }, gabarit(`
    <h3>Partager dans le chat</h3>
    <input class="champ" id="filtre-partage" placeholder="Chercher dans ma liste…" autocomplete="off">
    <div class="liste-partage" id="liste-partage"></div>
    <p class="mention">Ton message en cours sera envoyé avec. Pour un titre absent de ta liste, utilise « Recommander » sur sa fiche.</p>
    <div class="actions" style="margin-top:12px"><button type="button" class="bouton bouton-verre bouton-petit" data-fermer>Annuler</button></div>`));
  document.body.append(dialogue);
  dialogue.addEventListener('close', () => dialogue.remove());
  dialogue.querySelector('[data-fermer]').addEventListener('click', () => dialogue.close());

  const remplir = (filtre = '') => {
    const choix = elements.filter((i) => String(i.titre ?? '').toLowerCase().includes(filtre.toLowerCase())).slice(0, 40);
    dialogue.querySelector('#liste-partage').replaceChildren(...(choix.length
      ? choix.map((i) => {
        const image = imageValide(i.image);
        return el('button', { type: 'button', 'data-cle': `${i.type}:${i.id}` },
          image ? el('img', { src: image, alt: '' }) : el('span'),
          el('span', {}, el('b', {}, String(i.titre ?? '')), el('small', {}, maListe.TYPES[i.type].un)));
      })
      : [el('p', { class: 'mention' }, 'Rien dans ta liste ne correspond.')]));
  };
  dialogue.querySelector('#filtre-partage').addEventListener('input', (e) => remplir(e.target.value));
  dialogue.querySelector('#liste-partage').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-cle]');
    if (!bouton) return;
    const i = elements.find((x) => `${x.type}:${x.id}` === bouton.dataset.cle);
    dialogue.close();
    envoyer({ item: { type: i.type, id: i.id, titre: i.titre, image: i.image } });
  });
  remplir();
  dialogue.showModal();
}

// ---------- Ouverture d'un groupe ----------
async function ouvrirGroupe(g) {
  groupe = g;
  history.replaceState(null, '', `?groupe=${g.id}`);
  $('nom-groupe').textContent = g.nom;
  document.title = `${g.nom} · Chat · Radar`;
  $('membres').replaceChildren(...g.membres.map((m) => profils.get(m.user_id)).filter(Boolean)
    .map((p) => el('span', { class: 'pote' }, el('i', {}, p.avatar), p.pseudo)));
  $('choix-groupe').querySelectorAll('button').forEach((b) => b.classList.toggle('actif', b.dataset.groupe === g.id));

  $('fil').replaceChildren(el('div', { class: 'squelette', style: { height: '200px' } }));
  arreterEcoute();
  fil = await compte.messages(g.id);
  afficherFil();
  $('saisie').hidden = false;

  // Temps réel : messages des autres (les miens sont déjà ajoutés à l'envoi)
  arreterEcoute = compte.ecouterMessages(g.id, {
    ajout: (m) => {
      if (fil.some((x) => x.id === m.id)) return;
      fil.push(m);
      afficherFil({ defiler: false });
    },
    suppression: (id) => {
      fil = fil.filter((m) => m.id !== id);
      afficherFil({ defiler: false });
    },
  });
}

async function demarrer() {
  if (!compte.comptesActifs() || !(moi = await compte.utilisateur())) {
    $('fil').replaceChildren(vide('<strong>Connecte-toi pour discuter</strong><a class="bouton bouton-plein bouton-petit" href="potes.html" style="margin-top:12px">Aller dans Potes</a>'));
    return;
  }
  const [tousGroupes, monProfil, potes] = await Promise.all([compte.mesGroupes(), compte.monProfil(), compte.mesPotes()]);
  const groupes = tousGroupes.filter((g) => uuidValide(g.id));
  profils = new Map([...potes.map((p) => [p.id, p]), [moi.id, monProfil || { pseudo: 'Moi', avatar: '🙂' }]]);
  if (!groupes.length) {
    $('fil').replaceChildren(vide('<strong>Tu n\'es dans aucun groupe</strong>Crée ou rejoins un groupe de potes pour discuter.<br><a class="bouton bouton-plein bouton-petit" href="potes.html" style="margin-top:12px">Aller dans Potes</a>'));
    return;
  }
  if (groupes.length > 1) {
    $('choix-groupe').hidden = false;
    $('choix-groupe').replaceChildren(...groupes.map((g) => el('button', { type: 'button', 'data-groupe': g.id }, g.nom)));
    $('choix-groupe').addEventListener('click', (e) => {
      const b = e.target.closest('[data-groupe]');
      if (b) ouvrirGroupe(groupes.find((g) => g.id === b.dataset.groupe));
    });
  }
  const voulu = new URLSearchParams(location.search).get('groupe');
  await ouvrirGroupe(groupes.find((g) => g.id === voulu) || groupes[0]);
}

// ---------- Événements ----------
$('saisie').addEventListener('submit', (e) => { e.preventDefault(); envoyer(); });
$('texte').addEventListener('input', ajusterHauteur);
$('texte').addEventListener('keydown', (e) => {
  // Entrée = envoyer, Maj+Entrée = nouvelle ligne (sur ordinateur)
  if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(hover: none)').matches) { e.preventDefault(); envoyer(); }
});
$('partager').addEventListener('click', ouvrirPartage);
$('fil').addEventListener('click', async (e) => {
  const bouton = e.target.closest('[data-supprimer]');
  if (!bouton || !confirm('Supprimer ce message ?')) return;
  const id = Number(bouton.dataset.supprimer);
  await compte.supprimerMessage(id).catch((erreur) => alert(erreur.message));
  fil = fil.filter((m) => m.id !== id);
  afficherFil({ defiler: false });
});

demarrer().catch((erreur) => { $('fil').replaceChildren(el('div', { class: 'erreur' }, `Oups : ${erreur.message}`)); });
