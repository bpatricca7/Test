// Apollo 11 LM descent stage — procedural exterior with landing gear.
//
// Structure (LM.descentStage): an octagon 4.22 m across flats from y = 1.35 to 3.10. The cruciform
// main beams end in the four AXIS faces (forward/right/aft/left), which carry the landing-gear
// outriggers; the four DIAGONAL faces are the equipment quadrant bays (recessed):
//   forward-right (+X,-Z): MESA (Modular Equipment Stowage Assembly — TV camera, tools, rock boxes)
//   forward-left  (-X,-Z): "UNITED STATES" + flag panel
//   aft-left      (-X,+Z): Scientific Equipment (SEQ) bay door (EASEP on Apollo 11)
//   aft-right     (+X,+Z): foil-covered tanks / S-band erectable antenna stowage
// Everything is wrapped in thermal blankets: gold/amber aluminized Kapton above, black H-film and
// Inconel foil on the lower band and the base heat shield around the descent engine.
//
// Landing gear (LM.gear): primary strut (gold-wrapped outer cylinder + bare-aluminium piston that
// strokes along the same axis the physics uses), two secondary struts, deployment/downlock truss,
// dish footpads, 1.73-m lunar surface sensing probes on the aft/left/right pads, the forward leg's
// ladder, porch & handrails, and the Apollo 11 plaque on the forward strut.

import * as THREE from 'three';
import { LM, lmRcsJets } from '../../../core/constants.js';
import { Batch, V, tube, wrappedTube, lathe, box, hull, blanket, plate, alignY, boxUV } from './geom.js';

const deg = Math.PI / 180;
const TAN = Math.tan(22.5 * deg);

/**
 * Landing-gear geometry for one leg (pure numbers, shared with tests).
 * All points are in the LM body frame with the gear uncompressed.
 * @param {THREE.Vector3} dir unit horizontal leg direction
 */
export function legGeometry(dir) {
  const g = LM.gear;
  const u = dir.clone().setY(0).normalize();
  const lat = new THREE.Vector3(0, 1, 0).cross(u); // lateral axis (up x radial)
  const P = (R, Y, L = 0) => u.clone().multiplyScalar(R).add(new THREE.Vector3(0, Y, 0)).addScaledVector(lat, L);
  const pad = P(g.padCenterRadius, 0); // footpad bottom centre
  const top = P(g.strutTopRadius, g.strutTopY);
  // stroke direction exactly as the physics (sim/contact.js): from the pad toward the upper attachment
  const stroke = top.clone().sub(pad).normalize();
  const joint = pad.clone().add(new THREE.Vector3(0, 0.2, 0)); // ball joint in the pad
  const tTop = (g.strutTopY - joint.y) / stroke.y; // strut length joint -> upper fitting
  const T = joint.clone().addScaledVector(stroke, tTop);
  const tS = tTop - 2.2; // outer cylinder is 2.2 m long
  const S = joint.clone().addScaledVector(stroke, tS);
  // outward normal of the strut in the leg plane (ladder side)
  const n = u.clone().multiplyScalar(stroke.y).add(new THREE.Vector3(0, -stroke.dot(u), 0)).normalize();
  return { u, lat, P, pad, top, stroke, joint, T, S, tTop, tS, n };
}

/**
 * Build the descent stage.
 * @param {Object<string, THREE.Material>} M materials
 * @returns {{group: THREE.Group, legs: Array<{id: string, lower: THREE.Group, stroke: THREE.Vector3, probe: THREE.Object3D|null, probeAxis: THREE.Vector3}>}}
 */
