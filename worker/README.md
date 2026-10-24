# Relais Radar (Cloudflare Worker)

Petit serveur gratuit hébergé chez Cloudflare, qui sert d'intermédiaire entre le site et (entre autres) :

- **RAWG** (base de données de jeux) : l'API demande une clé, qui ne doit pas être visible dans le code du site. Le relais la garde secrète.
- **TMDB** (films et séries) : même principe, clé secrète `TMDB_KEY`.
- **Steam** : son API refuse les appels venant d'un navigateur (pas de CORS). Le relais, lui, est un serveur : il peut l'appeler.

```
navigateur ──> relais (Cloudflare) ──┬──> RAWG   (clé secrète ajoutée ici)
                                     └──> Steam  (config, prix, avis en français)
```

## Installation (une seule fois)

Nécessite Node.js 22 ou plus (exigé par wrangler 4), installé par exemple avec [nvm](https://github.com/nvm-sh/nvm) : `nvm install 22`.

```bash
cd worker
npm install
npx wrangler login                      # ouvre le navigateur pour se connecter à Cloudflare
npx wrangler secret put RAWG_KEY        # clé API RAWG (jeux)
npx wrangler secret put TMDB_KEY        # clé API TMDB (films et séries)
npx wrangler secret put VAPID_PRIVE     # clé privée des notifications web (JWK, voir ci-dessous)
npx wrangler secret put SUPABASE_SERVICE  # clé "service_role" / "sb_secret_…" de Supabase
npx wrangler secret put GITHUB_TOKEN    # jeton GitHub (voir « Lancement de la collecte »)
npx wrangler deploy                     # affiche l'adresse du relais (…workers.dev)
```

Puis mettre cette adresse dans `js/config.js` (`URL_RELAIS`).

| Secret | À quoi il sert | Où le trouver |
|---|---|---|
| `RAWG_KEY` | jeux (RAWG) | rawg.io → API |
| `TMDB_KEY` | films et séries | themoviedb.org → Paramètres → API (clé v3) |
| `VAPID_PRIVE` | signer les notifications web | paire de clés P-256 au format JWK ; la publique va dans `VAPID_PUBLIQUE` (`wrangler.toml`). La changer désabonne tous les appareils. |
| `SUPABASE_SERVICE` | lire les codes perso pour notifier (recommandations, chat) | Supabase → Project Settings → API keys (secret). **Jamais dans le site.** |
| `GITHUB_TOKEN` | lancer la collecte des actus toutes les heures | voir ci-dessous (**expire le vendredi 22 octobre 2027**) |

Un secret se remplace avec la même commande `npx wrangler secret put NOM` (pas besoin de redéployer).

## Lancement de la collecte des actus

Le `schedule` de GitHub Actions est souvent retardé ou sauté. Toutes les heures, la tâche planifiée du relais lance donc le workflow `actus.yml` (`workflow_dispatch`, fichier `src/github.js`). Il faut un jeton GitHub **fine-grained** limité au dépôt `radar`, avec la seule permission **Actions : Read and write** :

```bash
npx wrangler secret put GITHUB_TOKEN   # colle le jeton quand c'est demandé
npx wrangler deploy
```

**Le jeton actuel expire le vendredi 22 octobre 2027.** À renouveler une ou deux semaines avant (GitHub envoie aussi un email de rappel quelques jours avant) :
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → le jeton du relais → **Regenerate token**. Garder le même dépôt (`wazyrix/radar` seulement) et la même permission (« Actions : Read and write », rien d'autre), choisir la nouvelle durée (1 an au plus), puis copier le jeton affiché (il ne sera plus jamais montré).
2. `cd worker && npx wrangler secret put GITHUB_TOKEN`, puis coller le nouveau jeton (pas besoin de redéployer).
3. Remplacer la date d'expiration dans ce README (ici, dans le tableau des secrets et dans le README principal).
4. Vérifier au passage suivant (heure pile + 5 min) : un run « workflow_dispatch » vert dans l'onglet **Actions** du dépôt, et dans les journaux du relais `Collecte des actus : {"lance":true}`.

Si le jeton expire sans être renouvelé, rien ne casse : le `schedule` de GitHub (toutes les 6 h) continue la collecte, et les journaux du relais affichent `Collecte des actus : {"lance":false,"raison":"GitHub a répondu 401…"}`.

Le résultat apparaît dans les journaux du relais (tableau de bord Cloudflare → Workers → radar-relais → **Logs**, gardés 3 jours ; ou en direct avec `npx wrangler tail`) : `Collecte des actus : {"lance":true}`. Si le jeton expire, le `schedule` de GitHub (toutes les 6 h) prend le relais.

## AniList et MangaUpdates : par la collecte GitHub

AniList (403 « You have been manually blocked ») et MangaUpdates (403) refusent **toutes** les requêtes venant de Cloudflare, quel que soit l'en-tête User-Agent (constaté le 25 octobre 2026). Depuis un ordinateur, tout répond normalement, et GitHub Actions collecte déjà le calendrier AniList toutes les heures sans problème. Le relais ne les appelle donc plus :

1. à chaque passage, la tâche horaire lance le workflow en lui passant les identifiants AniList suivis (entrées `animes` et `mangas` : des nombres, aucun code perso) ;
2. le workflow publie `data/anilist.json` (tous les épisodes d'avant-hier à J+7) et `data/suivis.json` (`scripts/collecte_suivis.py` : suites des animés suivis, série MangaUpdates, dernier tome et dernier chapitre des mangas suivis) ;
3. la vérification lit ces fichiers sur le site (et `data/chapitres.json`, le calendrier des scans, pour les chapitres des mangas suivis, avec un lien vers la plateforme officielle quand elle est connue). Un épisode est notifié dès que son heure de diffusion est passée ; une suite ou un chapitre, au plus tard au passage qui suit la collecte.

Si le workflow en ligne ne connaît pas encore ces entrées (réponse 422), le relais le relance sans elles : la collecte reprend alors les œuvres de son fichier précédent.

## Journaux : bilan de chaque passage

Chaque passage horaire écrit deux lignes (tableau de bord Cloudflare → Workers → radar-relais → **Logs**, ou `npx wrangler tail`) :

```
Vérification : 10 liste(s) vérifiée(s) (3 avec notifs push) · 4 nouveauté(s) détectée(s) (episode 3, manga 1), dont 2 nouvelle(s)
  (déjà vues : 2, coupées par les préférences : 0) · cloche de 2 personne(s) · push : 2 envoyée(s), 0 échec(s), 0 en attente,
  0 sans appareil · sources : calendrier OK (52 min, 194 épisodes), suivis OK (51 min, 40 animés) · erreurs : aucune
Vérification (détail) : {"listes":10, …, "parListe":[{"code":"3fa2c1…","animes":4,"detectees":1,"nouvelles":1,"push":"1 envoyée(s)"}, …]}
```

- **sources** : âge des fichiers de la collecte GitHub. `ILLISIBLE`, ou une erreur « vieux de X h », veut dire que la collecte ne passe plus (onglet **Actions** du dépôt).
- **déjà vues** : nouveautés déjà notifiées à un passage précédent (normal) ; **coupées par les préférences** : la personne a désactivé ce type de notification.
- **push** : envois réussis, échecs avec leur raison (service de push et réponse), envois reportés faute de budget, personnes sans appareil abonné (la cloche du site seulement).
- **parListe** : une ligne par liste, repérée par le début de son code perso (6 caractères, ce qui ne permet pas d'y accéder).

## Supabase : pas de mise en pause

L'offre gratuite de Supabase met le projet en pause après 7 jours sans activité. Une fois par jour (passage de 4 h 05 UTC), la tâche planifiée fait une lecture minimale (`src/eveil.js`) : `recommandations?select=id&limit=1` avec la **clé publique** (`SUPABASE_CLE_PUBLIQUE` dans `wrangler.toml`, jamais la clé service). Sans connexion, la RLS renvoie une liste vide, mais la base a bien travaillé ; rien n'est écrit. Dans `npx wrangler tail` : `Supabase (anti-pause) : {"ok":true,"statut":200}`.

## Stockage (listes, notifications, cloche)

Les données du relais (listes, abonnements aux notifications, état de la vérification horaire, cloche) sont dans un **Durable Object SQLite** (`src/stockage.js`), pas dans KV : l'offre gratuite de KV n'autorise que 1000 écritures par jour, contre 100 000 lignes écrites par jour pour un Durable Object SQLite. Les anciennes données KV y ont été recopiées le 24 octobre 2026 (27 clés, vérifiées une à une) ; le relais n'utilise plus KV. L'espace KV `cff54157…` reste chez Cloudflare comme sauvegarde, et peut être supprimé depuis le tableau de bord.

La vérification horaire enregistre l'état de chacun **avant** d'envoyer la moindre notification (si l'écriture échoue, rien ne part : pas de doublon au passage suivant). Les envois push comptent dans la limite de 50 requêtes par passage : ce qui ne rentre pas part au passage suivant (24 h au plus).

## Routes

| Route | Rôle |
|---|---|
| `/jeux?search=&genres=&parent_platforms=&dates=&ordering=&metacritic=&page=` | Liste / recherche de jeux |
| `/jeu/:id` | Fiche complète : RAWG + captures + boutiques + série + infos Steam |
| `/hasard?…` | Un jeu au hasard parmi ceux qui correspondent aux filtres |
| `/genres` | Genres RAWG |
| `/tmdb/recherche?q=` · `/tmdb/genres` | Recherche de films et séries, genres TMDB |
| `/tmdb/decouvrir?type=film\|serie&genres=&annee=&note=&plateforme=&tri=&page=` | Explorer les films ou les séries |
| `/tmdb/hasard?type=…` | Un film ou une série au hasard parmi les 500 plus populaires qui correspondent aux filtres |
| `/tmdb/sorties?type=film\|serie&quand=avenir\|recentes` · `/tmdb/en-ce-moment` | Calendrier : sorties au cinéma en France (date française), nouvelles séries, séries diffusées cette semaine |
| `/tmdb/fiche/:type/:id` | Fiche complète : plateformes en France (JustWatch), saisons, casting, bande-annonce, recommandations |

## Sécurité

- Seuls les sites listés dans `ORIGINES` (`wrangler.toml`) peuvent utiliser le relais : toute autre origine (ou une requête sans en-tête `Origin`) reçoit une erreur 403. Pour tester le site en local, ajouter temporairement `http://localhost:8000` à `ORIGINES` et redéployer.
- Limite de débit par adresse IP (`src/limiteur.js`, un Durable Object par adresse) : 40 requêtes/min sur les routes RAWG/TMDB, 20/min en écriture, 60/min pour le reste. Au-delà : erreur 429 avec le délai à attendre.
- La clé RAWG est retirée des liens de pagination renvoyés par RAWG avant de répondre au navigateur.
- Seuls certains paramètres sont transmis à RAWG (liste `PARAMS_AUTORISES`).
- Gratuit : 100 000 requêtes par jour chez Cloudflare, 20 000 par mois chez RAWG (le site garde les réponses en cache).
