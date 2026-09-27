// Playing friends' walkie-talkie voices (and the walkie's little radio sounds).
//
// Each 80 ms frame is decoded (ADPCM -> 16 kHz float) into an AudioBuffer and scheduled on the
// game's AudioContext right after the previous one, 160 ms behind the live edge (a small
// jitter buffer). A press starts with a soft "kssh-bip" squelch and ends with a "roger" beep;
// the music ducks while a friend talks. stop() silences everything scheduled at once (mute,
// "Mute everyone", leaving). Nothing is kept after it played.

import { readHeader, frameData, F_END, W } from './wire.js';
import { decodeAdpcm } from './adpcm.js';

const JITTER = 0.16; // s behind the live edge
const LATE = 0.02; // a frame that would start sooner than this re-anchors (underrun)
const VOICE_GAIN = 1.35;

export class VoicePlayer {
  /** @param {import('../../core/audio.js').AudioEngine} audio */
  constructor(audio) {
    this.audio = audio;
    this.bus = null;
    this.streams = new Map(); // peer -> { next, started, sources:Set }
    this._noise = null;
    this._ducked = false;
    this._unduckTimer = null;
    this.stats = { frames: 0, scheduled: 0, samples: 0, underruns: 0, bursts: 0, stopped: 0, notRunning: 0, bad: 0 };
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
      // through the game's master: the Quiet switch silences voices too
      this.bus.connect(this.audio.master || ctx.destination);
    }
    return this.bus;
  }

  _stream(peer) {
    let s = this.streams.get(peer);
    if (!s) this.streams.set(peer, (s = { next: 0, started: false, sources: new Set() }));
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
