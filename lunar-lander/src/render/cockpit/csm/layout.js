// Apollo Block II Command Module crew compartment — layout & geometry math (CSM-CABIN agent).
//
// Pure functions of src/core/constants.js (no DOM, no scene): unit-testable in node.
//
// CSM body frame (see constants.js): -Z forward (toward the apex / docking tunnel), +Y "head up"
// (toward the side hatch), +X right. Origin at the CM/SM interface plane. The crew lie in their
// couches with their backs toward +Z (the aft heat shield), faces toward -Z (the Main Display
// Console) and heads toward +Y; their feet point toward -Y, where the Lower Equipment Bay (LEB) is.
//
// Inner pressure vessel: a cone ~0.12 m (normal distance) inside the outer mould line,
//   r_in(z) = CSM.cm.baseRadius - wallOffset + tan(33°)·z      (z negative toward the apex)
// closed aft by a shallow domed bulkhead (AFT_Z) and forward by the forward bulkhead + the docking
// tunnel (TUNNEL) that leads to the forward (tunnel) hatch.
import * as THREE from 'three';
import { CSM } from '../../../core/constants.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------ pressure vessel
/** tan of the cone half angle (radius change per metre of z). */
export const CONE_K = Math.tan(CSM.cm.coneHalfAngle);
/** Radial offset of the inner pressure vessel from the mould line (normal thickness / cos). */
export const WALL_OFFSET = CSM.cm.wallThickness / Math.cos(CSM.cm.coneHalfAngle);
/** Aft end of the conical inner wall (it meets the domed aft bulkhead there). */
export const AFT_Z = -0.07;
/** Forward end of the conical inner wall (it meets the forward bulkhead there). */
export const FWD_Z = -1.78;
/** Aft bulkhead: dome bulging aft by this much at the centre (z = AFT_Z + AFT_DOME). */
export const AFT_DOME = 0.1;
/** Docking tunnel inside the forward bulkhead (32-in passage) and the forward hatch plane. */
export const TUNNEL = { radius: 0.405, zBottom: -1.9, hatchZ: -2.3 };

/** Outer mould line radius at z (conical part). */
export function outerRadius(z) {
  return CSM.cm.baseRadius + CONE_K * z;
}
/** Inner pressure-vessel radius at z (conical part). */
export function innerRadius(z) {
  return CSM.cm.baseRadius - WALL_OFFSET + CONE_K * z;
}

/**
 * First intersection (t > tMin) of the ray p + t·d with the cone r = R0 + K z, R0 given.
 * @returns {number} t, or NaN when there is none
 */
export function rayCone(p, d, R0 = CSM.cm.baseRadius - WALL_OFFSET, K = CONE_K, tMin = 1e-6) {
  // (px + t dx)^2 + (py + t dy)^2 = (R0 + K (pz + t dz))^2
  const a = d.x * d.x + d.y * d.y - K * K * d.z * d.z;
  const r0 = R0 + K * p.z;
  const b = 2 * (p.x * d.x + p.y * d.y - K * d.z * r0);
  const c = p.x * p.x + p.y * p.y - r0 * r0;
  if (Math.abs(a) < 1e-12) {
    const t = -c / b;
    return t > tMin ? t : NaN;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return NaN;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo > tMin) return lo;
  if (hi > tMin) return hi;
  return NaN;
}

/** Outward unit normal of a cone of half-angle atan(K) at point p. */
export function coneNormal(p, out = V()) {
  const r = Math.hypot(p.x, p.y) || 1;
  const c = Math.cos(Math.atan(CONE_K));
  const s = Math.sin(Math.atan(CONE_K));
  return out.set((p.x / r) * c, (p.y / r) * c, -s);
}

/** Cylindrical angle of a point, measured from +Y toward +X (like the RCS quads), -PI..PI. */
export const thetaOf = (p) => Math.atan2(p.x, p.y);

// ------------------------------------------------------------------------------ frames
/**
 * A planar rectangle frame: origin (centre), x (right), y (up), z (normal toward the viewer /
 * cabin interior), size w × h. `matrix()` places a local XY-plane object (face toward +Z) on it.
 */
