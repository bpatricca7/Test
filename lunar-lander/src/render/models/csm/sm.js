// Apollo Block II Service Module — exterior geometry.
//
// Cylinder r = 1.955 m from z = 0.05 to 5.00 (CSM.sm) with the painted skin atlas (panels, EPS and
// ECS radiators, black/white RCS quad panels — see texgen.js), four RCS quads whose 16 nozzles sit
// exactly at csmRcsJets() positions / directions, the "UNITED STATES" + flag decals, two VHF
// scimitar antennas, the CM/SM umbilical fairing, running / docking lights and the flashing
// rendezvous beacon, the aft heat shield, the gimballed SPS engine (buildSPS) and the four-dish
// S-band high-gain antenna on its deployed boom (buildHGA).

import * as THREE from 'three';
import { CSM, csmRcsJets } from '../../../core/constants.js';
import { SM_LAYOUT, spsInnerProfile } from './profile.js';
import { lathe, frameAt, roundBox, tube, box, sphere, torusZ, clean } from './geom.js';

const D2R = Math.PI / 180;
const L = SM_LAYOUT;
const R = L.radius;

/** Rotate a geometry so its local +Z axis points along `dir`, then move it to `pos`. */
function orient(g, dir, pos) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/**
 * Build the SM body and its fixed appendages into B.
 * @param {import('./geom.js').PartBuilder} B
 * @returns {{lights: Array<{az:number, z:number, color:string}>}}
 */
