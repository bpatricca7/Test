// Stowage lockers & equipment bays of the Command Module (CSM-CABIN agent).
//
//   LHEB  left-hand equipment bay beside the CDR's couch (food, waste management, lithium
//         hydroxide canisters)
//   RHEB  right-hand equipment bay beside the LMP (ECS / water panels & stowage)
//   aft   lockers against the +Y side above the crew's heads (aft of the side hatch)
//   LEB   locker wall at the crew's feet (the aft part of the Lower Equipment Bay)
// Doors are painted into a locker atlas (stencilled locker number, typed contents placard, Velcro,
// scuffs) and carry raised latch handles; each bay is a closed box so it casts proper shadows.
import * as THREE from 'three';
import { Frame, lebFrames, innerRadius } from './layout.js';
import { V, Batch, roundBox, onFrame, cylBetween } from './geom.js';
import { remapUV } from './textures.js';

/**
 * Add a locker door (and its latches) to a batch on a frame at local (u, v).
 * @param {Batch} B
 * @param {object} atlas locker atlas (textures.createLockerAtlas)
 * @param {Frame} F
 * @param {object} d { u, v, w, h, label, content, latches: 'top'|'side'|'both', velcro }
 */
export function lockerDoor(B, atlas, F, d) {
  const cell = atlas.alloc({ label: d.label, content: d.content, velcro: d.velcro, seed: d.seed, color: d.color });
  const g = remapUV(roundBox(d.w - 0.006, d.h - 0.006, 0.014, 0.008, 0.003), cell);
  B.add('locker', onFrame(g, F, d.u, d.v, 0.007));
  // latches: small raised bar handles with a pivot boss
  const lat = d.latches || 'top';
  const handle = (u, v, rot) => {
    const m = new THREE.Matrix4().makeRotationZ(rot);
    B.add('alu', onFrame(roundBox(0.036, 0.009, 0.006, 0.003).applyMatrix4(m), F, u, v, 0.017));
    B.add('black', onFrame(new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 12).rotateX(Math.PI / 2), F, u + (rot ? 0 : -0.014), v + (rot ? -0.014 : 0), 0.016));
  };
  if (lat === 'top' || lat === 'both') handle(d.u, d.v + d.h / 2 - 0.022, 0);
  if (lat === 'side' || lat === 'both') handle(d.u + d.w / 2 - 0.022, d.v, Math.PI / 2);
  // hinge knuckles on the opposite edge
  for (const k of [-0.3, 0.3]) {
    const hu = lat === 'side' ? d.u - d.w / 2 + 0.006 : d.u + k * d.w;
    const hv = lat === 'side' ? d.v + k * d.h : d.v - d.h / 2 + 0.006;
    B.add('alu', onFrame(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 8).rotateZ(lat === 'side' ? 0 : Math.PI / 2), F, hu, hv, 0.012));
  }
}

/** Closed bay box behind a frame: face at n=0 back to n=-depth, painted structure. */
function bayBox(B, F, w, h, depth) {
  B.add('structure', onFrame(new THREE.BoxGeometry(w, h, depth), F, 0, 0, -depth / 2));
  // face frame (raised rim) around the doors
  const r = 0.012;
  for (const [u, v, bw, bh] of [[0, h / 2 - r / 2, w, r], [0, -h / 2 + r / 2, w, r], [-w / 2 + r / 2, 0, r, h], [w / 2 - r / 2, 0, r, h]]) {
    B.add('structure', onFrame(new THREE.BoxGeometry(bw, bh, 0.012), F, u, v, 0.006));
  }
}

/**
 * Build all stowage bays.
 * @param {(key: string) => THREE.Material} mat
 * @param {object} atlas locker atlas
 * @returns {{group: THREE.Group, frames: object}}
 */
