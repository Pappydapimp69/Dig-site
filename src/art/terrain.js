// Pre-renders the whole island once per run at 16 px per tile.
// Ground boundaries are displaced by smooth noise so the tile grid disappears;
// collision still uses the exact tiles.
import { T } from '../world.js';
import { mulberry32 } from '../rng.js';
import { CFG } from '../data.js';

export const S = 16; // screen px per tile (world tiles are 32 units, so scale 0.5)

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const P = Object.fromEntries(Object.entries({
  deep: '#24507e', water: '#2f6596', shallow: '#3f84ae', shallow2: '#57a0c0',
  sand: '#e0c98f', sandL: '#ecd9a6', sandD: '#cdb173', wet: '#b59a62',
  grass: '#4f8a3c', grassL: '#62a046', grassD: '#3f7330', flowerW: '#f4f0e0', flowerY: '#ffd84d',
  tall: '#3c6c2e', tallL: '#5c9440', tallD: '#2a5022',
  dirt: '#9a6c40', dirtL: '#b07e4c', dirtD: '#7e5432',
  rock: '#8d8577', rockL: '#a59c8a', rockH: '#bdb39e', rockD: '#77705f', rockE: '#6b6557',
  face: '#5d574d', faceD: '#443f38', faceB: '#2f2b26',
}).map(([k, v]) => [k, hex(v)]));

function noise(rng, cell, w, h) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh).map(() => rng());
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = sm(fx - ix), ty = sm(fy - iy);
    const i = iy * gw + ix;
    const a = g[i] + (g[i + 1] - g[i]) * tx;
    const b = g[i + gw] + (g[i + gw + 1] - g[i + gw]) * tx;
    return a + (b - a) * ty;
  };
}

