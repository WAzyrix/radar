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
//   histo:<code>    les 50 dernières notifications (la cloche du site)
// =========================================================
import { envoyerPush } from './push.js';

export const codeValide = (code) => /^[a-f0-9]{32}$/.test(code || '');
// Identifiant AniList / RAWG / TMDB : un entier positif
export const idValide = (id) => (Number.isInteger(id) && id > 0) || (typeof id === 'string' && /^\d{1,12}$/.test(id));

const TYPES = ['anime', 'manga', 'film', 'serie', 'jeu'];
export const PREFS_DEFAUT = { episode: true, vostfr: true, suite: true, manga: true, serie: true, film: true, jeu: true };
const MAX_APPAREILS = 10;
const MAX_CLOCHE = 50; // notifications gardées dans la cloche

const lire = async (env, cle, defaut) => (await env.RADAR_KV.get(cle, 'json')) ?? defaut;
const ecrire = (env, cle, valeur) => env.RADAR_KV.put(cle, JSON.stringify(valeur));

// Quota KV gratuit : 1000 écritures par jour (les lectures sont 100 fois plus nombreuses).
// On relit donc la valeur et on n'écrit que si elle a vraiment changé.
async function ecrireSiChange(env, cle, valeur) {
  const texte = JSON.stringify(valeur);
  if ((await env.RADAR_KV.get(cle)) === texte) return false;
  await env.RADAR_KV.put(cle, texte);
  return true;
}

// ---------- Liste ----------
export const lireListe = (env, code) => lire(env, `liste:${code}`, { maj: 0, items: [] });

export async function ecrireListe(env, code, donnees) {
  if (!donnees || typeof donnees.maj !== 'number' || !Array.isArray(donnees.items)) throw new Erreur400('Liste invalide');
  if (donnees.items.length > 2000) throw new Erreur400('Liste trop longue');
  // On ne garde que les champs connus (rien d'autre ne peut être stocké)
  const items = donnees.items
    .filter((i) => i && TYPES.includes(i.type) && idValide(i.id))
    .map((i) => ({
      type: i.type,
      id: Number(i.id),
      titre: String(i.titre || '').slice(0, 200),
      titres: Array.isArray(i.titres) ? i.titres.slice(0, 5).map((t) => String(t).slice(0, 200)) : undefined,
      image: /^https:\/\//.test(i.image || '') ? String(i.image).slice(0, 500) : '',
      couleur: /^#[0-9a-f]{6}$/i.test(i.couleur || '') ? i.couleur : undefined,
      statut: i.statut ? String(i.statut).slice(0, 20) : undefined,
      sortie: i.sortie ? String(i.sortie).slice(0, 10) : undefined,
      adn: typeof i.adn === 'number' ? i.adn : undefined,
      saisons: Array.isArray(i.saisons) ? i.saisons.filter((n) => Number.isInteger(n)).slice(0, 30) : undefined,
      // Rattrapage : dernier épisode vu par saison { "16498": 25 }
      vu: i.vu && typeof i.vu === 'object' && !Array.isArray(i.vu)
        ? Object.fromEntries(Object.entries(i.vu)
          .filter(([saison, episode]) => /^\d{1,12}$/.test(saison) && Number.isInteger(episode) && episode >= 0 && episode < 100_000)
          .slice(0, 60))
        : undefined,
      ajouteLe: String(i.ajouteLe || '').slice(0, 30),
    }));
  await ecrireSiChange(env, `liste:${code}`, { maj: donnees.maj, items });
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
  await ecrireSiChange(env, `abo:${code}`, abo);
  return { ok: true, appareils: abo.abonnements.length, prefs: abo.prefs };
}

export async function desabonner(env, code, { endpoint }) {
  const abo = await lire(env, `abo:${code}`, null);
  if (!abo?.abonnements.some((a) => a.endpoint === endpoint)) return { ok: true }; // rien à retirer
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
  await ecrireSiChange(env, `abo:${code}`, abo);
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

  // 1. Toujours : dans la cloche du site (même sans notifications push)
  const histo = await lireHistorique(env, code);
  const date = new Date().toISOString();
  await ecrire(env, `histo:${code}`, [...notifs.map((n) => ({ ...n, id: crypto.randomUUID(), date, lu: false })), ...histo].slice(0, MAX_CLOCHE));

  // 2. Si des appareils sont abonnés : notification push
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
  return aEnvoyer.length;
}

// ---------- Cloche : effacer, marquer comme lues ----------
/** Efface certaines notifications (ids) ou toutes (ids absent). */
export async function effacerHistorique(env, code, { ids } = {}) {
  const histo = await lireHistorique(env, code);
  const restantes = Array.isArray(ids) ? histo.filter((n) => !ids.includes(n.id)) : [];
  if (restantes.length !== histo.length) await ecrire(env, `histo:${code}`, restantes);
  return { ok: true, restantes: restantes.length };
}

export async function marquerLues(env, code) {
  const histo = await lireHistorique(env, code);
  if (histo.some((n) => !n.lu)) await ecrire(env, `histo:${code}`, histo.map((n) => ({ ...n, lu: true })));
  return { ok: true };
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
