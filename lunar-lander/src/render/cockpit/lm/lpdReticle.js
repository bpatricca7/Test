// LPD reticle meshes on the CDR's window (LM-CABIN agent). Geometry from lpd.js (exact, from the
// design eye); this file only turns the marks into thin etched lines and numerals on the inner pane.
import * as THREE from 'three';
import { computeLPD } from './lpd.js';
import { drawText } from '../kit/index.js';

/** Thin quad (in the pane plane) along a..b with half-width hw; `perp` = in-plane perpendicular. */
function strip(a, b, perp, hw, pos) {
  const p0 = a.clone().addScaledVector(perp, -hw);
  const p1 = b.clone().addScaledVector(perp, -hw);
  const p2 = b.clone().addScaledVector(perp, hw);
  const p3 = a.clone().addScaledVector(perp, hw);
  for (const p of [p0, p1, p2, p0, p2, p3]) pos.push(p.x, p.y, p.z);
}

/**
 * Build the reticle.
 * @param {(key: string) => THREE.Material} mat
 * @param {object} [o] options forwarded to computeLPD
 * @returns {{group: THREE.Group, data: object}}
 */
export function buildLPDReticle(mat, o = {}) {
  const data = computeLPD(o);
  const group = new THREE.Group();
  group.name = 'LMCabin:LPD';
  const nIn = data.plane.n.clone().negate();
  // lift the marks 0.3 mm off the pane toward the cabin (the pane itself is drawn at the plane)
  const lift = nIn.clone().multiplyScalar(0.0003);
  const pos = [];
  for (const m of data.marks) {
    const perp = new THREE.Vector3().crossVectors(nIn, m.along).normalize();
    const hw = m.kind === 'major' ? 0.0007 : m.kind === 'mid' ? 0.00055 : 0.0004;
    strip(m.a.clone().add(lift), m.b.clone().add(lift), perp, hw, pos);
  }
  if (data.scale) {
    const [a, b] = data.scale;
    const along = b.clone().sub(a).normalize();
    const perp = new THREE.Vector3().crossVectors(nIn, along).normalize();
    strip(a.clone().add(lift), b.clone().add(lift), perp, 0.0005, pos);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const lines = new THREE.Mesh(g, mat('lpdMark'));
  lines.renderOrder = 21;
  lines.castShadow = false;
  lines.receiveShadow = false;
  group.add(lines);

  // numerals: one small canvas per label, set just to the right of each major mark
  for (const m of data.marks) {
    if (!m.label) continue;
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 96, 60);
    drawText(ctx, m.label, 48, 31, 50, { color: '#050505', condense: 0.92, tracking: 0.02, weight: 'bold' });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const lm = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 1 });
    const w = 0.016;
    const h = 0.01;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lm);
    // orient in the pane: x along the mark, y = in-plane "up", z = into the cabin
    const x = m.along.clone();
    const z = nIn.clone();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    if (y.y < 0) {
      x.negate();
      y.negate();
    }
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const right = m.along.x >= 0 ? m.along : m.along.clone().negate();
    plane.position.copy(m.b).addScaledVector(right, w * 0.62).add(lift);
    plane.renderOrder = 21;
    group.add(plane);
  }
  return { group, data };
}
