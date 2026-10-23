# Radar

Mon site perso qui regroupe les actus qui m'intéressent, au même endroit, dans une interface inspirée d'Apple TV.

**En ligne : <https://wazyrix.github.io/radar/>**

| Section | Ce qu'on y trouve | D'où viennent les données |
|---|---|---|
| **Animés** | Calendrier des épisodes, fiches complètes, rattrapage de mes suivis, exploration par genres + tirage au hasard | API GraphQL [AniList](https://anilist.co), appelée directement par le navigateur |
| **Animés en France** | Heure de sortie VOSTFR/VF et langues disponibles saison par saison | API publique d'[ADN](https://animationdigitalnetwork.com) (collectée toutes les heures) |
| **Jeux vidéo** | Sorties à venir / récentes, fiches (avis, config PC, comment y jouer, rétro/émulation), mes listes, explorer par genre, tirage au hasard | [RAWG](https://rawg.io) + Steam, via un relais Cloudflare Worker ([worker/](worker/README.md)) |
| **Actu jeux** | Sorties, annonces, tests, consoles, scène jailbreak/homebrew | Flux RSS (jeuxvideo.com, Gamekult, IGN France, Gameblog, ActuGaming, PlayStation Blog, Nintendo Life, Gematsu, Wololo) |
| **Films & séries** | Actu ciné et séries | Flux RSS (AlloCiné, Écran Large) |
| **Cyber & info** | Failles, CVE, ransomwares, jailbreaks, outils | Flux RSS (CERT-FR, BleepingComputer, The Hacker News, Zataz, Korben) |
| **Actu** | France / États-Unis / Monde | Flux RSS (franceinfo, Le Monde, NPR, CBS News, BBC World, France 24) |

Tout est **100 % gratuit** : GitHub Pages pour l'hébergement, GitHub Actions pour la collecte des actus.

## Lancer en local

```bash
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000>. (Un serveur est nécessaire : ouvrir `index.html` directement ne marche pas, car les modules JavaScript et les fichiers JSON ne se chargent pas en `file://`.)

Pour mettre à jour les actus en local :

```bash
python3 scripts/collecte.py
```

> ⚠️ Le robot GitHub commite les actus toutes les heures. Deux règles pour éviter les conflits :
> - avant de pousser, fais un `git pull --rebase` ;
> - ne commite pas `data/` toi-même : après une collecte de test en local, annule-la avec `git checkout data/` (le robot régénère tout après ton push).
>
> En cas de conflit sur `data/*.json` pendant un rebase : `git checkout --ours data/ && git add data/ && git rebase --continue`.

## Comment ça marche

```
Toutes les heures (GitHub Actions)
  scripts/collecte.py ──lit──> flux RSS ──écrit──> data/*.json ──> publié sur GitHub Pages

Dans le navigateur
  pages HTML ──> js/pages/*.js ──┬──> data/*.json         (actus, ADN)
                                 ├──> API AniList          (animés, avec cache)
                                 └──> relais Cloudflare ──> RAWG + Steam   (jeux, clé RAWG secrète)
```

### Arborescence

```
index.html, animes.html, anime.html, jeux.html, jeu.html, actus.html   les pages
css/
  base.css          variables (couleurs, arrondis…), remise à zéro, typo
  composants.css    nav, boutons, cartes, carrousels… réutilisés partout
  pages.css         ce qui est propre à chaque page
js/
  api/anilist.js    client AniList : cache localStorage + limiteur de requêtes
  api/animes.js     toutes les requêtes animés (calendrier, fiche, explorer, hasard, rattrapage)
  api/actus.js      lecture des JSON d'actus + réglages des catégories
  lib/              outils (dates, échappement HTML…), traductions, suivis
  ui/               composants : navigation, cartes, calendrier, icônes, couleur d'accent
  pages/            un fichier par page
scripts/
  collecte.py       collecte RSS (bibliothèque standard Python uniquement)
  collecte_adn.py   catalogue + calendrier ADN (langues par saison, heures VOSTFR/VF)
  sources.json      liste des flux + mots-clés des tags
data/               JSON générés (ne pas modifier à la main)
.github/workflows/actus.yml   collecte horaire + déploiement
worker/             relais Cloudflare Worker (RAWG + Steam), voir worker/README.md
```

### Ajouter une source ou un tag

Tout se passe dans [`scripts/sources.json`](scripts/sources.json) :

- **Source** : ajouter `{ "nom": "...", "url": "https://.../feed" }` dans la catégorie (avec `"zone": "france" | "usa" | "monde"` pour l'actu générale).
- **Tag** : ajouter une entrée `"Nom du tag": ["mot", "autre mot"]`. Règles :
  - `"faille"` : mot entier, pluriel accepté (« failles ») ;
  - `"hack*"` : tout ce qui commence par « hack » ;
  - `"IA"` : avec une majuscule, la casse compte (évite le « ai » de « j'ai ») ;
  - les accents sont ignorés.

## Choix techniques (et pourquoi)

- **HTML/CSS/JS sans framework** : rien à compiler, on comprend tout en lisant le code. Les modules JS (`import`/`export`) découpent le code proprement.
- **AniList limite à 30 requêtes/minute** (en ce moment) : chaque réponse est gardée en cache dans le navigateur (de 10 min à 1 h selon le type) et un limiteur fait patienter si on approche de la limite.
- **Le total de résultats d'AniList est faux** (toujours 5000) : le tirage au hasard cherche donc la vraie dernière page par dichotomie, puis pioche parmi les 500 plus populaires qui correspondent aux filtres.
- **Heures du calendrier** : AniList donne l'heure de **diffusion TV au Japon**, convertie dans ton fuseau horaire. Les sites de streaming VOSTFR (Crunchyroll, ADN, anime-sama…) publient en général un peu plus tard : les deux heures sont justes, elles ne mesurent pas la même chose.
- **VOSTFR / VF** : seule ADN publie ces infos librement. ADN et AniList n'ont pas d'identifiant commun, donc on associe les séries par leur titre « nettoyé » (sans accents, ponctuation ni numéro de saison) : ça marche dans la grande majorité des cas, mais une série peut être ratée. Crunchyroll ne publie ni ses horaires ni ses langues.
- **Droits d'auteur** : pour les actus, on ne garde que le titre, la source, la date, un extrait de 200 caractères maximum et le lien vers l'article original.
- **Suivis** : stockés dans le navigateur (`localStorage`). Ils ne se synchronisent pas entre appareils (ce sera le rôle de Supabase en V3).

## Feuille de route

- [x] **V1** : site, section Animés (calendrier, fiche, hasard, genres, rattrapage), actus avec filtres, collecte automatique, déploiement
- [ ] **V2** : watchlist (animés, mangas, films) + notifications push sur téléphone via ntfy.sh
- [ ] **V3** : comptes pour les potes avec Supabase
