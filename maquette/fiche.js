// =========================================================
// Fiche animé : anime.html?id=XXXX (id AniList)
// =========================================================
import {
  anilist, echapper, titre, note, nettoyerSynopsis, appliquerAccent, carteAffiche,
  afficherNavigation, brancherBoutonHasard, GENRES_FR, STATUTS_FR, FORMATS_FR, RELATIONS_FR, ICONES,
} from './commun.js';

afficherNavigation('anime');

// Sans id dans l'URL, on montre Frieren pour la démo
const id = Number(new URLSearchParams(location.search).get('id')) || 154587;

const REQUETE_FICHE = `query($id:Int){ Media(id:$id){
  id type format status episodes chapters duration season seasonYear averageScore popularity genres siteUrl
  description bannerImage coverImage{extraLarge color}
  title{romaji english native}
  startDate{year month day}
  studios(isMain:true){ nodes{ name } }
  nextAiringEpisode{ episode airingAt }
  trailer{ id site }
  relations{ edges{ relationType node{ id type format title{romaji english} coverImage{extraLarge color} averageScore } } }
  recommendations(perPage:15, sort:RATING_DESC){ nodes{ mediaRecommendation{ id title{romaji english} coverImage{extraLarge color} averageScore format seasonYear } } }
  reviews(perPage:6, sort:RATING_DESC){ nodes{ id summary score rating ratingAmount siteUrl user{ name avatar{ medium } } } }
} }`;

// ---------- Suivi (stocké localement dans le navigateur) ----------
const CLE_SUIVIS = 'radar:suivis';
const lireSuivis = () => JSON.parse(localStorage.getItem(CLE_SUIVIS) || '[]');
function basculerSuivi(idAnime) {
  const suivis = lireSuivis();
  const index = suivis.indexOf(idAnime);
  if (index === -1) suivis.push(idAnime); else suivis.splice(index, 1);
  localStorage.setItem(CLE_SUIVIS, JSON.stringify(suivis));
  return index === -1; // true = maintenant suivi
}

