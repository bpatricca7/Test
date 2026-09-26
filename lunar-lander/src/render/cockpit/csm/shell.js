// Command Module pressure vessel (CSM-CABIN agent): the closed, shadow-casting inner shell of the
// crew compartment with the five window openings.
//
//   - conical inner wall (r_in(z), ~0.12 m inside the mould line) with EXACT holes where the window
//     pockets meet it: every grid cell near a window is projected onto the window plane, the
//     aperture outline (convex) is subtracted from it there, and the remaining pieces are mapped
//     back onto the cone along the window normal — the same ruled lines the pocket walls follow,
//     so wall and pocket meet without light leaks;
//   - window pockets (long slanted tunnels for the forward-looking rendezvous windows, the wall
//     thickness for the side windows, through the hatch for the hatch window), inner & outer panes
//     (cover glass with smudges), dark frames;
//   - domed aft bulkhead, forward bulkhead, docking tunnel and the forward (tunnel) hatch;
//   - the side hatch (raised inner panel with its window pocket, gearbox, actuator handle,
//     counterbalance, latch rails, gasket);
//   - an invisible outer skin (mould line) that only casts shadows, so sunlight can only enter
//     through the glass even with shadow-map bias.
import * as THREE from 'three';
import { CSM } from '../../../core/constants.js';
import {
  CONE_K, WALL_OFFSET, AFT_Z, FWD_Z, AFT_DOME, TUNNEL, innerRadius, rayCone, coneNormal, windowFrames, apertureOutline,
  Frame,
} from './layout.js';
import { V, Batch, subtractConvex, polyArea, inConvex, stripBetween, cylBetween, beam, roundBox, tube, lathe, boxUV } from './geom.js';

const R_IN = CSM.cm.baseRadius - WALL_OFFSET; // inner cone r at z = 0 (r = R + K z)
const R_OUT = CSM.cm.baseRadius;
const HATCH_T = 0.065; // side hatch inner panel stands this far (radially) inside the wall
const R_HATCH = R_IN - HATCH_T;
const UV_WALL = 1.0; // metres per wall texture tile
const OUTLINE_N = 40;

/** Point on a cone r = R + K z at (theta from +Y toward +X, z). */
const conePoint = (R, th, z, out = V()) => {
  const r = R + CONE_K * z;
  return out.set(Math.sin(th) * r, Math.cos(th) * r, z);
};
/** Wall texture UVs from a cone point (arc length / z). */
function wallUV(p) {
  const th = Math.atan2(p.x, p.y);
  return [(th * 1.35) / UV_WALL, p.z / UV_WALL];
}

/**
 * Triangle soup builder with explicit normals and winding fixed to face `normalAt(p)`.
 */
