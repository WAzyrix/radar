// =========================================================
// Fiche animé (ou manga) : anime.html?id=XXXX (id AniList)
// =========================================================
import { ficheAnime, saisons, dateDebut } from '../api/animes.js';
import { echapper, titre, note, nettoyerSynopsis, compteARebours, formatDate, afficherErreur } from '../lib/outils.js';

const formatJourHeure = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
import { GENRES_FR, STATUTS_FR, FORMATS_FR, RELATIONS_FR } from '../lib/traductions.js';
import { estSuivi, basculerSuivi, mettreAJourSaisons, statutSuivi, changerStatutSuivi, dernierSorti, enregistrerVus, suiviDe } from '../lib/suivis.js';
import { STATUTS } from '../lib/statuts.js';
import { afficherNavigation } from '../ui/nav.js';
import { appliquerAccent } from '../ui/accent.js';
import { carteAffiche, badgesLangues } from '../ui/cartes.js';
import { chargerAdn, trouverSerie, numeroSaison, prochaineSortie, derniereSortie } from '../api/adn.js';
import { brancherBoutonHasard } from '../ui/hasard.js';
import { ICONES } from '../ui/icones.js';
import { boutonRecommander, brancherRecommandation } from '../ui/recommander.js';
import { monterEpisodes } from '../ui/episodes-streaming.js';
import { boutonFavori, brancherFavori, monterCarteNote } from '../ui/notes.js';

afficherNavigation('animes');

const idDansAdresse = () => Number(new URLSearchParams(location.search).get('id'));

