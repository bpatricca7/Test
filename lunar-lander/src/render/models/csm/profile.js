// Pure geometry description of the Apollo Block II CSM outer mould line (no three.js, no DOM), shared
// by the model builder (main thread) and the texture generator (Web Worker).
//
// CSM body frame (see core/constants.js): -Z forward (apex / probe), +Y head-up (side hatch),
// +X right; origin on the axis at the CM/SM interface plane.
//
// AZIMUTH convention used everywhere in this module: angle about +Z measured from +Y toward +X
// (the same convention as CSM.rcs.quadAngles), so a point at azimuth a and radius r is
// (r sin a, r cos a, z). Texture U runs around the vehicle with its seam on -Y:
//     u = (a + PI) / (2 PI)            (u = 0.5 at +Y, the side hatch)
//
// All lengths in metres.

import { CSM } from '../../../core/constants.js';

const TAU = Math.PI * 2;
const cm = CSM.cm;
const coneSlope = Math.tan(cm.coneHalfAngle); // dr / d(-z) of the conical crew-compartment heat shield

/** Radius of the conical crew-compartment heat shield at axial station z (valid 0 >= z >= coneTopZ). */
export function coneRadius(z) {
  return cm.baseRadius + coneSlope * z;
}

/**
 * Foil-covered outer mould line of the CM, from the aft rim (just forward of the brown ablator
 * toroid) over the conical heat shield and the rounded forward heat shield, to the flat annulus
 * around the docking tunnel. [r, z] pairs, traversed aft -> forward (outward normal = (-dz, dr)).
 */
export const CM_FOIL_PROFILE = (() => {
  const pts = [];
  const z0 = -0.02;
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const z = z0 + (cm.coneTopZ - z0) * (i / n);
    pts.push([coneRadius(z), z]);
  }
  // forward heat shield: continues the cone briefly, steepens, then rolls over onto a flat top
  pts.push(
    [0.603, -2.085],
    [0.586, -2.140],
    [0.574, -2.210],
    [0.566, -2.290],
    [0.559, -2.370],
    [0.548, -2.435],
    [0.530, -2.487],
    [0.506, -2.522],
    [0.478, -2.543],
    [0.452, cm.shoulderZ],
    [0.445, cm.shoulderZ],
  );
  return pts;
})();

/** Cumulative arclength table of CM_FOIL_PROFILE (texture V = s / length). */
export const CM_FOIL_ARC = (() => {
  const s = [0];
  for (let i = 1; i < CM_FOIL_PROFILE.length; i++) {
    const [r0, z0] = CM_FOIL_PROFILE[i - 1];
    const [r1, z1] = CM_FOIL_PROFILE[i];
    s.push(s[i - 1] + Math.hypot(r1 - r0, z1 - z0));
  }
  return { s, length: s[s.length - 1] };
})();

/** Outer radius of the foil skin at axial station z (0 outside the foil section). */
export function cmOuterRadius(z) {
  const P = CM_FOIL_PROFILE;
  if (z > P[0][1]) return z <= 0.06 ? cm.baseRadius : 0; // ablator rim region (approximate)
  if (z >= cm.coneTopZ) return coneRadius(z);
  for (let i = 1; i < P.length; i++) {
    const [r0, z0] = P[i - 1];
    const [r1, z1] = P[i];
    if (z <= z0 && z >= z1) {
      const t = z0 === z1 ? 0 : (z - z0) / (z1 - z0);
      return r0 + (r1 - r0) * t;
    }
  }
  return 0;
}

/** Texture V (0..1 along the foil profile) of axial station z on the foil. */
export function cmVofZ(z) {
  const P = CM_FOIL_PROFILE;
  const { s, length } = CM_FOIL_ARC;
  if (z >= P[0][1]) return 0;
  for (let i = 1; i < P.length; i++) {
    const z0 = P[i - 1][1];
    const z1 = P[i][1];
    if (z <= z0 && z >= z1) {
      const t = z0 === z1 ? 0 : (z - z0) / (z1 - z0);
      return (s[i - 1] + (s[i] - s[i - 1]) * t) / length;
    }
  }
  return 1;
}

