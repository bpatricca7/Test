// Wave 5 (docs/teams/wave5-plan.md §8): look at a generated world without a browser.
//
//   node tools/worldview.mjs <biome> [--size=cozy|big] [--seed=1] [--out=.shots/worldview]
//                            [--views=iso,iso2,top,side] [--slice=y1,y2,...] [--T=4|8] [--quiet]
//
// Registers every block (real tile painters, drawn into a tiny fake 2D canvas), runs the
// biome's generate() in Node, prints a summary (time, blocks used, spawn, features by kind,
// unknown-block warnings) and writes PNG pictures:
//   <out>/<biome>-<seed>-iso.png     isometric view from the south-east (sun from the left)
//   <out>/<biome>-<seed>-iso2.png    the same from the north-west
//   <out>/<biome>-<seed>-top.png     top-down map, 4 px per block, shaded by height
//   <out>/<biome>-<seed>-side.png    elevation from the south (first block along +z)
//   <out>/<biome>-<seed>-y<N>.png    horizontal cut at height N (what a deck floor plan looks like)
// Colors are each tile's average color; light, fog and furniture are not drawn (furniture is
// marked with a magenta dot on the top map from world.features). Exit code 1 when generate()
// throws, the spawn is unsafe, or an unknown block key was asked for.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- a tiny fake canvas for the tile painters ----------
class FakeImageData {
  constructor(data, w, h) {
    if (typeof data === 'number') { h = w; w = data; data = new Uint8ClampedArray(w * h * 4); }
    this.data = data; this.width = w; this.height = h;
  }
}
globalThis.ImageData = globalThis.ImageData || FakeImageData;

function parseColor(c) {
  if (typeof c !== 'string') return [0, 0, 0, 255];
  c = c.trim();
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(c))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const v = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
  }
  if ((m = /^rgba?\(([^)]+)\)$/i.exec(c))) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? Math.round((p[3] <= 1 ? p[3] : p[3] / 255) * 255) : 255];
  }
  return [128, 128, 128, 255];
}

function fakeCtx(w = 16, h = 16) {
  const data = new Uint8ClampedArray(w * h * 4);
  const state = { fill: [0, 0, 0, 255], alpha: 1 };
  const ctx = {
    canvas: { width: w, height: h },
    get fillStyle() { return state.fillRaw; },
    set fillStyle(v) { state.fillRaw = v; state.fill = parseColor(v); },
    get globalAlpha() { return state.alpha; },
    set globalAlpha(v) { state.alpha = v; },
    fillRect(x, y, ww, hh) {
      const [r, g, b, a0] = state.fill;
      const a = (a0 / 255) * state.alpha;
      for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(h, Math.ceil(y + hh)); yy++) {
        for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(w, Math.ceil(x + ww)); xx++) {
          const i = (yy * w + xx) * 4;
          data[i] = data[i] * (1 - a) + r * a; data[i + 1] = data[i + 1] * (1 - a) + g * a;
          data[i + 2] = data[i + 2] * (1 - a) + b * a; data[i + 3] = Math.min(255, data[i + 3] + a * 255);
        }
      }
    },
    clearRect(x, y, ww, hh) {
      for (let yy = Math.max(0, y | 0); yy < Math.min(h, y + hh); yy++) for (let xx = Math.max(0, x | 0); xx < Math.min(w, x + ww); xx++) data.fill(0, (yy * w + xx) * 4, (yy * w + xx) * 4 + 4);
    },
    putImageData(img, x = 0, y = 0) {
      for (let yy = 0; yy < img.height; yy++) for (let xx = 0; xx < img.width; xx++) {
        const tx = xx + x, ty = yy + y;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const s = (yy * img.width + xx) * 4, d = (ty * w + tx) * 4;
        data[d] = img.data[s]; data[d + 1] = img.data[s + 1]; data[d + 2] = img.data[s + 2]; data[d + 3] = img.data[s + 3];
      }
    },
    getImageData(x, y, ww, hh) {
      const out = new Uint8ClampedArray(ww * hh * 4);
      for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < ww; xx++) {
        const s = ((yy + y) * w + xx + x) * 4, d = (yy * ww + xx) * 4;
        out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
      }
      return new ImageData(out, ww, hh);
    },
    createImageData(ww, hh) { return new ImageData(ww, hh); },
    _data: data,
  };
  return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
}

