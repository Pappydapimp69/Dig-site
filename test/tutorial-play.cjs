// Headless playtest of the tutorial with real key presses.
// Usage: node test/tutorial-play.cjs [screenshot-dir]
const { chromium } = require('playwright');
const path = require('node:path');

async function waitFor(page, fn, timeout = 8000) {
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
  const step = () => page.evaluate(() => { const t = window.__digsite.tutorial; return t && !t.done ? ['move', 'dig', 'bank', 'chop', 'stack', 'mine', 'stone', 'build', 'craft', 'attack', 'trap', 'dusk', 'night'][t.i] : 'done'; });
  const holdKey = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
  const goTo = (what) => page.evaluate((what) => {
    const d = window.__digsite, s = d.run, t = d.tutorial, p = s.players[0];
    const pos = what === 'site' ? t.site : what === 'tree' ? t.tree.stand : what === 'rock' ? t.rock : s.world.camp;
    p.x = pos.x; p.y = pos.y;
  }, what);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await waitFor(page, () => window.__digsite && window.__digsite.screen === 'menu');
    await page.keyboard.press('KeyT');
    await waitFor(page, () => window.__digsite.screen === 'play' && !!window.__digsite.tutorial);
    if (shots) await page.screenshot({ path: path.join(shots, 'tut-1.png') });

    await holdKey('KeyS', 700);
    await waitFor(page, async () => true);
    if (await step() !== 'dig') throw new Error(`expected dig, got ${await step()}`);
    if (shots) await page.screenshot({ path: path.join(shots, 'tut-2.png') });

    await goTo('site');
    await holdKey('KeyE', 2000);
    if (await step() !== 'bank') throw new Error(`expected bank, got ${await step()}`);
    await goTo('camp');
    await page.waitForTimeout(150);
    if (await step() !== 'chop') throw new Error(`expected chop, got ${await step()}`);
    if (shots) await page.screenshot({ path: path.join(shots, 'tut-4.png') });

    await goTo('tree');
    await holdKey('KeyE', 1600);
    if (await step() !== 'stack') throw new Error(`expected stack, got ${await step()}`);
    await goTo('camp');
    await page.waitForTimeout(150);
    if (await step() !== 'mine') throw new Error(`expected mine, got ${await step()}`);
    await goTo('rock');
    await holdKey('KeyE', 2300);
    await goTo('camp');
    await page.waitForTimeout(150);
    if (await step() !== 'build') throw new Error(`expected build, got ${await step()}`);
    await page.evaluate(() => { const s = window.__digsite.run, p = s.players[0]; p.x = s.world.camp.x; p.y = s.world.camp.y + 90; p.fx = 0; p.fy = 1; });
    await page.keyboard.press('KeyB'); await page.waitForTimeout(60);
    for (let i = 0; i < 10 && (await page.evaluate(() => window.__digsite.buildName())) !== 'wall'; i++) { await page.keyboard.press('KeyQ'); await page.waitForTimeout(60); }
    if (shots) await page.screenshot({ path: path.join(shots, 'tut-build.png') });
    await page.keyboard.press('KeyE'); await page.waitForTimeout(100);
    if (await step() !== 'craft') throw new Error(`expected craft, got ${await step()}`);
    for (let i = 0; i < 10 && (await page.evaluate(() => window.__digsite.buildName())) !== 'spear'; i++) { await page.keyboard.press('KeyQ'); await page.waitForTimeout(60); }
    await page.keyboard.press('KeyE'); await page.waitForTimeout(100);
    if (await step() !== 'attack') throw new Error(`expected attack, got ${await step()}`);
    await page.keyboard.press('KeyB'); await page.waitForTimeout(60);
    await page.keyboard.press('KeyF'); await page.waitForTimeout(100);
    if (await step() !== 'trap') throw new Error(`expected trap, got ${await step()}`);
    await page.keyboard.press('KeyQ');
    await page.waitForTimeout(150);
    if (await step() !== 'dusk') throw new Error(`expected dusk, got ${await step()}`);

    await waitFor(page, () => window.__digsite.run.phase === 'night', 15000);
    if (shots) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(shots, 'tut-night.png') }); }
    await page.evaluate(() => window.__digsite.step(40));
    await waitFor(page, () => window.__digsite.screen === 'menu');
    const save = await page.evaluate(() => window.__digsite.save);
    if (!save.tutorialDone || save.funding !== 50 || save.runs !== 0) throw new Error(`bad save after tutorial: ${JSON.stringify(save)}`);
    if (shots) await page.screenshot({ path: path.join(shots, 'tut-done.png') });

    if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    console.log('tutorial ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
