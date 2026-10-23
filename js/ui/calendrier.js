// =========================================================
// Calendrier des épisodes (utilisé sur l'accueil ET sur la page Animés).
// Une rangée de "jours" cliquables + la liste des épisodes du jour choisi.
// =========================================================
import { calendrierDuJour } from '../api/animes.js';
import { chargerAdn, trouverSerie, sortieEpisode } from '../api/adn.js';
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
export function monterCalendrier(jours, zone, { seulementPopulaires = false, filtreSuivis = null, de = -1, a = 5, quandAffiche = () => {} } = {}) {
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
      // Les deux en parallèle : épisodes AniList + sorties françaises ADN
      let [episodes, adn] = await Promise.all([calendrierDuJour(decalage), chargerAdn()]);
      if (decalage !== decalageActif) return; // un autre jour a été cliqué entre-temps

      const suivis = new Set(idsSuivis());
      if (seulementPopulaires) episodes = episodes.filter((e) => e.media.popularity > 500 || suivis.has(e.media.id));
      if (filtreSuivis?.checked) episodes = episodes.filter((e) => suivis.has(e.media.id));

      if (!episodes.length) {
        zone.innerHTML = `<div class="vide"><strong>Aucun épisode</strong>${filtreSuivis?.checked ? 'Aucun de tes animés suivis ne sort ce jour-là.' : 'Rien de prévu ce jour-là.'}</div>`;
        return;
      }
      zone.innerHTML = episodes.map((e) => carteEpisode(e, {
        suivi: suivis.has(e.media.id),
        adn: adn && sortieEpisode(adn, trouverSerie(adn, e.media), e.episode, e.airingAt),
      })).join('');

      // Aujourd'hui : on amène le prochain épisode à venir en vue (dans un carrousel)
      if (decalage === 0 && zone.classList.contains('carrousel')) {
        const index = episodes.findIndex((e) => e.airingAt > Date.now() / 1000);
        if (index > 0) zone.scrollLeft = zone.children[index].offsetLeft - zone.offsetLeft - 40;
      }
    } catch (erreur) {
      afficherErreur(zone, erreur);
    }
    quandAffiche();
  }

  afficher();
}

// Texte d'explication sur les heures (affiché sous les calendriers)
export const NOTE_HEURES = "« TV Japon » : diffusion au Japon, convertie à ton heure. « ADN » : sortie en France sur ADN (VOSTFR/VF), quand l'animé y est. Crunchyroll ne publie pas ses horaires : ses simulcasts sortent en général dans les heures qui suivent le Japon.";
