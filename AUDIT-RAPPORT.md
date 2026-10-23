# Rapport d'audit — Radar

*Audit du 23 octobre 2026 · commit `2ac4cb8`. Corrections appliquées ensuite : voir la [section 5](#5-corrections-appliquées).*

## 1. Résumé

1. Le site **fonctionne bien** en conditions normales : les 9 pages se chargent sans erreur console (en local et sur GitHub Pages), le responsive tient à 360, 768 et 1440 px, les recherches pièges ne cassent rien et les données d'actus sont propres (pas de doublons, tri correct).
2. **Deux failles critiques** : la **clé RAWG secrète est renvoyée en clair** par le relais (donc visible par tous les visiteurs), et les pages Potes et Chat permettent une **XSS stockée** entre membres d'un groupe (vol de session possible).
3. Le **relais n'a aucune limite de débit** : on peut vider le quota RAWG et le quota d'écritures KV de Cloudflare sans être connecté.
4. **Aucun run planifié du workflow n'a eu lieu** depuis la création du dépôt (seuls les `push` déclenchent la collecte). C'est à surveiller : les actus ne se mettent peut-être pas à jour toutes seules.
5. Le reste relève de la robustesse (messages d'erreur techniques, pas de timeout), de bugs d'interface mineurs, de la performance des images et de la documentation, qui n'est plus à jour.

**Ce qui n'a pas pu être testé** : Brave et Firefox (seul le navigateur intégré, basé sur Chromium, était disponible), les comptes, Potes et Chat en vrai (il aurait fallu créer des comptes sur ta base Supabase de production : vérifiés par lecture du code uniquement), la réception réelle des notifications push, et le spam du relais (je n'ai pas voulu consommer ton quota RAWG ; le constat vient du code). `BRIEF.md` n'existe pas dans le dépôt : la liste des fonctionnalités vient du README, d'AUDIT.md et du code.

---

## 2. Tableau des bugs

| # | Gravité | Où | Problème |
|---|---|---|---|
| 1 | 🔴 | Relais `/jeux` | La clé RAWG secrète est visible dans chaque réponse |
| 2 | 🔴 | `potes.js`, `chat.js` (+ SQL) | XSS stockée via les listes, les recommandations et les partages du chat |
| 3 | 🟠 | Relais (toutes les routes) | Aucune limite de débit : quota RAWG/TMDB vidable, proxy utilisable hors navigateur |
| 4 | 🟠 | Relais KV + tâche horaire | Écritures KV sans authentification ; le cron écrit chaque heure pour chaque liste, donc quota gratuit vite atteint |
| 5 | 🟠 | GitHub Actions | Aucun run `schedule` observé ; un run a échoué au commit (conflit `data/` probable) |
| 6 | 🟠 | Toutes les pages API | Réponse vide = message technique ; API lente = squelette infini (pas de timeout) |
| 7 | 🟠 | `verification.js` | Au-delà de 50 identifiants d'animés (tous utilisateurs confondus), des notifications sont perdues sans prévenir |
| 8 | 🟡 | `jeu.js` | « Au hasard » reste grisé à vie si le relais échoue (+ TypeError) |
| 9 | 🟡 | `recommander.js` | Même bug : bouton « Envoyer » bloqué après une erreur |
| 10 | 🟡 | `collecte.py` | Flux Atom : le mauvais lien est choisi (+ avertissement Python) |
| 11 | 🟡 | `api/jeux.js` | Dates calculées en UTC : décalage d'un jour entre 0 h et 2 h (heure de Paris) |
| 12 | 🟡 | `jeux.html` | Le « calendrier des sorties » ne montre que ~30 jeux sur 6 mois |
| 13 | 🟡 | `actus.js` | `?source=` inconnue : 0 article alors que le menu affiche « Toutes » |
| 14 | 🟡 | `fiche.js` | Animé inexistant : message brut d'AniList en anglais (« Not Found. ») |
| 15 | 🟡 | `worker/src/comptes.js` | Abonnement push accepté vers n'importe quelle URL https |
| 16 | 🟡 | Relais `/recommander` | Pas de limite : un pote peut envoyer des centaines de notifications |
| 17 | 🟡 | `supabase/schema.sql` | Le destinataire d'une reco peut réécrire son contenu (auteur, message) |
| 18 | 🟡 | `anilist.js` | Le limiteur repart de zéro à chaque page ; un 429 bloque jusqu'à 60 s sans rien afficher |
| 19 | 🟡 | `ma-liste.js` | Écriture locale sans `try/catch` : si le stockage est plein, la liste n'est pas enregistrée (non reproduit) |
| 20 | 🟡 | Cartes animés | Vignettes en `extraLarge` : ~4,7 Mo par carrousel de 20 affiches |
| 21 | 🟡 | Images | Pas d'image de secours si une affiche ne charge pas |
| 22 | 🟡 | Attributions | TMDB sans logo ; pas de lien RAWG sur l'accueil (qui affiche des jeux) |
| 23 | 🟡 | `css/base.css` | `--texte-3` (#6b6b76 sur #0a0a0f) : contraste 3,7:1, sous le minimum de 4,5:1 |
| 24 | 🟡 | `worker/` | `npm audit` : 7 vulnérabilités (5 hautes) dans wrangler 3 (outil de dev uniquement) |
| 25 | 💡 | Recherche du haut | Minimum 3 caractères : titres japonais courts introuvables ; aucune longueur max |
| 26 | 💡 | Chat (Realtime) | Écoute des suppressions sans filtre de groupe |
| 27 | 💡 | Workflow | Actions en Node 20 (dépréciées), migration `ubuntu-latest` annoncée |
| 28 | 💡 | Code | Code mort et doublons |
| 29 | 💡 | Docs | README et `worker/README.md` pas à jour (et trompeur sur la sécurité) |
| 30 | 💡 | GitHub Pages | Tout le dépôt est publié (`worker/`, `supabase/`, `scripts/`…) |

---

## 3. Détail

### 🔴 1. Clé RAWG exposée par le relais
- **Où** : `worker/src/jeux.js` (`rawg()`, `listeJeux()`), route `/jeux`.
- **Reproduire** : `curl "https://radar-relais.wazyrix.workers.dev/jeux?ordering=-added&page_size=5"`, puis regarder le champ `next`. Il contient `https://api.rawg.io/api/games?key=8a8b50…&page=2…`.
- **Constat** : RAWG met la clé dans les liens de pagination `next` / `previous`, et le relais renvoie la réponse telle quelle. Chaque visiteur de la page Jeux reçoit la clé, et elle reste stockée dans son `localStorage` (j'ai trouvé 2 entrées `jv:` qui la contiennent). Les routes `/genres`, `/jeu/:id` et `/hasard` ne la renvoient pas.
- **Attendu** : la clé ne quitte jamais Cloudflare.
- **Correction** : (1) dans le relais, supprimer `next` et `previous` (ou remplacer par un simple booléen `suite`) avant de répondre ; (2) **régénérer la clé sur rawg.io** puis `wrangler secret put RAWG_KEY`, car l'ancienne est compromise ; (3) changer `PREFIXE_CACHE` dans `js/api/relais.js` pour vider les caches qui la contiennent.

### 🔴 2. XSS stockée dans Potes et Chat
- **Où** : `js/pages/potes.js` (`lien(item)`, `style="--couleur:${item.couleur}"` dans « Populaire », « Activité », « Recommandations ») et `js/pages/chat.js` (`href="${lien(m.item)}"`). Côté serveur : `supabase/schema.sql` (colonnes `jsonb` sans contrôle) et `worker/src/recommandations.js` (`id: item.id` non validé).
- **Reproduire** (déduit du code, pas exécuté pour ne pas toucher à ta base) : un membre du groupe, connecté, appelle directement Supabase avec la clé publique, par exemple `from('listes').upsert({ user_id: <moi>, items: [{ type: 'anime', id: '1" autofocus onfocus="alert(1)', titre: 'x', ajouteLe: '2026-10-23' }] })`. La règle RLS l'autorise, puisque c'est sa propre ligne. Quand un pote ouvre Potes, le lien de la section « Activité » devient `<a href="anime.html?id=1" autofocus onfocus="alert(1)">` et le script s'exécute. Même chose avec `couleur: '"><img src=x onerror=…>'`, avec un message du chat (`item.id`) ou avec une recommandation.
- **Impact** : le script tourne chez la victime. Il peut lire la session Supabase (dans `localStorage`) et le code perso, donc prendre le contrôle du compte, de la liste et des notifications.
- **Correction** : échapper **toutes** les valeurs insérées dans des attributs (`href`, `style`, `data-*`), y compris `item.id` et `item.couleur` ; valider `id` (entier ou `^\d+$`) et `couleur` (`^#[0-9a-f]{6}$`) à l'affichage, dans le relais (`/recommander`) et dans SQL (contraintes `check` sur les `jsonb` de `messages.item` et `recommandations.item`). Même correction préventive pour `accueil.js` (suivis) et `ma-liste.js`, qui affichent la liste locale (importable depuis un code perso donné par quelqu'un d'autre).

### 🟠 3. Relais sans limite de débit
- **Où** : `worker/src/index.js`.
- **Constat** : le CORS est correct (une origine inconnue reçoit `Access-Control-Allow-Origin: https://wazyrix.github.io`, donc les navigateurs bloquent). Mais le CORS ne protège pas d'un `curl` ou d'un script : n'importe qui peut appeler `/jeux?search=<texte aléatoire>` en boucle. Chaque recherche différente coûte une requête RAWG (quota de 20 000 par mois), et `/hasard` en coûte 2 sans aucun cache. Même chose pour `/tmdb/recherche`.
- **Attendu** : un quota par IP.
- **Correction** : limite par IP (Rate Limiting binding de Cloudflare, gratuit, ou compteur KV/Cache API), refuser les requêtes sans en-tête `Origin` autorisé sur les routes coûteuses, limiter la longueur de `search` (100 caractères) et mettre un `cacheTtl` court sur `/hasard`.

### 🟠 4. Quota d'écritures KV
- **Où** : `worker/src/comptes.js` (`ecrireListe`), `verification.js` (ligne 76).
- **Constat** : `PUT /liste/<n'importe quel code de 32 caractères hexa>` crée une liste sans authentification. La tâche horaire réécrit `etat:<code>` **chaque heure pour chaque liste non vide**, soit 24 écritures par jour et par liste. L'offre gratuite KV donne 1 000 écritures par jour : vers ~40 listes (vraies ou créées par un tiers), la synchro et la cloche tombent en panne. Autres limites : aucune route ne permet de supprimer une liste, et `KV.list()` est lu sans curseur, donc au-delà de 1 000 listes certaines sont ignorées.
- **Correction** : n'écrire `etat:` que s'il a changé, limiter les `PUT` par IP, paginer `list()` avec `cursor`, ajouter `DELETE /liste/:code`.

### 🟠 5. Workflow : pas de collecte planifiée observée
- **Reproduire** : `gh run list --event schedule` ne renvoie rien. Les 19 runs depuis 12 h 52 UTC sont tous des `push`, alors que le cron `17 * * * *` aurait dû se déclencher à 13 h 17, 14 h 17 et 15 h 17.
- **Constat** : GitHub retarde parfois les premiers crons d'un nouveau dépôt, mais 3 h sans rien, c'est suspect. Sans push de ta part, les actus et ADN ne se mettent pas à jour. Par ailleurs, le run 39959984352 a échoué à l'étape « Enregistrer les JSON » (deux runs rapprochés : probable conflit de rebase sur `data/*.json`), et dans ce cas le site n'est pas redéployé.
- **Vérifié** : sur les runs réussis, un flux mort (AnimeLand, timeout) ne fait pas planter le script ; il apparaît dans `erreurs`.
- **Correction** : revérifier demain ; si toujours rien, faire un commit sur le workflow (ça relance souvent le planificateur) ou ajouter un déclencheur externe. Pour les conflits : `git pull --rebase -X theirs` ou régénérer `data/` après le pull, et faire en sorte que l'échec du push n'empêche pas le déploiement.

### 🟠 6. Erreurs d'API mal affichées
- **Reproduire** (page Animés, `fetch` simulé) : AniList renvoie `{}` et la page affiche « Oups : Cannot read properties of undefined (reading 'Page') ». Si AniList ne répond jamais, les squelettes restent affichés indéfiniment. Les cas « réseau coupé » (« Impossible de joindre AniList ») et « erreur 500 » sont bien gérés.
- **Correction** : vérifier la forme de la réponse dans `anilist.js` / `relais.js` (« Réponse inattendue d'AniList ») et ajouter un timeout (`AbortSignal.timeout(15000)`) avec le message « AniList met trop de temps à répondre ».

### 🟠 7. Notifications perdues au-delà de 50 animés
- **Où** : `worker/src/verification.js` ligne 99 (`.slice(0, 50)`) et requête `airingSchedules(perPage: 50)` sans pagination.
- **Constat** : suivre un animé = suivre toute sa franchise (Attack on Titan = 6 identifiants). Avec ~10 franchises suivies, **tous utilisateurs confondus**, la limite est dépassée : des épisodes et des suites ne sont jamais notifiés, sans aucun message.
- **Correction** : découper en lots de 50 (dans le budget de requêtes) et paginer `airingSchedules`.

### 🟡 8. Fiche jeu : « Au hasard » bloqué
- **Reproduire** : sur `jeu.html?id=3498`, couper le relais puis cliquer « Au hasard ». **Testé** : `TypeError: Cannot set properties of null (setting 'disabled')`, le bouton reste désactivé et aucun message ne s'affiche.
- **Cause** : `e.currentTarget` vaut `null` après un `await` (`jeu.js`, lignes 200-205).
- **Correction** : garder une référence au bouton avant l'`await`, et afficher un message si `autre` est `null`.

### 🟡 9. « Recommander » : même bug
- **Où** : `js/ui/recommander.js`, ligne 107 (`e.currentTarget.disabled = false` dans le `catch`, après des `await`).
- **Constat** : après une erreur, le message s'affiche mais le bouton « Envoyer » reste désactivé, donc on ne peut pas réessayer. Si l'envoi échoue au 2ᵉ pote, le 1ᵉʳ a déjà reçu la reco, et un nouvel essai la lui renvoie.
- **Correction** : même correction ; marquer les potes déjà servis.

### 🟡 10. Flux Atom : mauvais lien
- **Où** : `scripts/collecte.py`, ligne 141.
- **Testé** : pour une entrée qui a `<link rel="replies">` puis `<link rel="alternate">`, le script garde le lien des commentaires. Un élément XML sans enfants vaut `False`, donc le `or` passe toujours au premier `<link>`. Python affiche aussi un `DeprecationWarning`.
- **Correction** : `lien = entree.find(...alternate...)`, puis `if lien is None: lien = entree.find(f"{ATOM}link")`.

### 🟡 11. Dates des sorties jeux en UTC
- **Où** : `js/api/jeux.js`, `jourIso()` (`toISOString`).
- **Constat** : entre minuit et 2 h (heure de Paris), « demain » est calculé comme aujourd'hui, donc la liste « À venir » inclut le jour en cours et « Récemment sortis » s'arrête la veille.
- **Correction** : formater en local, avec `Intl.DateTimeFormat('en-CA')` comme dans le relais.

### 🟡 12. Calendrier des sorties jeux incomplet
- **Constat** : `sortiesAVenir()` demande 40 jeux pour 180 jours puis filtre les peu connus : **31 jeux affichés pour 6 mois**. Ce n'est pas un vrai calendrier.
- **Correction** : charger plusieurs pages, ou une requête par mois.

### 🟡 13. Actus : source inconnue dans l'adresse
- **Reproduire** : `actus.html?cat=monde&source=xyz` affiche « Aucun article », alors que le menu Source indique « Toutes ».
- **Correction** : ignorer une source absente de `data.sources`.

### 🟡 14. Fiche animé introuvable
- **Reproduire** : `anime.html?id=99999999` affiche « Animé introuvable / Not Found. ».
- **Correction** : traduire le 404 d'AniList (« Cet animé n'existe pas »).

### 🟡 15. Abonnement push vers n'importe quelle URL
- **Où** : `comptes.js`, `abonner()` (vérifie seulement `https://`).
- **Constat** : avec son propre code, n'importe qui peut faire envoyer au relais des POST vers une URL de son choix, à chaque notification.
- **Correction** : liste blanche des services push (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`).

### 🟡 16. Recommandations sans limite
- **Où** : `worker/src/recommandations.js`.
- **Constat** : contrairement au chat (une notification par personne toutes les 10 min), chaque reco déclenche une notification push.
- **Correction** : limite par expéditeur et par destinataire (par exemple 10 par heure).

### 🟡 17. RLS des recommandations trop large
- **Où** : `supabase/schema.sql`, politique `reco_marquer_vue`.
- **Constat** : le destinataire peut modifier toutes les colonnes (`de`, `item`, `message`), pas seulement `vue`.
- **Correction** : `revoke update on recommandations from authenticated; grant update (vue) on recommandations to authenticated;`

### 🟡 18. Limiteur AniList
- **Constat** : l'historique des requêtes est en mémoire et repart de zéro à chaque changement de page, donc la limite de 25 par minute peut être dépassée en naviguant vite. Sur un 429, on attend 30 s (×2) avec des squelettes et aucune explication.
- **Correction** : garder l'historique dans `sessionStorage` ; afficher « AniList est saturé, nouvel essai dans 30 s ».

### 🟡 19. Liste non enregistrée si le stockage est plein
- **Où** : `js/lib/ma-liste.js`, `ecrireLocal()`.
- **Constat** : le cache AniList/RAWG remplit `localStorage` (~330 Ko après une seule page). Si le quota (5 Mo sur Chrome/Brave) est atteint, `setItem` lève une exception et le clic sur « Suivre » ne fait rien. Non reproduit ici, car le navigateur intégré a un quota bien plus grand.
- **Correction** : en cas d'erreur, vider les caches `al:` et `jv:` puis réessayer.

### 🟡 20. Images trop lourdes
- **Mesuré** : une affiche `extraLarge` pèse ~234 Ko en moyenne (20 affiches = 4,7 Mo), contre ~80 Ko en `large`. `carteAffiche` utilise `extraLarge` pour des vignettes de ~180 px.
- **Correction** : `large` pour les cartes, `extraLarge` seulement sur la fiche.

### 🟡 21. Pas d'image de secours
- **Constat** : si une affiche AniList ou RAWG ne charge pas, le navigateur montre une image cassée (seules les cartes de jeux sans image ont un fond vide).
- **Correction** : `onerror` qui retire l'image et laisse la couleur de fond (`--couleur`) avec le titre.

### 🟡 22. Attributions
- **Constat** : TMDB est cité dans le pied de page de Ma liste, mais **sans logo** (exigé par les conditions de TMDB). L'accueil affiche des jeux RAWG sans lien vers RAWG (exigé sur chaque page qui utilise ses données). Le lien est présent sur `jeux.html` et `jeu.html`.

### 🟡 23. Contraste
- `--texte-3` est utilisé pour les petits textes (`.mention`) : ratio de 3,7:1. Passer à environ `#8a8a96`.

### 🟡 24. Dépendances du relais
- `npm audit` dans `worker/` : esbuild, miniflare, sharp, undici, ws (5 hautes, 2 modérées), toutes amenées par **wrangler 3**. Ce sont des outils de développement (rien n'est déployé avec), donc le risque concerne ton PC. Correction : passer à wrangler 4.

### 💡 25 à 30. Améliorations
- **25. Recherche du haut** : il faut 3 caractères minimum, donc « 進撃 » ou « K-On » est impossible en recherche rapide. Aucune limite de longueur : 500 caractères sont envoyés tels quels à AniList.
- **26. Chat** : `ecouterMessages` écoute les `DELETE` de toute la table `messages` sans filtre de groupe (sans gravité, l'identifiant seul est reçu).
- **27. Workflow** : avertissements « Node.js 20 is deprecated » (configure-pages, deploy-pages) et migration d'`ubuntu-latest` vers Ubuntu 26.
- **28. Code** : `historique()` dans `js/lib/notifications.js` n'est jamais utilisée ; `lien(item)` est copiée dans `chat.js`, `potes.js` et `ma-liste.js` ; le test `SUPABASE_URL.includes('A-REMPLACER')` est répété 4 fois (`nav.js`, `recommander.js`, `compte.js`…).
- **29. Docs** : le README ne mentionne ni `ma-liste.html`, ni `potes.html`, ni `chat.html`, ni `supabase/`, et la V3 n'est pas cochée alors que comptes, potes et chat existent. `worker/README.md` ne liste que 4 routes et affirme que « seuls les sites listés dans ORIGINES peuvent utiliser le relais », ce qui est faux hors navigateur (voir #3).
- **30. Pages** : `upload-pages-artifact` publie tout le dossier (`worker/`, `supabase/`, `scripts/`, `README.md`). Le dépôt est public, donc pas de fuite, mais c'est inutile. On peut publier un dossier filtré.

---

## 4. Fonctionnalités prévues : absentes ou incomplètes

| Fonctionnalité (AUDIT.md / README) | État |
|---|---|
| Films/séries : **fiche** | ❌ Absente : un film ou une série renvoie vers themoviedb.org |
| Films/séries : **recherche** | ⚠️ Seulement dans « Ma liste » (pour ajouter), pas de page dédiée |
| Films/séries : **hasard avec filtres** | ❌ Absent |
| Films/séries : **calendrier des sorties** | ❌ Absent sur le site (seule la notification « sort demain » existe dans le relais) |
| Jeux : **calendrier des sorties** | ⚠️ Partiel (~30 jeux sur 6 mois, voir #12) |
| Notifications push | ⚠️ Code complet et dédoublonné (`etat.vus` sur 30 jours), mais réception réelle non testée ; limites #7 et #16 |
| Collecte horaire des actus | ⚠️ Script OK, mais déclenchement planifié non observé (#5) |
| `BRIEF.md` | ❌ Absent du dépôt |

**Vérifié et fonctionnel** : calendrier des animés (hier → +5 jours, fuseau Europe/Paris, heures TV Japon + ADN), fiche animé (saisons, suites et préquelles, avis, « Où le regarder »), suivi par franchise (sans doublon, persistant après rechargement, synchronisé avec le relais), statuts À voir / En cours / Vu, Explorer animés et jeux (genres, filtres, tri, URL partageable, « Propose-moi »), fiche jeu (avis, config PC, boutiques, captures, série), listes de jeux, pages d'actus (recherche, thèmes, sources, zones, « Charger plus »), cloche, PWA et service worker (actif en ligne), aucun lien `target="_blank"` sans `rel="noopener"`, aucun secret dans l'historique git (seules les valeurs publiques : clé `sb_publishable`, clé VAPID publique, identifiant KV).

---

*Ordre de correction proposé : #1 (avec régénération de la clé RAWG), #2, puis #3 à #7, puis les 🟡. Un commit par correction, avec un nouveau test à chaque fois.*

---

## 5. Corrections appliquées

*Bilan au 23 octobre 2026, après le commit `112d04f`. Un commit par correction, retest à chaque fois.*

**En bref : 2/2 🔴 et 5/5 🟠 corrigés, 3/17 🟡 corrigés, 1/6 💡 en partie. Les 🟡 restants n'ont aucun impact sur la sécurité.**

### 🔴 Critiques : tous corrigés

| # | Correction | Commit | Testé |
|---|---|---|---|
| 1 | Le relais retire la clé RAWG de toutes les URL renvoyées (`sansCle()`, `worker/src/jeux.js`). Le cache du navigateur change de préfixe (`jv:` → `jv2:`), donc les anciennes réponses qui contenaient la clé sont effacées. | `add5973` | `curl /jeux` : `next` ne contient plus `key=`. Vérifié de nouveau en ligne : `/genres` renvoie `"next":null`. |
| 1 bis | **À faire par toi** : régénérer la clé sur rawg.io puis `npx wrangler secret put RAWG_KEY`, car l'ancienne a été exposée. | — | Je ne peux pas le vérifier. |
| 2 | Potes, Chat, Recommander et la cloche affichent les données de la base avec `el()` (nœuds texte + `setAttribute`), plus jamais avec `innerHTML`. Les identifiants (entier ou UUID), les couleurs (`#RRGGBB`) et les images (`https://`) sont validés. Le relais refuse les éléments mal formés (`/liste`, `/recommander`). `supabase/securite.sql` ajoute des contraintes `check` sur les `jsonb` (`item_valide`, `liste_valide`). | `1c1ff6d`, `d5b4e6a` | Contenus piégés (`"><img onerror>`, `autofocus onfocus`) injectés en local : affichés comme du texte. `securite.sql` testé sur PostgreSQL 16 (PGlite), avec une base piégée et une base propre. |

### 🟠 Importants : tous corrigés

| # | Correction | Commit |
|---|---|---|
| 3 | Limite de débit par IP avec un Durable Object (bloc /64 en IPv6) : 40 requêtes/min sur RAWG/TMDB, 20/min en écriture, 60/min pour le reste. Au-delà : 429 avec `Retry-After`. Toute origine autre que le site (ou une requête sans `Origin`) reçoit une 403. Recherches limitées à 100 caractères. | `f412018` |
| 4 | KV : on n'écrit que si la valeur a changé. L'état de la vérification horaire passe de 24 à ~4 écritures par jour et par liste. `KV.list()` suit le curseur (plus de limite à 1 000 listes). *Pas fait : la route `DELETE /liste/:code`.* | `1e9d071` |
| 5 | Workflow : `git pull --rebase -X theirs` avec 3 essais, et un push raté n'empêche plus la publication. Le planning a été réenregistré : un run `schedule` a bien eu lieu à 17 h 53 UTC. **Ensuite (point 2 de cette série) : le cron du relais Cloudflare lance le workflow toutes les heures (`workflow_dispatch`). Le `schedule` de GitHub reste en secours, toutes les 6 h.** | `d48ce70`, `112d04f` |
| 6 | `appeler()` coupe un appel au bout de 15 s (20 s pour le relais). `messageStatut()` traduit les codes HTTP. Une réponse vide ou incomplète donne un message clair. | `2236325` |
| 7 | La vérification horaire découpe les œuvres suivies en lots de 50 et pagine les épisodes (testé avec 150 puis 2 000 œuvres simulées : aucun doublon, tout est couvert en 2 passages). | `8cb392d` |

### 🟡 Mineurs

| # | État | Détail |
|---|---|---|
| 9 | ✅ Corrigé (`1c1ff6d`) | Le bouton « Envoyer » de Recommander se débloque après une erreur, et un nouvel essai ne renvoie pas la reco aux potes déjà servis. |
| 14 | ✅ Corrigé (`2236325`) | « Not Found. » d'AniList est traduit. |
| 17 | ✅ Corrigé (`1c1ff6d`, `d5b4e6a`) | Le destinataire d'une reco ne peut modifier que la colonne `vue` (`grant update (vue)`). |
| 24 | ✅ Corrigé (`f412018`, `2ee3b7f`) | wrangler 4.152.0 (Node 22) : `npm audit` ne signale plus aucune vulnérabilité. |
| 8 | ⏳ Restant | « Au hasard » sur la fiche jeu : `e.currentTarget` est toujours lu après un `await` (`jeu.js`). |
| 10 | ⏳ Restant | Lien Atom : le `or` sur un élément XML est toujours là (`collecte.py`, ligne 141). |
| 11 | ⏳ Restant | `jourIso()` utilise toujours `toISOString` (UTC) dans `js/api/jeux.js`. |
| 12 | ⏳ Restant | Calendrier des sorties jeux limité à ~30 jeux. |
| 13 | ⏳ Restant | `?source=` inconnue dans l'adresse de la page Actus. |
| 15 | ⏳ Restant | Pas de liste blanche des services push. |
| 16 | ⏳ Restant | Pas de limite propre aux recommandations. La limite générale (20 écritures/min par IP) s'applique quand même. |
| 18 | ⏳ Restant | Historique du limiteur AniList toujours en mémoire, sans message pendant l'attente d'un 429. |
| 19 | ⏳ Restant | `ecrireLocal()` sans `try/catch` (stockage plein). |
| 20 | ⏳ Restant | Les cartes animés utilisent toujours `extraLarge`. |
| 21 | ⏳ Restant | Pas d'image de secours. |
| 22 | ⏳ En partie | Le logo TMDB arrive avec les fiches films/séries (point 7 de cette série). Le lien RAWG sur l'accueil manque encore. |
| 23 | ⏳ Restant | `--texte-3` reste à `#6b6b76` (contraste 3,7:1). |

### 💡 Améliorations

| # | État |
|---|---|
| 28 | En partie : `lienElement()` remplace les 3 copies de `lien()`. Il reste `historique()`, qui n'est pas utilisée, et le test `A-REMPLACER`, répété 6 fois. |
| 25, 26, 27, 29, 30 | Pas encore faits. Les README ont été mis à jour au fil des commits (relais, sécurité, Node 22), mais pas encore en entier (#29). |

### Fonctionnalités manquantes (section 4)

- Films/séries : fiche, tirage au hasard, calendrier des sorties → point 7 de cette série.
- Le reste est inchangé.

### Ce qui reste à vérifier par toi

- Régénérer la clé RAWG (#1 bis).
- Mettre le jeton GitHub dans le relais (`npx wrangler secret put GITHUB_TOKEN`, puis `npx wrangler deploy`). Le message `{"lance":true}` doit ensuite apparaître dans `npx wrangler tail` à la 5ᵉ minute de chaque heure.
