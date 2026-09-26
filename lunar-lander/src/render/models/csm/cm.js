// Apollo Block II Command Module "Columbia" — exterior geometry.
//
// Outer mould line from core/constants.js (CSM.cm): aft heat shield (spherical cap, brown Avcoat rim
// visible between the CM and the SM), 33-degree conical crew-compartment heat shield and rounded
// forward heat shield covered in aluminized Mylar tape (see texgen.js), the docking tunnel with the
// docking ring and its 12 capture latches, the five windows (CSM.windows) as recessed panes — the two
// forward-looking rendezvous windows sit in deep scoops — the side hatch (outline in the foil
// texture), CM RCS ports (texture), the CM/SM umbilical and the EVA handholds by the hatch.
//
// The docking probe is built separately (buildProbe) because it stays visible in IVA views
// (userData.ivaVisible) and retracts when hard-docked.

import * as THREE from 'three';
import { CSM } from '../../../core/constants.js';
import { CM_FOIL_PROFILE, coneRadius, vec } from './profile.js';
import { lathe, frameAt, roundBox, tube, ribbon, wall, fan, box, sphere } from './geom.js';

const D2R = Math.PI / 180;
const cm = CSM.cm;
const cosC = Math.cos(cm.coneHalfAngle);
const sinC = Math.sin(cm.coneHalfAngle);

/**
 * Local frame on the conical heat shield at azimuth az (rad) and station z: X = tangent (increasing
 * azimuth), Y = outward surface normal, Z = along the slant toward the base (aft).
 */
export function coneFrame(az, z, lift = 0) {
  const s = Math.sin(az);
  const c = Math.cos(az);
  const R = new THREE.Vector3(s, c, 0);
  const T = new THREE.Vector3(c, -s, 0);
  const N = R.clone().multiplyScalar(cosC).add(new THREE.Vector3(0, 0, -sinC));
  const A = new THREE.Vector3().crossVectors(T, N); // aft along the slant
  const r = coneRadius(z);
  const P = new THREE.Vector3(r * s, r * c, z).addScaledVector(N, lift);
  return new THREE.Matrix4().makeBasis(T, N, A).setPosition(P);
}

/**
 * Build the Command Module into `B` (PartBuilder).
 * @param {import('./geom.js').PartBuilder} B
 * @param {Array<object>} pockets window pockets from profile.windowPocket()
 */
export function buildCM(B, pockets) {
  // ---- foil skin (UV = atlas)
  B.add('foil', lathe(CM_FOIL_PROFILE, { segments: 192, v: 'frac', u: 'frac' }));

  // ---- aft heat shield: spherical cap (bulging aft) with the toroidal rim, bare Avcoat
  {
    const h = cm.heatShieldBulge;
    const a = cm.baseRadius;
    const Rc = (a * a + h * h) / (2 * h);
    const zc = h - Rc;
    const prof = [];
    for (let i = 0; i <= 10; i++) {
      const r = (1.8 * i) / 10;
      prof.push([r, zc + Math.sqrt(Rc * Rc - r * r)]);
    }
    prof.push([1.86, 0.040], [1.905, 0.031], [1.935, 0.018], [1.951, 0.002], [1.955, -0.01], [CM_FOIL_PROFILE[0][0], CM_FOIL_PROFILE[0][1]]);
    B.add('ablator', lathe(prof, { segments: 128, crease: 60 }));
  }

  // ---- docking tunnel and docking ring
  {
    const zA = cm.apexZ; // -2.95 ring face (the docking interface plane)
    const tunnel = [
      [0.445, cm.shoulderZ],
      [0.445, -2.84],
      [0.492, -2.846],
      [0.494, -2.852],
      [0.494, zA + 0.022],
      [0.482, zA + 0.004],
      [0.470, zA],
      [0.412, zA],
      [0.405, zA + 0.008],
      [0.405, -2.80],
    ];
    B.add('ring', lathe(tunnel, { segments: 96, crease: 40 }));
    // tunnel bore (seen through the probe) and the forward hatch closing it
    B.add('darkMetal', lathe([[0.405, -2.80], [0.405, -2.62]], { segments: 48 }));
    B.add('darkMetal', lathe([[0.405, -2.62], [0.0, -2.62]], { segments: 48 }));
    // 12 automatic docking latches on the outside of the ring (behind the interface plane)
    for (let k = 0; k < 12; k++) {
      const az = (k / 12) * Math.PI * 2 + (15 * D2R);
      const m = frameAt(az, 0.494, -2.9);
      B.add('metal', roundBox([0, 0.016, 0], [0.05, 0.032, 0.085], 0.008, m));
      B.add('darkMetal', box([0, 0.036, -0.012], [0.024, 0.012, 0.03], m));
    }
    // ring / tunnel bolts
    for (let k = 0; k < 36; k++) {
      const az = (k / 36) * Math.PI * 2;
      B.add('darkMetal', sphere([Math.sin(az) * 0.44, Math.cos(az) * 0.44, zA - 0.002], 0.006, 5, 3));
    }
  }

  // ---- windows
  for (const P of pockets) {
    const n = P.normal;
    // glass pane
    B.add('glass', fan(P.glassRim, n, P.right, P.up));
    // frame between glass and pocket wall (in the glass plane)
    B.add('windowFrame', ribbon(P.frameRim, P.glassRim, n));
    // pocket wall from the frame to the foil
    B.add('ablatorDark', wall(P.frameRim, P.lipRim, { inward: true, centre: vec.add(P.center, vec.mul(n, 0.05)) }));
  }

  // ---- CM / SM umbilical (on -Y, bridging the CM rim to the SM fairing)
  {
    const az = Math.PI;
    const m = coneFrame(az, -0.2);
    B.add('metal', roundBox([0, 0.022, 0.0], [0.26, 0.05, 0.36], 0.02, m));
    B.add('darkMetal', box([0, 0.05, 0.02], [0.18, 0.012, 0.22], m));
    // cable bundle crossing the gap
    const p0 = new THREE.Vector3(0, -(coneRadius(-0.03) + 0.03), -0.03);
    const p1 = new THREE.Vector3(0, -(cm.baseRadius + 0.035), 0.12);
    B.add('darkMetal', tube(p0, p1, 0.035, 0.035, 10, true));
  }

  // ---- EVA handholds beside the side hatch (+Y)
  for (const side of [-1, 1]) {
    const az = side * 23 * D2R;
    const m1 = coneFrame(az, -0.78, 0);
    const m2 = coneFrame(az, -1.32, 0);
    const a = new THREE.Vector3(0, 0.05, 0).applyMatrix4(m1);
    const b = new THREE.Vector3(0, 0.05, 0).applyMatrix4(m2);
    B.add('gold', tube(a, b, 0.011, 0.011, 8, true));
    for (const [mm, pp] of [[m1, a], [m2, b]]) {
      const base = new THREE.Vector3(0, 0.0, 0).applyMatrix4(mm);
      B.add('gold', tube(base, pp, 0.009, 0.009, 8, false));
      B.add('darkMetal', roundBox([0, 0.004, 0], [0.04, 0.008, 0.05], 0.003, mm));
    }
  }
}

