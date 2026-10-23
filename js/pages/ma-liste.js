// =========================================================
// Page "Ma liste" : contenu, ajout de films/séries, notifications, appareils.
// =========================================================
import * as maListe from '../lib/ma-liste.js';
import * as notifs from '../lib/notifications.js';
import { rechercheFilmsSeries } from '../api/films.js';
import { echapper, ilYa, afficherErreur, antiRebond, couleurValide, imageValide } from '../lib/outils.js';
import { afficherNavigation } from '../ui/nav.js';
import { carteJeuListe } from '../ui/cartes-jeux.js';
import { ICONES } from '../ui/icones.js';
import { ETAPES, etapeDe, nomStatut, statutSuivant } from '../lib/statuts.js';

afficherNavigation('ma-liste');
document.documentElement.style.setProperty('--accent', '#ff7ab6');
document.getElementById('icone-potes').innerHTML = ICONES.potes;
const $ = (id) => document.getElementById(id);

// =========================================================
// 1. Contenu de la liste
// =========================================================
let filtre = new URLSearchParams(location.search).get('type') || '';
// Étape choisie (À voir / En cours / Vu), retenue d'une visite à l'autre
let etape = localStorage.getItem('radar:etape') || '';

const boutonRetirer = (item) => `<button type="button" class="retirer" data-type="${item.type}" data-id="${echapper(item.id)}" title="Retirer de ma liste" aria-label="Retirer ${echapper(item.titre)}">×</button>`;

function carteItem(item) {
  if (item.type === 'jeu') return `<div class="avec-retirer">${carteJeuListe({ id: item.id, nom: item.titre, image: item.image, sortie: item.sortie, statut: item.statut })}${boutonRetirer(item)}</div>`;
  const externe = item.type === 'film' || item.type === 'serie';
  return `
    <div class="avec-retirer">
      <a class="affiche" href="${maListe.lienElement(item)}" ${externe ? 'target="_blank" rel="noopener noreferrer"' : ''} style="--couleur:${couleurValide(item.couleur) || '#1a1a24'}">
        <div class="affiche-image">${imageValide(item.image) ? `<img src="${echapper(item.image)}" alt="" loading="lazy">` : ''}</div>
        <div class="affiche-titre">${echapper(item.titre)}</div>
        <div class="affiche-sous">${maListe.TYPES[item.type].un}${item.sortie ? ` · ${item.sortie.slice(0, 4)}` : ''}</div>
      </a>
      <button type="button" class="statut-carte etape-${etapeDe(item)}" data-statut-type="${item.type}" data-statut-id="${echapper(item.id)}" title="Changer : ${echapper(nomStatut({ ...item, statut: statutSuivant(item) }))} ensuite">${echapper(nomStatut(item))} ›</button>
      ${boutonRetirer(item)}
    </div>`;
}

