// Crew couches of the Command Module (CSM-CABIN agent).
//
// Three side-by-side couches (CDR left, CMP centre, LMP right). Each: tubular aluminium frame
// (side rails following the body profile, cross members), Beta-cloth covered pads (headrest with
// helmet side supports, back, seat, leg pan), heel rests with toe straps, armrests (CDR and LMP),
// impact-attenuation struts to the aft bulkhead and side walls, and the restraint harness (lap belt
// and shoulder straps lying loose on the empty couch, with the central buckle).
import * as THREE from 'three';
import { COUCH, COUCH_X, CONTROLLERS, AFT_Z, innerRadius } from './layout.js';
import { V, Batch, roundBox, beam, cylBetween, stripBetween, tube, boxUV } from './geom.js';

/** Scale a geometry's UVs (tiling textures on 0..1-mapped boxes). */
function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** Matrix for a pad segment from a to b (y/z plane), local X = body X, local Y along a->b. */
function segMatrix(a, b, offBehind, x = 0) {
  const along = V().subVectors(b, a).normalize();
  const X = V(1, 0, 0);
  const Z = V().crossVectors(X, along); // pad front (toward the body)
  const mid = V().addVectors(a, b).multiplyScalar(0.5).addScaledVector(Z, -offBehind);
  mid.x += x;
  return { m: new THREE.Matrix4().makeBasis(X, along, Z).setPosition(mid), along, Z, len: a.distanceTo(b) };
}

/** Beta-cloth pad as a softly rounded box between a and b, width w (pad front toward the body). */
function pad(B, a, b, w, t, x, key = 'beta') {
  const s = segMatrix(a, b, t / 2, x);
  // box-projected UVs (0.1 m weave tile on every face: no streaks on the rounded edges)
  const g = boxUV(roundBox(w, s.len, t, 0.02, 0.012, 4), 0.1);
  B.add(key, g, s.m);
  // stitched piping around the front face
  const e = 0.004;
  for (const sx of [-1, 1]) {
    const p0 = a.clone().addScaledVector(s.Z, 0.001);
    const p1 = b.clone().addScaledVector(s.Z, 0.001);
    p0.x += x + sx * (w / 2 - e);
    p1.x += x + sx * (w / 2 - e);
    B.add('betaShade', cylBetween(p0, p1, 0.0035, 0.0035, 6));
  }
  return s;
}

/**
 * Build the three couches.
 * @param {(key: string) => THREE.Material} mat
 * @returns {{group: THREE.Group}}
 */
