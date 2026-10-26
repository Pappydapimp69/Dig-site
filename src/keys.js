// One place that names controls for the active device. Every on-screen hint
// goes through here at render time, so hints never drift from the handlers.
const NAMES = {
  keys: { move: 'WASD', dig: 'E', trap: 'Q', pause: 'ESC', quit: 'Q', tutorial: 'T', resume: 'ESC' },
  pad: { move: 'THE STICK', dig: 'A', trap: 'X', pause: 'START', quit: 'B', tutorial: 'Y', resume: 'START OR A' },
  touch: { move: 'THE STICK', dig: 'DIG', trap: 'TRAP', pause: '', quit: '', tutorial: 'TAP', resume: 'TAP' },
};

export const keyName = (action, device) => (NAMES[device] || NAMES.keys)[action];

// "Hold {DIG}" -> "Hold E" / "Hold A" / "Hold DIG".
export const fillKeys = (text, device) => text.replace(/\{(\w+)\}/g, (_, a) => keyName(a.toLowerCase(), device) ?? a);
