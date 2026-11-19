// Données d'exemple pour développer sans clé API.
// Génère ~24 h d'écoutes réparties en sessions, quelques artistes récurrents.

const ARTISTS = [
  { artist: "Air", album: "Moon Safari", songs: ["La femme d'argent", "Sexy Boy", "Kelly Watch the Stars", "Talisman"] },
  { artist: "Daft Punk", album: "Discovery", songs: ["One More Time", "Digital Love", "Harder, Better, Faster, Stronger", "Something About Us"] },
  { artist: "Phoenix", album: "Wolfgang Amadeus Phoenix", songs: ["Lisztomania", "1901", "Fences"] },
  { artist: "Christine and the Queens", album: "Chaleur humaine", songs: ["Tilted", "Saint Claude", "Christine"] },
  { artist: "Radiohead", album: "In Rainbows", songs: ["Nude", "Reckoner", "Weird Fishes/Arpeggi", "House of Cards"] },
  { artist: "Stromae", album: "Racine carrée", songs: ["Papaoutai", "Formidable", "Tous les mêmes"] },
  { artist: "Bonobo", album: "Migration", songs: ["Kerala", "Break Apart", "Migration"] },
];

export function demoTracks() {
  const now = Date.now();
  const tracks = [];
  // sessions : [il y a X heures, durée en heures, artistes favoris]
  const sessions = [
    [23, 1.5, [0, 6]],
    [19, 1, [1, 2]],
    [14, 2, [4, 6, 0]],
    [9, 1.2, [3, 5]],
    [5, 2.5, [1, 2, 3, 5]],
    [1, 1, [4, 0]],
  ];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (const [hoursAgo, duration, favs] of sessions) {
    let t = now - hoursAgo * 3600e3;
    const end = t + duration * 3600e3;
    while (t < end) {
      const index = favs[Math.floor(rand() * favs.length)];
      const a = ARTISTS[index];
      tracks.push({
        name: a.songs[Math.floor(rand() * a.songs.length)],
        artist: a.artist,
        album: a.album,
        image: index % 3 === 2 ? null : `/api/demo-cover/${index}.svg`,
        url: null,
        playedAt: Math.round(t),
        nowPlaying: false,
      });
      t += (2.5 + rand() * 2.5) * 60e3;
    }
  }
  tracks.sort((x, y) => y.playedAt - x.playedAt);
  tracks[0].nowPlaying = true;
  return { user: "demo", tracks };
}

// Pochettes abstraites générées (aucune image réelle en mode démo)
const COVER_COLORS = [
  ["#f2c14e", "#f78154", "#4d9078"],
  ["#1b1b3a", "#e4572e", "#f3a712"],
  ["#2e86ab", "#f6f5ae", "#a23b72"],
  ["#ff6f59", "#254441", "#43aa8b"],
  ["#0b3954", "#bfd7ea", "#ff5a5f"],
  ["#5f0f40", "#fb8b24", "#e36414"],
  ["#3a0ca3", "#4cc9f0", "#f72585"],
];

export function demoCoverSvg(index) {
  const [bg, a, b] = COVER_COLORS[index % COVER_COLORS.length];
  let seed = index * 97 + 13;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shapes = Array.from({ length: 5 }, (_, i) => {
    const color = i % 2 ? a : b;
    const x = Math.round(rand() * 300), y = Math.round(rand() * 300), r = Math.round(30 + rand() * 110);
    return i % 3 === 0
      ? `<rect x="${x - r / 2}" y="${y - r / 2}" width="${r}" height="${r}" fill="${color}" transform="rotate(${Math.round(rand() * 90)} ${x} ${y})" opacity=".9"/>`
      : `<circle cx="${x}" cy="${y}" r="${r / 2}" fill="${color}" opacity=".9"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300"><rect width="300" height="300" fill="${bg}"/>${shapes}</svg>`;
}
