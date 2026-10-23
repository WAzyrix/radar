// =========================================================
// Fiche animé : « Regarder les épisodes » sur les plateformes officielles.
//
// Données AniList, saison par saison :
//  - externalLinks (type STREAMING) : la page de la série sur Crunchyroll, Netflix… ;
//  - streamingEpisodes : un lien par épisode (surtout Crunchyroll).
// Complété par la série ADN trouvée dans notre catalogue (langues VOSTFR/VF).
// Le prochain épisode à voir vient de la progression du rattrapage (suivis.js, "vu").
//
// Les adresses viennent d'AniList : seules les https:// (ou http:// converties) sont gardées,
// et tout est échappé.
// =========================================================
import { episodesStreaming } from '../api/animes.js';
import { echapper, compteARebours, afficherErreur, el } from '../lib/outils.js';
import { dernierSorti, suiviDe, enregistrerVus } from '../lib/suivis.js';
import { badgesLangues } from './cartes.js';
import { ICONES } from './icones.js';

// Plateformes disponibles en France, dans l'ordre où on les propose
const EN_FRANCE = ['Crunchyroll', 'ADN', 'Animation Digital Network', 'Netflix', 'Disney Plus', 'Amazon Prime Video', 'HIDIVE'];
const NOMS = { 'Animation Digital Network': 'ADN', 'Disney Plus': 'Disney+', 'Amazon Prime Video': 'Prime Video' };
const nom = (site) => NOMS[site] || site;

