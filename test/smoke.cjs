// Headless playtest: loads the real game in Chromium, plays a bit, screenshots.
// Usage: node test/smoke.cjs [screenshot-dir]
const { chromium } = require('playwright');
const path = require('node:path');

async function waitFor(page, fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for: ${fn}`);
}

(async () => {
  const { startServer } = await import('../scripts/serve.mjs');
  const server = await startServer(0);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const shots = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  try {
    await page.goto(url);
    await waitFor(page, () => window.__digsite && window.__digsite.screen === 'menu');
    if (shots) await page.screenshot({ path: path.join(shots, 'menu.png') });

    await page.keyboard.press('Enter');
    await waitFor(page, () => window.__digsite.screen === 'play');
    const x0 = await page.evaluate(() => window.__digsite.run.players[0].x);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyD');
    const x1 = await page.evaluate(() => window.__digsite.run.players[0].x);
    if (!(x1 > x0)) throw new Error(`player did not move (${x0} -> ${x1})`);
    if (shots) await page.screenshot({ path: path.join(shots, 'day.png') });

    // Jump to mid-night and move P1 out of camp so the dark and raptors show.
    await page.evaluate(() => {
      const d = window.__digsite;
      d.step(76);
      d.run.dinos.forEach((r, i) => { r.x = d.run.players[0].x + 120 + i * 30; r.y = d.run.players[0].y - 60; });
      d.step(20);
    });
    await page.waitForTimeout(200);
    if (shots) await page.screenshot({ path: path.join(shots, 'night.png') });

    await page.keyboard.press('Escape');
    await waitFor(page, () => window.__digsite.paused === true);
    await page.keyboard.press('KeyQ');
    await waitFor(page, () => window.__digsite.screen === 'summary');
    if (shots) await page.screenshot({ path: path.join(shots, 'summary.png') });
    await page.keyboard.press('Space');
    await waitFor(page, () => window.__digsite.screen === 'menu');
    const runs = await page.evaluate(() => window.__digsite.save.runs);
    if (runs !== 1) throw new Error(`save not updated, runs=${runs}`);

    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    console.log('smoke ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
