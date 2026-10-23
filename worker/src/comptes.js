// =========================================================
// Listes et abonnements aux notifications, stockés dans Cloudflare KV.
//
// Pas de compte ni de mot de passe : chaque personne a un "code perso"
// (32 caractères aléatoires générés par son navigateur). Celui qui connaît
// le code accède à la liste : c'est pourquoi il est long et impossible à deviner.
//
// Clés dans KV :
//   liste:<code>    { maj, items: [...] }            la watchlist
//   abo:<code>      { abonnements: [...], prefs }    appareils abonnés aux notifs
//   etat:<code>     ce que la vérification horaire a déjà vu (pour ne rien envoyer 2 fois)
//   histo:<code>    les 30 dernières notifications envoyées
// =========================================================
import { envoyerPush } from './push.js';

export const codeValide = (code) => /^[a-f0-9]{32}$/.test(code || '');

const TYPES = ['anime', 'manga', 'film', 'serie', 'jeu'];
export const PREFS_DEFAUT = { episode: true, vostfr: true, suite: true, manga: true, serie: true, film: true, jeu: true };
const MAX_APPAREILS = 10;

const lire = async (env, cle, defaut) => (await env.RADAR_KV.get(cle, 'json')) ?? defaut;
const ecrire = (env, cle, valeur) => env.RADAR_KV.put(cle, JSON.stringify(valeur));

// ---------- Liste ----------
export const lireListe = (env, code) => lire(env, `liste:${code}`, { maj: 0, items: [] });

export async function ecrireListe(env, code, donnees) {
  if (!donnees || typeof donnees.maj !== 'number' || !Array.isArray(donnees.items)) throw new Erreur400('Liste invalide');
  if (donnees.items.length > 2000) throw new Erreur400('Liste trop longue');
  // On ne garde que les champs connus (rien d'autre ne peut être stocké)
  const items = donnees.items
    .filter((i) => TYPES.includes(i.type) && (typeof i.id === 'number' || typeof i.id === 'string'))
    .map((i) => ({
      type: i.type,
      id: i.id,
      titre: String(i.titre || '').slice(0, 200),
      titres: Array.isArray(i.titres) ? i.titres.slice(0, 5).map((t) => String(t).slice(0, 200)) : undefined,
      image: String(i.image || '').slice(0, 500),
      couleur: i.couleur ? String(i.couleur).slice(0, 20) : undefined,
      statut: i.statut ? String(i.statut).slice(0, 20) : undefined,
      sortie: i.sortie ? String(i.sortie).slice(0, 10) : undefined,
      adn: typeof i.adn === 'number' ? i.adn : undefined,
      saisons: Array.isArray(i.saisons) ? i.saisons.filter((n) => Number.isInteger(n)).slice(0, 30) : undefined,
      ajouteLe: String(i.ajouteLe || '').slice(0, 30),
    }));
  await ecrire(env, `liste:${code}`, { maj: donnees.maj, items });
  return { ok: true, nombre: items.length };
}

// ---------- Abonnements aux notifications ----------
export async function abonner(env, code, { abonnement, prefs }) {
  if (!abonnement?.endpoint?.startsWith('https://') || !abonnement.keys?.p256dh || !abonnement.keys?.auth) throw new Erreur400('Abonnement invalide');
  const abo = await lire(env, `abo:${code}`, { abonnements: [], prefs: PREFS_DEFAUT });
  abo.abonnements = abo.abonnements.filter((a) => a.endpoint !== abonnement.endpoint);
  abo.abonnements.push({ endpoint: abonnement.endpoint, keys: { p256dh: abonnement.keys.p256dh, auth: abonnement.keys.auth } });
  abo.abonnements = abo.abonnements.slice(-MAX_APPAREILS);
  if (prefs) abo.prefs = nettoyerPrefs(prefs);
  await ecrire(env, `abo:${code}`, abo);
  return { ok: true, appareils: abo.abonnements.length, prefs: abo.prefs };
}

export async function desabonner(env, code, { endpoint }) {
  const abo = await lire(env, `abo:${code}`, null);
  if (!abo) return { ok: true };
  abo.abonnements = abo.abonnements.filter((a) => a.endpoint !== endpoint);
  if (abo.abonnements.length) await ecrire(env, `abo:${code}`, abo);
  else await env.RADAR_KV.delete(`abo:${code}`);
  return { ok: true };
}

export async function lireAbonnement(env, code) {
  const abo = await lire(env, `abo:${code}`, null);
  return { appareils: abo?.abonnements.length || 0, prefs: abo?.prefs || PREFS_DEFAUT };
}

export async function changerPrefs(env, code, prefs) {
  const abo = await lire(env, `abo:${code}`, null);
  if (!abo) throw new Erreur400("Active d'abord les notifications");
  abo.prefs = nettoyerPrefs(prefs);
  await ecrire(env, `abo:${code}`, abo);
  return { ok: true, prefs: abo.prefs };
}

const nettoyerPrefs = (prefs) => Object.fromEntries(Object.keys(PREFS_DEFAUT).map((k) => [k, prefs[k] !== false]));

export const lireHistorique = (env, code) => lire(env, `histo:${code}`, []);

/**
 * Envoie des notifications à tous les appareils d'un code (4 maximum d'un coup,
 * au-delà on regroupe en une seule), et les ajoute à l'historique.
 */
export async function notifier(env, code, notifs, abo) {
  if (!notifs.length) return 0;
  abo ??= await lire(env, `abo:${code}`, null);
  if (!abo?.abonnements.length) return 0;

  const aEnvoyer = notifs.length <= 4 ? notifs : [...notifs.slice(0, 3), {
    titre: `Et ${notifs.length - 3} autres nouveautés`,
    corps: notifs.slice(3).map((n) => n.titre).join(' · ').slice(0, 180),
    url: `${env.SITE}ma-liste.html`,
  }];

  const expires = new Set();
  for (const appareil of abo.abonnements) {
    for (const notif of aEnvoyer) {
      try {
        if ((await envoyerPush(env, appareil, notif)) === 'expire') { expires.add(appareil.endpoint); break; }
      } catch (erreur) {
        console.log('Échec envoi push :', erreur.message);
      }
    }
  }
  if (expires.size) {
    abo.abonnements = abo.abonnements.filter((a) => !expires.has(a.endpoint));
    await ecrire(env, `abo:${code}`, abo);
  }

  const histo = await lireHistorique(env, code);
  const date = new Date().toISOString();
  await ecrire(env, `histo:${code}`, [...notifs.map((n) => ({ ...n, date })), ...histo].slice(0, 30));
  return aEnvoyer.length;
}

export async function notifTest(env, code) {
  const envoyees = await notifier(env, code, [{
    titre: 'Radar fonctionne 🎉',
    corps: 'Les notifications sont bien activées sur cet appareil.',
    url: `${env.SITE}ma-liste.html`,
  }]);
  if (!envoyees) throw new Erreur400('Aucun appareil abonné');
  return { ok: true };
}

// Erreur "requête invalide" : le routeur la transforme en réponse 400
export class Erreur400 extends Error {}
