// Edgewise meter clusters for the Command Module panels (CSM-CABIN agent).
//
// The CM panels carry dozens of narrow vertical ("edgewise") meters grouped in one bezel: fuel-cell
// flows & temperatures, cryogenic pressures & quantities, SM RCS helium / quantity, ECS pressures &
// temperatures, DC/AC volts & amps. One cluster = one instrument case (kit/instruments createCase),
// its face painted with N scales, and small triangular pointers (one or two per scale: "1"/"2").
// Contract like the INSTRUMENTS agent's factories: { object, width, height, update(vessel, game, dt),
// mountHole, depth }.
import * as THREE from 'three';
import { createCase } from '../instruments/index.js';
import { setLayerRecursive, registerIntegral } from '../kit/index.js';
import { LAYERS } from '../../../core/constants.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let _ptrGeo = null;
/** Shared pointer geometry: small triangle, tip at the origin pointing toward -X. */
function pointerGeometry() {
  if (_ptrGeo) return _ptrGeo;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.0058, 0.0023);
  s.lineTo(0.0058, -0.0023);
  s.closePath();
  _ptrGeo = new THREE.ExtrudeGeometry(s, { depth: 0.0005, bevelEnabled: false });
  return _ptrGeo;
}
const _ptrMats = new Map();
function pointerMaterial(color) {
  let m = _ptrMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
    m.userData.keepEmissive = true;
    m.userData.integralScale = 0.3;
    m.emissive.set(color);
    registerIntegral(m);
    _ptrMats.set(color, m);
  }
  return m;
}

/**
 * Cluster of vertical edgewise meters in one case.
 * @param {object} o
 * @param {string} [o.title] title printed on the face (top)
 * @param {number} [o.width] case width (m); default 0.034 per meter + margins
 * @param {number} [o.height=0.1]
 * @param {Array<{label: string, units?: string, min: number, max: number, ticks?: number[], minor?: number,
 *   red?: number[], yellow?: number[], fmt?: (v:number)=>string,
 *   pointers: Array<{get: (v:object, game:object, sys:object)=>number, color?: number, tag?: string}>}>} o.meters
 * @param {() => object} [o.systems] returns the systems state passed to the getters
 */
export function createMeterCluster(o) {
  const n = o.meters.length;
  const pitch = o.pitch ?? 0.034;
  const W = o.width ?? n * pitch + 0.02;
  const H = o.height ?? 0.1;
  const fr = 0.005;
  const fw = W - 2 * fr;
  const fh = H - 2 * fr;
  const hasTitle = !!o.title;
  const top = fh / 2 - (hasTitle ? 0.0105 : 0.004) - 0.0075;
  const bot = -fh / 2 + 0.0085;
  const maps = [];
  const xs = [];
  const { group } = createCase({
    width: W,
    height: H,
    frame: fr,
    depth: 0.03,
    faceSpec: {
      draw(P) {
        if (hasTitle) P.text(o.title, 0, fh / 2 - 0.005, 0.0036);
        o.meters.forEach((m, i) => {
          const x = -fw / 2 + ((i + 0.5) * fw) / n;
          xs.push(x);
          const map = (val) => bot + ((clamp(val, m.min, m.max) - m.min) / (m.max - m.min)) * (top - bot);
          maps.push(map);
          const band = (r, col) => {
            if (!r) return;
            P.rect(x - 0.0013, (map(r[0]) + map(r[1])) / 2, 0.0026, Math.abs(map(r[1]) - map(r[0])), col, { glow: false });
          };
          // scale: centre line with ticks both sides (pointers ride on either side)
          P.rect(x, (top + bot) / 2, 0.0105, top - bot + 0.004, '#0c0c0d', { glow: false });
          band(m.red, '#c42016');
          band(m.yellow, '#d8a414');
          P.line(x, bot, x, top, 0.0005);
          const ticks = m.ticks || [m.min, (m.min + m.max) / 2, m.max];
          const minor = m.minor ?? 4;
          ticks.forEach((tv, k) => {
            const y = map(tv);
            P.line(x - 0.0028, y, x + 0.0028, y, 0.0006);
            if (m.labels !== false && (k === 0 || k === ticks.length - 1 || ticks.length <= 5 || k % 2 === 0)) {
              P.text(m.fmt ? m.fmt(tv) : String(tv), x - 0.0068, y, 0.0024, { align: 'right' });
            }
            if (k < ticks.length - 1) {
              for (let q = 1; q < minor; q++) {
                const yy = map(tv + ((ticks[k + 1] - tv) * q) / minor);
                P.line(x - 0.0016, yy, x + 0.0016, yy, 0.0004);
              }
            }
          });
          P.text(m.label, x, top + 0.0052, 0.0026, { lineHeight: 1.1 });
          if (m.units) P.text(m.units, x, bot - 0.0048, 0.0022);
        });
        if (o.draw) o.draw(P, { xs, top, bot, fw, fh });
      },
    },
  });
  // pointers
  const ptrs = [];
  o.meters.forEach((m, i) => {
    const two = m.pointers.length > 1;
    m.pointers.forEach((p, k) => {
      const mesh = new THREE.Mesh(pointerGeometry(), pointerMaterial(p.color ?? 0xe8e6dc));
      const side = two && k === 0 ? -1 : 1; // pointer 1 on the left pointing right, 2 on the right
      mesh.scale.x = side;
      mesh.position.set(xs[i] + side * 0.0012, 0, 0.0008);
      mesh.castShadow = false;
      mesh.userData.dynamic = true; // the only moving part: the rest of the case may be merged
      group.add(mesh);
      ptrs.push({ mesh, get: p.get, map: maps[i], val: NaN });
    });
  });
  setLayerRecursive(group, LAYERS.CABIN);
  group.userData.mergeStatic = true; // see csmCabin.js: only userData.dynamic meshes move
  let acc = 0;
  const sysFn = o.systems || (() => null);
  function update(v, game, dt) {
    acc += dt || 0;
    if (acc < 1 / 30) return;
    const e = acc;
    acc = 0;
    const sys = sysFn();
    for (const p of ptrs) {
      const target = p.get(v, game, sys);
      if (!Number.isFinite(target)) continue;
      p.val = Number.isFinite(p.val) ? p.val + (target - p.val) * Math.min(1, e * 5) : target;
      p.mesh.position.y = p.map(p.val);
    }
  }
  // mount information like the instruments (case depth behind the face)
  return { object: group, width: W, height: H, update, depth: 0.033, mountHole: { w: W - 0.006, h: H - 0.006 } };
}
