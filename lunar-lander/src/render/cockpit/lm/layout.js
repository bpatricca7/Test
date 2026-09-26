// LM crew compartment layout (LM-CABIN agent): the interior envelope and the frames (position +
// orientation) of every panel, shared by the shell, the panels and the fittings.
//
// Body frame: +Y up, -Z forward (windows), +X right; metres. Numbers that exist in constants.js
// (cabin cylinder, windows, eye points, hatches, floor) are read from there.
//
// Envelope. The forward cabin is the 2.34-m pressure cylinder (axis along Z at y = cabinAxisY)
// trimmed by a flat floor at LM.floorY; the interior lining sits just inside it. The forward end is
// the faceted front: the two window facets (planes through LM.windows.cdr / .lmp exactly), brows
// above them, cheeks at the outboard corners and the flat lower bulkhead (z = cabinFrontZ) that
// carries the forward hatch. Aft of cabinRearZ the aft midsection continues with a raised floor over
// the ascent engine, its sides filled by the ECS (right) and stowage (left) equipment racks.
//
// Crew stations (Apollo 11 LM-5 arrangement, adapted to these window/eye positions):
//   panel 1 (CDR flight displays) = 1A outboard/tall + 1B inboard/low (the inboard top corner stays
//   below the line of sight to the window's lower apex, so the LPD view is not obstructed);
//   panel 2 = its mirror image for the LMP; the ABORT / ABORT STAGE strip between them; panel 3
//   (radar, stabilisation & control) as a sloping shelf in two halves either side of panel 4 (DSKY);
//   panels 5 and 6 at knee level beside the forward hatch; panel 8 (CDR left console), panel 11
//   (CDR overhead-left circuit breakers), panel 16 (LMP right circuit breakers), panel 12 (LMP comm)
//   and panel 14 (EPS) on the right side; the ECS panel on the aft right.
import * as THREE from 'three';
import { LM } from '../../../core/constants.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

export const CAB = {
  axisY: LM.ascentStage.cabinAxisY, // 4.60
  radius: LM.ascentStage.cabinRadius, // 1.17
  frontZ: LM.ascentStage.cabinFrontZ, // -1.25
  rearZ: LM.ascentStage.cabinRearZ, // -0.18
  floorY: LM.floorY, // 3.46
  aftZ: 1.2, // aft bulkhead of the midsection
  midFloorY: 3.75, // raised midsection floor (over the ascent engine)
  ceilingY: 5.64, // flat ceiling band (the overhead window well and the docking tunnel open in it)
  rackX: 0.78, // inboard faces of the midsection equipment racks
  tunnel: { x: LM.docking.port.x, z: LM.docking.port.z, r: LM.docking.tunnelRadius, topY: 6.08 },
  engineCover: { z: 0.42, rBase: 0.5, rTop: 0.41, topY: 4.3 },
};

/**
 * Cross-section of the interior envelope (x, y), counter-clockwise seen from +Z (aft looking
 * forward). The lower corners are the floor chamfers, the sides follow the 1.17-m cylinder, the top
 * is a flat ceiling band wide enough for the overhead window well and the docking tunnel.
 */
export const SECTION = (() => {
  const half = [
    [0.62, CAB.floorY],
    [0.98, 3.8],
    [1.14, 4.2],
    [1.16, 4.75],
    [1.08, 5.15],
    [0.92, 5.49],
    [0.66, CAB.ceilingY],
  ];
  const tags = ['lowerSide', 'side', 'side', 'upperSide', 'diag', 'ceilingEdge'];
  const pts = [...half, ...half.slice().reverse().map(([x, y]) => [-x, y])];
  // edge tags (edge i goes from pts[i] to pts[i+1])
  const et = [...tags, 'ceiling', ...tags.slice().reverse(), 'floor'];
  return { pts, tags: et };
})();