// "Autour de l'œuvre" : tout ce qui est lié SAUF les saisons (onglets en haut)
// et les simples apparitions de personnages (crossovers, pubs…)
const RELATIONS_ECARTEES = ['CHARACTER'];

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
  const oeuvre = { type: typeListe, id: m.id, titre: titre(m), image: m.coverImage.large || m.coverImage.extraLarge };
  const suivre = `<button type="button" class="bouton bouton-verre ${estSuivi(m.id, typeListe) ? 'actif' : ''}" id="suivre">${boutonSuivre(estSuivi(m.id, typeListe))}</button>`;

  const recos = m.recommendations.nodes.map((n) => n.mediaRecommendation).filter(Boolean);

  document.getElementById('fiche').innerHTML = `
    <section class="fiche-haut">
      <div class="fiche-fond" style="--image:url('${m.bannerImage || m.coverImage.extraLarge}')"></div>
      <div class="fiche-grille">
        <div class="fiche-affiche"><img src="${m.coverImage.extraLarge}" alt="Affiche de ${echapper(titre(m))}"></div>
        <div class="fiche-infos">
          <h1>${echapper(titre(m))}</h1>
          ${m.title.native ? `<div class="titre-natif">${echapper(m.title.native)}</div>` : ''}
          <div class="saisons" id="saisons"></div>
          <div class="meta">${meta}</div>
          <div class="genres-liste">${statut}${genres}</div>
          <div class="actions">
            ${bandeAnnonce}
            ${suivre}
            ${boutonFavori(oeuvre)}
            <button type="button" class="bouton bouton-verre" id="hasard">${ICONES.de}Au hasard</button>
            ${boutonRecommander()}
          </div>
          <div class="statuts-suivi" id="statuts-suivi" role="group" aria-label="Où j'en suis"></div>
          <div class="statuts-suivi progression" id="progression" role="group" aria-label="Dernier épisode vu"></div>
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
      <div class="carte carte-large" id="carte-note"></div>
      ${estManga ? '' : carteOuRegarder(m, adn)}
      ${estManga ? '' : '<div class="carte carte-large" id="episodes-streaming" hidden></div>'}
    </div>

    <section class="section" id="autour" hidden>
      <div class="section-tete"><h2>Autour de l'œuvre</h2></div>
      <p class="mention" style="margin:-6px 0 14px">Films, OVA, spéciaux, spin-off et histoires parallèles. Les saisons sont dans les onglets en haut.</p>
      <div class="carrousel" id="autour-liste"></div>
    </section>

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
    // ... et toutes les saisons de la série : on suit la franchise entière (notifs saison 2, 3…)
    // ... et par défaut, on est à jour sur cette saison (modifiable juste en dessous)
    const vu = estManga ? undefined : { [m.id]: dernierSorti(m) };
    const suivi = basculerSuivi(m, { adn: trouverSerie(adn, m)?.id, saisons: idsSaisons, vu });
    bouton.classList.toggle('actif', suivi);
    bouton.innerHTML = boutonSuivre(suivi);
    afficherStatuts(m.id, typeListe);
    if (!estManga) afficherProgression(m, { question: suivi });
  });
  afficherStatuts(m.id, typeListe);
  if (!estManga) afficherProgression(m);
  brancherBoutonHasard(document.getElementById('hasard'));
  brancherFavori(document.getElementById('favori'), oeuvre);
  monterCarteNote(document.getElementById('carte-note'), oeuvre);
  // Animé : "Autour de l'œuvre" est rempli une fois les saisons connues (pour les en retirer)
  if (estManga) afficherAutour(m, []);
  else afficherSaisons(m, bouton, adn);
  brancherRecommandation(
    { type: estManga ? 'manga' : 'anime', id: m.id, titre: titre(m), image: m.coverImage.large || m.coverImage.extraLarge },
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

// ---------- Où j'en suis : À voir · En cours · Vu (visible quand l'animé est suivi) ----------
function afficherStatuts(id, type) {
  const zone = document.getElementById('statuts-suivi');
  const actuel = statutSuivi(id, type);
  if (!zone) return;
  if (!actuel) { zone.innerHTML = ''; return; }
  zone.innerHTML = Object.entries(STATUTS[type]).map(([cle, nom]) =>
    `<button type="button" class="${cle === actuel ? 'actif' : ''}" data-statut="${cle}">${cle === actuel ? ICONES.check : ''}${nom}</button>`).join('');
  zone.onclick = (e) => {
    const bouton = e.target.closest('[data-statut]');
    if (!bouton) return;
    changerStatutSuivi(id, bouton.dataset.statut, type);
    afficherStatuts(id, type);
  };
}

// ---------- Autour de l'œuvre : films, OVA, spin-off… (sans les saisons), par date ----------
function afficherAutour(m, idsSaisons) {
  const exclus = new Set([m.id, ...idsSaisons]);
  const liens = m.relations.edges
    .filter((r) => !RELATIONS_ECARTEES.includes(r.relationType) && !exclus.has(r.node.id))
    .sort((a, b) => (dateDebut(a.node.startDate) ?? Infinity) - (dateDebut(b.node.startDate) ?? Infinity));
  const section = document.getElementById('autour');
  if (!section || !liens.length) return;
  // Étiquette = le type de l'œuvre (Film, OVA…) ; dessous : son lien avec celle-ci et l'année
  document.getElementById('autour-liste').innerHTML = liens.map((r) => carteAffiche(r.node, {
    etiquette: FORMATS_FR[r.node.format] || 'À venir',
    sous: [RELATIONS_FR[r.relationType] || r.relationType, r.node.startDate?.year].filter(Boolean).join(' · '),
  })).join('');
  section.hidden = false;
}

// ---------- Tu en es où ? (dernier épisode vu de CETTE saison, pour le rattrapage) ----------
function afficherProgression(m, { question = false } = {}) {
  const zone = document.getElementById('progression');
  const suivi = suiviDe(m.id);
  if (!zone) return;
  if (!suivi) { zone.innerHTML = ''; return; }
  const dernier = dernierSorti(m);
  if (!dernier) { zone.innerHTML = ''; return; } // rien de sorti : rien à rattraper
  const vu = suivi.vu?.[m.id];
  // Jamais renseigné (ancien suivi) : rien n'est présélectionné, on pose la question
  const etat = !Number.isInteger(vu) ? null : vu >= dernier ? 'a-jour' : vu === 0 ? 'pas-commence' : 'episode';
  zone.innerHTML = `
    <span class="progression-question">${question || !etat ? 'Tu en es où ?' : 'Vu :'}</span>
    <button type="button" data-progression="a-jour" class="${etat === 'a-jour' ? 'actif' : ''}">${etat === 'a-jour' ? ICONES.check : ''}À jour (ép. ${dernier})</button>
    <label class="progression-episode ${etat === 'episode' ? 'actif' : ''}">Épisode
      <input type="number" min="1" max="${dernier}" inputmode="numeric" value="${etat === 'episode' ? vu : ''}" placeholder="…" aria-label="Dernier épisode vu"></label>
    <button type="button" data-progression="pas-commence" class="${etat === 'pas-commence' ? 'actif' : ''}">${etat === 'pas-commence' ? ICONES.check : ''}Pas commencé</button>`;

  const enregistrer = (episode) => { enregistrerVus(suivi.id, { [m.id]: episode }); afficherProgression(m); };
  zone.onclick = (e) => {
    const choix = e.target.closest('[data-progression]')?.dataset.progression;
    if (choix) enregistrer(choix === 'a-jour' ? dernier : 0);
  };
  const champ = zone.querySelector('input');
  champ.onchange = () => {
    const episode = Math.round(Number(champ.value));
    if (episode >= 1) enregistrer(Math.min(episode, dernier));
  };
}

// ---------- Onglets "Saison 1 · Saison 2 · …" ----------
let idsSaisons; // identifiants de toutes les saisons de la série affichée

async function afficherSaisons(m, elementSuivre, adn) {
  const zone = document.getElementById('saisons');
  let liste;
  try {
    liste = await saisons(m.id, m);
  } catch (erreur) {
    liste = []; // AniList indisponible : pas d'onglets, la fiche reste utilisable
    // AniList saturé : on retente une fois le blocage passé (si la fiche est toujours affichée)
    if (erreur.reessaiDans) setTimeout(() => { if (zone.isConnected) afficherSaisons(m, elementSuivre, adn); }, erreur.reessaiDans * 1000);
  }
  if (!document.body.contains(zone)) return; // une autre saison a été ouverte entre-temps
  idsSaisons = liste.map((s) => s.id);
  afficherAutour(m, idsSaisons);
  // Regarder les épisodes, saison par saison (un film ou un OVA hors saisons : lui seul)
  monterEpisodes(document.getElementById('episodes-streaming'), {
    saisons: liste.some((s) => s.id === m.id) ? liste : [m],
    idCourant: m.id,
    serieAdn: trouverSerie(adn, m),
    apresVu: () => afficherProgression(m),
  });
  if (!liste.length) return;

  // Déjà suivi via une autre saison ? Le bouton l'indique, et la liste des saisons est mise à jour
  if (mettreAJourSaisons(m.id, idsSaisons) && elementSuivre) {
    elementSuivre.classList.add('actif');
    elementSuivre.innerHTML = boutonSuivre(true);
    afficherStatuts(m.id, 'anime');
    afficherProgression(m);
  }
  if (liste.length < 2) return;

  zone.innerHTML = liste.map((s, i) => `
    <button type="button" class="${s.id === m.id ? 'actif' : ''}" data-saison="${s.id}" title="${echapper(s.title.english || s.title.romaji)}">
      Saison ${i + 1}${s.seasonYear ? `<small>${s.seasonYear}</small>` : ''}
    </button>`).join('');
  zone.addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-saison]');
    if (bouton && Number(bouton.dataset.saison) !== m.id) charger(Number(bouton.dataset.saison), { historique: true });
  });
}

// Charge une fiche sur place (onglets de saisons) ; "historique" = bouton retour possible
async function charger(id, { historique = false } = {}) {
  if (historique) history.pushState(null, '', `?id=${id}`);
  document.querySelector('.fiche-infos')?.classList.add('chargement');
  try {
    const [m, adn] = await Promise.all([ficheAnime(id), chargerAdn()]);
    afficherFiche(m, adn);
    document.querySelector('.fiche-haut')?.scrollIntoView({ behavior: 'smooth' });
  } catch (erreur) {
    afficherErreurFiche(erreur.message, erreur.reessaiDans && erreur, () => charger(id));
  }
}
window.addEventListener('popstate', () => charger(idDansAdresse()));

// `sature` : erreur d'AniList surchargé -> compte à rebours puis `reessayer()`
function afficherErreurFiche(message, sature, reessayer) {
  document.getElementById('fiche').innerHTML = `
    <div class="page-tete">
      <h1>${sature ? 'Un instant…' : 'Animé introuvable'}</h1>
      <p id="message-fiche">${echapper(message)}</p>
      <div class="actions" style="margin-top:20px"><a class="bouton bouton-plein" href="animes.html">Explorer les animés</a></div>
    </div>`;
  if (sature) afficherErreur(document.getElementById('message-fiche'), sature, { reessayer });
}

if (!idDansAdresse()) afficherErreurFiche("Aucun animé n'est indiqué dans l'adresse.");
else charger(idDansAdresse());
