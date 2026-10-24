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
npx wrangler login                  # ouvre le navigateur pour se connecter à Cloudflare
npx wrangler secret put RAWG_KEY    # colle ta clé RAWG quand c'est demandé
npx wrangler deploy                 # affiche l'adresse du relais (…workers.dev)
```

Puis mettre cette adresse dans `js/config.js` (`URL_RELAIS`).

## Lancement de la collecte des actus

Le `schedule` de GitHub Actions est souvent retardé ou sauté. Toutes les heures, la tâche planifiée du relais lance donc le workflow `actus.yml` (`workflow_dispatch`, fichier `src/github.js`). Il faut un jeton GitHub **fine-grained** limité au dépôt `radar`, avec la seule permission **Actions : Read and write** :

```bash
npx wrangler secret put GITHUB_TOKEN   # colle le jeton quand c'est demandé
npx wrangler deploy
```

Le résultat apparaît dans les journaux du relais (`npx wrangler tail`) : `Collecte des actus : {"lance":true}`. Si le jeton expire, le `schedule` de GitHub (toutes les 6 h) prend le relais.

## Supabase : pas de mise en pause

L'offre gratuite de Supabase met le projet en pause après 7 jours sans activité. Une fois par jour (passage de 4 h 05 UTC), la tâche planifiée fait une lecture minimale (`src/eveil.js`) : `recommandations?select=id&limit=1` avec la **clé publique** (`SUPABASE_CLE_PUBLIQUE` dans `wrangler.toml`, jamais la clé service). Sans connexion, la RLS renvoie une liste vide, mais la base a bien travaillé ; rien n'est écrit. Dans `npx wrangler tail` : `Supabase (anti-pause) : {"ok":true,"statut":200}`.

## Stockage (listes, notifications, cloche)

Les données du relais (listes, abonnements aux notifications, état de la vérification horaire, cloche) sont dans un **Durable Object SQLite** (`src/stockage.js`), pas dans KV : l'offre gratuite de KV n'autorise que 1000 écritures par jour, contre 100 000 lignes écrites par jour pour un Durable Object SQLite. Au premier passage après le déploiement, les anciennes données KV sont recopiées automatiquement (journaux : `Stockage : {"migration":"finie",…}`). Le binding `RADAR_KV` pourra ensuite être retiré de `wrangler.toml`.

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
