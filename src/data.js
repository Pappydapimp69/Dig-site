// Tuning and content tables. Everything balance-related lives here.
export const CFG = {
  dayLen: 75,        // seconds of daylight
  nightLen: 55,      // seconds of night
  nights: 3,         // survive this many nights to clear the island
  digTime: 1.6,      // seconds to dig one bone
  digR: 30,          // how close you must stand to a dig site
  speed: 150,        // player px/s
  pr: 10,            // player radius
  hp: 3,
  invuln: 1.2,       // seconds of safety after a bite
  campR: 70,         // drop bones inside this radius
  fireR: 150,        // camp fire light/safety radius at dusk
  fireSafeMin: 40,   // below this the fire no longer scares raptors
  baseCap: 3,        // bones carried
  baseTraps: 1,      // traps per night
  trapR: 22,
  stunTime: 3,
  reviveR: 34,
  reviveTime: 2,
  raptorSpeed: 175,  // faster than you...
  raptorTurn: 2.6,   // ...but turns slowly (rad/s), so a late sidestep works
  raptorR: 11,
  biteR: 20,
  brakeR: 90,        // raptors slow down to turn when this close to prey
  sight: 230,
  tallGrassSight: 0.45, // hiding in tall grass shrinks how far raptors see you
  stillSight: 0.7,
  nightBonus: 2,     // bones dug at night are worth double
  winBonus: 1.5,     // payout multiplier for clearing the island
};

// Bones = how many make one full skeleton for the museum.
export const SPECIES = [
  { id: 'raptor', name: 'Velociraptor', bones: 4, value: 10, weight: 5, color: '#e8dcc0' },
  { id: 'stego', name: 'Stegosaurus', bones: 6, value: 20, weight: 4, color: '#e2cfa0' },
  { id: 'trike', name: 'Triceratops', bones: 6, value: 25, weight: 3, color: '#efe3c8' },
  { id: 'herra', name: 'Herrerasaurus', bones: 5, value: 30, weight: 2, color: '#f4e9d0' },
  { id: 'rex', name: 'Tyrannosaurus', bones: 8, value: 50, weight: 1, color: '#fff4dc' },
];
export const speciesById = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export const UPGRADES = [
  { id: 'bag', name: 'Bigger Bag', desc: '+1 bone carried', base: 40, max: 4 },
  { id: 'dig', name: 'Better Brush', desc: 'dig 20% faster', base: 50, max: 4 },
  { id: 'boots', name: 'Trail Boots', desc: 'move 10% faster', base: 60, max: 3 },
  { id: 'traps', name: 'Snare Kit', desc: '+1 trap each night', base: 45, max: 4 },
  { id: 'fire', name: 'Bigger Fire', desc: 'camp fire burns wider', base: 70, max: 3 },
];

export const upgradeCost = (u, lvl) => u.base * (lvl + 1);
