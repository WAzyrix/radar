// =========================================================
// Sur les fiches : bouton "Recommander à un pote" + "2 potes suivent".
// Le module compte.js (et la bibliothèque Supabase) n'est chargé que si les
// comptes sont configurés : les pages restent légères sinon.
// =========================================================
import { SUPABASE_URL, URL_RELAIS } from '../config.js';
import { el, gabarit, uuidValide, appeler, imageValide } from '../lib/outils.js';
import { ICONES } from './icones.js';

const comptesConfigures = () => !SUPABASE_URL.includes('A-REMPLACER');
const chargerCompte = () => import('../lib/compte.js');

export const boutonRecommander = () => (comptesConfigures()
  ? `<button type="button" class="bouton bouton-verre bouton-petit" id="recommander">${ICONES.externe}Recommander</button>`
  : '');

/**
 * Branche le bouton "Recommander" et affiche les potes qui suivent l'élément.
 * @param {object} item  { type, id, titre, image }
 * @param {HTMLElement} zonePotes  où afficher "2 potes suivent"
 */
export async function brancherRecommandation(item, zonePotes) {
  if (!comptesConfigures()) return;
  const compte = await chargerCompte();
  document.getElementById('recommander')?.addEventListener('click', () => ouvrir(compte, item));

  const potes = await compte.potesQuiSuivent(item.type, item.id).catch(() => []);
  if (potes.length && zonePotes) {
    // Pseudos et avatars viennent de la base : nœuds texte uniquement
    zonePotes.replaceChildren(el('span', { class: 'potes-suivent' },
      potes.map((p) => el('i', { title: p.pseudo }, p.avatar)),
      ' ', potes.length === 1 ? `${potes[0].pseudo} suit aussi` : `${potes.length} potes suivent aussi`));
  }
}

