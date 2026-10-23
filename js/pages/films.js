// =========================================================
// Page Films & séries : calendrier des sorties, explorer (genres, filtres,
// « Propose-moi »), actus ciné. Données TMDB via le relais.
// =========================================================
import { sortiesFilms, seriesEnCeMoment, decouvrirFilms, filmAuHasard, genresFilms, rechercheFilmsSeries } from '../api/films.js';
import { relaisConfigure } from '../api/relais.js';
import { echapper, afficherErreur, antiRebond, premiereMajuscule } from '../lib/outils.js';
import { afficherNavigation } from '../ui/nav.js';
import { carteFilm, dateSortieFilm, lienFilm, noteFilm } from '../ui/cartes-films.js';
import { squelettesAffiches } from '../ui/cartes.js';
import { monterApercuActus } from '../ui/apercu-actus.js';
import { ICONES } from '../ui/icones.js';

afficherNavigation('films');
document.documentElement.style.setProperty('--accent', '#ff7ab6');

const $ = (id) => document.getElementById(id);
const formatMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const MESSAGE_RELAIS = '<div class="vide"><strong>Section bientôt prête</strong>Le relais n\'est pas encore déployé (voir worker/README.md).</div>';

// Plateformes de streaming en France (identifiants TMDB / JustWatch)
const PLATEFORMES = {
  8: 'Netflix', 119: 'Prime Video', 337: 'Disney+', 381: 'Canal+', 350: 'Apple TV+',
  1899: 'HBO Max', 531: 'Paramount+', 283: 'Crunchyroll', 415: 'ADN',
};

// =========================================================
// 1. Calendrier des sorties
// =========================================================
// Regroupe par mois ("Novembre 2026"), avec en tête les plus attendus
function calendrier(liste, { titreAttendus, sousTitre }) {
  const parMois = new Map();
  for (const r of liste) {
    const mois = premiereMajuscule(formatMois.format(new Date(`${r.date}T12:00:00`)));
    if (!parMois.has(mois)) parMois.set(mois, []);
    parMois.get(mois).push(r);
  }
  const attendus = [...liste].sort((a, b) => b.popularite - a.popularite).slice(0, 12);
  return `
    ${attendus.length ? `<h3 class="titre-mois">${titreAttendus}</h3>
    <div class="carrousel pleine-largeur">${attendus.map((r) => carteFilm(r, { sous: sousTitre(r) })).join('')}</div>` : ''}
    ${[...parMois].map(([mois, films]) => `
      <h3 class="titre-mois">${mois}</h3>
      <div class="grille-affiches">${films.map((r) => carteFilm(r, { sous: sousTitre(r) })).join('')}</div>`).join('')}`;
}

