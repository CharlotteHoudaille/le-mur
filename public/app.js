// Le mur — mes écoutes récentes affichées en vrac sur le mur de ma chambre (3D).
//
//  - une affiche = un album (ou un morceau seul s'il n'a pas d'album)
//  - les plus récentes près du centre et par-dessus les autres
//  - plus un album est écouté, plus son affiche est grande
//  - une affiche jaune résume les chiffres (écoutes, albums, tête d'affiche)
//
// Le navigateur ne parle qu'à notre serveur (/api/... et /vendor/...),
// jamais à Last.fm ni à Deezer.

import { drawAlbumPoster, drawStatsPoster, loadImage, hash } from "./posters.js";

const $ = (sel) => document.querySelector(sel);
const dialog = $("#detail");
const tooltip = $("#tooltip");

const REFRESH_MS = 60_000; // = durée du cache serveur
const MAX_POSTERS = 40;

const state = { data: null, albums: [], signature: "", room: null };

// ---------- Utilitaires ----------

const pad2 = (n) => String(n).padStart(2, "0");
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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ---------- La pièce en 3D ----------

async function startRoom() {
  try {
    const { createRoom } = await import("./scene.js");
    state.room = createRoom($("#room"), { onHover: showTooltip, onPick: openDetail });
  } catch (err) {
    console.error(err);
    showMessage("Ton navigateur n'arrive pas à afficher la 3D (WebGL).");
  }
}

function showTooltip(item, x, y) {
  if (!item || item.kind === "stats") { tooltip.hidden = true; return; }
  const a = item.album;
  tooltip.replaceChildren(
    el("b", null, a.artist),
    `${a.title} · ${a.plays.length} écoute${a.plays.length > 1 ? "s" : ""}`,
  );
  tooltip.style.left = `${Math.min(x, window.innerWidth - 280)}px`;
  tooltip.style.top = `${Math.min(y, window.innerHeight - 70)}px`;
  tooltip.hidden = false;
}

// ---------- Chargement ----------

function currentUser() {
  return new URLSearchParams(location.search).get("user")?.trim() || "";
}

async function load() {
  const user = currentUser();
  if (!state.data) showMessage("On colle les affiches…");

  try {
    const res = await fetch("/api/tracks" + (user ? `?user=${encodeURIComponent(user)}` : ""));
    const body = await res.json().catch(() => ({ error: "Le serveur a renvoyé une réponse illisible." }));
    if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
    await setData(body);
  } catch (err) {
    const text = err instanceof TypeError
      ? "Impossible de joindre le serveur. Vérifie ta connexion."
      : err.message;
    if (state.data) {
      showBanner(`${text} Mur affiché : ${ago(state.data.cachedAt)}.`, true);
    } else {
      state.room?.setPosters([]);
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

async function setData(body) {
  body.tracks = (body.tracks ?? []).filter((t) => t.playedAt > 0);
  state.data = body;

  const name = body.displayName || body.user || currentUser() || "toi";
  document.title = `Le mur de ${name}`;
  $("#userInput").placeholder = body.source === "demo" ? "pseudo Last.fm" : body.user || name;

  if (body.source === "demo") showBanner("Mode démo : mur d'exemple, sans Last.fm");
  else if (body.stale) showBanner(`Last.fm ne répond pas. Voici le mur enregistré ${ago(body.cachedAt)}.`, true);
  else hideBanner();

  const n = body.tracks.length;
  if (n === 0) {
    state.signature = "";
    state.room?.setPosters([]);
    showMessage(`Mur vide pour ${name}. Lance un morceau : son affiche sera collée ici dans quelques minutes.`);
    return;
  }

  // on ne recolle le mur que si quelque chose a changé
  const signature = `${name}|${n}|${body.tracks[0].playedAt}|${body.tracks[0].nowPlaying}`;
  if (signature === state.signature) { hideMessage(); return; }
  state.signature = signature;

  state.albums = groupAlbums(body.tracks);
  const shown = state.albums.slice(0, MAX_POSTERS - 1);

  // polices chargées avant de dessiner les affiches sur les canvas
  await Promise.all([
    document.fonts.load("100px Anton"),
    document.fonts.load("bold 20px 'Space Mono'"),
    document.fonts.load("20px 'Space Mono'"),
  ]).catch(() => {});

  const images = await Promise.all(shown.map((a) => loadImage(a.image)));
  const items = shown.map((album, i) => {
    const poster = drawAlbumPoster(album, images[i]);
    return { ...poster, key: album.key, album, plays: album.plays.length };
  });

  const top = [...state.albums].sort((a, b) => b.plays.length - a.plays.length)[0];
  const stats = drawStatsPoster({
    plays: n,
    albums: state.albums.length,
    artists: new Set(body.tracks.map((t) => t.artist)).size,
    top: `${top.title}`,
    since: Math.min(...body.tracks.map((t) => t.playedAt)),
  });
  // l'affiche des chiffres est glissée en 3e position : bien visible, mais pas au centre
  items.splice(Math.min(2, items.length), 0, { ...stats, key: "stats", plays: 1 });

  state.room?.setPosters(items);
  // la platine joue le dernier album (le disque tourne s'il a été écouté il y a moins de 15 min)
  state.room?.setNowPlaying(images[0], shown[0].nowPlaying || Date.now() - shown[0].last < 15 * 60e3);
  renderSrList(shown);
  hideMessage();
}

function renderSrList(albums) {
  $("#srList").replaceChildren(...albums.map((a) => {
    const li = el("li");
    const btn = el("button", null, `${a.artist} — ${a.title} (${a.plays.length} écoute${a.plays.length > 1 ? "s" : ""})`);
    btn.type = "button";
    btn.addEventListener("click", () => openDetail({ album: a, color: [217, 210, 195] }));
    li.append(btn);
    return li;
  }));
}

// ---------- Fiche détaillée ----------

function openDetail(item) {
  if (!item || item.kind === "stats") return;
  const a = item.album;
  const [r, g, b] = item.color ?? [217, 210, 195];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  dialog.style.setProperty("--c", `rgb(${r} ${g} ${b})`);
  dialog.style.setProperty("--on-c", lum > 0.55 ? "#1b1a18" : "#f6f3ed");

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
  tooltip.hidden = true;
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
  state.signature = "";
  load();
});
window.addEventListener("popstate", () => { state.data = null; state.signature = ""; load(); });

// ---------- Démarrage ----------

await startRoom();
load();
setInterval(() => {
  if (document.visibilityState === "visible") load();
}, REFRESH_MS);

export { hash };