export function buildSM(B) {
  // ---- skin (outward normals: traverse forward -> aft with flip)
  B.add('sm', lathe([[R, L.zFront], [R, L.zRear]], { segments: 192, v: 'frac', u: 'frac', flip: true }));
  // forward lip (under the CM rim) and the forward bulkhead closing the view into the SM
  B.add('smInner', lathe([[R, L.zFront], [R - 0.05, L.zFront]], { segments: 96 }));
  B.add('smInner', lathe([[R - 0.05, L.zFront], [R - 0.05, 0.33]], { segments: 96, flip: true }));
  B.add('smInner', lathe([[R - 0.05, 0.31], [0.0, 0.31]], { segments: 64 }));

  // ---- aft heat shield (planar UV for the quilted texture), aft rim
  {
    const g = lathe([[0.84, L.zRear - 0.005], [R - 0.012, L.zRear - 0.005]], { segments: 128 });
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 4 + 0.5, p.getY(i) / 4 + 0.5);
    B.add('aftShield', g);
    B.add('metal', torusZ([0, 0, L.zRear - 0.006], R - 0.008, 0.009, 6, 128));
    // SPS flexible heat-shield boot from the bulkhead to the engine
    B.add('boot', lathe([[0.49, 5.25], [0.54, 5.2], [0.64, 5.12], [0.76, 5.05], [0.84, L.zRear - 0.005]], { segments: 64 }));
    // gimbal actuators (pitch on +Y, yaw on +X): cylinder on the SM side, rod to the engine
    for (const az of [0, 90]) {
      const a = az * D2R;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const p0 = new THREE.Vector3(1.02 * s, 1.02 * c, L.zRear);
      const p1 = new THREE.Vector3(0.62 * s, 0.62 * c, 5.2);
      const p2 = new THREE.Vector3(0.5 * s, 0.5 * c, 5.3);
      B.add('darkMetal', tube(p0, p1, 0.045, 0.045, 10, true));
      B.add('metal', tube(p1, p2, 0.02, 0.02, 8, true));
      B.add('darkMetal', box([0, 0.02, 0], [0.12, 0.04, 0.1], frameAt(a, 1.02, L.zRear + 0.02)));
    }
  }

  // ---- RCS quads
  const jets = csmRcsJets();
  const { quadRadius: qr, quadZ: qz, quadAngles, quadNames } = CSM.rcs;
  quadAngles.forEach((a, qi) => {
    const m = frameAt(a, R, qz); // X tangent, Y radial (0 at the skin), Z aft
    // pedestal / mounting plate and the main housing (nozzle axes at r = quadRadius)
    const top = qr - R + 0.085; // housing top above the skin
    B.add('quad', roundBox([0, 0.01, 0], [0.36, 0.02, 0.38], 0.02, m));
    B.add('quad', roundBox([0, 0.03, 0], [0.26, 0.03, 0.26], 0.02, m));
    B.add('quad', roundBox([0, 0.04 + (top - 0.04) / 2, 0], [0.19, top - 0.04, 0.19], 0.022, m));
    // cover plate with its fasteners, and the heater / thermostat blocks on top
    B.add('darkMetal', roundBox([0, top + 0.002, 0], [0.15, 0.006, 0.15], 0.01, m));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) B.add('metal', sphere([sx * 0.06, top + 0.006, sz * 0.06], 0.006, 6, 4).applyMatrix4(m));
      B.add('quad', roundBox([sx * 0.035, top + 0.014, 0], [0.03, 0.018, 0.05], 0.006, m));
    }
    // propellant / pressurisation lines entering the pedestal
    B.add('metal', tube(new THREE.Vector3(-0.07, 0.035, 0.13).applyMatrix4(m), new THREE.Vector3(-0.07, 0.035, 0.19).applyMatrix4(m), 0.008, 0.008, 6, true));
    B.add('metal', tube(new THREE.Vector3(0.07, 0.035, 0.13).applyMatrix4(m), new THREE.Vector3(0.07, 0.035, 0.19).applyMatrix4(m), 0.008, 0.008, 6, true));
    // nozzles
    for (const j of jets.filter((jj) => jj.quad === quadNames[qi])) {
      const len = 0.13;
      const outer = [];
      const inner = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const z = -len + t * len;
        const r = 0.02 + (0.054 - 0.02) * Math.pow(t, 0.7);
        outer.push([r + 0.0025, z]);
        inner.push([r, z]);
      }
      const go = lathe(outer.slice().reverse(), { segments: 20 });
      const gi = lathe(inner, { segments: 20 });
      // exit lip, throat plug and the collar where the nozzle leaves the housing
      const gl = lathe([[0.054, 0.0005], [0.0575, 0]], { segments: 20 });
      const gt = lathe([[0, -len], [0.02, -len]], { segments: 12 });
      const gc = lathe([[0.036, -len + 0.004], [0.036, -len - 0.012], [0.02, -len - 0.02]], { segments: 16 });
      for (const [g, key] of [[go, 'nozzle'], [gi, 'nozzleIn'], [gl, 'nozzle'], [gt, 'nozzleIn'], [gc, 'darkMetal']]) {
        B.add(key, orient(g, j.exhaustDir, j.pos));
      }
      // valve / chamber body inside the housing root
      const root = j.pos.clone().addScaledVector(j.exhaustDir, -len - 0.02);
      B.add('darkMetal', tube(root, j.pos.clone().addScaledVector(j.exhaustDir, -len + 0.004), 0.024, 0.024, 10, true));
    }
  });

  // ---- "UNITED STATES" + flag decals (curved strips just proud of the skin)
  for (const c of L.decals.centres) {
    const half = L.decals.halfWidthM / R;
    const a = c * D2R;
    B.add('decal', lathe([[R + 0.0015, L.decals.z0], [R + 0.0015, L.decals.z1]], { segments: 12, az0: a - half, az1: a + half, v: 'frac', u: 'frac', flip: true }));
  }

  // ---- VHF scimitar antennas (white fibreglass blades in the radial-axial plane)
  for (const sc of L.scimitars) {
    const len = sc.z1 - sc.z0;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.07, 0);
    shape.quadraticCurveTo(0.2, 0.13, len, 0.1);
    shape.quadraticCurveTo(0.18, 0.21, 0.0, 0.05);
    shape.lineTo(0, 0);
    const g = clean(new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 14 }));
    g.translate(0, 0, -0.007);
    // shape X -> axial (+Z), shape Y -> radial, extrusion -> tangent (mirror-free basis)
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
    g.applyMatrix4(basis);
    g.applyMatrix4(frameAt(sc.az * D2R, R, sc.z0));
    B.add('white', g);
    // root fitting
    B.add('darkMetal', roundBox([0, 0.015, 0.04], [0.05, 0.03, 0.09], 0.008, frameAt(sc.az * D2R, R, sc.z0)));
  }

  // ---- CM/SM umbilical fairing on the SM
  {
    const u = L.umbilical;
    const m = frameAt(u.az * D2R, R, (u.z0 + u.z1) / 2);
    B.add('white', roundBox([0, 0.04, 0], [u.width, 0.08, u.z1 - u.z0], 0.035, m));
    B.add('darkMetal', box([0, 0.082, -0.1], [u.width * 0.6, 0.006, 0.18], m));
  }

  // ---- running / docking lights (lens domes are emissive, see materials)
  for (const lt of L.lights) {
    const m = frameAt(lt.az * D2R, R, lt.z);
    B.add('darkMetal', roundBox([0, 0.01, 0], [0.07, 0.02, 0.07], 0.01, m));
    if (lt.color === 'beacon') continue; // built separately (it flashes)
    const key = lt.color === 'red' ? 'lightRed' : lt.color === 'green' ? 'lightGreen' : 'lightAmber';
    const dome = sphere([0, 0, 0], 0.022, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    // sphere's +Y pole -> radial
    dome.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.02, 0));
    dome.applyMatrix4(m);
    B.add(key, dome);
  }

  // ---- EPS radiator / ECS radiator edge doublers: thin raised frames (texture carries the panels)
  for (const c of L.ecs.centres) {
    const hw = (L.ecs.width * D2R) / 2;
    const a = c * D2R;
    for (const z of [L.ecs.z0, L.ecs.z1]) {
      B.add('white', lathe([[R + 0.004, z - 0.02], [R + 0.004, z + 0.02]], { segments: 16, az0: a - hw, az1: a + hw, flip: true }));
      B.add('white', lathe([[R + 0.004, z - 0.02], [R, z - 0.02]], { segments: 16, az0: a - hw, az1: a + hw }));
      B.add('white', lathe([[R, z + 0.02], [R + 0.004, z + 0.02]], { segments: 16, az0: a - hw, az1: a + hw }));
    }
  }
}

