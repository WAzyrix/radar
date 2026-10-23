// =========================================================
// Jeux vidéo : RAWG (clé secrète) + Steam (pas de CORS côté navigateur).
// =========================================================

const RAWG = 'https://api.rawg.io/api';

// Paramètres RAWG qu'on accepte de transmettre (le reste est ignoré)
const PARAMS_AUTORISES = ['search', 'search_precise', 'genres', 'tags', 'platforms', 'parent_platforms', 'dates', 'ordering', 'metacritic', 'page', 'page_size', 'exclude_additions'];

export function filtrer(params) {
  const propres = {};
  for (const cle of PARAMS_AUTORISES) if (params.get(cle)) propres[cle] = params.get(cle);
  if (propres.page_size) propres.page_size = String(Math.min(Number(propres.page_size) || 20, 40));
  return propres;
}

export async function listeJeux(env, params) {
  return params.search && !params.ordering ? rechercheIntelligente(env, params) : rawg(env, '/games', params);
}

export const genres = (env) => rawg(env, '/genres', { page_size: 40 });

// Appel à RAWG avec la clé secrète. `cf.cacheTtl` demande à Cloudflare de garder la réponse.
export async function rawg(env, chemin, params = {}) {
  if (!env.RAWG_KEY) throw new Error('Clé RAWG absente (wrangler secret put RAWG_KEY)');
  const url = new URL(RAWG + chemin);
  for (const [cle, valeur] of Object.entries(params)) url.searchParams.set(cle, valeur);
  url.searchParams.set('key', env.RAWG_KEY);
  const reponse = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!reponse.ok) throw new Error(`RAWG a répondu ${reponse.status}`);
  return JSON.parse(sansCle(await reponse.text(), env.RAWG_KEY));
}

// RAWG recopie la clé dans les liens de pagination ("next", "previous") :
// on la retire de toutes les URL avant de répondre au navigateur.
export function sansCle(texte, cle) {
  return texte
    .replace(/([?&])key=[^&"\\]*(&?)/g, (_, separateur, suite) => (suite ? separateur : ''))
    .replaceAll(cle, '');
}

// ---------- Recherche par titre ----------
// RAWG trié par pertinence fait remonter des jeux amateurs ("ZELDA (Raul Fernandes)"),
// trié par popularité il sort des jeux hors sujet ("Batman: Arkham Knight" pour "hollow knight").
// On combine : résultats pertinents, puis classement maison :
//   1. le titre contient tous les mots cherchés ;
//   2. ensuite, le plus populaire (nombre de joueurs qui l'ont ajouté sur RAWG).
async function rechercheIntelligente(env, params) {
  const voulus = Number(params.page_size) || 20;
  const donnees = await rawg(env, '/games', { ...params, search_precise: 'true', page_size: 40 });
  const mots = normaliser(params.search).split(' ').filter(Boolean);
  const score = (jeu) => {
    const nom = normaliser(jeu.name);
    const tousLesMots = mots.every((m) => nom.includes(m));
    return (tousLesMots ? 1e9 : 0) + (jeu.added || 0);
  };
  donnees.results = donnees.results.sort((a, b) => score(b) - score(a)).slice(0, voulus);
  return donnees;
}

export const normaliser = (texte) => (texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- Fiche complète d'un jeu ----------
export async function ficheJeu(env, id) {
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
    metacritic: d.metacritic?.score || null,
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
export async function hasard(env, filtres) {
  const base = { ordering: '-added', exclude_additions: 'true', ...filtres, page_size: 40 };
  const premiere = await rawg(env, '/games', { ...base, page: 1 });
  const total = Math.min(premiere.count, 2000);
  if (!total) return { jeu: null };
  const page = 1 + Math.floor(Math.random() * Math.ceil(total / 40));
  const liste = page === 1 ? premiere : await rawg(env, '/games', { ...base, page });
  const jeux = liste.results.length ? liste.results : premiere.results;
  return { jeu: jeux[Math.floor(Math.random() * jeux.length)] };
}
