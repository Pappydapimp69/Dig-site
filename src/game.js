// Pure simulation: no DOM, so it runs in tests and in the browser alike.
import { mulberry32 } from './rng.js';
import { makeWorld, blocked, tileAt, spawnPoint, treeNear, T } from './world.js';
import { CFG, DINOS, TRAITS, TRAIT_POOL, FOSSILS, speciesById } from './data.js';

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

// How many of each kind hunt on night n.
export function nightRoster(n, tier = 0, trait = {}) {
  return {
    raptor: 1 + 2 * n + tier + (trait.extraRaptors || 0),
    spitter: n >= 2 ? n - 1 + Math.floor(tier / 2) : 0,
    rex: n >= CFG.nights || (tier >= 2 && n >= 2) ? 1 : 0,
  };
}

function pickContract(world, rng, tier) {
  const avail = {};
  for (const s of world.sites) if (s.species !== 'amber') avail[s.species] = (avail[s.species] || 0) + s.bones;
  const options = FOSSILS.filter((f) => (avail[f.id] || 0) >= 3);
  if (!options.length) return null;
  const sp = options[Math.floor(rng() * options.length)];
  const need = Math.min(avail[sp.id], 3 + Math.floor(rng() * 2) + Math.min(2, tier));
  return { sp: sp.id, need, have: 0, bonus: Math.round(need * sp.value * 1.5), done: false };
}

