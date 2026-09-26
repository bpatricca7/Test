// Command Module interior fittings (CSM-CABIN agent).
//
//   forward (tunnel) hatch: domed pressure hatch in the docking tunnel with its gearbox & handle,
//     pressure-equalisation valve, latch linkage and the "stowed on the aft bulkhead" drill
//   side-hatch mechanism: gearbox housing, ratchet actuator handle, counterbalance cylinder, latch
//     rails, window shade and the operating placard
//   floodlight fixtures (under the MDC wings, LEB, over the hatch) — returned for lighting.js
//   handholds (aluminium bars), suit umbilical hoses from the ECS to each couch, Beta-cloth
//   window shades, Velcro patches, checklist books & cue cards
//   COAS (crewman optical alignment sight) at the CDR's left rendezvous window, with a lit reticle
//   on its combiner glass; 16-mm data-acquisition camera on its bracket at the right rendezvous window
import * as THREE from 'three';
import * as KIT from '../kit/index.js';
import { TUNNEL, windowFrame, mdcSections, lebFrames, innerRadius, stationEye, COUCH_X } from './layout.js';
import { V, Batch, roundBox, cylBetween, tube, hose, lathe, onFrame, placeOnFrame } from './geom.js';
import { conePoint, R_HATCH } from './shell.js';
import { ribbon } from './couches.js';

/** Handhold bar between two points with standoff posts (along `out`). */
function handhold(B, a, b, out, h = 0.04) {
  const a2 = a.clone().addScaledVector(out, h);
  const b2 = b.clone().addScaledVector(out, h);
  B.add('alu', cylBetween(a2, b2, 0.009, 0.009, 12));
  for (const [p, q] of [[a, a2], [b, b2]]) {
    B.add('alu', cylBetween(p, q, 0.008, 0.008, 10));
    B.add('structure', cylBetween(p.clone().addScaledVector(out, -0.004), p.clone().addScaledVector(out, 0.006), 0.016, 0.016, 12));
  }
}

