// Pixel sprites: authored as character grids, or generated per pixel.
// Every character sprite gets a 1px dark outline so it reads on any ground.
import { mulberry32 } from '../rng.js';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function pix(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  });
  return c;
}

export function outline(src, color = '#16130e') {
  const w = src.width + 2, h = src.height + 2;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.drawImage(src, 1, 1);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const [r, gg, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const marks = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push((y * w + x) * 4);
    }
  }
  for (const i of marks) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

export function flipH(src) {
  const c = canvas(src.width, src.height);
  const g = c.getContext('2d');
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

// Generate a sprite by calling fn(x, y) -> color | null for every pixel.
export function gen(w, h, fn) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  }
  return c;
}

// ---------- explorers ----------
const HEAD_FRONT = ['...hhhh...', '..hhhhhh..', '.HHHHHHHH.', '..ssssss..', '..sKssKs..', '..ssssss..'];
const BODY_FRONT = ['..CccccC..', '.scccccccs', '.sCccccCs.', '..cccccc..', '..bbbbbb..'];
const HEAD_BACK = ['...hhhh...', '..hhhhhh..', '.HHHHHHHH.', '..hhhhhh..', '..Hhhhhh..', '...ssss...'];
const BODY_BACK = ['..CkkkkC..', '.skkkkkkks', '.sCkkkkCs.', '..cccccc..', '..bbbbbb..'];
const HEAD_SIDE = ['...hhhh...', '..hhhhhh..', '..HHHHHHHH', '...sssss..', '...sssKs..', '...sssss..'];
const BODY_SIDE = ['..kkcccc..', '..kkcccs..', '..kkcccc..', '...cccc...', '...bbbb...'];
const LEGS_FB = [
  ['..pp..pp..', '..pp..pp..', '..oo..oo..'],
  ['..pp..pp..', '...p..pp..', '...o..oo..'],
  ['..pp..pp..', '..pp..p...', '..oo..o...'],
];
const LEGS_SIDE = [
  ['....pp....', '....pp....', '....ooo...'],
  ['...p..p...', '..p....p..', '.oo....oo.'],
  ['....pp....', '....pp....', '....ooo...'],
];

const EXPLORER_PAL = [
  { c: '#e88a3f', C: '#a8551f' },
  { c: '#45bfd0', C: '#24808f' },
];

export function explorerSprites(id) {
  const pal = {
    ...EXPLORER_PAL[id],
    s: '#f0c08a', K: '#2a1d14', h: '#9a6a3a', H: '#5e3d1f', b: '#3b2a1a',
    p: '#3e4a6b', o: '#2b2118', k: '#7a6a3a',
  };
  const build = (head, body, legs) => legs.map((l) => outline(pix([...head, ...body, ...l], pal)));
  const side = build(HEAD_SIDE, BODY_SIDE, LEGS_SIDE);
  return {
    down: build(HEAD_FRONT, BODY_FRONT, LEGS_FB),
    up: build(HEAD_BACK, BODY_BACK, LEGS_FB),
    right: side,
    left: side.map(flipH),
  };
}

// ---------- raptor ----------
const RAPTOR_TOP = [
  '...............GGG..',
  '..............GGGGGG',
  '..............GEGGGG',
  'D............GGGGTT.',
  'GD..........GGGG....',
  '.GDG......GGGGGL....',
  '..GDGDGGGGGGGGGL....',
  '....GGDGGDGGGGG.....',
  '......BBBBBBBB......',
];
const RAPTOR_LEGS = [
  ['.......LL...LL......', '......LL.....LL.....', '.....KK.....KK......'],
  ['.........LLL........', '........LL.L........', '.......KK..KK.......'],
];

export function raptorSprites(stunned = false) {
  const pal = stunned
    ? { G: '#c9b84a', D: '#8a7a28', B: '#e8e2a8', E: '#ffffff', T: '#f4f0e0', L: '#9a8a3a', K: '#2e2a20' }
    : { G: '#86a843', D: '#4e6b28', B: '#d2d08e', E: '#ffe14d', T: '#f4f0e0', L: '#5a7a2e', K: '#2e2a20' };
  const right = RAPTOR_LEGS.map((l) => outline(pix([...RAPTOR_TOP, ...l], pal), '#141a0e'));
  return { right, left: right.map(flipH) };
}

