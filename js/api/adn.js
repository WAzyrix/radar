// =========================================================
// Disponibilité en France via ADN (fichier data/adn.json, généré par
// scripts/collecte_adn.py) : heures de sortie VOSTFR/VF et langues par saison.
//
// ADN et AniList n'ont pas d'identifiant commun : on fait correspondre
// les séries par leur TITRE, "nettoyé" (sans accents, ponctuation ni numéro de saison).
// Ça marche dans la grande majorité des cas, mais une série peut être ratée.
// =========================================================
import { normaliser } from '../lib/outils.js';

let promesse;

export function chargerAdn() {
  promesse ??= fetch('data/adn.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => data && preparer(data))
    .catch(() => null); // sans ADN, le site marche quand même
  return promesse;
}

// "Tougen Anki 2nd Season" -> "tougen anki" ; "桃源暗鬼 第2期" -> "桃源暗鬼"
export function cleTitre(titre) {
  return normaliser(titre)
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')                                  // "(2023)", "(TV)"
    .replace(/\b(season|saison|part|partie|cour)\s*\d+\b/g, ' ')  // "season 2", "part 2"
    .replace(/\b\d+(st|nd|rd|th)\s+(season|part|cour)\b/g, ' ')  // "2nd season"
    .replace(/第\s*\d+\s*期/g, ' ')                               // "第2期" (japonais)
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ')       // ponctuation -> espace
    .replace(/\s(ii|iii|iv|v|\d)$/, '')                          // "Overlord II", "Dr. Stone 4"
    // Le japonais en lettres latines s'écrit de plusieurs façons :
    // "Sōsa" / "Sousa" / "Sosa", "wo" / "o"… on ramène tout à une seule forme
    .replace(/ou/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/\bwo\b/g, 'o')
    .replace(/\s+/g, ' ')
    .trim();
}

// Devine le numéro de saison d'une fiche AniList à partir de ses titres
export function numeroSaison(media) {
  const titres = [media.title.english, media.title.romaji, ...(media.synonyms || [])].filter(Boolean).join(' | ');
  const romains = { ii: 2, iii: 3, iv: 4, v: 5 };
  const motifs = [/season\s*(\d+)/i, /saison\s*(\d+)/i, /(\d+)(?:st|nd|rd|th)\s+season/i, /\s(ii|iii|iv|v)(?:\s|$|:)/i];
  for (const motif of motifs) {
    const trouve = titres.match(motif);
    if (trouve) return Number(trouve[1]) || romains[trouve[1].toLowerCase()];
  }
  return 1;
}

function preparer(data) {
  const index = new Map();
  for (const serie of data.series) {
    for (const titre of [serie.titre, serie.titreOriginal]) {
      const cle = titre && cleTitre(titre);
      if (cle && !index.has(cle)) index.set(cle, serie);
    }
  }
  return { ...data, index };
}

/** La série ADN qui correspond à un média AniList (ou undefined). */
export function trouverSerie(adn, media) {
  if (!adn) return undefined;
  const titres = [media.title.english, media.title.romaji, media.title.native, ...(media.synonyms || [])].filter(Boolean);
  // 1er essai : titre complet. 2e essai : sans le sous-titre ("TOUGEN ANKI: Nikko Kegon Falls Arc" -> "TOUGEN ANKI")
  const essais = [...titres, ...titres.filter((t) => t.includes(':')).map((t) => t.split(':')[0])];
  for (const titre of essais) {
    const cle = cleTitre(titre);
    const serie = cle.length >= 3 && adn.index.get(cle);
    if (serie) return serie;
  }
  return undefined;
}

/** La sortie ADN d'un épisode précis (à moins de 4 jours de la diffusion japonaise). */
export function sortieEpisode(adn, serie, numero, airingAt) {
  if (!serie) return undefined;
  return adn.sorties.find((s) => s.serie === serie.id
    && String(s.episode) === String(numero)
    && Math.abs(new Date(s.date) / 1000 - airingAt) < 4 * 86400);
}

/** Dernière sortie ADN (passée) de cette série, dans la fenêtre du calendrier. */
export function derniereSortie(adn, serie) {
  if (!serie) return undefined;
  const maintenant = Date.now();
  return adn.sorties
    .filter((s) => s.serie === serie.id && new Date(s.date) <= maintenant)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}

/** Prochain épisode à sortir sur ADN pour cette série. */
export function prochaineSortie(adn, serie) {
  if (!serie) return undefined;
  const maintenant = Date.now();
  return adn.sorties
    .filter((s) => s.serie === serie.id && new Date(s.date) > maintenant)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
}
