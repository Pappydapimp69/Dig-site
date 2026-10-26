import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, update, nightRoster, stats } from '../src/game.js';
import { blocked, treeNear, TILE, T } from '../src/world.js';
import { CFG, DINOS, TRAITS, TRAIT_POOL } from '../src/data.js';
import { freshSave, applyRun, buy, loadSave, collection, perks } from '../src/save.js';

const STEP = 1 / 60;
const run = (s, secs, inputs = []) => { for (let t = 0; t < secs && !s.over; t += STEP) update(s, inputs, STEP); };
const toNight = (s) => { s.t = CFG.dayLen; update(s, [], STEP); };
const fakeRaptor = (x, y, kind = 'raptor') => ({ kind, x, y, carry: null, stealCd: 0, spitCd: 0, heading: 0, wanderH: 0, wanderT: 9, stun: 0, cd: 0, mode: 'wander' });

// Find a walkable spot at least `minD` px from camp.
function openSpot(s, minD) {
  const w = s.world;
  for (let i = 0; i < w.w * w.h; i++) {
    if (!w.reach[i]) continue;
    const x = ((i % w.w) + 0.5) * TILE, y = (((i / w.w) | 0) + 0.5) * TILE;
    if (Math.hypot(x - w.camp.x, y - w.camp.y) > minD && [-100, -60, 0, 40, 60, 100].every((d) => !blocked(w, x + d, y, 12) && !blocked(w, x, y + d, 12))) return { x, y };
  }
  throw new Error('no open spot');
}

test('same seed builds the same island', () => {
  const a = newRun({ trait: 'none', seed: 7 }), b = newRun({ trait: 'none', seed: 7 });
  assert.deepEqual(a.world.tiles, b.world.tiles);
  assert.deepEqual(a.world.sites, b.world.sites);
});

test('camp is walkable and every dig site is reachable', () => {
  for (const seed of [1, 2, 3, 42, 999, 12345]) {
    const s = newRun({ trait: 'none', seed });
    const w = s.world;
    assert.ok(!blocked(w, w.camp.x, w.camp.y, CFG.pr), `camp blocked on seed ${seed}`);
    assert.ok(w.sites.length >= 10, `only ${w.sites.length} sites on seed ${seed}`);
    for (const site of w.sites) {
      const i = Math.floor(site.y / TILE) * w.w + Math.floor(site.x / TILE);
      assert.equal(w.reach[i], 1, `unreachable site on seed ${seed}`);
    }
  }
});

test('players can walk', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  const x0 = s.players[0].x;
  run(s, 0.5, [{ x: 1, y: 0 }]);
  assert.ok(s.players[0].x > x0 + 30);
});

test('dig a bone, carry it home, get paid', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  const p = s.players[0], site = s.world.sites[0];
  const before = site.bones;
  Object.assign(p, { x: site.x, y: site.y });
  run(s, s.st.digTime + 0.05, [{ dig: true }]);
  assert.equal(p.carry.length, 1);
  assert.equal(site.bones, before - 1);
  Object.assign(p, { x: s.world.camp.x, y: s.world.camp.y });
  update(s, [{}], STEP);
  assert.equal(p.carry.length, 0);
  assert.equal(s.bankedCount, 1);
  assert.ok(s.funding > 0);
});

test('bag is capped', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  const p = s.players[0], site = s.world.sites[0];
  site.bones = 10;
  Object.assign(p, { x: site.x, y: site.y });
  run(s, s.st.digTime * 6, [{ dig: true }]);
  assert.equal(p.carry.length, s.st.cap);
});

test('night digs are worth double', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  s.dinos = [];
  const p = s.players[0], site = s.world.sites[0];
  Object.assign(p, { x: site.x, y: site.y });
  run(s, s.st.digTime + 0.05, [{ dig: true }]);
  assert.equal(p.carry[0].mult, CFG.nightBonus);
});

test('nightfall spawns raptors away from camp', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  assert.equal(s.phase, 'night');
  assert.equal(s.dinos.length, 3);
  for (const r of s.dinos) assert.ok(Math.hypot(r.x - s.world.camp.x, r.y - s.world.camp.y) > 16 * TILE);
});

test('raptors never enter a strong fire', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  const c = s.world.camp;
  s.dinos = [fakeRaptor(c.x + 200, c.y)];
  s.dinos[0].heading = Math.PI;
  for (let t = 0; t < 10; t += STEP) {
    update(s, [], STEP);
    if (s.fire > CFG.fireSafeMin) {
      assert.ok(Math.hypot(s.dinos[0].x - c.x, s.dinos[0].y - c.y) >= s.fire - 0.01);
    }
  }
  assert.equal(s.players[0].hp, CFG.hp, 'player in camp got bitten');
});