// ---------- trees ----------
const TREE_PAL = ['#1f4a2a', '#2f6b3a', '#3f8547', '#5aa55a'];
export function treeSprites() {
  const out = [];
  for (let v = 0; v < 3; v++) {
    const rng = mulberry32(101 + v * 7);
    const w = 22, h = 28;
    const blobs = [
      { x: 11, y: 10, r: 8.5 + rng() },
      { x: 5.5 + rng(), y: 13, r: 5.5 + rng() },
      { x: 16.5 - rng(), y: 13, r: 5.5 + rng() },
      { x: 9 + rng() * 4, y: 5, r: 5 + rng() },
    ];
    const inside = (x, y) => blobs.some((b) => Math.hypot(x + 0.5 - b.x, y + 0.5 - b.y) < b.r);
    const c = gen(w, h, (x, y) => {
      if (inside(x, y) && y < 20) {
        const nx = (x - 11) / 10, ny = (y - 9) / 10;
        let l = -(nx * 0.55 + ny * 0.85) + (rng() - 0.5) * 0.5;
        if (!inside(x, y + 2)) l -= 0.6;
        const i = l > 0.55 ? 3 : l > 0.05 ? 2 : l > -0.5 ? 1 : 0;
        return TREE_PAL[i];
      }
      if (y >= 16 && y < 26 && x >= 9 && x <= 12) return x === 12 ? '#4a321c' : x === 9 ? '#8a6238' : '#6b4a2b';
      return null;
    });
    out.push(outline(c, '#122a18'));
  }
  return out;
}

// ---------- props ----------
export function tentSprite() {
  return outline(gen(30, 20, (x, y) => {
    const half = (y + 1) * 0.75;
    const dx = x - 15;
    if (Math.abs(dx + 0.5) > half) return null;
    if (y > 9 && Math.abs(dx + 0.5) < (y - 9) * 0.45) return '#3a1a10'; // door
    if (y === 19) return '#7a2f18';
    return dx < 0 ? '#e0663a' : '#b84a26';
  }), '#2a120a');
}

export function crateSprite() {
  return outline(pix([
    '..b.....b...',
    '.bbb...bbb..',
    'wwwwwwwwwwww',
    'WddddddddddW',
    'WdWWWWWWWWdW',
    'WddddddddddW',
    'WdWWWWWWWWdW',
    'WddddddddddW',
  ], { b: '#f1e6c8', w: '#a8784a', W: '#5e3d22', d: '#8a5f36' }));
}

export function fireFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const rng = mulberry32(900 + f);
    const heights = Array.from({ length: 10 }, (_, x) => {
      const bell = 1 - Math.abs(x - 4.5) / 5;
      return Math.max(0, bell * 11 + (rng() - 0.5) * 4);
    });
    frames.push(gen(10, 14, (x, y) => {
      if (y >= 11) return (x + y) % 3 === 0 ? '#3a2614' : (y === 11 ? '#7a5230' : '#5e3d22');
      const hgt = heights[x];
      const fromBottom = 11 - y;
      if (fromBottom > hgt) return null;
      const t = fromBottom / Math.max(1, hgt);
      if (t < 0.35 && Math.abs(x - 4.5) < 2.5) return '#fff3b0';
      if (t < 0.65) return '#ffc53d';
      if (t < 0.9) return '#ff7a1a';
      return '#d0381a';
    }));
  }
  return frames;
}

export function moundSprite() {
  return gen(16, 9, (x, y) => {
    const nx = (x - 7.5) / 8, ny = (y - 5) / 4.5;
    const d = nx * nx + ny * ny;
    if (d > 1) return null;
    if (d > 0.75) return '#4a2e18';
    return ny < -0.2 ? '#a8713e' : (x + y) % 4 === 0 ? '#6e4424' : '#8a5a33';
  });
}

export function holeSprite() {
  return gen(14, 8, (x, y) => {
    const nx = (x - 6.5) / 7, ny = (y - 4) / 4;
    const d = nx * nx + ny * ny;
    if (d > 1) return null;
    if (d > 0.6) return ny < 0 ? '#4a2e18' : '#8a5a33';
    return '#24160c';
  });
}

export const boneSprite = (col = '#f4ead2') => pix(['bb...bb', '.bbbbb.', 'bb...bb'], { b: col });

export const trapSprite = () => outline(pix([
  '.t.t.t.t.',
  'ttttttttt',
  't..ggg..t',
  'ttttttttt',
], { t: '#b8b8b0', g: '#6a6a64' }));

export const heartSprite = (full) => pix([
  '.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...',
], { r: full ? '#ff5a5a' : '#4a3a3a' });

export const sunSprite = () => gen(9, 9, (x, y) => {
  const d = Math.hypot(x - 4, y - 4);
  if (d < 2.6) return '#ffe08a';
  if (d < 4.6 && (x === 4 || y === 4 || x === y || x + y === 8)) return '#ffc53d';
  return null;
});

