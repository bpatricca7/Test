// LM crew compartment structure (LM-CABIN agent): the closed interior envelope with its window
// openings (a shadow caster: sunlight reaches the cabin only through the glass), window frames and
// panes, the overhead docking window well, the docking tunnel with the overhead hatch, the forward
// hatch, the aft midsection (raised floor, ascent engine cover, equipment racks), ring frames and
// stringers, and the console housings behind every panel.
import * as THREE from 'three';
import { LM } from '../../../core/constants.js';
import { CAB, SECTION, envelopePlanes, triNormal, panelLayout } from './layout.js';
import {
  V, Batch, convexPolyhedron, polygonGeometry, offsetPolygon, ribbon, circlePts, boxFromTo, cylBetween, lathe, tube,
  roundBox, boxUV, invert,
} from './geom.js';

/** Material key per envelope face tag. */
const FACE_MAT = {
  floor: 'floor',
  lowerSideL: 'liningDark',
  lowerSideR: 'liningDark',
  sideL: 'lining',
  sideR: 'lining',
  upperSideL: 'lining',
  upperSideR: 'lining',
  diagL: 'quilt',
  diagR: 'quilt',
  ceilingEdgeL: 'lining',
  ceilingEdgeR: 'lining',
  ceiling: 'lining',
  winL: 'lining',
  winR: 'lining',
  browL: 'lining',
  browR: 'lining',
  cheekL: 'lining',
  cheekR: 'lining',
  front: 'lining',
  aft: 'quilt',
};

/**
 * Build the cabin structure.
 * @param {(key: string) => THREE.Material} mat material lookup
 * @returns {{group: THREE.Group, glass: THREE.Mesh[], faces: object[], hatchDump: THREE.Object3D}}
 */
