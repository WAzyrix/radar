// =========================================================
// Aperçu des actus d'une catégorie, avec des filtres rapides par tag
// (ex : Tout · Rumeurs · Nouvelles saisons). Utilisé sur les pages Animés et Jeux.
// =========================================================
import { chargerActus } from '../api/actus.js';
import { afficherErreur } from '../lib/outils.js';
import { carteArticle } from './cartes.js';

/**
 * @param {HTMLElement} zoneFiltres   conteneur des boutons de filtre
 * @param {HTMLElement} zoneArticles  conteneur des cartes
 * @param {string} categorie          clé de la catégorie (animes, jeux…)
 * @param {Array<[string, string]>} filtres  [tag, libellé] ; tag vide = tout
 */
export async function monterApercuActus(zoneFiltres, zoneArticles, categorie, filtres, nombre = 6) {
  let actif = '';
  let articles = [];

  function afficher() {
    const choisis = actif ? articles.filter((a) => a.tags.includes(actif)) : articles;
    zoneArticles.innerHTML = choisis.length
      ? choisis.slice(0, nombre).map(carteArticle).join('')
      : `<div class="vide" style="grid-column:1/-1"><strong>Rien pour l'instant</strong>${actif === 'Rumeur' ? 'Aucune rumeur sérieuse ces dernières semaines : seules les sources fiables sont retenues.' : 'Reviens un peu plus tard.'}</div>`;
  }

  zoneArticles.innerHTML = '<div class="squelette" style="height:190px;border-radius:24px"></div>'.repeat(3);
  try {
    articles = (await chargerActus(categorie)).articles;
  } catch (erreur) {
    afficherErreur(zoneArticles, erreur);
    return;
  }

  // Un bouton par filtre, avec le nombre d'articles concernés
  zoneFiltres.innerHTML = filtres.map(([tag, nom]) => {
    const nb = tag ? articles.filter((a) => a.tags.includes(tag)).length : 0;
    return `<button type="button" data-tag="${tag}" class="${tag === actif ? 'actif' : ''}">${nom}${nb ? ` <span style="opacity:.6">${nb}</span>` : ''}</button>`;
  }).join('');
  zoneFiltres.addEventListener('click', (e) => {
    const bouton = e.target.closest('button');
    if (!bouton) return;
    actif = bouton.dataset.tag;
    zoneFiltres.querySelectorAll('button').forEach((b) => b.classList.toggle('actif', b === bouton));
    afficher();
  });
  afficher();
}
