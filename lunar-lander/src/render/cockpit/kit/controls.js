// Rotary selector switches, thumbwheels, talkback indicators, lit push buttons and small lamps.
// All face +Z with their mounting plane at z = 0 (metres).
import * as THREE from 'three';
import { getMaterial, registerLamp, setLampLevel, LAMP_COLORS, COLORS } from './materials.js';
import { createCanvasTexture, drawText, roundRectPath, css } from './canvas.js';

const DEG = Math.PI / 180;

/** Planar UV projection (x,y over a w×h rectangle centred at cx,cy) for any geometry. */
export function planarUV(geom, w, h, cx = 0, cy = 0) {
  const p = geom.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - cx) / w + 0.5;
    uv[i * 2 + 1] = (p.getY(i) - cy) / h + 0.5;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}

/** Rounded rectangle THREE.Shape centred on the origin. */
export function roundedRectShape(w, h, r, shape = new THREE.Shape()) {
  r = Math.min(r, w / 2 - 1e-6, h / 2 - 1e-6);
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  if (r > 0) shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  if (r > 0) shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  if (r > 0) shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  if (r > 0) shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** Extruded rounded box whose FRONT face is at z = front and back at front - depth, planar UVs. */
export function roundedSlab(w, h, depth, r = 0.001, bevel = 0.0006, front = 0) {
  const b = Math.min(bevel, depth / 3, w / 4, h / 4);
  const shape = roundedRectShape(w - 2 * b, h - 2 * b, Math.max(0, r - b));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-5, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, front - (depth - b));
  planarUV(g, w, h);
  return g;
}

/**
 * Rounded slab with a rectangular window through it (front face at z = depth, back at 0).
 * Used for bezels of talkbacks / flags.
 */
export function frameSlab(w, h, depth, holeW, holeH, r = 0.001, holeR = 0.0005) {
  const shape = roundedRectShape(w, h, r);
  const hole = new THREE.Path();
  const hw = holeW / 2;
  const hh = holeH / 2;
  const hr = Math.min(holeR, hw, hh);
  hole.moveTo(-hw + hr, -hh);
  hole.lineTo(hw - hr, -hh);
  hole.quadraticCurveTo(hw, -hh, hw, -hh + hr);
  hole.lineTo(hw, hh - hr);
  hole.quadraticCurveTo(hw, hh, hw - hr, hh);
  hole.lineTo(-hw + hr, hh);
  hole.quadraticCurveTo(-hw, hh, -hw, hh - hr);
  hole.lineTo(-hw, -hh + hr);
  hole.quadraticCurveTo(-hw, -hh, -hw + hr, -hh);
  shape.holes.push(hole);
  const b = Math.min(0.0005, depth / 3);
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - b, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 2, curveSegments: 5 });
  planarUV(g, w, h);
  return g;
}

/**
 * Transparent decal plane with canvas-drawn content (for legends of stand-alone controls).
 * draw(g, W, H, pxPerM) paints in canvas px. Returns a Mesh lying at z = 0.0002.
 */
export function createDecal(width, height, draw, pxPerM = 3000) {
  const t = createCanvasTexture(width, height, pxPerM);
  t.g.clearRect(0, 0, t.canvas.width, t.canvas.height);
  draw(t.g, t.canvas.width, t.canvas.height, t.canvas.width / width);
  t.texture.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: t.texture, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  m.position.z = 0.0002;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------------------ rotary switch
let _knob = null;
function knobGeo() {
  if (_knob) return _knob;
  // skirt: fluted base disc
  const skirtPts = [[0.0001, 0], [0.0102, 0], [0.0104, 0.0006], [0.0104, 0.0029], [0.0096, 0.0038], [0.0001, 0.0038]].map(([r, h]) => new THREE.Vector2(r, h));
  const skirt = new THREE.LatheGeometry(skirtPts, 36).rotateX(Math.PI / 2);
  // flutes: perturb the rim radially (knurled look) by scaling alternate vertices
  const p = skirt.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const r = Math.hypot(x, y);
    if (r > 0.0099) {
      const a = Math.atan2(y, x);
      const k = 1 + 0.035 * Math.cos(a * 36);
      p.setXY(i, x * k, y * k);
    }
  }
  skirt.computeVertexNormals();
  // tapered bar pointer on top of the skirt
  const s = new THREE.Shape();
  s.moveTo(-0.0036, -0.0085);
  s.lineTo(0.0036, -0.0085);
  s.lineTo(0.0026, 0.0135);
  s.quadraticCurveTo(0, 0.0152, -0.0026, 0.0135);
  s.closePath();
  const bar = new THREE.ExtrudeGeometry(s, { depth: 0.0078, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 4 });
  bar.translate(0, 0, 0.0034);
  // white index line inlaid along the pointer
  const line = new THREE.BoxGeometry(0.0010, 0.0118, 0.0004).translate(0, 0.0072, 0.0034 + 0.0078 + 0.0009 + 0.00005);
  _knob = { skirt, bar, line };
  return _knob;
}

