// =========================================================
// Calendrier des scans (page Animés) : chapitres sortis hier / aujourd'hui, et ceux attendus.
// Liens uniquement vers les plateformes officielles (MANGA Plus, Webtoon, Piccoma, l'éditeur…) :
// une sortie sans plateforme officielle connue n'a pas de lien de lecture.
// =========================================================
import { chargerChapitres, cleJour } from '../api/chapitres.js';
import { echapper, attributUrl, couleurValide, idValide, formatHeure, afficherErreur } from '../lib/outils.js';
import * as maListe from '../lib/ma-liste.js';
import { squelettesEpisodes } from './cartes.js';
import { ICONES } from './icones.js';

const ONGLETS = [['hier', 'Hier'], ['aujourdhui', "Aujourd'hui"], ['avenir', 'À venir']];
const formatPrevu = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const RYTHMES = { 7: 'chaque semaine', 14: 'toutes les 2 semaines' };

function lienFiche(c, contenu) {
  return idValide(c.anilist) ? `<a href="anime.html?id=${Number(c.anilist)}">${contenu}</a>` : contenu;
}

function carteChapitre(c, { suivi, avenir }) {
  const image = attributUrl(c.image);
  const numero = c.chapitre && /^\d/.test(c.chapitre) ? `Chapitre ${echapper(c.chapitre)}` : echapper(c.chapitre || '');
  const tome = c.tome ? ` · tome ${echapper(c.tome)}` : '';
  let etat;
  if (avenir) {
    const date = c.heure ? new Date(c.heure) : new Date(`${c.date}T12:00:00`);
    const quand = `${formatPrevu.format(date)}${c.heure ? ` à ${formatHeure.format(date)}` : ''}`;
    etat = `<span class="etat bientot">Prévu ${echapper(quand)}</span>
      <span class="chapitre-source">${echapper(c.plateforme || '')} · ${RYTHMES[c.rythme] || ''}, sauf pause</span>`;
  } else {
    etat = c.officiel
      ? `<span class="etat sorti">Officiel · ${echapper(c.officiel)}</span>`
      : '<span class="chapitre-source">Sortie signalée sur MangaUpdates</span>';
  }
  const liens = (c.liens || []).filter((l) => attributUrl(l.url)).map((l) => `
    <a class="lien-plateforme" href="${attributUrl(l.url)}" target="_blank" rel="noopener noreferrer"
       title="Lire sur ${echapper(l.site)}${l.langue ? ` (${echapper(l.langue)})` : ''}">${echapper(l.site)}${ICONES.externe}</a>`).join('');
  return `
    <div class="episode chapitre ${suivi ? 'suivi' : ''}">
      ${lienFiche(c, image ? `<img src="${image}" alt="" loading="lazy" style="--couleur:${couleurValide(c.couleur) || '#1a1a24'}">` : '<span class="chapitre-sans-image"></span>')}
      <div class="episode-infos">
        <div class="episode-titre">${lienFiche(c, echapper(c.titre || 'Titre inconnu'))}</div>
        <div class="episode-ep">${avenir ? (c.chapitre ? `Chapitre ${echapper(c.chapitre)} attendu` : 'Prochain chapitre') : `${numero}${tome}`}</div>
        <div class="horaires">${etat}</div>
        ${liens ? `<div class="liens-plateformes">${liens}</div>` : ''}
      </div>
      ${suivi ? `<span class="badge-suivi" title="Ce manga est dans ta liste">${ICONES.coeur}</span>` : ''}
    </div>`;
}

/** jours : conteneur des onglets ; zone : grille ; filtre : case « Ma liste uniquement ». */
export function monterChapitres(jours, zone, filtre) {
  let actif = 'aujourdhui';
  for (const [cle, nom] of ONGLETS) {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = nom;
    bouton.classList.toggle('actif', cle === actif);
    bouton.addEventListener('click', () => {
      jours.querySelector('.actif')?.classList.remove('actif');
      bouton.classList.add('actif');
      actif = cle;
      afficher();
    });
    jours.append(bouton);
  }
  filtre.addEventListener('change', afficher);
  window.addEventListener('radar:liste', afficher);

  async function afficher() {
    const onglet = actif;
    zone.innerHTML = squelettesEpisodes();
    try {
      const donnees = await chargerChapitres();
      if (onglet !== actif) return;
      const suivis = new Set(maListe.items('manga').map((m) => m.id));
      let chapitres = onglet === 'avenir' ? donnees.avenir || [] : donnees.jours?.[cleJour(onglet === 'hier' ? -1 : 0)] || [];
      // Ma liste d'abord, puis les sorties officielles (le fichier les classe déjà ainsi)
      chapitres = [...chapitres].sort((a, b) => suivis.has(b.anilist) - suivis.has(a.anilist));
      if (filtre.checked) chapitres = chapitres.filter((c) => suivis.has(c.anilist));
      if (!chapitres.length) {
        const message = filtre.checked
          ? 'Aucun manga de ta liste ce jour-là. Suis un manga depuis sa fiche pour le voir ici.'
          : onglet === 'avenir' ? 'Aucune sortie officielle régulière attendue dans les 7 prochains jours.' : 'Aucun chapitre signalé ce jour-là.';
        zone.innerHTML = `<div class="vide"><strong>Aucun chapitre</strong>${message}</div>`;
        return;
      }
      zone.innerHTML = chapitres.map((c) => carteChapitre(c, { suivi: suivis.has(c.anilist), avenir: onglet === 'avenir' })).join('');
    } catch (erreur) {
      afficherErreur(zone, erreur, { reessayer: () => { if (onglet === actif) afficher(); } });
    }
  }

  afficher();
}

export const NOTE_CHAPITRES = "Sorties signalées sur MangaUpdates (dates à l'heure des États-Unis) : la plupart viennent de traductions de fans, sans lien ici. Les liens de lecture mènent uniquement aux plateformes officielles. « À venir » : déduit du rythme des sorties officielles de chaque série (le Weekly Shōnen Jump sort le dimanche sur MANGA Plus), hors pauses imprévues.";
