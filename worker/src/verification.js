// =========================================================
// Vérification horaire (tâche planifiée Cloudflare, "cron").
//
// Pour chaque personne abonnée aux notifications, on regarde ce qui est nouveau
// depuis le dernier passage, sur sa watchlist :
//   - animés  : épisode diffusé au Japon, dispo sur ADN, suite annoncée
//   - mangas  : nouveau tome ou chapitre
//   - séries  : nouvel épisode, nouvelle saison (TMDB)
//   - films   : sortie au cinéma demain, arrivée sur une plateforme (TMDB)
//   - jeux    : sort demain / aujourd'hui (date enregistrée dans la liste)
//
// AniList et MangaUpdates refusent les requêtes venant de Cloudflare (403, constaté le
// 25/10/2026) : le relais ne les appelle plus. La collecte horaire GitHub Actions le fait
// à sa place et publie avec le site :
//   - data/anilist.json : tous les épisodes d'avant-hier à J+7 (scripts/collecte_anilist.py) ;
//   - data/suivis.json  : suites des animés suivis, tomes et chapitres des mangas suivis
//     (scripts/collecte_suivis.py ; la tâche horaire lui passe les identifiants suivis, github.js).
//
// Limites du plan gratuit de Cloudflare : 50 requêtes sortantes par passage.
// Les films et séries sont donc vérifiés à tour de rôle : chacun au plus toutes les 6 h.
// Chaque passage se termine par un bilan dans les journaux (resumer() + détail en JSON).
// =========================================================
import { avecCloche, coutEnvoi, pousser } from './comptes.js';
import { stockage } from './stockage.js';
import { tmdb } from './tmdb.js';

const HEURE = 3600_000;
// Limite gratuite : 50 requêtes sortantes par passage. On en garde 4 (lancement du workflow,
// anti-pause Supabase, marge) : 46 au total, dont 30 au plus pour vérifier les nouveautés ;
// le reste sert aux notifications push (une requête par notification et par appareil).
const BUDGET_TOTAL = 46;
const BUDGET_VERIFICATION = 30;
const RECHECK = 6 * HEURE;
const RAFRAICHIR_DERNIERE = 6 * HEURE;
const FENETRE_MAX = 3 * 24 * HEURE; // épisodes cherchés au plus 3 jours en arrière
const FICHIER_VIEUX = 3 * HEURE;    // au-delà, la collecte GitHub a sans doute raté des passages

// Date et heure à Paris (pour les notifs "sort demain", envoyées le matin)
function parisAujourdhui(decalageJours = 0) {
  const d = new Date(Date.now() + decalageJours * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d); // AAAA-MM-JJ
}
const heureParis = () => Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()));

/**
 * Toutes les personnes qui ont une liste (notifs push activées ou non : sans push, les
 * nouveautés vont quand même dans la cloche du site), à partir de stockage.chargerComptes().
 */
export function lirePersonnes(comptes) {
  const personnes = [];
  for (const c of comptes) {
    const liste = lireJson(c.liste, { items: [] });
    if (!liste.items?.length) continue;
    const etat = lireJson(c.etat, null) || { derniere: Date.now() - HEURE, vus: {}, franchise: {}, manga: {}, tmdb: {} };
    etat.manga ??= {};
    etat.tmdb ??= {};
    etat.franchise ??= {};
    const p = { code: c.code, abo: lireJson(c.abo, null), histo: lireJson(c.histo, []), items: liste.items, etat, etatTexte: c.etat, notifs: [] };
    p.franchises = franchises(p);
    personnes.push(p);
  }
  return personnes;
}

/** Identifiants AniList à faire suivre par la collecte GitHub (scripts/collecte_suivis.py). */
export function oeuvresSuivies(personnes) {
  const trier = (ids) => [...new Set(ids)].sort((a, b) => a - b);
  return {
    animes: trier(personnes.flatMap((p) => [...p.franchises.values()].flatMap((f) => [...f]))),
    mangas: trier(personnes.flatMap((p) => p.items.filter((i) => i.type === 'manga').map((i) => i.id))),
  };
}

// Code perso abrégé dans les journaux : assez pour reconnaître une liste, pas pour y accéder
const abreger = (code) => `${code.slice(0, 6)}…`;

