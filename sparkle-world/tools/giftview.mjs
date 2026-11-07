#!/usr/bin/env node
// Pictures of the Gift Workshop's models without a browser (the gifts team doc, "How to test"):
// builds the real models of src/things/gifts/models.js in Node (a fake canvas paints the paper
// textures) and draws them with a tiny z-buffer rasterizer (Lambert light, vertex colors, the
// paper pixels, glow). Writes PNG sheets to .shots/gifts/:
//   toys.png (the 16 toys), gifts.png (wrapped gifts), papers.png (8 colors x 6 patterns),
//   wrap.png (the wrapping moment, two boxes), opened.png, workshop.png, held.png.
// Usage: node tools/giftview.mjs [--out=dir] [--only=toys,wrap]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const outDir = path.resolve(ROOT, args.out || '.shots/gifts');
const only = args.only ? new Set(String(args.only).split(',')) : null;

// ---------- a tiny fake canvas (paintTexture's painters only use fillStyle / fillRect) ----------
function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 255];
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [128, 128, 128, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}
class FakeImageData { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } }
globalThis.ImageData = globalThis.ImageData || FakeImageData;
function fakeCanvas() {
  const c = { width: 16, height: 16, _ctx: null };
  c.getContext = () => {
    if (c._ctx) return c._ctx;
    const w = c.width, h = c.height, data = new Uint8ClampedArray(w * h * 4);
    let fill = [0, 0, 0, 255];
    const ctx = {
      canvas: c,
      set fillStyle(v) { fill = parseColor(v); },
      get fillStyle() { return '#000000'; },
      fillRect(x, y, ww, hh) {
        for (let yy = Math.max(0, y | 0); yy < Math.min(h, y + hh); yy++) for (let xx = Math.max(0, x | 0); xx < Math.min(w, x + ww); xx++) data.set(fill, (yy * w + xx) * 4);
      },
      getImageData: (x, y, ww, hh) => new ImageData(data.slice(0, ww * hh * 4), ww, hh),
      _data: data,
    };
    c._ctx = new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
    return c._ctx;
  };
  return c;
}
globalThis.document = { createElement: () => fakeCanvas(), head: { appendChild() {} } };

const THREE = await import('three');
const M = await import('../src/things/gifts/models.js');
const D = await import('../src/things/gifts/data.js');
const { layerOf } = await import('../src/things/furniture/atlas.js');

// layer -> the paper's 16 x 16 pixels (every paper the models use)
const layers = new Map();
for (const p of D.PAPERS) for (const pt of D.PATTERNS) {
  const m = M.paperMat(p.key, pt.key);
  const l = layerOf(m.map);
  if (l >= 0) layers.set(l, m.map.image.getContext('2d')._data);
}

