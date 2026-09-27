// Multiplayer net-core tests (docs/MULTIPLAYER.md §15.1), no browser:
//   node tools/test-net.mjs                 unit tests + property test (20 seeds) + server tests + WebSocket property test
//   node tools/test-net.mjs --only=unit     just the unit tests (also: prop, server, ws)
//   node tools/test-net.mjs --seeds=5 --steps=2000 --seed=7
// The WebSocket tests start server/server.mjs on a random port; they need dist/sparkle-world.html
// (npm run build) for the page tests.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';

import { SimClock, NetHub, mulberry32 } from './net/hub.mjs';
import { makeSession, scenario, simNet, wsNet, setVerbose } from './net/scenario.mjs';
import { FakeAdapter, B, BLOCKS, FURNITURE, CROPS } from './net/fake-adapter.mjs';
import { LoopTransport } from '../src/net/loop-transport.js';
import { WsTransport } from '../src/net/ws-transport.js';
import { NetSession } from '../src/net/session.js';
import { Journal, buildPayload } from '../src/net/journal.js';
import { TokenBucket, StateBox, Pacer, NetError, jsonBytes, realClock } from '../src/net/transport.js';
import { RoomRegistry } from '../server/rooms.mjs';
import * as codec from '../src/net/codec.js';
import * as proto from '../src/net/protocol.js';
import * as wardrobe from '../src/player/wardrobe-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? '1'] : [a, '1'];
}));
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const SEEDS = +(args.seeds || 20);
const STEPS = +(args.steps || 5000);
const FIRST_SEED = +(args.seed || 1);
const VERBOSE = !!args.verbose;
setVerbose(VERBOSE);

let failures = 0;
let passed = 0;
const results = [];

