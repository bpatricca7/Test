// Landing Point Designator (LPD) reticle on the Commander's window — pure geometry (no DOM).
//
// The real LPD is a pair of scales etched on the inner and outer panes of the CDR's window. With his
// eye at the design eye point the CDR lines the two up and reads, against the landing site, the
// angle the LGC shows in N64 (R1, "AA"): the DEPRESSION ANGLE of the line of sight BELOW BODY -Z,
// measured in the body Y-Z plane. GNC computes it (gnc/guidance.js lpdAngles) as
//     elev = atan2(-d.y, -d.z)      with d = point - eyeCDR in body axes
// which is independent of d.x: every point that shares an LPD angle lies on ONE PLANE through the
// eye containing the body X axis. Each degree mark is therefore the straight line where that plane
// cuts the window pane — marks are computed exactly from LM.eyeCDR, so the reticle agrees with the
// DSKY number for a target anywhere across the window, not only on the scale line.
//
// The scale line itself is drawn at a constant azimuth (default 21 deg to the right of the eye,
// the direction that passes just inside the window's lower apex, so the whole visible range
// 0..~54 deg lies on one line). Marks beyond the glass (the pane ends at ~55 deg) are clipped away.
import * as THREE from 'three';
import { LM } from '../../../core/constants.js';

const D2R = Math.PI / 180;

/** LPD depression angle (deg) of a body-frame point seen from `eye` (same definition as GNC). */
export function lpdElevation(p, eye = LM.eyeCDR) {
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  return Math.atan2(-dy, -dz) / D2R;
}

/** Azimuth (deg, + = right) of a body-frame point seen from `eye` (same definition as GNC). */
export function lpdAzimuth(p, eye = LM.eyeCDR) {
  const d = new THREE.Vector3().subVectors(p, eye);
  return Math.atan2(d.x, Math.hypot(d.y, d.z)) / D2R;
}

/** Unit line-of-sight direction (body) for LPD elevation / azimuth (deg), as gnc lpdRay(). */
export function lpdDirection(elevDeg, azDeg, out = new THREE.Vector3()) {
  const e = elevDeg * D2R;
  const a = azDeg * D2R;
  return out.set(Math.sin(a), -Math.sin(e) * Math.cos(a), -Math.cos(e) * Math.cos(a));
}

/** Outward unit normal of a triangle given CCW-from-outside. */
export function triangleNormal(t) {
  return new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).normalize();
}

/**
 * Intersect the line of sight (eye + s * dir) with a plane {n, d} (n·p = d). Returns the point or null.
 */
function hitPlane(eye, dir, n, d) {
  const den = n.dot(dir);
  if (Math.abs(den) < 1e-9) return null;
  const s = (d - n.dot(eye)) / den;
  if (!(s > 0)) return null;
  return eye.clone().addScaledVector(dir, s);
}

/** 2D-in-plane clip of the segment a..b against a convex polygon (3D, coplanar). */
function clipSegmentToPolygon(a, b, poly, n) {
  let t0 = 0;
  let t1 = 1;
  const d = new THREE.Vector3().subVectors(b, a);
  const m = poly.length;
  // polygon CCW around n: inside is to the left of each edge: (e × (p - v)) · n >= 0
  for (let i = 0; i < m; i++) {
    const v0 = poly[i];
    const v1 = poly[(i + 1) % m];
    const e = new THREE.Vector3().subVectors(v1, v0);
    const f0 = new THREE.Vector3().crossVectors(e, new THREE.Vector3().subVectors(a, v0)).dot(n);
    const fd = new THREE.Vector3().crossVectors(e, d).dot(n);
    if (Math.abs(fd) < 1e-12) {
      if (f0 < 0) return null;
      continue;
    }
    const t = -f0 / fd;
    if (fd > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [a.clone().addScaledVector(d, t0), a.clone().addScaledVector(d, t1)];
}

/** Shrink a convex polygon toward its centroid by `inset` metres (approx. for triangles). */
function insetPolygon(poly, n, inset) {
  if (!inset) return poly.map((p) => p.clone());
  const m = poly.length;
  // move each edge line inward by inset, intersect consecutive edge lines
  const lines = [];
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % m];
    const e = new THREE.Vector3().subVectors(b, a).normalize();
    const inward = new THREE.Vector3().crossVectors(n, e).normalize(); // left of the edge (CCW)
    lines.push({ p: a.clone().addScaledVector(inward, inset), e });
  }
  const out = [];
  for (let i = 0; i < m; i++) {
    const L0 = lines[(i - 1 + m) % m];
    const L1 = lines[i];
    // solve L0.p + s L0.e = L1.p + t L1.e in the plane
    const w = new THREE.Vector3().subVectors(L1.p, L0.p);
    const c = new THREE.Vector3().crossVectors(L0.e, L1.e);
    const s = new THREE.Vector3().crossVectors(w, L1.e).dot(c) / c.lengthSq();
    out.push(L0.p.clone().addScaledVector(L0.e, s));
  }
  return out;
}