// ---------- PNG ----------
function crcTable() { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CRC = crcTable();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- the rasterizer ----------
const toSrgb = (v) => { const c = Math.max(0, Math.min(1, v)); return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; };
const LIGHT = new THREE.Vector3(0.45, 0.85, 0.6).normalize();

/** Draw obj into the sheet cell (cx, cy, size) seen from dir. */
function draw(sheet, obj, cx, cy, size, dir = [0.55, 0.5, 1], { fitBox = null } = {}) {
  obj.updateMatrixWorld(true);
  const box = fitBox || new THREE.Box3();
  const tris = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  obj.traverseVisible((o) => {
    if (!o.isMesh || o.userData.hitbox) return;
    const g = o.geometry, mat = o.material;
    const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color, LK = g.attributes.fLook;
    nm.getNormalMatrix(o.matrixWorld);
    const verts = [];
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      verts.push({ p: v.clone(), n: n.clone(), uv: UV ? [UV.getX(i), UV.getY(i)] : [0, 0], c: C ? [C.getX(i), C.getY(i), C.getZ(i)] : [mat.color.r, mat.color.g, mat.color.b], lk: LK ? [LK.getX(i), LK.getY(i)] : [-1, mat.emissive && (mat.emissive.r || mat.emissive.g) ? mat.emissiveIntensity : 0] });
      if (!fitBox) box.expandByPoint(v);
    }
    const idx = g.index ? Array.from(g.index.array) : verts.map((_, i) => i);
    const alpha = mat.transparent ? mat.opacity : 1;
    const side = mat.side;
    for (let i = 0; i + 2 < idx.length; i += 3) tris.push({ a: verts[idx[i]], b: verts[idx[i + 1]], c: verts[idx[i + 2]], alpha, double: side === THREE.DoubleSide });
  });
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const f = new THREE.Vector3(...dir).normalize().negate();
  const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, f);
  const sz = box.getSize(new THREE.Vector3());
  const scale = (size * 0.86) / Math.max(sz.x, sz.y, sz.z, 0.1) / 1.25;
  const proj = (p) => {
    const d = p.clone().sub(center);
    return [cx + size / 2 + d.dot(right) * scale, cy + size / 2 - d.dot(up) * scale, d.dot(f)];
  };
  const W = sheet.w;
  // opaque first, then see-through (back to front)
  tris.sort((x, y) => (x.alpha < 1) - (y.alpha < 1));
  for (const t of tris) {
    const A = proj(t.a.p), B = proj(t.b.p), C = proj(t.c.p);
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    if (Math.abs(area) < 1e-9) continue;
    if (area > 0 && !t.double) continue; // back face (screen y points down)
    const x0 = Math.max(cx, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(cx + size - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(cy, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(cy + size - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B[0] - px) * (C[1] - py) - (B[1] - py) * (C[0] - px)) / area;
        const w1 = ((C[0] - px) * (A[1] - py) - (C[1] - py) * (A[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const zi = y * W + x;
        if (z >= sheet.z[zi]) continue;
        const lerp = (k) => w0 * t.a[k][0] + w1 * t.b[k][0] + w2 * t.c[k][0];
        const nx = w0 * t.a.n.x + w1 * t.b.n.x + w2 * t.c.n.x, ny = w0 * t.a.n.y + w1 * t.b.n.y + w2 * t.c.n.y, nz = w0 * t.a.n.z + w1 * t.b.n.z + w2 * t.c.n.z;
        const nl = Math.hypot(nx, ny, nz) || 1;
        let dif = (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / nl;
        if (t.double && dif < 0) dif = -dif;
        const light = 0.55 + 0.6 * Math.max(0, dif);
        let r = w0 * t.a.c[0] + w1 * t.b.c[0] + w2 * t.c.c[0];
        let g = w0 * t.a.c[1] + w1 * t.b.c[1] + w2 * t.c.c[1];
        let b = w0 * t.a.c[2] + w1 * t.b.c[2] + w2 * t.c.c[2];
        const layer = Math.round(t.a.lk[0]);
        if (layer >= 0 && layers.has(layer)) {
          const u = lerp('uv'), vv = w0 * t.a.uv[1] + w1 * t.b.uv[1] + w2 * t.c.uv[1];
          const tx = ((Math.floor((u - Math.floor(u)) * 16) % 16) + 16) % 16, ty = 15 - (((Math.floor((vv - Math.floor(vv)) * 16) % 16) + 16) % 16);
          const d = layers.get(layer), i4 = (ty * 16 + tx) * 4;
          const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
          r *= lin(d[i4]); g *= lin(d[i4 + 1]); b *= lin(d[i4 + 2]);
        }
        const glowAmt = w0 * t.a.lk[1] + w1 * t.b.lk[1] + w2 * t.c.lk[1];
        r = r * light + r * glowAmt; g = g * light + g * glowAmt; b = b * light + b * glowAmt;
        const a = t.alpha;
        const i = zi * 4;
        const put = (k, val) => { sheet.d[i + k] = sheet.d[i + k] * (1 - a) + toSrgb(val) * 255 * a; };
        put(0, r); put(1, g); put(2, b);
        if (a >= 1) sheet.z[zi] = z;
      }
    }
  }
}

function sheetOf(cols, rows, size, bg = [255, 244, 250]) {
  const w = cols * size, h = rows * size;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const alt = ((Math.floor(x / size) + Math.floor(y / size)) % 2) ? 0.97 : 1;
    d[i] = bg[0] * alt; d[i + 1] = bg[1] * alt; d[i + 2] = bg[2] * alt; d[i + 3] = 255;
  }
  return { w, h, d, z: new Float32Array(w * h).fill(Infinity), size, cols };
}
function save(name, sheet) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, png(sheet.w, sheet.h, sheet.d));
  console.log('wrote', path.relative(ROOT, file));
}
const want = (n) => !only || only.has(n);
const cell = (sheet, i) => [(i % sheet.cols) * sheet.size, Math.floor(i / sheet.cols) * sheet.size];

