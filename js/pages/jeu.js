// =========================================================
// Fiche jeu : jeu.html?id=XXXX (id RAWG)
// Avis (Metacritic, joueurs, Steam), configuration PC, comment y jouer, captures, série.
// =========================================================
import { ficheJeu, jeuAuHasard } from '../api/jeux.js';
import { echapper, formatDate } from '../lib/outils.js';
import { GENRES_JEUX, NOTES_RAWG, RETRO, couleurMetacritic } from '../lib/traductions-jeux.js';
import { statutJeu, changerStatut, STATUTS_JEU } from '../lib/listes-jeux.js';
import { afficherNavigation } from '../ui/nav.js';
import { appliquerAccent } from '../ui/accent.js';
import { carteJeu, badgeMetacritic, dateSortie, imageReduite } from '../ui/cartes-jeux.js';
import { ICONES } from '../ui/icones.js';
import { boutonRecommander, brancherRecommandation } from '../ui/recommander.js';

afficherNavigation('jeux');

const id = Number(new URLSearchParams(location.search).get('id'));
const ligneInfo = (nom, valeur) => (valeur ? `<div><dt>${nom}</dt><dd>${echapper(valeur)}</dd></div>` : '');
const noms = (liste) => (liste || []).map((x) => x.name).join(', ');

// ---------- Morceaux de la fiche ----------

function boutonsStatut(jeu) {
  const actuel = statutJeu(jeu.id);
  return Object.entries(STATUTS_JEU).map(([cle, s]) => `
    <button type="button" class="bouton bouton-verre bouton-petit ${cle === actuel ? 'actif' : ''}" data-statut="${cle}">
      ${cle === actuel ? ICONES.check : ICONES[s.icone]}${s.court}
    </button>`).join('');
}

function carteAvis(jeu, steam) {
  const barres = (jeu.ratings || [])
    .sort((a, b) => b.percent - a.percent)
    .map((r) => {
      const n = NOTES_RAWG[r.title] || { nom: r.title, couleur: 'var(--accent)' };
      return `<div class="barre-avis"><span>${n.nom}</span><div><i style="width:${r.percent}%;background:${n.couleur}"></i></div><b>${Math.round(r.percent)} %</b></div>`;
    }).join('');

  const steamAvis = steam?.avis
    ? `<p class="avis-steam">Steam : <b>${echapper(steam.avis.resume)}</b> (${Math.round((steam.avis.positifs / steam.avis.total) * 100)} % positifs sur ${steam.avis.total.toLocaleString('fr-FR')} avis)</p>`
    : steam?.recommandations ? `<p class="avis-steam">Steam : ${steam.recommandations.toLocaleString('fr-FR')} recommandations</p>` : '';

  if (!jeu.metacritic && !barres && !steamAvis) return '';
  return `
    <div class="carte carte-large">
      <h2>Avis</h2>
      <div class="avis-grille">
        ${jeu.metacritic ? `<div class="note-anneau" style="--p:${jeu.metacritic};--accent:${couleurMetacritic(jeu.metacritic)}" title="Note Metacritic (presse)"><span>${jeu.metacritic}</span></div>` : ''}
        <div style="flex:1;min-width:220px">
          ${barres ? `<p class="mention" style="margin:0 0 10px">Avis des joueurs RAWG (${(jeu.ratings_count || 0).toLocaleString('fr-FR')} votes)</p>${barres}` : ''}
          ${steamAvis}
        </div>
      </div>
      ${jeu.metacritic_url ? `<p class="mention"><a class="lien-discret" href="${echapper(jeu.metacritic_url)}" target="_blank" rel="noopener">Critiques presse sur Metacritic</a></p>` : ''}
    </div>`;
}

function carteConfig(steam, configRawg) {
  // Priorité à Steam (en français), sinon RAWG (en anglais)
  const config = steam?.config?.minimum?.length ? steam.config : configRawg;
  if (!config || (!config.minimum?.length && !config.recommande?.length)) return '';
  const colonne = (titre, lignes) => (lignes?.length ? `<div><h3>${titre}</h3><ul class="config">${lignes.map((l) => `<li>${formaterLigne(l)}</li>`).join('')}</ul></div>` : '');
  return `
    <div class="carte carte-large">
      <h2>Configuration PC</h2>
      <div class="config-colonnes">
        ${colonne('Minimale', config.minimum)}
        ${colonne('Recommandée', config.recommande)}
      </div>
      <p class="mention">Source : ${config === configRawg ? 'RAWG (en anglais)' : 'Steam'}.</p>
    </div>`;
}