/** Outward half-space planes {n, d, tag} of the cabin envelope (for geom.convexPolyhedron). */
export function envelopePlanes() {
  const planes = [];
  const { pts, tags } = SECTION;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const n = V(y1 - y0, -(x1 - x0), 0).normalize(); // CCW -> outward = (dy, -dx)
    const side = (x0 + x1) / 2 < -1e-6 ? 'L' : (x0 + x1) / 2 > 1e-6 ? 'R' : '';
    planes.push({ n, d: n.x * x0 + n.y * y0, tag: tags[i] + side });
  }
  const W = LM.windows;
  for (const [tri, tag] of [
    [W.cdr, 'winL'],
    [W.lmp, 'winR'],
  ]) {
    const n = triNormal(tri);
    planes.push({ n, d: n.dot(tri[0]), tag });
    // brow: contains the window's top edge, rises 45 deg into the cabin
    const e = new THREE.Vector3().subVectors(tri[2], tri[0]);
    if (tag === 'winR') e.subVectors(tri[1], tri[0]);
    const f = V(-e.z, 0, e.x).normalize();
    if (f.z > 0) f.negate();
    const nb = f.multiplyScalar(Math.SQRT1_2).add(V(0, Math.SQRT1_2, 0)).normalize();
    planes.push({ n: nb, d: nb.dot(tri[0]), tag: tag === 'winL' ? 'browL' : 'browR' });
  }
  const cheek = (s) => {
    const n = V(-0.75 * s, 0, -0.66).normalize();
    return { n, d: n.dot(V(-1.12 * s, 0, -0.98)), tag: s > 0 ? 'cheekL' : 'cheekR' };
  };
  planes.push(cheek(1), cheek(-1));
  planes.push({ n: V(0, 0, -1), d: -CAB.frontZ, tag: 'front' });
  planes.push({ n: V(0, 0, 1), d: CAB.aftZ, tag: 'aft' });
  return planes;
}

/** Outward unit normal of a CCW-from-outside triangle. */
export function triNormal(t) {
  return new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).normalize();
}

/**
 * Frame of a flat panel: centre, orthonormal right/up/normal (normal faces the crew) and the
 * Matrix4 that maps the panel's local XY plane (face +Z) into the body frame.
 */
export function makeFrame(center, right, up) {
  const x = right.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const matrix = new THREE.Matrix4().makeBasis(x, y, z).setPosition(center);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return { center: center.clone(), right: x, up: y, normal: z, matrix, quaternion };
}

