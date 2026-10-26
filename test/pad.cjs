// Headless controller test with a fake standard-mapping gamepad.
const { chromium } = require('playwright');

async function waitFor(page, fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn)) return;
    await page.waitForTimeout(30);
  }
  throw new Error(`timed out waiting for: ${fn}`);
}

(async () => {
  const { startServer } = await import('../scripts/serve.mjs');
  const server = await startServer(0);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const b = () => ({ pressed: false, value: 0 });
    window.__pad = {
      id: 'fake', index: 0, connected: true, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, b),
      vibrationActuator: { playEffect: () => { window.__rumbles = (window.__rumbles || 0) + 1; return Promise.resolve(); } },
    };
    navigator.getGamepads = () => [window.__pad];
  });
  const tap = async (i) => {
    await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; }, i);
    await page.waitForTimeout(80);
    await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, i);
    await page.waitForTimeout(80);
  };
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await waitFor(page, () => window.__digsite && window.__digsite.screen === 'menu');

    // Menu: D-pad down from PLAY SOLO to PLAY CO-OP, then A.
    await tap(13);
    await tap(0);
    await waitFor(page, () => window.__digsite.screen === 'play');
    if (await page.evaluate(() => window.__digsite.run.players.length) !== 2) throw new Error('co-op did not start');

    // One pad in co-op drives P2; keyboard stays P1.
    const before = await page.evaluate(() => window.__digsite.run.players.map((p) => p.x));
    await page.evaluate(() => { window.__pad.axes[0] = 1; });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__pad.axes[0] = 0; });
    const after = await page.evaluate(() => window.__digsite.run.players.map((p) => p.x));
    if (!(after[1] > before[1] + 20)) throw new Error(`pad did not move P2 (${before[1]} -> ${after[1]})`);
    if (Math.abs(after[0] - before[0]) > 0.01) throw new Error('pad moved P1 in co-op');

    // Rumble on a hit.
    await page.evaluate(() => {
      const s = window.__digsite.run;
      s.events.push({ type: 'hurt', id: 1 });
    });
    await waitFor(page, () => (window.__rumbles || 0) > 0);

    // Start pauses, B quits to the summary, A returns to the menu.
    await tap(9);
    await waitFor(page, () => window.__digsite.paused === true);
    const t0 = await page.evaluate(() => window.__digsite.run.time);
    await page.waitForTimeout(300);
    if (await page.evaluate(() => window.__digsite.run.time) !== t0) throw new Error('game ran while paused');
    await tap(1);
    await waitFor(page, () => window.__digsite.screen === 'summary');
    await tap(0);
    await waitFor(page, () => window.__digsite.screen === 'menu');

    // Solo: Start with one pad starts solo, and the pad drives P1.
    await tap(9);
    await waitFor(page, () => window.__digsite.screen === 'play');
    if (await page.evaluate(() => window.__digsite.run.players.length) !== 1) throw new Error('start did not begin solo');
    const y0 = await page.evaluate(() => window.__digsite.run.players[0].y);
    await page.evaluate(() => { window.__pad.buttons[13] = { pressed: true, value: 1 }; }); // D-pad down
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__pad.buttons[13] = { pressed: false, value: 0 }; });
    const y1 = await page.evaluate(() => window.__digsite.run.players[0].y);
    if (!(y1 > y0 + 10)) throw new Error(`D-pad did not move P1 (${y0} -> ${y1})`);

    // Y starts the tutorial from the menu; holding it must not open the build menu.
    await page.evaluate(() => { window.__digsite.run.players[0].hp = 0; });
    await page.evaluate(() => { const d = window.__digsite; d.run.players[0].down = true; });
    await waitFor(page, () => window.__digsite.screen === 'summary');
    await tap(0);
    await waitFor(page, () => window.__digsite.screen === 'menu');
    await page.evaluate(() => { window.__pad.buttons[3] = { pressed: true, value: 1 }; });
    await waitFor(page, () => window.__digsite.screen === 'play' && !!window.__digsite.tutorial);
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.__pad.buttons[3] = { pressed: false, value: 0 }; });
    await page.waitForTimeout(100);
    if (await page.evaluate(() => window.__digsite.buildMode) !== null) throw new Error('tutorial started with the build menu open');

    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    console.log('pad ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
