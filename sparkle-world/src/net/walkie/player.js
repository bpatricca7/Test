// Playing friends' walkie-talkie voices (and the walkie's little radio sounds).
//
// Each 80 ms frame is decoded (ADPCM -> 16 kHz float) into an AudioBuffer and scheduled on the
// game's AudioContext right after the previous one, 160 ms behind the live edge (a small
// jitter buffer). A press starts with a soft "kssh-bip" squelch and ends with a "roger" beep;
// the music ducks while a friend talks. stop() silences everything scheduled at once (mute,
// "Mute everyone", leaving). Nothing is kept after it played.
//
// Loudness: a friend's page could send a scream or a full-scale blast, so every frame is
// levelled before it plays (levelFrame: the whole 80 ms frame is known before it plays, so this
// is a look-ahead limiter): a frame louder than -14 dBFS RMS or with peaks over 0.8 is turned
// down (at once), and the level comes back up slowly (+2 dB per frame). Normal talking is not
// touched. The voice bus then has its own peak limiter (a DynamicsCompressor at -3 dBFS, 20:1,
// knee 0, 2 ms attack; its automatic make-up gain is cancelled by a trim, so quiet sounds and
// hiss are not lifted) before the game's master gain and compressor.

import { readHeader, frameData, F_END, W } from './wire.js';
import { decodeAdpcm } from './adpcm.js';

const JITTER = 0.16; // s behind the live edge
const LATE = 0.02; // a frame that would start sooner than this re-anchors (underrun)
export const VOICE_GAIN = 1;

/** The per-frame leveller's limits (linear, 1 = full scale). */
export const LEVEL = Object.freeze({ RMS_MAX: 0.2, PEAK_MAX: 0.8, RISE: 1.26 });

/** The voice bus's peak limiter (DynamicsCompressorNode settings). */
export const LIMITER = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.12 });

/**
 * The trim after the limiter that cancels the compressor's automatic make-up gain (Web Audio:
 * makeup = (1 / curve(1.0)) ^ 0.6; for a hard knee curve(1.0) = threshold + (0 - threshold) / ratio).
 */
export function limiterTrim(l = LIMITER) {
  const fullDb = l.threshold + (0 - l.threshold) / l.ratio;
  return 10 ** ((0.6 * fullDb) / 20);
}

/**
 * Level one decoded frame in place: never louder than LEVEL.RMS_MAX (RMS) or LEVEL.PEAK_MAX
 * (peak). `prev` is the gain the previous frame of this press ended with (1 at a press start);
 * returns the gain this frame ends with. Down: at once (a 1 ms ramp, peaks clamped); up: at
 * most LEVEL.RISE per frame (+2 dB), with a 8 ms ramp so nothing clicks.
 */
export function levelFrame(pcm, prev = 1) {
  const n = pcm.length;
  if (!n) return prev;
  let pk = 0;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const v = pcm[i];
    ss += v * v;
    const a = v < 0 ? -v : v;
    if (a > pk) pk = a;
  }
  const rms = Math.sqrt(ss / n);
  let want = 1;
  if (rms > LEVEL.RMS_MAX) want = LEVEL.RMS_MAX / rms;
  if (pk * want > LEVEL.PEAK_MAX) want = LEVEL.PEAK_MAX / pk;
  const g = want < prev ? want : Math.min(want, prev * LEVEL.RISE);
  if (g === 1 && prev === 1) return 1;
  const ramp = Math.min(n, g < prev ? 16 : 128);
  for (let i = 0; i < n; i++) {
    let k = i < ramp ? prev + ((g - prev) * (i + 1)) / ramp : g;
    const a = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (a * k > LEVEL.PEAK_MAX) k = LEVEL.PEAK_MAX / a;
    pcm[i] *= k;
  }
  return g;
}

export class VoicePlayer {
  /** @param {import('../../core/audio.js').AudioEngine} audio */
  constructor(audio) {
    this.audio = audio;
    this.bus = null;
    this.streams = new Map(); // peer -> { next, started, sources:Set }
    this._noise = null;
    this._ducked = false;
    this._unduckTimer = null;
    this.stats = { frames: 0, scheduled: 0, samples: 0, underruns: 0, bursts: 0, stopped: 0, notRunning: 0, bad: 0, levelled: 0 };
  }

