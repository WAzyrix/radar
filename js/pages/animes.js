// =========================================================
// Page Animés : calendrier de la semaine, rattrapage, explorer (genres + filtres).
// =========================================================
import { explorer, auHasard, rattrapage } from '../api/animes.js';
import { echapper, titre, note, nettoyerSynopsis, compteARebours, afficherErreur, antiRebond, attributUrl, couleurValide } from '../lib/outils.js';
import { GENRES_FR, TAGS_FR, STATUTS_FR, FORMATS_FR, GENRES_VEDETTES } from '../lib/traductions.js';
import { listeSuivis, dernierSorti, enregistrerVus } from '../lib/suivis.js';
import { rattrapageMasque, masquerRattrapage } from '../lib/preferences.js';
import { estTermine } from '../lib/statuts.js';
import { afficherNavigation } from '../ui/nav.js';
import { carteAffiche, squelettesAffiches } from '../ui/cartes.js';
import { monterCalendrier, NOTE_HEURES } from '../ui/calendrier.js';
import { monterChapitres, NOTE_CHAPITRES } from '../ui/chapitres.js';
import { ICONES } from '../ui/icones.js';
import { monterApercuActus } from '../ui/apercu-actus.js';

afficherNavigation('animes');

const $ = (id) => document.getElementById(id);

// Le calendrier (en haut) change de hauteur en chargeant : si on arrive avec
// une ancre (#explorer…), on redescend à la bonne section une fois qu'il est affiché.
// On attend 2 signaux : calendrier affiché + premiers résultats d'Explorer.
let ancreFaite = !location.hash;
let signauxAttendus = 2;
function allerAncre() {
  if (ancreFaite || --signauxAttendus > 0) return;
  ancreFaite = true;
  document.querySelector(location.hash)?.scrollIntoView();
}

// =========================================================
// 1. Calendrier
// =========================================================
$('note-heures').innerHTML = `${ICONES.horloge}<span>${NOTE_HEURES}</span>`;
monterCalendrier($('jours'), $('episodes'), { filtreSuivis: $('filtre-suivis'), quandAffiche: allerAncre });

// =========================================================
// 1 bis. Calendrier des scans (chapitres de manga)
// =========================================================
$('note-scans').innerHTML = `${ICONES.horloge}<span>${NOTE_CHAPITRES}</span>`;
monterChapitres($('jours-scans'), $('chapitres'), $('filtre-scans'));

// =========================================================
// 2. Rattrapage
// =========================================================
// Pour chaque animé suivi, saison par saison : les épisodes sortis après le dernier vu
// (suivis.js, "vu"). Quelqu'un d'à jour ne voit rien d'autre que « Tu es à jour ».
const JOUR = 86400_000;
let lignesRattrapage = []; // ce qui est affiché (pour « Tout marquer à jour »)

// Épisodes à rattraper pour une saison d'un animé suivi
function aRattraper(suivi, media, sortiesMedia) {
  const numeros = sortiesMedia.map((s) => s.episode);
  const dernier = dernierSorti(media, numeros);
  const vu = suivi.vu?.[media.id];
  if (Number.isInteger(vu)) {
    return { dernier, episodes: Array.from({ length: Math.max(0, dernier - vu) }, (_, i) => vu + 1 + i) };
  }
  // Jamais renseigné : à jour à la date du suivi, on ne compte que ce qui est sorti depuis
  const depuis = Date.parse(suivi.ajouteLe) || 0;
  const apres = sortiesMedia.filter((s) => s.airingAt * 1000 > depuis).map((s) => s.episode);
  return { dernier, episodes: [...new Set(apres)].sort((a, b) => a - b) };
}

