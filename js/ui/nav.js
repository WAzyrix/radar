// =========================================================
// Navigation commune à toutes les pages :
// barre du haut (PC) + barre d'onglets en bas (mobile) + recherche d'animés.
// =========================================================
import { rechercheRapide } from '../api/animes.js';
import { rechercheRapideJeux, relaisConfigure } from '../api/jeux.js';
import { imageReduite } from './cartes-jeux.js';
import { echapper, titre, antiRebond } from '../lib/outils.js';
import { FORMATS_FR } from '../lib/traductions.js';
import { ICONES } from './icones.js';

const PAGES = [
  { id: 'accueil', nom: 'Accueil', lien: './', icone: 'accueil' },
  { id: 'animes', nom: 'Animés', lien: 'animes.html', icone: 'anime' },
  { id: 'jeux', nom: 'Jeux', lien: 'jeux.html', icone: 'manette' },
  { id: 'cinema', nom: 'Films', lien: 'actus.html?cat=cinema', icone: 'film' },
  { id: 'cyber', nom: 'Cyber', lien: 'actus.html?cat=cyber', icone: 'cyber' },
  { id: 'monde', nom: 'Actu', lien: 'actus.html?cat=monde', icone: 'monde' },
];

export function afficherNavigation(pageActive) {
  const lien = (p, avecIcone) => `<a href="${p.lien}" class="${p.id === pageActive ? 'actif' : ''}" ${p.id === pageActive ? 'aria-current="page"' : ''}>${avecIcone ? ICONES[p.icone] : ''}${p.nom}</a>`;

  document.body.insertAdjacentHTML('afterbegin', `
    <header class="nav">
      <a href="./" class="logo"><span class="logo-point"></span>Radar</a>
      <nav class="nav-liens" aria-label="Navigation principale">${PAGES.map((p) => lien(p, false)).join('')}</nav>
      <form class="recherche" role="search" action="animes.html">
        ${ICONES.loupe}
        <input type="search" name="q" placeholder="Rechercher un animé, un jeu…" aria-label="Rechercher un animé ou un jeu" autocomplete="off">
        <div class="resultats"></div>
      </form>
    </header>`);
  document.body.insertAdjacentHTML('beforeend', `<nav class="onglets" aria-label="Navigation">${PAGES.map((p) => lien(p, true)).join('')}</nav>`);

  brancherRecherche();
}

// Recherche en direct : la liste apparaît pendant la frappe.
// Entrée = page Animés avec tous les résultats (le <form> s'en charge tout seul).
function brancherRecherche() {
  const formulaire = document.querySelector('.recherche');
  const champ = formulaire.querySelector('input');
  const boite = formulaire.querySelector('.resultats');

  // On cherche en parallèle dans les animés (AniList) et les jeux (relais RAWG)
  const chercher = antiRebond(async (texte) => {
    const [animes, jeux] = await Promise.all([
      rechercheRapide(texte).catch(() => []),
      relaisConfigure() ? rechercheRapideJeux(texte).catch(() => []) : [],
    ]);
    if (champ.value.trim() !== texte) return; // l'utilisateur a continué à taper

    const blocAnimes = animes.slice(0, 4).map((m) => `
      <a href="anime.html?id=${m.id}">
        <img src="${m.coverImage.medium}" alt="" style="background:${m.coverImage.color || '#1a1a24'}">
        <div><strong>${echapper(titre(m))}</strong><span>${['Animé', FORMATS_FR[m.format], m.seasonYear].filter(Boolean).join(' · ')}</span></div>
      </a>`).join('');
    const blocJeux = jeux.map((j) => `
      <a href="jeu.html?id=${j.id}">
        <img src="${imageReduite(j.background_image)}" alt="" class="miniature-jeu">
        <div><strong>${echapper(j.name)}</strong><span>${['Jeu', j.released?.slice(0, 4)].filter(Boolean).join(' · ')}</span></div>
      </a>`).join('');

    boite.innerHTML = (blocAnimes || blocJeux)
      ? `${blocAnimes ? `<p class="groupe">Animés</p>${blocAnimes}<a class="tout-voir" href="animes.html?q=${encodeURIComponent(texte)}#explorer">Tous les animés ›</a>` : ''}
         ${blocJeux ? `<p class="groupe">Jeux vidéo</p>${blocJeux}<a class="tout-voir" href="jeux.html?q=${encodeURIComponent(texte)}#explorer">Tous les jeux ›</a>` : ''}`
      : '<p>Aucun résultat.</p>';
    boite.classList.add('ouvert');
  });

  champ.addEventListener('input', () => {
    const texte = champ.value.trim();
    if (texte.length < 3) { boite.classList.remove('ouvert'); return; }
    chercher(texte);
  });

  // On envoie vers la section "Explorer" de la page Animés
  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    const texte = champ.value.trim();
    if (texte) location.href = `animes.html?q=${encodeURIComponent(texte)}#explorer`;
  });

  champ.addEventListener('keydown', (e) => { if (e.key === 'Escape') boite.classList.remove('ouvert'); });
  document.addEventListener('click', (e) => { if (!formulaire.contains(e.target)) boite.classList.remove('ouvert'); });
}
