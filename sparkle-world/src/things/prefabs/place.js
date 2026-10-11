// Where a prefab goes and what it changes: placement from a pick (anchor, turn, base height,
// world-edge clamping), and the exact list of block changes (clear the area, level a
// foundation, a gentle terrace ring, trees in the way), entities to move out of the way and
// furniture to put in. Applying it is one world.batch; undoing restores every cell exactly.

import { SHAPES } from '../../core/registry.js';
import { rotXZ, frontVec } from './kit.js';

export const RING = 3; // terrace ring width around the footprint
export const EDGE = RING + 1; // footprint keeps this far from the world edge
const TREE_LIMIT = 4000;

const NATURAL = new Set([
  'grass', 'dirt', 'stone', 'sand', 'snow', 'moss', 'gravel', 'clay', 'path', 'sand_pink', 'grass_snowy',
  'grass_moss', 'ice_packed', 'mossy_stone', 'grass_frosting', 'grass_frosting_mint', 'grass_frosting_vanilla',
  'frosting_pink', 'frosting_white', 'frosting_mint', 'frosting_chocolate', 'cookie', 'chocolate', 'farmland',
  'farmland_wet',
]);
const SURFACE = new Set([
  'grass', 'sand', 'snow', 'moss', 'sand_pink', 'grass_snowy', 'grass_moss', 'grass_frosting',
  'grass_frosting_mint', 'grass_frosting_vanilla', 'frosting_pink', 'frosting_white', 'frosting_mint',
  'frosting_chocolate', 'path',
]);
const TREE = /^(log_|leaves_)|^(palm_log|palm_leaves|pine_leaves|snow_leaves|mushroom_stem|mushroom_cap)/;
const LEAVES = /^leaves_|^(palm_leaves|pine_leaves|snow_leaves)$/;

/** Lookup tables by block id (built once the registry is final). */
export function classify(game) {
  if (game._prefabClass) return game._prefabClass;
  const reg = game.registry.blocks;
  const props = reg.props;
  const n = 256;
  const c = {
    natural: new Uint8Array(n), surface: new Uint8Array(n), tree: new Uint8Array(n), leaves: new Uint8Array(n),
    plant: new Uint8Array(n), liquid: new Uint8Array(n), ground: new Uint8Array(n), opaque: props.opaque,
    shape: props.shape,
  };
  for (const def of reg.defs) {
    const id = def.id;
    if (!id) continue;
    const k = def.key;
    const shape = props.shape[id];
    if (NATURAL.has(k)) c.natural[id] = 1;
    if (SURFACE.has(k)) c.surface[id] = 1;
    if (TREE.test(k)) c.tree[id] = 1;
    if (LEAVES.test(k)) c.leaves[id] = 1;
    if (shape === SHAPES.cross || (shape === SHAPES.carpet && def.replaceable)) c.plant[id] = 1;
    if (shape === SHAPES.liquid) c.liquid[id] = 1;
    // what a house may stand on: anything solid that is not a tree or a sprite
    if (props.solid[id] && !c.tree[id] && shape !== SHAPES.cross) c.ground[id] = 1;
  }
  c.grass = reg.idOf('grass') > 0 ? reg.idOf('grass') : 1;
  c.dirt = reg.idOf('dirt') > 0 ? reg.idOf('dirt') : c.grass;
  c.stone = reg.idOf('stone') > 0 ? reg.idOf('stone') : c.dirt;
  c.sand = reg.idOf('sand');
  game._prefabClass = c;
  return c;
}

/** Highest ground block at or below y in column (x, z) (skipping trees, sprites, water); -1 if none. */
export function groundBelow(game, x, y, z) {
  const w = game.world, c = classify(game);
  for (let yy = Math.min(y, w.sy - 1); yy >= 0; yy--) if (c.ground[w.get(x, yy, z)]) return yy;
  return -1;
}

