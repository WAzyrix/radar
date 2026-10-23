// =========================================================
// Traductions des valeurs AniList (qui sont en anglais) + listes pour les filtres.
// =========================================================

export const GENRES_FR = {
  Action: 'Action', Adventure: 'Aventure', Comedy: 'Comédie', Drama: 'Drame', Ecchi: 'Ecchi',
  Fantasy: 'Fantasy', Horror: 'Horreur', 'Mahou Shoujo': 'Magical girl', Mecha: 'Mecha',
  Music: 'Musique', Mystery: 'Mystère', Psychological: 'Psychologique', Romance: 'Romance',
  'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie', Sports: 'Sport',
  Supernatural: 'Surnaturel', Thriller: 'Thriller',
};

// Sur AniList, "isekai" ou "shōnen" ne sont pas des genres mais des TAGS.
// On les présente ensemble à l'utilisateur, le code sait qui est quoi.
export const TAGS_FR = {
  Isekai: 'Isekai', Shounen: 'Shōnen', Seinen: 'Seinen', Shoujo: 'Shōjo', Josei: 'Josei',
  Iyashikei: 'Iyashikei (feel good)', School: 'Vie scolaire', Reincarnation: 'Réincarnation',
  'Time Manipulation': 'Voyage temporel', 'Martial Arts': 'Arts martiaux', 'Super Power': 'Super-pouvoirs',
  Magic: 'Magie', Survival: 'Survie', Revenge: 'Vengeance', Military: 'Militaire', Vampire: 'Vampires',
  Idol: 'Idols', Cultivation: 'Cultivation', 'Video Games': 'Jeux vidéo', Detective: 'Enquête',
};

export const STATUTS_FR = {
  FINISHED: 'Terminé', RELEASING: 'En cours', NOT_YET_RELEASED: 'À venir', CANCELLED: 'Annulé', HIATUS: 'En pause',
};

export const FORMATS_FR = {
  TV: 'Série TV', TV_SHORT: 'Format court', MOVIE: 'Film', SPECIAL: 'Spécial', OVA: 'OVA', ONA: 'ONA',
  MUSIC: 'Clip', MANGA: 'Manga', NOVEL: 'Light novel', ONE_SHOT: 'One-shot',
};

export const RELATIONS_FR = {
  SEQUEL: 'Suite', PREQUEL: 'Préquelle', SIDE_STORY: 'Histoire parallèle', SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Autre version', ADAPTATION: 'Adaptation', SOURCE: 'Œuvre originale', PARENT: 'Œuvre principale',
  SUMMARY: 'Résumé', COMPILATION: 'Compilation', CONTAINS: 'Contient', CHARACTER: 'Personnages', OTHER: 'Autre',
};

export const SAISONS_FR = { WINTER: "d'hiver", SPRING: 'de printemps', SUMMER: "d'été", FALL: "d'automne" };

// Genres mis en avant (tuiles de l'accueil). `type` dit si c'est un genre ou un tag AniList.
export const GENRES_VEDETTES = [
  { nom: 'Isekai', type: 'tag', valeur: 'Isekai', g1: '#5b5bd6', g2: '#9b6bff' },
  { nom: 'Romance', type: 'genre', valeur: 'Romance', g1: '#e2557a', g2: '#ff9a8b' },
  { nom: 'Comédie', type: 'genre', valeur: 'Comedy', g1: '#f5a524', g2: '#ffd66b' },
  { nom: 'Tranche de vie', type: 'genre', valeur: 'Slice of Life', g1: '#2fb27a', g2: '#8de0b3' },
  { nom: 'Shōnen', type: 'tag', valeur: 'Shounen', g1: '#e5484d', g2: '#ff8a3d' },
  { nom: 'Fantasy', type: 'genre', valeur: 'Fantasy', g1: '#3e63dd', g2: '#4cc3ff' },
  { nom: 'Mystère', type: 'genre', valeur: 'Mystery', g1: '#6e56cf', g2: '#d16bff' },
  { nom: 'Science-fiction', type: 'genre', valeur: 'Sci-Fi', g1: '#12a594', g2: '#5fd4c4' },
];
