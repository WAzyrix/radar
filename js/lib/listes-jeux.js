// =========================================================
// Mes listes de jeux, stockées dans le navigateur (localStorage).
// Chaque jeu a UN statut : envie, en cours, adoré ou "j'appréhende".
// =========================================================

const CLE = 'radar:jeux';

export const STATUTS_JEU = {
  envie: { nom: "Envie d'y jouer", court: 'Envie', icone: 'coeur' },
  'en-cours': { nom: 'En cours', court: 'En cours', icone: 'manette' },
  adore: { nom: 'Adorés', court: 'Adoré', icone: 'anime' },
  apprehende: { nom: "J'appréhende", court: "J'appréhende", icone: 'info' },
};

export function listeJeux() {
  try {
    return JSON.parse(localStorage.getItem(CLE)) || [];
  } catch {
    return [];
  }
}

export const statutJeu = (id) => listeJeux().find((j) => j.id === id)?.statut;

/** Donne un statut au jeu ; le même statut une 2e fois le retire de mes listes. */
export function changerStatut(jeu, statut) {
  const liste = listeJeux().filter((j) => j.id !== jeu.id);
  const avant = statutJeu(jeu.id);
  if (avant !== statut) {
    liste.push({ id: jeu.id, nom: jeu.name, image: jeu.background_image, sortie: jeu.released, statut, ajouteLe: new Date().toISOString() });
  }
  localStorage.setItem(CLE, JSON.stringify(liste));
  return avant === statut ? undefined : statut;
}
