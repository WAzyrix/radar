// =========================================================
// Flèches ‹ › sur les carrousels (sur ordinateur).
//
// Sur téléphone, on fait glisser du doigt. Sur PC, la molette fait défiler la page
// verticalement et la barre de défilement est masquée : sans flèches, on serait bloqué.
// Les carrousels sont souvent créés après le chargement (données AniList, RAWG…) :
// un MutationObserver repère ceux qui apparaissent et leur ajoute les flèches.
// =========================================================

const FLECHE = (sens) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${sens === 'gauche' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;

// Affiche ou cache chaque flèche selon qu'il reste du contenu de ce côté
function mettreAJour(carrousel) {
  const cadre = carrousel.parentElement;
  const max = carrousel.scrollWidth - carrousel.clientWidth;
  cadre.querySelector('.fleche-gauche').hidden = carrousel.scrollLeft <= 4;
  cadre.querySelector('.fleche-droite').hidden = carrousel.scrollLeft >= max - 4;
}

function equiper(carrousel) {
  if (carrousel.parentElement?.classList.contains('carrousel-cadre')) return;

  // On entoure le carrousel d'un cadre (pour placer les flèches par-dessus)
  const cadre = document.createElement('div');
  cadre.className = 'carrousel-cadre';
  carrousel.before(cadre);
  cadre.append(carrousel);
  cadre.insertAdjacentHTML('beforeend', `
    <button type="button" class="carrousel-fleche fleche-gauche" aria-label="Défiler vers la gauche" hidden>${FLECHE('gauche')}</button>
    <button type="button" class="carrousel-fleche fleche-droite" aria-label="Défiler vers la droite" hidden>${FLECHE('droite')}</button>`);

  // Un clic fait avancer d'environ une "page" de carrousel
  cadre.querySelector('.fleche-gauche').addEventListener('click', () => carrousel.scrollBy({ left: -carrousel.clientWidth * 0.85, behavior: 'smooth' }));
  cadre.querySelector('.fleche-droite').addEventListener('click', () => carrousel.scrollBy({ left: carrousel.clientWidth * 0.85, behavior: 'smooth' }));

  carrousel.addEventListener('scroll', () => mettreAJour(carrousel), { passive: true });
  new ResizeObserver(() => mettreAJour(carrousel)).observe(carrousel);
  mettreAJour(carrousel);
}

export function activerCarrousels() {
  document.querySelectorAll('.carrousel').forEach(equiper);

  new MutationObserver((changements) => {
    for (const changement of changements) {
      // Nouveaux carrousels ajoutés à la page
      for (const noeud of changement.addedNodes) {
        if (noeud.nodeType !== 1) continue;
        if (noeud.classList.contains('carrousel')) equiper(noeud);
        noeud.querySelectorAll?.('.carrousel').forEach(equiper);
      }
      // Contenu d'un carrousel remplacé (ex : changement de jour du calendrier)
      const parent = changement.target.closest?.('.carrousel');
      if (parent?.parentElement?.classList.contains('carrousel-cadre')) mettreAJour(parent);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