/** Axis-aligned world bounds of a placement's footprint. */
export function footprintBounds(plan, ox, oz, rot) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [lx, lz] of [[0, 0], [plan.W - 1, 0], [0, plan.D - 1], [plan.W - 1, plan.D - 1]]) {
    const [dx, dz] = rotXZ(lx - plan.ax, lz - plan.az, rot);
    x0 = Math.min(x0, ox + dx); x1 = Math.max(x1, ox + dx);
    z0 = Math.min(z0, oz + dz); z1 = Math.max(z1, oz + dz);
  }
  return { x0, x1, z0, z1 };
}

/** Turn that makes the prefab's front face the point (px, pz) from anchor (x, z). */
export function faceToward(x, z, px, pz) {
  const dx = px - (x + 0.5), dz = pz - (z + 0.5);
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 0 : 2;
}

/** Base height (the ground layer) for an anchor column, rising through water to its surface. */
export function baseHeight(game, x, z, fromY) {
  const w = game.world, c = classify(game);
  let base = groundBelow(game, x, fromY, z);
  if (base < 0) base = Math.max(1, w.heightAt(x, z));
  while (base + 1 < w.sy && c.liquid[w.get(x, base + 1, z)]) base++;
  return base;
}

/**
 * Placement for a prefab at world column (x, z) looked up from height fromY, turned `rot`.
 * Keeps the footprint (and its terrace ring) inside the world. Returns
 * { ox, oy, oz, rot, bounds } (ox/oz = anchor cell, oy = ground layer).
 */
export function placementAt(game, plan, x, z, fromY, rot) {
  const w = game.world;
  rot &= 3;
  let b = footprintBounds(plan, x, z, rot);
  let sx = 0, sz = 0;
  if (b.x0 < EDGE) sx = EDGE - b.x0;
  else if (b.x1 > w.sx - 1 - EDGE) sx = w.sx - 1 - EDGE - b.x1;
  if (b.z0 < EDGE) sz = EDGE - b.z0;
  else if (b.z1 > w.sz - 1 - EDGE) sz = w.sz - 1 - EDGE - b.z1;
  const ox = x + sx, oz = z + sz;
  if (sx || sz) b = footprintBounds(plan, ox, oz, rot);
  let oy = baseHeight(game, ox, oz, sx || sz ? Math.max(fromY, w.heightAt(ox, oz)) : fromY);
  oy = Math.max(1, Math.min(oy, w.sy - plan.H - 1));
  return { ox, oy, oz, rot, bounds: b };
}

/** Placement from a pick result (Build-tool target) with the front toward the player. */
export function placementFromHit(game, plan, hit, turn = 0) {
  if (!hit || !hit.place || !game.world) return null;
  const c = classify(game);
  let [x, y, z] = hit.place;
  let fromY = y;
  if (hit.type === 'block') {
    const top = hit.face && hit.face[1] === 1;
    const soft = game.registry.blocks.props.replaceable[hit.id] || c.plant[hit.id];
    if (top || soft) {
      x = hit.x; z = hit.z; fromY = hit.y;
    }
  }
  const p = game.player ? game.player.position : game.camera.position;
  const rot = (faceToward(x, z, p.x, p.z) + turn) & 3;
  let pl = placementAt(game, plan, x, z, fromY, rot);
  // never drop a house on top of her (a turned house can reach back over her): slide it
  // away along the way she is looking until she stands outside its footprint
  const yaw = game.cameraRig ? game.cameraRig.yaw : 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const [dx, dz] = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz) || 1];
  const covers = (b) => p.x > b.x0 - 1.2 && p.x < b.x1 + 2.2 && p.z > b.z0 - 1.2 && p.z < b.z1 + 2.2;
  for (let i = 0; i < 48 && covers(pl.bounds); i++) {
    x += dx;
    z += dz;
    const next = placementAt(game, plan, x, z, fromY, rot);
    if (next.ox === pl.ox && next.oz === pl.oz) break; // pinned against the world edge
    pl = next;
  }
  return pl;
}