function adresse(url) {
  const propre = String(url || '').trim().replace(/^http:\/\//i, 'https://');
  return /^https:\/\/[^\s"'<>]+$/i.test(propre) ? propre : null;
}

// Numéro d'épisode dans "Episode 12 - Titre" / "Épisode 12" / "Ep. 12"
const numero = (titre) => Number(String(titre).match(/(?:[ée]pisode|ep\.?)\s*(\d+)/i)?.[1]) || null;

/**
 * Prépare les liens d'une saison. `dejaVus` : adresses d'épisodes déjà attribuées à une autre
 * saison (AniList recopie parfois les épisodes de la saison 1 dans la saison 2).
 */
function preparer(media, dejaVus) {
  const vus = new Set();
  const liens = (media.externalLinks || [])
    .filter((l) => l.type === 'STREAMING' && adresse(l.url) && !vus.has(nom(l.site)) && vus.add(nom(l.site)))
    .map((l) => ({ site: nom(l.site), url: adresse(l.url), france: EN_FRANCE.includes(l.site) }))
    .sort((a, b) => (EN_FRANCE.indexOf(a.site) + 1 || 99) - (EN_FRANCE.indexOf(b.site) + 1 || 99));

  // Épisodes : écartés s'il y en a plus que la saison n'en compte, ou s'ils sont ceux d'une autre saison
  let episodes = (media.streamingEpisodes || [])
    .map((e, i) => ({ titre: String(e.title || ''), url: adresse(e.url), site: nom(e.site), ordre: numero(e.title) ?? i + 1 }))
    .filter((e) => e.url);
  const tropNombreux = media.episodes && episodes.length > media.episodes;
  const empruntes = episodes.length && episodes.every((e) => dejaVus.has(e.url));
  if (tropNombreux || empruntes) episodes = [];
  episodes.forEach((e) => dejaVus.add(e.url));
  // Numérotation parfois continue d'une saison à l'autre (saison 2 = « Episode 13… ») : on range par ordre
  episodes.sort((a, b) => a.ordre - b.ordre);
  return { liens, episodes };
}

// Lien vers l'épisode n (s'il est connu), sinon vers la série sur la 1re plateforme française
function lienEpisode(saison, n) {
  const episode = saison.episodes[n - 1];
  if (episode) return { url: episode.url, site: episode.site, direct: true };
  const plateforme = saison.liens.find((l) => l.france) || saison.liens[0];
  return plateforme ? { url: plateforme.url, site: plateforme.site, direct: false } : null;
}

function ligneSaison(s, { courante, suivi }) {
  const dernier = dernierSorti(s.media);
  const vu = suivi?.vu?.[s.media.id];
  // Prochain à voir : d'après la progression du rattrapage ; sans progression, l'épisode 1
  const prochain = Number.isInteger(vu) ? vu + 1 : 1;
  const aJour = Number.isInteger(vu) && prochain > dernier;
  const lien = !aJour && dernier >= 1 ? lienEpisode(s, prochain) : null;
  const film = s.media.format === 'MOVIE' || s.media.episodes === 1;
  const texteBouton = film ? 'Regarder' : Number.isInteger(vu) ? `Reprendre : ép. ${prochain}` : 'Commencer : ép. 1';

  let action;
  if (!dernier) action = '<span class="mention">Pas encore diffusée</span>';
  else if (aJour) {
    action = `<span class="pastille accent">${ICONES.check}À jour</span>`
      + (s.media.nextAiringEpisode ? `<small>Ép. ${s.media.nextAiringEpisode.episode} dans ${compteARebours(s.media.nextAiringEpisode.airingAt)}</small>` : '');
  } else {
    action = `
      ${lien ? `<a class="bouton bouton-plein bouton-petit" href="${echapper(lien.url)}" target="_blank" rel="noopener noreferrer" title="${lien.direct ? `Épisode ${prochain} sur ${echapper(lien.site)}` : `La série sur ${echapper(lien.site)} (lien direct vers l'épisode inconnu)`}">
        ${ICONES.lecture}${texteBouton}<small>${echapper(lien.site)}</small></a>
        ${suivi && !film && !Number.isInteger(vu) ? '<small>progression non renseignée</small>' : ''}`
    : `<span class="mention">${Number.isInteger(vu) ? `Prochain : ép. ${prochain}` : 'Épisode 1'} · aucune plateforme connue</span>`}
      ${suivi ? `<button type="button" class="bouton bouton-verre bouton-petit" data-vu="${s.media.id}" data-episode="${prochain}" title="Marquer l'épisode ${prochain} comme vu">${ICONES.check}Vu</button>` : ''}`;
  }

  const plateformes = s.liens.map((l) => `<a class="pastille ${l.france ? '' : 'hors-france'}" href="${echapper(l.url)}" target="_blank" rel="noopener noreferrer"${l.france ? '' : ' title="Pas forcément disponible en France"'}>${echapper(l.site)}</a>`).join('')
    + (s.adn ? `<a class="pastille" href="${echapper(s.adn.url)}" target="_blank" rel="noopener noreferrer">ADN ${badgesLangues(s.adn.langues)}</a>` : '');

  // Le nom de la plateforme sur chaque épisode, seulement s'il y en a plusieurs
  const plusieursSites = new Set(s.episodes.map((e) => e.site)).size > 1;
  const liste = s.episodes.length ? `
    <details class="episodes-liste">
      <summary>Tous les épisodes (${s.episodes.length})${plusieursSites ? '' : ` sur ${echapper(s.episodes[0].site)}`}</summary>
      <ol>${s.episodes.map((e, i) => `
        <li class="${Number.isInteger(vu) && i + 1 <= vu ? 'vu' : ''}">
          <a href="${echapper(e.url)}" target="_blank" rel="noopener noreferrer"><b>${i + 1}</b>${echapper(e.titre.replace(/^(?:[ée]pisode|ep\.?)\s*\d+\s*[-–:]\s*/i, '') || `Épisode ${i + 1}`)}${plusieursSites ? `<small>${echapper(e.site)}</small>` : ''}</a>
        </li>`).join('')}</ol>
    </details>` : '';

  return `
    <div class="saison-streaming ${courante ? 'courante' : ''}">
      <div class="saison-streaming-tete">
        <div><b>${film ? 'Le film' : s.unique ? 'Épisodes' : `Saison ${s.numero}`}</b><small>${[!film && s.media.episodes && `${s.media.episodes} épisode${s.media.episodes > 1 ? 's' : ''}`, courante && 'cette fiche'].filter(Boolean).join(' · ')}</small></div>
        <div class="saison-streaming-action">${action}</div>
      </div>
      ${plateformes ? `<div class="plateformes">${plateformes}</div>` : '<p class="mention" style="margin:6px 0 0">Aucune plateforme officielle référencée par AniList.</p>'}
      ${liste}
    </div>`;
}

/**
 * Remplit la carte. `saisons` : saisons de la franchise dans l'ordre (ou juste l'animé affiché),
 * `serieAdn` : série ADN trouvée pour cet animé (ou undefined).
 * `apresVu` : appelée quand on marque un épisode vu (pour rafraîchir le reste de la fiche).
 */
export async function monterEpisodes(zone, { saisons, idCourant, serieAdn, apresVu }) {
  zone.hidden = false;
  zone.innerHTML = '<h2>Regarder les épisodes</h2><div class="squelette" style="height:120px;border-radius:18px"></div>';
  let medias;
  try {
    // Les saisons chargées par la fiche ont déjà leurs liens : pas de requête en plus
    medias = saisons.every((s) => Array.isArray(s.streamingEpisodes)) ? saisons : await episodesStreaming(saisons.map((s) => s.id));
  } catch (erreur) {
    const message = el('div');
    zone.replaceChildren(el('h2', {}, 'Regarder les épisodes'), message);
    afficherErreur(message, erreur, { reessayer: () => monterEpisodes(zone, { saisons, idCourant, serieAdn, apresVu }) });
    return;
  }
  const parId = new Map(medias.map((x) => [x.id, x]));
  const dejaVus = new Set();
  const lignes = saisons.map((s, i) => ({ media: parId.get(s.id), numero: i + 1 })).filter((l) => l.media).map(({ media, numero: n }) => ({
    media,
    numero: n,
    ...preparer(media, dejaVus),
    // ADN numérote ses saisons comme nous (1, 2, 3…) : on n'affiche que la saison correspondante
    adn: serieAdn && serieAdn.saisons?.[String(n)] && adresse(serieAdn.url) ? { url: adresse(serieAdn.url), langues: serieAdn.saisons[String(n)] } : null,
  }));
  if (!lignes.some((l) => l.liens.length || l.episodes.length || l.adn)) {
    zone.innerHTML = '<h2>Regarder les épisodes</h2><p class="mention" style="margin-top:0">AniList ne référence aucune plateforme officielle pour cet animé.</p>';
    return;
  }

  const afficher = () => {
    const suivi = suiviDe(idCourant);
    zone.innerHTML = `
      <h2>Regarder les épisodes</h2>
      <p class="mention" style="margin-top:0">${suivi
    ? 'Le prochain épisode à voir suit ta progression du rattrapage. « Vu » la met à jour.'
    : 'Suis cet animé pour retrouver ici le prochain épisode à voir.'}</p>
      ${lignes.map((l) => ligneSaison({ ...l, unique: lignes.length === 1 }, { courante: l.media.id === idCourant && lignes.length > 1, suivi })).join('')}
      <p class="mention">Liens fournis par AniList (épisode par épisode surtout pour Crunchyroll) ; catalogues variables selon les pays.</p>`;
  };
  afficher();
  // Progression changée ailleurs (« Tu en es où ? », Suivre, autre appareil) : on suit
  const surListe = () => {
    if (!zone.isConnected) { window.removeEventListener('radar:liste', surListe); return; } // fiche remplacée
    afficher();
  };
  window.addEventListener('radar:liste', surListe);

  zone.onclick = (e) => {
    const bouton = e.target.closest('[data-vu]');
    const suivi = suiviDe(idCourant);
    if (!bouton || !suivi) return;
    enregistrerVus(suivi.id, { [bouton.dataset.vu]: Number(bouton.dataset.episode) });
    afficher();
    apresVu?.();
  };
}
