// Apollo 11 LM ascent stage "Eagle" — procedural exterior.
//
// Body frame (see constants.js): +Y up (thrust axis), -Z forward (windows), +X right (crew's right).
//
// Layout (all from constants where the numbers exist):
//   * forward crew cabin: faceted shell around the 2.34-m pressure cylinder; the front face is made
//     of the two triangular-window facets (planes through LM.windows.cdr / lmp EXACTLY), the lower
//     hatch face (forward hatch at LM.forwardHatch) and chamfered cheeks; black-anodized "mask"
//     around the windows, grey panels elsewhere.
//   * midsection above the ascent engine with the docking tunnel / drogue on top (LM.docking.port)
//     and the overhead docking window above the CDR (LM.windows.overhead).
//   * APS propellant-tank fairings (fuel left, oxidizer right) as faceted domes on the lower sides.
//   * aft equipment bay with its support struts.
//   * four RCS quads (lmRcsJets(): nozzle exits exactly at the jet positions) on support beams.
//   * rendezvous radar (front top), S-band steerable dish (right), VHF / EVA / S-band inflight
//     antennas, docking target, tracking light, docking lights, EVA handrails.
//   * underside: APS nozzle exit at LM.aps.nozzleExit (visible after staging).

import * as THREE from 'three';
import { LM, lmRcsJets } from '../../../core/constants.js';
import { Batch, V, tube, lathe, box, hull, dish, flip, alignY, blanket, polygon, boxUV } from './geom.js';
import { plane, clipPolyhedron, facesToGeometry, faceWithHoles, frameRing, insetPolygonGeo, offsetPolygon } from './poly.js';

const deg = Math.PI / 180;

/** Outward normal of a CCW-from-outside triangle. */
function triNormal(t) {
  return new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).normalize();
}

/** Add polyhedron faces to a batch, choosing the material per face with tagFn(face). */
function addFaces(batch, faces, tagFn, uvOffset) {
  const groups = new Map();
  for (const f of faces) {
    const t = tagFn ? tagFn(f) : f.tag;
    if (!t) continue;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(f);
  }
  for (const [t, list] of groups) batch.add(t, facesToGeometry(list, 1, uvOffset));
}

/**
 * RCS nozzle (combustion chamber + bell) along unit `dir` from the quad centre `c`; exit plane at
 * `exitDist` from the centre. Adds outer / inner surfaces to the batch.
 */
function rcsThruster(b, c, dir, exitDist) {
  const len = 0.14; // visible bell length
  const exitR = 0.068;
  const prof = [];
  const inner = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const r = 0.03 + (exitR - 0.03) * (1 - Math.pow(1 - s, 1.6));
    prof.push([r + 0.004, exitDist - len + s * len]);
    inner.push([r, exitDist - len + s * len]);
  }
  prof.push([exitR + 0.004, exitDist]);
  inner.reverse();
  const m = alignY(c, dir);
  const outer = lathe([[0.046, exitDist - len - 0.08], [0.046, exitDist - len - 0.005], [0.034, exitDist - len], ...prof], 16);
  outer.applyMatrix4(m);
  b.add('rcsNozzle', outer);
  // exit lip + interior (dark, facing inward)
  const lip = lathe([[exitR + 0.004, exitDist], [exitR - 0.001, exitDist + 0.002], ...inner], 16);
  lip.applyMatrix4(m);
  b.add('nozzleInner', lip);
}

/**
 * Build the ascent stage.
 * @param {Object<string, THREE.Material>} M materials from createLMMaterials()
 * @returns {{group: THREE.Group, quads: THREE.Group, trackingLight: THREE.Mesh, dockingLights: THREE.Mesh[]}}
 */
