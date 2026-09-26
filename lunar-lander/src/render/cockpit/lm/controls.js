// LM hand controllers (LM-CABIN agent): the Attitude Controller Assembly (ACA, right-hand pistol
// grip: fore/aft = pitch, left/right = roll, twist = yaw, ~±12 deg) and the Thrust/Translation
// Controller Assembly (TTCA, left-hand T-handle: fore/aft, left/right and up/down translation; with
// the JETS/THROTTLE lever at THROTTLE the up/down axis is the DPS throttle, 10..92.5 %), one pair per
// crew station, with their mounting brackets, rubber boots and armrests. Animated from vessel.ctrl.
import * as THREE from 'three';
import { CONTROLLERS } from './layout.js';
import { V, Batch, lathe, cylBetween, boxFromTo, roundBox, tube } from './geom.js';

const D2R = Math.PI / 180;
const ACA_MAX = 12 * D2R;
const TTCA_MAX = 14 * D2R;

/** Pistol-grip geometry (local: pivot at the origin, grip up +Y, raked 12 deg forward). */
function acaGrip(b) {
  // grip body: lathe with finger swells, flattened sideways
  const prof = [
    [0.001, 0.0], [0.016, 0.004], [0.019, 0.02], [0.0175, 0.035], [0.0195, 0.05], [0.0178, 0.064], [0.0198, 0.079],
    [0.019, 0.095], [0.02, 0.108], [0.0215, 0.118], [0.02, 0.128], [0.014, 0.135], [0.001, 0.137],
  ];
  const g = lathe(prof, 20);
  g.scale(0.82, 1, 1.12);
  g.rotateX(-12 * D2R);
  b.add('grip', g);
  // head (the wider top with the thumb switch)
  const head = roundBox(0.036, 0.022, 0.05, 0.009, 3);
  head.rotateX(-12 * D2R);
  head.translate(0, 0.128, -0.02);
  b.add('grip', head);
  // trigger (front, index finger) and push-to-talk thumb button (top)
  const trig = roundBox(0.012, 0.03, 0.008, 0.003, 2);
  trig.rotateX(-20 * D2R);
  trig.translate(0, 0.098, -0.032);
  b.add('trigger', trig);
  b.add('trigger', cylBetween(V(0, 0.138, -0.018), V(0, 0.145, -0.02), 0.006, 0.0055, 12));
  // collar where the grip enters the boot
  b.add('metal', cylBetween(V(0, -0.012, 0), V(0, 0.004, 0), 0.02, 0.018, 20));
}

/** T-handle geometry (local: pivot at the origin). */
function ttcaHandle(b) {
  b.add('metal', cylBetween(V(0, -0.01, 0), V(0, 0.06, 0), 0.008, 0.008, 12));
  b.add('grip', cylBetween(V(0, 0.06, 0.0), V(0, 0.075, -0.004), 0.013, 0.012, 14));
  // crossbar (the "T"), grip pads either side
  b.add('grip', cylBetween(V(-0.065, 0.082, -0.006), V(0.065, 0.082, -0.006), 0.012, 0.012, 16));
  for (const s of [-1, 1]) {
    const cap = new THREE.SphereGeometry(0.0125, 12, 8);
    cap.translate(s * 0.065, 0.082, -0.006);
    b.add('grip', cap);
  }
  b.add('metal', cylBetween(V(-0.02, 0.082, -0.006), V(0.02, 0.082, -0.006), 0.0135, 0.0135, 16));
}

/** Controller housing with rubber boot and bracket (static), in the controller's local frame. */
function housing(b, kind, side) {
  // box housing below the pivot
  b.add('console', roundBox(0.07, 0.07, 0.085, 0.008, 3).translate(0, -0.05, 0));
  // boot (black rubber bellows)
  const prof = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    prof.push([0.03 - t * 0.012 + (i % 2 ? 0.003 : 0), -0.018 + t * 0.022]);
  }
  b.add('rubber', lathe(prof, 20));
  // label plate on the front of the housing
  b.add('black', boxFromTo(V(-0.028, -0.07, -0.0435), V(0.028, -0.052, -0.0425)));
  // mounting bracket to the structure (toward the console, forward)
  b.add('darkMetal', boxFromTo(V(-0.022, -0.09, -0.02), V(0.022, -0.076, -0.1)));
  b.add('darkMetal', cylBetween(V(0, -0.083, -0.1), V(0, -0.083, -0.16), 0.012, 0.012, 10));
  if (kind === 'ttca') {
    // JETS / THROTTLE select lever on the outboard side
    const x = side * 0.037;
    b.add('metal', cylBetween(V(x, -0.03, 0.01), V(x + side * 0.012, -0.03, 0.01), 0.006, 0.006, 10));
  }
}

/**
 * Build the four hand controllers with armrests.
 * @param {(key: string) => THREE.Material} mat
 * @returns {{group: THREE.Group, update(vessel: object, dt: number): void}}
 */
