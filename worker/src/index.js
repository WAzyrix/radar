// =========================================================
// Relais Radar (Cloudflare Worker)
//
// Pourquoi ce relais ?
//  - RAWG demande une clé : elle ne doit pas être dans le code du site (visible par tous).
//    Le relais la garde secrète (variable RAWG_KEY, définie avec `wrangler secret put`).
//  - Steam n'autorise pas les appels depuis un navigateur (pas de CORS) : le relais,
//    lui, est un serveur, il peut l'appeler.
//
// Routes (toutes en GET, réponses JSON) :
//   /jeux?search=&genres=&parent_platforms=&dates=&ordering=&metacritic=&page=&page_size=
//   /jeu/:id          fiche complète (RAWG + captures + boutiques + série + Steam)
//   /hasard?…         un jeu au hasard parmi ceux qui correspondent aux filtres
//   /genres           liste des genres RAWG
// =========================================================

const RAWG = 'https://api.rawg.io/api';

// Paramètres RAWG qu'on accepte de transmettre (le reste est ignoré)
const PARAMS_AUTORISES = ['search', 'search_precise', 'genres', 'tags', 'platforms', 'parent_platforms', 'dates', 'ordering', 'metacritic', 'page', 'page_size', 'exclude_additions'];

export default {
  async fetch(requete, env) {
    const origine = requete.headers.get('Origin') || '';
    const originesOk = (env.ORIGINES || '').split(',').map((o) => o.trim());
    const entetesCors = {
      'Access-Control-Allow-Origin': originesOk.includes(origine) ? origine : originesOk[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (requete.method === 'OPTIONS') return new Response(null, { headers: entetesCors });
    if (requete.method !== 'GET') return json({ erreur: 'Méthode non autorisée' }, 405, entetesCors);

    const url = new URL(requete.url);
    try {
      let donnees;
      let duree = 3600; // durée de cache conseillée au navigateur (secondes)
      const fiche = url.pathname.match(/^\/jeu\/(\d+)$/);

      if (url.pathname === '/jeux') {
        donnees = await rawg(env, '/games', filtrer(url.searchParams));
      } else if (fiche) {
        donnees = await ficheJeu(env, fiche[1]);
        duree = 6 * 3600;
      } else if (url.pathname === '/hasard') {
        donnees = await hasard(env, filtrer(url.searchParams));
        duree = 0;
      } else if (url.pathname === '/genres') {
        donnees = await rawg(env, '/genres', { page_size: 40 });
        duree = 7 * 86400;
      } else {
        return json({ erreur: 'Route inconnue' }, 404, entetesCors);
      }
      return json(donnees, 200, { ...entetesCors, 'Cache-Control': duree ? `public, max-age=${duree}` : 'no-store' });
    } catch (erreur) {
      return json({ erreur: erreur.message }, 502, entetesCors);
    }
  },
};

function json(donnees, statut, entetes) {
  return new Response(JSON.stringify(donnees), { status: statut, headers: { 'Content-Type': 'application/json; charset=utf-8', ...entetes } });
}

function filtrer(params) {
  const propres = {};
  for (const cle of PARAMS_AUTORISES) if (params.get(cle)) propres[cle] = params.get(cle);
  if (propres.page_size) propres.page_size = String(Math.min(Number(propres.page_size) || 20, 40));
  return propres;
}

// Appel à RAWG avec la clé secrète. `cf.cacheTtl` demande à Cloudflare de garder la réponse.
async function rawg(env, chemin, params = {}) {
  if (!env.RAWG_KEY) throw new Error('Clé RAWG absente (wrangler secret put RAWG_KEY)');
  const url = new URL(RAWG + chemin);
  for (const [cle, valeur] of Object.entries(params)) url.searchParams.set(cle, valeur);
  url.searchParams.set('key', env.RAWG_KEY);
  const reponse = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!reponse.ok) throw new Error(`RAWG a répondu ${reponse.status}`);
  return reponse.json();
}

// ---------- Fiche complète d'un jeu ----------
async function ficheJeu(env, id) {
  // 4 appels RAWG en parallèle
  const [jeu, captures, boutiques, serie] = await Promise.all([
    rawg(env, `/games/${id}`),
    rawg(env, `/games/${id}/screenshots`, { page_size: 12 }).catch(() => ({ results: [] })),
    rawg(env, `/games/${id}/stores`).catch(() => ({ results: [] })),
    rawg(env, `/games/${id}/game-series`, { page_size: 15 }).catch(() => ({ results: [] })),
  ]);

  // Liens directs vers les boutiques (la fiche ne donne que le nom de la boutique)
  const liens = Object.fromEntries(boutiques.results.map((b) => [b.store_id, b.url]));
  jeu.stores = (jeu.stores || []).map((s) => ({ ...s, url: liens[s.store.id] || null }));

  // Si le jeu est sur Steam : description, configuration et avis en français
  const lienSteam = jeu.stores.find((s) => s.store.slug === 'steam')?.url;
  const appid = lienSteam?.match(/\/app\/(\d+)/)?.[1];
  const steam = appid ? await infosSteam(appid).catch(() => null) : null;

  return {
    jeu,
    captures: captures.results.map((c) => c.image),
    serie: serie.results,
    steam,
    configRawg: configurationRawg(jeu),
  };
}

async function infosSteam(appid) {
  const [details, avis] = await Promise.all([
    fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=fr&l=french`, { cf: { cacheTtl: 21600 } }).then((r) => r.json()),
    fetch(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&num_per_page=0&purchase_type=all`, { cf: { cacheTtl: 21600 } })
      .then((r) => r.json()).catch(() => null),
  ]);
  const d = details?.[appid]?.data;
  if (!d) return null;
  return {
    appid,
    url: `https://store.steampowered.com/app/${appid}`,
    description: d.short_description,
    prix: d.is_free ? 'Gratuit' : d.price_overview?.final_formatted || null,
    reduction: d.price_overview?.discount_percent || 0,
    recommandations: d.recommendations?.total || null,
    config: {
      minimum: lignesConfig(d.pc_requirements?.minimum),
      recommande: lignesConfig(d.pc_requirements?.recommended),
    },
    avis: avis?.query_summary?.total_reviews
      ? { resume: avis.query_summary.review_score_desc, positifs: avis.query_summary.total_positive, total: avis.query_summary.total_reviews }
      : null,
  };
}

