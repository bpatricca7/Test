// A tiny software renderer for avatar looks in Node (no browser, no WebGL): it runs the real
// avatar part builders (body, outfit, hair, accessories) on a small stand-in for avatar.js's
// BuildContext and draws the merged geometry with a z-buffer into a PNG. Cloth is drawn in its
// plain color (no pattern texture), the painted eye and mouth planes are left out (two dots
// stand in for the eyes). Used by `node tools/test-holiday-looks.mjs --shots=<dir>`
// (docs/teams/holiday-looks.md "How to test"); it never runs in the game.

import * as THREE from 'three';
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { GeoBuilder, Flare } from '../../src/player/avatar/geo.js';
import { REST, PARENT, BONES } from '../../src/player/avatar/rig.js';
import { buildBody, buildOutfit } from '../../src/player/avatar/outfit.js';
import { buildHair } from '../../src/player/avatar/hair.js';
import { buildAccessories } from '../../src/player/avatar/accessories.js';
import { normalizeLook } from '../../src/player/wardrobe-data.js';

// ---------- a stand-in BuildContext (same methods the builders call) ----------

class Ctx {
  constructor(look) {
    this.look = look;
    this.skin = look.skin;
    this.tieColor = look.acc.head !== 'none' ? look.acc.headColor : '#FF5FA2';
    this.builders = new Map();
    this.specs = new Map();
    this.flares = [];
    this.stride = 1;
    this.lift = 0;
    this.handPose = null;
    this.skirtStiff = false;
    this.backZ = -0.12;
    this.dyn = { chains: [], swings: [], wings: [], halo: null, balloon: null, upright: null, wandTip: null };
    this.bones = {};
    const body = new THREE.Group();
    body.userData.origin = [0, 0, 0];
    this.bones.body = body;
    for (const name of BONES) {
      const g = new THREE.Group();
      g.userData.origin = REST[name];
      this.bones[PARENT[name]].add(g);
      this.bones[name] = g;
    }
  }

  boneOf(b) { return typeof b === 'string' ? this.bones[b] : b; }

  B(bone, mat, opts = {}) {
    const g = this.boneOf(bone);
    if (!g) throw new Error(`no bone ${bone}`);
    const uv = opts.uv || (mat === 'hair' ? 'hair' : 'world');
    const key = `${g.uuid}|${mat}|${uv}`;
    let e = this.builders.get(key);
    if (!e) {
      e = { bone: g, mat, builder: new GeoBuilder(g.userData.origin, { uv }) };
      this.builders.set(key, e);
    }
    return e.builder;
  }

  cloth(spec, double = false) {
    const key = (double ? 'cloth2:' : 'cloth:') + JSON.stringify(spec);
    this.specs.set(key, spec);
    return key;
  }

  clothSpec(key) { return this.specs.get(key); }

  linColor(hex) { return new THREE.Color(hex); }

  bone(name, parent, pivot) {
    const g = new THREE.Group();
    g.name = name;
    g.userData.origin = pivot.slice();
    this.boneOf(parent).add(g);
    this.bones[name] = g;
    return g;
  }

  chain(name, parent, points) {
    const names = [];
    let par = parent;
    for (let i = 0; i < points.length - 1; i++) {
      const n = name + i;
      this.bone(n, par, points[i]);
      names.push(n);
      par = n;
    }
    return names;
  }

  addSwing() {}

  flare(bone, mat, rings, opts = {}) {
    const g = this.boneOf(bone);
    const f = new Flare(rings, { ...opts, origin: g.userData.origin });
    this.flares.push({ bone: g, mat, flare: f });
    return f;
  }
}