export function newRun({ seed = 1, players = 1, upgrades = {}, perks = [], tier = 0, trait } = {}) {
  const rng = mulberry32(seed);
  // Island trait and contract use their own stream so they never shift the world.
  const side = mulberry32((seed ^ 0x2545f491) >>> 0);
  const traitId = trait ?? TRAIT_POOL[Math.floor(side() * TRAIT_POOL.length)];
  const tr = TRAITS[traitId];
  const world = makeWorld(rng, 80, 60, {
    extraSites: tr.extraSites || 0,
    amberChance: tr.amberChance ?? CFG.amberChance,
  });
  const st = stats(upgrades, perks);
  const ps = [];
  for (let i = 0; i < players; i++) {
    ps.push({
      id: i, x: world.camp.x + (players > 1 ? (i ? 18 : -18) : 0), y: world.camp.y + 30,
      hp: st.hp, carry: [], digT: 0, chopT: 0, down: false, reviveT: 0, invuln: 0, slow: 0,
      traps: st.traps, trapHeld: false, moving: false, fx: 0, fy: 1,
    });
  }
  return {
    seed, rng, world, st, players: ps, dinos: [], traps: [], drops: [], spits: [],
    trait: traitId, tier, valueMult: 1 + CFG.tierValue * tier,
    contract: pickContract(world, side, tier),
    phase: 'day', t: 0, night: 0, fire: st.fireR, fuel: 1, woodPile: 0, time: 0,
    banked: {}, bankedCount: 0, amber: 0, funding: 0, payout: 0,
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
const traitOf = (s) => TRAITS[s.trait];

function spawn(s, kind) {
  const sp = spawnPoint(s.world, s.rng);
  const d = {
    kind, x: sp.x, y: sp.y, heading: s.rng.range(-Math.PI, Math.PI),
    wanderH: 0, wanderT: 0, stun: 0, cd: 0, mode: 'wander', carry: null, stealCd: 0, spitCd: 1,
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
  s.fuel = 1 + Math.min(1, s.woodPile * CFG.woodFuel);
  s.woodPile = 0;
  s.fire = s.st.fireR;
  for (const p of s.players) p.traps = s.st.traps;
  // Compies scatter at dusk, dropping anything they stole.
  for (const d of s.dinos) if (d.carry) dropItem(s, d.x, d.y, d.carry);
  s.dinos = [];
  const roster = nightRoster(s.night, s.tier, traitOf(s));
  for (const [kind, n] of Object.entries(roster)) for (let i = 0; i < n; i++) spawn(s, kind);
  s.events.push({ type: 'night', n: s.night });
  if (roster.rex) s.events.push({ type: 'rexwarn' });
}

function endNight(s) {
  s.dinos = [];
  s.spits = [];
  if (s.night >= CFG.nights) return finish(s, 'won');
  s.phase = 'day';
  s.t = 0;
  s.fire = s.st.fireR;
  s.fuel = 1;
  // From day 2, compies come looking for bones to steal.
  for (let i = 0; i < 3 + s.tier; i++) spawn(s, 'compy');
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

function hurt(s, p, dmg, from) {
  p.hp -= dmg;
  p.invuln = CFG.invuln;
  if (from) {
    const a = Math.atan2(p.y - from.y, p.x - from.x);
    move(s.world, p, Math.cos(a) * 24, Math.sin(a) * 24, CFG.pr);
  }
  s.events.push({ type: 'hurt', id: p.id });
  if (p.hp <= 0) {
    p.down = true;
    p.digT = p.chopT = 0;
    // Bones spill on the ground; a partner can grab them.
    for (const it of p.carry) dropItem(s, p.x, p.y, it);
    p.carry = [];
    s.events.push({ type: 'down', id: p.id });
  }
}

function deposit(s, p) {
  let gained = 0, wood = 0;
  for (const it of p.carry) {
    if (it.sp === 'wood') { wood++; continue; }
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
      if (c.have >= c.need) {
        c.done = true;
        gained += c.bonus;
        s.events.push({ type: 'contract', bonus: c.bonus });
      }
    }
  }
  if (wood) {
    if (s.phase === 'night') s.fuel = Math.min(CFG.maxFuel, s.fuel + wood * CFG.woodFuel);
    else s.woodPile = Math.min(CFG.maxWoodPile, s.woodPile + wood);
    s.events.push({ type: 'wood', id: p.id, n: wood });
  }
  s.funding += gained;
  p.carry = [];
  if (gained) s.events.push({ type: 'deposit', id: p.id, gained });
}

function updatePlayer(s, p, inp, dt) {
  p.invuln = Math.max(0, p.invuln - dt);
  p.slow = Math.max(0, p.slow - dt);
  if (p.down) return;

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

  // The dig button: revive a partner, else dig a site, else chop a tree.
  let dug = false, chopped = false;
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
        if (p.chopT >= CFG.chopTime) {
          p.chopT = 0;
          p.carry.push({ sp: 'wood', mult: 1 });
          s.events.push({ type: 'chop', id: p.id });
        }
      }
    }
  }
  if (!dug) p.digT = 0;
  if (!chopped) p.chopT = 0;

  if (inp.trap && !p.trapHeld && p.traps > 0) {
    s.traps.push({ x: p.x, y: p.y, armed: true });
    p.traps--;
    s.events.push({ type: 'trap', id: p.id });
  }
  p.trapHeld = !!inp.trap;

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
  if (r.stun > 0) { r.stun -= dt; return; }
  const camp = s.world.camp;
  const tr = traitOf(s);

  let target = null, best = Infinity;
  if (!(def.thief && r.carry)) {
    for (const p of s.players) {
      if (p.down || inFire(s, p)) continue;
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
  if (def.thief && r.carry) {
    // Run off with the loot.
    r.mode = 'flee';
    const near = nearestPlayer(s, r);
    desired = near.p ? Math.atan2(r.y - near.p.y, r.x - near.p.x) : r.heading;
    sp = def.ladenSpeed; // slower with loot, so you can run it down
    if (!near.p || near.d > 700) {
      r.gone = true;
      s.events.push({ type: 'escaped' });
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

  const off = angleDiff(desired, r.heading);
  r.heading += clamp(off, -def.turn * dt, def.turn * dt);
  // Up close, brake to turn. Without this a fast, slow-turning biter just
  // orbits a player standing inside its turning circle and never bites.
  if (target && (def.dmg || def.thief) && best < CFG.brakeR) sp *= Math.max(0.15, Math.cos(off));
  const hit = move(s.world, r, Math.cos(r.heading) * sp * dt, Math.sin(r.heading) * sp * dt, def.r);
  if (hit && r.mode !== 'chase') {
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

function updateSpits(s, dt) {
  for (const b of s.spits) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (blocked(s.world, b.x, b.y, 2)) b.life = 0;
    for (const p of s.players) {
      if (b.life <= 0 || p.down || p.invuln > 0 || dist(b, p) > 12) continue;
      b.life = 0;
      p.slow = CFG.spitSlow;
      hurt(s, p, 1, b);
    }
  }
  s.spits = s.spits.filter((b) => b.life > 0);
}

// inputs: one {x, y, dig, trap} per player.
export function update(s, inputs, dt) {
  if (s.over) return s;
  s.time += dt;
  s.t += dt;

  if (s.phase === 'day' && s.t >= CFG.dayLen) startNight(s);
  else if (s.phase === 'night') {
    s.fuel = Math.max(0, s.fuel - dt / CFG.nightLen);
    s.fire = s.st.fireR * clamp(s.fuel, 0, 1);
    if (s.t >= CFG.nightLen) endNight(s);
    if (s.over) return s;
  }

  for (const p of s.players) p.beingRevived = false;
  for (const p of s.players) updatePlayer(s, p, inputs[p.id] || {}, dt);
  for (const p of s.players) if (p.down && !p.beingRevived) p.reviveT = Math.max(0, p.reviveT - dt);
  for (const r of s.dinos) updateDino(s, r, dt);
  s.dinos = s.dinos.filter((r) => !r.gone);
  updateSpits(s, dt);
  s.traps = s.traps.filter((t) => t.armed);
  s.drops = s.drops.filter((d) => !d.taken);

  if (s.players.every((p) => p.down)) finish(s, 'lost');
  return s;
}