export function buildStowage(mat, atlas) {
  const B = new Batch('CSMCabin:stowage');
  const frames = {};

  // ---- LHEB (left, beside the CDR couch) and RHEB (right)
  for (const side of [-1, 1]) {
    const x = side * 1.4;
    const F = Frame.facing(V(x, 0.02, -0.3), V(side * 0.2, 0.1, -0.4), V(0, 1, 0), 0.34, 0.68);
    frames[side < 0 ? 'LHEB' : 'RHEB'] = F;
    bayBox(B, F, F.w, F.h, 0.3);
    const doors = side < 0
      ? [
        { u: 0, v: 0.235, w: 0.32, h: 0.2, label: 'L1', content: 'FOOD\nDAYS 1-3', latches: 'top', velcro: 1 },
        { u: 0, v: 0.025, w: 0.32, h: 0.2, label: 'L2', content: 'FOOD\nDAYS 4-6', latches: 'top' },
        { u: 0, v: -0.185, w: 0.32, h: 0.2, label: 'L3', content: 'LiOH\nCANISTERS', latches: 'both', velcro: 2 },
      ]
      : [
        { u: 0, v: 0.235, w: 0.32, h: 0.2, label: 'R1', content: 'WASTE\nMGMT', latches: 'top', velcro: 1 },
        { u: 0, v: 0.025, w: 0.32, h: 0.2, label: 'R2', content: 'PERSONAL\nHYGIENE', latches: 'top' },
        { u: 0, v: -0.185, w: 0.32, h: 0.2, label: 'R3', content: 'MEDICAL\nKIT', latches: 'both', velcro: 2 },
      ];
    for (const d of doors) lockerDoor(B, atlas, F, { ...d, seed: d.label.charCodeAt(1) * 13 });
  }

  // ---- aft +Y lockers (above the crew's heads, aft of the side hatch)
  {
    const F = new Frame(V(0, 1.36, -0.27), V(-1, 0, 0), V(0, 0, -1), 1.02, 0.3);
    frames.aftUp = F; // faces -Y (toward the couches)
    bayBox(B, F, F.w, F.h, 0.22);
    const labels = [['A1', 'CAMERA\nMAGAZINES'], ['A2', 'FLIGHT\nDATA FILE'], ['A3', 'SLEEP\nRESTRAINTS'], ['A4', 'CONSTANT\nWEAR GARMENT']];
    labels.forEach(([label, content], i) => lockerDoor(B, atlas, F, { u: -0.375 + i * 0.25, v: 0, w: 0.245, h: 0.27, label, content, latches: 'side', velcro: i % 2 ? 1 : 0, seed: 40 + i }));
  }

  // ---- LEB aft locker wall (faces +Y)
  {
    const { LK } = lebFrames();
    frames.LK = LK;
    bayBox(B, LK, LK.w, LK.h, 0.18);
    const labels = [['B1', 'ORDEAL'], ['B2', 'LIOH\nSTOWAGE'], ['B3', 'SURVIVAL\nKIT'], ['B4', 'FLIGHT\nPLAN'], ['B5', 'EVA\nEQUIPMENT'], ['B6', 'UTILITY\nTOWELS']];
    labels.forEach(([label, content], i) => {
      const c = i % 3;
      const r = Math.floor(i / 3);
      lockerDoor(B, atlas, LK, { u: -0.39 + c * 0.39, v: 0.115 - r * 0.235, w: 0.38, h: 0.225, label, content, latches: 'top', velcro: (i * 7) % 3, seed: 70 + i });
    });
  }

  // ---- closeout panels between the bays and the pressure vessel (wedges that close the gaps)
  for (const side of [-1, 1]) {
    // below the side consoles down to the LEB locker wall
    const a = V(side * 0.62, -1.24, -0.12);
    const b = V(side * 1.32, -0.62, -0.12);
    const c = V(side * 1.2, -0.58, -0.62);
    const d = V(side * 0.62, -1.24, -0.62);
    B.add('wall', quad(a, b, c, d, V(-side * 0.6, 0.8, 0)));
  }
  // cable trays (Beta-cloth wrapped harness bundles) along the cone wall
  for (const side of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const z = -0.15 - k * 0.19;
      const r = innerRadius(z) - 0.035;
      const th = side * (1.95 - k * 0.02);
      pts.push(V(Math.sin(th) * r, Math.cos(th) * r, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    B.add('betaShade', new THREE.TubeGeometry(curve, 48, 0.028, 8, false));
  }
  // tie-down rings on the aft bulkhead
  for (const x of [-0.9, -0.3, 0.3, 0.9]) B.add('alu', new THREE.TorusGeometry(0.018, 0.004, 6, 14).translate(x, -0.85, -0.05));
  void cylBetween;
  return { group: B.build(mat), frames };
}

/** Planar quad a-b-c-d facing `want`, with planar UVs (metres). */
function quad(a, b, c, d, want) {
  const g = new THREE.BufferGeometry();
  const n = V().crossVectors(V().subVectors(b, a), V().subVectors(d, a));
  const pts = n.dot(want) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x + p.z, p.y]), 2));
  g.computeVertexNormals();
  return g;
}

export { quad, bayBox };
