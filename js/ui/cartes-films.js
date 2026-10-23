// =========================================================
// Cartes HTML pour les films et les séries (affiches TMDB, format portrait).
// =========================================================
import { echapper, formatDate } from '../lib/outils.js';
import { TYPES } from '../lib/ma-liste.js';

export const lienFilm = (r) => `film.html?type=${r.type === 'serie' ? 'serie' : 'film'}&id=${Number(r.id)}`;
export const noteFilm = (n) => (n ? String(n).replace('.', ',') : '');

// "Sort demain", "Dans 5 jours", "12 novembre 2026"
export function dateSortieFilm(date) {
  if (!date) return 'Date à venir';
  const jour = new Date(`${date}T12:00:00`);
  const jours = Math.round((jour - Date.now()) / 86400_000);
  if (jours === 0) return "Aujourd'hui";
  if (jours === 1) return 'Demain';
  if (jours > 1 && jours <= 30) return `Dans ${jours} jours`;
  return `${formatDate.format(jour)} ${jour.getFullYear()}`;
}

export function carteFilm(r, { sous, etiquette } = {}) {
  const sousTitre = sous ?? [TYPES[r.type]?.un, r.date?.slice(0, 4)].filter(Boolean).join(' · ');
  return `
    <a class="affiche" href="${lienFilm(r)}" style="--couleur:#1a1a24">
      <div class="affiche-image">
        ${r.image ? `<img src="${echapper(r.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        ${r.note ? `<span class="affiche-note">★ ${noteFilm(r.note)}</span>` : ''}
        ${etiquette ? `<span class="affiche-etiquette">${echapper(etiquette)}</span>` : ''}
      </div>
      <div class="affiche-titre">${echapper(r.titre)}</div>
      ${sousTitre ? `<div class="affiche-sous">${echapper(sousTitre)}</div>` : ''}
    </a>`;
}