/** Every triangle of a look at rest: [{ p: [9 floats], n: [3], c: [r, g, b] (linear) }]. */
export function lookTriangles(lookIn) {
  const look = normalizeLook(lookIn);
  const P = new Ctx(look);
  buildBody(P);
  buildOutfit(P);
  buildHair(P);
  buildAccessories(P);
  const tris = [];
  const add = (geo, origin, mat, specs) => {
    if (!geo) return;
    if (mat === 'eyes' || mat === 'mouth' || mat.startsWith('glasses:') || mat.startsWith('wing:')) return;
    let tint = null;
    if (mat.startsWith('cloth')) tint = new THREE.Color(specs.get(mat).color);
    const pos = geo.getAttribute('position').array, nrm = geo.getAttribute('normal').array, col = geo.getAttribute('color').array;
    for (let i = 0; i + 8 < pos.length; i += 9) {
      const p = [];
      for (let k = 0; k < 9; k++) p.push(pos[i + k] + origin[k % 3]);
      let c = [col[i], col[i + 1], col[i + 2]];
      if (tint) c = [c[0] * tint.r, c[1] * tint.g, c[2] * tint.b];
      tris.push({ p, n: [nrm[i], nrm[i + 1], nrm[i + 2]], c });
    }
  };
  for (const e of P.builders.values()) add(e.builder.build(), e.bone.userData.origin, e.mat, P.specs);
  for (const f of P.flares) add(f.flare.geometry, f.bone.userData.origin, f.mat, P.specs);
  // two eye dots (the painted eyes are a texture)
  const s = 0.045;
  for (const x of [-0.12, 0.12]) {
    const z = 0.28, y = 1.33;
    const quad = [[x - s, y - s * 1.3, z], [x + s, y - s * 1.3, z], [x + s, y + s * 1.3, z], [x - s, y + s * 1.3, z]];
    const c = new THREE.Color('#3B2230');
    for (const [a, b, d] of [[0, 1, 2], [0, 2, 3]]) tris.push({ p: [...quad[a], ...quad[b], ...quad[d]], n: [0, 0, 1], c: [c.r, c.g, c.b] });
  }
  return { tris, handPose: P.handPose };
}

// ---------- the rasterizer ----------

const toSrgb = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));

/** Draw tris into an RGBA image region (yaw: turn the avatar this much about Y first). */
function draw(img, W, x0, y0, w, h, tris, yaw, scale, cy) {
  const zb = new Float32Array(w * h).fill(-Infinity);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const L = new THREE.Vector3(-0.45, 0.75, 0.6).normalize();
  for (const t of tris) {
    const sx = [], sy = [], sz = [];
    for (let k = 0; k < 3; k++) {
      const x = t.p[k * 3], y = t.p[k * 3 + 1], z = t.p[k * 3 + 2];
      const rx = x * cs + z * sn, rz = -x * sn + z * cs;
      sx.push(w / 2 + rx * scale);
      sy.push(h / 2 - (y - cy) * scale);
      sz.push(rz);
    }
    const nx = t.n[0] * cs + t.n[2] * sn, nz = -t.n[0] * sn + t.n[2] * cs, ny = t.n[1];
    const lam = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
    const k = 0.5 + 0.6 * lam;
    const r = toSrgb(t.c[0] * k), g = toSrgb(t.c[1] * k), b = toSrgb(t.c[2] * k);
    const minX = Math.max(0, Math.floor(Math.min(...sx))), maxX = Math.min(w - 1, Math.ceil(Math.max(...sx)));
    const minY = Math.max(0, Math.floor(Math.min(...sy))), maxY = Math.min(h - 1, Math.ceil(Math.max(...sy)));
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        const w0 = ((sx[1] - qx) * (sy[2] - qy) - (sx[2] - qx) * (sy[1] - qy)) / area;
        const w1 = ((sx[2] - qx) * (sy[0] - qy) - (sx[0] - qx) * (sy[2] - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2];
        const i = py * w + px;
        if (z <= zb[i]) continue;
        zb[i] = z;
        const o = ((y0 + py) * W + x0 + px) * 4;
        img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255;
      }
    }
  }
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Write a PNG: one row per look, one column per view (yaw angles). frame: 'full' (the whole
 * avatar) or 'head' (a close-up of the head).
 */
