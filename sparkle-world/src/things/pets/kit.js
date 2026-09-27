// Shared kit for the "life" modules (pets, garden, cooking):
//  - Kit: collects colored boxes / cylinders / balls and bakes them into ONE BufferGeometry
//    with vertex colors (one draw call per part, shared across every pet / plant / food of
//    the same kind), lit by the scene's hemi + sun lights like furniture.
//  - the basket (profile.basket food counts) API with a 'basket:change' event
//  - little inline SVG icons for our panels and a tiny "life HUD" button column.

import * as THREE from 'three';

// ---------- geometry baking ----------

const templates = new Map();
function template(kind, seg = 12, ratio = 1) {
  const key = `${kind}|${seg}|${ratio}`;
  let g = templates.get(key);
  if (!g) {
    if (kind === 'box') g = new THREE.BoxGeometry(1, 1, 1);
    else if (kind === 'cyl') g = new THREE.CylinderGeometry(ratio, 1, 1, seg);
    else g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.75)));
    templates.set(key, g);
  }
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n3 = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Collects primitives, then bakes them. Coordinates are block units.
 *   box(w,h,d,color,x,y,z,rot?)      min corner at (x,y,z); rot [rx,ry,rz] about its centre
 *   cbox(w,h,d,color,cx,cy,cz,rot?)  centred at (cx,cy,cz)
 *   cyl(r,h,color,x,y,z,seg,rot?,topRatio?)  base centre at (x,y,z) (rot about the centre)
 *   ball(r,color,x,y,z,seg?,scale?)  centred
 */
export class Kit {
  constructor() {
    this.parts = [];
  }

  cbox(w, h, d, color, cx = 0, cy = 0, cz = 0, rot = null) {
    this.parts.push({ g: template('box'), color, cx, cy, cz, sx: w, sy: h, sz: d, rot });
    return this;
  }

  box(w, h, d, color, x = 0, y = 0, z = 0, rot = null) {
    return this.cbox(w, h, d, color, x + w / 2, y + h / 2, z + d / 2, rot);
  }

  cyl(r, h, color, x = 0, y = 0, z = 0, seg = 12, rot = null, topRatio = 1) {
    this.parts.push({ g: template('cyl', seg, topRatio), color, cx: x, cy: y + h / 2, cz: z, sx: r, sy: h, sz: r, rot });
    return this;
  }

  ball(r, color, x = 0, y = 0, z = 0, seg = 12, scale = null) {
    const s = scale || [1, 1, 1];
    this.parts.push({ g: template('ball', seg), color, cx: x, cy: y, cz: z, sx: r * s[0], sy: r * s[1], sz: r * s[2], rot: null });
    return this;
  }

  /** Bake into an indexed BufferGeometry with position, normal and color (linear). */
  geometry({ top = 0.05, bottom = -0.16 } = {}) {
    let nv = 0, ni = 0;
    for (const p of this.parts) {
      nv += p.g.attributes.position.count;
      ni += p.g.index ? p.g.index.count : p.g.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const p of this.parts) {
      _p.set(p.cx, p.cy, p.cz);
      _s.set(p.sx, p.sy, p.sz);
      if (p.rot) _q.setFromEuler(_e.set(p.rot[0] || 0, p.rot[1] || 0, p.rot[2] || 0));
      else _q.identity();
      _m.compose(_p, _q, _s);
      _n3.getNormalMatrix(_m);
      _c.set(p.color);
      const P = p.g.attributes.position, N = p.g.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        _v.fromBufferAttribute(P, i).applyMatrix4(_m);
        pos[(vo + i) * 3] = _v.x; pos[(vo + i) * 3 + 1] = _v.y; pos[(vo + i) * 3 + 2] = _v.z;
        _v.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize();
        nrm[(vo + i) * 3] = _v.x; nrm[(vo + i) * 3 + 1] = _v.y; nrm[(vo + i) * 3 + 2] = _v.z;
        // a touch of toy shading: tops a bit brighter, undersides softer
        const k = _v.y > 0.5 ? 1 + top : _v.y < -0.5 ? 1 + bottom : 1;
        col[(vo + i) * 3] = Math.min(1, _c.r * k); col[(vo + i) * 3 + 1] = Math.min(1, _c.g * k); col[(vo + i) * 3 + 2] = Math.min(1, _c.b * k);
      }
      if (p.g.index) {
        const I = p.g.index;
        for (let i = 0; i < I.count; i++) idx[io + i] = I.getX(i) + vo;
        io += I.count;
      } else {
        for (let i = 0; i < P.count; i++) idx[io + i] = vo + i;
        io += P.count;
      }
      vo += P.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  mesh(material = VC_MAT) {
    return new THREE.Mesh(this.geometry(), material);
  }
}

/** Shared vertex-colored Lambert material (never disposed). */
export const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
VC_MAT.userData.shared = true;

const geoCache = new Map();
/** Geometry baked once per key (shared: disposeObject leaves it alone). */
export function baked(key, build) {
  let g = geoCache.get(key);
  if (!g) {
    const kit = new Kit();
    const opts = build(kit) || undefined;
    g = kit.geometry(opts);
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

/** Mesh from a cached baked geometry. */
export function bakedMesh(key, build, material = VC_MAT) {
  return new THREE.Mesh(baked(key, build), material);
}

/** A shared Lambert material with glow (horns, magic) - cached per color. */
const glowCache = new Map();
export function glowMat(color, intensity = 0.7) {
  const key = color + '|' + intensity;
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity });
    m.userData.shared = true;
    glowCache.set(key, m);
  }
  return m;
}

