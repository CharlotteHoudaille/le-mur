// Pochettes manquantes : Last.fm n'a pas toujours l'image d'un album récent.
// On la cherche alors dans l'API publique de Deezer (pas de clé nécessaire).
// Comme pour Last.fm, seul le serveur appelle Deezer : le navigateur reçoit
// une adresse de notre serveur (/api/deezer-cover/<md5>.jpg).

const API_URL = process.env.DEEZER_API_URL || "https://api.deezer.com";
const TIMEOUT_MS = 3500;
const LOOKUP_TTL_MS = 24 * 3600 * 1000;
export const DEEZER_MD5_RE = /^[a-f0-9]{32}$/;

// Résultats de recherche gardés 24 h (y compris « rien trouvé »)
const lookups = new Map(); // clé -> { md5, at }

// « Aya Nakamura, La Rvfleuze » -> « Aya Nakamura »
function mainArtist(artist) {
  return artist.split(/\s*(?:,|&| feat\.?| ft\.?| x | with )\s*/i)[0].trim();
}

const clean = (s) => String(s).replace(/["\\]/g, "").trim();
const md5Of = (x) => (DEEZER_MD5_RE.test(x ?? "") ? x : null);

async function search(path, q) {
  const url = new URL(API_URL + path);
  url.search = new URLSearchParams({ q, limit: "3" });
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`Deezer : ${body.error.message ?? "erreur"}`);
  return body.data ?? [];
}

async function lookup({ artist, album, name }) {
  const who = clean(mainArtist(artist));
  const sameArtist = (a) => a?.name?.toLowerCase() === who.toLowerCase();

  if (album) {
    // 1. recherche exacte artiste + album
    let data = await search("/search/album", `artist:"${who}" album:"${clean(album)}"`);
    let hit = data.find((d) => sameArtist(d.artist)) ?? data[0];
    if (md5Of(hit?.md5_image)) return hit.md5_image;
    // 2. recherche libre (titres avec « : », « (Deluxe) »...)
    data = await search("/search/album", `${who} ${clean(album)}`);
    hit = data.find((d) => sameArtist(d.artist));
    if (md5Of(hit?.md5_image)) return hit.md5_image;
  }
  // 3. par le titre du morceau : la pochette de son album
  const data = await search("/search", `artist:"${who}" track:"${clean(name)}"`);
  const hit = data.find((d) => sameArtist(d.artist)) ?? data[0];
  return md5Of(hit?.album?.md5_image);
}

export async function findCover(track) {
  const key = `${track.artist}\u0000${track.album || ""}\u0000${track.album ? "" : track.name}`.toLowerCase();
  const known = lookups.get(key);
  if (known && Date.now() - known.at < LOOKUP_TTL_MS) return known.md5;

  try {
    const md5 = await lookup(track);
    lookups.set(key, { md5, at: Date.now() });
    console.log(`[deezer] pochette ${md5 ? "trouvée" : "introuvable"} pour ${track.artist} — ${track.album || track.name}`);
    return md5;
  } catch (err) {
    // Deezer en panne : pas grave, l'affiche sera typographique. On ne mémorise pas l'échec.
    console.error(`[deezer] échec : ${err.message}`);
    return null;
  }
}

// Complète les pochettes manquantes d'une réponse Last.fm déjà nettoyée.
export async function addMissingCovers(result) {
  const groups = new Map(); // un album = une recherche
  for (const t of result.tracks) {
    if (t.image) continue;
    const key = `${t.artist}\u0000${t.album || t.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const jobs = [...groups.values()].slice(0, 30);

  // 6 recherches à la fois maximum, pour rester poli avec Deezer
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(jobs.slice(i, i + 6).map(async (tracks) => {
      const md5 = await findCover(tracks[0]);
      if (md5) for (const t of tracks) t.image = `/api/deezer-cover/${md5}.jpg`;
    }));
  }
  return result;
}

export async function fetchDeezerCover(md5) {
  const res = await fetch(`https://cdn-images.dzcdn.net/images/cover/${md5}/500x500-000000-80-0-0.jpg`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error("Pochette Deezer introuvable");
  return {
    type: res.headers.get("content-type") || "image/jpeg",
    data: Buffer.from(await res.arrayBuffer()),
  };
}
