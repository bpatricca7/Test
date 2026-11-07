#!/usr/bin/env node
// A perspective close-up of a real generated world WITH its real entities, without a browser
// or WebGL (pure Node, a small software renderer).
//
//   node tools/sceneview.mjs <biome> [--seed=1] [--size=cozy|big] [--out=file.png]
//        [--eye=x,y,z] [--at=x,y,z | --target=<name>[#n]] [--fov=60] [--w=1280] [--h=800]
//        [--time=day|dusk|night|0..1] [--ss=2] [--range=160] [--tex=auto|avg|pixel] [--cut=Y]
//        [--avatar[=x,y,z|at|spawn]] [--look=santa|elf|elf_girl|mrs_santa|cozy|default]
//        [--hold=gift|none] [--gift=paper,pattern,ribbon,bow,box] [--yaw=deg] [--quiet] [--verbose]
//   node tools/sceneview.mjs <biome> --seed=4 --size=big --list [--all]
//
// The world is made exactly as tools/test-wave5-integration.mjs makes it (tools/lib/
// standin-game.mjs): the real block registry and World, the biome's generate(), then the real
// world-feature placers on the stand-in game, so furniture, cruise pieces, gifts, elves,
// reindeer, the sleigh and the dress-up booth exist with their real three.js models. The block
// textures are the game's own (src/world/textures.js through a painting fake canvas,
// tools/lib/fake-dom.mjs) and the voxels are meshed by the game's own Mesher (faces next to
// air or see-through blocks only, ambient occlusion, smooth sky and block light) for the
// chunks inside the camera's view.
//
// Drawing: blocks use each face's average tile color (--tex=avg); with the default
// --tex=auto, faces close enough to show their 16x16 pixels show them. The block light follows
// the block shader (sky light x daylight, warm block light near lights, ambient floor), water
// and glass are see-through, light-emitting blocks are drawn bright. Every entity's object tree
// is drawn from its real meshes (world matrices, vertex colors, material color, the furniture
// atlas and canvas textures sampled per pixel, glow) with the game's Lambert light (hemisphere
// + sun). Sky gradient from the biome's sky colors, the horizon ring (ocean or snow) beyond
// the world's edge, distance fog, 2x supersampling. --time=dusk dims the daylight like the
// day-night cycle does so lights glow (Holiday Village caps daylight at 0.72 anyway).
//
// --avatar puts a real avatar (src/player/avatar.js createAvatar) in the scene wearing --look
// (a HOLIDAY_OUTFITS key from src/player/wardrobe-data.js, or 'default'), holding a wrapped
// gift (src/things/gifts/models.js heldGiftModel) unless --hold=none; she faces the camera
// unless --yaw is given. With no position she stands at the target (or the spawn).
//
// --list prints camera targets: the spawn, every named spot, every feature record by kind and
// the entities by key (with positions), the reindeer, each with a suggested --eye/--at pair.
// --target=<spot name | record kind | entity key | reindeer | spawn>[#n] aims the camera at
// one of them (the eye is picked with a clear line of sight unless --eye is given).

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T0 = performance.now();

// ---------- args ----------
const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const biomeKey = args.biome || argv.find((a) => !a.startsWith('--')) || 'cruise';
const seed = Number(args.seed ?? 1) | 0;
const sizeName = args.size || 'cozy';
const W0 = Math.max(16, Number(args.w || 1280) | 0), H0 = Math.max(16, Number(args.h || 800) | 0);
const SS = Math.max(1, Math.min(4, Number(args.ss || 2) | 0));
const FOV = Number(args.fov || 60);
const VERBOSE = !!args.verbose, QUIET = !!args.quiet;
const TEX = String(args.tex || 'auto');
// --cut=Y: leave out blocks (and entities wholly) at or above height Y, a dollhouse cutaway that
// takes a room's ceiling (and the decks above it) out of the way of a camera inside the room
const CUT = Number.isFinite(Number(args.cut)) && args.cut !== true ? Number(args.cut) : null;
const vec = (s) => { if (typeof s !== 'string') return null; const p = s.split(',').map(Number); return p.length === 3 && p.every(Number.isFinite) ? p : null; };
const say = (...a) => { if (!QUIET) console.log(...a); };

// quiet the game's own warnings (stand-in services) unless --verbose
const realWarn = console.warn, realError = console.error;
const muted = [];
if (!VERBOSE) { console.warn = (...a) => muted.push(a.join(' ')); console.error = (...a) => muted.push(a.join(' ')); }

// ---------- the stand-in game ----------
const S = await import('./lib/standin-game.mjs');
const { THREE } = S;
// the furniture atlas (src/things/furniture/atlas.js) keeps its texture array to itself: note
// every DataArrayTexture that gets uploaded, the shared one is the atlas
const arrayTextures = [];
{
  const base = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  Object.defineProperty(THREE.DataArrayTexture.prototype, 'needsUpdate', {
    configurable: true,
    get() { return base.get ? base.get.call(this) : undefined; },
    set(v) { if (!arrayTextures.includes(this)) arrayTextures.push(this); base.set.call(this, v); },
  });
}
const { buildBlockTexture } = await import('../src/world/textures.js');
const { Mesher } = await import('../src/world/mesher.js');
const { SHAPES } = await import('../src/core/registry.js');

Math.random = S.mulberry32(0x5eed); // pets jitter with Math.random: the same herd every run
const game = S.makeGame();
let blockTex = null;
const log = S.installAll(game, { finalize: (reg) => { blockTex = buildBlockTexture(reg); } });
let world, records;
try {
  ({ world, records } = S.newWorld(game, biomeKey, sizeName, seed));
} catch (err) {
  console.warn = realWarn; console.error = realError;
  console.error(String(err && err.message || err));
  process.exit(1);
}
// a few frames of the game's systems (pets walk onto their spots, pieces settle), then the
// static furniture batches the renderer would build right before the first frame
for (let i = 0; i < 4; i++) game._callSystems('update', 1 / 30);
game.entities.batcher.flush();
const reg = game.registry.blocks, props = reg.props;
const tGen = performance.now();

// ---------- targets (--list, --target) ----------
const spawn = world.meta.spawn;
const solidAt = (x, y, z) => { const id = world.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id !== 0 && props.opaque[id] === 1; };
const blocked = (x, y, z) => { const id = world.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id !== 0 && (props.solid[id] === 1 || props.opaque[id] === 1) && props.shape[id] !== SHAPES.liquid; };
const ents = [...game.entities.map.values()];

function entityCenter(e) {
  const fp = game.entities.footprint(e.def, e.x, e.y, e.z, e.rot);
  let x = 0, y = 0, z = 0, ymax = -Infinity;
  for (const c of fp) { x += c[0]; y += c[1]; z += c[2]; ymax = Math.max(ymax, c[1]); }
  const n = fp.length || 1;
  return [x / n + 0.5, Math.min(y / n + 0.5, ymax + 0.5), z / n + 0.5];
}
const FRONT = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // rot 0..3: the front faces +Z, +X, -Z, -X

