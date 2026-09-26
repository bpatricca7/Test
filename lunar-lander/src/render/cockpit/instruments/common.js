// Shared building blocks for the live instruments: 7-segment glyphs, emissive displays, bezels,
// needle meshes, update rate limiting.
import * as THREE from 'three';
import {
  createPanel, createCanvasTexture, setLayerRecursive, registerLamp, setLampLevel, LAMP_COLORS,
  createGlass, drawText, getMaterial, COLORS,
} from '../kit/index.js';
import { registerIntegral, setLampExposure } from '../kit/materials.js';
import { LAYERS } from '../../../core/constants.js';

export const FT = 0.3048;
export const DEG = Math.PI / 180;

/** Instrument update limiter: tick(dt) accumulates and returns the elapsed time when >= 1/hz. */
export function limiter(hz = 30) {
  let acc = 0;
  const step = 1 / hz;
  return {
    tick(dt) {
      acc += Math.max(0, dt || 0);
      if (acc < step) return 0;
      const e = Math.min(acc, 0.5);
      acc = 0;
      return e;
    },
  };
}

/**
 * Keep lamp / display brightness compensated for the post chain's auto-exposure (kit
 * setLampExposure). The exposure read-back lives on the render context (ctx.exposureInfo), reached
 * through the game's stable debug hook; cabins may also call KIT.setLampExposure(ctx.exposureInfo).
 */
function syncLampExposure(game) {
  const info = game?.ctx?.exposureInfo ?? game?.debug?.ctx?.exposureInfo;
  if (info) setLampExposure(info);
}

/**
 * Wrap up an instrument: put it on the cabin layer and return the contract object.
 * Adds `depth` (how far the instrument extends BEHIND its face plane, m — measured from the
 * geometry) and `mountHole` ({w, h}: the cut-out to make in the panel it is mounted on so the case
 * passes through while the bezel rests on the panel face).
 */
export function finish(object, width, height, update, extra = {}) {
  setLayerRecursive(object, LAYERS.CABIN);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const tmp = new THREE.Box3();
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    box.union(tmp);
  });
  const depth = Math.max(0, -box.min.z);
  const frame = extra.frame ?? 0.006;
  const upd = typeof update === 'function'
    ? (vessel, game, dt) => {
      syncLampExposure(game);
      return update(vessel, game, dt);
    }
    : update;
  return { object, width, height, update: upd, depth, mountHole: { w: width - frame, h: height - frame }, ...extra };
}

// ------------------------------------------------------------------------------ 7-segment glyphs
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', ' ': '', '': '', E: 'afged', r: 'eg', o: 'cdeg', F: 'afge', P: 'abfge', H: 'bcefg', L: 'fed', A: 'abcefg', C: 'afed',
};

/**
 * Draw one 7-segment character (or '+' sign) into a 2D context.
 * @param {CanvasRenderingContext2D} g
 * @param {string} ch   '0'-'9', '+', '-', ' ' or a few letters
 * @param {number} x    left (px)
 * @param {number} y    top (px)
 * @param {number} w    glyph width (px)
 * @param {number} h    glyph height (px)
 * @param {object} o    { t (segment thickness px), gap (px), slant (rad), on (fill style), off (style or null) }
 */
