// =========================================================
// Sur chaque fiche (animé, manga, film, série, jeu) :
//  - le bouton ❤️ Favori ;
//  - la carte « Ma note » : note sur 100 + petit avis, modifiable ou supprimable ;
//  - « Tes potes l'ont noté » : les notes de mes amis et des membres de mes groupes.
//
// Les avis (les miens comme ceux des potes) sont affichés avec el() : nœuds texte,
// jamais innerHTML. Seuls les morceaux écrits en dur passent par gabarit().
// =========================================================
import * as notes from '../lib/notes.js';
import { el, gabarit, ilYa, uuidValide } from '../lib/outils.js';
import { SUPABASE_URL } from '../config.js';
import { ICONES } from './icones.js';

const comptesActifs = () => !SUPABASE_URL.includes('A-REMPLACER');
const icone = (nom) => gabarit(ICONES[nom]);

// ---------- Favori ----------
const contenuFavori = (actif) => `${ICONES.coeur}${actif ? 'Favori' : 'Ajouter aux favoris'}`;

/** Bouton à mettre dans la rangée d'actions de la fiche (HTML écrit en dur). */
export function boutonFavori(oeuvre, { petit = false } = {}) {
  const actif = Boolean(notes.noteDe(oeuvre.type, oeuvre.id)?.favori);
  return `<button type="button" class="bouton bouton-verre ${petit ? 'bouton-petit' : ''} bouton-favori ${actif ? 'actif' : ''}" id="favori" aria-pressed="${actif}">${contenuFavori(actif)}</button>`;
}

export function brancherFavori(bouton, oeuvre) {
  if (!bouton) return;
  const afficher = () => {
    const actif = Boolean(notes.noteDe(oeuvre.type, oeuvre.id)?.favori);
    bouton.classList.toggle('actif', actif);
    bouton.setAttribute('aria-pressed', String(actif));
    bouton.innerHTML = contenuFavori(actif);
  };
  bouton.addEventListener('click', () => { notes.basculerFavori(oeuvre); afficher(); });
  // Changé ailleurs (carte « Ma note », autre appareil) : on suit
  window.addEventListener('radar:notes', () => { if (bouton.isConnected) afficher(); });
}

// ---------- Ma note ----------
const affichageNote = (note) => `${note}/100`;

function vueNote(n, { modifier, supprimer }) {
  const boutonModifier = el('button', { type: 'button', class: 'bouton bouton-verre bouton-petit' }, icone('plus'), 'Modifier');
  const boutonSupprimer = el('button', { type: 'button', class: 'lien-discret' }, 'Supprimer ma note');
  boutonModifier.addEventListener('click', modifier);
  boutonSupprimer.addEventListener('click', supprimer);
  return el('div', { class: 'ma-note-resume' },
    el('div', { class: 'note-anneau', style: { '--p': String(n.note) }, title: 'Ma note' }, el('span', {}, String(n.note))),
    el('div', {},
      el('p', { class: 'ma-note-valeur' }, el('b', {}, affichageNote(n.note)), n.noteLe ? el('small', {}, ` · notée ${ilYa(n.noteLe)}`) : null),
      n.avis ? el('p', { class: 'ma-note-avis' }, `« ${n.avis} »`) : el('p', { class: 'mention', style: { margin: '4px 0 0' } }, 'Pas d\'avis écrit.'),
      el('div', { class: 'actions', style: { 'margin-top': '12px' } }, boutonModifier, boutonSupprimer)));
}

function formulaireNote(n, { enregistrer, annuler }) {
  const depart = n?.note ?? 70;
  const curseur = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(depart), class: 'curseur-note', 'aria-label': 'Ma note sur 100' });
  const nombre = el('input', { type: 'number', min: '0', max: '100', step: '1', value: String(depart), class: 'champ champ-note', inputmode: 'numeric', 'aria-label': 'Ma note sur 100 (nombre)' });
  const avis = el('textarea', { class: 'champ', rows: '3', maxlength: String(notes.AVIS_MAX), placeholder: 'Ton avis en quelques mots (facultatif)', 'aria-label': 'Mon avis' });
  avis.value = n?.avis || '';
  const compteur = el('small', { class: 'compteur-avis' });
  const majCompteur = () => { compteur.textContent = `${avis.value.length}/${notes.AVIS_MAX}`; };
  majCompteur();
  curseur.addEventListener('input', () => { nombre.value = curseur.value; });
  nombre.addEventListener('input', () => {
    const v = Math.round(Number(nombre.value));
    if (Number.isFinite(v)) curseur.value = String(Math.min(100, Math.max(0, v)));
  });
  avis.addEventListener('input', majCompteur);

  const formulaire = el('form', { class: 'ma-note-formulaire' },
    el('label', { class: 'ligne-note' }, el('span', {}, 'Ma note'), curseur, nombre, el('span', { class: 'mention', style: { margin: '0' } }, '/100')),
    avis,
    compteur,
    el('div', { class: 'actions' },
      el('button', { type: 'submit', class: 'bouton bouton-plein bouton-petit' }, icone('check'), n ? 'Enregistrer' : 'Noter'),
      n ? el('button', { type: 'button', class: 'lien-discret', 'data-annuler': '' }, 'Annuler') : null));
  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    const note = Math.round(Number(nombre.value));
    if (!Number.isInteger(note) || note < 0 || note > 100) { nombre.focus(); return; }
    enregistrer({ note, avis: avis.value });
  });
  formulaire.querySelector('[data-annuler]')?.addEventListener('click', annuler);
  return formulaire;
}