/** Does a block stop the eye's view (anything but air, plants and water)? */
const sightBlocked = (x, y, z) => {
  const id = world.get(Math.floor(x), Math.floor(y), Math.floor(z));
  return id !== 0 && props.shape[id] !== SHAPES.cross && props.shape[id] !== SHAPES.liquid;
};
const pieceAt = (x, y, z) => !!game.entities.at(Math.floor(x), Math.floor(y), Math.floor(z));
const lineClear = (a, b, skipEnd = 1) => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const steps = Math.ceil(d * 4);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (t * d > d - skipEnd) break;
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    if (sightBlocked(x, y, z) || (t * d < d - 2.5 && pieceAt(x, y, z))) return false;
  }
  return true;
};

/**
 * An eye position with a clear, open view of `at` from about `dist` blocks away (from the
 * front side when `front` is known): nothing in the 3x3x3 cells round the eye, a clear line
 * to the target and to points round it, a gentle downward look preferred.
 */
function suggestEye(at, { dist = 9, front = null, skip = 1 } = {}) {
  let best = null;
  const side = [[0, 0, 0], [1.3, 0, 0], [-1.3, 0, 0], [0, 0, 1.3], [0, 0, -1.3], [0, 1.2, 0]];
  for (const d of [dist, dist * 0.8, dist * 0.65, dist * 0.5, dist * 0.38]) {
    for (let k = 0; k < 32; k++) {
      const yaw = (k / 32) * Math.PI * 2;
      for (const pitch of [0.4, 0.28, 0.55, 0.16, 0.75]) {
        const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
        const eye = [at[0] + dir[0] * d, at[1] + dir[1] * d, at[2] + dir[2] * d];
        if (eye[1] >= world.sy + 30 || eye[1] < 1) continue;
        let open = true;
        for (let ox = -1; ox <= 1 && open; ox++) for (let oy = -1; oy <= 1 && open; oy++) for (let oz = -1; oz <= 1 && open; oz++) {
          if (sightBlocked(eye[0] + ox, eye[1] + oy, eye[2] + oz) || pieceAt(eye[0] + ox, eye[1] + oy, eye[2] + oz)) open = false;
        }
        if (!open) continue;
        let seen = 0;
        for (const o of side) if (lineClear(eye, [at[0] + o[0], at[1] + o[1], at[2] + o[2]], (o[0] || o[1] || o[2] ? 1.6 : 1) + skip - 1)) seen++;
        if (seen < 4 || !lineClear(eye, at, skip)) continue;
        let score = d * 1.5 + seen * 1.2 - Math.abs(pitch - 0.4) * 4;
        // room round the eye (trunks and walls right next to the lens fill the picture)
        let room = 0;
        for (let ox = -2; ox <= 2; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -2; oz <= 2; oz++) {
          if (!sightBlocked(eye[0] + ox, eye[1] + oy, eye[2] + oz) && !pieceAt(eye[0] + ox, eye[1] + oy, eye[2] + oz)) room++;
        }
        score += (room / 75) * 8;
        if (front) score += 5 * (dir[0] * front[0] + dir[2] * front[1]) / Math.max(0.2, Math.cos(pitch));
        if (!best || score > best.score) best = { eye, score };
      }
    }
    if (best && best.score > d * 1.5 + 13) break;
  }
  return best ? best.eye.map((v) => Math.round(v * 10) / 10) : [at[0] + dist * 0.6, at[1] + dist * 0.5, at[2] + dist * 0.6];
}

/** A comfortable distance to look at an entity from (bigger pieces from further away). */
function distFor(e) {
  if (!e) return 9;
  const s = e.def.size || [1, 1, 1];
  return Math.max(4.5, Math.min(14, Math.max(s[0], s[1], s[2]) * 1.6 + 3));
}

const callOf = new Map(log.calls.map((c) => [c.rec, c]));
function targets() {
  const out = [];
  out.push({ name: 'spawn', group: 'spawn', at: [spawn[0], spawn[1] + 1, spawn[2]], front: null, dist: 10 });
  for (const r of records) {
    if (r.kind === 'cruise:spot' || r.kind === 'holiday:spot') out.push({ name: r.name, group: 'spot', at: [r.x + 0.5, r.y + 1, r.z + 0.5], front: null, info: r.deck || '', dist: 10, base: r.y });
  }
  for (const r of records) {
    if (r.kind === 'furn' || r.kind.endsWith(':spot')) continue;
    let at = [r.x + 0.5, r.y + 1, r.z + 0.5];
    if (r.kind === 'holiday:reindeer' && Array.isArray(r.area)) at = [(r.area[0] + r.area[2]) / 2 + 0.5, r.y + 1, (r.area[1] + r.area[3]) / 2 + 0.5];
    if (r.kind === 'cruise:dance' && Number.isFinite(r.x0)) at = [(r.x0 + r.x1) / 2 + 0.5, r.y + 1, (r.z0 + r.z1) / 2 + 0.5];
    if (r.kind === 'cruise:movie' && r.h) at = [r.x + 0.5, r.y + r.h / 2, r.z + 0.5];
    const call = callOf.get(r);
    const ok = call ? call.places.filter((p) => p.ok) : [];
    const ent = ok.length ? game.entities.map.get(ok[0].uid) || null : null;
    out.push({ name: r.kind, group: 'feature', at, front: ent ? FRONT[ent.rot & 3] : FRONT[(r.rot | 0) & 3], ent, dist: r.kind.endsWith(':dance') || r.kind.endsWith(':reindeer') ? 11 : ent ? distFor(ent) : 9 });
  }
  // the Holiday Tree itself (the presents' record knows its trunk column)
  for (const r of records) {
    if (r.kind !== 'holiday:presents' || !Array.isArray(r.tree)) continue;
    const [tx, tz] = r.tree;
    let top = world.sy - 1;
    while (top > r.y && world.get(tx, top, tz) === 0) top--;
    const spotRec = records.find((q) => q.kind === 'holiday:spot' && q.name === 'tree');
    const front = spotRec ? (() => { const dx = spotRec.x - tx, dz = spotRec.z - tz, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; })() : null;
    out.push({ name: 'holiday-tree', group: 'feature', at: [tx + 0.5, (r.y + top) / 2 + 0.5, tz + 0.5], front, dist: Math.min(30, (top - r.y) * 1.1 + 6), skip: Math.max(2, (top - r.y) / 3), base: r.y });
  }
  for (const e of ents) out.push({ name: e.key, group: 'entity', at: entityCenter(e), front: FRONT[e.rot & 3], ent: e, dist: distFor(e) });
  for (const p of (game.pets && game.pets.pets) || []) {
    const o = p.group || p.mesh || p.object3d || p.root;
    const pos = o && o.position ? [o.position.x, o.position.y + 0.8, o.position.z] : Number.isFinite(p.x) ? [p.x, p.y + 0.8, p.z] : null;
    if (pos) out.push({ name: p.species || 'pet', group: 'pet', at: pos, front: null });
  }
  return out;
}
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const fv = (a) => a.map(f1).join(',');