export function buildShell(mat) {
  const group = new THREE.Group();
  group.name = 'LMCabin:shell';
  const b = new Batch('shell');
  const W = LM.windows;
  const ow = W.overhead;

  // ------------------------------------------------------------------ envelope
  const faces = convexPolyhedron(envelopePlanes(), new THREE.Box3(V(-1.4, 3.3, -1.4), V(1.4, 5.95, 1.4)));
  const owRect = (y, grow = 0) => [
    V(ow.center.x - ow.width / 2 - grow, y, ow.center.z - ow.height / 2 - grow),
    V(ow.center.x + ow.width / 2 + grow, y, ow.center.z - ow.height / 2 - grow),
    V(ow.center.x + ow.width / 2 + grow, y, ow.center.z + ow.height / 2 + grow),
    V(ow.center.x - ow.width / 2 - grow, y, ow.center.z + ow.height / 2 + grow),
  ];
  const tun = CAB.tunnel;
  for (const f of faces) {
    const inward = f.n.clone().negate();
    const outer = f.verts.slice().reverse();
    const holes = [];
    if (f.tag === 'winL') holes.push(W.cdr.map((p) => p.clone()));
    if (f.tag === 'winR') holes.push(W.lmp.map((p) => p.clone()));
    if (f.tag === 'ceiling') {
      holes.push(owRect(CAB.ceilingY));
      holes.push(circlePts(V(tun.x, CAB.ceilingY, tun.z), V(1, 0, 0), V(0, 0, 1), tun.r, 48));
    }
    const key = FACE_MAT[f.tag] || 'lining';
    b.add(key, polygonGeometry(outer, holes, inward, 1));
  }

  // ------------------------------------------------------------------ windows: frames, bolts, panes
  const glass = [];
  for (const tri of [W.cdr, W.lmp]) {
    const n = triNormal(tri); // outward
    const inN = n.clone().negate();
    const depth = 0.022; // frame stands this far into the cabin
    const wid = 0.036;
    const inner0 = tri.map((p) => p.clone());
    const inner1 = tri.map((p) => p.clone().addScaledVector(inN, depth));
    const outer0 = offsetPolygon(tri, n, wid);
    const outer1 = outer0.map((p) => p.clone().addScaledVector(inN, depth));
    b.add('frame', polygonGeometry(outer1, [inner1], inN, 4));
    // inner reveal (the opening's wall) and outer edge of the frame
    b.add('frame', ribbon(inner1, inner0, true, 4));
    b.add('frame', ribbon(outer0, outer1, true, 4));
    // flat black anti-glare band painted on the facet around the frame
    const band0 = offsetPolygon(tri, n, wid + 0.035).map((p) => p.addScaledVector(inN, 0.0008));
    const band1 = offsetPolygon(tri, n, wid - 0.002).map((p) => p.addScaledVector(inN, 0.0008));
    b.add('black', polygonGeometry(band0, [band1], inN, 4));
    // second step: pane retainer ring just inside the opening (thin, recessed)
    const ret0 = tri.map((p) => p.clone().addScaledVector(inN, 0.004));
    const retIn = offsetPolygon(tri, n, -0.012).map((p) => p.addScaledVector(inN, 0.004));
    b.add('darkMetal', polygonGeometry(ret0, [retIn], inN, 4));
    // bolts around the frame
    const mid = offsetPolygon(tri, n, wid * 0.55).map((p) => p.addScaledVector(inN, depth));
    for (let i = 0; i < 3; i++) {
      const a = mid[i];
      const c = mid[(i + 1) % 3];
      const len = a.distanceTo(c);
      const nb = Math.max(2, Math.round(len / 0.07));
      for (let k = 0; k < nb; k++) {
        const p = a.clone().lerp(c, (k + 0.5) / nb);
        b.add('darkMetal', cylBetween(p, p.clone().addScaledVector(inN, 0.003), 0.0034, 0.0034, 6));
      }
    }
    // inner pane: reflective glass 6 mm inside the window plane (carries the LPD reticle)
    const pane = tri.map((p) => p.clone().addScaledVector(inN, 0.006));
    const pg = polygonGeometry(pane, [], inN, 8);
    const gm = new THREE.Mesh(pg, mat('glass'));
    gm.name = 'LMCabin:windowPane';
    gm.renderOrder = 20;
    gm.castShadow = false;
    gm.receiveShadow = true;
    glass.push(gm);
    group.add(gm);
  }

  // ------------------------------------------------------------------ overhead docking window
  {
    const lo = owRect(CAB.ceilingY);
    const hi = owRect(ow.center.y);
    // well walls (face into the well)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      b.add('frame', ribbon([hi[i], hi[j]], [lo[i], lo[j]], false, 4));
    }
    // frame ring on the ceiling, 12 mm proud
    const y1 = CAB.ceilingY - 0.012;
    const outer = owRect(y1, 0.035);
    const inner = owRect(y1, 0);
    b.add('frame', polygonGeometry(outer, [inner], V(0, -1, 0), 4));
    b.add('frame', ribbon(owRect(CAB.ceilingY, 0.035), outer, true, 4));
    b.add('frame', ribbon(inner, owRect(CAB.ceilingY, 0), true, 4));
    for (let i = 0; i < 4; i++) {
      const a = owRect(y1, 0.0175)[i];
      const c = owRect(y1, 0.0175)[(i + 1) % 4];
      const nb = Math.max(2, Math.round(a.distanceTo(c) / 0.06));
      for (let k = 0; k < nb; k++) {
        const p = a.clone().lerp(c, (k + 0.5) / nb);
        b.add('darkMetal', cylBetween(p, p.clone().add(V(0, -0.004, 0)), 0.004, 0.004, 6));
      }
    }
    const pane = owRect(ow.center.y - 0.004);
    const gm = new THREE.Mesh(polygonGeometry(pane, [], V(0, -1, 0), 8), mat('glass'));
    gm.name = 'LMCabin:overheadPane';
    gm.renderOrder = 20;
    gm.castShadow = false;
    glass.push(gm);
    group.add(gm);
  }

  // ------------------------------------------------------------------ docking tunnel & overhead hatch
  {
    const c0 = V(tun.x, CAB.ceilingY, tun.z);
    // tunnel wall (inside-facing open cylinder)
    const tw = new THREE.CylinderGeometry(tun.r, tun.r, tun.topY - CAB.ceilingY, 48, 1, true);
    invert(tw); // face inward
    tw.translate(c0.x, (tun.topY + CAB.ceilingY) / 2, c0.z);
    b.add('liningDark', boxUV(tw, 1));
    // flange at the ceiling (a thick ring)
    const fl = lathe([[tun.r, 0.0], [tun.r + 0.05, 0.0], [tun.r + 0.055, -0.012], [tun.r + 0.03, -0.022], [tun.r - 0.005, -0.022], [tun.r - 0.012, -0.01]], 48);
    fl.translate(c0.x, CAB.ceilingY, c0.z);
    b.add('structure', fl);
    // flange bolts
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const p = V(c0.x + Math.cos(a) * (tun.r + 0.03), CAB.ceilingY - 0.022, c0.z + Math.sin(a) * (tun.r + 0.03));
      b.add('darkMetal', cylBetween(p, p.clone().add(V(0, -0.005, 0)), 0.0045, 0.0045, 6));
    }
    // intermediate ring frame inside the tunnel
    const rf = lathe([[tun.r - 0.001, 0], [tun.r - 0.03, 0.005], [tun.r - 0.03, 0.03], [tun.r - 0.001, 0.035]], 48);
    rf.translate(c0.x, CAB.ceilingY + 0.2, c0.z);
    b.add('structure', rf);
    // overhead hatch (closed, seen from below): dished door with a rim, latch handle and dump valve
    const hy = tun.topY;
    const door = lathe([[0.001, -0.02], [tun.r * 0.55, -0.03], [tun.r - 0.02, -0.02], [tun.r - 0.005, 0.0]], 48);
    door.translate(c0.x, hy, c0.z);
    b.add('console', door);
    const rim = lathe([[tun.r - 0.001, -0.035], [tun.r - 0.025, -0.035], [tun.r - 0.025, 0.0]], 48);
    rim.translate(c0.x, hy, c0.z);
    b.add('rubber', rim);
    // radial stiffeners on the hatch
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const p0 = V(c0.x + Math.cos(a) * 0.08, hy - 0.03, c0.z + Math.sin(a) * 0.08);
      const p1 = V(c0.x + Math.cos(a) * (tun.r - 0.04), hy - 0.024, c0.z + Math.sin(a) * (tun.r - 0.04));
      b.add('structure', cylBetween(p0, p1, 0.008, 0.008, 6));
    }
    // handle: a U-bar across the hatch
    const hp = [V(-0.12, hy - 0.03, 0.06), V(-0.12, hy - 0.075, 0.06), V(0.12, hy - 0.075, 0.06), V(0.12, hy - 0.03, 0.06)].map((p) => p.add(V(c0.x, 0, c0.z)));
    b.add('metal', tube(hp, 0.009, { tension: 0.1, radial: 10 }));
    // dump valve (round body with a lever)
    const dv = V(c0.x - 0.1, hy - 0.03, c0.z - 0.13);
    b.add('darkMetal', cylBetween(dv, dv.clone().add(V(0, -0.03, 0)), 0.035, 0.03, 20));
    b.add('red', boxFromTo(dv.clone().add(V(-0.005, -0.045, -0.04)), dv.clone().add(V(0.005, -0.03, 0.04))));
  }

  // ------------------------------------------------------------------ forward hatch (32 in square)
  let hatchDump = null;
  {
    const h = LM.forwardHatch;
    const zf = CAB.frontZ;
    const c = h.center;
    // door slab (rounded square), 3 cm proud of the bulkhead
    const door = roundBox(h.width, h.height, 0.03, 0.07, 6);
    door.translate(c.x, c.y, zf + 0.015);
    b.add('console', door);
    // quilted inner pad (the hatch was covered with a padded thermal blanket)
    const pad = roundBox(h.width - 0.14, h.height - 0.16, 0.022, 0.05, 6);
    pad.translate(c.x, c.y - 0.01, zf + 0.04);
    b.add('quilt', pad);
    // perimeter seal & frame
    const fr = roundBox(h.width + 0.07, h.height + 0.07, 0.012, 0.09, 6);
    fr.translate(c.x, c.y, zf + 0.006);
    b.add('rubber', fr);
    // hinges on the right edge (door opens inward toward the LMP side)
    for (const dy of [-0.26, 0.26]) {
      b.add('darkMetal', cylBetween(V(c.x + h.width / 2 + 0.005, c.y + dy - 0.05, zf + 0.035), V(c.x + h.width / 2 + 0.005, c.y + dy + 0.05, zf + 0.035), 0.014, 0.014, 12));
      b.add('darkMetal', boxFromTo(V(c.x + h.width / 2 - 0.07, c.y + dy - 0.04, zf + 0.03), V(c.x + h.width / 2, c.y + dy + 0.04, zf + 0.042)));
    }
    // hatch handle: lever on the left edge with a lock
    const hb = V(c.x - h.width / 2 + 0.07, c.y + 0.02, zf + 0.035);
    b.add('darkMetal', cylBetween(hb, hb.clone().add(V(0, 0, 0.03)), 0.025, 0.025, 16));
    b.add('metal', tube([hb.clone().add(V(0, 0, 0.03)), hb.clone().add(V(0.01, -0.06, 0.05)), hb.clone().add(V(0.02, -0.16, 0.055))], 0.011, { tension: 0.2 }));
    b.add('rubber', cylBetween(hb.clone().add(V(0.02, -0.12, 0.055)), hb.clone().add(V(0.022, -0.19, 0.056)), 0.015, 0.015, 12));
    // latch bars along the left edge
    for (const dy of [-0.3, 0.3]) b.add('metal', boxFromTo(V(c.x - h.width / 2 + 0.01, c.y + dy - 0.012, zf + 0.03), V(c.x - h.width / 2 + 0.12, c.y + dy + 0.012, zf + 0.042)));
    // cabin relief & dump valve (upper centre): round body, handle, red guard ring
    const dv = V(c.x + 0.12, c.y + 0.24, zf + 0.05);
    b.add('darkMetal', cylBetween(dv.clone().add(V(0, 0, -0.02)), dv, 0.06, 0.055, 28));
    b.add('metal', cylBetween(dv, dv.clone().add(V(0, 0, 0.012)), 0.045, 0.04, 28));
    const lever = new THREE.Group();
    const lm = new THREE.Mesh(boxFromTo(V(-0.008, -0.01, 0), V(0.008, 0.075, 0.014)), mat('yellow'));
    lm.castShadow = lm.receiveShadow = true;
    lever.add(lm);
    lever.position.copy(dv).add(V(0, 0, 0.012));
    lever.rotation.z = -0.5;
    group.add(lever);
    hatchDump = lever;
  }

  // ------------------------------------------------------------------ aft midsection
  {
    // raised floor over the ascent engine (front riser at the cabin's rear plane)
    b.add('floor', boxUV(boxFromTo(V(-1.1, 3.38, CAB.rearZ), V(1.1, CAB.midFloorY, CAB.aftZ - 0.001)), 1));
    // step nosing
    b.add('metal', boxFromTo(V(-0.8, CAB.midFloorY - 0.008, CAB.rearZ - 0.006), V(0.8, CAB.midFloorY + 0.004, CAB.rearZ + 0.03)));
    // equipment racks either side (their inboard faces carry the ECS panel / stowage)
    for (const s of [-1, 1]) {
      const x0 = s * CAB.rackX;
      const x1 = s * 1.2;
      b.add('lining', boxUV(boxFromTo(V(Math.min(x0, x1), CAB.midFloorY, CAB.rearZ), V(Math.max(x0, x1), 5.45, CAB.aftZ)), 1));
      // rack top shelf lip
      b.add('structure', boxFromTo(V(Math.min(x0, x1), 5.45, CAB.rearZ), V(Math.max(x0, x1), 5.47, CAB.aftZ)));
    }
    // ascent engine cover ("doghouse"): quilted Beta-cloth covered frustum with a domed top
    const ec = CAB.engineCover;
    const h0 = CAB.midFloorY;
    const prof = [
      [ec.rBase + 0.02, h0],
      [ec.rBase, h0 + 0.02],
      [ec.rTop + 0.02, ec.topY - 0.06],
      [ec.rTop - 0.03, ec.topY - 0.01],
      [ec.rTop * 0.6, ec.topY + 0.01],
      [0.001, ec.topY + 0.02],
    ];
    const cover = lathe(prof, 40);
    cover.translate(0, 0, ec.z);
    // cylindrical-ish uv: u around (m), v up (m)
    {
      const p = cover.attributes.position;
      const uv = cover.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getZ(i) - ec.z, p.getX(i));
        uv.setXY(i, a * ec.rBase, p.getY(i) + Math.hypot(p.getX(i), p.getZ(i) - ec.z) * (p.getY(i) > ec.topY - 0.06 ? 1 : 0));
      }
    }
    b.add('quilt', cover);
    // two tie-down straps across the cover and a base band
    for (const a of [0.55, -0.55]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = -1 + (2 * i) / 16;
        const r = ec.rTop * Math.sqrt(Math.max(0, 1 - t * t * 0.55));
        const y = ec.topY + 0.025 - Math.abs(t) * (ec.topY - h0 - 0.06) * Math.abs(t);
        const rr = THREE.MathUtils.lerp(r, ec.rBase + 0.012, Math.abs(t) ** 2);
        pts.push(V(Math.cos(a) * t * rr * 1.02, y, ec.z + Math.sin(a) * t * rr * 1.02));
      }
      b.add('strap', tube(pts, 0.012, { radial: 6 }));
    }
    const band = new THREE.TorusGeometry(ec.rBase + 0.015, 0.012, 6, 48).rotateX(Math.PI / 2);
    band.translate(0, h0 + 0.05, ec.z);
    b.add('strap', band);
  }

  // ------------------------------------------------------------------ ring frames & stringers
  {
    // ceiling ring frames: channel beams (3 cm deep, 4.5 cm wide) lying FLUSH on the envelope across
    // the ceiling band and down the upper diagonals (section vertices from layout.SECTION)
    // right half of the section = SECTION.pts[0..6] (floor -> ceiling): take upperSide top .. ceiling edge
    const right = SECTION.pts.slice(4, 7).map(([x, y]) => new THREE.Vector2(x, y));
    const path = [...right.map((q) => new THREE.Vector2(-q.x, q.y)), ...right.slice().reverse()];
    const axis = new THREE.Vector2(0, CAB.axisY);
    // (the forward frame stands just ahead of circuit-breaker panels 11 / 16, which span z -0.875..-0.295)
    for (const z of [-0.935, 0.66, 1.0]) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const c = path[i + 1];
        if (z < 0 && Math.abs(a.x + c.x) < 1e-6) continue; // the AOT passes through the ceiling there
        const d = new THREE.Vector2().subVectors(c, a);
        const len = d.length();
        d.normalize();
        const mid = a.clone().add(c).multiplyScalar(0.5);
        let nIn = new THREE.Vector2(-d.y, d.x);
        if (nIn.dot(axis.clone().sub(mid)) < 0) nIn.negate();
        const beam = new THREE.BoxGeometry(len + 0.02, 0.03, 0.045);
        const m = new THREE.Matrix4().makeBasis(V(d.x, d.y, 0), V(nIn.x, nIn.y, 0), V(0, 0, 1));
        m.setPosition(mid.x + nIn.x * 0.0155, mid.y + nIn.y * 0.0155, z);
        beam.applyMatrix4(m);
        b.add('structure', boxUV(beam, 2));
      }
    }
    // longitudinal stringers along the ceiling band edges and either side of the tunnel
    for (const x of [-0.63, 0.63]) b.add('structure', boxUV(boxFromTo(V(x - 0.025, CAB.ceilingY - 0.035, -0.95), V(x + 0.025, CAB.ceilingY, CAB.aftZ)), 2));
    for (const x of [-0.5, 0.5]) b.add('structure', boxUV(boxFromTo(V(x - 0.02, CAB.ceilingY - 0.03, -0.55), V(x + 0.02, CAB.ceilingY, 0.9)), 2));
    // transverse beams bounding the tunnel opening
    for (const z of [-0.47, 0.47]) b.add('structure', boxUV(boxFromTo(V(-0.63, CAB.ceilingY - 0.04, z - 0.025), V(0.63, CAB.ceilingY, z + 0.025)), 2));
    // side-wall frame posts at the rear of the forward cabin (the "B-pillars" of the crew station)
    for (const s of [-1, 1]) {
      const pts = [V(s * 1.13, 4.2, -0.2), V(s * 1.15, 4.75, -0.2), V(s * 1.07, 5.15, -0.2), V(s * 0.9, 5.5, -0.2)];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const c = pts[i + 1];
        const d = new THREE.Vector3().subVectors(c, a);
        const beam = new THREE.BoxGeometry(0.035, d.length(), 0.06);
        beam.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize()));
        const m = a.clone().add(c).multiplyScalar(0.5);
        const inward = V(-s * 0.018, 0, 0);
        beam.translate(m.x + inward.x, m.y, m.z);
        b.add('structure', boxUV(beam, 2));
      }
    }
    // floor edge angles (the floor meets the lower walls)
    for (const s of [-1, 1]) b.add('structure', boxFromTo(V(s * 0.62 - 0.02, CAB.floorY, CAB.frontZ + 0.02), V(s * 0.62 + 0.02, CAB.floorY + 0.03, CAB.rearZ)));
  }

  // ------------------------------------------------------------------ console housings behind the panels
  // Each housing is the box behind a panel (open at the panel) CLIPPED BY THE CABIN ENVELOPE, so it
  // closes the gap between panel and wall without ever poking through a wall or into a window.
  {
    const L = panelLayout();
    const env = envelopePlanes().map((p) => ({ ...p, tag: 'env' }));
    for (const [id, p] of Object.entries(L)) {
      const D = id === 'p11' || id === 'p16' ? 0.08 : id === 'ecs' || id === 'ecsLow' ? 0.0 : 0.3;
      if (!D) continue;
      const m = p.frame.matrix;
      const R = new THREE.Matrix3().setFromMatrix4(m);
      const t = new THREE.Vector3().setFromMatrixPosition(m);
      const local = [
        [V(1, 0, 0), p.w / 2, 'side'],
        [V(-1, 0, 0), p.w / 2, 'side'],
        [V(0, 1, 0), p.h / 2, 'side'],
        [V(0, -1, 0), p.h / 2, 'side'],
        [V(0, 0, 1), -0.011, 'front'],
        [V(0, 0, -1), D, 'back'],
      ];
      const planes = local.map(([n, d, tag]) => {
        const nb = n.clone().applyMatrix3(R).normalize();
        return { n: nb, d: d + nb.dot(t), tag };
      });
      const hf = convexPolyhedron([...planes, ...env], new THREE.Box3(V(-1.4, 3.3, -1.4), V(1.4, 5.95, 1.4)));
      for (const f of hf) {
        if (f.tag === 'front' || f.tag === 'env') continue;
        // close-out sides read as riveted structure panels (the lining), the rest as panel grey
        b.add(f.tag === 'side' && D > 0.1 ? 'lining' : 'console', polygonGeometry(f.verts, [], f.n, 1));
        // dark inside (seen through the instrument cut-outs)
        b.add('black', polygonGeometry(f.verts.slice().reverse(), [], f.n.clone().negate(), 2));
      }
    }
  }

  const built = b.build((k) => mat(k));
  group.add(built);
  return { group, glass, faces, hatchDump };
}
