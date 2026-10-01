// Multiplayer net-core tests (docs/MULTIPLAYER.md §15.1), no browser:
//   node tools/test-net.mjs                 unit tests + property test (20 seeds) + server tests + WebSocket property test
//   node tools/test-net.mjs --only=unit     just the unit tests (also: prop, server, accounts, ws)
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
import { RoomRegistry, tooDeep, jsonSize } from '../server/rooms.mjs';
import { clientIpOf, isInternalIp } from '../server/server.mjs';
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
      'face.brows': wardrobe.BROWS,
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
    for (let k = 0; k < 200; k++) check(wardrobe.randomLook(rand, 'Zoe', null, 'boy'));
    for (let k = 0; k < 200; k++) check(wardrobe.randomLook(rand, 'Zoe', null, 'mix'));
    const l2 = wardrobe.normalizeLook({ hair: { style: 'bob', color: '#123456', color2: 'rainbow' }, acc: { faceColor: '#ABCDEF', handColor: '#00FF00' } });
    check(l2);
    const l3 = wardrobe.normalizeLook({ hair: { color2: '#FEDCBA' } });
    check(l3);
    // Jersey numbers (base 36: 35 is one character, 36 two).
    for (const num of [0, 7, 35, 36, 99]) {
      const l = wardrobe.normalizeLook({ name: 'Leo', top: { type: 'jersey', num } });
      check(l);
      eq(codec.unpackLook(codec.packLook(l), 'Leo').top.num, num, 'jersey number ' + num);
    }
    // An old 34-token string (before the brows / number tail) still unpacks, with the defaults.
    const old = codec.packLook(wardrobe.normalizeLook({ name: 'Mia', face: { brows: 'bold' }, top: { num: 42 } }));
    const oldToks = old.split('.');
    eq(oldToks.length, 36, 'token count');
    const back = codec.unpackLook(oldToks.slice(0, 34).join('.'), 'Mia');
    eq(back.face.brows, 'soft', 'old string: soft brows');
    eq(back.top.num, 7, 'old string: number 7');
    eq(codec.unpackLook(old, 'Mia').top.num, 42, 'new string: number 42');
    // A broken number token falls back instead of reaching the avatar.
    eq(codec.unpackLook(oldToks.slice(0, 35).concat('zz').join('.'), 'Mia').top.num, 7, 'number 1295 rejected');
    // packLook never throws on a look missing its top (adapter.js would swallow it into lk = '').
    assert(codec.packLook({ name: 'Mia', top: null }).endsWith('.0.7'), 'packLook without a top');
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
    reg.detach('sw1-heart-star-moon-cat', 'B');
    assert(reg.join('sw1-heart-star-moon-cat', 'D', sink('d'), {}).ok, 'a peer in its grace does not block a newcomer');
    assert(!reg.has('sw1-heart-star-moon-cat', 'B'), 'the gone peer left');
    reg.leave('sw1-heart-star-moon-cat', 'D');
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
    eq([proto.presenceSafe({ open: true, art: 'abc', n: [1, 2] }), proto.presenceSafe({ 'a-b': 1 }), proto.presenceSafe({ x: 'a\nb' }), proto.presenceSafe({ x: 'y'.repeat(1001) })], [true, false, false, false], 'presenceSafe');
    eq(proto.cleanText('Mi\u200ba\n', 12), 'Mia', 'cleanText');
  });

  await roomTransportTests();
  await sessionTests();
  await safetyTests();
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

// ---------- review fixes: the relay's gate, identity, ownership, kind messages ----------

/** A host (auto-admit unless told) and live guests over the loop hub. */
async function hostAndGuests(seed, names, { autoAdmit = true, env = {}, hubOpts = {} } = {}) {
  const { clock, hub } = simWorld(seed, hubOpts);
  const ctx = { clock, rand: mulberry32(seed), transport: (uid) => new LoopTransport({ hub, clock, uid }) };
  const H = makeSession(ctx, 'Lily', 'uH', { options: { autoAdmit }, env });
  const h = track(H.session.host());
  await runUntil(clock, () => h.done);
  assert(h.value === true, 'hosting');
  const gs = [];
  for (const [nm, uid] of names) gs.push(await guestJoins(clock, ctx, H, nm, uid));
  return { clock, hub, ctx, H, gs };
}

async function guestJoins(clock, ctx, H, nm, uid, opts = {}) {
  const G = makeSession(ctx, nm, uid, { guest: true, ...opts });
  await simAwait(clock, G.session.join(H.session.code));
  assert(await runUntil(clock, () => G.session.state === 'g.live'), nm + ' live');
  return G;
}

async function act(clock, players, ms = 2500) {
  for (const p of players) p.session.frameEnd();
  await clock.advance(ms);
}