function afficherListe() {
  const tous = maListe.items().filter(maListe.itemValide);
  // Filtres par type, avec le nombre d'éléments
  $('filtres-types').innerHTML = [['', 'Tout', tous.length], ...Object.entries(maListe.TYPES).map(([t, info]) => [t, info.nom, tous.filter((i) => i.type === t).length])]
    .map(([t, nom, nb]) => `<button type="button" data-type="${t}" class="${t === filtre ? 'actif' : ''}">${nom}${nb ? ` <span style="opacity:.6">${nb}</span>` : ''}</button>`).join('');

  if (!tous.length) {
    $('contenu-liste').innerHTML = `<div class="vide"><strong>Ta liste est vide</strong>Suis un animé ou un manga depuis sa fiche, classe un jeu, ou ajoute un film ci-dessous.</div>`;
    return;
  }
  // Filtre par étape (À voir / En cours / Vu), avec le nombre d'éléments du type choisi
  const duType = tous.filter((i) => !filtre || i.type === filtre);
  $('filtres-etapes').innerHTML = [['', 'Tout', duType.length], ...Object.entries(ETAPES).map(([e, info]) => [e, info.nom, duType.filter((i) => etapeDe(i) === e).length])]
    .map(([e, nom, nb]) => `<button type="button" data-etape="${e}" class="${e === etape ? 'actif' : ''}">${nom}${nb ? ` <span style="opacity:.6">${nb}</span>` : ''}</button>`).join('');

  // "Tout" : un bloc par type ; sinon seulement le type choisi
  const types = filtre ? [filtre] : Object.keys(maListe.TYPES);
  let affiches = 0;
  $('contenu-liste').innerHTML = types.map((t) => {
    const liste = tous.filter((i) => i.type === t && (!etape || etapeDe(i) === etape)).reverse();
    affiches += liste.length;
    if (!liste.length) return '';
    return `
      ${filtre ? '' : `<h3 class="titre-mois">${maListe.TYPES[t].nom}</h3>`}
      <div class="${t === 'jeu' ? 'grille-jeux' : 'grille-affiches'}">${liste.map(carteItem).join('')}</div>`;
  }).join('');
  if (!affiches) $('contenu-liste').innerHTML = `<div class="vide"><strong>Rien ici pour l'instant</strong>${etape === 'termine' ? 'Passe un élément en « Vu » avec la pastille sous sa carte.' : ''}</div>`;
}

$('filtres-etapes').addEventListener('click', (e) => {
  const bouton = e.target.closest('button');
  if (!bouton) return;
  etape = bouton.dataset.etape;
  localStorage.setItem('radar:etape', etape);
  afficherListe();
});

$('filtres-types').addEventListener('click', (e) => {
  const bouton = e.target.closest('button');
  if (!bouton) return;
  filtre = bouton.dataset.type;
  history.replaceState(null, '', filtre ? `?type=${filtre}` : location.pathname);
  afficherListe();
});

$('contenu-liste').addEventListener('click', (e) => {
  // Pastille de statut : on passe au statut suivant (À voir → En cours → Vu → À voir)
  const pastille = e.target.closest('[data-statut-type]');
  if (pastille) {
    const idBrut = Number(pastille.dataset.statutId);
    const item = maListe.trouver(pastille.dataset.statutType, Number.isNaN(idBrut) ? pastille.dataset.statutId : idBrut);
    if (item) maListe.enregistrer({ type: item.type, id: item.id, statut: statutSuivant(item) });
    return;
  }
  const bouton = e.target.closest('.retirer');
  if (!bouton) return;
  const id = Number(bouton.dataset.id);
  maListe.retirer(bouton.dataset.type, Number.isNaN(id) ? bouton.dataset.id : id);
});

// La liste change (ici, ou synchronisée depuis un autre appareil) : on réaffiche
window.addEventListener('radar:liste', () => { afficherListe(); afficherResultats(); });
afficherListe();

// =========================================================
// 2. Ajouter un film ou une série (TMDB)
// =========================================================
let derniersResultats = [];

function afficherResultats() {
  $('resultats-tmdb').innerHTML = derniersResultats.map((r) => {
    const dejaLa = Boolean(maListe.trouver(r.type, r.id));
    return `
      <div class="resultat-tmdb">
        <div class="affiche-image" style="--couleur:#1a1a24">
          ${r.image ? `<img src="${r.image}" alt="" loading="lazy">` : ''}
          ${r.note ? `<span class="affiche-note">★ ${String(r.note).replace('.', ',')}</span>` : ''}
        </div>
        <div class="affiche-titre">${echapper(r.titre)}</div>
        <div class="affiche-sous">${maListe.TYPES[r.type].un}${r.date ? ` · ${r.date.slice(0, 4)}` : ''}</div>
        <button type="button" class="bouton ${dejaLa ? 'bouton-verre actif' : 'bouton-verre'} bouton-petit" data-ajout="${r.type}:${r.id}">
          ${dejaLa ? `${ICONES.check}Dans ma liste` : `${ICONES.plus}Ajouter`}
        </button>
      </div>`;
  }).join('');
}