// "dans 2 j 5 h" à partir d'un timestamp
function compteARebours(timestamp) {
  const secondes = timestamp - Date.now() / 1000;
  const j = Math.floor(secondes / 86400);
  const h = Math.floor((secondes % 86400) / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  return j > 0 ? `${j} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Ordre d'affichage des relations : les suites/préquelles d'abord
const ORDRE_RELATIONS = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'SOURCE', 'ADAPTATION', 'ALTERNATIVE'];

async function chargerFiche() {
  const { Media: m } = await anilist(REQUETE_FICHE, { id });
  document.title = `${titre(m)} — Radar`;
  appliquerAccent(m.coverImage.color);

  const suivi = lireSuivis().includes(m.id);
  const studio = m.studios.nodes[0]?.name;
  const nbEpisodes = m.type === 'MANGA' ? (m.chapters && `${m.chapters} chapitres`) : (m.episodes && `${m.episodes} épisodes`);

  // Ligne d'infos sous le titre : la note (mise en avant) puis le reste, échappé
  const metaHtml = (m.averageScore ? `<span class="note">★ ${note(m.averageScore)}</span>` : '')
    + [FORMATS_FR[m.format], m.seasonYear || m.startDate.year, nbEpisodes, studio]
      .filter(Boolean).map((x) => `<span>${echapper(x)}</span>`).join('');

  const genres = m.genres.map((g) => `<span class="pastille">${GENRES_FR[g] || g}</span>`).join('');
  const statut = `<span class="pastille accent">${STATUTS_FR[m.status] || m.status}</span>`;

  const prochain = m.nextAiringEpisode
    ? `<div class="prochain">Épisode <b>${m.nextAiringEpisode.episode}</b> dans <b>${compteARebours(m.nextAiringEpisode.airingAt)}</b></div>`
    : '';

  const bandeAnnonce = m.trailer?.site === 'youtube'
    ? `<a class="bouton bouton-plein" href="https://www.youtube.com/watch?v=${encodeURIComponent(m.trailer.id)}" target="_blank" rel="noopener">${ICONES.lecture}Bande-annonce</a>`
    : '';

  // Relations triées, sans les "personnages communs" (peu utiles)
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
          <div class="meta">${metaHtml}</div>
          <div class="genres-liste">${statut}${genres}</div>
          <div class="actions">
            ${bandeAnnonce}
            <button class="bouton bouton-verre ${suivi ? 'actif' : ''}" id="suivre">${suivi ? ICONES.check + 'Suivi' : ICONES.plus + 'Suivre'}</button>
            <button class="bouton bouton-verre" id="hasard">${ICONES.de}Au hasard</button>
          </div>
          ${prochain}
        </div>
      </div>
    </section>

    <div class="fiche-corps">
      <div class="carte">
        <h2>Synopsis</h2>
        <p class="synopsis replie">${echapper(nettoyerSynopsis(m.description)) || 'Pas de synopsis disponible.'}</p>
        <button class="lire-plus">Lire la suite</button>
      </div>
      <div class="carte">
        ${m.averageScore ? `<div class="note-anneau" style="--p:${m.averageScore}"><span>${note(m.averageScore)}</span></div>` : ''}
        <dl class="infos-liste">
          ${ligneInfo('Format', FORMATS_FR[m.format])}
          ${ligneInfo('Statut', STATUTS_FR[m.status])}
          ${ligneInfo(m.type === 'MANGA' ? 'Chapitres' : 'Épisodes', m.type === 'MANGA' ? m.chapters : m.episodes)}
          ${ligneInfo('Durée', m.duration && `${m.duration} min`)}
          ${ligneInfo('Studio', studio)}
          ${ligneInfo('Popularité', m.popularity?.toLocaleString('fr-FR'))}
        </dl>
      </div>
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
      <div class="carrousel">${recos.map((r) => carteAffiche(r, { sous: FORMATS_FR[r.format] || '' })).join('')}</div>
    </section>` : ''}
  `;

  // Boutons
  const boutonSuivre = document.getElementById('suivre');
  boutonSuivre.addEventListener('click', () => {
    const estSuivi = basculerSuivi(m.id);
    boutonSuivre.classList.toggle('actif', estSuivi);
    boutonSuivre.innerHTML = estSuivi ? ICONES.check + 'Suivi' : ICONES.plus + 'Suivre';
  });
  brancherBoutonHasard(document.getElementById('hasard'));

  // "Lire la suite" : visible seulement si le synopsis est vraiment coupé
  const synopsis = document.querySelector('.synopsis');
  const lirePlus = document.querySelector('.lire-plus');
  if (synopsis.scrollHeight <= synopsis.clientHeight + 2) lirePlus.remove();
  lirePlus.addEventListener('click', () => {
    const replie = synopsis.classList.toggle('replie');
    lirePlus.textContent = replie ? 'Lire la suite' : 'Réduire';
  });
}

const rang = (type) => { const i = ORDRE_RELATIONS.indexOf(type); return i === -1 ? 99 : i; };

function ligneInfo(nom, valeur) {
  return valeur ? `<div><dt>${nom}</dt><dd>${echapper(valeur)}</dd></div>` : '';
}

function carteAvis(avis) {
  // On n'affiche que le résumé de l'avis (court), avec un lien vers l'avis complet
  return `
    <a class="avis-carte" href="${avis.siteUrl}" target="_blank" rel="noopener">
      <div class="avis-auteur">
        <img src="${avis.user.avatar.medium}" alt="">
        ${echapper(avis.user.name)}
        <span class="pastille accent">${avis.score}/100</span>
      </div>
      <p>« ${echapper(avis.summary)} »</p>
      <small>${avis.rating} personnes sur ${avis.ratingAmount} ont trouvé cet avis utile</small>
    </a>`;
}

chargerFiche().catch((erreur) => {
  document.getElementById('fiche').innerHTML = `<div class="erreur" style="margin-top:100px">Impossible de charger cet animé : ${echapper(erreur.message)}</div>`;
});