export async function verifier(env, personnes) {
  const budget = { reste: BUDGET_VERIFICATION };
  const compter = () => { budget.reste -= 1; return budget.reste >= 0; };
  const stock = stockage(env);
  const bilan = {
    listes: personnes.length,
    avecPush: personnes.filter((p) => p.abo?.abonnements?.length).length,
    sources: {},
    detectees: {},       // nouveautés trouvées, par catégorie (avant le tri)
    nouvelles: 0,        // ... dont jamais vues et voulues : cloche + push
    ignorees: { dejaVues: 0, preferences: 0 },
    cloches: 0,
    push: { envoyees: 0, echecs: 0, raisons: {}, appareilsRetires: 0, enAttente: 0, sansAppareil: 0 },
    erreurs: [],
    parListe: [],
  };
  await stock.nettoyer();
  if (!personnes.length) return bilan;

  // 1. Fichiers publiés par la collecte GitHub (AniList et MangaUpdates bloquent Cloudflare)
  const suiventAnimes = personnes.some((p) => p.franchises.size);
  const suiventMangas = personnes.some((p) => p.items.some((i) => i.type === 'manga'));
  const calendrier = suiventAnimes ? await lireFichier(env, 'anilist.json', compter, bilan) : null;
  const suivis = suiventAnimes || suiventMangas ? await lireFichier(env, 'suivis.json', compter, bilan) : null;
  if (suiventAnimes) bilan.sources.calendrier = decrire(calendrier, calendrier?.calendrier?.episodes, 'épisodes', bilan);
  if (suivis || suiventAnimes || suiventMangas) bilan.sources.suivis = decrire(suivis, suivis?.animes, 'animés', bilan);

  // 2. Animés : épisodes diffusés (calendrier) et suites annoncées.
  //    false si le calendrier est illisible : on rattrapera au prochain passage.
  const animesComplets = verifierAnimes(env, personnes, calendrier, suivis);
  // 3. ADN (VOSTFR / VF), un seul petit fichier pour tout le monde
  await verifierAdn(env, personnes, compter, bilan);
  // 4. Jeux : rien à télécharger, la date de sortie est dans la liste
  verifierJeux(env, personnes);
  // 5. Mangas (fichier des suivis), puis séries et films : une requête par œuvre, dans la limite du budget
  verifierMangas(env, personnes, suivis);
  if (env.TMDB_KEY) await verifierTmdb(env, personnes, compter, budget, bilan);

  // 6. Ce qui reste du budget (les vérifications non faites) sert aux notifications push.
  //    Chaque envoi est une requête : ce qui ne rentre pas attend le passage suivant (24 h au plus).
  let pourPush = BUDGET_TOTAL - (BUDGET_VERIFICATION - Math.max(0, budget.reste));
  const maintenant = Date.now();
  const ecritures = [];
  const envois = [];
  for (const p of personnes) {
    const prefs = p.abo?.prefs || {};
    const deja = new Set(Object.keys(p.etat.vus || {}));
    for (const n of p.notifs) bilan.detectees[n.categorie] = (bilan.detectees[n.categorie] || 0) + 1;
    const nouvelles = p.notifs.filter((n) => prefs[n.categorie] !== false && !deja.has(n.cle));
    bilan.ignorees.dejaVues += p.notifs.filter((n) => deja.has(n.cle)).length;
    bilan.ignorees.preferences += p.notifs.filter((n) => !deja.has(n.cle) && prefs[n.categorie] === false).length;
    bilan.nouvelles += nouvelles.length;
    if (nouvelles.length) bilan.cloches += 1;
    p.bilan = {
      code: abreger(p.code),
      animes: p.franchises.size,
      mangas: p.items.filter((i) => i.type === 'manga').length,
      appareils: p.abo?.abonnements?.length || 0,
      detectees: p.notifs.length,
      nouvelles: nouvelles.length,
      push: 'rien de nouveau',
    };
    const pourAfficher = nouvelles.map(({ cle, categorie, ...n }) => n);
    // On retient ce qui a été vu (et on oublie ce qui a plus de 30 jours)
    p.etat.vus = Object.fromEntries([
      ...Object.entries(p.etat.vus || {}).filter(([, t]) => maintenant - t < 30 * 86400_000),
      ...nouvelles.map((n) => [n.cle, maintenant]),
    ]);
    // Push : celles en attente d'un passage précédent, puis les nouvelles
    const aPousser = [...(p.etat.pushEnAttente || []).filter((n) => maintenant - n.depuis < 86400_000),
      ...pourAfficher.map((n) => ({ ...n, depuis: maintenant }))];
    const cout = coutEnvoi(p.abo, aPousser);
    if (cout && cout <= pourPush) {
      pourPush -= cout;
      envois.push({ p, notifs: aPousser.map(({ depuis, ...n }) => n) });
      delete p.etat.pushEnAttente;
    } else if (cout) {
      p.etat.pushEnAttente = aPousser.slice(-20);
      p.bilan.push = `${aPousser.length} en attente (budget de requêtes épuisé)`;
    } else {
      delete p.etat.pushEnAttente;
      if (pourAfficher.length) {
        bilan.push.sansAppareil += 1;
        p.bilan.push = 'aucun appareil abonné (cloche seulement)';
      }
    }
    // "derniere" (date du dernier passage) n'est rafraîchie que toutes les 6 h : entre-temps,
    // les nouveautés déjà envoyées sont reconnues grâce à "vus" (pas de doublon).
    // Calendrier illisible pendant ce passage : on ne l'avance pas, le suivant rattrapera.
    if (animesComplets && maintenant - p.etat.derniere >= RAFRAICHIR_DERNIERE) p.etat.derniere = maintenant;
    const texte = JSON.stringify(p.etat);
    if (texte !== p.etatTexte) ecritures.push([`etat:${p.code}`, texte]);
    if (pourAfficher.length) ecritures.push([`histo:${p.code}`, JSON.stringify(avecCloche(p.histo, pourAfficher))]);
  }

  // 7. On enregistre TOUT (état + cloche) AVANT d'envoyer quoi que ce soit, en une fois.
  //    Si l'écriture échoue, rien ne part : le passage suivant refera le même calcul, sans doublon.
  try {
    bilan.ecritures = await stock.ecrirePlusieurs(ecritures);
  } catch (erreur) {
    bilan.erreurs.push(`Écriture impossible, aucune notification envoyée : ${erreur.message}`);
    bilan.parListe = personnes.map((p) => p.bilan);
    return bilan;
  }

  // 8. Envoi des notifications push (appareils désabonnés retirés ensuite, en une écriture)
  const abosAJour = [];
  for (const { p, notifs } of envois) {
    const { envoyees, expires, echecs } = await pousser(env, p.abo, notifs);
    bilan.push.envoyees += envoyees;
    bilan.push.echecs += echecs.length;
    for (const raison of echecs) bilan.push.raisons[raison] = (bilan.push.raisons[raison] || 0) + 1;
    p.bilan.push = `${envoyees} envoyée(s)${echecs.length ? `, ${echecs.length} échec(s) : ${[...new Set(echecs)].join(' ; ')}` : ''}`
      + `${expires.size ? `, ${expires.size} appareil(s) désabonné(s) retiré(s)` : ''}`;
    if (expires.size) {
      bilan.push.appareilsRetires += expires.size;
      p.abo.abonnements = p.abo.abonnements.filter((a) => !expires.has(a.endpoint));
      abosAJour.push([`abo:${p.code}`, JSON.stringify(p.abo)]);
    }
  }
  if (abosAJour.length) await stock.ecrirePlusieurs(abosAJour).catch((erreur) => bilan.erreurs.push(`Abonnements expirés non retirés : ${erreur.message}`));
  bilan.push.enAttente = personnes.filter((p) => p.etat.pushEnAttente?.length).length;
  bilan.requetesRestantes = pourPush;
  bilan.parListe = personnes.map((p) => p.bilan);
  return bilan;
}

