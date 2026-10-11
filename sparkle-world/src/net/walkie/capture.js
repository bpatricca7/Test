// The walkie-talkie microphone: open ONLY while the button is held, closed the moment it is
// let go (every track is stopped, so the browser's / iPad's microphone light goes off).
//
// getUserMedia (echo cancellation, noise suppression, auto gain) -> two 7 kHz low-pass
// filters -> an AudioWorklet tap (ScriptProcessor on old browsers) on the game's own
// AudioContext -> 1024-sample blocks -> Downsampler (16 kHz, 16-bit) -> onPcm(Int16Array).
// Nothing is kept: blocks are handed on and dropped.

import { Downsampler } from './adpcm.js';
import { W } from './wire.js';

// the AudioWorklet (loaded from a Blob, once per AudioContext): copies the input into
// 1024-sample blocks and posts them to the page; 'stop' ends it
const WORKLET = `
class SwWalkieTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
    this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.on) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === 1024) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return this.on;
  }
}
registerProcessor('sw-walkie-tap', SwWalkieTap);
`;

const CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  video: false,
};

export class Mic {
  /** @param {import('../../core/audio.js').AudioEngine} audio the game's audio engine */
  constructor(audio) {
    this.audio = audio;
    this.stream = null;
    this.nodes = [];
    this.tap = null;
    this.onPcm = null; // fn(Int16Array at 16 kHz)
    this._token = 0;
    this._lastTracks = [];
    this.stats = { starts: 0, stops: 0, fails: 0, blocks: 0, samples: 0, worklet: 0, scriptProcessor: 0 };
  }

  static supported() {
    return typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** 'granted' | 'denied' | 'prompt' | 'unknown' (the Permissions API is optional). */
  async permission() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
      const st = await navigator.permissions.query({ name: 'microphone' });
      return st && typeof st.state === 'string' ? st.state : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Ask for the microphone once (the explanation card's OK), then close it at once.
   * Resolves 'ok' | 'denied' | 'none' | 'error'.
   */
  async probe() {
    if (!Mic.supported()) return 'none';
    try {
      const s = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      for (const t of s.getTracks()) t.stop();
      return 'ok';
    } catch (err) {
      const name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
      return 'error';
    }
  }

  /** Is a track of the last stream still live? (tests: must be false right after stop()) */
  get live() {
    return this._lastTracks.some((t) => t.readyState === 'live');
  }

  trackStates() {
    return this._lastTracks.map((t) => t.readyState);
  }

  /** Start capturing. Resolves true when blocks flow; false when stop() came first or it failed. */
  async start() {
    const token = ++this._token;
    this.stats.starts++;
    const ctx = this.audio.ctx;
    if (!ctx || !Mic.supported()) {
      this.stats.fails++;
      return false;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch (err) {
      this.stats.fails++;
      this.error = (err && err.name) || 'error';
      return false;
    }
    this._lastTracks = stream.getTracks();
    if (token !== this._token) {
      // let go while the microphone was starting
      for (const t of stream.getTracks()) t.stop();
      return false;
    }
    this.stream = stream;
    try {
      await this._graph(ctx, stream, token);
    } catch (err) {
      console.warn('[walkie] microphone graph failed', err);
      this.stats.fails++;
      this.stop();
      return false;
    }
    if (token !== this._token) {
      this.stop();
      return false;
    }
    return true;
  }

  async _graph(ctx, stream, token) {
    const src = ctx.createMediaStreamSource(stream);
    const lp1 = ctx.createBiquadFilter();
    const lp2 = ctx.createBiquadFilter();
    for (const f of [lp1, lp2]) {
      f.type = 'lowpass';
      f.frequency.value = 7000;
      f.Q.value = 0.707;
    }
    const sink = ctx.createGain();
    sink.gain.value = 0; // the tap must be pulled by the graph; nothing is heard
    const ds = new Downsampler(ctx.sampleRate, W.RATE);
    const onBlock = (block) => {
      if (token !== this._token || !this.stream) return;
      this.stats.blocks++;
      const pcm = ds.push(block);
      this.stats.samples += pcm.length;
      if (pcm.length && this.onPcm) this.onPcm(pcm);
    };
    let tap = null;
    if (ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
      try {
        if (!ctx.__swWalkieTap) {
          const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
          ctx.__swWalkieTap = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
        }
        await ctx.__swWalkieTap;
        tap = new AudioWorkletNode(ctx, 'sw-walkie-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        tap.port.onmessage = (e) => onBlock(e.data);
        this.stats.worklet++;
      } catch (err) {
        ctx.__swWalkieTap = null;
        tap = null;
      }
    }
    if (!tap) {
      tap = ctx.createScriptProcessor(1024, 1, 1);
      tap.onaudioprocess = (e) => onBlock(e.inputBuffer.getChannelData(0).slice(0));
      this.stats.scriptProcessor++;
    }
    if (token !== this._token) {
      try { tap.port?.postMessage('stop'); } catch {}
      return;
    }
    src.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(tap);
    tap.connect(sink);
    sink.connect(ctx.destination);
    this.tap = tap;
    this.nodes = [src, lp1, lp2, tap, sink];
  }

  /** Stop NOW: every track stopped, nodes disconnected (the microphone light goes off). */
  stop() {
    this._token++;
    const s = this.stream;
    this.stream = null;
    if (s) {
      for (const t of s.getTracks()) {
        try {
          t.stop();
        } catch {}
      }
      this.stats.stops++;
    }
    if (this.tap) {
      try {
        if (this.tap.port) this.tap.port.postMessage('stop');
        else this.tap.onaudioprocess = null;
      } catch {}
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {}
    }
    this.nodes = [];
    this.tap = null;
  }
}