/**
 * Docking probe (extended). Returns the static part (body, pitch arms, attenuators) and the moving
 * part (piston + capture-latch head) built into two separate builders.
 * @param {import('./geom.js').PartBuilder} Bs static probe parts
 * @param {import('./geom.js').PartBuilder} Bm moving probe parts (retract along +Z when docked)
 */
export function buildProbe(Bs, Bm) {
  const tipZ = CSM.docking.probeTip.z; // -3.55
  // probe cylinder (mounted in the tunnel)
  Bs.add('probe', lathe([[0.0, -2.64], [0.07, -2.64], [0.085, -2.66], [0.085, -2.99], [0.07, -3.02], [0.046, -3.025]], { segments: 32, crease: 40 }));
  Bs.add('darkMetal', lathe([[0.1, -2.86], [0.1, -2.9]], { segments: 32 }));
  Bs.add('darkMetal', lathe([[0.085, -2.86], [0.1, -2.86]], { segments: 32 }));
  Bs.add('darkMetal', lathe([[0.1, -2.9], [0.085, -2.9]], { segments: 32 }));
  // three pitch arms from the probe cylinder to the docking ring, with shock attenuators
  for (let k = 0; k < 3; k++) {
    const az = (30 + k * 120) * D2R;
    const s = Math.sin(az);
    const c = Math.cos(az);
    const inner = new THREE.Vector3(0.08 * s, 0.08 * c, -2.985);
    const outer = new THREE.Vector3(0.385 * s, 0.385 * c, -2.915);
    Bs.add('probe', tube(inner, outer, 0.017, 0.013, 8, true));
    // pad bearing on the ring
    Bs.add('darkMetal', sphere([outer.x, outer.y, outer.z], 0.022, 8, 6));
    // attenuator (parallel strut, aft of the arm)
    const i2 = new THREE.Vector3(0.086 * s, 0.086 * c, -2.72);
    const o2 = new THREE.Vector3(0.33 * s, 0.33 * c, -2.9);
    Bs.add('darkMetal', tube(i2, o2, 0.02, 0.02, 8, true));
    Bs.add('probe', tube(i2.clone().lerp(o2, 0.55), o2, 0.012, 0.012, 8, false));
    // tension link to the ring face
    const l0 = new THREE.Vector3(0.39 * s, 0.39 * c, -2.9);
    Bs.add('metal', tube(l0, new THREE.Vector3(0.405 * s, 0.405 * c, -2.82), 0.01, 0.01, 6, true));
  }
  // ---- moving part: piston and capture-latch head (probe tip at CSM.docking.probeTip)
  Bm.add('metal', lathe([[0.042, -2.96], [0.042, tipZ + 0.11]], { segments: 24 }));
  Bm.add('probe', lathe([
    [0.042, tipZ + 0.11],
    [0.058, tipZ + 0.095],
    [0.062, tipZ + 0.075],
    [0.062, tipZ + 0.045],
    [0.052, tipZ + 0.022],
    [0.032, tipZ + 0.007],
    [0.0, tipZ],
  ], { segments: 32, crease: 50 }));
  // three capture latches on the head
  for (let k = 0; k < 3; k++) {
    const az = (k * 120) * D2R;
    const m = frameAt(az, 0.06, tipZ + 0.06);
    Bm.add('darkMetal', box([0, 0.006, 0], [0.018, 0.012, 0.04], m));
  }
}
