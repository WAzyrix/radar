// =========================================================
// Préférences d'affichage (pour l'instant : masquer la section Rattrapage).
// Gardées dans le navigateur, et dans la table "preferences" de Supabase si je suis
// connecté (supabase/preferences.sql) : la plus récente des deux gagne.
// =========================================================
import { SUPABASE_URL } from '../config.js';

const CLE = 'radar:preferences';
const DEFAUT = { rattrapageMasque: false, maj: 0 };
const comptesConfigures = () => !SUPABASE_URL.includes('A-REMPLACER');

function lire() {
  try { return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE)) }; } catch { return { ...DEFAUT }; }
}

function ecrire(prefs) {
  localStorage.setItem(CLE, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent('radar:preferences'));
}

export const rattrapageMasque = () => lire().rattrapageMasque;

export async function masquerRattrapage(masque) {
  const prefs = { ...lire(), rattrapageMasque: Boolean(masque), maj: Date.now() };
  ecrire(prefs);
  if (!comptesConfigures()) return;
  const compte = await import('./compte.js');
  await compte.enregistrerPreferences(prefs).catch(() => { /* hors connexion : renvoyé à la prochaine synchro */ });
}

/** Au chargement : récupère les préférences du compte si elles sont plus récentes (ou envoie les miennes). */
export async function synchroniserPreferences() {
  if (!comptesConfigures()) return;
  const compte = await import('./compte.js');
  const distantes = await compte.mesPreferences();
  if (distantes === undefined) return; // pas connecté
  const locales = lire();
  if (distantes && distantes.maj > locales.maj) ecrire({ ...locales, ...distantes });
  else if (locales.maj > (distantes?.maj || 0)) await compte.enregistrerPreferences(locales);
}
