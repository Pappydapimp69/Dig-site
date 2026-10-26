import { TILE, T } from './world.js';
import { CFG, UPGRADES, speciesById, upgradeCost } from './data.js';
import { collection } from './save.js';

const TILE_COL = {
  [T.WATER]: '#1d4e89', [T.SAND]: '#d8c38a', [T.GRASS]: '#5d8f3a',
  [T.TALL]: '#4a7a2c', [T.ROCK]: '#7a7468', [T.TREE]: '#5d8f3a',
};
const P_COL = ['#ff9a3c', '#4fd1e8'];
const DARK = 0.88;

export function makeRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const dark = document.createElement('canvas');
  dark.width = W; dark.height = H;
  const dctx = dark.getContext('2d');
  const toasts = [];

  const text = (str, x, y, { size = 16, color = '#f3ead7', align = 'left', bold = false } = {}) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = align;
    ctx.fillStyle = '#0008';
    ctx.fillText(str, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  };

  function toast(msg) {
    toasts.push({ msg, t: 2.5 });
    if (toasts.length > 4) toasts.shift();
  }

  function darkness(s) {
    if (s.phase === 'night') return DARK;
    if (s.t > CFG.dayLen - 10) return DARK * (s.t - (CFG.dayLen - 10)) / 10; // dusk
    if (s.night > 0 && s.t < 5) return DARK * (1 - s.t / 5); // dawn
    return 0;
  }

  function drawTiles(s, cx, cy) {
    const w = s.world;
    const x0 = Math.max(0, Math.floor(cx / TILE)), y0 = Math.max(0, Math.floor(cy / TILE));
    const x1 = Math.min(w.w - 1, Math.floor((cx + W) / TILE)), y1 = Math.min(w.h - 1, Math.floor((cy + H) / TILE));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = w.tiles[y * w.w + x];
        const px = x * TILE - cx, py = y * TILE - cy;
        ctx.fillStyle = TILE_COL[t];
        ctx.fillRect(px, py, TILE + 1, TILE + 1);
        if (t === T.WATER) {
          ctx.fillStyle = '#ffffff14';
          const o = (Math.sin(s.time * 1.5 + x * 0.7 + y) + 1) * 6;
          ctx.fillRect(px + 4 + o, py + 12, 10, 2);
        } else if (t === T.TALL) {
          ctx.strokeStyle = '#2f5a1c';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            const gx = px + 5 + i * 7, gy = py + 26;
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + Math.sin(s.time * 2 + x + i) * 2, gy - 14);
          }
          ctx.stroke();
        } else if (t === T.ROCK) {
          ctx.fillStyle = '#5f5a50';
          ctx.beginPath();
          ctx.arc(px + 12 + ((x * 7 + y * 3) % 5), py + 18, 10, 0, Math.PI * 2);
          ctx.arc(px + 22, py + 12 + ((x + y * 5) % 4), 7, 0, Math.PI * 2);
          ctx.fill();
        } else if (t === T.TREE) {
          ctx.fillStyle = '#4a3220';
          ctx.fillRect(px + 13, py + 18, 6, 12);
          ctx.fillStyle = '#244a19';
          ctx.beginPath();
          ctx.arc(px + 16, py + 13, 13, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawCamp(s, cx, cy) {
    const c = s.world.camp;
    const x = c.x - cx, y = c.y - cy;
    ctx.fillStyle = '#b89a62';
    ctx.beginPath();
    ctx.arc(x, y, CFG.campR, 0, Math.PI * 2);
    ctx.fill();
    // Tent
    ctx.fillStyle = '#c4552f';
    ctx.beginPath();
    ctx.moveTo(x - 48, y - 10); ctx.lineTo(x - 28, y - 42); ctx.lineTo(x - 8, y - 10);
    ctx.fill();
    // Museum crate
    ctx.fillStyle = '#7b5530';
    ctx.fillRect(x + 18, y - 34, 26, 20);
    // Fire
    const f = s.phase === 'night' ? s.fire / s.st.fireR : 1;
    const flick = 1 + Math.sin(s.time * 17) * 0.12;
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.arc(x, y + 6, (5 + 7 * f) * flick, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.arc(x, y + 6, (2 + 4 * f) * flick, 0, Math.PI * 2);
    ctx.fill();
    if (s.phase === 'night' && s.fire > 0) {
      ctx.strokeStyle = s.fire > CFG.fireSafeMin ? '#ffb34d55' : '#ff3b3b88';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(x, y, s.fire, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawSites(s, cx, cy) {
    for (const site of s.world.sites) {
      const x = site.x - cx, y = site.y - cy;
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      if (site.bones <= 0) {
        ctx.fillStyle = '#3b2a1a';
        ctx.beginPath();
        ctx.ellipse(x, y, 12, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = '#8a6136';
      ctx.beginPath();
      ctx.ellipse(x, y, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = speciesById[site.species].color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 3); ctx.lineTo(x + 7, y + 3);
      ctx.moveTo(x - 7, y + 3); ctx.lineTo(x + 7, y - 3);
      ctx.stroke();
      text(String(site.bones), x, y - 14, { size: 12, align: 'center', bold: true });
    }
  }

  function drawTraps(s, cx, cy) {
    for (const t of s.traps) {
      const x = t.x - cx, y = t.y - cy;
      ctx.strokeStyle = '#c9c9c9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
        ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12);
      }
      ctx.stroke();
    }
  }

  function drawPlayers(s, cx, cy) {
    for (const p of s.players) {
      const x = p.x - cx, y = p.y - cy;
      if (p.down) {
        ctx.strokeStyle = P_COL[p.id];
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 8, y - 8); ctx.lineTo(x + 8, y + 8);
        ctx.moveTo(x + 8, y - 8); ctx.lineTo(x - 8, y + 8);
        ctx.stroke();
        if (p.reviveT > 0) arc(x, y, 18, p.reviveT / CFG.reviveTime, '#7dff8a');
        continue;
      }
      if (p.invuln > 0 && Math.floor(s.time * 12) % 2) continue;
      ctx.fillStyle = P_COL[p.id];
      ctx.beginPath();
      ctx.arc(x, y, CFG.pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a3d1e'; // hat
      ctx.fillRect(x - 11, y - 9, 22, 4);
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(x + p.fx * 5, y + p.fy * 5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      p.carry.forEach((b, i) => {
        ctx.fillStyle = b.mult > 1 ? '#ffd34d' : '#f4ead2';
        ctx.fillRect(x - 12 + i * 7, y + 14, 5, 5);
      });
      if (p.digT > 0) arc(x, y, 17, p.digT / s.st.digTime, '#ffe08a');
    }
  }

  function arc(x, y, r, frac, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
  }

  function drawRaptor(r, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r.heading);
    ctx.fillStyle = r.stun > 0 ? '#d9c34a' : '#7fb83a';
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(-10, -8); ctx.lineTo(-22, 0); ctx.lineTo(-10, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawDark(s, cx, cy, a) {
    if (a <= 0) return;
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = `rgba(6,10,28,${a})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r) => {
      if (r <= 0) return;
      const g = dctx.createRadialGradient(x, y, r * 0.3, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g;
      dctx.beginPath();
      dctx.arc(x, y, r, 0, Math.PI * 2);
      dctx.fill();
    };
    const c = s.world.camp;
    hole(c.x - cx, c.y - cy, (s.phase === 'night' ? s.fire : s.st.fireR) + 40);
    for (const p of s.players) if (!p.down) hole(p.x - cx, p.y - cy, 95);
    ctx.drawImage(dark, 0, 0);
  }

  function drawHud(s) {
    const isNight = s.phase === 'night';
    const len = isNight ? CFG.nightLen : CFG.dayLen;
    const label = isNight ? `NIGHT ${s.night}/${CFG.nights}` : `DAY ${s.night + 1}`;
    text(label, 16, 28, { size: 20, bold: true, color: isNight ? '#9ab8ff' : '#ffe08a' });
    ctx.fillStyle = '#0006';
    ctx.fillRect(16, 36, 180, 8);
    ctx.fillStyle = isNight ? '#6c8cff' : '#ffc94d';
    ctx.fillRect(16, 36, 180 * (1 - s.t / len), 8);
    text(`Funding $${s.funding}`, 16, 66, { size: 16 });
    if (isNight && s.fire <= CFG.fireSafeMin) text('The fire is dying!', 16, 88, { size: 14, color: '#ff8a7a' });

    s.players.forEach((p, i) => {
      const x = W - 16, y = 28 + i * 52;
      text(`P${i + 1}`, x - 150, y, { size: 16, bold: true, color: P_COL[i] });
      for (let h = 0; h < CFG.hp; h++) {
        ctx.fillStyle = h < p.hp ? '#ff5a5a' : '#ffffff30';
        ctx.fillRect(x - 118 + h * 18, y - 13, 13, 13);
      }
      text(`bag ${p.carry.length}/${s.st.cap}  traps ${p.traps}`, x, y + 20, { size: 13, align: 'right' });
    });

    let ty = H - 20;
    for (let i = toasts.length - 1; i >= 0; i--) {
      text(toasts[i].msg, W / 2, ty, { size: 16, align: 'center', bold: true });
      ty -= 24;
    }
  }

  function drawGame(s, dt) {
    for (const t of toasts) t.t -= dt;
    while (toasts.length && toasts[0].t <= 0) toasts.shift();

    const live = s.players.filter((p) => !p.down);
    const focus = live.length ? live : s.players;
    const fx = focus.reduce((n, p) => n + p.x, 0) / focus.length;
    const fy = focus.reduce((n, p) => n + p.y, 0) / focus.length;
    const cx = Math.round(Math.max(0, Math.min(s.world.w * TILE - W, fx - W / 2)));
    const cy = Math.round(Math.max(0, Math.min(s.world.h * TILE - H, fy - H / 2)));

    ctx.fillStyle = TILE_COL[T.WATER];
    ctx.fillRect(0, 0, W, H);
    drawTiles(s, cx, cy);
    drawCamp(s, cx, cy);
    drawSites(s, cx, cy);
    drawTraps(s, cx, cy);
    drawPlayers(s, cx, cy);
    for (const r of s.raptors) drawRaptor(r, r.x - cx, r.y - cy);
    const a = darkness(s);
    drawDark(s, cx, cy, a);
    if (a > 0.3) {
      // Eyes glint in the dark.
      ctx.fillStyle = '#ffe14d';
      for (const r of s.raptors) {
        const ex = r.x - cx + Math.cos(r.heading) * 9, ey = r.y - cy + Math.sin(r.heading) * 9;
        ctx.fillRect(ex - 3, ey - 1, 2, 2);
        ctx.fillRect(ex + 1, ey - 1, 2, 2);
      }
    }
    drawHud(s);
  }

  function panel() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b2a1a');
    g.addColorStop(1, '#0d150d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawMenu(save, msg) {
    panel();
    text('DIG SITE', W / 2, 70, { size: 52, align: 'center', bold: true, color: '#ffd38a' });
    text('Dig by day. Survive the night.', W / 2, 102, { size: 18, align: 'center', color: '#c9d6b8' });
    text(`Museum funding: $${save.funding}`, 60, 160, { size: 20, bold: true });

    text('UPGRADES', 60, 200, { size: 16, bold: true, color: '#ffe08a' });
    UPGRADES.forEach((u, i) => {
      const lvl = save.upgrades[u.id] || 0;
      const maxed = lvl >= u.max;
      const cost = upgradeCost(u, lvl);
      const can = !maxed && save.funding >= cost;
      const y = 230 + i * 30;
      text(`[${i + 1}] ${u.name}`, 60, y, { size: 16, color: can ? '#ffffff' : '#9aa38f' });
      text(`${'■'.repeat(lvl)}${'□'.repeat(u.max - lvl)}`, 250, y, { size: 14 });
      text(maxed ? 'MAX' : `$${cost}`, 330, y, { size: 16, color: can ? '#7dff8a' : '#9aa38f' });
      text(u.desc, 390, y, { size: 13, color: '#9aa38f' });
    });

    text('COLLECTION', 600, 200, { size: 16, bold: true, color: '#ffe08a' });
    collection(save).forEach((c, i) => {
      const y = 230 + i * 30;
      text(c.name, 600, y, { size: 16 });
      text(`${c.skeletons} built  ${c.progress}/${c.bones}`, 900, y, { size: 14, align: 'right', color: '#c9d6b8' });
    });

    text(`Runs ${save.runs}   Islands cleared ${save.wins}`, 60, 420, { size: 14, color: '#9aa38f' });
    text('SPACE  solo        ENTER  2-player co-op', W / 2, 480, { size: 22, align: 'center', bold: true });
    text('P1: WASD move, E dig/revive, Q trap     P2: arrows, . dig/revive, , trap', W / 2, 515, { size: 14, align: 'center', color: '#c9d6b8' });
    text('Solo also works with arrows + Space. Gamepads work too.', W / 2, 538, { size: 14, align: 'center', color: '#c9d6b8' });
    if (msg) text(msg, W / 2, 575, { size: 16, align: 'center', color: '#ff8a7a' });
  }

  function drawSummary(s) {
    panel();
    const won = s.result === 'won';
    text(won ? 'ISLAND CLEARED' : 'THE NIGHT WON', W / 2, 140, { size: 44, align: 'center', bold: true, color: won ? '#7dff8a' : '#ff8a7a' });
    text(`Bones banked: ${s.bankedCount}`, W / 2, 220, { size: 22, align: 'center' });
    text(`Funding earned: $${s.payout}${won ? ` (x${CFG.winBonus} clear bonus)` : ''}`, W / 2, 256, { size: 22, align: 'center' });
    let y = 310;
    for (const [sp, n] of Object.entries(s.banked)) {
      text(`${speciesById[sp].name}  x${n}`, W / 2, y, { size: 16, align: 'center', color: '#c9d6b8' });
      y += 24;
    }
    text('SPACE  back to the museum', W / 2, H - 50, { size: 20, align: 'center', bold: true });
  }

  return { drawGame, drawMenu, drawSummary, toast };
}
