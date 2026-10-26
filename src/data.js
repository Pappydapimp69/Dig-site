// Tuning and content tables. Everything balance-related lives here.
export const CFG = {
  dayLen: 75,        // seconds of daylight
  nightLen: 55,      // seconds of night
  nights: 3,         // survive this many nights to clear the island
  digTime: 1.6,      // seconds to dig one bone
  chopTime: 1.2,     // seconds to chop one log
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
  maxWoodPile: 4,    // logs stockpiled by day, burned at dusk
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
  amberValue: 60,
  nightBonus: 2,     // bones dug at night are worth double
  winBonus: 1.5,     // payout multiplier for clearing the island
  tierValue: 0.25,   // each cleared expedition adds this to bone value
};

// One shared AI with per-kind stats (see game.js updateDino).
export const DINOS = {
  raptor: { name: 'Velociraptor', speed: CFG.raptorSpeed, turn: CFG.raptorTurn, r: CFG.raptorR, bite: CFG.biteR, sight: CFG.sight, dmg: 1 },
  compy: { name: 'Compsognathus', speed: 160, ladenSpeed: 135, turn: 5, r: 6, bite: 16, sight: 200, dmg: 0, thief: true },
  spitter: { name: 'Dilophosaurus', speed: 105, turn: 3, r: 10, bite: 18, sight: 300, dmg: 1, range: 210, keepAway: 110, spitCd: 2.6 },
  rex: { name: 'Tyrannosaurus', speed: 125, turn: 1.5, r: 20, bite: 36, sight: 360, dmg: 2, motionOnly: true, stunScale: 0.5 },
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
  { id: 'raptor', name: 'Velociraptor', bones: 4, value: 10, weight: 5, color: '#e8dcc0', perk: '+10% SPEED' },
  { id: 'stego', name: 'Stegosaurus', bones: 6, value: 20, weight: 4, color: '#e2cfa0', perk: '+1 HEART' },
  { id: 'trike', name: 'Triceratops', bones: 6, value: 25, weight: 3, color: '#efe3c8', perk: 'LONGER SNARES' },
  { id: 'herra', name: 'Herrerasaurus', bones: 5, value: 30, weight: 2, color: '#f4e9d0', perk: 'DIG FASTER' },
  { id: 'rex', name: 'Tyrannosaurus', bones: 8, value: 50, weight: 1, color: '#fff4dc', perk: 'BIGGER FIRE' },
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