/** Le bilan d'un passage en une phrase, pour les journaux (Workers Logs). */
export function resumer(b) {
  const parCategorie = Object.entries(b.detectees).map(([c, n]) => `${c} ${n}`).join(', ');
  const total = Object.values(b.detectees).reduce((a, n) => a + n, 0);
  const sources = Object.entries(b.sources).map(([nom, s]) => `${nom} ${s.ok ? `OK (${s.age}${s.nombre !== undefined ? `, ${s.nombre} ${s.quoi}` : ''})` : 'ILLISIBLE'}`).join(', ');
  const raisons = Object.entries(b.push.raisons).map(([r, n]) => `${n}× ${r}`).join(' ; ');
  return [
    `${b.listes} liste(s) vérifiée(s) (${b.avecPush} avec notifs push)`,
    `${total} nouveauté(s) détectée(s)${parCategorie ? ` (${parCategorie})` : ''}, dont ${b.nouvelles} nouvelle(s)`
      + ` (déjà vues : ${b.ignorees.dejaVues}, coupées par les préférences : ${b.ignorees.preferences})`,
    `cloche de ${b.cloches} personne(s)`,
    `push : ${b.push.envoyees} envoyée(s), ${b.push.echecs} échec(s)${raisons ? ` [${raisons}]` : ''}`
      + `, ${b.push.enAttente} en attente, ${b.push.sansAppareil} sans appareil`,
    `sources : ${sources || 'aucune'}`,
    `erreurs : ${b.erreurs.length ? b.erreurs.join(' ; ') : 'aucune'}`,
  ].join(' · ');
}

