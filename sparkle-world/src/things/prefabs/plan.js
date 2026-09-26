// Turn a prefab def into a resolved plan: block keys -> registry ids (with stand-ins for keys
// an older block library lacks), furniture keys -> the first registered one. Unknown keys are
// skipped; each missing key is reported once per session in one friendly console warning.

import { PrefabRecorder, makeApi, BLOCK_STAND_INS } from './kit.js';

const reported = new Set();
let pending = [];
let flushTimer = 0;

function report(kind, key, detail) {
  const k = kind + ':' + key;
  if (reported.has(k)) return;
  reported.add(k);
  pending.push(detail ? `${key} (${detail})` : key);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = 0;
      if (pending.length) console.warn(`[prefabs] stand-ins / skipped keys: ${pending.join(', ')}`);
      pending = [];
    }, 0);
  }
}

/** Block id for 'a|b|c' (first registered key, then canonical stand-ins); -1 when none. */
export function resolveBlockKey(blocks, spec, cache) {
  if (spec === 'air') return 0;
  let id = cache.get(spec);
  if (id !== undefined) return id;
  id = -1;
  const alts = String(spec).split('|');
  for (const k of alts) {
    const i = blocks.idOf(k);
    if (i > 0) { id = i; break; }
  }
  if (id < 0) {
    for (const k of alts) {
      for (const s of BLOCK_STAND_INS[k] || []) {
        const i = blocks.idOf(s);
        if (i > 0) {
          id = i;
          report('block', k, 'using ' + s);
          break;
        }
      }
      if (id >= 0) break;
    }
  }
  if (id < 0) report('block', alts[alts.length - 1], 'skipped');
  cache.set(spec, id);
  return id;
}

/** First registered furniture key of a list, or null. */
export function resolveFurnitureKey(game, keys) {
  const reg = game.registry.furniture;
  if (!reg) return null;
  for (const k of keys) if (reg.has(k)) return k;
  report('furniture', keys.join('|'), 'skipped');
  return null;
}

/**
 * plan = { key, name, W, H, D, ax, az, ids: Int16Array (-1 untouched, 0 air, >0 block id),
 *          furniture: [{ key, def, x, y, z, rot, color, data, back }], opts, blockCount,
 *          maxY }
 */
export function resolvePlan(game, def) {
  const rec = new PrefabRecorder(def.size);
  const api = makeApi(rec);
  def.build(api);
  const { W, H, D } = rec;
  const blocks = game.registry.blocks;
  const cache = new Map();
  const ids = new Int16Array(W * H * D).fill(-1);
  const furniture = [];
  for (const f of rec.furniture) {
    const key = resolveFurnitureKey(game, f.keys);
    if (key) {
      furniture.push({ ...f, key, def: game.registry.furniture.get(key) });
    } else if (f.orBlock && rec.inside(f.x, f.y, f.z)) {
      const i = rec.index(f.x, f.y, f.z);
      if (rec.cells[i] === null || rec.cells[i] === 'air') rec.cells[i] = f.orBlock;
    }
  }
  let blockCount = 0, maxY = 0;
  for (let i = 0; i < rec.cells.length; i++) {
    const spec = rec.cells[i];
    if (spec === null) continue;
    const id = resolveBlockKey(blocks, spec, cache);
    if (id < 0) continue;
    ids[i] = id;
    if (id > 0) {
      blockCount++;
      const y = Math.floor(i / (W * D));
      if (y > maxY) maxY = y;
    }
  }
  if (rec.outside > 0 && !reported.has('outside:' + def.key)) {
    reported.add('outside:' + def.key);
    console.warn(`[prefabs] ${def.key}: ${rec.outside} writes fell outside its ${W}x${H}x${D} box`);
  }
  return {
    key: def.key,
    name: def.name,
    W, H, D,
    ax: def.anchor ? def.anchor[0] : Math.floor(W / 2),
    az: def.anchor ? def.anchor[1] : D - 1,
    ids,
    furniture,
    opts: { clear: 'all', level: true, ...(def.options || {}) },
    blockCount,
    maxY,
    index: (x, y, z) => (y * D + z) * W + x,
  };
}
