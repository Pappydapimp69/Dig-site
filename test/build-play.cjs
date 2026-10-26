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
  const tap = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(60); };
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
    if (await page.evaluate(() => window.__digsite.run.players[0].build) === null) throw new Error('build mode did not open');
    // Cycle to the wood wall and build it.
    for (let i = 0; i < 12; i++) {
      const id = await page.evaluate(() => { const s = window.__digsite.run; return s.players[0].build; });
      const name = await page.evaluate(() => window.__digsite.buildName());
      if (name === 'wall') break;
      await tap('KeyQ');
    }
    if (shots) await page.screenshot({ path: path.join(shots, 'build-ghost.png') });
    await tap('KeyE');
    await waitFor(page, () => window.__digsite.run.structures.some((x) => x.kind === 'wall'));
    // Craft a spear, then leave build mode.
    for (let i = 0; i < 12 && (await page.evaluate(() => window.__digsite.buildName())) !== 'spear'; i++) await tap('KeyQ');
    await tap('KeyE');
    await waitFor(page, () => window.__digsite.run.owned.spear === true);
    await tap('KeyB');
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