/**
 * Rotary selector switch with an Apollo black pointer knob (fluted skirt + tapered bar with a white
 * index line). Position legends are printed around it (on `opts.panel` if given, else on a decal).
 * @param {object} opts { positions=['OFF','ON'], index=0, angles (deg, clockwise from up; default
 *   30° apart centred on up), label (title above), size=1 (scale), legendRadius=0.0175, labelSize,
 *   panel (painter), x, y (only used with panel: where the knob sits on it) }
 * @returns {THREE.Group} with .setIndex(i), .index, .positions
 */
export function createRotarySwitch(opts = {}) {
  const positions = opts.positions || ['OFF', 'ON'];
  const n = positions.length;
  const step = opts.step ?? (n > 6 ? 300 / (n - 1) : 30);
  const angles = opts.angles || positions.map((_, i) => (i - (n - 1) / 2) * step);
  const K = knobGeo();
  const grp = new THREE.Group();
  grp.name = 'RotarySwitch';
  const knob = new THREE.Group();
  const blk = getMaterial('blackKnob');
  for (const gm of [K.skirt, K.bar]) {
    const m = new THREE.Mesh(gm, blk);
    m.castShadow = m.receiveShadow = true;
    knob.add(m);
  }
  const ln = new THREE.Mesh(K.line, getMaterial('white'));
  knob.add(ln);
  const sc = opts.size ?? 1;
  knob.scale.setScalar(sc);
  grp.add(knob);
  const legendR = (opts.legendRadius ?? 0.0178) * sc;
  const ls = opts.labelSize ?? 0.0029;
  const printLegends = (P, cx, cy) => {
    positions.forEach((t, i) => {
      if (!t) return;
      const a = angles[i] * DEG;
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      P.line(cx + dx * 0.0122 * sc, cy + dy * 0.0122 * sc, cx + dx * 0.0142 * sc, cy + dy * 0.0142 * sc, 0.0006);
      const tx = cx + dx * legendR;
      const ty = cy + dy * legendR;
      const align = Math.abs(dx) < 0.3 ? 'center' : dx > 0 ? 'left' : 'right';
      P.text(t, tx + (align === 'left' ? -0.001 : align === 'right' ? 0.001 : 0), ty, ls, { align });
    });
    if (opts.label) {
      const top = Math.max(...angles.map((d) => Math.cos(d * DEG)));
      const lines = String(opts.label).split('\n').length;
      // clear the (possibly multi-line) legends near the top of the dial
      const topLines = Math.max(1, ...positions.map((t, i) => (Math.abs(Math.sin(angles[i] * DEG)) < 0.6 ? String(t).split('\n').length : 1)));
      const yl = cy + legendR * Math.max(0.5, top) + ls * (0.9 + 0.6 * topLines) + 0.0012 + ((lines - 1) * ls * 1.2) / 2;
      P.text(opts.label, cx, yl, ls * 1.08, { lineHeight: 1.2 });
    }
  };
  if (opts.panel) {
    printLegends(opts.panel, opts.x ?? 0, opts.y ?? 0);
  } else if (opts.legends !== false) {
    // stand-alone: decal with the legends around the knob
    const W = legendR * 2 + 0.03;
    const H = legendR * 2 + 0.03;
    const painterLike = decalPainter(W, H);
    printLegends(painterLike, 0, 0);
    grp.add(painterLike.finish());
  }
  grp.positions = positions;
  grp.angles = angles;
  grp.index = 0;
  grp.setIndex = (i) => {
    grp.index = Math.max(0, Math.min(n - 1, i | 0));
    knob.rotation.z = -angles[grp.index] * DEG;
  };
  grp.setIndex(opts.index ?? 0);
  return grp;
}

