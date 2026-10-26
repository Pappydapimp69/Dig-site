import { SPECIES } from './data.js';

export const TILE = 32;
export const T = { WATER: 0, SAND: 1, GRASS: 2, TALL: 3, ROCK: 4, TREE: 5 };
export const SOLID = new Set([T.WATER, T.ROCK, T.TREE]);

function valueNoise(rng, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => rng());
  const smooth = (t) => t * t * (3 - 2 * t);
  const v = (i, j) => g[j * gw + i];
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx;
    const b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function pickSpecies(rng) {
  const total = SPECIES.reduce((n, s) => n + s.weight, 0);
  let roll = rng() * total;
  for (const s of SPECIES) {
    roll -= s.weight;
    if (roll < 0) return s.id;
  }
  return SPECIES[0].id;
}

// Flood fill from the camp over walkable tiles. Anything we place (dig sites,
// raptor spawns) must be on a reached tile, or the player can't get to it.
function flood(tiles, w, h, sx, sy) {
  const reach = new Uint8Array(w * h);
  const q = [sy * w + sx];
  reach[q[0]] = 1;
  while (q.length) {
    const i = q.pop();
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (reach[j] || SOLID.has(tiles[j])) continue;
      reach[j] = 1;
      q.push(j);
    }
  }
  return reach;
}

function tryWorld(rng, w, h, { extraSites = 0, amberChance = 0 } = {}) {
  const n1 = valueNoise(rng, w, h, 10);
  const n2 = valueNoise(rng, w, h, 4);
  const veg = valueNoise(rng, w, h, 5);
  const tiles = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2;
  const ctx = Math.floor(cx), cty = Math.floor(cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / cx, dy = (y - cy) / cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const e = n1(x, y) * 0.65 + n2(x, y) * 0.35 - d * d * 0.9 + 0.3;
      const v = veg(x, y);
      let t;
      if (e < 0.2) t = T.WATER;
      else if (e < 0.28) t = T.SAND;
      else if (e > 0.88) t = T.ROCK;
      else if (v > 0.66) t = T.TREE;
      else if (v > 0.52) t = T.TALL;
      else t = T.GRASS;
      // Clear the camp.
      if (Math.hypot(x - ctx, y - cty) < 5) t = T.GRASS;
      tiles[y * w + x] = t;
    }
  }

  const reach = flood(tiles, w, h, ctx, cty);
  const open = [];
  for (let i = 0; i < w * h; i++) if (reach[i]) open.push(i);

  const camp = { x: (ctx + 0.5) * TILE, y: (cty + 0.5) * TILE };
  const tdist = (i) => Math.hypot((i % w) - ctx, ((i / w) | 0) - cty);

  const sites = [];
  const candidates = open.filter((i) => tdist(i) > 8);
  const target = 14 + extraSites;
  for (let tries = 0; tries < 3000 && sites.length < target; tries++) {
    const i = rng.pick(candidates);
    if (i === undefined) break;
    const x = ((i % w) + 0.5) * TILE, y = (((i / w) | 0) + 0.5) * TILE;
    if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < TILE * 6)) continue;
    // Only draw from the rng when amber is possible, so amber-free islands
    // generate exactly as before.
    if (amberChance > 0 && rng() < amberChance) sites.push({ x, y, species: 'amber', bones: 1 });
    else sites.push({ x, y, species: pickSpecies(rng), bones: rng.int(2, 4) });
  }

  const spawns = open.filter((i) => tdist(i) > 16);
  return { w, h, tiles, reach, camp, sites, spawns, openCount: open.length };
}

export function makeWorld(rng, w = 80, h = 60, opts = {}) {
  let world;
  for (let i = 0; i < 20; i++) {
    world = tryWorld(rng, w, h, opts);
    if (world.openCount > 900 && world.sites.length >= 10 && world.spawns.length > 50) return world;
  }
  return world;
}

export function tileAt(world, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return T.WATER;
  return world.tiles[ty * world.w + tx];
}

export const solidAt = (world, px, py) => SOLID.has(tileAt(world, px, py));

export function blocked(world, x, y, r) {
  return solidAt(world, x - r, y - r) || solidAt(world, x + r, y - r) ||
    solidAt(world, x - r, y + r) || solidAt(world, x + r, y + r);
}

// Is there a tile of this type within r of (x, y)? Returns its centre or null.
export const treeNear = (world, x, y, r) => tileNear(world, x, y, r, T.TREE);

export function tileNear(world, x, y, r, type) {
  const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) continue;
      if (world.tiles[ty * world.w + tx] !== type) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (Math.hypot(cx - x, cy - y) < r + TILE / 2) return { x: cx, y: cy };
    }
  }
  return null;
}

export function spawnPoint(world, rng) {
  const i = rng.pick(world.spawns);
  return { x: ((i % world.w) + 0.5) * TILE, y: (((i / world.w) | 0) + 0.5) * TILE };
}
