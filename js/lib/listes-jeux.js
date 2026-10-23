// =========================================================
// Mes listes de jeux : raccourcis vers "Ma liste" (ma-liste.js).
// Chaque jeu a UN statut : envie, en cours, adoré ou "j'appréhende".
// =========================================================
import * as maListe from './ma-liste.js';

export const STATUTS_JEU = {
  envie: { nom: "Envie d'y jouer", court: 'Envie', icone: 'coeur' },
  'en-cours': { nom: 'En cours', court: 'En cours', icone: 'manette' },
  adore: { nom: 'Adorés', court: 'Adoré', icone: 'anime' },
  apprehende: { nom: "J'appréhende", court: "J'appréhende", icone: 'info' },
};

// Format attendu par les pages jeux : { id, nom, image, sortie, statut }
export const listeJeux = () => maListe.items('jeu').map((j) => ({ id: j.id, nom: j.titre, image: j.image, sortie: j.sortie, statut: j.statut }));

export const statutJeu = (id) => maListe.trouver('jeu', id)?.statut;

/** Donne un statut au jeu ; le même statut une 2e fois le retire de mes listes. */
export function changerStatut(jeu, statut) {
  if (statutJeu(jeu.id) === statut) {
    maListe.retirer('jeu', jeu.id);
    return undefined;
  }
  maListe.enregistrer({ type: 'jeu', id: jeu.id, titre: jeu.name, image: jeu.background_image, sortie: jeu.released || undefined, statut });
  return statut;
}