test('raptor turn rate is limited', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  s.dinos = [fakeRaptor(spot.x, spot.y)];
  Object.assign(s.players[0], { x: spot.x - 60, y: spot.y }); // directly behind it
  const h0 = s.dinos[0].heading;
  update(s, [{}], STEP);
  assert.ok(Math.abs(s.dinos[0].heading - h0) <= CFG.raptorTurn * STEP + 1e-9);
});

test('a raptor bites an exposed solo player until the run is lost', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  s.dinos = [fakeRaptor(spot.x + 40, spot.y)];
  Object.assign(s.players[0], { x: spot.x, y: spot.y });
  run(s, 20, [{}]);
  assert.equal(s.over, true);
  assert.equal(s.result, 'lost');
  assert.ok(s.players[0].down);
});

test('a trap stuns a raptor', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  const r = fakeRaptor(spot.x, spot.y);
  s.dinos = [r];
  s.traps = [{ x: spot.x, y: spot.y, armed: true }];
  update(s, [], STEP);
  assert.ok(r.stun > 0);
  assert.equal(s.traps.length, 0);
});

test('placing a trap needs a fresh press', () => {
  const s = newRun({ trait: 'none', seed: 3, upgrades: { traps: 2 } });
  run(s, 1, [{ trap: true }]);
  assert.equal(s.traps.length, 1);
});

test('co-op: a teammate revives a downed player', () => {
  const s = newRun({ trait: 'none', seed: 3, players: 2 });
  const [a, b] = s.players;
  b.down = true; b.hp = 0;
  Object.assign(a, { x: b.x + 10, y: b.y });
  run(s, CFG.reviveTime + 0.1, [{ dig: true }, {}]);
  assert.equal(b.down, false);
  assert.equal(b.hp, 1);
});

test('surviving every night clears the island with a bonus', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  s.funding = 100;
  for (let n = 0; n < CFG.nights; n++) {
    run(s, CFG.dayLen + 0.1);
    s.dinos = [];
    for (let t = 0; t < CFG.nightLen + 0.1 && !s.over; t += STEP) { update(s, [], STEP); s.dinos = []; }
  }
  assert.equal(s.result, 'won');
  assert.equal(s.payout, Math.round(100 * CFG.winBonus));
});

test('museum keeps bones and funding across runs', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  Object.assign(s, { result: 'lost', payout: 80, banked: { raptor: 5 } });
  const save = applyRun(freshSave(), s);
  assert.equal(save.funding, 80);
  assert.equal(save.museum.raptor, 5);
  const raptor = collection(save).find((c) => c.id === 'raptor');
  assert.equal(raptor.skeletons, 1);
  assert.equal(raptor.progress, 1);
});

test('upgrades cost funding and stop at max', () => {
  let save = { ...freshSave(), funding: 1000 };
  let r = buy(save, 'bag');
  assert.ok(r.ok);
  assert.equal(r.save.funding, 960);
  save = r.save;
  for (let i = 0; i < 10; i++) save = buy(save, 'bag').save;
  assert.equal(save.upgrades.bag, 4);
  assert.equal(buy(save, 'bag').why, 'maxed');
  assert.equal(buy(freshSave(), 'rex-cannon').ok, false);
  assert.equal(buy(freshSave(), 'bag').why, 'funds');
});

test('a corrupt save loads as fresh', () => {
  const bad = { getItem: () => '{nope' };
  assert.deepEqual(loadSave(bad), freshSave());
  assert.deepEqual(loadSave(null), freshSave());
});

test('a raptor passing beside a still player still lands a bite', () => {
  // Fast + slow-turning means a raptor can orbit a player inside its turning
  // circle forever. Sweep side-on passes at several ranges.
  let missed = 0;
  for (let k = 0; k < 20; k++) {
    const s = newRun({ trait: 'none', seed: 3 });
    toNight(s);
    const spot = openSpot(s, 400);
    const a = k * 0.37, d = 30 + (k % 5) * 15;
    const r = fakeRaptor(spot.x + Math.cos(a) * d, spot.y + Math.sin(a) * d);
    r.heading = a + (k % 2 ? 1 : -1) * Math.PI / 2;
    s.dinos = [r];
    Object.assign(s.players[0], { x: spot.x, y: spot.y });
    run(s, 5, [{}]);
    if (s.players[0].hp === CFG.hp) missed++;
  }
  assert.equal(missed, 0, `${missed}/20 raptors orbited without biting`);
});

// ---------- content ----------

