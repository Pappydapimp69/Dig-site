import { newRun, update, finish } from './game.js';
import { makeRenderer } from './render.js';
import { makeInput } from './input.js';
import { loadSave, writeSave, applyRun, buy, perks } from './save.js';
import { UPGRADES, speciesById, CFG } from './data.js';
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
  run = newRun({
    seed: (Math.random() * 2 ** 31) | 0, players, upgrades: save.upgrades,
    perks: perks(save), tier: Math.min(save.wins, 6),
  });
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
  rexwarn: () => 'The ground is shaking...',
  roar: () => 'THE REX SEES YOU. FREEZE!',
  steal: () => 'A compy stole your loot! Tag it!',
  escaped: () => 'The compy got away.',
  amber: () => `Amber! Worth $${CFG.amberValue}.`,
  contract: (e) => `Museum request filled! +$${e.bonus}`,
  wood: (e) => (run.phase === 'night' ? 'The fire flares up.' : `Firewood stacked (${run.woodPile}).`),
};

function drainEvents() {
  for (const e of run.events) {
    SFX[e.type]?.();
    const t = EVENT_TEXT[e.type];
    R.event({ ...e, text: t ? t(e) : null }, run);
  }
  run.events.length = 0;
}

function press(code) {
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
}
input.onPress(press);

// Taps on the canvas work the menus (buy a row, start a run).
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * canvas.width / r.width;
  const y = (e.clientY - r.top) * canvas.height / r.height;
  if (screen === 'menu') {
    const i = Math.floor((y - 80) / 18);
    if (x >= 14 && x <= 246 && y >= 80 && i < UPGRADES.length) press(`Digit${i + 1}`);
    else if (y > 214) press(input.touch.active || x < canvas.width / 2 ? 'Space' : 'Enter');
  } else if (screen === 'summary') press('Space');
});

function setupTouch() {
  const ui = document.getElementById('touch');
  if (!ui) return;
  const show = () => { ui.hidden = false; input.touch.active = true; };
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) show();
  window.addEventListener('touchstart', show, { once: true, passive: true });

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
    R.drawMenu(save, msg, now / 1000, input.touch.active);
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