/** A tiny painter-compatible object drawing onto a transparent decal (text + line only). */
export function decalPainter(W, H, pxPerM = 3200) {
  const t = createCanvasTexture(W, H, pxPerM);
  const s = t.canvas.width / W;
  const X = (x) => (x + W / 2) * s;
  const Y = (y) => (H / 2 - y) * s;
  const P = {
    g: t.g,
    X,
    Y,
    px: (m) => m * s,
    text(text, x, y, size, o = {}) {
      drawText(t.g, text, X(x), Y(y), size * s, o);
    },
    textWidth(text, size) {
      t.g.font = `bold ${size * s}px sans-serif`;
      return (t.g.measureText(text).width * 0.84) / s;
    },
    line(x1, y1, x2, y2, w = 0.0007, color = '#f0f0ea') {
      t.g.strokeStyle = css(color);
      t.g.lineWidth = Math.max(1, w * s);
      t.g.beginPath();
      t.g.moveTo(X(x1), Y(y1));
      t.g.lineTo(X(x2), Y(y2));
      t.g.stroke();
    },
    rect(x, y, w, h, color) {
      t.g.fillStyle = css(color);
      t.g.fillRect(X(x - w / 2), Y(y + h / 2), w * s, h * s);
    },
    ring() {},
    groove() {},
    screw() {},
    finish() {
      t.texture.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map: t.texture, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
      m.position.z = 0.0002;
      m.receiveShadow = true;
      return m;
    },
  };
  return P;
}

// ------------------------------------------------------------------------------ thumbwheel
let _wheelTex = null;
function wheelTexture() {
  if (_wheelTex) return _wheelTex;
  // cylinder u runs around the wheel (screen-up on the visible face), v along the axle:
  // digits are laid along canvas x and rotated 90° so they read upright on the wheel
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#161718';
  g.fillRect(0, 0, 640, 64);
  for (let d = 0; d < 10; d++) {
    g.save();
    g.translate((d + 0.5) * 64, 32);
    g.rotate(Math.PI / 2);
    drawText(g, String(d), 0, 0, 40, { color: '#f0efe8', condense: 0.9, caps: false });
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(d * 64 - 1, 0, 2, 64);
  }
  _wheelTex = new THREE.CanvasTexture(c);
  _wheelTex.colorSpace = THREE.SRGBColorSpace;
  _wheelTex.anisotropy = 4;
  return _wheelTex;
}

/**
 * Thumbwheel switch(es): digit wheels seen through slots in a black bezel, knurled edges proud of
 * the face. opts: { digits=1, value=0, label, width per digit=0.009 }
 * @returns {THREE.Group} with .setValue(v) (integer, rolls each wheel), .value
 */