async function afficherSorties(vue) {
  const zone = $('sorties-contenu');
  if (!relaisConfigure()) { zone.innerHTML = MESSAGE_RELAIS; return; }
  zone.innerHTML = `<div class="grille-affiches">${squelettesAffiches(8)}</div>`;
  try {
    if (vue === 'series') {
      const [enCours, nouvelles] = await Promise.all([seriesEnCeMoment(), sortiesFilms('serie', 'avenir')]);
      zone.innerHTML = `
        <h3 class="titre-mois">En ce moment : un épisode cette semaine</h3>
        <div class="carrousel pleine-largeur">${enCours.map((r) => carteFilm(r)).join('') || '<div class="vide">Rien cette semaine.</div>'}</div>
        ${nouvelles.length
    ? calendrier(nouvelles, { titreAttendus: 'Nouvelles séries les plus attendues', sousTitre: (r) => `Série · ${dateSortieFilm(r.date)}` })
    : '<div class="vide"><strong>Aucune nouvelle série annoncée</strong>Reviens un peu plus tard.</div>'}`;
      return;
    }
    const recents = vue === 'recents';
    const films = await sortiesFilms('film', recents ? 'recentes' : 'avenir');
    if (!films.length) { zone.innerHTML = '<div class="vide"><strong>Aucun film trouvé</strong>Reviens un peu plus tard.</div>'; return; }
    zone.innerHTML = recents
      ? `<div class="grille-affiches">${films.map((r) => carteFilm(r, { sous: `Sorti le ${dateSortieFilm(r.date).toLowerCase()}` })).join('')}</div>`
      : calendrier(films, { titreAttendus: 'Les plus attendus', sousTitre: (r) => `Au cinéma · ${dateSortieFilm(r.date)}` });
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
afficherSorties('cinema');

// =========================================================
// 2. Explorer
// =========================================================
let type = 'film';
let genres = { film: [], serie: [] };
const genresChoisis = new Set();
let page = 1;
let requeteActuelle = 0;

for (const [id, nom] of Object.entries(PLATEFORMES)) $('f-plateforme').add(new Option(nom, id));
for (let a = new Date().getFullYear() + 1; a >= 1950; a--) $('f-annee').add(new Option(a, a));

function lireFiltres() {
  return {
    texte: $('f-texte').value.trim(),
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
  if (type !== 'film') p.set('type', type);
  if (f.texte) p.set('q', f.texte);
  if (f.genres.length) p.set('genres', f.genres.join(','));
  if (f.plateforme) p.set('plateforme', f.plateforme);
  if (f.noteMin) p.set('note', f.noteMin);
  if (f.annee) p.set('annee', f.annee);
  if (f.tri !== 'popularite') p.set('tri', f.tri);
  const query = p.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

function urlVersFiltres() {
  const p = new URLSearchParams(location.search);
  type = p.get('type') === 'serie' ? 'serie' : 'film';
  $('f-texte').value = p.get('q') || '';
  genresChoisis.clear();
  (p.get('genres') || '').split(',').filter((g) => /^\d+$/.test(g)).forEach((g) => genresChoisis.add(g));
  $('f-plateforme').value = PLATEFORMES[p.get('plateforme')] ? p.get('plateforme') : '';
  $('f-note').value = p.get('note') || 0;
  $('f-annee').value = p.get('annee') || '';
  $('f-tri').value = ['note', 'recents'].includes(p.get('tri')) ? p.get('tri') : 'popularite';
  afficherType();
  afficherValeurNote();
}

function afficherType() {
  $('f-type').querySelectorAll('button').forEach((b) => b.classList.toggle('actif', b.dataset.type === type));
  $('proposer').textContent = type === 'film' ? 'Propose-moi un film' : 'Propose-moi une série';
  $('puces-genres').innerHTML = genres[type].map((g) => {
    const actif = genresChoisis.has(String(g.id));
    return `<button type="button" class="puce ${actif ? 'actif' : ''}" data-genre="${g.id}" aria-pressed="${actif}">${echapper(g.nom)}</button>`;
  }).join('');
}

function afficherValeurNote() {
  const v = Number($('f-note').value);
  $('valeur-note').textContent = v ? `${v}/10 et +` : 'toutes';
}

async function lancerRecherche({ ajouter = false } = {}) {
  const zone = $('resultats');
  if (!relaisConfigure()) { zone.innerHTML = MESSAGE_RELAIS; return; }
  const filtres = lireFiltres();
  filtresVersUrl(filtres);
  $('note-recherche').hidden = !filtres.texte;
  page = ajouter ? page + 1 : 1;
  const numero = ++requeteActuelle;
  if (!ajouter) {
    zone.innerHTML = squelettesAffiches(12);
    $('compte').textContent = '';
    $('proposition').innerHTML = '';
  }
  $('charger-plus').disabled = true;

  try {
    // Avec un titre : recherche TMDB (films et séries mélangés, on garde le type choisi)
    const { total, suite, resultats } = filtres.texte
      ? await rechercheFilmsSeries(filtres.texte).then((r) => r.filter((x) => x.type === type)).then((r) => ({ total: r.length, suite: false, resultats: r }))
      : await decouvrirFilms(type, filtres, page);
    if (numero !== requeteActuelle) return;
    const html = resultats.map((r) => carteFilm(r)).join('');
    if (ajouter) zone.insertAdjacentHTML('beforeend', html);
    else zone.innerHTML = html || `<div class="vide" style="grid-column:1/-1"><strong>Aucun${type === 'film' ? ' film' : 'e série'} ne correspond</strong>Essaie avec moins de filtres.</div>`;
    const nom = type === 'film' ? 'film' : 'série';
    $('compte').textContent = total ? `${total.toLocaleString('fr-FR')} ${nom}${total > 1 ? 's' : ''}` : '';
    $('charger-plus').hidden = !suite;
  } catch (erreur) {
    if (!ajouter) afficherErreur(zone, erreur);
  }
  $('charger-plus').disabled = false;
}

$('f-type').addEventListener('click', (e) => {
  const bouton = e.target.closest('[data-type]');
  if (!bouton || bouton.dataset.type === type) return;
  type = bouton.dataset.type;
  genresChoisis.clear(); // les genres TMDB ne sont pas les mêmes pour les films et les séries
  afficherType();
  lancerRecherche();
});
$('puces-genres').addEventListener('click', (e) => {
  const bouton = e.target.closest('.puce');
  if (!bouton) return;
  const valeur = bouton.dataset.genre;
  const actif = !genresChoisis.has(valeur);
  if (actif) genresChoisis.add(valeur); else genresChoisis.delete(valeur);
  bouton.classList.toggle('actif', actif);
  bouton.setAttribute('aria-pressed', actif);
  lancerRecherche();
});
$('f-texte').addEventListener('input', antiRebond(() => lancerRecherche(), 450));
$('f-note').addEventListener('input', afficherValeurNote);
for (const id of ['f-plateforme', 'f-note', 'f-annee', 'f-tri']) $(id).addEventListener('change', () => lancerRecherche());
$('filtres').addEventListener('submit', (e) => { e.preventDefault(); lancerRecherche(); });
$('filtres').addEventListener('reset', () => setTimeout(() => {
  history.replaceState(null, '', `${location.pathname}${type === 'serie' ? '?type=serie' : ''}${location.hash}`);
  urlVersFiltres();
  lancerRecherche();
}));
$('charger-plus').addEventListener('click', () => lancerRecherche({ ajouter: true }));

// --- « Propose-moi » : au hasard, en respectant les filtres (sauf le titre) ---
$('proposer').addEventListener('click', async () => {
  const bouton = $('proposer');
  const zone = $('proposition');
  if (!relaisConfigure()) { zone.innerHTML = MESSAGE_RELAIS; return; }
  bouton.disabled = true;
  try {
    const r = await filmAuHasard(type, lireFiltres());
    zone.innerHTML = r ? carteProposition(r) : `<div class="vide" style="margin-bottom:24px"><strong>Aucun${type === 'film' ? ' film' : 'e série'} ne correspond</strong>Essaie avec moins de filtres.</div>`;
    $('reproposer')?.addEventListener('click', () => bouton.click());
    zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (erreur) {
    afficherErreur(zone, erreur);
  }
  bouton.disabled = false;
});

function carteProposition(r) {
  const noms = new Map(genres[r.type].map((g) => [g.id, g.nom]));
  const listeGenres = r.genres.map((g) => noms.get(g)).filter(Boolean).slice(0, 3).join(' · ');
  return `
    <div class="proposition">
      <div class="proposition-fond" style="--image:url('${echapper(r.fond || r.image || '')}')"></div>
      <div class="proposition-contenu">
        ${r.image ? `<img src="${echapper(r.image)}" alt="" class="proposition-affiche">` : ''}
        <div>
          <div class="surtitre">Et pourquoi pas…</div>
          <h3>${echapper(r.titre)}</h3>
          <div class="meta">
            ${r.note ? `<span class="note">★ ${noteFilm(r.note)}</span>` : ''}
            ${r.date ? `<span>${r.date.slice(0, 4)}</span>` : ''}
            ${listeGenres ? `<span>${echapper(listeGenres)}</span>` : ''}
          </div>
          ${r.resume ? `<p class="resume">${echapper(r.resume)}</p>` : ''}
          <div class="actions" style="margin-top:14px">
            <a class="bouton bouton-plein bouton-petit" href="${lienFilm(r)}">${ICONES.info}Voir la fiche</a>
            <button type="button" class="bouton bouton-verre bouton-petit" id="reproposer">${ICONES.de}Un${r.type === 'film' ? ' autre' : 'e autre'}</button>
          </div>
        </div>
      </div>
    </div>`;
}

urlVersFiltres();
lancerRecherche();
// Les genres arrivent du relais (gardés 7 jours en cache) : on les affiche dès qu'ils sont là
if (relaisConfigure()) {
  genresFilms().then((g) => { genres = g; afficherType(); }).catch(() => { $('puces-genres').innerHTML = '<span class="mention">Genres indisponibles pour le moment.</span>'; });
}

// =========================================================
// 3. Actus (flux RSS AlloCiné, Écran Large)
// =========================================================
monterApercuActus($('filtres-actus'), $('actus-contenu'), 'cinema', [
  ['', 'Tout'], ['Bande-annonce', 'Bandes-annonces'], ['Série', 'Séries'], ['Cinéma', 'Cinéma'], ['Plateformes', 'Plateformes'],
]);

// Arrivée avec une ancre (#explorer…) : on y retourne une fois la page remplie
if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 1200);
