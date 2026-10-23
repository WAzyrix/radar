// =========================================================
// Code partagé par les deux pages de la maquette :
// appel AniList + cache, traductions, nav, recherche, couleur d'accent.
// (Dans la V1, ce fichier sera découpé en js/anilist.js, js/ui/…)
// =========================================================

const ANILIST_URL = 'https://graphql.anilist.co';
const DUREE_CACHE = 10 * 60 * 1000; // 10 minutes

// Appelle l'API GraphQL d'AniList.
// On met la réponse en cache dans sessionStorage : si on recharge la page,
// on ne refait pas la requête. Important car AniList limite à ~30 requêtes/minute.
export async function anilist(query, variables = {}) {
  const cle = 'anilist:' + JSON.stringify([query, variables]);
  try {
    const enCache = JSON.parse(sessionStorage.getItem(cle));
    if (enCache && Date.now() - enCache.t < DUREE_CACHE) return enCache.data;
  } catch { /* cache illisible : on ignore */ }

  const reponse = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (reponse.status === 429) throw new Error('AniList reçoit trop de requêtes, réessaie dans une minute.');
  const json = await reponse.json();
  if (json.errors) throw new Error(json.errors[0].message);

  try { sessionStorage.setItem(cle, JSON.stringify({ t: Date.now(), data: json.data })); } catch { /* stockage plein */ }
  return json.data;
}

// Échappe le texte avant de l'insérer dans du HTML (évite les injections).
export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Titre affiché : anglais s'il existe, sinon romaji.
export const titre = (media) => media.title.english || media.title.romaji;

// Le synopsis AniList contient un peu de HTML (<br>, <i>) : on garde juste le texte.
export function nettoyerSynopsis(html) {
  const avecRetours = (html || '').replace(/<br\s*\/?>/gi, '\n');
  const texte = new DOMParser().parseFromString(avecRetours, 'text/html').body.textContent;
  return texte.replace(/\n{3,}/g, '\n\n').trim();
}

export const note = (score) => (score ? (score / 10).toFixed(1).replace('.', ',') : '—');

// ---------- Traductions des valeurs AniList ----------
export const GENRES_FR = {
  Action: 'Action', Adventure: 'Aventure', Comedy: 'Comédie', Drama: 'Drame', Ecchi: 'Ecchi',
  Fantasy: 'Fantasy', Horror: 'Horreur', 'Mahou Shoujo': 'Magical girl', Mecha: 'Mecha',
  Music: 'Musique', Mystery: 'Mystère', Psychological: 'Psychologique', Romance: 'Romance',
  'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie', Sports: 'Sport',
  Supernatural: 'Surnaturel', Thriller: 'Thriller',
};
export const STATUTS_FR = {
  FINISHED: 'Terminé', RELEASING: 'En cours', NOT_YET_RELEASED: 'À venir', CANCELLED: 'Annulé', HIATUS: 'En pause',
};
export const FORMATS_FR = {
  TV: 'Série TV', TV_SHORT: 'Format court', MOVIE: 'Film', SPECIAL: 'Spécial', OVA: 'OVA', ONA: 'ONA',
  MUSIC: 'Clip', MANGA: 'Manga', NOVEL: 'Light novel', ONE_SHOT: 'One-shot',
};
export const RELATIONS_FR = {
  SEQUEL: 'Suite', PREQUEL: 'Préquelle', SIDE_STORY: 'Histoire parallèle', SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Autre version', ADAPTATION: 'Adaptation', SOURCE: 'Œuvre originale', PARENT: 'Œuvre principale',
  SUMMARY: 'Résumé', COMPILATION: 'Compilation', CONTAINS: 'Contient', CHARACTER: 'Personnages', OTHER: 'Autre',
};

// ---------- Couleur d'accent tirée de l'affiche ----------
// AniList donne la couleur dominante de chaque affiche (ex: "#e49335").
// Elle peut être trop sombre ou trop terne : on la convertit en HSL
// et on borne la luminosité pour qu'elle reste lisible sur fond sombre.
export function appliquerAccent(hex) {
  if (!hex) return;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  const sat = Math.min(Math.max(s * 100, 45), 85);
  const lum = Math.min(Math.max(l * 100, 58), 72);
  document.documentElement.style.setProperty('--accent', `hsl(${Math.round(h)} ${Math.round(sat)}% ${Math.round(lum)}%)`);
}

