// Where a vehicle parks (docs/teams/vehicles.md §5.6): from a live pose (footprint centre and
// yaw) back to a furniture anchor and a quarter turn, searching outward in fixed, bounded
// rings. Pure logic over a small context, so Node tests can run it:
//   ctx = { canPlace(def, x, y, z, rot) -> bool, liquid(x, y, z) -> bool, solid(x, y, z) -> bool }
// (cells; index.js wires them to game.entities.canPlace and the block props).
//
// Bounds: rings 0..3 (49 columns) x 4 turns x 3 heights = at most 588 canPlace calls; the
// extended search (never for a button press) adds rings 4..8 (at most 3,468 more). Only run at
// Get out, auto-park and saves (cached), never every frame.

import { rotXZ } from '../entities.js';

const RINGS = 3;
const RINGS_EXTENDED = 8;

const fin = Number.isFinite;

/** The quarter turn closest to a yaw (rot r has rotation.y = r * PI / 2). */
export function rotFromYaw(yaw) {
  if (!fin(yaw)) return 0;
  return ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
}

/**
 * Footprint centre (cx, cz) -> anchor cell [ax, az] for size [w, h, d] at rot: the inverse of
 * entities.localToWorld(entity, w / 2, 0, d / 2).
 */
export function anchorFromCenter(size, cx, cz, rot) {
  const w = Math.max(1, size[0] | 0), d = Math.max(1, size[2] | 0);
  const ai = Math.floor((w - 1) / 2);
  const [ox, oz] = rotXZ(w / 2 - ai - 0.5, 0.5 - d / 2, rot);
  return [Math.round(cx - 0.5 - ox), Math.round(cz - 0.5 - oz)];
}

/** Anchor -> footprint centre [cx, cz] (entities.localToWorld at w/2, d/2). */
export function centerFromAnchor(size, ax, az, rot) {
  const w = Math.max(1, size[0] | 0), d = Math.max(1, size[2] | 0);
  const ai = Math.floor((w - 1) / 2);
  const [ox, oz] = rotXZ(w / 2 - ai - 0.5, 0.5 - d / 2, rot);
  return [ax + 0.5 + ox, az + 0.5 + oz];
}

/** The bottom-row cells of a footprint (y = the anchor's y). */
export function bottomCells(size, ax, ay, az, rot) {
  const w = Math.max(1, size[0] | 0), d = Math.max(1, size[2] | 0);
  const ai = Math.floor((w - 1) / 2);
  const out = [];
  for (let i = 0; i < w; i++) {
    for (let k = 0; k < d; k++) {
      const [ox, oz] = rotXZ(i - ai, k - (d - 1), rot);
      out.push([ax + ox, ay, az + oz]);
    }
  }
  return out;
}

/** Land: no bottom cell is a liquid, and at least half stand on something solid. */
export function isLandSpot(ctx, size, ax, ay, az, rot) {
  const cells = bottomCells(size, ax, ay, az, rot);
  let held = 0;
  for (const [x, y, z] of cells) {
    if (ctx.liquid(x, y, z)) return false;
    if (ctx.solid(x, y - 1, z)) held++;
  }
  return held * 2 >= cells.length;
}

/** Water: every bottom cell is a liquid with no liquid above it (the top water layer). */
export function isWaterSpot(ctx, size, ax, ay, az, rot) {
  for (const [x, y, z] of bottomCells(size, ax, ay, az, rot)) {
    if (!ctx.liquid(x, y, z) || ctx.liquid(x, y + 1, z)) return false;
  }
  return true;
}

/**
 * The nearest place to park def from pose { x, y, z, yaw } (pivot: footprint centre at wheel
 * level; boats: y = the water cell). opts.extended: search rings 4..8 too. Returns
 * { x, y, z, rot, checks } or null; result.checks / findParkSpot.lastChecks count canPlace calls.
 */
export function findParkSpot(ctx, def, pose, opts = {}) {
  const size = def.size;
  const water = !!(def.vehicle && def.vehicle.water);
  let checks = 0;
  findParkSpot.lastChecks = 0;
  if (!pose || !fin(pose.x) || !fin(pose.y) || !fin(pose.z)) return null;
  const rot0 = rotFromYaw(pose.yaw);
  const rots = [rot0, (rot0 + 1) & 3, (rot0 + 3) & 3, (rot0 + 2) & 3];
  const baseY = water ? Math.floor(pose.y) : Math.floor(pose.y + 0.02);
  const dys = water ? [0] : [0, 1, -1];
  const anchors = rots.map((r) => anchorFromCenter(size, pose.x, pose.z, r));
  const max = opts.extended ? RINGS_EXTENDED : RINGS;
  for (let r = 0; r <= max; r++) {
    for (let ri = 0; ri < 4; ri++) {
      const rot = rots[ri];
      const [ax0, az0] = anchors[ri];
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const dy of dys) {
            const ax = ax0 + dx, ay = baseY + dy, az = az0 + dz;
            checks++;
            if (!ctx.canPlace(def, ax, ay, az, rot)) continue;
            const ok = water ? isWaterSpot(ctx, size, ax, ay, az, rot) : isLandSpot(ctx, size, ax, ay, az, rot);
            if (ok) {
              findParkSpot.lastChecks = checks;
              return { x: ax, y: ay, z: az, rot, checks };
            }
          }
        }
      }
    }
  }
  findParkSpot.lastChecks = checks;
  return null;
}
findParkSpot.lastChecks = 0;