export function buildAscentStage(M) {
  const group = new THREE.Group();
  group.name = 'LM ascent stage';
  const b = new Batch('ascent');
  const bq = new Batch('rcsQuads');

  const W = LM.windows;
  const nL = triNormal(W.cdr);
  const nR = triNormal(W.lmp);
  const zFront = -1.255; // lower front (hatch) face
  const roofY = 5.8; // forward cabin roof (clears the 2.34-m pressure cylinder, top at y = 5.77)

  // --------------------------------------------------------------- forward crew cabin shell
  const cabinPlanes = [
    plane(V(0, 0, -1), V(0, 0, zFront), 'asGrey'),
    plane(nL, W.cdr[0], 'asGrey'),
    plane(nR, W.lmp[0], 'asGrey'),
    plane(V(0, 0.7, -0.7), V(0, 5.64, -1.13), 'asBlack'), // brow above the windows
    plane(V(0, 1, 0), V(0, roofY, 0), 'asBlack'), // forward roof
    plane(V(-0.75, 0, -0.66), V(-1.05, 0, -0.92), 'asGrey'), // cheeks
    plane(V(0.75, 0, -0.66), V(1.05, 0, -0.92), 'asGrey'),
    plane(V(-1, 0, 0), V(-1.3, 0, 0), 'asGrey'),
    plane(V(1, 0, 0), V(1.3, 0, 0), 'asGrey'),
    plane(V(0, -1, 0), V(0, 3.2, 0), 'gold'),
    plane(V(-0.6, -0.8, 0), V(-1.3, 3.55, 0), 'asGrey'),
    plane(V(0.6, -0.8, 0), V(1.3, 3.55, 0), 'asGrey'),
    plane(V(-0.55, 0.83, 0), V(-1.3, 5.42, 0), 'asBlack'),
    plane(V(0.55, 0.83, 0), V(1.3, 5.42, 0), 'asBlack'),
    plane(V(0, -0.6, -0.8), V(0, 3.2, -1.17), 'asGrey'),
    plane(V(0, 0, 1), V(0, 0, -0.2), 'asGrey'),
  ];
  const cabin = clipPolyhedron(cabinPlanes, new THREE.Box3(V(-2, 3, -2), V(2, 6.5, 0.5)), 'asGrey');
  // the two window facets get real openings (the glass is semi-transparent and a dim cabin cavity
  // sits behind it, so from outside you see depth and the sun patch on the panels inside)
  // the overhead docking window sits at its true height (LM.windows.overhead.center.y) in a
  // recessed well cut through the roof; its opening (window + frame) is the roof hole
  const ow = W.overhead;
  const owRect = (y, grow) => [
    V(ow.center.x - ow.width / 2 - grow, y, ow.center.z + ow.height / 2 + grow),
    V(ow.center.x + ow.width / 2 + grow, y, ow.center.z + ow.height / 2 + grow),
    V(ow.center.x + ow.width / 2 + grow, y, ow.center.z - ow.height / 2 - grow),
    V(ow.center.x - ow.width / 2 - grow, y, ow.center.z - ow.height / 2 - grow),
  ];
  const windowFaces = [];
  const otherFaces = [];
  for (const f of cabin) {
    if (f.n.dot(nL) > 0.9999) windowFaces.push([f, W.cdr]);
    else if (f.n.dot(nR) > 0.9999) windowFaces.push([f, W.lmp]);
    else if (f.n.y > 0.9999) windowFaces.push([f, owRect(roofY, 0.04)]);
    else otherFaces.push(f);
  }
  addFaces(b, otherFaces, null, [0.13, 0.41]);
  for (const [f, tri] of windowFaces) b.add(f.tag, faceWithHoles(f, [tri], [0.13, 0.41]));
  {
    // cabin cavity: the cabin shell inset by 3 cm, facing inward (never pokes outside the shell)
    const inset = cabinPlanes.map((p) => ({ n: p.n, d: p.d - 0.03, tag: 'cabinInt' }));
    const cav = clipPolyhedron(inset, new THREE.Box3(V(-2, 3, -2), V(2, 6.5, 0.5)), 'cabinInt');
    b.add('cabinInt', flip(facesToGeometry(cav, 1)));
    b.add('cabinPanel', box(V(0, 4.3, -1.0), V(1.2, 0.72, 0.2)));
    b.add('cabinPanel', box(V(0, 4.72, -1.02), V(0.34, 0.24, 0.16)));
    for (const sx of [-1, 1]) b.add('cabinPanel', box(V(sx * 0.5, 4.85, -0.98), V(0.3, 0.45, 0.14)));
  }

  // black-anodized panel bands (thermal control / RCS plume impingement areas)
  for (const sx of [-1, 1]) {
    const x = sx * 1.3035;
    const zs = sx > 0 ? [-0.2, -0.7] : [-0.7, -0.2]; // CCW seen from outside
    const band = [V(x, 4.5, zs[0]), V(x, 4.5, zs[1]), V(x, 5.15, zs[1]), V(x, 5.15, zs[0])];
    b.add('asBlack', insetPolygonGeo(band, V(sx, 0, 0), 0));
    const xm = sx * 1.1035;
    const zm = sx > 0 ? [0.75, -0.2] : [-0.2, 0.75];
    const mpanel = [V(xm, 4.72, zm[0]), V(xm, 4.72, zm[1]), V(xm, 5.62, zm[1]), V(xm, 5.62, zm[0])];
    b.add('asBlack', insetPolygonGeo(mpanel, V(sx, 0, 0), 0));
  }

  // --------------------------------------------------------------- midsection (tunnel, engine cover)
  const mid = clipPolyhedron(
    [
      plane(V(-1, 0, 0), V(-1.1, 0, 0), 'asGrey'),
      plane(V(1, 0, 0), V(1.1, 0, 0), 'asGrey'),
      plane(V(0, -1, 0), V(0, 3.1, 0), 'gold'),
      plane(V(0, 1, 0), V(0, 6.1, 0), 'asBlack'),
      plane(V(0, 0, -1), V(0, 0, -0.45), 'asGrey'),
      plane(V(0, 0, 1), V(0, 0, 0.8), 'asGrey'),
      plane(V(-0.6, 0.8, 0), V(-1.1, 5.75, 0), 'asBlack'),
      plane(V(0.6, 0.8, 0), V(1.1, 5.75, 0), 'asBlack'),
      plane(V(0, 0.75, -0.66), V(0, 6.1, -0.25), 'asBlack'),
      plane(V(0, 0.75, 0.66), V(0, 6.1, 0.6), 'asBlack'),
      plane(V(-0.7, -0.7, 0), V(-1.1, 3.45, 0), 'asGrey'),
      plane(V(0.7, -0.7, 0), V(1.1, 3.45, 0), 'asGrey'),
    ],
    new THREE.Box3(V(-2, 3, -1), V(2, 7, 1.5)),
  );
  addFaces(b, mid, null, [0.71, 0.2]);

  // --------------------------------------------------------------- APS tank fairings (faceted domes)
  const tankDome = (cx, cy, cz, R, outerX, side, ay = 0.85, az = 1.35) => {
    // faceted fairing: tangent planes of an ellipsoid (elongated fore-aft) around the tank
    const planes = [];
    const C = V(cx, cy, cz);
    const rings = [
      { pol: 22 * deg, n: 6, off: 0 },
      { pol: 45 * deg, n: 10, off: 18 * deg },
      { pol: 68 * deg, n: 12, off: 0 },
      { pol: 90 * deg, n: 12, off: 15 * deg },
      { pol: 115 * deg, n: 10, off: 0 },
    ];
    for (const r of rings) {
      for (let k = 0; k < r.n; k++) {
        const az0 = r.off + (k * 2 * Math.PI) / r.n;
        const u = V(side * Math.cos(r.pol), Math.sin(r.pol) * Math.cos(az0), Math.sin(r.pol) * Math.sin(az0));
        const p = C.clone().add(V(u.x * R, u.y * R * ay, u.z * R * az));
        const nrm = V(u.x, u.y / ay, u.z / az);
        planes.push(plane(nrm, p, 'asGrey'));
      }
    }
    planes.push(plane(V(side, 0, 0), V(outerX, 0, 0), 'asGrey'));
    planes.push(plane(V(-side, 0, 0), V(cx - side * 0.1, 0, 0), null));
    planes.push(plane(V(0, -1, 0), V(0, 3.12, 0), 'gold'));
    const faces = clipPolyhedron(planes, new THREE.Box3(V(-3, 2.5, -2), V(3, 6, 2)));
    addFaces(b, faces, (f) => f.tag, [cx, cz]);
  };
  tankDome(-0.98, 3.86, 0.22, 0.56, -1.47, -1, 0.78, 1.55); // fuel (Aerozine 50) — left
  tankDome(0.95, 3.85, 0.18, 0.54, 1.43, 1, 0.78, 1.5); // oxidizer (N2O4) — right

  // --------------------------------------------------------------- aft equipment bay
  const aft = clipPolyhedron(
    [
      plane(V(-1, 0, 0), V(-0.95, 0, 0), 'asGrey'),
      plane(V(1, 0, 0), V(0.95, 0, 0), 'asGrey'),
      plane(V(0, -1, 0), V(0, 4.05, 0), 'gold'),
      plane(V(0, 1, 0), V(0, 5.78, 0), 'blackQuilt'),
      plane(V(0, 0, 1), V(0, 0, 1.42), 'blackQuilt'),
      plane(V(0, 0, -1), V(0, 0, 0.7), null),
      plane(V(0, 0.7, 0.7), V(0, 5.78, 1.2), 'asBlack'),
      plane(V(0, -0.7, 0.7), V(0, 4.05, 1.25), 'asBlack'),
      plane(V(-0.7, 0, 0.7), V(-0.95, 0, 1.27), 'asBlack'),
      plane(V(0.7, 0, 0.7), V(0.95, 0, 1.27), 'asBlack'),
    ],
    new THREE.Box3(V(-2, 3.5, 0.5), V(2, 6.5, 2)),
  );
  addFaces(b, aft, (f) => f.tag, [0.3, 0.9]);
  // aft-bay support struts (tubular, visible under the bay)
  for (const sx of [-1, 1]) {
    b.add('metal', tube(V(sx * 0.82, 4.07, 1.3), V(sx * 0.9, 3.25, 0.74), 0.028, 0.028, 8));
    b.add('metal', tube(V(sx * 0.82, 4.07, 1.3), V(sx * 0.35, 3.2, 0.78), 0.024, 0.024, 8));
    b.add('metal', tube(V(sx * 0.55, 4.07, 0.95), V(sx * 0.95, 3.35, 0.72), 0.02, 0.02, 8));
  }
  // equipment on the aft bay rear face: two cold-plate / battery boxes wrapped in foil
  b.add('silver', blanket(V(-0.8, 4.2, 1.43), V(-0.1, 4.2, 1.43), V(-0.1, 5.0, 1.43), V(-0.8, 5.0, 1.43), { bulge: 0.03, seed: 5, nu: 8, nv: 8 }));
  b.add('gold', blanket(V(0.1, 4.2, 1.43), V(0.8, 4.2, 1.43), V(0.8, 5.05, 1.43), V(0.1, 5.05, 1.43), { bulge: 0.035, seed: 6, nu: 8, nv: 8 }));

  // --------------------------------------------------------------- windows (glass + frames)
  for (const [tri, n] of [
    [W.cdr, nL],
    [W.lmp, nR],
  ]) {
    b.add('glass', insetPolygonGeo(tri, n, 0.004));
    b.add('black', frameRing(tri, n, 0.045, 0.02, 0.01));
    // outer trim: a thin second ring of bright metal (window retainer)
    b.add('darkMetal', frameRing(offsetPolygon(tri, n, 0.045), n, 0.018, 0.012, 0.005));
  }
  // overhead docking window (above the CDR), with its frame
  {
    const y = ow.center.y;
    const rect = owRect(y, 0);
    b.add('glass', insetPolygonGeo(rect, V(0, 1, 0), 0.002));
    b.add('black', frameRing(rect, V(0, 1, 0), 0.04, 0.012, 0.0));
    // well walls from the frame up to the roof (facing into the well)
    const lo = owRect(y, 0.04);
    const hi = owRect(roofY, 0.04);
    const pos = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      for (const q of [lo[i], hi[j], lo[j], lo[i], hi[i], hi[j]]) pos.push(q.x, q.y, q.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    b.add('asBlack', boxUV(g, 1));
    // raised coaming around the well
    b.add('black', frameRing(owRect(roofY, 0.04), V(0, 1, 0), 0.03, 0.02, 0.0));
  }

  // --------------------------------------------------------------- forward hatch
  {
    const h = LM.forwardHatch;
    const hw = h.width / 2;
    const hh = h.height / 2;
    const z = zFront - 0.004;
    const c = h.center;
    // slightly rounded square: 8-gon with small corner chamfers (CCW seen from the front, n = -Z)
    const k = 0.06;
    const pts = [
      V(c.x + hw, c.y - hh + k, z), V(c.x + hw - k, c.y - hh, z), V(c.x - hw + k, c.y - hh, z), V(c.x - hw, c.y - hh + k, z),
      V(c.x - hw, c.y + hh - k, z), V(c.x - hw + k, c.y + hh, z), V(c.x + hw - k, c.y + hh, z), V(c.x + hw, c.y + hh - k, z),
    ];
    const n = V(0, 0, -1);
    // hatch door: slightly proud panel with its own panel texture
    b.add('asGrey', insetPolygonGeo(pts, n, 0.012));
    b.add('asGrey', frameRing(pts, n, 0.0, 0.012, 0.0));
    b.add('black', frameRing(offsetPolygon(pts, n, 0.012), n, 0.035, 0.008, 0.0));
    // handle (right side, crew's view from inside = our +X... the external handle sits on the hinge-free edge)
    const hx = c.x - hw + 0.12;
    b.add('metal', tube(V(hx, c.y - 0.1, z - 0.012), V(hx, c.y - 0.1, z - 0.05), 0.012, 0.012, 8));
    b.add('metal', tube(V(hx, c.y + 0.1, z - 0.012), V(hx, c.y + 0.1, z - 0.05), 0.012, 0.012, 8));
    b.add('metal', tube(V(hx, c.y - 0.11, z - 0.05), V(hx, c.y + 0.11, z - 0.05), 0.014, 0.014, 8));
    // hinges on the right edge
    for (const dy of [-0.28, 0.28]) b.add('darkMetal', box(V(c.x + hw + 0.01, c.y + dy, z - 0.02), V(0.05, 0.1, 0.04)));
    // placard next to the handle
    const mk = M.markings.userData.rects;
    if (mk) {
      const r = mk.hatch;
      const g = polygon([V(hx + 0.22, c.y - 0.06, z - 0.013), V(hx + 0.06, c.y - 0.06, z - 0.013), V(hx + 0.06, c.y + 0.1, z - 0.013), V(hx + 0.22, c.y + 0.1, z - 0.013)]);
      const uv = g.attributes.uv;
      // polygon() is fan-triangulated around the centre; map uv from local position
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = (hx + 0.22 - p.getX(i)) / 0.16;
        const v = (p.getY(i) - (c.y - 0.06)) / 0.16;
        uv.setXY(i, r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v);
      }
      b.add('markings', g);
    }
    // EVA handrails either side of the hatch
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.14);
      const zz = zFront - 0.07;
      b.add('metal', tube(V(x, 3.5, zz), V(x, 4.25, zz), 0.013, 0.013, 8));
      b.add('metal', tube(V(x, 3.5, zFront), V(x, 3.5, zz), 0.01, 0.01, 6));
      b.add('metal', tube(V(x, 4.25, zFront), V(x, 4.25, zz), 0.01, 0.01, 6));
    }
  }

  // --------------------------------------------------------------- docking tunnel & drogue
  {
    const top = LM.docking.port.y; // 6.45
    const R = LM.docking.tunnelRadius + 0.1;
    b.add('asBlack', lathe([[R + 0.06, 6.02], [R + 0.04, 6.1], [R, 6.14], [R, top - 0.07]], 32));
    b.add('metal', lathe([[R, top - 0.07], [R + 0.02, top - 0.05], [R + 0.02, top - 0.01], [R - 0.02, top], [R - 0.09, top]], 32));
    // drogue cone (receives the CSM probe) and the hatch at its apex
    b.add('darkMetal', lathe([[R - 0.09, top - 0.004], [R - 0.12, top - 0.02], [0.08, top - 0.23], [0.05, top - 0.25], [0.001, top - 0.25]], 32));
    // 12 latch-receiving lugs around the ring
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.add('metal', box(V(Math.cos(a) * (R + 0.035), top - 0.03, Math.sin(a) * (R + 0.035)), V(0.035, 0.05, 0.035)));
    }
  }

  // --------------------------------------------------------------- docking target (standoff cross)
  {
    const c = V(-0.62, 6.1, 0.5); // on the upper deck, clear of the tunnel base
    b.add('black', lathe([[0.19, c.y], [0.19, c.y + 0.012], [0.0, c.y + 0.012]], 24));
    const mk = M.markings.userData.rects;
    if (mk) {
      const r = mk.target;
      const g = lathe([[0.17, c.y + 0.013], [0.001, c.y + 0.013]], 24);
      const p = g.attributes.position;
      const uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const u = 0.5 + p.getX(i) / 0.36;
        const v = 0.5 - p.getZ(i) / 0.36;
        uv.setXY(i, r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v);
      }
      g.translate(c.x, 0, c.z);
      b.add('markings', g);
    }
    // post + cross (white)
    b.add('white', tube(V(c.x, c.y, c.z), V(c.x, c.y + 0.38, c.z), 0.012, 0.012, 8));
    b.add('white', box(V(c.x, c.y + 0.38, c.z), V(0.2, 0.02, 0.022)));
    b.add('white', box(V(c.x, c.y + 0.38, c.z), V(0.022, 0.02, 0.2)));
  }

  // --------------------------------------------------------------- rendezvous radar (front, top)
  {
    const base = V(0.18, roofY, -0.72);
    b.add('asGrey', box(V(base.x, base.y + 0.07, base.z), V(0.28, 0.14, 0.28)));
    b.add('darkMetal', tube(V(base.x, base.y + 0.14, base.z), V(base.x, base.y + 0.34, base.z), 0.06, 0.05, 12));
    // trunnion yoke
    const pivot = V(base.x, base.y + 0.42, base.z - 0.02);
    for (const sx of [-1, 1]) {
      b.add('darkMetal', box(V(pivot.x + sx * 0.2, pivot.y - 0.02, pivot.z), V(0.03, 0.2, 0.08)));
    }
    b.add('darkMetal', box(V(pivot.x, pivot.y - 0.1, pivot.z), V(0.43, 0.04, 0.08)));
    // dish looking forward & up (stowed-ish), 24-in reflector
    const axis = V(0, 0.55, -0.83).normalize();
    const dc = pivot.clone().addScaledVector(axis, -0.02);
    const m = alignY(dc, axis);
    const front = dish(0.305, 0.08, 28, 6);
    front.applyMatrix4(m);
    b.add('white', front);
    const back = flip(dish(0.31, 0.08, 28, 4)).translate(0, -0.012, 0);
    back.applyMatrix4(m);
    b.add('gold', back);
    // cassegrain feed: sub-reflector on 4 struts
    const feed = dc.clone().addScaledVector(axis, 0.2);
    b.add('darkMetal', tube(dc.clone().addScaledVector(axis, 0.03), feed, 0.03, 0.02, 10));
    b.add('white', lathe([[0.05, 0], [0.04, 0.012], [0.0, 0.02]], 12).applyMatrix4(alignY(feed, axis)));
  }

  // --------------------------------------------------------------- S-band steerable antenna (right)
  {
    const root = V(1.08, 5.78, 0.42);
    const elbow = V(1.42, 6.15, 0.5);
    b.add('asGrey', box(V(root.x, root.y - 0.02, root.z), V(0.2, 0.16, 0.22)));
    b.add('metal', tube(root, elbow, 0.035, 0.03, 10));
    b.add('darkMetal', box(elbow, V(0.12, 0.12, 0.12)));
    const axis = V(0.45, 0.8, -0.4).normalize();
    const dc = elbow.clone().addScaledVector(axis, 0.1);
    const m = alignY(dc, axis);
    const front = dish(0.33, 0.09, 28, 6);
    front.applyMatrix4(m);
    b.add('white', front);
    const back = flip(dish(0.335, 0.09, 28, 4)).translate(0, -0.012, 0);
    back.applyMatrix4(m);
    b.add('gold', back);
    const feed = dc.clone().addScaledVector(axis, 0.24);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const rim = V(Math.cos(a) * 0.3, 0.08, Math.sin(a) * 0.3).applyMatrix4(m);
      b.add('metal', tube(rim, feed, 0.007, 0.007, 5));
    }
    b.add('white', lathe([[0.05, -0.02], [0.05, 0.02], [0.0, 0.03]], 12).applyMatrix4(alignY(feed, axis)));
  }

  // --------------------------------------------------------------- VHF, EVA and S-band inflight antennas
  {
    // VHF inflight antennas: forward (upper left) and aft (upper right) "spikes"
    const vhf = (base, dir, len) => {
      const d = dir.clone().normalize();
      b.add('darkMetal', tube(base, base.clone().addScaledVector(d, 0.1), 0.035, 0.025, 8));
      b.add('white', tube(base.clone().addScaledVector(d, 0.1), base.clone().addScaledVector(d, len), 0.012, 0.006, 6));
    };
    vhf(V(-0.95, 5.8, -0.35), V(-0.35, 0.75, -0.55), 0.62);
    vhf(V(0.62, 5.78, 1.3), V(0.35, 0.7, 0.62), 0.6);
    // EVA antenna (erected on the surface: vertical mast with a small cup)
    const eva = V(-0.7, 6.1, 0.62);
    b.add('darkMetal', box(V(eva.x, eva.y + 0.04, eva.z), V(0.1, 0.08, 0.1)));
    b.add('metal', tube(V(eva.x, eva.y + 0.08, eva.z), V(eva.x, eva.y + 0.72, eva.z), 0.01, 0.008, 6));
    b.add('white', lathe([[0.0, 0.0], [0.03, 0.03], [0.02, 0.06], [0.0, 0.06]], 10).translate(eva.x, eva.y + 0.72, eva.z));
    // S-band inflight antennas: two small conical helices (forward left, aft right)
    for (const [p, dir] of [
      [V(-1.12, 5.62, -0.55), V(-0.6, 0.5, -0.6)],
      [V(0.9, 5.3, 1.4), V(0.5, 0.2, 0.8)],
    ]) {
      const m = alignY(p, dir.normalize());
      b.add('white', lathe([[0.06, 0], [0.06, 0.02], [0.035, 0.12], [0.0, 0.14]], 12).applyMatrix4(m));
      b.add('darkMetal', lathe([[0.07, -0.03], [0.07, 0.0], [0.0, 0.0]], 12).applyMatrix4(m));
    }
  }

  // --------------------------------------------------------------- lights
  // tracking light (xenon flasher) on the front above the windows, docking lights around
  b.add('darkMetal', box(V(0, 5.735, -1.02), V(0.14, 0.05, 0.12)));
  const trackGeo = lathe([[0.045, 0], [0.04, 0.03], [0.0, 0.05]], 12).translate(0, 5.76, -1.02);
  const trackingLight = new THREE.Mesh(trackGeo, M.lightWhite);
  trackingLight.name = 'LM tracking light';
  trackingLight.visible = false;
  const trackLens = lathe([[0.045, 0], [0.04, 0.03], [0.0, 0.05]], 12).translate(0, 5.758, -1.02);
  b.add('lensOff', trackLens);
  const dockLightGeo = (p, n) => lathe([[0.03, 0], [0.025, 0.02], [0.0, 0.028]], 10).applyMatrix4(alignY(p, n));
  const dockingLights = [
    new THREE.Mesh(dockLightGeo(V(-1.31, 5.05, -0.45), V(-1, 0, 0)), M.lightRed),
    new THREE.Mesh(dockLightGeo(V(1.31, 5.05, -0.45), V(1, 0, 0)), M.lightGreen),
    new THREE.Mesh(dockLightGeo(V(-1.0, 5.3, -0.975), V(-0.75, 0, -0.66)), M.lightAmber),
  ];
  dockingLights.forEach((l) => (l.name = 'LM docking light'));

  // --------------------------------------------------------------- underside: APS nozzle & heat shield
  {
    const e = LM.aps.nozzleExit; // y = 3.10
    const re = LM.aps.nozzleExitRadius;
    const yT = LM.aps.nozzleThroat.y;
    const prof = [];
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const r = 0.07 + (re - 0.07) * (1 - Math.pow(1 - s, 1.7));
      prof.push([r, yT - (yT - e.y) * s]);
    }
    // interior of the ablative nozzle (dark), seen from below after staging
    b.add('nozzleInner', lathe([[0.001, yT + 0.05], [0.07, yT + 0.02], ...prof], 24));
    b.add('darkMetal', lathe([[re + 0.06, e.y - 0.004], [re, e.y - 0.004], [re, e.y + 0.02]], 32));
    // black H-film heat shield disc around the exit
    b.add('blackFoil', lathe([[1.0, e.y - 0.002], [re + 0.06, e.y - 0.003]], 32));
  }

  // --------------------------------------------------------------- RCS quads (IVA-visible group)
  const jets = lmRcsJets();
  const quads = [1, 2, 3, 4].map((q) => jets.filter((j) => j.quad === q));
  for (const qj of quads) {
    const up = qj.find((j) => j.id.endsWith('U'));
    const c = up.pos.clone().addScaledVector(up.exhaustDir, -LM.rcs.nozzleOffset); // quad centre
    const sx = Math.sign(c.x);
    const sz = Math.sign(c.z);
    // cluster housing: foil-covered box, black cap and base
    bq.add('silver', box(c, V(0.2, 0.26, 0.2)));
    bq.add('blackQuilt', box(V(c.x, c.y + 0.1, c.z), V(0.215, 0.05, 0.215)));
    bq.add('blackQuilt', box(V(c.x, c.y - 0.1, c.z), V(0.215, 0.05, 0.215)));
    // thruster mounting bosses on the horizontal faces
    for (const j of qj) rcsThruster(bq, c, j.exhaustDir, LM.rcs.nozzleOffset);
    // support beam back to the structure (inboard, along the diagonal)
    const front = sz < 0;
    const anchor = front ? V(sx * 1.2, c.y, -0.8) : V(sx * 0.9, c.y, 1.15);
    const inner = c.clone().add(V(-sx * 0.1, 0, -sz * 0.1));
    const beam = hull([
      inner.clone().add(V(0, 0.08, 0)), inner.clone().add(V(0, -0.08, 0)),
      inner.clone().add(V(sx * 0.05, 0.08, -sz * 0.05)), inner.clone().add(V(sx * 0.05, -0.08, -sz * 0.05)),
      anchor.clone().add(V(0, 0.13, 0)), anchor.clone().add(V(0, -0.13, 0)),
      anchor.clone().add(V(sx * 0.12, 0.13, -sz * 0.12)), anchor.clone().add(V(sx * 0.12, -0.13, -sz * 0.12)),
    ]);
    bq.add('asBlack', beam);
    // lower diagonal brace
    const braceTo = front ? V(sx * 1.24, 4.25, -0.72) : V(sx * 0.88, 4.2, 1.1);
    bq.add('metal', tube(V(c.x - sx * 0.08, c.y - 0.12, c.z - sz * 0.08), braceTo, 0.022, 0.022, 8));
    // heater / thermal shroud strip + warning stripe placard
    const mk = M.markings.userData.rects;
    if (mk) {
      const r = mk.stripe;
      const n = V(sx, 0, 0);
      const x = c.x + sx * 0.101;
      const pts = sx > 0
        ? [V(x, c.y + 0.04, c.z + 0.07), V(x, c.y + 0.04, c.z - 0.07), V(x, c.y + 0.07, c.z - 0.07), V(x, c.y + 0.07, c.z + 0.07)]
        : [V(x, c.y + 0.04, c.z - 0.07), V(x, c.y + 0.04, c.z + 0.07), V(x, c.y + 0.07, c.z + 0.07), V(x, c.y + 0.07, c.z - 0.07)];
      const g = insetPolygonGeo(pts, n, 0);
      const uv = g.attributes.uv;
      const pp = g.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const u = (pp.getZ(i) - (c.z - 0.07)) / 0.14;
        const v = (pp.getY(i) - (c.y + 0.04)) / 0.03;
        uv.setXY(i, r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v);
      }
      bq.add('markings', g);
    }
  }

  // --------------------------------------------------------------- misc. hardware
  // ascent-stage/descent-stage interstage fittings (4) and umbilical box
  for (const [x, z] of [[-1.0, -0.9], [1.0, -0.9], [-0.95, 0.72], [0.95, 0.72]]) {
    b.add('darkMetal', box(V(x, 3.13, z), V(0.16, 0.08, 0.16)));
  }
  b.add('asBlack', box(V(0.62, 3.2, 0.62), V(0.28, 0.16, 0.2)));
  // external gaseous-oxygen / helium lines along the right side (tubing)
  b.add('metal', tube(V(1.3, 3.72, -0.55), V(1.3, 3.72, -0.18), 0.012, 0.012, 6));
  b.add('metal', tube(V(1.3, 3.72, -0.18), V(1.1, 3.85, 0.72), 0.012, 0.012, 6));
  // gold Kapton blanket patches on the lower cabin sides (where the cabin meets the tank fairings)
  for (const sx of [-1, 1]) {
    const x = sx * 1.305;
    const p0 = V(x, 3.72, sx > 0 ? -0.95 : -0.22);
    const p1 = V(x, 3.72, sx > 0 ? -0.22 : -0.95);
    const p2 = V(x, 4.55, sx > 0 ? -0.22 : -0.95);
    const p3 = V(x, 4.55, sx > 0 ? -0.95 : -0.22);
    b.add('gold', blanket(p0, p1, p2, p3, { bulge: 0.025, wrinkle: 0.01, seed: 40 + sx, nu: 8, nv: 8 }));
  }

  const meshes = b.build(M, group);
  const quadsGroup = new THREE.Group();
  quadsGroup.name = 'LM RCS quads';
  const quadMeshes = bq.build(M, quadsGroup);
  quadMeshes.forEach((m) => (m.userData.ivaVisible = true));
  group.add(quadsGroup);
  group.add(trackingLight);
  dockingLights.forEach((l) => group.add(l));
  trackingLight.castShadow = false;
  dockingLights.forEach((l) => (l.castShadow = false));
  return { group, meshes, quads: quadsGroup, trackingLight, dockingLights };
}
