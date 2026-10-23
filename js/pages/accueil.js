// =========================================================
// Page d'accueil : héros, suivis, calendrier, carrousels, genres, actus.
// =========================================================
import { tendancesEtSaison } from '../api/animes.js';
import { sortiesAVenir, sortiesRecentes, relaisConfigure } from '../api/jeux.js';
import { carteJeu, squelettesJeux } from '../ui/cartes-jeux.js';
import { chargerActus, CATEGORIES } from '../api/actus.js';
import { echapper, titre, note, nettoyerSynopsis, afficherErreur } from '../lib/outils.js';
import { FORMATS_FR, SAISONS_FR, GENRES_VEDETTES } from '../lib/traductions.js';
import { listeSuivis } from '../lib/suivis.js';
import { afficherNavigation } from '../ui/nav.js';
import { appliquerAccent } from '../ui/accent.js';
import { carteAffiche, sousTitreGenres, ligneArticle, squelettesAffiches } from '../ui/cartes.js';
import { monterCalendrier, NOTE_HEURES } from '../ui/calendrier.js';
import { brancherBoutonHasard } from '../ui/hasard.js';
import { ICONES } from '../ui/icones.js';

afficherNavigation('accueil');

// ---------- Héros qui défile ----------
const DUREE_DIAPO = 9000;

function monterHeros(medias) {
  const heros = document.getElementById('heros');
  if (!medias.length) return;
  let index = 0;
  let minuteur;

  // Précharge les images pour que le changement soit fluide
  medias.forEach((m) => { new Image().src = m.bannerImage; });

  heros.insertAdjacentHTML('beforeend', `<div class="heros-points">${medias.map((m, i) => `<button type="button" aria-label="Voir ${echapper(titre(m))}"></button>`).join('')}</div>`);
  const points = heros.querySelectorAll('.heros-points button');
  points.forEach((point, i) => point.addEventListener('click', () => { montrer(i); relancer(); }));

  function montrer(i) {
    index = i;
    const m = medias[i];
    appliquerAccent(m.coverImage.color);
    points.forEach((p, j) => p.classList.toggle('actif', j === i));

    const meta = [
      m.averageScore && `<span class="note">★ ${note(m.averageScore)}</span>`,
      m.seasonYear && `<span>${m.seasonYear}</span>`,
      FORMATS_FR[m.format] && `<span>${FORMATS_FR[m.format]}</span>`,
      m.episodes && `<span>${m.episodes} épisodes</span>`,
    ].filter(Boolean).join('');

    // On remplace l'image et le texte (les animations CSS rejouent à chaque fois)
    heros.querySelector('.heros-image')?.remove();
    heros.querySelector('.heros-contenu').remove();
    heros.insertAdjacentHTML('afterbegin', `
      <div class="heros-image" style="--image-large:url('${m.bannerImage}');--image-mobile:url('${m.coverImage.extraLarge}')"></div>
      <div class="heros-contenu">
        <div class="surtitre">N°${i + 1} des tendances</div>
        <h1>${echapper(titre(m))}</h1>
        <div class="meta">${meta}</div>
        <p class="resume">${echapper(nettoyerSynopsis(m.description))}</p>
        <div class="actions">
          <a class="bouton bouton-plein" href="anime.html?id=${m.id}">${ICONES.info}Voir la fiche</a>
          <button type="button" class="bouton bouton-verre" id="hasard">${ICONES.de}Au hasard</button>
        </div>
      </div>`);
    brancherBoutonHasard(document.getElementById('hasard'));
  }

  function relancer() {
    clearInterval(minuteur);
    minuteur = setInterval(() => montrer((index + 1) % medias.length), DUREE_DIAPO);
  }

  // Pause quand la souris est sur le héros (le temps de lire)
  heros.addEventListener('mouseenter', () => clearInterval(minuteur));
  heros.addEventListener('mouseleave', relancer);

  montrer(0);
  relancer();
}