// Transforme le HTML de Steam ("<li><strong>Processeur :</strong> i5</li>…") en lignes de texte
function lignesConfig(html) {
  if (!html || typeof html !== 'string') return [];
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/<li>|\n/)
    .map((ligne) => ligne.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((ligne) => ligne && !/^(minimum|minimale|recommand[ée]e?s?)\s*:?$/i.test(ligne));
}

// RAWG donne la config PC en texte anglais "Minimum:\nOS: …\nProcessor: …"
function configurationRawg(jeu) {
  const pc = (jeu.platforms || []).find((p) => p.platform.slug === 'pc');
  const req = pc?.requirements || pc?.requirements_en;
  if (!req) return null;
  const decouper = (texte) => (texte || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(minimum|recommended):?$/i.test(l));
  return { minimum: decouper(req.minimum), recommande: decouper(req.recommended) };
}

// ---------- Jeu au hasard ----------
// RAWG donne un nombre de résultats fiable : on tire une page au hasard parmi les
// plus populaires (2000 max) puis un jeu au hasard dans cette page.
async function hasard(env, filtres) {
  const base = { ordering: '-added', exclude_additions: 'true', ...filtres, page_size: 40 };
  const premiere = await rawg(env, '/games', { ...base, page: 1 });
  const total = Math.min(premiere.count, 2000);
  if (!total) return { jeu: null };
  const page = 1 + Math.floor(Math.random() * Math.ceil(total / 40));
  const liste = page === 1 ? premiere : await rawg(env, '/games', { ...base, page });
  const jeux = liste.results.length ? liste.results : premiere.results;
  return { jeu: jeux[Math.floor(Math.random() * jeux.length)] };
}
