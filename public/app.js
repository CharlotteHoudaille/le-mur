// Le mur de Charlotte — mes écoutes récentes encadrées au-dessus de mon lit.
//
//  - un cadre = un album (ou un morceau seul s'il n'a pas d'album)
//  - les plus récents en premier (en haut à gauche), 12 au maximum
//  - la date sous la pochette = dernière écoute
//  - la platine joue le dernier morceau, sa pochette est posée au sol
//
// Toute la pièce est une « scène » dessinée à taille fixe (1600×900 sur un écran
// large, 900×1700 sur un téléphone), puis mise à l'échelle pour tenir dans
// l'écran : pas de défilement, tout est visible d'un coup.
//
// Le navigateur ne parle qu'à notre serveur (/api/...), jamais à Last.fm ni à Deezer.

const $ = (sel) => document.querySelector(sel);
const stage = $("#stage");
const gallery = $("#gallery");
const dialog = $("#detail");

const REFRESH_MS = 60_000; // = durée du cache serveur
const FRAME_RATIO = 1.27; // hauteur / largeur d'un cadre (pochette + étiquette)
const PALETTE = ["#b4572f", "#2f5d73", "#c9a34a", "#5d7a55", "#8a4f7d", "#d0743c", "#3e4a7a"];
const FRAMES = ["black", "oak", "white", "black", "oak"];

// Disposition de la pièce, en pixels « de scène »
const LAYOUTS = {
  landscape: {
    W: 1600, H: 900, floorY: 742, plinth: 18,
    sign: { x: 800, y: 20, size: 58 },
    postit: { x: 1358, y: 160, w: 205 },
    gallery: { x: 290, y: 122, w: 1020, h: 318, gap: 26, max: 12 },
    bed: { x: 180, w: 1240 },
    sun: { x: 1010, y: 40, w: 620 },
  },
  portrait: {
    W: 900, H: 1700, floorY: 1330, plinth: 20,
    sign: { x: 450, y: 70, size: 72 },
    postit: { x: 36, y: 228, w: 230 },
    gallery: { x: 40, y: 420, w: 820, h: 660, gap: 30, max: 6 },
    bed: { x: -40, w: 980 },
    sun: { x: 300, y: 380, w: 640 },
  },
};

const state = {
  data: null,
  albums: [], // tous les albums, du plus récent au plus ancien
  shown: [], // ceux qui sont au mur
  elements: new Map(), // clé -> <button class="frame">
  colors: new Map(), // image -> [r, g, b]
  signature: "",
  layout: null,
};

// ---------- Utilitaires ----------

