// Apollo instrument panels: satin grey painted aluminium plates with crisp white condensed
// lettering, white group rules/boxes, fasteners, subtle wear, a small edge bevel, cut-outs for
// instruments — and (optionally) all the hardware mounted on them: toggle switches, circuit
// breakers, rotaries, push buttons, talkbacks, thumbwheels. Legends of every control are printed
// on the panel texture itself, as on the real panels.
import * as THREE from 'three';
import { COLORS, createPaintedMaterial } from './materials.js';
import { createPainter, hashString } from './canvas.js';
import { createSwitchBank } from './switches.js';
import { createBreakerBank, layoutBreakers } from './breakers.js';
import { createRotarySwitch, createPushButton, createTalkback, createThumbwheel, createLamp, roundedRectShape } from './controls.js';

/**
 * Panel slab geometry: rounded rectangle with holes, small edge bevel, front face at z = 0,
 * planar UVs over the full width × height.
 */
function panelGeometry(w, h, depth, holes, cornerR, bevel) {
  const b = Math.min(bevel, depth / 3);
  const shape = roundedRectShape(w - 2 * b, h - 2 * b, Math.max(0, cornerR - b));
  for (const ho of holes) {
    const p = new THREE.Path();
    if (ho.radius != null || ho.r != null) {
      const r = (ho.radius ?? ho.r) + b;
      p.absarc(ho.x, ho.y, r, 0, Math.PI * 2, true);
    } else {
      const hw = ho.w / 2 + b;
      const hh = ho.h / 2 + b;
      const cr = Math.min(ho.radius2 ?? ho.corner ?? 0.0015, hw, hh);
      // clockwise path for holes
      p.moveTo(ho.x - hw + cr, ho.y - hh);
      p.quadraticCurveTo(ho.x - hw, ho.y - hh, ho.x - hw, ho.y - hh + cr);
      p.lineTo(ho.x - hw, ho.y + hh - cr);
      p.quadraticCurveTo(ho.x - hw, ho.y + hh, ho.x - hw + cr, ho.y + hh);
      p.lineTo(ho.x + hw - cr, ho.y + hh);
      p.quadraticCurveTo(ho.x + hw, ho.y + hh, ho.x + hw, ho.y + hh - cr);
      p.lineTo(ho.x + hw, ho.y - hh + cr);
      p.quadraticCurveTo(ho.x + hw, ho.y - hh, ho.x + hw - cr, ho.y - hh);
      p.closePath();
    }
    shape.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 10,
  });
  g.translate(0, 0, -(depth - b));
  // planar UVs over the panel rectangle
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / w + 0.5;
    uv[i * 2 + 1] = p.getY(i) / h + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Default fastener layout: Dzus/screws at the corners and every ~0.13 m along the edges. */
function defaultScrews(w, h, inset, kind) {
  const out = [];
  const nx = Math.max(1, Math.round((w - 2 * inset) / 0.13));
  const ny = Math.max(1, Math.round((h - 2 * inset) / 0.13));
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + inset + ((w - 2 * inset) * i) / nx;
    out.push({ x, y: h / 2 - inset, kind }, { x, y: -h / 2 + inset, kind });
  }
  for (let j = 1; j < ny; j++) {
    const y = -h / 2 + inset + ((h - 2 * inset) * j) / ny;
    out.push({ x: -w / 2 + inset, y, kind }, { x: w / 2 - inset, y, kind });
  }
  return out;
}