export function drawSegChar(g, ch, x, y, w, h, o = {}) {
  const t = o.t ?? w * 0.17;
  const gap = o.gap ?? t * 0.18;
  const slant = o.slant ?? 0;
  const litSet = ch === '+' ? '' : SEG[ch] ?? '';
  const xl = t / 2;
  const xr = w - t / 2;
  const yt = t / 2;
  const ym = h / 2;
  const yb = h - t / 2;
  const hs = (x1, x2, yy) => [[x1 + gap, yy], [x1 + gap + t / 2, yy - t / 2], [x2 - gap - t / 2, yy - t / 2], [x2 - gap, yy], [x2 - gap - t / 2, yy + t / 2], [x1 + gap + t / 2, yy + t / 2]];
  const vs = (xx, y1, y2) => [[xx, y1 + gap], [xx + t / 2, y1 + gap + t / 2], [xx + t / 2, y2 - gap - t / 2], [xx, y2 - gap], [xx - t / 2, y2 - gap - t / 2], [xx - t / 2, y1 + gap + t / 2]];
  const segs = {
    a: hs(xl, xr, yt), g: hs(xl, xr, ym), d: hs(xl, xr, yb),
    f: vs(xl, yt, ym), b: vs(xr, yt, ym), e: vs(xl, ym, yb), c: vs(xr, ym, yb),
  };
  const poly = (pts) => {
    g.beginPath();
    pts.forEach(([px, py], i) => {
      const sx = x + px + (h - py) * Math.tan(slant);
      const sy = y + py;
      if (i) g.lineTo(sx, sy);
      else g.moveTo(sx, sy);
    });
    g.closePath();
    g.fill();
  };
  // '+' : horizontal bar plus a vertical bar through the middle (DSKY sign)
  const plusH = hs(w * 0.06, w * 0.94, ym);
  const plusV = vs(w / 2, ym - h * 0.36, ym + h * 0.36);
  if (o.off) {
    g.fillStyle = o.off;
    if (o.sign) {
      poly(plusH);
      poly(plusV);
    } else for (const k of 'abcdefg') poly(segs[k]);
  }
  if (o.on && ch !== ' ') {
    g.fillStyle = o.on;
    if (ch === '+') {
      poly(plusH);
      poly(plusV);
    } else if (ch === '-' && o.sign) poly(plusH);
    else for (const k of litSet) poly(segs[k]);
  }
}

/** Draw a colon (two dots) for clocks. */
export function drawColon(g, x, y, h, r, style, slant = 0) {
  g.fillStyle = style;
  for (const f of [0.3, 0.7]) {
    const yy = y + h * f;
    g.beginPath();
    g.arc(x + (h - h * f) * Math.tan(slant), yy, r, 0, Math.PI * 2);
    g.fill();
  }
}

// ------------------------------------------------------------------------------ emissive display
/**
 * Self-luminous display plane (DSKY EL panel, timers, lamp matrices).
 * Two canvases of the same size: `base` (static unlit look, used as albedo map) and `glow`
 * (redrawn when content changes, used as emissive map). Emissive intensity follows the global
 * lamp brightness (kit LIGHTING.lamps).
 * @param {number} wM
 * @param {number} hM
 * @param {object} [o] { pxPerM=5000, intensity (kit LAMP_INTENSITY default), roughness=0.55 }
 * @returns {{mesh, material, base, glow, redraw(fn)}}
 */
export function createDisplay(wM, hM, o = {}) {
  const base = createCanvasTexture(wM, hM, o.pxPerM || 5000);
  const glow = createCanvasTexture(wM, hM, o.pxPerM || 5000);
  const material = new THREE.MeshStandardMaterial({
    map: base.texture,
    emissiveMap: glow.texture,
    emissive: new THREE.Color(1, 1, 1),
    roughness: o.roughness ?? 0.55,
    metalness: 0,
  });
  registerLamp(material, o.intensity);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), material);
  mesh.receiveShadow = true;
  return {
    mesh,
    material,
    base,
    glow,
    /** Clear the glow canvas to black, call fn(g, W, H), upload. */
    redraw(fn) {
      const g = glow.g;
      g.save();
      g.fillStyle = '#000';
      g.fillRect(0, 0, glow.canvas.width, glow.canvas.height);
      fn(g, glow.canvas.width, glow.canvas.height);
      g.restore();
      glow.texture.needsUpdate = true;
    },
    setBrightness(k) {
      setLampLevel(material, k);
    },
  };
}

// ------------------------------------------------------------------------------ bezel & face
/**
 * Instrument case: grey bezel frame around a black face plate with printed markings and
 * cut-outs, optional glass. Returns { group, face (panel group), bezel }.
 * o: { width, height, frame=0.006 (bezel border width), faceColor, bezelColor, faceSpec (extra
 *   createPanel spec for the face: labels/lines/boxes/draw), holes (face cut-outs), glass=true,
 *   screws=true, depth=0.03 (case depth behind the face) }
 */
