# Radar

Mon site perso qui regroupe les actus qui m'intéressent, au même endroit, dans une interface inspirée d'Apple TV.

**En ligne : <https://wazyrix.github.io/radar/>**

| Section | Ce qu'on y trouve | D'où viennent les données |
|---|---|---|
| **Animés** | Calendrier des épisodes, fiches complètes (avec liens directs vers les épisodes sur Crunchyroll, ADN, Netflix…, saison par saison, et le prochain épisode à voir), rattrapage de mes suivis, exploration par genres + tirage au hasard | API GraphQL [AniList](https://anilist.co), appelée directement par le navigateur |
| **Animés en France** | Heure de sortie VOSTFR/VF et langues disponibles saison par saison | API publique d'[ADN](https://animationdigitalnetwork.com) (collectée toutes les heures) |
| **Jeux vidéo** | Sorties à venir / récentes, fiches (avis, config PC, comment y jouer, rétro/émulation), mes listes, explorer par genre, tirage au hasard | [RAWG](https://rawg.io) + Steam, via un relais Cloudflare Worker ([worker/](worker/README.md)) |
| **Actu jeux** | Sorties, annonces, tests, consoles, scène jailbreak/homebrew | Flux RSS (jeuxvideo.com, Gamekult, IGN France, Gameblog, ActuGaming, PlayStation Blog, Nintendo Life, Gematsu, Wololo) |
| **Films & séries** | Calendrier des sorties (cinéma en France, séries du moment, nouvelles séries), fiches complètes (où le regarder, saisons, casting, bande-annonce), explorer par genre / plateforme + tirage au hasard, actu ciné | [TMDB](https://www.themoviedb.org) (+ JustWatch pour les plateformes) via le relais Cloudflare, flux RSS (AlloCiné, Écran Large) |
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
Toutes les heures (GitHub Actions, lancé par le cron du relais Cloudflare)
  scripts/collecte.py ──lit──> flux RSS ──écrit──> data/*.json ──> publié sur GitHub Pages
  scripts/collecte_anilist.py ──> tendances, mieux notés, calendrier ──> data/anilist.json

Dans le navigateur
  pages HTML ──> js/pages/*.js ──┬──> data/*.json         (actus, ADN)
                                 ├──> API AniList          (fiches, explorer… avec cache ; l'accueil lit data/anilist.json)
                                 ├──> Supabase             (comptes, groupes, amis, chat, notes : règles RLS dans supabase/)
                                 └──> relais Cloudflare ──┬──> RAWG + Steam (jeux) · TMDB (films et séries)   (clés secrètes)
                                                          └──> listes, notifications, cloche (Durable Object SQLite)
```

### Arborescence

```
index.html, animes.html, anime.html, jeux.html, jeu.html, films.html, film.html,
actus.html, ma-liste.html, potes.html, chat.html   les pages
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
  collecte_anilist.py  tendances, mieux notés de la saison et calendrier AniList (pour l'accueil)
  sources.json      liste des flux + mots-clés des tags
data/               JSON générés (ne pas modifier à la main)
.github/workflows/actus.yml   collecte horaire + déploiement
worker/             relais Cloudflare Worker (RAWG, Steam, TMDB, notifications, stockage des listes), voir worker/README.md
supabase/           base des comptes (à exécuter dans Supabase, dans cet ordre) :
                    schema.sql, chat.sql, securite.sql, preferences.sql, amis.sql, notes.sql,
                    dates-recommandations.sql, comptes.sql, moderation.sql, securite-2.sql,
                    codes-uniques.sql (après avoir réglé les codes en double, s'il y en a)
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
- **AniList limite à 30 requêtes/minute** (en ce moment, 90 normalement), puis bloque l'adresse IP une minute, avec une réponse sans en-têtes CORS : le navigateur n'y voit qu'une panne réseau. Donc :
  - l'accueil et le calendrier lisent `data/anilist.json`, régénéré toutes les heures par GitHub Actions (plus aucun appel à AniList) ;
  - chaque réponse est gardée en cache (calendrier 15 min, tendances et explorer 1 h, fiches et saisons 24 h, sauf si le « prochain épisode » est déjà sorti) ; les requêtes identiques en cours sont partagées ;
  - un limiteur commun à tous les onglets (25 requêtes/min) et l'état « bloqué » sont gardés dans `localStorage` ; pendant un blocage, on n'envoie plus rien ;
  - saturé ou en panne : on affiche le cache même expiré (gardé 3 jours) ; sinon « AniList est surchargé, réessaie dans X secondes » avec un nouvel essai automatique.
- **Le total de résultats d'AniList est faux** (toujours 5000) : le tirage au hasard cherche donc la vraie dernière page par dichotomie, puis pioche parmi les 500 plus populaires qui correspondent aux filtres.
- **Heures du calendrier** : AniList donne l'heure de **diffusion TV au Japon**, convertie dans ton fuseau horaire. Les sites de streaming VOSTFR (Crunchyroll, ADN, anime-sama…) publient en général un peu plus tard : les deux heures sont justes, elles ne mesurent pas la même chose.
- **VOSTFR / VF** : seule ADN publie ces infos librement. ADN et AniList n'ont pas d'identifiant commun, donc on associe les séries par leur titre « nettoyé » (sans accents, ponctuation ni numéro de saison) : ça marche dans la grande majorité des cas, mais une série peut être ratée. Crunchyroll ne publie ni ses horaires ni ses langues.
- **Droits d'auteur** : pour les actus, on ne garde que le titre, la source, la date, un extrait de 200 caractères maximum et le lien vers l'article original.
- **Ma liste** : stockée dans le navigateur et copiée sur le relais (Durable Object SQLite) sous un « code perso » de 32 caractères aléatoires. Le même code sur un autre appareil = la même liste.
- **Favoris et notes perso** (animés, mangas, films, séries, jeux) : un seul système (`js/lib/notes.js`, `js/ui/notes.js`). Ma note sur 100, un avis de 500 caractères max et/ou un favori ❤️, gardés dans le navigateur et, une fois connecté, dans la table Supabase `notes` (`supabase/notes.sql`) : visibles par moi, mes amis et les membres de mes groupes seulement (RLS). La page Potes en tire l'activité (« a noté… »), la compatibilité de goûts avec chaque pote et les suggestions des plus compatibles. Le statut « Adoré » des jeux est devenu « Terminé » + favori.
- **Notifications web** : le relais vérifie les nouveautés toutes les heures et envoie des notifications chiffrées (norme Web Push, sans bibliothèque). Le service worker (`sw.js`) les affiche, même site fermé. Sur iPhone, il faut d'abord ajouter le site à l'écran d'accueil.

## Feuille de route

- [x] **V1** : site, section Animés (calendrier, fiche, hasard, genres, rattrapage), actus avec filtres, collecte automatique, déploiement
- [x] **Section Jeux** : sorties, fiches, listes, explorer, hasard (RAWG + Steam via le relais)
- [x] **V2** : « Ma liste » (animés, mangas, séries, films, jeux) synchronisée par code perso + notifications web (épisodes, VOSTFR/VF, suites, tomes, séries, films, jeux), site installable comme une appli
- [x] **V3** : comptes pour les potes avec Supabase (groupes, amis, chat, recommandations, notes et favoris, modération, suppression de compte)
- [x] **Films & séries** : TMDB via le relais (fiches, explorer, hasard, calendrier des sorties)