/**
 * Instrument panel with printed labels and (optionally) its hardware.
 *
 * spec: {
 *   width, height, depth=0.012, color=COLORS.panelGray, pxPerM=2800 (clamped to 2048 px/edge),
 *   name, seed, cornerRadius=0.003, bevel=0.0012, roughness=0.55, wear=0.5 (0..1),
 *   labels: [{ text, x, y, size=0.008 (font em, m), align='center', color, rotate (rad), condense,
 *              weight, baseline }],
 *   lines:  [{ x1, y1, x2, y2, width=0.0007, color }],
 *   polylines: [{ points: [[x,y],...], width, closed }],
 *   boxes:  [{ x, y, w, h, title, titleSize=0.0036, style='gap'|'bar', lineWidth, sides='tlrb' }],
 *   rects:  [{ x, y, w, h, color, radius }]   (filled; e.g. white strips, black backgrounds),
 *   holes:  [{ x, y, w, h, corner } | { x, y, radius }]   (cut-outs for instruments),
 *   screws: true | 'dzus' | [{ x, y, kind='phillips'|'dzus'|'slot'|'hex', r }], screwInset=0.0065,
 *   border: { width (black edge stripe, m), color, inner (colour of an inner rule), innerWidth },
 *   switches:  [...]  toggle specs (see createSwitchBank) — legends printed on the panel,
 *   breakers:  { rows, cols, pitchX, pitchY, x0, y0, labels, amps, rowLabels, groups, popped, ... }
 *              (see createCircuitBreakerPanel) or an array of such grids,
 *   rotaries:  [{ id, x, y, positions, index, angles, label, size }],
 *   buttons:   [{ id, x, y, label, color, lit, size|width,height, guard, style }],
 *   talkbacks: [{ id, x, y, state, size, label }],
 *   thumbwheels: [{ id, x, y, digits, value, label }],
 *   lamps:     [{ id, x, y, color, size, lit, label }],
 *   draw(painter)  custom painting callback (metre coordinates, see canvas.createPainter)
 * }
 * Label/line coordinates are metres from the panel centre (+x right, +y up).
 *
 * @returns {THREE.Group} group with:
 *   .width, .height, .painter, .mesh, .userData.canvasTexture (colour canvas/texture),
 *   .controls (Map id -> handle), .getControl(id), .setSwitch(id, state),
 *   .switchBank, .breakerBank, .addSwitches(list), .commit() (re-upload textures after painting)
 */
