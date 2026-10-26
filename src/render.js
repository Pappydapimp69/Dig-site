// Pixel-art renderer. Draws at 480x300 and the page scales it up with
// nearest-neighbour, so every pixel stays crisp. World units are 2x screen px.
import { T, TILE } from './world.js';
import { CFG, UPGRADES, speciesById, upgradeCost } from './data.js';
import { collection } from './save.js';
import { drawText, textWidth } from './art/font.js';
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
    raptorStun: SP.raptorSprites(true),
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
  const species = Object.fromEntries(Object.values(speciesById).map((s) => [s.id, SP.boneSprite(s.color)]));

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
      for (const r of s.raptors) if (r.stun > CFG.stunTime - 0.05) burst(r.x / 2, r.y / 2 - 4, 10, ['#d0d0c8', '#8a8a84'], 55, 0.4, 10);
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
    if (s.phase === 'night') return DARK;
    if (s.t > CFG.dayLen - 12) return DARK * (s.t - (CFG.dayLen - 12)) / 12;
    if (s.night > 0 && s.t < 5) return DARK * (1 - s.t / 5);
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
        const q = Math.min(1, Math.floor(alphaBuf[i] * 4 + b) / 4) * a;
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
    items.push({ y: w.camp.y / 2 - 6, kind: 'tent' }, { y: w.camp.y / 2 - 10, kind: 'crate' }, { y: w.camp.y / 2 + 6, kind: 'fire' });
    for (const p of s.players) items.push({ y: p.y / 2, kind: 'player', p });
    for (const r of s.raptors) items.push({ y: r.y / 2, kind: 'raptor', r });
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
      } else if (it.kind === 'player') drawPlayer(s, it.p, sx(it.p.x), sy(it.p.y), dt);
      else drawRaptor(s, it.r, sx(it.r.x), sy(it.r.y), dt);
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
    for (const p of s.players) if (!p.down) lights.push({ x: sx(p.x), y: sy(p.y) - 6, r: 52 });
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

    // Things that must read through the dark.
    for (const r of s.raptors) {
      const x = sx(r.x), y = sy(r.y);
      const st = actor.get(r);
      if (a > 0.3 && r.stun <= 0) {
        const right = Math.cos(r.heading) >= 0;
        ctx.fillStyle = r.mode === 'chase' ? '#ff4a3a' : '#ffe14d';
        ctx.fillRect(Math.round(x + (right ? 6 : -7)), Math.round(y - 15), 1, 1);
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
    const bob = p.moving && frame !== 0 ? -1 : digging && Math.floor(s.time * 8) % 2 ? 1 : 0;
    blit(img, x - img.width / 2, y - img.height + 1 + bob);
    if (tileUnder(s, p) === T.TALL) blit(art.tuft, x - 6, y - 3);
    // Carried bones stack above the head.
    p.carry.forEach((b, i) => blit(b.mult > 1 ? art.boneGold : species[b.sp], x - 3, y - img.height - 3 - i * 3));
    if (digging) {
      bar(x - 8, y - img.height - 6 - p.carry.length * 3, 16, p.digT / s.st.digTime, '#ffd84d');
      st.dust += dt;
      if (st.dust > 0.12) { st.dust = 0; burst(x + cam.x, y + cam.y, 2, ['#8a5a33', '#b07e4c'], 30, 0.35, 25); }
    } else if (p.moving) {
      st.dust += dt;
      if (st.dust > 0.18) { st.dust = 0; particles.push({ x: x + cam.x, y: y + cam.y, vx: -p.fx * 10, vy: -6, life: 0.3, color: '#c8b48a', g: 0 }); }
    }
  }


  function drawRaptor(s, r, x, y, dt) {
    const st = anim(r, r.stun <= 0, dt);
    if (st.mode !== 'chase' && r.mode === 'chase') st.alert = 0.8;
    st.mode = r.mode;
    st.alert = Math.max(0, (st.alert || 0) - dt);
    const set = r.stun > 0 ? art.raptorStun : art.raptor;
    const dirSet = Math.cos(r.heading) >= 0 ? set.right : set.left;
    const rate = r.mode === 'chase' ? 12 : 6;
    const img = dirSet[r.stun > 0 ? 0 : Math.floor(st.t * rate) % 2];
    blit(art.shadowBig, x - 11, y - 3);
    blit(img, x - img.width / 2, y - img.height + 1);
    if (r.mode === 'chase' && r.stun <= 0) {
      st.dust += dt;
      if (st.dust > 0.1) { st.dust = 0; particles.push({ x: x + cam.x, y: y + cam.y, vx: -Math.cos(r.heading) * 15, vy: -8, life: 0.3, color: '#b8a47a', g: 0 }); }
    }
  }

  const tileUnder = (s, p) => {
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    return s.world.tiles[ty * s.world.w + tx];
  };

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
    const len = isNight ? CFG.nightLen : CFG.dayLen;
    panel(4, 4, 108, 34);
    blit(isNight ? art.moon : art.sun, 8, 8);
    drawText(ctx, isNight ? `NIGHT ${s.night}/${CFG.nights}` : `DAY ${s.night + 1}`, 21, 9, { color: isNight ? '#b8c8ff' : '#ffe08a' });
    bar(9, 21, 98, 1 - s.t / len, isNight ? '#6c8cff' : '#ffc53d');
    drawText(ctx, `$${s.funding}`, 9, 27, { color: '#ffd84d' });
    if (isNight && s.fire <= CFG.fireSafeMin && Math.floor(s.time * 3) % 2) {
      drawText(ctx, 'THE FIRE IS DYING!', 8, 44, { color: '#ff6a5a' });
    }

    s.players.forEach((p, i) => {
      const x = W - 104, y = 4 + i * 36;
      panel(x, y, 100, 32);
      drawText(ctx, `P${i + 1}`, x + 4, y + 5, { color: P_COL[i] });
      for (let h = 0; h < CFG.hp; h++) blit(h < p.hp ? art.heart : art.heartEmpty, x + 20 + h * 9, y + 5);
      for (let b = 0; b < s.st.cap; b++) {
        const item = p.carry[b];
        blit(item ? (item.mult > 1 ? art.boneGold : art.bone) : art.boneEmpty, x + 5 + b * 9, y + 19);
      }
      blit(art.trap, x + 72, y + 18);
      drawText(ctx, `${p.traps}`, x + 86, y + 19);
    });

    let ty = H - 14;
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

  function drawMenu(save, msg, time = 0) {
    backdrop(time);
    drawText(ctx, 'DIG SITE', W / 2, 18, { scale: 4, align: 'center', color: '#ffd38a', shadow: '#5a2a10' });
    drawText(ctx, 'DIG BY DAY. SURVIVE THE NIGHT.', W / 2, 52, { align: 'center', color: '#b8c8a0' });

    panel(14, 68, 232, 130);
    drawText(ctx, 'UPGRADES', 22, 74, { color: '#ffe08a' });
    drawText(ctx, `FUNDING $${save.funding}`, 238, 74, { align: 'right', color: '#ffd84d' });
    UPGRADES.forEach((u, i) => {
      const lvl = save.upgrades[u.id] || 0;
      const maxed = lvl >= u.max;
      const cost = upgradeCost(u, lvl);
      const can = !maxed && save.funding >= cost;
      const y = 90 + i * 21;
      drawText(ctx, `${i + 1} ${u.name}`, 22, y, { color: can ? '#f4ead2' : '#8a8070' });
      for (let k = 0; k < u.max; k++) {
        ctx.fillStyle = k < lvl ? '#7dff8a' : '#3a3428';
        ctx.fillRect(150 + k * 6, y + 1, 4, 5);
      }
      drawText(ctx, maxed ? 'MAX' : `$${cost}`, 238, y, { align: 'right', color: can ? '#7dff8a' : '#8a8070' });
      drawText(ctx, u.desc, 30, y + 9, { color: '#7a7262', shadow: null });
    });

    panel(254, 68, 212, 130);
    drawText(ctx, 'MUSEUM', 262, 74, { color: '#ffe08a' });
    collection(save).forEach((c, i) => {
      const y = 90 + i * 21;
      blit(species[c.id], 262, y + 1);
      drawText(ctx, c.name, 273, y, { color: c.have ? '#f4ead2' : '#8a8070' });
      bar(273, y + 10, 80, c.progress / c.bones, '#f4ead2');
      drawText(ctx, `${c.skeletons} BUILT`, 458, y, { align: 'right', color: c.skeletons ? '#7dff8a' : '#8a8070' });
    });

    const pulse = Math.floor(time * 2) % 2 ? '#ffffff' : '#ffe08a';
    drawText(ctx, 'SPACE  SOLO      ENTER  CO-OP', W / 2, 208, { align: 'center', color: pulse });
    drawText(ctx, 'P1 WASD  E DIG  Q TRAP     P2 ARROWS  . DIG  , TRAP', W / 2, 222, { align: 'center', color: '#b8c8a0' });
    drawText(ctx, `RUNS ${save.runs}   ISLANDS CLEARED ${save.wins}`, W / 2, 234, { align: 'center', color: '#7a8a70' });
    if (msg) drawText(ctx, msg, W / 2, 196, { align: 'center', color: '#ff6a5a' });
  }

  function drawSummary(s, time = 0) {
    backdrop(time);
    const won = s.result === 'won';
    drawText(ctx, won ? 'ISLAND CLEARED' : 'THE NIGHT WON', W / 2, 40, { scale: 3, align: 'center', color: won ? '#7dff8a' : '#ff6a5a', shadow: '#14110c' });
    panel(W / 2 - 110, 76, 220, 40 + Object.keys(s.banked).length * 12);
    drawText(ctx, `BONES BANKED  ${s.bankedCount}`, W / 2, 84, { align: 'center' });
    drawText(ctx, `FUNDING  $${s.payout}${won ? `  (X${CFG.winBonus})` : ''}`, W / 2, 96, { align: 'center', color: '#ffd84d' });
    let y = 112;
    for (const [sp, n] of Object.entries(s.banked)) {
      blit(species[sp], W / 2 - 60, y + 1);
      drawText(ctx, `${speciesById[sp].name} X${n}`, W / 2 - 50, y, { color: '#b8c8a0' });
      y += 12;
    }
    drawText(ctx, 'SPACE  BACK TO THE MUSEUM', W / 2, 214, { align: 'center', color: Math.floor(time * 2) % 2 ? '#ffffff' : '#ffe08a' });
  }

  return { drawGame, drawMenu, drawSummary, toast, event };
}
