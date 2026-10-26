import { newRun, update, finish } from './game.js';
import { makeRenderer } from './render.js';
import { makeInput } from './input.js';
import { loadSave, writeSave, applyRun, buy } from './save.js';
import { UPGRADES, speciesById } from './data.js';
import { SFX, unlockAudio } from './sfx.js';

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
let msg = '';
let acc = 0;
let last = performance.now();

function start(players) {
  run = newRun({ seed: (Math.random() * 2 ** 31) | 0, players, upgrades: save.upgrades });
  screen = 'play';
  acc = 0;
}

function endRun() {
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
};

function drainEvents() {
  for (const e of run.events) {
    SFX[e.type]?.();
    const t = EVENT_TEXT[e.type];
    R.event({ ...e, text: t ? t(e) : null }, run);
  }
  run.events.length = 0;
}

input.onPress((code) => {
  unlockAudio();
  if (screen === 'menu') {
    msg = '';
    if (code === 'Space') start(1);
    else if (code === 'Enter') start(2);
    const m = /^Digit([1-9])$/.exec(code);
    if (m && UPGRADES[m[1] - 1]) {
      const r = buy(save, UPGRADES[m[1] - 1].id);
      if (r.ok) { save = r.save; writeSave(storage(), save); SFX.deposit(); }
      else msg = r.why === 'maxed' ? 'Already maxed.' : 'Not enough funding.';
    }
  } else if (screen === 'summary') {
    if (code === 'Space' || code === 'Enter') screen = 'menu';
  } else if (screen === 'play' && code === 'Escape') {
    finish(run, 'lost');
  }
});

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.pollPadPresses();
  if (screen === 'play') {
    acc += dt;
    while (acc >= STEP && !run.over) {
      update(run, input.players(run.players.length), STEP);
      acc -= STEP;
    }
    drainEvents();
    R.drawGame(run, dt);
    if (run.over) endRun();
  } else if (screen === 'menu') {
    R.drawMenu(save, msg, now / 1000);
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
  start,
  step(seconds, inputs = []) {
    for (let t = 0; t < seconds && run && !run.over; t += STEP) update(run, inputs, STEP);
  },
};
