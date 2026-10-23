// =========================================================
// Vérification horaire (tâche planifiée Cloudflare, "cron").
//
// Pour chaque personne abonnée aux notifications, on regarde ce qui est nouveau
// depuis le dernier passage, sur sa watchlist :
//   - animés  : épisode diffusé au Japon (AniList), dispo sur ADN, suite annoncée
//   - mangas  : nouveau tome ou chapitre (MangaUpdates)
//   - séries  : nouvel épisode, nouvelle saison (TMDB)
//   - films   : sortie au cinéma demain, arrivée sur une plateforme (TMDB)
//   - jeux    : sort demain / aujourd'hui (date enregistrée dans la liste)
//
// Limites du plan gratuit de Cloudflare : 50 requêtes sortantes par passage.
// On regroupe donc les requêtes (une seule pour tous les animés) et on fait
// tourner les mangas/films/séries : chacun est revérifié au plus toutes les 6 h.
// =========================================================
import { lireListe, notifier } from './comptes.js';
import { tmdb } from './tmdb.js';
import { normaliser } from './jeux.js';

const HEURE = 3600_000;
// Date de début comparable (20240315) ; null si inconnue (œuvre annoncée)
const dateDebut = (d) => (d?.year ? d.year * 10000 + (d.month || 1) * 100 + (d.day || 1) : null);
const BUDGET_REQUETES = 40; // on garde une marge sous la limite de 50
const RECHECK = 6 * HEURE;
const RAFRAICHIR_DERNIERE = 6 * HEURE;
const RESERVE_AUTRES = 10; // requêtes gardées pour ADN, mangas, séries et films
const FENETRE_MAX = 3 * 24 * HEURE; // épisodes cherchés au plus 3 jours en arrière

// Date et heure à Paris (pour les notifs "sort demain", envoyées le matin)
function parisAujourdhui(decalageJours = 0) {
  const d = new Date(Date.now() + decalageJours * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d); // AAAA-MM-JJ
}
const heureParis = () => Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()));

export async function verifier(env) {
  const budget = { reste: BUDGET_REQUETES };
  const compter = () => { budget.reste -= 1; return budget.reste >= 0; };

  // 1. Toutes les personnes qui ont une liste (notifs push activées ou non :
  //    sans push, les nouveautés vont quand même dans la cloche du site)
  //    KV.list renvoie 1000 clés au plus par appel : on suit le curseur.
  const cles = [];
  let curseur;
  do {
    const page = await env.RADAR_KV.list({ prefix: 'liste:', cursor: curseur });
    cles.push(...page.keys);
    curseur = page.list_complete ? undefined : page.cursor;
  } while (curseur);

  const personnes = [];
  for (const { name } of cles) {
    const code = name.slice(6);
    const [abo, liste, etatTexte] = await Promise.all([
      env.RADAR_KV.get(`abo:${code}`, 'json'),
      lireListe(env, code),
      env.RADAR_KV.get(`etat:${code}`),
    ]);
    if (liste.items.length) {
      const etat = etatTexte ? JSON.parse(etatTexte) : { derniere: Date.now() - HEURE, vus: {}, franchise: {}, manga: {}, tmdb: {} };
      personnes.push({ code, abo, items: liste.items, etat, etatTexte, notifs: [] });
    }
  }
  if (!personnes.length) return { personnes: 0 };

  // 2. Animés : requêtes AniList groupées (50 œuvres par requête) pour tout le monde.
  //    false si AniList est en panne : on rattrapera au prochain passage.
  const animesComplets = await verifierAnimes(env, personnes, compter, budget);
  // 3. ADN (VOSTFR / VF), un seul petit fichier pour tout le monde
  await verifierAdn(env, personnes, compter);
  // 4. Jeux : rien à télécharger, la date de sortie est dans la liste
  verifierJeux(env, personnes);
  // 5. Mangas, séries, films : une requête par œuvre, dans la limite du budget
  await verifierMangas(env, personnes, compter, budget);
  if (env.TMDB_KEY) await verifierTmdb(env, personnes, compter, budget);

  // 6. Envoi, en respectant les préférences de chacun
  let envoyees = 0;
  let ecritures = 0;
  for (const p of personnes) {
    const prefs = p.abo?.prefs || {};
    const deja = new Set(p.etat.vus ? Object.keys(p.etat.vus) : []);
    const nouvelles = p.notifs.filter((n) => prefs[n.categorie] !== false && !deja.has(n.cle));
    envoyees += await notifier(env, p.code, nouvelles.map(({ cle, categorie, ...n }) => n), p.abo);
    // On retient ce qui a été envoyé (et on oublie ce qui a plus de 30 jours)
    const maintenant = Date.now();
    p.etat.vus = Object.fromEntries([
      ...Object.entries(p.etat.vus || {}).filter(([, t]) => maintenant - t < 30 * 86400_000),
      ...nouvelles.map((n) => [n.cle, maintenant]),
    ]);
    // Quota KV gratuit : 1000 écritures/jour. On n'écrit l'état que s'il a changé.
    // "derniere" (date du dernier passage) n'est rafraîchie que toutes les 6 h : entre-temps,
    // les nouveautés déjà envoyées sont reconnues grâce à "vus" (pas de doublon).
    // AniList en panne pendant ce passage : on ne l'avance pas, le suivant rattrapera.
    const derniere = p.etat.derniere;
    if (animesComplets && maintenant - derniere >= RAFRAICHIR_DERNIERE) p.etat.derniere = maintenant;
    const texte = JSON.stringify(p.etat);
    if (texte !== p.etatTexte) {
      await env.RADAR_KV.put(`etat:${p.code}`, texte);
      ecritures += 1;
    }
  }
  return { personnes: personnes.length, envoyees, ecritures, requetesRestantes: budget.reste };
}