if (args.list) {
  console.warn = realWarn; console.error = realError;
  const T = targets();
  console.log(`${biomeKey} ${sizeName} seed ${seed}: ${world.sx}x${world.sy}x${world.sz}, ${ents.length} entities, ${(game.pets && game.pets.pets.length) || 0} pets, ${records.length} records`);
  console.log('(each line: name  position  -> suggested --eye=... --at=...; use --target=name[#n] to aim there)');
  const show = (t) => `--eye=${fv(suggestEye(t.at, { front: t.front, dist: t.dist, skip: t.skip }))} --at=${fv(t.at)}`;
  console.log('\nspawn');
  console.log(`  spawn ${fv(spawn)}  -> ${show(T[0])}`);
  console.log('\nspots');
  for (const t of T.filter((x) => x.group === 'spot')) console.log(`  ${t.name.padEnd(10)} ${(t.info || '').padEnd(16)} ${fv(t.at)}  -> ${show(t)}`);
  console.log('\nfeatures (records by kind)');
  const byKind = new Map();
  for (const t of T.filter((x) => x.group === 'feature')) { if (!byKind.has(t.name)) byKind.set(t.name, []); byKind.get(t.name).push(t); }
  for (const [k, list] of byKind) {
    console.log(`  ${k} x${list.length}`);
    const nK = args.all ? list.length : 4; // --list --all: every record
    list.slice(0, nK).forEach((t, i) => console.log(`    #${i} ${fv(t.at)}  -> ${show(t)}`));
    if (list.length > nK) console.log(`    ... and ${list.length - 4} more (#4..#${list.length - 1})`);
  }
  console.log('\nentities by key (count: first positions)');
  const byKey = new Map();
  for (const t of T.filter((x) => x.group === 'entity')) { if (!byKey.has(t.name)) byKey.set(t.name, []); byKey.get(t.name).push(t); }
  const KEYS_FIRST = /cruise_|holiday|gift|elf|sleigh|reindeer|bed|booth|workshop|fireplace|tree|dj|movie|arcade|golf/;
  const keys = [...byKey.keys()].sort((a, b) => (KEYS_FIRST.test(b) - KEYS_FIRST.test(a)) || a.localeCompare(b));
  for (const k of keys) {
    const list = byKey.get(k);
    const nE = args.all ? list.length : 3; // --list --all: every position
    console.log(`  ${k} x${list.length}: ${list.slice(0, nE).map((t) => fv(t.at)).join('  ')}${list.length > nE ? '  ...' : ''}`);
  }
  const pets = T.filter((x) => x.group === 'pet');
  if (pets.length) {
    console.log('\npets');
    pets.forEach((t, i) => console.log(`  #${i} ${t.name} ${fv(t.at)}  -> ${show(t)}`));
  }
  process.exit(0);
}

// ---------- camera ----------
let at = vec(args.at), eye = vec(args.eye);
let avatarPos = null, aimed = null;
if (args.target) {
  const [name, idx] = String(args.target).split('#');
  const T = targets();
  const list = T.filter((t) => t.name === name || t.name === `cruise:${name}` || t.name === `holiday:${name}`);
  const t = list[Math.max(0, Number(idx) | 0)] || list[0];
  if (!t) { console.warn = realWarn; console.error(`no target "${name}" (try --list)`); process.exit(1); }
  aimed = t;
  at = at || t.at.slice();
}
if (args.avatar) {
  const v = vec(args.avatar);
  if (v) avatarPos = v;
  else if (args.avatar === 'spawn' || (!at && args.avatar === true)) avatarPos = spawn.slice();
  else if (aimed && aimed.ent && aimed.ent.frontCell) {
    // she stands in front of the piece
    const [x, y, z] = aimed.ent.frontCell();
    avatarPos = [x + 0.5, y, z + 0.5];
  } else if (at) {
    // her feet on the floor under the target (in front of it when it has a front)
    const off = aimed && aimed.front ? (aimed.skip ? aimed.skip * 0.6 + 1.5 : 1.5) : 0;
    const x = at[0] + (aimed && aimed.front ? aimed.front[0] * off : 0), z = at[2] + (aimed && aimed.front ? aimed.front[1] * off : 0);
    let y = aimed && Number.isFinite(aimed.base) ? aimed.base : Math.floor(at[1]);
    if (blocked(x, y, z) || blocked(x, y + 1, z)) { while (y < world.sy && (blocked(x, y, z) || blocked(x, y + 1, z))) y++; }
    else while (y > 0 && !blocked(x, y - 1, z)) y--;
    avatarPos = [Math.floor(x) + 0.5, y, Math.floor(z) + 0.5];
  }
}
if (!at) at = avatarPos ? [avatarPos[0], avatarPos[1] + 1, avatarPos[2]] : [spawn[0], spawn[1] + 1, spawn[2]];
if (avatarPos && aimed && !args.at && !args.eye && aimed.dist > 10) {
  // a big target behind her: frame her, with it as the backdrop
  at = [avatarPos[0] + (aimed.at[0] - avatarPos[0]) * 0.2, avatarPos[1] + 1.6, avatarPos[2] + (aimed.at[2] - avatarPos[2]) * 0.2];
  eye = suggestEye(at, { front: aimed.front, dist: 7 });
}
if (!eye && aimed) eye = suggestEye(at, { front: aimed.front, dist: aimed.dist, skip: aimed.skip });
if (!eye) eye = suggestEye(at, { dist: avatarPos ? 5 : 9 });
say(`camera --eye=${fv(eye)} --at=${fv(at)} --fov=${FOV}`);