// ---------- soft blob shadow ----------

let shadowGeo = null, shadowMat = null;
export function blobShadow(size = 0.6) {
  if (!shadowGeo) {
    shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    shadowGeo.userData.shared = true;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(58,31,77,0.55)');
    grad.addColorStop(0.55, 'rgba(58,31,77,0.28)');
    grad.addColorStop(1, 'rgba(58,31,77,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.shared = true;
    shadowMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    shadowMat.userData.shared = true;
  }
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.scale.set(size, 1, size);
  m.renderOrder = 1;
  return m;
}

// ---------- rounded "sticker" label on a canvas (name tags) ----------

export const FONT = "'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function heartPath(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.38);
  g.bezierCurveTo(cx - s * 0.62, cy - s * 0.02, cx - s * 0.3, cy - s * 0.52, cx, cy - s * 0.2);
  g.bezierCurveTo(cx + s * 0.3, cy - s * 0.52, cx + s * 0.62, cy - s * 0.02, cx, cy + s * 0.38);
  g.closePath();
}

/** Sprite with a white pill, colored border, little heart and the text. Returns the sprite. */
export function nameTagSprite(text, accent = '#FF5FA2') {
  const H = 72, font = `700 40px ${FONT}`;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = font;
  const tw = Math.ceil(g.measureText(text).width);
  const W = Math.min(512, tw + 96);
  c.width = W;
  c.height = H;
  g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  roundRect(g, 5, 7, W - 10, H - 14, (H - 14) / 2);
  g.fillStyle = 'rgba(255,255,255,0.94)';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = accent;
  g.stroke();
  heartPath(g, 34, H / 2 + 1, 26);
  g.fillStyle = accent;
  g.fill();
  g.font = font;
  g.textBaseline = 'middle';
  g.fillStyle = '#3A1F4D';
  g.fillText(text, 56, H / 2 + 2, W - 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(mat);
  const h = 0.3;
  s.scale.set((h * W) / H, h, 1);
  s.renderOrder = 6;
  return s;
}

export function disposeSprite(s) {
  if (!s) return;
  if (s.parent) s.parent.remove(s);
  if (s.material.map) s.material.map.dispose();
  s.material.dispose();
}

// ---------- icons (24x24, currentColor) ----------

const EO = 'fill-rule="evenodd" clip-rule="evenodd"';
const PATHS = {
  paw: `<ellipse cx="12" cy="16.2" rx="5.4" ry="4.4"/><ellipse cx="5.2" cy="10.6" rx="2.2" ry="2.8" transform="rotate(-18 5.2 10.6)"/><ellipse cx="18.8" cy="10.6" rx="2.2" ry="2.8" transform="rotate(18 18.8 10.6)"/><ellipse cx="9" cy="6.2" rx="2.2" ry="2.9"/><ellipse cx="15" cy="6.2" rx="2.2" ry="2.9"/>`,
  basket: `<path ${EO} d="M3 9.6h18l-2 10a2 2 0 0 1-2 1.6H7a2 2 0 0 1-2-1.6Z M8 12.2h1.8v6.4H8Z M11.1 12.2h1.8v6.4h-1.8Z M14.2 12.2H16v6.4h-1.8Z"/><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M7 9.4 10 3.8M17 9.4 14 3.8"/>`,
  bowl: `<path d="M2.6 10.4h18.8a9.4 8.6 0 0 1-18.8 0Z"/><path opacity=".7" d="M5 8.6c1.6-2.8 4.2-4 7-4s5.4 1.2 7 4Z"/>`,
  spoon: `<ellipse cx="15.8" cy="7.2" rx="4" ry="5" transform="rotate(40 15.8 7.2)"/><path d="m12.6 10.4 1.8 1.8-9 9a1.3 1.3 0 0 1-1.8-1.8Z"/>`,
  oven: `<path ${EO} d="M4.4 3h15.2A1.8 1.8 0 0 1 21.4 4.8v14.4a1.8 1.8 0 0 1-1.8 1.8H4.4a1.8 1.8 0 0 1-1.8-1.8V4.8A1.8 1.8 0 0 1 4.4 3Z M5.6 9.6v8.4h12.8V9.6Z M6.6 5.2h2v2h-2Z M10 5.2h2v2h-2Z"/><path opacity=".6" d="M7.6 12.4h8.8v3.6H7.6Z"/>`,
  pot: `<path d="M4 9.2h16v7.6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M2 8h20v2.2H2Z M10 4.2h4v2.8h-4Z"/><path opacity=".6" d="M1 11.4h2.6v2.6H1Z M20.4 11.4H23v2.6h-2.6Z"/>`,
  fridge: `<path ${EO} d="M6.4 2h11.2A1.8 1.8 0 0 1 19.4 3.8v16.4a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V3.8A1.8 1.8 0 0 1 6.4 2Z M6.6 9.2v.9h10.8v-.9Z M7.4 4.4h1.6v3.2H7.4Z M7.4 11.8h1.6v4.6H7.4Z"/>`,
  blender: `<path d="M6.4 2.6h11.2l-1.8 11.6H8.2Z"/><path d="M7.2 15.6h9.6l1.2 5.8H6Z"/><path opacity=".55" d="M17.8 5h2.6v5.6h-3.4Z"/>`,
  bell: `<path d="M12 2.4a1.6 1.6 0 0 1 1.6 1.6v.5a6.2 6.2 0 0 1 4.6 6v4.4l2 2.6v1.3H3.8v-1.3l2-2.6v-4.4a6.2 6.2 0 0 1 4.6-6V4A1.6 1.6 0 0 1 12 2.4Z"/><path d="M9.4 20h5.2a2.6 2.6 0 0 1-5.2 0Z"/>`,
  seed: `<path d="M12 21.4c-4.6 0-7-3.4-7-7.6C5 8.8 9 4.6 12 2.6c3 2 7 6.2 7 11.2 0 4.2-2.4 7.6-7 7.6Z"/><path fill="#fff" opacity=".45" d="M10.4 7.8c-1.8 1.8-2.8 4-2.6 6.2.1.9-1.3 1-1.4.1-.3-2.8 1-5.4 3-7.3.6-.6 1.6.3 1 1Z"/>`,
  water: `<path d="M3.6 9.2h10.8v8.6a3 3 0 0 1-3 3H6.6a3 3 0 0 1-3-3Z"/><path d="m14 11 6.6-4.4 1 1.4-6.6 5.4Z"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M5.2 9.2c0-3.6 1.8-5.4 3.8-5.4s3.8 1.8 3.8 5.4"/><circle cx="20.8" cy="3.2" r="1.2"/><circle cx="22.4" cy="6" r=".9"/>`,
  ride: `<path ${EO} d="M6.4 21.6v-7.4c0-4.6 1.8-8.2 4.8-10l-.4-2.6 2.6 1.4 2.2-1.6.6 2.8c2.6 1.4 4.8 4.2 5.4 7.6.3 1.8-1 3-2.6 2.4l-3-1.2c-.9 2.6-1 5.6-.4 8.6Z M15.2 7.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"/><path opacity=".55" d="M8 8.6c-1.8-1.2-3.8-1-4.8.4 1.8.2 2.8 1.4 3.2 3Z"/>`,
  hopoff: `<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M4.5 13C5 7.5 9.2 4.2 13.4 5.4c3.2.9 4.8 4.4 4.6 8.6"/><path d="m13.8 12.4 4.4 5.6 4.2-5.8Z"/><rect x="2.5" y="19.4" width="19" height="2.8" rx="1.4"/>`,
  sit: `<path d="M12 3.4a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z"/><path d="M7 20.6v-5.2c0-2.8 2.2-4.4 5-4.4s5 1.6 5 4.4v5.2Z"/><path opacity=".6" d="M4 20h16v2H4Z"/>`,
  leaf: `<path d="M20.4 3.6C11 3.2 4.4 7.6 4.4 14.4c0 1.6.4 3 1 4.2L3.6 20.4l1.4 1.2 1.8-1.8c1.2.8 2.8 1.2 4.4 1.2 6.8 0 10.6-7 9.2-17.4Z"/>`,
  cake: `<path d="M3.4 13.6h17.2v7.4H3.4Z"/><path opacity=".75" d="M5.2 9.6h13.6v4H5.2Z"/><path d="M11.2 4.4h1.6v5.2h-1.6Z"/><path d="M12 1.2c1 1.2 1.4 2 .9 2.8-.5.7-1.4.7-1.9 0-.4-.8 0-1.6 1-2.8Z"/>`,
  dice: `<path ${EO} d="M5.4 2.8h13.2a2.6 2.6 0 0 1 2.6 2.6v13.2a2.6 2.6 0 0 1-2.6 2.6H5.4a2.6 2.6 0 0 1-2.6-2.6V5.4a2.6 2.6 0 0 1 2.6-2.6Z M8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M16 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M8 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M16 14.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z"/>`,
  eat: `<path d="M12 21.2S3.2 15.6 3.2 9.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.8 2.8c0 6.2-8.8 11.8-8.8 11.8Z"/><path fill="#fff" opacity=".5" d="M7.4 9.2a2 2 0 0 1 2-2c.6 0 .6.9 0 1a1.2 1.2 0 0 0-1 1c-.1.6-1 .6-1 0Z"/>`,
  table: `<path d="M2.4 6.6h19.2v3.2H2.4Z"/><path d="M4.4 9.8h2.4v10.6H4.4Z M17.2 9.8h2.4v10.6h-2.4Z"/><path opacity=".6" d="M9 2.4h6v4H9Z"/>`,
  home: `<path d="M3 11.2 12 3.4l9 7.8v8.6a1.6 1.6 0 0 1-1.6 1.6h-4.6v-6.2H9.2v6.2H4.6A1.6 1.6 0 0 1 3 19.8Z"/>`,
  wave: `<path d="M7.2 11.4V5.2a1.6 1.6 0 0 1 3.2 0v5h.8V3.6a1.6 1.6 0 0 1 3.2 0v6.6h.8V5a1.6 1.6 0 0 1 3.2 0v8.8c0 4.2-2.8 7.6-6.8 7.6-2.6 0-4.2-1-5.6-3L2.6 13a1.6 1.6 0 0 1 2.4-2.1Z"/>`,
  book: `<path d="M3 4.6c2.8-1.2 5.8-1.2 8.2.6v15.6c-2.4-1.6-5.4-1.6-8.2-.4Z M12.8 5.2c2.4-1.8 5.4-1.8 8.2-.6v15.8c-2.8-1.2-5.8-1.2-8.2.4Z"/>`,
  sparkle: `<path d="M12 1.8c.6 4.8 2.6 7.4 8 8.2-5.4.8-7.4 3.4-8 8.2-.6-4.8-2.6-7.4-8-8.2 5.4-.8 7.4-3.4 8-8.2Z"/><path opacity=".7" d="M19 15.2c.3 2.2 1.2 3.2 3.2 3.5-2 .3-2.9 1.3-3.2 3.5-.3-2.2-1.2-3.2-3.2-3.5 2-.3 2.9-1.3 3.2-3.5Z"/>`,
};

export function lifeIcon(name) {
  const body = PATHS[name] || PATHS.sparkle;
  return `<svg class="sw-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** ui.button with one of our own icons (falls back to the core icon set when unknown here). */
export function lifeButton(ui, { icon, label, onClick, variant = 'pink', size = null, title = null, className = '' }) {
  const own = icon && PATHS[icon];
  const b = ui.button({ icon: own ? null : icon, label, onClick, variant, size, title, className });
  if (own) b.insertAdjacentHTML('afterbegin', lifeIcon(icon));
  return b;
}

// ---------- the basket (profile.basket: { foodKey: count }) ----------

export function basketCount(game, key) {
  const b = game.profile && game.profile.basket;
  return (b && b[key]) | 0;
}

export function basketAdd(game, key, n = 1) {
  const b = game.profile.basket || (game.profile.basket = {});
  b[key] = Math.max(0, ((b[key] | 0) + n));
  if (!b[key]) delete b[key];
  game.saveProfile();
  game.events.emit('basket:change', { basket: b, key, delta: n });
  return b[key] | 0;
}

/** Take n of key if there are enough; returns true when taken. */
export function basketTake(game, key, n = 1) {
  if (basketCount(game, key) < n) return false;
  basketAdd(game, key, -n);
  return true;
}

// ---------- a small column of round HUD buttons (Basket, Pets, Hop off) ----------

const HUD_CSS = /* css */ `
/* The column starts under the HUD's top-left pills and ends above the joystick (touch) or the
   bottom row; more buttons than fit (riding + a treat in her hand + pets + friends) go on in a
   second column beside the first, never over the joystick. */
.lf-hud { position: absolute; left: calc(12px + var(--sw-safe-l)); top: calc(72px + var(--sw-safe-t)); bottom: calc(104px + var(--sw-safe-b)); display: none; flex-direction: column; flex-wrap: wrap; align-content: flex-start; gap: 8px 10px; align-items: center; pointer-events: none !important; }
.sw-app.sw-touch-hud .lf-hud { bottom: calc(256px + var(--sw-safe-b)); }
.sw-app.sw-playing .lf-hud { display: flex; }
.lf-hud > * { pointer-events: auto; }
.lf-hud .sw-round[hidden] { display: none; }
.lf-hud .lf-pulse .sw-round-face { animation: lf-pulse 1.4s ease-in-out infinite; }
@keyframes lf-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
@media (max-width: 760px), (max-height: 520px) { .lf-hud { top: calc(62px + var(--sw-safe-t)); gap: 6px; } }
/* portrait tablets: the HUD's name and counts are two rows */
@media (min-width: 481px) and (max-width: 900px) and (min-height: 521px) { .lf-hud { top: calc(124px + var(--sw-safe-t)); } }
@media (min-width: 481px) and (max-width: 760px) and (min-height: 521px) { .lf-hud { top: calc(112px + var(--sw-safe-t)); } }
/* phones sideways: pictures only, above the joystick in the bottom-left corner */
@media (max-height: 520px) and (min-width: 481px) { .lf-hud .sw-round-label { display: none; } .sw-app.sw-touch-hud .lf-hud { bottom: calc(162px + var(--sw-safe-b)); } }
@media (max-width: 480px) { .lf-hud { top: calc(104px + var(--sw-safe-t)); } .lf-hud .sw-round-label { display: none; } .sw-app.sw-touch-hud .lf-hud { bottom: calc(300px + var(--sw-safe-b)); } }
`;

const huds = new WeakMap();

/**
 * The life HUD column (left side, under the world name). add(name, { icon, label, color,
 * onClick, order }) adds a round button; show(name, visible).
 */
export function lifeHud(game) {
  let h = huds.get(game);
  if (h) return h;
  const ui = game.ui;
  ui.addStyles(HUD_CSS);
  const el = ui.el('div', 'lf-hud');
  ui.hudLayer.appendChild(el);
  const buttons = new Map();
  h = {
    el,
    add(name, { icon, label, color = 'var(--sw-pink)', onClick, order = 0 }) {
      const b = ui.el('button', 'sw-round');
      b.type = 'button';
      b.dataset.action = name;
      b.dataset.order = String(order);
      b.setAttribute('aria-label', label);
      const face = ui.el('span', 'sw-round-face');
      face.style.setProperty('--c', color);
      face.innerHTML = lifeIcon(icon);
      b.append(face, ui.el('span', 'sw-round-label', label));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        game.audio.play('click');
        if (onClick) onClick(e);
      });
      b.hidden = true;
      buttons.set(name, b);
      const after = [...el.children].find((c) => Number(c.dataset.order) > order);
      el.insertBefore(b, after || null);
      return b;
    },
    show(name, visible) {
      const b = buttons.get(name);
      if (b) b.hidden = !visible;
    },
    button: (name) => buttons.get(name) || null,
  };
  huds.set(game, h);
  return h;
}

// ---------- misc ----------

/** Project a world point to CSS px inside the game container (null when behind). */
const _proj = new THREE.Vector3();
export function toScreen(game, x, y, z, out = { x: 0, y: 0 }) {
  _proj.set(x, y, z).project(game.camera);
  if (_proj.z > 1) return null;
  out.x = ((_proj.x + 1) / 2) * game.container.clientWidth;
  out.y = ((1 - _proj.y) / 2) * game.container.clientHeight;
  return out;
}

/** Load a data URL into an Image (resolves null on failure). */
export function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
