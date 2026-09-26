// Reaction-control jets: for every jet with level > 0 a vapour cone (instanced ray-marched volume)
// plus sunlit vapour puffs streaming away (GPU particles in the vessel body frame).
//
// What the Apollo footage shows for a 100-lbf hypergolic thruster in vacuum: every pulse starts with
// a brief yellow-white flash (the fuel-rich start transient), then a faint, translucent, fast-expanding
// cone of vapour that is gone ~0.1-0.2 s after the valve closes, within a metre or two. The vapour
// never forms clumps that hang around: puffs expand several-fold during their ~0.1-s life and thin out
// as they do (radiance ~ size0/size). Short DAP pulses (14 ms) still read as a distinct flash. Jets are drawn in the FX layer, so they are visible through the cockpit
// windows as well as from outside.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { createPlumeMaterial, plumeGeometry } from './plume.js';
import { ParticlePool } from './particles.js';

// fallPow > 1: the column brightness falls with distance (bright at the exit, gone within ~1.5 m)
const JET = { re: 0.07, tan: 0.55, len: 1.7, k: 2.0, fallPow: 1.5, inten: 0.075 };

/**
 * RCS effects for one vessel (16 jets).
 * @param {object} ctx RenderContext
 * @param {object} vessel game vessel (its rcs.jets table is read every frame)
 * @returns {{group: THREE.Group, pool: ParticlePool, update(frame, v, t, dt, gain): void,
 *   rebind(vessel): boolean, dispose(): void}}
 */
