// =========================================================
// Statuts de "Ma liste" selon le type d'œuvre.
// Le premier statut de chaque type est celui par défaut (à l'ajout dans la liste).
// =========================================================
import { STATUTS_JEU } from './listes-jeux.js';

export const STATUTS = {
  anime: { 'a-voir': 'À voir', 'en-cours': 'En cours', vu: 'Vu' },
  serie: { 'a-voir': 'À voir', 'en-cours': 'En cours', vu: 'Vu' },
  film: { 'a-voir': 'À voir', vu: 'Vu' },
  manga: { 'a-lire': 'À lire', 'en-cours': 'En cours', lu: 'Lu' },
  jeu: Object.fromEntries(Object.entries(STATUTS_JEU).map(([cle, s]) => [cle, s.court])),
};

// Statuts "terminé" : l'œuvre ne fait plus partie de ce qu'il reste à voir
export const TERMINES = new Set(['vu', 'lu']);

/** Statut d'un élément (les éléments ajoutés avant les statuts ont celui par défaut). */
export function statutDe(item) {
  const possibles = STATUTS[item.type] || {};
  return possibles[item.statut] ? item.statut : Object.keys(possibles)[0];
}

export const nomStatut = (item) => STATUTS[item.type]?.[statutDe(item)] || '';

/** Statut suivant, pour un bouton qui fait défiler les statuts (À voir → En cours → Vu → À voir). */
export function statutSuivant(item) {
  const cles = Object.keys(STATUTS[item.type] || {});
  return cles[(cles.indexOf(statutDe(item)) + 1) % cles.length];
}

export const estTermine = (item) => TERMINES.has(statutDe(item));

// Trois "étapes" communes à tous les types, pour filtrer Ma liste
export const ETAPES = {
  'a-faire': { nom: 'À voir', statuts: ['a-voir', 'a-lire', 'envie', 'apprehende'] },
  'en-cours': { nom: 'En cours', statuts: ['en-cours'] },
  termine: { nom: 'Vu / terminé', statuts: ['vu', 'lu', 'adore'] },
};
export const etapeDe = (item) => Object.keys(ETAPES).find((e) => ETAPES[e].statuts.includes(statutDe(item)));