export class Frame {
  constructor(origin, right, up, w = 0, h = 0) {
    this.origin = origin.clone();
    this.x = right.clone().normalize();
    this.z = V().crossVectors(this.x, up).normalize();
    this.y = V().crossVectors(this.z, this.x);
    this.w = w;
    this.h = h;
  }
  /** World (body) point for local panel coordinates (u right, v up, n along the normal). */
  point(u, v, n = 0, out = V()) {
    return out.copy(this.origin).addScaledVector(this.x, u).addScaledVector(this.y, v).addScaledVector(this.z, n);
  }
  /** Local coordinates of a body point. */
  local(p) {
    const d = V().subVectors(p, this.origin);
    return V(d.dot(this.x), d.dot(this.y), d.dot(this.z));
  }
  matrix() {
    return new THREE.Matrix4().makeBasis(this.x, this.y, this.z).setPosition(this.origin);
  }
  quaternion() {
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.x, this.y, this.z));
  }
  /** Ray (p + t d) hits the rectangle (optionally grown by `margin`)? Returns t or NaN. */
  intersect(p, d, margin = 0) {
    const den = d.dot(this.z);
    if (Math.abs(den) < 1e-9) return NaN;
    const t = V().subVectors(this.origin, p).dot(this.z) / den;
    if (t <= 0) return NaN;
    const q = V().copy(p).addScaledVector(d, t).sub(this.origin);
    if (Math.abs(q.dot(this.x)) <= this.w / 2 + margin && Math.abs(q.dot(this.y)) <= this.h / 2 + margin) return t;
    return NaN;
  }
  /** Frame whose normal points from `origin` toward `target`, "up" as close as possible to `upHint`. */
  static facing(origin, target, upHint, w, h) {
    const n = V().subVectors(target, origin).normalize();
    const x = V().crossVectors(upHint, n).normalize();
    const y = V().crossVectors(n, x);
    return new Frame(origin, x, y, w, h);
  }
}

// ------------------------------------------------------------------------------ windows
/** Corner radius of the window apertures (the CM windows are rounded rectangles). */
const WINDOW_CORNER = { rendezvousLeft: 0.035, rendezvousRight: 0.035, sideLeft: 0.045, sideRight: 0.045 };

/**
 * Orthonormal window frame from CSM.windows[id]. The z axis is the OUTWARD normal (as in the
 * constants); `up` is orthogonalised against it (the side-window "up" is not exactly in-plane).
 * @param {string} id rendezvousLeft | rendezvousRight | sideLeft | sideRight | hatch
 */
export function windowFrame(id) {
  const w = CSM.windows[id];
  const n = w.normal.clone().normalize();
  const up = w.up.clone().addScaledVector(n, -w.up.dot(n)).normalize();
  const right = V().crossVectors(up, n).normalize();
  const f = new Frame(w.center, right, up, w.width, w.height);
  // Frame computed z = right × up which equals n for a right-handed (right, up, n)
  f.id = id;
  f.round = !!w.round;
  f.corner = f.round ? Math.min(w.width, w.height) / 2 : WINDOW_CORNER[id] ?? 0.03;
  return f;
}

/** All five window frames by id. */
export function windowFrames() {
  const out = {};
  for (const id of Object.keys(CSM.windows)) out[id] = windowFrame(id);
  return out;
}

/**
 * Outline of a window aperture in its own plane (local u, v), counter-clockwise, `n` points.
 * Rounded rectangle (or circle for the hatch window), grown by `grow` metres.
 */
