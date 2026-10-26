// Headless playtest: build a wall with real keys, spear a raptor, leave by boat.
// Usage: node test/build-play.cjs [screenshot-dir]
const { chromium } = require('playwright');
const path = require('node:path');

async function waitFor(page, fn, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return;
    await page.waitForTimeout(40);
  }
  throw new Error(`timed out waiting for: ${fn}`);
}

(async () => {
  const { startServer } = await import('../scripts/serve.mjs');
  const server = await startServer(0);
  const shots = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const tap = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(60); };
  // Hold E until the build finishes, polling game state (headless frames run slow).
  const holdUntilBuilt = async () => {
    await page.keyboard.down('KeyE');
    try { await waitFor(page, () => window.__digsite.buildMode === null, 15000); } finally { await page.keyboard.up('KeyE'); }
  };
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => localStorage.setItem('digsite.save.v1', JSON.stringify({ requestsDone: 9, tutorialDone: true })));
    await page.reload();
    await waitFor(page, () => window.__digsite && window.__digsite.screen === 'menu');
    await tap('Space');
    await waitFor(page, () => window.__digsite.screen === 'play');
    await page.evaluate(() => {
      const s = window.__digsite.run;
      s.stock.wood = 20; s.stock.stone = 20; s.time = 10;
      const p = s.players[0];
      p.x = s.world.camp.x; p.y = s.world.camp.y + 70; p.fx = 0; p.fy = 1;
    });
    await tap('KeyB');
    if (await page.evaluate(() => window.__digsite.buildMode) !== 'menu') throw new Error('build menu did not open');
    if (shots) await page.screenshot({ path: path.join(shots, 'build-menu.png') });
    for (let i = 0; i < 12 && (await page.evaluate(() => window.__digsite.buildName())) !== 'wall'; i++) await tap('KeyS');
    await tap('KeyE');
    if (await page.evaluate(() => window.__digsite.buildMode) !== 'place') throw new Error('no placement after choosing');
    if (shots) await page.screenshot({ path: path.join(shots, 'build-ghost.png') });
    await holdUntilBuilt();
    await waitFor(page, () => window.__digsite.run.structures.some((x) => x.kind === 'wall'));
    if (await page.evaluate(() => window.__digsite.buildMode) !== null) throw new Error('build mode stayed open after placing');
    // A spear needs a workbench: build one beside you first.
    await page.evaluate(() => { const p = window.__digsite.run.players[0]; p.fx = 1; p.fy = 0; });
    await tap('KeyB');
    for (let i = 0; i < 14 && (await page.evaluate(() => window.__digsite.buildName())) !== 'workbench'; i++) await tap('KeyS');
    await tap('KeyE'); await holdUntilBuilt();
    await waitFor(page, () => window.__digsite.run.structures.some((x) => x.kind === 'workbench'));
    if (shots) await page.screenshot({ path: path.join(shots, 'build-bench.png') });
    // Crafting happens at the table: press E facing it to open its menu.
    await tap('KeyE');
    if (await page.evaluate(() => window.__digsite.buildFrom) !== 'workbench') throw new Error('E at the workbench did not open it');
    if (shots) await page.screenshot({ path: path.join(shots, 'bench-open.png') });
    for (let i = 0; i < 14 && (await page.evaluate(() => window.__digsite.buildName())) !== 'spear'; i++) await tap('KeyS');
    await tap('KeyE'); await holdUntilBuilt();
    await waitFor(page, () => window.__digsite.run.owned.spear === true);
    // Spear a raptor placed in front of you.
    await page.evaluate(() => {
      const s = window.__digsite.run, p = s.players[0];
      s.phase = 'night';
      s.dinos.push({ kind: 'raptor', x: p.x, y: p.y + 26, hp: 3, scared: 0, carry: null, stealCd: 0, spitCd: 0, heading: -Math.PI / 2, wanderH: 0, wanderT: 9, stun: 2, cd: 5, mode: 'wander' });
    });
    await tap('KeyF');
    await waitFor(page, () => window.__digsite.run.dinos.some((d) => d.hp < 3));
    if (shots) await page.screenshot({ path: path.join(shots, 'build-fight.png') });
    // Back to day and leave from the pause menu.
    await page.evaluate(() => { const s = window.__digsite.run; s.phase = 'day'; s.dinos = []; s.night = 2; s.funding = 100; });
    await tap('Escape');
    await waitFor(page, () => window.__digsite.paused);
    if (shots) await page.screenshot({ path: path.join(shots, 'build-pause.png') });
    await tap('KeyL');
    await waitFor(page, () => window.__digsite.screen === 'summary');
    const run = await page.evaluate(() => ({ result: window.__digsite.run.result, payout: window.__digsite.run.payout }));
    if (run.result !== 'left' || run.payout !== 120) throw new Error(`bad leave: ${JSON.stringify(run)}`);
    if (shots) await page.screenshot({ path: path.join(shots, 'build-summary.png') });
    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    console.log('build ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
