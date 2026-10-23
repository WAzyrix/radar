// =========================================================
// Cartes HTML pour les jeux vidéo.
// Les visuels RAWG sont en format paysage (16:9) : cartes plus larges que les affiches d'animés.
// =========================================================
import { echapper, formatDate } from '../lib/outils.js';
import { couleurMetacritic, GENRES_JEUX } from '../lib/traductions-jeux.js';
import { STATUTS_JEU } from '../lib/listes-jeux.js';

// Petite image : RAWG sait renvoyer une version réduite (bien plus légère)
// ".../media/games/ab/xyz.jpg" -> ".../media/crop/600/400/games/ab/xyz.jpg"
export const imageReduite = (url) => (url || '').replace(/\/media\/(games|screenshots)\//, '/media/crop/600/400/$1/');

// `enLigne` : dans une ligne de texte (et pas en coin d'une image)
export function badgeMetacritic(note, { enLigne = false } = {}) {
  return note ? `<span class="metacritic ${enLigne ? 'en-ligne' : ''}" style="--mc:${couleurMetacritic(note)}" title="Note Metacritic">${note}</span>` : '';
}

// "12 nov. 2026", "dans 5 jours", "Date à venir"
export function dateSortie(jeu) {
  if (!jeu.released || jeu.tba) return 'Date à venir';
  const date = new Date(`${jeu.released}T12:00:00`);
  const jours = Math.round((date - Date.now()) / 86400_000);
  if (jours === 0) return "Sort aujourd'hui";
  if (jours === 1) return 'Sort demain';
  if (jours > 1 && jours <= 30) return `Dans ${jours} jours`;
  return `${formatDate.format(date)} ${date.getFullYear()}`;
}

export const plateformesCourtes = (jeu) => (jeu.parent_platforms || []).map((p) => p.platform.name).join(' · ');

export function carteJeu(jeu, { sous, statut } = {}) {
  const genres = (jeu.genres || []).slice(0, 2).map((g) => GENRES_JEUX[g.slug] || g.name).join(' · ');
  return `
    <a class="carte-jeu" href="jeu.html?id=${jeu.id}">
      <div class="carte-jeu-image">
        ${jeu.background_image ? `<img src="${imageReduite(jeu.background_image)}" alt="" loading="lazy">` : ''}
        ${badgeMetacritic(jeu.metacritic)}
        ${statut ? `<span class="affiche-etiquette">${STATUTS_JEU[statut].court}</span>` : ''}
      </div>
      <div class="affiche-titre">${echapper(jeu.name)}</div>
      <div class="affiche-sous">${echapper(sous ?? [dateSortie(jeu), genres].filter(Boolean).join(' · '))}</div>
    </a>`;
}

// Carte d'un jeu de mes listes (on a seulement nom, image et date en local)
export function carteJeuListe(j) {
  return carteJeu({ id: j.id, name: j.nom, background_image: j.image, released: j.sortie }, { statut: j.statut });
}

export const squelettesJeux = (n = 6) => '<div><div class="squelette" style="aspect-ratio:16/10"></div><div class="squelette" style="height:14px;margin-top:10px;width:70%"></div></div>'.repeat(n);
