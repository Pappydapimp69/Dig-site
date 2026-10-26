// Pure simulation: no DOM, so it runs in tests and in the browser alike.
import { mulberry32 } from './rng.js';
import { makeWorld, blocked, tileAt, spawnPoint, treeNear, tileNear, T, TILE } from './world.js';
import { CFG, DINOS, TRAITS, TRAIT_POOL, FOSSILS, BUILDS, buildById, speciesById } from './data.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function stats(up = {}, perks = []) {
  const has = (id) => perks.includes(id);
  return {
    cap: CFG.baseCap + (up.bag || 0),
    digTime: CFG.digTime * Math.pow(0.8, up.dig || 0) * (has('herra') ? 0.85 : 1),
    speed: CFG.speed * (1 + 0.1 * (up.boots || 0)) * (has('raptor') ? 1.1 : 1),
    traps: CFG.baseTraps + (up.traps || 0),
    fireR: (CFG.fireR + 30 * (up.fire || 0)) * (has('rex') ? 1.25 : 1),
    hp: CFG.hp + (up.medkit || 0) + (has('stego') ? 1 : 0),
    lantern: 1 + 0.25 * (up.lantern || 0),
    stun: CFG.stunTime + (has('trike') ? 1.5 : 0),
  };
}

export const tierFor = (requestsDone) => Math.min(6, Math.floor(requestsDone / CFG.requestsPerTier));

// How many of each kind hunt on night n. Nights never stop, so it keeps
// climbing (with caps); a rex comes every third night.
export function nightRoster(n, tier = 0, trait = {}) {
  return {
    raptor: Math.min(12, 1 + 2 * n + tier + (trait.extraRaptors || 0)),
    spitter: n >= 2 ? Math.min(5, n - 1 + Math.floor(tier / 2)) : 0,
    rex: n % 3 === 0 || (tier >= 2 && n >= 2 && n % 3 === 2) ? 1 + Math.floor(n / 9) : 0,
  };
}

// Requests chain: fill one and the next appears. idx is the lifetime count,
// so they grow with you across runs.
function pickContract(world, rng, idx, valueMult) {
  const avail = {};
  for (const s of world.sites) if (s.species !== 'amber') avail[s.species] = (avail[s.species] || 0) + s.bones;
  const want = Math.min(8, 3 + Math.floor(idx / 2));
  let options = FOSSILS.filter((f) => (avail[f.id] || 0) >= want);
  if (!options.length) options = FOSSILS.filter((f) => (avail[f.id] || 0) >= 2);
  if (!options.length) return null;
  const sp = options[Math.floor(rng() * options.length)];
  const need = Math.min(avail[sp.id], want);
  return {
    sp: sp.id, need, have: 0, idx, done: false,
    bonus: Math.round(need * sp.value * CFG.requestBonus * valueMult),
    unlock: BUILDS.find((b) => b.unlock === idx + 1)?.id || null,
  };
}

export function newRun({ seed = 1, players = 1, upgrades = {}, perks = [], requestsDone = 0, tier, trait, tutorial = false } = {}) {
  const rng = mulberry32(seed);
  // Island trait and first request use their own stream so they never shift the world.
  const side = mulberry32((seed ^ 0x2545f491) >>> 0);
  const traitId = tutorial ? 'none' : trait ?? TRAIT_POOL[Math.floor(side() * TRAIT_POOL.length)];
  const tr = TRAITS[traitId];
  const world = makeWorld(rng, 80, 60, {
    extraSites: tr.extraSites || 0,
    amberChance: tr.amberChance ?? CFG.amberChance,
  });
  const st = stats(upgrades, perks);
  const t = tier ?? tierFor(requestsDone);
  const valueMult = 1 + CFG.tierValue * t;
  const ps = [];
  for (let i = 0; i < players; i++) {
    ps.push({
      id: i, x: world.camp.x + (players > 1 ? (i ? 18 : -18) : 0), y: world.camp.y + 30,
      hp: st.hp, carry: [], digT: 0, chopT: 0, mineT: 0, down: false, reviveT: 0, invuln: 0, slow: 0,
      traps: st.traps, held: {}, moving: false, fx: 0, fy: 1, atkCd: 0, swing: 0,
      // build: null, { mode: 'menu', sel } while choosing, or { mode: 'place', id } with a ghost out.
      build: null, lastSel: 0,
    });
  }
  return {
    seed, rng, world, st, players: ps, dinos: [], traps: [], drops: [], spits: [], shots: [], flares: [],
    structures: [], structAt: new Map(), stock: { wood: 0, stone: 0 }, owned: {},
    trait: traitId, tier: t, valueMult,
    // The tutorial borrows the first few unlocks (wall, spear) to teach building.
    reqBase: tutorial ? 3 : requestsDone, requestsFilled: 0, unlocked: [],
    contract: tutorial ? null : pickContract(world, side, requestsDone, valueMult),
    phase: 'day', t: 0, night: 0, fire: st.fireR, fuel: 1, time: 0,
    dayLen: CFG.dayLen, nightLen: tutorial ? 30 : CFG.nightLen, nights: tutorial ? 1 : Infinity,
    // Tutorial: one short night, one raptor, no deaths, and the day waits
    // (hold) until the tutorial overlay says it's time for dusk.
    tutorial: tutorial ? { hold: true } : null,
    banked: {}, bankedCount: 0, amber: 0, funding: 0, payout: 0,
    over: false, result: null, events: [],
  };
}

