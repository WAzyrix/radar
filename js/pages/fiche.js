// =========================================================
// Fiche animé (ou manga) : anime.html?id=XXXX (id AniList)
// =========================================================
import { ficheAnime } from '../api/animes.js';
import { echapper, titre, note, nettoyerSynopsis, compteARebours, formatDate } from '../lib/outils.js';

const formatJourHeure = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
import { GENRES_FR, STATUTS_FR, FORMATS_FR, RELATIONS_FR } from '../lib/traductions.js';
import { estSuivi, basculerSuivi } from '../lib/suivis.js';
import { afficherNavigation } from '../ui/nav.js';
import { appliquerAccent } from '../ui/accent.js';
import { carteAffiche, badgesLangues } from '../ui/cartes.js';
import { chargerAdn, trouverSerie, numeroSaison, prochaineSortie, derniereSortie } from '../api/adn.js';
import { brancherBoutonHasard } from '../ui/hasard.js';
import { ICONES } from '../ui/icones.js';
import { boutonRecommander, brancherRecommandation } from '../ui/recommander.js';

afficherNavigation('animes');

const id = Number(new URLSearchParams(location.search).get('id'));

// Ordre d'affichage des relations : suites et préquelles d'abord
const ORDRE_RELATIONS = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'SOURCE', 'ADAPTATION', 'ALTERNATIVE'];
const rang = (type) => { const i = ORDRE_RELATIONS.indexOf(type); return i === -1 ? 99 : i; };

const ligneInfo = (nom, valeur) => (valeur ? `<div><dt>${nom}</dt><dd>${echapper(valeur)}</dd></div>` : '');

function carteAvis(avis) {
  // Seulement le résumé de l'avis (court), avec un lien vers l'avis complet sur AniList
  return `
    <a class="avis-carte" href="${avis.siteUrl}" target="_blank" rel="noopener">
      <div class="avis-auteur">
        <img src="${avis.user.avatar.medium}" alt="" loading="lazy">
        ${echapper(avis.user.name)}
        <span class="pastille accent">${avis.score}/100</span>
      </div>
      <p>« ${echapper(avis.summary)} »</p>
      <small>${avis.rating} sur ${avis.ratingAmount} lecteurs ont trouvé cet avis utile</small>
    </a>`;
}

function boutonSuivre(suivi) {
  return suivi ? `${ICONES.check}Suivi` : `${ICONES.plus}Suivre`;
}

// Carte "Où le regarder en France" : ADN (langues par saison) + autres plateformes connues d'AniList
function carteOuRegarder(m, adn) {
  const serie = trouverSerie(adn, m);
  let contenu;
  if (serie) {
    const prochain = prochaineSortie(adn, serie);
    // Animé en cours : la saison qu'ADN diffuse en ce moment est forcément celle de cette fiche.
    // Sinon, on devine le numéro d'après le titre ("Season 2", "2nd Season"…).
    const enCours = m.status === 'RELEASING' && (prochain || derniereSortie(adn, serie));
    const saisonCourante = enCours ? String(enCours.saison) : String(numeroSaison(m));
    const saisons = Object.entries(serie.saisons).sort((a, b) => Number(a[0]) - Number(b[0]));
    contenu = `
      <p>Sur <a class="lien-discret" href="${serie.url}" target="_blank" rel="noopener">ADN</a> (${echapper(serie.titre)}) :</p>
      <div class="dispo-saisons">
        ${saisons.map(([num, langues]) => `
          <div class="dispo-saison ${num === saisonCourante ? 'courante' : ''}">
            <span>Saison ${num}</span>${badgesLangues(langues)}
            ${num === saisonCourante ? '<small>cette fiche</small>' : ''}
          </div>`).join('') || `<div class="dispo-saison"><span>Langues</span>${badgesLangues(serie.langues)}</div>`}
      </div>
      ${prochain ? `<div class="prochain">${ICONES.drapeauFR}<span>Prochain épisode sur ADN : <b>ép. ${echapper(prochain.episode)}</b>, ${formatJourHeure.format(new Date(prochain.date))}</span>${badgesLangues(prochain.langues)}</div>` : ''}`;
  } else {
    contenu = "<p class=\"mention\" style=\"margin-top:0\">Pas trouvé dans le catalogue d'ADN (ou sous un titre différent).</p>";
  }

  // Autres plateformes listées par AniList (dans le monde : pas forcément dispo en France)
  const vus = new Set();
  const autres = (m.externalLinks || [])
    .filter((l) => l.type === 'STREAMING' && l.site !== 'YouTube' && !vus.has(l.site) && vus.add(l.site))
    .map((l) => `<a class="pastille" href="${echapper(l.url)}" target="_blank" rel="noopener">${echapper(l.site)}</a>`).join('');

  return `
    <div class="carte carte-large">
      <h2>Où le regarder en France</h2>
      ${contenu}
      ${autres ? `<p class="mention">Aussi référencé sur (selon les pays, langues non précisées) :</p><div class="plateformes">${autres}</div>` : ''}
      <p class="mention">${ICONES.drapeauJP} VOSTFR = audio japonais sous-titré · ${ICONES.drapeauFR} VF = doublage français. Les langues viennent du catalogue ADN ; Crunchyroll ne publie pas ces infos.</p>
    </div>`;
}