/**
 * Remplit `conteneur` (une .carte) : ma note + celles de mes potes.
 * `oeuvre` = { type, id, titre, image }.
 */
export function monterCarteNote(conteneur, oeuvre) {
  if (!conteneur) return;
  const zoneMoi = el('div', { class: 'ma-note' });
  const zonePotes = el('div', { class: 'notes-potes' });
  conteneur.replaceChildren(el('h2', {}, 'Ma note'), zoneMoi, zonePotes);
  let edition = false;

  const afficher = () => {
    if (!zoneMoi.isConnected) { window.removeEventListener('radar:notes', afficher); return; } // fiche remplacée
    const n = notes.noteDe(oeuvre.type, oeuvre.id);
    const aUneNote = Number.isInteger(n?.note);
    if (aUneNote && !edition) {
      zoneMoi.replaceChildren(vueNote(n, {
        modifier: () => { edition = true; afficher(); },
        supprimer: () => {
          if (!confirm('Supprimer ta note et ton avis ?')) return;
          notes.modifier(oeuvre, { note: null, avis: null });
        },
      }));
    } else {
      zoneMoi.replaceChildren(
        aUneNote ? null : el('p', { class: 'mention', style: { 'margin-top': '0' } }, 'Donne ta note sur 100, avec un petit avis si tu veux. Tes amis et tes groupes la verront.'),
        formulaireNote(aUneNote ? n : null, {
          enregistrer: (valeurs) => { edition = false; notes.modifier(oeuvre, valeurs); },
          annuler: () => { edition = false; afficher(); },
        }));
    }
  };
  afficher();
  window.addEventListener('radar:notes', afficher);
  afficherNotesPotes(zonePotes, oeuvre);
}

// ---------- Tes potes l'ont noté ----------
async function afficherNotesPotes(zone, oeuvre) {
  if (!comptesActifs()) return;
  try {
    const compte = await import('../lib/compte.js');
    if (!(await compte.utilisateur())) {
      zone.replaceChildren(el('p', { class: 'mention' }, el('a', { class: 'lien-discret', href: 'potes.html' }, 'Connecte-toi'), ' pour voir les notes de tes amis et de tes groupes.'));
      return;
    }
    const [lignes, profils] = await Promise.all([compte.notesSurOeuvre(oeuvre.type, oeuvre.id), compte.profilsPotes()]);
    const parId = new Map(profils.filter((p) => uuidValide(p.id)).map((p) => [p.id, p]));
    const avis = notes.notesValides(lignes).filter((n) => parId.has(n.auteur));
    if (!avis.length) return;
    const notees = avis.filter((n) => n.note !== null).sort((a, b) => b.note - a.note);
    const favoris = avis.filter((n) => n.note === null && n.favori);
    const moyenne = notees.length ? Math.round(notees.reduce((s, n) => s + n.note, 0) / notees.length) : null;
    const pote = (n) => { const p = parId.get(n.auteur); return el('span', { class: 'pote' }, el('i', {}, String(p.avatar ?? '')), String(p.pseudo ?? '')); };
    zone.replaceChildren(
      el('h3', {}, notees.length ? 'Tes potes l\'ont noté' : 'Tes potes l\'adorent',
        moyenne !== null ? el('small', {}, ` · moyenne ${moyenne}/100`) : null),
      el('ul', { class: 'liste-notes-potes' },
        notees.map((n) => el('li', {},
          pote(n),
          el('b', { class: 'pastille accent' }, affichageNote(n.note)),
          n.favori ? el('span', { title: 'Dans ses favoris' }, '❤️') : null,
          n.avis ? el('p', {}, `« ${n.avis} »`) : null)),
        favoris.map((n) => el('li', {}, pote(n), el('span', {}, '❤️ dans ses favoris')))));
  } catch {
    // notes.sql pas encore exécuté, ou base injoignable : la fiche reste utilisable
  }
}
