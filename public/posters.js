// Dessin des affiches (en 2D, sur un <canvas>) qui serviront de textures en 3D.
//
// Trois sortes d'affiches, tirées au hasard (mais toujours la même pour un album) :
//  - « print »  : la pochette imprimée, bord blanc (carrée)
//  - « gig »    : affiche de concert : pochette + nom géant + date (format A)
//  - « type »   : pas de pochette : affiche typographique colorée
// et une affiche spéciale « stats » qui remplace l'ancien post-it.

const PX = 640; // largeur des textures en pixels
const PAPER = "#f3eee4";
const INK = "#1b1a18";
const PALETTE = ["#b4572f", "#2f5d73", "#c9a34a", "#5d7a55", "#8a4f7d", "#d0743c", "#3e4a7a", "#a23b3b"];

export function hash(str) {
  let h = 2166136261;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seeded(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const pad2 = (n) => String(n).padStart(2, "0");
function stamp(ms) {
  const d = new Date(ms);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "").toUpperCase();
  return `${day} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} · ${pad2(d.getHours())}H${pad2(d.getMinutes())}`;
}

// Grain de papier, calculé une seule fois
let grain;
function paperGrain() {
  if (grain) return grain;
  grain = document.createElement("canvas");
  grain.width = grain.height = 256;
  const g = grain.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 200 + Math.random() * 55;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grain;
}

// Usure : grain, bords un peu salis, pli central
function wear(ctx, w, h, rand) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = ctx.createPattern(paperGrain(), "repeat");
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  const edge = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(60,40,10,0.28)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  if (rand() < 0.6) {
    // pli horizontal (l'affiche a été pliée)
    const y = h * (0.45 + rand() * 0.1);
    const fold = ctx.createLinearGradient(0, y - 6, 0, y + 6);
    fold.addColorStop(0, "rgba(0,0,0,0)");
    fold.addColorStop(0.5, "rgba(0,0,0,0.16)");
    fold.addColorStop(0.55, "rgba(255,255,255,0.0)");
    fold.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fold;
    ctx.fillRect(0, y - 6, w, 12);
  }
  ctx.restore();
}

// Texte qui tient dans une largeur : on coupe en lignes puis on réduit la taille
function fitLines(ctx, text, maxW, maxSize, maxLines, family) {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  for (let size = maxSize; size > 10; size -= 2) {
    ctx.font = `${size}px ${family}`;
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) line = test;
      else { if (line) lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines };
  }
  ctx.font = `12px ${family}`;
  return { size: 12, lines: [text.slice(0, 20)] };
}

