# Relais Radar (Cloudflare Worker)

Petit serveur gratuit hébergé chez Cloudflare, qui sert d'intermédiaire entre le site et :

- **RAWG** (base de données de jeux) : l'API demande une clé, qui ne doit pas être visible dans le code du site. Le relais la garde secrète.
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

## Routes

| Route | Rôle |
|---|---|
| `/jeux?search=&genres=&parent_platforms=&dates=&ordering=&metacritic=&page=` | Liste / recherche de jeux |
| `/jeu/:id` | Fiche complète : RAWG + captures + boutiques + série + infos Steam |
| `/hasard?…` | Un jeu au hasard parmi ceux qui correspondent aux filtres |
| `/genres` | Genres RAWG |

## Sécurité

- Seuls les sites listés dans `ORIGINES` (`wrangler.toml`) peuvent utiliser le relais : toute autre origine (ou une requête sans en-tête `Origin`) reçoit une erreur 403. Pour tester le site en local, ajouter temporairement `http://localhost:8000` à `ORIGINES` et redéployer.
- Limite de débit par adresse IP (`src/limiteur.js`, un Durable Object par adresse) : 40 requêtes/min sur les routes RAWG/TMDB, 20/min en écriture, 60/min pour le reste. Au-delà : erreur 429 avec le délai à attendre.
- La clé RAWG est retirée des liens de pagination renvoyés par RAWG avant de répondre au navigateur.
- Seuls certains paramètres sont transmis à RAWG (liste `PARAMS_AUTORISES`).
- Gratuit : 100 000 requêtes par jour chez Cloudflare, 20 000 par mois chez RAWG (le site garde les réponses en cache).
