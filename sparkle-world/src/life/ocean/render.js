// The sea animals' instanced meshes (docs/teams/ocean.md §4.2): one THREE.InstancedMesh per
// kind (at most 9 draw calls), slots compacted every frame (live records in slots 0..n-1),
// tints rewritten only when a slot's owner or the record's tintVer changed. Nothing is
// allocated per frame.
//
// Glass (material.js): each kind has a second mesh for its animals seen through a see-through
// block (r.behind, index.js _glassTick), drawn in SEA_BEHIND order. Only the animals behind the
// glass go there, so one fish behind an ice floe never turns the whole school faint. It costs
// a draw call only while a kind has animals on both sides of the glass (hidden at count 0), and
// never past SEA_CALLS in all (glassLanes): when calls are short, kinds with nothing in view are
// not drawn, the spare calls go to the split kinds with the most animals in front, and only a kind
// left without one (every kind in view) draws all its animals on one side for that while: the
// side most of them are on (never a 10th call).

import * as THREE from 'three';
import { SEA_KINDS, SEA_SPEC, PALETTES, hexToLinear } from './kinds.js';
import { geometryFor } from './models.js';
import { seaMaterial, SEA_ORDER, SEA_BEHIND, SEA_WATER } from './material.js';
import { SURF } from './motion.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _rgb = [0, 0, 0];
const WATER = hexToLinear(SEA_WATER);

/** Sea life never adds more than this many draw calls (docs/teams/ocean.md §4.2; probe C1). */
export const SEA_CALLS = 9;

const _cand = {}, _score = {}, _prev = {};

/**
 * Which lane each kind draws in this frame, within SEA_CALLS. live[kind]: its drawn animals;
 * back[kind]: how many of them are seen through glass. out[kind]: null (each animal in its own
 * lane: the front mesh, or the glass mesh if r.behind), true (all in the glass mesh) or false (all
 * in the front mesh); out keeps last frame's lanes (read for steadiness). Every kind with animals
 * costs one call; a kind split by the glass costs a second one.
 * When calls are short:
 *  - seen[kind] (its animals in view) and hide: a kind with nothing in view is not drawn at all
 *    (hide[kind] = true, no call), so a whale far off or crabs behind her never cost a school its lane;
 *  - the spare calls go to the split kinds with the most animals in front of the glass
 *    (front[kind], in view), a kind that had its lane last frame first among near equals (+2), so a
 *    school by an ice floe comes before two far-off dolphins and the choice does not flip;
 *  - a split kind left without one (every kind in view: a whale visit) draws all its animals on
 *    the side most of its animals in view are on: in front when at least 3 times as many are in
 *    front as behind the glass (1.5 times once it is there, so it does not flip), else behind the
 *    glass. So a school with one fish behind an ice floe stays bright (that one fish drawn over
 *    the ice) instead of turning faint. Without front / seen (no camera): behind the glass.
 * Pure, no allocations.
 */
export function glassLanes(live, back, out, budget = SEA_CALLS, front = null, seen = null, hide = null) {
  let used = 0, want = 0;
  for (const kind of SEA_KINDS) {
    if (hide) hide[kind] = false;
    const n = live[kind] || 0, b = back[kind] || 0;
    if (n > 0) used++;
    if (n > 0 && b > 0 && b < n) want++;
  }
  if (seen && hide && used + want > budget) {
    for (const kind of SEA_KINDS) {
      const n = live[kind] || 0, b = back[kind] || 0;
      if (n > 0 && !(seen[kind] > 0)) { hide[kind] = true; used--; if (b > 0 && b < n) want--; }
    }
  }
  let spare = budget - used;
  for (const kind of SEA_KINDS) {
    const n = live[kind] || 0, b = back[kind] || 0;
    const had = out[kind] === null;
    _prev[kind] = out[kind];
    _cand[kind] = false;
    if (n <= 0 || b <= 0 || (hide && hide[kind])) out[kind] = false;
    else if (b >= n) out[kind] = true;
    else {
      out[kind] = true;
      _cand[kind] = true;
      _score[kind] = (front ? front[kind] || 0 : n - b) + (had ? 2 : 0);
    }
  }
  for (let g = 0; g < SEA_KINDS.length && spare > 0; g++) {
    let best = null;
    for (const kind of SEA_KINDS) if (_cand[kind] && (best === null || _score[kind] > _score[best])) best = kind;
    if (best === null) break;
    out[best] = null;
    _cand[best] = false;
    spare--;
  }
  // no call left for these: the side most of its animals in view are on
  if (front && seen) {
    for (const kind of SEA_KINDS) {
      if (!_cand[kind]) continue;
      const f = front[kind] || 0, bk = Math.max(0, (seen[kind] || 0) - f);
      out[kind] = !(f >= (_prev[kind] === false ? 1.5 : 3) * Math.max(1, bk));
    }
  }
  return out;
}