// ---------- light and sky (the day-night cycle's numbers for this time of day) ----------
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Hex -> raw sRGB 0..1 (what the block shader and the sky dome mix). */
const hexRaw = (h) => { const v = parseInt(String(h).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
const mixv = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toLinear = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
const TIMES = { day: 0.3, noon: 0.4, morning: 0.26, sunset: 0.72, dusk: 0.75, night: 0.9 };
const dayTime = Number.isFinite(Number(args.time)) ? Number(args.time) : TIMES[args.time || 'day'] ?? 0.3;
const biome = game.registry.biomes.get(biomeKey);
const sky = { top: '#5FB8FF', horizon: '#CDEFFF', ...((biome && biome.sky) || {}) };
const ENV = (() => {
  const daylightMax = Math.min(1, Math.max(0.4, Number(sky.daylightMax) || 1));
  const ang = (dayTime - 0.25) * Math.PI * 2, elev = Math.sin(ang);
  const sunDir = new THREE.Vector3(Math.cos(ang) * 0.88, elev, -0.36).normalize();
  const moonDir = new THREE.Vector3(-Math.cos(ang) * 0.9, -elev * 0.8, -0.75).normalize();
  const dayF = smoothstep(-0.1, 0.22, elev), nightF = 1 - smoothstep(-0.3, 0.02, elev);
  const dusk = 1 - smoothstep(0.0, 0.36, Math.abs(elev - 0.04));
  const SUNRISE = { top: '#8E9BEB', mid: '#F0B8DA', horizon: '#FFD4AA', dusk: '#FFB892', glow: '#FFE2A8', sun: '#FFF0CC' };
  const SUNSET = { top: '#6C64D4', mid: '#E29FDC', horizon: '#FFB7A4', dusk: '#FF9DB8', glow: '#FFC592', sun: '#FFDDB8' };
  const NIGHT = { top: '#0E1346', mid: '#22286F', horizon: '#3E3A8E' };
  const pal = dayTime < 0.5 ? SUNRISE : SUNSET;
  const dayTop = hexRaw(sky.top), dayHor = hexRaw(sky.horizon), dayMid = sky.mid ? hexRaw(sky.mid) : mixv(dayHor, dayTop, 0.5);
  const duskH = hexRaw(dayTime < 0.5 ? (sky.sunrise || SUNRISE.horizon) : (sky.sunset || SUNSET.horizon));
  let top = mixv(hexRaw(sky.nightTop || NIGHT.top), dayTop, dayF), mid = mixv(hexRaw(NIGHT.mid), dayMid, dayF), horizon = mixv(hexRaw(NIGHT.horizon), dayHor, dayF);
  top = mixv(top, hexRaw(pal.top), dusk * 0.55); mid = mixv(mid, hexRaw(pal.mid), dusk * 0.85); horizon = mixv(horizon, duskH, dusk * 0.9);
  if (sky.fog && dayF > 0) horizon = mixv(horizon, hexRaw(sky.fog), dayF * (1 - dusk) * 0.6);
  const daylight = Math.min(daylightMax, Math.max(0.4, 0.4 + 0.6 * dayF));
  const ambient = Math.max(0.22, Math.min(0.6, 0.22 + 0.38 * dayF));
  let skyCol = mixv([0.8, 0.82, 1.2], [1, 1, 1], dayF);
  skyCol = mixv(skyCol, [1, 0.86, 0.76], dusk * 0.6);
  const worldR = Math.max(world.sx, world.sz);
  const ground = Math.max(world.waterLevel || 0, 16);
  const liftY = Math.max(0, eye[1] - ground - 14);
  let far = Math.max(120, Math.min(200, worldR * 0.95)) + liftY * 1.6;
  const near = far * 0.3 + liftY * 0.6;
  far = Math.max(far, near + 30);
  // Lambert lights (linear), as daynight.js sets them; three divides by PI in BRDF_Lambert
  const hemiI = (0.6 + 1.35 * dayF), sunI = 1.7 * dayF, moonI = 0.32 * nightF;
  const w = smoothstep(0.25, 0.75, dayF);
  const L = moonDir.clone().lerp(sunDir, w).normalize();
  const sunC = toLinear(w >= 0.5 ? [1, 0.95 - 0.1 * dusk, 0.88 - 0.12 * dusk] : [0.78, 0.8, 1]);
  const hemiSky = toLinear([0.75 + 0.25 * dayF, 0.78 + 0.22 * dayF, 1]), hemiGround = toLinear([0xd9 / 255, 0xc7 / 255, 1]);
  const glowC = mixv(hexRaw('#FFF3BF'), hexRaw(pal.glow), dusk), sunColor = mixv(hexRaw('#FFFCEB'), hexRaw(pal.sun), dusk);
  return {
    dayF, nightF, dusk, daylight, ambient, skyCol, top, mid, horizon, duskColor: hexRaw(pal.dusk), glowC, sunColor, sunDir, near, far,
    hemiI, sunI: Math.max(sunI, moonI), L, sunC, hemiSky, hemiGround, blockLight: [1.0, 0.86, 0.62], uDay: smoothstep(-0.2, 0.05, elev),
  };
})();
const curve = (v) => Math.pow(0.86, (1 - v) * 15);

// ---------- framebuffer and camera math ----------
const W = W0 * SS, H = H0 * SS;
const color = new Float32Array(W * H * 3);
const depth = new Float32Array(W * H).fill(Infinity);
const E = new THREE.Vector3(...eye), A = new THREE.Vector3(...at);
const fwd = A.clone().sub(E).normalize();
const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
right.normalize();
const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
const focal = (H / 2) / Math.tan((FOV * Math.PI) / 360);
const CX = W / 2, CY = H / 2, NEAR = 0.05;
const [ex, ey, ez] = eye, [rx, ry, rz] = [right.x, right.y, right.z], [ux, uy, uz] = [up.x, up.y, up.z], [fx, fy, fz] = [fwd.x, fwd.y, fwd.z];
const fogC = ENV.horizon;
const FOG_NEAR = ENV.near, FOG_FAR = ENV.far;
const RANGE = Number(args.range || FOG_FAR + 8);
// pixel -> ray length factor (distance = view depth * rayLen)
const rayLen = (px, py) => Math.sqrt(1 + ((px - CX) / focal) ** 2 + ((py - CY) / focal) ** 2);
const tanX = (W / 2) / focal, tanY = (H / 2) / focal;

// ---------- the sky ----------
{
  const s = ENV.sunDir;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const vx = (px + 0.5 - CX) / focal, vy = -(py + 0.5 - CY) / focal;
      let dx = rx * vx + ux * vy + fx, dy = ry * vx + uy * vy + fy, dz = rz * vx + uz * vy + fz;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const upv = Math.max(0, Math.min(1, dy));
      let c = mixv(ENV.horizon, ENV.mid, smoothstep(0, 0.26, upv));
      c = mixv(c, ENV.top, smoothstep(0.16, 0.9, upv));
      const sd = dx * s.x + dy * s.y + dz * s.z, toward = 0.5 + 0.5 * sd;
      const band = Math.exp(-Math.max(dy, 0) * 6) * smoothstep(-0.16, 0, dy);
      c = mixv(c, ENV.duskColor, Math.max(0, Math.min(1, ENV.dusk * band * (0.3 + 0.7 * toward * toward))));
      const s5 = Math.max(sd, 0) ** 5;
      c = c.map((v, i) => v + ENV.glowC[i] * ENV.dusk * s5 * 0.28 * (0.4 + 0.6 * band));
      if (ENV.uDay > 0.001 && sd > 0.6) {
        const ls = Math.log2(sd);
        const halo = 2 ** (ls * 1400) * 0.55 + 2 ** (ls * 90) * 0.3 + 2 ** (ls * 10) * 0.1;
        c = c.map((v, i) => v + ENV.glowC[i] * halo * ENV.uDay);
        c = mixv(c, ENV.sunColor, smoothstep(0.99845, 0.99885, sd) * ENV.uDay);
      }
      const o = (py * W + px) * 3;
      color[o] = c[0]; color[o + 1] = c[1]; color[o + 2] = c[2];
    }
  }
}