const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function buildTerrain(world, seed) {
  const W = world.w * S, H = world.h * S;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const nx = noise(rng, 11, W, H), ny = noise(rng, 11, W, H), patch = noise(rng, 40, W, H);
  const rockN = noise(rng, 6, W, H), crackN = noise(rng, 18, W, H);

  const tile = (tx, ty) => (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h ? T.WATER : world.tiles[ty * world.w + tx]);
  // Ground type under rocks and trees is grass.
  const ground = (px, py) => {
    const t = tile(Math.floor(px / S), Math.floor(py / S));
    return t === T.ROCK || t === T.TREE ? T.GRASS : t;
  };
  // Distance (in tiles, capped) from each water tile to land, for shallow bands.
  const landDist = new Uint8Array(world.w * world.h).fill(9);
  for (let ty = 0; ty < world.h; ty++) {
    for (let tx = 0; tx < world.w; tx++) {
      if (tile(tx, ty) !== T.WATER) { landDist[ty * world.w + tx] = 0; continue; }
      let best = 9;
      for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
        const t = tile(tx + ox, ty + oy);
        if (t !== T.WATER && tx + ox >= 0 && ty + oy >= 0 && tx + ox < world.w && ty + oy < world.h) {
          best = Math.min(best, Math.max(Math.abs(ox), Math.abs(oy)));
        }
      }
      landDist[ty * world.w + tx] = best;
    }
  }
  const camp = { x: world.camp.x / 2, y: world.camp.y / 2 };
  const campR = CFG.campR / 2 + 6;

  const put = (i, col) => { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const ox = (nx(px, py) - 0.5) * 9, oy = (ny(px, py) - 0.5) * 9;
      const sx = px + ox, sy = py + oy;
      const t = ground(sx, sy);
      const h = hash(px, py);
      let col;
      if (t === T.WATER) {
        const ld = landDist[Math.floor(sy / S) * world.w + Math.floor(sx / S)] ?? 9;
        const shore = ground(sx + 5, sy) !== T.WATER || ground(sx - 5, sy) !== T.WATER ||
          ground(sx, sy + 5) !== T.WATER || ground(sx, sy - 5) !== T.WATER;
        col = shore ? P.shallow2 : ld <= 1 ? P.shallow : ld <= 3 ? P.water : P.deep;
        if (h < 0.01) col = P.shallow;
      } else if (t === T.SAND) {
        const wet = ground(sx + 3, sy) === T.WATER || ground(sx - 3, sy) === T.WATER ||
          ground(sx, sy + 3) === T.WATER || ground(sx, sy - 3) === T.WATER;
        col = wet ? P.wet : h < 0.1 ? P.sandD : h > 0.92 ? P.sandL : P.sand;
      } else if (t === T.TALL) {
        const lean = Math.floor(hash(px, 7) * 5);
        const blade = (py + lean) % 5;
        col = blade === 0 ? P.tallL : blade === 1 && h < 0.6 ? P.tallL : h < 0.15 ? P.tallD : P.tall;
      } else {
        const p = patch(px, py);
        col = h < 0.07 ? P.grassD : h > 0.93 ? P.grassL : p > 0.7 && h < 0.5 ? P.grassL : p < 0.25 && h < 0.5 ? P.grassD : P.grass;
        if (h > 0.9975) col = P.flowerW;
        else if (h > 0.995) col = P.flowerY;
      }
      const dc = Math.hypot(px - camp.x, py - camp.y) + (nx(px, py) - 0.5) * 8;
      if (dc < campR) col = h < 0.12 ? P.dirtD : h > 0.9 ? P.dirtL : P.dirt;
      put(i, col);
    }
  }

  // Tree shadows.
  const darken = (px, py, f) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const i = (py * W + px) * 4;
    d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
  };
  for (let ty = 0; ty < world.h; ty++) {
    for (let tx = 0; tx < world.w; tx++) {
      if (tile(tx, ty) !== T.TREE) continue;
      const cx = tx * S + 9, cy = ty * S + 14;
      for (let y = -4; y <= 4; y++) for (let x = -10; x <= 10; x++) {
        if ((x / 10) ** 2 + (y / 4) ** 2 <= 1) darken(cx + x, cy + y, 0.72);
      }
    }
  }

  // Rocks as raised plateaus with a lit rim and a south cliff face.
  for (let ty = 0; ty < world.h; ty++) {
    for (let tx = 0; tx < world.w; tx++) {
      if (tile(tx, ty) !== T.ROCK) continue;
      const up = tile(tx, ty - 1) === T.ROCK, down = tile(tx, ty + 1) === T.ROCK;
      const left = tile(tx - 1, ty) === T.ROCK, right = tile(tx + 1, ty) === T.ROCK;
      const faceRows = down ? 0 : 6;
      for (let ly = 0; ly < S; ly++) {
        for (let lx = 0; lx < S; lx++) {
          const px = tx * S + lx, py = ty * S + ly;
          const h = hash(px, py);
          let col;
          if (ly >= S - faceRows) {
            col = ly === S - 1 ? P.faceB : (lx + ty * 3) % 6 === 0 || h < 0.08 ? P.faceD : P.face;
          } else {
            const rn = rockN(px, py) + (h - 0.5) * 0.15;
            col = rn > 0.66 ? P.rockL : rn < 0.36 ? P.rockD : P.rock;
            if (Math.abs(crackN(px, py) - 0.5) < 0.018) col = P.faceD;
            else if (rn > 0.66 && rockN(px - 1, py - 1) < 0.66) col = P.rockH;
            if (!up && ly === 0) col = P.rockH;
            else if (!left && lx === 0) col = P.rockL;
            else if (!right && lx === S - 1) col = P.rockE;
          }
          put((py * W + px) * 4, col);
        }
      }
      if (!down) for (let ly = 0; ly < 4; ly++) for (let lx = 0; lx < S; lx++) darken(tx * S + lx, (ty + 1) * S + ly, 0.6 + ly * 0.1);
    }
  }

  g.putImageData(img, 0, 0);
  return c;
}

// Water tiles touching land, for animated foam.
export function shoreTiles(world) {
  const out = [];
  const t = (x, y) => (x < 0 || y < 0 || x >= world.w || y >= world.h ? T.WATER : world.tiles[y * world.w + x]);
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (t(x, y) !== T.WATER) continue;
      const n = t(x, y - 1) !== T.WATER, s = t(x, y + 1) !== T.WATER, w = t(x - 1, y) !== T.WATER, e = t(x + 1, y) !== T.WATER;
      if (n || s || w || e) out.push({ x, y, n, s, w, e });
    }
  }
  return out;
}
