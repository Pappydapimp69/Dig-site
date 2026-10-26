import { newRun, update, finish } from './game.js';
import { makeRenderer } from './render.js';
import { makeInput } from './input.js';
import { loadSave, writeSave, applyRun, buy, perks } from './save.js';
import { UPGRADES, speciesById, CFG } from './data.js';
import { SFX, unlockAudio } from './sfx.js';
import { makeTutorial, updateTutorial, tutorialHint, tutorialTarget, TUTORIAL_SEED } from './tutorial.js';

const STEP = 1 / 60;
const canvas = document.getElementById('game');
const R = makeRenderer(canvas);
const input = makeInput(window);

function storage() {
  try { return window.localStorage; } catch { return null; }
}

let save = loadSave(storage());
let screen = 'menu';
let run = null;
let tut = null;
const device = () => (input.touch.active ? 'touch' : input.device);
let msg = '';
let paused = false;
// Menu cursor for controllers: upgrades 0..n-1, then PLAY SOLO, PLAY CO-OP.
const SOLO = UPGRADES.length, COOP = UPGRADES.length + 1;
let sel = SOLO;
let acc = 0;
let last = performance.now();

function start(players) {
  run = newRun({
    seed: (Math.random() * 2 ** 31) | 0, players, upgrades: save.upgrades,
    perks: perks(save), tier: Math.min(save.wins, 6),
  });
  tut = null;
  screen = 'play';
  paused = false;
  acc = 0;
}

function startTutorial() {
  run = newRun({ seed: TUTORIAL_SEED, players: 1, tutorial: true });
  tut = makeTutorial(run);
  screen = 'play';
  paused = false;
  acc = 0;
}

function tryBuy(i) {
  const r = buy(save, UPGRADES[i].id);
  if (r.ok) { save = r.save; writeSave(storage(), save); SFX.deposit(); }
  else msg = r.why === 'maxed' ? 'Already maxed.' : 'Not enough funding.';
}

function endRun() {
  if (run.tutorial) {
    // The tutorial never counts as a run; finishing it once pays a starter bonus.
    if (run.result === 'won') {
      const first = !save.tutorialDone;
      save = { ...save, tutorialDone: true, funding: save.funding + (first ? 50 : 0) };
      writeSave(storage(), save);
      msg = first ? 'TUTORIAL DONE! +$50 TO START YOU OFF.' : 'TUTORIAL DONE!';
    }
    tut = null;
    screen = 'menu';
    return;
  }
  save = applyRun(save, run);
  writeSave(storage(), save);
  screen = 'summary';
}

const EVENT_TEXT = {
  bone: (e) => `${speciesById[e.sp].name} bone!`,
  deposit: (e) => `+$${e.gained} for the museum`,
  night: (e) => `Night ${e.n}. They're coming.`,
  dawn: () => 'Dawn. Get digging.',
  snap: () => 'Snare! Raptor stunned.',
  down: (e) => `P${e.id + 1} is down!`,
  revive: (e) => `P${e.id + 1} is back up`,
  rexwarn: () => 'The ground is shaking...',
  roar: () => 'THE REX SEES YOU. FREEZE!',
  steal: () => 'A compy stole your loot! Tag it!',
  escaped: () => 'The compy got away.',
  amber: () => `Amber! Worth $${CFG.amberValue}.`,
  contract: (e) => `Museum request filled! +$${e.bonus}`,
  rescued: () => 'You made it back to camp.',
  wood: (e) => (run.phase === 'night' ? 'The fire flares up.' : `Firewood stacked (${run.woodPile}).`),
};

const RUMBLE = {
  hurt: (e) => input.rumble(e.id, run.players.length, 0.6, 180),
  down: (e) => input.rumble(e.id, run.players.length, 1, 450),
  roar: () => input.rumble(null, 0, 0.9, 800),
  snap: () => input.rumble(null, 0, 0.25, 90),
  bone: (e) => input.rumble(e.id, run.players.length, 0.15, 60),
};

function drainEvents() {
  for (const e of run.events) {
    SFX[e.type]?.();
    RUMBLE[e.type]?.(e);
    const t = EVENT_TEXT[e.type];
    R.event({ ...e, text: t ? t(e) : null }, run);
  }
  run.events.length = 0;
}