export function apertureOutline(f, grow = 0, n = 48) {
  const pts = [];
  const hw = f.w / 2 + grow;
  const hh = f.h / 2 + grow;
  if (f.round) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([Math.cos(a) * hw, Math.sin(a) * hh]);
    }
    return pts;
  }
  const r = Math.min(f.corner + grow, hw, hh);
  const per = Math.max(2, Math.round(n / 4));
  const corners = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= per; i++) {
      const a = a0 + (i / per) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

/**
 * Window pocket through the pressure vessel: for each outline point of the aperture (grown by
 * `grow`), the point on the glass plane (outer) and where the pocket wall, running along -normal,
 * meets the INNER cone (inner). For the forward-looking rendezvous windows the pocket is a long
 * slanted tunnel; for the flush side / hatch windows it is the wall thickness.
 * @returns {{outer: THREE.Vector3[], inner: THREE.Vector3[], depth: number[]}}
 */
export function windowPocket(f, grow = 0, n = 48) {
  const outline = apertureOutline(f, grow, n);
  const d = f.z.clone().negate();
  const outer = [];
  const inner = [];
  const depth = [];
  for (const [u, v] of outline) {
    const p = f.point(u, v, 0);
    // start a little outside so the glass point itself is never inside the inner cone
    const start = p.clone().addScaledVector(d, -0.05);
    let t = rayCone(start, d);
    if (!Number.isFinite(t)) t = 0.2;
    t = Math.max(0.05, t) - 0.05;
    outer.push(p);
    inner.push(p.clone().addScaledVector(d, t));
    depth.push(t);
  }
  return { outer, inner, depth, outline };
}

// ------------------------------------------------------------------------------ Main Display Console
/** MDC geometry parameters (see mdcSections). */
export const MDC = {
  tiltDeg: 20, // panels lean back (top toward the apex) to face the crew's eyes
  wingDeg: 26, // wings fold toward the crew (concave console)
  centreWidth: 0.84,
  wingWidth: 0.53,
  height: CSM.mainDisplayConsole.height,
  wingHeight: 0.74,
  wingDrop: 0.03, // wings' centre sits slightly lower than the centre section's
  depth: 0.24, // console box depth behind the panel faces
};

/**
 * The three MDC sections (panel 1 = CDR/left wing, 2 = centre, 3 = LMP/right wing) as Frames
 * whose z axis points toward the crew.
 * @returns {{P1: Frame, P2: Frame, P3: Frame}}
 */
export function mdcSections() {
  const c = CSM.mainDisplayConsole.center;
  const a = MDC.tiltDeg * DEG;
  const b = MDC.wingDeg * DEG;
  const r0 = V(1, 0, 0);
  const u0 = V(0, Math.cos(a), -Math.sin(a));
  const n0 = V(0, Math.sin(a), Math.cos(a));
  const P2 = new Frame(c, r0, u0, MDC.centreWidth, MDC.height);
  const hw = MDC.centreWidth / 2;
  const make = (side) => {
    // hinge line at x = side*hw on the centre plane; the wing extends outward and folds toward +n
    const hinge = c.clone().addScaledVector(r0, side * hw).addScaledVector(u0, -MDC.wingDrop);
    const out = r0.clone().multiplyScalar(side * Math.cos(b)).addScaledVector(n0, Math.sin(b)); // hinge -> outer end
    const centre = hinge.clone().addScaledVector(out, MDC.wingWidth / 2);
    const right = side < 0 ? out.clone().negate() : out.clone(); // local +x always toward the crew's right
    return new Frame(centre, right, u0, MDC.wingWidth, MDC.wingHeight);
  };
  return { P1: make(-1), P2, P3: make(1) };
}

// ------------------------------------------------------------------------------ side consoles
/**
 * Side consoles beside the couches (below the side windows): panel 8 (CDR, left: circuit
 * breakers & lighting) with panel 15 below it, panel 5 (LMP, right) with panel 16 below it,
 * each tilted to face its crewman.
 */
export function sidePanels() {
  const eL = CSM.eyeCDR;
  const eR = CSM.eyeLMP;
  const up = V(0, 1, 0);
  const P8 = Frame.facing(V(-1.1, -0.31, -0.74), eL.clone().add(V(0.25, -0.35, 0.0)), up.clone().add(V(0, 0, -0.35)), 0.46, 0.44);
  const P5 = Frame.facing(V(1.1, -0.31, -0.74), eR.clone().add(V(-0.25, -0.35, 0.0)), up.clone().add(V(0, 0, -0.35)), 0.46, 0.44);
  const P15 = Frame.facing(V(-1.13, -0.36, -0.29), V(-0.35, -0.36, -0.45), V(0, 1, 0), 0.3, 0.34);
  const P16 = Frame.facing(V(1.13, -0.36, -0.29), V(0.35, -0.36, -0.45), V(0, 1, 0), 0.3, 0.34);
  return { P8, P5, P15, P16 };
}

// ------------------------------------------------------------------------------ Lower Equipment Bay
/**
 * LEB (at the crew's feet, -Y): the aft locker wall (flat, facing +Y), the G&N console (angled
 * along the cone, carrying the optics eyepieces, DSKY #2 and panel 122) and the closeout panel
 * between the G&N console and the underside of the MDC (panels 100/101).
 */
export function lebFrames() {
  // G&N console plane: from (y=-1.21, z=-0.62) rising to (y=-0.93, z=-1.13)
  const gnBot = V(0, -1.21, -0.6);
  const gnTop = V(0, -0.93, -1.13);
  const gnUp = V().subVectors(gnTop, gnBot).normalize();
  const GN = new Frame(gnBot.clone().add(gnTop).multiplyScalar(0.5), V(1, 0, 0), gnUp, 1.08, gnBot.distanceTo(gnTop));
  // lockers facing +Y from the aft bulkhead to the G&N console
  const LK = new Frame(V(0, -1.26, -0.37), V(1, 0, 0), V(0, 0, -1), 1.2, 0.49);
  // closeout between G&N top and the MDC lower edge
  const mdc = mdcSections().P2;
  const mdcBot = mdc.point(0, -mdc.h / 2, -0.02);
  const cUp = V().subVectors(mdcBot, gnTop).normalize();
  const CL = new Frame(gnTop.clone().add(mdcBot).multiplyScalar(0.5), V(1, 0, 0), cUp, 0.84, gnTop.distanceTo(mdcBot));
  return { GN, LK, CL };
}

// ------------------------------------------------------------------------------ couches & controls
/** Couch lateral positions (x) — CDR left, CMP centre, LMP right (under the eye points). */
export const COUCH_X = { CDR: CSM.eyeCDR.x, CMP: CSM.eyeCMP.x, LMP: CSM.eyeLMP.x };

/**
 * Couch profile in the couch's own plane (y, z of the body frame), metres: the pad surfaces the
 * body lies on (headrest, back, seat, legs, foot rest).
 */
export const COUCH = {
  headTop: V(0, 0.5, -0.235),
  head: V(0, 0.2, -0.24), // bottom of the headrest
  shoulder: V(0, 0.16, -0.225),
  hip: V(0, -0.41, -0.235),
  knee: V(0, -0.52, -0.66),
  heel: V(0, -0.97, -0.6),
  width: { head: 0.25, back: 0.5, seat: 0.48, legs: 0.4 },
  padThickness: 0.05,
};

/**
 * Hand controller mounts at the CDR station: the rotation hand controller (RHC) on the right
 * armrest, the translation hand controller (THC) on the left. Grip axis = +Y (a seated pilot's
 * "up"): the crew lie with their forearms along -Z.
 */
export const CONTROLLERS = {
  RHC: { base: V(CSM.eyeCDR.x + 0.29, -0.28, -0.64), axis: V(0, 1, 0) },
  THC: { base: V(CSM.eyeCDR.x - 0.3, -0.28, -0.64), axis: V(0, 1, 0) },
};

/**
 * Eye points of the IVA stations (body frame). RV = close to the left rendezvous window, looking
 * forward (-Z, parallel to the docking axis) through the COAS.
 */
export function stationEye(id) {
  if (id === 'CMP') return CSM.eyeCMP.clone();
  if (id === 'LMP') return CSM.eyeLMP.clone();
  if (id === 'RV') {
    // 0.42 m straight aft of the left rendezvous window centre, looking along the docking axis
    // (-Z) through the COAS — the same eye point as the camera module's RV station
    return CSM.windows.rendezvousLeft.center.clone().add(V(0, 0, 0.42));
  }
  return CSM.eyeCDR.clone();
}