const lireJson = (texte, defaut) => {
  try { return texte ? JSON.parse(texte) : defaut; } catch { return defaut; }
};

// Fichier JSON publié avec le site (data/…). null s'il est illisible (raison dans le bilan).
// Le paramètre ?h= change toutes les heures : on ne lit pas une copie gardée en cache.
async function lireFichier(env, nom, compter, bilan) {
  if (!compter()) {
    bilan.erreurs.push(`${nom} : budget de requêtes épuisé`);
    return null;
  }
  try {
    const reponse = await fetch(`${env.SITE}data/${nom}?h=${Math.floor(Date.now() / HEURE)}`, { signal: AbortSignal.timeout(10_000) });
    if (!reponse.ok) throw new Error(`réponse ${reponse.status}`);
    return await reponse.json();
  } catch (erreur) {
    bilan.erreurs.push(`${nom} illisible : ${erreur.message}`);
    return null;
  }
}

// Âge d'un fichier de la collecte, pour le bilan (et une alerte s'il n'est plus mis à jour)
function decrire(fichier, contenu, quoi, bilan) {
  if (!fichier || !contenu) return { ok: false };
  const age = Date.now() - Date.parse(fichier.genere);
  const heures = Math.floor(age / HEURE);
  if (age > FICHIER_VIEUX) bilan.erreurs.push(`fichier de la collecte GitHub vieux de ${heures} h (généré le ${fichier.genere})`);
  return { ok: true, age: heures ? `${heures} h ${Math.round((age % HEURE) / 60_000)} min` : `${Math.round(age / 60_000)} min`, nombre: Object.keys(contenu).length, quoi };
}

// ---------- Animés ----------
// Suivre un animé = suivre toute sa franchise. Pour chaque animé suivi, on connaît :
//   - ses saisons (envoyées par le site, champ "saisons") ;
//   - les suites découvertes depuis par le relais (etat.franchise[id]).
// On surveille les épisodes de TOUTES ces œuvres, et on cherche de nouvelles suites
// sur chacune d'elles : la saison 3 de Frieren est une suite de la saison 2, pas de la 1.

// Œuvres à surveiller pour une personne : id suivi -> ensemble des id de la franchise
function franchises(p) {
  const resultat = new Map();
  for (const anime of p.items.filter((i) => i.type === 'anime')) {
    // Ancien format (avant les franchises) : on reprend les suites déjà connues
    const anciennes = p.etat.suites?.[anime.id] || [];
    resultat.set(anime.id, new Set([anime.id, ...(anime.saisons || []), ...(p.etat.franchise[anime.id] || []), ...anciennes]));
  }
  return resultat;
}

// "Vient d'être diffusé", ou la date si l'épisode date un peu (rattrapage après une panne)
const quandDiffuse = (airingAt) => (Date.now() - airingAt * 1000 < 2 * HEURE
  ? 'Vient d\'être diffusé au Japon.'
  : `Diffusé au Japon ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(airingAt * 1000)}.`);