export function createThumbwheel(opts = {}) {
  const nd = opts.digits || 1;
  const dw = opts.digitWidth || 0.009;
  const W = nd * dw + 0.006;
  const H = 0.024;
  const grp = new THREE.Group();
  grp.name = 'Thumbwheel';
  const bez = new THREE.Mesh(roundedSlab(W, H, 0.004, 0.0015, 0.0006, 0.004), getMaterial('blackPaint'));
  bez.castShadow = bez.receiveShadow = true;
  grp.add(bez);
  const R = 0.0105;
  const tex = wheelTexture();
  const wheels = [];
  for (let i = 0; i < nd; i++) {
    const cyl = new THREE.CylinderGeometry(R, R, dw * 0.78, 30, 1, true);
    cyl.rotateZ(Math.PI / 2); // axis along X
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    const w = new THREE.Mesh(cyl, mat);
    // wheel centre behind the face so only a sliver shows through the slot
    w.position.set(-W / 2 + 0.003 + dw * (i + 0.5), 0, 0.004 - R + 0.0022);
    grp.add(w);
    wheels.push(w);
    // dark slot mask: window in the bezel (a black frame left/right of each wheel is the bezel)
  }
  // slot window frame (front plate with holes) — thin plate in front of the wheels
  const plate = new THREE.Shape();
  roundedRectShape(W, H, 0.0015, plate);
  for (let i = 0; i < nd; i++) {
    const hole = new THREE.Path();
    const cx = -W / 2 + 0.003 + dw * (i + 0.5);
    const hw = dw * 0.72;
    const hh = 0.0105;
    hole.moveTo(cx - hw / 2, -hh / 2);
    hole.lineTo(cx + hw / 2, -hh / 2);
    hole.lineTo(cx + hw / 2, hh / 2);
    hole.lineTo(cx - hw / 2, hh / 2);
    hole.closePath();
    plate.holes.push(hole);
  }
  const pg = new THREE.ExtrudeGeometry(plate, { depth: 0.0008, bevelEnabled: false });
  pg.translate(0, 0, 0.0042);
  const pm = new THREE.Mesh(pg, getMaterial('blackPaint'));
  pm.receiveShadow = true;
  grp.add(pm);
  grp.value = 0;
  grp.setValue = (v) => {
    grp.value = Math.max(0, Math.round(v));
    let x = grp.value;
    for (let i = nd - 1; i >= 0; i--) {
      const d = x % 10;
      x = Math.floor(x / 10);
      // cylinder UV v runs 0..1 around; rotate so digit d faces +Z
      wheels[i].rotation.x = ((d + 0.5) / 10) * Math.PI * 2;
    }
  };
  grp.setValue(opts.value ?? 0);
  if (opts.label) {
    const dec = createDecal(W + 0.02, 0.01, (g, Wp, Hp, s) => drawText(g, opts.label, Wp / 2, Hp / 2, 0.003 * s));
    dec.position.set(0, H / 2 + 0.005, 0.0002);
    grp.add(dec);
  }
  return grp;
}

// ------------------------------------------------------------------------------ talkbacks
const _flagTex = {};
/** Shared flag textures: 'grey', 'barber', 'line-h', 'line-v', 'blank' (black). */
export function talkbackTexture(state) {
  if (_flagTex[state]) return _flagTex[state];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (state === 'barber') {
    g.fillStyle = '#f1efe7';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#121212';
    for (let i = -8; i < 8; i++) {
      g.beginPath();
      g.moveTo(i * 32, 128);
      g.lineTo(i * 32 + 16, 128);
      g.lineTo(i * 32 + 16 + 128, 0);
      g.lineTo(i * 32 + 128, 0);
      g.closePath();
      g.fill();
    }
  } else if (state === 'blank') {
    g.fillStyle = '#0c0c0c';
    g.fillRect(0, 0, 128, 128);
  } else {
    g.fillStyle = css(COLORS.panelGray);
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#eceae2';
    if (state === 'line-h') g.fillRect(0, 56, 128, 16);
    if (state === 'line-v') g.fillRect(56, 0, 16, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _flagTex[state] = t;
  return t;
}

let _glassGeoCache = new Map();
/** Flat cover-glass plane (w×h, optional round) at z. Additive reflective glass. */
export function createGlass(w, h, z = 0, round = false) {
  const key = `${w.toFixed(5)}x${h.toFixed(5)}${round ? 'r' : ''}`;
  let g = _glassGeoCache.get(key);
  if (!g) {
    g = round ? new THREE.CircleGeometry(w / 2, 48) : new THREE.PlaneGeometry(w, h);
    // spread the smudge texture over the glass at ~0.1 m per tile
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 8 + (w * 13.7) % 1, uv.getY(i) * h * 8 + (h * 7.1) % 1);
    _glassGeoCache.set(key, g);
  }
  const m = new THREE.Mesh(g, getMaterial('glass'));
  m.position.z = z;
  m.renderOrder = 10;
  m.castShadow = false;
  m.receiveShadow = true; // no Sun glint where the glass is in shadow
  return m;
}

/**
 * Talkback indicator: small flag window in a black bezel showing grey (with optional flow line)
 * or barber-pole stripes. opts: { size=0.012, state='grey'|'barber'|'line-h'|'line-v'|'blank', round=false }
 * @returns {THREE.Group} with .setState(state), .state
 */
export function createTalkback(opts = {}) {
  const s = opts.size || 0.012;
  const grp = new THREE.Group();
  grp.name = 'Talkback';
  const bw = s * 1.55;
  const bez = new THREE.Mesh(frameSlab(bw, bw, 0.003, s, s, s * 0.18, s * 0.06), getMaterial('blackPaint'));
  bez.castShadow = bez.receiveShadow = true;
  grp.add(bez);
  // recessed window: flag plane 1.8 mm below the bezel face; dark inner walls
  const well = new THREE.Mesh(new THREE.BoxGeometry(s, s, 0.0019).translate(0, 0, 0.0031 - 0.00095), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, side: THREE.BackSide }));
  grp.add(well);
  const flagMat = new THREE.MeshStandardMaterial({ map: talkbackTexture(opts.state || 'grey'), roughness: 0.6 });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.98, s * 0.98), flagMat);
  flag.position.z = 0.0013;
  flag.receiveShadow = true;
  grp.add(flag);
  grp.add(createGlass(s * 1.02, s * 1.02, 0.00305));
  grp.state = opts.state || 'grey';
  grp.setState = (st) => {
    if (st === grp.state) return;
    grp.state = st;
    flagMat.map = talkbackTexture(st);
    flagMat.needsUpdate = true;
  };
  return grp;
}