// ---------- args ----------
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const biomeKey = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'meadow';
const size = args.size || 'cozy';
const seed = Number(args.seed ?? 1) | 0;
const outDir = path.resolve(ROOT, args.out || '.shots/worldview');
const views = String(args.views || 'iso,iso2,top,side').split(',');
const slices = args.slice ? String(args.slice).split(',').map(Number) : [];

const { BlockRegistry, ItemRegistry } = await import('../src/core/registry.js');
const blocksMod = await import('../src/world/blocks.js');
const { World, WORLD_SIZES } = await import('../src/world/world.js');
const { mulberry32, hashString } = await import('../src/core/util.js');
const { Noise } = await import('../src/core/noise.js');
const worldgen = await import('../src/world/worldgen.js');

const items = new ItemRegistry();
const reg = new BlockRegistry(items);
blocksMod.install({ registry: { blocks: reg, items } });
// the garden's farmland (registered by src/things/garden.js in the game)
if (reg.idOf('farmland') < 0) reg.register({ key: 'farmland', name: 'Farmland', category: 'garden', tiles: { all: 'dirt' } });

const biomes = new Map();
worldgen.install({ registry: { biomes, blocks: reg, items }, events: { on() {} } });
const def = biomes.get(biomeKey);
if (!def) { console.error(`unknown biome "${biomeKey}" (have: ${[...biomes.keys()].join(', ')})`); process.exit(1); }

// average color per block (top and side faces)
const colorCache = new Map();
function tileColor(tileKey) {
  if (colorCache.has(tileKey)) return colorCache.get(tileKey);
  let out = [255, 0, 255, 255];
  const p = reg.painters.get(tileKey);
  if (p) {
    const ctx = fakeCtx();
    try { p(ctx, mulberry32(hashString('tile:' + tileKey))); } catch (err) { /* keep magenta */ }
    const d = ctx._data;
    let r = 0, g = 0, b = 0, n = 0, opaque = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; if (d[i + 3] > 200) opaque++; }
    if (n) out = [r / n, g / n, b / n, opaque / 256];
  }
  colorCache.set(tileKey, out);
  return out;
}
const faceColor = (id, face) => {
  const d = reg.byId(id);
  if (!d || !d.tiles) return [255, 0, 255, 1];
  let tk;
  try { tk = reg.faceTile(d, face); } catch { tk = d.key; }
  const c = tileColor(tk);
  if (d.tint) { const t = parseColor(d.tint); return [c[0] * t[0] / 255, c[1] * t[1] / 255, c[2] * t[2] / 255, c[3]]; }
  return c;
};

// ---------- generate ----------
const warns = [];
const origWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(' ')); };
const dims = WORLD_SIZES[size] || WORLD_SIZES.cozy;
const world = new World(dims, reg);
world.meta = { id: 'view', name: 'View', biome: biomeKey, seed, createdAt: 0, sizeName: size };
const t0 = performance.now();
let failed = false;
try {
  def.generate(world, mulberry32(seed), new Noise(seed));
} catch (err) {
  console.warn = origWarn;
  console.error('generate() threw:', err);
  process.exit(1);
}
const genMs = performance.now() - t0;
console.warn = origWarn;
// props for the spawn check
const props = { solid: new Uint8Array(256), replaceable: new Uint8Array(256) };
for (const d of reg.defs) { props.solid[d.id] = d.solid ? 1 : 0; props.replaceable[d.id] = d.replaceable || d.key === 'air' ? 1 : 0; }
reg.props = reg.props || props;
const spawn = (def.spawn || worldgen.defaultSpawn)(world);

