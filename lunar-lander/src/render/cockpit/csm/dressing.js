// Loose stowage & wall dressing of the Command Module (CSM-CABIN agent).
//
// The flown cabin was anything but bare: Beta-cloth pouches snapped to the walls between the
// windows, Velcro-backed cue cards next to the hatch, a Hasselblad magazine bag, the pencil and
// the "tissue dispenser" of every mission photo. These soft items sit on the conical wall (placed
// in cylindrical coordinates: theta from +Y toward +X, z) and are merged per material like the rest
// of the cabin.
import * as THREE from 'three';
import * as KIT from '../kit/index.js';
import { coneNormal, Frame } from './layout.js';
import { V, Batch, boxUV, roundBox, cylBetween, onFrame, placeOnFrame } from './geom.js';
import { conePoint, R_IN } from './shell.js';

const DEG = Math.PI / 180;

/**
 * Frame on the inner wall at (theta, z), `lift` metres in from the wall, z axis into the cabin,
 * y axis as close as possible to `upHint`.
 */
export function wallFrame(th, z, lift = 0, upHint = V(0, 1, 0), w = 0, h = 0) {
  const p = conePoint(R_IN, th, z);
  const n = coneNormal(p, V()).negate();
  p.addScaledVector(n, lift);
  let up = upHint.clone().addScaledVector(n, -upHint.dot(n));
  if (up.lengthSq() < 1e-6) up = V(0, 0, -1).addScaledVector(n, n.z);
  up.normalize();
  const right = V().crossVectors(up, n).normalize();
  return new Frame(p, right, up, w, h);
}

/**
 * Soft, rounded "superquadric" cushion of size w × h × d centred at the origin: a unit sphere whose
 * coordinates are pushed toward a box (exponent p < 1 squares it off), back half flattened.
 */
function softBox(w, h, d, p = 0.32, flatBack = 0.2) {
  const g = new THREE.SphereGeometry(1, 28, 18);
  const q = g.attributes.position;
  const f = (t) => Math.sign(t) * Math.abs(t) ** p;
  for (let i = 0; i < q.count; i++) {
    // sphere is +Y-up: map its (x, y, z) to (x, y, z) of the box
    const x = f(q.getX(i)) * (w / 2);
    const y = f(q.getY(i)) * (h / 2);
    let z = f(q.getZ(i)) * (d / 2);
    if (z < 0) z *= flatBack;
    q.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Soft Beta-cloth pouch: a padded bag with rounded edges (front bulges, back flat on the wall), a
 * closing flap over the top third with two press studs. Local frame: back on z = 0, front +z.
 */
function pouch(B, F, w, h, d, key = 'betaShade') {
  B.add(key, onFrame(boxUV(softBox(w, h, d), 0.1), F, 0, 0, d * 0.12));
  // flap over the top third, following the bag's front
  const flap = boxUV(softBox(w * 1.03, h * 0.4, d * 0.3, 0.25, 0.6), 0.1);
  B.add(key, onFrame(flap, F, 0, h * 0.3, d * 0.52));
  // press studs
  for (const s of [-1, 1]) {
    const a = F.point(s * w * 0.28, h * 0.17, d * 0.64);
    B.add('alu', cylBetween(a, a.clone().addScaledVector(F.z, 0.004), 0.0055, 0.0055, 10));
  }
}

/**
 * @param {(key: string) => THREE.Material} mat
 * @returns {{group: THREE.Group}}
 */
export function buildDressing(mat) {
  const B = new Batch('CSMCabin:dressing');
  const group = new THREE.Group();
  group.name = 'CSMCabin:dressing';

  // pouches between each side window and the hatch, aft of the rendezvous windows (clear of the
  // rendezvous-window pockets, |theta| 40-63 deg at z -1.14..-1.50, and of the side-window pockets,
  // |theta| 69-92 deg at z -0.73..-1.13), and above the equipment bays
  for (const s of [-1, 1]) {
    pouch(B, wallFrame(s * 57 * DEG, -0.93, 0.002), 0.15, 0.18, 0.045);
    pouch(B, wallFrame(s * 70 * DEG, -0.48, 0.002), 0.2, 0.15, 0.05, s < 0 ? 'betaShade' : 'beta');
  }
  // a smaller film-magazine bag right of the side hatch
  pouch(B, wallFrame(31 * DEG, -1.56, 0.002, V(0, 0.3, -1)), 0.11, 0.13, 0.04, 'beta');

  // Velcro-backed cue card left of the side hatch (rendezvous / orbital events)
  {
    const F = wallFrame(-31 * DEG, -1.56, 0.004, V(0, 0.3, -1));
    B.add('velcro', onFrame(new THREE.BoxGeometry(0.1, 0.13, 0.003), F, 0, 0, 0.0015));
    const card = KIT.createChecklistCard({
      title: 'ORBITAL EVENTS REV 14',
      lines: ['AOS 104:01:59', 'SUNRISE 104:15:26', 'LOS 104:48:10', 'SUNSET 105:01:20', 'LM OVHD 104:22:10', 'P22 TRACK LM', 'VHF RNG ON'],
      width: 0.095,
      height: 0.125,
      seed: 23,
    });
    placeOnFrame(card, F, 0, 0, 0.0045);
    card.rotateZ(0.04);
    group.add(card);
  }

  // pencil & grease pencil held by a Velcro tab just aft of the cue card
  {
    const F = wallFrame(-31 * DEG, -1.43, 0.004, V(0, 0.3, -1));
    B.add('velcro', onFrame(new THREE.BoxGeometry(0.05, 0.022, 0.003), F, 0, 0, 0.0015));
    const a = F.point(-0.07, 0.004, 0.008);
    const b = F.point(0.07, -0.012, 0.008);
    B.add('gold', cylBetween(a, b, 0.0036, 0.0036, 6)); // yellow pencil
    B.add('black', cylBetween(b, b.clone().addScaledVector(V().subVectors(b, a).normalize(), 0.012), 0.0036, 0.0006, 6));
    const c = F.point(-0.06, 0.02, 0.009);
    const e = F.point(0.065, 0.026, 0.009);
    B.add('red', cylBetween(c, e, 0.0045, 0.0045, 8)); // grease pencil
  }

  group.add(B.build(mat));
  return { group };
}
