// Tuning and content tables. Everything balance-related lives here.
export const CFG = {
  dayLen: 75,        // seconds of daylight
  nightLen: 55,      // seconds of night
  // Nights never end the run. You leave by day (pause menu) to keep it all.
  digTime: 1.6,      // seconds to dig one bone
  chopTime: 1.2,     // seconds to chop one log
  mineTime: 2.0,     // seconds to mine one stone
  mineR: 30,         // how close you must stand to a rock
  digR: 30,          // how close you must stand to a dig site
  chopR: 30,         // how close you must stand to a tree
  pickR: 18,         // walk over dropped items to pick them up
  speed: 150,        // player px/s
  pr: 10,            // player radius
  hp: 3,
  invuln: 1.2,       // seconds of safety after a hit
  campR: 70,         // drop bones and wood inside this radius
  fireR: 150,        // camp fire light/safety radius at full fuel
  fireSafeMin: 40,   // below this the fire no longer scares dinosaurs
  woodFuel: 0.3,     // one log adds this much night fuel (1 = a full night)
  maxFuel: 1.6,
  duskBurn: 2,       // logs from the camp stock the fire burns at dusk
  baseCap: 3,        // items carried
  baseTraps: 1,      // traps per night
  trapR: 22,
  stunTime: 3,
  reviveR: 34,
  reviveTime: 2,
  raptorSpeed: 175,  // faster than you...
  raptorTurn: 2.6,   // ...but turns slowly (rad/s), so a late sidestep works
  raptorR: 11,
  biteR: 20,
  brakeR: 90,        // biters slow down to turn when this close to prey
  sight: 230,
  tallGrassSight: 0.45, // hiding in tall grass shrinks how far dinosaurs see you
  stillSight: 0.7,
  spitSpeed: 230,
  spitSlow: 2,       // seconds slowed after a venom hit
  amberChance: 0.06, // chance a dig site is amber instead of bones
  amberValue: 30,
  nightBonus: 2,     // bones dug at night are worth double
  winBonus: 1.5,     // tutorial payout multiplier
  leaveBonus: 0.1,   // leaving pays +10% per night survived
  deathKeep: 0.5,    // dying keeps half the run's funding
  tierValue: 0.25,   // each expedition tier adds this to bone value
  requestsPerTier: 3,
  requestBonus: 3,   // a request pays need x bone value x this
  attackCd: 0.45,
  spearR: 38,
  shotSpeed: 320,
  structR: 13,       // how much of a tile a wall blocks
  torchR: 55,        // torches scare dinosaurs this close
  torchLife: 100,    // seconds of night a torch burns
  stationR: 64,      // stand this close to a crafting table to use it
};

// One shared AI with per-kind stats (see game.js updateDino).
export const DINOS = {
  raptor: { name: 'Velociraptor', speed: CFG.raptorSpeed, turn: CFG.raptorTurn, r: CFG.raptorR, bite: CFG.biteR, sight: CFG.sight, dmg: 1, hp: 3, wallDps: 2 },
  compy: { name: 'Compsognathus', speed: 160, ladenSpeed: 135, turn: 5, r: 6, bite: 16, sight: 200, dmg: 0, thief: true, hp: 1, wallDps: 0 },
  spitter: { name: 'Dilophosaurus', speed: 105, turn: 3, r: 10, bite: 18, sight: 300, dmg: 1, range: 210, keepAway: 110, spitCd: 2.6, hp: 3, wallDps: 1 },
  rex: { name: 'Tyrannosaurus', speed: 125, turn: 1.5, r: 20, bite: 36, sight: 360, dmg: 2, motionOnly: true, stunScale: 0.5, hp: 15, wallDps: 8 },
};

export const TRAITS = {
  none: { name: 'Calm Island', desc: '', amberChance: 0 }, // tests only
  foggy: { name: 'Foggy Island', desc: 'Short sight for you and them.', sight: 0.75, light: 0.65 },
  fullmoon: { name: 'Full Moon', desc: 'Brighter nights. More raptors.', dark: 0.62, extraRaptors: 1 },
  storm: { name: 'Storm Island', desc: 'Rain masks you. Mud slows you.', sight: 0.7, playerSpeed: 0.9 },
  rich: { name: 'Bone Yard', desc: 'Extra dig sites.', extraSites: 5 },
  amber: { name: 'Amber Coast', desc: 'Amber everywhere.', amberChance: 0.3 },
};
export const TRAIT_POOL = ['foggy', 'fullmoon', 'storm', 'rich', 'amber'];