function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}
function eq(a, b, msg) {
  const ta = JSON.stringify(a), tb = JSON.stringify(b);
  if (ta !== tb) throw new Error(`${msg}: expected ${tb.slice(0, 300)} got ${ta.slice(0, 300)}`);
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    passed++;
    const line = `  ok   ${name} (${Date.now() - t0} ms)${info ? ' - ' + info : ''}`;
    results.push(line);
    console.log(line);
  } catch (err) {
    failures++;
    const line = `  FAIL ${name}: ${err && err.stack ? err.stack : err}`;
    results.push(line);
    console.log(line);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const track = (p) => {
  const s = { done: false, value: undefined, error: null };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
};

// =====================================================================================
// Unit tests
// =====================================================================================

async function unitTests() {
  console.log('\nUnit tests');
  const rand = mulberry32(12345);
  const ri = (n) => Math.floor(rand() * n);

  await test('codec: cells round trip', () => {
    const pairs = [];
    for (let k = 0; k < 5000; k++) pairs.push(ri(208 * 64 * 208), ri(256));
    const s = codec.packCells(pairs);
    eq(s.length, 7 * 5000, 'length');
    eq(codec.unpackCells(s), pairs, 'cells');
    assert(codec.unpackCells('00000') === null, 'bad length');
    assert(codec.unpackCells('0000!zz') === null, 'bad digit');
  });

  await test('codec: outbox b round trip', () => {
    const tr = [];
    for (let k = 0; k < 100; k++) tr.push(ri(2768896), ri(256), ri(256));
    const s = codec.packB(tr);
    eq(s.length, 900, 'length');
    eq(codec.unpackB(s), tr, 'triples');
  });

  await test('codec: regions round trip (random boxes, noisy and flat)', () => {
    const sx = 48, sy = 20, sz = 40;
    const cells = new Uint8Array(sx * sy * sz);
    for (let i = 0; i < cells.length; i++) cells[i] = rand() < 0.5 ? 0 : ri(4) + (i % 7 === 0 ? ri(250) : 0);
    for (let k = 0; k < 200; k++) {
      const dx = 1 + ri(16), dy = 1 + ri(12), dz = 1 + ri(16);
      const x0 = ri(sx - dx), y0 = ri(sy - dy), z0 = ri(sz - dz);
      const b64 = codec.encodeRegion((i) => cells[i], sx, sz, x0, y0, z0, dx, dy, dz);
      const out = [];
      eq(codec.decodeRegion([x0, y0, z0, dx, dy, dz, b64], sx, sz, out), dx * dy * dz, 'count');
      for (let j = 0; j < out.length; j += 2) if (cells[out[j]] !== out[j + 1]) throw new Error('region mismatch');
    }
    assert(codec.decodeRegion([0, 0, 0, 2, 2, 2, codec.bytesToBase64(new Uint8Array([1, 3]))], sx, sz, []) === -1, 'short RLE rejected');
  });

  await test('codec: RLE round trip', () => {
    const src = new Uint8Array(100000);
    for (let i = 0; i < src.length; i++) src[i] = i % 1000 < 900 ? 3 : ri(256);
    const rle = codec.rleEncode(src);
    const dst = new Uint8Array(src.length);
    eq(codec.rleDecode(rle, dst), src.length, 'decoded');
    assert(Buffer.compare(Buffer.from(dst), Buffer.from(src)) === 0, 'same bytes');
  });

  await test('codec: look round trip for every option', () => {
    const lists = {
      'hair.style': wardrobe.HAIR_STYLES, 'hair.mix': wardrobe.HAIR_MIXES, 'face.smile': wardrobe.SMILES,
      'top.type': wardrobe.TOPS, 'top.pattern': wardrobe.PATTERNS, 'bottom.type': wardrobe.BOTTOMS, 'bottom.pattern': wardrobe.PATTERNS,
      'dress.type': wardrobe.DRESSES, 'dress.pattern': wardrobe.PATTERNS, 'shoes.type': wardrobe.SHOES,
      'acc.head': wardrobe.HEAD_ACC, 'acc.face': wardrobe.FACE_ACC, 'acc.back': wardrobe.BACK_ACC, 'acc.neck': wardrobe.NECK_ACC, 'acc.hand': wardrobe.HAND_ACC,
    };
    let n = 0;
    const check = (look) => {
      const norm = wardrobe.normalizeLook(look);
      const packed = codec.packLook(norm);
      assert(packed.length <= 160, 'look <= 160 chars: ' + packed.length);
      const back = codec.unpackLook(packed, norm.name);
      eq(back, norm, 'look');
      n++;
    };
    for (const [pathKey, list] of Object.entries(lists)) {
      for (const opt of list) {
        const look = wardrobe.normalizeLook({ name: 'Mia' });
        const [a, b] = pathKey.split('.');
        if (a === 'dress' && !look.dress) look.dress = { type: 'party', color: '#FF8CC6', pattern: 'none', patternColor: '#FFFFFF' };
        look[a][b] = opt.key;
        check(look);
      }
    }
    for (let k = 0; k < 200; k++) check(wardrobe.randomLook(rand, 'Zoe'));
    const l2 = wardrobe.normalizeLook({ hair: { style: 'bob', color: '#123456', color2: 'rainbow' }, acc: { faceColor: '#ABCDEF', handColor: '#00FF00' } });
    check(l2);
    const l3 = wardrobe.normalizeLook({ hair: { color2: '#FEDCBA' } });
    check(l3);
    eq(codec.unpackLook('garbage.tokens', 'X').hair.style, 'long', 'defaults for garbage');
    return `${n} looks`;
  });

  await test('codec: snapshot framing, crc and compression', async () => {
    const json = { v: 1, name: "Lily's World", entities: [[1, 'bed', 1, 2, 3, 0, 0, { open: true }, 0, 0]], txt: 'héllo ✨ 🦄' };
    const rle = codec.rleEncode(new Uint8Array(40000).map((_, i) => (i < 20000 ? 1 : i % 3)));
    for (const compress of [false, true]) {
      const fr = await codec.frameSnapshot(json, rle, { compress });
      assert(fr.chunks.every((c) => c.length <= proto.C.CHUNK_CHARS), 'chunk size');
      const msg = { k: 's', e: 'abcdef', id: 's1', s0: 123456, i: fr.chunks.length - 1, n: fr.chunks.length, z: fr.z, c: fr.c, d: fr.chunks[0] };
      assert(jsonBytes(msg) <= proto.C.MSG_BYTES, 'chunk message <= 3900 B: ' + jsonBytes(msg));
      const back = await codec.unframeSnapshot(fr.chunks, fr.z, fr.c);
      eq(back.json, { ...json, blocks: '' }, 'json');
      assert(Buffer.compare(Buffer.from(back.rle), Buffer.from(rle)) === 0, 'rle');
      const bad = fr.chunks.slice();
      const c0 = bad[0];
      bad[0] = (c0[5] === 'A' ? 'B' : 'A') + c0.slice(1);
      let threw = null;
      try {
        await codec.unframeSnapshot(bad.map((c, k) => (k === 0 ? c0.slice(0, 5) + (c0[5] === 'A' ? 'B' : 'A') + c0.slice(6) : c)), fr.z, fr.c);
      } catch (e) {
        threw = e.message;
      }
      assert(threw === 'crc' || threw === 'frame' || threw === 'json', 'corruption detected: ' + threw);
    }
    assert(codec.canDeflate(), 'deflate-raw available in Node 22');
  });

  await test('codec: stableStringify, fnv1a32, splitForJson', () => {
    eq(codec.stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}', 'stable');
    eq(codec.fnv1a32(''), 0x811c9dc5, 'fnv empty');
    eq(codec.fnv1a32(new Uint8Array([97])), 0xe40c292c, 'fnv "a" bytes');
    const s = 'a"b\\c\n' + 'é✨🦄'.repeat(300) + 'x'.repeat(5000) + '\u0001';
    const pieces = codec.splitForJson(s, 700, 600);
    eq(pieces.join(''), s, 'rejoin');
    for (const p of pieces) {
      assert(jsonBytes(p) <= 700, 'piece bytes ' + jsonBytes(p));
      assert(p.length <= 600, 'piece chars');
      assert(!/[\ud800-\udbff]$/.test(p), 'no split surrogate');
    }
    eq(codec.utf8Length('é✨🦄a'), Buffer.byteLength('é✨🦄a'), 'utf8Length');
  });

  await test('hash: incremental block hash equals full scan after 10,000 random sets', () => {
    const ad = new FakeAdapter({ size: [40, 16, 40] });
    let h = codec.blockHashOf((i) => ad.cells[i], ad.cells.length);
    ad.hooks = {
      cell: (i, prev, id) => {
        if (prev !== 0) h = (h - codec.blockMix(i, prev)) >>> 0;
        if (id !== 0) h = (h + codec.blockMix(i, id)) >>> 0;
      },
      ent() {}, plant() {}, actor() {},
    };
    for (let k = 0; k < 10000; k++) ad._set(ri(ad.cells.length), rand() < 0.3 ? 0 : ri(BLOCKS.length));
    eq(h, codec.blockHashOf((i) => ad.cells[i], ad.cells.length), 'hash');
  });

  await test('journal: batches and fixes never exceed 3,900 B; keys get sequence numbers', () => {
    const ad = new FakeAdapter({ size: [64, 16, 64] });
    const j = new Journal();
    // scattered cells, a dense column (regions), noisy regions, entities with data, plants, actors
    for (let k = 0; k < 3000; k++) {
      const i = ri(ad.cells.length);
      ad.cells[i] = ri(BLOCKS.length);
      j.touchCell(i);
    }
    for (let y = 1; y < 15; y++) for (let z = 16; z < 32; z++) for (let x = 16; x < 32; x++) {
      const i = ad.idx(x, y, z);
      ad.cells[i] = ri(BLOCKS.length);
      j.touchCell(i);
    }
    for (let k = 0; k < 200; k++) {
      const e = ad._put([k + 1, 'easel', ri(60), 5, ri(60), 0, '#FFB6D9', { art: 'x'.repeat(ri(400)), n: k }, 0, 0]);
      j.touchEnt(e.uid);
    }
    j.touchEnt(999999); // removed
    for (let k = 0; k < 100; k++) {
      const i = ad.idx(ri(64), 5, ri(64));
      ad.plants.set(i, { crop: 'carrot', stage: ri(4) });
      j.touchPlant(i);
    }
    j.touchActor('pet:rex');
    const { msgs } = j.flush(ad, { e: 'ep0001', a: [[1, 5], [2, 7]], r: [[1, 4, 2]] });
    assert(msgs.length > 5, 'several messages');
    for (const m of msgs) assert(jsonBytes(m) <= proto.C.MSG_BYTES, 'batch bytes ' + jsonBytes(m));
    for (let k = 1; k < msgs.length; k++) eq(msgs[k].s, msgs[k - 1].s + 1, 'consecutive seq');
    assert(msgs[0].a && !msgs[1].a, 'acks only in the first part');
    // applying every batch to a copy gives the same world
    const copy = new FakeAdapter({ size: [64, 16, 64], empty: false });
    for (const m of msgs) {
      const p = proto.parseBatch(m);
      assert(p, 'parses');
      const cells = [];
      if (p.c) codec.unpackCells(p.c, cells);
      for (const g of p.g || []) codec.decodeRegion(g, 64, 64, cells);
      copy.applyPayload({ X: p.X, cells, E: p.E, P: p.P, K: p.K });
    }
    for (let i = 0; i < ad.cells.length; i++) if (j.cells.has(i) && copy.cells[i] !== ad.cells[i]) throw new Error('cell ' + i);
    // a fix from 0 holds everything, and splits into <= 3,900 B parts
    const payload = buildPayload(ad, j.since(0));
    const text = JSON.stringify(payload);
    const pieces = codec.splitForJson(text, proto.C.MSG_BYTES - 166, proto.C.CHUNK_CHARS);
    for (let i = 0; i < pieces.length; i++) {
      const m = { k: 'f', e: 'ep0001', to: 'p'.repeat(16), id: 'f1', from: 0, upto: 123456, i, n: pieces.length, d: pieces[i] };
      assert(jsonBytes(m) <= proto.C.MSG_BYTES, 'fix part bytes ' + jsonBytes(m));
    }
    eq(JSON.parse(pieces.join('')), payload, 'fix rejoins');
    return `${msgs.length} batches, fix ${pieces.length} parts`;
  });

  await test('journal: floor rises when above the key limit', () => {
    const ad = new FakeAdapter({ size: [64, 16, 64] });
    const j = new Journal({ maxKeys: 1000 });
    for (let k = 0; k < 30; k++) {
      for (let n = 0; n < 100; n++) j.touchCell(k * 100 + n);
      j.flush(ad, { e: 'x' });
    }
    assert(j.floor > 0, 'floor rose');
    assert(j.size <= 1000, 'size bounded');
    for (const s of j.cells.values()) assert(s > j.floor, 'kept newer than floor');
  });

  await test('transport: token bucket, state box limits, pacer priorities', async () => {
    const b = new TokenBucket(30, 60, 0);
    let n = 0;
    while (b.take(0)) n++;
    eq(n, 60, 'burst');
    assert(!b.take(10) && b.take(34), 'refill ~33 ms/token');
    const box = new StateBox(200);
    box.merge({ a: 1, b: 'x' });
    let threw = false;
    try {
      box.merge({ c: 'y'.repeat(300) });
    } catch (e) {
      threw = e instanceof NetError && e.code === 'too_big';
    }
    assert(threw, 'too_big thrown');
    eq(box.state, { a: 1, b: 'x' }, 'nothing applied');
    eq(box.takePatch(), { patch: { a: 1, b: 'x' }, replace: true }, 'first send replaces');
    box.merge({ a: 2, b: null });
    eq(box.takePatch(), { patch: { a: 2, b: null }, replace: false }, 'diff with delete');
    box.merge({ a: 2 });
    eq(box.takePatch(), null, 'no change, no patch');
    const clock = new SimClock(0);
    const sent = [];
    const pacer = new Pacer({ clock, rate: 10, burst: 2, isUp: () => true, emit: (t, d) => sent.push(d.n), sendState: () => sent.push('S') });
    pacer.send('op', { n: 1 }, 1);
    pacer.send('op', { n: 2 }, 1);
    eq(pacer.send('bulk', { n: 3 }, 3), 'queued', 'queued past burst');
    pacer.send('bulk', { n: 4 }, 2);
    pacer.send('ctl', { n: 5 }, 0);
    pacer.requestState(true);
    await clock.advance(1000);
    eq(sent, [1, 2, 'S', 5, 4, 3], 'presence first, then ctl > op > fix > snapshot');
    pacer.send('bulk', { n: 6 }, 3);
    pacer.send('bulk', { n: 7 }, 3);
    pacer.send('bulk', { n: 8 }, 3);
    pacer.send('bulk', { n: 9 }, 3);
    await clock.advance(0);
    pacer.linkDown();
    await clock.advance(3000);
    assert(!sent.includes(9), 'queue dropped when the link goes down');
  });

  await test('rooms: presence merge, hand-off, clear on leave, stamps, roster, grace', () => {
    let now = 0;
    const reg = new RoomRegistry({ maxPeers: 3, stateBytes: 200, graceMs: 1000, now: () => now });
    const inbox = { a: [], b: [], c: [], d: [] };
    const sink = (k) => (f) => inbox[k].push(f);
    assert(reg.join('sw1-heart-star-moon-cat', 'A', sink('a'), { by: 'uA' }).ok, 'A joins');
    eq(inbox.a[0].self, 'A', 'welcome self');
    assert(reg.handle('sw1-heart-star-moon-cat', 'A', { t: 's', patch: { r: 'h', n: 1 } }) === null, 'state ok');
    assert(reg.join('sw1-heart-star-moon-cat', 'B', sink('b'), { by: 'uA' }).ok, 'B joins');
    const wb = inbox.b[0];
    eq(wb.reset, true, 'B gets the whole roster');
    eq(wb.j.find((e) => e.peer === 'A').state, { r: 'h', n: 1 }, 'hand-off to newcomer');
    eq(wb.j.find((e) => e.peer === 'A').isMe, true, 'same user: isMe (other tab)');
    eq(wb.j.find((e) => e.peer === 'A').sameTab, false, 'not sameTab');
    eq(inbox.a.at(-1).j[0].peer, 'B', 'A sees B joined');
    reg.handle('sw1-heart-star-moon-cat', 'A', { t: 's', patch: { n: 2, r: null } });
    eq(inbox.b.at(-1), { t: 'p', u: [['A', { n: 2, r: null }]] }, 'B sees the patch');
    eq(reg.handle('sw1-heart-star-moon-cat', 'A', { t: 's', patch: { big: 'x'.repeat(300) } }).code, 'too_big', 'presence limit');
    eq(reg.handle('sw1-heart-star-moon-cat', 'A', { t: 's', patch: { 'bad-key': 1 } }).code, 'bad_state', 'identifier keys');
    reg.handle('sw1-heart-star-moon-cat', 'B', { t: 'b', topic: 'sw.op', data: { x: 1 } });
    const fa = inbox.a.at(-1), fb = inbox.b.at(-1);
    eq([fa.from.peer, fa.from.sameTab, fa.from.isMe, fa.from.kind, fa.from.guest], ['B', false, true, 'viewer', false], 'stamp for A');
    eq([fb.from.sameTab, fb.from.isMe], [true, true], 'echo to sender');
    eq(reg.handle('sw1-heart-star-moon-cat', 'B', { t: 'b', topic: 'sw.op', data: { x: 'y'.repeat(4000) } }).code, 'too_big', 'message limit');
    assert(reg.join('sw1-heart-star-moon-cat', 'C', sink('c'), {}).ok, 'C joins');
    eq(reg.join('sw1-heart-star-moon-cat', 'D', sink('d'), {}).code, 'full', 'room cap');
    reg.detach('sw1-heart-star-moon-cat', 'C');
    now = 500;
    reg.sweep();
    assert(reg.has('sw1-heart-star-moon-cat', 'C'), 'kept during grace');
    const r = reg.join('sw1-heart-star-moon-cat', 'C', sink('c'), {});
    assert(r.ok && r.resumed, 'resumed');
    eq(inbox.c.at(-1).reset, true, 'resume gets the roster');
    reg.detach('sw1-heart-star-moon-cat', 'C');
    now = 2000;
    reg.sweep();
    assert(!reg.has('sw1-heart-star-moon-cat', 'C'), 'gone after grace');
    eq(inbox.a.at(-1), { t: 'p', l: ['C'] }, 'others see C leave');
    reg.leave('sw1-heart-star-moon-cat', 'A');
    const again = [];
    reg.join('sw1-heart-star-moon-cat', 'E', (f) => again.push(f), {});
    assert(!again[0].j.some((e) => e.peer === 'A'), 'presence cleared on leave');
  });

  await test('protocol: codes, room names, parsers', () => {
    const w = proto.randomCode(rand);
    const name = proto.roomNameFor(w);
    assert(proto.isRoomName(name), 'room name grammar');
    eq(proto.codeFromRoom(name), w, 'round trip');
    eq(proto.roomNameFor(['heart', 'star']), null, 'bad code');
    assert(proto.roomNameFor(['cupcake', 'cupcake', 'rainbow', 'rainbow']).length <= 48, 'longest fits');
    eq(proto.parseBatch({ e: 'x', s: 0 }), null, 'bad seq');
    assert(proto.parseBatch({ e: 'x', s: 3, c: '0000a01', E: [[1, 'bed', 1, 2, 3, 0, 0, 0, 0, 0], ['bad']] }).E.length === 1, 'drops bad records');
    eq(proto.parseBulk({ k: 's', e: 'x', id: 's1', i: 5, n: 5, s0: 1, z: 0, c: 'a', d: '' }), null, 'index out of range');
    eq(proto.messageText('denied', { host: 'Lily' }), "Lily can't play right now. Maybe later!", 'message text');
  });

  await roomTransportTests();
  await sessionTests();
}

// ---------- RoomTransport against a contract-faithful fake room ----------

async function roomTransportTests() {
  const { RoomTransport } = await import('../src/net/room-transport.js');
  const { makeFakeClaude } = await import('./net/fake-room.mjs');

  await test('RoomTransport: join, presence, emit, echo filter, by/uid, probe, errors', async () => {
    const world = makeFakeClaude();
    const a = new RoomTransport({ claude: world.page({ uid: 'uA', level: 'interact' }) });
    const b = new RoomTransport({ claude: world.page({ uid: 'uB', level: 'view' }) });
    eq(await a.identity(), { uid: 'uA', canHost: true }, 'identity A');
    eq((await b.identity()).canHost, null, 'viewer: null = try it');
    const ra = await a.open('sw1-heart-star-moon-cat');
    const rb = await b.open('sw1-heart-star-moon-cat');
    assert(ra.self && rb.self && ra.self !== rb.self, 'peer ids');
    await world.flush();
    assert(a.connected() && b.connected(), 'connected');
    const got = [];
    b.on('op', (d, from) => got.push([d, from]));
    const echo = [];
    a.on('op', (d) => echo.push(d));
    a.setState({ r: 'h', uid: 'uA' });
    a.flushState();
    assert(['sent', 'queued'].includes(a.send('op', { s: 1 }, 1)), 'send');
    await world.flush(200);
    eq(got, [[{ s: 1 }, ra.self]], 'b got it from a');
    eq(echo, [], 'own echo filtered');
    const pa = b.peers().find((p) => p.id === ra.self);
    eq([pa.uid, pa.state.r, pa.self], ['uA', 'h', false], 'peer mapping (uid from by)');
    assert(b.peers().find((p) => p.self).id === rb.self, 'self marked');
    assert(await a.probeSend(), 'interact may send');
    assert(!(await b.probeSend()), 'viewer may not send');
    eq(a.send('op', { big: 'x'.repeat(5000) }, 1), 'dropped', 'too big dropped');
    let threw = null;
    try {
      a.setState({ huge: 'x'.repeat(4000) });
    } catch (e) {
      threw = e.code;
    }
    eq(threw, 'too_big', 'presence too big throws');
    await b.close();
    await world.flush(200);
    assert(!a.peers().some((p) => p.id === rb.self), 'b left');
    eq(world.reportErrors, 0, 'no reportError');
    const c = new RoomTransport({ claude: world.page({ uid: 'uC', level: 'interact', rooms: false }) });
    let code = null;
    try {
      await c.open('sw1-heart-star-moon-cat');
    } catch (e) {
      code = e.code;
    }
    eq(code, 'no_rooms', 'not_permitted join -> no_rooms');
    const d = new RoomTransport({ claude: { use: async () => null } });
    code = null;
    try {
      await d.open('sw1-heart-star-moon-cat');
    } catch (e) {
      code = e.code;
    }
    eq(code, 'unavailable', 'no room capability');
    const st = [];
    a.onStatus((s) => st.push(s));
    world.revoke(a);
    await world.flush(100);
    eq(st.at(-1), { connected: false, fatal: 'revoked' }, 'revoked is fatal');
  });
}

// ---------- session state machine over the loop hub ----------

function simWorld(seed, faults = {}) {
  const clock = new SimClock();
  const hub = new NetHub({ clock, rand: mulberry32(seed * 7 + 1), ...faults });
  return { clock, hub };
}

/** Await a promise while the sim clock runs. */
async function simAwait(clock, p, maxMs = 60000) {
  const t = track(p);
  await runUntil(clock, () => t.done, maxMs);
  if (!t.done) throw new Error('timed out (sim)');
  if (t.error) throw t.error;
  return t.value;
}

async function runUntil(clock, cond, maxMs = 30000, step = 50) {
  const end = clock.now() + maxMs;
  while (!cond()) {
    if (clock.now() >= end) return false;
    await clock.advance(step);
  }
  return true;
}


async function sessionTests() {
  await test('session: knock, deny, admit, full, version, kick, no host', async () => {
    const { clock, hub } = simWorld(3, { presenceDelayMs: [5, 30], delayMs: [5, 60] });
    const ctx = { clock, rand: mulberry32(3), transport: (uid) => new LoopTransport({ hub, clock, uid }) };
    const H = makeSession(ctx, 'Lily', 'uH');
    const knocks = [];
    H.session.on('knock', (k) => knocks.push(k));
    const h = track(H.session.host());
    await runUntil(clock, () => h.done);
    assert(h.value === true && H.session.state === 'h.live', 'hosting');
    const code = H.session.code;
    // nobody with these pictures
    const X = makeSession(ctx, 'Xan', 'uX', { guest: true });
    const other = code.slice();
    other[0] = other[0] === 'gem' ? 'cat' : 'gem';
    await simAwait(clock, X.session.join(other));
    await runUntil(clock, () => X.session.state === 'idle', 20000);
    eq(X.messages, ['no_host'], 'no host message');
    // wrong build
    const V = makeSession(ctx, 'Vi', 'uV', { guest: true, build: 'other' });
    await simAwait(clock, V.session.join(code));
    await runUntil(clock, () => V.session.state === 'idle', 20000);
    eq(V.messages, ['version'], 'version message');
    // deny
    const G1 = makeSession(ctx, 'Mia', 'u1', { guest: true });
    await simAwait(clock, G1.session.join(code));
    await runUntil(clock, () => knocks.length === 1);
    eq(knocks[0].name, 'Mia', 'knock card name');
    H.session.deny(knocks[0].peer);
    await runUntil(clock, () => G1.session.state === 'idle');
    eq(G1.messages, ['denied'], 'denied');
    // admit three, the fourth is full
    const gs = [];
    for (const [nm, uid] of [['Mia', 'u1'], ['Zoe', 'u2'], ['Ava', 'u3']]) {
      const G = makeSession(ctx, nm, uid, { guest: true });
      await simAwait(clock, G.session.join(code));
      await runUntil(clock, () => knocks.length > 1 + gs.length);
      H.session.admit(knocks.at(-1).peer);
      assert(await runUntil(clock, () => G.session.state === 'g.live'), nm + ' live');
      gs.push(G);
    }
    eq(H.session.players().length, 4, 'four players');
    const F = makeSession(ctx, 'Fay', 'u4', { guest: true });
    await simAwait(clock, F.session.join(code));
    await runUntil(clock, () => F.session.state === 'idle');
    eq(F.messages, ['full'], 'full');
    // kick: sent home, her later edits ignored, her knock refused
    const zoe = gs[1];
    const zoePeer = zoe.session.transport.selfId();
    H.session.kick(zoePeer);
    await runUntil(clock, () => zoe.session.state === 'idle');
    eq(zoe.messages, ['kicked'], 'kicked message');
    const Z2 = makeSession(ctx, 'Zoe', 'u2', { guest: true });
    await simAwait(clock, Z2.session.join(code));
    await runUntil(clock, () => Z2.session.state === 'idle');
    eq(Z2.messages, ['kicked'], 'banned uid refused');
    // the host leaves: everyone goes home
    const summary = [];
    H.session.on('summary', () => summary.push(1));
    await simAwait(clock, H.session.leave());
    await runUntil(clock, () => gs[0].session.state === 'idle' && gs[2].session.state === 'idle');
    eq(gs[0].messages, ['ended'], 'host went home');
    eq(summary.length, 1, 'host summary');
    eq(hub.violations, [], 'no hub violations');
    hub.close();
  });

  await test('session: host reload (new epoch) and a guest reload keep playing', async () => {
    const { clock, hub } = simWorld(5, { presenceDelayMs: [5, 30], delayMs: [5, 60] });
    const ctx = { clock, rand: mulberry32(5), transport: (uid) => new LoopTransport({ hub, clock, uid }) };
    const H = makeSession(ctx, 'Lily', 'uH', { options: { autoAdmit: true } });
    await runUntil(clock, () => false, 10);
    const h = track(H.session.host());
    await runUntil(clock, () => h.done);
    const G = makeSession(ctx, 'Mia', 'u1', { guest: true });
    await simAwait(clock, G.session.join(H.session.code));
    assert(await runUntil(clock, () => G.session.state === 'g.live'), 'live');
    G.adapter.userCells([[3, 5, 3, B.planks]]);
    G.session.frameEnd();
    await clock.advance(2000);
    // host reload: same world, new page, same code, guests auto-admitted
    const code = H.session.code;
    await simAwait(clock, H.session.abandon());
    const H2 = makeSession(ctx, 'Lily', 'uH', { adapter: H.adapter });
    const h2 = track(H2.session.host({ code, resume: true, uids: ['u1'] }));
    await runUntil(clock, () => h2.done);
    assert(h2.value, 'rehosted');
    assert(await runUntil(clock, () => G.session.state === 'g.live' && G.session.guestCore.epoch === H2.session.epoch, 30000), 'guest follows new epoch');
    // guest reload
    const peerBefore = G.session.transport.selfId();
    await simAwait(clock, G.session.abandon());
    const G2 = makeSession(ctx, 'Mia', 'u1', { guest: true });
    await simAwait(clock, G2.session.join(code));
    assert(await runUntil(clock, () => G2.session.state === 'g.live'), 'reloaded guest live');
    assert(G2.session.transport.selfId() !== peerBefore, 'new peer');
    eq(G2.session.guestCore.seat, 1, 'same seat');
    G2.adapter.userCells([[4, 5, 3, B.wool]]);
    G2.session.frameEnd();
    await clock.advance(3000);
    eq(H.adapter.cells[H.adapter.idx(4, 5, 3)], B.wool, 'edit arrived');
    eq(H.adapter.cells[H.adapter.idx(3, 5, 3)], B.planks, 'earlier edit kept');
    hub.close();
  });
}

// =====================================================================================
// Property test: 1 host + 3 guests, seeded random actions, faults; convergence + exactly once
// =====================================================================================

async function propertyTests() {
  console.log(`\nProperty test (loop hub, 30% drop, 5% duplicates, 0-800 ms delay, 3 s partitions): ${SEEDS} seeds x ${STEPS} actions`);
  const rows = [];
  for (let k = 0; k < SEEDS; k++) {
    const seed = FIRST_SEED + k;
    await test(`property seed ${seed}`, async () => {
      const net = simNet(seed);
      try {
        const r = await scenario(seed, STEPS, net, { label: 'loop' });
        rows.push(r);
        return `${r.executed} guest entries once each, ${r.rejects} rejects, ${r.fixes} fixes, ${r.snapshots} snapshots, rs ${r.rsForced}, ` +
          `kicks ${r.kicks}, reloads ${r.reloads}, host restarts ${r.restarts}, partitions ${r.partitions}, quiet ${(r.quietMs / 1000).toFixed(1)} s, maxEmit ${r.maxEmit} B, maxState ${r.maxState} B, max ${r.maxPerSec}/s`;
      } finally {
        net.close();
      }
    });
  }
  return rows;
}

// =====================================================================================
// Server tests (real server/server.mjs over HTTP and WebSockets)
// =====================================================================================

function startServerProcess(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs')], {
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => {
      out += d.toString();
      const m = /listening on port (\d+)/.exec(out);
      if (m) resolve({ child, port: +m[1], output: () => out });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('exit', (code) => reject(new Error('server exited ' + code + ': ' + out)));
    setTimeout(() => reject(new Error('server did not start: ' + out)), 10000);
  });
}