async function safetyTests() {
  await test('rooms: a deeply nested broadcast is refused (never thrown); sizes are safe', () => {
    const reg = new RoomRegistry({});
    const got = [];
    assert(reg.join('sw1-heart-star-moon-cat', 'A', (f) => got.push(f), {}).ok, 'joins');
    let deep = [];
    for (let k = 0; k < 8000; k++) deep = [deep];
    eq(reg.handle('sw1-heart-star-moon-cat', 'A', { t: 'b', topic: 'x', data: deep }).code, 'bad_frame', '8,000 levels refused');
    assert(tooDeep(deep) && !tooDeep({ a: [1, { b: [2] }] }) && !tooDeep('x'), 'depth check');
    assert(jsonSize(deep) === -1 || jsonSize(deep) > 0, 'jsonSize never throws');
    eq(got.filter((f) => f.t === 'b').length, 0, 'nothing relayed');
  });

  await test('rooms: the gate (Railway) - join order, public keys until let in, no messages, same-device host, rooms per address', () => {
    const reg = new RoomRegistry({ gate: true });
    const R = 'sw1-heart-star-moon-cat';
    const box = { H: [], G: [], X: [], H2: [] };
    const sink = (k) => (f) => box[k].push(f);
    reg.join(R, 'H', sink('H'), { by: 'dH' });
    reg.handle(R, 'H', { t: 's', patch: { v: 1, r: 'h', hs: 5, nm: 'Lily', lk: 'abc', ep: 'e1', adm: [], no: [] } });
    reg.join(R, 'G', sink('G'), { by: 'dG' });
    const w = box.G[0];
    const hE = w.j.find((e) => e.peer === 'H');
    eq(hE.state, { v: 1, r: 'h', hs: 5, ep: 'e1', adm: [], no: [] }, 'a newcomer sees only the public keys');
    assert(hE.at < w.j.find((e) => e.peer === 'G').at, 'join order in every entry');
    reg.handle(R, 'G', { t: 's', patch: { r: 'g', kn: 1, nm: 'Mia', lk: 'x' } });
    eq(box.H.at(-1).u[0][1], { r: 'g', kn: 1, nm: 'Mia', lk: 'x' }, 'the host sees the knock in full');
    reg.handle(R, 'H', { t: 'b', topic: 'sw.op', data: { s: 1 } });
    assert(!box.G.some((f) => f.t === 'b'), 'no messages before she is let in');
    reg.handle(R, 'G', { t: 'b', topic: 'sw.op', data: { s: 2 } });
    assert(!box.H.some((f) => f.t === 'b' && f.data.s === 2), 'nobody hears a member who is not let in');
    reg.handle(R, 'H', { t: 's', patch: { nm: 'Lilly' } });
    assert(!box.G.some((f) => f.u && f.u[0][1].nm), 'private keys stay private');
    reg.handle(R, 'H', { t: 's', patch: { adm: [['G', 1]] } });
    eq(box.G.at(-1).j.find((e) => e.peer === 'H').state.nm, 'Lilly', 'let in: everything, at once');
    reg.handle(R, 'H', { t: 'b', topic: 'sw.op', data: { s: 3 } });
    assert(box.G.some((f) => f.t === 'b' && f.data.s === 3), 'messages reach her now');
    // a later "host" with hs 0 and its own adm is not the room's host
    reg.join(R, 'X', sink('X'), { by: 'dX' });
    reg.handle(R, 'X', { t: 's', patch: { r: 'h', hs: 0, ep: 'e9', adm: [['X', 1], ['G', 1]] } });
    reg.handle(R, 'X', { t: 'b', topic: 'sw.op', data: { s: 4 } });
    assert(!box.G.some((f) => f.t === 'b' && f.data.s === 4), 'a later pretend host reaches nobody');
    assert(!box.X.some((f) => (f.j || []).some((e) => e.state.nm) || (f.u || []).some((u) => u[1].nm)), 'and sees no names');
    // the host's own reloaded page (the same device stamp) is the host as well
    reg.join(R, 'H2', sink('H2'), { by: 'dH' });
    reg.handle(R, 'H2', { t: 's', patch: { r: 'h', hs: 9, ep: 'e2', adm: [] } });
    assert(box.H2.some((f) => (f.j || []).some((e) => e.peer === 'G' && e.state.nm === 'Mia')), 'her reloaded page sees in full');
    reg.handle(R, 'H2', { t: 'b', topic: 'sw.op', data: { s: 5 } });
    assert(box.G.some((f) => f.t === 'b' && f.data.s === 5), 'her reloaded page reaches her friends');
    // sent home: public keys again
    reg.handle(R, 'H', { t: 's', patch: { adm: [] } });
    eq(box.G.at(-1).j.find((e) => e.peer === 'H').state.nm, undefined, 'sent home: names hidden again');
    // while her page reloads, a pretend host who came in between does not take her place
    let T = 1000;
    const rr = new RoomRegistry({ gate: true, now: () => T, hostHoldMs: 90000 });
    const b2 = { H: [], G: [], X: [], H2: [] };
    const s2 = (k) => (f) => b2[k].push(f);
    rr.join(R, 'H', s2('H'), { by: 'dH' });
    rr.handle(R, 'H', { t: 's', patch: { r: 'h', ep: 'e1', adm: [['G', 1]] } });
    rr.join(R, 'G', s2('G'), { by: 'dG' });
    rr.handle(R, 'G', { t: 's', patch: { r: 'g', nm: 'Mia' } });
    rr.join(R, 'X', s2('X'), { by: 'dX' });
    rr.handle(R, 'X', { t: 's', patch: { r: 'h', hs: 0, ep: 'e9', adm: [['G', 1], ['X', 2]] } });
    rr.leave(R, 'H');
    eq(rr.gameOf(R).host, null, 'her page is gone: nobody is the host meanwhile (not the pretend host)');
    rr.handle(R, 'X', { t: 'b', topic: 'sw.op', data: { s: 6 } });
    assert(!b2.G.some((f) => f.t === 'b' && f.data.s === 6) && !b2.X.some((f) => (f.u || []).some((u) => u[1].nm)), 'the pretend host reaches nobody and sees no names');
    rr.join(R, 'H2', s2('H2'), { by: 'dH' });
    rr.handle(R, 'H2', { t: 's', patch: { r: 'h', ep: 'e2', adm: [['G', 1]] } });
    eq(rr.gameOf(R).host.peer, 'H2', 'her reloaded page is the host again');
    const xAt = b2.G.flatMap((f) => f.j || []).filter((e) => e.peer === 'X').at(-1).at;
    const h2At = b2.G.flatMap((f) => f.j || []).filter((e) => e.peer === 'H2').at(-1).at;
    assert(h2At < xAt, `and her \`at\` is still her device's first (${h2At} < ${xAt}), so guests and her own rival check agree`);
    // she goes for good: after 90 s (friends wait 60 s for her) the room is free again
    rr.leave(R, 'H2');
    T += 60000;
    rr.sweep();
    eq(rr.gameOf(R).host, null, 'held for her after 60 s');
    T += 31000;
    rr.sweep();
    eq(rr.gameOf(R).host?.peer, 'X', 'free after 90 s');
    // two devices pick the same code at once: the one who was there first is the host, even
    // when her r:'h' arrives second
    const r3 = new RoomRegistry({ gate: true });
    r3.join(R, 'A', () => {}, { by: 'dA' });
    r3.join(R, 'B', () => {}, { by: 'dB' });
    r3.handle(R, 'B', { t: 's', patch: { r: 'h' } });
    r3.handle(R, 'A', { t: 's', patch: { r: 'h' } });
    eq(r3.gameOf(R).host.peer, 'A', 'the first device wins the race');
    // rooms one address may make
    const r2 = new RoomRegistry({ roomsPerOwner: 2 });
    assert(r2.join('a1', 'p1', () => {}, { owner: 'ip' }).ok && r2.join('a2', 'p2', () => {}, { owner: 'ip' }).ok, 'two rooms');
    eq(r2.join('a3', 'p3', () => {}, { owner: 'ip' }).code, 'limit', 'a third room from the same address');
    assert(r2.join('a1', 'p4', () => {}, { owner: 'ip' }).ok, 'joining a room that is there is fine');
    r2.leave('a2', 'p2');
    assert(r2.join('a3', 'p3', () => {}, { owner: 'ip' }).ok, 'a closed room frees its place');
  });

  await test('identity: a presence uid proves nothing; guests follow the host who was there first', async () => {
    const W = simWorld(22, { presenceDelayMs: [5, 30], delayMs: [5, 40] });
    const c2 = { clock: W.clock, rand: mulberry32(22), transport: (uid) => new LoopTransport({ hub: W.hub, clock: W.clock, uid }) };
    const Ho = makeSession(c2, 'Lily', 'uH');
    const knocks = [];
    Ho.session.on('knock', (k) => knocks.push(k));
    const h = track(Ho.session.host());
    await runUntil(W.clock, () => h.done);
    const code = Ho.session.code;
    const Mia = makeSession(c2, 'Mia', 'u1', { guest: true });
    await simAwait(W.clock, Mia.session.join(code));
    await runUntil(W.clock, () => knocks.length === 1);
    Ho.session.admit(knocks[0].peer);
    assert(await runUntil(W.clock, () => Mia.session.state === 'g.live'), 'Mia live');
    // a stranger on another device writes Mia's uid (and the host's) in her own presence
    const fake = new LoopTransport({ hub: W.hub, clock: W.clock, uid: 'uStranger' });
    await simAwait(W.clock, fake.open(proto.roomNameFor(code)));
    const hostState = Ho.session.transport.myState();
    fake.setState({ v: proto.PROTOCOL, pv: 'test', r: 'g', kn: 1, uid: 'u1', nm: 'Mia', ep: hostState.ep });
    fake.flushState();
    assert(await runUntil(W.clock, () => knocks.length === 2), 'a knock card for her (not let in as Mia)');
    eq(knocks[1].uid, 'uStranger', 'the card has the room stamp, not her claim');
    Ho.session.deny(knocks[1].peer);
    // a pretend host who came later (hs 0) does not get the next friend
    const pretend = new LoopTransport({ hub: W.hub, clock: W.clock, uid: 'uPretend' });
    await simAwait(W.clock, pretend.open(proto.roomNameFor(code)));
    pretend.setState({ v: proto.PROTOCOL, pv: 'test', r: 'h', hs: 0, ep: 'zzzz', nm: 'Lily', adm: [], no: [] });
    pretend.flushState();
    await W.clock.advance(500);
    const Zoe = makeSession(c2, 'Zoe', 'u2', { guest: true });
    await simAwait(W.clock, Zoe.session.join(code));
    await runUntil(W.clock, () => knocks.length === 3, 20000);
    eq(Zoe.session.guestCore.hostPeer, Ho.session.transport.selfId(), 'Zoe knocks at the real host');
    await fake.close();
    await pretend.close();
    W.hub.close();
    return `${knocks.length} knock cards`;
  });

  await test('careful friends: tapping makes nothing hers; watering and eating are fine; fence joins are the host\'s', async () => {
    const { clock, hub, H, gs } = await hostAndGuests(23, [['Mia', 'u1']]);
    const [G] = gs;
    const HA = H.adapter, GA = G.adapter;
    const lamp = HA.userPlace('lamp', 10, 5, 10);
    const table = HA.userPlace('table', 14, 5, 14);
    const cake = HA.userPlace('cupcake', 14, 6, 14);
    const fence = HA.userPlace('fence', 18, 5, 18);
    HA.userTill(12, 4, 12);
    assert(lamp && table && cake && fence, 'the host built a lamp, a table with a cupcake and a fence');
    await act(clock, [H, G]);
    // a tap on her lamp, then Remove: still hers
    GA.userData(lamp, { on: true });
    await act(clock, [G]);
    eq(HA.ents.get(lamp).data.on, true, 'the friend switched the lamp on');
    GA.userRemove(lamp);
    await act(clock, [G], 3000);
    assert(HA.ents.has(lamp), 'but cannot take it away after tapping it');
    eq(H.session.hostCore.stats.rejectCodes['e-:2'], 1, 'refused as protected');
    // watering the host's garden, eating her cupcake
    GA.userWater(12, 4, 12);
    GA.userRemove(cake);
    await act(clock, [G], 3000);
    eq(HA.cells[HA.idx(12, 4, 12)], B.farmland_wet, 'watering the host\'s garden is fine');
    assert(!HA.ents.has(cake), 'eating the host\'s cupcake is fine');
    // ... and watering made nothing hers
    GA.userCells([[12, 4, 12, B.air]]);
    await act(clock, [G], 3000);
    eq(HA.cells[HA.idx(12, 4, 12)], B.farmland_wet, 'the wet soil stays the host\'s');
    // her page's guess of a fence join is not taken
    GA.userData(fence, { conn: 5 });
    await act(clock, [G], 3000);
    eq(HA.ents.get(fence).data.conn, 0, 'the host keeps her fence joins');
    assert(await runUntil(clock, () => GA.ents.get(fence)?.data.conn === 0, 5000), 'and the friend gets them back');
    hub.close();
  });

  await test('ownership follows the friend: a new friend in a freed seat owns nothing; a resumed host keeps owners', async () => {
    let saved = null;
    const { clock, hub, ctx, H, gs } = await hostAndGuests(24, [['Mia', 'u1'], ['Zoe', 'u2']]);
    const [Mia, Zoe] = gs;
    const chair = Mia.adapter.userPlace('chair', 6, 5, 6);
    const stool = Zoe.adapter.userPlace('chair', 8, 5, 6);
    await act(clock, [Mia, Zoe], 3000);
    assert(H.adapter.ents.has(chair) && H.adapter.ents.has(stool), 'Mia and Zoe each built a chair');
    // Mia goes; her seat is freed after 60 s; June takes it
    await simAwait(clock, Mia.session.abandon());
    await clock.advance(65000);
    const June = await guestJoins(clock, ctx, H, 'June', 'u3');
    eq(June.session.guestCore.seat, 1, 'June got seat 1');
    June.adapter.userRemove(chair);
    await act(clock, [June], 3000);
    assert(H.adapter.ents.has(chair), 'June cannot remove Mia\'s chair');
    eq(H.session.undoSeat(1), 0, 'Undo building for June has nothing of Mia\'s');
    // the host's page reloads: owners come back from her saved world
    saved = { code: H.session.code.join('-'), ...H.session.hostCore.exportAuthors() };
    const code = H.session.code;
    await simAwait(clock, H.session.abandon());
    const H2 = makeSession(ctx, 'Lily', 'uH', { adapter: H.adapter, options: { autoAdmit: true }, env: { loadAuthors: () => saved } });
    const h2 = track(H2.session.host({ code, resume: true, uids: ['u2', 'u3'] }));
    await runUntil(clock, () => h2.done);
    assert(h2.value, 'hosting again');
    assert(await runUntil(clock, () => Zoe.session.state === 'g.live' && Zoe.session.guestCore.epoch === H2.session.epoch, 30000), 'Zoe follows');
    Zoe.adapter.userRemove(stool);
    await act(clock, [Zoe], 3000);
    assert(!H.adapter.ents.has(stool), 'Zoe can still take back her own chair after the host\'s reload');
    hub.close();
  });

  await test('kind words: Undo building tells the friend; an unanswered knock is not "Not now"; a wrong code keeps her where she is', async () => {
    let exits = 0;
    const env = { exitToTitle: () => { exits++; } };
    const W = simWorld(25, { presenceDelayMs: [5, 30], delayMs: [5, 40] });
    const ctx = { clock: W.clock, rand: mulberry32(25), transport: (uid) => new LoopTransport({ hub: W.hub, clock: W.clock, uid }) };
    const H = makeSession(ctx, 'Lily', 'uH');
    const knocks = [], gone = [];
    H.session.on('knock', (k) => knocks.push(k));
    H.session.on('knock-gone', (k) => gone.push(k));
    const h = track(H.session.host());
    await runUntil(W.clock, () => h.done);
    const code = H.session.code;
    // nobody answers for 90 s
    const Rosie = makeSession(ctx, 'Rosie', 'u1', { guest: true, env });
    await simAwait(W.clock, Rosie.session.join(code));
    await runUntil(W.clock, () => Rosie.session.state === 'idle', 100000);
    eq(Rosie.messages, ['no_answer'], 'no answer: its own message');
    eq(exits, 0, 'she stays where she was (keypad)');
    assert(await runUntil(W.clock, () => gone.length === 1), 'the host hears the knock went away');
    assert(gone[0].waited >= 89000 && gone[0].name === 'Rosie', 'after a long wait (' + gone[0].waited + ')');
    // wrong pictures
    const X = makeSession(ctx, 'Xan', 'u9', { guest: true, env });
    const other = code.slice();
    other[0] = other[0] === 'gem' ? 'cat' : 'gem';
    await simAwait(W.clock, X.session.join(other));
    await runUntil(W.clock, () => X.session.state === 'idle', 20000);
    eq([X.messages, exits], [['no_host'], 0], 'wrong pictures: the message, and she stays on the keypad');
    // Undo building: she hears it kindly
    const Mia = makeSession(ctx, 'Mia', 'u2', { guest: true, env });
    await simAwait(W.clock, Mia.session.join(code));
    await runUntil(W.clock, () => knocks.length === 2);
    H.session.admit(knocks[1].peer);
    assert(await runUntil(W.clock, () => Mia.session.state === 'g.live'), 'Mia live');
    Mia.adapter.userCells([[3, 5, 3, B.planks], [4, 5, 3, B.planks]]);
    await act(W.clock, [Mia], 3000);
    eq(H.session.undoSeat(1), 1, 'one group undone');
    assert(await runUntil(W.clock, () => Mia.adapter.toasts.some(([t]) => /tidied up/.test(t)), 5000), 'Mia hears "Lily tidied up..."');
    assert(await runUntil(W.clock, () => Mia.adapter.cells[Mia.adapter.idx(3, 5, 3)] === B.air, 5000), 'her blocks went back');
    // sent home from inside the world: back to the title
    H.session.kick(Mia.session.transport.selfId());
    await runUntil(W.clock, () => Mia.session.state === 'idle');
    eq([Mia.messages, exits], [['kicked'], 1], 'sent home from the world: title');
    W.hub.close();
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
  console.log('\nProperty test with a tiny journal (floor rises, big gaps go to snapshots: rs resync path)');
  for (let k = 0; k < Math.max(1, Math.round(SEEDS / 5)); k++) {
    const seed = FIRST_SEED + 1000 + k;
    await test(`property (journal 400 keys, fix max 6 KB) seed ${seed}`, async () => {
      const net = simNet(seed, { journalMaxKeys: 400, fixMax: 6000 });
      try {
        const r = await scenario(seed, STEPS, net, { label: 'small-journal' });
        assert(r.rsForced > 0, 'the rs path ran');
        return `${r.executed} entries once each, rs forced ${r.rsForced}, resyncs ${r.resyncRs}, snapshots ${r.snapshots}, fixes ${r.fixes}, quiet ${(r.quietMs / 1000).toFixed(1)} s`;
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
async function rawWs(port, room, secret, headers, device = null) {
  const { WebSocket: WS } = await import('ws');
  return new Promise((resolve) => {
    const frames = [];
    const ws = new WS(`ws://127.0.0.1:${port}/r/${room}?s=${secret}` + (device ? `&d=${device}` : ''), { headers });
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
    const srv = await startServerProcess({ SW_DIST: page, SW_MAX_ROOMS: '2', SW_MAX_PER_IP: '6', SW_IDLE_MS: '2500' });
    const room = 'sw1-heart-star-moon-cat';
    const socks = [];
    try {
      // origin check (browsers always send Origin; it must be this site)
      const bad = await rawWs(srv.port, room, 'secret-number-oxxxxx', { Origin: 'https://evil.example' });
      eq(bad.error, 403, 'foreign origin refused');
      const good = await rawWs(srv.port, 'room-origin', 'secret-number-o2xxxx', { Origin: `http://127.0.0.1:${srv.port}` });
      assert(!good.error, 'same origin accepted');
      await waitFor(() => good.frames.length > 0);
      good.ws.close(1000);
      await waitFor(() => good.closed !== null);
      await sleep(100);
      // 4 players per room
      for (let k = 0; k < 4; k++) socks.push(await rawWs(srv.port, room, 'secret-number-' + k + 'xxxx'));
      await waitFor(() => socks.every((s) => s.frames.length > 0));
      const fifth = await rawWs(srv.port, room, 'secret-number-5xxxxx');
      await waitFor(() => fifth.closed !== null);
      eq(fifth.closed, 4001, 'fifth player refused (room full)');
      assert(fifth.frames.some((f) => f.t === 'e' && f.code === 'full'), 'full error frame');
      const [a, b] = socks;
      // the relay is gated: a becomes the room's host and lets b in (b then hears messages)
      const bPeer = b.frames[0].self;
      a.ws.send(JSON.stringify({ t: 's', patch: { r: 'h', adm: [[bPeer, 1]] } }));
      await waitFor(() => b.frames.some((f) => f.t === 'p' && !f.reset && f.j && f.j.some((e) => e.state.r === 'h')));
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
      // presence limit (4 KiB merged)
      a.ws.send(JSON.stringify({ t: 's', patch: { b1: 'x'.repeat(1000), b2: 'x'.repeat(1000), b3: 'x'.repeat(1000), b4: 'x'.repeat(1000), b5: 'x'.repeat(200) } }));
      await waitFor(() => a.frames.filter((f) => f.t === 'e').length >= 2);
      eq(a.frames.filter((f) => f.t === 'e').map((f) => f.code), ['too_big', 'too_big'], 'presence too big');
      a.ws.send(JSON.stringify({ t: 's', patch: { n: 1 } }));
      await waitFor(() => b.frames.some((f) => f.t === 'p' && f.u));
      eq(b.frames.find((f) => f.t === 'p' && f.u).u[0][1], { n: 1 }, 'presence relayed');
      assert(!socks[2].frames.some((f) => f.t === 'p' && f.u && 'n' in f.u[0][1]), 'not to a player who is not let in');
      assert(!socks[2].frames.some((f) => f.t === 'b'), 'who hears no messages either');
      // rate limit: 300 messages at once, about 80 get through
      const before = b.frames.length;
      for (let k = 0; k < 300; k++) a.ws.send(JSON.stringify({ t: 'b', topic: 'sw.op', data: { k } }));
      await sleep(400);
      const relayed = b.frames.length - before;
      assert(relayed >= 70 && relayed <= 110, 'rate limited: ' + relayed + ' of 300 relayed');
      assert(a.frames.some((f) => f.t === 'e' && f.code === 'rate'), 'the sender hears it was too fast');
      // rooms cap (2): a second room is fine, a third is refused
      const r2 = await rawWs(srv.port, 'room-two', 'secret-number-r2xxxx');
      await waitFor(() => r2.frames.length > 0);
      const r3 = await rawWs(srv.port, 'room-three', 'secret-number-r3xxxx');
      await waitFor(() => r3.closed !== null);
      eq(r3.closed, 4002, 'rooms cap');
      // per-IP cap (6): 5 open now
      const r4 = await rawWs(srv.port, 'room-two', 'secret-number-r4xxxx');
      const r5 = await rawWs(srv.port, 'room-two', 'secret-number-r5xxxx');
      await waitFor(() => r5.closed !== null);
      eq([r4.closed, r5.closed], [null, 4029], 'per-IP cap');
      // idle rooms are closed (no traffic for SW_IDLE_MS)
      await waitFor(() => r2.closed !== null, 15000);
      eq(r2.closed, 4000, 'idle room closed');
      // graceful shutdown
      const code = await stopServer(srv);
      eq(code, 0, 'exit 0 on SIGTERM');
      await waitFor(() => socks.every((s) => s.closed !== null), 3000);
      assert(socks.every((s) => s.closed === 1012 || s.closed === 4000), 'restart/idle close codes: ' + socks.map((s) => s.closed));
      assert(!/secret-number|yyyy|xxxx/.test(srv.output()), 'no payloads or secrets logged');
    } finally {
      for (const s of socks) try { s.ws.terminate(); } catch {}
      await stopServer(srv);
    }
  });

  await test('server: new rooms per address, IPv6 counts per /64, silent drops', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
    const page = path.join(dir, 'page.html');
    writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
    const srv = await startServerProcess({ SW_DIST: page, SW_MAX_PER_IP: '100', SW_ROOMS_PER_IP: '100', SW_CONNECT_BURST: '1000', SW_GRACE_MS: '5000' });
    const socks = [];
    const open = async (...a) => {
      const s = await rawWs(srv.port, ...a);
      socks.push(s);
      return s;
    };
    const xff = (v) => ({ 'X-Forwarded-For': v });
    try {
      // new rooms per address: 20/min, burst 12 (a code that nobody plays makes a new room)
      const scan = [];
      for (let k = 0; k < 16; k++) {
        const x = await open('sw1-scan-' + k, 'secret-scan-' + k + 'xxxxxx', xff('198.51.100.7'));
        if (!x.error) await waitFor(() => x.closed !== null || x.frames.length > 0);
        scan.push(x);
        if (!x.error) {
          x.ws.close(1000);
          await waitFor(() => x.closed !== null);
        }
      }
      const scanRefused = scan.filter((x) => x.error === 429).length;
      assert(scanRefused >= 3 && scanRefused <= 4, `trying 16 codes in a row from one address: ${scanRefused} refused with 429 (12 new rooms at once, then 1 every 3 s)`);
      const hostThere = await open('sw1-live-room', 'secret-live-hostxxxx', xff('198.51.100.8'));
      await waitFor(() => hostThere.frames.length > 0);
      const guestThere = await open('sw1-live-room', 'secret-live-guestxxx', xff('198.51.100.7'));
      await waitFor(() => guestThere.frames.length > 0 || guestThere.closed !== null || guestThere.error);
      assert(!guestThere.error && guestThere.frames.some((f) => f.t === 'p' && f.self), 'joining a game that is there is not a new room (not limited)');
      for (const x of [hostThere, guestThere]) x.ws.close(1000);
      // IPv6: one home gets a whole /64, so the limits count the /64 (the last 64 bits vary)
      const v6 = [];
      for (let k = 0; k < 14; k++) v6.push(await open('sw1-six-' + k, 'secret-six-' + k + 'xxxxxxx', xff(`2001:db8:5:6:${(k + 1).toString(16)}::${k + 2}`)));
      const v6Refused = v6.filter((x) => x.error === 429).length;
      assert(v6Refused >= 1 && v6Refused <= 2, `new rooms from 14 addresses of one IPv6 /64: ${v6Refused} refused (they count as one address)`);
      const v6other = await open('sw1-six-other', 'secret-six-otherxxxx', xff('2001:db8:5:7::1'));
      await waitFor(() => v6other.frames.length > 0 || v6other.error);
      assert(!v6other.error, 'another /64 is another address');
      for (const x of [...v6, v6other]) if (!x.error) x.ws.close(1000);
      await sleep(200);

      // a connection that never said anything and drops: it leaves at once (no 5 s grace)
      const silent = await open('sw1-silent-drop', 'secret-silent-xxxxxx', xff('198.51.100.9'));
      await waitFor(() => silent.frames.length > 0);
      const watcher = await open('sw1-silent-drop', 'secret-silent-watchx', xff('198.51.100.10'));
      await waitFor(() => watcher.frames.length > 0);
      watcher.ws.send(JSON.stringify({ t: 's', patch: { r: 'h' } }));
      silent.ws.terminate();
      await waitFor(() => watcher.frames.some((f) => f.t === 'p' && Array.isArray(f.l) && f.l.length));
      assert(watcher.frames.some((f) => f.t === 'p' && Array.isArray(f.l) && f.l.includes(silent.frames[0].self)), 'a silent page that drops leaves at once');
      const talker = await open('sw1-silent-drop', 'secret-silent-talker', xff('198.51.100.11'));
      await waitFor(() => talker.frames.length > 0);
      talker.ws.send(JSON.stringify({ t: 's', patch: { r: 'g' } }));
      await sleep(100);
      const n0 = watcher.frames.filter((f) => f.t === 'p' && f.l).length;
      talker.ws.terminate();
      await sleep(1000);
      eq(watcher.frames.filter((f) => f.t === 'p' && f.l).length, n0, 'a page that set presence keeps its reconnect grace');
      watcher.ws.close(1000);
      assert(!/secret-/.test(srv.output()), 'no secrets logged');
    } finally {
      for (const x of socks) try { x.ws.terminate(); } catch {}
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
      const rb = await b.open(room);
      a.setState({ r: 'h', n: 1, adm: [[rb.self, 1]] });
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
      a.setState({ n: 3 });
      await waitFor(() => b.peers().some((p) => p.id === ra.self && p.state.n === 3), 15000);
      assert(b.peers().some((p) => p.id === ra.self && p.state.n === 3), 'room rebuilt after restart, same peer, presence flows');
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

// ---------- the review's server attacks ----------

async function serverSafetyTests() {
  await test('server: a 16 KB nested frame never takes the relay down; every answer has security headers', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
    const page = path.join(dir, 'page.html');
    writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
    const srv = await startServerProcess({ SW_DIST: page });
    try {
      const room = 'sw1-heart-star-moon-cat';
      const h = await rawWs(srv.port, room, 'hostsecret0000000000');
      const k = await rawWs(srv.port, room, 'kidsecret00000000000');
      await waitFor(() => h.frames.length > 0 && k.frames.length > 0);
      const bad = await rawWs(srv.port, 'attacker-room', 'attackersecret000000');
      await waitFor(() => bad.frames.length > 0);
      const depth = 7990;
      bad.ws.send('{"t":"b","topic":"x","data":' + '['.repeat(depth) + ']'.repeat(depth) + '}');
      await waitFor(() => bad.frames.some((f) => f.t === 'e'), 3000);
      eq(bad.frames.find((f) => f.t === 'e').code, 'bad_frame', 'the frame is refused');
      await sleep(300);
      eq(srv.child.exitCode, null, 'the server is still running');
      eq((await get(srv.port, '/healthz')).status, 200, '/healthz still answers');
      eq([h.closed, k.closed], [null, null], 'the other room is still open');
      h.ws.send(JSON.stringify({ t: 's', patch: { r: 'h', n: 1 } }));
      await waitFor(() => h.frames.some((f) => f.t === 'p' && !f.reset && f.j), 3000);
      const home = await get(srv.port, '/');
      assert(/frame-ancestors 'none'/.test(home.headers['content-security-policy'] || ''), 'CSP frame-ancestors on the page');
      assert(/connect-src 'self'/.test(home.headers['content-security-policy'] || ''), 'CSP connect-src on the page');
      eq(home.headers['x-frame-options'], 'DENY', 'X-Frame-Options');
      // only the game page may use the microphone (the walkie-talkie), only on this site; the
      // camera never
      const game = await get(srv.port, '/play');
      const pp = game.headers['permissions-policy'] || '';
      assert(/microphone=\(self\)/.test(pp) && /camera=\(\)/.test(pp) && /display-capture=\(\)/.test(pp), 'the game page: microphone for this site only, camera off (' + pp + ')');
      for (const p of ['/healthz', '/nope']) {
        const q = (await get(srv.port, p)).headers['permissions-policy'] || '';
        assert(/microphone=\(\)/.test(q) && /camera=\(\)/.test(q), p + ': microphone and camera off');
      }
      for (const [p, st] of [['/nope', 404], ['/r/sw1-heart-star-moon-cat', 426], ['/healthz', 200]]) {
        const r = await get(srv.port, p);
        eq(r.status, st, p);
        assert(r.headers['x-content-type-options'] === 'nosniff' && r.headers['content-security-policy'], p + ' has security headers');
      }
      for (const s of [h, k, bad]) s.ws.terminate();
      assert(!/hostsecret|kidsecret|attacker|\[\[\[/.test(srv.output()), 'no payloads or secrets logged');
    } finally {
      await stopServer(srv);
    }
  });

  await test('server: stamps come from the device secret; X-Forwarded-For cannot dodge the per-IP limits; new connections are paced', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
    const page = path.join(dir, 'page.html');
    writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
    const srv = await startServerProcess({ SW_DIST: page, SW_MAX_PER_IP: '4', SW_ROOMS_PER_IP: '3', SW_CONNECT_BURST: '40' });
    const socks = [];
    const open = async (...a) => {
      const s = await rawWs(srv.port, ...a);
      socks.push(s);
      return s;
    };
    try {
      const R = 'sw1-heart-star-moon-cat';
      const a = await open(R, 'aaaa-secret-0000000', {}, 'device-one-secret-000000');
      const b = await open(R, 'bbbb-secret-0000000', {}, 'device-one-secret-000000');
      const c = await open(R, 'cccc-secret-0000000', {}, 'device-two-secret-000000');
      await waitFor(() => c.frames.length > 0);
      const stamps = c.frames[0].j.map((e) => [e.peer, e.by, e.at]);
      const byOf = (s) => stamps.find((x) => x[0] === s.frames[0].self)[1];
      assert(byOf(a) && byOf(a) === byOf(b), 'the same device: the same stamp');
      assert(byOf(c) && byOf(c) !== byOf(a), 'another device: another stamp');
      const atOf = (s) => stamps.find((x) => x[0] === s.frames[0].self)[2];
      assert(atOf(a) === atOf(b) && atOf(c) > atOf(a), 'join order: a device keeps its first place (its second page too), a later device comes after');
      for (const s of socks.splice(0)) s.ws.close(1000);
      await sleep(300);
      const other = await open('sw1-cat-cat-cat-cat', 'dddd-secret-0000000', {}, 'device-one-secret-000000');
      await waitFor(() => other.frames.length > 0);
      assert(other.frames[0].j[0].by !== byOf(a), 'in another room the stamp is another (no tracking across rooms)');
      const plain = await open('sw1-cat-cat-cat-sun', 'eeee-secret-0000000');
      await waitFor(() => plain.frames.length > 0);
      eq(plain.frames[0].j[0].by, null, 'no device secret: no stamp');
      for (const s of socks.splice(0)) s.ws.close(1000);
      await sleep(300);
      // per-IP connections: writing X-Forwarded-For does not make a new address
      for (let k = 0; k < 7; k++) await open('sw1-sun-sun-sun-sun', `xff-secret-${k}-0000000`, { 'X-Forwarded-For': `10.0.${k}.1, 127.0.0.1` });
      await waitFor(() => socks.filter((s) => s.closed === 4029).length >= 3, 3000);
      eq(socks.filter((s) => s.closed === 4029).length, 3, 'the 5th, 6th and 7th are refused (4 per IP)');
      for (const s of socks.splice(0)) s.ws.close(1000);
      await sleep(300);
      for (let k = 0; k < 6; k++) await open('sw1-sun-sun-sun-moon', `xfp-secret-${k}-0000000`, { 'X-Forwarded-For': `6.6.${k}.6, 203.0.113.9` });
      await waitFor(() => socks.filter((s) => s.closed === 4029).length >= 2, 3000);
      eq(socks.filter((s) => s.closed === 4029).length, 2, 'the right-most public entry counts (one address)');
      for (const s of socks.splice(0)) s.ws.close(1000);
      await sleep(300);
      // a home whose real address is public 100.x (outside carrier-grade NAT 100.64.0.0/10):
      // the proxy's entry counts, so forged entries in front of it are not new addresses
      for (let k = 0; k < 6; k++) await open('sw1-sun-sun-moon-moon', `xfh-secret-${k}-0000000`, { 'X-Forwarded-For': `5.5.${k}.5, 100.8.1.2` });
      await waitFor(() => socks.filter((s) => s.closed === 4029).length >= 2, 3000);
      eq(socks.filter((s) => s.closed === 4029).length, 2, 'a public 100.x address is the client, not a hop (forged entries before it do not count)');
      for (const s of socks.splice(0)) s.ws.close(1000);
      await sleep(300);
      eq(clientIpOf('100.64.0.2', '100.33.12.7'), '100.33.12.7', 'behind the proxy, a public 100.x entry is the client');
      eq(clientIpOf('100.64.0.2', '6.6.6.6, 100.33.12.7'), '100.33.12.7', 'entries a client wrote before it are never reached');
      eq(clientIpOf('100.64.0.2', '100.130.2.2'), '100.130.2.2', 'the top of 100/8 is public too');
      eq(clientIpOf('100.64.0.2', '6.6.6.6, 100.72.1.1'), '6.6.6.6', 'a carrier-grade NAT hop (100.64.0.0/10) is skipped');
      eq(clientIpOf('100.8.1.2', '6.6.6.6'), '6.6.6.6', "Railway's proxies connect from anywhere in 100.0.0.0/8 (the socket peer)");
      eq(clientIpOf('198.51.100.7', '6.6.6.6'), '198.51.100.7', 'a public socket peer is the client (X-Forwarded-For ignored)');
      eq(clientIpOf('100.64.0.2', '6.6.6.6', false), '100.64.0.2', 'SW_TRUST_PROXY=0: always the socket peer');
      assert(isInternalIp('100.8.1.2', { proxyPeer: true }) && !isInternalIp('100.8.1.2') && isInternalIp('100.127.0.1') && !isInternalIp('100.128.0.1'), '100/8 is a proxy peer; only 100.64.0.0/10 is a hop inside X-Forwarded-For');
      // rooms one address may make at a time
      for (let k = 0; k < 4; k++) await open(`room-made-${k}`, `room-secret-${k}-0000000`);
      await waitFor(() => socks[3].closed !== null, 3000);
      eq(socks.map((s) => s.closed), [null, null, null, 4029], 'three rooms, the fourth is refused');
      for (const s of socks.splice(0)) s.ws.close(1000);
      await sleep(300);
      // new connections per address: a burst of 40, then 1 a second
      let refused = 0;
      for (let k = 0; k < 45; k++) {
        const s = await rawWs(srv.port, 'sw1-gem-gem-gem-gem', `fast-secret-${k}-000000`);
        if (s.error === 429) refused++;
        else s.ws.terminate();
      }
      assert(refused >= 3, 'connecting over and over is slowed down (' + refused + ' refused with 429)');
    } finally {
      for (const s of socks) try { s.ws.terminate(); } catch {}
      await stopServer(srv);
    }
  });
}

// ---------- family accounts on the relay (docs/ACCOUNTS.md §8, §12.6) ----------
// server/server.mjs in this process with an injected fake `accounts` (tools/fake-accounts.mjs,
// the §15.2 shape): refusals and close codes, claims in the room (nickname stamping, wk, r:'h',
// ob, sw.op), live revocation, the per-family limit, the database-down cache, legacy sockets.

/** A WebSocket to /r/<room> with an account cookie and player (?p=). */
async function acctWs(port, room, { secret = 'sec-' + Math.random().toString(36).slice(2, 12) + '-000000', cookie = '', p = null, device = null } = {}) {
  const { WebSocket: WS } = await import('ws');
  return new Promise((resolve) => {
    const q = `?s=${secret}` + (device ? `&d=${device}` : '') + (p ? `&p=${encodeURIComponent(p)}` : '');
    const ws = new WS(`ws://127.0.0.1:${port}/r/${room}${q}`, { headers: cookie ? { Cookie: cookie } : {} });
    const box = { ws, frames: [], closed: null, reason: '', status: null, opened: false, self: null, bytes: 0, closedAt: 0 };
    ws.on('message', (d, isBinary) => {
      if (isBinary) {
        box.bytes += d.length;
        return;
      }
      const f = JSON.parse(d.toString());
      if (f.t === 'p' && f.self) box.self = f.self;
      box.frames.push(f);
    });
    ws.on('close', (code, reason) => {
      box.closed = code;
      box.reason = String(reason);
      box.closedAt = Date.now();
      resolve(box);
    });
    ws.on('unexpected-response', (req, res) => {
      box.status = res.statusCode;
      resolve(box);
    });
    ws.on('error', () => {});
    ws.on('open', () => {
      box.opened = true;
      // refusals close right after the handshake: give them a moment before resolving
      setTimeout(() => resolve(box), 150);
    });
  });
}

/** The latest presence another member has of `peer` (merging p frames). */
function presenceOf(box, peer) {
  let st = null;
  for (const f of box.frames) {
    if (f.t !== 'p') continue;
    if (f.reset) st = null;
    for (const e of f.j || []) if (e.peer === peer) st = { ...e.state };
    for (const [pp, patch] of f.u || []) if (pp === peer) {
      st = { ...(st || {}) };
      for (const k in patch) {
        if (patch[k] === null) delete st[k];
        else st[k] = patch[k];
      }
    }
    if ((f.l || []).includes(peer)) st = null;
  }
  return st;
}

async function startAccountServer(fakeOpts = {}, serverOpts = {}) {
  const { createFakeAccounts } = await import('./fake-accounts.mjs');
  const { createServer } = await import('../server/server.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-acct-'));
  const page = path.join(dir, 'page.html');
  writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
  const fake = await createFakeAccounts({ mode: 'required', ...fakeOpts });
  const app = createServer({ accounts: fake, htmlPath: page, siteDir: path.join(dir, 'no-site'), log: () => {}, connectBurst: 1000, roomsBurst: 1000, maxPerIp: 100, roomsPerIp: 100, ...serverOpts });
  const port = await app.listen(0, '127.0.0.1');
  return { app, fake, port, close: () => app.close() };
}

async function accountTests() {
  console.log('\nFamily accounts on the relay (in-process server, fake accounts)');
  const ROOM = 'sw1-heart-star-moon-cat';

  await test('accounts: refusals complete the handshake, send {t:e, code} and close with 4401-4405 / 1013', async () => {
    const s = await startAccountServer({ mode: 'required' });
    try {
      const { fake, port } = s;
      const fam = fake.addFamily({ plan: 'active', consent: 'verified' });
      const lily = fake.addPlayer(fam, { nickname: 'Lily', friends: true });
      const mia = fake.addPlayer(fam, { nickname: 'Mia', friends: false });
      const dev = fake.addSession(fam, { kind: 'device' });
      const locked = fake.addSession(fam, { kind: 'device', lockPlayer: mia });
      const lapsedFam = fake.addFamily({ plan: 'lapsed', consent: 'verified' });
      const rose = fake.addPlayer(lapsedFam, { nickname: 'Rose', friends: true });
      const lapsedDev = fake.addSession(lapsedFam, { kind: 'device' });
      const trialFam = fake.addFamily({ plan: 'trialing', consent: 'email_plus' });
      const tia = fake.addPlayer(trialFam, { nickname: 'Tia', friends: true });
      const trialDev = fake.addSession(trialFam, { kind: 'device' });
      const cases = [
        ['required mode without p', { cookie: dev.cookie }, 4401, 'signed_out'],
        ['p without a session', { p: lily }, 4401, 'signed_out'],
        ['an unknown session', { cookie: 'sw_sess=' + 'x'.repeat(43), p: lily }, 4401, 'signed_out'],
        ['a lapsed plan', { cookie: lapsedDev.cookie, p: rose }, 4402, 'not_entitled'],
        ['Play with friends off', { cookie: dev.cookie, p: mia }, 4403, 'friends_off'],
        ['consent not verified yet (free week)', { cookie: trialDev.cookie, p: tia }, 4404, 'friends_locked'],
        ["another family's player", { cookie: dev.cookie, p: rose }, 4405, 'player_gone'],
        ['a player that is not there', { cookie: dev.cookie, p: '00000000-0000-4000-8000-000000000000' }, 4405, 'player_gone'],
        ['a device locked to another player', { cookie: locked.cookie, p: lily }, 4405, 'player_gone'],
      ];
      for (const [label, opts, code, name] of cases) {
        const b = await acctWs(port, ROOM, opts);
        await waitFor(() => b.closed !== null, 3000);
        eq([b.opened, b.closed, b.frames], [true, code, [{ t: 'e', code: name }]], label);
      }
      const bad = await acctWs(port, ROOM, { cookie: dev.cookie, p: '<script>' });
      eq(bad.status, 400, 'a malformed p is a 400 before the handshake');
      fake.down = true;
      const down = await acctWs(port, ROOM, { cookie: dev.cookie, p: lily });
      await waitFor(() => down.closed !== null, 3000);
      eq([down.closed, down.frames], [1013, [{ t: 'e', code: 'unavailable' }]], 'the database is down and nothing is cached: 1013 (the page retries)');
      fake.down = false;
      const ok = await acctWs(port, ROOM, { cookie: dev.cookie, p: lily });
      await sleep(200);
      eq([ok.opened, ok.closed], [true, null], 'an entitled player with friends on is let through');
      assert(ok.frames.some((f) => f.t === 'p' && f.self), 'she joined the room');
      eq(ok.frames.filter((f) => f.t === 'v'), [{ t: 'v', k: 'perm', walkie: 0 }], 'an account link is told its walkie permission at once');
      ok.ws.close(1000);
    } finally {
      await s.close();
    }
  });

  await test('accounts: in the room the server stamps nicknames, drops wk without walkie, refuses r:h / ob / sw.op without the claims', async () => {
    const s = await startAccountServer({ mode: 'required' });
    try {
      const { fake, port } = s;
      const famA = fake.addFamily({ plan: 'active', consent: 'verified' });
      const lily = fake.addPlayer(famA, { nickname: 'Lily', friends: true, walkie: true });
      const devA = fake.addSession(famA, { kind: 'device' });
      const famB = fake.addFamily({ plan: 'active', consent: 'verified' });
      const june = fake.addPlayer(famB, { nickname: 'June', friends: true, walkie: false });
      const devB = fake.addSession(famB, { kind: 'device' });
      const H = await acctWs(port, ROOM, { cookie: devA.cookie, p: lily, device: 'device-lily-000000000000' });
      const G = await acctWs(port, ROOM, { cookie: devB.cookie, p: june, device: 'device-june-000000000000' });
      await waitFor(() => H.self && G.self);
      eq(H.frames.find((f) => f.t === 'v'), { t: 'v', k: 'perm', walkie: 1 }, "Lily's grown-up switched her walkie on: perm 1");
      eq(G.frames.find((f) => f.t === 'v'), { t: 'v', k: 'perm', walkie: 0 }, "June's walkie is off: perm 0");
      // the host (a changed page pretending to be someone else) lets June in
      H.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'h', nm: 'Queen Admin', wk: 1, adm: [[G.self, 1]] } }));
      await waitFor(() => presenceOf(G, H.self)?.nm);
      eq(presenceOf(G, H.self).nm, 'Lily', 'the name June sees is the one Lily\'s grown-up chose');
      eq(presenceOf(G, H.self).wk, 1, 'Lily may show her walkie badge');
      G.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'g', nm: 'Lily', wk: 1, ob: [[1, 'p', 1, 2, 3]] } }));
      await waitFor(() => presenceOf(H, G.self)?.nm);
      const g = presenceOf(H, G.self);
      eq([g.nm, g.wk, Array.isArray(g.ob)], ['June', undefined, true], "June cannot be 'Lily', and her walkie badge is dropped (no grown-up switch); she may build");
      // a replace frame is held to the same rules
      G.ws.send(JSON.stringify({ t: 's', replace: true, patch: { v: 1, r: 'g', nm: 'Nobody', wk: 1 } }));
      await sleep(200);
      eq([presenceOf(H, G.self).nm, presenceOf(H, G.self).wk, presenceOf(H, G.self).ob], ['June', undefined, undefined], 'replace: nm stamped, wk dropped');
      H.ws.close(1000);
      G.ws.close(1000);

      // free-join visitors (§8.6): a family without a plan, friends on, email-plus consent
      const v = await startAccountServer({ mode: 'required', friendsMode: 'free-join', mpConsent: 'email_plus' });
      try {
        const famH = v.fake.addFamily({ plan: 'active', consent: 'verified' });
        const host = v.fake.addPlayer(famH, { nickname: 'Lily', friends: true });
        const hDev = v.fake.addSession(famH, { kind: 'device' });
        const famV = v.fake.addFamily({ plan: 'none', consent: 'email_plus' });
        const vis = v.fake.addPlayer(famV, { nickname: 'Poppy', friends: true });
        const vDev = v.fake.addSession(famV, { kind: 'device' });
        const HH = await acctWs(v.port, ROOM, { cookie: hDev.cookie, p: host });
        const V = await acctWs(v.port, ROOM, { cookie: vDev.cookie, p: vis });
        await waitFor(() => HH.self && V.self);
        eq(V.frames.find((f) => f.t === 'v'), { t: 'v', k: 'perm', walkie: 0 }, 'a visitor never has the walkie');
        HH.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'h', adm: [[V.self, 1]] } }));
        await sleep(150);
        V.ws.send(JSON.stringify({ t: 's', patch: { r: 'h', nm: 'x' } }));
        await waitFor(() => V.frames.some((f) => f.t === 'e'));
        eq(V.frames.filter((f) => f.t === 'e').map((f) => f.code), ['cannot_host'], "a visitor's r:'h' is refused");
        V.ws.send(JSON.stringify({ t: 's', patch: { r: 'g', nm: 'x', ob: [[1, 'p', 0, 0, 0]] } }));
        await waitFor(() => presenceOf(HH, V.self)?.nm);
        eq([presenceOf(HH, V.self).nm, presenceOf(HH, V.self).ob, presenceOf(HH, V.self).r], ['Poppy', undefined, 'g'], "a visitor's building outbox never reaches the host");
        V.ws.send(JSON.stringify({ t: 'b', topic: 'sw.op', data: { k: 1 } }));
        V.ws.send(JSON.stringify({ t: 'b', topic: 'sw.bulk', data: { k: 1 } }));
        await waitFor(() => V.frames.filter((f) => f.t === 'e').length >= 3);
        eq(V.frames.filter((f) => f.t === 'e').map((f) => f.code), ['cannot_host', 'cannot_build', 'cannot_build'], 'sw.op / sw.bulk from a visitor are rejected');
        assert(!HH.frames.some((f) => f.t === 'b' && f.topic.startsWith('sw.')), 'the host got none of them');
        V.ws.send(JSON.stringify({ t: 'b', topic: 'sw.ctl', data: { k: 'hi' } }));
        await waitFor(() => HH.frames.some((f) => f.t === 'b' && f.topic === 'sw.ctl'));
        HH.ws.close(1000);
        V.ws.close(1000);
      } finally {
        await v.close();
      }
    } finally {
      await s.close();
    }
  });

  await test('accounts: live revocation within about a second (friends off 4403, signed out 4401, deleted 4405, plan ended 4402); walkie off clears the badge', async () => {
    const s = await startAccountServer({ mode: 'required' });
    try {
      const { fake, port, app } = s;
      const fam = fake.addFamily({ plan: 'active', consent: 'verified' });
      const lily = fake.addPlayer(fam, { nickname: 'Lily', friends: true, walkie: true });
      const mia = fake.addPlayer(fam, { nickname: 'Mia', friends: true, walkie: true });
      const zoe = fake.addPlayer(fam, { nickname: 'Zoe', friends: true });
      const dev = fake.addSession(fam, { kind: 'device' });
      const dev2 = fake.addSession(fam, { kind: 'device' });
      const other = fake.addFamily({ plan: 'active', consent: 'verified' });
      const ann = fake.addPlayer(other, { nickname: 'Ann', friends: true });
      const annDev = fake.addSession(other, { kind: 'device' });
      const H = await acctWs(port, ROOM, { cookie: dev.cookie, p: lily });
      const M = await acctWs(port, ROOM, { cookie: dev2.cookie, p: mia });
      const A = await acctWs(port, ROOM, { cookie: annDev.cookie, p: ann });
      await waitFor(() => H.self && M.self && A.self);
      H.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'h', nm: 'Lily', adm: [[M.self, 1], [A.self, 2]] } }));
      M.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'g', nm: 'Mia', wk: 1 } }));
      await waitFor(() => presenceOf(H, M.self)?.wk === 1);
      // the walkie switch off: the badge goes at once (the voice side is in test-walkie)
      let t0 = Date.now();
      fake.setPlayer(mia, { walkie: false });
      await waitFor(() => presenceOf(H, M.self) && presenceOf(H, M.self).wk === undefined, 2000);
      const wkMs = Date.now() - t0;
      assert(presenceOf(H, M.self).wk === undefined && wkMs < 1000, `Mia's walkie badge is gone in ${wkMs} ms`);
      await waitFor(() => M.frames.some((f) => f.t === 'v' && f.k === 'perm' && f.walkie === 0));
      M.ws.send(JSON.stringify({ t: 's', patch: { wk: 1 } }));
      await sleep(150);
      eq(presenceOf(H, M.self).wk, undefined, 'her page cannot put the badge back');
      // and on again: the page is told
      fake.setPlayer(mia, { walkie: true });
      await waitFor(() => M.frames.filter((f) => f.t === 'v' && f.k === 'perm').at(-1)?.walkie === 1, 2000);
      // Play with friends off: closed with 4403
      t0 = Date.now();
      fake.setPlayer(mia, { friends: false });
      await waitFor(() => M.closed !== null, 2000);
      eq([M.closed, M.frames.filter((f) => f.t === 'e').map((f) => f.code)], [4403, ['friends_off']], 'friends off');
      assert(M.closedAt - t0 < 1000, `closed in ${M.closedAt - t0} ms`);
      await waitFor(() => H.frames.some((f) => f.t === 'p' && (f.l || []).includes(M.self)), 1000);
      assert(H.frames.some((f) => f.t === 'p' && (f.l || []).includes(M.self)), 'the host sees her leave at once');
      eq(A.closed, null, "another family's player is not touched");
      // the device is signed out (Family page: Sign out): 4401
      const Z = await acctWs(port, ROOM, { cookie: dev2.cookie, p: zoe });
      await waitFor(() => Z.self);
      t0 = Date.now();
      fake.revokeSession(dev2.hash);
      await waitFor(() => Z.closed !== null, 2000);
      eq([Z.closed, Z.closedAt - t0 < 1000], [4401, true], 'a revoked session closes with 4401 within a second');
      // the player is deleted: 4405
      fake.deletePlayer(lily);
      await waitFor(() => H.closed !== null, 2000);
      eq(H.closed, 4405, 'a deleted player closes with 4405');
      // the other family's plan ends (a webhook): 4402
      fake.setPlan(other, 'lapsed');
      await waitFor(() => A.closed !== null, 2000);
      eq(A.closed, 4402, 'a plan that ended closes with 4402');
      // a plan that runs out by time is found by the sweep (recheck, cached ≤ 60 s)
      const fam3 = fake.addFamily({ plan: 'canceling', consent: 'verified' });
      const kim = fake.addPlayer(fam3, { nickname: 'Kim', friends: true });
      const kDev = fake.addSession(fam3, { kind: 'device' });
      const K = await acctWs(port, ROOM, { cookie: kDev.cookie, p: kim });
      await waitFor(() => K.self);
      fake.clock.set(30 * 24 * 3600e3); // a month later: the period ended, no event
      await app.recheckAll(false);
      await sleep(100);
      eq(K.closed, null, 'the 60 s cache still answers (a lapse by time takes up to about two minutes)');
      fake.invalidate();
      await app.recheckAll(false);
      await waitFor(() => K.closed !== null, 2000);
      eq(K.closed, 4402, 'the next sweep ends it with 4402');
      fake.clock.set(0);
      const st = app.stats();
      assert(st.revoked >= 5 && st.rechecks > 0 && st.accountConnections === 0, `counters: revoked ${st.revoked}, rechecks ${st.rechecks}, account connections ${st.accountConnections}`);
    } finally {
      await s.close();
    }
  });

  await test('accounts: at most SW_MAX_PER_FAMILY connections per family; the database-down cache keeps friends playing', async () => {
    const s = await startAccountServer({ mode: 'required' }, { maxPerFamily: 2 });
    try {
      const { fake, port, app } = s;
      const fam = fake.addFamily({ plan: 'active', consent: 'verified' });
      const lily = fake.addPlayer(fam, { nickname: 'Lily', friends: true });
      const mia = fake.addPlayer(fam, { nickname: 'Mia', friends: true });
      const dev = fake.addSession(fam, { kind: 'device' });
      const other = fake.addFamily({ plan: 'active', consent: 'verified' });
      const ann = fake.addPlayer(other, { nickname: 'Ann', friends: true });
      const aDev = fake.addSession(other, { kind: 'device' });
      const lilySecret = 'sec-lily-comes-back-0000';
      let a = await acctWs(port, ROOM, { cookie: dev.cookie, p: lily, secret: lilySecret });
      const b = await acctWs(port, 'sw1-cat-cat-cat-cat', { cookie: dev.cookie, p: mia });
      const c = await acctWs(port, 'sw1-sun-sun-sun-sun', { cookie: dev.cookie, p: lily });
      await waitFor(() => c.closed !== null, 2000);
      eq([a.closed, b.closed, c.closed, c.frames.filter((f) => f.t === 'e').map((f) => f.code)], [null, null, 4029, ['limit']], 'the third connection of one family is refused (limit)');
      const d = await acctWs(port, 'sw1-sun-sun-sun-sun', { cookie: aDev.cookie, p: ann });
      await sleep(150);
      eq(d.closed, null, 'another family is not affected');
      eq(app.stats().familyLimited, 1, 'counted');
      b.ws.close(1000);
      await sleep(200);
      const e = await acctWs(port, 'sw1-sun-sun-sun-sun', { cookie: dev.cookie, p: mia });
      await sleep(150);
      eq(e.closed, null, 'after one closes, a new one may come');
      // at the limit, the same page coming back (same peer) before its old socket closed takes
      // its own old place instead of being refused
      const a2 = await acctWs(port, ROOM, { cookie: dev.cookie, p: lily, secret: lilySecret });
      await waitFor(() => a.closed !== null, 2000);
      await sleep(100);
      eq([a.closed, a2.closed, app.stats().familyLimited], [4009, null, 1], 'at the limit, a reconnect of the same page replaces its old socket (4009), it is not refused');
      a = a2;
      // the database goes down: live games go on, a reconnect uses the cached claims
      fake.down = true;
      await app.recheckAll(true);
      await sleep(150);
      eq([a.closed, d.closed, e.closed], [null, null, null], 'a recheck that finds the database down closes nobody');
      a.ws.close(4000);
      await sleep(150);
      const again = await acctWs(port, ROOM, { cookie: dev.cookie, p: lily });
      await sleep(150);
      eq(again.closed, null, 'a reconnect while the database is down is let in from the cache (up to 30 minutes old)');
      const fresh = fake.addSession(fam, { kind: 'device' });
      const nope = await acctWs(port, ROOM, { cookie: fresh.cookie, p: mia });
      await waitFor(() => nope.closed !== null, 2000);
      eq(nope.closed, 1013, 'a session the cache never saw gets 1013 (unavailable)');
      assert(fake.counters.stale >= 1, 'the stale entry was used');
      fake.down = false;
      for (const x of [again, d, e]) x.ws.close(1000);
    } finally {
      await s.close();
    }
  });

  await test('accounts: optional mode lets legacy sockets play exactly as today, never in a room with account children; the Family page exists only with accounts on', async () => {
    const s = await startAccountServer({ mode: 'optional' });
    try {
      const { port, fake } = s;
      const A = await acctWs(port, ROOM, { device: 'device-legacy-a-0000000' });
      const B = await acctWs(port, ROOM, { device: 'device-legacy-b-0000000' });
      await waitFor(() => A.self && B.self);
      eq(A.frames.filter((f) => f.t === 'v'), [], 'no perm frame for a legacy socket');
      A.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'h', nm: 'Anyname', wk: 1, adm: [[B.self, 1]] } }));
      await waitFor(() => presenceOf(B, A.self)?.nm);
      eq([presenceOf(B, A.self).nm, presenceOf(B, A.self).wk], ['Anyname', 1], 'a legacy member keeps her own name and badge');
      B.ws.send(JSON.stringify({ t: 'b', topic: 'sw.op', data: { x: 1 } }));
      await waitFor(() => A.frames.some((f) => f.t === 'b' && f.topic === 'sw.op'));
      const fam = fake.addFamily({ plan: 'active', consent: 'verified' });
      const lily = fake.addPlayer(fam, { nickname: 'Lily', friends: true });
      const dev = fake.addSession(fam, { kind: 'device' });
      // an account child never shares a room with children whose families have no account
      // (her grown-up agreed to friends "whose families have Sparkle World too", §8.2)
      const joinsBefore = A.frames.filter((f) => f.t === 'p' && f.j).length;
      const C = await acctWs(port, ROOM, { cookie: dev.cookie, p: lily });
      await waitFor(() => C.closed !== null, 2000);
      eq([C.closed, C.self, C.frames.some((f) => f.t === 'e' && f.code === 'accounts_mixed')], [4406, null, true], 'an account player cannot join a room of legacy pages: {t:e, accounts_mixed} and 4406, before any roster');
      await sleep(100);
      eq([A.frames.filter((f) => f.t === 'p' && f.j).length, B.frames.some((f) => f.t === 'p' && (f.j || []).some((e) => e.state && e.state.nm === 'Lily'))], [joinsBefore, false], 'the legacy players never see her (no join, no nickname)');
      // a signed-in page without p (it fell back to local mode) plays as a legacy socket
      const D = await acctWs(port, ROOM, { cookie: dev.cookie, device: 'device-legacy-d-0000000' });
      await waitFor(() => D.self || D.closed !== null);
      eq([D.closed, D.frames.filter((f) => f.t === 'v').length], [null, 0], 'optional: a session cookie without p is a legacy socket (no claims, no perm frame)');
      // the other way round: a room with an account child refuses a legacy page
      const ROOM2 = 'sw1-cat-moon-star-heart';
      const mia = fake.addPlayer(fam, { nickname: 'Mia', friends: true });
      const E = await acctWs(port, ROOM2, { cookie: dev.cookie, p: lily });
      await waitFor(() => E.self);
      E.ws.send(JSON.stringify({ t: 's', patch: { v: 1, r: 'h', nm: 'Lily' } }));
      const F = await acctWs(port, ROOM2, { device: 'device-legacy-f-0000000' });
      await waitFor(() => F.closed !== null, 2000);
      eq([F.closed, F.self, F.frames.some((f) => f.t === 'p')], [4406, null, false], 'a legacy page cannot join a room with an account child (4406, no roster, so no nickname or avatar)');
      const G = await acctWs(port, ROOM2, { cookie: fake.addSession(fam, { kind: 'device' }).cookie, p: mia });
      await waitFor(() => G.self || G.closed !== null);
      eq(G.closed, null, 'account children still play together');
      for (const x of [A, B, D, E, G]) x.ws.close(1000);
    } finally {
      await s.close();
    }
    // the Family page files: 404 with accounts off, COOP with accounts on
    const { createServer } = await import('../server/server.mjs');
    const { createFakeAccounts } = await import('./fake-accounts.mjs');
    const dir = mkdtempSync(path.join(tmpdir(), 'sw-site-'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.join(dir, 'account'), { recursive: true });
    for (const f of ['index.html', 'account.html', 'account/verify.html', 'privacy.html', 'terms.html']) writeFileSync(path.join(dir, f), '<!doctype html><title>x</title>');
    for (const f of ['account.js', 'account.css']) writeFileSync(path.join(dir, f), '/* x */');
    const page = path.join(dir, 'page.html');
    writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
    const off = createServer({ htmlPath: page, siteDir: dir, log: () => {} });
    const offPort = await off.listen(0, '127.0.0.1');
    const on = createServer({ accounts: await createFakeAccounts({ mode: 'optional' }), htmlPath: page, siteDir: dir, log: () => {} });
    const onPort = await on.listen(0, '127.0.0.1');
    try {
      for (const p of ['/account', '/account/verify', '/account.js', '/account.css', '/privacy', '/terms']) {
        eq((await get(offPort, p)).status, 404, `accounts off: ${p} is not there`);
        const r = await get(onPort, p);
        eq(r.status, 200, `accounts on: ${p}`);
        const page = p === '/account' || p === '/account/verify';
        eq(r.headers['cross-origin-opener-policy'], page ? 'same-origin' : undefined, `${p}: COOP only on the Family page`);
      }
      eq((await get(offPort, '/')).headers['cross-origin-opener-policy'], undefined, 'the home page: no COOP (as today)');
    } finally {
      await off.close();
      await on.close();
    }
  });
}