// ---------- structures ----------

const unlockLevel = (s) => s.reqBase + s.requestsFilled;
const keyOf = (s, tx, ty) => ty * s.world.w + tx;

// What this player can build right now, in menu order.
export function buildList(s) {
  const lvl = unlockLevel(s);
  return BUILDS.filter((b) => b.unlock <= lvl && !((b.kind === 'tool' || b.kind === 'weapon') && s.owned[b.id]));
}

export const canAfford = (s, b) => Object.entries(b.cost).every(([k, n]) => (s.stock[k] || 0) >= n);

// Best crafting table level within reach of this player (0 = none).
export function stationLevel(s, p) {
  let lvl = 0;
  for (const st of s.structures) {
    const b = buildById[st.kind];
    if (b.station && b.station > lvl && dist(st, p) < CFG.stationR) lvl = b.station;
  }
  return lvl;
}
export const hasStation = (s, p, b) => !b.needs || stationLevel(s, p) >= b.needs;

// The tile in front of the player, and whether a structure can go there.
export function buildTarget(s, p) {
  // Always the neighbouring tile in the facing direction (8-way), never the
  // tile you stand on.
  const sx = Math.abs(p.fx) > 0.38 ? Math.sign(p.fx) : 0;
  const sy = Math.abs(p.fy) > 0.38 ? Math.sign(p.fy) : 0;
  const tx = Math.floor(p.x / TILE) + (sx || sy ? sx : 0);
  const ty = Math.floor(p.y / TILE) + (sx || sy ? sy : 1);
  const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
  const onTile = (q) => !q.down && Math.floor(q.x / TILE) === tx && Math.floor(q.y / TILE) === ty;
  let why = null;
  if (tx < 0 || ty < 0 || tx >= s.world.w || ty >= s.world.h || blocked(s.world, x, y, 2)) why = 'blocked';
  else if (s.players.some(onTile)) why = 'player';
  else if (s.structAt.has(keyOf(s, tx, ty))) why = 'taken';
  else if (dist({ x, y }, s.world.camp) < 40) why = 'fire';
  else if (s.world.sites.some((st) => st.bones > 0 && dist(st, { x, y }) < TILE * 0.7)) why = 'site';
  return { tx, ty, x, y, ok: !why, why };
}

function placeStructure(s, b, tg) {
  const st = { kind: b.id, tx: tg.tx, ty: tg.ty, x: tg.x, y: tg.y, hp: b.hp || 1, maxHp: b.hp || 1, solid: !!b.solid, life: b.id === 'torch' ? CFG.torchLife : 0 };
  s.structures.push(st);
  s.structAt.set(keyOf(s, tg.tx, tg.ty), st);
  return st;
}

function removeStructure(s, st) {
  s.structures = s.structures.filter((x) => x !== st);
  s.structAt.delete(keyOf(s, st.tx, st.ty));
}

