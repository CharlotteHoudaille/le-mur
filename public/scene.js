// La chambre en 3D (three.js).
//
//  Unités : 1 = 1 mètre. Le mur est le plan z = 0, le sol y = 0.
//  La caméra regarde le mur de face, cadrée pour ne montrer que le haut du lit.
//  Le soleil est une SpotLight avec une « map » (un gobo) : la fenêtre et
//  l'ombre d'une plante, projetées sur le mur et sur les affiches.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { hash, seeded } from "./posters.js";

const BED_TOP = 1.32; // haut de la tête de lit
const VIEW_BOTTOM = 0.34; // bas de l'écran (au niveau du mur) : on voit le haut du lit et le meuble
const MATTRESS_TOP = 0.72;
// petit meuble à droite du lit (modèle Poly Haven « side_table_01 », 0,55 m, agrandi ×1,25)
const TABLE = { x: 1.44, scale: 1.25, top: 0.55 * 1.25 };

export function createRoom(canvas, { onHover, onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#8f9a85");
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);

  // ---------- Le mur ----------
  const wallMat = new THREE.MeshStandardMaterial({
    color: "#a6b39a",
    roughness: 0.97,
    bumpMap: noiseTexture(512, 6, 0.55),
    bumpScale: 1.4,
  });
  wallMat.bumpMap.repeat.set(5, 4);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), wallMat);
  wall.position.set(0, 4.5, 0);
  wall.receiveShadow = true;
  scene.add(wall);

  // sol (on ne le voit pas, mais il renvoie un peu de lumière chaude)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshStandardMaterial({ color: "#a77c52", roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 4);
  scene.add(floor);

  // ---------- Lumières ----------
  scene.add(new THREE.HemisphereLight("#fff4e6", "#6f5a44", 0.42));

  // lumière douce de la pièce (ombres portées des affiches)
  const key = new THREE.DirectionalLight("#fff1df", 0.55);
  key.position.set(-3, 5, 6);
  key.target.position.set(0, 2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -1, near: 1, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);

  // le soleil par la fenêtre, avec son gobo
  const cookie = new THREE.CanvasTexture(drawWindowCookie());
  cookie.colorSpace = THREE.SRGBColorSpace;
  cookie.center.set(0.5, 0.5);
  const sun = new THREE.SpotLight("#ffd29a", 1500, 0, 0.2, 0.15, 2);
  sun.position.set(6.5, 5.6, 5.2);
  sun.target.position.set(2.0, 2.55, 0);
  sun.map = cookie;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // lampe de chevet, hors champ en bas à gauche
  const lamp = new THREE.PointLight("#ffb46a", 7, 6, 2);
  lamp.position.set(-1.6, 1.0, 1.0);
  scene.add(lamp);

  // ---------- Le lit (on n'en voit que le haut) ----------
  scene.add(buildBed());

  // ---------- Modèles 3D réels (Poly Haven, CC0) ----------
  const loader = new GLTFLoader();
  const loadModel = (id, place) =>
    loader.loadAsync(`/models/${id}/${id}_1k.gltf`).then((gltf) => {
      gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      place(gltf.scene);
      scene.add(gltf.scene);
    }).catch((err) => console.warn(`modèle ${id} indisponible`, err));

  // coussins scannés, posés devant les oreillers
  loadModel("throw_pillows_01", (m) => {
    m.position.set(0.02, MATTRESS_TOP + 0.13, 0.62);
    m.scale.setScalar(1.15);
  });
  // le petit meuble
  loadModel("side_table_01", (m) => {
    m.position.set(TABLE.x, 0, 0.3);
    m.scale.setScalar(TABLE.scale);
  });
  // la petite plante, posée sur le meuble
  loadModel("potted_plant_02", (m) => {
    m.position.set(TABLE.x + 0.2, TABLE.top, 0.26);
    m.scale.setScalar(0.42);
    m.rotation.y = 0.6;
  });

  // ---------- La platine (le disque tourne : c'est le dernier album écouté) ----------
  const turntable = buildTurntable();
  turntable.group.position.set(TABLE.x - 0.11, TABLE.top, 0.3);
  turntable.group.rotation.y = -0.12;
  turntable.group.scale.setScalar(1.15);
  scene.add(turntable.group);

  function setNowPlaying(img, playing) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#b4572f";
    ctx.fillRect(0, 0, 256, 256);
    if (img) ctx.drawImage(img, 0, 0, 256, 256);
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(128, 128, 9, 0, Math.PI * 2);
    ctx.fill();
    turntable.labelMat.map?.dispose();
    turntable.labelMat.map = new THREE.CanvasTexture(c);
    turntable.labelMat.map.colorSpace = THREE.SRGBColorSpace;
    turntable.labelMat.needsUpdate = true;
    turntable.playing = playing;
  }

  // ---------- Affiches ----------
  const posterGroup = new THREE.Group();
  scene.add(posterGroup);
  let posters = []; // { mesh, item, lift }
  let items = [];
  const tapeMat = new THREE.MeshStandardMaterial({ color: "#efe6cc", roughness: 0.45, transparent: true, opacity: 0.6, depthWrite: false });

  function setPosters(newItems) {
    for (const p of posters) {
      p.mesh.geometry.dispose();
      p.mesh.material.map?.dispose();
      p.mesh.material.dispose();
    }
    posterGroup.clear();
    posters = [];
    items = newItems;
    items.forEach((item, i) => {
      const texture = new THREE.CanvasTexture(item.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      // depthWrite: false + renderOrder : l'ordre de collage décide qui passe devant,
      // pas la distance au mur (le papier gondolé ferait des chevauchements bizarres)
      const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.78, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.index = i;
      // scotch sur certaines affiches
      const rand = seeded(hash(item.key) + 3);
      if (rand() < 0.55) {
        for (const side of [-1, 1]) {
          const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.04), tapeMat);
          tape.userData.side = side;
          tape.userData.rot = side * (0.6 + rand() * 0.3);
          mesh.add(tape);
        }
      }
      posterGroup.add(mesh);
      posters.push({ mesh, item, lift: 0 });
    });
    layout();
  }

  // Disposition « en vrac » : grille très lâche + beaucoup de hasard,
  // les plus récentes près du centre et par-dessus.
  function layout() {
    if (!posters.length) return;
    const r = view.region;
    const n = posters.length;
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    const base = THREE.MathUtils.clamp(Math.sqrt((area * 1.35) / n / 1.2), 0.26, 0.62);

    const cols = Math.max(2, Math.round((r.x1 - r.x0) / (base * 0.86)));
    const rows = Math.max(2, Math.round((r.y1 - r.y0) / (base * 1.05)));
    const cw = (r.x1 - r.x0) / cols;
    const ch = (r.y1 - r.y0) / rows;
    const focus = { x: 0, y: r.y0 + (r.y1 - r.y0) * 0.55 };
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = r.x0 + (col + 0.5) * cw;
        const y = r.y0 + (row + 0.5) * ch;
        // derrière la tête de lit, une affiche serait invisible
        if (Math.abs(x) < 1.0 && y < BED_TOP + 0.05) continue;
        // ni derrière le meuble, la platine et la plante
        if (x > 0.98 && x < 1.98 && y < 1.32) continue;
        const jitter = seeded(row * 97 + col * 13 + 5)();
        cells.push({ x, y, d: Math.hypot((x - focus.x) / 1.6, y - focus.y) + jitter * 0.6 });
      }
    }
    cells.sort((a, b) => a.d - b.d);

    posters.forEach((p, i) => {
      const rand = seeded(hash(p.item.key) + 11);
      const cell = cells[i % cells.length];
      const extra = i >= cells.length; // plus d'affiches que de cases : on chevauche encore plus
      const scale = 0.85 + Math.min(0.45, (p.item.plays - 1) * 0.06) + (p.item.kind === "stats" ? 0.25 : 0);
      const w = base * scale * (p.item.ratio > 1.2 ? 0.92 : 1);
      const h = w * p.item.ratio;
      const x = cell.x + (rand() - 0.5) * cw * (extra ? 1.4 : 0.7);
      const y = cell.y + (rand() - 0.5) * ch * (extra ? 1.4 : 0.6);
      const rot = (rand() - 0.5) * 0.22;
      p.mesh.geometry.dispose();
      p.mesh.geometry = paperGeometry(w, h, rand);
      // les plus récentes devant ; l'affiche des chiffres toujours au premier plan
      const layer = p.item.kind === "stats" ? n + 1 : n - i;
      p.baseZ = 0.006 + layer * 0.0015;
      p.mesh.renderOrder = p.layerOrder = 10 + layer * 2;
      for (const tape of p.mesh.children) tape.renderOrder = 11 + layer * 2;
      p.mesh.position.set(x, y, p.baseZ);
      p.mesh.rotation.z = rot;
      for (const tape of p.mesh.children) {
        tape.position.set(tape.userData.side * (w / 2 - 0.02), h / 2 - 0.012, 0.004);
        tape.rotation.z = tape.userData.rot;
      }
    });
  }

  // ---------- Cadrage ----------
  const view = { region: { x0: -2.5, x1: 2.5, y0: 1, y1: 3.5 } };

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // hauteur de mur visible : au moins 3 m, et assez large pour ~2,4 m sur téléphone
    const visH = Math.max(3.4, 2.7 / camera.aspect);
    const dist = visH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    view.center = new THREE.Vector3(0, VIEW_BOTTOM + visH / 2, 0);
    view.dist = dist;
    camera.updateProjectionMatrix();
    const visW = visH * camera.aspect;
    view.region = {
      x0: -visW / 2 + Math.min(0.55, visW * 0.08),
      x1: visW / 2 - Math.min(0.55, visW * 0.08),
      y0: Math.max(VIEW_BOTTOM + 0.12, 1.0),
      y1: VIEW_BOTTOM + visH - 0.32,
    };
    layout();
  }

  // ---------- Interactions ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0, 0);
  const parallax = new THREE.Vector2(0, 0);
  let hovered = null;
  let pointerInside = false;

  function pick(clientX, clientY) {
    pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(posters.map((p) => p.mesh), false)[0];
    return hit ? posters[hit.object.userData.index] : null;
  }

  canvas.addEventListener("pointermove", (e) => {
    pointerInside = true;
    parallax.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    if (e.pointerType !== "mouse") return;
    const p = pick(e.clientX, e.clientY);
    if (p !== hovered) {
      hovered = p;
      canvas.style.cursor = p ? "pointer" : "default";
    }
    onHover?.(p?.item ?? null, e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => {
    pointerInside = false;
    hovered = null;
    onHover?.(null);
  });
  canvas.addEventListener("click", (e) => {
    const p = pick(e.clientX, e.clientY);
    if (p) onPick?.(p.item);
  });

  // ---------- Boucle ----------
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  function frame() {
    const t = clock.getElapsedTime();
    // légère parallaxe à la souris (la tête bouge un peu)
    const target = pointerInside && !reduceMotion ? parallax : new THREE.Vector2(0, 0);
    camera.position.set(
      view.center.x + target.x * 0.12,
      view.center.y - target.y * 0.06,
      view.dist,
    );
    camera.lookAt(view.center.x, view.center.y, 0);
    // la plante bouge dans le vent : le gobo tourne très légèrement
    if (!reduceMotion) cookie.rotation = Math.sin(t * 0.35) * 0.012 + Math.sin(t * 0.9) * 0.004;
    // 33 tours par minute
    const dt = Math.min(0.05, t - (frame.last ?? t));
    frame.last = t;
    if (turntable.playing && !reduceMotion) turntable.spinner.rotation.y -= dt * (33.3 / 60) * Math.PI * 2;
    // l'affiche survolée se décolle un peu du mur
    for (const p of posters) {
      const goal = p === hovered ? 1 : 0;
      p.lift += (goal - p.lift) * 0.15;
      p.mesh.position.z = p.baseZ + p.lift * 0.06;
      if (p.lift > 0.05) p.mesh.renderOrder = 10000;
      else if (p.mesh.renderOrder === 10000) p.mesh.renderOrder = p.layerOrder;
      const s = 1 + p.lift * 0.035;
      p.mesh.scale.set(s, s, 1);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);

  return { setPosters, setNowPlaying };
}

// ---------- Géométries et textures ----------

// Une feuille de papier : légèrement gondolée, coins du bas un peu décollés
function paperGeometry(w, h, rand) {
  const g = new THREE.PlaneGeometry(w, h, 12, 16);
  const pos = g.attributes.position;
  const liftL = rand() * 0.025, liftR = rand() * 0.025, bow = 0.004 + rand() * 0.006;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2); // -1..1
    const y = pos.getY(i) / (h / 2); // -1..1
    let z = bow * (1 - x * x) * (1 - y * y * 0.5);
    const low = Math.max(0, -y); // moitié basse
    z += Math.pow(low, 3) * Math.pow(Math.max(0, -x), 2) * liftL;
    z += Math.pow(low, 3) * Math.pow(Math.max(0, x), 2) * liftR;
    pos.setZ(i, z);
  }
  g.computeVertexNormals();
  return g;
}

