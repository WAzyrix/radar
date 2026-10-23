// =========================================================
// Animés (et mangas) suivis : raccourcis vers "Ma liste" (ma-liste.js).
// =========================================================
import * as maListe from './ma-liste.js';

const typeDe = (media) => (media.type === 'MANGA' ? 'manga' : 'anime');

// Animés suivis, au format attendu par le rattrapage et l'accueil
export const listeSuivis = () => maListe.items('anime');

// Suivre un animé = suivre toute sa franchise : l'élément de la liste garde les
// identifiants de toutes ses saisons ("saisons"), et le relais y ajoute les suites annoncées.
const trouverSuivi = (id, type = 'anime') => maListe.items(type).find((i) => i.id === id || i.saisons?.includes(id));
export const idsSuivis = () => [...new Set(listeSuivis().flatMap((s) => [s.id, ...(s.saisons || [])]))];
export const estSuivi = (id, type = 'anime') => Boolean(trouverSuivi(id, type));

/** Met à jour la liste des saisons d'un animé suivi. Renvoie true s'il est suivi. */
export function mettreAJourSaisons(id, saisons) {
  const suivi = trouverSuivi(id);
  if (!suivi) return false;
  const nouvelles = [...new Set(saisons)];
  if (JSON.stringify(suivi.saisons || []) !== JSON.stringify(nouvelles)) {
    maListe.enregistrer({ type: 'anime', id: suivi.id, saisons: nouvelles });
  }
  return true;
}

/**
 * Suit / ne suit plus un animé ou un manga AniList. Renvoie true s'il est maintenant suivi.
 * `adn` : identifiant de la série sur ADN (pour les notifications VOSTFR/VF).
 */
export function basculerSuivi(media, { adn, saisons, vu } = {}) {
  const type = typeDe(media);
  const existant = trouverSuivi(media.id, type);
  if (existant) {
    maListe.retirer(type, existant.id); // ne plus suivre = toute la franchise
    return false;
  }
  maListe.enregistrer({
    type,
    id: media.id,
    titre: media.title.english || media.title.romaji,
    titres: [media.title.romaji, media.title.english].filter(Boolean), // pour retrouver le manga sur MangaUpdates
    image: media.coverImage.extraLarge || media.coverImage.large,
    couleur: media.coverImage.color,
    adn,
    saisons: type === 'anime' && saisons?.length ? saisons : undefined,
    vu: type === 'anime' ? vu : undefined,
  });
  return true;
}

// ---------- Progression : dernier épisode vu, saison par saison ----------
// suivi.vu = { "16498": 25, "20958": 3 } (identifiant AniList de la saison -> dernier épisode vu).
// Une saison absente de "vu" est considérée à jour à la date du suivi (ajouteLe) :
// seuls les épisodes sortis APRÈS sont à rattraper.

/** Dernier épisode sorti d'une saison (selon AniList). `numeros` = épisodes connus par le calendrier. */
export function dernierSorti(media, numeros = []) {
  if (media.nextAiringEpisode) return media.nextAiringEpisode.episode - 1;
  if (['FINISHED', 'CANCELLED'].includes(media.status)) return media.episodes || Math.max(0, ...numeros);
  return Math.max(0, ...numeros); // pas encore sorti, ou en pause sans date
}

/** Enregistre le dernier épisode vu pour une ou plusieurs saisons : { idSaison: épisode }. */
export function enregistrerVus(idSuivi, vus) {
  const suivi = trouverSuivi(idSuivi);
  if (!suivi) return;
  maListe.enregistrer({ type: 'anime', id: suivi.id, vu: { ...(suivi.vu || {}), ...vus } });
}

/** Le suivi (franchise) auquel appartient une saison. */
export const suiviDe = (idSaison) => trouverSuivi(idSaison);

/** Statut de l'animé (ou manga) suivi : à voir, en cours, vu… (undefined s'il n'est pas suivi). */
export function statutSuivi(id, type = 'anime') {
  const suivi = trouverSuivi(id, type);
  return suivi ? (suivi.statut || (type === 'manga' ? 'a-lire' : 'a-voir')) : undefined;
}

export function changerStatutSuivi(id, statut, type = 'anime') {
  const suivi = trouverSuivi(id, type);
  if (suivi) maListe.enregistrer({ type, id: suivi.id, statut });
}