export function renderLooks(file, looks, { yaws = [0, Math.PI * 0.25, Math.PI * 0.5, Math.PI], frame = 'full', cell = 220 } = {}) {
  const cw = cell, ch = Math.round(cell * (frame === 'head' ? 1 : 1.35));
  const W = cw * yaws.length, H = ch * looks.length;
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const alt = (Math.floor(x / cw) + Math.floor(y / ch)) % 2;
      img[o] = alt ? 246 : 255; img[o + 1] = alt ? 236 : 243; img[o + 2] = 255; img[o + 3] = 255;
    }
  }
  const scale = frame === 'head' ? cw / 1.1 : ch / 2.35;
  const cy = frame === 'head' ? 1.45 : 1.02;
  looks.forEach((look, row) => {
    const { tris } = lookTriangles(look);
    yaws.forEach((yaw, col) => draw(img, W, col * cw, row * ch, cw, ch, tris, yaw, scale, cy));
  });
  writeFileSync(file, png(W, H, img));
  return file;
}

/** Write a PNG grid: `cols` looks per row, each drawn once at `yaw`. */
export function renderGrid(file, looks, { cols = 4, yaw = 0.5, frame = 'head', cell = 200 } = {}) {
  const cw = cell, ch = Math.round(cell * (frame === 'head' ? 1 : 1.35));
  const rows = Math.ceil(looks.length / cols);
  const W = cw * cols, H = ch * rows;
  const img = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const alt = (Math.floor(x / cw) + Math.floor(y / ch)) % 2;
      img[o] = alt ? 246 : 255; img[o + 1] = alt ? 236 : 243; img[o + 2] = 255; img[o + 3] = 255;
    }
  }
  const scale = frame === 'head' ? cw / 1.1 : ch / 2.35;
  const cy = frame === 'head' ? 1.45 : 1.02;
  looks.forEach((look, i) => {
    const { tris } = lookTriangles(look);
    draw(img, W, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch, tris, yaw, scale, cy);
  });
  writeFileSync(file, png(W, H, img));
  return file;
}

/** Every triangle of a three.js object (vertex colors, else the material color; glow kept bright). */
export function objectTriangles(root) {
  const tris = [];
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.userData.hitbox) return;
    const g = o.geometry, pos = g.getAttribute('position'), nor = g.getAttribute('normal'), col = g.getAttribute('color');
    const look = g.getAttribute('fLook');
    const mc = o.material && o.material.color ? o.material.color : new THREE.Color(1, 1, 1);
    nm.getNormalMatrix(o.matrixWorld);
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const p = [], ids = [0, 1, 2].map((k) => (idx ? idx[i + k] : i + k));
      for (const id of ids) { v.fromBufferAttribute(pos, id).applyMatrix4(o.matrixWorld); p.push(v.x, v.y, v.z); }
      const nn = nor ? new THREE.Vector3().fromBufferAttribute(nor, ids[0]).applyMatrix3(nm).normalize() : new THREE.Vector3(0, 1, 0);
      let c = col ? [col.getX(ids[0]), col.getY(ids[0]), col.getZ(ids[0])] : [mc.r, mc.g, mc.b];
      const glowAmt = look ? look.getY(ids[0]) : (o.material && o.material.emissiveIntensity && o.material.emissive && o.material.emissive.getHex() ? o.material.emissiveIntensity : 0);
      if (glowAmt > 0) c = c.map((x) => x * (1 + glowAmt));
      tris.push({ p, n: [nn.x, nn.y, nn.z], c });
    }
  });
  return tris;
}

/** Write a PNG of a three.js object from a few yaws (center: [x, y, z]; span: world units shown). */
export function renderObject(file, root, { yaws = [0, 0.6, Math.PI / 2, Math.PI], center = [0, 1, 0], span = 3.2, cell = 260 } = {}) {
  const tris = objectTriangles(root).map((t) => ({ ...t, p: t.p.map((x, i) => (i % 3 === 1 ? x : x - center[i % 3])) }));
  const W = cell * yaws.length, H = cell;
  const img = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { img[i * 4] = 236; img[i * 4 + 1] = 244; img[i * 4 + 2] = 255; img[i * 4 + 3] = 255; }
  yaws.forEach((yaw, col) => draw(img, W, col * cell, 0, cell, cell, tris, yaw, cell / span, center[1]));
  writeFileSync(file, png(W, H, img));
  return file;
}
