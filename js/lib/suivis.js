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
export function basculerSuivi(media, { adn, saisons } = {}) {
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
  });
  return true;
}

/** Statut de l'animé (ou manga) suivi : à voir, en cours, vu… (undefined s'il n'est pas suivi). */
export function statutSuivi(id, type = 'anime') {
  const suivi = trouverSuivi(id, type);
  return suivi ? (suivi.statut || (type === 'manga' ? 'a-lire' : 'a-voir')) : undefined;
}

export function changerStatutSuivi(id, statut, type = 'anime') {
  const suivi = trouverSuivi(id, type);
  if (suivi) maListe.enregistrer({ type, id: suivi.id, statut });
}
