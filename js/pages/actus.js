// =========================================================
// Page d'actus d'une catégorie : actus.html?cat=cyber|cinema|monde
// Recherche + filtres (thème, source, zone) faits dans le navigateur,
// sur le JSON généré par scripts/collecte.py.
// =========================================================
import { chargerActus, CATEGORIES, ZONES } from '../api/actus.js';
import { echapper, normaliser, ilYa, afficherErreur, antiRebond } from '../lib/outils.js';
import { afficherNavigation } from '../ui/nav.js';
import { carteArticle } from '../ui/cartes.js';

const PAR_PAGE = 30;
const $ = (id) => document.getElementById(id);

const parametres = new URLSearchParams(location.search);
const cle = CATEGORIES[parametres.get('cat')] ? parametres.get('cat') : 'monde';
const categorie = CATEGORIES[cle];

// État des filtres (repris de l'adresse si présent)
const filtres = {
  texte: parametres.get('q') || '',
  tag: parametres.get('tag') || '',
  source: parametres.get('source') || '',
  zone: parametres.get('zone') || '',
};
let articles = [];
let nbAffiches = PAR_PAGE;

afficherNavigation(cle);
document.title = `${categorie.nom} · Radar`;
document.documentElement.style.setProperty('--accent', categorie.couleur);
$('titre').textContent = categorie.nom;
$('description').textContent = categorie.description;
$('categories').innerHTML = Object.entries(CATEGORIES)
  .map(([c, cat]) => `<a href="actus.html?cat=${c}" class="${c === cle ? 'actif' : ''}">${cat.nom}</a>`).join('');

// ---------- Filtrage ----------
function articlesFiltres() {
  const mots = normaliser(filtres.texte).split(/\s+/).filter(Boolean);
  return articles.filter((a) => {
    if (filtres.tag && !a.tags.includes(filtres.tag)) return false;
    if (filtres.source && a.source !== filtres.source) return false;
    if (filtres.zone && a.zone !== filtres.zone) return false;
    if (mots.length) {
      // Tous les mots tapés doivent apparaître (titre, extrait, source ou tags)
      const texte = a._recherche ??= normaliser(`${a.titre} ${a.extrait} ${a.source} ${a.tags.join(' ')}`);
      return mots.every((m) => texte.includes(m));
    }
    return true;
  });
}

function afficher() {
  const liste = articlesFiltres();
  const zone = $('articles');
  zone.innerHTML = liste.length
    ? liste.slice(0, nbAffiches).map(carteArticle).join('')
    : '<div class="vide" style="grid-column:1/-1"><strong>Aucun article</strong>Essaie un autre mot ou retire un filtre.</div>';
  $('charger-plus').hidden = liste.length <= nbAffiches;
  $('compte-articles').textContent = `${liste.length} article${liste.length > 1 ? 's' : ''}`;
  memoriserDansUrl();
}

function memoriserDansUrl() {
  const p = new URLSearchParams({ cat: cle });
  if (filtres.texte) p.set('q', filtres.texte);
  for (const k of ['tag', 'source', 'zone']) if (filtres[k]) p.set(k, filtres[k]);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

// Quand un filtre change, on repart des 30 premiers résultats
function filtrer() {
  nbAffiches = PAR_PAGE;
  afficher();
}

// ---------- Construction des contrôles ----------
function monterFiltres(data) {
  // Sources
  for (const nom of data.sources) $('source').add(new Option(nom, nom));
  $('source').value = filtres.source;
  $('source').addEventListener('change', (e) => { filtres.source = e.target.value; filtrer(); });

  // Zones (seulement si les articles en ont : actu générale)
  if (articles.some((a) => a.zone)) {
    const zones = { '': 'Tout', ...ZONES };
    $('zones').hidden = false;
    $('zones').innerHTML = Object.entries(zones)
      .map(([z, nom]) => `<button type="button" data-zone="${z}" class="${z === filtres.zone ? 'actif' : ''}">${nom}</button>`).join('');
    $('zones').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      filtres.zone = b.dataset.zone;
      $('zones').querySelectorAll('button').forEach((x) => x.classList.toggle('actif', x === b));
      filtrer();
    });
  }

  // Thèmes : on n'affiche que ceux qui ont au moins un article, avec leur nombre
  const comptes = {};
  for (const a of articles) for (const t of a.tags) comptes[t] = (comptes[t] || 0) + 1;
  const tags = data.tags.filter((t) => comptes[t]);
  $('tags').innerHTML = [`<button type="button" class="puce ${filtres.tag ? '' : 'actif'}" data-tag="">Tous</button>`,
    ...tags.map((t) => `<button type="button" class="puce ${t === filtres.tag ? 'actif' : ''}" data-tag="${echapper(t)}">${echapper(t)} <span style="opacity:.6">${comptes[t]}</span></button>`)].join('');
  $('tags').addEventListener('click', (e) => {
    const b = e.target.closest('.puce');
    if (!b) return;
    // Recliquer sur le thème actif le désactive
    filtres.tag = b.dataset.tag === filtres.tag ? '' : b.dataset.tag;
    $('tags').querySelectorAll('.puce').forEach((x) => x.classList.toggle('actif', x.dataset.tag === filtres.tag));
    filtrer();
  });

  // Recherche texte
  $('recherche').value = filtres.texte;
  $('recherche').addEventListener('input', antiRebond((e) => { filtres.texte = e.target.value.trim(); filtrer(); }, 200));

  $('charger-plus').addEventListener('click', () => { nbAffiches += PAR_PAGE; afficher(); });
}

function afficherInfos(data) {
  const erreurs = data.erreurs?.length ? `<span>⚠️ Indisponible pour le moment : ${data.erreurs.map(echapper).join(', ')}</span>` : '';
  $('infos').innerHTML = `
    <span id="compte-articles"></span>
    <span>Mis à jour ${ilYa(data.maj)}</span>
    <span>Sources : ${data.sources.map(echapper).join(', ')}</span>
    ${erreurs}`;
}

// ---------- Lancement ----------
$('articles').innerHTML = '<div class="squelette" style="height:190px;border-radius:24px"></div>'.repeat(6);
chargerActus(cle).then((data) => {
  articles = data.articles;
  afficherInfos(data);
  monterFiltres(data);
  afficher();
}).catch((erreur) => afficherErreur($('articles'), erreur));
