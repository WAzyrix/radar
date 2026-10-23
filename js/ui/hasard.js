// Bouton "Au hasard" : tire un animé et ouvre sa fiche.
import { auHasard } from '../api/animes.js';

export function brancherBoutonHasard(bouton, filtres) {
  bouton.addEventListener('click', async (e) => {
    e.preventDefault(); // utile si c'est un lien <a href="#">
    bouton.disabled = true;
    bouton.setAttribute('aria-busy', 'true');
    try {
      const media = await auHasard(filtres);
      if (media) location.href = `anime.html?id=${media.id}`;
    } catch (erreur) {
      alert(erreur.message);
    } finally {
      bouton.disabled = false;
      bouton.removeAttribute('aria-busy');
    }
  });
}