// ---------- the rasterizer ----------
// a vertex: [vx, vy, vz (view space), r, g, b (light x color multiplier), u, v]
const NV = 8;
const LIN2SRGB = new Float32Array(4097);
for (let i = 0; i <= 4096; i++) { const v = i / 4096; LIN2SRGB[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
const toSrgb = (v) => (v <= 0 ? 0 : v >= 1 ? (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) : LIN2SRGB[(v * 4096) | 0]);
const SRGB2LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const s = i / 255; SRGB2LIN[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }

const blendList = []; // see-through triangles, drawn back to front after the opaque ones
let triCount = 0;

/** Clip a view-space polygon (flat array of NV-float vertices) against the near plane. */
function clipNear(poly) {
  const n = poly.length / NV;
  let allIn = true, allOut = true;
  for (let i = 0; i < n; i++) { if (poly[i * NV + 2] < NEAR) allIn = false; else allOut = false; }
  if (allIn) return poly;
  if (allOut) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * NV, b = ((i + 1) % n) * NV;
    const za = poly[a + 2], zb = poly[b + 2];
    if (za >= NEAR) for (let k = 0; k < NV; k++) out.push(poly[a + k]);
    if ((za >= NEAR) !== (zb >= NEAR)) {
      const t = (NEAR - za) / (zb - za);
      for (let k = 0; k < NV; k++) out.push(poly[a + k] + (poly[b + k] - poly[a + k]) * t);
    }
  }
  return out.length >= 3 * NV ? out : null;
}

/**
 * Draw one view-space triangle. mat: { tex, texMode: 'block'|'img', cutout, blend, alpha,
 * linear (colors in linear space: convert to sRGB), bright (emissive block) }.
 */
function triView(poly, mat) {
  const p = clipNear(poly);
  if (!p) return;
  const n = p.length / NV;
  for (let k = 1; k + 1 < n; k++) {
    if (mat.blend) {
      const t = new Float32Array(3 * NV);
      t.set(p.slice(0, NV), 0); t.set(p.slice(k * NV, (k + 1) * NV), NV); t.set(p.slice((k + 1) * NV, (k + 2) * NV), 2 * NV);
      blendList.push({ t, mat, d: (t[2] + t[NV + 2] + t[2 * NV + 2]) / 3 });
    } else raster(p, 0, k * NV, (k + 1) * NV, mat);
  }
}

function raster(p, i0, i1, i2, mat) {
  const z0 = p[i0 + 2], z1 = p[i1 + 2], z2 = p[i2 + 2];
  const X0 = CX + (p[i0] * focal) / z0, Y0 = CY - (p[i0 + 1] * focal) / z0;
  const X1 = CX + (p[i1] * focal) / z1, Y1 = CY - (p[i1 + 1] * focal) / z1;
  const X2 = CX + (p[i2] * focal) / z2, Y2 = CY - (p[i2 + 1] * focal) / z2;
  const area = (X1 - X0) * (Y2 - Y0) - (X2 - X0) * (Y1 - Y0);
  if (!(Math.abs(area) > 1e-12)) return;
  let minX = Math.max(0, Math.floor(Math.min(X0, X1, X2))), maxX = Math.min(W - 1, Math.ceil(Math.max(X0, X1, X2)));
  let minY = Math.max(0, Math.floor(Math.min(Y0, Y1, Y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(Y0, Y1, Y2)));
  if (minX > maxX || minY > maxY) return;
  triCount++;
  const iz0 = 1 / z0, iz1 = 1 / z1, iz2 = 1 / z2;
  // attributes over z (perspective-correct)
  const a0r = p[i0 + 3] * iz0, a0g = p[i0 + 4] * iz0, a0b = p[i0 + 5] * iz0, a0u = p[i0 + 6] * iz0, a0v = p[i0 + 7] * iz0;
  const a1r = p[i1 + 3] * iz1, a1g = p[i1 + 4] * iz1, a1b = p[i1 + 5] * iz1, a1u = p[i1 + 6] * iz1, a1v = p[i1 + 7] * iz1;
  const a2r = p[i2 + 3] * iz2, a2g = p[i2 + 4] * iz2, a2b = p[i2 + 5] * iz2, a2u = p[i2 + 6] * iz2, a2v = p[i2 + 7] * iz2;
  const inv = 1 / area;
  const tex = mat.tex, blend = mat.blend, cutout = mat.cutout, linear = mat.linear;
  const isBlock = mat.texMode === 'block';
  const layerBase = isBlock ? mat.layer * 1024 : 0;
  const avg = mat.avg;
  const texData = tex ? tex.data : null, tw = tex ? tex.w : 0, th = tex ? tex.h : 0, flip = tex ? tex.flipY : false, texLin = tex ? tex.srgb : false;
  const texelPx = focal / 16; // block texel size in pixels at depth 1
  const matAlpha = mat.alpha ?? 1;
  // edge functions: top-left fill rule so shared edges are drawn once
  const e0x = Y1 - Y2, e0y = X2 - X1, e1x = Y2 - Y0, e1y = X0 - X2, e2x = Y0 - Y1, e2y = X1 - X0;
  const sgn = area > 0 ? 1 : -1;
  const tl = (ex, ey) => (sgn * ey > 0 || (ey === 0 && sgn * ex < 0) ? 0 : -1e-9);
  const b0 = tl(e0x, e0y), b1 = tl(e1x, e1y), b2 = tl(e2x, e2y);
  for (let py = minY; py <= maxY; py++) {
    const qy = py + 0.5;
    for (let px = minX; px <= maxX; px++) {
      const qx = px + 0.5;
      const w0 = ((X1 - qx) * (Y2 - qy) - (X2 - qx) * (Y1 - qy)) * inv;
      if (w0 < 0 || (w0 === 0 && b0)) continue;
      const w1 = ((X2 - qx) * (Y0 - qy) - (X0 - qx) * (Y2 - qy)) * inv;
      if (w1 < 0 || (w1 === 0 && b1)) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < 0 || (w2 === 0 && b2)) continue;
      const iz = w0 * iz0 + w1 * iz1 + w2 * iz2;
      const z = 1 / iz;
      const pi = py * W + px;
      if (z >= depth[pi]) continue;
      let r = (w0 * a0r + w1 * a1r + w2 * a2r) * z, g = (w0 * a0g + w1 * a1g + w2 * a2g) * z, b = (w0 * a0b + w1 * a1b + w2 * a2b) * z;
      let a = matAlpha;
      if (texData) {
        const u = (w0 * a0u + w1 * a1u + w2 * a2u) * z, v = (w0 * a0v + w1 * a1v + w2 * a2v) * z;
        let fu = u - Math.floor(u), fv2 = v - Math.floor(v);
        let tx = (fu * tw) | 0, ty = flip ? ((1 - fv2) * th) | 0 : (fv2 * th) | 0;
        if (tx >= tw) tx = tw - 1; if (ty >= th) ty = th - 1; if (ty < 0) ty = 0;
        const ti = layerBase + (ty * tw + tx) * 4;
        const ta = texData[ti + 3] / 255;
        if (cutout && ta < 0.5) continue;
        let tr, tg, tb;
        if (isBlock) {
          // crude mip choice: far faces show their tile's average color
          const k = TEX === 'avg' ? 0 : TEX === 'pixel' ? 1 : Math.max(0, Math.min(1, (texelPx / z) - 1.2));
          if (k < 1) { tr = avg[0] + (texData[ti] / 255 - avg[0]) * k; tg = avg[1] + (texData[ti + 1] / 255 - avg[1]) * k; tb = avg[2] + (texData[ti + 2] / 255 - avg[2]) * k; }
          else { tr = texData[ti] / 255; tg = texData[ti + 1] / 255; tb = texData[ti + 2] / 255; }
          if (blend) a *= Math.max(ta, 0.45);
        } else if (texLin) {
          tr = SRGB2LIN[texData[ti]]; tg = SRGB2LIN[texData[ti + 1]]; tb = SRGB2LIN[texData[ti + 2]];
          if (blend) a *= ta;
        } else {
          tr = texData[ti] / 255; tg = texData[ti + 1] / 255; tb = texData[ti + 2] / 255;
          if (blend) a *= ta;
        }
        r *= tr; g *= tg; b *= tb;
      }
      if (linear) { r = toSrgb(r); g = toSrgb(g); b = toSrgb(b); }
      // distance fog (sRGB, like the block shader)
      const dist = z * Math.sqrt(1 + ((qx - CX) / focal) ** 2 + ((qy - CY) / focal) ** 2);
      const fog = dist <= FOG_NEAR ? 0 : smoothstep(FOG_NEAR, FOG_FAR, dist);
      if (fog > 0) { r += (fogC[0] - r) * fog; g += (fogC[1] - g) * fog; b += (fogC[2] - b) * fog; }
      const o = pi * 3;
      if (blend) {
        a = a + (1 - a) * fog * 0.6;
        if (a <= 0.003) continue;
        color[o] += (r - color[o]) * a; color[o + 1] += (g - color[o + 1]) * a; color[o + 2] += (b - color[o + 2]) * a;
        if (a > 0.92) depth[pi] = z;
      } else {
        color[o] = r; color[o + 1] = g; color[o + 2] = b;
        depth[pi] = z;
      }
    }
  }
}

/** World -> view space into out[off..]. */
function toView(x, y, z, out, off) {
  const dx = x - ex, dy = y - ey, dz = z - ez;
  out[off] = dx * rx + dy * ry + dz * rz;
  out[off + 1] = dx * ux + dy * uy + dz * uz;
  out[off + 2] = dx * fx + dy * fy + dz * fz;
}

/** Is a world-space box (partly) inside the view frustum and range? */
function boxVisible(x0, y0, z0, x1, y1, z1) {
  const cs = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const dx = x - ex, dy = y - ey, dz = z - ez;
    cs.push([dx * rx + dy * ry + dz * rz, dx * ux + dy * uy + dz * uz, dx * fx + dy * fy + dz * fz]);
  }
  const m = 1.02;
  if (cs.every((c) => c[2] < NEAR)) return false;
  if (cs.every((c) => c[2] > RANGE)) return false;
  if (cs.every((c) => c[0] > c[2] * tanX * m)) return false;
  if (cs.every((c) => c[0] < -c[2] * tanX * m)) return false;
  if (cs.every((c) => c[1] > c[2] * tanY * m)) return false;
  if (cs.every((c) => c[1] < -c[2] * tanY * m)) return false;
  const cx = Math.max(x0, Math.min(ex, x1)), cy = Math.max(y0, Math.min(ey, y1)), cz = Math.max(z0, Math.min(ez, z1));
  return Math.hypot(cx - ex, cy - ey, cz - ez) <= RANGE;
}

