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
  won: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle'), i * 120)),
  lost: () => tone(220, 1, 'sawtooth', 0.12, -160),
};