// calendrier : data/anilist.json (épisodes d'avant-hier à J+7, toutes séries confondues) ;
// suivis : data/suivis.json (suites de chaque animé suivi). Renvoie false si le calendrier manque.
function verifierAnimes(env, personnes, calendrier, suivis) {
  const episodes = calendrier?.calendrier?.episodes;
  const fiches = suivis?.animes;
  const maintenant = Date.now();
  // Fenêtre de recherche : depuis le dernier passage de chacun, au moins 6 h (délai de
  // rafraîchissement de "derniere"), au plus 3 jours. Les épisodes déjà notifiés sont
  // reconnus grâce à "vus" (mémoire de 30 jours).
  const borne = (p) => Math.max(Math.min(p.etat.derniere, maintenant - RAFRAICHIR_DERNIERE), maintenant - FENETRE_MAX);
  const nom = (media) => media.title.english || media.title.romaji;

  for (const p of personnes) {
    const debutFenetre = borne(p);
    for (const [idSuivi, franchise] of p.franchises) {
      const anime = p.items.find((i) => i.type === 'anime' && i.id === idSuivi);

      // Épisodes diffusés dans la fenêtre, sur n'importe quelle saison ("vus" évite les doublons)
      for (const e of episodes || []) {
        const diffusion = e.airingAt * 1000;
        if (!franchise.has(e.media?.id) || diffusion <= debutFenetre || diffusion > maintenant) continue;
        p.notifs.push({
          cle: `ep:${e.media.id}:${e.episode}`, categorie: 'episode',
          titre: `${nom(e.media) || anime.titre} : épisode ${e.episode}`,
          corps: quandDiffuse(e.airingAt),
          url: `${env.SITE}anime.html?id=${e.media.id}`, image: anime.image,
        });
      }

      // Nouvelles suites, sur n'importe quelle œuvre de la franchise.
      // La toute première fois (franchise jamais vérifiée), on mémorise sans notifier.
      if (!fiches) continue;
      const premiereFois = !p.etat.franchise[idSuivi];
      for (const membre of [...franchise]) {
        const fiche = fiches[membre];
        if (!fiche) continue;
        for (const suite of fiche.suites) {
          if (franchise.has(suite.id)) continue;
          // Une "suite" sortie AVANT l'œuvre est une suite d'histoire, pas une nouveauté
          // (ex : One Piece est la "suite" de MONSTERS, ONA de 2024)
          if (fiche.debut && suite.debut && suite.debut < fiche.debut) continue;
          franchise.add(suite.id); // la suite est désormais surveillée (épisodes, suites suivantes)
          if (premiereFois) continue;
          p.notifs.push({
            cle: `suite:${suite.id}`, categorie: 'suite',
            titre: `Suite annoncée : ${suite.titre}`,
            corps: `La suite de ${anime.titre} est annoncée !`,
            url: `${env.SITE}anime.html?id=${suite.id}`, image: anime.image,
          });
        }
      }
      // Franchise réellement vérifiée (au moins une œuvre dans le fichier) : on la mémorise.
      // Sinon (animé tout juste suivi, pas encore collecté), la "première fois" reste à faire :
      // pas de fausses "suites annoncées".
      if ([...franchise].some((id) => fiches[id])) p.etat.franchise[idSuivi] = [...franchise];
    }
    delete p.etat.suites; // remplacé par etat.franchise
  }
  return Array.isArray(episodes);
}

// ---------- ADN : sorties VOSTFR / VF ----------
async function verifierAdn(env, personnes, compter, bilan) {
  const concernes = personnes.filter((p) => p.items.some((i) => i.type === 'anime' && i.adn));
  if (!concernes.length) return;
  const fichier = await lireFichier(env, 'adn-sorties.json', compter, bilan);
  bilan.sources.adn = decrire(fichier, fichier?.sorties, 'sorties', { erreurs: [] });
  if (!fichier?.sorties) return;
  const { sorties } = fichier;
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

// ---------- Mangas ----------
// La collecte GitHub (data/suivis.json) donne, pour chaque manga suivi, sa série MangaUpdates,
// son dernier tome et son dernier chapitre ; on compare avec ce que chacun a déjà vu.
function verifierMangas(env, personnes, suivis) {
  if (!suivis?.mangas) return;
  for (const p of personnes) {
    for (const m of p.items.filter((i) => i.type === 'manga')) {
      const nouveau = suivis.mangas[m.id];
      if (!nouveau?.mu) continue; // pas encore collecté, ou introuvable sur MangaUpdates
      const ancien = p.etat.manga[m.id];
      if (ancien?.tomes && nouveau.tomes > ancien.tomes) {
        p.notifs.push({ cle: `tome:${m.id}:${nouveau.tomes}`, categorie: 'manga', titre: `${m.titre} : tome ${nouveau.tomes}`, corps: 'Nouveau tome sorti au Japon.', url: `${env.SITE}anime.html?id=${m.id}`, image: m.image });
      } else if (ancien?.chapitre && nouveau.chapitre > ancien.chapitre) {
        p.notifs.push({ cle: `chap:${m.id}:${nouveau.chapitre}`, categorie: 'manga', titre: `${m.titre} : chapitre ${nouveau.chapitre}`, corps: 'Nouveau chapitre sorti au Japon.', url: `${env.SITE}anime.html?id=${m.id}`, image: m.image });
      }
      // Un tome ou un chapitre inconnu ce passage-ci ne fait pas oublier le précédent
      p.etat.manga[m.id] = { mu: nouveau.mu, tomes: nouveau.tomes ?? ancien?.tomes ?? null, chapitre: nouveau.chapitre ?? ancien?.chapitre ?? null };
    }
  }
}

// ---------- Films et séries (TMDB) ----------
async function verifierTmdb(env, personnes, compter, budget, bilan) {
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
    } catch (erreur) {
      bilan.erreurs.push(`TMDB ${cle} : ${erreur.message}`); // on réessaiera au prochain passage
    }
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