function afficherFiche(m, adn) {
  document.title = `${titre(m)} · Radar`;
  appliquerAccent(m.coverImage.color);

  const estManga = m.type === 'MANGA';
  const studio = m.studios.nodes[0]?.name;
  const quantite = estManga ? (m.chapters && `${m.chapters} chapitres`) : (m.episodes && `${m.episodes} épisodes`);
  const debut = m.startDate.year && m.startDate.month
    ? formatDate.format(new Date(m.startDate.year, m.startDate.month - 1, m.startDate.day || 1)) + ' ' + m.startDate.year
    : m.startDate.year;

  // Ligne d'infos sous le titre : la note (mise en avant) puis le reste, échappé
  const meta = (m.averageScore ? `<span class="note">★ ${note(m.averageScore)}</span>` : '')
    + [FORMATS_FR[m.format], m.seasonYear || m.startDate.year, quantite, studio]
      .filter(Boolean).map((x) => `<span>${echapper(x)}</span>`).join('');

  const genres = m.genres.map((g) => `<span class="pastille">${GENRES_FR[g] || g}</span>`).join('');
  const statut = m.status ? `<span class="pastille accent">${STATUTS_FR[m.status] || m.status}</span>` : '';

  const prochain = m.nextAiringEpisode
    ? `<div class="prochain">${ICONES.horloge}<span>Épisode <b>${m.nextAiringEpisode.episode}</b> dans <b>${compteARebours(m.nextAiringEpisode.airingAt)}</b> (diffusion au Japon)</span></div>`
    : '';

  const bandeAnnonce = m.trailer?.site === 'youtube'
    ? `<a class="bouton bouton-plein" href="https://www.youtube.com/watch?v=${encodeURIComponent(m.trailer.id)}" target="_blank" rel="noopener">${ICONES.lecture}Bande-annonce</a>`
    : '';

  // "Suivre" : animés ET mangas (notifs : épisodes, VOSTFR/VF, suites, nouveaux tomes)
  const typeListe = estManga ? 'manga' : 'anime';
  const suivre = `<button type="button" class="bouton bouton-verre ${estSuivi(m.id, typeListe) ? 'actif' : ''}" id="suivre">${boutonSuivre(estSuivi(m.id, typeListe))}</button>`;

  const relations = m.relations.edges
    .filter((r) => r.relationType !== 'CHARACTER')
    .sort((a, b) => rang(a.relationType) - rang(b.relationType));
  const recos = m.recommendations.nodes.map((n) => n.mediaRecommendation).filter(Boolean);

  document.getElementById('fiche').innerHTML = `
    <section class="fiche-haut">
      <div class="fiche-fond" style="--image:url('${m.bannerImage || m.coverImage.extraLarge}')"></div>
      <div class="fiche-grille">
        <div class="fiche-affiche"><img src="${m.coverImage.extraLarge}" alt="Affiche de ${echapper(titre(m))}"></div>
        <div class="fiche-infos">
          <h1>${echapper(titre(m))}</h1>
          ${m.title.native ? `<div class="titre-natif">${echapper(m.title.native)}</div>` : ''}
          <div class="meta">${meta}</div>
          <div class="genres-liste">${statut}${genres}</div>
          <div class="actions">
            ${bandeAnnonce}
            ${suivre}
            <button type="button" class="bouton bouton-verre" id="hasard">${ICONES.de}Au hasard</button>
            ${boutonRecommander()}
          </div>
          <div id="potes-suivent"></div>
          ${prochain}
        </div>
      </div>
    </section>

    <div class="fiche-corps">
      <div class="carte">
        <h2>Synopsis</h2>
        <p class="synopsis replie">${echapper(nettoyerSynopsis(m.description)) || 'Pas de synopsis disponible.'}</p>
        <button type="button" class="lire-plus">Lire la suite</button>
        <p class="mention">Synopsis en anglais, fourni par AniList.</p>
      </div>
      <div class="carte">
        ${m.averageScore ? `<div class="note-anneau" style="--p:${m.averageScore}" title="Note moyenne AniList"><span>${note(m.averageScore)}</span></div>` : ''}
        <dl class="infos-liste">
          ${ligneInfo('Format', FORMATS_FR[m.format])}
          ${ligneInfo('Statut', STATUTS_FR[m.status])}
          ${ligneInfo(estManga ? 'Chapitres' : 'Épisodes', estManga ? m.chapters : m.episodes)}
          ${ligneInfo('Volumes', estManga && m.volumes)}
          ${ligneInfo('Durée', m.duration && `${m.duration} min / épisode`)}
          ${ligneInfo('Début', debut)}
          ${ligneInfo('Studio', studio)}
          ${ligneInfo('Popularité', m.popularity && `${m.popularity.toLocaleString('fr-FR')} membres`)}
        </dl>
        <p class="mention"><a class="lien-discret" href="${m.siteUrl}" target="_blank" rel="noopener">Voir sur AniList</a></p>
      </div>
      ${estManga ? '' : carteOuRegarder(m, adn)}
    </div>

    ${relations.length ? `
    <section class="section">
      <div class="section-tete"><h2>Suites, préquelles et liés</h2></div>
      <div class="carrousel">${relations.map((r) => carteAffiche(r.node, {
        etiquette: RELATIONS_FR[r.relationType] || r.relationType,
        sous: FORMATS_FR[r.node.format] || '',
      })).join('')}</div>
    </section>` : ''}

    ${m.reviews.nodes.length ? `
    <section class="section">
      <div class="section-tete"><h2>Avis des fans</h2><a href="${m.siteUrl}/reviews" target="_blank" rel="noopener">Tous les avis ›</a></div>
      <div class="carrousel avis">${m.reviews.nodes.map(carteAvis).join('')}</div>
    </section>` : ''}

    ${recos.length ? `
    <section class="section">
      <div class="section-tete"><h2>Si tu as aimé</h2></div>
      <div class="carrousel">${recos.map((r) => carteAffiche(r)).join('')}</div>
    </section>` : ''}
  `;

  // Bouton Suivre
  const bouton = document.getElementById('suivre');
  bouton?.addEventListener('click', () => {
    // On mémorise la série ADN correspondante : le relais pourra prévenir de la sortie VOSTFR/VF
    const suivi = basculerSuivi(m, { adn: trouverSerie(adn, m)?.id });
    bouton.classList.toggle('actif', suivi);
    bouton.innerHTML = boutonSuivre(suivi);
  });
  brancherBoutonHasard(document.getElementById('hasard'));
  brancherRecommandation(
    { type: estManga ? 'manga' : 'anime', id: m.id, titre: titre(m), image: m.coverImage.extraLarge },
    document.getElementById('potes-suivent'),
  );

  // "Lire la suite" : visible seulement si le synopsis est vraiment coupé
  const synopsis = document.querySelector('.synopsis');
  const lirePlus = document.querySelector('.lire-plus');
  if (synopsis.scrollHeight <= synopsis.clientHeight + 2) lirePlus.remove();
  lirePlus.addEventListener('click', () => {
    const replie = synopsis.classList.toggle('replie');
    lirePlus.textContent = replie ? 'Lire la suite' : 'Réduire';
  });
}

function afficherErreurFiche(message) {
  document.getElementById('fiche').innerHTML = `
    <div class="page-tete">
      <h1>Animé introuvable</h1>
      <p>${echapper(message)}</p>
      <div class="actions" style="margin-top:20px"><a class="bouton bouton-plein" href="animes.html">Explorer les animés</a></div>
    </div>`;
}

if (!id) afficherErreurFiche("Aucun animé n'est indiqué dans l'adresse.");
else Promise.all([ficheAnime(id), chargerAdn()]).then(([m, adn]) => afficherFiche(m, adn)).catch((erreur) => afficherErreurFiche(erreur.message));