export function buildDescentStage(M) {
  const group = new THREE.Group();
  group.name = 'LM descent stage';
  const b = new Batch('descent');
  const yB = LM.descentStage.yBottom;
  const yT = LM.descentStage.yTop;
  const yBand = 1.72;

  // --------------------------------------------------------------- octagonal walls
  const face = (k, a) => {
    const phi = k * 45 * deg;
    const u = V(Math.cos(phi), 0, Math.sin(phi));
    const tt = V(u.z, 0, -u.x); // left -> right seen from outside
    const hs = a * TAN;
    const E = (s, y) => u.clone().multiplyScalar(a).addScaledVector(tt, s * hs).setY(y);
    return { u, tt, hs, E, a };
  };
  const AX = 2.08; // axis-face blanket base plane (bulge brings it to ~2.12)
  const DG = 1.99; // recessed quadrant-bay faces
  const faces = [];
  for (let k = 0; k < 8; k++) faces.push(face(k, k % 2 === 0 ? AX : DG));

  const bl = (key, p0, p1, p2, p3, o) => b.add(key, blanket(p0, p1, p2, p3, o));
  let seed = 1;
  for (let k = 0; k < 8; k++) {
    const F = faces[k];
    const E = F.E;
    // lower black H-film band
    bl('blackFoil', E(-1, yB), E(1, yB), E(1, yBand + 0.02), E(-1, yBand + 0.02), { bulge: 0.028, wrinkle: 0.02, nu: 10, nv: 4, seed: seed++ });
    if (k % 2 === 0) {
      // axis face: 2 x 2 gold blankets with offset seams
      const sm = (k === 6 ? 0.0 : 0.08 * Math.sin(k * 1.7));
      const ym = 2.38 + 0.06 * Math.cos(k * 2.3);
      const cols = [[-1, sm], [sm, 1]];
      const rows = [[yBand, ym], [ym, yT]];
      for (const [s0, s1] of cols) {
        for (const [y0, y1] of rows) {
          const key = (k === 2 && y0 > 2 && s0 < 0) || (k === 4 && y0 < 2 && s0 > -0.5) ? 'bronze' : 'gold';
          bl(key, E(s0, y0), E(s1, y0), E(s1, y1), E(s0, y1), { bulge: 0.05, wrinkle: 0.03, tuck: 0.015, nu: 12, nv: 10, sag: 0.02, seed: seed++ });
        }
      }
    } else {
      // quadrant bay: taller single-width blankets (upper/lower)
      const ym = 2.3 + 0.1 * Math.sin(k);
      bl('gold', E(-1, yBand), E(1, yBand), E(1, ym), E(-1, ym), { bulge: 0.045, wrinkle: 0.03, nu: 12, nv: 8, sag: 0.015, seed: seed++ });
      bl(k === 3 ? 'bronze' : 'gold', E(-1, ym), E(1, ym), E(1, yT), E(-1, yT), { bulge: 0.05, wrinkle: 0.03, nu: 12, nv: 8, seed: seed++ });
    }
  }
  // corner strips joining the axis faces to the recessed bays (black-wrapped corner posts)
  for (let k = 0; k < 8; k++) {
    const A = faces[k];
    const B = faces[(k + 1) % 8];
    bl('blackFoil', B.E(1, yB), A.E(-1, yB), A.E(-1, yT), B.E(1, yT), { bulge: 0.01, wrinkle: 0.008, tuck: 0.0, nu: 2, nv: 8, seed: seed++ });
  }
  // top lip (structural edge member, black-anodized) around the upper deck
  for (let k = 0; k < 8; k++) {
    const F = faces[k];
    const a = F.a + 0.035;
    const hs = a * TAN;
    const c = F.u.clone().multiplyScalar(a).setY(yT - 0.02);
    const m = new THREE.Matrix4().makeRotationY(-k * 45 * deg);
    const g = box(V(0, 0, 0), V(0.05, 0.05, 2 * hs + 0.02));
    g.applyMatrix4(m);
    g.translate(c.x, c.y, c.z);
    b.add('black', g);
  }

  // --------------------------------------------------------------- upper deck & base heat shield
  const Rv = 2.1 / Math.cos(22.5 * deg);
  b.add('blackFoil', lathe([[Rv, yT + 0.002], [1.2, yT + 0.002], [0.0, yT + 0.002]], 8, 22.5 * deg));
  // base heat shield (Inconel foil) with the engine opening
  {
    const shape = new THREE.Shape();
    const Rb = 2.07 / Math.cos(22.5 * deg);
    for (let k = 0; k < 8; k++) {
      const a = (22.5 + k * 45) * deg;
      if (k === 0) shape.moveTo(Rb * Math.cos(a), Rb * Math.sin(a));
      else shape.lineTo(Rb * Math.cos(a), Rb * Math.sin(a));
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.66, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new THREE.ShapeGeometry(shape, 24);
    g.rotateX(Math.PI / 2);
    g.translate(0, yB, 0);
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    b.add('blackFoil', ng);
    b.add('inconel', lathe([[0.66, yB - 0.004], [0.9, yB - 0.004]], 32));
    // dark cavity between the base opening and the engine
    b.add('nozzleInner', lathe([[0.25, yB + 0.45], [0.66, yB + 0.25], [0.66, yB - 0.002]], 32));
  }

  // --------------------------------------------------------------- descent engine (DPS) nozzle
  {
    const re = LM.dps.nozzleExitRadius; // 0.76
    const yE = LM.dps.nozzleExit.y; // 0.78
    const yTh = LM.dps.nozzleThroat.y; // 1.95
    const rt = 0.11;
    const r = (y) => {
      const s = (yTh - y) / (yTh - yE);
      return rt + (re - rt) * (1 - Math.pow(1 - s, 1.7));
    };
    const outer = [];
    for (let i = 0; i <= 10; i++) {
      const y = yE + (yB + 0.1 - yE) * (i / 10);
      outer.push([r(y) + 0.008, y]);
    }
    b.add('nozzleExt', lathe([[re + 0.012, yE - 0.004], ...outer], 40));
    const inner = [[0.001, yTh + 0.18], [rt * 0.9, yTh + 0.08]];
    for (let i = 0; i <= 16; i++) {
      const y = yTh - (yTh - yE) * (i / 16);
      inner.push([r(y), y]);
    }
    inner.push([re + 0.012, yE - 0.004]);
    b.add('nozzleInner', lathe(inner, 40));
    // stiffener rings on the nozzle extension
    for (const y of [0.95, 1.18]) b.add('darkMetal', lathe([[r(y) + 0.008, y - 0.012], [r(y) + 0.02, y - 0.008], [r(y) + 0.02, y + 0.008], [r(y) + 0.008, y + 0.012]], 40));
  }

  // --------------------------------------------------------------- landing radar antenna (underside)
  {
    const g = box(V(0, 0, 0), V(0.62, 0.14, 0.5));
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(-6 * deg));
    g.translate(0.05, yB - 0.08, 1.2);
    b.add('asGrey', g);
    b.add('black', box(V(0.05, yB - 0.16, 1.2), V(0.56, 0.02, 0.44)));
  }

  // --------------------------------------------------------------- leg outriggers & gear
  const legs = [];
  const lowerBatches = [];
  for (const leg of LM.gear.legs) {
    const G = legGeometry(leg.dir);
    const { u, lat, P, stroke, joint, T, S, n } = G;
    // outrigger box at the top of the axis face (gold wrapped, tapered)
    b.add('gold', hull([
      P(2.04, 2.6, -0.2), P(2.04, 2.6, 0.2), P(2.04, 3.09, -0.2), P(2.04, 3.09, 0.2),
      P(2.36, 2.7, -0.13), P(2.36, 2.7, 0.13), P(2.36, 3.05, -0.13), P(2.36, 3.05, 0.13),
    ], 1, [legs.length * 0.77, 0.3]));
    // primary strut outer cylinder (gold Kapton wrap) with metal end fittings
    b.add('goldWrap', wrappedTube(S.clone().addScaledVector(stroke, 0.06), T.clone().addScaledVector(stroke, 0.02), 0.088, 14, 24, 0.016, legs.length + 3));
    b.add('metal', tube(S.clone().addScaledVector(stroke, -0.02), S.clone().addScaledVector(stroke, 0.08), 0.088, 0.088, 16));
    b.add('darkMetal', tube(T.clone().addScaledVector(stroke, -0.04), T.clone().addScaledVector(stroke, 0.12), 0.07, 0.06, 12));
    // secondary struts to the lower corners of the axis face
    const Bp = [P(2.1, 1.45, 0.78), P(2.1, 1.45, -0.78)];
    const Sc = S.clone().addScaledVector(stroke, 0.03);
    Bp.forEach((B, i) => {
      const s0 = Sc.clone().addScaledVector(lat, i ? -0.05 : 0.05);
      b.add('goldWrap', wrappedTube(s0.clone().lerp(B, 0.06), s0.clone().lerp(B, 0.94), 0.045, 10, 14, 0.01, 50 + legs.length * 2 + i));
      b.add('metal', tube(s0, s0.clone().lerp(B, 0.07), 0.035, 0.035, 8));
      b.add('metal', tube(s0.clone().lerp(B, 0.93), B, 0.035, 0.035, 8));
      b.add('darkMetal', box(B, V(0.1, 0.1, 0.1), alignY(V(0, 0, 0), V(0, 1, 0))));
    });
    // deployment & downlock truss
    const Q = Bp.map((B) => Sc.clone().lerp(B, 0.45));
    b.add('metal', tube(Q[0], Q[1], 0.02, 0.02, 8));
    Q.forEach((q, i) => b.add('black', tube(q, P(2.1, 1.95, i ? -0.42 : 0.42), 0.022, 0.022, 8)));
    const qm = Q[0].clone().lerp(Q[1], 0.5);
    b.add('metal', tube(qm, P(2.1, 2.45, 0), 0.026, 0.026, 8));
    b.add('darkMetal', box(qm, V(0.08, 0.08, 0.08)));

    // --- lower (stroking) assembly: piston, ball joint, footpad, probe ---
    const lower = new THREE.Group();
    lower.name = `LM gear ${leg.id} lower`;
    const lb = new Batch(`gear-${leg.id}`);
    lb.add('metal', tube(joint.clone().addScaledVector(stroke, 0.08), S.clone().addScaledVector(stroke, 0.9), 0.05, 0.05, 14, false));
    lb.add('darkMetal', lathe([[0.001, 0.14], [0.07, 0.16], [0.075, 0.2], [0.06, 0.25], [0.04, 0.27], [0.001, 0.28]], 16).translate(G.pad.x, 0, G.pad.z));
    // footpad: 37-in dish, foil covered
    const padProfile = [[0.001, 0.0], [0.28, 0.0], [0.37, 0.018], [0.435, 0.055], [0.465, 0.11], [0.47, 0.165], [0.458, 0.182], [0.42, 0.178], [0.3, 0.165], [0.14, 0.168], [0.08, 0.18], [0.001, 0.19]];
    const padGeo = boxUV(lathe(padProfile, 32), 1, [legs.length * 0.31, 0.17]);
    padGeo.translate(G.pad.x, 0, G.pad.z);
    lb.add('padFoil', padGeo);
    // rim band (bare metal lip)
    lb.add('metal', lathe([[0.472, 0.15], [0.476, 0.16], [0.476, 0.175], [0.462, 0.186]], 32).translate(G.pad.x, 0, G.pad.z));
    let probe = null;
    const probeAxis = u.clone();
    if (LM.gear.probeLegs.includes(leg.id)) {
      // lunar surface sensing probe: hinged at the pad rim, 1.73 m below the pad bottom
      probe = new THREE.Group();
      probe.name = `LM contact probe ${leg.id}`;
      const hinge = G.pad.clone().addScaledVector(lat, 0.5).setY(0.12);
      probe.position.copy(hinge);
      const pb = new Batch(`probe-${leg.id}`);
      const len = LM.gear.probeLength + 0.12;
      pb.add('metal', tube(V(0, 0.02, 0), V(0, -len, 0), 0.014, 0.011, 8));
      pb.add('metal', lathe([[0.001, -len - 0.02], [0.025, -len], [0.012, -len + 0.03]], 10));
      pb.add('metal', box(V(0, 0, 0), V(0.05, 0.07, 0.05)));
      pb.build(M, probe);
      lower.add(probe);
      // bracket from the pad rim to the hinge
      lb.add('darkMetal', tube(G.pad.clone().addScaledVector(lat, 0.44).setY(0.12), hinge, 0.02, 0.02, 6));
      lb.add('darkMetal', box(hinge, V(0.07, 0.05, 0.07)));
    }
    lb.build(M, lower);
    group.add(lower);
    legs.push({ id: leg.id, lower, stroke: stroke.clone(), probe, probeAxis, geom: G, fold: 0 });
    lowerBatches.push(lower);

    // --- forward leg: ladder, porch, handrails, plaque ---
    if (leg.id === 'fwd') {
      const at = (t, off, L) => joint.clone().addScaledVector(stroke, t).addScaledVector(n, off).addScaledVector(lat, L);
      const t0 = G.tS + 0.02;
      const t1 = (3.05 - joint.y - n.y * 0.19) / stroke.y;
      for (const L of [-0.23, 0.23]) {
        b.add('metal', tube(at(t0, 0.19, L), at(t1, 0.19, L), 0.017, 0.017, 8));
        // stand-off brackets to the strut
        for (const t of [t0 + 0.1, (t0 + t1) / 2, t1 - 0.25]) b.add('metal', tube(at(t, 0.07, L * 0.5), at(t, 0.19, L), 0.011, 0.011, 6));
      }
      const nR = 9;
      for (let i = 0; i < nR; i++) {
        const t = t0 + 0.14 + (i * (t1 - t0 - 0.3)) / (nR - 1);
        b.add('metal', tube(at(t, 0.19, -0.24), at(t, 0.19, 0.24), 0.015, 0.015, 8));
      }
      // porch: platform at the hatch sill, projecting over the forward face
      const pz0 = 1.27;
      const pz1 = 2.33;
      b.add('metal', hull([P(pz0, 3.1, -0.41), P(pz0, 3.1, 0.41), P(pz1, 3.1, -0.41), P(pz1, 3.1, 0.41), P(pz0, 3.135, -0.41), P(pz0, 3.135, 0.41), P(pz1, 3.135, -0.41), P(pz1, 3.135, 0.41)]));
      // anti-slip ribs on the porch
      for (let i = 0; i < 7; i++) {
        const R = pz0 + 0.1 + i * 0.14;
        b.add('darkMetal', box(V(0, 0, 0), V(0.8, 0.012, 0.025)).translate(P(R, 3.141, 0).x, 3.141, P(R, 3.141, 0).z));
      }
      // porch support struts
      for (const L of [-0.36, 0.36]) b.add('metal', tube(P(pz1 - 0.05, 3.1, L), P(2.12, 2.72, L * 0.7), 0.018, 0.018, 6));
      // handrails
      for (const L of [-0.41, 0.41]) {
        const Lo = Math.sign(L) * 0.6;
        const pts = [P(2.3, 3.14, L), P(2.24, 3.66, L * 1.1), P(1.8, 3.98, Lo), P(1.29, 3.98, Lo)];
        for (let i = 0; i < pts.length - 1; i++) b.add('metal', tube(pts[i], pts[i + 1], 0.016, 0.016, 8));
      }
      // Apollo 11 plaque on the strut, between the ladder rails
      {
        const tp = t0 + 1.04;
        const c = joint.clone().addScaledVector(stroke, tp).addScaledVector(n, 0.1);
        const w = 0.115;
        const h = 0.097;
        const e1 = lat.clone();
        const e2 = stroke.clone();
        const q = [
          c.clone().addScaledVector(e1, -w).addScaledVector(e2, -h),
          c.clone().addScaledVector(e1, w).addScaledVector(e2, -h),
          c.clone().addScaledVector(e1, w).addScaledVector(e2, h),
          c.clone().addScaledVector(e1, -w).addScaledVector(e2, h),
        ];
        const g = new THREE.BufferGeometry();
        const pos = [q[0], q[1], q[2], q[0], q[2], q[3]].flatMap((p) => [p.x, p.y, p.z]);
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
        g.computeVertexNormals();
        b.add('plaque', g);
        // backing frame
        b.add('darkMetal', plate(q.map((p) => p.clone().addScaledVector(n, -0.004)).map((p, i) => p.clone().addScaledVector(e1, i === 0 || i === 3 ? -0.01 : 0.01).addScaledVector(e2, i < 2 ? -0.01 : 0.01)), 0.012));
      }
    }
  }

  // --------------------------------------------------------------- quadrant equipment
  // forward-right bay (k = 7): MESA, stowed (folded up against the bay)
  {
    const F = faces[7];
    const a = F.a + 0.07;
    const E = (s, y, off = 0) => F.u.clone().multiplyScalar(a + off).addScaledVector(F.tt, s * F.hs).setY(y);
    b.add('silver', blanket(E(-0.62, 1.82), E(0.62, 1.82), E(0.62, 2.98), E(-0.62, 2.98), { bulge: 0.035, wrinkle: 0.012, nu: 12, nv: 12, seed: 77 }));
    b.add('black', hull([E(-0.66, 1.78, -0.08), E(0.66, 1.78, -0.08), E(-0.66, 1.78, 0.01), E(0.66, 1.78, 0.01), E(-0.66, 1.83, -0.08), E(0.66, 1.83, -0.08), E(-0.66, 1.83, 0.01), E(0.66, 1.83, 0.01)]));
    // hinge line at the bottom and the D-ring release lanyard at the top left
    b.add('metal', tube(E(-0.6, 1.8, 0.02), E(0.6, 1.8, 0.02), 0.014, 0.014, 8));
    b.add('white', lathe([[0.035, -0.006], [0.042, 0.0], [0.035, 0.006], [0.028, 0.0], [0.035, -0.006]], 12).applyMatrix4(alignY(E(-0.5, 2.9, 0.06), F.u)));
  }
  // forward-left bay (k = 5): "UNITED STATES" + flag
  {
    const F = faces[5];
    const a = F.a + 0.085;
    const E = (s, y) => F.u.clone().multiplyScalar(a).addScaledVector(F.tt, s * F.hs).setY(y);
    const w = 0.56 / 2 / F.hs;
    const q = [E(-w, 2.05), E(w, 2.05), E(w, 2.75), E(-w, 2.75)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([q[0], q[1], q[2], q[0], q[2], q[3]].flatMap((p) => [p.x, p.y, p.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    g.computeVertexNormals();
    b.add('flagPanel', g);
    b.add('black', plate(q.map((p) => p.clone().addScaledVector(F.u, -0.002)).map((p, i) => p.clone().addScaledVector(F.tt, i === 0 || i === 3 ? -0.012 : 0.012).setY(p.y + (i < 2 ? -0.012 : 0.012))), 0.03));
  }
  // aft-left bay (k = 3): SEQ bay door (black quilted, silver trim)
  {
    const F = faces[3];
    const a = F.a + 0.06;
    const E = (s, y) => F.u.clone().multiplyScalar(a).addScaledVector(F.tt, s * F.hs).setY(y);
    b.add('blackQuilt', blanket(E(-0.7, 1.85), E(0.7, 1.85), E(0.7, 2.85), E(-0.7, 2.85), { bulge: 0.03, wrinkle: 0.006, nu: 8, nv: 8, seed: 91 }));
    b.add('metal', tube(E(-0.7, 2.86), E(0.7, 2.86), 0.012, 0.012, 6));
    b.add('metal', tube(E(-0.25, 2.3), E(0.25, 2.3), 0.012, 0.012, 6));
  }
  // aft-right bay (k = 1): stowage box (S-band erectable antenna) wrapped in silver, plumbing
  {
    const F = faces[1];
    const a = F.a + 0.05;
    const E = (s, y, off = 0) => F.u.clone().multiplyScalar(a + off).addScaledVector(F.tt, s * F.hs).setY(y);
    b.add('silver', blanket(E(-0.8, 2.25), E(0.1, 2.25), E(0.1, 2.95), E(-0.8, 2.95), { bulge: 0.04, wrinkle: 0.015, nu: 10, nv: 8, seed: 93 }));
    b.add('black', hull([E(-0.84, 2.21, -0.06), E(0.14, 2.21, -0.06), E(-0.84, 2.21, 0.0), E(0.14, 2.21, 0.0), E(-0.84, 2.99, -0.06), E(0.14, 2.99, -0.06), E(-0.84, 2.99, 0.0), E(0.14, 2.99, 0.0)]));
    for (const y of [1.95, 2.02]) b.add('metal', tube(E(-0.9, y, 0.02), E(0.9, y, 0.02), 0.012, 0.012, 6));
    b.add('metal', tube(E(0.5, 1.95, 0.02), E(0.5, 2.9, 0.02), 0.012, 0.012, 6));
  }

  // --------------------------------------------------------------- RCS plume deflectors (under the quads)
  for (const j of lmRcsJets().filter((q) => q.id.endsWith('D'))) {
    const d = V(j.pos.x, 0, j.pos.z).normalize();
    const tt = V(d.z, 0, -d.x);
    const at = (R, y, s) => d.clone().multiplyScalar(R).addScaledVector(tt, s).setY(y);
    const pts = [at(2.36, 3.16, -0.16), at(2.36, 3.16, 0.16), at(2.02, 3.44, 0.13), at(2.02, 3.44, -0.13)];
    b.add('asGrey', plate(pts, 0.012));
    b.add('black', plate([at(2.37, 3.15, -0.17), at(2.37, 3.15, 0.17), at(2.34, 3.18, 0.17), at(2.34, 3.18, -0.17)], 0.02));
    for (const s of [-0.11, 0.11]) b.add('metal', tube(at(2.26, 3.23, s), at(2.05, yT, s * 0.8), 0.012, 0.012, 6));
  }

  const meshes = b.build(M, group);
  return { group, meshes, legs };
}
