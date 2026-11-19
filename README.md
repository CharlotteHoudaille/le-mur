# Le mur de Charlotte

Mes écoutes récentes [Last.fm](https://www.last.fm) affichées en vrac sur le mur de ma chambre, en 3D (three.js) : des dizaines d'affiches collées les unes sur les autres au-dessus de mon lit, et le soleil qui entre par la fenêtre.

- **1 affiche = 1 album** écouté récemment (40 au maximum). Trois styles : la pochette imprimée, une affiche de concert (pochette + nom géant + date de la dernière écoute), ou une affiche typographique s'il n'y a pas de pochette.
- **Les plus récentes** sont près du centre et collées **par-dessus** les autres.
- **Taille** : plus un album est écouté, plus son affiche est grande.
- **L'affiche jaune** résume les chiffres : écoutes, albums, artistes, et l'album en tête d'affiche.
- **La platine** sur le petit meuble joue le dernier album : sa pochette est sur l'étiquette du disque, qui tourne à 33 tours si l'écoute date de moins de 15 minutes.
- **Lumière** : le soleil (une SpotLight avec un gobo : la fenêtre et l'ombre d'une plante) éclaire le mur et les affiches ; chaque affiche porte une ombre douce.
- Survoler une affiche la décolle du mur ; un clic ouvre la liste de toutes ses écoutes.
- Le champ en haut à droite permet de voir le mur de n'importe quel pseudo Last.fm public.

## Lancer l'application

Prérequis : Docker.

```bash
git clone <url-du-depot>
cd <dossier-du-depot>
cp .env.example .env    # puis remplir LASTFM_API_KEY et LASTFM_USER
docker compose up
```

Puis ouvrir <http://localhost:3000>.

Sans fichier `.env` (ou sans clé), l'application démarre quand même en **mode démo**, avec des écoutes et des pochettes d'exemple.

### Variables d'environnement (`.env`)

| Variable | Rôle |
| --- | --- |
| `LASTFM_API_KEY` | Clé API Last.fm ([créer une clé](https://www.last.fm/api/account/create)). **Jamais commitée.** |
| `LASTFM_USER` | Pseudo Last.fm affiché par défaut |
| `DISPLAY_NAME` | Prénom affiché dans le titre pour `LASTFM_USER` (optionnel) |
| `CACHE_TTL_SECONDS` | Durée du cache serveur, 60 s par défaut |
| `DEMO_MODE` | `true` pour forcer les données d'exemple |
| `PORT` | Port du serveur, 3000 par défaut |

### En ligne (serveur avec un nom de domaine)

Le site tourne sur <https://student13.wt.thomasjuldo.com>. Sur le serveur :

```bash
git clone https://github.com/CharlotteHoudaille/le-mur.git && cd le-mur
# créer .env (LASTFM_API_KEY, LASTFM_USER...) ; SITE_DOMAIN=mon.domaine si autre domaine
docker compose -f docker-compose.yml -f compose.server.yaml up -d --build
```

[compose.server.yaml](compose.server.yaml) ajoute **Caddy** devant l'application : il obtient le certificat HTTPS tout seul et renvoie vers le serveur Node, qui n'est plus exposé directement ([Caddyfile](Caddyfile)).

### Sans Docker

```bash
npm install
npm run dev     # lit .env automatiquement (Node 20+)
```

## Comment ça marche

```
navigateur  ──►  serveur Node/Express  ──►  Last.fm   user.getRecentTracks + pochettes
  (page)          /api/tracks           └─►  Deezer    pochettes manquantes (API publique)
                  /api/cover/<fichier>
                  /api/deezer-cover/<md5>.jpg
```

- **Le navigateur ne parle qu'au serveur.** Même les pochettes passent par `/api/cover/...` : dans l'onglet Network, aucune requête ne va vers Last.fm.
- **La clé reste sur le serveur**, lue dans `process.env` ([server/lastfm.js](server/lastfm.js)). Elle n'est jamais envoyée au navigateur, ni dans l'image Docker (`.env` est exclu par `.gitignore` et `.dockerignore`).
- **Cache** ([server/cache.js](server/cache.js)) : les réponses Last.fm sont gardées 60 s en mémoire. Recharger la page deux fois = un seul appel à Last.fm (en-tête `X-Cache: MISS` puis `HIT`, et une ligne `[lastfm] appel` dans les logs). Si deux visiteurs arrivent en même temps, ils partagent le même appel en cours.
- **Si Last.fm tombe** : le serveur renvoie la dernière réponse connue (bandeau rouge « Last.fm ne répond pas »). S'il n'a rien en cache, la page affiche « Mur fermé pour travaux » avec un bouton Réessayer, jamais un écran vide.
- **Pochettes manquantes** ([server/deezer.js](server/deezer.js)) : quand Last.fm n'a pas l'image d'un album, le serveur la cherche dans l'API publique de Deezer (artiste + album, puis artiste + titre). Les recherches sont gardées 24 h ; si Deezer ne répond pas, l'affiche devient simplement typographique.
- **Pochettes** : le serveur reconstruit lui-même l'URL de l'image à partir d'un nom de fichier vérifié (32 caractères hexadécimaux), il ne peut donc pas être utilisé pour appeler une autre adresse. Les images sont gardées 24 h.
- **Une seule page** : la scène 3D remplit l'écran ; la caméra est cadrée pour que le haut du lit soit toujours en bas de l'écran, et la zone d'affiches s'adapte (plus haute sur téléphone).
- **three.js est servi par notre serveur** (`/vendor/three/...`, depuis `node_modules`), pas par un CDN : le navigateur ne parle qu'à notre serveur.

## Structure

```
server/
  index.js    routes Express (/api/tracks, /api/cover, fichiers statiques)
  lastfm.js   appel à Last.fm + nettoyage des données + pochettes
  deezer.js   pochettes manquantes via l'API publique Deezer
  cache.js    cache mémoire avec durée de vie
  demo.js     données et pochettes d'exemple
public/
  index.html  structure de la page (canvas 3D + interface)
  style.css   interface, grain, fiche détaillée
  app.js      chargement des données, regroupement par album, fiche détaillée
  posters.js  dessin des affiches sur des <canvas> (textures)
  scene.js    la chambre en three.js : mur, lumières, lit, affiches, survol
```

## Tester les cas demandés

- **Cache** : `curl -i localhost:3000/api/tracks` deux fois → `X-Cache: MISS` puis `X-Cache: HIT`, et `docker compose logs` ne montre qu'un appel.
- **Last.fm injoignable** : lancer le serveur avec `LASTFM_API_URL=http://127.0.0.1:9/` → la page affiche un message au lieu d'un écran blanc.

## Crédits

Modèles 3D de [Poly Haven](https://polyhaven.com), sous licence **CC0** (domaine public), dans `public/models/` :
[Throw Pillows 01](https://polyhaven.com/a/throw_pillows_01) (coussins),
[Side Table 01](https://polyhaven.com/a/side_table_01) (petit meuble),
[Potted Plant 02](https://polyhaven.com/a/potted_plant_02) (plante).
La tête de lit, les oreillers, la platine, le mur et les affiches sont construits dans le code (three.js).
