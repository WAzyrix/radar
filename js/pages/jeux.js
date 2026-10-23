// =========================================================
// Page Jeux vidéo : sorties (à venir / récentes), mes listes, explorer, actus.
// =========================================================
import { calendrierSorties, sortiesRecentes, explorerJeux, jeuAuHasard, relaisConfigure } from '../api/jeux.js';
import { echapper, afficherErreur, antiRebond, premiereMajuscule } from '../lib/outils.js';
import { GENRES_JEUX, THEMES_JEUX, PLATEFORMES } from '../lib/traductions-jeux.js';
import { listeJeux, STATUTS_JEU, statutJeu } from '../lib/listes-jeux.js';
import { favoris } from '../lib/notes.js';
import { afficherNavigation } from '../ui/nav.js';
import { carteJeu, carteJeuListe, squelettesJeux, badgeMetacritic, dateSortie, plateformesCourtes } from '../ui/cartes-jeux.js';
import { monterApercuActus } from '../ui/apercu-actus.js';
import { ICONES } from '../ui/icones.js';

afficherNavigation('jeux');
document.documentElement.style.setProperty('--accent', '#6ee7a8');

const $ = (id) => document.getElementById(id);
const formatMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

// Sans relais configuré, on l'explique au lieu d'afficher des erreurs partout
const MESSAGE_RELAIS = '<div class="vide"><strong>Section bientôt prête</strong>Le relais jeux n\'est pas encore déployé (voir worker/README.md).</div>';

// =========================================================
// 1. Sorties
// =========================================================
async function afficherSorties(vue) {
  const zone = $('sorties-contenu');
  if (!relaisConfigure()) { zone.innerHTML = MESSAGE_RELAIS; return; }
  zone.innerHTML = `<div class="grille-jeux">${squelettesJeux(8)}</div>`;
  try {
    if (vue === 'recentes') {
      const jeux = await sortiesRecentes();
      zone.innerHTML = `<div class="grille-jeux">${jeux.map((j) => carteJeu(j)).join('')}</div>`;
      return;
    }
    // À venir : regroupés par mois ("Novembre 2026", "Décembre 2026"…)
    const jeux = await calendrierSorties();
    const parMois = new Map();
    for (const j of jeux) {
      const mois = j.released && !j.tba ? premiereMajuscule(formatMois.format(new Date(`${j.released}T12:00:00`))) : 'Date à venir';
      if (!parMois.has(mois)) parMois.set(mois, []);
      parMois.get(mois).push(j);
    }
    // En tête : les plus attendus (ceux que le plus de joueurs ont ajoutés sur RAWG)
    const attendus = [...jeux].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 10);
    zone.innerHTML = `
      <h3 class="titre-mois">Les plus attendus</h3>
      <div class="carrousel jeux pleine-largeur">${attendus.map((j) => carteJeu(j)).join('')}</div>
      ${[...parMois].sort(([a], [b]) => (a === 'Date à venir') - (b === 'Date à venir')).map(([mois, liste]) => `
        <h3 class="titre-mois">${mois}</h3>
        <div class="grille-jeux">${liste.map((j) => carteJeu(j)).join('')}</div>`).join('')}`;
  } catch (erreur) {
    afficherErreur(zone, erreur);
  }
}

$('choix-sorties').addEventListener('click', (e) => {
  const bouton = e.target.closest('button');
  if (!bouton) return;
  $('choix-sorties').querySelectorAll('button').forEach((b) => b.classList.toggle('actif', b === bouton));
  afficherSorties(bouton.dataset.vue);
});
afficherSorties('avenir');

// =========================================================
// 2. Mes listes (lues dans le navigateur, aucune requête)
// =========================================================
let listeActive = 'envie';

// Les favoris ❤️ (lib/notes.js) sont une liste à part : un jeu peut être « Terminé » ET favori
const jeuxFavoris = () => favoris('jeu').map((n) => ({ id: n.id, nom: n.titre, image: n.image, statut: statutJeu(n.id) }));