export class SeaMeshes {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'sea-life';
    scene.add(this.group);
    this.k = {};
    for (const kind of SEA_KINDS) {
      const front = this._lane(kind, SEA_ORDER, 'sea-' + kind);
      const back = this._lane(kind, SEA_BEHIND, 'sea-' + kind + '-glass');
      // the front lane's fields stay on K itself (slotTint, slotSurf, counts read them)
      this.k[kind] = Object.assign(front, { back });
    }
  }

  /** One instanced mesh of a kind with its own instance buffers (the baked attributes shared). */
  _lane(kind, order, name) {
    const cap = SEA_SPEC[kind].cap;
    const base = geometryFor(kind);
    const geo = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'color', 'aSea', 'aPivot']) geo.setAttribute(a, base.attributes[a]);
    geo.setIndex(base.index);
    geo.boundingSphere = base.boundingSphere;
    geo.boundingBox = base.boundingBox;
    const iSwim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iAcc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iSwim', iSwim);
    geo.setAttribute('iTint', iTint);
    geo.setAttribute('iAcc', iAcc);
    // (surface y, liquid rgb): -1e4 = dry, drawn as on land
    const surf = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) surf[i * 4] = -1e4;
    const iSurf = new THREE.InstancedBufferAttribute(surf, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iSurf', iSurf);
    const mesh = new THREE.InstancedMesh(geo, seaMaterial(SEA_SPEC[kind].mode), cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order; // the front lane after the water, the glass lane before it (material.js)
    mesh.userData.envWarm = true;
    mesh.name = name;
    this.group.add(mesh);
    return { mesh, geo, iSwim, iTint, iAcc, iSurf, owner: new Int16Array(cap).fill(-1), ver: new Int32Array(cap).fill(-1), n: 0, tints: false };
  }

  /**
   * Write the live records of a kind (lists: arrays of records) into the instance buffers.
   * liquid(r) -> the linear rgb of the liquid r swims in (default: water). behind: null (each
   * record's own r.behind picks its mesh) or true / false for all of them. An animal seen through
   * glass (material.js) draws in the kind's glass mesh, before the see-through chunks, untinted.
   */
  write(kind, lists, liquid = null, behind = null) {
    const K = this.k[kind], B = K.back;
    const cap = SEA_SPEC[kind].cap;
    K.n = 0; K.tints = false;
    B.n = 0; B.tints = false;
    for (let l = 0; l < lists.length; l++) {
      const list = lists[l];
      for (let i = 0; i < list.length && K.n + B.n < cap; i++) {
        const r = list[i];
        if (!r.on || r.hidden) continue;
        const glass = behind === null ? !!r.behind : !!behind;
        this._slot(kind, glass ? B : K, r, l, liquid, glass);
      }
    }
    this._finish(K);
    this._finish(B);
    return K.n + B.n;
  }

  /** Write record r into the next slot of lane L. */
  _slot(kind, L, r, l, liquid, glass) {
    const n = L.n;
    const M = L.mesh.instanceMatrix.array, S = L.iSwim.array, T = L.iTint.array, A = L.iAcc.array, U = L.iSurf.array;
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
    S[n * 4 + 3] = r.shade;
    const wet = !r.dry && !glass;
    const lq = wet && liquid ? liquid(r) : WATER;
    U[n * 4] = wet ? r.level + SURF : -1e4;
    U[n * 4 + 1] = lq[0]; U[n * 4 + 2] = lq[1]; U[n * 4 + 3] = lq[2];
    const id = (r.uid != null ? r.uid : r.i + l * 1000);
    const ver = r.tintVer * 4 + (r.saddle ? 2 : 0);
    // glowDirty is cleared by whichever lane writes the record (one lane a frame)
    if (L.owner[n] !== id || L.ver[n] !== ver || r.glowDirty) {
      const p = PALETTES[kind][r.variant] || PALETTES[kind][0];
      hexToLinear(p[1], _rgb);
      T[n * 4] = _rgb[0]; T[n * 4 + 1] = _rgb[1]; T[n * 4 + 2] = _rgb[2]; T[n * 4 + 3] = r.glow || 0;
      hexToLinear(p[2], _rgb);
      A[n * 4] = _rgb[0]; A[n * 4 + 1] = _rgb[1]; A[n * 4 + 2] = _rgb[2]; A[n * 4 + 3] = r.saddle ? 1 : 0;
      L.owner[n] = id;
      L.ver[n] = ver;
      r.glowDirty = false;
      L.tints = true;
    }
    L.n = n + 1;
  }

  /** Upload a lane's written slots and free the rest. */
  _finish(L) {
    const n = L.n, cap = L.owner.length;
    L.mesh.count = n;
    L.mesh.visible = n > 0;
    if (n > 0) {
      L.mesh.instanceMatrix.clearUpdateRanges();
      L.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      L.mesh.instanceMatrix.needsUpdate = true;
      L.iSwim.clearUpdateRanges();
      L.iSwim.addUpdateRange(0, n * 4);
      L.iSwim.needsUpdate = true;
      L.iSurf.clearUpdateRanges();
      L.iSurf.addUpdateRange(0, n * 4);
      L.iSurf.needsUpdate = true;
      if (L.tints) {
        L.iTint.clearUpdateRanges();
        L.iTint.addUpdateRange(0, n * 4);
        L.iTint.needsUpdate = true;
        L.iAcc.clearUpdateRanges();
        L.iAcc.addUpdateRange(0, n * 4);
        L.iAcc.needsUpdate = true;
      }
    }
    // slots past n are free: forget their owner so a reused slot always rewrites its tint
    for (let i = n; i < cap && L.owner[i] !== -1; i++) { L.owner[i] = -1; L.ver[i] = -1; }
  }

  hideAll() {
    for (const kind of SEA_KINDS) {
      for (const L of [this.k[kind], this.k[kind].back]) {
        L.mesh.count = 0;
        L.mesh.visible = false;
        L.n = 0;
        L.owner.fill(-1);
        L.ver.fill(-1);
      }
    }
  }

  /** Draw nothing of a kind this frame (glassLanes hide: none of it in view); its slots stay written. */
  hideKind(kind) {
    this.k[kind].mesh.visible = false;
    this.k[kind].back.mesh.visible = false;
  }

  /** Tint of slot i of a kind (for the S2-style probe check): [r, g, b, glow]. */
  slotTint(kind, i) {
    const T = this.k[kind].iTint.array;
    return [T[i * 4], T[i * 4 + 1], T[i * 4 + 2], T[i * 4 + 3]];
  }

  /** Slot i's (surface y, liquid r, g, b) of a kind (the probe's candy-pond check). */
  slotSurf(kind, i) {
    const U = this.k[kind].iSurf.array;
    return [U[i * 4], U[i * 4 + 1], U[i * 4 + 2], U[i * 4 + 3]];
  }

  /** Live instances per kind in the front mesh (glass: true, in the glass mesh). */
  counts(glass = false) {
    const out = {};
    for (const kind of SEA_KINDS) out[kind] = glass ? this.k[kind].back.n : this.k[kind].n;
    return out;
  }
}