// ------------------------------------------------------------------------------ push buttons / lamps
/**
 * Draw a lamp/button legend canvas.
 * style 'block': lit face glows, legend letters dark;  'legend': letters glow on a dark face.
 */
function legendCanvas(label, wPx, hPx, style, lit, colorName, tone = 'dark') {
  const c = document.createElement('canvas');
  c.width = wPx;
  c.height = hPx;
  const g = c.getContext('2d');
  const lines = String(label || '').toUpperCase().split('\n');
  const size = Math.min((hPx * 0.62) / Math.max(1, lines.length) / 1.12, wPx * 0.3);
  const fit = (t) => {
    g.font = `bold ${size}px sans-serif`;
    return Math.min(1, (wPx * 0.86) / Math.max(1, g.measureText(t).width * 0.84));
  };
  const k = Math.min(...lines.map(fit));
  if (style === 'block') {
    if (lit) {
      // slightly brighter centre (lamp behind a diffuser)
      const rg = g.createRadialGradient(wPx / 2, hPx / 2, 0, wPx / 2, hPx / 2, Math.max(wPx, hPx) * 0.75);
      rg.addColorStop(0, '#ffffff');
      rg.addColorStop(1, '#b8b8b8');
      g.fillStyle = rg;
      g.fillRect(0, 0, wPx, hPx);
      drawText(g, lines.join('\n'), wPx / 2, hPx / 2, size * k, { color: 'rgba(0,0,0,0.82)', lineHeight: 1.12 });
    } else {
      // unlit: frosted lens, legend faintly readable
      const gr = g.createLinearGradient(0, 0, 0, hPx);
      gr.addColorStop(0, tone === 'light' ? '#cfccc4' : '#2a2927');
      gr.addColorStop(1, tone === 'light' ? '#b9b6ae' : '#1d1c1b');
      g.fillStyle = gr;
      g.fillRect(0, 0, wPx, hPx);
      drawText(g, lines.join('\n'), wPx / 2, hPx / 2, size * k, { color: 'rgba(0,0,0,0.9)', lineHeight: 1.12 });
    }
  } else {
    g.fillStyle = lit ? '#000' : '#111213';
    g.fillRect(0, 0, wPx, hPx);
    drawText(g, lines.join('\n'), wPx / 2, hPx / 2, size * k, { color: lit ? '#ffffff' : 'rgba(120,120,116,0.55)', lineHeight: 1.12 });
  }
  void colorName;
  return c;
}

/**
 * Tint the "unlit" lens canvas by lamp colour (so an unlit red lens looks dark red).
 */
