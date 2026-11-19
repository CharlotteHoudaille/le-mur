// Seul fichier qui parle à Last.fm. La clé vient de l'environnement
// et n'est jamais renvoyée au navigateur.

// LASTFM_API_URL ne sert qu'aux tests (simuler un Last.fm injoignable)
const API_URL = process.env.LASTFM_API_URL || "https://ws.audioscrobbler.com/2.0/";
const TIMEOUT_MS = 6000;

export class LastfmError extends Error {
  constructor(message, { status = 502, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function fetchRecentTracks(user, apiKey, limit = 200) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    method: "user.getrecenttracks",
    user,
    api_key: apiKey,
    format: "json",
    limit: String(limit),
  });

  console.log(`[lastfm] appel user.getRecentTracks pour "${user}"`);

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new LastfmError("Last.fm ne répond pas", { status: 503, code: "unreachable" });
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new LastfmError("Réponse illisible de Last.fm", { status: 502, code: "bad_response" });
  }

  // Last.fm renvoie parfois une erreur dans le JSON (ex. 6 = utilisateur inconnu)
  if (body.error) {
    if (body.error === 6) {
      throw new LastfmError(`Utilisateur Last.fm « ${user} » introuvable`, { status: 404, code: "user_not_found" });
    }
    if (body.error === 10 || body.error === 26) {
      throw new LastfmError("Clé API Last.fm invalide", { status: 500, code: "bad_key" });
    }
    throw new LastfmError(`Erreur Last.fm : ${body.message}`, { status: 502, code: "lastfm_error" });
  }
  if (!response.ok) {
    throw new LastfmError(`Last.fm a répondu ${response.status}`, { status: 502, code: "lastfm_error" });
  }

  return normalize(body);
}

// On ne garde que ce dont la page a besoin, dans une forme simple.
export function normalize(body) {
  const raw = body?.recenttracks?.track ?? [];
  const list = Array.isArray(raw) ? raw : [raw];

  const tracks = list.map((t) => {
    const nowPlaying = t["@attr"]?.nowplaying === "true";
    const images = t.image ?? [];
    const image = coverPath((images.find((i) => i.size === "extralarge") ?? images.at(-1))?.["#text"]);
    return {
      name: t.name,
      artist: t.artist?.["#text"] ?? t.artist?.name ?? "Inconnu",
      album: t.album?.["#text"] || null,
      image,
      url: t.url,
      playedAt: nowPlaying ? Date.now() : Number(t.date?.uts ?? 0) * 1000,
      nowPlaying,
    };
  });

  return {
    user: body?.recenttracks?.["@attr"]?.user ?? null,
    tracks,
  };
}

// ---------- Pochettes ----------
// Le navigateur ne charge jamais une image chez Last.fm : on lui donne
// une adresse de NOTRE serveur (/api/cover/<fichier>), qui va la chercher.

export const COVER_FILE_RE = /^[a-f0-9]{32}\.(png|jpe?g|gif|webp)$/i;
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f"; // étoile grise "pas de pochette"

function coverPath(url) {
  if (!url) return null;
  const file = url.split("/").pop();
  if (!COVER_FILE_RE.test(file) || file.startsWith(PLACEHOLDER)) return null;
  return `/api/cover/${file}`;
}

export async function fetchCover(file) {
  // On reconstruit l'URL nous-mêmes : impossible de faire appeler
  // une autre adresse à notre serveur.
  const response = await fetch(`https://lastfm.freetls.fastly.net/i/u/300x300/${file}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new LastfmError("Pochette introuvable", { status: 404 });
  return {
    type: response.headers.get("content-type") || "image/jpeg",
    data: Buffer.from(await response.arrayBuffer()),
  };
}