/** Front-console frame: face tilted back by `tilt` deg (top leans forward), yawed by `yaw` deg (+ faces right). */
export function consoleFrame(center, tilt, yaw = 0) {
  const e = new THREE.Euler(-tilt * D2R, yaw * D2R, 0, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(e);
  return makeFrame(center, V(1, 0, 0).applyQuaternion(q), V(0, 1, 0).applyQuaternion(q));
}

/**
 * Panel placement table. Each: { w, h, frame }. Coordinates chosen so that every panel lies inside
 * the envelope and nothing crosses the CDR's line of sight to the bottom of his window.
 */
export function panelLayout() {
  const P = {};
  // ---- front console (facing the crew)
  // panel 1B: inboard, low — FDAI + ALT/ALT RATE tapes directly in front of the CDR. The design eye
  // stands only ~0.35 m behind the window apex, so the flight displays sit ~60-70 deg below the line
  // of sight; tilting 1B/2B back 28 deg turns their faces up toward the eye (viewing angle to the face
  // normal ~45 deg instead of ~58 deg), so the FDAI and tapes read with a downward glance.
  P.p1B = { w: 0.37, h: 0.23, frame: consoleFrame(V(-0.245, 4.615, -1.09), 28) };
  // panel 1A: outboard, tall — X-pointer, C&W, MASTER ALARM, thrust, event timer, engine switches
  P.p1A = { w: 0.31, h: 0.53, frame: consoleFrame(V(-0.585, 4.762, -1.065), 8, 12) };
  P.p2B = { w: 0.37, h: 0.23, frame: consoleFrame(V(0.245, 4.615, -1.09), 28) };
  P.p2A = { w: 0.31, h: 0.53, frame: consoleFrame(V(0.585, 4.762, -1.065), 8, -12) };
  // centre strip between panels 1 and 2: ABORT / ABORT STAGE
  P.abort = { w: 0.12, h: 0.21, frame: consoleFrame(V(0, 4.625, -1.095), 28) };
  // panel 3 halves: sloping shelf below panels 1/2 (tilted 40 deg back = faces up toward the crew)
  P.p3L = { w: 0.56, h: 0.165, frame: consoleFrame(V(-0.44, 4.441, -1.007), 40) };
  P.p3R = { w: 0.56, h: 0.165, frame: consoleFrame(V(0.44, 4.441, -1.007), 40) };
  // panel 4: DSKY in the centre between the panel 3 halves, above the forward hatch
  // (it stands proud of panels 1/2 so both crewmen can see it past the ABORT strip)
  P.p4 = { w: 0.27, h: 0.235, frame: consoleFrame(V(0, 4.409, -1.0026), 35) };
  // panels 5 & 6: knee level beside the forward hatch, turned toward their crewman
  P.p5 = { w: 0.30, h: 0.46, frame: consoleFrame(V(-0.585, 4.03, -1.176), 8, 16) };
  P.p6 = { w: 0.30, h: 0.46, frame: consoleFrame(V(0.585, 4.03, -1.176), 8, -16) };
  // ---- side consoles
  // panel 8: CDR's left console at hip level, facing up and inboard; read with the head turned left
  P.p8 = { w: 0.42, h: 0.27, frame: makeFrame(V(-0.93, 4.44, -0.7), V(0, 0, -1), V(-0.77, 0.64, 0)) };
  // panel 12: LMP's right console (communications), mirror of panel 8
  P.p12 = { w: 0.42, h: 0.27, frame: makeFrame(V(0.93, 4.44, -0.7), V(0, 0, 1), V(0.77, 0.64, 0)) };
  // panel 14: EPS, on the right wall aft of panel 12 (vertical, slightly up-facing)
  P.p14 = { w: 0.3, h: 0.32, frame: makeFrame(V(1.075, 4.62, -0.33), V(0, 0, 1), V(0.34, 0.94, 0)) };
  // panel 11: CDR overhead-left circuit breakers on the upper diagonal
  P.p11 = { w: 0.58, h: 0.33, frame: makeFrame(V(-0.975, 5.31, -0.585), V(0, 0, -1), V(0.426, 0.905, 0)) };
  // panel 16: LMP right circuit breakers (mirror)
  P.p16 = { w: 0.58, h: 0.33, frame: makeFrame(V(0.975, 5.31, -0.585), V(0, 0, 1), V(-0.426, 0.905, 0)) };
  // ECS control panel on the right midsection rack (faces inboard -X)
  P.ecs = { w: 0.62, h: 0.42, frame: makeFrame(V(CAB.rackX - 0.001, 4.5, 0.42), V(0, 0, 1), V(0, 1, 0)) };
  // ECS lower: oxygen / water control module (valve handles), below the ECS panel
  P.ecsLow = { w: 0.62, h: 0.24, frame: makeFrame(V(CAB.rackX - 0.001, 4.07, 0.42), V(0, 0, 1), V(0, 1, 0)) };
  return P;
}

/** Controller placements (ACA pistol grips / TTCA T-handles), both stations. */
export const CONTROLLERS = {
  // CDR: ACA in the right hand, TTCA in the left hand
  cdrACA: V(-0.19, 4.19, -0.87),
  cdrTTCA: V(-0.66, 4.2, -0.88),
  // LMP: ACA right, TTCA left
  lmpACA: V(0.66, 4.19, -0.87),
  lmpTTCA: V(0.19, 4.2, -0.88),
};