export function buildCouches(mat) {
  const B = new Batch('CSMCabin:couches');
  const C = COUCH;
  const t = C.padThickness;
  for (const [id, xc] of Object.entries(COUCH_X)) {
    const W = C.width;
    const P = (p) => V(xc, p.y, p.z);
    const headTop = P(C.headTop);
    const head = P(C.head);
    const shoulder = P(C.shoulder);
    const hip = P(C.hip);
    const knee = P(C.knee);
    const heel = P(C.heel);
    // ---- pads
    pad(B, headTop, head, W.head, t, 0);
    // helmet side supports (angled wings on the headrest)
    for (const sx of [-1, 1]) {
      const s = segMatrix(headTop, head, t / 2, 0);
      const g = boxUV(roundBox(0.05, s.len * 0.8, 0.07, 0.015, 0.01, 3), 0.1);
      const m = new THREE.Matrix4().makeRotationY(sx * 0.55);
      m.setPosition(sx * (W.head / 2 + 0.018), 0, -0.02);
      B.add('beta', g, s.m.clone().multiply(m));
    }
    pad(B, shoulder, hip, W.back, t, 0);
    pad(B, hip.clone().add(V(0, -0.02, -0.02)), knee, W.seat, t * 0.9, 0);
    pad(B, knee.clone().add(V(0, -0.03, 0.01)), heel, W.legs, t * 0.8, 0);
    // ---- frame: side rails behind the pads following the profile, cross tubes
    const prof = [headTop, head, shoulder, hip, knee, heel];
    const behind = [];
    for (let i = 0; i < prof.length; i++) {
      const a = prof[Math.max(0, i - 1)];
      const b = prof[Math.min(prof.length - 1, i + 1)];
      const along = V().subVectors(b, a).normalize();
      const Z = V().crossVectors(V(1, 0, 0), along);
      behind.push(prof[i].clone().addScaledVector(Z, -(t + 0.018)));
    }
    const widths = [W.head * 0.8, W.head * 0.8, W.back, W.back, W.seat, W.legs];
    for (const sx of [-1, 1]) {
      for (let i = 1; i < prof.length; i++) {
        const a = behind[i - 1].clone();
        const b = behind[i].clone();
        a.x += (sx * widths[i - 1]) / 2 - sx * 0.02;
        b.x += (sx * widths[i]) / 2 - sx * 0.02;
        B.add('frame', beam(a, b, 0.026, 0.034, V(1, 0, 0)));
      }
    }
    for (let i = 0; i < prof.length; i++) {
      const a = behind[i].clone();
      const b = behind[i].clone();
      a.x -= widths[i] / 2 - 0.02;
      b.x += widths[i] / 2 - 0.02;
      B.add('frame', cylBetween(a, b, 0.012, 0.012, 8));
    }
    // heel rest (U channel) and toe strap
    {
      const hz = heel.clone().add(V(0, -0.02, -0.03));
      B.add('frame', beam(hz.clone().add(V(-W.legs / 2 + 0.03, 0, 0)), hz.clone().add(V(W.legs / 2 - 0.03, 0, 0)), 0.07, 0.012, V(0, 1, 0)));
      for (const sx of [-1, 1]) {
        const p = hz.clone().add(V((sx * (W.legs / 2 - 0.03)), 0, 0));
        B.add('frame', beam(p, p.clone().add(V(0, 0.03, -0.09)), 0.012, 0.05, V(1, 0, 0)));
      }
      const s0 = hz.clone().add(V(-0.15, 0.04, -0.1));
      const s1 = hz.clone().add(V(0.15, 0.04, -0.1));
      B.add('strap', ribbon([s0, hz.clone().add(V(0, 0.05, -0.115)), s1], 0.04, V(0, 1, 0)));
    }
    // ---- armrests (CDR both sides, LMP both sides; CMP shares theirs)
    if (id !== 'CMP') {
      for (const sx of [-1, 1]) {
        const ax = xc + sx * 0.29;
        const e = V(ax, -0.315, -0.29);
        const h = V(ax, -0.315, -0.585);
        B.add('beta', boxUV(roundBox(0.07, 0.3, 0.032, 0.012, 0.008, 3), 0.1), new THREE.Matrix4().makeBasis(V(1, 0, 0), V(0, 0, -1), V(0, 1, 0)).setPosition(V().addVectors(e, h).multiplyScalar(0.5)));
        // support arm from the couch rail
        const r0 = V(xc + sx * (W.back / 2 - 0.02), -0.33, -0.27);
        B.add('frame', beam(r0, V(ax, -0.34, -0.3), 0.03, 0.02, V(0, 1, 0)));
        B.add('frame', beam(V(ax, -0.34, -0.3), V(ax, -0.34, -0.57), 0.028, 0.02, V(0, 1, 0)));
        B.add('frame', beam(V(ax, -0.36, -0.44), hip.clone().add(V(sx * (W.seat / 2 - 0.02), -0.05, -0.12)), 0.018, 0.018, V(0, 1, 0)));
      }
    }
    // ---- attenuation struts: couch frame -> aft bulkhead / side walls
    const zA = AFT_Z + 0.02;
    const strut = (a, b) => {
      B.add('frame', cylBetween(a, b, 0.014, 0.014, 10));
      const m0 = V().lerpVectors(a, b, 0.3);
      const m1 = V().lerpVectors(a, b, 0.68);
      B.add('alu', cylBetween(m0, m1, 0.024, 0.024, 12));
      B.add('gold', cylBetween(V().lerpVectors(a, b, 0.29), V().lerpVectors(a, b, 0.32), 0.027, 0.027, 12));
      for (const p of [a, b]) B.add('structure', new THREE.SphereGeometry(0.02, 8, 6).translate(p.x, p.y, p.z));
    };
    strut(behind[3].clone().add(V(-0.12, 0, 0)), V(xc - 0.35, -0.55, zA));
    strut(behind[3].clone().add(V(0.12, 0, 0)), V(xc + 0.35, -0.55, zA));
    strut(behind[1].clone().add(V(0, 0, 0)), V(xc * 1.2, 0.75, zA));
    strut(behind[4].clone(), V(xc, -1.05, zA + 0.01));
    if (id !== 'CMP') {
      const sx = Math.sign(xc);
      const wallZ = -0.3;
      const rw = innerRadius(wallZ) - 0.03;
      strut(behind[2].clone().add(V(sx * 0.22, 0, 0)), V(sx * rw * 0.97, 0.2, wallZ));
    }
    // ---- restraint harness: lap belt halves & shoulder straps lying on the empty couch, buckle
    const seatN = V().crossVectors(V(1, 0, 0), V().subVectors(knee, hip).normalize());
    const backN = V().crossVectors(V(1, 0, 0), V().subVectors(hip, shoulder).normalize());
    const buckle = hip.clone().lerp(knee, 0.22).addScaledVector(seatN, 0.012);
    B.add('alu', new THREE.CylinderGeometry(0.03, 0.03, 0.012, 20).rotateX(Math.PI / 2).applyMatrix4(new THREE.Matrix4().lookAt(V(), seatN, V(0, 1, 0))).translate(buckle.x, buckle.y, buckle.z));
    for (const sx of [-1, 1]) {
      // lap belt: from the seat edge over the pad to the buckle
      const a = hip.clone().add(V(sx * (W.seat / 2 + 0.02), -0.01, -0.05));
      const m = hip.clone().lerp(knee, 0.12).add(V(sx * 0.12, 0, 0)).addScaledVector(seatN, 0.006);
      B.add('strap', ribbon([a, m, buckle.clone().add(V(sx * 0.02, 0, 0))], 0.045, seatN));
      // shoulder strap: from behind the shoulder down the back pad, over the hip, to the buckle
      const s0 = shoulder.clone().add(V(sx * 0.09, 0.03, 0.05));
      const s1 = shoulder.clone().add(V(sx * 0.08, -0.02, -0.004)).addScaledVector(backN, 0.004);
      const s2 = shoulder.clone().lerp(hip, 0.6).add(V(sx * 0.06, 0, 0)).addScaledVector(backN, 0.005);
      const s3 = hip.clone().add(V(sx * 0.035, -0.02, -0.03));
      B.add('strap', ribbon([s0, s1, s2, s3, buckle.clone().add(V(sx * 0.012, 0.01, 0))], 0.042, backN));
    }
  }
  const group = B.build(mat);
  return { group, controllers: CONTROLLERS };
}

/**
 * Flat ribbon (strap) along a smooth curve through points, width w, lying in the plane whose
 * normal is `n` (approx.).
 */
function ribbon(points, w, n) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
  const N = Math.max(4, Math.ceil(curve.getLength() / 0.02));
  const a = [];
  const b = [];
  for (let i = 0; i <= N; i++) {
    const p = curve.getPointAt(i / N);
    const tg = curve.getTangentAt(i / N);
    const side = V().crossVectors(n, tg).normalize().multiplyScalar(w / 2);
    a.push(p.clone().sub(side));
    b.push(p.clone().add(side));
  }
  const g = stripBetween(a, b, false, 0.05);
  // double-sided look: add the back face slightly offset
  const back = stripBetween(b.map((p) => p.clone().addScaledVector(n, -0.002)), a.map((p) => p.clone().addScaledVector(n, -0.002)), false, 0.05);
  const B = new Batch('r');
  B.add('x', g);
  B.add('x', back);
  return B.build(() => null).children[0].geometry;
}

export { ribbon, scaleUV };
void tube;