function stopServer(srv) {
  return new Promise((resolve) => {
    if (srv.child.exitCode !== null) return resolve(srv.child.exitCode);
    srv.child.removeAllListeners('exit');
    srv.child.once('exit', (code) => resolve(code));
    srv.child.kill('SIGTERM');
  });
}

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

/** A raw WebSocket client (Node 22 global WebSocket; `ws` when headers are needed). */
async function rawWs(port, room, secret, headers) {
  const { WebSocket: WS } = await import('ws');
  return new Promise((resolve) => {
    const frames = [];
    const ws = new WS(`ws://127.0.0.1:${port}/r/${room}?s=${secret}`, { headers });
    const box = { ws, frames, closed: null, error: null };
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    ws.on('close', (code) => (box.closed = code));
    ws.on('unexpected-response', (req, res) => {
      box.error = res.statusCode;
      resolve(box);
    });
    ws.on('error', () => {});
    ws.on('open', () => resolve(box));
  });
}

const waitFor = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await sleep(20);
  }
  return true;
};

async function serverTests() {
  console.log('\nServer tests (server/server.mjs)');
  const html = path.join(ROOT, 'dist', 'sparkle-world.html');
  await test('server: serves the built game, /healthz and /api/net', async () => {
    assert(existsSync(html), 'run "npm run build" first (dist/sparkle-world.html missing)');
    const srv = await startServerProcess();
    try {
      const page = await get(srv.port, '/', { 'accept-encoding': 'gzip' });
      eq(page.status, 200, 'status');
      eq(page.headers['content-encoding'], 'gzip', 'gzip');
      assert(/no-cache/.test(page.headers['cache-control']), 'cache header');
      assert(page.headers.etag, 'etag');
      const text = gunzipSync(page.body).toString();
      assert(text.startsWith('<!doctype html>') && text.includes('Sparkle World'), 'the game page');
      const again = await get(srv.port, '/', { 'if-none-match': page.headers.etag });
      eq(again.status, 304, 'revalidation');
      const plain = await get(srv.port, '/');
      assert(!plain.headers['content-encoding'] && plain.body.length > page.body.length, 'uncompressed for others');
      const hz = await get(srv.port, '/healthz');
      eq([hz.status, JSON.parse(hz.body)], [200, { ok: true }], 'healthz');
      const api = JSON.parse((await get(srv.port, '/api/net')).body);
      eq([api.ok, api.version, /^[0-9a-f]{8}$/.test(api.build)], [true, '0.1.0', true], 'api/net');
      eq((await get(srv.port, '/nope')).status, 404, '404');
      eq((await get(srv.port, '/r/sw1-heart-star-moon-cat')).status, 426, 'rooms need WebSocket');
      assert(/listening on port/.test(srv.output()), 'startup line');
    } finally {
      const code = await stopServer(srv);
      eq(code, 0, 'graceful exit on SIGTERM');
    }
  });

  await test('server: health check fails without a built game', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
    const srv = await startServerProcess({ SW_DIST: path.join(dir, 'missing.html') });
    try {
      eq((await get(srv.port, '/healthz')).status, 503, 'healthz 503');
      eq(JSON.parse((await get(srv.port, '/api/net')).body).ok, false, 'api/net not ok');
    } finally {
      await stopServer(srv);
    }
  });

  await test('server: limits (4 per room, 3,900 B messages, 4 KiB presence, rate, rooms, per-IP, origin, idle, shutdown)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
    const page = path.join(dir, 'page.html');
    writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
    const srv = await startServerProcess({ SW_DIST: page, SW_MAX_ROOMS: '3', SW_MAX_PER_IP: '6', SW_IDLE_MS: '1500' });
    const room = 'sw1-heart-star-moon-cat';
    const socks = [];
    try {
      // 4 peers per room
      for (let k = 0; k < 4; k++) socks.push(await rawWs(srv.port, room, 'secret-number-' + k + 'xxxx'));
      await waitFor(() => socks.every((s) => s.frames.length > 0));
      const fifth = await rawWs(srv.port, room, 'secret-number-5xxxxx');
      await waitFor(() => fifth.closed !== null);
      eq(fifth.closed, 4001, 'fifth player refused (room full)');
      assert(fifth.frames.some((f) => f.t === 'e' && f.code === 'full'), 'full error frame');
      const [a, b] = socks;
      // message size limit
      a.ws.send(JSON.stringify({ t: 'b', topic: 'sw.op', data: { x: 'y'.repeat(3950) } }));
      a.ws.send(JSON.stringify({ t: 'b', topic: 'sw.op', data: { x: 'ok' } }));
      await waitFor(() => b.frames.some((f) => f.t === 'b'));
      const got = b.frames.filter((f) => f.t === 'b');
      eq(got.length, 1, 'oversized message not relayed');
      eq(got[0].from.by, null, 'sender stamp by:null');
      eq([got[0].from.kind, got[0].from.guest, got[0].from.isMe, got[0].from.sameTab], ['viewer', false, false, false], 'stamp');
      assert(a.frames.some((f) => f.t === 'e' && f.code === 'too_big'), 'too_big reported');
      assert(a.frames.some((f) => f.t === 'b' && f.from.sameTab && f.from.isMe), 'echo to sender');
      // presence limit
      a.ws.send(JSON.stringify({ t: 's', patch: { big: 'x'.repeat(1000), b2: 'x'.repeat(1000), b3: 'x'.repeat(1000), b4: 'x'.repeat(1000), b5: 'x'.repeat(200) } }));
      await waitFor(() => a.frames.filter((f) => f.t === 'e').length >= 2);
      assert(a.frames.some((f) => f.t === 'e' && f.code === 'too_big' ), 'presence too big');
      a.ws.send(JSON.stringify({ t: 's', patch: { r: 'h', n: 1 } }));
      await waitFor(() => b.frames.some((f) => f.t === 'p' && f.u));
      const upd = b.frames.find((f) => f.t === 'p' && f.u);
      eq(upd.u[0][1], { r: 'h', n: 1 }, 'presence relayed');
      // rate limit: 300 messages at once, only ~80 get through
      const before = b.frames.length;
      for (let k = 0; k < 300; k++) a.ws.send(JSON.stringify({ t: 'b', topic: 'sw.op', data: { k } }));
      await sleep(400);
      const relayed = b.frames.length - before;
      assert(relayed >= 70 && relayed <= 110, 'rate limited: ' + relayed + ' of 300 relayed');
      // rooms cap (3) and per-IP cap (6 connections: 4 open now)
      const r2 = await rawWs(srv.port, 'room-two', 'secret-number-r2xxxx');
      const r3 = await rawWs(srv.port, 'room-three', 'secret-number-r3xxxx');
      await waitFor(() => r2.frames.length && r3.frames.length);
      const r4 = await rawWs(srv.port, 'room-four', 'secret-number-r4xxxx');
      await waitFor(() => r4.closed !== null);
      eq(r4.closed, 4029, 'per-IP cap');
      r2.ws.close(1000);
      await waitFor(() => r2.closed !== null);
      await sleep(100);
      const r5 = await rawWs(srv.port, 'room-five', 'secret-number-r5xxxx');
      await waitFor(() => r5.closed !== null || r5.frames.length > 0);
      await waitFor(() => r5.closed !== null, 1000);
      assert(r5.closed === 4002 || r5.frames.some((f) => f.code === 'rooms_full'), 'rooms cap: ' + r5.closed);
      // origin check
      const bad = await rawWs(srv.port, room, 'secret-number-oxxxxx', { Origin: 'https://evil.example' });
      eq(bad.error, 403, 'foreign origin refused');
      const good = await rawWs(srv.port, 'room-three', 'secret-number-o2xxxx', { Origin: `http://127.0.0.1:${srv.port}`, Host: `127.0.0.1:${srv.port}` });
      assert(!good.error, 'same origin accepted');
      good.ws.close(1000);
      // idle rooms are closed
      await waitFor(() => r3.closed !== null, 12000);
      eq(r3.closed, 4000, 'idle room closed');
      // graceful shutdown: clients see 1012
      const code = await stopServer(srv);
      eq(code, 0, 'exit 0');
      await waitFor(() => socks.every((s) => s.closed !== null), 3000);
      assert(socks.every((s) => s.closed === 1012 || s.closed === 4000), 'restart close code: ' + socks.map((s) => s.closed));
      assert(!/secret-number|yyyy|xxxx/.test(srv.output()), 'no payloads or secrets logged');
    } finally {
      for (const s of socks) try { s.ws.terminate(); } catch {}
      await stopServer(srv);
    }
  });

  await test('server: WsTransport reconnects as the same peer after a drop and after a server restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
    const page = path.join(dir, 'page.html');
    writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
    let srv = await startServerProcess({ SW_DIST: page });
    const port = srv.port;
    const url = `ws://127.0.0.1:${port}`;
    const a = new WsTransport({ url, uid: 'ua' });
    const b = new WsTransport({ url, uid: 'ub' });
    try {
      const room = 'sw1-sun-sun-moon-cat';
      const ra = await a.open(room);
      await b.open(room);
      a.setState({ r: 'h', n: 1 });
      await waitFor(() => b.peers().some((p) => p.id === ra.self && p.state.n === 1));
      a.partition(1500);
      await sleep(300);
      a.setState({ n: 2 });
      await waitFor(() => b.peers().some((p) => p.id === ra.self && p.state.n === 2), 6000);
      eq(a.selfId(), ra.self, 'same peer after reconnect');
      assert(b.peers().some((p) => p.id === ra.self && p.state.n === 2), 'presence re-asserted');
      // server restart on the same port
      await stopServer(srv);
      srv = await startServerProcess({ SW_DIST: page, PORT: String(port) });
      await waitFor(() => a.peers().length === 2 && b.peers().some((p) => p.id === ra.self && p.state.n === 2), 15000);
      assert(b.peers().some((p) => p.id === ra.self && p.state.n === 2), 'room rebuilt after restart');
      const got = [];
      b.on('op', (d) => got.push(d));
      a.send('op', { hello: 1 }, 1);
      await waitFor(() => got.length === 1);
      eq(got, [{ hello: 1 }], 'messages flow again');
    } finally {
      await a.close();
      await b.close();
      await stopServer(srv);
    }
  });
}

