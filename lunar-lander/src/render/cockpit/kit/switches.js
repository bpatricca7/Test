// Apollo toggle switches: lever-lock toggles with satin-chrome bat-handle levers, hex panel nut,
// keyed lock washer and threaded bushing; optional grey/red guard posts or hinged red covers.
// Built with InstancedMesh (one draw call per part per bank) so a panel can carry hundreds.
//
// Local frame: panel face = XY plane at z = 0, hardware extends toward +Z. Metres.
import * as THREE from 'three';
import { getMaterial, COLORS, useInstancedShadowDepth } from './materials.js';

const DEG = Math.PI / 180;
/** Lever throw from centre, per position (Apollo toggles throw ~±20°). */
export const TOGGLE_THROW = 21 * DEG;
/** Pivot height of the lever above the panel face. */
const PIVOT_Z = 0.0064;

let _geo = null;
/** Shared toggle-switch part geometries (created once). */
function geo() {
  if (_geo) return _geo;
  const toZ = (gm) => gm.rotateX(Math.PI / 2); // cylinder/lathe axis Y -> Z
  // hex panel nut (across flats ~9.5 mm)
  const nut = toZ(new THREE.CylinderGeometry(0.0053, 0.0053, 0.0024, 6)).translate(0, 0, 0.0012 + 0.0006);
  nut.rotateZ(Math.PI / 6);
  // keyed lock washer (thin disc with a tab)
  const washer = toZ(new THREE.CylinderGeometry(0.0064, 0.0064, 0.0006, 24)).translate(0, 0, 0.0003);
  // threaded bushing: stacked slightly different radii fake thread shading
  const bushingPts = [];
  const b0 = 0.0024;
  const b1 = 0.0074;
  bushingPts.push(new THREE.Vector2(0.0001, b0));
  const nThread = 6;
  for (let i = 0; i <= nThread; i++) {
    const z = b0 + ((b1 - b0 - 0.0006) * i) / nThread;
    bushingPts.push(new THREE.Vector2(0.00305, z));
    if (i < nThread) bushingPts.push(new THREE.Vector2(0.00285, z + ((b1 - b0 - 0.0006) / nThread) * 0.5));
  }
  bushingPts.push(new THREE.Vector2(0.0029, b1 - 0.0002));
  bushingPts.push(new THREE.Vector2(0.0024, b1));
  bushingPts.push(new THREE.Vector2(0.0001, b1));
  const bushing = toZ(new THREE.LatheGeometry(bushingPts, 16));
  // lever (lathe about its own axis; origin at the pivot). Lever-lock collar near the base.
  const L = [
    [0.0001, -0.0012], [0.0011, -0.0012], [0.0011, 0.0022], [0.0017, 0.0026], [0.00172, 0.0043], [0.00118, 0.0048],
    [0.00118, 0.0072], [0.00135, 0.0102], [0.0017, 0.0132], [0.00205, 0.0158], [0.00218, 0.0172], [0.00212, 0.0182],
    [0.00185, 0.0191], [0.0013, 0.0198], [0.0006, 0.02015], [0.0001, 0.0202],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const lever = toZ(new THREE.LatheGeometry(L, 14));
  lever.scale(1.12, 0.86, 1); // flattened "bat" — wider across the throw plane
  // guard post: flat plate with a rounded top, standing beside the lever in the throw plane
  const gs = new THREE.Shape();
  const gh = 0.0195; // height above panel
  const gl = 0.0058; // half length along Y (narrow posts either side of the lever)
  gs.moveTo(-gl, 0);
  gs.lineTo(gl, 0);
  gs.lineTo(gl, gh - 0.004);
  gs.quadraticCurveTo(gl, gh, gl - 0.004, gh);
  gs.lineTo(-gl + 0.004, gh);
  gs.quadraticCurveTo(-gl, gh, -gl, gh - 0.004);
  gs.closePath();
  const gGeo = new THREE.ExtrudeGeometry(gs, { depth: 0.0016, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0003, bevelSegments: 1, curveSegments: 4 });
  gGeo.translate(0, 0, -0.0008);
  // map (sx, sy, sz) -> (sz, sx, sy): thickness along X, length along Y, height along Z
  gGeo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  gGeo.computeVertexNormals();
  // hinged cover: open-backed box (front, sides, top, bottom lip) hinged at the top edge
  const cw = 0.0165;
  const ch = 0.031;
  const cd = 0.028; // deep enough to close over a lever in either position
  const t = 0.0012;
  const parts = [
    new THREE.BoxGeometry(cw, ch, t).translate(0, 0, cd - t / 2), // front
    new THREE.BoxGeometry(t, ch, cd).translate(-cw / 2 + t / 2, 0, cd / 2), // left
    new THREE.BoxGeometry(t, ch, cd).translate(cw / 2 - t / 2, 0, cd / 2), // right
    new THREE.BoxGeometry(cw, t, cd).translate(0, ch / 2 - t / 2, cd / 2), // top
    new THREE.BoxGeometry(cw, t, cd * 0.35).translate(0, -ch / 2 + t / 2, cd - cd * 0.175), // bottom lip
  ];
  const cover = mergeSimple(parts);
  cover.translate(0, -ch / 2, 0); // hinge line at y = 0 (top edge), cover hangs downward
  // cover hinge block (fixed)
  const hinge = new THREE.BoxGeometry(cw + 0.003, 0.004, 0.005).translate(0, 0, 0.0025);
  _geo = { nut, washer, bushing, lever, guard: gGeo, cover, hinge, coverSize: { w: cw, h: ch, d: cd } };
  return _geo;
}

/** Minimal merge of non-indexed/indexed geometries with position+normal+uv (no deps). */
export function mergeSimple(list) {
  const out = new THREE.BufferGeometry();
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  let base = 0;
  for (const g0 of list) {
    const gm = g0.index ? g0 : g0;
    const p = gm.attributes.position;
    const n = gm.attributes.normal;
    const u = gm.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    if (gm.index) for (let i = 0; i < gm.index.count; i++) idx.push(gm.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
    g0.dispose();
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** Normalise a switch state to an index into positions (0 = up/left). */
function stateIndex(s, n) {
  if (typeof s === 'number') return Math.max(0, Math.min(n - 1, Math.round(s)));
  if (s === 'up' || s === 'left' || s === true || s === 'on') return 0;
  if (s === 'down' || s === 'right' || s === false || s === 'off') return n - 1;
  if (s === 'center' || s === 'centre' || s === 'mid') return n === 3 ? 1 : 0;
  return 0;
}

/**
 * Print the Apollo legends of one toggle onto a panel painter: function name above, position
 * legends at the ends of the throw (centre legend beside the nut for 3-position switches).
 * @param {object} P painter (see canvas.createPainter)
 * @param {object} s switch spec (see createSwitchBank)
 */
export function printToggleLegends(P, s) {
  const size = s.labelSize ?? 0.0034;
  const posSize = s.positionSize ?? size * 0.9;
  const pos = s.positions || ['ON', 'OFF'];
  const horiz = s.orientation === 'h' || s.orientation === 'horizontal';
  const x = s.x;
  const y = s.y;
  const three = pos.length >= 3;
  if (!horiz) {
    const topY = y + 0.0099;
    const botY = y - 0.0101;
    if (pos[0]) P.text(pos[0], x, topY, posSize);
    if (pos[pos.length - 1]) P.text(pos[pos.length - 1], x, botY, posSize);
    if (three && pos[1]) P.text(pos[1], x + 0.0072, y, posSize * 0.95, { align: 'left' });
    if (s.label) {
      const lines = String(s.label).split('\n').length;
      const lh = size * 1.2;
      // centre of the LAST line sits just above the top legend; the block grows upward
      const lastY = topY + posSize * 0.36 + 0.0031 + size * 0.36;
      P.text(s.label, x, lastY + ((lines - 1) * lh) / 2, size, { lineHeight: 1.2 });
    }
  } else {
    if (pos[0]) P.text(pos[0], x - 0.0082, y, posSize, { align: 'right' });
    if (pos[pos.length - 1]) P.text(pos[pos.length - 1], x + 0.0082, y, posSize, { align: 'left' });
    if (three && pos[1]) P.text(pos[1], x, y - 0.0085, posSize * 0.95);
    if (s.label) {
      const lines = String(s.label).split('\n').length;
      const lh = size * 1.2;
      P.text(s.label, x, y + 0.0092 + size * 0.36 + ((lines - 1) * lh) / 2, size);
    }
  }
}

/**
 * Bank of Apollo toggle switches, instanced.
 * @param {object} opts
 * @param {Array<object>} opts.switches  [{ id, x, y, label, positions=['ON','OFF'] (2 or 3 legends,
 *   first = up/left), state (index | 'up'|'center'|'down'), guard: false|'grey'|'red' (posts either
 *   side), cover: false|'red'|'grey' (hinged cover), coverOpen=false, orientation 'v'|'h',
 *   labelSize, positionSize }]
 * @param {object} [opts.panel] painter to print legends on (createPanel does this for you)
 * @returns {{object: THREE.Group, switches: Array<object>, byId: Map<string, object>,
 *   setState(idOrIndex, state): void, getState(idOrIndex): number}}
 *   Each switch handle: { id, index, x, y, positions, state (index), setState(s), setCoverOpen(b) }.
 */
export function createSwitchBank(opts = {}) {
  const list = opts.switches || [];
  const G = geo();
  const n = Math.max(1, list.length);
  const group = new THREE.Group();
  group.name = 'SwitchBank';
  const nut = new THREE.InstancedMesh(G.nut, getMaterial('satinMetal'), n);
  const washer = new THREE.InstancedMesh(G.washer, getMaterial('darkMetal'), n);
  const bushing = new THREE.InstancedMesh(G.bushing, getMaterial('satinMetal'), n);
  const lever = new THREE.InstancedMesh(G.lever, getMaterial('chrome'), n);
  const nGuard = list.filter((s) => s.guard).length * 2;
  const nCover = list.filter((s) => s.cover).length;
  const guard = nGuard ? new THREE.InstancedMesh(G.guard, getMaterial('instancePaint'), nGuard) : null;
  const cover = nCover ? new THREE.InstancedMesh(G.cover, getMaterial('instancePaint'), nCover) : null;
  const hinge = nCover ? new THREE.InstancedMesh(G.hinge, getMaterial('instancePaint'), nCover) : null;
  for (const m of [nut, washer, bushing, lever, guard, cover, hinge]) {
    if (!m) continue;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // instances span the panel; bounding sphere is of one switch
    useInstancedShadowDepth(m);
    group.add(m);
  }
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const S1 = new THREE.Vector3(1, 1, 1);
  const V = new THREE.Vector3();
  const E = new THREE.Euler();
  const col = new THREE.Color();
  let gi = 0;
  let ci = 0;
  const handles = [];
  const byId = new Map();

  list.forEach((s, i) => {
    const positions = s.positions || ['ON', 'OFF'];
    const horiz = s.orientation === 'h' || s.orientation === 'horizontal';
    const rotZ = horiz ? Math.PI / 2 : 0; // horizontal: throw plane rotated 90°
    Q.setFromEuler(E.set(0, 0, rotZ + (i * 0.37) % 0.5));
    M.compose(V.set(s.x, s.y, 0), Q, S1);
    nut.setMatrixAt(i, M);
    Q.setFromEuler(E.set(0, 0, rotZ));
    M.compose(V.set(s.x, s.y, 0), Q, S1);
    washer.setMatrixAt(i, M);
    bushing.setMatrixAt(i, M);
    const h = {
      id: s.id ?? `S${i}`,
      index: i,
      x: s.x,
      y: s.y,
      positions,
      state: stateIndex(s.state ?? 0, positions.length),
      coverIndex: -1,
      coverOpen: !!s.coverOpen,
      setState(st) {
        h.state = stateIndex(st, positions.length);
        const nPos = positions.length;
        // up (0) tips the lever toward +Y (rotation about X is negative)
        const a = nPos === 3 ? (1 - h.state) * TOGGLE_THROW : h.state === 0 ? TOGGLE_THROW : -TOGGLE_THROW;
        Q.setFromEuler(E.set(-a, 0, rotZ, 'ZXY'));
        M.compose(V.set(s.x, s.y, PIVOT_Z), Q, S1);
        lever.setMatrixAt(i, M);
        lever.instanceMatrix.needsUpdate = true;
      },
      setCoverOpen(open) {
        if (h.coverIndex < 0) return;
        h.coverOpen = !!open;
        const cs = G.coverSize;
        Q.setFromEuler(E.set(open ? -1.9 : 0, 0, rotZ, 'ZXY'));
        V.set(0, cs.h / 2 + 0.0005, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotZ);
        M.compose(V.set(s.x + V.x, s.y + V.y, 0.0005), Q, S1);
        cover.setMatrixAt(h.coverIndex, M);
        cover.instanceMatrix.needsUpdate = true;
      },
    };
    h.setState(h.state);
    if (s.guard) {
      col.set(s.guard === 'red' ? COLORS.guardRed : 0x6a6d6f);
      for (const side of [-1, 1]) {
        V.set(side * 0.0088, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotZ);
        Q.setFromEuler(E.set(0, 0, rotZ));
        M.compose(V.set(s.x + V.x, s.y + V.y, 0), Q, S1);
        guard.setMatrixAt(gi, M);
        guard.setColorAt(gi, col);
        gi++;
      }
    }
    if (s.cover) {
      h.coverIndex = ci;
      col.set(s.cover === 'red' ? COLORS.guardRed : 0x6a6d6f);
      cover.setColorAt(ci, col);
      const cs = G.coverSize;
      V.set(0, cs.h / 2 + 0.0005, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rotZ);
      Q.setFromEuler(E.set(0, 0, rotZ));
      M.compose(V.set(s.x + V.x, s.y + V.y + 0.0012, 0), Q, S1);
      hinge.setMatrixAt(ci, M);
      hinge.setColorAt(ci, col.set(0x5a5c5e));
      ci++;
      h.setCoverOpen(h.coverOpen);
    }
    handles.push(h);
    byId.set(h.id, h);
    if (opts.panel && s.print !== false) printToggleLegends(opts.panel, s);
  });
  if (!list.length) {
    // keep a valid (empty) bank
    for (const m of [nut, washer, bushing, lever]) m.count = 0;
  }
  for (const m of [nut, washer, bushing, lever, guard, cover, hinge]) {
    if (!m) continue;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  const get = (k) => (typeof k === 'number' ? handles[k] : byId.get(k));
  return {
    object: group,
    switches: handles,
    byId,
    setState(k, st) {
      get(k)?.setState(st);
    },
    getState(k) {
      return get(k)?.state;
    },
  };
}

/** Alias of createSwitchBank (same options). */
export const createToggleSwitchArray = createSwitchBank;

/**
 * Single toggle switch (bat-handle lever). opts: { state: 'up'|'center'|'down' | index,
 * positions (2 or 3 legends, default 2-position), guard: false|'grey'|'red', cover, orientation }.
 * Returns a THREE.Group with .setState(state), .setCoverOpen(open) and .handle.
 */
export function createToggleSwitch(opts = {}) {
  const positions = opts.positions || (opts.state === 'center' ? ['UP', 'CTR', 'DN'] : ['UP', 'DN']);
  const bank = createSwitchBank({ switches: [{ ...opts, x: 0, y: 0, positions, print: false }] });
  const grp = bank.object;
  const h = bank.switches[0];
  grp.handle = h;
  grp.setState = (s) => h.setState(s);
  grp.setCoverOpen = (o) => h.setCoverOpen(o);
  return grp;
}
