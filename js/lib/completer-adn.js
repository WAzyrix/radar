// =========================================================
// Complète "Ma liste" avec la série ADN de chaque animé suivi.
//
// L'identifiant ADN sert au relais pour prévenir de la sortie VOSTFR/VF.
// Il est enregistré quand on clique sur "Suivre", mais il peut manquer :
//   - animés suivis avant la V2 ;
//   - animé arrivé sur ADN APRÈS qu'on l'a suivi.
// On revérifie donc les animés sans série ADN, au plus une fois par semaine chacun.
// =========================================================
import { anilist } from '../api/anilist.js';
import { chargerAdn, trouverSerie } from '../api/adn.js';
import * as maListe from './ma-liste.js';

const CLE_VERIFS = 'radar:adn-verifs'; // { idAnime: date de la dernière vérification }
const SEMAINE = 7 * 86400_000;

export async function completerAdn() {
  let verifs = {};
  try { verifs = JSON.parse(localStorage.getItem(CLE_VERIFS)) || {}; } catch { /* on repart de zéro */ }

  const aVerifier = maListe.items('anime')
    .filter((a) => !a.adn && Date.now() - (verifs[a.id] || 0) > SEMAINE)
    .slice(0, 50);
  if (!aVerifier.length) return 0;

  const [adn, data] = await Promise.all([
    chargerAdn(),
    anilist('query($ids:[Int]){ Page(perPage:50){ media(id_in:$ids){ id title{romaji english native} synonyms } } }',
      { ids: aVerifier.map((a) => a.id) }, { duree: 24 * 3600_000 }),
  ]);
  if (!adn) return 0;

  let trouves = 0;
  for (const media of data.Page.media) {
    const serie = trouverSerie(adn, media);
    if (serie) {
      maListe.enregistrer({ type: 'anime', id: media.id, adn: serie.id });
      trouves += 1;
    }
    verifs[media.id] = Date.now();
  }
  localStorage.setItem(CLE_VERIFS, JSON.stringify(verifs));
  return trouves;
}
