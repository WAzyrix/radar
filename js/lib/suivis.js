// =========================================================
// Animés suivis, stockés dans le navigateur (localStorage).
// On garde le titre et l'image pour pouvoir les afficher sans appeler AniList.
// (En V2, ce module sera enrichi pour la watchlist ; en V3 il ira dans Supabase.)
// =========================================================

const CLE = 'radar:suivis';

export function listeSuivis() {
  try {
    return JSON.parse(localStorage.getItem(CLE)) || [];
  } catch {
    return [];
  }
}

export const estSuivi = (id) => listeSuivis().some((s) => s.id === id);

export const idsSuivis = () => listeSuivis().map((s) => s.id);

function enregistrer(liste) {
  localStorage.setItem(CLE, JSON.stringify(liste));
}

/** Ajoute ou retire un animé. Renvoie true s'il est maintenant suivi. */
export function basculerSuivi(media) {
  const liste = listeSuivis();
  const index = liste.findIndex((s) => s.id === media.id);
  if (index !== -1) {
    liste.splice(index, 1);
    enregistrer(liste);
    return false;
  }
  liste.push({
    id: media.id,
    titre: media.title.english || media.title.romaji,
    image: media.coverImage.extraLarge || media.coverImage.large,
    couleur: media.coverImage.color,
    ajouteLe: new Date().toISOString(),
  });
  enregistrer(liste);
  return true;
}