/** Beacon lens (flashing) — separate so its material intensity can pulse. */
export function buildBeacon(B) {
  const lt = L.lights.find((l) => l.color === 'beacon');
  const m = frameAt(lt.az * D2R, R, lt.z);
  const dome = sphere([0, 0, 0], 0.028, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.02, 0));
  dome.applyMatrix4(m);
  B.add('lightBeacon', dome);
}

/** Arclength-parameter lookup on a profile: z where the normalised arclength equals f. */
function zAtFraction(prof, f) {
  const s = [0];
  for (let i = 1; i < prof.length; i++) s.push(s[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const target = f * s[s.length - 1];
  for (let i = 1; i < prof.length; i++) {
    if (s[i] >= target) {
      const t = (target - s[i - 1]) / (s[i] - s[i - 1]);
      return [prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * t, prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * t];
    }
  }
  return prof[prof.length - 1];
}

/**
 * SPS engine (gimballed part): chamber, attach flange, nozzle extension outer skin (banded texture),
 * stiffener rings, exit lip and the dark interior down to the throat. Built around the body axis in
 * body coordinates; the caller parents it to a pivot.
 * @param {import('./geom.js').PartBuilder} B
 */
export function buildSPS(B) {
  const inner = spsInnerProfile(30);
  const bellStart = inner.findIndex((p) => p[1] >= 5.34 - 1e-6);
  const bell = inner.slice(bellStart);
  const throat = inner.slice(0, bellStart + 1);
  // interior (normals toward the axis = (-dz, dr) for this aft-going traversal)
  B.add('spsInner', lathe(bell, { segments: 72 }));
  B.add('spsThroat', lathe(throat, { segments: 36 }));
  B.add('spsThroat', lathe([[0.0, throat[0][1]], [throat[0][0], throat[0][1]]], { segments: 24 }));
  // outer skin: offset along the profile normal
  const off = 0.007;
  const outer = bell.map(([r, z], i) => {
    const a = bell[Math.max(0, i - 1)];
    const b = bell[Math.min(bell.length - 1, i + 1)];
    const dr = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dr, dz);
    return [r + (dz / l) * off, z - (dr / l) * off];
  });
  B.add('spsOuter', lathe(outer, { segments: 72, v: 'frac', u: 'frac', flip: true }));
  // exit lip (rolled edge)
  const e = outer[outer.length - 1];
  const ei = bell[bell.length - 1];
  B.add('spsOuter', lathe([[ei[0], ei[1]], [(ei[0] + e[0]) / 2 + 0.004, e[1] + 0.006], [e[0] + 0.002, e[1]]], { segments: 72 }));
  // stiffener / joint rings at the texture bands
  for (const f of [0.3, 0.62, 0.84]) {
    const [r, z] = zAtFraction(outer, f);
    B.add('spsRing', lathe([[r, z - 0.018], [r + 0.012, z - 0.012], [r + 0.012, z + 0.012], [r, z + 0.018]], { segments: 72, flip: true, crease: 50 }));
  }
  // attach flange and chamber housing
  B.add('darkMetal', lathe([[0.36, 5.345], [0.49, 5.345], [0.495, 5.335], [0.495, 5.29], [0.47, 5.28], [0.47, 5.02]], { segments: 48, crease: 50 }));
  // flange bolts
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    B.add('metal', sphere([Math.sin(a) * 0.46, Math.cos(a) * 0.46, 5.35], 0.008, 5, 3));
  }
}