$('recherche-tmdb').addEventListener('input', antiRebond(async (e) => {
  const texte = e.target.value.trim();
  if (texte.length < 2) { derniersResultats = []; afficherResultats(); return; }
  try {
    derniersResultats = await rechercheFilmsSeries(texte);
    afficherResultats();
    if (!derniersResultats.length) $('resultats-tmdb').innerHTML = '<div class="vide" style="grid-column:1/-1">Aucun film ni série trouvé.</div>';
  } catch (erreur) {
    afficherErreur($('resultats-tmdb'), erreur);
  }
}, 400));

$('resultats-tmdb').addEventListener('click', (e) => {
  const bouton = e.target.closest('[data-ajout]');
  if (!bouton) return;
  const r = derniersResultats.find((x) => `${x.type}:${x.id}` === bouton.dataset.ajout);
  if (maListe.trouver(r.type, r.id)) maListe.retirer(r.type, r.id);
  else maListe.enregistrer({ type: r.type, id: r.id, titre: r.titre, image: r.image, sortie: r.date || undefined });
});

// =========================================================
// 3. Notifications
// =========================================================
const PREFS = {
  episode: 'Épisode d\'animé diffusé au Japon',
  vostfr: 'Épisode dispo en VOSTFR / VF sur ADN',
  suite: 'Suite d\'un animé annoncée',
  manga: 'Nouveau tome ou chapitre de manga',
  serie: 'Nouvel épisode ou nouvelle saison de série',
  film: 'Film au cinéma demain / arrivé en streaming',
  jeu: 'Sortie d\'un jeu de ma liste',
};

async function afficherNotifs(message = '') {
  const carte = $('carte-notifs');
  const etat = await notifs.etat();
  const info = message ? `<p class="message-notif">${message}</p>` : '';

  if (!etat.possible) {
    carte.innerHTML = notifs.estIphone() && !notifs.estAppliInstallee()
      ? `<h3>Sur iPhone, une étape avant</h3>
         <ol class="etapes">
           <li>Ouvre ce site dans <b>Safari</b>.</li>
           <li>Appuie sur <b>Partager</b> (le carré avec une flèche), puis <b>« Sur l'écran d'accueil »</b>.</li>
           <li>Ouvre Radar depuis la nouvelle icône, et reviens sur cette page.</li>
         </ol>`
      : '<p>Ce navigateur ne gère pas les notifications web. Essaie avec Chrome, Edge, Firefox ou Safari récent.</p>';
    return;
  }

  if (etat.permission === 'denied') {
    carte.innerHTML = `${info}<p>Tu as bloqué les notifications pour ce site. Pour les réactiver : clique sur le cadenas à gauche de l'adresse → Notifications → Autoriser, puis recharge la page.</p>`;
    return;
  }

  if (!etat.actif) {
    carte.innerHTML = `
      ${info}
      <p>Reçois une notification quand un épisode sort, qu'une suite est annoncée, qu'un jeu de ta liste sort… même site fermé. Les nouveautés sont vérifiées toutes les heures.</p>
      <div class="actions" style="margin-top:16px"><button type="button" class="bouton bouton-plein" id="activer">${ICONES.plus}Activer les notifications</button></div>`;
    $('activer').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await notifs.activer();
        afficherNotifs('Notifications activées sur cet appareil ✅');
      } catch (erreur) {
        afficherNotifs(`⚠️ ${echapper(erreur.message)}`);
      }
    });
    return;
  }

  // Notifications actives : préférences, test, historique
  carte.innerHTML = `${info}<p>Notifications <b>actives</b> sur cet appareil.</p><div class="squelette" style="height:120px;margin-top:14px"></div>`;
  const { prefs, appareils } = await notifs.lirePrefs();
  carte.innerHTML = `
    ${info}
    <p>Notifications <b>actives</b> sur cet appareil${appareils > 1 ? ` (et ${appareils - 1} autre${appareils > 2 ? 's' : ''})` : ''}. Choisis ce que tu veux recevoir :</p>
    <div class="prefs">${Object.entries(PREFS).map(([cle, nom]) => `
      <label class="interrupteur"><input type="checkbox" data-pref="${cle}" ${prefs[cle] !== false ? 'checked' : ''}> ${nom}</label>`).join('')}
    </div>
    <div class="actions" style="margin-top:18px">
      <button type="button" class="bouton bouton-verre bouton-petit" id="tester">${ICONES.info}Envoyer une notif de test</button>
      <button type="button" class="bouton bouton-verre bouton-petit" id="desactiver">Désactiver sur cet appareil</button>
    </div>
    <p class="mention">Toutes tes notifications sont aussi dans la cloche 🔔 en haut du site.</p>`;

  carte.querySelector('.prefs').addEventListener('change', async () => {
    const nouvelles = Object.fromEntries([...carte.querySelectorAll('[data-pref]')].map((c) => [c.dataset.pref, c.checked]));
    await notifs.changerPrefs(nouvelles).catch((erreur) => afficherNotifs(`⚠️ ${echapper(erreur.message)}`));
  });
  $('tester').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    await notifs.envoyerTest()
      .then(() => afficherNotifs('Notification de test envoyée : elle devrait arriver dans quelques secondes.'))
      .catch((erreur) => afficherNotifs(`⚠️ ${echapper(erreur.message)}`));
  });
  $('desactiver').addEventListener('click', async () => {
    await notifs.desactiver();
    afficherNotifs('Notifications désactivées sur cet appareil.');
  });
}