// ---------- blocks: the game's own mesher over the chunks in view ----------
const atlas = blockTex.texture.image; // { data, width: 16, height: 16, depth }
const layerAvg = [];
for (let l = 0; l < blockTex.depth; l++) {
  let r = 0, g = 0, b = 0, n = 0, a = 0;
  for (let i = 0; i < 256; i++) {
    const o = (l * 256 + i) * 4;
    a += atlas.data[o + 3];
    if (atlas.data[o + 3] > 127) { r += atlas.data[o]; g += atlas.data[o + 1]; b += atlas.data[o + 2]; n++; }
  }
  layerAvg.push(n ? [r / n / 255, g / n / 255, b / n / 255, a / 256 / 255] : [1, 0, 1, 1]);
}
const emitLayers = new Set();
for (let id = 0; id < reg.defs.length; id++) if (props.emit[id] > 0) for (let f = 0; f < 6; f++) emitLayers.add(props.faceLayer[id * 6 + f] & 1023);
const blockTexObj = { data: atlas.data, w: 16, h: 16, flipY: false, srgb: false };
const matCache = new Map();
function blockMat(layer, pass) {
  const key = layer * 4 + pass;
  let m = matCache.get(key);
  if (!m) {
    m = { tex: blockTexObj, texMode: 'block', layer, avg: layerAvg[layer], cutout: pass === 2, blend: pass === 3, alpha: 1, linear: false, bright: emitLayers.has(layer) };
    matCache.set(key, m);
  }
  return m;
}
const mesher = new Mesher(world);
const CH = 16;
let chunksDrawn = 0;
const tri = new Float32Array(3 * NV);
const vlight = (shade, ls, lb, bright) => {
  if (bright) return [1.08, 1.08, 1.08];
  const sk = curve(ls) * ENV.daylight;
  const bl = lb > 0.01 ? curve(lb) : 0;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = shade * Math.max(ENV.skyCol[i] * sk, ENV.blockLight[i] * bl, ENV.ambient);
  return out;
};
for (let cz = 0; cz * CH < world.sz; cz++) {
  for (let cx = 0; cx * CH < world.sx; cx++) {
    const x0 = cx * CH, z0 = cz * CH;
    if (!boxVisible(x0, 0, z0, Math.min(world.sx, x0 + CH), world.sy, Math.min(world.sz, z0 + CH))) continue;
    const parts = mesher.build(cx, cz);
    chunksDrawn++;
    for (const [pass, part] of [[1, parts.opaque], [2, parts.cutout], [3, parts.translucent]]) {
      if (!part) continue;
      const P = part.position, UV = part.uv, LA = part.layer, SH = part.shade, LI = part.light, I = part.index;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], b = I[t + 1], c = I[t + 2];
        const ax = P[a * 3] + x0, ay = P[a * 3 + 1], az = P[a * 3 + 2] + z0;
        const bx = P[b * 3] + x0, by = P[b * 3 + 1], bz = P[b * 3 + 2] + z0;
        const qx = P[c * 3] + x0, qy = P[c * 3 + 1], qz = P[c * 3 + 2] + z0;
        // back faces (faces are counter-clockwise seen from outside); cutout / see-through: both sides
        if (pass === 1) {
          const nx = (by - ay) * (qz - az) - (bz - az) * (qy - ay), ny = (bz - az) * (qx - ax) - (bx - ax) * (qz - az), nz = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
          if (nx * (ex - ax) + ny * (ey - ay) + nz * (ez - az) <= 0) continue;
        }
        if (CUT !== null && Math.min(ay, by, qy) >= CUT - 1e-6) continue;
        const layer = LA[a] & 1023;
        const m = blockMat(layer, pass);
        let k = 0;
        for (const [vi, X, Y, Z] of [[a, ax, ay, az], [b, bx, by, bz], [c, qx, qy, qz]]) {
          toView(X, Y, Z, tri, k);
          const L = vlight(SH[vi] / 255, LI[vi * 2] / 255, LI[vi * 2 + 1] / 255, m.bright);
          tri[k + 3] = L[0]; tri[k + 4] = L[1]; tri[k + 5] = L[2];
          tri[k + 6] = UV[vi * 2]; tri[k + 7] = UV[vi * 2 + 1];
          k += NV;
        }
        if (tri[2] < NEAR && tri[NV + 2] < NEAR && tri[2 * NV + 2] < NEAR) continue;
        triView(tri.slice(), m);
      }
    }
  }
}
const tBlocks = performance.now();