// ---------- Animés (AniList) ----------
// Suivre un animé = suivre toute sa franchise. Pour chaque animé suivi, on connaît :
//   - ses saisons (envoyées par le site, champ "saisons") ;
//   - les suites découvertes depuis par le relais (etat.franchise[id]).
// On surveille les épisodes de TOUTES ces œuvres, et on cherche de nouvelles suites
// sur chacune d'elles : la saison 3 de Frieren est une suite de la saison 2, pas de la 1.
async function verifierAnimes(env, personnes, compter, budget) {
  // Œuvres à surveiller pour chaque personne : id suivi -> ensemble des id de la franchise
  for (const p of personnes) {
    p.etat.franchise ??= {};
    p.franchises = new Map();
    for (const anime of p.items.filter((i) => i.type === 'anime')) {
      // Ancien format (avant les franchises) : on reprend les suites déjà connues
      const anciennes = p.etat.suites?.[anime.id] || [];
      const connues = new Set([anime.id, ...(anime.saisons || []), ...(p.etat.franchise[anime.id] || []), ...anciennes]);
      p.franchises.set(anime.id, connues);
    }
  }
  const ids = [...new Set(personnes.flatMap((p) => [...p.franchises.values()].flatMap((f) => [...f])))].sort((a, b) => a - b);
  if (!ids.length) return true;

  // AniList renvoie 50 résultats au plus par page : on découpe les œuvres en lots de 50.
  // Si le budget ne permet pas de tous les lire, on fait TOURNER le lot de départ d'une
  // heure à l'autre : chaque lot est relu au moins toutes les "rotation" heures.
  const lots = [];
  for (let i = 0; i < ids.length; i += 50) lots.push(ids.slice(i, i + 50));
  const lotsParPassage = Math.max(1, budget.reste - RESERVE_AUTRES);
  const rotation = Math.ceil(lots.length / lotsParPassage); // en heures (1 si tout tient)
  const maintenant = Date.now();
  const depart = Math.floor(maintenant / HEURE) % lots.length;

  // Fenêtre de recherche : depuis le dernier passage de chacun, et au moins une rotation
  // complète (+ 6 h, délai de rafraîchissement de "derniere"), au plus 3 jours.
  // Les épisodes déjà notifiés sont reconnus grâce à "vus" (mémoire de 30 jours).
  const borne = (p) => Math.max(Math.min(p.etat.derniere, maintenant - (rotation * HEURE + RAFRAICHIR_DERNIERE)), maintenant - FENETRE_MAX);
  const depuis = Math.floor(Math.min(...personnes.map(borne)) / 1000);

  const sorties = [];
  const medias = new Map();
  let panne = false;
  for (let n = 0; n < lots.length && !panne; n++) {
    const lot = lots[(depart + n) % lots.length];
    let lu = true;
    for (let page = 1; ; page++) {
      if (budget.reste <= RESERVE_AUTRES || !compter()) { lu = false; break; }
      const data = await requeteAnilist(lot, depuis, page);
      if (!data) { panne = true; break; }
      sorties.push(...data.sorties.airingSchedules);
      if (page === 1) for (const m of data.medias.media) medias.set(m.id, m);
      if (!data.sorties.pageInfo.hasNextPage) break;
    }
    if (!lu) break; // budget épuisé : les lots suivants passeront aux prochaines heures
  }
  const nom = (m) => m?.title.english || m?.title.romaji;

  for (const p of personnes) {
    const debutFenetre = borne(p);
    for (const [idSuivi, franchise] of p.franchises) {
      const anime = p.items.find((i) => i.type === 'anime' && i.id === idSuivi);

      // Épisodes diffusés dans la fenêtre, sur n'importe quelle saison ("vus" évite les doublons)
      for (const s of sorties) {
        if (!franchise.has(s.mediaId) || s.airingAt * 1000 <= debutFenetre) continue;
        p.notifs.push({
          cle: `ep:${s.mediaId}:${s.episode}`, categorie: 'episode',
          titre: `${nom(medias.get(s.mediaId)) || anime.titre} : épisode ${s.episode}`,
          corps: 'Vient d\'être diffusé au Japon.',
          url: `${env.SITE}anime.html?id=${s.mediaId}`, image: anime.image,
        });
      }

      // Nouvelles suites, sur n'importe quelle œuvre de la franchise.
      // La toute première fois (franchise jamais vérifiée), on mémorise sans notifier.
      const premiereFois = !p.etat.franchise[idSuivi];
      for (const membre of [...franchise]) {
        const media = medias.get(membre);
        if (!media) continue;
        for (const e of media.relations.edges) {
          if (e.relationType !== 'SEQUEL' || e.node.type !== 'ANIME' || franchise.has(e.node.id)) continue;
          // Une "suite" sortie AVANT l'œuvre est une suite d'histoire, pas une nouveauté
          // (ex : One Piece est la "suite" de MONSTERS, ONA de 2024)
          const ici = dateDebut(media.startDate);
          const la = dateDebut(e.node.startDate);
          if (ici && la && la < ici) continue;
          franchise.add(e.node.id); // la suite est désormais surveillée (épisodes, suites suivantes)
          if (premiereFois) continue;
          p.notifs.push({
            cle: `suite:${e.node.id}`, categorie: 'suite',
            titre: `Suite annoncée : ${nom(e.node)}`,
            corps: `La suite de ${anime.titre} est annoncée !`,
            url: `${env.SITE}anime.html?id=${e.node.id}`, image: anime.image,
          });
        }
      }
      // Franchise réellement vérifiée (au moins une œuvre reçue) : on la mémorise.
      // Sinon (lot sauté), la "première fois" reste à faire : pas de fausses "suites annoncées".
      if ([...franchise].some((id) => medias.has(id))) p.etat.franchise[idSuivi] = [...franchise];
    }
    delete p.etat.suites; // remplacé par etat.franchise
  }
  // Une panne d'AniList empêche de faire avancer la date du dernier passage
  // (le budget épuisé, lui, est couvert par la rotation et la fenêtre de recherche)
  return !panne;
}