export function createPanel(spec) {
  const { width, height, depth = 0.012 } = spec;
  const color = spec.color ?? COLORS.panelGray;
  const seed = spec.seed ?? hashString(`${spec.name || ''}${width.toFixed(4)}${height.toFixed(4)}${(spec.labels || []).map((l) => l.text).join('')}`);
  const P = createPainter(width, height, { pxPerM: spec.pxPerM || 2800, color, roughness: spec.roughness ?? 0.55 });
  const grp = new THREE.Group();
  grp.name = spec.name || 'Panel';
  grp.width = width;
  grp.height = height;
  grp.painter = P;
  grp.userData.canvasTexture = P.color;
  const controls = new Map();
  grp.controls = controls;
  const hot = [];

  // ---- painting (order: fills, custom, rules, text, controls legends, fasteners, edge, wear)
  for (const r of spec.rects || []) P.rect(r.x, r.y, r.w, r.h, r.color ?? '#e9e8e2', { radius: r.radius, glow: r.glow });
  if (spec.draw) spec.draw(P);
  for (const b of spec.boxes || []) P.box(b);
  for (const l of spec.lines || []) P.line(l.x1, l.y1, l.x2, l.y2, l.width ?? 0.0007, l.color ?? '#f0f0ea');
  for (const pl of spec.polylines || []) P.polyline(pl.points, pl.width ?? 0.0007, pl.color ?? '#f0f0ea', true, !!pl.closed);
  for (const l of spec.labels || []) {
    const { text, x, y, size = 0.008, ...rest } = l;
    P.text(text, x, y, size, rest);
  }
  // dark shadow ring around instrument cut-outs (paint wraps into the hole)
  for (const ho of spec.holes || []) {
    if (ho.radius != null || ho.r != null) P.ring(ho.x, ho.y, (ho.radius ?? ho.r) + 0.0004, 0.0012, 'rgba(0,0,0,0.5)', 0, Math.PI * 2, false);
  }

  // ---- hardware
  if (spec.switches?.length) {
    const bank = createSwitchBank({ switches: spec.switches, panel: P });
    grp.add(bank.object);
    grp.switchBank = bank;
    for (const h of bank.switches) {
      controls.set(h.id, h);
      hot.push([h.x, h.y]);
    }
  }
  const cbGrids = spec.breakers ? (Array.isArray(spec.breakers) ? spec.breakers : [spec.breakers]) : [];
  if (cbGrids.length) {
    const all = [];
    cbGrids.forEach((gd, k) => {
      const o = normaliseBreakerGrid(gd, width, height, seed + k);
      all.push(...layoutBreakers(P, o));
    });
    const bank = createBreakerBank({ breakers: all });
    grp.add(bank.object);
    grp.breakerBank = bank;
    for (const h of bank.breakers) controls.set(h.id, h);
    all.forEach((b, i) => { if (i % 5 === 2) hot.push([b.x, b.y]); });
  }
  for (const r of spec.rotaries || []) {
    const k = createRotarySwitch({ ...r, panel: P });
    k.position.set(r.x, r.y, 0);
    grp.add(k);
    controls.set(r.id ?? `R${controls.size}`, k);
    hot.push([r.x, r.y]);
  }
  for (const b of spec.buttons || []) {
    const btn = createPushButton(b);
    btn.position.set(b.x, b.y, 0);
    grp.add(btn);
    controls.set(b.id ?? `B${controls.size}`, btn);
    if (b.caption) P.text(b.caption, b.x, b.y + (b.height || b.size || 0.02) / 2 + 0.0065, b.captionSize ?? 0.0031);
    hot.push([b.x, b.y]);
  }
  for (const t of spec.talkbacks || []) {
    const tb = createTalkback(t);
    tb.position.set(t.x, t.y, 0);
    grp.add(tb);
    controls.set(t.id ?? `TB${controls.size}`, tb);
    if (t.label) P.text(t.label, t.x, t.y + (t.size || 0.012) * 0.78 + 0.0045 + (String(t.label).split('\n').length - 1) * 0.0018, t.labelSize ?? 0.0029);
  }
  for (const t of spec.thumbwheels || []) {
    const tw = createThumbwheel({ ...t, label: undefined });
    tw.position.set(t.x, t.y, 0);
    grp.add(tw);
    controls.set(t.id ?? `TW${controls.size}`, tw);
    if (t.label) P.text(t.label, t.x, t.y + 0.0175, t.labelSize ?? 0.0031);
  }
  for (const l of spec.lamps || []) {
    const lp = createLamp(l);
    lp.position.set(l.x, l.y, 0);
    grp.add(lp);
    controls.set(l.id ?? `L${controls.size}`, lp);
    if (l.label) P.text(l.label, l.x, l.y + (l.size || 0.008) + 0.004, l.labelSize ?? 0.0029);
  }

  // ---- fasteners, edge, wear
  let screws = spec.screws;
  if (screws === true || screws === 'dzus' || screws === 'phillips') screws = defaultScrews(width, height, spec.screwInset ?? 0.0065, screws === true ? 'phillips' : screws);
  const sr = rngLocal(seed);
  for (const s of Array.isArray(screws) ? screws : []) {
    const kind = s.kind || 'phillips';
    P.screw(s.x, s.y, s.r ?? (kind === 'dzus' ? 0.0034 : 0.0021), kind, s.rot ?? sr() * Math.PI);
  }
  P.edge(spec.border || {});
  P.wear(spec.wear ?? 0.5, seed, hot);
  P.commit();

  // ---- geometry
  const mat = createPaintedMaterial(P, { bumpScale: spec.bumpScale ?? 0.6, metalness: spec.metalness ?? 0.05 });
  const geomHoles = spec.holes || [];
  const mesh = new THREE.Mesh(panelGeometry(width, height, depth, geomHoles, spec.cornerRadius ?? 0.003, spec.bevel ?? 0.0012), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = (spec.name || 'Panel') + ':plate';
  grp.add(mesh);
  grp.mesh = mesh;
  grp.material = mat;

  grp.getControl = (id) => controls.get(id);
  grp.setSwitch = (id, st) => controls.get(id)?.setState?.(st);
  grp.commit = () => P.commit();
  /** Add more toggles later (legends are printed and the texture re-uploaded). */
  grp.addSwitches = (list) => {
    const bank = createSwitchBank({ switches: list, panel: P });
    grp.add(bank.object);
    for (const h of bank.switches) controls.set(h.id, h);
    P.commit();
    return bank;
  };
  return grp;
}

function rngLocal(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** Fill defaults of a breaker grid relative to a panel of size w × h. */
function normaliseBreakerGrid(o, w, h, seed) {
  const rows = o.rows || 1;
  const cols = o.cols || 1;
  const pitchX = o.pitchX ?? 0.02;
  const pitchY = o.pitchY ?? 0.03;
  const hasRow = !!o.rowLabels?.length;
  const rlw = o.rowLabelWidth ?? 0.034;
  const gridW = (cols - 1) * pitchX + (hasRow ? rlw + 0.006 : 0);
  const x0 = o.x0 ?? -gridW / 2 + (hasRow ? rlw + 0.006 : 0);
  const topPad = o.groups?.length ? 0.018 : 0.012;
  const y0 = o.y0 ?? ((rows - 1) * pitchY) / 2 - topPad / 2 + 0.002;
  return { ...o, rows, cols, pitchX, pitchY, x0, y0, seed: o.seed ?? seed };
}

/**
 * Circuit-breaker panel: a grey panel carrying a rows × cols grid of Apollo circuit breakers.
 * opts: { rows, cols, pitchX=0.02, pitchY=0.03, width, height (auto from the grid if omitted),
 *   rowLabels: [] (white strips at the left), colLabels: [], labels: string[][] | (r,c)=>string,
 *   amps: number | number[][] | (r,c)=>number (printed below), popped: [[r,c],...] | probability,
 *   groups: [{ row, from, to, title }] (white title strips spanning columns), gaps: [[r,c]],
 *   ids: string[][], title (printed at the top), x0, y0 (grid origin override), screws=true,
 *   + any createPanel spec field (labels, boxes, ...) }
 * @returns {THREE.Group} panel group (see createPanel) with .breakers (handles), .setPopped(r, c, b)
 */
export function createCircuitBreakerPanel(opts = {}) {
  const rows = opts.rows || 4;
  const cols = opts.cols || 10;
  const pitchX = opts.pitchX ?? 0.02;
  const pitchY = opts.pitchY ?? 0.03;
  const hasRow = !!opts.rowLabels?.length;
  const rlw = opts.rowLabelWidth ?? 0.034;
  const width = opts.width || (cols - 1) * pitchX + 0.03 + (hasRow ? rlw + 0.008 : 0);
  const height = opts.height || rows * pitchY + 0.022 + (opts.title ? 0.014 : 0);
  const labels = [...(opts.labels && !Array.isArray(opts.labels[0]) && typeof opts.labels !== 'function' ? opts.labels : [])];
  if (opts.title) labels.push({ text: opts.title, x: 0, y: height / 2 - 0.0125, size: 0.0044 });
  const gridLabels = Array.isArray(opts.labels?.[0]) || typeof opts.labels === 'function' ? opts.labels : null;
  const grid = {
    rows, cols, pitchX, pitchY,
    labels: gridLabels,
    amps: opts.amps ?? 5,
    rowLabels: opts.rowLabels,
    rowLabelWidth: rlw,
    colLabels: opts.colLabels,
    groups: opts.groups,
    popped: opts.popped ?? 0.04,
    gaps: opts.gaps,
    ids: opts.ids,
    labelSize: opts.labelSize,
    x0: opts.x0,
    y0: opts.y0 ?? (opts.title ? ((rows - 1) * pitchY) / 2 - 0.0085 : undefined),
  };
  const panel = createPanel({ screws: true, ...opts, width, height, labels, breakers: grid, name: opts.name || 'CircuitBreakers' });
  panel.breakers = panel.breakerBank?.breakers || [];
  panel.setPopped = (r, c, p) => {
    const h = panel.breakers.find((b) => b.id === `CB${r}-${c}`) || (typeof r === 'string' ? panel.controls.get(r) : null);
    h?.setPopped(typeof r === 'string' ? c : p);
  };
  return panel;
}
