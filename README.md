# Dig Site

Dig by day. Survive the night.

A solo or 2-player co-op survival roguelite. You're a fossil hunter on a cursed
island. By day you dig up dinosaur bones, chop wood and mine stone. At night,
dinosaurs hunt you. Your camp fire keeps them off until it burns low; walls,
spikes, torches and weapons do the rest. Nights never end and keep getting
harder. Leave by boat during the day to keep everything (plus 10% per night
survived); die and you keep half.

**The goal is the museum.** It posts a chain of requests. Each one you fill pays
well and permanently unlocks something new to build: axe, wood wall, spear,
pickaxe, spike wall, sling, flare, stone wall. Requests also set how hard (and
how well paid) your next expedition is.

## Play

New players: press **T** (controller **Y**, or tap the bottom line on a phone) on the menu for the tutorial. It's a calm island where the clock waits for you; finish it once for a $50 head start.

```
npm run serve        # then open http://127.0.0.1:8080
```

- **Solo:** Space on the menu. WASD or arrows to move, E or Space to dig/chop/mine, Q or Shift for a snare, F to attack, B to build. Esc pauses; from the pause menu, L leaves the island (by day).
- **Co-op:** Enter on the menu. P1: WASD, E, Q, F, B. P2: arrows, `.` dig, `,` snare, `/` attack, `;` build.
- **Build menu:** B opens it (you stand still while it's open). W/S choose, E picks, B closes. Building and crafting take time: hold E (standing still) until the bar fills, like chopping. For walls, torches, snares and tables a ghost appears on the tile you face first. Q goes back to the menu, B cancels. Materials are spent when the bar finishes. Materials come from the camp stock.
- **Controllers:** left stick or D-pad to move, A (or RT) to dig/chop/mine/revive, X (or a bumper) for a snare, B to attack, Y for the build menu (D-pad to choose, A to pick/place, X back), Start to pause; from pause, Y leaves the island and B quits. The menu works with the D-pad and A. In co-op with one controller, the keyboard is P1 and the controller is P2; with two controllers each gets a player. Controllers rumble when you're hit and when the rex roars.
- Menu: number keys 1-7 buy upgrades.

## Rules of the island

**Dinosaurs**
- **Velociraptor** - fast but turns slowly, so a late sidestep works.
- **Compsognathus** - comes by day from day 2. Steals from your bag. Tag it to get your loot back; it's slower when carrying.
- **Dilophosaurus** - from night 2. Spits venom from range that hurts and slows you.
- **Tyrannosaurus** - the last night. Bites for 2 and shrugs off snares fast, but it only sees you when you move. Freeze.

**Crafting tables**
- Tools, weapons and flares are crafted while standing at a table. A **Workbench** (4 wood) makes the axe and spear; a **Stone Workshop** (3 wood, 4 stone, unlocks with the pickaxe) makes the pickaxe, sling and flare. Walls, torches and snares need no table.

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
npm run smoke        # headless browser playtests, incl. a simulated controller (needs Playwright)
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