// Bones = how many make one full skeleton for the museum.
export const SPECIES = [
  { id: 'raptor', name: 'Velociraptor', bones: 4, value: 5, weight: 5, color: '#e8dcc0', perk: '+10% SPEED' },
  { id: 'stego', name: 'Stegosaurus', bones: 6, value: 10, weight: 4, color: '#e2cfa0', perk: '+1 HEART' },
  { id: 'trike', name: 'Triceratops', bones: 6, value: 12, weight: 3, color: '#efe3c8', perk: 'LONGER SNARES' },
  { id: 'herra', name: 'Herrerasaurus', bones: 5, value: 15, weight: 2, color: '#f4e9d0', perk: 'DIG FASTER' },
  { id: 'rex', name: 'Tyrannosaurus', bones: 8, value: 25, weight: 1, color: '#fff4dc', perk: 'BIGGER FIRE' },
  { id: 'amber', name: 'Amber', bones: 0, value: CFG.amberValue, weight: 0, color: '#ffb43d', treasure: true },
];
export const speciesById = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
export const FOSSILS = SPECIES.filter((s) => !s.treasure);

export const UPGRADES = [
  { id: 'bag', name: 'Bigger Bag', desc: '+1 item carried', base: 40, max: 4 },
  { id: 'dig', name: 'Better Brush', desc: 'dig 20% faster', base: 50, max: 4 },
  { id: 'boots', name: 'Trail Boots', desc: 'move 10% faster', base: 60, max: 3 },
  { id: 'traps', name: 'Snare Kit', desc: '+1 trap each night', base: 45, max: 4 },
  { id: 'fire', name: 'Bigger Fire', desc: 'camp fire burns wider', base: 70, max: 3 },
  { id: 'lantern', name: 'Lantern', desc: 'see farther, spot dig sites', base: 55, max: 3 },
  { id: 'medkit', name: 'Medkit', desc: '+1 heart', base: 120, max: 2 },
];

export const upgradeCost = (u, lvl) => u.base * (lvl + 1);

// Things you build or craft during a run from the camp's wood and stone.
// Each unlocks permanently after filling that many museum requests.
// kind: place (put on the tile you face), tool/weapon (crafted once per run), use (consumed on the spot).
// time: seconds of holding dig to build or craft it.
// station: this structure is a crafting table of that level. needs: crafting
// it requires standing at a table of at least that level.
export const STATIONS = { 1: 'Workbench', 2: 'Stone Workshop' };
export const BUILDS = [
  { id: 'workbench', time: 3, name: 'Workbench', kind: 'place', cost: { wood: 4 }, unlock: 0, hp: 20, solid: true, station: 1, desc: 'craft axes and spears here' },
  { id: 'snare', time: 1, name: 'Snare', kind: 'place', cost: { wood: 1 }, unlock: 0, desc: 'stuns a dinosaur' },
  { id: 'torch', time: 1, name: 'Torch', kind: 'place', cost: { wood: 1 }, unlock: 0, desc: 'light that scares dinosaurs' },
  { id: 'axe', time: 2.5, name: 'Axe', kind: 'tool', cost: { wood: 2, stone: 1 }, unlock: 1, needs: 1, desc: 'chop twice as fast' },
  { id: 'wall', time: 2, name: 'Wood Wall', kind: 'place', cost: { wood: 2 }, unlock: 2, hp: 12, solid: true, desc: 'blocks dinosaurs' },
  { id: 'spear', time: 2.5, name: 'Spear', kind: 'weapon', cost: { wood: 2, stone: 1 }, unlock: 3, needs: 1, desc: 'hit and knock back' },
  { id: 'workshop', time: 5, name: 'Stone Workshop', kind: 'place', cost: { wood: 3, stone: 4 }, unlock: 4, hp: 40, solid: true, station: 2, desc: 'craft advanced gear here' },
  { id: 'pickaxe', time: 3, name: 'Pickaxe', kind: 'tool', cost: { wood: 1, stone: 2 }, unlock: 4, needs: 2, desc: 'mine twice as fast' },
  { id: 'spikes', time: 3, name: 'Spike Wall', kind: 'place', cost: { wood: 3, stone: 1 }, unlock: 5, hp: 16, solid: true, spikes: 1, desc: 'hurts what attacks it' },
  { id: 'sling', time: 2.5, name: 'Sling', kind: 'weapon', cost: { wood: 1, stone: 1 }, unlock: 6, needs: 2, desc: 'stun from range (uses stone)' },
  { id: 'flare', time: 0.6, name: 'Flare', kind: 'use', cost: { wood: 1, stone: 1 }, unlock: 7, needs: 2, scareR: 170, scareTime: 6, desc: 'scares off everything nearby' },
  { id: 'stonewall', time: 4, name: 'Stone Wall', kind: 'place', cost: { stone: 3 }, unlock: 8, hp: 40, solid: true, desc: 'a much tougher wall' },
];
export const buildById = Object.fromEntries(BUILDS.map((b) => [b.id, b]));
export const nextUnlock = (filled) => BUILDS.find((b) => b.unlock > filled) || null;
