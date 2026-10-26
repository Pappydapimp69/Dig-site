// Tiny synth beeps so the prototype has feedback without audio assets.
let ac = null;

export function unlockAudio() {
  if (ac) return;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; }
}

function tone(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur);
}

export const SFX = {
  bone: () => tone(660, 0.12, 'triangle', 0.1, 220),
  deposit: () => { tone(523, 0.1, 'triangle'); setTimeout(() => tone(784, 0.15, 'triangle'), 90); },
  trap: () => tone(200, 0.08, 'square', 0.06),
  snap: () => tone(120, 0.2, 'sawtooth', 0.12, -60),
  hurt: () => tone(180, 0.25, 'sawtooth', 0.14, -120),
  down: () => tone(140, 0.6, 'sawtooth', 0.14, -100),
  revive: () => tone(440, 0.3, 'triangle', 0.1, 440),
  night: () => tone(110, 1.2, 'sine', 0.15, -40),
  dawn: () => tone(330, 0.8, 'sine', 0.1, 330),
  chop: () => tone(300, 0.07, 'square', 0.07, -120),
  wood: () => tone(180, 0.4, 'sawtooth', 0.06, 200),
  amber: () => [880, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'triangle', 0.08), i * 70)),
  steal: () => tone(900, 0.15, 'square', 0.06, -500),
  grab: () => tone(500, 0.12, 'triangle', 0.1, 300),
  spit: () => tone(400, 0.15, 'sawtooth', 0.05, -250),
  roar: () => { tone(70, 1.2, 'sawtooth', 0.2, -30); tone(95, 1, 'square', 0.08, -40); },
  rexwarn: () => tone(50, 1.5, 'sine', 0.2, -10),
  contract: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle'), i * 90)),
  pickup: () => tone(600, 0.08, 'triangle', 0.08, 200),
  mine: () => tone(520, 0.06, 'square', 0.06, -200),
  built: () => { tone(260, 0.08, 'square', 0.08); setTimeout(() => tone(390, 0.1, 'square', 0.08), 70); },
  cantafford: () => tone(150, 0.15, 'square', 0.06),
  cantbuild: () => tone(150, 0.15, 'square', 0.06),
  buildon: () => tone(600, 0.06, 'triangle', 0.06),
  buildoff: () => tone(400, 0.06, 'triangle', 0.06),
  swing: () => tone(800, 0.08, 'sawtooth', 0.05, -500),
  shoot: () => tone(700, 0.06, 'triangle', 0.06, 300),
  hit: () => tone(160, 0.1, 'square', 0.1, -60),
  routed: () => tone(500, 0.3, 'triangle', 0.08, 400),
  smash: () => tone(90, 0.4, 'sawtooth', 0.14, -40),
  noammo: () => tone(150, 0.1, 'square', 0.05),
  stone: () => tone(300, 0.1, 'square', 0.05, 60),
  left: () => [392, 523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle'), i * 120)),
  won: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle'), i * 120)),
  lost: () => tone(220, 1, 'sawtooth', 0.12, -160),
};