// Bruit doux (plâtre, tissu) en niveaux de gris, répétable
function noiseTexture(size, cells, contrast) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  for (const [n, alpha] of [[cells, contrast], [cells * 4, contrast * 0.5], [cells * 16, contrast * 0.35]]) {
    const small = document.createElement("canvas");
    small.width = small.height = n;
    const s = small.getContext("2d");
    const img = s.createImageData(n, n);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    s.putImageData(img, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    // dessiné 3×3 pour que les bords se raccordent
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) ctx.drawImage(small, dx, dy, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Le gobo du soleil : 4 carreaux de fenêtre et l'ombre d'une plante, flous
function drawWindowCookie() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);
  ctx.filter = "blur(7px)";
  ctx.fillStyle = "#fff";
  // la fenêtre, en perspective
  ctx.beginPath();
  ctx.moveTo(110, 70); ctx.lineTo(420, 105); ctx.lineTo(440, 430); ctx.lineTo(90, 410); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(266, 85); ctx.lineTo(266, 425);
  ctx.moveTo(98, 245); ctx.lineTo(432, 270);
  ctx.stroke();
  // la plante
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(470, 520); ctx.quadraticCurveTo(400, 420, 330, 330);
  ctx.moveTo(440, 470); ctx.quadraticCurveTo(430, 380, 420, 300);
  ctx.stroke();
  const leaves = [[430, 440, 60, 22, -0.5], [400, 380, 66, 26, -0.95], [350, 320, 74, 32, -0.4], [318, 286, 56, 26, -1.2], [420, 300, 46, 18, -1.4], [370, 430, 50, 18, 0.25]];
  for (const [x, y, rx, ry, a] of leaves) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";
  return c;
}