/** {r, z} on the foil profile at texture V (inverse of cmVofZ). */
export function cmProfileAtV(v) {
  const P = CM_FOIL_PROFILE;
  const { s, length } = CM_FOIL_ARC;
  const target = Math.min(1, Math.max(0, v)) * length;
  for (let i = 1; i < P.length; i++) {
    if (target <= s[i] || i === P.length - 1) {
      const t = s[i] === s[i - 1] ? 0 : (target - s[i - 1]) / (s[i] - s[i - 1]);
      return { r: P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, z: P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t };
    }
  }
  return { r: P[P.length - 1][0], z: P[P.length - 1][1] };
}

/** Azimuth (rad, from +Y toward +X, -PI..PI) of a body-frame point. */
export function azimuthOf(x, y) {
  return Math.atan2(x, y);
}

/** Texture U of an azimuth (seam on -Y). */
export function uOfAzimuth(a) {
  let u = (a + Math.PI) / TAU;
  u -= Math.floor(u);
  return u;
}

/** Body-frame point [x, y, z] at azimuth a (rad), radius r, station z. */
export function pointAt(a, r, z) {
  return [r * Math.sin(a), r * Math.cos(a), z];
}

// ------------------------------------------------------------------ small vector helpers (arrays)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));
export const vec = { add, sub, mul, dot, cross, norm };

/** Signed height of point p above the CM foil surface (+ = outside), measured radially. */
export function heightAboveCM(p) {
  const R = cmOuterRadius(p[2]);
  return Math.hypot(p[0], p[1]) - R;
}

/**
 * Distance t >= tMin along unit direction d from p at which the ray meets the CM foil surface
 * (the first crossing from inside to outside). Bisection on the radial height function.
 */
