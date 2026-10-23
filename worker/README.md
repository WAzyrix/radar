# Relais Radar (Cloudflare Worker)

Petit serveur gratuit hébergé chez Cloudflare, qui sert d'intermédiaire entre le site et :

- **RAWG** (base de données de jeux) : l'API demande une clé, qui ne doit pas être visible dans le code du site. Le relais la garde secrète.
- **Steam** : son API refuse les appels venant d'un navigateur (pas de CORS). Le relais, lui, est un serveur : il peut l'appeler.

```
navigateur ──> relais (Cloudflare) ──┬──> RAWG   (clé secrète ajoutée ici)
                                     └──> Steam  (config, prix, avis en français)
```

## Installation (une seule fois)

Nécessite Node.js (`sudo apt install nodejs npm`). On utilise wrangler 3, compatible avec Node 20 (la version de Debian 13).

```bash
cd worker
npm install
npx wrangler login                  # ouvre le navigateur pour se connecter à Cloudflare
npx wrangler secret put RAWG_KEY    # colle ta clé RAWG quand c'est demandé
npx wrangler deploy                 # affiche l'adresse du relais (…workers.dev)
```

Puis mettre cette adresse dans `js/config.js` (`URL_RELAIS`).

## Routes

| Route | Rôle |
|---|---|
| `/jeux?search=&genres=&parent_platforms=&dates=&ordering=&metacritic=&page=` | Liste / recherche de jeux |
| `/jeu/:id` | Fiche complète : RAWG + captures + boutiques + série + infos Steam |
| `/hasard?…` | Un jeu au hasard parmi ceux qui correspondent aux filtres |
| `/genres` | Genres RAWG |

## Sécurité

- Seuls les sites listés dans `ORIGINES` (`wrangler.toml`) peuvent utiliser le relais depuis un navigateur.
- Seuls certains paramètres sont transmis à RAWG (liste `PARAMS_AUTORISES`).
- Gratuit : 100 000 requêtes par jour chez Cloudflare, 20 000 par mois chez RAWG (le site garde les réponses en cache).
