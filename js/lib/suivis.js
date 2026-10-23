// =========================================================
// Animés (et mangas) suivis : raccourcis vers "Ma liste" (ma-liste.js).
// =========================================================
import * as maListe from './ma-liste.js';

const typeDe = (media) => (media.type === 'MANGA' ? 'manga' : 'anime');

// Animés suivis, au format attendu par le rattrapage et l'accueil
export const listeSuivis = () => maListe.items('anime');
export const idsSuivis = () => listeSuivis().map((s) => s.id);
export const estSuivi = (id, type = 'anime') => Boolean(maListe.trouver(type, id));

/**
 * Suit / ne suit plus un animé ou un manga AniList. Renvoie true s'il est maintenant suivi.
 * `adn` : identifiant de la série sur ADN (pour les notifications VOSTFR/VF).
 */
export function basculerSuivi(media, { adn } = {}) {
  const type = typeDe(media);
  if (maListe.trouver(type, media.id)) {
    maListe.retirer(type, media.id);
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
  });
  return true;
}
