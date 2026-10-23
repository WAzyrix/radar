// =========================================================
// Fabriques de cartes HTML réutilisées sur plusieurs pages.
// Chaque fonction reçoit des données et renvoie une chaîne HTML.
// =========================================================
import { echapper, titre, note, formatHeure, ilYa } from '../lib/outils.js';
import { FORMATS_FR, GENRES_FR } from '../lib/traductions.js';
import { ZONES } from '../api/actus.js';
import { ICONES } from './icones.js';

// Affiche d'animé (carrousels, grilles)
export function carteAffiche(media, { sous, etiquette = '' } = {}) {
  const couleur = media.coverImage.color || '#1a1a24';
  const image = media.coverImage.extraLarge || media.coverImage.large;
  const sousTitre = sous ?? [FORMATS_FR[media.format], media.seasonYear].filter(Boolean).join(' · ');
  return `
    <a class="affiche" href="anime.html?id=${media.id}" style="--couleur:${couleur}">
      <div class="affiche-image">
        <img src="${image}" alt="" loading="lazy">
        ${media.averageScore ? `<span class="affiche-note">★ ${note(media.averageScore)}</span>` : ''}
        ${etiquette ? `<span class="affiche-etiquette">${echapper(etiquette)}</span>` : ''}
      </div>
      <div class="affiche-titre">${echapper(titre(media))}</div>
      ${sousTitre ? `<div class="affiche-sous">${echapper(sousTitre)}</div>` : ''}
    </a>`;
}

export const sousTitreGenres = (media) => (media.genres || []).slice(0, 2).map((g) => GENRES_FR[g] || g).join(' · ');

// Épisode du calendrier. `suivi` = mis en valeur si l'animé est dans mes suivis.
export function carteEpisode(e, { suivi = false } = {}) {
  const maintenant = Date.now() / 1000;
  const sorti = e.airingAt <= maintenant;
  const bientot = !sorti && e.airingAt - maintenant < 3 * 3600;
  const heure = formatHeure.format(e.airingAt * 1000);
  const total = e.media.episodes ? ` / ${e.media.episodes}` : '';
  return `
    <a class="episode ${suivi ? 'suivi' : ''}" href="anime.html?id=${e.media.id}">
      <img src="${e.media.coverImage.large}" alt="" loading="lazy" style="--couleur:${e.media.coverImage.color || '#1a1a24'}">
      <div class="episode-infos">
        <div class="episode-titre">${echapper(titre(e.media))}</div>
        <div class="episode-ep">Épisode ${e.episode}${total}</div>
        <span class="etat ${sorti ? 'sorti' : bientot ? 'bientot' : ''}">${sorti ? `Diffusé à ${heure}` : `À ${heure}`}</span>
      </div>
      ${suivi ? `<span class="badge-suivi" title="Tu suis cet animé">${ICONES.coeur}</span>` : ''}
    </a>`;
}

// Couleur stable pour chaque source (calculée à partir de son nom)
export function couleurSource(nom) {
  let h = 0;
  for (const c of nom) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 75% 65%)`;
}

// Article d'actu : uniquement titre, source, date, extrait court et lien (droits d'auteur)
export function carteArticle(a) {
  const zone = a.zone ? ` · ${ZONES[a.zone]}` : '';
  return `
    <a class="article" href="${echapper(a.lien)}" target="_blank" rel="noopener noreferrer" style="--c:${couleurSource(a.source)}">
      <div class="article-source"><b>${echapper(a.source)}</b><span>${ilYa(a.date)}${zone}</span></div>
      <h3>${echapper(a.titre)}</h3>
      ${a.extrait ? `<p>${echapper(a.extrait)}</p>` : ''}
      ${a.tags.length ? `<div class="article-tags">${a.tags.map((t) => `<span class="tag">${echapper(t)}</span>`).join('')}</div>` : ''}
    </a>`;
}

// Version compacte d'un article (aperçu sur l'accueil)
export function ligneArticle(a) {
  return `
    <a class="article-ligne" href="${echapper(a.lien)}" target="_blank" rel="noopener noreferrer">
      <strong>${echapper(a.titre)}</strong>
      <small>${a.tags[0] ? `<span class="tag">${echapper(a.tags[0])}</span>` : ''}${echapper(a.source)} · ${ilYa(a.date)}</small>
    </a>`;
}

// Squelettes affichés pendant le chargement
export const squelettesAffiches = (n = 8) => '<div><div class="squelette" style="aspect-ratio:2/3"></div><div class="squelette" style="height:14px;margin-top:10px;width:80%"></div></div>'.repeat(n);
export const squelettesEpisodes = (n = 4) => '<div class="squelette" style="height:112px;border-radius:24px"></div>'.repeat(n);
