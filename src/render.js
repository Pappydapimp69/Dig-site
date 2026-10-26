// Pixel-art renderer. Draws at 480x300 and the page scales it up with
// nearest-neighbour, so every pixel stays crisp. World units are 2x screen px.
import { T, TILE } from './world.js';
import { CFG, UPGRADES, TRAITS, DINOS, BUILDS, buildById, nextUnlock, speciesById, upgradeCost } from './data.js';
import { buildList, buildTarget, canAfford, tierFor } from './game.js';
import { collection } from './save.js';
import { drawText, textWidth } from './art/font.js';
import { keyName, fillKeys } from './keys.js';
import { buildTerrain, S } from './art/terrain.js';
import * as SP from './art/sprites.js';

const DARK = 0.9;
const P_COL = ['#ff9a4c', '#5fd6e6'];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const SHAKE_TIME = 0.3;

export function makeRenderer(cv) {
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const W = cv.width, H = cv.height;

  const art = {
    explorers: [SP.explorerSprites(0), SP.explorerSprites(1)],
    raptor: SP.raptorSprites(false),
    dinos: {
      raptor: { normal: SP.raptorSprites(false), stun: SP.raptorSprites(true) },
      compy: SP.compySprites(),
      spitter: SP.spitterSprites(),
      rex: SP.rexSprites(),
    },
    wood: SP.woodSprite(),
    amber: SP.amberSprite(),
    spit: SP.spitSprite(),
    woodPile: [0, 1, 2, 3, 4].map((n) => SP.woodPileSprite(n)),
    struct: { wall: SP.wallSprite(), spikes: SP.spikeSprite(), stonewall: SP.stoneWallSprite() },
    torch: SP.torchFrames(),
    stone: SP.stoneSprite(),
    icons: SP.iconSprites(),
    shadowHuge: SP.shadowSprite(34, 8),
    shadowSmall: SP.shadowSprite(10, 4),
    trees: SP.treeSprites(),
    tent: SP.tentSprite(),
    crate: SP.crateSprite(),
    fire: SP.fireFrames(),
    mound: SP.moundSprite(),
    hole: SP.holeSprite(),
    bone: SP.boneSprite(),
    boneGold: SP.boneSprite('#ffd84d'),
    boneEmpty: SP.boneSprite('#5a5040'),
    trap: SP.trapSprite(),
    heart: SP.heartSprite(true),
    heartEmpty: SP.heartSprite(false),
    sun: SP.sunSprite(),
    moon: SP.moonSprite(),
    shadow: SP.shadowSprite(12, 5),
    shadowBig: SP.shadowSprite(22, 6),
    tuft: SP.tuftSprite(),
  };
  // Icon for anything that can be carried.
  const species = Object.fromEntries(Object.values(speciesById).map((s) => [s.id, SP.boneSprite(s.color)]));
  species.amber = art.amber;
  species.wood = art.wood;
  species.stone = art.stone;
  // Icon and world sprite for each build.
  const buildIcon = (id) => ({ snare: art.trap, torch: art.torch[0], wall: art.struct.wall, spikes: art.struct.spikes, stonewall: art.struct.stonewall }[id] || art.icons[id]);
  for (const b of BUILDS) if (!buildIcon(b.id)) throw new Error(`no icon for build ${b.id}`);
  const itemIcon = (it) => (it.mult > 1 && species[it.sp] && speciesById[it.sp] && it.sp !== 'amber' ? art.boneGold : species[it.sp]);
  for (const k of Object.keys(DINOS)) if (!art.dinos[k]) throw new Error(`no sprite for dino kind ${k}`);
  const SHADOW = { raptor: 'shadowBig', compy: 'shadowSmall', spitter: 'shadowBig', rex: 'shadowHuge' };

  const dark = SP.canvas(W, H);
  const dctx = dark.getContext('2d');
  const darkImg = dctx.createImageData(W, H);
  const alphaBuf = new Float32Array(W * H);

  let terrain = null, terrainRun = null;
  let particles = [], toasts = [], floaters = [];
  let shake = 0;
  const cam = { x: 0, y: 0 }; // particles live in terrain px; this converts
  const actor = new WeakMap(); // per-entity animation state

  const toast = (msg) => {
    toasts.push({ msg, t: 2.6 });
    if (toasts.length > 3) toasts.shift();
  };

  function burst(x, y, n, colors, speed = 40, life = 0.5, up = 20) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, life: life * (0.6 + Math.random() * 0.6), color: colors[i % colors.length], g: 90 });
    }
  }

  function event(e, s) {
    const p = e.id !== undefined ? s.players[e.id] : null;
    if (e.type === 'bone' && p) {
      burst(p.x / 2, p.y / 2 - 2, 10, ['#8a5a33', '#6e4424', '#b07e4c'], 50, 0.5, 30);
      burst(p.x / 2, p.y / 2 - 6, 4, ['#fff4c0'], 25, 0.6, 30);
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 0.9, text: '+BONE', color: '#f4ead2' });
    } else if (e.type === 'deposit' && p) {
      burst(s.world.camp.x / 2, s.world.camp.y / 2 - 6, 14, ['#ffd84d', '#fff3b0', '#ffb43d'], 45, 0.7, 25);
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 1.1, text: `+$${e.gained}`, color: '#ffd84d' });
    } else if (e.type === 'hurt' && p) {
      burst(p.x / 2, p.y / 2 - 6, 12, ['#ff5a5a', '#b02a2a'], 60, 0.4, 10);
      shake = SHAKE_TIME;
    } else if (e.type === 'down') {
      shake = SHAKE_TIME * 1.5;
    } else if (e.type === 'snap') {
      for (const r of s.dinos) if (r.stun > 0) burst(r.x / 2, r.y / 2 - 4, 10, ['#d0d0c8', '#8a8a84'], 55, 0.4, 10);
    } else if (e.type === 'amber' && p) {
      burst(p.x / 2, p.y / 2 - 6, 16, ['#ffd27a', '#e88a1a', '#fff3b0'], 55, 0.8, 35);
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 1.2, text: 'AMBER!', color: '#ffb43d' });
    } else if (e.type === 'chop' && p) {
      burst(p.x / 2 + p.fx * 6, p.y / 2 - 6, 6, ['#d9b07a', '#8a5f36', '#3f8547'], 40, 0.4, 20);
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 0.8, text: '+WOOD', color: '#d9b07a' });
    } else if (e.type === 'wood') {
      burst(s.world.camp.x / 2, s.world.camp.y / 2, 12, ['#ffc53d', '#ff7a1a'], 35, 0.8, 40);
    } else if (e.type === 'steal' && p) {
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 1, text: 'STOLEN!', color: '#ff6a5a' });
    } else if (e.type === 'grab' && p) {
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 1, text: 'GOT IT!', color: '#7dff8a' });
    } else if (e.type === 'roar') {
      shake = SHAKE_TIME * 2.5;
    } else if (e.type === 'contract') {
      floaters.push({ x: s.world.camp.x / 2, y: s.world.camp.y / 2 - 30, t: 2, text: `REQUEST DONE +$${e.bonus}`, color: '#7dff8a' });
    } else if (e.type === 'mine' && p) {
      burst(p.x / 2 + p.fx * 6, p.y / 2 - 4, 7, ['#8d8577', '#bdb39e', '#5d574d'], 45, 0.4, 20);
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 0.8, text: '+STONE', color: '#bdb39e' });
    } else if (e.type === 'built' && p) {
      const tg = buildTarget(s, p);
      burst(tg.x / 2, tg.y / 2, 10, ['#d9b07a', '#8a5f36', '#f4ead2'], 35, 0.5, 25);
    } else if (e.type === 'cantafford' && p) {
      const b = buildById[e.item];
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 1, text: `NEED ${costText(b.cost)}`, color: '#ff8a7a' });
    } else if (e.type === 'cantbuild' && p) {
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 1, text: "CAN'T BUILD THERE", color: '#ff8a7a' });
    } else if (e.type === 'hit') {
      shake = Math.max(shake, 0.06);
    } else if (e.type === 'routed') {
      const r = s.dinos.find((d) => d.routed && d.kind === e.kind);
      if (r) floaters.push({ x: r.x / 2, y: r.y / 2 - 24, t: 1.2, text: 'RAN OFF!', color: '#7dff8a' });
    } else if (e.type === 'smash') {
      shake = Math.max(shake, 0.2);
    } else if (e.type === 'swing' && p) {
      if (e.hits) burst(p.x / 2 + p.fx * 14, p.y / 2 - 6 + p.fy * 10, 8, ['#ffffff', '#ff5a5a'], 50, 0.3, 5);
    } else if (e.type === 'noammo' && p) {
      floaters.push({ x: p.x / 2, y: p.y / 2 - 18, t: 1, text: 'NO STONE', color: '#ff8a7a' });
    } else if (e.type === 'revive' && p) {
      burst(p.x / 2, p.y / 2 - 6, 14, ['#7dff8a', '#d0ffd8'], 40, 0.6, 30);
    }
    if (e.text) toast(e.text);
  }

  // ---------- helpers ----------
  const blit = (img, x, y, alpha = 1) => {
    if (alpha < 1) { ctx.globalAlpha = alpha; ctx.drawImage(img, Math.round(x), Math.round(y)); ctx.globalAlpha = 1; }
    else ctx.drawImage(img, Math.round(x), Math.round(y));
  };

  function darkness(s) {
    const D = TRAITS[s.trait].dark || DARK;
    if (s.phase === 'night') return D;
    if (s.t > s.dayLen - 12) return D * (s.t - (s.dayLen - 12)) / 12;
    if (s.night > 0 && s.t < 5) return D * (1 - s.t / 5);
    return 0;
  }

  // Per-pixel darkness, quantised with a world-anchored Bayer matrix so the
  // light edge is a native dither instead of a smooth blur.
  function drawDark(a, lights, camX, camY) {
    if (a <= 0.01) return;
    alphaBuf.fill(a);
    for (const L of lights) {
      const r = L.r;
      const x0 = Math.max(0, Math.floor(L.x - r)), x1 = Math.min(W - 1, Math.ceil(L.x + r));
      const y0 = Math.max(0, Math.floor(L.y - r)), y1 = Math.min(H - 1, Math.ceil(L.y + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dd = Math.hypot(x - L.x, y - L.y) / r;
          if (dd >= 1) continue;
          const lit = dd < 0.45 ? 0 : (dd - 0.45) / 0.55;
          const v = a * lit;
          const i = y * W + x;
          if (v < alphaBuf[i]) alphaBuf[i] = v;
        }
      }
    }
    const d = darkImg.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const b = BAYER[((y + camY) & 3) * 4 + ((x + camX) & 3)];
        const q = Math.min(1, Math.floor((alphaBuf[i] / a) * 4 + b) / 4) * a;
        const o = i * 4;
        d[o] = 8; d[o + 1] = 10; d[o + 2] = 30; d[o + 3] = q * 255;
      }
    }
    dctx.putImageData(darkImg, 0, 0);
    ctx.drawImage(dark, 0, 0);
  }

  function anim(ent, moving, dt) {
    let st = actor.get(ent);
    if (!st) { st = { t: 0, dust: 0, mode: ent.mode }; actor.set(ent, st); }
    st.t = moving ? st.t + dt : 0;
    return st;
  }

  // ---------- game ----------
  function drawGame(s, dt) {
    if (terrainRun !== s) {
      terrain = buildTerrain(s.world, s.seed);
      terrainRun = s;
      particles = []; floaters = []; toasts = [];
    }
    for (const t of toasts) t.t -= dt;
    toasts = toasts.filter((t) => t.t > 0);
    shake = Math.max(0, shake - dt);

    const live = s.players.filter((p) => !p.down);
    const focus = live.length ? live : s.players;
    const fx = focus.reduce((n, p) => n + p.x, 0) / focus.length / 2;
    const fy = focus.reduce((n, p) => n + p.y, 0) / focus.length / 2;
    let camX = Math.round(Math.max(0, Math.min(terrain.width - W, fx - W / 2)));
    let camY = Math.round(Math.max(0, Math.min(terrain.height - H, fy - H / 2)));
    if (shake > 0) { camX += Math.round((Math.random() - 0.5) * 6 * shake / SHAKE_TIME); camY += Math.round((Math.random() - 0.5) * 6 * shake / SHAKE_TIME); }
    cam.x = camX; cam.y = camY;

    ctx.fillStyle = '#24507e';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(terrain, camX, camY, W, H, 0, 0, W, H);
    const sx = (wx) => wx / 2 - camX, sy = (wy) => wy / 2 - camY;
    const w = s.world;

    // Water glints.
    const tx0 = Math.max(0, Math.floor(camX / S)), ty0 = Math.max(0, Math.floor(camY / S));
    const tx1 = Math.min(w.w - 1, Math.floor((camX + W) / S) + 1), ty1 = Math.min(w.h - 1, Math.floor((camY + H) / S) + 2);
    ctx.fillStyle = '#9fd0e6';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (w.tiles[ty * w.w + tx] !== T.WATER) continue;
        const ph = Math.sin(s.time * 1.3 + tx * 1.7 + ty * 2.3);
        if (ph > 0.85) ctx.fillRect(tx * S - camX + ((tx * 5 + ty) % 10), ty * S - camY + ((tx + ty * 3) % 12), 3, 1);
      }
    }

    // Ground decals.
    for (const site of w.sites) {
      const x = sx(site.x), y = sy(site.y);
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      if (site.bones <= 0) { blit(art.hole, x - 7, y - 4); continue; }
      blit(art.mound, x - 8, y - 5);
      const bob = Math.round(Math.sin(s.time * 3 + site.x) * 0.6);
      blit(species[site.species], x - 3, y - 6 + bob);
      for (let i = 0; i < site.bones; i++) {
        ctx.fillStyle = '#14110c'; ctx.fillRect(Math.round(x - site.bones * 2 + i * 4), Math.round(y - 12), 3, 3);
        ctx.fillStyle = '#f4ead2'; ctx.fillRect(Math.round(x - site.bones * 2 + i * 4), Math.round(y - 12), 2, 2);
      }
    }
    for (const t of s.traps) blit(art.trap, sx(t.x) - 5, sy(t.y) - 3);
    for (const f of s.flares) {
      if (Math.random() < 0.6) particles.push({ x: f.x / 2 + (Math.random() - 0.5) * 4, y: f.y / 2 - 4, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30, life: 0.6, color: Math.random() < 0.5 ? '#ff4a3a' : '#ffc53d', g: 40 });
    }
    for (const d of s.drops) {
      const bob = Math.round(Math.sin(s.time * 4 + d.x) * 1);
      blit(art.shadowSmall, sx(d.x) - 5, sy(d.y) - 1);
      blit(itemIcon(d.item), sx(d.x) - 3, sy(d.y) - 5 + bob);
    }

    // Fire safety ring, drawn as a dotted pixel circle.
    const cx = sx(w.camp.x), cy = sy(w.camp.y);
    if (s.phase === 'night' && s.fire > 0) {
      const r = s.fire / 2;
      ctx.fillStyle = s.fire > CFG.fireSafeMin ? '#ffb34d' : '#ff4a3a';
      const n = Math.max(24, Math.round(r * 0.8));
      for (let i = 0; i < n; i++) {
        if ((i + Math.floor(s.time * 6)) % 3 === 0) continue;
        const a = (i / n) * Math.PI * 2;
        ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
      }
    }

    // Y-sorted pass.
    const items = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1; tx++) {
        if (tx < 0 || w.tiles[ty * w.w + tx] !== T.TREE) continue;
        items.push({ y: ty * S + 14, kind: 'tree', tx, ty });
      }
    }
    items.push({ y: w.camp.y / 2 - 6, kind: 'tent' }, { y: w.camp.y / 2 - 10, kind: 'crate' }, { y: w.camp.y / 2 + 6, kind: 'fire' }, { y: w.camp.y / 2 + 8, kind: 'pile' });
    for (const p of s.players) items.push({ y: p.y / 2, kind: 'player', p });
    for (const r of s.dinos) items.push({ y: r.y / 2, kind: 'dino', r });
    for (const st of s.structures) items.push({ y: st.y / 2 + 7, kind: 'struct', st });
    items.sort((a, b) => a.y - b.y);

    for (const it of items) {
      if (it.kind === 'tree') {
        const img = art.trees[(it.tx * 7 + it.ty * 13) % 3];
        const x = it.tx * S + 8 - img.width / 2 - camX, y = it.ty * S + 17 - img.height - camY;
        // Fade the canopy when someone is behind it.
        const hidden = s.players.some((p) => {
          const px = sx(p.x), py = sy(p.y);
          return px > x && px < x + img.width && py < y + img.height - 6 && py > y;
        });
        blit(img, x, y, hidden ? 0.45 : 1);
      } else if (it.kind === 'tent') blit(art.tent, cx - 34, cy - 30);
      else if (it.kind === 'crate') {
        blit(art.crate, cx + 12, cy - 26);
      } else if (it.kind === 'fire') {
        const f = s.phase === 'night' ? Math.max(0.15, s.fire / s.st.fireR) : 1;
        const img = art.fire[Math.floor(s.time * 10) % art.fire.length];
        const h = Math.max(4, Math.round(img.height * (0.4 + 0.6 * f)));
        ctx.drawImage(img, 0, img.height - h, img.width, h, Math.round(cx - 5), Math.round(cy + 6 - h), img.width, h);
        if (Math.random() < dt * 8 * f) particles.push({ x: cx + (Math.random() - 0.5) * 4, y: cy - 4, vx: (Math.random() - 0.5) * 6, vy: -20 - Math.random() * 15, life: 0.8, color: Math.random() < 0.5 ? '#ffc53d' : '#ff7a1a', g: 0 });
      } else if (it.kind === 'pile') {
        if (s.stock.wood > 0) blit(art.woodPile[Math.min(4, s.stock.wood)], cx + 8, cy + 2);
        for (let i = 0; i < Math.min(5, s.stock.stone); i++) blit(art.stone, cx - 20 + (i % 3) * 5, cy + 6 - Math.floor(i / 3) * 3);
      } else if (it.kind === 'struct') {
        const st = it.st;
        const x = sx(st.x), y = sy(st.y);
        if (st.kind === 'torch') {
          const img = art.torch[st.life > 0 && s.phase === 'night' ? Math.floor(s.time * 8) % 3 : 0];
          blit(img, x - 4, y - 14);
        } else {
          const img = art.struct[st.kind];
          blit(img, x - img.width / 2, y + 9 - img.height);
          if (st.hp < st.maxHp) bar(x - 7, y - img.height + 4, 14, st.hp / st.maxHp, st.hp / st.maxHp > 0.4 ? '#7dff8a' : '#ff6a5a');
        }
      } else if (it.kind === 'player') drawPlayer(s, it.p, sx(it.p.x), sy(it.p.y), dt);
      else drawDino(s, it.r, sx(it.r.x), sy(it.r.y), dt);
    }

    for (const b of s.shots) {
      ctx.fillStyle = '#14110c'; ctx.fillRect(Math.round(sx(b.x)) - 1, Math.round(sy(b.y)) - 7, 3, 3);
      ctx.fillStyle = '#bdb39e'; ctx.fillRect(Math.round(sx(b.x)) - 1, Math.round(sy(b.y)) - 7, 2, 2);
    }
    for (const p of s.players) {
      if (p.swing <= 0 || p.down) continue;
      const a0 = Math.atan2(p.fy, p.fx), x = sx(p.x), y = sy(p.y) - 6;
      ctx.fillStyle = '#ffffff';
      for (let i = -3; i <= 3; i++) {
        const a = a0 + i * 0.28 * (1 - p.swing * 2);
        ctx.fillRect(Math.round(x + Math.cos(a) * 16), Math.round(y + Math.sin(a) * 16), 1, 1);
      }
    }
    for (const b of s.spits) {
      blit(art.spit, sx(b.x) - 1, sy(b.y) - 7);
      if (Math.random() < 0.5) particles.push({ x: b.x / 2, y: b.y / 2 - 6, vx: 0, vy: 0, life: 0.25, color: '#5ea02a', g: 0 });
    }

    // Particles.
    for (const p of particles) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.g && p.vy > 0 && p.life < 0.15) p.vx *= 0.8;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - camX), Math.round(p.y - camY), 1, 1);
    }

    // Darkness, with the fire and each explorer's lantern as lights.
    const a = darkness(s);
    const fireR = (s.phase === 'night' ? s.fire : s.st.fireR) / 2 + 26;
    const flick = 1 + Math.sin(s.time * 13) * 0.03;
    const lights = [{ x: cx, y: cy, r: fireR * flick }];
    const tr = TRAITS[s.trait];
    const lantern = 52 * s.st.lantern * (tr.light || 1);
    for (const p of s.players) if (!p.down) lights.push({ x: sx(p.x), y: sy(p.y) - 6, r: lantern });
    for (const st of s.structures) if (st.kind === 'torch' && st.life > 0 && s.phase === 'night') lights.push({ x: sx(st.x), y: sy(st.y) - 10, r: CFG.torchR / 2 + 28 });
    for (const f of s.flares) lights.push({ x: sx(f.x), y: sy(f.y) - 4, r: 110 });
    drawDark(a, lights, camX, camY);
    if (a > 0.2) {
      // Warm spill around the fire.
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, fireR);
      g.addColorStop(0, `rgba(255,150,60,${0.22 * a})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(cx - fireR, cy - fireR, fireR * 2, fireR * 2);
      ctx.globalCompositeOperation = 'source-over';
    }

    drawWeather(s, camX, camY, dt);

    // A better lantern lets you spot dig sites through the dark.
    if (a > 0.3 && s.st.lantern > 1) {
      const reach = 70 * s.st.lantern;
      for (const site of w.sites) {
        if (site.bones <= 0) continue;
        const x = sx(site.x), y = sy(site.y);
        if (!s.players.some((p) => !p.down && Math.hypot(sx(p.x) - x, sy(p.y) - y) < reach)) continue;
        if (Math.floor(s.time * 2 + site.x) % 3 === 0) continue;
        ctx.globalAlpha = 0.7;
        blit(species[site.species], x - 3, y - 6);
        ctx.globalAlpha = 1;
      }
    }

    // Things that must read through the dark.
    for (const r of s.dinos) {
      const x = sx(r.x), y = sy(r.y);
      const st = actor.get(r);
      if (a > 0.3 && r.stun <= 0 && st && st.eye) {
        const right = Math.cos(r.heading) >= 0;
        ctx.fillStyle = r.mode === 'chase' ? '#ff4a3a' : '#ffe14d';
        ctx.fillRect(Math.round(x + (right ? st.eye[0] : -st.eye[0] - 1)), Math.round(y + st.eye[1]), 1, 1);
      }
      if (st && st.alert > 0) {
        drawText(ctx, '!', x, y - 26 - Math.round((0.8 - st.alert) * 6), { color: '#ff4a3a', align: 'center' });
      }
      if (r.stun > 0) {
        for (let i = 0; i < 3; i++) {
          const ang = s.time * 6 + i * 2.1;
          ctx.fillStyle = '#ffe14d';
          ctx.fillRect(Math.round(x + Math.cos(ang) * 7), Math.round(y - 20 + Math.sin(ang) * 2), 1, 1);
        }
      }
    }
    for (const f of floaters) {
      f.t -= dt;
      f.y -= 14 * dt;
      if (f.t > 0) drawText(ctx, f.text, f.x - camX, f.y - camY, { color: f.color, align: 'center' });
    }
    floaters = floaters.filter((f) => f.t > 0);

    drawHud(s);
  }

  function drawPlayer(s, p, x, y, dt) {
    const set = art.explorers[p.id];
    const st = anim(p, p.moving && !p.down, dt);
    blit(art.shadow, x - 6, y - 2);
    if (p.down) {
      const img = set.down[0];
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y - 3));
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      if (p.reviveT > 0) bar(x - 8, y - 16, 16, p.reviveT / CFG.reviveTime, '#7dff8a');
      else if (s.players.length > 1) drawText(ctx, 'HELP', x, y - 18, { color: P_COL[p.id], align: 'center' });
      return;
    }
    if (p.invuln > 0 && Math.floor(s.time * 14) % 2) return;
    const dir = Math.abs(p.fx) > Math.abs(p.fy) ? (p.fx > 0 ? 'right' : 'left') : p.fy < 0 ? 'up' : 'down';
    const cycle = [0, 1, 0, 2];
    const frame = p.moving ? cycle[Math.floor(st.t * 8) % 4] : 0;
    const img = set[dir][frame];
    const digging = p.digT > 0;
    const working = digging || p.chopT > 0 || p.mineT > 0;
    const bob = p.moving && frame !== 0 ? -1 : working && Math.floor(s.time * 8) % 2 ? 1 : 0;
    blit(img, x - img.width / 2, y - img.height + 1 + bob);
    if (tileUnder(s, p) === T.TALL) blit(art.tuft, x - 6, y - 3);
    // Carried bones stack above the head.
    p.carry.forEach((b, i) => blit(itemIcon(b), x - 3, y - img.height - 3 - i * 3));
    // Chopping and mining: progress bar, a tool swinging toward the target, chips.
    const tool = p.chopT > 0 ? 'axe' : p.mineT > 0 ? 'pickaxe' : null;
    if (tool) {
      const total = tool === 'axe' ? CFG.chopTime / (s.owned.axe ? 2 : 1) : CFG.mineTime / (s.owned.pickaxe ? 2 : 1);
      const t = tool === 'axe' ? p.chopT : p.mineT;
      bar(x - 8, y - img.height - 6 - p.carry.length * 3, 16, t / total, tool === 'axe' ? '#d9b07a' : '#bdb39e');
      const up = Math.floor(s.time * 8) % 2 === 0;
      const ic = art.icons[tool];
      const left = p.fx < -0.3;
      ctx.save();
      ctx.translate(Math.round(x + (left ? -9 : 9)), Math.round(y - 10 + (up ? -3 : 1)));
      ctx.scale(left ? -1 : 1, 1);
      ctx.rotate(up ? -0.6 : 0.5);
      ctx.drawImage(ic, -ic.width / 2, -ic.height / 2);
      ctx.restore();
      if (!up && Math.random() < 0.5) {
        const chips = tool === 'axe' ? ['#d9b07a', '#8a5f36', '#3f8547'] : ['#8d8577', '#bdb39e', '#5d574d'];
        burst(x + cam.x + (left ? -14 : 14), y + cam.y - 6, 2, chips, 35, 0.35, 18);
      }
    }
    if (p.slow > 0 && Math.random() < 0.3) particles.push({ x: x + cam.x, y: y + cam.y - 6, vx: 0, vy: 10, life: 0.4, color: '#9ef04a', g: 0 });
    if (digging) {
      bar(x - 8, y - img.height - 6 - p.carry.length * 3, 16, p.digT / s.st.digTime, '#ffd84d');
      st.dust += dt;
      if (st.dust > 0.12) { st.dust = 0; burst(x + cam.x, y + cam.y, 2, ['#8a5a33', '#b07e4c'], 30, 0.35, 25); }
    } else if (p.moving) {
      st.dust += dt;
      if (st.dust > 0.18) { st.dust = 0; particles.push({ x: x + cam.x, y: y + cam.y, vx: -p.fx * 10, vy: -6, life: 0.3, color: '#c8b48a', g: 0 }); }
    }
  }


  // Eye pixel offsets (right-facing, from the dino's feet) for the night glint.
  const EYES = { raptor: [5, -15], compy: [2, -8], spitter: [4, -14], rex: [7, -26] };

  function drawDino(s, r, x, y, dt) {
    const st = anim(r, r.stun <= 0, dt);
    if (st.mode !== 'chase' && r.mode === 'chase') st.alert = 0.8;
    st.mode = r.mode;
    st.alert = Math.max(0, (st.alert || 0) - dt);
    st.eye = EYES[r.kind];
    const sets = art.dinos[r.kind];
    const set = r.stun > 0 ? sets.stun : sets.normal;
    const dirSet = Math.cos(r.heading) >= 0 ? set.right : set.left;
    const rate = r.kind === 'rex' ? 4 : r.mode === 'wander' ? 6 : 12;
    const img = dirSet[r.stun > 0 ? 0 : Math.floor(st.t * rate) % 2];
    const sh = art[SHADOW[r.kind]];
    blit(sh, x - sh.width / 2, y - sh.height / 2 - 1);
    blit(img, x - img.width / 2, y - img.height + 1);
    if (r.carry) blit(itemIcon(r.carry), x - 3, y - img.height - 4);
    if (r.hp < DINOS[r.kind].hp && !r.routed) bar(x - 8, y - img.height - 4, 16, r.hp / DINOS[r.kind].hp, '#ff6a5a');
    if (r.chewing && Math.random() < 0.3) burst(r.chewing.x / 2, r.chewing.y / 2 - 4, 2, ['#8a5f36', '#d9b07a'], 30, 0.3, 15);
    if (r.kind === 'rex' && r.stun <= 0) {
      // Footfalls you can feel.
      st.step = (st.step || 0) + dt;
      const near = s.players.some((p) => Math.hypot(p.x - r.x, p.y - r.y) < 500);
      if (st.step > (r.mode === 'chase' ? 0.35 : 0.6)) {
        st.step = 0;
        if (near) shake = Math.max(shake, 0.08);
        burst(x + cam.x, y + cam.y, 4, ['#8a7a5a', '#6a5a3a'], 25, 0.3, 5);
      }
    }
    if (r.mode !== 'wander' && r.stun <= 0) {
      st.dust += dt;
      if (st.dust > 0.1) { st.dust = 0; particles.push({ x: x + cam.x, y: y + cam.y, vx: -Math.cos(r.heading) * 15, vy: -8, life: 0.3, color: '#b8a47a', g: 0 }); }
    }
  }

  const tileUnder = (s, p) => {
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    return s.world.tiles[ty * s.world.w + tx];
  };

  let rain = [];
  function drawWeather(s, camX, camY, dt) {
    const tr = s.trait;
    if (tr === 'storm') {
      ctx.fillStyle = 'rgba(20,30,60,0.18)';
      ctx.fillRect(0, 0, W, H);
      while (rain.length < 140) rain.push({ x: Math.random() * (W + 60), y: Math.random() * H, v: 260 + Math.random() * 80 });
      ctx.fillStyle = 'rgba(170,200,240,0.55)';
      for (const d of rain) {
        d.y += d.v * dt;
        d.x -= d.v * 0.3 * dt;
        if (d.y > H) { d.y = -4; d.x = Math.random() * (W + 60); }
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
      }
      if (Math.sin(s.time * 0.7) > 0.995) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 0, W, H); }
    } else if (tr === 'foggy') {
      for (let i = 0; i < 6; i++) {
        const fx = ((i * 137 + s.time * (6 + i)) % (W + 200)) - 100 - (camX % 200);
        const fy = (i * 61) % H;
        const g = ctx.createRadialGradient(fx, fy, 5, fx, fy, 120);
        g.addColorStop(0, 'rgba(210,220,225,0.22)');
        g.addColorStop(1, 'rgba(210,220,225,0)');
        ctx.fillStyle = g;
        ctx.fillRect(fx - 120, fy - 120, 240, 240);
      }
      ctx.fillStyle = 'rgba(200,210,220,0.12)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function bar(x, y, w, frac, color) {
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = '#14110c';
    ctx.fillRect(x - 1, y - 1, w + 2, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.round(w * Math.min(1, frac)), 2);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(20,17,12,0.72)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(244,234,210,0.15)';
    ctx.fillRect(x, y, w, 1);
  }

  function drawHud(s) {
    const isNight = s.phase === 'night';
    const len = isNight ? s.nightLen : s.dayLen;
    panel(4, 4, 108, 34);
    blit(isNight ? art.moon : art.sun, 8, 8);
    drawText(ctx, isNight ? (Number.isFinite(s.nights) ? `NIGHT ${s.night}/${s.nights}` : `NIGHT ${s.night}`) : `DAY ${s.night + 1}`, 21, 9, { color: isNight ? '#b8c8ff' : '#ffe08a' });
    bar(9, 21, 98, 1 - s.t / len, isNight ? '#6c8cff' : '#ffc53d');
    drawText(ctx, `$${s.funding}`, 9, 27, { color: '#ffd84d' });
    let hy = 42;
    if (s.contract) {
      // The goal, its reward, and the next action: always on screen.
      const c = s.contract;
      const unlock = c.unlock ? buildById[c.unlock] : null;
      panel(4, hy, 108, unlock ? 22 : 13);
      blit(species[c.sp], 8, hy + 4);
      drawText(ctx, `WANT ${c.have}/${c.need}  +$${c.bonus}`, 18, hy + 3);
      if (unlock) drawText(ctx, `UNLOCKS ${unlock.name}`, 18, hy + 12, { color: '#7dff8a' });
      hy += unlock ? 24 : 15;
    }
    if (!s.tutorial) {
      panel(4, hy, 108, 13);
      blit(art.wood, 8, hy + 5);
      drawText(ctx, `${s.stock.wood}`, 18, hy + 3, { color: '#d9b07a' });
      blit(art.stone, 44, hy + 5);
      drawText(ctx, `${s.stock.stone}`, 52, hy + 3, { color: '#bdb39e' });
      hy += 15;
    }
    if (isNight && s.fire <= CFG.fireSafeMin && Math.floor(s.time * 3) % 2) {
      drawText(ctx, 'THE FIRE IS DYING! BRING WOOD!', 8, hy + 2, { color: '#ff6a5a' });
    }
    // Island intro banner.
    if (s.time < 4.5 && !s.tutorial) {
      const tr = TRAITS[s.trait];
      const al = Math.min(1, (4.5 - s.time) * 2);
      ctx.globalAlpha = al;
      panel(W / 2 - 100, 92, 200, 44);
      drawText(ctx, tr.name, W / 2, 98, { align: 'center', scale: 2, color: '#ffd38a' });
      drawText(ctx, tr.desc, W / 2, 116, { align: 'center', color: '#b8c8a0' });
      drawText(ctx, `EXPEDITION ${s.tier + 1}`, W / 2, 126, { align: 'center', color: '#7a8a70' });
      ctx.globalAlpha = 1;
    }

    s.players.forEach((p, i) => {
      const x = W - 124, y = 4 + i * 36;
      panel(x, y, 120, 32);
      drawText(ctx, `P${i + 1}`, x + 4, y + 5, { color: P_COL[i] });
      for (let h = 0; h < s.st.hp; h++) blit(h < p.hp ? art.heart : art.heartEmpty, x + 20 + h * 9, y + 5);
      for (let b = 0; b < s.st.cap; b++) {
        const item = p.carry[b];
        blit(item ? itemIcon(item) : art.boneEmpty, x + 5 + b * 9, y + 19);
      }
      blit(art.trap, x + 92, y + 18);
      drawText(ctx, `${p.traps}`, x + 106, y + 19);
      let gx = x + 106;
      for (const g of ['sling', 'spear']) if (s.owned[g]) { blit(art.icons[g], gx, y + 3); gx -= 12; }
    });

    // Messages sit above any open build bars.
    let ty = H - 14 - s.players.filter((p) => p.build && p.build.mode === 'place' && !p.down).length * 18;
    for (let i = toasts.length - 1; i >= 0; i--) {
      const m = toasts[i];
      const w = textWidth(m.msg) + 10;
      panel(Math.round(W / 2 - w / 2), ty - 3, w, 13);
      drawText(ctx, m.msg, W / 2, ty, { align: 'center', color: m.t < 0.4 && Math.floor(m.t * 10) % 2 ? '#8a8070' : '#f4ead2' });
      ty -= 15;
    }
  }

  // ---------- menus ----------
  const menuArt = { raptor: art.raptor.right.map((i) => scale2(i)) };
  function scale2(img) {
    const c = SP.canvas(img.width * 2, img.height * 2);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function backdrop(time) {
    const bands = ['#0e1630', '#132040', '#1a2a48', '#22344c', '#2a3d4a'];
    for (let y = 0; y < H; y++) {
      const f = Math.min(bands.length - 1, (y / H) * bands.length + BAYER[(y & 3) * 4 + 1] - 0.5);
      ctx.fillStyle = bands[Math.max(0, Math.floor(f))];
      ctx.fillRect(0, y, W, 1);
    }
    ctx.fillStyle = '#d8e0ff';
    for (let i = 0; i < 40; i++) {
      const x = (i * 97) % W, y = (i * 53) % 140;
      if (Math.sin(time * 2 + i) > -0.6) ctx.fillRect(x, y, 1, 1);
    }
    blit(art.moon, 408, 20);
    // Jungle silhouette.
    ctx.fillStyle = '#0a120c';
    for (let x = 0; x < W; x++) {
      const h = 40 + Math.sin(x * 0.05) * 8 + Math.sin(x * 0.13 + 1) * 6 + Math.sin(x * 0.31) * 3;
      ctx.fillRect(x, H - Math.round(h), 1, Math.round(h));
    }
    // A raptor prowls along the treeline.
    const rx = ((time * 40) % (W + 80)) - 40;
    const img = menuArt.raptor[Math.floor(time * 8) % 2];
    ctx.globalAlpha = 0.9;
    blit(img, rx, H - 58 - img.height / 2);
    ctx.globalAlpha = 1;
  }

  function drawMenu(save, msg, time = 0, device = 'keys', sel = -1) {
    const touch = device === 'touch', pad = device === 'pad';
    backdrop(time);
    drawText(ctx, 'DIG SITE', W / 2, 18, { scale: 4, align: 'center', color: '#ffd38a', shadow: '#5a2a10' });
    drawText(ctx, 'DIG BY DAY. SURVIVE THE NIGHT.', W / 2, 52, { align: 'center', color: '#b8c8a0' });

    panel(14, 64, 232, 150);
    drawText(ctx, 'UPGRADES', 22, 69, { color: '#ffe08a' });
    drawText(ctx, `FUNDING $${save.funding}`, 238, 69, { align: 'right', color: '#ffd84d' });
    UPGRADES.forEach((u, i) => {
      const lvl = save.upgrades[u.id] || 0;
      const maxed = lvl >= u.max;
      const cost = upgradeCost(u, lvl);
      const can = !maxed && save.funding >= cost;
      const y = 82 + i * 18;
      if (pad && sel === i) {
        ctx.fillStyle = 'rgba(255,224,138,0.14)';
        ctx.fillRect(16, y - 3, 228, 17);
        drawText(ctx, '>', 16, y, { color: '#ffe08a' });
      }
      drawText(ctx, `${pad ? '' : `${i + 1} `}${u.name}`, 22, y, { color: can ? '#f4ead2' : '#8a8070' });
      for (let k = 0; k < u.max; k++) {
        ctx.fillStyle = k < lvl ? '#7dff8a' : '#3a3428';
        ctx.fillRect(150 + k * 6, y + 1, 4, 5);
      }
      drawText(ctx, maxed ? 'MAX' : `$${cost}`, 238, y, { align: 'right', color: can ? '#7dff8a' : '#8a8070' });
      drawText(ctx, u.desc, 30, y + 8, { color: '#7a7262', shadow: null });
    });

    panel(254, 64, 212, 150);
    drawText(ctx, 'MUSEUM', 262, 69, { color: '#ffe08a' });
    drawText(ctx, 'SKELETON PERKS', 458, 69, { align: 'right', color: '#7a7262' });
    collection(save).forEach((c, i) => {
      const y = 84 + i * 24;
      blit(species[c.id], 262, y + 1);
      drawText(ctx, c.name, 273, y, { color: c.have ? '#f4ead2' : '#8a8070' });
      drawText(ctx, `${c.skeletons ? c.skeletons + 'X ' : ''}${c.progress}/${c.bones}`, 458, y, { align: 'right', color: c.skeletons ? '#7dff8a' : '#8a8070' });
      bar(273, y + 10, 60, c.progress / c.bones, '#f4ead2');
      drawText(ctx, c.perk, 458, y + 9, { align: 'right', color: c.skeletons ? '#7dff8a' : '#5a5448', shadow: null });
    });

    const pulse = Math.floor(time * 2) % 2 ? '#ffffff' : '#ffe08a';
    drawText(ctx, `NEXT: EXPEDITION ${tierFor(save.requestsDone || 0) + 1}`, W / 2, 220, { align: 'center', color: '#ffd38a' });
    if (pad) {
      const opt = (label, x, on) => {
        if (on) { ctx.fillStyle = 'rgba(255,224,138,0.18)'; ctx.fillRect(x - 46, 229, 92, 12); }
        drawText(ctx, label, x, 232, { align: 'center', color: on ? pulse : '#8a8070' });
      };
      opt('PLAY SOLO', W / 2 - 56, sel === UPGRADES.length);
      opt('PLAY CO-OP', W / 2 + 56, sel === UPGRADES.length + 1);
      drawText(ctx, 'A SELECT   D-PAD MOVE   A DIG  X TRAP  START PAUSE', W / 2, 244, { align: 'center', color: '#b8c8a0' });
    } else if (touch) {
      drawText(ctx, 'TAP HERE TO PLAY', W / 2, 232, { align: 'center', color: pulse });
      drawText(ctx, 'TAP AN UPGRADE TO BUY IT', W / 2, 244, { align: 'center', color: '#b8c8a0' });
    } else {
      drawText(ctx, 'SPACE  SOLO      ENTER  CO-OP', W / 2, 232, { align: 'center', color: pulse });
      drawText(ctx, 'E DIG/CHOP  Q TRAP  ESC PAUSE  (P2: . AND ,)', W / 2, 244, { align: 'center', color: '#b8c8a0' });
    }
    const nu = nextUnlock(save.requestsDone || 0);
    drawText(ctx, `REQUESTS FILLED ${save.requestsDone || 0}   ${nu ? `NEXT UNLOCK: ${nu.name} AT ${nu.unlock}` : 'EVERYTHING UNLOCKED'}   BEST NIGHT ${save.bestNight || 0}`, W / 2, 256, { align: 'center', color: '#7a8a70' });
    const tutLine = touch ? 'TAP HERE FOR THE TUTORIAL' : `${keyName('tutorial', device)}  TUTORIAL`;
    drawText(ctx, save.tutorialDone ? tutLine : `NEW HERE?  ${tutLine}`, W / 2, 268, { align: 'center', color: save.tutorialDone ? '#8a8070' : pulse });
    if (msg) drawText(ctx, msg, W / 2, 282, { align: 'center', color: /DONE/.test(msg) ? '#7dff8a' : '#ff6a5a' });
  }

  function drawSummary(s, time = 0) {
    backdrop(time);
    const won = s.result !== 'lost';
    drawText(ctx, s.result === 'left' ? 'OFF THE ISLAND' : won ? 'ISLAND CLEARED' : 'THE NIGHT WON', W / 2, 30, { scale: 3, align: 'center', color: won ? '#7dff8a' : '#ff6a5a', shadow: '#14110c' });
    const rows = Object.keys(s.banked).length;
    panel(W / 2 - 120, 60, 240, 44 + rows * 12 + (s.unlocked.length ? 14 : 0));
    drawText(ctx, `NIGHTS SURVIVED ${s.night}   REQUESTS FILLED ${s.requestsFilled}`, W / 2, 66, { align: 'center' });
    drawText(ctx, `BONES BANKED ${s.bankedCount}${s.amber ? `   AMBER ${s.amber}` : ''}`, W / 2, 78, { align: 'center' });
    const note = s.result === 'left' ? `  (+${Math.round(CFG.leaveBonus * s.night * 100)}% FOR NIGHTS)` : s.result === 'lost' ? '  (KEPT HALF)' : '';
    drawText(ctx, `FUNDING $${s.payout}${note}`, W / 2, 90, { align: 'center', color: '#ffd84d' });
    let y = 104;
    if (s.unlocked.length) {
      drawText(ctx, `UNLOCKED: ${s.unlocked.map((id) => buildById[id].name).join(', ')}`, W / 2, y, { align: 'center', color: '#7dff8a' });
      y += 14;
    }
    for (const [sp, n] of Object.entries(s.banked)) {
      blit(species[sp], W / 2 - 60, y + 1);
      drawText(ctx, `${speciesById[sp].name} X${n}`, W / 2 - 50, y, { color: '#b8c8a0' });
      y += 12;
    }
    drawText(ctx, 'SPACE / A / TAP  BACK TO THE MUSEUM', W / 2, 214, { align: 'center', color: Math.floor(time * 2) % 2 ? '#ffffff' : '#ffe08a' });
  }

  const costText = (cost) => Object.entries(cost).map(([k, n]) => `${n} ${k.toUpperCase()}`).join(' ');

  // Build menu (a list to choose from), then a ghost on the target tile only
  // once you've picked something to place.
  function drawBuild(s, device) {
    let row = 0;
    for (const p of s.players) {
      if (!p.build || p.down) continue;
      const tag = s.players.length > 1 ? `P${p.id + 1} ` : '';
      if (p.build.mode === 'place') {
        const b = buildById[p.build.id];
        const tg = buildTarget(s, p);
        const ok = canAfford(s, b) && (tg.ok || (b.id === 'snare' && tg.why !== 'blocked' && tg.why !== 'player'));
        const x = tg.x / 2 - cam.x, y = tg.y / 2 - cam.y;
        ctx.globalAlpha = 0.55 + Math.sin(s.time * 8) * 0.15;
        const img = buildIcon(b.id);
        if (b.id === 'snare') blit(img, x - 5, y - 3);
        else if (b.id === 'torch') blit(img, x - 4, y - 14);
        else blit(img, x - img.width / 2, y + 9 - img.height);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ok ? '#7dff8a' : '#ff4a3a';
        ctx.strokeRect(Math.round(x - 8) + 0.5, Math.round(y - 8) + 0.5, 15, 15);
        const hint = device === 'touch' ? `${tag}PLACE ${b.name.toUpperCase()}: PLACE / BACK / CANCEL`
          : `${tag}${keyName('place', device)} PLACE ${b.name}   ${keyName('next', device)} BACK   ${keyName('build', device)} CANCEL`;
        const w = textWidth(hint) + 12, by = H - 30 - row * 18;
        panel(Math.round(W / 2 - w / 2), by, w, 13);
        drawText(ctx, hint, W / 2, by + 3, { align: 'center', color: ok ? '#f4ead2' : '#ff8a7a' });
        row++;
        continue;
      }
      // The menu.
      const list = buildList(s);
      const sel = p.build.sel % list.length;
      const mw = 220, mh = 30 + list.length * 12;
      const mx = s.players.length > 1 ? (p.id === 0 ? 10 : W - mw - 10) : Math.round(W / 2 - mw / 2);
      const my = Math.round(H / 2 - mh / 2);
      panel(mx, my, mw, mh);
      drawText(ctx, `${tag}BUILD`, mx + 6, my + 5, { color: '#ffe08a' });
      drawText(ctx, `WOOD ${s.stock.wood}  STONE ${s.stock.stone}`, mx + mw - 6, my + 5, { align: 'right', color: '#b8c8a0' });
      list.forEach((it, i) => {
        const y = my + 17 + i * 12;
        const afford = canAfford(s, it);
        if (i === sel) { ctx.fillStyle = 'rgba(255,224,138,0.22)'; ctx.fillRect(mx + 3, y - 2, mw - 6, 11); }
        const icon = buildIcon(it.id);
        const ih = Math.min(9, icon.height), iw = Math.round(icon.width * ih / icon.height);
        ctx.drawImage(icon, mx + 6 + Math.round((10 - iw) / 2), y - 1, iw, ih);
        drawText(ctx, it.name, mx + 19, y, { color: i === sel ? '#ffe08a' : afford ? '#f4ead2' : '#8a8070' });
        drawText(ctx, costText(it.cost), mx + mw - 6, y, { align: 'right', color: afford ? '#7dff8a' : '#ff8a7a' });
      });
      const cur = list[sel];
      const verb = cur.kind === 'place' ? 'CHOOSE' : cur.kind === 'use' ? 'USE' : 'CRAFT';
      drawText(ctx, cur.desc, mx + 6, my + mh - 11, { color: '#b8c8a0', shadow: null });
      const hint = device === 'touch' ? 'STICK UP/DOWN, THEN CHOOSE' : `${keyName('choose', device)} SELECT   ${keyName('place', device)} ${verb}   ${keyName('build', device)} CLOSE`;
      drawText(ctx, hint, mx + mw / 2, my + mh + 4, { align: 'center', color: '#f4ead2' });
    }
  }

  function drawPause(device, s) {
    ctx.fillStyle = 'rgba(8,10,20,0.7)';
    ctx.fillRect(0, 0, W, H);
    panel(W / 2 - 110, 150, 220, 84);
    if (s && !s.tutorial) {
      const day = s.phase === 'day';
      const txt = day ? `${keyName('leave', device)}  LEAVE THE ISLAND  (+${Math.round(CFG.leaveBonus * s.night * 100)}%)` : 'THE BOAT ONLY COMES BY DAY';
      drawText(ctx, txt, W / 2, 214, { align: 'center', color: day ? '#7dff8a' : '#8a8070' });
    }
    drawText(ctx, 'PAUSED', W / 2, 158, { scale: 2, align: 'center', color: '#ffd38a' });
    drawText(ctx, device === 'touch' ? 'TAP TO RESUME' : `${keyName('resume', device)}  RESUME`, W / 2, 186, { align: 'center' });
    if (device !== 'touch') drawText(ctx, `${keyName('quit', device)}  QUIT TO MUSEUM`, W / 2, 200, { align: 'center', color: '#ff8a7a' });
  }

  function wrap(text, max) {
    const lines = [];
    let line = '';
    for (const w of text.split(' ')) {
      if ((line + ' ' + w).trim().length > max) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
    }
    if (line) lines.push(line);
    return lines;
  }

  // Tutorial card (top centre, between the HUD panels) and a guide arrow.
  function drawTutorial(s, hint, target, device) {
    const text = wrap(fillKeys(hint.text, device), 37);
    const tip = hint.tip ? wrap(fillKeys(hint.tip, device), 37) : [];
    const h = 14 + (text.length + tip.length) * 9;
    panel(118, 4, 232, h);
    drawText(ctx, `TUTORIAL ${hint.n}/${hint.of}`, 124, 8, { color: '#7a8a70', shadow: null });
    text.forEach((l, i) => drawText(ctx, l, 124, 17 + i * 9));
    tip.forEach((l, i) => drawText(ctx, l, 124, 17 + (text.length + i) * 9, { color: hint.warn ? '#ff8a5a' : '#ffe08a' }));

    if (!target) return;
    const x = target.x / 2 - cam.x, y = target.y / 2 - cam.y;
    const bob = Math.round(Math.sin(s.time * 6) * 2);
    ctx.fillStyle = '#ffe08a';
    ctx.strokeStyle = '#14110c';
    ctx.lineWidth = 1;
    const tri = (ax, ay, ang) => {
      ctx.save();
      ctx.translate(Math.round(ax), Math.round(ay));
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    const m = 18;
    if (x > m && x < W - m && y > m + h && y < H - m) {
      tri(x, y - 24 + bob, Math.PI / 2); // bouncing arrow over the target
    } else {
      // Off screen: pin an arrow to the edge, pointing the way.
      const cxs = W / 2, cys = H / 2;
      const ang = Math.atan2(y - cys, x - cxs);
      const k = Math.min((W / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
      tri(cxs + Math.cos(ang) * (k + bob), cys + Math.sin(ang) * (k + bob), ang);
    }
  }

  return { drawGame, drawMenu, drawSummary, drawPause, drawTutorial, drawBuild, toast, event };
}
