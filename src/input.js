const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'Space', 'Enter',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Period', 'Comma',
  'KeyF', 'KeyB', 'Slash', 'Semicolon',
]);
// Standard gamepad mapping (Xbox names; PlayStation is the same layout).
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PRESS = ['A', 'B', 'X', 'Y', 'START', 'SELECT'];
const DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
const REPEAT_FIRST = 0.4, REPEAT_NEXT = 0.12;
const unit = (v) => Math.max(-1, Math.min(1, v));

export function makeInput(target) {
  const down = new Set();
  // Keys pressed since the sim last read input, so a tap shorter than a
  // frame still counts (held-state alone misses it).
  const tapped = new Set();
  const listeners = [];
  // On-screen controls write here; they drive player 1.
  const touch = { x: 0, y: 0, dig: false, trap: false, build: false, attack: false, active: false };
  const padPrev = [];
  const state = { device: 'keys' };
  const emit = (code, pad) => listeners.forEach((f) => f(code, pad));

  target.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    state.device = 'keys';
    if (!e.repeat) { emit(e.code); tapped.add(e.code); }
    down.add(e.code);
  });
  target.addEventListener('keyup', (e) => down.delete(e.code));
  target.addEventListener('blur', () => down.clear());
  target.addEventListener('touchstart', () => { state.device = 'touch'; }, { passive: true });
  target.addEventListener('gamepadconnected', (e) => emit('PadConnected', e.gamepad.index));
  target.addEventListener('gamepaddisconnected', (e) => emit('PadDisconnected', e.gamepad.index));

  const k = (c) => (down.has(c) || tapped.has(c) ? 1 : 0);

  function pads() {
    const list = (navigator.getGamepads && navigator.getGamepads()) || [];
    return Array.from(list).filter((p) => p && p.connected !== false);
  }
  const btn = (pad, name) => {
    const b = pad.buttons[BTN[name]];
    return !!b && (b.pressed || b.value > 0.5);
  };

  // Left stick with a radial dead zone, D-pad overriding it.
  function padMove(pad) {
    let x = pad.axes[0] || 0, y = pad.axes[1] || 0;
    const m = Math.hypot(x, y);
    if (m < 0.25) { x = 0; y = 0; } else { const s = Math.min(1, (m - 0.25) / 0.75) / m; x *= s; y *= s; }
    const dx = btn(pad, 'RIGHT') - btn(pad, 'LEFT'), dy = btn(pad, 'DOWN') - btn(pad, 'UP');
    if (dx || dy) { x = dx; y = dy; }
    return { x, y };
  }

  // Edge-detected presses for menus: PadA, PadB, PadStart, PadUp (with auto-repeat), ...
  function pollPadPresses(dt = 1 / 60) {
    pads().forEach((pad) => {
      const prev = padPrev[pad.index] || (padPrev[pad.index] = { held: {}, rep: {} });
      const m = padMove(pad);
      const dir = { UP: m.y < -0.5, DOWN: m.y > 0.5, LEFT: m.x < -0.5, RIGHT: m.x > 0.5 };
      for (const name of PRESS) {
        const now = btn(pad, name);
        if (now && !prev.held[name]) { state.device = 'pad'; emit(`Pad${name[0]}${name.slice(1).toLowerCase()}`, pad.index); }
        prev.held[name] = now;
      }
      for (const name of DIRS) {
        const code = `Pad${name[0]}${name.slice(1).toLowerCase()}`;
        if (!dir[name]) { prev.rep[name] = null; continue; }
        if (prev.rep[name] == null) { state.device = 'pad'; emit(code, pad.index); prev.rep[name] = REPEAT_FIRST; continue; }
        prev.rep[name] -= dt;
        if (prev.rep[name] <= 0) { emit(code, pad.index); prev.rep[name] = REPEAT_NEXT; }
      }
      if (m.x || m.y) state.device = 'pad';
    });
  }

  // Which player each connected pad drives. Solo: every pad drives P1.
  // Co-op with one pad: keyboard is P1, the pad is P2.
  function padOwners(n) {
    const list = pads();
    if (n === 1) return list.map((pad) => ({ pad, player: 0 }));
    const offset = Math.max(0, n - list.length);
    return list.slice(0, n).map((pad, j) => ({ pad, player: offset + j }));
  }

  function players(n) {
    const p1 = {
      x: k('KeyD') - k('KeyA'), y: k('KeyS') - k('KeyW'),
      dig: !!k('KeyE'), trap: !!k('KeyQ'), attack: !!k('KeyF'), build: !!k('KeyB'),
    };
    const p2 = {
      x: k('ArrowRight') - k('ArrowLeft'), y: k('ArrowDown') - k('ArrowUp'),
      dig: !!(k('Period') || k('Numpad0')), trap: !!(k('Comma') || k('NumpadDecimal')),
      attack: !!k('Slash'), build: !!k('Semicolon'),
    };
    if (n === 1) {
      p1.x = unit(p1.x + p2.x);
      p1.y = unit(p1.y + p2.y);
      p1.dig = p1.dig || !!k('Space') || p2.dig;
      p1.trap = p1.trap || !!k('ShiftLeft') || p2.trap;
      p1.attack = p1.attack || p2.attack;
      p1.build = p1.build || p2.build;
    }
    if (touch.x || touch.y) { p1.x = touch.x; p1.y = touch.y; }
    for (const key of ['dig', 'trap', 'attack', 'build']) p1[key] = p1[key] || touch[key] || tapped.has(`touch:${key}`);
    // Fresh presses since the last read (xTap). A release and re-press inside
    // one frame look like "still held" to edge detection; these catch it.
    const t = (...codes) => codes.some((c) => tapped.has(c));
    const taps1 = { dig: ['KeyE', 'touch:dig'], trap: ['KeyQ', 'touch:trap'], attack: ['KeyF', 'touch:attack'], build: ['KeyB', 'touch:build'] };
    const taps2 = { dig: ['Period', 'Numpad0'], trap: ['Comma', 'NumpadDecimal'], attack: ['Slash'], build: ['Semicolon'] };
    for (const key of Object.keys(taps1)) {
      p1[`${key}Tap`] = t(...taps1[key], ...(n === 1 ? taps2[key] : []), ...(n === 1 && key === 'dig' ? ['Space'] : []), ...(n === 1 && key === 'trap' ? ['ShiftLeft'] : []));
      p2[`${key}Tap`] = t(...taps2[key]);
    }
    tapped.clear();
    const out = n === 1 ? [p1] : [p1, p2];
    for (const { pad, player } of padOwners(n)) {
      const o = out[player];
      const m = padMove(pad);
      if (m.x || m.y) { o.x = m.x; o.y = m.y; }
      o.dig = o.dig || btn(pad, 'A') || btn(pad, 'RT');
      o.trap = o.trap || btn(pad, 'X') || btn(pad, 'RB') || btn(pad, 'LB');
      o.attack = o.attack || btn(pad, 'B');
      o.build = o.build || btn(pad, 'Y');
    }
    return out;
  }

  // Rumble the pad(s) driving a player (or every pad when player is null).
  function rumble(player, n, strong, ms) {
    const owners = player == null ? pads().map((pad) => ({ pad })) : padOwners(n).filter((o) => o.player === player);
    for (const { pad } of owners) {
      const act = pad.vibrationActuator;
      if (act && act.playEffect) {
        act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: Math.min(1, strong * 0.6) }).catch(() => {});
      }
    }
  }

  return {
    onPress: (f) => listeners.push(f), players, pollPadPresses, rumble, touch,
    // On-screen buttons call this on press so a tap shorter than a frame still counts.
    tapTouch: (key) => tapped.add(`touch:${key}`),
    // Drop taps left over from menus (they'd fire on a run's first frame).
    clearTaps: () => tapped.clear(),
    padCount: () => pads().length,
    get device() { return state.device; },
  };
}
