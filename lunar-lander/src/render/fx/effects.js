// Effects: engine plumes (DPS/APS/SPS), RCS jets, descent-engine dust, touchdown puff, liftoff debris.
// Contract (ARCHITECTURE.md §6): createEffects(ctx) -> { update(frame) }
//
// All effects live on LAYERS.FX (main camera only, visible through cockpit windows) and are positioned
// with the floating origin every frame. Engine and RCS effects are children of a per-vessel group that
// follows the vessel (position = vessel.pos - origin, quaternion = vessel.quat), so they are built in
// the vessel body frame straight from the data in core/constants.js (nozzle exits, jet table).
// The effects clock advances with SIMULATED time (frozen while paused, capped per frame under warp).
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { createEnginePlume } from './plume.js';
import { createRcsEffects } from './rcs.js';
import { createSurfaceEffects } from './dust.js';
import { MOON } from '../../core/constants.js';
import { terrainHeight } from '../../world/moon.js';

/**
 * Create all effects and add them to ctx.scene.
 * @param {object} ctx RenderContext
 * @returns {{update(frame): void, vessels: object, surface: object}}
 */
export function createEffects(ctx) {
  const root = new THREE.Group();
  root.name = 'fx';
  ctx.scene.add(root);

  const perVessel = {};
  for (const id of ['LM', 'CSM']) {
    const v = ctx.game.vessels[id];
    const group = new THREE.Group();
    group.name = `fx-${id}`;
    const plume = createEnginePlume(ctx);
    group.add(plume.object);
    let rcs = createRcsEffects(ctx, v);
    group.add(rcs.group);
    root.add(group);
    perVessel[id] = { group, plume, rcs, jets: v.rcs.jets };
  }
  const surface = createSurfaceEffects(ctx);
  root.add(surface.group);

  let t = 0;
  const nozzle = new THREE.Vector3();
  const exh = new THREE.Vector3();
  const up = new THREE.Vector3();

  /** Distance from a vessel's nozzle exit to the ground along its exhaust (Infinity when far/upward). */
  function groundDistance(v) {
    const e = v.mainEngine;
    if (!e || !(v.tel?.altitude < 200)) return Infinity;
    nozzle.copy(e.nozzleExit).applyQuaternion(v.quat).add(v.pos);
    up.copy(nozzle).normalize();
    exh.copy(e.thrustLine || e.thrustDir).negate().applyQuaternion(v.quat);
    const down = -exh.dot(up);
    if (down < 0.2) return Infinity;
    const h = nozzle.length() - (MOON.radius + terrainHeight(up.x, up.y, up.z));
    return Math.max(0.2, h) / down;
  }

  return {
    vessels: perVessel,
    surface,
    update(frame) {
      const dt = Math.min(frame.simDt || 0, 0.1);
      t += dt;
      // Self-luminous effects are partly exposure-compensated (HDR radiance ~ E^-0.5): a vacuum plume
      // stays a faint glow over a sunlit landscape instead of vanishing, without blooming in the dark.
      const ex = ctx.exposureInfo;
      const gain = ex && ex.valid ? THREE.MathUtils.clamp(Math.pow(ex.multiplier, -0.5), 0.12, 3) : 0.5;
      for (const id of ['LM', 'CSM']) {
        const v = frame.vessels[id];
        const pv = perVessel[id];
        if (v.rcs.jets !== pv.jets) {
          // jet table replaced (a scenario reload recreated the vessel): re-attach the RCS effects to it
          // (same layout -> keep the GPU objects), or rebuild them, disposing the old ones
          if (!pv.rcs.rebind(v)) {
            pv.rcs.dispose();
            pv.rcs = createRcsEffects(ctx, v);
            pv.group.add(pv.rcs.group);
          }
          pv.jets = v.rcs.jets;
        }
        pv.group.position.copy(v.pos).sub(frame.origin);
        pv.group.quaternion.copy(v.quat);
        pv.group.updateMatrixWorld(true);
        pv.plume.update(frame, v, t, dt, id === 'LM' ? groundDistance(v) : Infinity, gain);
        pv.rcs.update(frame, v, t, dt, gain);
      }
      surface.update(frame, t, dt, gain);
    },
  };
}