/**
 * S-band high-gain antenna. Returns the root (boom, fixed to the SM) and the steerable dish cluster
 * (`yoke`), whose local +Z is the antenna boresight; the caller aims it.
 * @param {import('./geom.js').PartBuilder} Bf fixed parts
 * @param {import('./geom.js').PartBuilder} By steerable parts (yoke-local coordinates)
 * @returns {{tip: THREE.Vector3, stow: THREE.Vector3}} boom tip (body) and the default boresight
 */
export function buildHGA(Bf, By) {
  const a = L.hga.az * D2R;
  const radial = new THREE.Vector3(Math.sin(a), Math.cos(a), 0);
  const tangent = new THREE.Vector3(Math.cos(a), -Math.sin(a), 0);
  const root = radial.clone().multiplyScalar(R - 0.02).setZ(L.hga.z);
  // hinge bracket on the SM aft edge
  Bf.add('darkMetal', roundBox([0, 0.03, 0], [0.18, 0.06, 0.16], 0.015, frameAt(a, R, L.hga.z)));
  // boom: deployed 45 deg aft / outward, with the drive housing at mid-length
  const dir = radial.clone().multiplyScalar(Math.SQRT1_2).add(new THREE.Vector3(0, 0, Math.SQRT1_2));
  const hinge = root.clone().addScaledVector(radial, 0.08);
  const tip = hinge.clone().addScaledVector(dir, 1.4);
  Bf.add('white', tube(hinge, tip, 0.032, 0.03, 12, true));
  Bf.add('metal', sphere([hinge.x, hinge.y, hinge.z], 0.05, 10, 8));
  const mid = hinge.clone().lerp(tip, 0.35);
  Bf.add('darkMetal', tube(mid.clone().addScaledVector(tangent, -0.06), mid.clone().addScaledVector(tangent, 0.06), 0.05, 0.05, 12, true));
  // gimbal housing at the tip
  Bf.add('darkMetal', sphere([tip.x, tip.y, tip.z], 0.07, 12, 8));

  // ---- steerable cluster in yoke-local coordinates (+Z = boresight, origin at the gimbal)
  const back = -0.28; // dish vertex plane behind the gimbal
  By.add('darkMetal', roundBox([0, 0, back - 0.08], [0.34, 0.34, 0.16], 0.03));
  By.add('metal', tube([0, 0, -0.02], [0, 0, back - 0.02], 0.035, 0.035, 10, true));
  // yoke arms
  for (const s of [-1, 1]) {
    By.add('white', tube([s * 0.13, 0, 0], [s * 0.13, 0, back - 0.02], 0.018, 0.018, 8, true));
  }
  By.add('white', tube([-0.13, 0, 0], [0.13, 0, 0], 0.02, 0.02, 8, true));
  const dishR = 0.395;
  const depth = 0.11;
  const f = (dishR * dishR) / (4 * depth);
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const r = (dishR * i) / 10;
    prof.push([r, back + (r * r) / (4 * f)]);
  }
  const offs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const d = 0.42;
  for (const [sx, sy] of offs) {
    const cx = sx * d;
    const cy = sy * d;
    const dish = lathe(prof, { segments: 40 });
    dish.translate(cx, cy, 0);
    By.add('dish', dish);
    // rolled rim
    const rim = torusZ([cx, cy, back + depth], dishR, 0.008, 6, 48);
    By.add('dish', rim);
    // feed: support tripod and horn at the focus
    const focus = [cx, cy, back + f];
    By.add('metal', tube([cx, cy, back], focus, 0.018, 0.022, 10, true));
    By.add('darkMetal', sphere(focus, 0.03, 10, 6));
    for (let k = 0; k < 3; k++) {
      const aa = (k / 3) * Math.PI * 2 + 0.3;
      By.add('metal', tube([cx + Math.cos(aa) * dishR * 0.75, cy + Math.sin(aa) * dishR * 0.75, back + depth * 0.56], focus, 0.005, 0.005, 5, false));
    }
    // back structure: truss to the central box
    By.add('white', tube([cx * 0.35, cy * 0.35, back - 0.05], [cx * 0.8, cy * 0.8, back + 0.005], 0.012, 0.012, 6, true));
  }
  // centre wide-beam horn
  By.add('dish', lathe([[0.0, back + 0.02], [0.09, back + 0.02], [0.13, back + 0.12]], { segments: 24 }));
  By.add('darkMetal', lathe([[0.0, back + 0.021], [0.09, back + 0.021]], { segments: 24 }));
  return { tip, stow: dir.clone() };
}