const solidAt = (s, x, y) => {
  const st = s.structAt.get(keyOf(s, Math.floor(x / TILE), Math.floor(y / TILE)));
  return st && st.solid ? st : null;
};
// A wall blocks the middle of its tile (structR each way), so you can see it's a post.
function wallHit(s, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]]) {
    const st = solidAt(s, x + ox, y + oy);
    if (st && Math.abs(x - st.x) < CFG.structR + r && Math.abs(y - st.y) < CFG.structR + r) return st;
  }
  return null;
}

// Building, crafting and using all go through here. Returns an event type.
function act(s, p, b) {
  if (!hasStation(s, p, b)) return 'needstation';
  if (!canAfford(s, b)) return 'cantafford';
  if (b.kind === 'place') {
    const tg = buildTarget(s, p);
    if (b.id === 'snare') {
      if (tg.why === 'blocked' || tg.why === 'player') return 'cantbuild';
      s.traps.push({ x: tg.x, y: tg.y, armed: true });
    } else {
      if (!tg.ok) return 'cantbuild';
      placeStructure(s, b, tg);
    }
  } else if (b.kind === 'tool' || b.kind === 'weapon') {
    s.owned[b.id] = true;
  } else if (b.id === 'flare') {
    s.flares.push({ x: p.x, y: p.y, t: b.time });
    for (const r of s.dinos) {
      if (dist(r, p) < b.scareR) { r.scared = b.time; r.fleeFrom = { x: p.x, y: p.y }; if (r.carry) { dropItem(s, r.x, r.y, r.carry); r.carry = null; } }
    }
  }
  for (const [k, n] of Object.entries(b.cost)) s.stock[k] -= n;
  return 'built';
}

// ---------- shared helpers ----------

// Move along each axis separately so you slide along walls.
function move(world, e, dx, dy, r, s = null) {
  let hit = false;
  const stop = (x, y) => blocked(world, x, y, r) || (s && wallHit(s, x, y, r));
  if (!stop(e.x + dx, e.y)) e.x += dx; else hit = true;
  if (!stop(e.x, e.y + dy)) e.y += dy; else hit = true;
  return hit;
}

const fireScares = (s) => s.phase === 'night' && s.fire > CFG.fireSafeMin;
const inFire = (s, p) => fireScares(s) && dist(p, s.world.camp) < s.fire;
const traitOf = (s) => TRAITS[s.trait];
const litTorches = (s) => s.structures.filter((x) => x.kind === 'torch' && x.life > 0);

function spawn(s, kind) {
  const sp = spawnPoint(s.world, s.rng);
  const d = {
    kind, x: sp.x, y: sp.y, heading: s.rng.range(-Math.PI, Math.PI), hp: DINOS[kind].hp,
    wanderH: 0, wanderT: 0, stun: 0, cd: 0, mode: 'wander', carry: null, stealCd: 0, spitCd: 1, scared: 0,
  };
  s.dinos.push(d);
  return d;
}

function dropItem(s, x, y, item) {
  const a = s.rng() * Math.PI * 2;
  s.drops.push({ x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 10, item });
}

function startNight(s) {
  s.phase = 'night';
  s.t = 0;
  s.night++;
  const burn = Math.min(CFG.duskBurn, s.stock.wood);
  s.stock.wood -= burn;
  s.fuel = 1 + burn * CFG.woodFuel;
  s.fire = s.st.fireR;
  for (const p of s.players) p.traps = s.st.traps;
  for (const st of s.structures) if (st.kind === 'torch') st.life = CFG.torchLife;
  // Compies scatter at dusk, dropping anything they stole.
  for (const d of s.dinos) if (d.carry) dropItem(s, d.x, d.y, d.carry);
  s.dinos = [];
  const roster = s.tutorial ? { raptor: 1 } : nightRoster(s.night, s.tier, traitOf(s));
  for (const [kind, n] of Object.entries(roster)) for (let i = 0; i < n; i++) spawn(s, kind);
  s.events.push({ type: 'night', n: s.night, burned: burn });
  if (roster.rex) s.events.push({ type: 'rexwarn' });
}

function endNight(s) {
  s.dinos = [];
  s.spits = [];
  if (s.night >= s.nights) return finish(s, 'won');
  s.phase = 'day';
  s.t = 0;
  s.fire = s.st.fireR;
  s.fuel = 1;
  // From day 2, compies come looking for bones to steal.
  for (let i = 0; i < 3 + s.tier; i++) spawn(s, 'compy');
  s.events.push({ type: 'dawn', n: s.night });
}

