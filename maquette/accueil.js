// =========================================================
// Page d'accueil de la maquette : héros, calendrier, carrousels.
// =========================================================
import {
  anilist, echapper, titre, note, nettoyerSynopsis, appliquerAccent, carteAffiche,
  afficherNavigation, brancherBoutonHasard, GENRES_FR, FORMATS_FR, ICONES,
} from './commun.js';

afficherNavigation('accueil');

// Saison AniList en cours selon le mois (hiver = janv-mars, etc.)
function saisonActuelle() {
  const d = new Date();
  const saisons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  return { saison: saisons[Math.floor(d.getMonth() / 3)], annee: d.getFullYear() };
}

// Champs communs à toutes les cartes (on les écrit une seule fois)
const CHAMPS_CARTE = 'id title{romaji english} coverImage{extraLarge color} averageScore format seasonYear episodes genres';

async function chargerAccueil() {
  const { saison, annee } = saisonActuelle();
  // Une seule requête pour deux listes, grâce aux alias GraphQL ("tendances:" et "saison:")
  const data = await anilist(`query($saison:MediaSeason, $annee:Int){
    tendances: Page(perPage:20){ media(type:ANIME, sort:TRENDING_DESC, isAdult:false){ ${CHAMPS_CARTE} bannerImage description } }
    saison: Page(perPage:20){ media(type:ANIME, season:$saison, seasonYear:$annee, sort:SCORE_DESC, isAdult:false, popularity_greater:3000){ ${CHAMPS_CARTE} } }
  }`, { saison, annee });

  const tendances = data.tendances.media;
  afficherHeros(tendances.find((m) => m.bannerImage) || tendances[0]);
  document.getElementById('tendances').innerHTML = tendances
    .map((m) => carteAffiche(m, { sous: [FORMATS_FR[m.format], m.seasonYear].filter(Boolean).join(' · ') }))
    .join('');

  const nomsSaisons = { WINTER: "d'hiver", SPRING: 'de printemps', SUMMER: "d'été", FALL: "d'automne" };
  document.getElementById('titre-saison').textContent = `Les mieux notés de la saison ${nomsSaisons[saison]}`;
  document.getElementById('saison').innerHTML = data.saison.media
    .map((m) => carteAffiche(m, { sous: (m.genres || []).slice(0, 2).map((g) => GENRES_FR[g] || g).join(' · ') }))
    .join('');
}

function afficherHeros(m) {
  appliquerAccent(m.coverImage.color);
  const heros = document.getElementById('heros');
  heros.style.setProperty('--image-large', `url("${m.bannerImage || m.coverImage.extraLarge}")`);
  heros.style.setProperty('--image-mobile', `url("${m.coverImage.extraLarge}")`);

  const meta = [
    m.averageScore && `<span class="note">★ ${note(m.averageScore)}</span>`,
    m.seasonYear,
    FORMATS_FR[m.format],
    m.episodes && `${m.episodes} épisodes`,
  ].filter(Boolean).map((x) => `<span>${x}</span>`).join('');

  heros.querySelector('.heros-contenu').innerHTML = `
    <div class="surtitre">N°1 des tendances</div>
    <h1>${echapper(titre(m))}</h1>
    <div class="meta">${meta}</div>
    <p class="resume">${echapper(nettoyerSynopsis(m.description))}</p>
    <div class="actions">
      <a class="bouton bouton-plein" href="anime.html?id=${m.id}">${ICONES.info}Voir la fiche</a>
      <button class="bouton bouton-verre" id="hasard">${ICONES.de}Au hasard</button>
    </div>`;
  brancherBoutonHasard(document.getElementById('hasard'));
}

// ---------- Calendrier ----------
const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const jourSemaine = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

function afficherJours() {
  const conteneur = document.getElementById('jours');
  const noms = { '-1': 'Hier', 0: "Aujourd'hui", 1: 'Demain' };
  for (let decalage = -1; decalage <= 4; decalage++) {
    const date = new Date();
    date.setDate(date.getDate() + decalage);
    const nom = noms[decalage] ?? jourSemaine.format(date).replace(/^./, (c) => c.toUpperCase());
    const bouton = document.createElement('button');
    bouton.className = 'jour' + (decalage === 0 ? ' actif' : '');
    bouton.textContent = nom;
    bouton.addEventListener('click', () => {
      conteneur.querySelector('.actif')?.classList.remove('actif');
      bouton.classList.add('actif');
      chargerCalendrier(decalage);
    });
    conteneur.append(bouton);
  }
}

async function chargerCalendrier(decalage) {
  const zone = document.getElementById('calendrier');
  zone.innerHTML = '<div class="squelette" style="height:112px"></div>'.repeat(4);

  // Début et fin du jour choisi, en heure locale, convertis en timestamp Unix (secondes)
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  debut.setDate(debut.getDate() + decalage);
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + 1);

  const data = await anilist(`query($a:Int, $b:Int){ Page(perPage:50){ airingSchedules(airingAt_greater:$a, airingAt_lesser:$b, sort:TIME){
    episode airingAt media{ id isAdult popularity title{romaji english} coverImage{large color} } } } }`,
  { a: Math.floor(debut / 1000), b: Math.floor(fin / 1000) });

  const maintenant = Date.now() / 1000;
  // On masque les épisodes adultes et les animés très confidentiels
  const episodes = data.Page.airingSchedules.filter((e) => !e.media.isAdult && e.media.popularity > 500);

  if (!episodes.length) { zone.innerHTML = '<p class="note-maquette">Aucun épisode ce jour-là.</p>'; return; }

  zone.innerHTML = episodes.map((e) => {
    const sorti = e.airingAt <= maintenant;
    const bientot = !sorti && e.airingAt - maintenant < 3 * 3600;
    const etat = sorti ? `Sorti à ${heure.format(e.airingAt * 1000)}` : `À ${heure.format(e.airingAt * 1000)}`;
    return `
      <a class="episode" href="anime.html?id=${e.media.id}">
        <img src="${e.media.coverImage.large}" alt="" loading="lazy" style="--couleur:${e.media.coverImage.color || '#1a1a24'}">
        <div class="episode-infos">
          <div class="episode-titre">${echapper(titre(e.media))}</div>
          <div class="episode-ep">Épisode ${e.episode}</div>
          <span class="etat ${sorti ? 'sorti' : bientot ? 'bientot' : ''}">${etat}</span>
        </div>
      </a>`;
  }).join('');

  // Aujourd'hui : on fait défiler jusqu'au prochain épisode à venir
  if (decalage === 0) {
    const index = episodes.findIndex((e) => e.airingAt > maintenant);
    if (index > 0) zone.scrollLeft = zone.children[index].offsetLeft - zone.offsetLeft - 40;
  }
}

// ---------- Lancement ----------
afficherJours();
brancherBoutonHasard(document.getElementById('hasard-lien'));
Promise.all([chargerAccueil(), chargerCalendrier(0)]).catch((erreur) => {
  document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="erreur">Oups : ${echapper(erreur.message)}</div>`);
});
