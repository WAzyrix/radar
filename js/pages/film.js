// =========================================================
// Fiche film ou série : film.html?type=film|serie&id=XXXX (id TMDB)
// Présentation, où le regarder en France, saisons, casting, bande-annonce, recommandations.
// =========================================================
import { ficheFilm, filmAuHasard } from '../api/films.js';
import { echapper, formatDate, attributUrl, lienSur } from '../lib/outils.js';
import * as maListe from '../lib/ma-liste.js';
import { STATUTS, statutDe } from '../lib/statuts.js';
import { afficherNavigation } from '../ui/nav.js';
import { carteFilm, dateSortieFilm, noteFilm } from '../ui/cartes-films.js';
import { ICONES } from '../ui/icones.js';
import { boutonRecommander, brancherRecommandation } from '../ui/recommander.js';
import { boutonFavori, brancherFavori, monterCarteNote } from '../ui/notes.js';

afficherNavigation('films');
document.documentElement.style.setProperty('--accent', '#ff7ab6');

const parametres = new URLSearchParams(location.search);
const type = parametres.get('type') === 'serie' ? 'serie' : 'film';
const id = Number(parametres.get('id'));

const STATUTS_TMDB = {
  Released: 'Sorti', 'Returning Series': 'En cours', Ended: 'Terminée', Canceled: 'Annulée',
  'In Production': 'En production', 'Post Production': 'En post-production', Planned: 'Annoncé', Rumored: 'Rumeur', Pilot: 'Pilote',
};
const LANGUES = new Intl.DisplayNames(['fr'], { type: 'language' });
const PAYS = new Intl.DisplayNames(['fr'], { type: 'region' });
const nomLangue = (code) => { try { return code ? LANGUES.of(code) : ''; } catch { return code; } };
const nomPays = (code) => { try { return PAYS.of(code); } catch { return code; } };
const dateLongue = (d) => (d ? `${formatDate.format(new Date(`${d}T12:00:00`))} ${d.slice(0, 4)}` : '');
const duree = (min) => (min ? (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`) : '');
const ligneInfo = (nom, valeur) => (valeur ? `<div><dt>${nom}</dt><dd>${echapper(valeur)}</dd></div>` : '');

// ---------- Ma liste : statuts (À voir / En cours / Vu) ----------
function boutonsStatut(f) {
  const element = maListe.trouver(type, f.id);
  const actuel = element ? statutDe(element) : null;
  return Object.entries(STATUTS[type]).map(([cle, nom]) => `
    <button type="button" class="bouton ${cle === actuel ? 'bouton-plein' : 'bouton-verre'} bouton-petit" data-statut="${cle}" aria-pressed="${cle === actuel}">
      ${cle === actuel ? ICONES.check : ''}${nom}
    </button>`).join('')
    + (element ? '<button type="button" class="lien-discret" data-statut="">Retirer de ma liste</button>' : '');
}

function changerStatut(f, statut) {
  const element = maListe.trouver(type, f.id);
  // Cliquer sur le statut actuel (ou « Retirer ») retire de la liste
  if (!statut || (element && statutDe(element) === statut)) { maListe.retirer(type, f.id); return; }
  maListe.enregistrer({ type, id: f.id, titre: f.titre, image: f.image, sortie: f.dateFrance || f.date || undefined, statut });
}

// ---------- Où le regarder ----------
// TMDB liste chaque offre à part (« Netflix » et « Netflix Standard with Ads »,
// « Paramount+ Amazon Channel »…) : une seule par plateforme et par ligne. Une plateforme
// déjà « avec un abonnement » n'est pas répétée dans « Gratuit » ; la location et l'achat
// restent séparés (on peut louer ET acheter sur Apple TV).
const nomPlateforme = (nom) => String(nom || '')
  .replace(/\s+(?:(?:standard|basic|premium)\s+)?with\s+ads$/i, '')
  .replace(/\s+(?:amazon|apple\s*tv)\s+channel$/i, '')
  .trim();

function fusionnerPlateformes(r) {
  const garder = (liste = [], vues = new Set()) => liste.map((p) => ({ ...p, nom: nomPlateforme(p.nom) }))
    .filter((p) => p.nom && !vues.has(p.nom.toLowerCase()) && vues.add(p.nom.toLowerCase()));
  const enStreaming = new Set();
  return { ...r, abonnement: garder(r.abonnement, enStreaming), gratuit: garder(r.gratuit, enStreaming), location: garder(r.location), achat: garder(r.achat) };
}

function carteRegarder(f) {
  const r = f.regarder && fusionnerPlateformes(f.regarder);
  const auCinema = type === 'film' && f.dateFrance && f.dateFrance >= new Date().toISOString().slice(0, 10);
  const ligne = (titre, liste) => (liste?.length ? `
    <span class="etiquette" style="margin-top:14px">${titre}</span>
    <div class="plateformes">${liste.map((p) => `<span class="pastille plateforme">${p.logo ? `<img src="${echapper(p.logo)}" alt="" loading="lazy">` : ''}${echapper(p.nom)}</span>`).join('')}</div>` : '');
  const contenu = r && (r.abonnement.length || r.gratuit.length || r.location.length || r.achat.length)
    ? `${ligne('Avec un abonnement', r.abonnement)}${ligne('Gratuit', r.gratuit)}${ligne('En location', r.location)}${ligne('À l\'achat', r.achat)}
       ${lienSur(r.lien) ? `<p class="mention"><a class="lien-discret" href="${attributUrl(r.lien)}" target="_blank" rel="noopener noreferrer">Liens directs vers les plateformes ${ICONES.externe}</a> · source : JustWatch</p>` : ''}`
    : `<p class="mention" style="margin-top:0">${auCinema
      ? `Au cinéma en France : ${dateSortieFilm(f.dateFrance).toLowerCase()}. Pas encore sur une plateforme de streaming.`
      : 'Disponible sur aucune plateforme de streaming en France pour le moment (selon JustWatch).'}</p>`;
  return `<div class="carte carte-large"><h2>Où le regarder en France</h2>${contenu}</div>`;
}

// ---------- Séries : saisons et prochain épisode ----------
function carteSaisons(f) {
  if (type !== 'serie' || !f.saisons.length) return '';
  const episode = (e, libelle) => (e ? `<p class="prochain">${ICONES.calendrier}<span>${libelle} : <b>S${e.saison} · ép. ${e.numero}</b>${e.nom ? ` « ${echapper(e.nom)} »` : ''}${e.date ? `, ${dateSortieFilm(e.date).toLowerCase()}` : ''}</span></p>` : '');
  return `
    <div class="carte carte-large">
      <h2>${f.nbSaisons} saison${f.nbSaisons > 1 ? 's' : ''} · ${f.nbEpisodes || '?'} épisodes</h2>
      ${episode(f.prochainEpisode, 'Prochain épisode')}
      ${!f.prochainEpisode ? episode(f.dernierEpisode, 'Dernier épisode diffusé') : ''}
      <div class="liste-saisons">
        ${f.saisons.map((s) => `
          <div class="saison-tmdb">
            ${s.image ? `<img src="${echapper(s.image)}" alt="" loading="lazy">` : '<span></span>'}
            <div><b>${echapper(s.nom)}</b><small>${s.episodes} épisode${s.episodes > 1 ? 's' : ''}${s.date ? ` · ${s.date.slice(0, 4)}` : ''}</small></div>
          </div>`).join('')}
      </div>
    </div>`;
}

function afficherFiche(f) {
  document.title = `${f.titre} · Radar`;
  const oeuvre = { type, id: f.id, titre: f.titre, image: f.image };
  const annee = (f.dateFrance || f.date || '').slice(0, 4);
  const meta = [
    f.note && `<span class="note">★ ${noteFilm(f.note)}</span>`,
    annee && `<span>${annee}</span>`,
    type === 'film' ? duree(f.duree) && `<span>${duree(f.duree)}</span>` : f.nbSaisons && `<span>${f.nbSaisons} saison${f.nbSaisons > 1 ? 's' : ''}</span>`,
    f.classification && `<span class="pastille">${/^\d+$/.test(f.classification) ? `-${f.classification}` : echapper(f.classification)}</span>`,
  ].filter(Boolean).join('');
  const bandeAnnonce = f.bandeAnnonce
    ? `<a class="bouton bouton-plein bouton-petit" href="https://www.youtube.com/watch?v=${encodeURIComponent(f.bandeAnnonce.cle)}" target="_blank" rel="noopener noreferrer">${ICONES.lecture}Bande-annonce</a>`
    : '';

  document.getElementById('fiche').innerHTML = `
    <section class="heros heros-jeu">
      <div class="heros-image" style="--image-large:url('${echapper(f.fond || f.image || '')}');--image-mobile:url('${echapper(f.fond || f.image || '')}')"></div>
      <div class="heros-contenu">
        <div class="surtitre">${echapper([maListe.TYPES[type].un, ...f.genres.slice(0, 3)].join(' · '))}</div>
        <h1>${echapper(f.titre)}</h1>
        <div class="meta">${meta}</div>
        ${f.slogan ? `<p class="resume">${echapper(f.slogan)}</p>` : ''}
        <div id="potes-suivent"></div>
        <div class="actions" style="margin-top:22px" id="statuts">${boutonsStatut(f)}</div>
        <div class="actions" style="margin-top:10px">
          ${bandeAnnonce}
          ${boutonFavori(oeuvre, { petit: true })}
          <button type="button" class="bouton bouton-verre bouton-petit" id="hasard">${ICONES.de}${type === 'film' ? 'Un film' : 'Une série'} au hasard</button>
          ${boutonRecommander()}
        </div>
      </div>
    </section>

    <div class="fiche-corps">
      <div class="carte">
        <h2>Synopsis</h2>
        <p class="synopsis">${echapper(f.resume || 'Pas encore de résumé en français.')}</p>
      </div>
      <div class="carte">
        <dl class="infos-liste">
          ${ligneInfo(type === 'film' ? 'Au cinéma en France' : 'Première diffusion', dateLongue(f.dateFrance || f.date))}
          ${type === 'film' && f.dateFrance && f.date && f.dateFrance !== f.date ? ligneInfo('Sortie mondiale', dateLongue(f.date)) : ''}
          ${ligneInfo(type === 'film' ? 'Réalisation' : 'Création', f.auteurs.join(', '))}
          ${ligneInfo('Diffusion', f.chaines.join(', '))}
          ${ligneInfo('Statut', STATUTS_TMDB[f.statut] || f.statut)}
          ${ligneInfo('Durée', type === 'film' ? duree(f.duree) : f.duree && `${duree(f.duree)} par épisode`)}
          ${ligneInfo('Pays', f.pays.map(nomPays).join(', '))}
          ${ligneInfo('Langue originale', nomLangue(f.langue))}
          ${f.titreOriginal && f.titreOriginal !== f.titre ? ligneInfo('Titre original', f.titreOriginal) : ''}
          ${ligneInfo('Note TMDB', f.note && `${noteFilm(f.note)}/10 (${f.votes.toLocaleString('fr-FR')} votes)`)}
        </dl>
        ${f.imdb && /^tt\d+$/.test(f.imdb) ? `<p class="mention"><a class="lien-discret" href="https://www.imdb.com/title/${f.imdb}/" target="_blank" rel="noopener noreferrer">Voir sur IMDb ${ICONES.externe}</a></p>` : ''}
      </div>
      ${carteRegarder(f)}
      <div class="carte carte-large" id="carte-note"></div>
      ${carteSaisons(f)}
    </div>

    ${f.casting.length ? `
    <section class="section">
      <div class="section-tete"><h2>Casting</h2></div>
      <div class="carrousel casting">${f.casting.map((c) => `
        <div class="acteur">
          <div class="acteur-photo">${c.photo ? `<img src="${echapper(c.photo)}" alt="" loading="lazy">` : ''}</div>
          <b>${echapper(c.nom)}</b><small>${echapper(c.role)}</small>
        </div>`).join('')}
      </div>
    </section>` : ''}

    ${f.recommandations.length ? `
    <section class="section">
      <div class="section-tete"><h2>Dans le même genre</h2></div>
      <div class="carrousel">${f.recommandations.map((r) => carteFilm(r)).join('')}</div>
    </section>` : ''}
  `;

  document.getElementById('statuts').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-statut]');
    if (!bouton) return;
    changerStatut(f, bouton.dataset.statut);
    document.getElementById('statuts').innerHTML = boutonsStatut(f);
  });

  // Au hasard : même type, garde une référence au bouton (e.currentTarget est perdu après un await)
  const hasard = document.getElementById('hasard');
  hasard.addEventListener('click', async () => {
    hasard.disabled = true;
    try {
      const autre = await filmAuHasard(type);
      if (autre) location.href = `film.html?type=${type}&id=${Number(autre.id)}`;
    } catch (erreur) {
      alert(erreur.message);
    }
    hasard.disabled = false;
  });

  brancherRecommandation({ type, id: f.id, titre: f.titre, image: f.image }, document.getElementById('potes-suivent'));
  brancherFavori(document.getElementById('favori'), oeuvre);
  monterCarteNote(document.getElementById('carte-note'), oeuvre);
}

async function demarrer() {
  if (!Number.isInteger(id) || id <= 0) throw new Error('adresse incomplète : il manque le film ou la série.');
  afficherFiche(await ficheFilm(type, id));
}

demarrer().catch((erreur) => {
  const introuvable = /introuvable/i.test(erreur.message);
  document.getElementById('fiche').innerHTML = `
    <div class="vide" style="margin:120px var(--gouttiere)">
      <strong>${introuvable ? `${type === 'film' ? 'Ce film' : 'Cette série'} n'existe pas` : 'Fiche indisponible'}</strong>
      ${echapper(introuvable ? 'Vérifie le lien, ou cherche-le dans Films & séries.' : erreur.message)}
      <a class="bouton bouton-plein bouton-petit" href="films.html#explorer" style="margin-top:14px">Explorer les films et séries</a>
    </div>`;
});