function afficherListes() {
  const jeux = listeJeux();
  const listes = [...Object.entries(STATUTS_JEU).map(([cle, s]) => [cle, s.nom, jeux.filter((j) => j.statut === cle)]), ['favoris', '❤️ Favoris', jeuxFavoris()]];
  $('choix-listes').innerHTML = listes.map(([cle, nom, liste]) =>
    `<button type="button" data-statut="${cle}" class="${cle === listeActive ? 'actif' : ''}">${nom}${liste.length ? ` <span style="opacity:.6">${liste.length}</span>` : ''}</button>`).join('');

  const choisis = [...listes.find(([cle]) => cle === listeActive)[2]].reverse();
  $('listes-contenu').innerHTML = choisis.length
    ? choisis.map(carteJeuListe).join('')
    : `<div class="vide" style="grid-column:1/-1"><strong>Liste vide</strong>${listeActive === 'favoris'
      ? 'Appuie sur ❤️ sur la fiche d\'un jeu pour l\'ajouter à tes favoris.'
      : `Ouvre la fiche d'un jeu et classe-le : « ${STATUTS_JEU[listeActive].nom} », « En cours »…`}</div>`;
}
window.addEventListener('radar:notes', afficherListes);

$('choix-listes').addEventListener('click', (e) => {
  const bouton = e.target.closest('button');
  if (!bouton) return;
  listeActive = bouton.dataset.statut;
  afficherListes();
});
afficherListes();

// =========================================================
// 3. Explorer
// =========================================================
const genresChoisis = new Set();
const themesChoisis = new Set();
let page = 1;
let requeteActuelle = 0;

$('puces-genres').innerHTML = Object.entries(GENRES_JEUX)
  .map(([slug, nom]) => `<button type="button" class="puce" data-genre="${slug}" aria-pressed="false">${nom}</button>`).join('');
$('puces-themes').innerHTML = Object.entries(THEMES_JEUX)
  .map(([slug, nom]) => `<button type="button" class="puce" data-theme="${slug}" aria-pressed="false">${nom}</button>`).join('');
for (const [id, nom] of Object.entries(PLATEFORMES)) $('f-plateforme').add(new Option(nom, id));
for (let a = new Date().getFullYear() + 2; a >= 1980; a--) $('f-annee').add(new Option(a, a));

function lireFiltres() {
  return {
    texte: $('f-texte').value,
    genres: [...genresChoisis],
    themes: [...themesChoisis],
    plateforme: $('f-plateforme').value,
    noteMin: Number($('f-note').value),
    annee: $('f-annee').value,
    tri: $('f-tri').value,
  };
}

// Filtres <-> adresse de la page (pour partager une recherche)
function filtresVersUrl(f) {
  const p = new URLSearchParams();
  if (f.texte) p.set('q', f.texte);
  if (f.genres.length) p.set('genres', f.genres.join(','));
  if (f.themes.length) p.set('themes', f.themes.join(','));
  if (f.plateforme) p.set('plateforme', f.plateforme);
  if (f.noteMin) p.set('note', f.noteMin);
  if (f.annee) p.set('annee', f.annee);
  if (f.tri !== '-added') p.set('tri', f.tri);
  const query = p.toString();
  history.replaceState(null, '', `${location.pathname}${query ? '?' + query : ''}${location.hash}`);
}

function urlVersFiltres() {
  const p = new URLSearchParams(location.search);
  $('f-texte').value = p.get('q') || '';
  genresChoisis.clear();
  (p.get('genres') || '').split(',').filter(Boolean).forEach((g) => genresChoisis.add(g));
  themesChoisis.clear();
  (p.get('themes') || '').split(',').filter(Boolean).forEach((t) => themesChoisis.add(t));
  $('f-plateforme').value = p.get('plateforme') || '';
  $('f-note').value = p.get('note') || 0;
  $('f-annee').value = p.get('annee') || '';
  $('f-tri').value = p.get('tri') || '-added';
  document.querySelectorAll('#puces-genres .puce, #puces-themes .puce').forEach((b) => {
    const actif = b.dataset.genre ? genresChoisis.has(b.dataset.genre) : themesChoisis.has(b.dataset.theme);
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-pressed', actif);
  });
  afficherValeurNote();
}

function afficherValeurNote() {
  const v = Number($('f-note').value);
  $('valeur-note').textContent = v ? `${v} et +` : 'toutes';
}