function tintUnlit(c, colorName) {
  const col = LAMP_COLORS[colorName] || LAMP_COLORS.white;
  const g = c.getContext('2d');
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgb(${Math.round(90 + col.r * 120)},${Math.round(90 + col.g * 120)},${Math.round(90 + col.b * 120)})`;
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
  return c;
}

/**
 * Lamp face material pair (unlit look in `map`, lit look in `emissiveMap`) registered with the
 * global lamp brightness. Returns { material, setLit(on|level) }.
 */
export function createLampFace(label, wM, hM, { style = 'block', color = 'white', pxPerM = 6000, intensity, tone = 'dark' } = {}) {
  const wPx = Math.max(32, Math.min(512, Math.round(wM * pxPerM)));
  const hPx = Math.max(32, Math.min(512, Math.round(hM * pxPerM)));
  const off = tintUnlit(legendCanvas(label, wPx, hPx, style, false, color, tone), color);
  const on = legendCanvas(label, wPx, hPx, style, true, color);
  const mapT = new THREE.CanvasTexture(off);
  mapT.colorSpace = THREE.SRGBColorSpace;
  const emT = new THREE.CanvasTexture(on);
  emT.colorSpace = THREE.SRGBColorSpace;
  mapT.anisotropy = emT.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map: mapT,
    emissiveMap: emT,
    emissive: (LAMP_COLORS[color] || LAMP_COLORS.white).clone(),
    roughness: 0.32,
    metalness: 0,
  });
  registerLamp(material, intensity ?? (style === 'block' ? 0.8 : 1.2));
  const setLit = (v) => {
    const k = v === true ? 1 : v === false ? 0 : +v || 0;
    setLampLevel(material, k);
    // a lit lens is dominated by transmitted light: dim its diffuse (ambient-lit) look
    material.color.setScalar(1 - 0.8 * Math.min(1, k));
  };
  setLit(0);
  return { material, setLit };
}

/**
 * Push button (optionally lit) — square lens cap in a black bezel.
 * opts: { label, color: 'red'|'amber'|'white'|'green'|'blue', lit=false, size=0.02 (or width/height),
 *   style: 'block'|'legend', tone: 'dark'|'light' (unlit lens look), guard: false|'grey'|'red',
 *   travel=0.0015 }
 * @returns {THREE.Group} with .setLit(on|level), .press(down)
 */
export function createPushButton(opts = {}) {
  const w = opts.width || opts.size || 0.02;
  const h = opts.height || opts.size || 0.02;
  const grp = new THREE.Group();
  grp.name = 'PushButton';
  const bez = new THREE.Mesh(roundedSlab(w + 0.005, h + 0.005, 0.004, 0.0018, 0.0006, 0.004), getMaterial('blackPaint'));
  bez.castShadow = bez.receiveShadow = true;
  grp.add(bez);
  const face = createLampFace(opts.label || '', w, h, { style: opts.style || 'block', color: opts.color || 'white', tone: opts.tone || 'dark' });
  const cap = new THREE.Mesh(roundedSlab(w, h, 0.004, 0.0012, 0.0007, 0.0068), face.material);
  cap.castShadow = true;
  cap.receiveShadow = true;
  grp.add(cap);
  if (opts.guard) {
    const gm = opts.guard === 'red' ? getMaterial('guardRed') : getMaterial('guardGray');
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(roundedSlab(0.0022, h + 0.008, 0.016, 0.0009, 0.0005, 0.016), gm);
      post.position.x = sx * (w / 2 + 0.0045);
      post.castShadow = post.receiveShadow = true;
      grp.add(post);
    }
  }
  grp.add(createGlass(w * 0.98, h * 0.98, 0.00685));
  grp.setLit = face.setLit;
  grp.press = (down) => {
    cap.position.z = down ? -(opts.travel ?? 0.0015) : 0;
  };
  grp.setLit(!!opts.lit);
  return grp;
}

/**
 * Small round indicator lamp (jewel lens in a black bezel). opts: { color='amber', size=0.008, lit }
 * @returns {THREE.Group} with .setLit(on|level)
 */
export function createLamp(opts = {}) {
  const r = (opts.size || 0.008) / 2;
  const grp = new THREE.Group();
  grp.name = 'Lamp';
  const bez = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.55, r * 1.7, 0.003, 24).rotateX(Math.PI / 2).translate(0, 0, 0.0015),
    getMaterial('blackPaint'),
  );
  bez.castShadow = bez.receiveShadow = true;
  grp.add(bez);
  const col = LAMP_COLORS[opts.color || 'amber'] || LAMP_COLORS.amber;
  const mat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.25), emissive: col.clone(), roughness: 0.15 });
  registerLamp(mat);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.55).translate(0, 0, 0.003), mat);
  grp.add(lens);
  grp.setLit = (v) => setLampLevel(mat, v === true ? 1 : v === false ? 0 : +v || 0);
  grp.setLit(!!opts.lit);
  return grp;
}

/** Keep the rounded-rect path helper reachable for callers drawing their own faces. */
export { roundRectPath };
