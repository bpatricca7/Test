// Apollo circuit breakers: black push-pull buttons in a thin bezel collar; a tripped / pulled
// breaker stands ~4 mm proud and shows its white band. Instanced (hundreds per panel).
import * as THREE from 'three';
import { getMaterial } from './materials.js';
import { rng } from './canvas.js';

/** Travel of a popped (open) breaker button, m. */
export const CB_POP = 0.0042;

let _geo = null;
function geo() {
  if (_geo) return _geo;
  const toZ = (g) => g.rotateX(Math.PI / 2);
  // bezel collar: low flanged ring
  const collar = toZ(
    new THREE.LatheGeometry(
      [[0.0028, 0], [0.0059, 0], [0.0059, 0.0006], [0.0052, 0.0014], [0.0046, 0.0016], [0.0046, 0.0008], [0.0028, 0.0008]].map(([r, h]) => new THREE.Vector2(r, h)),
      24,
    ),
  );
  // button cap: cylinder with a softly rounded top edge and a shallow dished face
  const capPts = [
    [0.0001, 0.0068], [0.0022, 0.00672], [0.0033, 0.0069], [0.0039, 0.0066], [0.00415, 0.0060], [0.0042, 0.0050],
    [0.0042, 0.0012], [0.00405, 0.0008], [0.0001, 0.0008],
  ].reverse().map(([r, h]) => new THREE.Vector2(r, h));
  const cap = toZ(new THREE.LatheGeometry(capPts, 20));
  // white band (visible only when popped): sits under the cap
  const band = toZ(new THREE.CylinderGeometry(0.0041, 0.0041, CB_POP + 0.0006, 20)).translate(0, 0, 0.0008 + (CB_POP + 0.0006) / 2 - 0.0004);
  _geo = { collar, cap, band };
  return _geo;
}

/**
 * Bank of circuit breakers (hardware only; labels are printed by printBreakerLegends/createPanel).
 * @param {object} opts { breakers: [{ id, x, y, popped=false }] }
 * @returns {{object: THREE.Group, breakers: Array<{id, x, y, popped, setPopped(b)}>, byId: Map,
 *   setPopped(idOrIndex, b): void}}
 */
export function createBreakerBank(opts = {}) {
  const list = opts.breakers || [];
  const n = Math.max(1, list.length);
  const G = geo();
  const group = new THREE.Group();
  group.name = 'BreakerBank';
  const collar = new THREE.InstancedMesh(G.collar, getMaterial('darkMetal'), n);
  const cap = new THREE.InstancedMesh(G.cap, getMaterial('blackKnob'), n);
  const band = new THREE.InstancedMesh(G.band, getMaterial('white'), n);
  for (const m of [collar, cap, band]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const V = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1);
  const ZERO = new THREE.Vector3(1e-5, 1e-5, 1e-5);
  const handles = [];
  const byId = new Map();
  list.forEach((b, i) => {
    M.compose(V.set(b.x, b.y, 0), Q, ONE);
    collar.setMatrixAt(i, M);
    const h = {
      id: b.id ?? `CB${i}`,
      x: b.x,
      y: b.y,
      popped: !!b.popped,
      setPopped(p) {
        h.popped = !!p;
        M.compose(V.set(b.x, b.y, h.popped ? CB_POP : 0), Q, ONE);
        cap.setMatrixAt(i, M);
        M.compose(V.set(b.x, b.y, 0), Q, h.popped ? ONE : ZERO);
        band.setMatrixAt(i, M);
        cap.instanceMatrix.needsUpdate = true;
        band.instanceMatrix.needsUpdate = true;
      },
    };
    h.setPopped(h.popped);
    handles.push(h);
    byId.set(h.id, h);
  });
  if (!list.length) for (const m of [collar, cap, band]) m.count = 0;
  collar.instanceMatrix.needsUpdate = true;
  const get = (k) => (typeof k === 'number' ? handles[k] : byId.get(k));
  return { object: group, breakers: handles, byId, setPopped: (k, p) => get(k)?.setPopped(p) };
}

