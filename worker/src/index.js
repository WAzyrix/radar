// =========================================================
// Relais Radar (Cloudflare Worker) : point d'entrée et routes.
//
// Pourquoi ce relais ?
//  - RAWG et TMDB demandent une clé : elle ne doit pas être dans le code du site.
//  - Steam et MangaUpdates refusent les appels venant d'un navigateur (pas de CORS).
//  - Les notifications doivent partir d'un serveur, même quand ton navigateur est fermé.
//
// Routes :
//   GET    /jeux?…  /jeu/:id  /hasard?…  /genres     jeux vidéo (jeux.js)
//   GET    /tmdb/recherche?q=  /tmdb/genres            films et séries (tmdb.js)
//   GET    /tmdb/decouvrir?type=&genres=&annee=&note=&plateforme=&tri=&page=
//   GET    /tmdb/hasard?type=&…   /tmdb/sorties?type=&quand=avenir|recentes   /tmdb/en-ce-moment
//   GET    /tmdb/fiche/:type/:id                      fiche complète (film ou serie)
//   GET    /push/cle                                  clé publique des notifications
//   GET    /liste/:code    PUT /liste/:code           watchlist (comptes.js)
//   GET    /abo/:code      PUT /abo/:code  DELETE /abo/:code   abonnement aux notifs
//   PUT    /prefs/:code                               types de notifications voulus
//   POST   /test/:code                                notification de test
//   GET    /historique/:code                          la cloche (50 dernières notifications)
//   PUT    /historique/:code     DELETE /historique/:code   tout marquer lu / effacer (tout ou { ids })
//   POST   /recommander                               recommander à un pote (compte Supabase)
//   POST   /chat/notifier                             prévenir le groupe d'un nouveau message
// Tâche planifiée (toutes les heures) : verification.js + lancement de la collecte des actus (github.js)
//                 + une fois par jour, une lecture Supabase pour éviter la mise en pause (eveil.js)
// =========================================================
import { filtrer, listeJeux, ficheJeu, hasard, genres } from './jeux.js';
import { rechercheTmdb, genresTmdb, decouvrir, hasardTmdb, sorties, enCeMoment, ficheTmdb, typeValide } from './tmdb.js';
import {
  codeValide, lireListe, ecrireListe, abonner, desabonner, lireAbonnement, changerPrefs, notifTest, lireHistorique, effacerHistorique, marquerLues, Erreur400,
} from './comptes.js';
import { verifier } from './verification.js';
import { recommander } from './recommandations.js';
import { notifierChat } from './chat.js';
import { cleIp } from './limiteur.js';
import { lancerCollecte } from './github.js';
import { eveilDuJour, reveillerSupabase } from './eveil.js';

// Le Durable Object doit être exporté par le point d'entrée pour que Cloudflare le trouve
export { Limiteur } from './limiteur.js';

const TAILLE_MAX = 300_000; // octets acceptés dans un envoi (une liste reste bien en dessous)

// Routes qui consomment le quota RAWG (20 000 requêtes/mois) ou TMDB
const ROUTES_COUTEUSES = /^\/(jeux|jeu\/|hasard|genres|tmdb\/)/;

