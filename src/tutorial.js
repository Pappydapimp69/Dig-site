// Tutorial overlay. It watches the real game (state + events) and advances
// steps; it never re-implements a verb. Each step only counts what happens
// while it is active, and the dig step is pinned to one marked site.
import { CFG } from './data.js';
import { TILE, T, blocked, tileNear } from './world.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const STEPS = [
  { id: 'move', text: 'MOVE WITH {MOVE}.', tip: 'WALK A FEW STEPS AWAY FROM THE FIRE.' },
  { id: 'dig', text: 'STAND ON THE MARKED DIG SITE AND HOLD {DIG}.', tip: 'STAND STILL. THE BAR FILLS AS YOU DIG.' },
  { id: 'bank', text: 'CARRY THE BONE BACK TO CAMP.', tip: 'WALK INTO THE DIRT CIRCLE AROUND THE FIRE.' },
  { id: 'chop', text: 'HOLD {DIG} NEXT TO A TREE TO CHOP WOOD.', tip: 'STAND RIGHT BESIDE THE MARKED TREE.' },
  { id: 'stack', text: 'BRING THE WOOD TO CAMP. IT BURNS AT NIGHT.', tip: 'WOOD STACKED BY DAY FEEDS THE FIRE AT DUSK.' },
  { id: 'mine', text: 'HOLD {DIG} NEXT TO THE ROCKS TO MINE STONE.', tip: 'STAND BESIDE THE MARKED ROCK, AWAY FROM TREES.' },
  { id: 'stone', text: 'BRING THE STONE TO CAMP.', tip: 'WOOD AND STONE AT CAMP ARE WHAT YOU BUILD WITH.' },
  { id: 'build', text: 'PRESS {BUILD} TO OPEN THE BUILD MENU. CHOOSE WOOD WALL WITH {CHOOSE} AND {PLACE}.', tip: '{BUILD} CLOSES THE MENU.' },
  { id: 'bench', text: 'NOW BUILD A WORKBENCH THE SAME WAY. TOOLS AND WEAPONS ARE CRAFTED AT ONE.', tip: 'BETTER GEAR NEEDS A STONE WORKSHOP LATER.' },
  { id: 'craft', text: 'STAND AT THE WORKBENCH. OPEN THE BUILD MENU AND CHOOSE SPEAR.', tip: 'MORE BUILDS UNLOCK AS YOU FILL MUSEUM REQUESTS.' },
  { id: 'workshop', text: 'BETTER GEAR NEEDS A STONE WORKSHOP. BUILD ONE FROM THE BUILD MENU.', tip: 'IT COSTS WOOD AND STONE. THE MUSEUM SENT SOME.' },
  { id: 'craft2', text: 'STAND AT THE WORKSHOP AND CRAFT A PICKAXE. IT MINES TWICE AS FAST.', tip: 'THE MENU SAYS WHICH TABLE EACH ITEM NEEDS.' },
  { id: 'attack', text: 'PRESS {ATTACK} TO SWING YOUR SPEAR.', tip: 'HIT A DINOSAUR ENOUGH AND IT RUNS OFF.' },
  { id: 'trap', text: 'PRESS {TRAP} TO SET A SNARE.', tip: 'A DINOSAUR THAT STEPS ON A SNARE IS STUNNED.' },
  { id: 'dusk', text: 'NIGHT IS COMING. GO BACK TO THE FIRE.', tip: 'DINOSAURS COME OUT AT NIGHT.' },
  { id: 'night', text: 'THE FIRE KEEPS RAPTORS AWAY UNTIL IT BURNS LOW. SURVIVE UNTIL DAWN.', tip: 'SPEAR IT WITH {ATTACK}, FEED THE FIRE, OR LURE IT ONTO YOUR SNARE.' },
];
export const TUTORIAL_SEED = 6; // a calm island with a dig site and a tree near camp
export const TIP_AFTER = 12; // seconds stuck on a step before the tip shows