// A walkable spot next to a tree, away from dig sites.
function treeSpot(s) {
  const w = s.world;
  for (let i = 0; i < w.w * w.h; i++) {
    if (!w.reach[i]) continue;
    const x = ((i % w.w) + 0.5) * TILE, y = (((i / w.w) | 0) + 0.5) * TILE;
    if (blocked(w, x, y, 12) || !treeNear(w, x, y, CFG.chopR)) continue;
    if (w.sites.some((st) => Math.hypot(st.x - x, st.y - y) < CFG.digR + 5)) continue;
    return { x, y };
  }
  throw new Error('no tree spot');
}

test('chop wood; logs stockpiled by day feed the fire at dusk', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  const p = s.players[0];
  Object.assign(p, treeSpot(s));
  run(s, CFG.chopTime * 2 + 0.1, [{ dig: true }]);
  assert.equal(p.carry.filter((c) => c.sp === 'wood').length, 2);
  Object.assign(p, { x: s.world.camp.x, y: s.world.camp.y });
  update(s, [{}], STEP);
  assert.equal(s.woodPile, 2);
  assert.equal(s.funding, 0, 'wood is not money');
  toNight(s);
  assert.ok(Math.abs(s.fuel - (1 + 2 * CFG.woodFuel)) < 0.02);
});

test('logs added at night keep the fire burning longer', () => {
  const plain = newRun({ trait: 'none', seed: 3 });
  const fed = newRun({ trait: 'none', seed: 3 });
  for (const s of [plain, fed]) { toNight(s); s.dinos = []; }
  run(plain, 40); run(fed, 1);
  fed.players[0].carry = [{ sp: 'wood', mult: 1 }, { sp: 'wood', mult: 1 }];
  run(fed, 39);
  assert.ok(fed.fire > plain.fire + 50, `${fed.fire} vs ${plain.fire}`);
});

test('every dinosaur kind has stats and appears in some night roster', () => {
  const seen = new Set();
  for (let n = 1; n <= CFG.nights; n++) for (const [k, c] of Object.entries(nightRoster(n))) if (c) seen.add(k);
  seen.add('compy'); // compies come by day
  assert.deepEqual([...seen].sort(), Object.keys(DINOS).sort());
});

test('night roster grows each night and the rex comes on the last night', () => {
  const r1 = nightRoster(1), r3 = nightRoster(CFG.nights);
  assert.equal(r1.rex, 0);
  assert.equal(r1.spitter, 0);
  assert.equal(r3.rex, 1);
  assert.ok(r3.raptor > r1.raptor);
  assert.ok(nightRoster(1, 2).raptor > r1.raptor, 'tier adds raptors');
});

test('compies arrive by day from day 2', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  s.t = CFG.nightLen;
  update(s, [], STEP);
  assert.equal(s.phase, 'day');
  assert.ok(s.dinos.length >= 3 && s.dinos.every((d) => d.kind === 'compy'));
});

test('a compy steals a bone, and tagging it makes it drop the bone', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  const spot = openSpot(s, 400);
  const p = s.players[0];
  Object.assign(p, spot, { carry: [{ sp: 'rex', mult: 1 }] });
  const c = fakeRaptor(spot.x + 30, spot.y, 'compy');
  c.heading = Math.PI;
  s.dinos = [c];
  run(s, 2, [{}]);
  assert.equal(p.carry.length, 0, 'compy did not steal');
  assert.equal(c.carry.sp, 'rex');
  assert.equal(p.hp, CFG.hp, 'compies do not bite');
  Object.assign(p, { x: c.x, y: c.y });
  run(s, 1, [{}]); // past the grab grace
  assert.equal(c.carry, null);
  assert.equal(s.drops.length + p.carry.length, 1, 'bone dropped');
});

test('a compy that gets away takes the bone with it', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  const spot = openSpot(s, 400);
  const c = fakeRaptor(spot.x, spot.y, 'compy');
  c.carry = { sp: 'rex', mult: 1 };
  s.dinos = [c];
  Object.assign(s.players[0], { x: spot.x + 800, y: spot.y });
  update(s, [{}], STEP);
  assert.equal(s.dinos.length, 0);
});

test('a spitter hits from range and slows you', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  const sp = fakeRaptor(spot.x + 60, spot.y, 'spitter');
  sp.heading = Math.PI;
  s.dinos = [sp];
  Object.assign(s.players[0], spot);
  let slowed = false;
  for (let t = 0; t < 4 && !slowed; t += STEP) { update(s, [{}], STEP); slowed = s.players[0].slow > 0; }
  assert.ok(slowed, 'never hit by venom');
  assert.ok(s.players[0].hp < CFG.hp);
});