// Une page d'épisodes diffusés + les fiches (suites) d'un lot de 50 œuvres. null si AniList échoue.
async function requeteAnilist(ids, depuis, page) {
  const reponse = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      query: `query($ids:[Int], $a:Int, $b:Int, $page:Int){
        sorties: Page(page:$page, perPage:50){ pageInfo{ hasNextPage }
          airingSchedules(mediaId_in:$ids, airingAt_greater:$a, airingAt_lesser:$b){ mediaId episode airingAt } }
        medias: Page(perPage:50){ media(id_in:$ids){ id startDate{year month day} title{romaji english} relations{ edges{ relationType node{ id type startDate{year month day} title{romaji english} } } } } }
      }`,
      variables: { ids, a: depuis, b: Math.floor(Date.now() / 1000), page },
    }),
  }).catch(() => null);
  if (!reponse?.ok) return null;
  const { data } = await reponse.json().catch(() => ({}));
  return data?.sorties && data?.medias ? data : null;
}

// ---------- ADN : sorties VOSTFR / VF ----------
async function verifierAdn(env, personnes, compter) {
  const concernes = personnes.filter((p) => p.items.some((i) => i.type === 'anime' && i.adn));
  if (!concernes.length || !compter()) return;
  const reponse = await fetch(`${env.SITE}data/adn-sorties.json`);
  if (!reponse.ok) return;
  const { sorties } = await reponse.json();
  const maintenant = Date.now();

  for (const p of concernes) {
    const parSerieAdn = new Map(p.items.filter((i) => i.type === 'anime' && i.adn).map((i) => [i.adn, i]));
    for (const s of sorties) {
      const anime = parSerieAdn.get(s.serie);
      const date = new Date(s.date).getTime();
      if (!anime || date <= p.etat.derniere || date > maintenant) continue;
      const langues = s.langues.map((l) => (l === 'vf' ? 'VF' : 'VOSTFR')).join(' + ');
      p.notifs.push({
        cle: `adn:${s.serie}:${s.saison}:${s.episode}:${s.langues.join()}`, categorie: 'vostfr',
        titre: `${anime.titre} : épisode ${s.episode} en ${langues}`,
        corps: 'Disponible maintenant sur ADN.',
        url: s.url || `${env.SITE}anime.html?id=${anime.id}`, image: anime.image,
      });
    }
  }
}

