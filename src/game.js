// Pure simulation: no DOM, so it runs in tests and in the browser alike.
import { mulberry32 } from './rng.js';
import { makeWorld, blocked, tileAt, spawnPoint, T } from './world.js';
import { CFG, speciesById } from './data.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function stats(up = {}) {
  return {
    cap: CFG.baseCap + (up.bag || 0),
    digTime: CFG.digTime * Math.pow(0.8, up.dig || 0),
    speed: CFG.speed * (1 + 0.1 * (up.boots || 0)),
    traps: CFG.baseTraps + (up.traps || 0),
    fireR: CFG.fireR + 30 * (up.fire || 0),
  };
}

export function newRun({ seed = 1, players = 1, upgrades = {} } = {}) {
  const rng = mulberry32(seed);
  const world = makeWorld(rng);
  const st = stats(upgrades);
  const ps = [];
  for (let i = 0; i < players; i++) {
    ps.push({
      id: i, x: world.camp.x + (players > 1 ? (i ? 18 : -18) : 0), y: world.camp.y + 30,
      hp: CFG.hp, carry: [], digT: 0, down: false, reviveT: 0, invuln: 0,
      traps: st.traps, trapHeld: false, moving: false, fx: 0, fy: 1,
    });
  }
  return {
    seed, rng, world, st, players: ps, raptors: [], traps: [],
    phase: 'day', t: 0, night: 0, fire: st.fireR, time: 0,
    banked: {}, bankedCount: 0, funding: 0, payout: 0,
    over: false, result: null, events: [],
  };
}

// Move along each axis separately so you slide along walls.
function move(world, e, dx, dy, r) {
  let hit = false;
  if (!blocked(world, e.x + dx, e.y, r)) e.x += dx; else hit = true;
  if (!blocked(world, e.x, e.y + dy, r)) e.y += dy; else hit = true;
  return hit;
}

const fireScares = (s) => s.phase === 'night' && s.fire > CFG.fireSafeMin;
const inFire = (s, p) => fireScares(s) && dist(p, s.world.camp) < s.fire;

function startNight(s) {
  s.phase = 'night';
  s.t = 0;
  s.night++;
  s.fire = s.st.fireR;
  for (const p of s.players) p.traps = s.st.traps;
  const count = 1 + 2 * s.night;
  for (let i = 0; i < count; i++) {
    const sp = spawnPoint(s.world, s.rng);
    s.raptors.push({
      x: sp.x, y: sp.y, heading: s.rng.range(-Math.PI, Math.PI),
      wanderH: 0, wanderT: 0, stun: 0, cd: 0, mode: 'wander',
    });
  }
  s.events.push({ type: 'night', n: s.night });
}

function endNight(s) {
  s.raptors = [];
  if (s.night >= CFG.nights) return finish(s, 'won');
  s.phase = 'day';
  s.t = 0;
  s.fire = s.st.fireR;
  s.events.push({ type: 'dawn', n: s.night });
}

export function finish(s, result) {
  if (s.over) return;
  s.over = true;
  s.result = result;
  for (const p of s.players) p.carry = [];
  s.payout = result === 'won' ? Math.round(s.funding * CFG.winBonus) : s.funding;
  s.events.push({ type: result });
}

function updatePlayer(s, p, inp, dt) {
  p.invuln = Math.max(0, p.invuln - dt);
  if (p.down) return;

  let mx = inp.x || 0, my = inp.y || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  p.moving = len > 0.01;
  if (p.moving) { p.fx = mx; p.fy = my; }

  let speed = s.st.speed;
  if (p.carry.length >= s.st.cap) speed *= 0.85;
  if (tileAt(s.world, p.x, p.y) === T.TALL) speed *= 0.8;
  move(s.world, p, mx * speed * dt, my * speed * dt, CFG.pr);

  // The dig button also revives a downed teammate, which takes priority.
  let dug = false;
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
          s.events.push({ type: 'bone', id: p.id, sp: site.species });
        }
      }
    }
  }
  if (!dug) p.digT = 0;

  if (inp.trap && !p.trapHeld && p.traps > 0) {
    s.traps.push({ x: p.x, y: p.y, armed: true });
    p.traps--;
    s.events.push({ type: 'trap', id: p.id });
  }
  p.trapHeld = !!inp.trap;

  if (p.carry.length && dist(p, s.world.camp) < CFG.campR) {
    let gained = 0;
    for (const b of p.carry) {
      s.banked[b.sp] = (s.banked[b.sp] || 0) + 1;
      s.bankedCount++;
      gained += speciesById[b.sp].value * b.mult;
    }
    s.funding += gained;
    p.carry = [];
    s.events.push({ type: 'deposit', id: p.id, gained });
  }
}

