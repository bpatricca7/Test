// Synthesized sound effects and a gentle generative music-box loop (WebAudio, no files).
// The AudioContext is created on the first user gesture (unlock()), as browsers require.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic steps
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.musicOn = false;
    this.night = false;
    this._noise = null;
    this._musicTimer = null;
    this._nextNoteTime = 0;
    this._step = 0;
    this._melody = 7;
    this._lastPlay = new Map();
  }

  /** Create/resume the context. Safe to call on every gesture. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.ratio.value = 4;
        comp.connect(this.ctx.destination);
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(comp);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.connect(this.master);
        this._applyVolumes();
        if (this.musicOn) this._startMusic();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (err) {
      console.warn('[audio] unavailable', err);
    }
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolumes({ music, sfx } = {}) {
    if (typeof music === 'number') this.musicVolume = music;
    if (typeof sfx === 'number') this.sfxVolume = sfx;
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.sfxVolume * 0.6, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.28, t, 0.3);
  }

  /** Pause/resume all sound (e.g. hidden tab). */
  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  // ---------- building blocks ----------

  _noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  _env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** One oscillator note with an envelope; f1 makes it glide. */
  _tone({ f0, f1 = null, type = 'sine', t = 0, attack = 0.005, decay = 0.2, vol = 0.5, out = null }) {
    const ctx = this.ctx;
    const when = ctx.currentTime + t;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, when);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, when + attack + decay);
    this._env(g, when, attack, vol, decay);
    osc.connect(g).connect(out || this.sfxGain);
    osc.start(when);
    osc.stop(when + attack + decay + 0.05);
    return osc;
  }

  _noiseHit({ t = 0, decay = 0.1, vol = 0.3, filter = 'lowpass', freq = 1200, freq1 = null, q = 0.7 }) {
    const ctx = this.ctx;
    const when = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, when);
    if (freq1) f.frequency.exponentialRampToValueAtTime(freq1, when + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, when, 0.004, vol, decay);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(when, Math.random() * 0.5);
    src.stop(when + decay + 0.05);
  }

  _bell(midi, t, vol, decay = 1.1, out = null) {
    const f = midiToHz(midi);
    this._tone({ f0: f, t, attack: 0.004, decay, vol, out });
    this._tone({ f0: f * 2.01, t, attack: 0.002, decay: decay * 0.5, vol: vol * 0.3, out });
    this._tone({ f0: f * 3.98, t, attack: 0.002, decay: decay * 0.25, vol: vol * 0.12, out });
  }

  // ---------- public ----------

  /**
   * Play a named effect: pop place remove click sparkle chime whoosh splash jump step eat pet
   * bark meow neigh magic success page camera, or 'note:<midi>'.
   */
  play(name, { volume = 1, pitch = 1 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // avoid machine-gun repeats of the same sound in one frame
    const now = performance.now();
    const last = this._lastPlay.get(name) || 0;
    if (now - last < 30) return;
    this._lastPlay.set(name, now);
    const v = volume;
    const p = pitch;
    try {
      if (name.startsWith('note:')) {
        this._bell(Number(name.slice(5)) || 60, 0, 0.5 * v, 1.4);
        return;
      }
      switch (name) {
        case 'pop':
          this._tone({ f0: 420 * p, f1: 980 * p, decay: 0.09, vol: 0.45 * v });
          break;
        case 'place':
          this._tone({ f0: 260 * p, f1: 150 * p, type: 'triangle', decay: 0.1, vol: 0.55 * v });
          this._noiseHit({ decay: 0.05, vol: 0.18 * v, freq: 1800 * p });
          this._tone({ f0: 1560 * p, t: 0.02, decay: 0.12, vol: 0.08 * v });
          break;
        case 'remove':
          this._tone({ f0: 900 * p, f1: 320 * p, decay: 0.16, vol: 0.32 * v });
          this._noiseHit({ decay: 0.14, vol: 0.12 * v, filter: 'highpass', freq: 3000 });
          break;
        case 'click':
          this._tone({ f0: 1250 * p, decay: 0.035, vol: 0.25 * v });
          break;
        case 'sparkle':
          for (let i = 0; i < 4; i++) {
            const m = 84 + PENTA[Math.floor(Math.random() * 5)] + (i % 2) * 12;
            this._tone({ f0: midiToHz(m) * p, t: i * 0.045, decay: 0.18, vol: 0.12 * v });
          }
          break;
        case 'chime':
          this._bell(88, 0, 0.25 * v, 0.9);
          this._bell(95, 0.07, 0.18 * v, 0.9);
          break;
        case 'whoosh':
          this._noiseHit({ decay: 0.35, vol: 0.3 * v, filter: 'bandpass', freq: 400, freq1: 2400, q: 1.2 });
          break;
        case 'splash':
          this._noiseHit({ decay: 0.4, vol: 0.4 * v, freq: 2200, freq1: 400 });
          for (let i = 0; i < 3; i++) this._tone({ f0: 500 + Math.random() * 500, f1: 900 + Math.random() * 600, t: 0.05 + i * 0.07, decay: 0.06, vol: 0.12 * v });
          break;
        case 'jump':
          this._tone({ f0: 300 * p, f1: 620 * p, type: 'triangle', decay: 0.13, vol: 0.3 * v });
          break;
        case 'step':
          this._noiseHit({ decay: 0.045, vol: 0.08 * v, freq: 700 * p });
          break;
        case 'eat':
          for (let i = 0; i < 3; i++) this._noiseHit({ t: i * 0.12, decay: 0.07, vol: 0.3 * v, filter: 'bandpass', freq: 1500 + Math.random() * 800, q: 1.5 });
          break;
        case 'pet':
          this._tone({ f0: 520 * p, f1: 700 * p, decay: 0.18, vol: 0.2 * v });
          this._tone({ f0: 700 * p, f1: 880 * p, t: 0.16, decay: 0.22, vol: 0.2 * v });
          break;
        case 'bark':
          for (let i = 0; i < 2; i++) {
            this._tone({ f0: 480 * p, f1: 260 * p, type: 'square', t: i * 0.2, attack: 0.01, decay: 0.09, vol: 0.12 * v });
            this._noiseHit({ t: i * 0.2, decay: 0.08, vol: 0.12 * v, filter: 'bandpass', freq: 900, q: 2 });
          }
          break;
        case 'meow':
          this._tone({ f0: 650 * p, f1: 1000 * p, type: 'triangle', attack: 0.05, decay: 0.2, vol: 0.2 * v });
          this._tone({ f0: 1000 * p, f1: 560 * p, type: 'triangle', t: 0.22, decay: 0.25, vol: 0.18 * v });
          break;
        case 'neigh':
          for (let i = 0; i < 5; i++) this._tone({ f0: (900 - i * 70) * p, f1: (800 - i * 70) * p, type: 'sawtooth', t: i * 0.08, decay: 0.07, vol: 0.06 * v });
          break;
        case 'magic':
          for (let i = 0; i < 7; i++) {
            const m = 72 + PENTA[i % 5] + Math.floor(i / 5) * 12;
            this._bell(m + 12, i * 0.06, 0.13 * v, 0.6);
          }
          this._noiseHit({ decay: 0.6, vol: 0.06 * v, filter: 'highpass', freq: 5000 });
          break;
        case 'success':
          [72, 76, 79, 84].forEach((m, i) => this._bell(m, i * 0.1, 0.22 * v, 0.9));
          break;
        case 'page':
          this._noiseHit({ decay: 0.16, vol: 0.18 * v, filter: 'highpass', freq: 2500, freq1: 6000 });
          break;
        case 'camera':
          this._noiseHit({ decay: 0.03, vol: 0.4 * v, filter: 'highpass', freq: 3000 });
          this._noiseHit({ t: 0.09, decay: 0.05, vol: 0.3 * v, filter: 'bandpass', freq: 1800 });
          break;
        default:
          this._tone({ f0: 660 * p, decay: 0.08, vol: 0.2 * v });
      }
    } catch (err) {
      console.warn('[audio] play failed', name, err);
    }
  }

  /** Turn the music-box loop on/off. */
  music(on) {
    this.musicOn = !!on;
    if (!this.ctx) return;
    if (this.musicOn) this._startMusic();
    else this._stopMusic();
  }

  /** Night theme: slower, lower, softer. */
  setNight(night) {
    this.night = !!night;
  }

  _startMusic() {
    if (this._musicTimer || !this.ctx) return;
    this._nextNoteTime = this.ctx.currentTime + 0.2;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 90);
  }

  _stopMusic() {
    if (this._musicTimer) clearInterval(this._musicTimer);
    this._musicTimer = null;
  }

  _scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const beat = this.night ? 0.62 : 0.4; // seconds per eighth note
    const chords = [0, -3, 5, 7]; // I vi IV V (as root offsets from C)
    while (this._nextNoteTime < ctx.currentTime + 0.35) {
      const t = this._nextNoteTime - ctx.currentTime;
      const step = this._step++;
      const bar = Math.floor(step / 8) % 4;
      const root = 60 + chords[bar] - (this.night ? 12 : 0);
      if (step % 8 === 0) this._bell(root - 12, t, 0.22, 2.2, this.musicGain);
      if (step % 8 === 4 && !this.night) this._bell(root - 5, t, 0.12, 1.6, this.musicGain);
      // melody: random walk on the pentatonic scale, resting now and then
      const rest = Math.random() < (this.night ? 0.45 : 0.25);
      if (!rest) {
        this._melody += Math.floor(Math.random() * 5) - 2;
        this._melody = Math.max(3, Math.min(12, this._melody));
        const oct = Math.floor(this._melody / 5), deg = this._melody % 5;
        const m = 60 + (this.night ? 0 : 12) + oct * 12 + PENTA[deg] - 12;
        this._bell(m, t, this.night ? 0.12 : 0.16, 1.3, this.musicGain);
      }
      this._nextNoteTime += beat;
    }
  }
}