export function rayToCMSurface(p, d, tMax = 0.6) {
  let a = 0;
  let ha = heightAboveCM(p);
  if (ha >= 0) {
    // already outside: march backwards until inside
    let t = 0;
    while (t > -tMax) {
      t -= 0.01;
      if (heightAboveCM(add(p, mul(d, t))) < 0) break;
    }
    a = t;
    ha = heightAboveCM(add(p, mul(d, a)));
  }
  let b = a;
  let hb = ha;
  const step = 0.005;
  while (b < tMax) {
    b += step;
    hb = heightAboveCM(add(p, mul(d, b)));
    if (hb >= 0) break;
  }
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    const hm = heightAboveCM(add(p, mul(d, m)));
    if (hm < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/**
 * Window pocket geometry for one of CSM.windows (plain-array form of the THREE.Vector3 fields).
 *
 * The outer (heat-shield) pane is a rounded rectangle / disc in the plane defined by the window's
 * centre, outward normal and up vector. It is pushed inward along -normal until every point of its
 * rim is at least `recess` below the foil, and a pocket wall joins the rim to the foil along the
 * normal (for the forward-looking rendezvous windows this becomes the characteristic scoop).
 *
 * @param {{center:number[], normal:number[], up:number[], width:number, height:number, round?:boolean}} w
 * @param {{recess?: number, frame?: number, segments?: number}} [opts]
 * @returns {{center:number[], normal:number[], up:number[], right:number[], shift:number,
 *   glassRim:number[][], frameRim:number[][], lipRim:number[][], footprintUV:number[][]}}
 *   glassRim: inner edge of the frame (the visible glass), frameRim: outer edge of the frame (glass
 *   plane), lipRim: where the pocket wall meets the foil, footprintUV: lipRim in texture (u, v).
 */
export function windowPocket(w, { recess = 0.02, frame = 0.018, segments = 40 } = {}) {
  const n = norm(w.normal);
  // make "up" orthogonal to the normal
  let up = sub(w.up, mul(n, dot(w.up, n)));
  up = norm(up);
  const right = cross(up, n);
  const outline = (hw, hh) => {
    const rc = w.round ? Math.min(hw, hh) : Math.min(0.045, Math.min(hw, hh) * 0.35);
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * TAU;
      const cx = Math.cos(a);
      const sy = Math.sin(a);
      const t = w.round ? Math.min(hw, hh) : roundedRectRay(cx, sy, hw, hh, rc);
      pts.push([cx * t, sy * t]);
    }
    return pts;
  };
  const outer = outline(w.width / 2 + frame, w.height / 2 + frame);
  const inner = outline(w.width / 2, w.height / 2);
  const toWorld = (x, y, c) => add(add(c, mul(right, x)), mul(up, y));
  // push the pane inward until the whole frame rim is at least `recess` below the foil
  let shift = 0;
  for (const [x, y] of outer) {
    const t = rayToCMSurface(toWorld(x, y, w.center), n); // > 0: rim point is below the surface by t
    shift = Math.max(shift, recess - t);
  }
  const center = sub(w.center, mul(n, shift));
  const frameRim = outer.map(([x, y]) => toWorld(x, y, center));
  const glassRim = inner.map(([x, y]) => toWorld(x, y, center));
  const lipRim = frameRim.map((p) => add(p, mul(n, rayToCMSurface(p, n))));
  const footprintUV = lipRim.map((p) => [uOfAzimuth(azimuthOf(p[0], p[1])), cmVofZ(p[2])]);
  return { center, normal: n, up, right, shift, glassRim, frameRim, lipRim, footprintUV };
}

/** Distance along direction (cx, sy) (unit) from the centre to a rounded rectangle's edge. */
function roundedRectRay(cx, sy, hw, hh, rc) {
  // bisection on the signed distance function of the rounded box
  let a = 0;
  let b = Math.hypot(hw, hh) + 0.01;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    const qx = Math.abs(cx * m) - (hw - rc);
    const qy = Math.abs(sy * m) - (hh - rc);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
    if (d < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

// ------------------------------------------------------------------ SPS nozzle
/**
 * Inner contour of the SPS nozzle extension (quadratic Bezier bell, Rao-like), from the attach
 * flange at z = 5.34 (r = 0.36, 30 deg half-angle) to the exit plane (CSM.sps.nozzleExit, r = 1.25,
 * 8 deg exit angle), preceded by the throat region (hidden in the chamber).
 * @param {number} [n] samples along the bell
 * @returns {number[][]} [r, z] from the throat to the exit
 */
export function spsInnerProfile(n = 28) {
  const zExit = CSM.sps.nozzleExit.z;
  const rExit = CSM.sps.nozzleExitRadius;
  const zThroat = CSM.sps.nozzleThroat.z;
  const P0 = [0.36, 5.34];
  const P2 = [rExit, zExit];
  // tangents: 30 deg at the flange, 8 deg at the exit -> control point at the tangent intersection
  const t0 = [Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180)];
  const t2 = [Math.sin(8 * Math.PI / 180), Math.cos(8 * Math.PI / 180)];
  // P0 + a t0 = P2 - b t2
  const det = t0[0] * -t2[1] - -t2[0] * t0[1];
  const rx = P2[0] - P0[0];
  const rz = P2[1] - P0[1];
  const a = (rx * -t2[1] - -t2[0] * rz) / det;
  const P1 = [P0[0] + a * t0[0], P0[1] + a * t0[1]];
  const pts = [
    [0.17, zThroat - 0.12],
    [0.148, zThroat - 0.04],
    [0.145, zThroat],
    [0.175, zThroat + 0.07],
    [0.25, zThroat + 0.14],
    [0.32, 5.30],
  ];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k0 = (1 - t) * (1 - t);
    const k1 = 2 * (1 - t) * t;
    const k2 = t * t;
    pts.push([k0 * P0[0] + k1 * P1[0] + k2 * P2[0], k0 * P0[1] + k1 * P1[1] + k2 * P2[1]]);
  }
  return pts;
}

/** Inner radius of the SPS bell at station z (linear interpolation of spsInnerProfile). */
export function spsInnerRadius(z, prof = spsInnerProfile()) {
  if (z <= prof[0][1]) return prof[0][0];
  for (let i = 1; i < prof.length; i++) {
    if (z <= prof[i][1]) {
      const t = (z - prof[i - 1][1]) / (prof[i][1] - prof[i - 1][1]);
      return prof[i - 1][0] + (prof[i][0] - prof[i - 1][0]) * t;
    }
  }
  return prof[prof.length - 1][0];
}

// ------------------------------------------------------------------ SM layout (azimuths in degrees)
/**
 * Where things sit on the Service Module skin. Azimuths in DEGREES from +Y toward +X; z in metres.
 * Shared by the geometry builder and the skin texture generator so painted panels and 3-D parts
 * line up.
 */
export const SM_LAYOUT = {
  zFront: CSM.sm.zFront,
  zRear: CSM.sm.zRear,
  radius: CSM.sm.radius,
  // the six radial-beam sector boundaries (longitudinal panel joints)
  sectorBoundaries: [40, 110, 170, 220, 290, 350],
  // circumferential joints
  rings: [0.64, 2.02, 4.36, 4.86],
  // fuel-cell (EPS) radiators: eight panels on the forward band
  eps: { z0: 0.12, z1: 0.58, centres: [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5], width: 30 },
  // environmental control (ECS) space radiators: two large panels on opposite sides
  ecs: { z0: 2.16, z1: 4.24, centres: [52, 232], width: 40 },
  // RCS quad mounting panels (centred on the quads)
  quadPanel: { halfWidthDeg: 11.5, z0: 0.93, z1: 1.77 },
  // "UNITED STATES" + flag decal strips
  decals: { centres: [142, 322], halfWidthM: 0.26, z0: 0.84, z1: 4.66 },
  // VHF scimitar antennas
  scimitars: [{ az: 45, z0: 0.76, z1: 1.32 }, { az: 225, z0: 0.76, z1: 1.32 }],
  // S-band high-gain antenna boom root (aft edge)
  hga: { az: 232, z: 4.84 },
  // CM/SM umbilical fairing
  umbilical: { az: 180, z0: 0.05, z1: 0.52, width: 0.30 },
  // running / docking lights and the flashing rendezvous beacon
  lights: [
    { az: 262, z: 0.36, color: 'red' },
    { az: 82, z: 0.36, color: 'green' },
    { az: 0, z: 0.36, color: 'amber' },
    { az: 180 + 24, z: 0.36, color: 'amber' },
    { az: 300, z: 0.24, color: 'beacon' },
  ],
  // small service panels (fill/drain, vents): [az, z, wM, hM]
  service: [
    [128, 1.25, 0.22, 0.30], [132, 1.62, 0.16, 0.16], [305, 2.35, 0.28, 0.20], [300, 1.05, 0.14, 0.2],
    [20, 3.05, 0.34, 0.24], [18, 4.62, 0.3, 0.16], [160, 4.55, 0.26, 0.14], [200, 3.2, 0.24, 0.32],
    [248, 1.05, 0.18, 0.26], [76, 1.1, 0.2, 0.16], [98, 3.4, 0.3, 0.42], [278, 3.35, 0.3, 0.4],
    [10, 2.3, 0.16, 0.16], [190, 2.05, 0.2, 0.12], [340, 4.6, 0.2, 0.16], [110, 4.6, 0.22, 0.16],
  ],
};

/**
 * CM surface features for the foil texture: side-hatch outline, the 12 CM RCS engine ports, the four
 * flush S-band omni antennas and the heat-shield joint. Azimuths in DEGREES, z in metres.
 */
export const CM_FEATURES = {
  hatch: { az: 0, zTop: -1.46, zBottom: -0.60, widthM: 0.80 },
  forwardJointZ: cm.coneTopZ,
  // CM RCS: 2 pitch (+Y, near the apex), 2 pitch (-Y, near the base), 2+2 yaw (+-X, near the base),
  // 4 roll (upper/lower quadrants near the base). [az, z]
  rcsPorts: [
    [-9, -1.86], [9, -1.86],
    [168, -0.30], [192, -0.30],
    [83, -0.30], [97, -0.30], [263, -0.30], [277, -0.30],
    [150, -0.40], [210, -0.40], [330, -0.40], [30, -0.40],
  ],
  omni: [[45, -0.55], [135, -0.55], [225, -0.55], [315, -0.55]],
  // small vents / dump nozzles: [az, z, radius]
  vents: [[240, -0.95, 0.018], [244, -1.02, 0.014], [118, -1.30, 0.016], [300, -1.62, 0.014]],
};
