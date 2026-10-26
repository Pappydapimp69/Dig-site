# Dig Site

Dig by day. Survive the night.

A solo or 2-player co-op survival roguelite. You're a fossil hunter on a cursed
island. By day you dig up dinosaur bones and haul them back to camp. At night,
raptors hunt you. Your camp fire keeps them off, until it dies down. Survive 3
nights to clear the island. Bones and funding carry over to your museum, where
you buy upgrades between runs.

## Play

```
npm run serve        # then open http://127.0.0.1:8080
```

- **Solo:** Space on the menu. WASD or arrows to move, E or Space to dig, Q or Shift for a trap.
- **Co-op:** Enter on the menu. P1: WASD, E dig/revive, Q trap. P2: arrows, `.` dig/revive, `,` trap.
- Gamepads work: left stick, A to dig, X for a trap.
- Menu: number keys 1-7 buy upgrades.

## Rules of the island

**Dinosaurs**
- **Velociraptor** - fast but turns slowly, so a late sidestep works.
- **Compsognathus** - comes by day from day 2. Steals from your bag. Tag it to get your loot back; it's slower when carrying.
- **Dilophosaurus** - from night 2. Spits venom from range that hurts and slows you.
- **Tyrannosaurus** - the last night. Bites for 2 and shrugs off snares fast, but it only sees you when you move. Freeze.

**Everything else**
- Hold dig next to a tree to chop wood. Wood brought to camp by day is stacked and burned at dusk; wood brought at night keeps the fire alive.
- Every island has a trait: Foggy, Full Moon, Storm, Bone Yard or Amber Coast.
- Amber is rare and worth a lot. The museum posts a request each run that pays a bonus.
- Finishing a skeleton unlocks a permanent perk (speed, an extra heart, longer snares, faster digging, a bigger fire).
- Each island you clear makes the next expedition harder and every bone worth more.
- If you go down, your bag spills. Your partner can pick it up.

- Bones you dig at night are worth double.
- A full bag slows you down. Tall grass slows you down but hides you.
- Raptors are faster than you but turn slowly, so a late sidestep works.
- The fire shrinks all night. Once it's small, raptors stop being scared of it.
- Snares stun a raptor for 3 seconds. You get a fresh set each night.
- In co-op, hold dig next to a downed partner to revive them.

## Desktop / Steam build

```
npm install
npm run desktop      # runs in an Electron window
```

## Tests

```
npm test             # simulation tests (no browser)
npm run smoke        # headless browser playtest (needs Playwright)
```

## Layout

- `src/game.js` - the simulation. Pure, no DOM, seeded, so it's testable.
- `src/world.js` - island generation. Every dig site is checked reachable from camp.
- `src/data.js` - all tuning numbers and content tables.
- `src/save.js` - museum save, upgrades, collection.
- `src/render.js` - pixel-art renderer. Draws at 480x300; the page scales it up crisp.
- `src/art/` - bitmap font, sprites (authored grids + generated), island pre-render.
- `src/input.js`, `src/sfx.js`, `src/main.js` - the rest of the browser side.
- `electron/` - desktop wrapper.