// =========================================================
// 4. Mes appareils (code perso)
// =========================================================
function afficherSynchro(message = '') {
  const code = maListe.codePerso();
  const synchro = maListe.derniereSynchro();
  $('carte-synchro').innerHTML = `
    ${message ? `<p class="message-notif">${message}</p>` : ''}
    <p>Ta liste est liée à un <b>code perso</b>. Pour retrouver la même liste sur ton téléphone (ou un autre PC), entre ce code là-bas. Garde-le pour toi : il donne accès à ta liste.</p>
    <div class="code-perso">
      <code id="code">${'•'.repeat(32)}</code>
      <button type="button" class="bouton bouton-verre bouton-petit" id="voir-code">Afficher</button>
      <button type="button" class="bouton bouton-verre bouton-petit" id="copier-code">Copier</button>
    </div>
    <p class="mention">${synchro ? `Dernière synchronisation ${ilYa(synchro)}.` : 'Pas encore synchronisée.'}</p>
    <h3 style="margin-top:22px">Utiliser le code d'un autre appareil</h3>
    <form class="ligne-code" id="form-code">
      <input class="champ" id="autre-code" placeholder="Colle ici le code de ton autre appareil" autocomplete="off" spellcheck="false">
      <button class="bouton bouton-plein bouton-petit">Relier</button>
    </form>`;

  $('voir-code').addEventListener('click', (e) => {
    const visible = $('code').textContent === code;
    $('code').textContent = visible ? '•'.repeat(32) : code;
    e.currentTarget.textContent = visible ? 'Afficher' : 'Masquer';
  });
  $('copier-code').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(code);
    e.currentTarget.textContent = 'Copié ✓';
  });
  $('form-code').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await maListe.utiliserCode($('autre-code').value);
      afficherSynchro('Appareil relié ✅ Ta liste a été récupérée.');
      afficherNotifs();
    } catch (erreur) {
      afficherSynchro(`⚠️ ${echapper(erreur.message)}`);
    }
  });
}

// ---------- Lancement ----------
afficherSynchro();
afficherNotifs().catch((erreur) => afficherErreur($('carte-notifs'), erreur));
// Après la synchro automatique (lancée par la navigation), on met à jour la date affichée
window.addEventListener('radar:liste', () => afficherSynchro());