function press(code) {
  unlockAudio();
  if (code === 'PadConnected' || code === 'PadDisconnected') {
    const text = code === 'PadConnected' ? `Controller ${input.padCount()} connected` : 'Controller disconnected';
    if (screen === 'play') R.toast(text); else msg = text;
    if (code === 'PadDisconnected' && screen === 'play' && !run.over) paused = true;
    return;
  }
  if (screen === 'menu') {
    msg = '';
    if (code === 'Space') start(1);
    else if (code === 'Enter') start(2);
    else if (code === 'PadStart') start(input.padCount() >= 2 ? 2 : 1);
    else if (code === 'KeyT' || code === 'PadY') startTutorial();
    else if (code === 'PadUp') sel = (sel + COOP) % (COOP + 1);
    else if (code === 'PadDown') sel = (sel + 1) % (COOP + 1);
    else if (code === 'PadLeft' || code === 'PadRight') { if (sel >= SOLO) sel = sel === SOLO ? COOP : SOLO; }
    else if (code === 'PadA') {
      if (sel === SOLO) start(1);
      else if (sel === COOP) start(2);
      else tryBuy(sel);
    }
    const m = /^Digit([1-9])$/.exec(code);
    if (m && UPGRADES[m[1] - 1]) tryBuy(m[1] - 1);
  } else if (screen === 'summary') {
    if (['Space', 'Enter', 'PadA', 'PadB', 'PadStart'].includes(code)) screen = 'menu';
  } else if (screen === 'play') {
    if (code === 'Escape' || code === 'PadStart') paused = !paused;
    else if (paused && (code === 'KeyQ' || code === 'PadB' || code === 'PadSelect')) { paused = false; finish(run, 'lost'); }
    else if (paused && code === 'PadA') paused = false;
  }
}
input.onPress(press);

// Taps on the canvas work the menus (buy a row, start a run).
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * canvas.width / r.width;
  const y = (e.clientY - r.top) * canvas.height / r.height;
  if (screen === 'menu') {
    const i = Math.floor((y - 80) / 18);
    if (x >= 14 && x <= 246 && y >= 80 && i < UPGRADES.length) tryBuy(i);
    else if (y >= 262) startTutorial();
    else if (y > 214) press(input.touch.active || x < canvas.width / 2 ? 'Space' : 'Enter');
  } else if (screen === 'summary') press('Space');
  else if (screen === 'play' && paused) paused = false;
});

function setupTouch() {
  const ui = document.getElementById('touch');
  if (!ui) return;
  const show = () => { ui.hidden = false; input.touch.active = true; };
  // A controller takes over: hide the on-screen controls until the next touch.
  setInterval(() => { if (input.device === 'pad' && !ui.hidden) { ui.hidden = true; input.touch.active = false; } }, 500);
  window.addEventListener('touchstart', show, { passive: true });
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) show();

  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  let sid = null, ox = 0, oy = 0;
  const moveStick = (e) => {
    const R = stick.clientWidth / 2;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Dead zone matters: the rex sees any movement.
    const k = Math.hypot(dx, dy) / R < 0.2 ? 0 : 1;
    input.touch.x = (dx / R) * k;
    input.touch.y = (dy / R) * k;
  };
  stick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId;
    stick.setPointerCapture(sid);
    const r = stick.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e); });
  const end = (e) => {
    if (e.pointerId !== sid) return;
    sid = null;
    input.touch.x = input.touch.y = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);

  const hold = (id, key) => {
    const b = document.getElementById(id);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      unlockAudio();
      b.setPointerCapture(e.pointerId);
      input.touch[key] = true;
      if (screen !== 'play' && key === 'dig') press('Space');
    });
    const up = () => { input.touch[key] = false; };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  };
  hold('btn-dig', 'dig');
  hold('btn-trap', 'trap');
}
setupTouch();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.pollPadPresses(dt);
  if (screen === 'play') {
    if (!paused) acc += dt;
    while (acc >= STEP && !run.over) {
      update(run, input.players(run.players.length), STEP);
      acc -= STEP;
    }
    if (tut && !paused && updateTutorial(tut, run, run.events, dt)) {
      SFX.contract();
      if (!tut.done) R.toast('Nice!');
    }
    drainEvents();
    R.drawGame(run, paused ? 0 : dt);
    if (tut && !tut.done) R.drawTutorial(run, tutorialHint(tut, run), tutorialTarget(tut, run), device());
    if (paused) R.drawPause(device());
    if (run.over) endRun();
  } else if (screen === 'menu') {
    R.drawMenu(save, msg, now / 1000, device(), sel);
  } else {
    R.drawSummary(run, now / 1000);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook: lets automated playtests read state and fast-forward.
window.__digsite = {
  get screen() { return screen; },
  get run() { return run; },
  get save() { return save; },
  get paused() { return paused; },
  start,
  startTutorial,
  get tutorial() { return tut; },
  step(seconds, inputs = []) {
    for (let t = 0; t < seconds && run && !run.over; t += STEP) update(run, inputs, STEP);
  },
};