function updateRaptor(s, r, dt) {
  r.cd = Math.max(0, r.cd - dt);
  if (r.stun > 0) { r.stun -= dt; return; }
  const camp = s.world.camp;

  let target = null, best = Infinity;
  for (const p of s.players) {
    if (p.down || inFire(s, p)) continue;
    let sight = CFG.sight;
    if (tileAt(s.world, p.x, p.y) === T.TALL) sight *= CFG.tallGrassSight;
    if (!p.moving) sight *= CFG.stillSight;
    const d = dist(r, p);
    if (d < sight && d < best) { best = d; target = p; }
  }

  let desired;
  if (target) {
    r.mode = 'chase';
    desired = Math.atan2(target.y - r.y, target.x - r.x);
  } else {
    r.mode = 'wander';
    r.wanderT -= dt;
    if (r.wanderT <= 0) {
      r.wanderH = r.heading + s.rng.range(-1.5, 1.5);
      r.wanderT = s.rng.range(1, 3);
    }
    desired = r.wanderH;
  }
  if (fireScares(s) && dist(r, camp) < s.fire + 24) {
    desired = Math.atan2(r.y - camp.y, r.x - camp.x);
  }

  const maxTurn = CFG.raptorTurn * dt;
  const off = angleDiff(desired, r.heading);
  r.heading += clamp(off, -maxTurn, maxTurn);
  let sp = r.mode === 'chase' ? CFG.raptorSpeed : CFG.raptorSpeed * 0.45;
  // Up close, brake to turn. Without this a fast, slow-turning raptor just
  // orbits a player standing inside its turning circle and never bites.
  if (target && best < CFG.brakeR) sp *= Math.max(0.15, Math.cos(off));
  const hit = move(s.world, r, Math.cos(r.heading) * sp * dt, Math.sin(r.heading) * sp * dt, CFG.raptorR);
  if (hit && r.mode === 'wander') {
    r.heading += (s.rng() < 0.5 ? 1 : -1) * Math.PI / 2;
    r.wanderH = r.heading;
    r.wanderT = 1;
  }

  // Hard rule: a raptor never stands inside a burning fire.
  if (fireScares(s)) {
    const d = dist(r, camp);
    if (d < s.fire) {
      const a = Math.atan2(r.y - camp.y, r.x - camp.x);
      r.x = camp.x + Math.cos(a) * s.fire;
      r.y = camp.y + Math.sin(a) * s.fire;
    }
  }

  for (const trap of s.traps) {
    if (trap.armed && dist(trap, r) < CFG.trapR) {
      trap.armed = false;
      r.stun = CFG.stunTime;
      s.events.push({ type: 'snap' });
      return;
    }
  }

  if (target && r.cd <= 0 && target.invuln <= 0 && dist(r, target) < CFG.biteR) {
    target.hp--;
    target.invuln = CFG.invuln;
    r.cd = 1;
    const a = Math.atan2(target.y - r.y, target.x - r.x);
    move(s.world, target, Math.cos(a) * 24, Math.sin(a) * 24, CFG.pr);
    s.events.push({ type: 'hurt', id: target.id });
    if (target.hp <= 0) {
      target.down = true;
      target.carry = [];
      target.digT = 0;
      s.events.push({ type: 'down', id: target.id });
    }
  }
}

// inputs: one {x, y, dig, trap} per player.
export function update(s, inputs, dt) {
  if (s.over) return s;
  s.time += dt;
  s.t += dt;

  if (s.phase === 'day' && s.t >= CFG.dayLen) startNight(s);
  else if (s.phase === 'night') {
    s.fire = Math.max(0, s.st.fireR * (1 - s.t / CFG.nightLen));
    if (s.t >= CFG.nightLen) endNight(s);
    if (s.over) return s;
  }

  for (const p of s.players) p.beingRevived = false;
  for (const p of s.players) updatePlayer(s, p, inputs[p.id] || {}, dt);
  for (const p of s.players) if (p.down && !p.beingRevived) p.reviveT = Math.max(0, p.reviveT - dt);
  for (const r of s.raptors) updateRaptor(s, r, dt);
  s.traps = s.traps.filter((t) => t.armed);

  if (s.players.every((p) => p.down)) finish(s, 'lost');
  return s;
}