// ---------- the avatar (optional) ----------
let avatarInfo = '';
if (avatarPos) {
  const { createAvatar } = await import('../src/player/avatar.js');
  const WD = await import('../src/player/wardrobe-data.js');
  const GM = await import('../src/things/gifts/models.js');
  const lookKey = String(args.look || 'santa');
  const outfit = WD.HOLIDAY_OUTFITS.find((o) => o.key === lookKey);
  if (!outfit && lookKey !== 'default') { console.warn = realWarn; console.error(`no look "${lookKey}" (have: default, ${WD.HOLIDAY_OUTFITS.map((o) => o.key).join(', ')})`); process.exit(1); }
  const look = WD.normalizeLook(outfit ? { ...WD.DEFAULT_LOOK, ...outfit.look } : WD.DEFAULT_LOOK);
  const av = createAvatar(look, { fx: null, blink: false });
  if (args.hold !== 'none') {
    const [paper = 'red', pattern = 'stars', ribbon = 'gold', bow = 'bow', box = 'small'] = String(args.gift || '').split(',').filter(Boolean);
    av.hold(GM.heldGiftModel({ box, paper, pattern, ribbon, bow }), 'hold');
  }
  for (let i = 0; i < 6; i++) av.update(1 / 30, { onGround: true });
  const yaw = args.yaw !== undefined ? (Number(args.yaw) * Math.PI) / 180 : Math.atan2(eye[0] - avatarPos[0], eye[2] - avatarPos[2]);
  av.group.position.set(...avatarPos);
  av.group.rotation.y = yaw;
  game.scene.add(av.group);
  avatarInfo = ` avatar ${lookKey} at ${fv(avatarPos)}${args.hold !== 'none' ? ' holding a gift' : ''}`;
}

// ---------- entities: every visible mesh in the scene ----------
const imgTexCache = new Map();
function texOf(map) {
  if (!map) return null;
  if (imgTexCache.has(map)) return imgTexCache.get(map);
  let t = null;
  const img = map.image;
  if (img && img._data && img.width) t = { data: img._data, w: img.width, h: img.height, flipY: map.flipY !== false, srgb: map.colorSpace === THREE.SRGBColorSpace };
  else if (img && img.data && img.width && !map.isDataArrayTexture) t = { data: img.data, w: img.width, h: img.height, flipY: false, srgb: map.colorSpace === THREE.SRGBColorSpace }; // data rows start at v = 0
  imgTexCache.set(map, t);
  return t;
}
const atlasTex = arrayTextures.filter((t) => t.userData && t.userData.shared && t.image && t.image.width === 16).pop();
const furnAtlas = atlasTex ? { data: atlasTex.image.data, w: 16, h: 16, flipY: false, srgb: true } : null;
const furnLayerTex = new Map();
function atlasLayerTex(layer) {
  let t = furnLayerTex.get(layer);
  if (!t) { t = { data: furnAtlas.data.subarray(layer * 1024, (layer + 1) * 1024), w: 16, h: 16, flipY: false, srgb: true }; furnLayerTex.set(layer, t); }
  return t;
}
const skipped = new Map();
let meshCount = 0, objTris = 0;
const nrm = new THREE.Matrix3(), vA = new THREE.Vector3(), nA = new THREE.Vector3();
const hemiS = ENV.hemiSky, hemiG = ENV.hemiGround, Ld = ENV.L, sunC = ENV.sunC;
const INV_PI = 1 / Math.PI;
const blkLin = toLinear(ENV.blockLight);
function lambert(nx, ny, nz, wx, wy, wz, out) {
  const h = 0.5 * ny + 0.5;
  const d = Math.max(0, nx * Ld.x + ny * Ld.y + nz * Ld.z);
  const lb = world.getBlockLight(Math.floor(wx), Math.floor(wy), Math.floor(wz)) / 15;
  const bl = lb > 0.01 ? curve(lb) * 0.55 * (1.15 - 0.75 * ENV.dayF) : 0;
  for (let i = 0; i < 3; i++) out[i] = (hemiG[i] + (hemiS[i] - hemiG[i]) * h) * ENV.hemiI * INV_PI + sunC[i] * ENV.sunI * d * INV_PI + blkLin[i] * bl;
}
const Lc = [0, 0, 0];

function drawMesh(o) {
  const g = o.geometry;
  if (!g || !g.attributes || !g.attributes.position) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
  const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, UV = g.attributes.uv, LK = g.attributes.fLook;
  const idx = g.index ? g.index.array : null;
  const total = idx ? idx.length : P.count;
  const instances = o.isInstancedMesh ? o.count : 1;
  const im = new THREE.Matrix4(), wm = new THREE.Matrix4();
  for (let inst = 0; inst < instances; inst++) {
    if (o.isInstancedMesh) { o.getMatrixAt(inst, im); wm.multiplyMatrices(o.matrixWorld, im); } else wm.copy(o.matrixWorld);
    nrm.getNormalMatrix(wm);
    const flipW = wm.determinant() < 0;
    for (const grp of groups) {
      const m = mats[grp.materialIndex | 0];
      if (!m || m.visible === false || m.colorWrite === false) continue;
      if (m.isShaderMaterial || m.isRawShaderMaterial || m.isSpriteMaterial || m.isPointsMaterial || m.isLineBasicMaterial) { skipped.set(m.type + (m.name ? ':' + m.name : ''), (skipped.get(m.type) || 0) + 1); continue; }
      const opacity = m.opacity ?? 1;
      if (m.transparent && opacity <= 0.01) continue;
      const basic = m.isMeshBasicMaterial;
      const mc = m.color || new THREE.Color(1, 1, 1);
      const em = m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b) ? m.emissive : null;
      const emI = m.emissiveIntensity ?? 1;
      const atlasMat = !!(m.userData && m.userData.atlas);
      const tex = atlasMat ? null : texOf(m.map);
      const uvM = m.map && !atlasMat ? (m.map.updateMatrix(), m.map.matrix) : null;
      const blend = !!m.transparent && (opacity < 0.999 || !!tex);
      const cutout = (m.alphaTest || 0) > 0 || (!!m.transparent && !!tex && !blend);
      const side = m.side;
      const start = grp.start, end = Math.min(total, grp.start + grp.count);
      const baseMat = { tex, texMode: 'img', cutout, blend, alpha: blend ? opacity : 1, linear: true, bright: false };
      const layerMats = new Map();
      for (let t = start; t + 2 < end; t += 3) {
        const ids = [idx ? idx[t] : t, idx ? idx[t + 1] : t + 1, idx ? idx[t + 2] : t + 2];
        const w = [];
        for (const id of ids) { vA.fromBufferAttribute(P, id).applyMatrix4(wm); w.push(vA.x, vA.y, vA.z); }
        if (CUT !== null && Math.min(w[1], w[4], w[7]) >= CUT - 0.01) continue; // above the cutaway
        // which side faces the camera
        const ax = w[0], ay = w[1], az = w[2];
        let nx = (w[4] - ay) * (w[8] - az) - (w[5] - az) * (w[7] - ay), ny = (w[5] - az) * (w[6] - ax) - (w[3] - ax) * (w[8] - az), nz = (w[3] - ax) * (w[7] - ay) - (w[4] - ay) * (w[6] - ax);
        if (flipW) { nx = -nx; ny = -ny; nz = -nz; }
        const facing = nx * (ex - ax) + ny * (ey - ay) + nz * (ez - az) > 0;
        if (side === THREE.FrontSide && !facing) continue;
        if (side === THREE.BackSide && facing) continue;
        const flipN = side === THREE.DoubleSide && !facing ? -1 : side === THREE.BackSide ? -1 : 1;
        let mat = baseMat;
        let glow = 0;
        if (atlasMat && LK) {
          const layer = Math.round(LK.getX(ids[0]));
          glow = LK.getY(ids[0]);
          if (layer >= 0 && furnAtlas) {
            mat = layerMats.get(layer);
            if (!mat) { mat = { ...baseMat, tex: atlasLayerTex(layer) }; layerMats.set(layer, mat); }
          }
        }
        let k = 0;
        for (let j = 0; j < 3; j++) {
          const id = ids[j];
          const X = w[j * 3], Y = w[j * 3 + 1], Z = w[j * 3 + 2];
          toView(X, Y, Z, tri, k);
          let cr = mc.r, cg = mc.g, cb = mc.b;
          if (C && m.vertexColors) { cr *= C.getX(id); cg *= C.getY(id); cb *= C.getZ(id); }
          if (basic) { Lc[0] = 1; Lc[1] = 1; Lc[2] = 1; }
          else {
            if (N) nA.fromBufferAttribute(N, id).applyMatrix3(nrm).normalize().multiplyScalar(flipN);
            else nA.set(nx, ny, nz).normalize().multiplyScalar(flipN);
            lambert(nA.x, nA.y, nA.z, X + nA.x * 0.3, Y + nA.y * 0.3, Z + nA.z * 0.3, Lc);
          }
          const gl = atlasMat && LK ? LK.getY(id) : glow;
          tri[k + 3] = cr * Lc[0] + cr * gl + (em ? em.r * emI : 0);
          tri[k + 4] = cg * Lc[1] + cg * gl + (em ? em.g * emI : 0);
          tri[k + 5] = cb * Lc[2] + cb * gl + (em ? em.b * emI : 0);
          let u = UV ? UV.getX(id) : 0, v = UV ? UV.getY(id) : 0;
          if (uvM) { const e = uvM.elements; const uu = e[0] * u + e[3] * v + e[6]; v = e[1] * u + e[4] * v + e[7]; u = uu; }
          tri[k + 6] = u; tri[k + 7] = v;
          k += NV;
        }
        if (tri[2] < NEAR && tri[NV + 2] < NEAR && tri[2 * NV + 2] < NEAR) continue;
        if (tri[2] > RANGE && tri[NV + 2] > RANGE && tri[2 * NV + 2] > RANGE) continue;
        objTris++;
        triView(tri.slice(), mat);
      }
    }
  }
}

