// STUB — owned by the TERRAIN agent. Pure, deterministic lunar surface functions shared by
// physics (collision, altitude), guidance (radar altitude), terrain rendering (main thread and
// workers) and rocks. NO three.js scene access, NO DOM: must run inside a Web Worker.
//
// Contract (see ARCHITECTURE.md §Terrain):
//   terrainHeight(x, y, z)       -> metres above MOON.radius at unit direction (x,y,z)
//   surfaceRadius(x, y, z)       -> MOON.radius + terrainHeight
//   surfaceNormal(x, y, z, out)  -> writes the unit surface normal (MCI) into out {x,y,z}; returns out
//   albedo(x, y, z)              -> base normal albedo 0..1 (maria ~0.07, highlands ~0.16)
import { MOON } from '../core/constants.js';

export function terrainHeight(x, y, z) {
  return 0;
}

export function surfaceRadius(x, y, z) {
  return MOON.radius + terrainHeight(x, y, z);
}

export function surfaceNormal(x, y, z, out = { x: 0, y: 0, z: 0 }) {
  const l = Math.hypot(x, y, z) || 1;
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
  return out;
}

export function albedo(x, y, z) {
  return 0.1;
}