if (want('toys')) {
  const s = sheetOf(4, 4, 220);
  D.TOYS.forEach((t, i) => { const [x, y] = cell(s, i); draw(s, M.toyModel(t.key), x, y, s.size, [0.45, 0.42, 1]); });
  save('toys.png', s);
}
if (want('gifts')) {
  const s = sheetOf(4, 3, 200);
  const looks = [
    ['small', 'red', 'stars', 'gold', 'bow'], ['tall', 'blue', 'snow', 'white', 'puff'], ['round', 'pink', 'hearts', 'purple', 'star'], ['small', 'green', 'candy', 'red', 'puff'],
    ['tall', 'gold', 'dots', 'red', 'bow'], ['round', 'snow', 'candy', 'green', 'bow'], ['small', 'purple', 'stripes', 'pink', 'star'], ['tall', 'mint', 'stars', 'silver', 'star'],
    ['round', 'red', 'snow', 'gold', 'puff'], ['small', 'blue', 'hearts', 'gold', 'bow'], ['tall', 'pink', 'stripes', 'blue', 'bow'], ['round', 'green', 'dots', 'white', 'star'],
  ];
  looks.forEach(([box, paper, pattern, ribbon, bow], i) => { const [x, y] = cell(s, i); draw(s, M.giftModel({ box, paper, pattern, ribbon, bow }), x, y, s.size, [0.55, 0.5, 1]); });
  save('gifts.png', s);
}
if (want('papers')) {
  const s = sheetOf(8, 6, 110);
  D.PATTERNS.forEach((pt, r) => D.PAPERS.forEach((p, c) => {
    const [x, y] = [c * s.size, r * s.size];
    draw(s, M.giftModel({ box: 'small', paper: p.key, pattern: pt.key, ribbon: D.ribbonFor(p.key, () => 0.3), bow: 'bow' }, { tag: false }), x, y, s.size, [0.3, 0.35, 1]);
  }));
  save('papers.png', s);
}
if (want('wrap')) {
  const times = [0, 0.4, 0.8, 1.15, 1.35, 1.6, 1.9, 2.3, 2.8];
  const s = sheetOf(times.length, 3, 170);
  ['small', 'tall', 'round'].forEach((box, r) => times.forEach((t, c) => {
    const m = M.stageModel({ inside: ['teddy', 'rocket', 'unicorn'][r], box, paper: ['red', 'blue', 'pink'][r], pattern: ['stars', 'snow', 'hearts'][r], ribbon: ['gold', 'white', 'purple'][r], bow: ['bow', 'puff', 'star'][r] });
    M.putInside(m, ['teddy', 'rocket', 'unicorn'][r]);
    M.poseStage(m, D.wrapPose(t), t);
    draw(s, m, c * s.size, r * s.size, s.size, [0.5, 0.55, 1], { fitBox: new THREE.Box3(new THREE.Vector3(-0.6, 0, -0.6), new THREE.Vector3(0.6, 0.95, 0.6)) });
  }));
  save('wrap.png', s);
  const steps = ['toy', 'box', 'paper', 'ribbon'];
  const s2 = sheetOf(4, 1, 220);
  steps.forEach((st, c) => {
    const m = M.stageModel({ inside: 'dino', box: 'small', paper: 'mint', pattern: 'dots', ribbon: 'pink', bow: 'bow' });
    M.putInside(m, 'dino');
    M.poseStage(m, st, 0);
    draw(s2, m, c * s2.size, 0, s2.size, [0.5, 0.55, 1], { fitBox: new THREE.Box3(new THREE.Vector3(-0.6, 0, -0.6), new THREE.Vector3(0.6, 0.95, 0.6)) });
  });
  save('steps.png', s2);
}
if (want('opened')) {
  const s = sheetOf(3, 1, 220);
  [['small', 'teddy', 'red', 'stars'], ['tall', 'robot', 'blue', 'snow'], ['round', 'unicorn', 'pink', 'hearts']].forEach(([box, inside, paper, pattern], i) => {
    draw(s, M.openedModel({ box, inside, paper, pattern, ribbon: 'gold', bow: 'bow' }), i * s.size, 0, s.size, [0.55, 0.6, 1]);
  });
  save('opened.png', s);
}
if (want('workshop')) {
  const s = sheetOf(2, 2, 360);
  M.WORKSHOP_COLORS.forEach((c, i) => { const [x, y] = cell(s, i); draw(s, M.workshopModel(c), x, y, s.size, i % 2 ? [0.6, 0.35, 1] : [-0.3, 0.3, 1]); });
  save('workshop.png', s);
}