async function afficherRattrapage() {
  // Masquée : la section se replie sur son titre et un bouton « Afficher le rattrapage »
  const masque = rattrapageMasque();
  $('rattrapage-corps').hidden = masque;
  $('rattrapage-replie').hidden = !masque;
  $('resume-rattrapage').textContent = '';
  if (masque) return;

  const zone = $('rattrapage-contenu');
  // Les animés déjà « Vu » n'ont rien à rattraper
  const suivis = listeSuivis().filter((a) => !estTermine(a));
  $('tout-a-jour').hidden = true;
  lignesRattrapage = [];

  if (!suivis.length) {
    zone.innerHTML = `<div class="vide"><strong>Tu ne suis encore aucun animé</strong>Ouvre la fiche d'un animé et appuie sur « Suivre » : ses nouveaux épisodes apparaîtront ici.</div>`;
    return;
  }

  zone.innerHTML = '<div class="rattrapage-liste">' + '<div class="squelette" style="height:130px;border-radius:24px"></div>'.repeat(Math.min(suivis.length, 6)) + '</div>';
  try {
    // Calendrier lu depuis le plus ancien suivi sans progression (90 jours maximum)
    const plusAncien = Math.min(...suivis.map((s) => Date.parse(s.ajouteLe) || Date.now()));
    const depuis = new Date(Math.max(plusAncien, Date.now() - 90 * JOUR));
    const ids = [...new Set(suivis.flatMap((a) => [a.id, ...(a.saisons || [])]))];
    const { medias, sorties } = await rattrapage(ids, depuis);

    const parMedia = {};
    for (const s of sorties) (parMedia[s.mediaId] ??= []).push(s);

    const dejaVus = new Set();
    for (const suivi of suivis) {
      const franchise = new Set([suivi.id, ...(suivi.saisons || [])]);
      for (const m of medias.filter((x) => franchise.has(x.id) && !dejaVus.has(x.id))) {
        dejaVus.add(m.id);
        const { dernier, episodes } = aRattraper(suivi, m, parMedia[m.id] || []);
        if (episodes.length) lignesRattrapage.push({ suivi, m, dernier, episodes });
      }
    }
    lignesRattrapage.sort((a, b) => b.episodes.length - a.episodes.length);

    if (!lignesRattrapage.length) {
      zone.innerHTML = '<div class="vide"><strong>Tu es à jour 🎉</strong>Les nouveaux épisodes de tes animés apparaîtront ici dès leur sortie.</div>';
      return;
    }
    const total = lignesRattrapage.reduce((n, l) => n + l.episodes.length, 0);
    const nb = lignesRattrapage.length;
    $('resume-rattrapage').textContent = `${total.toLocaleString('fr-FR')} épisode${total > 1 ? 's' : ''} à rattraper sur ${nb} animé${nb > 1 ? 's' : ''}`;
    $('tout-a-jour').hidden = false;
    zone.innerHTML = `<div class="rattrapage-liste">${lignesRattrapage.map(carteRattrapage).join('')}</div>`;
  } catch (erreur) {
    afficherErreur(zone, erreur, { reessayer: afficherRattrapage });
  }
}

function carteRattrapage({ m, dernier, episodes }, index) {
  const couleur = couleurValide(m.coverImage.color) || '#8b9cff';
  const premier = episodes[0];
  const plage = episodes.length > 1 ? `Épisodes ${premier} à ${episodes[episodes.length - 1]}` : `Épisode ${premier}`;
  const suite = m.nextAiringEpisode
    ? `<small>Prochain : ép. ${m.nextAiringEpisode.episode} dans ${compteARebours(m.nextAiringEpisode.airingAt)}</small>`
    : `<small>${STATUTS_FR[m.status] || ''}</small>`;
  return `
    <div class="rattrapage-carte nouveau" style="--couleur:${couleur}">
      <a href="anime.html?id=${Number(m.id)}" tabindex="-1" aria-hidden="true"><img src="${attributUrl(m.coverImage.large)}" alt="" loading="lazy"></a>
      <div class="infos">
        <a href="anime.html?id=${m.id}"><strong>${echapper(titre(m))}</strong></a>
        <span class="compteur">${episodes.length.toLocaleString('fr-FR')} nouveau${episodes.length > 1 ? 'x' : ''}</span>
        <small>${plage} · ${dernier} sorti${dernier > 1 ? 's' : ''}</small>
        ${suite}
        <button type="button" class="bouton bouton-verre bouton-petit" data-a-jour="${index}">${ICONES.check}Je suis à jour</button>
      </div>
    </div>`;
}

function marquerAJour(lignes) {
  // Regroupé par animé suivi : une seule écriture par franchise
  const parSuivi = new Map();
  for (const { suivi, m, dernier } of lignes) parSuivi.set(suivi.id, { ...(parSuivi.get(suivi.id) || {}), [m.id]: dernier });
  for (const [idSuivi, vus] of parSuivi) enregistrerVus(idSuivi, vus);
  afficherRattrapage();
}

$('rattrapage-contenu').addEventListener('click', (e) => {
  const bouton = e.target.closest('[data-a-jour]');
  if (bouton) marquerAJour([lignesRattrapage[Number(bouton.dataset.aJour)]]);
});
$('tout-a-jour').addEventListener('click', () => marquerAJour(lignesRattrapage));
$('masquer-rattrapage').addEventListener('click', () => masquerRattrapage(true));
$('afficher-rattrapage').addEventListener('click', () => masquerRattrapage(false));
window.addEventListener('radar:preferences', afficherRattrapage);
afficherRattrapage();

