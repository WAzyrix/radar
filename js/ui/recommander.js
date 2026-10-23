// =========================================================
// Sur les fiches : bouton "Recommander à un pote" + "2 potes suivent".
// Le module compte.js (et la bibliothèque Supabase) n'est chargé que si les
// comptes sont configurés : les pages restent légères sinon.
// =========================================================
import { SUPABASE_URL, URL_RELAIS } from '../config.js';
import { echapper } from '../lib/outils.js';
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
    zonePotes.innerHTML = `<span class="potes-suivent">${potes.map((p) => `<i title="${echapper(p.pseudo)}">${echapper(p.avatar)}</i>`).join('')}
      ${potes.length === 1 ? `${echapper(potes[0].pseudo)} suit aussi` : `${potes.length} potes suivent aussi`}</span>`;
  }
}

async function ouvrir(compte, item) {
  const dialogue = document.createElement('dialog');
  dialogue.className = 'dialogue';
  document.body.append(dialogue);
  dialogue.addEventListener('close', () => dialogue.remove());
  dialogue.innerHTML = '<div class="squelette" style="height:160px"></div>';
  dialogue.showModal();

  const potes = (await compte.utilisateur()) ? await compte.mesPotes().catch(() => []) : null;
  if (!potes?.length) {
    dialogue.innerHTML = `
      <h3>Recommander ${echapper(item.titre)}</h3>
      <p>${potes ? "Tu n'as pas encore de potes dans ton groupe." : 'Connecte-toi pour recommander à tes potes.'}</p>
      <div class="actions"><a class="bouton bouton-plein bouton-petit" href="potes.html">Aller dans Potes</a>
      <button type="button" class="bouton bouton-verre bouton-petit" data-fermer>Fermer</button></div>`;
    dialogue.querySelector('[data-fermer]').addEventListener('click', () => dialogue.close());
    return;
  }

  const choisis = new Set();
  dialogue.innerHTML = `
    <form method="dialog" id="form-reco">
      <h3>Recommander ${echapper(item.titre)}</h3>
      <span class="etiquette">À qui ?</span>
      <div class="puces">${potes.map((p) => `<button type="button" class="puce" data-pote="${p.id}">${echapper(p.avatar)} ${echapper(p.pseudo)}</button>`).join('')}</div>
      <label class="etiquette" for="message-reco" style="margin-top:14px">Un mot ? (facultatif)</label>
      <textarea class="champ" id="message-reco" maxlength="280" rows="3" placeholder="Regarde ça, tu vas adorer !"></textarea>
      <p class="message-notif" id="retour-reco" hidden></p>
      <div class="actions" style="margin-top:14px">
        <button type="button" class="bouton bouton-plein bouton-petit" id="envoyer-reco">Envoyer</button>
        <button type="button" class="bouton bouton-verre bouton-petit" data-fermer>Annuler</button>
      </div>
    </form>`;

  dialogue.querySelector('.puces').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pote]');
    if (!b) return;
    if (choisis.has(b.dataset.pote)) choisis.delete(b.dataset.pote); else choisis.add(b.dataset.pote);
    b.classList.toggle('actif', choisis.has(b.dataset.pote));
  });
  dialogue.querySelector('[data-fermer]').addEventListener('click', () => dialogue.close());
  dialogue.querySelector('#envoyer-reco').addEventListener('click', async (e) => {
    const retour = dialogue.querySelector('#retour-reco');
    if (!choisis.size) { retour.hidden = false; retour.textContent = 'Choisis au moins un pote.'; return; }
    e.currentTarget.disabled = true;
    try {
      const jeton = await compte.jeton();
      const message = dialogue.querySelector('#message-reco').value.trim();
      // Le relais vérifie qui je suis, enregistre la reco et notifie le pote
      for (const a of choisis) {
        const reponse = await fetch(`${URL_RELAIS}/recommander`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
          body: JSON.stringify({ a, item: { type: item.type, id: item.id, titre: item.titre, image: item.image }, message }),
        });
        if (!reponse.ok) throw new Error((await reponse.json().catch(() => ({}))).erreur || 'Envoi impossible');
      }
      retour.hidden = false;
      retour.textContent = 'Recommandation envoyée ✅';
      setTimeout(() => dialogue.close(), 1200);
    } catch (erreur) {
      retour.hidden = false;
      retour.textContent = `⚠️ ${erreur.message}`;
      e.currentTarget.disabled = false;
    }
  });
}