// result: 'left' (took the boat by day), 'lost' (everyone down), 'won' (tutorial).
export function finish(s, result) {
  if (s.over) return;
  s.over = true;
  s.result = result;
  for (const p of s.players) p.carry = [];
  if (result === 'left') s.payout = Math.round(s.funding * (1 + CFG.leaveBonus * s.night));
  else if (result === 'lost') s.payout = Math.round(s.funding * CFG.deathKeep);
  else s.payout = Math.round(s.funding * CFG.winBonus);
  s.events.push({ type: result });
}

// The boat only comes by day.
export function leave(s) {
  if (s.over || s.phase !== 'day' || s.tutorial) return false;
  finish(s, 'left');
  return true;
}

function hurt(s, p, dmg, from) {
  p.hp -= dmg;
  p.invuln = CFG.invuln;
  if (from) {
    const a = Math.atan2(p.y - from.y, p.x - from.x);
    move(s.world, p, Math.cos(a) * 24, Math.sin(a) * 24, CFG.pr);
  }
  s.events.push({ type: 'hurt', id: p.id });
  if (p.hp <= 0 && s.tutorial) {
    // No failing the tutorial: wake up back at camp.
    p.hp = s.st.hp;
    p.x = s.world.camp.x;
    p.y = s.world.camp.y + 20;
    p.invuln = 2;
    s.events.push({ type: 'rescued', id: p.id });
  } else if (p.hp <= 0) {
    p.down = true;
    p.digT = p.chopT = p.mineT = 0;
    p.build = null;
    // Bones spill on the ground; a partner can grab them.
    for (const it of p.carry) dropItem(s, p.x, p.y, it);
    p.carry = [];
    s.events.push({ type: 'down', id: p.id });
  }
}

// A dinosaur at 0 hp is routed: it runs off and leaves for the night.
function hitDino(s, r, dmg, from, stun = 0, knock = 30) {
  r.hp -= dmg;
  r.stun = Math.max(r.stun, stun * (DINOS[r.kind].stunScale || 1));
  const a = Math.atan2(r.y - from.y, r.x - from.x);
  move(s.world, r, Math.cos(a) * knock, Math.sin(a) * knock, DINOS[r.kind].r, s);
  if (r.carry) { dropItem(s, r.x, r.y, r.carry); r.carry = null; }
  s.events.push({ type: 'hit', kind: r.kind });
  if (r.hp <= 0 && !r.routed) {
    r.routed = true;
    r.stun = 0;
    r.fleeFrom = { x: from.x, y: from.y };
    s.events.push({ type: 'routed', kind: r.kind });
  }
}

function completeRequest(s, c) {
  c.done = true;
  s.requestsFilled++;
  const unlocked = c.unlock ? buildById[c.unlock] : null;
  if (unlocked) s.unlocked.push(unlocked.id);
  s.events.push({ type: 'contract', bonus: c.bonus, unlock: unlocked?.id || null });
  // The next request in the chain.
  s.contract = pickContract(s.world, s.rng, unlockLevel(s), s.valueMult);
  return c.bonus;
}

function deposit(s, p) {
  let gained = 0, wood = 0, stone = 0;
  for (const it of p.carry) {
    if (it.sp === 'wood') { wood++; continue; }
    if (it.sp === 'stone') { stone++; continue; }
    if (it.sp === 'amber') {
      s.amber++;
      gained += Math.round(CFG.amberValue * s.valueMult);
      continue;
    }
    s.banked[it.sp] = (s.banked[it.sp] || 0) + 1;
    s.bankedCount++;
    gained += Math.round(speciesById[it.sp].value * it.mult * s.valueMult);
    const c = s.contract;
    if (c && !c.done && c.sp === it.sp) {
      c.have++;
      if (c.have >= c.need) gained += completeRequest(s, c);
    }
  }
  if (wood) {
    if (s.phase === 'night') s.fuel = Math.min(CFG.maxFuel, s.fuel + wood * CFG.woodFuel);
    else s.stock.wood += wood;
    s.events.push({ type: 'wood', id: p.id, n: wood });
  }
  if (stone) {
    s.stock.stone += stone;
    s.events.push({ type: 'stone', id: p.id, n: stone });
  }
  s.funding += gained;
  p.carry = [];
  if (gained) s.events.push({ type: 'deposit', id: p.id, gained });
}

