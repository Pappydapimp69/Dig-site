const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'Space', 'Enter',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Period', 'Comma',
]);
const unit = (v) => Math.max(-1, Math.min(1, v));
const dead = (v) => (Math.abs(v) < 0.2 ? 0 : v);

export function makeInput(target) {
  const down = new Set();
  const listeners = [];
  // On-screen controls write here; they drive player 1.
  const touch = { x: 0, y: 0, dig: false, trap: false, active: false };
  const prevPadButtons = [];

  target.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat) listeners.forEach((f) => f(e.code));
    down.add(e.code);
  });
  target.addEventListener('keyup', (e) => down.delete(e.code));
  target.addEventListener('blur', () => down.clear());

  const k = (c) => (down.has(c) ? 1 : 0);

  function pads() {
    const list = (navigator.getGamepads && navigator.getGamepads()) || [];
    return Array.from(list).filter(Boolean);
  }

  // Gamepad A/Start act like Space/Enter on menus.
  function pollPadPresses() {
    pads().forEach((pad, i) => {
      const a = !!pad.buttons[0]?.pressed, start = !!pad.buttons[9]?.pressed;
      const prev = prevPadButtons[i] || {};
      if (a && !prev.a) listeners.forEach((f) => f('Space'));
      if (start && !prev.start) listeners.forEach((f) => f('Enter'));
      prevPadButtons[i] = { a, start };
    });
  }

  function players(n) {
    const p1 = { x: k('KeyD') - k('KeyA'), y: k('KeyS') - k('KeyW'), dig: !!k('KeyE'), trap: !!k('KeyQ') };
    const p2 = {
      x: k('ArrowRight') - k('ArrowLeft'), y: k('ArrowDown') - k('ArrowUp'),
      dig: !!(k('Period') || k('Numpad0')), trap: !!(k('Comma') || k('NumpadDecimal')),
    };
    if (n === 1) {
      p1.x = unit(p1.x + p2.x);
      p1.y = unit(p1.y + p2.y);
      p1.dig = p1.dig || !!k('Space') || p2.dig;
      p1.trap = p1.trap || !!k('ShiftLeft') || p2.trap;
    }
    if (touch.x || touch.y) { p1.x = touch.x; p1.y = touch.y; }
    p1.dig = p1.dig || touch.dig;
    p1.trap = p1.trap || touch.trap;
    const out = n === 1 ? [p1] : [p1, p2];
    pads().slice(0, n).forEach((pad, i) => {
      const o = out[i];
      const ax = dead(pad.axes[0] || 0), ay = dead(pad.axes[1] || 0);
      if (ax || ay) { o.x = ax; o.y = ay; }
      o.dig = o.dig || !!pad.buttons[0]?.pressed;
      o.trap = o.trap || !!pad.buttons[2]?.pressed;
    });
    return out;
  }

  return { onPress: (f) => listeners.push(f), players, pollPadPresses, touch };
}