// ---------- Le lit ----------
function buildBed() {
  const bed = new THREE.Group();

  const fabricBump = noiseTexture(256, 32, 0.8);
  fabricBump.repeat.set(6, 6);

  // velours rouille : sheen = reflet doux typique du velours
  const velvet = new THREE.MeshPhysicalMaterial({
    color: "#8a3c1e",
    roughness: 0.82,
    sheen: 1,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color("#f2a57d"),
    bumpMap: fabricBump,
    bumpScale: 0.3,
  });

  // panneau arrière + 9 boudins capitonnés
  const panel = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.98, 0.08, 4, 0.03), velvet);
  panel.position.set(0, BED_TOP - 0.49 - 0.02, 0.05);
  panel.castShadow = panel.receiveShadow = true;
  bed.add(panel);
  const count = 9;
  const step = 1.84 / count;
  for (let i = 0; i < count; i++) {
    const r = step / 2 - 0.004;
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.98 - 2 * r - 0.04, 10, 24), velvet);
    capsule.scale.z = 0.55;
    capsule.position.set(-0.92 + step * (i + 0.5), BED_TOP - 0.49 - 0.02, 0.1);
    capsule.castShadow = capsule.receiveShadow = true;
    bed.add(capsule);
  }

  // oreillers : un superellipsoïde gonflé au centre, plus fin sur les bords
  const linen = new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.95, bumpMap: fabricBump, bumpScale: 0.6 });
  const pillows = [
    // [largeur, épaisseur, hauteur, x, y, z, inclinaison, matière]
    [0.82, 0.22, 0.56, -0.44, 0.95, 0.32, -0.42, linen],
    [0.82, 0.22, 0.56, 0.44, 0.95, 0.32, -0.38, linen],
  ];
  for (const [w, d, h, x, y, z, tilt, mat] of pillows) {
    const pillow = new THREE.Mesh(pillowGeometry(w, h, d), mat);
    pillow.position.set(x, y, z);
    pillow.rotation.x = tilt;
    pillow.rotation.z = (x > 0 ? -1 : 1) * 0.03;
    pillow.castShadow = pillow.receiveShadow = true;
    bed.add(pillow);
  }

  // matelas + couette, sous le champ de la caméra
  const duvet = new THREE.Mesh(new RoundedBoxGeometry(1.96, 0.34, 2.1, 6, 0.1), linen);
  duvet.position.set(0, 0.55, 1.2);
  duvet.receiveShadow = true;
  bed.add(duvet);
  return bed;
}