// ---------- Carrousels AniList ----------
async function chargerAnimes() {
  const tendances = document.getElementById('tendances');
  const saison = document.getElementById('saison');
  tendances.innerHTML = saison.innerHTML = squelettesAffiches();
  try {
    const data = await tendancesEtSaison();
    monterHeros(data.tendances.filter((m) => m.bannerImage).slice(0, 5));
    tendances.innerHTML = data.tendances.map((m) => carteAffiche(m)).join('');
    document.getElementById('titre-saison').textContent = `Les mieux notés de la saison ${SAISONS_FR[data.nomSaison]}`;
    saison.innerHTML = data.saison.map((m) => carteAffiche(m, { sous: sousTitreGenres(m) })).join('');
  } catch (erreur) {
    afficherErreur(tendances, erreur);
    saison.innerHTML = '';
    document.getElementById('heros').querySelector('.heros-contenu').innerHTML = `<h1>Radar</h1><p class="resume">${echapper(erreur.message)}</p>`;
  }
}

// ---------- Mes suivis (lus dans le navigateur, sans requête) ----------
function afficherSuivis() {
  const suivis = listeSuivis();
  if (!suivis.length) return;
  document.getElementById('section-suivis').hidden = false;
  document.getElementById('suivis').innerHTML = suivis.slice().reverse().map((s) => `
    <a class="affiche" href="anime.html?id=${s.id}" style="--couleur:${s.couleur || '#1a1a24'}">
      <div class="affiche-image"><img src="${s.image}" alt="" loading="lazy"></div>
      <div class="affiche-titre">${echapper(s.titre)}</div>
    </a>`).join('');
}

// ---------- Genres ----------
function afficherGenres() {
  document.getElementById('genres').innerHTML = GENRES_VEDETTES.map((g) => `
    <a class="genre-tuile" href="animes.html?${g.type === 'tag' ? 'tags' : 'genres'}=${encodeURIComponent(g.valeur)}#explorer" style="--g1:${g.g1};--g2:${g.g2}">
      <span>${g.nom}</span>
    </a>`).join('');
}

// ---------- Aperçu des actus ----------
async function afficherActus() {
  const zone = document.getElementById('apercu-actus');
  const blocs = await Promise.all(Object.entries(CATEGORIES).map(async ([cle, cat]) => {
    try {
      const data = await chargerActus(cle);
      const lignes = data.articles.slice(0, 4).map(ligneArticle).join('');
      return `<div class="bloc-actu" style="--c:${cat.couleur}">
        <h3><i></i>${cat.nom}<a href="actus.html?cat=${cle}">Tout ›</a></h3>${lignes || '<p class="vide">Rien pour le moment.</p>'}</div>`;
    } catch {
      return `<div class="bloc-actu" style="--c:${cat.couleur}"><h3><i></i>${cat.nom}</h3><p class="vide">Actus indisponibles.</p></div>`;
    }
  }));
  zone.innerHTML = blocs.join('');
}

// ---------- Jeux vidéo ----------
async function afficherJeux() {
  if (!relaisConfigure()) {
    // Relais pas encore déployé : on masque simplement les sections jeux
    document.getElementById('section-jeux-avenir').hidden = true;
    document.getElementById('section-jeux-recents').hidden = true;
    return;
  }
  const avenir = document.getElementById('jeux-avenir');
  const recents = document.getElementById('jeux-recents');
  avenir.innerHTML = recents.innerHTML = squelettesJeux(5);
  sortiesAVenir()
    .then((jeux) => { avenir.innerHTML = jeux.slice(0, 15).map((j) => carteJeu(j)).join(''); })
    .catch((erreur) => afficherErreur(avenir, erreur));
  sortiesRecentes()
    .then((jeux) => { recents.innerHTML = jeux.slice(0, 15).map((j) => carteJeu(j)).join(''); })
    .catch((erreur) => afficherErreur(recents, erreur));
}

// ---------- Lancement ----------
afficherSuivis();
afficherGenres();
document.getElementById('note-heures').innerHTML = `${ICONES.horloge}<span>${NOTE_HEURES}</span>`;
monterCalendrier(document.getElementById('jours'), document.getElementById('calendrier'), { seulementPopulaires: true });
brancherBoutonHasard(document.getElementById('surprends-moi'));
chargerAnimes();
afficherJeux();
afficherActus();