export const moonSprite = () => gen(9, 9, (x, y) => {
  const d = Math.hypot(x - 4, y - 4), cut = Math.hypot(x - 6, y - 3);
  return d < 4 && cut > 3 ? '#cfd8ff' : null;
});

export const shadowSprite = (w, h) => gen(w, h, (x, y) => {
  const nx = (x + 0.5 - w / 2) / (w / 2), ny = (y + 0.5 - h / 2) / (h / 2);
  return nx * nx + ny * ny <= 1 ? 'rgba(10,14,6,0.35)' : null;
});

export const tuftSprite = () => pix([
  'l..l.l..l..l.',
  'l.ll.l.ll.ll.',
  'dldl.ldldldld',
  'ddddddddddddd',
], { l: '#6aa04a', d: '#2f5a24' });

// ---------- more dinosaurs ----------
function dinoSet(top, legs, pal, line) {
  const right = legs.map((l) => outline(pix([...top, ...l], pal), line));
  return { right, left: right.map(flipH) };
}
function withStun(build) {
  return { normal: build(false), stun: build(true) };
}
const STUN_PAL = { G: '#c9b84a', D: '#8a7a28', B: '#e8e2a8', E: '#ffffff', F: '#e8d870', L: '#9a8a3a' };

export const compySprites = () => withStun((stun) => dinoSet([
  '........GG..',
  '.......GEGG.',
  'D.....GGG...',
  '.DGGDGGG....',
  '...BBBB.....',
], [
  ['...L..L.....', '..K..K......'],
  ['....LL......', '....KK......'],
], { G: '#c9a84a', D: '#8a6a28', B: '#efe2a8', E: '#1a1a1a', L: '#7a6028', K: '#2e2a20', ...(stun ? STUN_PAL : {}) }, '#1e1608'));

export const spitterSprites = () => withStun((stun) => dinoSet([
  '..............FF..',
  '............FFGGG.',
  '...........FFGEGGG',
  'D...........GGGTT.',
  'GD.........GGG....',
  '.GDG.....GGGGGL...',
  '..GDGDGGGGGGGGL...',
  '....GGDGGDGGGG....',
  '......BBBBBBB.....',
], [
  ['.......LL..LL.....', '......LL....LL....', '.....KK....KK.....'],
  ['........LLL.......', '.......LL.L.......', '......KK..KK......'],
], { G: '#4a9a8e', D: '#2a5e58', F: '#e8506e', B: '#cde6c4', E: '#ffe14d', T: '#f4f0e0', L: '#336e66', K: '#1e2a28', ...(stun ? STUN_PAL : {}) }, '#0e1e1c'));

export const rexSprites = () => withStun((stun) => dinoSet([
  '.......................GGGGGG.....',
  '.....................GGGGGGGGGG...',
  '.....................GGEGGGGGGGGG.',
  '....................GGGGGGGGGGGGGG',
  '....................GGGGGTTTTTTTT.',
  '....................GGGG..T.T.T...',
  '...................GGGGGGGGGG.....',
  'D.................GGGGGGGG........',
  'GD..............GGGGGGGGa.........',
  '.GDG.........GGGGGGGGGGa..........',
  '..GDGG....GGGGGGGGGGGGG...........',
  '...GGDGGDGGGGDGGGDGGGGG...........',
  '.....GGGDGGGGGGGGGGGGG............',
  '.......GGBBBBBBBBBGGG.............',
  '.........BBBBBBBBBG...............',
], [
  ['..........LLLL..LLLL..............', '..........LLL....LLL..............', '...........LL.....LL..............', '...........LL.....LL..............', '..........KKK....KKK..............'],
  ['...........LLLLLLLL...............', '............LLL.LL................', '............LL..LL................', '...........LL...LL................', '..........KKK..KKK................'],
], { G: '#7a6040', D: '#4a3a28', B: '#c8b08a', E: '#ff3a2a', T: '#f4f0e0', a: '#5a4630', L: '#5a4630', K: '#2a2018', ...(stun ? STUN_PAL : {}) }, '#140e08'));

export const woodSprite = () => pix(['.wwwww.', 'wWwwwwo', '.wwwww.'], { w: '#8a5f36', W: '#6e4a2a', o: '#d9b07a' });

export const amberSprite = () => outline(pix(['.aa.', 'aAaa', 'aaAa', '.aa.'], { a: '#e88a1a', A: '#ffd27a' }), '#4a2408');

export const spitSprite = () => pix(['.g.', 'ggg', '.g.'], { g: '#9ef04a' });

