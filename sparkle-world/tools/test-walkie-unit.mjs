// Walkie-talkie unit tests (no browser): the ADPCM codec round trip (SNR), the resampler,
// the frame format, and the relay (server/voice.mjs) over the real room logic
// (server/rooms.mjs): voice-on gating, "only players of this game", floor arbitration, the
// 15 s cap (time and audio length), idle timeouts, rate / size limits, host mutes, kicks,
// listener mutes. Run by tools/test-walkie.mjs (or on its own: node tools/test-walkie-unit.mjs).

import { W, F_START, F_END, packFrame, readHeader, frameData } from '../src/net/walkie/wire.js';
import { AdpcmEncoder, decodeAdpcm, Downsampler } from '../src/net/walkie/adpcm.js';
import { RoomRegistry } from '../server/rooms.mjs';
import { VoiceRelay } from '../server/voice.mjs';

export async function runUnit({ check, log = console.log }) {
  const results = {};

  // ---------- ADPCM round trip ----------
  {
    const RATE = 16000;
    const n = RATE * 2;
    // speech-like: a gliding voiced tone with harmonics, a syllable envelope, a little noise
    const pcm = new Int16Array(n);
    let phase = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const f0 = 180 + 60 * Math.sin(2 * Math.PI * 1.3 * t);
      phase += (2 * Math.PI * f0) / RATE;
      const env = 0.25 + 0.75 * Math.abs(Math.sin(2 * Math.PI * 2.2 * t));
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(phase * h) / h;
      v = (v * 0.35 + rnd() * 0.02) * env;
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    const enc = new AdpcmEncoder();
    const frames = [];
    for (let i = 0, seq = 0; i < n; i += W.FRAME_SAMPLES, seq++) {
      const block = pcm.subarray(i, Math.min(n, i + W.FRAME_SAMPLES));
      const e = enc.encode(block);
      frames.push(packFrame(seq === 0 ? F_START : i + W.FRAME_SAMPLES >= n ? F_END : 0, seq, e.pred, e.index, e.data));
    }
    // each frame decodes on its own (a lost frame would not break the next one)
    const out = new Float32Array(n);
    let at = 0;
    let bytes = 0;
    for (const f of frames) {
      const h = readHeader(f);
      const d = decodeAdpcm(frameData(f), h.pred, h.index, h.samples);
      out.set(d.subarray(0, Math.min(d.length, n - at)), at);
      at += h.samples;
      bytes += f.length;
    }
    let sig = 0;
    let err = 0;
    for (let i = 0; i < n; i++) {
      const s = pcm[i] / 32768;
      sig += s * s;
      err += (s - out[i]) * (s - out[i]);
    }
    const snr = 10 * Math.log10(sig / err);
    results.snr = +snr.toFixed(1);
    results.bytesPerSecond = Math.round(bytes / 2);
    check(snr > 20, `ADPCM round trip of 2 s speech-like audio: SNR ${snr.toFixed(1)} dB (> 20 dB)`);
    check(Math.abs(bytes / 2 - 8100) < 150, `16 kHz ADPCM in 80 ms frames: ${Math.round(bytes / 2)} B/s (about 8.1 KB/s with headers)`);
    // a frame decoded alone with a different history still matches
    const mid = frames[10];
    const h = readHeader(mid);
    const alone = decodeAdpcm(frameData(mid), h.pred, h.index, h.samples);
    let same = true;
    for (let i = 0; i < alone.length; i++) if (alone[i] !== out[10 * W.FRAME_SAMPLES + i]) same = false;
    check(same, 'a frame in the middle decodes on its own (its header carries the decoder state)');
    // quiet and loud extremes survive
    const loud = new Int16Array(1280).map((_, i) => (i % 40 < 20 ? 32000 : -32000));
    const e2 = new AdpcmEncoder().encode(loud);
    const d2 = decodeAdpcm(e2.data, e2.pred, e2.index, 1280);
    check(d2.every((v) => v >= -1 && v <= 1), 'a full-scale square wave stays within -1..1');
  }

  // ---------- resampler ----------
  {
    for (const inRate of [48000, 44100]) {
      const n = inRate; // 1 s
      const src = new Float32Array(n);
      for (let i = 0; i < n; i++) src[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / inRate);
      const ds = new Downsampler(inRate, 16000);
      const parts = [];
      for (let i = 0; i < n; i += 1024) parts.push(ds.push(src.subarray(i, Math.min(n, i + 1024))));
      const total = parts.reduce((a, p) => a + p.length, 0);
      const all = new Int16Array(total);
      let k = 0;
      for (const p of parts) {
        all.set(p, k);
        k += p.length;
      }
      let zc = 0;
      let peak = 0;
      for (let i = 1; i < all.length; i++) {
        if ((all[i - 1] < 0) !== (all[i] < 0)) zc++;
        peak = Math.max(peak, Math.abs(all[i]));
      }
      check(Math.abs(total - 16000) <= 2, `resampler ${inRate} -> 16000 Hz: ${total} samples for 1 s (in 1024-sample blocks)`);
      check(Math.abs(zc / 2 - 1000) <= 3 && Math.abs(peak / 32767 - 0.5) < 0.02, `a 1 kHz tone stays 1 kHz (${zc / 2} cycles) at the same level (${(peak / 32767).toFixed(3)})`);
    }
  }

  // ---------- frame format ----------
  {
    const f = packFrame(F_START, 513, -1234, 42, new Uint8Array([1, 2, 3, 4]));
    const h = readHeader(f);
    check(h && h.flags === F_START && h.seq === 513 && h.pred === -1234 && h.index === 42 && h.samples === 8, `header round trip ${JSON.stringify(h)}`);
    const bad = (mut) => {
      const g = new Uint8Array(f);
      mut(g);
      return readHeader(g);
    };
    check(bad((g) => { g[0] = 0x58; }) === null, 'a wrong magic byte is refused');
    check(bad((g) => { g[7] = 1; }) === null, 'a reserved byte that is not 0 is refused');
    check(bad((g) => { g[6] = 89; }) === null, 'a step index above 88 is refused');
    check(bad((g) => { g[1] = 4; }) === null, 'unknown flags are refused');
    check(readHeader(new Uint8Array(W.MAX_FRAME_BYTES + 1).fill(0).map((v, i) => (i === 0 ? W.MAGIC : v))) === null, `a frame over ${W.MAX_FRAME_BYTES} B is refused`);
    check(readHeader(new Uint8Array(5)) === null, 'a frame shorter than its header is refused');
  }

  // ---------- the relay ----------
  results.relay = relayTests(check, log);
  return results;
}