/**
 * Compute the LPD reticle on a window pane.
 * @param {object} [o]
 * @param {THREE.Vector3} [o.eye=LM.eyeCDR] design eye (body frame)
 * @param {THREE.Vector3[]} [o.tri=LM.windows.cdr] window triangle (CCW from outside)
 * @param {number} [o.paneOffset=0.006] distance of the marked pane INSIDE the window plane (m)
 * @param {number} [o.inset=0.012] keep marks this far inside the glass edge (m)
 * @param {number} [o.azimuth=21] scale-line azimuth (deg, + right of the eye)
 * @param {number} [o.min=0] first angle (deg)   @param {number} [o.max=80] last angle (deg)
 * @param {number} [o.step=1] minor step (deg)   @param {number} [o.labelEvery=10]
 * @param {number} [o.halfLen] tick half-lengths {minor, mid, major} (m, along the mark line)
 * @returns {{plane: {n: THREE.Vector3, d: number}, poly: THREE.Vector3[], scale: [THREE.Vector3, THREE.Vector3]|null,
 *   marks: Array<{deg: number, kind: 'minor'|'mid'|'major', a: THREE.Vector3, b: THREE.Vector3, center: THREE.Vector3,
 *   along: THREE.Vector3, label: string|null}>, maxVisible: number}}
 *   along = unit direction of the constant-angle line on the pane (points to the right, +X-ish).
 */
export function computeLPD(o = {}) {
  const eye = o.eye || LM.eyeCDR;
  const tri = o.tri || LM.windows.cdr;
  const nOut = triangleNormal(tri);
  const off = o.paneOffset ?? 0.006;
  // marked pane: parallel to the window plane, `off` toward the cabin (inside = -nOut)
  const pane = tri.map((p) => p.clone().addScaledVector(nOut, -off));
  const d = nOut.dot(pane[0]);
  const poly = insetPolygon(pane, nOut, o.inset ?? 0.012);
  const az = o.azimuth ?? 21;
  const min = o.min ?? 0;
  const max = o.max ?? 80;
  const step = o.step ?? 1;
  const labelEvery = o.labelEvery ?? 10;
  const hl = { minor: 0.0045, mid: 0.0075, major: 0.012, ...(o.halfLen || {}) };
  const marks = [];
  let maxVisible = -Infinity;
  let scaleTop = null;
  let scaleBot = null;
  for (let deg = min; deg <= max + 1e-9; deg += step) {
    const e = Math.round(deg * 1000) / 1000;
    const center = hitPlane(eye, lpdDirection(e, az), nOut, d);
    if (!center) continue;
    // the constant-angle line on the pane: direction = pane plane ∩ LOS plane (contains body X)
    const losN = new THREE.Vector3(0, Math.cos(e * D2R), -Math.sin(e * D2R)); // normal of the LOS plane
    const along = new THREE.Vector3().crossVectors(losN, nOut).normalize();
    if (along.x < 0) along.negate();
    const kind = Math.abs(e % labelEvery) < 1e-6 ? 'major' : Math.abs(e % 5) < 1e-6 ? 'mid' : 'minor';
    const h = hl[kind];
    const seg = clipSegmentToPolygon(center.clone().addScaledVector(along, -h), center.clone().addScaledVector(along, h), poly, nOut);
    if (!seg || seg[0].distanceTo(seg[1]) < h * 1.2) continue; // mark cut off by the frame
    marks.push({ deg: e, kind, a: seg[0], b: seg[1], center, along, label: kind === 'major' ? String(e) : null });
    maxVisible = Math.max(maxVisible, e);
    if (!scaleTop) scaleTop = center.clone();
    scaleBot = center.clone();
  }
  // the scale line runs between the extreme visible marks, extended a little upward (toward the
  // horizon) within the glass
  let scale = null;
  if (scaleTop && scaleBot) {
    const up = hitPlane(eye, lpdDirection(min - 4, az), nOut, d);
    const s0 = up || scaleTop;
    scale = clipSegmentToPolygon(s0, scaleBot, poly, nOut);
  }
  return { plane: { n: nOut, d }, poly, scale, marks, maxVisible };
}