function pillowGeometry(w, h, d) {
  const g = new THREE.SphereGeometry(1, 64, 40);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const sx = Math.sign(v.x) * Math.pow(Math.abs(v.x), 0.4);
    const sy = Math.sign(v.y) * Math.pow(Math.abs(v.y), 0.4);
    let sz = v.z;
    const edge = Math.max(Math.abs(sx), Math.abs(sy));
    sz *= 1 - 0.85 * Math.pow(edge, 5);
    p.setXYZ(i, (sx * w) / 2, (sy * h) / 2, (sz * d) / 2);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- La platine ----------
function buildTurntable() {
  const group = new THREE.Group();
  const walnut = new THREE.MeshStandardMaterial({ color: "#5b3a24", roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: "#c9c9c9", roughness: 0.3, metalness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: "#1c1c1c", roughness: 0.4, metalness: 0.4 });

  const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.075, 0.33, 4, 0.012), walnut);
  plinth.position.y = 0.0375 + 0.012;
  group.add(plinth);
  for (const [x, z] of [[-0.18, -0.13], [0.18, -0.13], [-0.18, 0.13], [0.18, 0.13]]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.012, 16), dark);
    foot.position.set(x, 0.006, z);
    group.add(foot);
  }
  const top = 0.087;
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.012, 64), dark);
  platter.position.set(-0.04, top + 0.006, 0);
  group.add(platter);

  // le disque : sillons dessinés sur la face du dessus
  const spinner = new THREE.Group();
  spinner.position.set(-0.04, top + 0.013, 0);
  const grooves = document.createElement("canvas");
  grooves.width = grooves.height = 512;
  const g = grooves.getContext("2d");
  g.fillStyle = "#0d0d0d";
  g.fillRect(0, 0, 512, 512);
  for (let r = 70; r < 252; r += 2) {
    g.strokeStyle = r % 6 === 0 ? "#262626" : "#141414";
    g.beginPath();
    g.arc(256, 256, r, 0, Math.PI * 2);
    g.stroke();
  }
  const grooveTex = new THREE.CanvasTexture(grooves);
  grooveTex.colorSpace = THREE.SRGBColorSpace;
  const vinylTop = new THREE.MeshStandardMaterial({ map: grooveTex, roughness: 0.28, metalness: 0.2 });
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.136, 0.136, 0.003, 96), [dark, vinylTop, dark]);
  spinner.add(vinyl);
  const labelMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7 });
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.0034, 64), [dark, labelMat, dark]);
  label.position.y = 0.0004;
  spinner.add(label);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 12), metal);
  spindle.position.y = 0.008;
  spinner.add(spindle);
  group.add(spinner);

  // le bras de lecture, posé sur le disque
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.03, 24), metal);
  pivot.position.set(0.16, top + 0.015, -0.1);
  group.add(pivot);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.21, 12), metal);
  arm.position.set(0.105, top + 0.03, -0.01);
  arm.rotation.z = Math.PI / 2;
  arm.rotation.y = -0.95;
  group.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.016), dark);
  head.position.set(0.05, top + 0.022, 0.075);
  head.rotation.y = -0.95;
  group.add(head);

  group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return { group, spinner, labelMat, playing: false };
}
