// Axis-separated AABB collision against solid voxels and entity colliders (game.colliders),
// with automatic step-up onto slabs/carpets and ledge detection for kid-friendly auto-jump.

import { SHAPES } from '../core/registry.js';

const EPS = 0.001;
const STEP_HEIGHT = 0.55;
const LEDGE_HEIGHT = 1.05;

export class Physics {
  /**
   * @param {import('./world.js').World} world
   * @param {Set<import('three').Box3>} colliders world-space boxes from furniture etc.
   */
  constructor(world, colliders) {
    this.world = world;
    this.colliders = colliders;
    this._hit = { top: 0, bottom: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0, any: false };
  }

  /** Height of a voxel's collision box (0 = not solid). */
  solidHeight(id) {
    const p = this.world.registry.props;
    if (!p.solid[id]) return 0;
    const s = p.shape[id];
    return s === SHAPES.slab ? 0.5 : s === SHAPES.carpet ? 1 / 16 : 1;
  }

  /**
   * Collect everything overlapping the box into this._hit (extreme faces of the overlapping
   * solids). Returns true if anything overlaps.
   */
  overlap(minX, minY, minZ, maxX, maxY, maxZ) {
    const h = this._hit;
    h.any = false;
    h.top = -Infinity; h.bottom = Infinity;
    h.minX = Infinity; h.maxX = -Infinity; h.minZ = Infinity; h.maxZ = -Infinity;
    const w = this.world;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX - 1e-9);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY - 1e-9);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - 1e-9);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const bh = this.solidHeight(w.get(x, y, z));
          if (bh <= 0 || y + bh <= minY) continue;
          h.any = true;
          if (y + bh > h.top) h.top = y + bh;
          if (y < h.bottom) h.bottom = y;
          if (x < h.minX) h.minX = x;
          if (x + 1 > h.maxX) h.maxX = x + 1;
          if (z < h.minZ) h.minZ = z;
          if (z + 1 > h.maxZ) h.maxZ = z + 1;
        }
      }
    }
    if (this.colliders) {
      for (const b of this.colliders) {
        if (b.max.x <= minX || b.min.x >= maxX || b.max.y <= minY || b.min.y >= maxY || b.max.z <= minZ || b.min.z >= maxZ) continue;
        h.any = true;
        if (b.max.y > h.top) h.top = b.max.y;
        if (b.min.y < h.bottom) h.bottom = b.min.y;
        if (b.min.x < h.minX) h.minX = b.min.x;
        if (b.max.x > h.maxX) h.maxX = b.max.x;
        if (b.min.z < h.minZ) h.minZ = b.min.z;
        if (b.max.z > h.maxZ) h.maxZ = b.max.z;
      }
    }
    return h.any;
  }

  /** True if a body box at feet position (x, y, z) would overlap something solid. */
  bodyBlocked(x, y, z, halfW, height) {
    return this.overlap(x - halfW, y, z - halfW, x + halfW, y + height, z + halfW);
  }

  /** Is the voxel at these (float) coords a liquid? */
  liquidAt(x, y, z) {
    const id = this.world.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return this.world.registry.props.shape[id] === SHAPES.liquid;
  }

  /**
   * Move a body { pos: Vector3 (feet centre), vel: Vector3, halfW, height } by vel*dt.
   * Returns a result object (reused): { onGround, hitWall, ledge, hitCeiling } where ledge is
   * the top y of a climbable 1-block obstacle we walked into (or null).
   */
  move(body, dt, { step = true } = {}) {
    const res = this._res || (this._res = { onGround: false, hitWall: false, ledge: null, hitCeiling: false });
    res.onGround = false; res.hitWall = false; res.ledge = null; res.hitCeiling = false;
    const p = body.pos, v = body.vel;
    const hw = body.halfW, ht = body.height;
    const w = this.world;
    // sub-steps keep fast falls from tunnelling through thin floors
    const dist = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.35));
    const sdt = dt / steps;
    const wasOnGround = !!body.onGround;
    for (let s = 0; s < steps; s++) {
      // Y
      const dy = v.y * sdt;
      if (dy !== 0) {
        p.y += dy;
        if (this.overlap(p.x - hw, p.y, p.z - hw, p.x + hw, p.y + ht, p.z + hw)) {
          if (dy < 0) {
            p.y = this._hit.top + EPS;
            res.onGround = true;
          } else {
            p.y = this._hit.bottom - ht - EPS;
            res.hitCeiling = true;
          }
          v.y = 0;
        }
      }
      // X then Z
      for (let axis = 0; axis < 2; axis++) {
        const d = (axis === 0 ? v.x : v.z) * sdt;
        if (d === 0) continue;
        if (axis === 0) p.x += d; else p.z += d;
        if (!this.overlap(p.x - hw, p.y, p.z - hw, p.x + hw, p.y + ht, p.z + hw)) continue;
        const top = this._hit.top;
        const rise = top - p.y;
        const grounded = wasOnGround || res.onGround;
        // small obstacle (slab, carpet, bed edge): just step up onto it
        if (step && grounded && rise > 0 && rise <= STEP_HEIGHT && !this.bodyBlocked(p.x, top + EPS, p.z, hw, ht)) {
          p.y = top + EPS;
          continue;
        }
        if (grounded && rise > 0 && rise <= LEDGE_HEIGHT && !this.bodyBlocked(p.x, top + EPS, p.z, hw, ht)) {
          res.ledge = top;
        }
        const h = this._hit;
        if (axis === 0) {
          p.x = d > 0 ? h.minX - hw - EPS : h.maxX + hw + EPS;
          v.x = 0;
        } else {
          p.z = d > 0 ? h.minZ - hw - EPS : h.maxZ + hw + EPS;
          v.z = 0;
        }
        res.hitWall = true;
      }
    }
    // resting contact check (standing still on ground)
    if (!res.onGround && v.y <= 0) {
      res.onGround = this.overlap(p.x - hw, p.y - 0.02, p.z - hw, p.x + hw, p.y, p.z + hw);
    }
    // invisible wall at the world edge
    const m = hw + 0.02;
    if (p.x < m) { p.x = m; v.x = 0; }
    if (p.z < m) { p.z = m; v.z = 0; }
    if (p.x > w.sx - m) { p.x = w.sx - m; v.x = 0; }
    if (p.z > w.sz - m) { p.z = w.sz - m; v.z = 0; }
    body.onGround = res.onGround;
    return res;
  }
}