// Nearest tree you can stand beside that is well away from every dig site,
// so the dig button chops there instead of digging (digging wins otherwise).
function pickTree(world, from) {
  let best = null, bd = Infinity;
  for (let ty = 0; ty < world.h; ty++) {
    for (let tx = 0; tx < world.w; tx++) {
      if (world.tiles[ty * world.w + tx] !== T.TREE) continue;
      const c = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (world.sites.some((s) => dist(s, c) < CFG.digR + CFG.chopR + TILE)) continue;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const stand = { x: c.x + dx * TILE, y: c.y + dy * TILE };
        const i = Math.floor(stand.y / TILE) * world.w + Math.floor(stand.x / TILE);
        if (!world.reach[i] || blocked(world, stand.x, stand.y, CFG.pr)) continue;
        const d = dist(stand, from);
        if (d < bd) { bd = d; best = { ...c, stand }; }
      }
    }
  }
  return best;
}

// A rock you can mine without a tree or dig site taking the button first.
function pickRock(world, from) {
  let best = null, bd = Infinity;
  for (let ty = 0; ty < world.h; ty++) {
    for (let tx = 0; tx < world.w; tx++) {
      const i = ty * world.w + tx;
      if (!world.reach[i]) continue;
      const stand = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (blocked(world, stand.x, stand.y, CFG.pr)) continue;
      if (!tileNear(world, stand.x, stand.y, CFG.mineR, T.ROCK) || tileNear(world, stand.x, stand.y, CFG.chopR, T.TREE)) continue;
      if (world.sites.some((s) => dist(s, stand) < CFG.digR + TILE)) continue;
      const d = dist(stand, from);
      if (d < bd) { bd = d; best = { ...stand, stand }; }
    }
  }
  return best;
}

export function makeTutorial(s) {
  const camp = s.world.camp;
  const site = s.world.sites.filter((x) => x.species !== 'amber').sort((a, b) => dist(a, camp) - dist(b, camp))[0];
  site.bones = Math.max(site.bones, 2);
  const tut = { i: 0, t: 0, site, tree: pickTree(s.world, camp), rock: pickRock(s.world, camp), done: false, base: {} };
  enter(tut, s);
  return tut;
}

function enter(tut, s) {
  tut.t = 0;
  const p = s.players[0];
  tut.base = { x: p.x, y: p.y, bones: tut.site.bones };
  // The museum tops up supplies so the build steps can't stall on materials.
  if (STEPS[tut.i].id === 'build') { s.stock.wood = Math.max(s.stock.wood, 4); s.stock.stone = Math.max(s.stock.stone, 1); }
  if (STEPS[tut.i].id === 'bench') s.stock.wood = Math.max(s.stock.wood, 4);
  if (STEPS[tut.i].id === 'workshop') { s.stock.wood = Math.max(s.stock.wood, 3); s.stock.stone = Math.max(s.stock.stone, 4); }
  if (STEPS[tut.i].id === 'craft2') { s.stock.wood = Math.max(s.stock.wood, 1); s.stock.stone = Math.max(s.stock.stone, 2); }
  if (STEPS[tut.i].id === 'craft') { s.stock.wood = Math.max(s.stock.wood, 2); s.stock.stone = Math.max(s.stock.stone, 1); }
  if (STEPS[tut.i].id === 'dusk' && s.tutorial) {
    s.tutorial.hold = false;
    s.t = Math.max(s.t, s.dayLen - 10);
  }
}

export const currentStep = (tut) => STEPS[tut.i];

