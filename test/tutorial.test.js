import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, update, menuItems } from '../src/game.js';
import { CFG, buildById } from '../src/data.js';
import { makeTutorial, updateTutorial, currentStep, tutorialHint, tutorialTarget, STEPS, TUTORIAL_SEED, TIP_AFTER } from '../src/tutorial.js';
import { fillKeys } from '../src/keys.js';
import { freshSave, loadSave } from '../src/save.js';

const STEP = 1 / 60;
function setup() {
  const s = newRun({ seed: TUTORIAL_SEED, tutorial: true });
  return { s, tut: makeTutorial(s) };
}
// One frame: sim, then the overlay sees this frame's events, then they're drained.
function frame(s, tut, inp = {}) {
  update(s, [inp], STEP);
  const advanced = updateTutorial(tut, s, s.events, STEP);
  s.events.length = 0;
  return advanced;
}
function hold(s, tut, secs, inp = {}) { for (let t = 0; t < secs; t += STEP) frame(s, tut, inp); }
const at = (s, pos) => Object.assign(s.players[0], { x: pos.x, y: pos.y });

test('tutorial island is calm, short, and has its marked site and tree', () => {
  const { s, tut } = setup();
  assert.equal(s.trait, 'none');
  assert.equal(s.nights, 1);
  assert.equal(s.contract, null, 'no museum request to distract');
  assert.ok(tut.site && tut.tree && tut.tree.stand && tut.rock);
  assert.equal(currentStep(tut).id, 'move');
});

test('doing nothing for five minutes: nothing advances, no night, no game over', () => {
  const { s, tut } = setup();
  hold(s, tut, 300);
  assert.equal(currentStep(tut).id, 'move');
  assert.equal(s.phase, 'day');
  assert.equal(s.dinos.length, 0);
  assert.equal(s.over, false);
  assert.ok(tutorialHint(tut, s).tip, 'a tip shows when stuck');
});

test('full walkthrough with real inputs completes the tutorial', () => {
  const { s, tut } = setup();
  hold(s, tut, 0.8, { y: 1 });                                         // move
  assert.equal(currentStep(tut).id, 'dig');
  assert.deepEqual(tutorialTarget(tut, s), tut.site);
  at(s, tut.site); hold(s, tut, s.st.digTime + 0.1, { dig: true });    // dig
  assert.equal(currentStep(tut).id, 'bank');
  at(s, s.world.camp); frame(s, tut);                                  // bank
  assert.equal(currentStep(tut).id, 'chop');
  at(s, tut.tree.stand); hold(s, tut, CFG.chopTime + 0.1, { dig: true }); // chop
  assert.equal(currentStep(tut).id, 'stack');
  at(s, s.world.camp); frame(s, tut);                                  // stack
  assert.equal(currentStep(tut).id, 'mine');
  at(s, tut.rock); hold(s, tut, CFG.mineTime + 0.1, { dig: true });    // mine
  assert.equal(currentStep(tut).id, 'stone');
  at(s, s.world.camp); frame(s, tut);                                  // stone
  assert.equal(currentStep(tut).id, 'build');
  const p = s.players[0];
  Object.assign(p, { x: s.world.camp.x, y: s.world.camp.y + 90, fx: 0, fy: 1 });
  const tapIn = (inp) => { frame(s, tut, inp); frame(s, tut); };
  const choose = (id) => {
    frame(s, tut); // let go of anything still held
    tapIn(buildById[id].kind === 'place' ? { build: true } : { dig: true }); // gear: use the table
    for (let i = 0; i < 10 && menuItems(s, p)[p.build.sel].id !== id; i++) tapIn({ y: 1 });
    tapIn({ dig: true });
    if (p.build && p.build.mode !== 'menu') hold(s, tut, buildById[id].time + 0.05, { dig: true });
  };
  choose('wall');
  // (choose() already held dig long enough to build the wall)
  assert.equal(currentStep(tut).id, 'bench');
  Object.assign(p, { fx: 1, fy: 0 });
  choose('workbench');                                                 // bench
  assert.equal(currentStep(tut).id, 'craft');
  choose('spear');                                                     // craft
  assert.equal(currentStep(tut).id, 'workshop');
  Object.assign(p, { fx: -1, fy: 0 });
  choose('workshop');                                                  // workshop
  assert.equal(currentStep(tut).id, 'craft2');
  choose('pickaxe');                                                   // craft2
  assert.ok(s.owned.pickaxe);
  assert.equal(currentStep(tut).id, 'attack');
  tapIn({ attack: true });                                             // attack
  assert.equal(currentStep(tut).id, 'snare');
  Object.assign(p, { fx: 1, fy: 0 });                                  // face the workbench
  choose('snare');                                                     // snare
  assert.equal(p.traps, 1);
  assert.equal(currentStep(tut).id, 'trap');
  frame(s, tut, { trap: true }); frame(s, tut);                        // trap
  assert.equal(currentStep(tut).id, 'dusk');
  hold(s, tut, 11);                                                    // dusk -> night
  assert.equal(s.phase, 'night');
  assert.equal(s.dinos.length, 1, 'one raptor');
  assert.equal(currentStep(tut).id, 'night');
  hold(s, tut, s.nightLen + 1);                                        // survive
  assert.ok(tut.done);
  assert.equal(s.result, 'won');
});

