// CDR hand controllers of the Command Module (CSM-CABIN agent), animated from vessel.ctrl.
//
// Rotation Hand Controller (RHC) on the CDR's right armrest: black pistol grip on a gimballed
// base inside a rubber boot, grey housing with the mounting clamp. Like a seated pilot's stick
// (the crew lie with their forearms along -Z, grip axis along +Y):
//   pitch + (nose up)    grip tilts aft (+Z)       rotation about +X
//   roll  + (right down) grip tilts right (+X)     rotation about -Z
//   yaw   + (nose right) grip twists clockwise seen from above (about -Y)
// Travel ±11° (pitch/roll), ±11° twist; springs back to centre (the input module's ctrl values
// already include the "breakout"/centring).
// Translation Hand Controller (THC) on the left armrest: T-handle on a shaft from a housing,
// translating ±1.5 cm along the commanded axis (fwd = -Z, right = +X, up = +Y). The T-handle's
// counter-clockwise twist (CSM/LV abort) is not modelled.
import * as THREE from 'three';
import { CONTROLLERS } from './layout.js';
import { V, Batch, roundBox, lathe, cylBetween } from './geom.js';

const MAX_TILT = 11 * (Math.PI / 180);
const MAX_TWIST = 11 * (Math.PI / 180);
const MAX_TRANS = 0.015;

/** Ribbed rubber boot (lathe around +Y). */
function boot(r0, r1, h, ribs = 6) {
  const prof = [[0.001, 0]];
  const n = ribs * 2;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const r = r0 + (r1 - r0) * s + (i % 2 ? 0.003 : 0);
    prof.push([r, h * s]);
  }
  prof.push([0.001, h]);
  return lathe(prof, 20);
}

/** Pistol grip: tapered, slightly forward-leaning profile (lathe, then squashed / tilted). */
function gripGeometry() {
  const prof = [
    [0.001, 0], [0.017, 0], [0.019, 0.01], [0.021, 0.035], [0.0215, 0.06], [0.02, 0.085], [0.021, 0.1], [0.019, 0.112], [0.012, 0.12], [0.001, 0.122],
  ];
  const g = lathe(prof, 18);
  g.scale(1, 1, 1.25); // deeper front-to-back like a pistol grip
  g.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, -0.18, 0, 0)); // lean the top forward (-Z)
  return g;
}

/**
 * Build both hand controllers.
 * @param {(key: string) => THREE.Material} mat
 * @returns {{group: THREE.Group, update(v: object, dt: number): void, rhc: THREE.Object3D, thc: THREE.Object3D}}
 */
export function buildControllers(mat) {
  const group = new THREE.Group();
  group.name = 'CSMCabin:controllers';

  // ------------------------------------------------------------------ RHC
  const rhc = new THREE.Group();
  rhc.name = 'RHC';
  rhc.position.copy(CONTROLLERS.RHC.base);
  {
    const B = new Batch('RHC:base');
    // housing on the armrest end: grey box with a clamp band, the direct-switch guard, cable
    B.add('structure', roundBox(0.075, 0.05, 0.1, 0.008).translate(0, -0.028, 0.02));
    B.add('alu', new THREE.BoxGeometry(0.082, 0.012, 0.012).translate(0, -0.03, 0.062));
    B.add('black', new THREE.CylinderGeometry(0.03, 0.032, 0.006, 24).translate(0, -0.001, 0));
    B.add('rubber', boot(0.026, 0.017, 0.035));
    B.add('black', cylBetween(V(0.035, -0.04, 0.05), V(0.06, -0.06, 0.2), 0.006, 0.006, 8)); // cable
    // "direct" rotation switch guard ring at the base (breakout to DIRECT)
    B.add('alu', new THREE.TorusGeometry(0.034, 0.002, 6, 24).rotateX(Math.PI / 2).translate(0, 0.004, 0));
    rhc.add(B.build(mat));
  }
  const rhcPivot = new THREE.Group();
  rhcPivot.position.set(0, 0.012, 0);
  rhc.add(rhcPivot);
  {
    const B = new Batch('RHC:grip');
    B.add('black', gripGeometry().translate(0, 0.02, 0));
    B.add('black', cylBetween(V(0, -0.01, 0), V(0, 0.025, 0), 0.008, 0.008, 10));
    // push-to-talk trigger at the front, thumb switch on top
    B.add('structDark', roundBox(0.012, 0.025, 0.008, 0.003).translate(0, 0.075, -0.029));
    B.add('alu', new THREE.CylinderGeometry(0.004, 0.004, 0.008, 10).translate(0.004, 0.142, -0.022));
    B.add('red', new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 10).translate(-0.008, 0.139, -0.018));
    rhcPivot.add(B.build(mat));
  }
  group.add(rhc);

  // ------------------------------------------------------------------ THC
  const thc = new THREE.Group();
  thc.name = 'THC';
  thc.position.copy(CONTROLLERS.THC.base);
  {
    const B = new Batch('THC:base');
    B.add('structure', roundBox(0.07, 0.055, 0.11, 0.008).translate(0, -0.03, 0.02));
    B.add('rubber', boot(0.024, 0.016, 0.03, 5));
    B.add('alu', new THREE.BoxGeometry(0.076, 0.012, 0.012).translate(0, -0.035, 0.065));
    thc.add(B.build(mat));
  }
  const thcSlide = new THREE.Group();
  thc.add(thcSlide);
  {
    const B = new Batch('THC:handle');
    B.add('black', cylBetween(V(0, 0, 0), V(0, 0.07, 0), 0.007, 0.007, 12));
    // T-handle bar along Z with rounded ends and a grip pad
    B.add('black', cylBetween(V(0, 0.078, 0.045), V(0, 0.078, -0.045), 0.011, 0.011, 16));
    for (const z of [0.045, -0.045]) B.add('black', new THREE.SphereGeometry(0.011, 12, 8).translate(0, 0.078, z));
    B.add('rubber', cylBetween(V(0, 0.078, 0.028), V(0, 0.078, -0.028), 0.0125, 0.0125, 16));
    thcSlide.add(B.build(mat));
  }
  group.add(thc);

  // ------------------------------------------------------------------ animation
  const s = { p: 0, r: 0, y: 0, f: 0, rt: 0, u: 0 };
  const ease = (cur, target, dt, k = 18) => cur + (target - cur) * Math.min(1, dt * k);
  function update(v, dt) {
    const c = v?.ctrl || {};
    const clamp = (x) => Math.max(-1, Math.min(1, x || 0));
    s.p = ease(s.p, clamp(c.pitch), dt);
    s.r = ease(s.r, clamp(c.roll), dt);
    s.y = ease(s.y, clamp(c.yaw), dt);
    s.f = ease(s.f, clamp(c.transFwd), dt);
    s.rt = ease(s.rt, clamp(c.transRight), dt);
    s.u = ease(s.u, clamp(c.transUp), dt);
    rhcPivot.rotation.set(s.p * MAX_TILT, -s.y * MAX_TWIST, -s.r * MAX_TILT, 'ZXY');
    thcSlide.position.set(s.rt * MAX_TRANS, s.u * MAX_TRANS, -s.f * MAX_TRANS);
  }
  return { group, update, rhc, thc, rhcPivot, thcSlide };
}