function relayTests(check) {
  let clock = 1000;
  const now = () => clock;
  const reg = new RoomRegistry({ now });
  const relay = new VoiceRelay({ registry: reg, now });
  const ROOM = 'sw1-heart-star-moon-cat';
  const pages = {};
  const mk = (peer) => {
    const pg = { peer, json: [], bin: [], presence: [] };
    reg.join(ROOM, peer, (fr) => pg.presence.push(fr), {});
    pg.link = relay.link(ROOM, peer, { json: (o) => pg.json.push(o), binary: (b) => { pg.bin.push(b); return true; } });
    pages[peer] = pg;
    return pg;
  };
  const setState = (peer, patch) => reg.handle(ROOM, peer, { t: 's', patch });
  const H = mk('hosthosthosthost');
  const A = mk('aaaaaaaaaaaaaaaa'); // let in, walkie on
  const B = mk('bbbbbbbbbbbbbbbb'); // let in, walkie OFF
  const K = mk('kkkkkkkkkkkkkkkk'); // knocking (not let in), says walkie on
  const M = mk('mmmmmmmmmmmmmmmm'); // another "host" in the same room, lets itself in
  setState(H.peer, { r: 'h', adm: [[A.peer, 1], [B.peer, 2]] });
  setState(A.peer, { r: 'g' });
  setState(B.peer, { r: 'g' });
  setState(K.peer, { r: 'g', kn: 1 });
  setState(M.peer, { r: 'h', adm: [[H.peer, 1], [A.peer, 2]] });
  const last = (pg, k) => [...pg.json].reverse().find((o) => o.k === k);
  const clear = () => { for (const p of Object.values(pages)) { p.json.length = 0; p.bin.length = 0; } };
  const enc = new AdpcmEncoder();
  let seq = 0;
  const frame = (flags = 0, samples = W.FRAME_SAMPLES) => {
    const e = enc.encode(new Int16Array(samples).map((_, i) => Math.round(8000 * Math.sin(i / 5))));
    return packFrame(flags, seq++ & 0xffff, e.pred, e.index, e.data);
  };
  const bytes = (pg) => pg.bin.reduce((a, b) => a + b.length, 0);

  H.link.control({ t: 'v', k: 'on', h: H.peer });
  A.link.control({ t: 'v', k: 'on', h: H.peer });
  K.link.control({ t: 'v', k: 'on', h: H.peer });
  M.link.control({ t: 'v', k: 'on', h: M.peer });
  check(last(H, 'hi')?.ok === true && last(A, 'hi')?.ok === true, 'the host and a friend she let in are in the game');
  check(last(K, 'hi')?.ok === false, 'a knocking page (not let in) is not in the game, even with walkie on');

  // a press: floor, talk notice, frames only to walkie-on players of this game
  clear();
  H.link.control({ t: 'v', k: 'req' });
  check(last(H, 'go') !== undefined, 'the host presses: the floor is hers (go)');
  check(last(A, 'talk')?.by === H.peer, 'Rosie (walkie on) learns who is talking');
  check(B.json.length === 0 && K.json.length === 0 && M.json.length === 0, 'the walkie-off friend, the knocker and the other "host" learn nothing');
  for (let k = 0; k < 25; k++) {
    clock += 80;
    H.link.binary(frame(k === 0 ? F_START : 0));
  }
  check(A.bin.length === 25 && bytes(A) === 25 * (8 + 640), `Rosie received all 25 frames (${bytes(A)} B)`);
  check(bytes(B) === 0 && bytes(K) === 0 && bytes(M) === 0 && bytes(H) === 0, 'walkie-off friend, knocker, other "host" and the talker herself: zero voice bytes');
  // someone else presses while the host talks
  A.link.control({ t: 'v', k: 'req' });
  check(last(A, 'busy')?.by === H.peer, 'Rosie presses while Lily talks: busy (by Lily)');
  A.link.binary(frame(F_START));
  check(H.bin.length === 0, 'frames from someone without the floor are dropped');
  clock += 80;
  H.link.binary(frame(F_END));
  check(last(A, 'talk') && last(A, 'talk').by === null, 'the last frame ends the press: everyone hears "nobody talks"');
  // cooldown: the same talker must pause a moment; another may go at once
  H.link.control({ t: 'v', k: 'req' });
  check(last(H, 'no')?.why === 'wait', 'the same talker right again: "wait" (0.7 s pause)');
  A.link.control({ t: 'v', k: 'req' });
  check(last(A, 'go') !== undefined, 'Rosie may talk right after Lily');
  A.link.control({ t: 'v', k: 'end' });
  check(relay.floors.size === 0, "an 'end' without a last frame frees the floor");

  // 15 s cap by audio length
  clear();
  clock += 2000;
  H.link.control({ t: 'v', k: 'req' });
  let relayedSamples = 0;
  for (let k = 0; k < 220; k++) {
    clock += 80;
    const before = A.bin.length;
    H.link.binary(frame(k === 0 ? F_START : 0));
    if (A.bin.length > before) relayedSamples += W.FRAME_SAMPLES;
  }
  const cut = last(H, 'cut');
  check(cut?.why === 'cap', `a press that goes on is cut at 15 s (${(relayedSamples / 16000).toFixed(2)} s relayed)`);
  check(relayedSamples <= W.BURST_SAMPLES + W.MAX_FRAME_SAMPLES && relayedSamples >= W.BURST_SAMPLES - W.FRAME_SAMPLES, 'no more than 15 s (+ one frame) of audio per press');
  // 15 s cap by time (slow frames that would stay under the sample cap)
  clear();
  clock += 2000;
  H.link.control({ t: 'v', k: 'req' });
  for (let k = 0; k < 22; k++) {
    clock += 800;
    H.link.binary(frame(0, 320));
    relay.tick();
  }
  check(last(H, 'cut')?.why === 'cap' && relay.floors.size === 0, `by time too: cut after ${W.BURST_MS / 1000} s (+${W.GRACE_MS} ms network slack)`);

  // idle: no first frame / a silent talker
  clear();
  clock += 2000;
  H.link.control({ t: 'v', k: 'req' });
  clock += W.FIRST_FRAME_MS + 10;
  relay.tick();
  check(last(H, 'cut')?.why === 'idle', 'no audio 3 s after "go": the floor is freed');
  clock += 2000;
  H.link.control({ t: 'v', k: 'req' });
  H.link.binary(frame(F_START));
  clock += W.IDLE_MS + 10;
  relay.tick();
  check(last(H, 'cut')?.why === 'idle', 'a talker who goes silent (1.5 s) loses the floor');

  // rate and size limits
  clear();
  clock += 2000;
  H.link.control({ t: 'v', k: 'req' });
  const dropped0 = relay.counts.rateDropped;
  for (let k = 0; k < 100; k++) H.link.binary(frame(0));
  const got = A.bin.length;
  check(relay.counts.rateDropped - dropped0 >= 100 - W.FRAMES_BURST && got <= W.FRAMES_BURST, `a flood of 100 frames at once: ${got} relayed, ${relay.counts.rateDropped - dropped0} dropped (per-talker rate limit)`);
  // and the sustained rate: 3 s of frames 4x too fast
  const d1 = relay.counts.rateDropped;
  const g1 = A.bin.length;
  for (let k = 0; k < 150; k++) {
    clock += 20;
    H.link.binary(frame(0));
  }
  const sent3s = A.bin.length - g1;
  check(sent3s <= Math.ceil(3 * W.FRAMES_PER_S) + 2 && relay.counts.rateDropped - d1 > 60, `4x too fast for 3 s: ${sent3s} frames relayed (limits ${W.FRAMES_PER_S} frames/s, ${W.BYTES_PER_S} B/s), ${relay.counts.rateDropped - d1} dropped`);
  const bad0 = relay.counts.bad;
  H.link.binary(new Uint8Array(W.MAX_FRAME_BYTES + 100));
  const big = frame(0);
  big[0] = 1;
  H.link.binary(big);
  check(relay.counts.bad - bad0 === 2, 'oversized and malformed frames are dropped');
  H.link.control({ t: 'v', k: 'end' });

  // listener mutes
  clear();
  clock += 3000;
  A.link.control({ t: 'v', k: 'mute', p: [H.peer] });
  H.link.control({ t: 'v', k: 'req' });
  H.link.binary(frame(F_START));
  check(A.bin.length === 0, 'Rosie muted Lily for herself: Lily\'s voice is not even sent to her');
  H.link.binary(frame(F_END));
  A.link.control({ t: 'v', k: 'mute', p: [] });

  // host mutes: one friend, then everyone
  clear();
  clock += 3000;
  setState(H.peer, { wm: [0, [A.peer]] });
  A.link.control({ t: 'v', k: 'req' });
  check(last(A, 'no')?.why === 'muted', 'the host muted Rosie: her press is refused (muted)');
  setState(H.peer, { wm: null });
  A.link.control({ t: 'v', k: 'req' });
  A.link.binary(frame(F_START));
  check(H.bin.length === 1, 'unmuted: Rosie talks, Lily hears');
  setState(H.peer, { wm: [1, []] });
  clock += 80;
  A.link.binary(frame(0));
  check(last(A, 'cut')?.why === 'quiet' && H.bin.length === 1, '"Mute everyone" while Rosie talks: cut at the next frame, nothing more relayed');
  clock += 1000;
  H.link.control({ t: 'v', k: 'req' });
  check(last(H, 'no')?.why === 'quiet', '"Mute everyone" also quiets the host\'s own walkie');
  setState(H.peer, { wm: null });

  // sent home while talking
  clear();
  clock += 1000;
  A.link.control({ t: 'v', k: 'req' });
  A.link.binary(frame(F_START));
  setState(H.peer, { adm: [[B.peer, 2]] });
  clock += 80;
  A.link.binary(frame(0));
  check(last(A, 'cut')?.why === 'group' && H.bin.length === 1, 'a friend sent home is cut at once');
  H.link.control({ t: 'v', k: 'req' });
  H.link.binary(frame(F_START));
  check(A.bin.length === 0, 'and hears nothing any more');
  H.link.binary(frame(F_END));
  setState(H.peer, { adm: [[A.peer, 1], [B.peer, 2]] });

  // voice off, closing while talking
  clear();
  clock += 1000;
  A.link.control({ t: 'v', k: 'off' });
  H.link.control({ t: 'v', k: 'req' });
  H.link.binary(frame(F_START));
  check(A.bin.length === 0, 'walkie turned off: nothing more is received');
  H.link.close();
  check(relay.floors.size === 0, 'a talker whose connection closes frees the floor');
  const s = relay.stats();
  check(s.bytesRelayed > 0 && typeof s.cuts.cap === 'number', `relay counters ${JSON.stringify({ grants: s.grants, busy: s.busy, denied: s.denied, cuts: s.cuts })}`);
  return s;
}

// on its own
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  let fails = 0;
  const check = (c, m) => {
    console.log((c ? '  ok: ' : '  FAIL: ') + m);
    if (!c) fails++;
  };
  const r = await runUnit({ check });
  console.log(JSON.stringify({ snr: r.snr, bytesPerSecond: r.bytesPerSecond }));
  if (fails) {
    console.log(`${fails} failed`);
    process.exitCode = 1;
  } else console.log('all walkie unit tests passed');
}