test('each step only counts what happens while it is active', () => {
  const { s, tut } = setup();
  // Bank a bone and set a snare while still on the "move" step, without moving.
  s.players[0].carry = [{ sp: 'raptor', mult: 1 }];
  frame(s, tut);
  frame(s, tut, { trap: true });
  assert.equal(currentStep(tut).id, 'move');
  hold(s, tut, 0.8, { y: 1 });
  at(s, tut.site); hold(s, tut, s.st.digTime + 0.1, { dig: true });
  assert.equal(currentStep(tut).id, 'bank', 'earlier deposit did not pre-complete the bank step');
});

test('the dig step is pinned to the marked site', () => {
  const { s, tut } = setup();
  hold(s, tut, 0.8, { y: 1 });
  const other = s.world.sites.find((x) => x !== tut.site && x.bones > 0);
  at(s, other); hold(s, tut, s.st.digTime + 0.1, { dig: true });
  assert.equal(currentStep(tut).id, 'dig');
});

test('stall warnings: full bag, and standing where digging outranks chopping', () => {
  const { s, tut } = setup();
  tut.i = STEPS.findIndex((x) => x.id === 'chop');
  s.players[0].carry = Array.from({ length: s.st.cap }, () => ({ sp: 'raptor', mult: 1 }));
  assert.match(tutorialHint(tut, s).tip, /BAG IS FULL/);
  s.players[0].carry = [];
  at(s, tut.site);
  assert.match(tutorialHint(tut, s).tip, /TOO CLOSE TO A DIG SITE/);
});

test('you cannot die in the tutorial', () => {
  const { s, tut } = setup();
  tut.i = STEPS.findIndex((x) => x.id === 'dusk');
  s.tutorial.hold = false; s.t = s.dayLen; update(s, [{}], STEP);
  const r = s.dinos[0];
  at(s, { x: s.world.camp.x + 600, y: s.world.camp.y });
  for (let i = 0; i < 4; i++) {
    Object.assign(r, { x: s.players[0].x + 5, y: s.players[0].y, cd: 0, stun: 0 });
    s.players[0].invuln = 0;
    update(s, [{}], STEP);
  }
  assert.equal(s.over, false);
  assert.equal(s.players[0].down, false);
});

test('hints name the right button for each device', () => {
  assert.equal(fillKeys('HOLD {DIG}', 'keys'), 'HOLD E');
  assert.equal(fillKeys('HOLD {DIG}', 'pad'), 'HOLD A');
  assert.equal(fillKeys('HOLD {DIG}', 'touch'), 'HOLD DIG');
  for (const st of STEPS) for (const d of ['keys', 'pad', 'touch']) assert.ok(!/\{/.test(fillKeys(st.text, d)), `${st.id}/${d}`);
});

test('tip appears after being stuck a while', () => {
  const { s, tut } = setup();
  assert.equal(tutorialHint(tut, s).tip, null);
  hold(s, tut, TIP_AFTER + 0.1);
  assert.ok(tutorialHint(tut, s).tip);
});

test('old saves load with the tutorial not done', () => {
  assert.equal(freshSave().tutorialDone, false);
  assert.equal(loadSave({ getItem: () => JSON.stringify({ funding: 5 }) }).tutorialDone, false);
});

test('dropping your only snare early cannot soft-lock the snare step', () => {
  const { s, tut } = setup();
  tut.i = STEPS.findIndex((x) => x.id === 'trap');
  s.stock.wood = 2; // what entering the step tops up
  const p = s.players[0];
  assert.equal(p.traps, 0);
  assert.match(tutorialHint(tut, s).tip, /MAKE ANOTHER AT THE WORKBENCH/);
  // Craft one at a workbench, then the step completes.
  const tx = Math.floor(p.x / 32) + 1, ty = Math.floor(p.y / 32);
  const st = { kind: 'workbench', tx, ty, x: (tx + 0.5) * 32, y: (ty + 0.5) * 32, hp: 20, maxHp: 20, solid: true, life: 0 };
  s.structures.push(st); s.structAt.set(ty * s.world.w + tx, st);
  assert.equal(tutorialTarget(tut, s), st, 'arrow points at the workbench');
  Object.assign(p, { fx: 1, fy: 0 });
  const tapIn = (inp) => { frame(s, tut, inp); frame(s, tut); };
  tapIn({ dig: true });
  for (let i = 0; i < 5 && menuItems(s, p)[p.build.sel].id !== 'snare'; i++) tapIn({ y: 1 });
  tapIn({ dig: true });
  hold(s, tut, buildById.snare.time + 0.05, { dig: true });
  frame(s, tut);
  tapIn({ trap: true });
  assert.equal(currentStep(tut).id, 'dusk');
});