// ---------- the same property test through the real server ----------

async function wsPropertyTests() {
  console.log('\nProperty test through the real server (4 WsTransport clients; client-side 30% drop, 5% duplicates, 0-800 ms delay; socket drops)');
  const dir = mkdtempSync(path.join(tmpdir(), 'sw-'));
  const page = path.join(dir, 'page.html');
  writeFileSync(page, '<!doctype html><title>Sparkle World</title>');
  const srv = await startServerProcess({ SW_DIST: page, SW_MAX_PER_IP: '50', SW_ROOMS_PER_IP: '50', SW_CONNECT_BURST: '100000', SW_ROOMS_BURST: '100000' });
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
// Vehicles (docs/teams/vehicles.md §10.2): presence vh and the host's custody of a friend's car
// =====================================================================================

async function vehicleTests() {
  console.log('\nVehicles: presence vh, host custody');
  const { avatarFields, NetHost } = await import('../src/net/host.js');

  await test('vehicles: presence vh - the parser, sent only on change, host presence within 3,900 B', async () => {
    const P = proto.parseVehiclePresence;
    eq(P(['car_kart', 'ff4f7b', 1, 5, 1000001]), ['car_kart', 'ff4f7b', 1, 5, 1000001], 'a good one');
    eq(P(['boat_swan', 'ffffff']), ['boat_swan', 'ffffff', 0, 0, 0], 'missing numbers are 0');
    eq(P(['car_kart', 'ff4f7b', 99, 5000, 2 ** 40]), ['car_kart', 'ff4f7b', 3, 999, 2 ** 31], 'numbers clamped');
    eq(P(['car_kart', 'ff4f7b', 'x', NaN, Infinity]), ['car_kart', 'ff4f7b', 0, 0, 0], 'junk numbers are 0');
    for (const bad of ['car_kart', null, {}, [], ['Car!', 'ff4f7b'], ['car_kart', '#ff4f7b'], ['car_kart', 'FF4F7B'], ['car_kart', 'ff4f7'],
      [['car_kart'], 'ff4f7b'], ['x'.repeat(40), 'ff4f7b'], ['car_kart', 'ff4f7b', 1, 2, 3, 4, 5, 6, 7], ['<b>', 'ff4f7b']]) {
      eq(P(bad), null, 'refused: ' + JSON.stringify(bad).slice(0, 40));
    }
    // avatarFields: vh goes out only when it changes
    const owner = { presenceText: new Map(), lastPos: null, lastLookAt: -Infinity, _set: NetHost.prototype._set };
    const send = (vh) => { const patch = {}; avatarFields(owner, patch, { vh }, 0); return patch; };
    eq(send(['car_kart', 'ff4f7b', 0, 0, 7]).vh, ['car_kart', 'ff4f7b', 0, 0, 7], 'first drive: sent');
    assert(!('vh' in send(['car_kart', 'ff4f7b', 0, 0, 7])), 'unchanged: not sent');
    eq(send(['car_kart', 'ff4f7b', 0, 1, 7]).vh[3], 1, 'a honk: sent');
    eq(send(['bad key!', 'ff4f7b']).vh, null, 'a broken one goes out as null');
    eq(send(null).vh, undefined, 'still null: not sent again');
    // a host with three friends, every field at its biggest, a vehicle too
    const { clock, hub, H, gs } = await hostAndGuests(41, [['Mia', 'u1'], ['Zoe', 'u2'], ['June', 'u3']]);
    H.adapter.vh = ['van_icecream', 'ffbfa0', 3, 999, 2 ** 31 - 1];
    for (const G of gs) G.adapter.vh = ['car_convertible', 'ff5fa2', 3, 999, 2 ** 30];
    await act(clock, [H, ...gs], 3000);
    const hs = jsonBytes(H.session.transport.myState());
    assert(hs <= 3900, 'host presence ' + hs + ' B');
    eq(H.session.transport.myState().vh, ['van_icecream', 'ffbfa0', 3, 999, 2 ** 31 - 1], 'the host\'s vh is out');
    const gp = H.session.transport.peers().find((p) => p.state.nm === 'Mia');
    eq(gp.state.vh, ['car_convertible', 'ff5fa2', 3, 999, 2 ** 30], 'a friend\'s vh reaches the host');
    hub.close();
    return `host presence ${hs} B`;
  });

  await test('vehicles: custody - drive, park while paused, plain remove, refusals, freed seat, 10 s rule, stop, mine=1, Undo building', async () => {
    const { clock, hub, H, gs } = await hostAndGuests(42, [['Mia', 'u1']]);
    const [G] = gs;
    const HA = H.adapter, GA = G.adapter, host = H.session.hostCore;
    const mia = 'u:u1';
    const drive = async (uid) => {
      GA.vh = ['kart_test', 'ff4f7b', 0, 0, uid];
      GA.userRemove(uid);
      await act(clock, [G], 3000);
    };
    const park = async (x, z) => {
      GA.vh = null;
      const uid = GA.userPlace('kart_test', x, 5, z);
      await act(clock, [G], 3000);
      return uid;
    };
    // 1. her own kart: drive (custody), the host pauses building, she parks: accepted, still hers
    const k = GA.userPlace('kart_test', 6, 5, 6);
    await act(clock, [G], 3000);
    assert(HA.ents.has(k) && host.author.ents.get(k) === mia, 'Mia built a kart');
    await drive(k);
    assert(!HA.ents.has(k) && host.custody.has(mia), 'driving: gone, in custody');
    eq(host.custodyRecords().map((r) => [r.uid, r.key, r.x, r.z]), [[k, 'kart_test', 6, 6]], 'custody record (for the host\'s saves)');
    H.session.setRules({ build: 0 });
    await act(clock, [H], 2000);
    const k2 = await park(10, 6);
    assert(HA.ents.has(k2) && HA.ents.get(k2).x === 10, 'parked while building is paused');
    eq(host.author.ents.get(k2), mia, 'still hers');
    eq(host.custody.size, 0, 'no custody left');
    // 2. paused: a vehicle without custody is refused as before
    const before3 = host.stats.rejectCodes['e+:3'] || 0;
    GA.userPlace('kart_test', 14, 5, 6);
    await act(clock, [G], 3000);
    eq((host.stats.rejectCodes['e+:3'] || 0) - before3, 1, 'paused: refused (code 3)');
    H.session.setRules({ build: 1 });
    await act(clock, [H], 2000);
    // a plain Remove of her kart (no vh): no custody, it stays removed
    const k3 = GA.userPlace('kart_test', 18, 5, 6);
    await act(clock, [G], 3000);
    GA.userRemove(k3);
    await act(clock, [G], 15000);
    assert(!HA.ents.has(k3) && host.custody.size === 0, 'Remove is Remove: no custody, not put back');
    // 3. the 10 s rule: she stops saying she drives it (a page that dropped her drive)
    await drive(k2);
    assert(host.custody.has(mia), 'custody again');
    GA.vh = null;
    await act(clock, [G], 4000);
    assert(host.custody.has(mia), 'not yet after 4 s');
    await act(clock, [G], 9000);
    assert(HA.ents.has(k2) && HA.ents.get(k2).x === 10 && host.author.ents.get(k2) === mia, 'back at its spot after 10 s, still hers');
    assert(HA.toasts.some(([t]) => /went back to its spot/.test(t)), 'the host hears it went back');
    assert(await runUntil(clock, () => GA.ents.has(k2), 5000), 'and Mia sees it again');
    // ... but not while a park of it waits in her outbox
    await drive(k2);
    const id = G.session.transport.selfId();
    const p = host.peerMap.get(id);
    host.peerMap.set(id, { ...p, state: { ...p.state, vh: null, ob: [[99999, 'e+', 1000099, 'kart_test', 3, 5, 3, 0, 0, 0]] } });
    const t = clock.now();
    host._watchCustody(t);
    host._watchCustody(t + 11000);
    assert(host.custody.has(mia), 'a park still in her outbox: kept');
    host.peerMap.set(id, p);
    // 4. a freed seat (seat hold over / sent home / her page reloaded): back with uid and owner
    host._freeSeat(1);
    assert(HA.ents.has(k2) && HA.ents.get(k2).x === 10 && host.author.ents.get(k2) === mia && host.custody.size === 0, 'freed seat: back');
    hub.close();

    // 5. stop(): back before the final save; listed until then
    const W2 = await hostAndGuests(43, [['Mia', 'u1']]);
    const kk = W2.gs[0].adapter.userPlace('kart_test', 6, 5, 6);
    await act(W2.clock, [W2.gs[0]], 3000);
    W2.gs[0].adapter.vh = ['kart_test', 'ff4f7b', 0, 0, kk];
    W2.gs[0].adapter.userRemove(kk);
    await act(W2.clock, [W2.gs[0]], 3000);
    eq(W2.H.session.hostCore.custodyRecords().length, 1, 'listed while she drives');
    let seenAtSave = null;
    W2.H.session.env = { ...(W2.H.session.env || {}), saveHost: () => { seenAtSave = W2.H.adapter.ents.has(kk); } };
    await simAwait(W2.clock, W2.H.session.leave());
    assert(W2.H.adapter.ents.has(kk), 'stop: the kart is back');
    assert(seenAtSave === true, 'back before the final save (' + seenAtSave + ')');
    W2.hub.close();

    // 6. mine = 1: she drives the host's car and parks it: a uid of hers, the host still owns it
    const W3 = await hostAndGuests(44, [['Mia', 'u1']]);
    const H3 = W3.H.adapter, G3 = W3.gs[0].adapter, host3 = W3.H.session.hostCore;
    const hk = H3.userPlace('kart_test', 20, 5, 20);
    await act(W3.clock, [W3.H], 3000);
    eq(host3.author.ents.get(hk), 0, 'the host\'s kart');
    W3.H.session.setRules({ mine: 1 });
    await act(W3.clock, [W3.H], 2000);
    G3.vh = ['kart_test', 'ff4f7b', 0, 0, hk];
    G3.userRemove(hk);
    await act(W3.clock, [W3.gs[0]], 3000);
    assert(!H3.ents.has(hk) && host3.custody.has(mia), 'Mia drives the host\'s kart');
    G3.vh = null;
    const nk = G3.userPlace('kart_test', 23, 5, 20);
    await act(W3.clock, [W3.gs[0]], 3000);
    assert(H3.ents.has(nk) && nk >= 1e6 && nk < 2e6, 'parked with a uid of hers');
    eq(host3.author.ents.get(nk), 0, 'the host still owns it');
    // 7. Undo building after take + park: the host's kart is back at its old spot, no custody
    W3.H.session.undoSeat(1);
    assert(H3.ents.has(hk) && H3.ents.get(hk).x === 20 && !H3.ents.has(nk), 'Undo building: back at its old spot');
    eq(host3.custody.size, 0, 'no custody left');
    // careful mode again: the host's kart cannot be taken (refused, she gets it back)
    W3.H.session.setRules({ mine: 0 });
    await act(W3.clock, [W3.H], 2000);
    G3.vh = ['kart_test', 'ff4f7b', 0, 0, hk];
    G3.userRemove(hk);
    await act(W3.clock, [W3.gs[0]], 3000);
    assert(H3.ents.has(hk) && host3.custody.size === 0, 'careful mode: protected, no custody');
    assert(await runUntil(W3.clock, () => G3.ents.has(hk), 5000), 'and it comes back on her page');
    W3.hub.close();
  });
}

// =====================================================================================

const t0 = Date.now();
if (!ONLY || ONLY.has('unit')) await unitTests();
if (!ONLY || ONLY.has('unit') || ONLY.has('vehicles')) await vehicleTests();
if (!ONLY || ONLY.has('prop')) await propertyTests();
if (!ONLY || ONLY.has('server')) await serverTests();
if (!ONLY || ONLY.has('server')) await serverSafetyTests();
if (!ONLY || ONLY.has('accounts')) await accountTests();
if (!ONLY || ONLY.has('ws')) await wsPropertyTests();
console.log(`\n${passed} passed, ${failures} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