export function buildControllers(mat) {
  const group = new THREE.Group();
  group.name = 'LMCabin:controllers';
  const matFor = (k) => (k === 'grip' ? gripMat : k === 'trigger' ? mat('black') : mat(k));
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1e, roughness: 0.55, metalness: 0.05, name: 'lmcabin:grip' });
  const moving = [];

  const make = (kind, pos, side) => {
    const root = new THREE.Group();
    root.position.copy(pos);
    const hb = new Batch(`${kind}-housing`);
    housing(hb, kind, side);
    root.add(hb.build(matFor));
    const pivot = new THREE.Group();
    const pb = new Batch(`${kind}-grip`);
    if (kind === 'aca') acaGrip(pb);
    else ttcaHandle(pb);
    pivot.add(pb.build(matFor));
    // TTCA throttle lever pivot sits aft of the handle (the handle swings up/down in an arc)
    if (kind === 'ttca') pivot.position.set(0, 0, 0.02);
    root.add(pivot);
    group.add(root);
    moving.push({ kind, pivot, s: { a: 0, b: 0, c: 0 } });
    return root;
  };
  make('aca', CONTROLLERS.cdrACA, 1);
  make('ttca', CONTROLLERS.cdrTTCA, -1);
  make('aca', CONTROLLERS.lmpACA, 1);
  make('ttca', CONTROLLERS.lmpTTCA, -1);

  // ---- armrests: padded rests under each forearm, on struts from the lower walls / console
  const b = new Batch('armrests');
  for (const p of [CONTROLLERS.cdrACA, CONTROLLERS.cdrTTCA, CONTROLLERS.lmpACA, CONTROLLERS.lmpTTCA]) {
    const y = p.y - 0.1;
    const pad = roundBox(0.07, 0.028, 0.22, 0.012, 3);
    pad.translate(p.x, y, p.z + 0.15);
    b.add('pad', pad);
    b.add('darkMetal', boxFromTo(V(p.x - 0.028, y - 0.026, p.z + 0.06), V(p.x + 0.028, y - 0.014, p.z + 0.25)));
    // strut down and outboard to the structure
    const out = Math.sign(p.x) * (Math.abs(p.x) > 0.4 ? 1 : -1);
    const foot = V(p.x + out * 0.18, 3.62, p.z + 0.1);
    b.add('darkMetal', cylBetween(V(p.x, y - 0.026, p.z + 0.2), foot, 0.01, 0.01, 8));
    b.add('darkMetal', cylBetween(foot, foot.clone().add(V(0, -0.03, 0)), 0.022, 0.022, 10));
    // hinge knuckle at the rear of the rest
    b.add('metal', cylBetween(V(p.x - 0.036, y - 0.02, p.z + 0.25), V(p.x + 0.036, y - 0.02, p.z + 0.25), 0.009, 0.009, 10));
  }
  // cable to the controllers (coiled, from housing down to the floor)
  for (const p of [CONTROLLERS.cdrACA, CONTROLLERS.lmpACA, CONTROLLERS.cdrTTCA, CONTROLLERS.lmpTTCA]) {
    const pts = [p.clone().add(V(0, -0.085, 0.02)), p.clone().add(V(0.01, -0.2, 0.05)), p.clone().add(V(0.03, -0.35, 0.02)), V(p.x + 0.04, 3.5, p.z - 0.1)];
    b.add('cable', tube(pts, 0.005, { radial: 6 }));
  }
  group.add(b.build(matFor));

  const s = new THREE.Vector3();
  return {
    group,
    /**
     * Animate the grips. The active vessel's ctrl moves BOTH stations' controllers (they are wired
     * in parallel; the crewman flying is the one whose hand is on it).
     */
    update(v, dt) {
      const c = v.ctrl;
      const k = 1 - Math.exp(-(dt || 0.016) * 18); // stiff spring-back feel
      const throttleMode = v.mainEngine && !v.staged && v.gnc?.throttleMode !== 'AUTO' && v.mainEngine.armed;
      for (const m of moving) {
        if (m.kind === 'aca') {
          s.set(c.pitch * ACA_MAX, -c.yaw * ACA_MAX, -c.roll * ACA_MAX);
        } else {
          const vert = throttleMode ? THREE.MathUtils.lerp(-TTCA_MAX, TTCA_MAX, THREE.MathUtils.clamp(c.throttle, 0, 1)) : c.transUp * TTCA_MAX;
          // fore/aft: push forward = +transFwd -> handle tips forward (rotation about +X negative)
          s.set(-c.transFwd * TTCA_MAX * 0.8 + vert * 0.0, 0, -c.transRight * TTCA_MAX * 0.8);
          m.s.lift = THREE.MathUtils.lerp(m.s.lift ?? 0, vert, k);
        }
        m.s.a = THREE.MathUtils.lerp(m.s.a, s.x, k);
        m.s.b = THREE.MathUtils.lerp(m.s.b, s.y, k);
        m.s.c = THREE.MathUtils.lerp(m.s.c, s.z, k);
        m.pivot.rotation.set(m.s.a, m.s.b, m.s.c, 'YXZ');
        if (m.kind === 'ttca') {
          // vertical travel: the T-handle rises / falls about 2.5 cm over its range
          m.pivot.position.y = Math.sin(m.s.lift) * 0.1;
          m.pivot.rotation.x += -m.s.lift * 0.35;
        }
      }
    },
  };
}