async function ouvrir(compte, item) {
  const dialogue = el('dialog', { class: 'dialogue' }, el('div', { class: 'squelette', style: { height: '160px' } }));
  document.body.append(dialogue);
  dialogue.addEventListener('close', () => dialogue.remove());
  dialogue.showModal();

  const connecte = await compte.utilisateur();
  const [potes, groupes, amis] = connecte
    ? await Promise.all([compte.mesPotes().catch(() => []), compte.mesGroupes().catch(() => []), compte.mesAmis().catch(() => [])])
    : [null, [], []];
  const titre = el('h3', {}, `Recommander ${item.titre}`);
  if (!potes?.length) {
    dialogue.replaceChildren(titre,
      el('p', {}, potes ? "Tu n'as encore personne à qui recommander : rejoins un groupe ou ajoute des amis." : 'Connecte-toi pour recommander à tes potes.'),
      gabarit(`<div class="actions"><a class="bouton bouton-plein bouton-petit" href="potes.html">Aller dans Potes</a>
        <button type="button" class="bouton bouton-verre bouton-petit" data-fermer>Fermer</button></div>`));
    dialogue.querySelector('[data-fermer]').addEventListener('click', () => dialogue.close());
    return;
  }

  const choisis = new Set();
  const groupesChoisis = new Set();
  const dejaEnvoye = new Set(); // potes déjà servis (si on réessaie après une erreur)
  const mesGroupes = groupes.filter((g) => uuidValide(g.id));
  const potesValides = potes.filter((p) => uuidValide(p.id));

  // Plusieurs groupes (ou des amis) : on choisit d'abord à qui (le groupe actif par défaut), puis les potes
  const idsAmis = new Set(amis.filter((a) => a.statut === 'ami').map((a) => a.id));
  const portees = [
    ...mesGroupes.map((g) => ({ id: g.id, nom: g.nom, membres: new Set(g.membres.map((m) => m.user_id)), chat: g })),
    ...(idsAmis.size ? [{ id: 'amis', nom: 'Mes amis', membres: idsAmis }] : []),
    { id: 'tous', nom: 'Tout le monde', membres: null },
  ];
  let portee = portees.find((x) => x.id === compte.trouverGroupeActif(mesGroupes)?.id) || portees[0];
  const choixPortee = portees.length > 2
    ? el('nav', { class: 'segments', 'aria-label': 'Groupe', style: { margin: '4px 0 10px' } },
      portees.map((x) => el('button', { type: 'button', 'data-portee': x.id }, x.nom)))
    : null;
  const puces = el('div', { class: 'puces' });
  const afficherPuces = () => {
    choixPortee?.querySelectorAll('[data-portee]').forEach((b) => b.classList.toggle('actif', b.dataset.portee === portee.id));
    const visibles = potesValides.filter((p) => !portee.membres || portee.membres.has(p.id));
    const chats = portee.chat ? [portee.chat] : portee.id === 'tous' ? mesGroupes : [];
    puces.replaceChildren(
      ...visibles.map((p) => el('button', { type: 'button', class: `puce ${choisis.has(p.id) ? 'actif' : ''}`, 'data-pote': p.id }, `${p.avatar} ${p.pseudo}`)),
      ...chats.map((g) => el('button', { type: 'button', class: `puce ${groupesChoisis.has(g.id) ? 'actif' : ''}`, 'data-groupe': g.id }, `💬 Chat « ${g.nom} »`)),
      ...(visibles.length ? [] : [el('span', { class: 'mention', style: { margin: '0' } }, portee.id === 'amis' ? 'Aucun ami pour l\'instant.' : 'Personne d\'autre dans ce groupe pour l\'instant.')]));
  };
  choixPortee?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-portee]');
    if (!b) return;
    portee = portees.find((x) => x.id === b.dataset.portee);
    afficherPuces();
  });
  afficherPuces();

  dialogue.replaceChildren(el('form', { method: 'dialog', id: 'form-reco' },
    titre,
    el('span', { class: 'etiquette' }, 'À qui ?'),
    choixPortee,
    puces,
    gabarit(`
      <label class="etiquette" for="message-reco" style="margin-top:14px">Un mot ? (facultatif)</label>
      <textarea class="champ" id="message-reco" maxlength="280" rows="3" placeholder="Regarde ça, tu vas adorer !"></textarea>
      <p class="message-notif" id="retour-reco" hidden></p>
      <div class="actions" style="margin-top:14px">
        <button type="button" class="bouton bouton-plein bouton-petit" id="envoyer-reco">Envoyer</button>
        <button type="button" class="bouton bouton-verre bouton-petit" data-fermer>Annuler</button>
      </div>`)));

  dialogue.querySelector('.puces').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pote], [data-groupe]');
    if (!b) return;
    const [ensemble, valeur] = b.dataset.pote ? [choisis, b.dataset.pote] : [groupesChoisis, b.dataset.groupe];
    if (ensemble.has(valeur)) ensemble.delete(valeur); else ensemble.add(valeur);
    b.classList.toggle('actif', ensemble.has(valeur));
  });
  dialogue.querySelector('[data-fermer]').addEventListener('click', () => dialogue.close());
  const boutonEnvoyer = dialogue.querySelector('#envoyer-reco');
  boutonEnvoyer.addEventListener('click', async () => {
    const retour = dialogue.querySelector('#retour-reco');
    if (!choisis.size && !groupesChoisis.size) { retour.hidden = false; retour.textContent = 'Choisis au moins un pote ou un chat.'; return; }
    boutonEnvoyer.disabled = true;
    try {
      const jeton = await compte.jeton();
      const message = dialogue.querySelector('#message-reco').value.trim();
      const element = { type: item.type, id: item.id, titre: item.titre, image: imageValide(item.image) || undefined };
      // Le relais vérifie qui je suis, enregistre la reco et notifie le pote
      for (const a of choisis) {
        if (dejaEnvoye.has(a)) continue;
        const reponse = await appeler(`${URL_RELAIS}/recommander`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
          body: JSON.stringify({ a, item: element, message }),
        }, { service: 'le relais', delai: 20_000 });
        if (!reponse.ok) throw new Error((await reponse.json().catch(() => ({}))).erreur || 'Envoi impossible');
        dejaEnvoye.add(a);
      }
      // Partage dans le chat des groupes choisis
      for (const groupeId of groupesChoisis) {
        if (dejaEnvoye.has(groupeId)) continue;
        await compte.envoyerMessage(groupeId, { contenu: message, item: element });
        dejaEnvoye.add(groupeId);
      }
      retour.hidden = false;
      retour.textContent = 'Recommandation envoyée ✅';
      setTimeout(() => dialogue.close(), 1200);
    } catch (erreur) {
      retour.hidden = false;
      retour.textContent = `⚠️ ${erreur.message}`;
      boutonEnvoyer.disabled = false;
    }
  });
}