// ---------- Icônes (SVG inline, pas de dépendance externe) ----------
export const ICONES = {
  accueil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  anime: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4-2.5z"/></svg>',
  cyber: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  monde: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
  loupe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  de: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  lecture: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>',
  externe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

// ---------- Navigation (identique sur toutes les pages) ----------
const PAGES = [
  { id: 'accueil', nom: 'Accueil', lien: 'index.html' },
  { id: 'anime', nom: 'Animés', lien: 'anime.html' },
  { id: 'film', nom: 'Films', lien: '#' },
  { id: 'cyber', nom: 'Cyber', lien: '#' },
  { id: 'monde', nom: 'Actu', lien: '#' },
];

export function afficherNavigation(pageActive) {
  const liens = PAGES.map((p) => `<a href="${p.lien}" class="${p.id === pageActive ? 'actif' : ''}">${p.nom}</a>`).join('');
  const onglets = PAGES.map((p) => `<a href="${p.lien}" class="${p.id === pageActive ? 'actif' : ''}">${ICONES[p.id]}${p.nom}</a>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <header class="nav">
      <a href="index.html" class="logo"><span class="logo-point"></span>Radar</a>
      <nav class="nav-liens">${liens}</nav>
      <div class="recherche">
        ${ICONES.loupe}
        <input type="search" placeholder="Rechercher un animé…" aria-label="Rechercher un animé" autocomplete="off">
        <div class="resultats"></div>
      </div>
    </header>`);
  document.body.insertAdjacentHTML('beforeend', `<nav class="onglets">${onglets}</nav>`);
  brancherRecherche();
}

// Recherche en direct : on attend que l'utilisateur arrête de taper (350 ms)
// avant d'appeler AniList, pour ne pas envoyer une requête par lettre.
function brancherRecherche() {
  const champ = document.querySelector('.recherche input');
  const boite = document.querySelector('.resultats');
  let minuteur;

  champ.addEventListener('input', () => {
    clearTimeout(minuteur);
    const texte = champ.value.trim();
    if (texte.length < 3) { boite.classList.remove('ouvert'); return; }

    minuteur = setTimeout(async () => {
      const data = await anilist(`query($s:String){ Page(perPage:6){ media(search:$s, type:ANIME, isAdult:false, sort:SEARCH_MATCH){
        id title{romaji english} format seasonYear coverImage{medium color} } } }`, { s: texte });
      const medias = data.Page.media;
      boite.innerHTML = medias.length
        ? medias.map((m) => `
          <a href="anime.html?id=${m.id}">
            <img src="${m.coverImage.medium}" alt="" style="background:${m.coverImage.color}">
            <div><strong>${echapper(titre(m))}</strong><span>${[FORMATS_FR[m.format], m.seasonYear].filter(Boolean).join(' · ')}</span></div>
          </a>`).join('')
        : '<span style="display:block;padding:10px">Aucun résultat</span>';
      boite.classList.add('ouvert');
    }, 350);
  });

  // Ferme la liste quand on clique ailleurs
  document.addEventListener('click', (e) => { if (!e.target.closest('.recherche')) boite.classList.remove('ouvert'); });
}

// ---------- Carte "affiche" réutilisable ----------
export function carteAffiche(media, { sous = '', etiquette = '' } = {}) {
  const couleur = media.coverImage.color || '#1a1a24';
  return `
    <a class="affiche" href="anime.html?id=${media.id}" style="--couleur:${couleur}">
      <div class="affiche-image">
        <img src="${media.coverImage.extraLarge || media.coverImage.large}" alt="" loading="lazy">
        ${media.averageScore ? `<span class="affiche-note">★ ${note(media.averageScore)}</span>` : ''}
        ${etiquette ? `<span class="relation">${echapper(etiquette)}</span>` : ''}
      </div>
      <div class="affiche-titre">${echapper(titre(media))}</div>
      ${sous ? `<div class="affiche-sous">${echapper(sous)}</div>` : ''}
    </a>`;
}

// ---------- Animé au hasard ----------
// AniList n'a pas de "random". Astuce : on compte combien d'animés
// correspondent aux critères, puis on demande une page au hasard (1 résultat par page).
export async function animeAuHasard() {
  const filtres = 'type:ANIME, isAdult:false, averageScore_greater:65, popularity_greater:5000';
  const compte = await anilist(`query{ Page(perPage:1){ pageInfo{ total } media(${filtres}){ id } } }`);
  const total = Math.min(compte.Page.pageInfo.total, 5000);
  const page = 1 + Math.floor(Math.random() * total);
  // Pas de cache ici : on veut un tirage différent à chaque fois
  const reponse = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: `query($p:Int){ Page(page:$p, perPage:1){ media(${filtres}, sort:POPULARITY_DESC){ id } } }`, variables: { p: page } }),
  });
  const json = await reponse.json();
  return json.data.Page.media[0]?.id;
}

export function brancherBoutonHasard(bouton) {
  bouton.addEventListener('click', async (e) => {
    e.preventDefault(); // utile si c'est un lien <a href="#">
    bouton.disabled = true;
    const id = await animeAuHasard();
    if (id) location.href = `anime.html?id=${id}`;
    bouton.disabled = false;
  });
}
