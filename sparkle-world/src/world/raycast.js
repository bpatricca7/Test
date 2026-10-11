// Voxel ray casting (Amanatides & Woo DDA). Non-cube shapes (flowers, slabs, carpets) are
// tested against their real box inside the cell so you can aim past a thin carpet edge.

import { SHAPES } from '../core/registry.js';

// in-cell boxes for thin shapes: [minx, miny, minz, maxx, maxy, maxz]
const SHAPE_BOX = {
  [SHAPES.cross]: [0.15, 0, 0.15, 0.85, 0.9, 0.85],
  [SHAPES.slab]: [0, 0, 0, 1, 0.5, 1],
  [SHAPES.carpet]: [0, 0, 0, 1, 1 / 16, 1],
};

const _n = [0, 0, 0];

export function shapeBox(shape) {
  return SHAPE_BOX[shape] || null;
}

/**
 * Ray vs axis-aligned box (slab test, no allocations). Returns entry distance (>= 0) or -1,
 * and writes the entry face normal into outNormal (array of 3) when given.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, outNormal) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    const mn = a === 0 ? minX : a === 1 ? minY : minZ;
    const mx = a === 0 ? maxX : a === 1 ? maxY : maxZ;
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return -1;
      continue;
    }
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    let s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  if (outNormal) {
    outNormal[0] = outNormal[1] = outNormal[2] = 0;
    if (axis >= 0) outNormal[axis] = sign;
  }
  return Math.max(0, tmin);
}

/** A reusable hit object for raycastVoxels(..., out) in per-frame code. */
export function makeVoxelHit() {
  return { x: 0, y: 0, z: 0, id: 0, face: [0, 0, 0], distance: 0, point: [0, 0, 0] };
}

function writeHit(out, x, y, z, id, nx, ny, nz, t, ox, oy, oz, dx, dy, dz) {
  const h = out || makeVoxelHit();
  h.x = x; h.y = y; h.z = z; h.id = id;
  h.face[0] = nx; h.face[1] = ny; h.face[2] = nz;
  h.distance = t;
  h.point[0] = ox + dx * t; h.point[1] = oy + dy * t; h.point[2] = oz + dz * t;
  return h;
}

/**
 * Cast a ray through the voxel grid. Returns a hit object or null:
 * { x, y, z, id, face: [nx,ny,nz], distance, point: [px,py,pz] }.
 * `accept(id)` decides which voxels stop the ray (default: selectable blocks).
 * `out` (from makeVoxelHit) is filled and returned instead of allocating a new hit.
 */
export function raycastVoxels(world, ox, oy, oz, dx, dy, dz, maxDist, accept = null, out = null) {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  const props = world.registry.props;
  const selectable = props.selectable;
  const shapeOf = props.shape;

  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let t = 0;
  let fx = 0, fy = 0, fz = 0; // normal of the face we entered through
  const n = _n;
  let first = true;

  while (t <= maxDist) {
    // below the floor, or above the world and still climbing: nothing more to hit
    // (a ray starting high above the world, e.g. from a flying camera, keeps descending)
    if (y < 0 || (y >= world.sy && stepY > 0)) break;
    if (!first) {
      const id = world.get(x, y, z);
      if (id !== 0 && (accept ? accept(id) : selectable[id])) {
        const box = SHAPE_BOX[shapeOf[id]];
        if (!box) return writeHit(out, x, y, z, id, fx, fy, fz, t, ox, oy, oz, dx, dy, dz);
        const bt = rayBox(ox, oy, oz, dx, dy, dz,
          x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5], n);
        if (bt >= 0 && bt <= maxDist) return writeHit(out, x, y, z, id, n[0], n[1], n[2], bt, ox, oy, oz, dx, dy, dz);
      }
    }
    first = false;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; fx = -stepX; fy = 0; fz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; fx = 0; fy = -stepY; fz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; fx = 0; fy = 0; fz = -stepZ;
    }
  }
  return null;
}
