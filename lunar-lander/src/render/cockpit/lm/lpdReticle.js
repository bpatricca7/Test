// LPD reticle on the CDR's window (LM-CABIN agent). Geometry from lpd.js (exact, from the design
// eye); this file only turns the marks into thin etched lines and numerals on the inner pane.
//
// Lines and numerals are ONE mesh with ONE lit material ('lpdMark' + an alpha mask canvas): the
// numerals are quads that sample their glyph cell of the mask, the lines sample a solid cell. So both
// catch the same cabin light (they read dark against the sunlit surface and faintly grey against the
// black sky) — before, the numerals were unlit black decals that vanished against space.
import * as THREE from 'three';
import { computeLPD } from './lpd.js';
import { drawText } from '../kit/index.js';

const CELL_W = 96;
const CELL_H = 60;
const COLS = 4;

/** Quad p0..p3 (counter-clockwise seen from the cabin) with uv rectangle [u0,v0]..[u1,v1]. */
function quad(p0, p1, p2, p3, uv, n, out) {
  const [u0, v0, u1, v1] = uv;
  const P = [p0, p1, p2, p0, p2, p3];
  const T = [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
  for (let i = 0; i < 6; i++) {
    out.pos.push(P[i].x, P[i].y, P[i].z);
    out.nor.push(n.x, n.y, n.z);
    out.uv.push(T[i][0], T[i][1]);
  }
}

/** Thin quad (in the pane plane) along a..b with half-width hw; `perp` = in-plane perpendicular. */
function strip(a, b, perp, hw, n, uv, out) {
  const p0 = a.clone().addScaledVector(perp, -hw);
  const p1 = b.clone().addScaledVector(perp, -hw);
  const p2 = b.clone().addScaledVector(perp, hw);
  const p3 = a.clone().addScaledVector(perp, hw);
  quad(p0, p1, p2, p3, uv, n, out);
}

/**
 * Build the reticle.
 * @param {(key: string) => THREE.Material} mat
 * @param {object} [o] options forwarded to computeLPD
 * @returns {{group: THREE.Group, data: object, mesh: THREE.Mesh}}
 */
export function buildLPDReticle(mat, o = {}) {
  const data = computeLPD(o);
  const group = new THREE.Group();
  group.name = 'LMCabin:LPD';
  const nIn = data.plane.n.clone().negate();
  // lift the marks 0.3 mm off the pane toward the cabin (the pane itself is drawn at the plane)
  const lift = nIn.clone().multiplyScalar(0.0003);
  const labels = data.marks.filter((m) => m.label);

  // alpha mask: cell 0 solid (lines), then one cell per numeral (white glyph on black)
  const cells = labels.length + 1;
  const rows = Math.ceil(cells / COLS);
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const W = COLS * CELL_W;
  const H = rows * CELL_H;
  let alphaMap = null;
  if (cv) {
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.fillRect(4, 4, CELL_W - 8, CELL_H - 8);
    labels.forEach((m, i) => {
      const c = i + 1;
      const x = (c % COLS) * CELL_W;
      const y = Math.floor(c / COLS) * CELL_H;
      drawText(g, m.label, x + CELL_W / 2, y + CELL_H / 2 + 1, 50, { color: '#ffffff', condense: 0.92, tracking: 0.02, weight: 'bold' });
    });
    alphaMap = new THREE.CanvasTexture(cv);
    alphaMap.anisotropy = 4;
  }
  // uv rectangle of a cell (flipY canvas convention), inset half a texel
  const cellUV = (c, inset = 0.5) => {
    const x = (c % COLS) * CELL_W;
    const y = Math.floor(c / COLS) * CELL_H;
    return [(x + inset) / W, 1 - (y + CELL_H - inset) / H, (x + CELL_W - inset) / W, 1 - (y + inset) / H];
  };
  const solid = (() => {
    const [u0, v0, u1, v1] = cellUV(0, 12);
    return [u0, v0, u1, v1];
  })();

  const out = { pos: [], nor: [], uv: [] };
  for (const m of data.marks) {
    const perp = new THREE.Vector3().crossVectors(nIn, m.along).normalize();
    const hw = m.kind === 'major' ? 0.0007 : m.kind === 'mid' ? 0.00055 : 0.0004;
    strip(m.a.clone().add(lift), m.b.clone().add(lift), perp, hw, nIn, solid, out);
  }
  if (data.scale) {
    const [a, b] = data.scale;
    const along = b.clone().sub(a).normalize();
    const perp = new THREE.Vector3().crossVectors(nIn, along).normalize();
    strip(a.clone().add(lift), b.clone().add(lift), perp, 0.0005, nIn, solid, out);
  }
  // numerals just to the right of each major mark, upright in the pane
  const w = 0.016;
  const h = 0.01;
  labels.forEach((m, i) => {
    const x = m.along.clone();
    const z = nIn.clone();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    if (y.y < 0) {
      x.negate();
      y.negate();
    }
    const right = m.along.x >= 0 ? m.along : m.along.clone().negate();
    const c = m.b.clone().addScaledVector(right, w * 0.62).add(lift);
    const at = (sx, sy) => c.clone().addScaledVector(x, (sx * w) / 2).addScaledVector(y, (sy * h) / 2);
    quad(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1), cellUV(i + 1), nIn, out);
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  const material = mat('lpdMark');
  if (alphaMap) {
    material.alphaMap = alphaMap;
    material.needsUpdate = true;
  }
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'LPD reticle';
  mesh.renderOrder = 21;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return { group, data, mesh };
}