/** COAS reticle texture (canvas): circle, cross, range marks — drawn in the lamp colour. */
function coasReticle() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.2;
  g.beginPath();
  g.arc(128, 128, 70, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(128, 8);
  g.lineTo(128, 108);
  g.moveTo(128, 148);
  g.lineTo(128, 248);
  g.moveTo(8, 128);
  g.lineTo(108, 128);
  g.moveTo(148, 128);
  g.lineTo(248, 128);
  g.stroke();
  for (let k = 1; k <= 8; k++) {
    const y = 128 + k * 13;
    g.beginPath();
    g.moveTo(128 - (k % 2 ? 5 : 9), y);
    g.lineTo(128 + (k % 2 ? 5 : 9), y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {(key: string) => THREE.Material} mat
 * @param {{hatch: object}} shellInfo from buildShell
 * @returns {{group: THREE.Group, floods: Array<{position: THREE.Vector3, lens: THREE.Mesh}>, coas: object}}
 */
export function buildDetails(mat, shellInfo) {
  const B = new Batch('CSMCabin:details');
  const group = new THREE.Group();
  group.name = 'CSMCabin:details';
  const floods = [];
  const lensMat = mat('lens');

  // ---------------------------------------------------------------- forward (tunnel) hatch
  {
    const z = TUNNEL.hatchZ;
    const r = TUNNEL.radius - 0.004;
    // shallow dome facing the cabin (+Z)
    const prof = [];
    for (let k = 0; k <= 10; k++) {
      const rr = (r * k) / 10;
      prof.push([rr, 0.035 * (1 - (rr / r) ** 2)]);
    }
    prof.reverse();
    const dome = lathe(prof.map(([a, b]) => [a, b]), 48);
    dome.rotateX(Math.PI / 2); // lathe axis +Y -> +Z
    dome.translate(0, 0, z);
    B.add('structure', dome);
    // rim ring & 6 latch housings
    B.add('alu', new THREE.TorusGeometry(r - 0.01, 0.009, 8, 48).translate(0, 0, z + 0.004));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      B.add('structure', roundBox(0.06, 0.035, 0.03, 0.006).rotateZ(a).translate(Math.cos(a) * (r - 0.05), Math.sin(a) * (r - 0.05), z + 0.02));
      // linkage rods to the centre gearbox
      B.add('alu', cylBetween(V(Math.cos(a) * (r - 0.07), Math.sin(a) * (r - 0.07), z + 0.03), V(Math.cos(a) * 0.07, Math.sin(a) * 0.07, z + 0.045), 0.005, 0.005, 6));
    }
    // central gearbox, handle and pressure equalisation valve
    B.add('structure', new THREE.CylinderGeometry(0.07, 0.075, 0.04, 24).rotateX(Math.PI / 2).translate(0, 0, z + 0.05));
    B.add('alu', roundBox(0.24, 0.03, 0.02, 0.01).translate(0.08, 0.0, z + 0.08));
    B.add('black', cylBetween(V(0.19, 0, z + 0.07), V(0.19, 0, z + 0.13), 0.013, 0.013, 12));
    B.add('red', new THREE.CylinderGeometry(0.025, 0.025, 0.018, 20).rotateX(Math.PI / 2).translate(-0.15, 0.13, z + 0.03));
    B.add('alu', new THREE.CylinderGeometry(0.01, 0.01, 0.03, 10).rotateX(Math.PI / 2).translate(-0.15, 0.13, z + 0.05));
    // decal
    const pl = KIT.createPlacard({ text: 'FORWARD HATCH\nPRESS EQUAL VALVE — OPEN BEFORE UNLATCHING', width: 0.2, height: 0.035, size: 0.006 });
    pl.position.set(0, -0.2, z + 0.02);
    group.add(pl);
    // tunnel handholds
    handhold(B, V(-0.3, 0.2, TUNNEL.zBottom + 0.02), V(-0.3, 0.2, TUNNEL.zBottom - 0.2), V(0.83, -0.55, 0).normalize(), 0.035);
    handhold(B, V(0.3, 0.2, TUNNEL.zBottom + 0.02), V(0.3, 0.2, TUNNEL.zBottom - 0.2), V(-0.83, -0.55, 0).normalize(), 0.035);
  }

  // ---------------------------------------------------------------- side hatch mechanism
  {
    const H = shellInfo.hatch;
    const zc = (H.z0 + H.z1) / 2;
    const pt = (th, z, off = 0) => conePoint(R_HATCH - off / Math.cos(0.576), th, z);
    const inward = (p) => V(-p.x, -p.y, 0).normalize().multiplyScalar(0.839).add(V(0, 0, 0.545)).normalize();
    // latch rails along both long edges
    for (const s of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const z = H.z0 - 0.04 + ((H.z1 - H.z0 + 0.08) * k) / 8;
        const th = (s * (H.halfWidth - 0.035)) / (R_HATCH + 0.649 * z);
        pts.push(pt(th, z, 0.018));
      }
      B.add('alu', tube(pts, 0.009, { radial: 8 }));
      for (let k = 1; k < 8; k += 2) B.add('structure', roundBox(0.03, 0.03, 0.02, 0.005).translate(pts[k].x, pts[k].y, pts[k].z));
    }
    // gearbox housing below the window, ratchet actuator handle
    const gb = pt(0, zc + 0.12, 0.03);
    const n = inward(gb);
    const gq = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n);
    B.add('structure', roundBox(0.22, 0.13, 0.06, 0.015).applyQuaternion(gq).translate(gb.x, gb.y, gb.z));
    const hA = gb.clone().addScaledVector(n, 0.035);
    const hB = hA.clone().add(V(0.2, 0, 0.04));
    B.add('alu', cylBetween(hA, hB, 0.011, 0.011, 12));
    B.add('black', cylBetween(hB.clone().add(V(-0.06, 0, -0.012)), hB.clone().add(V(0.03, 0, 0.006)), 0.015, 0.015, 12));
    // counterbalance (gas-powered opening) cylinder along the left edge
    const c0 = pt(-0.2 / (R_HATCH - 0.4), H.z0 - 0.02, 0.05);
    const c1 = pt(-0.22 / (R_HATCH - 0.6), H.z1 + 0.1, 0.05);
    B.add('frame', cylBetween(c0, c1, 0.022, 0.022, 16));
    B.add('gold', cylBetween(V().lerpVectors(c0, c1, 0.1), V().lerpVectors(c0, c1, 0.15), 0.024, 0.024, 16));
    // placard with the unlatching instructions
    const pl = KIT.createPlacard({ text: 'HATCH OPERATION\n1. PRESS EQUALIZATION VALVE — OPEN\n2. ACTUATOR HANDLE — UNLATCH (CCW)\n3. PUSH OUTBOARD', width: 0.16, height: 0.05, size: 0.0052, align: 'left' });
    const pp = pt(0.12 / R_HATCH, zc + 0.26, 0.004);
    pl.position.copy(pp);
    pl.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(V(), inward(pp).negate(), V(0, 0, -1)));
    group.add(pl);
    // side-hatch handholds (either side of the hatch)
    for (const s of [-1, 1]) {
      const th = (s * (H.halfWidth + 0.08)) / 1.2;
      const a = conePoint(1.812 - 0.005, th, H.z0 - 0.05);
      const b = conePoint(1.812 - 0.005, th, H.z0 - 0.35);
      handhold(B, a, b, inward(a), 0.045);
    }
  }

  // ---------------------------------------------------------------- floodlight fixtures
  const S = mdcSections();
  const fixture = (p, dir) => {
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir.clone().normalize());
    B.add('structure', roundBox(0.12, 0.05, 0.04, 0.012).applyQuaternion(q).translate(p.x, p.y, p.z));
    const lens = new THREE.Mesh(roundBox(0.1, 0.034, 0.006, 0.008), lensMat);
    lens.quaternion.copy(q);
    lens.position.copy(p).addScaledVector(dir.clone().normalize(), 0.021);
    lens.castShadow = false;
    group.add(lens);
    floods.push({ position: p.clone().addScaledVector(dir.clone().normalize(), 0.06), lens });
  };
  for (const k of ['P1', 'P3']) {
    const F = S[k];
    const p = F.point(0, -F.h / 2 - 0.035, 0.01);
    fixture(p, F.z.clone().multiplyScalar(0.5).add(V(0, -0.85, 0.2)));
  }
  {
    const { CL } = lebFrames();
    fixture(CL.point(0, CL.h / 2 - 0.04, 0.03), CL.z.clone().add(V(0, -0.6, 0.3)));
  }

  // ---------------------------------------------------------------- suit umbilical hoses
  // CDR: from the ECS suit-circuit connectors on the LHEB wall; CMP & LMP: from the LEB suit-circuit
  // outlets below their feet. Hoses end at the couch side at hip level (stowed, crew suits off).
  {
    const src = V(-1.3, -0.45, -0.52);
    const routes = [
      [src, V(-1.12, -0.44, -0.5), V(COUCH_X.CDR - 0.36, -0.42, -0.42), V(COUCH_X.CDR - 0.3, -0.3, -0.36)],
      [V(-0.18, -1.2, -0.42), V(-0.2, -1.02, -0.5), V(-0.25, -0.72, -0.46), V(-0.27, -0.45, -0.36)],
      [V(0.2, -1.2, -0.42), V(0.24, -1.0, -0.5), V(COUCH_X.LMP - 0.37, -0.7, -0.45), V(COUCH_X.LMP - 0.3, -0.36, -0.36)],
    ];
    for (const r of routes) {
      for (const off of [-0.03, 0.03]) {
        const pts = r.map((p, i) => p.clone().add(V(i === 0 ? off : off * 0.8, 0, i === 0 ? 0 : off * 0.5)));
        B.add('hose', hose(pts, 0.017, 0.02, 8));
        // blue (supply) / red (return) connectors at the couch end
        const end = pts[pts.length - 1];
        const dir = V().subVectors(end, pts[pts.length - 2]).normalize();
        B.add(off < 0 ? 'blueCon' : 'red', cylBetween(end, end.clone().addScaledVector(dir, 0.035), 0.021, 0.021, 14));
      }
    }
    // ECS connector plate on the wall, LEB outlets
    B.add('structure', roundBox(0.1, 0.22, 0.03, 0.01).rotateY(Math.PI / 2 - 0.3).translate(src.x - 0.02, src.y + 0.05, src.z));
    for (const x of [-0.18, 0.2]) B.add('structure', roundBox(0.12, 0.03, 0.08, 0.008).translate(x, -1.225, -0.42));
  }

  // ---------------------------------------------------------------- structural ring frames on the cone wall
  for (const z of [-0.2, -1.68]) {
    // square-section ring (torus with 4 radial segments rotated 45°), sitting on the wall
    const r0 = innerRadius(z);
    const g = new THREE.TorusGeometry(r0 - 0.012, 0.024, 4, 128);
    g.rotateZ(0);
    const p = g.attributes.position;
    // turn the diamond section into a flat-faced channel: squash radially
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const rr = Math.hypot(x, y);
      const k = (r0 - 0.012 + (rr - (r0 - 0.012)) * 0.6) / rr;
      p.setXY(i, x * k, y * k);
    }
    g.computeVertexNormals();
    B.add('structure', g.translate(0, 0, z));
  }

  // ---------------------------------------------------------------- handholds (MDC, LEB)
  {
    const P2 = S.P2;
    handhold(B, P2.point(-0.3, P2.h / 2 + 0.03, -0.05), P2.point(-0.08, P2.h / 2 + 0.03, -0.05), P2.y, 0.03);
    handhold(B, P2.point(0.08, P2.h / 2 + 0.03, -0.05), P2.point(0.3, P2.h / 2 + 0.03, -0.05), P2.y, 0.03);
    const { GN } = lebFrames();
    handhold(B, GN.point(-0.5, GN.h / 2 + 0.02, 0.0), GN.point(-0.3, GN.h / 2 + 0.02, 0.0), GN.z, 0.05);
    handhold(B, GN.point(0.3, GN.h / 2 + 0.02, 0.0), GN.point(0.5, GN.h / 2 + 0.02, 0.0), GN.z, 0.05);
  }

  // ---------------------------------------------------------------- window shades (stowed, Beta cloth) & Velcro
  for (const id of ['sideLeft', 'sideRight']) {
    const f = windowFrame(id);
    const n = f.z.clone().negate();
    const p = f.origin.clone().addScaledVector(n, 0.17).addScaledVector(f.y, -f.h / 2 - 0.07);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.x, f.y, n));
    B.add('betaShade', roundBox(0.3, 0.05, 0.02, 0.012).applyQuaternion(q).translate(p.x, p.y, p.z));
    B.add('strap', roundBox(0.03, 0.055, 0.024, 0.004).applyQuaternion(q).translate(p.x + f.x.x * 0.1, p.y + f.x.y * 0.1, p.z + f.x.z * 0.1));
  }
  const velcro = (p, n, w, h, rot = 0) => {
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n.clone().normalize());
    q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rot));
    B.add('velcro', new THREE.BoxGeometry(w, h, 0.002).applyQuaternion(q).translate(p.x, p.y, p.z));
  };
  {
    // on the cone wall around the cabin (inner normal) and on the MDC edges
    const spots = [[-2.2, -0.35], [-2.0, -0.6], [2.1, -0.4], [1.9, -0.7], [-1.3, -1.35], [1.25, -1.4], [0.5, -0.25], [-0.6, -0.28], [2.6, -0.5], [-2.7, -0.45]];
    for (const [th, z] of spots) {
      const r = innerRadius(z) - 0.002;
      const p = V(Math.sin(th) * r, Math.cos(th) * r, z);
      velcro(p, V(-p.x, -p.y, 0).normalize().multiplyScalar(0.84).add(V(0, 0, 0.54)), 0.06, 0.025, th);
    }
  }

  // ---------------------------------------------------------------- checklists & cue cards
  {
    const P1 = S.P1;
    const card1 = KIT.createChecklistCard({ title: 'CSM SOLO — P52 IMU REALIGN', lines: ['V37E 52E', 'OPTION 3 - REFSMMAT', 'PRO', 'V51 - PLEASE MARK', 'STAR 1: 33 ANTARES', 'STAR 2: 40 ALTAIR', 'V06N93 - TORQUE ANGLES', 'V32E IF > 1 DEG'], width: 0.1, height: 0.13, seed: 3 });
    placeOnFrame(card1, P1, -P1.w / 2 - 0.06, -0.2, 0.02);
    card1.rotateY(0.35);
    group.add(card1);
    const P3 = S.P3;
    const card2 = KIT.createChecklistCard({ title: 'LM RESCUE — DPS/APS', lines: ['CSI TIG 125:19:35', 'CDH TIG 126:17:46', 'TPI TIG 127:03:31', 'ΔV TPI 24.1 FPS', 'BRAKING GATES', '  1 NM   30 FPS', '  0.5 NM 20 FPS', '  1000 FT 10 FPS'], width: 0.1, height: 0.13, seed: 7 });
    placeOnFrame(card2, P3, P3.w / 2 + 0.06, -0.18, 0.02);
    card2.rotateY(-0.35);
    group.add(card2);
    // checklist book on the LEB closeout (Flight Data File), fastened with Velcro
    const { CL } = lebFrames();
    const book = KIT.createChecklistCard({ title: 'CMP SOLO BOOK', lines: ['LOS/AOS TIMES', 'REV 13 102:03:30', 'REV 14 104:01:59', 'LANDMARK TRACKING', 'P22 - 130 PRIME', 'UPDATE PAD', 'SEXTANT STAR CHECK'], width: 0.13, height: 0.17, seed: 11 });
    placeOnFrame(book, CL, 0.25, -0.1, 0.02);
    group.add(book);
    B.add('betaShade', onFrame(roundBox(0.14, 0.18, 0.012, 0.006), CL, 0.25, -0.1, 0.008));
  }

  // ---------------------------------------------------------------- COAS at the left rendezvous window
  const coas = {};
  {
    const f = windowFrame('rendezvousLeft');
    const eye = stationEye('RV');
    const axis = V().subVectors(f.origin, eye).normalize();
    const cpos = eye.clone().addScaledVector(axis, 0.13);
    const up = f.y.clone();
    const right = V().crossVectors(axis, up).normalize();
    const upO = V().crossVectors(right, axis).normalize();
    const basis = new THREE.Matrix4().makeBasis(right, upO, axis.clone().negate());
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    // body below the line of sight, mount arm to the window bezel
    const body = cpos.clone().addScaledVector(upO, -0.052).addScaledVector(axis, 0.02);
    B.add('black', roundBox(0.055, 0.05, 0.1, 0.01).applyQuaternion(q).translate(body.x, body.y, body.z));
    B.add('black', cylBetween(body.clone().addScaledVector(axis, -0.06), body.clone().addScaledVector(axis, -0.035), 0.012, 0.012, 12));
    const armEnd = f.origin.clone().addScaledVector(f.z, -0.24).addScaledVector(f.y, -0.13);
    B.add('alu', cylBetween(body.clone().addScaledVector(axis, 0.04), armEnd, 0.007, 0.007, 8));
    // combiner glass frame + glass + reticle
    const comb = cpos.clone();
    const frameG = roundBox(0.062, 0.054, 0.004, 0.006);
    frameG.applyQuaternion(q);
    // hollow frame: 4 thin bars
    for (const [u, v, w, h] of [[0, 0.025, 0.062, 0.005], [0, -0.025, 0.062, 0.005], [-0.029, 0, 0.005, 0.054], [0.029, 0, 0.005, 0.054]]) {
      const g = new THREE.BoxGeometry(w, h, 0.004).applyQuaternion(q);
      const p = comb.clone().addScaledVector(right, u).addScaledVector(upO, v);
      B.add('black', g.translate(p.x, p.y, p.z));
    }
    frameG.dispose();
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.054, 0.046), KIT.getMaterial('glass'));
    glass.quaternion.copy(q);
    glass.position.copy(comb);
    glass.renderOrder = 3;
    group.add(glass);
    const retMat = new THREE.MeshBasicMaterial({ map: coasReticle(), color: new THREE.Color(1.0, 0.55, 0.15).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), retMat);
    ret.quaternion.copy(q);
    ret.position.copy(comb).addScaledVector(axis, -0.001);
    ret.renderOrder = 4;
    ret.castShadow = false;
    group.add(ret);
    coas.reticle = ret;
    coas.material = retMat;
  }

  // ---------------------------------------------------------------- 16-mm DAC camera at the right rendezvous window
  {
    const f = windowFrame('rendezvousRight');
    const n = f.z.clone().negate();
    const p = f.origin.clone().addScaledVector(n, 0.3).addScaledVector(f.y, -0.03);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.x.clone().negate(), f.y, n));
    B.add('black', roundBox(0.075, 0.1, 0.09, 0.01).applyQuaternion(q).translate(p.x, p.y, p.z));
    const lensA = p.clone().addScaledVector(f.z, 0.045);
    const lensB = lensA.clone().addScaledVector(f.z, 0.06);
    B.add('black', cylBetween(lensA, lensB, 0.02, 0.022, 18));
    B.add('alu', cylBetween(lensB.clone().addScaledVector(f.z, -0.012), lensB, 0.023, 0.023, 18));
    // magazine on top, bracket to the window frame
    const mag = p.clone().addScaledVector(f.y, 0.07).addScaledVector(n, 0.01);
    B.add('black', roundBox(0.07, 0.05, 0.08, 0.012).applyQuaternion(q).translate(mag.x, mag.y, mag.z));
    B.add('alu', cylBetween(p.clone().addScaledVector(f.y, -0.05), f.origin.clone().addScaledVector(n, 0.2).addScaledVector(f.y, -0.16), 0.008, 0.008, 8));
  }

  // ---------------------------------------------------------------- a Hasselblad in its Velcro spot on the MDC's right end
  {
    const P3 = S.P3;
    const p = P3.point(P3.w / 2 + 0.07, 0.25, 0.04);
    const q = P3.quaternion();
    B.add('black', roundBox(0.09, 0.09, 0.08, 0.012).applyQuaternion(q).translate(p.x, p.y, p.z));
    B.add('alu', roundBox(0.092, 0.03, 0.082, 0.004).applyQuaternion(q).translate(p.x + P3.y.x * 0.03, p.y + P3.y.y * 0.03, p.z + P3.y.z * 0.03));
    const la = p.clone().addScaledVector(P3.z, 0.04);
    B.add('black', cylBetween(la, la.clone().addScaledVector(P3.z, 0.06), 0.03, 0.03, 20));
    B.add('alu', cylBetween(la.clone().addScaledVector(P3.z, 0.045), la.clone().addScaledVector(P3.z, 0.052), 0.031, 0.031, 20));
  }

  // a spare strap hanging from the aft lockers (loose restraint)
  B.add('strap', ribbon([V(0.35, 1.22, -0.2), V(0.36, 1.05, -0.26), V(0.3, 0.92, -0.3)], 0.04, V(0, 0, 1)));

  group.add(B.build((k) => (k === 'blueCon' ? blueConnector() : mat(k))));
  return { group, floods, coas };
}

let _blue = null;
function blueConnector() {
  if (!_blue) _blue = new THREE.MeshStandardMaterial({ color: 0x2c5fb3, roughness: 0.4, metalness: 0.3 });
  return _blue;
}
