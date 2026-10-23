// =========================================================
// Page Jeux vidéo : sorties (à venir / récentes), mes listes, explorer, actus.
// =========================================================
import { sortiesAVenir, sortiesRecentes, explorerJeux, jeuAuHasard, relaisConfigure } from '../api/jeux.js';
import { chargerActus } from '../api/actus.js';
import { echapper, afficherErreur, antiRebond, premiereMajuscule } from '../lib/outils.js';
import { GENRES_JEUX, PLATEFORMES } from '../lib/traductions-jeux.js';
import { listeJeux, STATUTS_JEU } from '../lib/listes-jeux.js';
import { afficherNavigation } from '../ui/nav.js';
import { carteJeu, carteJeuListe, squelettesJeux, badgeMetacritic, dateSortie, plateformesCourtes } from '../ui/cartes-jeux.js';
import { carteArticle } from '../ui/cartes.js';
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
    const jeux = await sortiesAVenir();
    const parMois = new Map();
    for (const j of jeux) {
      const mois = j.released && !j.tba ? premiereMajuscule(formatMois.format(new Date(`${j.released}T12:00:00`))) : 'Date à venir';
      if (!parMois.has(mois)) parMois.set(mois, []);
      parMois.get(mois).push(j);
    }
    zone.innerHTML = [...parMois].map(([mois, liste]) => `
      <h3 class="titre-mois">${mois}</h3>
      <div class="grille-jeux">${liste.map((j) => carteJeu(j)).join('')}</div>`).join('');
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

function afficherListes() {
  const jeux = listeJeux();
  $('choix-listes').innerHTML = Object.entries(STATUTS_JEU).map(([cle, s]) => {
    const nb = jeux.filter((j) => j.statut === cle).length;
    return `<button type="button" data-statut="${cle}" class="${cle === listeActive ? 'actif' : ''}">${s.nom}${nb ? ` <span style="opacity:.6">${nb}</span>` : ''}</button>`;
  }).join('');

  const choisis = jeux.filter((j) => j.statut === listeActive).reverse();
  $('listes-contenu').innerHTML = choisis.length
    ? choisis.map(carteJeuListe).join('')
    : `<div class="vide" style="grid-column:1/-1"><strong>Liste vide</strong>Ouvre la fiche d'un jeu et classe-le : « ${STATUTS_JEU[listeActive].nom} », « En cours »…</div>`;
}

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
let page = 1;
let requeteActuelle = 0;

$('puces-genres').innerHTML = Object.entries(GENRES_JEUX)
  .map(([slug, nom]) => `<button type="button" class="puce" data-genre="${slug}" aria-pressed="false">${nom}</button>`).join('');
for (const [id, nom] of Object.entries(PLATEFORMES)) $('f-plateforme').add(new Option(nom, id));
for (let a = new Date().getFullYear() + 2; a >= 1980; a--) $('f-annee').add(new Option(a, a));

function lireFiltres() {
  return {
    texte: $('f-texte').value,
    genres: [...genresChoisis],
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
  $('f-plateforme').value = p.get('plateforme') || '';
  $('f-note').value = p.get('note') || 0;
  $('f-annee').value = p.get('annee') || '';
  $('f-tri').value = p.get('tri') || '-added';
  $('puces-genres').querySelectorAll('.puce').forEach((b) => {
    const actif = genresChoisis.has(b.dataset.genre);
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

$('puces-genres').addEventListener('click', (e) => {
  const bouton = e.target.closest('.puce');
  if (!bouton) return;
  const genre = bouton.dataset.genre;
  const actif = !genresChoisis.has(genre);
  if (actif) genresChoisis.add(genre); else genresChoisis.delete(genre);
  bouton.classList.toggle('actif', actif);
  bouton.setAttribute('aria-pressed', actif);
  lancerRecherche();
});
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
          <h3>${echapper(j.name)} ${badgeMetacritic(j.metacritic).replace('class="metacritic"', 'class="metacritic en-ligne"')}</h3>
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
// 4. Actus jeux (les 6 dernières, depuis les flux RSS)
// =========================================================
chargerActus('jeux')
  .then((data) => { $('actus-contenu').innerHTML = data.articles.slice(0, 6).map(carteArticle).join(''); })
  .catch((erreur) => afficherErreur($('actus-contenu'), erreur));

// Arrivée avec une ancre (#explorer…) : on y retourne une fois la page remplie
if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 1200);