  get ctx() {
    return this.audio.ctx;
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  _out() {
    const ctx = this.ctx;
    if (!this.bus || this.bus.context !== ctx) {
      this.bus = ctx.createGain();
      this.bus.gain.value = VOICE_GAIN;
      // the voice bus's own peak limiter (see the top of this file), then a trim that
      // cancels the compressor's automatic make-up gain
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = LIMITER.threshold;
      lim.knee.value = LIMITER.knee;
      lim.ratio.value = LIMITER.ratio;
      lim.attack.value = LIMITER.attack;
      lim.release.value = LIMITER.release;
      const trim = ctx.createGain();
      trim.gain.value = limiterTrim();
      this.bus.connect(lim);
      lim.connect(trim);
      // through the game's master: the Quiet switch silences voices too
      trim.connect(this.audio.master || ctx.destination);
    }
    return this.bus;
  }

  _stream(peer) {
    let s = this.streams.get(peer);
    if (!s) this.streams.set(peer, (s = { next: 0, started: false, sources: new Set(), gain: 1 }));
    return s;
  }

  /** One frame from `peer` (ArrayBuffer / Uint8Array). Returns true when scheduled. */
  frame(peer, bytes) {
    this.stats.frames++;
    const h = readHeader(bytes);
    if (!h) {
      this.stats.bad++;
      return false;
    }
    if (!this.running) {
      this.stats.notRunning++;
      if (h.flags & F_END) this.end(peer);
      return false;
    }
    const ctx = this.ctx;
    const s = this._stream(peer);
    if (h.samples > 0) {
      const pcm = decodeAdpcm(frameData(bytes), h.pred, h.index, h.samples);
      // never much louder than talking: a scream or a blast is turned down before it plays
      s.gain = levelFrame(pcm, s.started ? s.gain : 1);
      if (s.gain < 0.999) this.stats.levelled++;
      const buf = ctx.createBuffer(1, pcm.length, W.RATE);
      buf.getChannelData(0).set(pcm);
      const now = ctx.currentTime;
      if (!s.started || s.next < now + LATE) {
        if (s.started) this.stats.underruns++;
        s.next = now + JITTER;
        if (!s.started) {
          s.started = true;
          this.stats.bursts++;
          this._duck(true);
          this.squelch(s.next - 0.12, true);
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this._out());
      src.onended = () => {
        s.sources.delete(src);
        try { src.disconnect(); } catch {}
      };
      src.start(s.next);
      s.sources.add(src);
      s.next += buf.duration;
      this.stats.scheduled++;
      this.stats.samples += pcm.length;
    }
    if (h.flags & F_END) this.end(peer);
    return true;
  }

  /** The press is over: a roger beep after the last word, then the music comes back. */
  end(peer) {
    const s = this.streams.get(peer);
    if (!s || !s.started) return;
    s.started = false;
    if (!this.running) return;
    const at = Math.max(s.next, this.ctx.currentTime + 0.01);
    this.squelch(at, false);
    this._unduckAt(at + 0.35);
  }

  /** Silence now (a mute, "Mute everyone", leaving): peer = one talker, or everyone. */
  stop(peer = null) {
    for (const [p, s] of this.streams) {
      if (peer !== null && p !== peer) continue;
      if (s.sources.size) this.stats.stopped++;
      for (const src of s.sources) {
        try {
          src.onended = null;
          src.stop();
          src.disconnect();
        } catch {}
      }
      s.sources.clear();
      s.started = false;
      s.next = 0;
    }
    if (![...this.streams.values()].some((s) => s.sources.size)) this._duck(false);
  }

  /** Is something of `peer` (or anyone) still scheduled? */
  playing(peer = null) {
    for (const [p, s] of this.streams) if ((peer === null || p === peer) && s.sources.size) return true;
    return false;
  }

  // ---------- music ducking ----------

  _duck(on) {
    const a = this.audio;
    if (this._unduckTimer) {
      clearTimeout(this._unduckTimer);
      this._unduckTimer = null;
    }
    if (!a.ctx || !a.musicGain || on === this._ducked) return;
    this._ducked = on;
    if (on) a.musicGain.gain.setTargetAtTime(a.musicVolume * 0.28 * 0.3, a.ctx.currentTime, 0.08);
    else if (typeof a._applyVolumes === 'function') a._applyVolumes();
  }

  _unduckAt(t) {
    if (this._unduckTimer) clearTimeout(this._unduckTimer);
    const ms = Math.max(0, (t - this.ctx.currentTime) * 1000);
    this._unduckTimer = setTimeout(() => {
      this._unduckTimer = null;
      if (!this.playing()) this._duck(false);
    }, ms);
  }

  // ---------- radio sounds (synthesized, gentle) ----------

  _noiseBuf() {
    const ctx = this.ctx;
    if (!this._noise || this._noise.sampleRate !== ctx.sampleRate) {
      const n = Math.floor(ctx.sampleRate * 0.25);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._noise = b;
    }
    return this._noise;
  }

  _tone(out, t, f0, f1, dur, vol, type = 'sine') {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.audio.track(o, g);
  }

  _hiss(out, t, dur, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
    this.audio.track(src, bp, g);
  }

  /** Radio squelch: in = "kssh-bip" before a friend's voice, out = "kssh" + roger beep. */
  squelch(t, isIn) {
    if (!this.running) return;
    const out = this._out();
    const at = Math.max(t, this.ctx.currentTime);
    this._hiss(out, at, 0.09, 0.09);
    if (isIn) this._tone(out, at + 0.05, 1320, 1320, 0.05, 0.05);
    else {
      this._tone(out, at + 0.06, 1180, 1180, 0.06, 0.05);
      this._tone(out, at + 0.13, 880, 880, 0.08, 0.05);
    }
  }

  /** My own press: a happy "bi-bip" when the walkie is live, a soft "bip" when let go. */
  cue(kind) {
    if (!this.running) return;
    const out = this.audio.sfxGain || this._out();
    const t = this.ctx.currentTime + 0.005;
    if (kind === 'live') {
      this._tone(out, t, 880, 880, 0.06, 0.22);
      this._tone(out, t + 0.08, 1320, 1320, 0.08, 0.22);
    } else if (kind === 'done') {
      this._tone(out, t, 1100, 700, 0.12, 0.18);
    } else if (kind === 'busy') {
      // "boop boop": someone else has the walkie (friendly, not an error)
      this._tone(out, t, 440, 420, 0.14, 0.28, 'triangle');
      this._tone(out, t + 0.18, 330, 310, 0.18, 0.28, 'triangle');
    } else if (kind === 'cap') {
      this._tone(out, t, 988, 988, 0.1, 0.2);
      this._tone(out, t + 0.14, 784, 784, 0.1, 0.2);
      this._tone(out, t + 0.28, 659, 659, 0.16, 0.2);
    }
  }
}
