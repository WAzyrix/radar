// =========================================================
// Calendrier des épisodes (utilisé sur l'accueil ET sur la page Animés).
// Une rangée de "jours" cliquables + la liste des épisodes du jour choisi.
// =========================================================
import { calendrierDuJour } from '../api/animes.js';
import { formatJour, premiereMajuscule, afficherErreur } from '../lib/outils.js';
import { idsSuivis } from '../lib/suivis.js';
import { carteEpisode, squelettesEpisodes } from './cartes.js';

const NOMS = { '-1': 'Hier', 0: "Aujourd'hui", 1: 'Demain' };

/**
 * @param {HTMLElement} jours      conteneur des boutons de jours
 * @param {HTMLElement} zone       conteneur des épisodes
 * @param {object} options
 *   - seulementPopulaires : masque les animés très confidentiels (pour l'accueil)
 *   - filtreSuivis        : case à cocher "seulement mes suivis" (facultatif)
 */
export function monterCalendrier(jours, zone, { seulementPopulaires = false, filtreSuivis = null, de = -1, a = 5 } = {}) {
  let decalageActif = 0;

  for (let decalage = de; decalage <= a; decalage++) {
    const date = new Date();
    date.setDate(date.getDate() + decalage);
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = NOMS[decalage] ?? premiereMajuscule(formatJour.format(date));
    bouton.classList.toggle('actif', decalage === 0);
    bouton.addEventListener('click', () => {
      jours.querySelector('.actif')?.classList.remove('actif');
      bouton.classList.add('actif');
      decalageActif = decalage;
      afficher();
    });
    jours.append(bouton);
  }

  filtreSuivis?.addEventListener('change', afficher);

  async function afficher() {
    const decalage = decalageActif;
    zone.innerHTML = squelettesEpisodes();
    try {
      let episodes = await calendrierDuJour(decalage);
      if (decalage !== decalageActif) return; // un autre jour a été cliqué entre-temps

      const suivis = new Set(idsSuivis());
      if (seulementPopulaires) episodes = episodes.filter((e) => e.media.popularity > 500 || suivis.has(e.media.id));
      if (filtreSuivis?.checked) episodes = episodes.filter((e) => suivis.has(e.media.id));

      if (!episodes.length) {
        zone.innerHTML = `<div class="vide"><strong>Aucun épisode</strong>${filtreSuivis?.checked ? 'Aucun de tes animés suivis ne sort ce jour-là.' : 'Rien de prévu ce jour-là.'}</div>`;
        return;
      }
      zone.innerHTML = episodes.map((e) => carteEpisode(e, { suivi: suivis.has(e.media.id) })).join('');

      // Aujourd'hui : on amène le prochain épisode à venir en vue (dans un carrousel)
      if (decalage === 0 && zone.classList.contains('carrousel')) {
        const index = episodes.findIndex((e) => e.airingAt > Date.now() / 1000);
        if (index > 0) zone.scrollLeft = zone.children[index].offsetLeft - zone.offsetLeft - 40;
      }
    } catch (erreur) {
      afficherErreur(zone, erreur);
    }
  }

  afficher();
}

// Texte d'explication sur les heures (affiché sous les calendriers)
export const NOTE_HEURES = "Heure de diffusion TV au Japon, convertie à ton heure. La VOSTFR (Crunchyroll, ADN, sites de streaming…) arrive en général un peu plus tard.";
