// Hill-shaded map of the procedural Moon (TERRAIN dev tool, no browser needed).
// node dev/terrain-map.mjs --lat 0.67 --lon 23.47 --km 200 --px 512 --lod 300 --sun 11 --sunaz 90 --out shots/fix-terrain/map.png
import fs from 'node:fs';
import zlib from 'node:zlib';
import { evalSurface, createSample } from '../src/world/moon.js';
import { MOON } from '../src/core/constants.js';

const a = process.argv.slice(2);
const o = { lat: 0.67, lon: 23.47, km: 200, px: 512, lod: 0, sun: 11, sunaz: 90, out: 'map.png', albedo: 1 };
for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1];
for (const k of ['lat', 'lon', 'km', 'px', 'lod', 'sun', 'sunaz', 'albedo']) o[k] = +o[k];
const R = MOON.radius;
const D = Math.PI / 180;
const c = [Math.cos(o.lat * D) * Math.cos(o.lon * D), Math.cos(o.lat * D) * Math.sin(o.lon * D), Math.sin(o.lat * D)];
const e = [-Math.sin(o.lon * D), Math.cos(o.lon * D), 0];
const n = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
const N = o.px;
const step = (o.km * 1000) / N;
const lod = o.lod || step;
const s = createSample();
const H = new Float64Array((N + 1) * (N + 1));
const A = new Float64Array((N + 1) * (N + 1));
for (let j = 0; j <= N; j++) {
  for (let i = 0; i <= N; i++) {
    const de = (i - N / 2) * step;
    const dn = (N / 2 - j) * step;
    const x = c[0] * R + e[0] * de + n[0] * dn;
    const y = c[1] * R + e[1] * de + n[1] * dn;
    const z = c[2] * R + e[2] * de + n[2] * dn;
    const l = Math.hypot(x, y, z);
    evalSurface(x / l, y / l, z / l, lod, 1, s);
    H[j * (N + 1) + i] = s.h;
    A[j * (N + 1) + i] = s.albedo;
  }
}
const se = Math.sin(o.sun * D);
const ce = Math.cos(o.sun * D);
const L = [Math.sin(o.sunaz * D) * ce, Math.cos(o.sunaz * D) * ce, se]; // east, north, up
const img = Buffer.alloc(N * (N * 3 + 1));
for (let j = 0; j < N; j++) {
  img[j * (N * 3 + 1)] = 0;
  for (let i = 0; i < N; i++) {
    const h = H[j * (N + 1) + i];
    const dx = (H[j * (N + 1) + i + 1] - h) / step;
    const dy = (h - H[(j + 1) * (N + 1) + i]) / step;
    const nl = Math.hypot(dx, dy, 1);
    const mu = Math.max(0, (-dx * L[0] - dy * L[1] + L[2]) / nl);
    const alb = o.albedo ? A[j * (N + 1) + i] / 0.12 : 1;
    const v = Math.max(0, Math.min(255, Math.round(255 * Math.pow(mu * alb * 0.9 / Math.max(se, 0.2), 1 / 2.2))));
    const p = j * (N * 3 + 1) + 1 + i * 3;
    img[p] = img[p + 1] = img[p + 2] = v;
  }
}
function crc32(buf) {
  let c2 = ~0;
  for (let k = 0; k < buf.length; k++) {
    c2 ^= buf[k];
    for (let b = 0; b < 8; b++) c2 = c2 & 1 ? (c2 >>> 1) ^ 0xedb88320 : c2 >>> 1;
  }
  return ~c2 >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 2;
fs.writeFileSync(o.out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', o.out);
