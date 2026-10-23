// =========================================================
// Lecture des actus : fichiers JSON générés toutes les heures
// par scripts/collecte.py (via GitHub Actions) dans data/.
// =========================================================

// Réglages d'affichage de chaque catégorie (le contenu, lui, vient du JSON)
export const CATEGORIES = {
  animes: { nom: 'Actu animés', court: 'Animés', couleur: '#c79bff', icone: 'anime', description: 'Nouvelles saisons, nouveaux animés, trailers, doublage… et rumeurs de sources fiables uniquement.' },
  jeux: { nom: 'Jeux vidéo', court: 'Jeux', couleur: '#6ee7a8', icone: 'manette', description: 'Sorties, annonces, tests, consoles et scène jailbreak/homebrew : Nintendo, PlayStation, Xbox, PC.' },
  cinema: { nom: 'Films & séries', court: 'Films', couleur: '#ff7ab6', icone: 'film', description: "L'actu ciné et séries : sorties, bandes-annonces, plateformes." },
  cyber: { nom: 'Cyber & info', court: 'Cyber', couleur: '#4cc3ff', icone: 'cyber', description: 'Failles, CVE, ransomwares, jailbreaks et outils.' },
  monde: { nom: 'Actu', court: 'Actu', couleur: '#ffb84d', icone: 'monde', description: "L'essentiel de l'actualité, en France, aux États-Unis et dans le monde." },
};

export const ZONES = { france: 'France', usa: 'États-Unis', monde: 'Monde' };

const memoire = {}; // évite de retélécharger le même fichier pendant la visite

export function chargerActus(categorie) {
  if (!CATEGORIES[categorie]) return Promise.reject(new Error('Catégorie inconnue'));
  // "no-cache" : le navigateur vérifie auprès du serveur s'il y a une version plus récente
  memoire[categorie] ??= fetch(`data/${categorie}.json`, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`Actus indisponibles (${r.status})`);
    return r.json();
  });
  return memoire[categorie];
}