class Soup {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
  }
  /** Add a triangle; flips it if its face normal disagrees with `want` (unit vector). */
  tri(a, b, c, na, nb, nc, ua, ub, uc, want) {
    const e1 = V().subVectors(b, a);
    const e2 = V().subVectors(c, a);
    const fn = V().crossVectors(e1, e2);
    if (fn.lengthSq() < 1e-16) return;
    if (fn.dot(want) < 0) {
      [b, c] = [c, b];
      [nb, nc] = [nc, nb];
      [ub, uc] = [uc, ub];
    }
    for (const [p, n, u] of [[a, na, ua], [b, nb, ub], [c, nc, uc]]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(u[0], u[1]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/**
 * Cone surface patch r = R + K z over a (theta, z) grid, facing the axis (inward), with holes.
 * @param {number} R cone radius at z = 0
 * @param {(i: number, j: number) => THREE.Vector3} gridPoint vertex for grid indices
 * @param {number} nu grid cells along theta
 * @param {number} nv grid cells along z
 * @param {Array} holes [{frame, outline (CCW [u,v]), center (Vector3), reach (m)}]
 * @param {boolean} inward facing toward the axis (true) or outward (false)
 */
function conePatch(R, gridPoint, nu, nv, holes, inward = true) {
  const soup = new Soup();
  const nrm = (p) => {
    const n = coneNormal(p, V());
    return inward ? n.negate() : n;
  };
  const toCone = (h, u, v) => {
    const f = h.frame;
    const start = f.point(u, v, 0.6);
    const t = rayCone(start, f.z.clone().negate(), R, CONE_K);
    return Number.isFinite(t) ? start.addScaledVector(f.z, -t) : null;
  };
  const G = [];
  for (let j = 0; j <= nv; j++) {
    G[j] = [];
    for (let i = 0; i <= nu; i++) G[j][i] = gridPoint(i, j);
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const c = [G[j][i], G[j][i + 1], G[j + 1][i + 1], G[j + 1][i]];
      const ctr = V().add(c[0]).add(c[1]).add(c[2]).add(c[3]).multiplyScalar(0.25);
      const want = nrm(ctr);
      const near = holes.filter((h) => ctr.distanceTo(h.center) < h.reach);
      if (!near.length) {
        const n = c.map(nrm);
        const u = c.map(wallUV);
        soup.tri(c[0], c[1], c[2], n[0], n[1], n[2], u[0], u[1], u[2], want);
        soup.tri(c[0], c[2], c[3], n[0], n[2], n[3], u[0], u[2], u[3], want);
        continue;
      }
      // subtract each nearby window aperture in its own plane, mapping pieces back onto the cone
      let pieces3 = [c];
      for (const hole of near) {
        const f = hole.frame;
        const next = [];
        for (const pc3 of pieces3) {
          let poly = pc3.map((p) => {
            const d = V().subVectors(p, f.origin);
            return [d.dot(f.x), d.dot(f.y)];
          });
          if (polyArea(poly) < 0) poly = poly.reverse();
          if (poly.every(([x, y]) => inConvex(hole.outline, x, y))) continue; // fully inside the window
          for (const pc of subtractConvex(poly, hole.outline)) {
            const pts = pc.map(([x, y]) => toCone(hole, x, y));
            if (pts.some((p) => !p)) continue;
            next.push(pts);
          }
        }
        pieces3 = next;
      }
      for (const pts of pieces3) {
        const n = pts.map(nrm);
        const u = pts.map(wallUV);
        for (let k = 1; k < pts.length - 1; k++) soup.tri(pts[0], pts[k], pts[k + 1], n[0], n[k], n[k + 1], u[0], u[k], u[k + 1], want);
      }
    }
  }
  return soup.geometry();
}

/** Window hole description for conePatch (outline in the window plane, CCW). */
function holeFor(frame, reach) {
  let outline = apertureOutline(frame, 0, OUTLINE_N);
  if (polyArea(outline) < 0) outline = outline.reverse();
  return { frame, outline, center: null, reach };
}

/** Points where the aperture outline's ruled lines (along -n) meet the cone of radius R. */
function rimOnCone(frame, R) {
  const out = [];
  for (const [u, v] of apertureOutline(frame, 0, OUTLINE_N)) {
    const start = frame.point(u, v, 0.6);
    const t = rayCone(start, frame.z.clone().negate(), R, CONE_K);
    out.push(start.addScaledVector(frame.z, -t));
  }
  return out;
}

/** Planar pane (rounded rect / disc) in a window frame at depth d (m inside the glass plane). */
function paneGeometry(frame, d, grow = 0) {
  const pts = apertureOutline(frame, grow, OUTLINE_N);
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(shape, 1);
  // uv over the aperture
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / frame.w + 0.5;
    uv[i * 2 + 1] = p.getY(i) / frame.h + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // face INTO the cabin (-n): flip x so the ShapeGeometry's +Z maps to -n
  const m = new THREE.Matrix4().makeBasis(frame.x.clone().negate(), frame.y, frame.z.clone().negate()).setPosition(frame.point(0, 0, -d));
  g.applyMatrix4(m);
  return g;
}

/**
 * Build the pressure vessel, windows, bulkheads, tunnel and the side hatch.
 * @param {(key: string) => THREE.Material} mat cabin material lookup
 * @returns {{group: THREE.Group, windows: object, hatch: object, glass: THREE.Mesh}}
 */
export function buildShell(mat) {
  const B = new Batch('CSMCabin:shell');
  const W = windowFrames();
  const windows = {};
  const hatchWin = W.hatch;

  // ---------------------------------------------------------------- side hatch region (theta, z)
  const HZ0 = -0.46; // aft edge
  const HZ1 = -1.32; // forward edge
  const HHW = 0.38; // half width (m, circumferential)
  const hatchTh = (R, z) => HHW / (R + CONE_K * z);

  // ---------------------------------------------------------------- windows: pockets, panes, frames
  const glassParts = [];
  for (const [id, f] of Object.entries(W)) {
    const inHatch = id === 'hatch';
    const rimWall = rimOnCone(f, R_IN); // where the pocket meets the inner wall
    const rimIn = inHatch ? rimOnCone(f, R_HATCH) : rimWall; // cabin end of the pocket
    const glass = apertureOutline(f, 0, OUTLINE_N).map(([u, v]) => f.point(u, v, 0));
    const center = rimIn.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / rimIn.length);
    // pocket walls: v along the pocket (0 cabin end -> 1 glass), facing the pocket axis
    const g = stripBetween(rimIn, glass, true, 0.1);
    orientToward(g, (p) => {
      // toward the pocket's axis line (origin + t n)
      const d = V().subVectors(p, f.origin);
      const along = d.dot(f.z);
      return d.addScaledVector(f.z, -along).negate();
    });
    B.add('pocket', g);
    // panes: outer (heat-shield pane) 1.5 cm inside the glass plane, inner (pressure pane) at the
    // shallowest part of the pocket
    const minDepth = Math.min(...rimIn.map((p) => -V().subVectors(p, f.origin).dot(f.z)));
    const dOuter = 0.015;
    const dInner = Math.max(dOuter + 0.02, minDepth - 0.012);
    glassParts.push(paneGeometry(f, dOuter, 0.004), paneGeometry(f, dInner, 0.004));
    if (dInner - dOuter > 0.06) glassParts.push(paneGeometry(f, (dInner + dOuter) / 2, 0.004)); // middle pane
    // thin dark retaining frames around each pane (seen edge-on through the glass)
    for (const d of [dOuter, dInner]) B.add('structDark', paneRing(f, d, 0.004, 0.012));
    // interior bezel around the cabin end of the pocket
    B.add('structDark', bezel(f, rimIn, center, inHatch ? V().subVectors(V(0, 0, center.z), center).normalize() : null));
    windows[id] = { id, frame: f, rimIn, rimWall, glass, center, depthInner: dInner, depthOuter: dOuter };
  }

  // ---------------------------------------------------------------- conical inner wall with holes
  const NU = 128;
  const NV = 36;
  const holes = Object.values(windows).map((w) => ({ ...holeFor(w.frame, 0.42), center: rimCentre(w.rimWall) }));
  B.add('wall', conePatch(R_IN, (i, j) => conePoint(R_IN, -Math.PI + (i / NU) * Math.PI * 2, AFT_Z + ((FWD_Z - AFT_Z) * j) / NV), NU, NV, holes, true));

  // ---------------------------------------------------------------- side hatch inner panel
  {
    const nu = 16;
    const nv = 18;
    const gp = (R) => (i, j) => {
      const z = HZ0 + ((HZ1 - HZ0) * j) / nv;
      const th = (-1 + (2 * i) / nu) * hatchTh(R, z);
      return conePoint(R, th, z);
    };
    const hole = { ...holeFor(hatchWin, 0.3), center: rimCentre(windows.hatch.rimIn) };
    B.add('hatch', conePatch(R_HATCH, gp(R_HATCH), nu, nv, [hole], true));
    // side walls of the raised panel (hatch edge) + a dark gasket line on the wall around it
    const ring = [];
    const ringW = [];
    const ringG = [];
    const edge = (R, s) => {
      const out = [];
      for (let i = 0; i <= nu; i++) out.push([i, 0]);
      for (let j = 1; j <= nv; j++) out.push([nu, j]);
      for (let i = nu - 1; i >= 0; i--) out.push([i, nv]);
      for (let j = nv - 1; j >= 1; j--) out.push([0, j]);
      return out.map(([i, j]) => {
        const z = HZ0 + ((HZ1 - HZ0) * j) / nv;
        const th = (-1 + (2 * i) / nu) * (HHW + s) / (R + CONE_K * z);
        return conePoint(R, th, z + (j === 0 ? s * 0.84 : j === nv ? -s * 0.84 : 0));
      });
    };
    ring.push(...edge(R_HATCH, 0));
    ringW.push(...edge(R_IN - 0.002, 0.004));
    ringG.push(...edge(R_IN - 0.0015, 0.022));
    const side = stripBetween(ring, ringW, true, 0.1);
    orientToward(side, (p) => {
      const hc = conePoint(R_HATCH, 0, (HZ0 + HZ1) / 2);
      return V().subVectors(p, hc).setZ(0).normalize().add(V(0, -0.2, 0));
    });
    B.add('structure', side);
    const gasket = stripBetween(ringW, ringG, true, 0.1);
    orientToward(gasket, (p) => coneNormal(p, V()).negate());
    B.add('black', gasket);
  }

  // ---------------------------------------------------------------- aft bulkhead (domed, faces -Z)
  {
    const soup = new Soup();
    const NR = 14;
    const Rb = innerRadius(AFT_Z);
    const pt = (i, k) => {
      const r = (Rb * k) / NR;
      const th = -Math.PI + (i / NU) * Math.PI * 2;
      const z = AFT_Z + AFT_DOME * (1 - (r / Rb) ** 2);
      return V(Math.sin(th) * r, Math.cos(th) * r, z);
    };
    const nrm = (p) => V(p.x * 2 * AFT_DOME / (Rb * Rb), p.y * 2 * AFT_DOME / (Rb * Rb), -1).normalize();
    const uv = (p) => [p.x / UV_WALL, p.y / UV_WALL];
    for (let k = 0; k < NR; k++) {
      for (let i = 0; i < NU; i++) {
        const a = pt(i, k);
        const b = pt(i + 1, k);
        const c = pt(i + 1, k + 1);
        const d = pt(i, k + 1);
        const want = V(0, 0, -1);
        soup.tri(a, b, c, nrm(a), nrm(b), nrm(c), uv(a), uv(b), uv(c), want);
        soup.tri(a, c, d, nrm(a), nrm(c), nrm(d), uv(a), uv(c), uv(d), want);
      }
    }
    B.add('wall', soup.geometry());
  }

  // ---------------------------------------------------------------- forward bulkhead, tunnel, forward hatch
  {
    const rTop = innerRadius(FWD_Z);
    // forward bulkhead: slightly concave annulus from the wall to the tunnel (faces +Z, the cabin)
    const prof = [];
    const NS = 8;
    for (let k = 0; k <= NS; k++) {
      const s = k / NS;
      const r = rTop + (TUNNEL.radius - rTop) * s;
      const z = FWD_Z + (TUNNEL.zBottom - FWD_Z) * s - 0.03 * Math.sin(Math.PI * s);
      prof.push([r, z]);
    }
    B.add('wall', revolveZ(prof, NU, (p) => [p.x / UV_WALL, p.y / UV_WALL], true));
    // tunnel wall (faces the axis) and a ring frame at its mouth
    const tprof = [];
    for (let k = 0; k <= 6; k++) tprof.push([TUNNEL.radius, TUNNEL.zBottom + ((TUNNEL.hatchZ - TUNNEL.zBottom) * k) / 6]);
    B.add('wall', revolveZ(tprof, 64, (p) => [Math.atan2(p.x, p.y) * 0.4, p.z], true));
    B.add('structure', revolveZ([[TUNNEL.radius + 0.05, TUNNEL.zBottom + 0.003], [TUNNEL.radius - 0.012, TUNNEL.zBottom + 0.003], [TUNNEL.radius - 0.012, TUNNEL.zBottom - 0.03]], 64, null, true));
  }

  // ---------------------------------------------------------------- outer skin: shadow-only occluder
  const skin = buildOuterSkin(W);

  const group = B.build((k) => mat(k === 'hatch' ? 'structure' : k));
  group.add(skin);
  const glassGeo = mergeList(glassParts);
  const glassMesh = new THREE.Mesh(glassGeo, mat('glass'));
  glassMesh.name = 'CSMCabin:windowGlass';
  glassMesh.castShadow = false;
  glassMesh.receiveShadow = false;
  glassMesh.renderOrder = 2;
  group.add(glassMesh);
  return { group, windows, glass: glassMesh, hatch: { z0: HZ0, z1: HZ1, halfWidth: HHW, radius: R_HATCH } };
}

/** Centre of a rim polygon. */
function rimCentre(pts) {
  return pts.reduce((a, p) => a.add(p), V()).multiplyScalar(1 / pts.length);
}

/**
 * Revolve an (r, z) profile around the Z axis (theta from +Y toward +X). `inward` = normals toward
 * the axis / cabin side of the profile: we fix the winding so faces point toward the cabin interior
 * (toward the axis for walls, toward +Z for the forward bulkhead).
 */
function revolveZ(prof, nTh, uvFn, towardCabin = true) {
  const soup = new Soup();
  const pt = (k, i) => {
    const th = -Math.PI + (i / nTh) * Math.PI * 2;
    return V(Math.sin(th) * prof[k][0], Math.cos(th) * prof[k][0], prof[k][1]);
  };
  const uvf = uvFn || ((p) => [Math.atan2(p.x, p.y), p.z]);
  for (let k = 0; k < prof.length - 1; k++) {
    // profile normal in (r, z): perpendicular to the segment, pointing toward smaller r / +z (cabin)
    const dr = prof[k + 1][0] - prof[k][0];
    const dz = prof[k + 1][1] - prof[k][1];
    let nr = dz;
    let nz = -dr;
    // cabin side: for walls (dz != 0) toward the axis (nr < 0); for bulkheads toward +z
    if (Math.abs(dz) > Math.abs(dr) ? nr > 0 : nz < 0) {
      nr = -nr;
      nz = -nz;
    }
    if (!towardCabin) {
      nr = -nr;
      nz = -nz;
    }
    const L = Math.hypot(nr, nz) || 1;
    nr /= L;
    nz /= L;
    for (let i = 0; i < nTh; i++) {
      const a = pt(k, i);
      const b = pt(k, i + 1);
      const c = pt(k + 1, i + 1);
      const d = pt(k + 1, i);
      const nf = (p) => {
        const rr = Math.hypot(p.x, p.y) || 1;
        return V((p.x / rr) * nr, (p.y / rr) * nr, nz);
      };
      const ctr = V().add(a).add(b).add(c).add(d).multiplyScalar(0.25);
      const want = nf(ctr);
      soup.tri(a, b, c, nf(a), nf(b), nf(c), uvf(a), uvf(b), uvf(c), want);
      soup.tri(a, c, d, nf(a), nf(c), nf(d), uvf(a), uvf(c), uvf(d), want);
    }
  }
  return soup.geometry();
}

/** Re-wind the triangles of a geometry so their faces point along `dirAt(centroid)`, smooth normals. */
function orientToward(g, dirAt) {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.attributes.position;
  const u = src.attributes.uv;
  const a = V();
  const b = V();
  const c = V();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    const n = V().crossVectors(V().subVectors(b, a), V().subVectors(c, a));
    const ctr = V().add(a).add(b).add(c).multiplyScalar(1 / 3);
    if (n.dot(dirAt(ctr)) < 0) {
      p.setXYZ(i + 1, c.x, c.y, c.z);
      p.setXYZ(i + 2, b.x, b.y, b.z);
      if (u) {
        const ux = u.getX(i + 1);
        const uy = u.getY(i + 1);
        u.setXY(i + 1, u.getX(i + 2), u.getY(i + 2));
        u.setXY(i + 2, ux, uy);
      }
    }
  }
  src.deleteAttribute('normal');
  src.computeVertexNormals();
  if (src !== g) {
    g.setIndex(null);
    for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]);
  }
  return g;
}

