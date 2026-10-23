// =========================================================
// La cloche 🔔 (barre du haut) : toutes les notifications, même sans les notifs push.
// Les notifications sont rangées par le relais (vérification horaire, recommandations,
// chat…) sous mon code perso. On peut en effacer une, ou tout effacer.
// =========================================================
import { codePerso, appelRelais } from '../lib/ma-liste.js';
import { echapper, ilYa } from '../lib/outils.js';
import { ICONES } from './icones.js';

const RAFRAICHIR = 5 * 60_000; // revérifie toutes les 5 minutes tant que la page est ouverte

let notifs = [];
let racine;

export function monterCloche(conteneur) {
  conteneur.insertAdjacentHTML('beforeend', `
    <div class="cloche">
      <button type="button" class="cloche-bouton" aria-label="Notifications" aria-expanded="false">
        ${ICONES.cloche}<span class="cloche-pastille" hidden></span>
      </button>
      <div class="cloche-panneau" hidden>
        <div class="cloche-tete">
          <strong>Notifications</strong>
          <button type="button" class="lien-discret" data-tout-effacer>Tout effacer</button>
        </div>
        <ul class="cloche-liste"></ul>
      </div>
    </div>`);
  racine = conteneur.querySelector('.cloche');
  const bouton = racine.querySelector('.cloche-bouton');
  const panneau = racine.querySelector('.cloche-panneau');

  bouton.addEventListener('click', () => {
    const ouvrir = panneau.hidden;
    panneau.hidden = !ouvrir;
    bouton.setAttribute('aria-expanded', ouvrir);
    if (ouvrir) {
      afficher();
      marquerToutLu();
    }
  });
  // Clic ailleurs ou Échap : on referme
  document.addEventListener('click', (e) => { if (!racine.contains(e.target)) panneau.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panneau.hidden = true; });

  racine.querySelector('[data-tout-effacer]').addEventListener('click', async () => {
    if (!notifs.length) return;
    notifs = [];
    afficher();
    await appelRelais('DELETE', `/historique/${codePerso()}`, {}).catch(() => {});
  });

  racine.querySelector('.cloche-liste').addEventListener('click', async (e) => {
    const effacer = e.target.closest('[data-effacer]');
    if (!effacer) return;
    e.preventDefault(); // la croix est dans le lien : on n'ouvre pas la page
    const id = effacer.dataset.effacer;
    notifs = notifs.filter((n) => n.id !== id);
    afficher();
    await appelRelais('DELETE', `/historique/${codePerso()}`, { ids: [id] }).catch(() => {});
  });

  charger();
  setInterval(() => { if (document.visibilityState === 'visible') charger(); }, RAFRAICHIR);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') charger(); });
}

async function charger() {
  try {
    notifs = await appelRelais('GET', `/historique/${codePerso()}`);
    afficher();
  } catch { /* hors connexion : on garde ce qu'on a */ }
}

async function marquerToutLu() {
  if (!notifs.some((n) => !n.lu)) return;
  // On laisse le temps de voir les nouvelles (point coloré) avant de les marquer lues
  setTimeout(async () => {
    notifs = notifs.map((n) => ({ ...n, lu: true }));
    mettreAJourPastille();
    await appelRelais('PUT', `/historique/${codePerso()}`, {}).catch(() => {});
  }, 1500);
}

// Les liens des notifications pointent vers le site en ligne : on les rend relatifs,
// pour rester sur la même version du site (utile en local)
function lienLocal(url) {
  if (!url) return '#';
  const page = url.match(/\/radar\/([^/]+\.html.*|)$/);
  return page ? page[1] || './' : url;
}

function mettreAJourPastille() {
  const nonLues = notifs.filter((n) => !n.lu).length;
  const pastille = racine.querySelector('.cloche-pastille');
  pastille.hidden = !nonLues;
  pastille.textContent = nonLues > 9 ? '9+' : nonLues;
}

function afficher() {
  mettreAJourPastille();
  const liste = racine.querySelector('.cloche-liste');
  liste.innerHTML = notifs.length
    ? notifs.map((n) => `
      <li class="${n.lu ? '' : 'non-lue'}">
        <a href="${echapper(lienLocal(n.url))}">
          ${n.image ? `<img src="${echapper(n.image)}" alt="" loading="lazy">` : `<span class="cloche-icone">${ICONES.cloche}</span>`}
          <div><b>${echapper(n.titre)}</b>${n.corps ? `<span>${echapper(n.corps)}</span>` : ''}<small>${ilYa(n.date)}</small></div>
          ${n.id ? `<button type="button" class="cloche-effacer" data-effacer="${echapper(n.id)}" aria-label="Effacer cette notification">×</button>` : ''}
        </a>
      </li>`).join('')
    : '<li class="cloche-vide">Rien de neuf pour l\'instant.<br><small>Suis des animés, des jeux ou des séries : leurs nouveautés arriveront ici.</small></li>';
}