// True only on the frame a button goes down.
function pressed(p, inp, key) {
  const now = !!inp[key];
  const edge = now && !p.held[key];
  p.held[key] = now;
  return edge;
}

function attack(s, p) {
  if (p.atkCd > 0) return;
  const front = (r) => {
    const dx = r.x - p.x, dy = r.y - p.y, d = Math.hypot(dx, dy) || 1;
    return (dx * p.fx + dy * p.fy) / d > -0.2;
  };
  if (s.owned.spear) {
    const near = s.dinos.filter((r) => !r.routed && dist(r, p) < CFG.spearR + DINOS[r.kind].r && front(r));
    if (near.length || !s.owned.sling) {
      p.atkCd = CFG.attackCd;
      p.swing = 0.2;
      for (const r of near) hitDino(s, r, 1, p, 0.3, 40);
      s.events.push({ type: 'swing', id: p.id, hits: near.length });
      return;
    }
  }
  if (s.owned.sling) {
    if (s.stock.stone <= 0) { s.events.push({ type: 'noammo', id: p.id }); p.atkCd = CFG.attackCd; return; }
    s.stock.stone--;
    p.atkCd = CFG.attackCd * 1.6;
    s.shots.push({ x: p.x, y: p.y, vx: p.fx * CFG.shotSpeed, vy: p.fy * CFG.shotSpeed, life: 0.8, from: p.id });
    s.events.push({ type: 'shoot', id: p.id });
  }
}