// "Processeur : Intel i5" -> libellé en gras
function formaterLigne(ligne) {
  const [libelle, ...reste] = ligne.split(/\s*:\s*/);
  return reste.length ? `<b>${echapper(libelle)}</b> ${echapper(reste.join(' : '))}` : echapper(ligne);
}

function carteCommentJouer(jeu) {
  const plateformes = (jeu.platforms || []).map((p) => `<span class="pastille">${echapper(p.platform.name)}</span>`).join('');
  const boutiques = (jeu.stores || []).map((s) => (s.url
    ? `<a class="pastille" href="${echapper(s.url)}" target="_blank" rel="noopener">${echapper(s.store.name)} ${ICONES.externe}</a>`
    : `<span class="pastille">${echapper(s.store.name)}</span>`)).join('');

  // Anciennes consoles : solutions officielles + émulateurs
  const retro = (jeu.platforms || []).filter((p) => RETRO[p.platform.slug]).map((p) => {
    const r = RETRO[p.platform.slug];
    return `
      <div class="retro">
        <strong>${echapper(p.platform.name)}</strong>
        <dl class="infos-liste">
          ${ligneInfo('Officiellement', r.officiel)}
          ${ligneInfo('Émulateur', r.emulateurs)}
          ${ligneInfo('Config indicative', r.config)}
        </dl>
      </div>`;
  }).join('');

  return `
    <div class="carte carte-large">
      <h2>Comment y jouer</h2>
      ${plateformes ? `<span class="etiquette">Plateformes</span><div class="plateformes">${plateformes}</div>` : ''}
      ${boutiques ? `<span class="etiquette" style="margin-top:16px">Où l'acheter</span><div class="plateformes">${boutiques}</div>` : ''}
      ${retro ? `<span class="etiquette" style="margin-top:16px">Jeu rétro : comment y jouer aujourd'hui</span>${retro}
        <p class="mention">L'émulation est légale, mais il faut posséder le jeu original et en faire sa propre copie.</p>` : ''}
    </div>`;
}

// ---------- Fiche complète ----------

function afficherFiche({ jeu, captures, serie, steam, configRawg }) {
  document.title = `${jeu.name} · Radar`;
  const couleur = jeu.saturated_color || jeu.dominant_color;
  if (couleur && couleur !== '0f0f0f') appliquerAccent(`#${couleur}`);
  else document.documentElement.style.setProperty('--accent', '#6ee7a8'); // vert "jeux" par défaut
  jeu.metacritic ||= steam?.metacritic; // RAWG n'a pas toujours la note, Steam si

  const genres = (jeu.genres || []).map((g) => GENRES_JEUX[g.slug] || g.name).join(' · ');
  const meta = [
    badgeMetacritic(jeu.metacritic, { enLigne: true }),
    `<span>${echapper(dateSortie(jeu))}</span>`,
    jeu.developers?.[0] && `<span>${echapper(jeu.developers[0].name)}</span>`,
    jeu.playtime && `<span>~${jeu.playtime} h de jeu</span>`,
    steam?.prix && `<span>${echapper(steam.prix)}${steam.reduction ? ` (-${steam.reduction} %)` : ''}</span>`,
  ].filter(Boolean).join('');

  const sortie = jeu.released ? `${formatDate.format(new Date(`${jeu.released}T12:00:00`))} ${jeu.released.slice(0, 4)}` : 'À venir';
  const descriptionFr = steam?.description;
  const descriptionEn = jeu.description_raw;

  document.getElementById('fiche').innerHTML = `
    <section class="heros heros-jeu">
      <div class="heros-image" style="--image-large:url('${jeu.background_image || ''}');--image-mobile:url('${jeu.background_image || ''}')"></div>
      <div class="heros-contenu">
        <div class="surtitre">${echapper(genres || 'Jeu vidéo')}</div>
        <h1>${echapper(jeu.name)}</h1>
        <div class="meta">${meta}</div>
        <div id="potes-suivent"></div>
        <div class="actions" style="margin-top:22px" id="statuts">${boutonsStatut(jeu)}</div>
        <div class="actions" style="margin-top:10px">
          <button type="button" class="bouton bouton-verre bouton-petit" id="hasard">${ICONES.de}Au hasard</button>
          ${jeu.website ? `<a class="bouton bouton-verre bouton-petit" href="${echapper(jeu.website)}" target="_blank" rel="noopener">${ICONES.externe}Site officiel</a>` : ''}
          ${boutonRecommander()}
        </div>
      </div>
    </section>

    <div class="fiche-corps">
      <div class="carte">
        <h2>Présentation</h2>
        ${descriptionFr ? `<p class="synopsis">${echapper(descriptionFr)}</p>` : ''}
        ${descriptionEn ? `
          <p class="synopsis ${descriptionFr ? 'description-en' : ''} replie" ${descriptionFr ? 'hidden' : ''}>${echapper(descriptionEn)}</p>
          <button type="button" class="lire-plus">${descriptionFr ? 'Description complète (en anglais)' : 'Lire la suite'}</button>` : ''}
        ${!descriptionFr && !descriptionEn ? '<p class="synopsis">Pas de description disponible.</p>' : ''}
      </div>
      <div class="carte">
        ${jeu.metacritic ? `<div class="note-anneau" style="--p:${jeu.metacritic};--accent:${couleurMetacritic(jeu.metacritic)}" title="Note Metacritic"><span>${jeu.metacritic}</span></div>` : ''}
        <dl class="infos-liste">
          ${ligneInfo('Sortie', sortie)}
          ${ligneInfo('Développeur', noms(jeu.developers))}
          ${ligneInfo('Éditeur', noms(jeu.publishers))}
          ${ligneInfo('Classification', jeu.esrb_rating?.name)}
          ${ligneInfo('Durée moyenne', jeu.playtime && `${jeu.playtime} h`)}
          ${ligneInfo('Prix Steam', steam?.prix)}
        </dl>
      </div>
      ${carteAvis(jeu, steam)}
      ${carteCommentJouer(jeu)}
      ${carteConfig(steam, configRawg)}
    </div>

    ${captures.length ? `
    <section class="section">
      <div class="section-tete"><h2>Captures</h2></div>
      <div class="carrousel jeux captures">${captures.map((c) => `
        <a href="${echapper(c)}" target="_blank" rel="noopener" class="carte-jeu"><div class="carte-jeu-image"><img src="${imageReduite(c)}" alt="" loading="lazy"></div></a>`).join('')}
      </div>
    </section>` : ''}

    ${serie.length ? `
    <section class="section">
      <div class="section-tete"><h2>De la même série</h2></div>
      <div class="carrousel jeux">${serie.map((j) => carteJeu(j)).join('')}</div>
    </section>` : ''}
  `;

  // Statut dans mes listes
  document.getElementById('statuts').addEventListener('click', (e) => {
    const bouton = e.target.closest('[data-statut]');
    if (!bouton) return;
    changerStatut(jeu, bouton.dataset.statut);
    document.getElementById('statuts').innerHTML = boutonsStatut(jeu);
  });

  brancherRecommandation({ type: 'jeu', id: jeu.id, titre: jeu.name, image: jeu.background_image }, document.getElementById('potes-suivent'));

  // Au hasard : on garde une référence au bouton (e.currentTarget vaut null après un await)
  const hasard = document.getElementById('hasard');
  hasard.addEventListener('click', async () => {
    hasard.disabled = true;
    try {
      const autre = await jeuAuHasard();
      if (autre) location.href = `jeu.html?id=${Number(autre.id)}`;
      else alert('Aucun jeu trouvé, réessaie.');
    } catch (erreur) {
      alert(erreur.message);
    }
    hasard.disabled = false;
  });

  // Description : "Lire la suite" / description anglaise
  const bouton = document.querySelector('.lire-plus');
  const texte = document.querySelector('.description-en') || document.querySelector('.synopsis.replie');
  if (bouton && texte) {
    if (!texte.hidden && texte.scrollHeight <= texte.clientHeight + 2) bouton.remove();
    bouton.addEventListener('click', () => {
      if (texte.hidden) { texte.hidden = false; texte.classList.remove('replie'); bouton.textContent = 'Masquer'; return; }
      const replie = texte.classList.toggle('replie');
      bouton.textContent = replie ? 'Lire la suite' : 'Réduire';
    });
  }
}

function afficherErreurFiche(message) {
  document.getElementById('fiche').innerHTML = `
    <div class="page-tete">
      <h1>Jeu introuvable</h1>
      <p>${echapper(message)}</p>
      <div class="actions" style="margin-top:20px"><a class="bouton bouton-plein" href="jeux.html#explorer">Explorer les jeux</a></div>
    </div>`;
}

if (!id) afficherErreurFiche("Aucun jeu n'est indiqué dans l'adresse.");
else ficheJeu(id).then(afficherFiche).catch((erreur) => afficherErreurFiche(erreur.message));
