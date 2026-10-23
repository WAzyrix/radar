// =========================================================
// Jeux vidéo : traductions RAWG + "comment y jouer" (rétro / émulation).
// =========================================================

// Genres RAWG (slug -> nom affiché)
export const GENRES_JEUX = {
  action: 'Action', adventure: 'Aventure', 'role-playing-games-rpg': 'RPG', shooter: 'Tir',
  platformer: 'Plateformes', indie: 'Indé', strategy: 'Stratégie', simulation: 'Simulation',
  puzzle: 'Réflexion', racing: 'Course', sports: 'Sport', fighting: 'Combat', arcade: 'Arcade',
  casual: 'Détente', family: 'Famille', 'massively-multiplayer': 'MMO', 'board-games': 'Jeux de société',
  card: 'Cartes', educational: 'Éducatif',
};

// Familles de plateformes RAWG (id -> nom)
export const PLATEFORMES = {
  1: 'PC', 2: 'PlayStation', 3: 'Xbox', 7: 'Nintendo', 4: 'iOS', 8: 'Android', 5: 'Mac', 6: 'Linux',
};

// Avis des joueurs RAWG
export const NOTES_RAWG = {
  exceptional: { nom: 'Exceptionnel', couleur: '#5ee69a' },
  recommended: { nom: 'Recommandé', couleur: '#8b9cff' },
  meh: { nom: 'Bof', couleur: '#ffb84d' },
  skip: { nom: 'À éviter', couleur: '#ff6b6b' },
};

// Couleur de la note Metacritic (mêmes seuils que Metacritic)
export const couleurMetacritic = (note) => (note >= 75 ? '#5ee69a' : note >= 50 ? '#ffb84d' : '#ff6b6b');

/**
 * Comment jouer aux jeux des anciennes consoles.
 * `officiel` : moyens légaux d'y jouer aujourd'hui.
 * `emulateurs` : émulateurs reconnus (logiciels libres et légaux) ; config indicative.
 * Rappel : l'émulation est légale, mais il faut posséder le jeu original (copie perso).
 */
export const RETRO = {
  nes: { officiel: 'Nintendo Switch Online', emulateurs: 'Mesen, RetroArch', config: 'Tourne sur presque tout (même un vieux PC ou un smartphone).' },
  snes: { officiel: 'Nintendo Switch Online', emulateurs: 'Mesen, bsnes, RetroArch', config: 'Tourne sur presque tout.' },
  'nintendo-64': { officiel: 'Nintendo Switch Online + Pack additionnel', emulateurs: 'simple64, RetroArch (Mupen64Plus)', config: 'PC modeste suffisant, GPU compatible OpenGL 3.3.' },
  gamecube: { officiel: 'Switch Online (Switch 2, quelques jeux)', emulateurs: 'Dolphin', config: 'Processeur 64 bits récent (bon mono-cœur), GPU compatible Vulkan ou OpenGL 4.6, 4 Go de RAM.' },
  wii: { officiel: '—', emulateurs: 'Dolphin', config: 'Processeur 64 bits récent (bon mono-cœur), GPU compatible Vulkan ou OpenGL 4.6, 4 Go de RAM.' },
  'wii-u': { officiel: 'Certains jeux ressortis sur Switch', emulateurs: 'Cemu', config: '4 cœurs récents, 8 Go de RAM, GPU compatible Vulkan.' },
  'game-boy': { officiel: 'Nintendo Switch Online', emulateurs: 'mGBA, SameBoy', config: 'Tourne sur presque tout.' },
  'game-boy-color': { officiel: 'Nintendo Switch Online', emulateurs: 'mGBA, SameBoy', config: 'Tourne sur presque tout.' },
  'game-boy-advance': { officiel: 'Nintendo Switch Online + Pack additionnel', emulateurs: 'mGBA', config: 'Tourne sur presque tout.' },
  'nintendo-ds': { officiel: '—', emulateurs: 'melonDS, DeSmuME', config: 'PC modeste suffisant.' },
  'nintendo-3ds': { officiel: '—', emulateurs: 'Azahar', config: 'Processeur 4 cœurs, GPU compatible OpenGL 4.3 ou Vulkan.' },
  playstation1: { officiel: 'PS Plus Premium (Classiques)', emulateurs: 'DuckStation', config: 'Tourne sur presque tout.' },
  playstation2: { officiel: 'PS Plus Premium (quelques jeux)', emulateurs: 'PCSX2', config: 'Processeur avec AVX2 (bon mono-cœur), 8 Go de RAM, GPU DirectX 11 ou Vulkan.' },
  playstation3: { officiel: 'PS Plus Premium (streaming)', emulateurs: 'RPCS3', config: 'Exigeant : 6 cœurs / 12 threads récents, 16 Go de RAM, GPU Vulkan.' },
  psp: { officiel: '—', emulateurs: 'PPSSPP', config: 'Tourne sur presque tout (même un smartphone).' },
  'ps-vita': { officiel: '—', emulateurs: 'Vita3K', config: 'Processeur 4 cœurs récent, GPU Vulkan.' },
  'xbox-old': { officiel: 'Rétrocompatibilité Xbox Series (certains jeux)', emulateurs: 'xemu', config: 'Processeur 4 cœurs, GPU OpenGL 4.0.' },
  xbox360: { officiel: 'Rétrocompatibilité Xbox Series (beaucoup de jeux)', emulateurs: 'Xenia', config: 'Processeur avec AVX, GPU Vulkan ou DirectX 12, 8 Go de RAM.' },
  'sega-master-system': { officiel: '—', emulateurs: 'RetroArch (Genesis Plus GX)', config: 'Tourne sur presque tout.' },
  genesis: { officiel: 'Nintendo Switch Online + Pack additionnel', emulateurs: 'RetroArch (Genesis Plus GX)', config: 'Tourne sur presque tout.' },
  'sega-saturn': { officiel: '—', emulateurs: 'RetroArch (Beetle Saturn)', config: 'Processeur correct (bon mono-cœur).' },
  dreamcast: { officiel: '—', emulateurs: 'Flycast', config: 'PC modeste, GPU OpenGL 3.' },
  'game-gear': { officiel: '—', emulateurs: 'RetroArch (Genesis Plus GX)', config: 'Tourne sur presque tout.' },
};