export function createRcsEffects(ctx, vessel) {
  let jets = vessel.rcs.jets;
  const n = jets.length;
  const group = new THREE.Group();
  group.name = `rcs-${vessel.id}`;

  // ---- instanced vapour cones
  const mat = createPlumeMaterial({ steps: ctx.quality === 'low' ? 8 : 12, instanced: true });
  const u = mat.uniforms;
  u.uRe.value = JET.re;
  u.uTan.value = JET.tan;
  u.uLen.value = JET.len;
  u.uLb.value = JET.len * 1.3;
  u.uRb.value = JET.re + JET.len * 1.3 * JET.tan * 1.6;
  u.uK.value = JET.k;
  u.uFallPow.value = JET.fallPow;
  u.uIntensity.value = JET.inten;
  u.uCoreHot.value = 0.35;
  u.uCoreColor.value.setRGB(1.0, 0.86, 0.62);
  u.uBodyColor.value.setRGB(0.85, 0.86, 0.9);
  u.uFlashColor.value.setRGB(4.2, 3.2, 2.0); // the onset flash stays the dominant cue
  const geo = plumeGeometry(16);
  const aJet = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  aJet.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aJet', aJet);
  const cones = new THREE.InstancedMesh(geo, mat, n);
  cones.frustumCulled = false;
  cones.layers.set(ctx.LAYERS.FX);
  cones.renderOrder = 21;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  function placeJets() {
    for (let i = 0; i < n; i++) {
      q.setFromUnitVectors(Y, jets[i].exhaustDir);
      m.compose(jets[i].pos, q, one);
      cones.setMatrixAt(i, m);
      aJet.array[i * 4 + 2] = Math.random();
    }
    cones.instanceMatrix.needsUpdate = true;
  }
  placeJets();
  group.add(cones);

  // ---- vapour puffs (body frame)
  const pool = new ParticlePool(ctx, { capacity: ctx.quality === 'low' ? 900 : 2400, style: 'puff', additive: true, fadeIn: 0.05, thin: 1, name: `rcs-vapour-${vessel.id}` });
  group.add(pool.mesh);

  const vis = new Float32Array(n);
  const flash = new Float32Array(n);
  const lastOn = new Float64Array(n).fill(NaN);
  const accum = new Float32Array(n);
  const tmpP = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();

  function emitPuff(j, speed, spread, size0, size1, life, bright, flashy) {
    const d = j.exhaustDir;
    t1.set(d.y, d.z, d.x).cross(d).normalize();
    t2.crossVectors(d, t1);
    const a = Math.random() * Math.PI * 2;
    const s = spread * Math.sqrt(Math.random());
    tmpV.copy(d).addScaledVector(t1, Math.cos(a) * s).addScaledVector(t2, Math.sin(a) * s).normalize().multiplyScalar(speed * (0.7 + 0.6 * Math.random()));
    tmpP.copy(j.pos).addScaledVector(d, 0.05);
    const c = flashy ? [1.0 * bright, 0.85 * bright, 0.6 * bright] : [0.85 * bright, 0.87 * bright, 0.9 * bright];
    pool.emit(tmpP, tmpV, life * (0.7 + 0.6 * Math.random()), size0, size1, c[0], c[1], c[2], 1, Math.random(), 0, 0);
  }

  return {
    group,
    pool,
    /**
     * Re-attach to a new jet table (a scenario reload recreates the vessels). Same layout -> the GPU
     * objects are kept; returns false when the table differs in size (caller rebuilds).
     */
    rebind(v) {
      const nj = v.rcs.jets;
      if (!nj || nj.length !== n) return false;
      jets = nj;
      placeJets();
      vis.fill(0);
      flash.fill(0);
      lastOn.fill(NaN);
      accum.fill(0);
      for (let i = 0; i < n; i++) aJet.array[i * 4] = aJet.array[i * 4 + 1] = 0;
      aJet.needsUpdate = true;
      pool.clear();
      return true;
    },
    dispose() {
      group.removeFromParent();
      cones.geometry.dispose();
      mat.dispose();
      cones.dispose();
      pool.dispose();
    },
    /**
     * @param {object} frame
     * @param {object} v vessel
     * @param {number} t fx clock
     * @param {number} dt fx step (0 when paused)
     * @param {number} [gain] exposure-dependent brightness gain (see effects.js)
     */
    update(frame, v, t, dt, gain = 1) {
      if (v.rcs.jets !== jets) return; // table replaced (should not happen)
      let any = false;
      for (let i = 0; i < n; i++) {
        const j = jets[i];
        // a jet fired this frame if its level is up, or (when physics provides it) its cumulative
        // on-time advanced — catches 14-ms pulses that start and end between two frames
        let fired = j.level > 0;
        let lvl = j.level;
        if (typeof j.onTime === 'number') {
          if (!Number.isNaN(lastOn[i]) && j.onTime > lastOn[i] + 1e-6) {
            fired = true;
            lvl = Math.max(lvl, Math.min(1, (j.onTime - lastOn[i]) / Math.max(dt, 1e-3)));
          }
          lastOn[i] = j.onTime;
        }
        if (fired && vis[i] < 0.15 && dt > 0) {
          flash[i] = 1;
          // start transient: a brief burst of warm, fuel-rich vapour that balloons and thins at once
          for (let k = 0; k < 10; k++) emitPuff(j, 22, 0.8, 0.08, 1.3, 0.1, 0.07, true);
        }
        const target = fired ? Math.max(0.55, lvl) : 0;
        const tau = target > vis[i] ? 0.015 : 0.07;
        if (dt > 0) vis[i] += (target - vis[i]) * (1 - Math.exp(-dt / tau));
        if (dt > 0) flash[i] *= Math.exp(-dt / 0.06);
        if (fired && dt > 0) {
          accum[i] += dt * (ctx.quality === 'low' ? 160 : 340) * Math.max(0.4, lvl);
          while (accum[i] >= 1) {
            accum[i] -= 1;
            emitPuff(j, 32, 0.55, 0.05, 0.9, 0.12, 0.016, false);
          }
        }
        aJet.array[i * 4] = vis[i] * 1.1;
        aJet.array[i * 4 + 1] = flash[i];
        if (vis[i] > 1e-3 || flash[i] > 1e-3) any = true;
      }
      aJet.needsUpdate = true;
      cones.visible = any;
      u.uTime.value = t;
      u.uIntensity.value = JET.inten * gain;
      pool.uniforms.uIntensity.value = gain;
      pool.update(t);
    },
  };
}