function hash(str) {
  let h = 2166136261;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const pad2 = (n) => String(n).padStart(2, "0");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// « MER 18.11 · 14H32 »
function stamp(ms) {
  const d = new Date(ms);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "").toUpperCase();
  return `${day} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} · ${pad2(d.getHours())}H${pad2(d.getMinutes())}`;
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function ago(ms) {
  const min = (ms - Date.now()) / 60e3;
  if (Math.abs(min) < 60) return rtf.format(Math.round(min), "minute");
  if (Math.abs(min) < 1440) return rtf.format(Math.round(min / 60), "hour");
  return rtf.format(Math.round(min / 1440), "day");
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Couleur dominante d'une pochette (servie par NOTRE serveur → lisible par un canvas)
function coverColor(src) {
  if (state.colors.has(src)) return Promise.resolve(state.colors.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) {
        const w = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255 + 0.06;
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; total += w;
      }
      const color = [r / total, g / total, b / total].map(Math.round);
      state.colors.set(src, color);
      resolve(color);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function setColorVars(node, [r, g, b]) {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  node.style.setProperty("--c", `rgb(${r} ${g} ${b})`);
  node.style.setProperty("--on-c", lum > 0.55 ? "#1b1a18" : "#f6f3ed");
}

// ---------- La scène à l'échelle de l'écran ----------

function fitStage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const L = vw / vh < 0.9 ? LAYOUTS.portrait : LAYOUTS.landscape;
  const changed = state.layout !== L;
  state.layout = L;

  // échelle « contain » : toute la scène est visible ; le surplus est du mur (en haut)
  const s = Math.min(vw / L.W, vh / L.H);
  const left = (vw - L.W * s) / 2;
  const top = vh - L.H * s;
  stage.style.width = `${L.W}px`;
  stage.style.height = `${L.H}px`;
  stage.style.transform = `translate(${left}px, ${top}px) scale(${s})`;

  // le sol continue sur toute la largeur, à la bonne hauteur
  document.documentElement.style.setProperty("--floor-top", `${top + L.floorY * s}px`);
  document.documentElement.style.setProperty("--plinth", `${Math.max(8, L.plinth * s)}px`);

  if (changed) placeDecor(L);
  layoutGallery();
}

function place(node, { x, y, w, h }) {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  if (w != null) node.style.width = `${w}px`;
  if (h != null) node.style.height = `${h}px`;
}

function placeDecor(L) {
  const sign = $("#sign");
  place(sign, { x: L.sign.x, y: L.sign.y });
  sign.style.setProperty("--neon-size", `${L.sign.size}px`);
  place($("#subtitle"), { x: L.postit.x, y: L.postit.y, w: L.postit.w });
  place($("#sunlight"), { x: L.sun.x, y: L.sun.y, w: L.sun.w });
  place(gallery, L.gallery);
  place($("#message"), L.gallery);

  // le lit (viewBox 1400×560) : ses pieds (y=492) posés 44 px devant la plinthe
  const bedH = L.bed.w * (560 / 1400);
  const bedTop = L.floorY + 44 - 492 * (L.bed.w / 1400);
  place($("#bed"), { x: L.bed.x, y: bedTop, w: L.bed.w, h: bedH });
}

// Meilleure grille pour n cadres dans la zone : on essaie chaque nombre de colonnes
function bestGrid(n, g) {
  let best = { cols: 1, rows: n, size: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const size = Math.min(
      (g.w - g.gap * (cols - 1)) / cols,
      (g.h - g.gap * (rows - 1)) / (rows * FRAME_RATIO),
    );
    if (size > best.size) best = { cols, rows, size };
  }
  best.size = Math.min(best.size, 250); // pas de cadres géants s'il y en a peu
  return best;
}

function layoutGallery() {
  const L = state.layout;
  if (!L) return;
  const g = L.gallery;
  const n = state.shown.length;
  if (!n) return;

  const { cols, rows, size } = bestGrid(n, g);
  const h = size * FRAME_RATIO;
  const totalH = rows * h + (rows - 1) * g.gap;
  const y0 = (g.h - totalH) / 2;

  state.shown.forEach((album, i) => {
    const node = state.elements.get(album.key);
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols; // dernière rangée centrée
    const col = i - row * cols;
    const rowW = inRow * size + (inRow - 1) * g.gap;
    const x = (g.w - rowW) / 2 + col * (size + g.gap);
    const y = y0 + row * (h + g.gap);
    place(node, { x, y, w: size, h });
    node.style.setProperty("--s", `${size}px`);
  });
}

// ---------- Chargement ----------

function currentUser() {
  return new URLSearchParams(location.search).get("user")?.trim() || "";
}

async function load() {
  const user = currentUser();
  if (!state.data) showMessage("On accroche les cadres…");

  try {
    const res = await fetch("/api/tracks" + (user ? `?user=${encodeURIComponent(user)}` : ""));
    const body = await res.json().catch(() => ({ error: "Le serveur a renvoyé une réponse illisible." }));
    if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
    setData(body);
  } catch (err) {
    const text = err instanceof TypeError
      ? "Impossible de joindre le serveur. Vérifie ta connexion."
      : err.message;
    if (state.data) {
      showBanner(`${text} Mur affiché : ${ago(state.data.cachedAt)}.`, true);
    } else {
      clearGallery();
      $("#subtitle").textContent = "";
      showMessage(`Mur en travaux. ${text}`, true);
    }
  }
}

function groupAlbums(tracks) {
  const byAlbum = new Map();
  for (const t of tracks) {
    const key = `${t.artist}\u0000${t.album || t.name}`;
    let a = byAlbum.get(key);
    if (!a) {
      a = { key, artist: t.artist, album: t.album, title: t.album || t.name, image: t.image, plays: [], last: 0, nowPlaying: false };
      byAlbum.set(key, a);
    }
    a.plays.push(t);
    a.last = Math.max(a.last, t.playedAt);
    a.nowPlaying ||= t.nowPlaying;
    a.image ??= t.image;
  }
  return [...byAlbum.values()].sort((x, y) => (y.nowPlaying - x.nowPlaying) || (y.last - x.last));
}

function setData(body) {
  body.tracks = (body.tracks ?? []).filter((t) => t.playedAt > 0);
  state.data = body;

  const name = body.displayName || body.user || currentUser() || "toi";
  $("#title").textContent = `Le mur de ${name}`;
  document.title = `Le mur de ${name}`;
  $("#userInput").placeholder = body.source === "demo" ? "pseudo Last.fm" : body.user || name;

  if (body.source === "demo") showBanner("Mode démo : mur d'exemple, sans Last.fm");
  else if (body.stale) showBanner(`Last.fm ne répond pas. Voici le mur enregistré ${ago(body.cachedAt)}.`, true);
  else hideBanner();

  const n = body.tracks.length;
  if (n === 0) {
    clearGallery();
    $("#subtitle").textContent = "";
    showMessage(`Mur vide pour ${name}. Lance un morceau : il sera encadré ici dans quelques minutes.`);
    return;
  }
  hideMessage();

  const signature = `${name}|${n}|${body.tracks[0].playedAt}|${body.tracks[0].nowPlaying}|${state.layout?.W}`;
  if (signature === state.signature) return;
  state.signature = signature;

  state.albums = groupAlbums(body.tracks);
  state.shown = state.albums.slice(0, state.layout.gallery.max);

  const top = [...state.albums].sort((a, b) => b.plays.length - a.plays.length)[0];
  const hidden = state.albums.length - state.shown.length;
  $("#subtitle").replaceChildren(
    `${n} écoute${n > 1 ? "s" : ""}, ${state.albums.length} album${state.albums.length > 1 ? "s" : ""}`,
    hidden > 0 ? ` (les ${state.shown.length} derniers au mur)` : "",
    ". Le plus écouté : ",
    el("b", null, top.title),
  );

  render();
  updateTurntable();
}

// ---------- Cadres ----------

function clearGallery() {
  state.albums = [];
  state.shown = [];
  state.signature = "";
  state.elements.clear();
  gallery.replaceChildren();
}

function render() {
  const keep = new Set(state.shown.map((a) => a.key));
  for (const [key, node] of state.elements) {
    if (!keep.has(key)) { node.remove(); state.elements.delete(key); }
  }
  state.shown.forEach((album, i) => {
    let node = state.elements.get(album.key);
    if (!node) {
      node = el("button", "frame");
      node.type = "button";
      node.addEventListener("click", () => openDetail(album.key));
      node.style.setProperty("--delay", `${i * 0.05}s`);
      state.elements.set(album.key, node);
      gallery.append(node);
    }
    fillFrame(node, album);
  });
  layoutGallery();
}

function fillFrame(node, a) {
  const rand = seeded(hash(a.key));
  rand();
  node.className = `frame ${FRAMES[Math.floor(rand() * FRAMES.length)]}`;
  node.style.setProperty("--rot", `${((rand() - 0.5) * 1.6).toFixed(2)}deg`); // un cadre n'est jamais tout à fait droit
  node.setAttribute("aria-label",
    `${a.artist}, ${a.title} : ${a.plays.length} écoute${a.plays.length > 1 ? "s" : ""}, la dernière ${ago(a.last)}`);

  setColorVars(node, state.colors.get(a.image) ?? hexToRgb(PALETTE[hash(a.artist) % PALETTE.length]));
  if (a.image && !state.colors.has(a.image)) coverColor(a.image).then((c) => c && setColorVars(node, c));

  const mat = el("span", "mat");
  if (a.image) {
    const img = el("img", "art");
    img.src = a.image;
    img.alt = "";
    img.decoding = "async";
    mat.append(img);
  } else {
    const longest = Math.max(...a.artist.split(/\s+/).map((w) => w.length));
    const type = el("span", "art art-type", a.artist);
    type.style.setProperty("--fit", Math.min(1, 8 / Math.max(1, longest)).toFixed(3));
    mat.append(type);
  }
  const label = el("span", "label");
  label.append(
    el("b", null, a.artist),
    el("span", null, a.title),
    el("span", "date", a.nowPlaying ? "en ce moment" : stamp(a.last)),
  );
  mat.append(label);

  const extras = [];
  if (a.plays.length > 1) extras.push(el("span", "plays", `×${a.plays.length}`));
  if (a.nowPlaying) extras.push(el("span", "live", "En écoute"));
  node.replaceChildren(mat, ...extras);
}

// La platine « joue » le dernier album et sa pochette est posée au sol
function updateTurntable() {
  const a = state.albums[0];
  const sleeve = $("#sleeveImg");
  if (!a) return;
  if (a.image) sleeve.setAttribute("href", a.image);
  else sleeve.removeAttribute("href");
  const apply = (c) => document.documentElement.style.setProperty("--now-color", `rgb(${c.join(" ")})`);
  apply(hexToRgb(PALETTE[hash(a.artist) % PALETTE.length]));
  if (a.image) coverColor(a.image).then((c) => c && apply(c));
}

// ---------- Fiche détaillée ----------

function openDetail(key) {
  const a = state.albums.find((x) => x.key === key);
  if (!a) return;
  const node = state.elements.get(key);
  dialog.style.setProperty("--c", node.style.getPropertyValue("--c"));
  dialog.style.setProperty("--on-c", node.style.getPropertyValue("--on-c"));

  const head = el("div", "detail-head");
  const img = el("img");
  img.alt = a.album ? `Pochette de ${a.album}` : "";
  if (a.image) img.src = a.image;
  const text = el("div");
  text.append(
    el("h2", null, a.artist),
    el("p", null, a.album || "Single"),
    el("p", null, `${a.plays.length} écoute${a.plays.length > 1 ? "s" : ""}`),
  );
  head.append(img, text);

  const list = el("ol");
  for (const t of a.plays) {
    const li = el("li");
    const time = el("time", null, t.nowPlaying ? "en ce moment" : stamp(t.playedAt));
    time.dateTime = new Date(t.playedAt).toISOString();
    li.append(el("span", null, t.name), time);
    list.append(li);
  }
  $("#detailBody").replaceChildren(head, list);
  dialog.showModal();
}

dialog.querySelector(".close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

// ---------- Messages ----------

function showMessage(text, withRetry = false) {
  $("#messageText").textContent = text;
  $("#retry").hidden = !withRetry;
  $("#message").hidden = false;
}
function hideMessage() { $("#message").hidden = true; }
function showBanner(text, warn = false) {
  const b = $("#banner");
  b.textContent = text;
  b.classList.toggle("warn", warn);
  b.hidden = false;
}
function hideBanner() { $("#banner").hidden = true; }

$("#retry").addEventListener("click", load);

$("#userForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const user = $("#userInput").value.trim();
  const url = new URL(location.href);
  if (user) url.searchParams.set("user", user);
  else url.searchParams.delete("user");
  history.pushState(null, "", url);
  $("#userInput").value = "";
  state.data = null;
  clearGallery();
  load();
});
window.addEventListener("popstate", () => { state.data = null; clearGallery(); load(); });

// ---------- Démarrage ----------

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const before = state.layout;
    fitStage();
    // passage paysage <-> portrait : le nombre de cadres change
    if (before !== state.layout && state.data) { state.signature = ""; setData(state.data); }
  }, 100);
});
fitStage();
load();
setInterval(() => {
  if (document.visibilityState === "visible") load();
}, REFRESH_MS);