game.scene.updateMatrixWorld(true);
game.scene.traverseVisible((o) => {
  if (!o.isMesh || o.userData.hitbox) return;
  const g = o.geometry;
  if (g) {
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = g.boundingSphere;
    if (s && !o.isInstancedMesh) {
      const c = s.center.clone().applyMatrix4(o.matrixWorld);
      const r = s.radius * o.matrixWorld.getMaxScaleOnAxis();
      if (!boxVisible(c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r)) return;
      if (CUT !== null && c.y - r >= CUT) return;
    }
  }
  meshCount++;
  drawMesh(o);
});
const tObjs = performance.now();

// ---------- the horizon ring beyond the world's edge (ocean or snow), then see-through ----------
if (world.outside && world.outside.block) {
  const def = reg.byKey(world.outside.block);
  if (def) {
    const layer = props.faceLayer[def.id * 6 + 2] & 1023;
    const liquid = props.shape[def.id] === SHAPES.liquid;
    const top = layerAvg[layer];
    const ys = world.outside.surface;
    const L = vlight(1, 1, 0, false);
    // the seabed under an ocean ring: the world's edge block at the water's depth
    let bed = top;
    if (liquid) {
      let y = Math.floor(ys) - 1;
      while (y > 0 && props.shape[world.get(0, y, 0)] === SHAPES.liquid) y--;
      const id = world.get(0, y, 0);
      bed = id ? layerAvg[props.faceLayer[id * 6 + 2] & 1023] : top;
    }
    const alpha = liquid ? Math.max(0.55, top[3]) : 1;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const vx = (px + 0.5 - CX) / focal, vy = -(py + 0.5 - CY) / focal;
        const dx = rx * vx + ux * vy + fx, dy = ry * vx + uy * vy + fy, dz = rz * vx + uz * vy + fz; // view depth 1
        if (dy >= -1e-6) continue;
        const t = (ys - ey) / dy;
        if (t <= 0) continue;
        const hx = ex + dx * t, hz = ez + dz * t;
        if (hx >= 0 && hz >= 0 && hx < world.sx && hz < world.sz) continue;
        const pi = py * W + px;
        if (t >= depth[pi]) continue;
        let c = top.slice(0, 3);
        if (liquid) c = mixv(bed.map((v) => v * 0.55), top, alpha);
        c = c.map((v, i) => v * L[i]);
        const dist = t * Math.hypot(dx, dy, dz);
        c = mixv(c, fogC, dist <= FOG_NEAR ? 0 : smoothstep(FOG_NEAR, FOG_FAR, dist));
        const o = pi * 3;
        color[o] = c[0]; color[o + 1] = c[1]; color[o + 2] = c[2];
        depth[pi] = t;
      }
    }
  }
}
blendList.sort((a, b) => b.d - a.d);
for (const { t, mat } of blendList) raster(t, 0, NV, 2 * NV, mat);
const tRaster = performance.now();

// ---------- downsample and write ----------
const out = new Uint8Array(W0 * H0 * 4);
for (let y = 0; y < H0; y++) {
  for (let x = 0; x < W0; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const o = ((y * SS + sy) * W + x * SS + sx) * 3;
      r += Math.min(1, Math.max(0, color[o])); g += Math.min(1, Math.max(0, color[o + 1])); b += Math.min(1, Math.max(0, color[o + 2]));
    }
    const k = 255 / (SS * SS), o = (y * W0 + x) * 4;
    out[o] = Math.round(r * k); out[o + 1] = Math.round(g * k); out[o + 2] = Math.round(b * k); out[o + 3] = 255;
  }
}
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
const file = path.resolve(ROOT, args.out || `.shots/sceneview/${biomeKey}-${seed}.png`);
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, png(W0, H0, out));
console.warn = realWarn; console.error = realError;
const ms = (a, b) => `${((b - a) / 1000).toFixed(1)} s`;
say(`${biomeKey} ${sizeName} seed ${seed} t=${dayTime}:${avatarInfo} ${chunksDrawn} chunks, ${meshCount} meshes (${objTris} tris), ${triCount} triangles drawn, ${blendList.length} see-through`);
say(`time: world ${ms(T0, tGen)}, blocks ${ms(tGen, tBlocks)}, entities ${ms(tBlocks, tObjs)}, raster+sky ${ms(tObjs, tRaster)}, total ${ms(T0, performance.now())}`);
if (skipped.size && VERBOSE) say('skipped materials:', [...skipped.entries()].map(([k, v]) => `${k} x${v}`).join(', '));
if (VERBOSE && muted.length) say('muted warnings:', [...new Set(muted)].slice(0, 20).join(' | '));
say('wrote', path.relative(process.cwd(), file) || file);
