// The sea animals' instanced meshes (docs/teams/ocean.md §4.2): one THREE.InstancedMesh per
// kind (at most 9 draw calls), slots compacted every frame (live records in slots 0..n-1),
// tints rewritten only when a slot's owner or the record's tintVer changed. Nothing is
// allocated per frame.

import * as THREE from 'three';
import { SEA_KINDS, SEA_SPEC, PALETTES, hexToLinear } from './kinds.js';
import { geometryFor } from './models.js';
import { seaMaterial } from './material.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _rgb = [0, 0, 0];

export class SeaMeshes {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'sea-life';
    scene.add(this.group);
    this.k = {};
    for (const kind of SEA_KINDS) {
      const cap = SEA_SPEC[kind].cap;
      // the mesh's own geometry shares the baked attributes; only the instance data is its own
      const base = geometryFor(kind);
      const geo = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'color', 'aSea', 'aPivot']) geo.setAttribute(name, base.attributes[name]);
      geo.setIndex(base.index);
      geo.boundingSphere = base.boundingSphere;
      geo.boundingBox = base.boundingBox;
      const iSwim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const iTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const iAcc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iSwim', iSwim);
      geo.setAttribute('iTint', iTint);
      geo.setAttribute('iAcc', iAcc);
      const mesh = new THREE.InstancedMesh(geo, seaMaterial(SEA_SPEC[kind].mode), cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.userData.envWarm = true;
      mesh.name = 'sea-' + kind;
      this.group.add(mesh);
      this.k[kind] = { mesh, geo, iSwim, iTint, iAcc, owner: new Int16Array(cap).fill(-1), ver: new Int32Array(cap).fill(-1), n: 0 };
    }
  }

  /**
   * Write the live records of a kind (list: an array of records; extra: optional second list)
   * into the instance buffers. visible(r) -> false skips a record.
   */
  write(kind, lists, near = null) {
    const K = this.k[kind];
    const cap = SEA_SPEC[kind].cap;
    const pal = PALETTES[kind];
    const M = K.mesh.instanceMatrix.array, S = K.iSwim.array, T = K.iTint.array, A = K.iAcc.array;
    let n = 0, tints = false;
    for (let l = 0; l < lists.length; l++) {
      const list = lists[l];
      for (let i = 0; i < list.length && n < cap; i++) {
        const r = list[i];
        if (!r.on || r.hidden) continue;
        const f = r.fade < 1 ? 0.35 + 0.65 * Math.max(0, r.fade) : 1;
        _p.set(r.x, r.y, r.z);
        _e.set(r.pitch, r.yaw, r.roll, 'YXZ');
        _q.setFromEuler(_e);
        const sc = r.scale * f;
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        _m.toArray(M, n * 16);
        S[n * 4] = r.phase;
        S[n * 4 + 1] = r.amp;
        S[n * 4 + 2] = r.extra;
        S[n * 4 + 3] = near ? near(r) : r.shade;
        const id = (r.uid != null ? r.uid : r.i + l * 1000);
        const ver = r.tintVer * 4 + (r.saddle ? 2 : 0);
        if (K.owner[n] !== id || K.ver[n] !== ver || r.glowDirty) {
          const p = pal[r.variant] || pal[0];
          hexToLinear(p[1], _rgb);
          T[n * 4] = _rgb[0]; T[n * 4 + 1] = _rgb[1]; T[n * 4 + 2] = _rgb[2]; T[n * 4 + 3] = r.glow || 0;
          hexToLinear(p[2], _rgb);
          A[n * 4] = _rgb[0]; A[n * 4 + 1] = _rgb[1]; A[n * 4 + 2] = _rgb[2]; A[n * 4 + 3] = r.saddle ? 1 : 0;
          K.owner[n] = id;
          K.ver[n] = ver;
          r.glowDirty = false;
          tints = true;
        }
        n++;
      }
    }
    K.mesh.count = n;
    K.mesh.visible = n > 0;
    K.n = n;
    if (n > 0) {
      K.mesh.instanceMatrix.clearUpdateRanges();
      K.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      K.mesh.instanceMatrix.needsUpdate = true;
      K.iSwim.clearUpdateRanges();
      K.iSwim.addUpdateRange(0, n * 4);
      K.iSwim.needsUpdate = true;
      if (tints) {
        K.iTint.clearUpdateRanges();
        K.iTint.addUpdateRange(0, n * 4);
        K.iTint.needsUpdate = true;
        K.iAcc.clearUpdateRanges();
        K.iAcc.addUpdateRange(0, n * 4);
        K.iAcc.needsUpdate = true;
      }
    }
    // slots past n are free: forget their owner so a reused slot always rewrites its tint
    for (let i = n; i < cap && K.owner[i] !== -1; i++) { K.owner[i] = -1; K.ver[i] = -1; }
    return n;
  }

  hideAll() {
    for (const kind of SEA_KINDS) {
      const K = this.k[kind];
      K.mesh.count = 0;
      K.mesh.visible = false;
      K.n = 0;
      K.owner.fill(-1);
      K.ver.fill(-1);
    }
  }

  /** Tint of slot i of a kind (for the S2-style probe check): [r, g, b, glow]. */
  slotTint(kind, i) {
    const T = this.k[kind].iTint.array;
    return [T[i * 4], T[i * 4 + 1], T[i * 4 + 2], T[i * 4 + 3]];
  }

  counts() {
    const out = {};
    for (const kind of SEA_KINDS) out[kind] = this.k[kind].n;
    return out;
  }
}
