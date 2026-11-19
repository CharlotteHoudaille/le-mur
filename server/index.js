import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TtlCache } from "./cache.js";
import { fetchRecentTracks, fetchCover, COVER_FILE_RE, LastfmError } from "./lastfm.js";
import { demoTracks, demoCoverSvg } from "./demo.js";
import { addMissingCovers, fetchDeezerCover, DEEZER_MD5_RE } from "./deezer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.LASTFM_API_KEY || "";
const DEFAULT_USER = process.env.LASTFM_USER || "";
// Prénom affiché sur le mur de l'utilisateur par défaut (sinon : son pseudo)
const DISPLAY_NAME = process.env.DISPLAY_NAME || "";
const TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 60;
const DEMO_MODE = process.env.DEMO_MODE === "true" || !API_KEY;

const cache = new TtlCache(TTL_SECONDS * 1000);
const app = express();

// Noms d'utilisateur Last.fm : lettres, chiffres, _ et -, 2 à 15 caractères
const USER_RE = /^[a-zA-Z][a-zA-Z0-9_-]{1,14}$/;

app.get("/api/tracks", async (req, res) => {
  const user = String(req.query.user || DEFAULT_USER).trim();

  if (DEMO_MODE) {
    return res.json({ ...demoTracks(), source: "demo", cachedAt: Date.now() });
  }
  if (!USER_RE.test(user)) {
    return res.status(400).json({ error: "Nom d'utilisateur Last.fm invalide", code: "bad_user" });
  }

  const key = user.toLowerCase();
  const displayName = DISPLAY_NAME && key === DEFAULT_USER.toLowerCase() ? DISPLAY_NAME : null;
  try {
    const { value, status, storedAt } = await cache.getOrLoad(key, () =>
      fetchRecentTracks(user, API_KEY).then(addMissingCovers), // + pochettes Deezer si manquantes
    );
    res.set("X-Cache", status);
    res.json({ ...value, displayName, source: "lastfm", cachedAt: storedAt });
  } catch (err) {
    const e = err instanceof LastfmError ? err : new LastfmError("Erreur inattendue", { status: 500 });
    console.error(`[lastfm] échec : ${e.message}`);

    // Repli : anciennes données si on en a
    const stale = cache.getStale(key);
    if (stale && e.code !== "user_not_found") {
      res.set("X-Cache", "STALE");
      return res.json({ ...stale.value, displayName, source: "lastfm", cachedAt: stale.storedAt, stale: true, warning: e.message });
    }
    res.status(e.status).json({ error: e.message, code: e.code });
  }
});

// Pochettes : une image ne change jamais, on la garde 24 h (max 500 en mémoire)
const coverCache = new TtlCache(24 * 3600 * 1000);
const MAX_COVERS = 500;

async function sendCover(res, key, loader) {
  try {
    const { value } = await coverCache.getOrLoad(key, loader);
    if (coverCache.entries.size > MAX_COVERS) {
      coverCache.entries.delete(coverCache.entries.keys().next().value);
    }
    res.set("Content-Type", value.type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(value.data);
  } catch {
    res.status(404).end();
  }
}

// Pochette Last.fm (nom de fichier vérifié : on ne peut pas faire appeler une autre adresse)
app.get("/api/cover/:file", (req, res) => {
  const { file } = req.params;
  if (!COVER_FILE_RE.test(file)) return res.status(400).end();
  sendCover(res, `lastfm:${file}`, () => fetchCover(file));
});

// Pochette Deezer (identifiant md5 vérifié)
app.get("/api/deezer-cover/:md5.jpg", (req, res) => {
  const { md5 } = req.params;
  if (!DEEZER_MD5_RE.test(md5)) return res.status(400).end();
  sendCover(res, `deezer:${md5}`, () => fetchDeezerCover(md5));
});

app.get("/api/demo-cover/:index.svg", (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index > 50) return res.status(400).end();
  res.type("image/svg+xml").set("Cache-Control", "public, max-age=86400").send(demoCoverSvg(index));
});

app.get("/api/health", (_req, res) => res.json({ ok: true, demo: DEMO_MODE }));

// three.js est servi par NOTRE serveur (pas de CDN) : le navigateur ne parle qu'à nous
const THREE_DIR = path.join(__dirname, "..", "node_modules", "three");
app.use("/vendor/three", express.static(path.join(THREE_DIR, "build"), { maxAge: "7d" }));
app.use("/vendor/three-addons", express.static(path.join(THREE_DIR, "examples", "jsm"), { maxAge: "7d" }));

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Le mur sur http://localhost:${PORT}`);
  console.log(DEMO_MODE ? "Mode DÉMO (pas d'appel Last.fm)" : `Cache : ${TTL_SECONDS}s, utilisateur par défaut : ${DEFAULT_USER || "(aucun)"}`);
});
