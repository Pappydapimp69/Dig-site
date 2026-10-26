import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, update } from '../src/game.js';
import { blocked, TILE } from '../src/world.js';
import { CFG } from '../src/data.js';
import { freshSave, applyRun, buy, loadSave, collection } from '../src/save.js';

const STEP = 1 / 60;
const run = (s, secs, inputs = []) => { for (let t = 0; t < secs && !s.over; t += STEP) update(s, inputs, STEP); };
const toNight = (s) => { s.t = CFG.dayLen; update(s, [], STEP); };
const fakeRaptor = (x, y) => ({ x, y, heading: 0, wanderH: 0, wanderT: 9, stun: 0, cd: 0, mode: 'wander' });

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
  const a = newRun({ seed: 7 }), b = newRun({ seed: 7 });
  assert.deepEqual(a.world.tiles, b.world.tiles);
  assert.deepEqual(a.world.sites, b.world.sites);
});

test('camp is walkable and every dig site is reachable', () => {
  for (const seed of [1, 2, 3, 42, 999, 12345]) {
    const s = newRun({ seed });
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
  const s = newRun({ seed: 3 });
  const x0 = s.players[0].x;
  run(s, 0.5, [{ x: 1, y: 0 }]);
  assert.ok(s.players[0].x > x0 + 30);
});

test('dig a bone, carry it home, get paid', () => {
  const s = newRun({ seed: 3 });
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
  const s = newRun({ seed: 3 });
  const p = s.players[0], site = s.world.sites[0];
  site.bones = 10;
  Object.assign(p, { x: site.x, y: site.y });
  run(s, s.st.digTime * 6, [{ dig: true }]);
  assert.equal(p.carry.length, s.st.cap);
});

test('night digs are worth double', () => {
  const s = newRun({ seed: 3 });
  toNight(s);
  s.raptors = [];
  const p = s.players[0], site = s.world.sites[0];
  Object.assign(p, { x: site.x, y: site.y });
  run(s, s.st.digTime + 0.05, [{ dig: true }]);
  assert.equal(p.carry[0].mult, CFG.nightBonus);
});

test('nightfall spawns raptors away from camp', () => {
  const s = newRun({ seed: 3 });
  toNight(s);
  assert.equal(s.phase, 'night');
  assert.equal(s.raptors.length, 3);
  for (const r of s.raptors) assert.ok(Math.hypot(r.x - s.world.camp.x, r.y - s.world.camp.y) > 16 * TILE);
});

test('raptors never enter a strong fire', () => {
  const s = newRun({ seed: 3 });
  toNight(s);
  const c = s.world.camp;
  s.raptors = [fakeRaptor(c.x + 200, c.y)];
  s.raptors[0].heading = Math.PI;
  for (let t = 0; t < 10; t += STEP) {
    update(s, [], STEP);
    if (s.fire > CFG.fireSafeMin) {
      assert.ok(Math.hypot(s.raptors[0].x - c.x, s.raptors[0].y - c.y) >= s.fire - 0.01);
    }
  }
  assert.equal(s.players[0].hp, CFG.hp, 'player in camp got bitten');
});

test('raptor turn rate is limited', () => {
  const s = newRun({ seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  s.raptors = [fakeRaptor(spot.x, spot.y)];
  Object.assign(s.players[0], { x: spot.x - 60, y: spot.y }); // directly behind it
  const h0 = s.raptors[0].heading;
  update(s, [{}], STEP);
  assert.ok(Math.abs(s.raptors[0].heading - h0) <= CFG.raptorTurn * STEP + 1e-9);
});

test('a raptor bites an exposed solo player until the run is lost', () => {
  const s = newRun({ seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  s.raptors = [fakeRaptor(spot.x + 40, spot.y)];
  Object.assign(s.players[0], { x: spot.x, y: spot.y });
  run(s, 20, [{}]);
  assert.equal(s.over, true);
  assert.equal(s.result, 'lost');
  assert.ok(s.players[0].down);
});

test('a trap stuns a raptor', () => {
  const s = newRun({ seed: 3 });
  toNight(s);
  const spot = openSpot(s, 400);
  const r = fakeRaptor(spot.x, spot.y);
  s.raptors = [r];
  s.traps = [{ x: spot.x, y: spot.y, armed: true }];
  update(s, [], STEP);
  assert.ok(r.stun > 0);
  assert.equal(s.traps.length, 0);
});

test('placing a trap needs a fresh press', () => {
  const s = newRun({ seed: 3, upgrades: { traps: 2 } });
  run(s, 1, [{ trap: true }]);
  assert.equal(s.traps.length, 1);
});

test('co-op: a teammate revives a downed player', () => {
  const s = newRun({ seed: 3, players: 2 });
  const [a, b] = s.players;
  b.down = true; b.hp = 0;
  Object.assign(a, { x: b.x + 10, y: b.y });
  run(s, CFG.reviveTime + 0.1, [{ dig: true }, {}]);
  assert.equal(b.down, false);
  assert.equal(b.hp, 1);
});

test('surviving every night clears the island with a bonus', () => {
  const s = newRun({ seed: 3 });
  s.funding = 100;
  for (let n = 0; n < CFG.nights; n++) {
    run(s, CFG.dayLen + 0.1);
    s.raptors = [];
    for (let t = 0; t < CFG.nightLen + 0.1 && !s.over; t += STEP) { update(s, [], STEP); s.raptors = []; }
  }
  assert.equal(s.result, 'won');
  assert.equal(s.payout, Math.round(100 * CFG.winBonus));
});

test('museum keeps bones and funding across runs', () => {
  const s = newRun({ seed: 3 });
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
    const s = newRun({ seed: 3 });
    toNight(s);
    const spot = openSpot(s, 400);
    const a = k * 0.37, d = 30 + (k % 5) * 15;
    const r = fakeRaptor(spot.x + Math.cos(a) * d, spot.y + Math.sin(a) * d);
    r.heading = a + (k % 2 ? 1 : -1) * Math.PI / 2;
    s.raptors = [r];
    Object.assign(s.players[0], { x: spot.x, y: spot.y });
    run(s, 5, [{}]);
    if (s.players[0].hp === CFG.hp) missed++;
  }
  assert.equal(missed, 0, `${missed}/20 raptors orbited without biting`);
});
