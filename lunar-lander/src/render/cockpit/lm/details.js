// LM crew compartment fittings (LM-CABIN agent): everything that makes the cabin look lived-in —
// rolled window shades, handholds, the Alignment Optical Telescope, the COAS at the overhead window,
// flood and utility lights, wire bundles, suit hoses and umbilical connectors, stowage bags and
// lockers, the two PLSS backpacks and OPS stowed aft, crew restraint cables, bungees, Velcro,
// placards, stowage labels and checklist cue cards.
import * as THREE from 'three';
import * as KIT from '../kit/index.js';
import { LM } from '../../../core/constants.js';
import { CAB, triNormal } from './layout.js';
import { V, Batch, tube, sag, cylBetween, boxFromTo, roundBox, boxUV } from './geom.js';

/**
 * Build the cabin fittings.
 * @param {(key: string) => THREE.Material} mat
 * @returns {{group: THREE.Group, floods: Array<{position: THREE.Vector3, lens: THREE.Mesh}>, coas: THREE.Object3D,
 *   utility: THREE.Vector3[]}}
 */
export function buildDetails(mat) {
  const group = new THREE.Group();
  group.name = 'LMCabin:details';
  const b = new Batch('details');
  const W = LM.windows;

  // ------------------------------------------------------------------ rolled window shades
  for (const [tri, top] of [
    [W.cdr, [0, 2]],
    [W.lmp, [0, 1]],
  ]) {
    const n = triNormal(tri);
    const inN = n.clone().negate();
    const a = tri[top[0]].clone().addScaledVector(inN, 0.04).add(V(0, 0.035, 0));
    const c = tri[top[1]].clone().addScaledVector(inN, 0.04).add(V(0, 0.035, 0));
    const dir = c.clone().sub(a).normalize();
    const a2 = a.clone().addScaledVector(dir, 0.03);
    const c2 = c.clone().addScaledVector(dir, -0.03);
    b.add('shade', cylBetween(a2, c2, 0.018, 0.018, 16));
    // end caps and brackets
    for (const p of [a2, c2]) {
      b.add('darkMetal', cylBetween(p.clone().addScaledVector(dir, -0.006), p.clone().addScaledVector(dir, 0.004), 0.021, 0.021, 16));
      b.add('darkMetal', boxFromTo(p.clone().add(V(-0.008, 0, -0.008)), p.clone().add(V(0.008, 0.04, 0.008))));
    }
    // two retaining straps with snaps
    for (const t of [0.3, 0.7]) {
      const p = a2.clone().lerp(c2, t);
      const ring = new THREE.TorusGeometry(0.0195, 0.0035, 6, 16);
      ring.lookAt(dir);
      ring.translate(p.x, p.y, p.z);
      b.add('strap', ring);
      b.add('metal', cylBetween(p.clone().addScaledVector(inN, 0.018), p.clone().addScaledVector(inN, 0.023), 0.004, 0.004, 8));
    }
  }
  // overhead window shade (rolled along the aft edge of the well)
  {
    const ow = W.overhead;
    const z = ow.center.z + ow.height / 2 + 0.05;
    const y = CAB.ceilingY - 0.03;
    b.add('shade', cylBetween(V(ow.center.x - ow.width / 2, y, z), V(ow.center.x + ow.width / 2, y, z), 0.018, 0.018, 14));
    b.add('darkMetal', boxFromTo(V(ow.center.x - ow.width / 2 - 0.01, y - 0.01, z - 0.01), V(ow.center.x - ow.width / 2, CAB.ceilingY, z + 0.01)));
    b.add('darkMetal', boxFromTo(V(ow.center.x + ow.width / 2, y - 0.01, z - 0.01), V(ow.center.x + ow.width / 2 + 0.01, CAB.ceilingY, z + 0.01)));
  }

  // ------------------------------------------------------------------ handholds
  // grab bar: a bent tube whose first/last points sit on the wall, with flared mounting feet
  const handhold = (pts, r = 0.0115) => {
    b.add('handrail', tube(pts, r, { tension: 0.05, radial: 12 }));
    for (const [p, q] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]) {
      const toWall = p.clone().sub(q).normalize();
      // (runs 2 cm on into the wall so it always meets it)
      b.add('darkMetal', cylBetween(p.clone().addScaledVector(toWall, -0.014), p.clone().addScaledVector(toWall, 0.02), r * 1.3, r * 2.1, 14));
    }
  };
  for (const s of [-1, 1]) {
    // vertical grab bar on the front corner (cheek) outboard of panel 1A / 2A
    handhold([V(s * 1.0, 4.52, -1.09), V(s * 0.975, 4.55, -1.065), V(s * 0.975, 4.95, -1.065), V(s * 1.0, 4.98, -1.09)]);
    // overhead ingress handles either side of the tunnel
    handhold([V(s * 0.53, CAB.ceilingY - 0.035, -0.32), V(s * 0.53, CAB.ceilingY - 0.08, -0.28), V(s * 0.53, CAB.ceilingY - 0.08, 0.28), V(s * 0.53, CAB.ceilingY - 0.035, 0.32)]);
    // aft handhold on the rack front faces
    handhold([V(s * 0.8, 4.9, CAB.rearZ - 0.005), V(s * 0.83, 4.93, CAB.rearZ - 0.05), V(s * 0.83, 5.25, CAB.rearZ - 0.05), V(s * 0.8, 5.28, CAB.rearZ - 0.005)]);
  }
  // placards on the grab bars
  for (const s of [-1, 1]) {
    const pl = KIT.createPlacard({ text: 'HANDHOLD', width: 0.045, height: 0.009, bg: '#e8e4d8', fg: '#141414' });
    pl.position.set(s * 0.992, 4.99, -1.083);
    pl.rotation.y = -s * 0.85;
    group.add(pl);
  }

  // ------------------------------------------------------------------ AOT (Alignment Optical Telescope)
  {
    const top = V(0, CAB.ceilingY - 0.01, -0.99);
    const mid = V(0, 5.42, -0.965);
    const eye = V(0, 5.33, -0.9);
    b.add('structure', cylBetween(top.clone().add(V(0, 0.01, 0)), top.clone().add(V(0, -0.02, 0)), 0.1, 0.1, 28));
    b.add('console', cylBetween(top, mid, 0.075, 0.068, 28));
    b.add('darkMetal', cylBetween(mid, mid.clone().add(V(0, -0.02, 0)), 0.071, 0.071, 28));
    // eyepiece housing, angled aft toward the crew
    b.add('black', cylBetween(mid.clone().add(V(0, -0.015, 0)), eye, 0.04, 0.034, 20));
    b.add('rubber', cylBetween(eye, eye.clone().add(V(0, -0.012, 0.03)), 0.034, 0.03, 20));
    // reticle rotation knob (left), detent/counter box (right)
    b.add('blackKnob', cylBetween(V(-0.07, 5.46, -0.965), V(-0.105, 5.46, -0.965), 0.022, 0.022, 20));
    b.add('console', boxFromTo(V(0.066, 5.44, -1.0), V(0.1, 5.5, -0.93)));
    b.add('black', boxFromTo(V(0.1, 5.455, -0.985), V(0.1015, 5.485, -0.945)));
    // protective guard hoop around the eyepiece
    b.add('metal', tube([V(-0.06, 5.45, -0.93), V(-0.07, 5.34, -0.86), V(0, 5.3, -0.83), V(0.07, 5.34, -0.86), V(0.06, 5.45, -0.93)], 0.006, { tension: 0.4 }));
    const pl = KIT.createPlacard({ text: 'DO NOT USE AS HANDHOLD', width: 0.07, height: 0.01, bg: '#e8e4d8', fg: '#a01a12' });
    pl.position.set(0, 5.5, -0.93);
    pl.rotation.x = -0.3;
    group.add(pl);
  }

  // ------------------------------------------------------------------ COAS (overhead window)
  const coas = new THREE.Group();
  {
    const ow = W.overhead;
    // stowed on its bracket on the OUTBOARD side of the window well (clear of the floodlight)
    const base = V(ow.center.x - ow.width / 2 - 0.045, CAB.ceilingY - 0.02, ow.center.z);
    const cb = new Batch('coas');
    cb.add('darkMetal', boxFromTo(base.clone().add(V(-0.02, -0.02, -0.03)), base.clone().add(V(0.02, 0.02, 0.03))));
    const body0 = base.clone().add(V(0, -0.04, 0));
    const body1 = base.clone().add(V(0, -0.2, 0));
    cb.add('console', cylBetween(body0, body1, 0.03, 0.03, 20));
    cb.add('black', cylBetween(body1, body1.clone().add(V(0, -0.03, 0)), 0.022, 0.022, 20));
    cb.add('darkMetal', cylBetween(body0, body0.clone().add(V(0, 0.02, 0)), 0.034, 0.034, 20));
    cb.add('blackKnob', cylBetween(body0.clone().add(V(-0.03, -0.06, 0)), body0.clone().add(V(-0.045, -0.06, 0)), 0.012, 0.012, 14));
    coas.add(cb.build((k) => (k === 'blackKnob' ? KIT.getMaterial('blackKnob') : mat(k))));
    group.add(coas);
  }

  // ------------------------------------------------------------------ flood & utility lights
  const floods = [];
  for (const s of [-1, 1]) {
    // fixtures lie fore-aft between the overhead window and the AOT
    const c = V(s * 0.15, CAB.ceilingY, -0.72);
    b.add('black', boxFromTo(c.clone().add(V(-0.05, -0.035, -0.12)), c.clone().add(V(0.05, 0, 0.12))));
    b.add('darkMetal', boxFromTo(c.clone().add(V(-0.055, -0.04, -0.125)), c.clone().add(V(-0.045, -0.034, 0.125))));
    b.add('darkMetal', boxFromTo(c.clone().add(V(0.045, -0.04, -0.125)), c.clone().add(V(0.055, -0.034, 0.125))));
    const lens = new THREE.Mesh(boxFromTo(c.clone().add(V(-0.04, -0.041, -0.11)), c.clone().add(V(0.04, -0.036, 0.11))), mat('floodLens'));
    lens.castShadow = false;
    lens.receiveShadow = false;
    group.add(lens);
    floods.push({ position: c.clone().add(V(0, -0.09, 0.02)), lens });
  }
  // aft flood (midsection ceiling, aft of the tunnel)
  {
    const c = V(0, CAB.ceilingY, 0.78);
    b.add('black', boxFromTo(c.clone().add(V(-0.1, -0.035, -0.045)), c.clone().add(V(0.1, 0, 0.045))));
    const lens = new THREE.Mesh(boxFromTo(c.clone().add(V(-0.09, -0.041, -0.035)), c.clone().add(V(0.09, -0.036, 0.035))), mat('floodLens'));
    lens.castShadow = false;
    group.add(lens);
    floods.push({ position: c.clone().add(V(0, -0.1, 0)), lens, aft: true });
  }
  const utility = [];
  for (const s of [-1, 1]) {
    const m = V(s * 0.6, CAB.ceilingY - 0.02, -0.3);
    b.add('darkMetal', cylBetween(m, m.clone().add(V(0, -0.06, 0)), 0.008, 0.008, 8));
    const head0 = m.clone().add(V(0, -0.06, 0));
    const head1 = head0.clone().add(V(-s * 0.03, -0.04, -0.07));
    b.add('console', cylBetween(head0, head1, 0.022, 0.028, 16));
    b.add('floodLensStatic', cylBetween(head1, head1.clone().add(V(-s * 0.003, -0.004, -0.008)), 0.024, 0.024, 16));
    utility.push(head1);
  }

  // ------------------------------------------------------------------ wire bundles
  const bundle = (pts, r) => {
    b.add('wire', tube(pts, r, { radial: 10, uvLen: 0.05, tension: 0.4 }));
    // cable clamps
    for (let i = 1; i < pts.length - 1; i++) b.add('darkMetal', cylBetween(pts[i].clone().add(V(0, 0.012, 0)), pts[i].clone().add(V(0, 0.022, 0)), r * 1.25, r * 1.25, 10));
  };
  for (const s of [-1, 1]) {
    // along the ceiling band edges from above the CB panels to the aft
    bundle([V(s * 0.71, 5.575, -0.92), V(s * 0.71, 5.58, -0.5), V(s * 0.71, 5.585, 0.0), V(s * 0.71, 5.58, 0.5), V(s * 0.72, 5.56, 1.15)], 0.022);
    bundle([V(s * 0.76, 5.56, -0.9), V(s * 0.765, 5.56, -0.3), V(s * 0.775, 5.55, 0.4), V(s * 0.79, 5.5, 1.1)], 0.014);
    // down the B-pillar behind the crew
    bundle([V(s * 0.9, 5.47, -0.235), V(s * 1.05, 5.12, -0.24), V(s * 1.115, 4.75, -0.24), V(s * 1.105, 4.25, -0.24), V(s * 0.98, 3.83, -0.24)], 0.016);
    // short bundle into the top of panel 11/16
    bundle([V(s * 0.8, 5.52, -0.85), V(s * 0.86, 5.49, -0.82), V(s * 0.9, 5.46, -0.78)], 0.012);
  }
  // across the ceiling in front of the tunnel
  bundle([V(-0.62, 5.6, -0.49), V(-0.2, 5.605, -0.5), V(0.2, 5.605, -0.5), V(0.62, 5.6, -0.49)], 0.013);

  // ------------------------------------------------------------------ suit umbilicals & hoses
  {
    // connector block on the right rack front face (ECS suit loop outlets)
    const cb = V(0.95, 4.32, CAB.rearZ);
    b.add('console', boxFromTo(cb.clone().add(V(-0.13, -0.09, -0.02)), cb.clone().add(V(0.13, 0.09, 0))));
    const conns = [];
    for (let i = 0; i < 4; i++) {
      const p = cb.clone().add(V(-0.09 + i * 0.06, 0.02, -0.02));
      b.add('connector', cylBetween(p, p.clone().add(V(0, 0, -0.05)), 0.028, 0.028, 18));
      b.add(i % 2 ? 'red' : 'hoseBlue', cylBetween(p.clone().add(V(0, 0, -0.05)), p.clone().add(V(0, 0, -0.056)), 0.029, 0.029, 18));
      conns.push(p.clone().add(V(0, 0, -0.06)));
    }
    const hose = (a, pts, key) => {
      b.add(key, tube([a, ...pts], 0.019, { radial: 12, uvLen: 0.05, tension: 0.45 }));
      const end = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const d = end.clone().sub(prev).normalize();
      b.add('connector', cylBetween(end, end.clone().addScaledVector(d, 0.07), 0.026, 0.026, 16));
      b.add('darkMetal', cylBetween(end.clone().addScaledVector(d, 0.07), end.clone().addScaledVector(d, 0.085), 0.022, 0.022, 16));
    };
    // LMP pair: loops down and is clipped to the right wall at hip height
    hose(conns[2], [conns[2].clone().add(V(0.01, -0.05, -0.12)), V(1.02, 3.9, -0.45), V(1.07, 3.86, -0.62), V(1.08, 4.05, -0.8), V(1.06, 4.2, -0.9)], 'hoseBlue');
    hose(conns[3], [conns[3].clone().add(V(0.0, -0.05, -0.12)), V(1.08, 3.93, -0.42), V(1.12, 3.95, -0.6), V(1.12, 4.12, -0.78), V(1.1, 4.24, -0.86)], 'hoseGrey');
    // CDR pair: across the aft of the cabin floor to the left side, up to its stowage clip
    hose(conns[0], [conns[0].clone().add(V(-0.02, -0.08, -0.1)), V(0.6, 3.56, -0.3), V(0.0, 3.5, -0.26), V(-0.6, 3.56, -0.32), V(-0.98, 3.9, -0.44), V(-1.06, 4.12, -0.55)], 'hoseBlue');
    hose(conns[1], [conns[1].clone().add(V(-0.02, -0.08, -0.1)), V(0.58, 3.55, -0.24), V(0.0, 3.49, -0.21), V(-0.62, 3.55, -0.26), V(-1.02, 3.92, -0.38), V(-1.1, 4.14, -0.48)], 'hoseGrey');
    // hose clips on the side walls
    for (const s of [-1, 1]) b.add('darkMetal', boxFromTo(V(s * 1.12 - 0.02, 4.1, -0.62), V(s * 1.15, 4.2, -0.52)));
    // comm cables (thin, black) with their plugs
    b.add('cable', tube([V(0.99, 4.4, CAB.rearZ - 0.02), V(0.9, 4.2, -0.3), V(0.7, 3.62, -0.5), V(0.62, 3.9, -0.75), V(0.7, 4.3, -0.8)], 0.006, { radial: 6 }));
    b.add('cable', tube([V(0.93, 4.4, CAB.rearZ - 0.02), V(0.6, 3.6, -0.4), V(-0.4, 3.5, -0.5), V(-0.7, 3.8, -0.8), V(-0.72, 4.18, -0.8)], 0.006, { radial: 6 }));
    // suit isolation valves (big knurled handles) above the connectors
    for (const x of [0.88, 1.02]) {
      const p = V(x, 4.55, CAB.rearZ);
      b.add('darkMetal', cylBetween(p, p.clone().add(V(0, 0, -0.03)), 0.035, 0.035, 20));
      b.add('red', boxFromTo(p.clone().add(V(-0.045, -0.009, -0.045)), p.clone().add(V(0.045, 0.009, -0.03))));
    }
    const pl = KIT.createPlacard({ text: 'SUIT ISOL  CDR    LMP', width: 0.2, height: 0.012, bg: '#5d6062' });
    pl.position.set(0.95, 4.62, CAB.rearZ - 0.001);
    pl.rotation.y = Math.PI;
    group.add(pl);
  }

  // ------------------------------------------------------------------ stowage: left rack & aft
  const bag = (c, w, h, d, key = 'beta', r = 0.03) => b.add(key, boxUV(roundBox(w, h, d, r, 3), 1).translate(c.x, c.y, c.z));
  // left rack inboard face (faces +X): ISA, LiOH stowage, data file, helmet bags
  {
    const x = -CAB.rackX;
    const bagsL = [
      [V(x + 0.07, 4.25, 0.35), 0.14, 0.62, 0.6, 'betaWhite', 0.014], // ISA
      [V(x + 0.05, 4.95, 0.2), 0.1, 0.34, 0.5, 'beta', 0.01],
      [V(x + 0.055, 4.93, 0.82), 0.11, 0.38, 0.52, 'beta', 0.01],
      [V(x + 0.045, 5.3, 0.55), 0.09, 0.25, 0.9, 'betaWhite', 0.01],
      [V(x + 0.045, 3.95, 0.95), 0.09, 0.35, 0.36, 'beta', 0.01],
    ];
    for (const [c, w, h, d, key, r] of bagsL) {
      const g = roundBox(d, h, w, r, 3); // extruded along Z: width d along x-local; rotate so depth is along X
      g.rotateY(Math.PI / 2);
      g.translate(c.x, c.y, c.z);
      b.add(key, boxUV(g, 1));
    }
    // snap fasteners and zip lines on the bags
    for (const [c, w, h, d] of bagsL) {
      for (const dz of [-d / 2 + 0.03, d / 2 - 0.03]) {
        for (const dy of [h / 2 - 0.03, -h / 2 + 0.03]) {
          b.add('metal', cylBetween(V(c.x + w / 2, c.y + dy, c.z + dz), V(c.x + w / 2 + 0.004, c.y + dy, c.z + dz), 0.0045, 0.0045, 8));
        }
      }
      b.add('strap', boxFromTo(V(c.x + w / 2, c.y + h / 2 - 0.012, c.z - d / 2 + 0.01), V(c.x + w / 2 + 0.003, c.y + h / 2 - 0.006, c.z + d / 2 - 0.01)));
    }
    // bungee cords across the ISA (yellowish elastic with hooks)
    for (const y of [4.05, 4.45]) b.add('yellow', tube(sag(V(x + 0.15, y, 0.02), V(x + 0.15, y + 0.02, 0.68), 0.01, 8), 0.0045, { radial: 6 }));
    for (const [y, z] of [[4.05, 0.0], [4.47, 0.7], [4.45, 0.0], [4.07, 0.7]]) b.add('metal', boxFromTo(V(x + 0.001, y - 0.01, z - 0.01), V(x + 0.02, y + 0.01, z + 0.01)));
  }
  // right rack above the ECS panel: stowage bag + water dispenser
  {
    const x = CAB.rackX;
    const g = roundBox(0.62, 0.3, 0.1, 0.016, 3);
    g.rotateY(Math.PI / 2);
    g.translate(x - 0.05, 5.1, 0.45);
    b.add('beta', boxUV(g, 1));
    // water gun: nozzle on a bracket with its hose
    const wg = V(x - 0.03, 4.85, 1.0);
    b.add('console', boxFromTo(wg.clone().add(V(-0.03, -0.05, -0.03)), wg.clone().add(V(0.0, 0.05, 0.03))));
    b.add('metal', cylBetween(wg.clone().add(V(-0.03, 0.0, 0)), wg.clone().add(V(-0.11, -0.03, 0)), 0.012, 0.009, 12));
    b.add('cable', tube([wg.clone().add(V(-0.02, -0.05, 0)), wg.clone().add(V(-0.05, -0.2, -0.05)), wg.clone().add(V(-0.02, -0.35, 0.05)), V(x, 4.3, 1.1)], 0.007, { radial: 6 }));
    // LiOH canister access (PRIM / SEC) below the ECS panel: round caps with T-handles
    for (const [z, t] of [[0.2, 'PRIM'], [0.62, 'SEC']]) {
      const c = V(x, 4.02, z);
      b.add('console', cylBetween(c, c.clone().add(V(-0.02, 0, 0)), 0.085, 0.085, 28));
      b.add('darkMetal', cylBetween(c.clone().add(V(-0.02, 0, 0)), c.clone().add(V(-0.03, 0, 0)), 0.07, 0.07, 28));
      b.add('metal', boxFromTo(c.clone().add(V(-0.05, -0.008, -0.055)), c.clone().add(V(-0.03, 0.008, 0.055))));
      b.add('metal', cylBetween(c.clone().add(V(-0.03, 0, 0)), c.clone().add(V(-0.05, 0, 0)), 0.01, 0.01, 10));
      const pl = KIT.createPlacard({ text: `LiOH ${t}`, width: 0.06, height: 0.011, bg: '#5d6062' });
      pl.position.set(x - 0.001, 4.13, z);
      pl.rotation.y = -Math.PI / 2;
      group.add(pl);
    }
    const pl = KIT.createLabelStrip({ text: 'WATER DISPENSER', width: 0.07, height: 0.01 });
    pl.position.set(x - 0.002, 4.93, 1.0);
    pl.rotation.y = -Math.PI / 2;
    group.add(pl);
  }
  // ECS plumbing on the right rack: suit-loop ducts, O2 / water lines, suit fan and glycol pump
  {
    const x = CAB.rackX;
    const duct = (pts, r = 0.032) => {
      b.add('metal', tube(pts, r, { radial: 14, tension: 0.15 }));
      for (let i = 1; i < pts.length - 1; i++) {
        const d = pts[i + 1].clone().sub(pts[i - 1]).normalize();
        b.add('darkMetal', cylBetween(pts[i].clone().addScaledVector(d, -0.012), pts[i].clone().addScaledVector(d, 0.012), r * 1.18, r * 1.18, 14));
      }
    };
    // two vertical suit-loop ducts aft of the ECS panel, turning into the aft bulkhead at the top
    duct([V(x - 0.045, CAB.midFloorY, 0.86), V(x - 0.045, 4.4, 0.86), V(x - 0.045, 5.3, 0.87), V(x - 0.02, 5.38, 1.05), V(x - 0.01, 5.39, 1.19)]);
    duct([V(x - 0.04, CAB.midFloorY, 0.96), V(x - 0.04, 4.6, 0.96), V(x - 0.04, 5.25, 0.97), V(x - 0.015, 5.3, 1.1), V(x - 0.01, 5.3, 1.19)], 0.026);
    // horizontal duct under the stowage bag, to the suit fan at the front of the rack
    duct([V(x - 0.04, 4.82, 0.86), V(x - 0.04, 4.82, 0.4), V(x - 0.045, 4.82, 0.0), V(x - 0.07, 4.8, -0.1)], 0.028);
    // suit fan housing (cylindrical, with its motor) at the forward end
    const fan = V(x - 0.09, 4.8, -0.1);
    b.add('console', cylBetween(fan.clone().add(V(0, 0, -0.06)), fan.clone().add(V(0, 0, 0.06)), 0.07, 0.07, 24));
    b.add('structure', cylBetween(fan.clone().add(V(0, 0, -0.07)), fan.clone().add(V(0, 0, -0.06)), 0.074, 0.074, 24));
    b.add('structure', cylBetween(fan.clone().add(V(0, 0, 0.06)), fan.clone().add(V(0, 0, 0.07)), 0.074, 0.074, 24));
    // motor end bell with its electrical connector, and two saddle brackets bolted to the rack face
    b.add('console', cylBetween(fan.clone().add(V(0, 0, -0.07)), fan.clone().add(V(0, 0, -0.1)), 0.045, 0.04, 20));
    b.add('connector', cylBetween(fan.clone().add(V(-0.02, 0.04, -0.085)), fan.clone().add(V(-0.02, 0.07, -0.085)), 0.011, 0.011, 10));
    for (const dz of [-0.04, 0.04]) {
      b.add('strap', new THREE.TorusGeometry(0.073, 0.004, 6, 28).translate(fan.x, fan.y, fan.z + dz));
      b.add('darkMetal', boxFromTo(V(fan.x + 0.05, fan.y - 0.012, fan.z + dz - 0.008), V(x, fan.y + 0.012, fan.z + dz + 0.008)));
    }
    const fanLab = KIT.createLabelStrip({ text: 'SUIT FAN', width: 0.05, height: 0.01 });
    fanLab.position.set(fan.x - 0.071, fan.y, fan.z);
    fanLab.rotation.y = -Math.PI / 2;
    group.add(fanLab);
    // O2 and water lines: thin tubes along the rack face with bends and fittings
    const line = (pts, key = 'metal', r = 0.0055) => {
      b.add(key, tube(pts, r, { radial: 8, tension: 0.2 }));
      for (const p of [pts[0], pts[pts.length - 1]]) b.add('connector', cylBetween(p.clone().add(V(0.004, 0, 0)), p.clone().add(V(-0.014, 0, 0)), r * 2, r * 2, 10));
    };
    line([V(x - 0.012, 4.29, 0.55), V(x - 0.012, 4.2, 0.55), V(x - 0.012, 4.14, 0.45), V(x - 0.012, 4.14, 0.3)]);
    line([V(x - 0.012, 4.29, 0.62), V(x - 0.012, 4.17, 0.64), V(x - 0.012, 3.9, 0.7), V(x - 0.012, 3.84, 0.92)]);
    line([V(x - 0.012, 4.71, 0.2), V(x - 0.012, 4.76, 0.18), V(x - 0.02, 4.76, -0.05)], 'metal', 0.005);
    line([V(x - 0.012, 4.71, 0.66), V(x - 0.012, 4.78, 0.7), V(x - 0.02, 4.9, 0.95), V(x - 0.03, 4.9, 1.0)], 'metal', 0.005);
    line([V(x - 0.012, 3.82, 0.05), V(x - 0.012, 3.95, 0.05), V(x - 0.012, 3.97, 0.12)], 'red', 0.006);
    // glycol pump package low and aft
    const gp = V(x - 0.08, CAB.midFloorY + 0.1, 1.06);
    b.add('console', boxUV(roundBox(0.12, 0.2, 0.18, 0.015, 2), 2).translate(gp.x, gp.y, gp.z));
    b.add('darkMetal', cylBetween(gp.clone().add(V(-0.06, 0.02, 0)), gp.clone().add(V(-0.1, 0.02, 0)), 0.045, 0.045, 18));
    const gpLab = KIT.createLabelStrip({ text: 'GLYCOL PUMP', width: 0.06, height: 0.01 });
    gpLab.position.set(gp.x - 0.061, gp.y + 0.07, gp.z);
    gpLab.rotation.y = -Math.PI / 2;
    group.add(gpLab);
  }

  // aft bulkhead: two PLSS backpacks with the OPS on top, strapped down; lockers above
  for (const [s, who] of [[-1, 'CDR'], [1, 'LMP']]) {
    const c = V(s * 0.5, CAB.midFloorY + 0.34, CAB.aftZ - 0.15);
    const plss = roundBox(0.46, 0.66, 0.24, 0.032, 4);
    plss.translate(c.x, c.y, c.z);
    b.add('betaWhite', boxUV(plss, 1));
    // OPS (oxygen purge system) on top
    const ops = roundBox(0.4, 0.2, 0.22, 0.035, 4);
    ops.translate(c.x, c.y + 0.44, c.z + 0.005);
    b.add('betaWhite', boxUV(ops, 1));
    // OPS actuator / regulator and PLSS fittings (blue O2 / red water)
    b.add('connector', cylBetween(V(c.x - s * 0.12, c.y + 0.45, c.z - 0.11), V(c.x - s * 0.12, c.y + 0.45, c.z - 0.14), 0.02, 0.02, 14));
    b.add('hoseBlue', cylBetween(V(c.x - 0.08, c.y + 0.2, c.z - 0.12), V(c.x - 0.08, c.y + 0.2, c.z - 0.15), 0.02, 0.02, 14));
    b.add('red', cylBetween(V(c.x + 0.06, c.y + 0.2, c.z - 0.12), V(c.x + 0.06, c.y + 0.2, c.z - 0.15), 0.02, 0.02, 14));
    b.add('darkMetal', cylBetween(V(c.x - 0.15, c.y - 0.2, c.z - 0.12), V(c.x - 0.15, c.y - 0.2, c.z - 0.14), 0.016, 0.016, 12));
    // tie-down straps
    for (const dy of [-0.18, 0.12]) b.add('strap', boxFromTo(V(c.x - 0.245, c.y + dy - 0.02, c.z - 0.125), V(c.x + 0.245, c.y + dy + 0.02, c.z - 0.118)));
    for (const dx of [-0.245, 0.24]) b.add('metal', boxFromTo(V(c.x + dx, c.y - 0.2, c.z - 0.126), V(c.x + dx + 0.006, c.y + 0.14, c.z - 0.118)));
    const lab = KIT.createLabelStrip({ text: `PLSS  (${who})`, width: 0.08, height: 0.012 });
    lab.position.set(c.x, c.y + 0.26, c.z - 0.121);
    lab.rotation.y = Math.PI;
    group.add(lab);
    // lockers above the PLSS
    const lk = roundBox(0.5, 0.42, 0.3, 0.014, 3);
    lk.translate(s * 0.5, 5.12, CAB.aftZ - 0.15);
    b.add('beta', boxUV(lk, 1));
    for (const dx of [-0.2, 0.2]) b.add('velcro', boxFromTo(V(s * 0.5 + dx - 0.02, 5.22, CAB.aftZ - 0.3 - 0.002), V(s * 0.5 + dx + 0.02, 5.26, CAB.aftZ - 0.3)));
  }
  // hammocks rolled against the aft ceiling
  b.add('beta', cylBetween(V(-0.62, 5.52, 1.1), V(0.62, 5.52, 1.1), 0.06, 0.06, 18));
  for (const x of [-0.4, 0.0, 0.4]) {
    const ring = new THREE.TorusGeometry(0.062, 0.005, 6, 18);
    ring.rotateY(Math.PI / 2);
    ring.translate(x, 5.52, 1.1);
    b.add('strap', ring);
  }
  // stowage beside the forward hatch at knee level (below panels 5 / 6)
  for (const s of [-1, 1]) {
    const g = roundBox(0.28, 0.3, 0.12, 0.014, 3);
    g.translate(s * 0.58, 3.63, CAB.frontZ + 0.08);
    b.add('beta', boxUV(g, 1));
    b.add('velcro', boxFromTo(V(s * 0.58 - 0.05, 3.72, CAB.frontZ + 0.14), V(s * 0.58 + 0.05, 3.74, CAB.frontZ + 0.1405)));
  }

  // ------------------------------------------------------------------ crew restraints
  for (const s of [-1, 1]) {
    for (const dx of [-0.2, 0.2]) {
      const reel = V(s * 0.4 + dx, CAB.floorY + 0.02, -0.72);
      b.add('console', boxFromTo(reel.clone().add(V(-0.04, -0.02, -0.04)), reel.clone().add(V(0.04, 0.03, 0.04))));
      b.add('darkMetal', cylBetween(reel.clone().add(V(-0.03, 0.03, 0)), reel.clone().add(V(0.03, 0.03, 0)), 0.012, 0.012, 12));
    }
    // cables from the outboard reels up to their stowage hooks on the side consoles
    const reelO = V(s * 0.6, CAB.floorY + 0.05, -0.72);
    const hook = V(s * 0.99, 4.3, -0.62);
    b.add('cable', tube(sag(reelO, hook, 0.08, 10, V(0, 0, 0.03)), 0.004, { radial: 6 }));
    const dring = new THREE.TorusGeometry(0.018, 0.0035, 6, 16);
    dring.translate(hook.x, hook.y - 0.02, hook.z);
    b.add('metal', dring);
    const reelI = V(s * 0.2, CAB.floorY + 0.05, -0.72);
    const hook2 = V(s * 0.14, 3.95, -1.02);
    b.add('cable', tube(sag(reelI, hook2, 0.05, 8), 0.004, { radial: 6 }));
    // bungee between the side console and the lower wall (tethers the restraint when unused)
    b.add('yellow', tube(sag(V(s * 1.0, 4.2, -0.9), V(s * 1.02, 4.22, -0.45), 0.05, 8), 0.004, { radial: 6 }));
  }
  // Velcro foot pads and tie-down rings on the floor
  for (const s of [-1, 1]) {
    b.add('velcro', boxFromTo(V(s * 0.4 - 0.11, CAB.floorY, -0.98), V(s * 0.4 + 0.11, CAB.floorY + 0.003, -0.58)));
    for (const z of [-1.1, -0.4]) {
      const ring = new THREE.TorusGeometry(0.02, 0.004, 6, 14);
      ring.rotateX(Math.PI / 2);
      ring.translate(s * 0.45, CAB.floorY + 0.006, z);
      b.add('metal', ring);
    }
  }
  // Velcro patches on walls (for stowing small items)
  for (const [c, w, h, ax] of [
    [V(-1.12, 4.95, -0.62), 0.12, 0.04, 'x'],
    [V(1.12, 4.95, -0.66), 0.12, 0.04, 'x'],
    [V(-0.6, 5.635, -0.2), 0.1, 0.1, 'y'],
    [V(0.95, 4.95, CAB.rearZ - 0.001), 0.14, 0.05, 'z'],
    [V(-0.95, 4.95, CAB.rearZ - 0.001), 0.14, 0.05, 'z'],
  ]) {
    const t = 0.003;
    const d = ax === 'x' ? V(t, h, w) : ax === 'y' ? V(w, t, h) : V(w, h, t);
    b.add('velcro', boxFromTo(c.clone().sub(d.clone().multiplyScalar(0.5)), c.clone().add(d.clone().multiplyScalar(0.5))));
  }

  // ------------------------------------------------------------------ checklists & flight data file
  const card = (opts, pos, rotY, rotX = 0, rotZ = 0) => {
    const cc = KIT.createChecklistCard(opts);
    cc.position.copy(pos);
    cc.rotation.set(rotX, rotY, rotZ, 'YXZ');
    group.add(cc);
    return cc;
  };
  card({
    title: 'LM DESCENT CUE CARD',
    width: 0.1,
    height: 0.13,
    lines: ['PDI  +00:00  THROT UP  26 SEC', '  P63  V16N68  RANGE', '+02:00  YAW TO FACE UP', '+04:00  RADAR ALT DATA GOOD', { rule: true }, 'HI GATE  P64  7400 FT', '  LPD  V06N64', 'LO GATE  500 FT  P66', '  ROD  1 FT/S/CLICK', { rule: true }, 'CONTACT  ENG STOP', '  ENG ARM - OFF', '  413 IS IN'],
    seed: 3,
  }, V(-0.9, 4.82, -0.84), 0.95, 0, 0);
  card({
    title: 'LM ASCENT CUE CARD',
    width: 0.1,
    height: 0.13,
    lines: ['TIG -5:00  V21N01 1605', 'TIG -2:00  ENG ARM ASC', 'TIG -0:05  ABORT STAGE', 'TIG  PRO  (P12)', { rule: true }, '+00:10  PITCHOVER', '+03:00  V82  HA/HP', '+07:15  SECO 5537 FPS', { rule: true }, 'INSERTION  9 X 45 NM', '  RCS TRIM  V83'],
    seed: 7,
  }, V(0.9, 4.82, -0.84), -0.95, 0, 0);
  // flight data file on the left rack front face
  {
    const fdf = new Batch('fdf');
    fdf.add('pad', boxUV(roundBox(0.16, 0.22, 0.04, 0.006, 2), 4).translate(-0.99, 4.72, CAB.rearZ - 0.025));
    fdf.add('white', boxFromTo(V(-1.065, 4.615, CAB.rearZ - 0.04), V(-0.915, 4.825, CAB.rearZ - 0.043)));
    group.add(fdf.build((k) => mat(k)));
    const lab = KIT.createLabelStrip({ text: 'FLIGHT DATA FILE', width: 0.11, height: 0.012 });
    lab.position.set(-0.99, 4.86, CAB.rearZ - 0.002);
    lab.rotation.y = Math.PI;
    group.add(lab);
    card({ title: 'LM ACTIVATION CHECKLIST', width: 0.1, height: 0.13, lines: ['CB (11) ALL - CLOSE', 'CB (16) AS REQD', 'ECS - SUIT FAN 1', 'EPS - DES BATS ON', '  HI V TAP', { rule: true }, 'IMU - OPR', 'PGNS TURN ON', '  V35E LAMP TEST', 'AGS INIT  400+30000'], seed: 11 }, V(-0.99, 4.45, CAB.rearZ - 0.004), Math.PI, 0.05, 0.02);
  }

  // ------------------------------------------------------------------ placards & labels
  const lab = (text, pos, rotY, w = 0.08, h = 0.012, o = {}) => {
    const l = KIT.createLabelStrip({ text, width: w, height: h, ...o });
    l.position.copy(pos);
    l.rotation.y = rotY;
    group.add(l);
  };
  lab('ISA', V(-CAB.rackX + 0.145, 4.62, 0.35), Math.PI / 2, 0.04);
  lab('LiOH STOWAGE', V(-CAB.rackX + 0.105, 5.14, 0.2), Math.PI / 2, 0.07);
  lab('HELMET BAGS', V(-CAB.rackX + 0.105, 5.43, 0.55), Math.PI / 2, 0.07);
  lab('OPS', V(-0.5, CAB.midFloorY + 0.8, CAB.aftZ - 0.261), Math.PI, 0.03);
  lab('OPS', V(0.5, CAB.midFloorY + 0.8, CAB.aftZ - 0.261), Math.PI, 0.03);
  lab('FOOD', V(-0.5, 5.2, CAB.aftZ - 0.301), Math.PI, 0.04);
  lab('JETTISON BAG', V(0.5, 5.2, CAB.aftZ - 0.301), Math.PI, 0.07);
  {
    const c1 = KIT.createPlacard({ text: 'CAUTION — DO NOT STEP ON ENGINE COVER', width: 0.2, height: 0.014, bg: '#e8e4d8', fg: '#a01a12' });
    c1.position.set(0, CAB.engineCover.topY + 0.028, CAB.engineCover.z);
    c1.rotation.x = -Math.PI / 2;
    group.add(c1);
    const c2 = KIT.createPlacard({ text: 'CABIN RELIEF & DUMP', width: 0.1, height: 0.012, bg: '#5d6062' });
    c2.position.set(LM.forwardHatch.center.x + 0.12, LM.forwardHatch.center.y + 0.33, CAB.frontZ + 0.052);
    group.add(c2);
    const c3 = KIT.createPlacard({ text: 'HATCH  ▲ OPEN', width: 0.07, height: 0.012, bg: '#5d6062' });
    c3.position.set(LM.forwardHatch.center.x - 0.3, LM.forwardHatch.center.y - 0.25, CAB.frontZ + 0.052);
    group.add(c3);
  }

  const built = b.build((k) => (k === 'blackKnob' ? KIT.getMaterial('blackKnob') : k === 'floodLensStatic' ? mat('floodLens') : mat(k)));
  group.add(built);
  KIT.setLayerRecursive(group);
  return { group, floods, coas, utility };
}