// =========================================================
// 3. Explorer : texte + genres/thèmes + filtres
// =========================================================
const formulaire = $('filtres');
const choix = { genres: new Set(), tags: new Set() }; // genres et thèmes cochés
let page = 1;
let requeteActuelle = 0; // pour ignorer les réponses d'une ancienne recherche

// Années : de l'an prochain jusqu'à 1970
const anneeMax = new Date().getFullYear() + 1;
for (let a = anneeMax; a >= 1970; a--) $('f-annee').add(new Option(a, a));

// --- Puces de genres ---
function puce(type, valeur, nom) {
  return `<button type="button" class="puce" data-type="${type}" data-valeur="${echapper(valeur)}" aria-pressed="false">${echapper(nom)}</button>`;
}
const vedettes = new Set(GENRES_VEDETTES.map((g) => g.valeur));
$('puces-vedettes').innerHTML = GENRES_VEDETTES.map((g) => puce(g.type === 'tag' ? 'tags' : 'genres', g.valeur, g.nom)).join('');
$('puces-autres').innerHTML = [
  ...Object.entries(GENRES_FR).filter(([v]) => !vedettes.has(v)).map(([v, nom]) => puce('genres', v, nom)),
  ...Object.entries(TAGS_FR).filter(([v]) => !vedettes.has(v)).map(([v, nom]) => puce('tags', v, nom)),
].join('');

$('voir-plus-genres').addEventListener('click', (e) => {
  const ouvert = $('puces-autres').classList.toggle('ouvert');
  e.target.textContent = ouvert ? 'Moins de genres' : 'Plus de genres et thèmes';
});

formulaire.addEventListener('click', (e) => {
  const bouton = e.target.closest('.puce');
  if (!bouton) return;
  const { type, valeur } = bouton.dataset;
  const actif = !choix[type].has(valeur);
  if (actif) choix[type].add(valeur); else choix[type].delete(valeur);
  bouton.classList.toggle('actif', actif);
  bouton.setAttribute('aria-pressed', actif);
  lancerRecherche();
});

// --- Lecture / écriture des filtres ---
function lireFiltres() {
  return {
    texte: $('f-texte').value,
    genres: [...choix.genres],
    tags: [...choix.tags],
    noteMin: Number($('f-note').value),
    statut: $('f-statut').value,
    annee: $('f-annee').value,
    format: $('f-format').value,
    tri: $('f-tri').value,
  };
}

// Les filtres sont recopiés dans l'adresse : on peut partager ou garder en favori une recherche
function filtresVersUrl(f) {
  const p = new URLSearchParams();
  if (f.texte) p.set('q', f.texte);
  if (f.genres.length) p.set('genres', f.genres.join(','));
  if (f.tags.length) p.set('tags', f.tags.join(','));
  if (f.noteMin) p.set('note', f.noteMin);
  for (const cle of ['statut', 'annee', 'format']) if (f[cle]) p.set(cle, f[cle]);
  if (f.tri !== 'POPULARITY_DESC') p.set('tri', f.tri);
  const query = p.toString();
  history.replaceState(null, '', `${location.pathname}${query ? '?' + query : ''}${location.hash}`);
}

function urlVersFiltres() {
  const p = new URLSearchParams(location.search);
  $('f-texte').value = p.get('q') || '';
  for (const type of ['genres', 'tags']) {
    (p.get(type) || '').split(',').filter(Boolean).forEach((v) => choix[type].add(v));
  }
  $('f-note').value = p.get('note') || 0;
  $('f-statut').value = p.get('statut') || '';
  $('f-annee').value = p.get('annee') || '';
  $('f-format').value = p.get('format') || '';
  $('f-tri').value = p.get('tri') || 'POPULARITY_DESC';

  // Coche les puces correspondantes (et déplie la liste si un genre "caché" est choisi)
  formulaire.querySelectorAll('.puce').forEach((b) => {
    const actif = choix[b.dataset.type].has(b.dataset.valeur);
    b.classList.toggle('actif', actif);
    b.setAttribute('aria-pressed', actif);
    if (actif && b.closest('#puces-autres')) $('puces-autres').classList.add('ouvert');
  });
  afficherValeurNote();
}

function afficherValeurNote() {
  const v = Number($('f-note').value);
  $('valeur-note').textContent = v ? `${note(v)} et +` : 'toutes';
}