// ---------- the same property test through the real server ----------

async function wsPropertyTests() {
  console.log('\nProperty test through the real server (4 WsTransport clients; client-side 30% drop, 5% duplicates, 0-800 ms delay; socket drops)');
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
  const page = path.join(dir, 'page.html');
  writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
  const srv = await startServerProcess({ SW_DIST: page, SW_MAX_PER_IP: '50' });
  const seeds = +(args.wsseeds || 1);
  try {
    for (let k = 0; k < seeds; k++) {
      const seed = FIRST_SEED + 100 + k;
      await test(`ws property seed ${seed}`, async () => {
        const net = wsNet(srv.port, seed);
        const r = await scenario(seed, +(args.wssteps || STEPS), net, { label: 'ws', quietMs: 10000, maxQuietMs: 120000 });
        return `${r.executed} guest entries once each, ${r.rejects} rejects, ${r.fixes} fixes, ${r.snapshots} snapshots, kicks ${r.kicks}, reloads ${r.reloads}, host restarts ${r.restarts}, socket drops ${r.partitions}, quiet ${(r.quietMs / 1000).toFixed(1)} s`;
      });
    }
  } finally {
    const code = await stopServer(srv);
    if (code !== 0) console.log('  server exit code', code);
  }
}

// =====================================================================================

const t0 = Date.now();
if (!ONLY || ONLY.has('unit')) await unitTests();
if (!ONLY || ONLY.has('prop')) await propertyTests();
if (!ONLY || ONLY.has('server')) await serverTests();
if (!ONLY || ONLY.has('ws')) await wsPropertyTests();
console.log(`\n${passed} passed, ${failures} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