function updatePlayer(s, p, inp, dt) {
  p.invuln = Math.max(0, p.invuln - dt);
  p.slow = Math.max(0, p.slow - dt);
  p.atkCd = Math.max(0, p.atkCd - dt);
  p.swing = Math.max(0, p.swing - dt);
  if (p.down) { for (const k of ['dig', 'trap', 'build', 'attack']) p.held[k] = !!inp[k]; return; }

  const digPress = pressed(p, inp, 'dig');
  const trapPress = pressed(p, inp, 'trap');
  const buildPress = pressed(p, inp, 'build');
  if (buildPress) {
    // The build key opens the menu, and closes the menu or cancels a placement.
    p.build = p.build === null && buildList(s).length ? { mode: 'menu', sel: p.lastSel } : null;
    s.events.push({ type: p.build === null ? 'buildoff' : 'buildon', id: p.id });
  }

  // Build menu: you stand still; up/down (or the snare button) choose, dig picks.
  if (p.build && p.build.mode === 'menu') {
    const list = buildList(s);
    if (!list.length) { p.build = null; return; }
    const navY = (inp.y || 0) > 0.5 ? 1 : (inp.y || 0) < -0.5 ? -1 : 0;
    const nav = navY !== p.navY ? navY : 0;
    p.navY = navY;
    let sel = p.build.sel % list.length;
    if (nav) sel = (sel + nav + list.length) % list.length;
    if (trapPress) sel = (sel + 1) % list.length;
    p.build.sel = p.lastSel = sel;
    p.moving = false;
    p.digT = p.chopT = p.mineT = 0;
    if (digPress) {
      const b = list[sel];
      if (!hasStation(s, p, b)) s.events.push({ type: 'needstation', id: p.id, item: b.id });
      else if (!canAfford(s, b)) s.events.push({ type: 'cantafford', id: p.id, item: b.id });
      else if (b.kind === 'place') p.build = { mode: 'place', id: b.id };
      else { s.events.push({ type: act(s, p, b), id: p.id, item: b.id }); p.build = null; }
    }
    collectAndBank(s, p);
    return;
  }

  let mx = inp.x || 0, my = inp.y || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  p.moving = len > 0.01;
  if (p.moving) { p.fx = mx; p.fy = my; }

  let speed = s.st.speed * (traitOf(s).playerSpeed || 1);
  if (p.carry.length >= s.st.cap) speed *= 0.85;
  if (tileAt(s.world, p.x, p.y) === T.TALL) speed *= 0.8;
  if (p.slow > 0) speed *= 0.55;
  move(s.world, p, mx * speed * dt, my * speed * dt, CFG.pr);

  if (pressed(p, inp, 'attack')) attack(s, p);

  // Placing: walk to aim the ghost, dig puts it down, snare goes back to the menu.
  if (p.build && p.build.mode === 'place') {
    const b = buildById[p.build.id];
    if (trapPress) p.build = { mode: 'menu', sel: p.lastSel };
    else if (digPress) {
      const res = act(s, p, b);
      s.events.push({ type: res, id: p.id, item: b.id });
      if (res === 'built') p.build = null;
    }
    p.digT = p.chopT = p.mineT = 0;
    collectAndBank(s, p);
    return;
  }

  // The dig button: revive a partner, else dig a site, else chop a tree, else mine a rock.
  let dug = false, chopped = false, mined = false;
  if (inp.dig) {
    const mate = s.players.find((q) => q.down && dist(q, p) < CFG.reviveR);
    if (mate) {
      mate.reviveT += dt;
      mate.beingRevived = true;
      if (mate.reviveT >= CFG.reviveTime) {
        mate.down = false; mate.hp = 1; mate.reviveT = 0; mate.invuln = 2;
        s.events.push({ type: 'revive', id: mate.id });
      }
    } else if (!p.moving && p.carry.length < s.st.cap) {
      const site = s.world.sites.find((x) => x.bones > 0 && dist(x, p) < CFG.digR);
      if (site) {
        dug = true;
        p.digT += dt;
        if (p.digT >= s.st.digTime) {
          p.digT = 0;
          site.bones--;
          p.carry.push({ sp: site.species, mult: s.phase === 'night' ? CFG.nightBonus : 1 });
          s.events.push({ type: site.species === 'amber' ? 'amber' : 'bone', id: p.id, sp: site.species });
        }
      } else if (treeNear(s.world, p.x, p.y, CFG.chopR)) {
        chopped = true;
        p.chopT += dt;
        if (p.chopT >= CFG.chopTime / (s.owned.axe ? 2 : 1)) {
          p.chopT = 0;
          p.carry.push({ sp: 'wood', mult: 1 });
          s.events.push({ type: 'chop', id: p.id });
        }
      } else if (tileNear(s.world, p.x, p.y, CFG.mineR, T.ROCK)) {
        mined = true;
        p.mineT += dt;
        if (p.mineT >= CFG.mineTime / (s.owned.pickaxe ? 2 : 1)) {
          p.mineT = 0;
          p.carry.push({ sp: 'stone', mult: 1 });
          s.events.push({ type: 'mine', id: p.id });
        }
      }
    }
  }
  if (!dug) p.digT = 0;
  if (!chopped) p.chopT = 0;
  if (!mined) p.mineT = 0;

  if (trapPress && p.traps > 0) {
    s.traps.push({ x: p.x, y: p.y, armed: true });
    p.traps--;
    s.events.push({ type: 'trap', id: p.id });
  }
  collectAndBank(s, p);
}

function collectAndBank(s, p) {
  for (const d of s.drops) {
    if (!d.taken && p.carry.length < s.st.cap && dist(d, p) < CFG.pickR) {
      d.taken = true;
      p.carry.push(d.item);
      s.events.push({ type: 'pickup', id: p.id });
    }
  }
  if (p.carry.length && dist(p, s.world.camp) < CFG.campR) deposit(s, p);
}

function nearestPlayer(s, d) {
  let best = null, bd = Infinity;
  for (const p of s.players) {
    if (p.down) continue;
    const dd = dist(p, d);
    if (dd < bd) { bd = dd; best = p; }
  }
  return { p: best, d: bd };
}