const { sx, sy, sz } = world;
const B = world.blocks;
const counts = new Map();
for (let i = 0; i < B.length; i++) if (B[i]) counts.set(B[i], (counts.get(B[i]) || 0) + 1);
const feats = Array.isArray(world.features) ? world.features : [];
const byKind = {};
for (const f of feats) byKind[f.kind + (f.key ? ':' + f.key : '')] = (byKind[f.kind + (f.key ? ':' + f.key : '')] || 0) + 1;

const sp = spawn.map((v) => Math.floor(v));
const below = world.get(sp[0], sp[1] - 1, sp[2]);
const spawnOk = below && reg.byId(below)?.solid && !reg.byId(world.get(sp[0], sp[1], sp[2]))?.solid && !reg.byId(world.get(sp[0], sp[1] + 1, sp[2]))?.solid;

if (!args.quiet) {
  console.log(`${biomeKey} ${size} seed ${seed}: ${sx}x${sy}x${sz}, generate ${genMs.toFixed(0)} ms, ${reg.defs.length} block types registered`);
  console.log(`spawn ${spawn.map((v) => v.toFixed(1)).join(', ')} on ${reg.byId(below)?.key} -> ${spawnOk ? 'safe' : 'NOT SAFE'}`);
  console.log(`waterLevel ${world.waterLevel}, outside ${JSON.stringify(world.outside)}, gems ${world.gemSpots ? world.gemSpots.length : 0} (total ${world.gemTotal})`);
  console.log('blocks used:', [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${reg.byId(id).key} ${n}`).join(', '));
  console.log(`features (${feats.length}):`, JSON.stringify(byKind));
  if (warns.length) console.log('warnings:', [...new Set(warns)].join(' | '));
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
class Img {
  constructor(w, h, bg = [205, 232, 255]) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { this.d[i * 4] = bg[0]; this.d[i * 4 + 1] = bg[1]; this.d[i * 4 + 2] = bg[2]; this.d[i * 4 + 3] = 255; } }
  px(x, y, c, a = 1) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 4; this.d[i] = this.d[i] * (1 - a) + c[0] * a; this.d[i + 1] = this.d[i + 1] * (1 - a) + c[1] * a; this.d[i + 2] = this.d[i + 2] * (1 - a) + c[2] * a; }
  rect(x, y, w, h, c, a = 1) { for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, c, a); }
  save(file) { writeFileSync(file, png(this.w, this.h, this.d)); }
}
const shadeC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const isAir = (id) => id === 0;
const translucent = (id) => { const d = reg.byId(id); return d && (d.translucent || d.shape === 'liquid'); };
mkdirSync(outDir, { recursive: true });
const base = path.join(outDir, `${biomeKey}-${seed}`);
const written = [];

if (views.includes('top')) {
  const S = 4, img = new Img(sx * S, sz * S);
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    let y = sy - 1; while (y >= 0 && isAir(world.get(x, y, z))) y--;
    if (y < 0) continue;
    const id = world.get(x, y, z);
    let c = faceColor(id, 'top');
    if (translucent(id)) { let yy = y - 1; while (yy >= 0 && translucent(world.get(x, yy, z))) yy--; const under = yy >= 0 ? faceColor(world.get(x, yy, z), 'top') : c; c = [c[0] * 0.6 + under[0] * 0.4, c[1] * 0.6 + under[1] * 0.4, c[2] * 0.6 + under[2] * 0.4]; }
    const k = 0.62 + (y / sy) * 0.55;
    img.rect(x * S, z * S, S, S, shadeC(c, Math.min(1.15, k)));
  }
  for (const f of feats) img.rect((f.x | 0) * S + 1, (f.z | 0) * S + 1, 2, 2, f.kind === 'furn' ? [255, 0, 200] : [255, 230, 0]);
  img.rect(sp[0] * S, sp[2] * S, S, S, [255, 0, 0]);
  img.save(base + '-top.png'); written.push(base + '-top.png');
}
if (views.includes('side')) {
  const S = 4, img = new Img(sx * S, sy * S);
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    let z = 0; while (z < sz && isAir(world.get(x, y, z))) z++;
    if (z >= sz) continue;
    const c = faceColor(world.get(x, y, z), 'south');
    img.rect(x * S, (sy - 1 - y) * S, S, S, shadeC(c, 0.85 + 0.15 * (1 - z / sz)));
  }
  img.save(base + '-side.png'); written.push(base + '-side.png');
}
for (const yCut of slices) {
  const S = 4, img = new Img(sx * S, sz * S, [40, 40, 60]);
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const id = world.get(x, yCut, z);
    if (id) img.rect(x * S, z * S, S, S, faceColor(id, 'top'));
    else { const idb = world.get(x, yCut - 1, z); if (idb) img.rect(x * S, z * S, S, S, shadeC(faceColor(idb, 'top'), 0.45)); }
  }
  img.save(`${base}-y${yCut}.png`); written.push(`${base}-y${yCut}.png`);
}
function iso(flip, file) {
  const T = Math.max(2, Number(args.T || 4) | 0); // half-width of a block's top diamond (--T=8 for a closer look)
  const W = (sx + sz) * T + 8, H = (sx + sz) * (T / 2) + sy * T + 8;
  const img = new Img(W, H, [190, 225, 255]);
  const X = (x, z) => (flip ? (x - z) : (z - x)) * T + sx * T + 4;
  const Y = (x, y, z) => (flip ? (sx - 1 - x + sz - 1 - z) : (x + z)) * (T / 2) - y * T + sy * T + 4;
  // draw back to front: increasing x+z (towards viewer) then y
  const order = [];
  for (let s = 0; s <= sx + sz - 2; s++) order.push(s);
  for (const s of order) {
    for (let x = Math.max(0, s - sz + 1); x <= Math.min(sx - 1, s); x++) {
      const zz = s - x;
      const x0 = flip ? sx - 1 - x : x, z0 = flip ? sz - 1 - zz : zz;
      for (let y = 0; y < sy; y++) {
        const id = world.get(x0, y, z0);
        if (!id) continue;
        const dx = flip ? -1 : 1, dz = flip ? -1 : 1;
        const top = world.get(x0, y + 1, z0), fa = world.get(x0 + dx, y, z0), fb = world.get(x0, y, z0 + dz);
        const tr = translucent(id);
        const vis = (n) => n === 0 || (translucent(n) && !tr) || (reg.byId(n)?.shape === 'cross') || (reg.byId(n)?.transparent);
        if (!vis(top) && !vis(fa) && !vis(fb)) continue;
        const d = reg.byId(id);
        const a = tr ? 0.55 : 1;
        const cx = X(x0, z0), cy = Y(x0, y, z0);
        if (d.shape === 'cross') { const c = faceColor(id, 'side'); img.rect(cx - 1, cy - T, 3, T, c, 0.9); continue; }
        const ct = faceColor(id, 'top'), cs = faceColor(id, 'side');
        const hgt = d.shape === 'slab' ? T / 2 : d.shape === 'carpet' ? 1 : T;
        const yo = T - hgt;
        // top diamond
        if (vis(top)) for (let r = 0; r < T; r++) { const w = (r + 1) * 2; img.rect(cx - w + 1, cy + yo - T / 2 + (r >> 1) - T / 2 + T / 2, w * 2 - 2, 1, ct, a); }
        for (let r = 0; r < T; r++) { const w = (T - r) * 2; img.rect(cx - w + 1, cy + yo + (r >> 1), w * 2 - 2, 1, ct, a); }
        // left and right faces
        if (vis(fb)) img.rect(cx - 2 * T, cy + yo + T / 2, 2 * T, hgt, shadeC(cs, 0.82), a);
        if (vis(fa)) img.rect(cx, cy + yo + T / 2, 2 * T, hgt, shadeC(cs, 0.66), a);
      }
    }
  }
  img.save(file); written.push(file);
}
if (views.includes('iso')) iso(false, base + '-iso.png');
if (views.includes('iso2')) iso(true, base + '-iso2.png');
if (!args.quiet) console.log('wrote', written.map((f) => path.relative(ROOT, f)).join(', '));

const unknown = warns.filter((w) => /unknown block/.test(w));
if (!spawnOk || unknown.length || failed) process.exit(1);