/** Dark retaining ring of a pane: flat annulus in the pane plane (width w), facing the cabin. */
function paneRing(f, d, grow, w) {
  const inner = apertureOutline(f, grow - 0.002, OUTLINE_N).map(([x, y]) => f.point(x, y, -d + 0.001));
  const outer = apertureOutline(f, grow + w, OUTLINE_N).map(([x, y]) => f.point(x, y, -d + 0.001));
  const g = stripBetween(inner, outer, true, 0.1);
  return orientToward(g, () => f.z.clone().negate());
}

/**
 * Interior window bezel: a raised dark frame around the cabin end of the pocket (lip into the
 * pocket, rounded top, flange onto the wall).
 */
function bezel(f, rim, center, forcedOut) {
  const rings = [[], [], [], []];
  for (let i = 0; i < rim.length; i++) {
    const p = rim[i];
    const w = coneNormal(p, V()).negate(); // into the cabin
    const e = V().subVectors(p, center);
    e.addScaledVector(w, -e.dot(w)).normalize(); // outward from the opening, in the wall plane
    if (forcedOut) void forcedOut;
    rings[0].push(p.clone().addScaledVector(f.z, 0.025)); // into the pocket
    rings[1].push(p.clone().addScaledVector(w, 0.014).addScaledVector(e, -0.004));
    rings[2].push(p.clone().addScaledVector(w, 0.016).addScaledVector(e, 0.026));
    rings[3].push(p.clone().addScaledVector(w, 0.002).addScaledVector(e, 0.04));
  }
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = stripBetween(rings[k], rings[k + 1], true, 0.1);
    orientToward(g, (q) => {
      // away from the wall surface into the cabin / toward the opening axis for the lip
      const n = coneNormal(q, V()).negate();
      if (k === 0) return V().subVectors(center, q).addScaledVector(f.z, 0).normalize().add(n.multiplyScalar(0.2));
      return n.add(V().subVectors(q, center).normalize().multiplyScalar(k === 2 ? 0.6 : -0.1));
    });
    parts.push(g);
  }
  return mergeList(parts);
}

