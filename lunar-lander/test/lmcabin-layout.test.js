// LM-CABIN: geometric invariants of the crew-compartment layout (pure three.js maths, no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LM } from '../src/core/constants.js';
import { panelLayout, envelopePlanes, SECTION, CAB, CONTROLLERS, triNormal } from '../src/render/cockpit/lm/layout.js';
import { convexPolyhedron } from '../src/render/cockpit/lm/geom.js';

const corners = (p) =>
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
    p.frame.center.clone().addScaledVector(p.frame.right, (sx * p.w) / 2).addScaledVector(p.frame.up, (sy * p.h) / 2));

/** Largest signed distance of a point outside the envelope (<= 0 = inside). */
const outside = (pt, planes) => Math.max(...planes.map((pl) => pl.n.dot(pt) - pl.d));

test('envelope matches the constants: 2.34-m cabin width, floor, front bulkhead, inside the ascent stage', () => {
  const xs = SECTION.pts.map((p) => Math.abs(p[0]));
  const ys = SECTION.pts.map((p) => p[1]);
  // the widest point of the interior is the pressure-cylinder wall at (about) the axis height
  const widest = SECTION.pts.reduce((a, p) => (Math.abs(p[0]) > Math.abs(a[0]) ? p : a));
  assert.ok(Math.max(...xs) <= LM.ascentStage.cabinRadius + 1e-9);
  assert.ok(Math.abs(widest[1] - LM.ascentStage.cabinAxisY) < 0.3, `widest at y ${widest[1]}`);
  assert.equal(Math.min(...ys), LM.floorY);
  assert.ok(Math.max(...ys) < LM.ascentStage.yTop && Math.min(...ys) > LM.ascentStage.yBottom);
  const front = envelopePlanes().find((p) => p.tag === 'front');
  assert.ok(Math.abs(front.d - -LM.ascentStage.cabinFrontZ) < 1e-12);
  // the forward hatch opening lies on the front bulkhead, inside the envelope
  const h = LM.forwardHatch;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const c = new THREE.Vector3(h.center.x + (sx * h.width) / 2, h.center.y + (sy * h.height) / 2, LM.ascentStage.cabinFrontZ);
    // (the 32-in hatch sill is flush with the floor: allow 1 cm)
    assert.ok(outside(c, envelopePlanes()) <= 0.01, 'hatch corner outside the cabin');
  }
});

test('the envelope has the two window facets exactly in the planes of the constant window triangles', () => {
  const planes = envelopePlanes();
  for (const [tag, tri] of [['winL', LM.windows.cdr], ['winR', LM.windows.lmp]]) {
    const pl = planes.find((p) => p.tag === tag);
    for (const v of tri) assert.ok(Math.abs(pl.n.dot(v) - pl.d) < 1e-9, `${tag} vertex off its facet`);
    assert.ok(pl.n.distanceTo(triNormal(tri)) < 1e-9);
  }
  // and every window vertex lies on the closed hull (no other plane cuts the glass away)
  const faces = convexPolyhedron(planes, new THREE.Box3(new THREE.Vector3(-1.4, 3.3, -1.4), new THREE.Vector3(1.4, 5.95, 1.4)));
  for (const tag of ['winL', 'winR']) assert.ok(faces.some((f) => f.tag === tag), `facet ${tag} missing`);
  for (const v of [...LM.windows.cdr, ...LM.windows.lmp]) assert.ok(outside(v, planes) < 1e-6);
});

test('every panel lies inside the cabin envelope', () => {
  const planes = envelopePlanes();
  for (const [id, p] of Object.entries(panelLayout())) {
    for (const c of corners(p)) assert.ok(outside(c, planes) <= 1e-3, `panel ${id} pokes out by ${outside(c, planes).toFixed(4)} m`);
  }
});

test('panel faces point toward the crew (into the cabin, toward the eye points)', () => {
  const eyes = [LM.eyeCDR, LM.eyeLMP];
  for (const [id, p] of Object.entries(panelLayout())) {
    const f = p.frame;
    const toEye = Math.max(...eyes.map((e) => e.clone().sub(f.center).normalize().dot(f.normal)));
    assert.ok(toEye > 0.05, `panel ${id} faces away from both crew stations (${toEye.toFixed(2)})`);
  }
});

test("no panel blocks the CDR's line of sight to the lower part of his window (LPD view)", () => {
  const eye = LM.eyeCDR;
  const tri = LM.windows.cdr;
  // sample the window area on a barycentric grid (kept 1.5 cm inside the frame)
  const c = tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3);
  const targets = [];
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10 - i; j++) {
      const a = i / 10;
      const b = j / 10;
      const p = tri[0].clone().multiplyScalar(1 - a - b).addScaledVector(tri[1], a).addScaledVector(tri[2], b);
      targets.push(p.lerp(c, 0.12));
    }
  }
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  for (const [id, p] of Object.entries(panelLayout())) {
    const [a, b, cc, d] = corners(p);
    for (const t of targets) {
      ray.origin.copy(eye);
      ray.direction.subVectors(t, eye).normalize();
      const dist = eye.distanceTo(t);
      for (const [u, v, w] of [[a, b, cc], [a, cc, d]]) {
        if (ray.intersectTriangle(u, v, w, false, hit) && eye.distanceTo(hit) < dist - 1e-4) {
          assert.fail(`panel ${id} blocks the CDR's view of the window at (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`);
        }
      }
    }
  }
});

test('the FDAI balls (the visible front of the 0.16-m deep instruments) sit inside the cabin behind panels 1B / 2B', () => {
  // The rear corners of the FDAI cases pass through the sloped window facet below each window (the
  // real panels 1/2 back onto the window wells too); what the crew can see — the face and the front
  // half of the ball (radius 0.0736 m, centre ~0.08 m behind the face) — must be inside.
  const planes = envelopePlanes();
  const L = panelLayout();
  for (const [id, x] of [['p1B', -0.075], ['p2B', 0.075]]) {
    const f = L[id].frame;
    const ball = f.center.clone().addScaledVector(f.right, x).addScaledVector(f.normal, -0.08);
    assert.ok(outside(ball, planes) < -0.05, `${id}: FDAI ball centre too close to the wall`);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const faceCorner = f.center.clone().addScaledVector(f.right, x + sx * 0.095).addScaledVector(f.up, sy * 0.095).addScaledVector(f.normal, -0.02);
      assert.ok(outside(faceCorner, planes) < 0, `${id}: FDAI bezel outside the cabin`);
    }
  }
});

test('hand controllers sit inside the cabin, in front of the crew, below the panels', () => {
  const planes = envelopePlanes();
  for (const [id, p] of Object.entries(CONTROLLERS)) {
    assert.ok(outside(p, planes) < -0.1, `${id} too close to / outside the walls`);
    assert.ok(p.y > CAB.floorY + 0.5 && p.y < LM.eyeCDR.y - 0.8, `${id} height ${p.y}`);
    assert.ok(p.z < CAB.rearZ && p.z > CAB.frontZ, `${id} z ${p.z}`);
  }
});