function updateDino(s, r, dt) {
  const def = DINOS[r.kind];
  r.cd = Math.max(0, r.cd - dt);
  r.stealCd = Math.max(0, r.stealCd - dt);
  r.spitCd = Math.max(0, r.spitCd - dt);
  r.scared = Math.max(0, r.scared - dt);
  if (r.stun > 0) { r.stun -= dt; return; }
  const camp = s.world.camp;
  const tr = traitOf(s);
  const torches = litTorches(s);
  const nearTorch = (p) => s.phase === 'night' && torches.some((t) => dist(t, p) < CFG.torchR);

  let target = null, best = Infinity;
  if (!(def.thief && r.carry) && !r.routed && r.scared <= 0) {
    for (const p of s.players) {
      if (p.down || inFire(s, p) || nearTorch(p)) continue;
      if (def.motionOnly && !p.moving) continue; // the rex can't see you if you freeze
      if (def.thief && (!p.carry.length || r.stealCd > 0)) continue;
      let sight = def.sight * (tr.sight || 1);
      if (tileAt(s.world, p.x, p.y) === T.TALL) sight *= CFG.tallGrassSight;
      if (!p.moving) sight *= CFG.stillSight;
      const d = dist(r, p);
      if (d < sight && d < best) { best = d; target = p; }
    }
  }

  const prevMode = r.mode;
  let desired, sp;
  if (r.routed || r.scared > 0 || (def.thief && r.carry)) {
    // Run away: routed for good, scared by a flare for a while, or a thief with loot.
    r.mode = 'flee';
    const near = nearestPlayer(s, r);
    const from = r.routed || r.scared > 0 ? (r.fleeFrom || near.p) : near.p;
    desired = from ? Math.atan2(r.y - from.y, r.x - from.x) : r.heading;
    sp = def.thief && r.carry ? def.ladenSpeed : def.speed; // slower with loot, so you can run it down
    if (!near.p || near.d > 700) {
      r.gone = true;
      if (r.carry) s.events.push({ type: 'escaped' });
      return;
    }
  } else if (target) {
    r.mode = 'chase';
    desired = Math.atan2(target.y - r.y, target.x - r.x);
    sp = def.speed;
    if (def.keepAway && best < def.keepAway) desired += Math.PI; // spitters back off
    else if (def.range && best < def.range) sp *= 0.2;           // and hold at range
  } else {
    r.mode = 'wander';
    r.wanderT -= dt;
    if (r.wanderT <= 0) {
      r.wanderH = r.heading + s.rng.range(-1.5, 1.5);
      r.wanderT = s.rng.range(1, 3);
    }
    desired = r.wanderH;
    sp = def.speed * 0.45;
  }
  if (r.kind === 'rex' && r.mode === 'chase' && prevMode !== 'chase') s.events.push({ type: 'roar' });
  if (fireScares(s) && dist(r, camp) < s.fire + 24) desired = Math.atan2(r.y - camp.y, r.x - camp.x);
  if (s.phase === 'night') {
    for (const t of torches) if (dist(r, t) < CFG.torchR + 16) desired = Math.atan2(r.y - t.y, r.x - t.x);
  }

  const off = angleDiff(desired, r.heading);
  r.heading += clamp(off, -def.turn * dt, def.turn * dt);
  // Up close, brake to turn. Without this a fast, slow-turning biter just
  // orbits a player standing inside its turning circle and never bites.
  if (target && (def.dmg || def.thief) && best < CFG.brakeR) sp *= Math.max(0.15, Math.cos(off));
  const nx = Math.cos(r.heading) * sp * dt, ny = Math.sin(r.heading) * sp * dt;
  const hit = move(s.world, r, nx, ny, def.r, s);
  // Blocked by a wall while hunting: tear it down (spikes bite back).
  const wall = hit && r.mode === 'chase' ? wallHit(s, r.x + Math.sign(nx) * 4, r.y + Math.sign(ny) * 4, def.r) : null;
  if (wall && def.wallDps) {
    wall.hp -= def.wallDps * dt;
    r.chewing = wall;
    const b = buildById[wall.kind];
    if (b.spikes) {
      r.spikeT = (r.spikeT || 0) + dt;
      if (r.spikeT >= 1) { r.spikeT = 0; hitDino(s, r, b.spikes, wall, 0, 12); }
    }
    if (wall.hp <= 0) {
      removeStructure(s, wall);
      s.events.push({ type: 'smash', kind: wall.kind });
    }
  } else r.chewing = null;
  if (hit && r.mode !== 'chase' && !wall) {
    r.heading += (s.rng() < 0.5 ? 1 : -1) * Math.PI / 2;
    r.wanderH = r.heading;
    r.wanderT = 1;
  }

  // Hard rule: no dinosaur stands inside a burning fire.
  if (fireScares(s)) {
    const d = dist(r, camp);
    if (d < s.fire) {
      const a = Math.atan2(r.y - camp.y, r.x - camp.x);
      r.x = camp.x + Math.cos(a) * s.fire;
      r.y = camp.y + Math.sin(a) * s.fire;
    }
  }
  if (r.routed || r.scared > 0) return;

  for (const trap of s.traps) {
    if (trap.armed && dist(trap, r) < CFG.trapR + def.r / 2) {
      trap.armed = false;
      r.stun = s.st.stun * (def.stunScale || 1);
      if (r.carry) { dropItem(s, r.x, r.y, r.carry); r.carry = null; }
      s.events.push({ type: 'snap', kind: r.kind });
      return;
    }
  }

  if (def.thief) {
    if (r.carry) {
      // Tag a thief to make it drop the loot.
      const near = nearestPlayer(s, r);
      if (near.p && near.d < 20 && r.stealCd < 3.4) {
        dropItem(s, r.x, r.y, r.carry);
        r.carry = null;
        r.stealCd = 4;
        s.events.push({ type: 'grab', id: near.p.id });
      }
    } else if (target && best < def.bite && target.carry.length) {
      r.carry = target.carry.pop();
      r.stealCd = 4;
      s.events.push({ type: 'steal', id: target.id });
    }
    return;
  }

  if (def.range && target && r.spitCd <= 0 && best < def.range && best > 40) {
    const a = Math.atan2(target.y - r.y, target.x - r.x);
    s.spits.push({ x: r.x, y: r.y, vx: Math.cos(a) * CFG.spitSpeed, vy: Math.sin(a) * CFG.spitSpeed, life: 1.4 });
    r.spitCd = def.spitCd;
    s.events.push({ type: 'spit' });
  }

  if (target && r.cd <= 0 && target.invuln <= 0 && best < def.bite) {
    r.cd = 1;
    hurt(s, target, def.dmg, r);
  }
}