/** Merge a list of geometries (position/normal/uv). */
function mergeList(list) {
  const b = new Batch('tmp');
  for (const g of list) b.add('x', g);
  const grp = b.build(() => null);
  return grp.children[0].geometry;
}

/**
 * Invisible mould-line skin (cone + aft cap + forward cap), window apertures cut exactly: casts
 * sunlight shadows only.
 */
function buildOuterSkin(W) {
  const holes = Object.values(W).map((f) => ({ ...holeFor(f, 0.45), center: rimCentre(rimOnCone(f, R_OUT)) }));
  const NU = 96;
  const NV = 24;
  const z0 = 0.02;
  const z1 = -1.95;
  const parts = [conePatch(R_OUT, (i, j) => conePoint(R_OUT, -Math.PI + (i / NU) * Math.PI * 2, z0 + ((z1 - z0) * j) / NV), NU, NV, holes, false)];
  parts.push(new THREE.CircleGeometry(R_OUT + CONE_K * z0 + 0.01, NU).translate(0, 0, z0));
  parts.push(new THREE.CircleGeometry(R_OUT + CONE_K * z1 + 0.01, 48).translate(0, 0, z1));
  const g = mergeList(parts);
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  m.userData.shadowOnly = true;
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'CSMCabin:shadowSkin';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.userData.shadowOnly = true;
  return mesh;
}

export { conePoint, R_IN, R_HATCH, HATCH_T, revolveZ, orientToward, Soup, mergeList, paneGeometry };
// silence unused imports kept for future detailing
void cylBetween;
void beam;
void roundBox;
void tube;
void lathe;
void boxUV;
void Frame;
