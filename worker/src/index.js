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
//   GET    /tmdb/recherche?q=                         films et séries (tmdb.js)
//   GET    /push/cle                                  clé publique des notifications
//   GET    /liste/:code    PUT /liste/:code           watchlist (comptes.js)
//   GET    /abo/:code      PUT /abo/:code  DELETE /abo/:code   abonnement aux notifs
//   PUT    /prefs/:code                               types de notifications voulus
//   POST   /test/:code                                notification de test
//   GET    /historique/:code                          dernières notifications
// Tâche planifiée (toutes les heures) : verification.js
// =========================================================
import { filtrer, listeJeux, ficheJeu, hasard, genres } from './jeux.js';
import { rechercheTmdb } from './tmdb.js';
import {
  codeValide, lireListe, ecrireListe, abonner, desabonner, lireAbonnement, changerPrefs, notifTest, lireHistorique, Erreur400,
} from './comptes.js';
import { verifier } from './verification.js';

const TAILLE_MAX = 300_000; // octets acceptés dans un envoi (une liste reste bien en dessous)

export default {
  async fetch(requete, env) {
    const origine = requete.headers.get('Origin') || '';
    const originesOk = (env.ORIGINES || '').split(',').map((o) => o.trim());
    const cors = {
      'Access-Control-Allow-Origin': originesOk.includes(origine) ? origine : originesOk[0],
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    if (requete.method === 'OPTIONS') return new Response(null, { headers: cors });

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
    ctx.waitUntil(verifier(env).then((bilan) => console.log('Vérification :', JSON.stringify(bilan))));
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

  // ---------- Notifications ----------
  if (methode === 'GET' && chemin === '/push/cle') return { donnees: { cle: env.VAPID_PUBLIQUE }, duree: 86400 };

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
  }

  const erreur = new Error('Route inconnue');
  erreur.statut = 404;
  throw erreur;
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