export const woodPileSprite = (n) => gen(14, 8, (x, y) => {
  const rows = Math.min(n, 4);
  const layer = Math.floor((7 - y) / 2);
  if (layer >= rows || y > 7) return null;
  const off = layer % 2 ? 2 : 0;
  if (x < off || x > 13 - (layer % 2 ? 2 : 0)) return null;
  if ((x - off) % 5 === 4) return '#d9b07a';
  return y % 2 ? '#6e4a2a' : '#8a5f36';
});

// ---------- structures and gear ----------
export const wallSprite = () => outline(gen(16, 20, (x, y) => {
  const post = x % 4;
  const top = post === 1 || post === 2 ? 0 : 2;
  if (y < top) return null;
  if (y >= 17) return '#3a2614';
  if (y === 8 || y === 13) return '#5e3d22'; // lashings
  return post === 0 ? '#6e4a2a' : post === 3 ? '#5a3a20' : y < 3 ? '#b88a52' : '#8a5f36';
}), '#1e1408');

export const spikeSprite = () => outline(gen(16, 20, (x, y) => {
  const post = x % 4;
  const tip = Math.abs(post - 1.5) * 2.2;
  if (y < tip) return null;
  if (y < 4) return '#d8d0b8';
  if (y >= 17) return '#3a2614';
  if (y === 10) return '#5e3d22';
  return post === 0 ? '#6e4a2a' : post === 3 ? '#5a3a20' : '#8a5f36';
}), '#1e1408');

export const stoneWallSprite = () => outline(gen(16, 18, (x, y) => {
  const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;
  if ((x + off) % 8 === 0 || y % 4 === 0) return '#4a463e';
  return y < 4 ? '#a59c8a' : (x + row) % 5 === 0 ? '#77705f' : '#8d8577';
}), '#1a1814');

export function torchFrames() {
  return [0, 1, 2].map((f) => outline(gen(7, 16, (x, y) => {
    if (y >= 6) return x === 3 ? (y > 13 ? '#3a2614' : '#6e4a2a') : null;
    const w = [1, 2, 3, 2, 1, 1][y] + (f === 1 && y === 2 ? 1 : 0);
    if (Math.abs(x - 3 - (f === 2 && y < 3 ? 1 : 0)) > w - 1) return null;
    return y < 2 ? '#fff3b0' : y < 4 ? '#ffc53d' : '#ff7a1a';
  }), '#2a1408'));
}

export const stoneSprite = () => pix(['.sss.', 'sSsss', '.sss.'], { s: '#8d8577', S: '#bdb39e' });

const ICON_ROWS = {
  axe: ['..mm.....', '.mmmm....', '..mmw....', '....w....', '....w....', '....w....', '....w....'],
  pickaxe: ['.mmmmmm..', 'm...w..m.', '....w....', '....w....', '....w....', '....w....', '....w....'],
  spear: ['.......m.', '......mm.', '.....w...', '....w....', '...w.....', '..w......', '.w.......'],
  sling: ['w.....w..', '.w...w...', '..w.w....', '...s.....', '..sss....', '...s.....', '.........'],
  flare: ['...f.....', '..fyf....', '...f.....', '..rrr....', '..rrr....', '..rrr....', '..rrr....'],
};
export function iconSprites() {
  const pal = { m: '#c8c8c0', w: '#8a5f36', s: '#8d8577', f: '#ff7a1a', y: '#fff3b0', r: '#d0381a' };
  return Object.fromEntries(Object.entries(ICON_ROWS).map(([k, rows]) => [k, outline(pix(rows, pal))]));
}

export const workbenchSprite = () => outline(pix([
  '...m....s.......',
  '..mmm..sss......',
  'wwwwwwwwwwwwwwww',
  'WWWWWWWWWWWWWWWW',
  '.l..........l...',
  '.l..........l...',
  '.l..........l...',
  '.ll........ll...',
], { m: '#c8c8c0', s: '#8d8577', w: '#b88a52', W: '#6e4a2a', l: '#5a3a20' }), '#1e1408');

export const workshopSprite = () => outline(pix([
  '....aaaaaa......',
  '.....aaaa...ff..',
  '....aaaaaa.fyf..',
  'ssssssssssssssss',
  'SgSSgSSSgSSgSSgS',
  'SSSSSSSSSSSSSSSS',
  'SgSSSgSSSSgSSSgS',
  'SSSSSSSSSSSSSSSS',
], { a: '#5a5a62', f: '#ff7a1a', y: '#fff3b0', s: '#a59c8a', S: '#8d8577', g: '#5d574d' }), '#1a1814');