async function lancerRecherche({ ajouter = false } = {}) {
  const zone = $('resultats');
  if (!relaisConfigure()) { zone.innerHTML = MESSAGE_RELAIS; return; }
  const filtres = lireFiltres();
  filtresVersUrl(filtres);
  page = ajouter ? page + 1 : 1;
  const numero = ++requeteActuelle;
  if (!ajouter) {
    zone.innerHTML = squelettesJeux(8);
    $('compte').textContent = '';
    $('proposition').innerHTML = '';
  }
  $('charger-plus').disabled = true;

  try {
    const { total, suite, jeux } = await explorerJeux(filtres, page);
    if (numero !== requeteActuelle) return;
    const html = jeux.map((j) => carteJeu(j)).join('');
    if (ajouter) zone.insertAdjacentHTML('beforeend', html);
    else zone.innerHTML = html || '<div class="vide" style="grid-column:1/-1"><strong>Aucun jeu ne correspond</strong>Essaie avec moins de filtres.</div>';
    $('compte').textContent = total ? `${total.toLocaleString('fr-FR')} jeu${total > 1 ? 'x' : ''}` : '';
    $('charger-plus').hidden = !suite;
  } catch (erreur) {
    if (!ajouter) afficherErreur(zone, erreur);
  }
  $('charger-plus').disabled = false;
}

// Genres et thèmes : même fonctionnement, seul l'ensemble mis à jour change
function brancherPuces(conteneur, choisis, attribut) {
  conteneur.addEventListener('click', (e) => {
    const bouton = e.target.closest('.puce');
    if (!bouton) return;
    const valeur = bouton.dataset[attribut];
    const actif = !choisis.has(valeur);
    if (actif) choisis.add(valeur); else choisis.delete(valeur);
    bouton.classList.toggle('actif', actif);
    bouton.setAttribute('aria-pressed', actif);
    lancerRecherche();
  });
}
brancherPuces($('puces-genres'), genresChoisis, 'genre');
brancherPuces($('puces-themes'), themesChoisis, 'theme');
$('f-texte').addEventListener('input', antiRebond(() => lancerRecherche(), 450));
$('f-note').addEventListener('input', afficherValeurNote);
for (const id of ['f-plateforme', 'f-note', 'f-annee', 'f-tri']) $(id).addEventListener('change', () => lancerRecherche());
$('filtres').addEventListener('submit', (e) => { e.preventDefault(); lancerRecherche(); });
$('filtres').addEventListener('reset', () => setTimeout(() => {
  history.replaceState(null, '', location.pathname + location.hash);
  urlVersFiltres();
  lancerRecherche();
}));
$('charger-plus').addEventListener('click', () => lancerRecherche({ ajouter: true }));

// --- "Propose-moi un jeu" : au hasard, en respectant les filtres ---
$('proposer').addEventListener('click', async () => {
  const bouton = $('proposer');
  const zone = $('proposition');
  if (!relaisConfigure()) { zone.innerHTML = MESSAGE_RELAIS; return; }
  bouton.disabled = true;
  try {
    const jeu = await jeuAuHasard(lireFiltres());
    zone.innerHTML = jeu ? carteProposition(jeu) : '<div class="vide" style="margin-bottom:24px"><strong>Aucun jeu ne correspond</strong>Essaie avec moins de filtres.</div>';
    $('reproposer')?.addEventListener('click', () => bouton.click());
    zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (erreur) {
    afficherErreur(zone, erreur);
  }
  bouton.disabled = false;
});

function carteProposition(j) {
  const genres = (j.genres || []).slice(0, 3).map((g) => GENRES_JEUX[g.slug] || g.name).join(' · ');
  return `
    <div class="proposition">
      <div class="proposition-fond" style="--image:url('${j.background_image || ''}')"></div>
      <div class="proposition-contenu">
        <div>
          <div class="surtitre">Et pourquoi pas…</div>
          <h3>${echapper(j.name)} ${badgeMetacritic(j.metacritic, { enLigne: true })}</h3>
          <div class="meta"><span>${echapper(dateSortie(j))}</span>${genres ? `<span>${echapper(genres)}</span>` : ''}<span>${echapper(plateformesCourtes(j))}</span></div>
          <div class="actions" style="margin-top:14px">
            <a class="bouton bouton-plein bouton-petit" href="jeu.html?id=${j.id}">${ICONES.info}Voir la fiche</a>
            <button type="button" class="bouton bouton-verre bouton-petit" id="reproposer">${ICONES.de}Un autre</button>
          </div>
        </div>
      </div>
    </div>`;
}

urlVersFiltres();
lancerRecherche();

// =========================================================
// 4. Actus & rumeurs (flux RSS)
// =========================================================
monterApercuActus($('filtres-actus'), $('actus-contenu'), 'jeux', [
  ['', 'Tout'], ['Rumeur', 'Rumeurs'], ['Annonce', 'Annonces'], ['Sortie', 'Sorties'], ['Consoles', 'Consoles'], ['Jailbreak & homebrew', 'Jailbreak'],
]);

// Arrivée avec une ancre (#explorer…) : on y retourne une fois la page remplie
if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 1200);