/**
 * Lay out a grid of circuit breakers on a painter and return the breaker specs.
 * Row headers are printed on white strips at the left (dark lettering), group titles on white
 * strips spanning their columns above the breakers, each breaker gets a 1–2 line legend above it
 * and its amp rating below it (as on the LM panels 11 & 16 and the CM panels 8/11/225/226/229).
 * @param {object} P painter
 * @param {object} o see createCircuitBreakerPanel
 * @returns {Array<{id, x, y, popped, row, col}>}
 */
export function layoutBreakers(P, o) {
  const rows = o.rows;
  const cols = o.cols;
  const px = o.pitchX;
  const py = o.pitchY;
  const x0 = o.x0;
  const y0 = o.y0;
  const r = rng(o.seed || 7);
  const labelSize = o.labelSize ?? 0.0029;
  const out = [];
  const label = typeof o.labels === 'function' ? o.labels : (ri, ci) => o.labels?.[ri]?.[ci] ?? '';
  const amps = typeof o.amps === 'function' ? o.amps : Array.isArray(o.amps) ? (ri, ci) => o.amps[ri]?.[ci] : () => o.amps;
  const poppedSet = new Set((Array.isArray(o.popped) ? o.popped : []).map(([a, b]) => `${a},${b}`));
  const gaps = new Set((o.gaps || []).map(([a, b]) => `${a},${b}`));
  const pProb = typeof o.popped === 'number' ? o.popped : 0;
  for (let ri = 0; ri < rows; ri++) {
    const y = y0 - ri * py;
    // row header strip
    const rl = o.rowLabels?.[ri];
    if (rl) {
      const sw = o.rowLabelWidth ?? 0.034;
      const sx = x0 - px * 0.5 - 0.004 - sw / 2;
      const sh = Math.min(py * 0.42, labelSize * 3.4);
      P.rect(sx, y - 0.0005, sw, sh, '#e9e8e2', { radius: 0.0006 });
      P.text(rl, sx, y - 0.0005, labelSize * 1.02, { color: '#1c1d1f', glow: false, lineHeight: 1.1 });
    }
    for (let ci = 0; ci < cols; ci++) {
      if (gaps.has(`${ri},${ci}`)) continue;
      const x = x0 + ci * px;
      const text = label(ri, ci);
      if (text) P.text(text, x, y + 0.0083 + (String(text).includes('\n') ? labelSize * 0.6 : 0), labelSize, { lineHeight: 1.12 });
      const a = amps(ri, ci);
      if (a != null && a !== '') P.text(String(a), x, y - 0.0079, labelSize * 0.9);
      P.groove(x, y, 0.0062, 0.0004);
      const popped = poppedSet.has(`${ri},${ci}`) || (pProb > 0 && r() < pProb);
      out.push({ id: o.ids?.[ri]?.[ci] ?? `CB${ri}-${ci}`, x, y, popped, row: ri, col: ci });
    }
  }
  // column labels (e.g. bus names) above the first row
  if (o.colLabels) {
    o.colLabels.forEach((t, ci) => t && P.text(t, x0 + ci * px, y0 + py * 0.5 + 0.004, labelSize));
  }
  // group strips: white bar with dark lettering spanning columns, above the row's legends
  for (const gp of o.groups || []) {
    const xa = x0 + gp.from * px - px * 0.46;
    const xb = x0 + gp.to * px + px * 0.46;
    const y = y0 - gp.row * py + 0.0083 + labelSize * 2.5;
    const h = labelSize * 1.5;
    P.rect((xa + xb) / 2, y, xb - xa, h, '#e9e8e2', { radius: 0.0005 });
    P.text(gp.title, (xa + xb) / 2, y, labelSize * 1.15, { color: '#1c1d1f', glow: false });
  }
  return out;
}