export function createCase(o) {
  const { width, height } = o;
  const fr = o.frame ?? 0.006;
  const group = new THREE.Group();
  const bezel = createPanel({
    width,
    height,
    depth: 0.004,
    color: o.bezelColor ?? COLORS.panelGray,
    holes: [{ x: 0, y: 0, w: width - 2 * fr, h: height - 2 * fr, corner: o.corner ?? 0.004 }],
    screws: o.screws === false ? [] : [
      { x: -width / 2 + fr / 2, y: height / 2 - fr / 2, kind: 'phillips', r: Math.min(0.0019, fr * 0.3) },
      { x: width / 2 - fr / 2, y: height / 2 - fr / 2, kind: 'phillips', r: Math.min(0.0019, fr * 0.3) },
      { x: -width / 2 + fr / 2, y: -height / 2 + fr / 2, kind: 'phillips', r: Math.min(0.0019, fr * 0.3) },
      { x: width / 2 - fr / 2, y: -height / 2 + fr / 2, kind: 'phillips', r: Math.min(0.0019, fr * 0.3) },
    ],
    wear: 0.35,
    pxPerM: 2400,
    cornerRadius: 0.003,
    name: 'bezel',
    ...(o.bezelSpec || {}),
  });
  bezel.position.z = 0.004;
  group.add(bezel);
  const fw = width - 2 * fr + 0.002;
  const fh = height - 2 * fr + 0.002;
  const face = createPanel({
    width: fw,
    height: fh,
    depth: 0.003,
    color: o.faceColor ?? 0x151617,
    roughness: 0.7,
    holes: o.holes || [],
    wear: 0.12,
    bevel: 0.0004,
    cornerRadius: 0.002,
    pxPerM: o.pxPerM || 4000,
    screws: [],
    name: 'face',
    ...(o.faceSpec || {}),
  });
  group.add(face);
  // dark case interior behind the face (visible through cut-outs at an angle)
  const depth = o.depth ?? 0.03;
  const box = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, depth).translate(0, 0, -depth / 2 - 0.003), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, side: THREE.BackSide }));
  box.receiveShadow = true;
  group.add(box);
  if (o.glass !== false) {
    const gl = createGlass(width - 2 * fr, height - 2 * fr, 0.0025);
    group.add(gl);
  }
  return { group, face, bezel, faceWidth: fw, faceHeight: fh };
}

// ------------------------------------------------------------------------------ pointers
/** Flat needle / pointer mesh (Shape extruded 0.4 mm) in a given colour. */
export function needleMesh(shape, color = 0xdad9d0, emissive = 0.0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0004, bevelEnabled: false });
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.0 });
  // pointers are lit by the instrument integral lighting (dim) like the face markings
  m.userData.integralScale = 0.25 + emissive;
  m.userData.keepEmissive = true;
  m.emissive.set(color);
  registerIntegral(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

/** Triangle pointer shape pointing toward -Y (tip at origin), size = base width. */
export function trianglePointer(size, len = size * 1.1) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(size / 2, len);
  s.lineTo(-size / 2, len);
  s.closePath();
  return s;
}

/** Thin bar needle from (0,0) along +Y of length len, width w (tapered tip). */
export function barNeedle(len, w, tip = 0.35) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, len * (1 - tip * 0.1));
  s.lineTo(0, len);
  s.lineTo(-w / 2, len * (1 - tip * 0.1));
  s.closePath();
  return s;
}

/** Smoothly approach target (meter movement lag). */
export function approach(cur, target, dt, rate = 10) {
  if (!Number.isFinite(target)) return cur;
  if (!Number.isFinite(cur)) return target;
  return cur + (target - cur) * Math.min(1, dt * rate);
}

export { THREE, drawText, getMaterial, createGlass, LAMP_COLORS, createCanvasTexture, createPanel, COLORS };