function updateProjectiles(s, dt) {
  for (const b of s.spits) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (blocked(s.world, b.x, b.y, 2) || wallHit(s, b.x, b.y, 2)) b.life = 0;
    for (const p of s.players) {
      if (b.life <= 0 || p.down || p.invuln > 0 || dist(b, p) > 12) continue;
      b.life = 0;
      p.slow = CFG.spitSlow;
      hurt(s, p, 1, b);
    }
  }
  s.spits = s.spits.filter((b) => b.life > 0);
  for (const b of s.shots) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (blocked(s.world, b.x, b.y, 2)) b.life = 0;
    for (const r of s.dinos) {
      if (b.life <= 0 || r.routed || dist(b, r) > DINOS[r.kind].r + 6) continue;
      b.life = 0;
      hitDino(s, r, 1, b, 1.2, 10);
    }
  }
  s.shots = s.shots.filter((b) => b.life > 0);
  for (const f of s.flares) f.t -= dt;
  s.flares = s.flares.filter((f) => f.t > 0);
}

// inputs: one {x, y, dig, trap, build, attack} per player.
export function update(s, inputs, dt) {
  if (s.over) return s;
  s.time += dt;
  s.t += dt;

  if (s.phase === 'day' && s.tutorial?.hold) s.t = Math.min(s.t, s.dayLen - 15);
  if (s.phase === 'day' && s.t >= s.dayLen) startNight(s);
  else if (s.phase === 'night') {
    s.fuel = Math.max(0, s.fuel - dt / s.nightLen);
    s.fire = s.st.fireR * clamp(s.fuel, 0, 1);
    for (const st of s.structures) if (st.kind === 'torch') st.life = Math.max(0, st.life - dt);
    if (s.t >= s.nightLen) endNight(s);
    if (s.over) return s;
  }

  for (const p of s.players) p.beingRevived = false;
  for (const p of s.players) updatePlayer(s, p, inputs[p.id] || {}, dt);
  for (const p of s.players) if (p.down && !p.beingRevived) p.reviveT = Math.max(0, p.reviveT - dt);
  for (const r of s.dinos) updateDino(s, r, dt);
  s.dinos = s.dinos.filter((r) => !r.gone);
  updateProjectiles(s, dt);
  s.traps = s.traps.filter((t) => t.armed);
  s.drops = s.drops.filter((d) => !d.taken);

  if (s.players.every((p) => p.down)) finish(s, 'lost');
  return s;
}