// ---------- Jeux : sort demain / aujourd'hui (le matin, vers 9 h) ----------
function verifierJeux(env, personnes) {
  if (heureParis() !== 9) return;
  const aujourdhui = parisAujourdhui(0);
  const demain = parisAujourdhui(1);
  for (const p of personnes) {
    for (const jeu of p.items.filter((i) => i.type === 'jeu' && i.sortie)) {
      const quand = jeu.sortie === demain ? 'demain' : jeu.sortie === aujourdhui ? "aujourd'hui" : null;
      if (!quand) continue;
      p.notifs.push({
        cle: `jeu:${jeu.id}:${quand}`, categorie: 'jeu',
        titre: `${jeu.titre} sort ${quand} !`,
        corps: quand === 'demain' ? 'Prépare-toi 🎮' : 'Il est disponible 🎮',
        url: `${env.SITE}jeu.html?id=${jeu.id}`, image: jeu.image,
      });
    }
  }
}

// ---------- Mangas (MangaUpdates) ----------
// On cherche d'abord la série MangaUpdates correspondante (une seule fois),
// puis on compare le nombre de tomes et le dernier chapitre.
async function verifierMangas(env, personnes, compter, budget) {
  const maintenant = Date.now();
  // Mangas à vérifier, du moins récemment vérifié au plus récent
  const aFaire = new Map();
  for (const p of personnes) {
    for (const m of p.items.filter((i) => i.type === 'manga')) {
      const vu = p.etat.manga[m.id]?.vu || 0;
      if (maintenant - vu >= RECHECK) aFaire.set(m.id, { manga: m, vu: Math.min(vu, aFaire.get(m.id)?.vu ?? Infinity) });
    }
  }
  const tries = [...aFaire.values()].sort((a, b) => a.vu - b.vu);
  const resultats = new Map();

  for (const { manga } of tries) {
    if (budget.reste < 3) break;
    const connu = personnes.map((p) => p.etat.manga[manga.id]).find((e) => e?.mu);
    let mu = connu?.mu;
    if (!mu) {
      if (!compter()) break;
      mu = await chercherMangaUpdates(manga).catch(() => null);
      if (!mu) { resultats.set(manga.id, { introuvable: true }); continue; }
    }
    if (!compter()) break;
    const serie = await fetch(`https://api.mangaupdates.com/v1/series/${mu}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!serie) continue;
    resultats.set(manga.id, {
      mu,
      tomes: Number(serie.status?.match(/(\d+)\s+Volumes?/i)?.[1]) || null,
      chapitre: Number(serie.latest_chapter) || null,
    });
  }

  for (const p of personnes) {
    for (const m of p.items.filter((i) => i.type === 'manga')) {
      const nouveau = resultats.get(m.id);
      if (!nouveau) continue;
      const ancien = p.etat.manga[m.id];
      if (ancien?.tomes && nouveau.tomes > ancien.tomes) {
        p.notifs.push({ cle: `tome:${m.id}:${nouveau.tomes}`, categorie: 'manga', titre: `${m.titre} : tome ${nouveau.tomes}`, corps: 'Nouveau tome sorti au Japon.', url: `${env.SITE}anime.html?id=${m.id}`, image: m.image });
      } else if (ancien?.chapitre && nouveau.chapitre > ancien.chapitre) {
        p.notifs.push({ cle: `chap:${m.id}:${nouveau.chapitre}`, categorie: 'manga', titre: `${m.titre} : chapitre ${nouveau.chapitre}`, corps: 'Nouveau chapitre sorti au Japon.', url: `${env.SITE}anime.html?id=${m.id}`, image: m.image });
      }
      p.etat.manga[m.id] = { ...nouveau, vu: maintenant };
    }
  }
}

async function chercherMangaUpdates(manga) {
  const reponse = await fetch('https://api.mangaupdates.com/v1/series/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ search: manga.titres?.[0] || manga.titre, perpage: 15 }),
  });
  if (!reponse.ok) return null;
  const { results } = await reponse.json();
  // On écarte les doujinshis, anthologies, romans… et on préfère un titre identique
  const candidats = results.map((r) => r.record)
    .filter((r) => ['Manga', 'Manhwa', 'Manhua'].includes(r.type) && !/\bdj\b|anthology|\(novel\)/i.test(r.title));
  const voulus = new Set([manga.titre, ...(manga.titres || [])].map(normaliser));
  return (candidats.find((r) => voulus.has(normaliser(r.title))) || candidats[0])?.series_id || null;
}

// ---------- Films et séries (TMDB) ----------
async function verifierTmdb(env, personnes, compter, budget) {
  const maintenant = Date.now();
  const aFaire = new Map();
  for (const p of personnes) {
    for (const o of p.items.filter((i) => i.type === 'film' || i.type === 'serie')) {
      const cle = `${o.type}:${o.id}`;
      const vu = p.etat.tmdb[cle]?.vu || 0;
      if (maintenant - vu >= RECHECK) aFaire.set(cle, { oeuvre: o, vu: Math.min(vu, aFaire.get(cle)?.vu ?? Infinity) });
    }
  }
  const resultats = new Map();
  for (const [cle, { oeuvre }] of [...aFaire].sort((a, b) => a[1].vu - b[1].vu)) {
    if (budget.reste < 1 || !compter()) break;
    try {
      if (oeuvre.type === 'serie') {
        const s = await tmdb(env, `/tv/${oeuvre.id}`);
        resultats.set(cle, {
          saisons: s.number_of_seasons,
          dernierEp: s.last_episode_to_air ? { s: s.last_episode_to_air.season_number, e: s.last_episode_to_air.episode_number, date: s.last_episode_to_air.air_date } : null,
        });
      } else {
        const f = await tmdb(env, `/movie/${oeuvre.id}`, { append_to_response: 'release_dates,watch/providers' });
        const sortiesFr = f.release_dates?.results?.find((r) => r.iso_3166_1 === 'FR')?.release_dates || [];
        resultats.set(cle, {
          cinema: sortiesFr.find((r) => r.type === 3)?.release_date?.slice(0, 10) || null,
          plateformes: (f['watch/providers']?.results?.FR?.flatrate || []).map((x) => x.provider_name),
        });
      }
    } catch { /* on réessaiera au prochain passage */ }
  }

  const demain = parisAujourdhui(1);
  for (const p of personnes) {
    for (const o of p.items.filter((i) => i.type === 'film' || i.type === 'serie')) {
      const cle = `${o.type}:${o.id}`;
      const nouveau = resultats.get(cle);
      if (!nouveau) continue;
      const ancien = p.etat.tmdb[cle];
      if (o.type === 'serie' && ancien) {
        if (nouveau.saisons > ancien.saisons) {
          p.notifs.push({ cle: `saison:${o.id}:${nouveau.saisons}`, categorie: 'serie', titre: `${o.titre} : saison ${nouveau.saisons} annoncée`, corps: 'Une nouvelle saison arrive !', url: `https://www.themoviedb.org/tv/${o.id}`, image: o.image });
        } else if (nouveau.dernierEp && JSON.stringify(nouveau.dernierEp) !== JSON.stringify(ancien.dernierEp)) {
          const { s, e } = nouveau.dernierEp;
          p.notifs.push({ cle: `ep-serie:${o.id}:${s}:${e}`, categorie: 'serie', titre: `${o.titre} : S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`, corps: 'Nouvel épisode diffusé.', url: `https://www.themoviedb.org/tv/${o.id}`, image: o.image });
        }
      }
      if (o.type === 'film') {
        if (nouveau.cinema === demain) {
          p.notifs.push({ cle: `cine:${o.id}`, categorie: 'film', titre: `${o.titre} sort au cinéma demain`, corps: 'Prévois ta séance 🍿', url: `https://www.themoviedb.org/movie/${o.id}`, image: o.image });
        }
        const nouvelles = ancien ? nouveau.plateformes.filter((x) => !ancien.plateformes?.includes(x)) : [];
        if (nouvelles.length) {
          p.notifs.push({ cle: `plateforme:${o.id}:${nouvelles.join()}`, categorie: 'film', titre: `${o.titre} est sur ${nouvelles.join(', ')}`, corps: 'Disponible en streaming en France.', url: `https://www.themoviedb.org/movie/${o.id}`, image: o.image });
        }
      }
      p.etat.tmdb[cle] = { ...nouveau, vu: maintenant };
    }
  }
}

