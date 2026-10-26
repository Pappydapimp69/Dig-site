// The museum: what carries over between runs.
import { SPECIES, UPGRADES, upgradeCost } from './data.js';

export const KEY = 'digsite.save.v1';

export function freshSave() {
  return {
    funding: 0,
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    museum: {},
    runs: 0,
    wins: 0,
  };
}

export function loadSave(storage) {
  const f = freshSave();
  try {
    const raw = storage && storage.getItem(KEY);
    if (!raw) return f;
    const d = JSON.parse(raw);
    return {
      ...f, ...d,
      upgrades: { ...f.upgrades, ...(d.upgrades || {}) },
      museum: { ...(d.museum || {}) },
    };
  } catch {
    return f;
  }
}

export function writeSave(storage, save) {
  try { storage && storage.setItem(KEY, JSON.stringify(save)); } catch { /* storage blocked */ }
}

export function applyRun(save, run) {
  const out = JSON.parse(JSON.stringify(save));
  out.runs++;
  if (run.result === 'won') out.wins++;
  out.funding += run.payout;
  for (const [sp, n] of Object.entries(run.banked)) out.museum[sp] = (out.museum[sp] || 0) + n;
  return out;
}

export function buy(save, id) {
  const u = UPGRADES.find((x) => x.id === id);
  const lvl = save.upgrades[id] || 0;
  if (!u || lvl >= u.max) return { ok: false, save, why: 'maxed' };
  const cost = upgradeCost(u, lvl);
  if (save.funding < cost) return { ok: false, save, why: 'funds' };
  const out = JSON.parse(JSON.stringify(save));
  out.funding -= cost;
  out.upgrades[id] = lvl + 1;
  return { ok: true, save: out };
}

// Each species with at least one finished skeleton grants its perk.
export const perks = (save) => collection(save).filter((c) => c.skeletons > 0).map((c) => c.id);

export function collection(save) {
  return SPECIES.filter((s) => !s.treasure).map((s) => {
    const have = save.museum[s.id] || 0;
    return { ...s, have, skeletons: Math.floor(have / s.bones), progress: have % s.bones };
  });
}