function ellipsis(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// Couleur dominante d'une image (pixels colorés favorisés)
export function dominantColor(img) {
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
  return [r / total, g / total, b / total].map(Math.round);
}

const rgb = ([r, g, b], k = 1) => `rgb(${Math.round(r * k)} ${Math.round(g * k)} ${Math.round(b * k)})`;
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Renvoie { canvas, ratio (h/w), color } pour un album
export function drawAlbumPoster(album, img) {
  const rand = seeded(hash(album.key));
  rand();
  const kind = !img ? "type" : rand() < 0.42 ? "print" : "gig";
  const color = img ? dominantColor(img) : hexToRgb(PALETTE[hash(album.artist) % PALETTE.length]);

  if (kind === "print") return { ...drawPrint(img, rand), color, kind };
  if (kind === "gig") return { ...drawGig(album, img, color, rand), color, kind };
  return { ...drawType(album, color, rand), color, kind };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawPrint(img, rand) {
  const w = PX, h = PX;
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  const m = w * 0.045;
  ctx.drawImage(img, m, m, w - 2 * m, h - 2 * m);
  wear(ctx, w, h, rand);
  return { canvas: c, ratio: 1 };
}

function drawGig(album, img, color, rand) {
  const w = PX, h = Math.round(PX * 1.41);
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d");
  const dark = luminance(color) > 0.6 ? 0.35 : 0.55;
  ctx.fillStyle = rand() < 0.35 ? INK : rgb(color, dark);
  ctx.fillRect(0, 0, w, h);
  const fg = PAPER;

  // la pochette, un peu en biais, comme collée
  const m = w * 0.08;
  const size = w - 2 * m;
  ctx.save();
  ctx.translate(w / 2, m + size / 2);
  ctx.rotate((rand() - 0.5) * 0.05);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();

  // nom de l'artiste, géant
  let y = m + size + w * 0.06;
  const name = fitLines(ctx, album.artist, w - 2 * m, 130, 2, "Anton, Impact, sans-serif");
  ctx.fillStyle = fg;
  ctx.textBaseline = "top";
  for (const line of name.lines) {
    ctx.font = `${name.size}px Anton, Impact, sans-serif`;
    ctx.fillText(line, m, y);
    y += name.size * 0.98;
  }
  // titre + date, en petit
  ctx.font = `bold ${Math.round(w * 0.04)}px "Space Mono", monospace`;
  ctx.fillText(ellipsis(ctx, album.title.toUpperCase(), w - 2 * m), m, Math.min(y + 6, h - w * 0.2));
  ctx.fillRect(m, h - w * 0.13, w - 2 * m, 3);
  ctx.font = `${Math.round(w * 0.036)}px "Space Mono", monospace`;
  ctx.fillText(album.nowPlaying ? "EN CE MOMENT" : stamp(album.last), m, h - w * 0.1);
  if (album.plays.length > 1) {
    ctx.textAlign = "right";
    ctx.fillText(`×${album.plays.length}`, w - m, h - w * 0.1);
    ctx.textAlign = "left";
  }
  wear(ctx, w, h, rand);
  return { canvas: c, ratio: h / w };
}

function drawType(album, color, rand) {
  const w = PX, h = Math.round(PX * 1.41);
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = rgb(color);
  ctx.fillRect(0, 0, w, h);
  const fg = luminance(color) > 0.55 ? INK : PAPER;
  const m = w * 0.08;
  ctx.fillStyle = fg;
  ctx.textBaseline = "top";
  const name = fitLines(ctx, album.artist, w - 2 * m, 220, 4, "Anton, Impact, sans-serif");
  let y = m;
  for (const line of name.lines) {
    ctx.font = `${name.size}px Anton, Impact, sans-serif`;
    ctx.fillText(line, m, y);
    y += name.size * 0.95;
  }
  ctx.font = `bold ${Math.round(w * 0.045)}px "Space Mono", monospace`;
  ctx.fillText(ellipsis(ctx, album.title.toUpperCase(), w - 2 * m), m, y + 16);
  ctx.fillRect(m, h - w * 0.13, w - 2 * m, 3);
  ctx.font = `${Math.round(w * 0.036)}px "Space Mono", monospace`;
  ctx.fillText(album.nowPlaying ? "EN CE MOMENT" : stamp(album.last), m, h - w * 0.1);
  wear(ctx, w, h, rand);
  return { canvas: c, ratio: h / w };
}

// L'affiche des statistiques (remplace le post-it)
export function drawStatsPoster(stats) {
  const w = PX, h = Math.round(PX * 1.41);
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e9c46a";
  ctx.fillRect(0, 0, w, h);
  const m = w * 0.08;
  ctx.fillStyle = INK;
  ctx.textBaseline = "top";

  ctx.font = `bold ${Math.round(w * 0.04)}px "Space Mono", monospace`;
  ctx.fillText("EN TOURNÉE DANS MES OREILLES", m, m);
  ctx.fillRect(m, m + w * 0.07, w - 2 * m, 4);

  ctx.font = `${Math.round(w * 0.42)}px Anton, Impact, sans-serif`;
  ctx.fillText(String(stats.plays), m - 6, m + w * 0.1);
  ctx.font = `${Math.round(w * 0.12)}px Anton, Impact, sans-serif`;
  ctx.fillText("ÉCOUTES", m, m + w * 0.56);
  ctx.font = `${Math.round(w * 0.075)}px Anton, Impact, sans-serif`;
  ctx.fillText(`${stats.albums} ALBUMS · ${stats.artists} ARTISTES`, m, m + w * 0.72);

  ctx.font = `bold ${Math.round(w * 0.036)}px "Space Mono", monospace`;
  ctx.fillText("TÊTE D'AFFICHE", m, h - w * 0.42);
  const top = fitLines(ctx, stats.top, w - 2 * m, 84, 2, "Anton, Impact, sans-serif");
  let y = h - w * 0.37;
  for (const line of top.lines) {
    ctx.font = `${top.size}px Anton, Impact, sans-serif`;
    ctx.fillText(line, m, y);
    y += top.size * 0.98;
  }
  ctx.fillRect(m, h - w * 0.13, w - 2 * m, 4);
  ctx.font = `${Math.round(w * 0.036)}px "Space Mono", monospace`;
  ctx.fillText(`DEPUIS ${stamp(stats.since)}`, m, h - w * 0.1);
  wear(ctx, w, h, seeded(7));
  return { canvas: c, ratio: h / w, color: [233, 196, 106], kind: "stats" };
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