// --- Recherche ---
async function lancerRecherche({ ajouter = false } = {}) {
  const filtres = lireFiltres();
  filtresVersUrl(filtres);
  page = ajouter ? page + 1 : 1;
  const numero = ++requeteActuelle;
  const zone = $('resultats');
  const plus = $('charger-plus');

  if (!ajouter) {
    zone.innerHTML = squelettesAffiches(12);
    $('compte').textContent = '';
    $('proposition').innerHTML = '';
  }
  plus.disabled = true;

  try {
    const { suite, medias } = await explorer(filtres, page);
    if (numero !== requeteActuelle) return; // une recherche plus récente a été lancée

    const html = medias.map((m) => carteAffiche(m)).join('');
    if (ajouter) zone.insertAdjacentHTML('beforeend', html);
    else zone.innerHTML = html || '<div class="vide" style="grid-column:1/-1"><strong>Aucun animé ne correspond</strong>Essaie avec moins de filtres.</div>';

    // Le total d'AniList est faux : on n'affiche un nombre que quand on a tout chargé
    const affiches = zone.querySelectorAll('.affiche').length;
    $('compte').textContent = suite ? `${affiches} affichés, et d'autres…` : affiches ? `${affiches} animé${affiches > 1 ? 's' : ''}` : '';
    plus.hidden = !suite;
  } catch (erreur) {
    // Une recherche plus récente a été lancée : on n'y touche pas
    if (!ajouter && numero === requeteActuelle) afficherErreur(zone, erreur, { reessayer: () => { if (numero === requeteActuelle) lancerRecherche(); } });
  }
  plus.disabled = false;
  if (!ajouter) allerAncre();
}

const rechercheTexte = antiRebond(() => lancerRecherche(), 400);
$('f-texte').addEventListener('input', rechercheTexte);
$('f-note').addEventListener('input', afficherValeurNote);
for (const id of ['f-note', 'f-statut', 'f-annee', 'f-format', 'f-tri']) $(id).addEventListener('change', () => lancerRecherche());
formulaire.addEventListener('submit', (e) => { e.preventDefault(); lancerRecherche(); });
formulaire.addEventListener('reset', () => {
  choix.genres.clear();
  choix.tags.clear();
  // Le "reset" du navigateur remet les champs à zéro juste après cet évènement
  setTimeout(() => { urlVersFiltres(); filtresVersUrl(lireFiltres()); lancerRecherche(); });
});
$('charger-plus').addEventListener('click', () => lancerRecherche({ ajouter: true }));

// --- "Propose-moi un animé" : un tirage au hasard qui respecte les filtres ---
$('proposer').addEventListener('click', async () => {
  const bouton = $('proposer');
  const zone = $('proposition');
  bouton.disabled = true;
  try {
    const m = await auHasard({ ...lireFiltres(), texte: '' });
    zone.innerHTML = m ? carteProposition(m) : '<div class="vide" style="margin-bottom:24px"><strong>Aucun animé ne correspond</strong>Essaie avec moins de filtres.</div>';
    $('reproposer')?.addEventListener('click', () => bouton.click());
    zone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (erreur) {
    afficherErreur(zone, erreur);
  }
  bouton.disabled = false;
});

function carteProposition(m) {
  const genres = (m.genres || []).slice(0, 3).map((g) => GENRES_FR[g] || g).join(' · ');
  const meta = [m.averageScore && `★ ${note(m.averageScore)}`, FORMATS_FR[m.format], m.seasonYear, m.episodes && `${m.episodes} ép.`].filter(Boolean).join(' · ');
  return `
    <div class="proposition" style="--couleur:${couleurValide(m.coverImage.color) || '#8b9cff'}">
      <div class="proposition-fond" style="--image:url('${attributUrl(m.bannerImage || m.coverImage.extraLarge)}')"></div>
      <div class="proposition-contenu">
        <img src="${attributUrl(m.coverImage.extraLarge)}" alt="">
        <div>
          <div class="surtitre">Et pourquoi pas…</div>
          <h3>${echapper(titre(m))}</h3>
          <div class="meta"><span>${echapper(meta)}</span>${genres ? `<span>${echapper(genres)}</span>` : ''}</div>
          <p>${echapper(nettoyerSynopsis(m.description))}</p>
          <div class="actions">
            <a class="bouton bouton-plein bouton-petit" href="anime.html?id=${m.id}">${ICONES.info}Voir la fiche</a>
            <button type="button" class="bouton bouton-verre bouton-petit" id="reproposer">${ICONES.de}Un autre</button>
          </div>
        </div>
      </div>
    </div>`;
}

urlVersFiltres();
lancerRecherche();

// =========================================================
// 4. Actus & rumeurs
// =========================================================
monterApercuActus($('filtres-actus'), $('actus-contenu'), 'animes', [
  ['', 'Tout'], ['Nouvelle saison', 'Nouvelles saisons'], ['Nouvel animé', 'Nouveaux animés'], ['Rumeur', 'Rumeurs'], ['Trailer', 'Trailers'], ['Date de sortie', 'Dates'],
]);
