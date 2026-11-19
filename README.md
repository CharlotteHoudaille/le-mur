# Le mur de Charlotte

Mes écoutes récentes [Last.fm](https://www.last.fm) encadrées au-dessus du lit de ma chambre : un mur vert sauge, une galerie de pochettes, mon prénom en néon, une platine vinyle et le soleil qui entre par la fenêtre.

- **1 cadre = 1 album** écouté récemment, avec la date de la dernière écoute sous la pochette.
- **Les plus récents en premier** (en haut à gauche). La platine joue le dernier album, et sa pochette est posée au sol.
- **Pastille `×N`** : nombre d'écoutes de l'album.
- **Couleur** : la couleur dominante de la pochette (fiche détaillée, étiquette du vinyle).
- **Sticker « EN ÉCOUTE »** sur le morceau en cours.
- Un clic sur un cadre ouvre la liste de toutes ses écoutes.
- Le champ en haut permet de voir le mur de n'importe quel pseudo Last.fm public.

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
- **Une seule page** : toute la chambre est une scène dessinée à taille fixe (1600×900, ou 900×1700 sur téléphone) puis mise à l'échelle pour tenir dans l'écran. Les 12 albums les plus récents sont encadrés (6 sur téléphone), la grille de cadres est calculée pour remplir la place disponible.

## Structure

```
server/
  index.js    routes Express (/api/tracks, /api/cover, fichiers statiques)
  lastfm.js   appel à Last.fm + nettoyage des données + pochettes
  deezer.js   pochettes manquantes via l'API publique Deezer
  cache.js    cache mémoire avec durée de vie
  demo.js     données et pochettes d'exemple
public/
  index.html  structure de la page + le lit et la fenêtre (SVG)
  style.css   le mur, les affiches, la lumière, le néon, le sol
  app.js      chargement des données, création et disposition des affiches
```

## Tester les cas demandés

- **Cache** : `curl -i localhost:3000/api/tracks` deux fois → `X-Cache: MISS` puis `X-Cache: HIT`, et `docker compose logs` ne montre qu'un appel.
- **Last.fm injoignable** : lancer le serveur avec `LASTFM_API_URL=http://127.0.0.1:9/` → la page affiche un message au lieu d'un écran blanc.