export default {
  async fetch(requete, env) {
    // 1. Seul le site (ORIGINES) peut appeler le relais. Le navigateur envoie toujours
    //    l'en-tête Origin sur un appel venant d'un autre site : sans lui, ou avec un
    //    autre site, on refuse (un script peut le falsifier : c'est le rôle de la limite 2).
    const origine = requete.headers.get('Origin') || '';
    const originesOk = (env.ORIGINES || '').split(',').map((o) => o.trim()).filter(Boolean);
    if (!originesOk.includes(origine)) return json({ erreur: 'Site non autorisé à utiliser ce relais.' }, 403, { Vary: 'Origin' });
    const cors = {
      'Access-Control-Allow-Origin': origine,
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Retry-After',
      Vary: 'Origin',
    };
    if (requete.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 2. Limite de débit par adresse IP (requêtes par minute ; une page du site en fait 2 à 5)
    const chemin = new URL(requete.url).pathname;
    const categorie = requete.method !== 'GET' ? 'ecritures' : ROUTES_COUTEUSES.test(chemin) ? 'api' : 'lectures';
    const verdict = await verifierLimite(env, requete, categorie);
    if (!verdict.ok) {
      return json({ erreur: `Trop de requêtes : réessaie dans ${verdict.attente} s.` }, 429, { ...cors, 'Retry-After': String(verdict.attente) });
    }

    try {
      const { donnees, duree = 0 } = await router(requete, env);
      return json(donnees, 200, { ...cors, 'Cache-Control': duree ? `public, max-age=${duree}` : 'no-store' });
    } catch (erreur) {
      const statut = erreur instanceof Erreur400 ? 400 : erreur.statut || 502;
      return json({ erreur: erreur.message }, statut, cors);
    }
  },

  // Appelé par Cloudflare toutes les heures (voir [triggers] dans wrangler.toml)
  async scheduled(evenement, env, ctx) {
    // La collecte d'abord : une seule requête, et elle ne doit pas attendre la vérification
    ctx.waitUntil(lancerCollecte(env).then((bilan) => console.log('Collecte des actus :', JSON.stringify(bilan))));
    ctx.waitUntil(verifier(env).then((bilan) => console.log('Vérification :', JSON.stringify(bilan))));
    // Une fois par jour : une lecture Supabase, pour que le projet gratuit ne soit pas mis en pause
    if (eveilDuJour(evenement.scheduledTime)) {
      ctx.waitUntil(reveillerSupabase(env).then((bilan) => console.log('Supabase (anti-pause) :', JSON.stringify(bilan))));
    }
  },
};

async function router(requete, env) {
  const url = new URL(requete.url);
  const methode = requete.method;
  const chemin = url.pathname;
  const segments = chemin.split('/').filter(Boolean);
  const code = segments[1];

  // ---------- Jeux vidéo ----------
  if (methode === 'GET' && chemin === '/jeux') return { donnees: await listeJeux(env, filtrer(url.searchParams)), duree: 3600 };
  if (methode === 'GET' && /^\/jeu\/\d+$/.test(chemin)) return { donnees: await ficheJeu(env, segments[1]), duree: 6 * 3600 };
  if (methode === 'GET' && chemin === '/hasard') return { donnees: await hasard(env, filtrer(url.searchParams)) };
  if (methode === 'GET' && chemin === '/genres') return { donnees: await genres(env), duree: 7 * 86400 };

  // ---------- Films et séries ----------
  if (methode === 'GET' && chemin === '/tmdb/recherche') {
    const texte = (url.searchParams.get('q') || '').trim();
    if (texte.length < 2) throw new Erreur400('Recherche trop courte');
    return { donnees: await rechercheTmdb(env, texte), duree: 6 * 3600 };
  }
  if (methode === 'GET' && chemin === '/tmdb/genres') return { donnees: await genresTmdb(env), duree: 7 * 86400 };
  if (methode === 'GET' && chemin === '/tmdb/decouvrir') return { donnees: await decouvrir(env, typeValide(url.searchParams.get('type')), url.searchParams), duree: 3600 };
  if (methode === 'GET' && chemin === '/tmdb/hasard') return { donnees: await hasardTmdb(env, typeValide(url.searchParams.get('type')), url.searchParams) };
  if (methode === 'GET' && chemin === '/tmdb/sorties') return { donnees: await sorties(env, typeValide(url.searchParams.get('type')), url.searchParams.get('quand')), duree: 6 * 3600 };
  if (methode === 'GET' && chemin === '/tmdb/en-ce-moment') return { donnees: await enCeMoment(env), duree: 6 * 3600 };
  if (methode === 'GET' && /^\/tmdb\/fiche\/(film|serie)\/\d{1,9}$/.test(chemin)) return { donnees: await ficheTmdb(env, segments[2], segments[3]), duree: 12 * 3600 };

  // ---------- Notifications ----------
  if (methode === 'GET' && chemin === '/push/cle') return { donnees: { cle: env.VAPID_PUBLIQUE }, duree: 86400 };

  // ---------- Recommandations entre potes ----------
  if (methode === 'POST' && chemin === '/recommander') return { donnees: await recommander(env, requete, await lireCorps(requete)) };
  if (methode === 'POST' && chemin === '/chat/notifier') return { donnees: await notifierChat(env, requete, await lireCorps(requete)) };

  // ---------- Routes avec un code perso ----------
  if (['liste', 'abo', 'prefs', 'test', 'historique'].includes(segments[0])) {
    if (!codeValide(code)) throw new Erreur400('Code perso invalide');
    const corps = ['PUT', 'POST', 'DELETE'].includes(methode) ? await lireCorps(requete) : null;
    const route = `${methode} ${segments[0]}`;
    if (route === 'GET liste') return { donnees: await lireListe(env, code) };
    if (route === 'PUT liste') return { donnees: await ecrireListe(env, code, corps) };
    if (route === 'GET abo') return { donnees: await lireAbonnement(env, code) };
    if (route === 'PUT abo') return { donnees: await abonner(env, code, corps) };
    if (route === 'DELETE abo') return { donnees: await desabonner(env, code, corps) };
    if (route === 'PUT prefs') return { donnees: await changerPrefs(env, code, corps) };
    if (route === 'POST test') return { donnees: await notifTest(env, code) };
    if (route === 'GET historique') return { donnees: await lireHistorique(env, code) };
    if (route === 'DELETE historique') return { donnees: await effacerHistorique(env, code, corps) };
    if (route === 'PUT historique') return { donnees: await marquerLues(env, code) };
  }

  const erreur = new Error('Route inconnue');
  erreur.statut = 404;
  throw erreur;
}

// api       : routes qui coûtent du quota RAWG/TMDB
// ecritures : PUT / POST / DELETE (écrivent dans KV, envoient des notifications)
// lectures  : le reste (liste, cloche, clé publique…)
const LIMITES = { api: 40, ecritures: 20, lectures: 60 };

async function verifierLimite(env, requete, categorie) {
  const ip = cleIp(requete.headers.get('CF-Connecting-IP') || 'inconnue');
  try {
    return await env.LIMITEUR.get(env.LIMITEUR.idFromName(ip)).autoriser(categorie, LIMITES[categorie]);
  } catch (erreur) {
    // Limiteur indisponible : on laisse passer plutôt que de casser le site
    console.log('Limiteur indisponible :', erreur.message);
    return { ok: true };
  }
}

async function lireCorps(requete) {
  const texte = await requete.text();
  if (texte.length > TAILLE_MAX) throw new Erreur400('Envoi trop gros');
  try {
    return texte ? JSON.parse(texte) : {};
  } catch {
    throw new Erreur400('JSON invalide');
  }
}

function json(donnees, statut, entetes) {
  return new Response(JSON.stringify(donnees), { status: statut, headers: { 'Content-Type': 'application/json; charset=utf-8', ...entetes } });
}