/**
 * Furniture data for one placement. String values starting with '@' are ids that must be
 * unique per built copy (e.g. the rope bridge id `b` shared by every segment of one bridge):
 * they get the placement's anchor and turn in front, so two copies of a build never share one.
 */
export function placedData(data, pl) {
  if (!data) return data;
  let out = null;
  for (const k in data) {
    const v = data[k];
    if (typeof v !== 'string' || v[0] !== '@') continue;
    if (!out) out = { ...data };
    out[k] = `pf:${pl.ox},${pl.oy},${pl.oz},${pl.rot}${v}`;
  }
  return out || data;
}

/** Prefab-local (lx, ly, lz) -> world [x, y, z] for a placement. */
export function toWorld(plan, pl, lx, ly, lz) {
  const [dx, dz] = rotXZ(lx - plan.ax, lz - plan.az, pl.rot);
  return [pl.ox + dx, pl.oy + ly, pl.oz + dz];
}

/**
 * Every change the placement makes. Returns { idx: Int32Array, next: Uint8Array,
 * map: Map(idx -> id), entities: [entity], furniture: [{ key, x, y, z, rot, color, data }],
 * bounds, entry: [x, z] (a spot in front of the door) }.
 */
export function computeDiff(game, plan, pl) {
  const w = game.world;
  const c = classify(game);
  const { sx, sy, sz } = w;
  const map = new Map();
  const blocks = w.blocks;
  const cur = (i) => (map.has(i) ? map.get(i) : blocks[i]);
  const put = (x, y, z, id) => {
    if (x < 0 || z < 0 || y < 0 || x >= sx || z >= sz || y >= sy) return;
    const i = (y * sz + z) * sx + x;
    if (!map.has(i) && blocks[i] === id) return;
    map.set(i, id);
  };
  const clearAll = plan.opts.clear !== 'none';
  const level = plan.opts.level !== false;
  const { W, H, D, ids } = plan;
  const oy = pl.oy;
  const seeds = []; // removed tree logs: [x, y, z]

  // per column: the terrain's own surface block and the block under it
  const surfOf = new Map();
  const tally = new Map();
  const columnGround = (x, z) => {
    const k = z * sx + x;
    let r = surfOf.get(k);
    if (r) return r;
    let top = 0, under = 0;
    for (let y = Math.min(sy - 1, oy + H + 8); y >= 1; y--) {
      const id = blocks[(y * sz + z) * sx + x];
      if (!id || c.leaves[id] || c.plant[id] || c.tree[id] || c.liquid[id]) continue;
      if (c.natural[id]) {
        top = id;
        for (let yy = y - 1; yy >= Math.max(1, y - 3); yy--) {
          const u = blocks[(yy * sz + z) * sx + x];
          if (c.natural[u] && !c.surface[u]) { under = u; break; }
        }
      }
      break;
    }
    r = { top, under };
    surfOf.set(k, r);
    if (c.surface[top]) tally.set(top, (tally.get(top) || 0) + 1);
    return r;
  };
  for (let lz = 0; lz < D; lz++) for (let lx = 0; lx < W; lx++) {
    const [x, , z] = toWorld(plan, pl, lx, 0, lz);
    if (x >= 0 && z >= 0 && x < sx && z < sz) columnGround(x, z);
  }
  let common = c.grass, best = 0;
  for (const [id, n] of tally) if (n > best) { best = n; common = id; }
  const surfaceFor = (x, z) => {
    const g = surfOf.get(z * sx + x);
    return g && c.surface[g.top] ? g.top : common;
  };
  const underFor = (x, z) => {
    const g = surfOf.get(z * sx + x);
    if (g && g.under) return g.under;
    const s = surfaceFor(x, z);
    return s === c.sand && c.sand > 0 ? c.sand : c.dirt;
  };

  // ---- the footprint: clear, build, level ----
  for (let lz = 0; lz < D; lz++) {
    for (let lx = 0; lx < W; lx++) {
      const [x, , z] = toWorld(plan, pl, lx, 0, lz);
      if (x < 0 || z < 0 || x >= sx || z >= sz) continue;
      let solidAt0 = false;
      for (let y = oy; y < sy; y++) {
        const ly = y - oy;
        const i = (y * sz + z) * sx + x;
        const was = blocks[i];
        let id;
        if (ly < H) {
          const p = ids[(ly * D + lz) * W + lx];
          if (p >= 0) id = p;
          else if (ly === 0) id = level ? surfaceFor(x, z) : -1;
          else id = clearAll ? 0 : -1;
        } else if (clearAll) {
          id = c.leaves[was] && ly > H ? -1 : 0; // high canopies of trees nearby may stay
        } else {
          id = -1;
        }
        if (id < 0) continue;
        if (ly === 0 && id > 0 && !c.plant[id] && !c.liquid[id]) solidAt0 = true;
        if (id === 0 && c.tree[was] && !c.leaves[was]) seeds.push([x, y, z]);
        put(x, y, z, id);
      }
      // foundation: fill the gap under the ground layer down to solid ground
      if (level || solidAt0) {
        for (let y = oy - 1; y >= 1; y--) {
          const was = cur((y * sz + z) * sx + x);
          if (c.ground[was]) break;
          if (c.tree[was] && !c.leaves[was]) seeds.push([x, y, z]);
          put(x, y, z, oy - y <= 3 ? underFor(x, z) : c.stone);
        }
      }
    }
  }

  const b = pl.bounds;
  // ---- a gentle terrace ring so the house does not sit in a pit or on a cliff ----
  if (level) {
    for (let x = b.x0 - RING; x <= b.x1 + RING; x++) {
      for (let z = b.z0 - RING; z <= b.z1 + RING; z++) {
        if (x < 1 || z < 1 || x >= sx - 1 || z >= sz - 1) continue;
        const d = Math.max(b.x0 - x, x - b.x1, b.z0 - z, z - b.z1);
        if (d < 1) continue;
        // natural ground top of this column (skip canopies, sprites, trunks; stop at builds)
        let top = -1, blocked = false;
        for (let y = sy - 1; y >= 1; y--) {
          const id = cur((y * sz + z) * sx + x);
          if (!id || c.leaves[id] || c.plant[id] || c.tree[id]) continue;
          if (c.natural[id]) top = y;
          else blocked = true;
          break;
        }
        if (blocked || top < 0) continue;
        const g = columnGround(x, z);
        const surf = c.surface[g.top] ? g.top : common;
        const cutTo = oy + d - 1, fillTo = oy - d;
        if (top > cutTo) {
          // what stood on the old top (flowers, trunks) goes too
          for (let y = top + 1; y < sy; y++) {
            const id = cur((y * sz + z) * sx + x);
            if (c.plant[id]) put(x, y, z, 0);
            else if (c.tree[id] && !c.leaves[id]) { seeds.push([x, y, z]); put(x, y, z, 0); } else break;
          }
          for (let y = top; y > cutTo; y--) {
            const id = cur((y * sz + z) * sx + x);
            if (c.tree[id] && !c.leaves[id]) seeds.push([x, y, z]);
            put(x, y, z, 0);
          }
          const at = cur((cutTo * sz + z) * sx + x);
          if (c.natural[at] && !c.surface[at]) put(x, cutTo, z, surf);
        } else if (top < fillTo) {
          for (let y = top + 1; y <= fillTo; y++) {
            const id = cur((y * sz + z) * sx + x);
            if (id !== 0 && !c.plant[id]) break; // water, trunks, builds: leave them
            put(x, y, z, y === fillTo ? surf : g.under || underFor(x, z));
          }
          if (c.surface[g.top]) put(x, top, z, g.under || c.dirt);
        }
      }
    }
  }

  // ---- trees whose trunks were cut: take the whole tree (log-to-log, leaves near it) ----
  if (seeds.length) {
    const visited = new Set();
    const cols = [];
    for (const [x, , z] of seeds) if (!cols.some((q) => q[0] === x && q[1] === z)) cols.push([x, z]);
    const minY = Math.min(...seeds.map((s) => s[1])) - 1;
    const nearTrunk = (x, z) => cols.some(([cx, cz]) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) <= 3);
    const queue = seeds.map((s) => [s[0], s[1], s[2], 1]);
    for (const s of seeds) visited.add((s[1] * sz + s[2]) * sx + s[0]);
    let n = 0;
    while (queue.length && n < TREE_LIMIT) {
      const [x, y, z, fromLog] = queue.pop();
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nz < 0 || ny < minY || nx >= sx || nz >= sz || ny >= sy) continue;
        const i = (ny * sz + nz) * sx + nx;
        if (visited.has(i)) continue;
        const id = blocks[i];
        const leaf = c.leaves[id] === 1;
        const log = c.tree[id] === 1 && !leaf;
        if (!(leaf && nearTrunk(nx, nz)) && !(log && fromLog)) continue;
        visited.add(i);
        if (map.has(i) && map.get(i) !== 0) continue;
        put(nx, ny, nz, 0);
        queue.push([nx, ny, nz, log ? 1 : 0]);
        n++;
      }
    }
  }

  // ---- entities in the way ----
  const entities = [];
  if (game.entities) {
    for (const e of game.entities.all()) {
      let hit = false;
      for (const [cx, cy, cz] of e.cells) {
        const inFoot = cx >= b.x0 && cx <= b.x1 && cz >= b.z0 && cz <= b.z1;
        if (inFoot && clearAll && cy >= oy - 1) { hit = true; break; }
        if (cx < 0 || cz < 0 || cy < 0 || cx >= sx || cz >= sz || cy >= sy) continue;
        const i = (cy * sz + cz) * sx + cx;
        if (map.has(i)) { hit = true; break; }
        if (cy > 0 && map.get(i - sx * sz) === 0) { hit = true; break; }
      }
      if (hit) entities.push(e);
    }
  }

  // ---- furniture in world coordinates ----
  const furniture = [];
  for (const f of plan.furniture) {
    let { x, z } = f;
    if (f.back && f.def) {
      const d = Math.max(1, f.def.size[2] | 0);
      const [fx, fz] = frontVec(f.rot);
      x += fx * (d - 1);
      z += fz * (d - 1);
    }
    const [wx, wy, wz] = toWorld(plan, pl, x, f.y, z);
    furniture.push({ key: f.key, x: wx, y: wy, z: wz, rot: (f.rot + pl.rot) & 3, color: f.color, data: placedData(f.data, pl) });
  }

  const n = map.size;
  const idx = new Int32Array(n), next = new Uint8Array(n);
  let k = 0;
  for (const [i, id] of map) { idx[k] = i; next[k] = id; k++; }
  const [ex, , ez] = toWorld(plan, pl, plan.ax, 0, plan.D + 1);
  return { idx, next, map, entities, furniture, bounds: b, entry: [ex, ez], oy };
}

/**
 * Undo / Redo while playing with friends: write ids[k] only where the cell still holds
 * expect[k] (someone may have built there since); one batch. Returns how many were written.
 */
export function writeCellsCas(world, idx, ids, expect) {
  const { sx, sz } = world;
  const layer = sx * sz;
  let n = 0;
  world.batch(() => {
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      if (world.blocks[i] !== expect[k]) continue;
      const y = Math.floor(i / layer);
      const r = i - y * layer;
      const z = Math.floor(r / sx);
      if (world.set(r - z * sx, y, z, ids[k], { record: false })) n++;
    }
  });
  return n;
}

/** Write ids into the world as one batch (one relight). Returns the previous ids. */
export function writeCells(world, idx, ids) {
  const prev = new Uint8Array(idx.length);
  const { sx, sz } = world;
  const layer = sx * sz;
  world.batch(() => {
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      prev[k] = world.blocks[i];
      const y = Math.floor(i / layer);
      const r = i - y * layer;
      const z = Math.floor(r / sx);
      world.set(r - z * sx, y, z, ids[k], { record: false });
    }
  });
  return prev;
}