test('the rex cannot see you if you stand still', () => {
  const still = newRun({ trait: 'none', seed: 3 });
  const spot = openSpot(still, 400);
  for (const [s, moving] of [[still, false]]) {
    toNight(s);
    s.dinos = [fakeRaptor(spot.x + 120, spot.y, 'rex')];
    Object.assign(s.players[0], spot);
    update(s, [moving ? { x: 0.01 } : {}], STEP);
    assert.equal(s.dinos[0].mode, 'wander');
  }
  const moving = newRun({ trait: 'none', seed: 3 });
  toNight(moving);
  moving.dinos = [fakeRaptor(spot.x + 120, spot.y, 'rex')];
  Object.assign(moving.players[0], spot);
  update(moving, [{ y: 1 }], STEP);
  assert.equal(moving.dinos[0].mode, 'chase');
  assert.ok(moving.events.some((e) => e.type === 'roar'));
});

test('a rex shakes off a snare twice as fast and bites for 2', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  const rex = fakeRaptor(spot.x, spot.y, 'rex');
  s.dinos = [rex];
  s.traps = [{ x: spot.x, y: spot.y, armed: true }];
  update(s, [], STEP);
  assert.ok(Math.abs(rex.stun - CFG.stunTime * DINOS.rex.stunScale) < 0.05);
  assert.equal(DINOS.rex.dmg, 2);
});

test('going down spills your bones; a partner can pick them up', () => {
  const s = newRun({ trait: 'none', seed: 3, players: 2 });
  toNight(s);
  const spot = openSpot(s, 400);
  const [a, b] = s.players;
  Object.assign(a, spot, { hp: 1, carry: [{ sp: 'rex', mult: 2 }, { sp: 'stego', mult: 1 }] });
  Object.assign(b, { x: s.world.camp.x, y: s.world.camp.y });
  s.dinos = [fakeRaptor(spot.x + 15, spot.y)];
  run(s, 2, [{}, {}]);
  assert.ok(a.down);
  assert.equal(s.drops.length, 2);
  s.dinos = [];
  for (const d of [...s.drops]) { Object.assign(b, { x: d.x, y: d.y }); update(s, [{}, {}], STEP); }
  assert.equal(b.carry.length, 2);
  assert.equal(b.carry.find((c) => c.sp === 'rex').mult, 2, 'night bonus kept');
});

test('filling the museum request pays its bonus', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  const c = s.contract;
  assert.ok(c && c.need >= 3);
  s.players[0].carry = Array.from({ length: c.need }, () => ({ sp: c.sp, mult: 1 }));
  s.st.cap = 10;
  Object.assign(s.players[0], { x: s.world.camp.x, y: s.world.camp.y });
  const before = s.funding;
  update(s, [{}], STEP);
  assert.ok(c.done);
  assert.ok(s.funding - before >= c.bonus);
});

test('amber pays big but does not count toward skeletons', () => {
  const s = newRun({ trait: 'none', seed: 3 });
  s.players[0].carry = [{ sp: 'amber', mult: 1 }];
  Object.assign(s.players[0], { x: s.world.camp.x, y: s.world.camp.y });
  update(s, [{}], STEP);
  assert.equal(s.funding, CFG.amberValue);
  assert.equal(s.bankedCount, 0);
  assert.equal(s.amber, 1);
});

test('traits: picked from the seed; amber and bone-yard islands change the sites', () => {
  assert.equal(newRun({ seed: 11 }).trait, newRun({ seed: 11 }).trait);
  for (const id of TRAIT_POOL) assert.ok(TRAITS[id].name);
  const rich = newRun({ trait: 'rich', seed: 3 }), calm = newRun({ trait: 'none', seed: 3 });
  assert.ok(rich.world.sites.length > calm.world.sites.length);
  const amber = newRun({ trait: 'amber', seed: 3 });
  assert.ok(amber.world.sites.some((x) => x.species === 'amber'));
  assert.ok(!calm.world.sites.some((x) => x.species === 'amber'));
});

test('higher expedition tiers pay more per bone', () => {
  const s = newRun({ trait: 'none', seed: 3, tier: 2 });
  s.players[0].carry = [{ sp: 'raptor', mult: 1 }];
  Object.assign(s.players[0], { x: s.world.camp.x, y: s.world.camp.y });
  update(s, [{}], STEP);
  assert.equal(s.funding, Math.round(10 * (1 + 2 * CFG.tierValue)));
});

test('finished skeletons grant perks', () => {
  const save = { ...freshSave(), museum: { stego: 6, raptor: 3 } };
  assert.deepEqual(perks(save), ['stego']);
  assert.equal(stats({}, perks(save)).hp, CFG.hp + 1);
  assert.equal(stats({ medkit: 2 }, []).hp, CFG.hp + 2);
  assert.ok(stats({}, ['raptor']).speed > stats({}, []).speed);
  assert.ok(stats({}, ['trike']).stun > CFG.stunTime);
  assert.ok(!collection(save).some((c) => c.id === 'amber'));
});