// Call once per frame with the events produced since the last call.
// Returns true when a step was completed this frame.
export function updateTutorial(tut, s, events, dt) {
  if (tut.done) return false;
  tut.t += dt;
  const p = s.players[0];
  const has = (type) => events.some((e) => e.type === type);
  let ok = false;
  switch (STEPS[tut.i].id) {
    case 'move': ok = dist(p, tut.base) > 70; break;
    case 'dig': ok = tut.site.bones < tut.base.bones; break;
    case 'bank': ok = has('deposit'); break;
    case 'chop': ok = has('chop'); break;
    case 'stack': ok = has('wood'); break;
    case 'mine': ok = has('mine'); break;
    case 'stone': ok = has('stone'); break;
    case 'build': ok = events.some((e) => e.type === 'built' && e.item === 'wall'); break;
    case 'bench': ok = events.some((e) => e.type === 'built' && e.item === 'workbench'); break;
    case 'craft': ok = events.some((e) => e.type === 'built' && e.item === 'spear'); break;
    case 'workshop': ok = events.some((e) => e.type === 'built' && e.item === 'workshop'); break;
    case 'craft2': ok = events.some((e) => e.type === 'built' && e.item === 'pickaxe'); break;
    case 'attack': ok = has('swing'); break;
    case 'trap': ok = has('trap'); break;
    case 'dusk': ok = s.phase === 'night'; break;
    case 'night': ok = s.over && s.result === 'won'; break;
  }
  if (!ok) return false;
  if (tut.i === STEPS.length - 1) { tut.done = true; return true; }
  tut.i++;
  enter(tut, s);
  return true;
}

// What to say right now. Catches the two ways a step can silently stall:
// a full bag (dig/chop do nothing) and standing where digging outranks chopping.
export function tutorialHint(tut, s) {
  const step = STEPS[tut.i];
  const p = s.players[0];
  let warn = null;
  if ((step.id === 'dig' || step.id === 'chop') && p.carry.length >= s.st.cap) warn = 'YOUR BAG IS FULL. EMPTY IT AT CAMP FIRST.';
  else if (step.id === 'chop' && s.world.sites.some((x) => x.bones > 0 && dist(x, p) < CFG.digR)) warn = 'TOO CLOSE TO A DIG SITE. USE THE MARKED TREE.';
  else if (step.id === 'dig' && p.moving && dist(p, tut.site) < CFG.digR) warn = 'STAND STILL TO DIG.';
  else if (step.id === 'mine' && p.carry.length >= s.st.cap) warn = 'YOUR BAG IS FULL. EMPTY IT AT CAMP FIRST.';
  else if ((step.id === 'mine' || step.id === 'attack' || step.id === 'trap') && p.build !== null) warn = 'THE BUILD MENU IS OPEN. PRESS {BUILD} TO CLOSE IT.';
  else if (step.id === 'build' && p.build && p.build.mode === 'place') warn = 'NOW HOLD {PLACE} TO BUILD THE WALL IN THE OUTLINE.';
  else if (step.id === 'bench' && p.build && p.build.mode === 'place') warn = 'NOW HOLD {PLACE} TO BUILD THE WORKBENCH.';
  else if ((step.id === 'craft' || step.id === 'craft2') && p.build && p.build.mode === 'craft') warn = 'HOLD {PLACE} UNTIL THE BAR FILLS.';
  else if (step.id === 'craft' && !s.structures.some((x) => x.kind === 'workbench' && dist(x, p) < CFG.stationR)) warn = 'WALK UP TO YOUR WORKBENCH FIRST.';
  else if (step.id === 'workshop' && p.build && p.build.mode === 'place') warn = 'NOW HOLD {PLACE} TO BUILD THE WORKSHOP.';
  else if (step.id === 'craft2' && !s.structures.some((x) => x.kind === 'workshop' && dist(x, p) < CFG.stationR)) warn = 'WALK UP TO YOUR STONE WORKSHOP FIRST.';
  return { text: step.text, tip: warn || (tut.t > TIP_AFTER ? step.tip : null), warn: !!warn, n: tut.i + 1, of: STEPS.length };
}

// Where the guide arrow points, in world units (or null).
export function tutorialTarget(tut, s) {
  switch (STEPS[tut.i].id) {
    case 'dig': return tut.site;
    case 'bank': case 'stack': case 'stone': case 'dusk': return s.world.camp;
    case 'chop': return tut.tree;
    case 'craft': return s.structures.find((x) => x.kind === 'workbench') || null;
    case 'craft2': return s.structures.find((x) => x.kind === 'workshop') || null;
    case 'mine': return tut.rock;
    default: return null;
  }
}
