// Outdoor sounds, synthesized on the game's audio context and sfx bus (no files): the wind
// that rushes past on a zip line (a looping voice driven by her speed), the zing of a new
// cable, campfire crackles, a marshmallow sizzle, cooler pops, juice slurps, creaky rope
// bridges and a soft hammock creak. Silent until the first user gesture unlocked audio.

export function createOutdoorSfx(game) {
  const A = game.audio;
  const ready = () => !!A && !!A.ctx && A.ctx.state === 'running' && !!A.sfxGain;
  let noiseBuf = null;
  const noise = () => {
    if (!noiseBuf) {
      const len = A.ctx.sampleRate * 2;
      noiseBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  };
  const env = (g, t, a, peak, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  function tone({ f0, f1 = null, type = 'sine', t = 0, a = 0.005, d = 0.2, vol = 0.3 }) {
    const ctx = A.ctx;
    const when = ctx.currentTime + t;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, when + a + d);
    env(g, when, a, vol, d);
    o.connect(g).connect(A.sfxGain);
    o.start(when);
    o.stop(when + a + d + 0.05);
  }
  function hiss({ t = 0, d = 0.2, vol = 0.2, type = 'bandpass', f = 1200, f1 = null, q = 1, a = 0.01 }) {
    const ctx = A.ctx;
    const when = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, when);
    if (f1) filt.frequency.exponentialRampToValueAtTime(f1, when + d);
    filt.Q.value = q;
    const g = ctx.createGain();
    env(g, when, a, vol, d);
    src.connect(filt).connect(g).connect(A.sfxGain);
    src.start(when, Math.random() * 1.5);
    src.stop(when + a + d + 0.05);
  }
  const safe = (fn) => (...args) => {
    if (!ready()) return;
    try {
      fn(...args);
    } catch (err) {
      console.warn('[outdoor] sound failed', err);
    }
  };

  // ---------- the zip-line wind: one looping voice whose loudness follows her speed ----------
  let wind = null;
  function windStart() {
    if (!ready() || wind) return;
    try {
      const ctx = A.ctx;
      const src = ctx.createBufferSource();
      src.buffer = noise();
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 500;
      band.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      // the little trolley wheels humming on the cable
      const hum = ctx.createOscillator();
      hum.type = 'triangle';
      hum.frequency.value = 180;
      const hg = ctx.createGain();
      hg.gain.value = 0.0001;
      src.connect(band).connect(g).connect(A.sfxGain);
      hum.connect(hg).connect(A.sfxGain);
      src.start();
      hum.start();
      wind = { src, band, g, hum, hg };
    } catch (err) {
      console.warn('[outdoor] wind failed', err);
      wind = null;
    }
  }
  function windSpeed(speed) {
    if (!wind || !ready()) return;
    const now = A.ctx.currentTime;
    const s = Math.max(0, Math.min(14, speed));
    wind.g.gain.setTargetAtTime(0.03 + s * 0.028, now, 0.12);
    wind.band.frequency.setTargetAtTime(420 + s * 130, now, 0.15);
    wind.hg.gain.setTargetAtTime(0.004 + s * 0.0025, now, 0.12);
    wind.hum.frequency.setTargetAtTime(150 + s * 38, now, 0.1);
  }
  function windStop() {
    if (!wind) return;
    const w = wind;
    wind = null;
    try {
      if (ready()) {
        const now = A.ctx.currentTime;
        w.g.gain.setTargetAtTime(0.0001, now, 0.12);
        w.hg.gain.setTargetAtTime(0.0001, now, 0.08);
        w.src.stop(now + 0.6);
        w.hum.stop(now + 0.6);
      } else {
        w.src.stop();
        w.hum.stop();
      }
    } catch (err) {
      // already stopped
    }
  }

  return {
    windStart,
    windSpeed,
    windStop,
    /** A new cable snaps tight: a bright rising zing with a sparkle on top. */
    zing: safe(() => {
      tone({ f0: 300, f1: 1800, type: 'triangle', a: 0.02, d: 0.45, vol: 0.12 });
      tone({ f0: 1200, f1: 2400, t: 0.18, a: 0.01, d: 0.3, vol: 0.06 });
      hiss({ d: 0.5, vol: 0.06, type: 'highpass', f: 5000 });
    }),
    /** The trolley whizzing back along the cable toward her. */
    whirr: safe((dur = 1) => {
      tone({ f0: 240, f1: 520, type: 'triangle', a: 0.05, d: dur, vol: 0.05 });
      hiss({ d: dur, vol: 0.05, type: 'bandpass', f: 900, f1: 1800, q: 2 });
    }),
    /** A soft thump: landing on a platform, a trolley docking. */
    thump: safe((vol = 1) => {
      tone({ f0: 180, f1: 90, type: 'sine', a: 0.005, d: 0.16, vol: 0.28 * vol });
      hiss({ d: 0.08, vol: 0.08 * vol, type: 'lowpass', f: 700 });
    }),
    /** One burst of campfire crackles (vol 0..1). */
    crackle: safe((vol = 1) => {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        hiss({ t: Math.random() * 0.25, d: 0.015 + Math.random() * 0.03, vol: (0.08 + Math.random() * 0.12) * vol, type: 'highpass', f: 1400 + Math.random() * 2600 });
      }
      if (Math.random() < 0.4) hiss({ d: 0.35, vol: 0.025 * vol, type: 'lowpass', f: 380, a: 0.08 });
    }),
    /** Gentle sizzle while the marshmallow toasts. */
    sizzle: safe((vol = 1) => {
      hiss({ d: 0.5, vol: 0.05 * vol, type: 'bandpass', f: 3200, q: 0.8, a: 0.05 });
      if (Math.random() < 0.5) hiss({ t: Math.random() * 0.3, d: 0.02, vol: 0.08 * vol, type: 'highpass', f: 3000 });
    }),
    /** A lid popping open. */
    pop: safe(() => {
      tone({ f0: 520, f1: 1300, type: 'sine', a: 0.004, d: 0.1, vol: 0.2 });
      hiss({ d: 0.06, vol: 0.1, type: 'highpass', f: 2400 });
    }),
    /** Slurping a juice box through the straw. */
    slurp: safe(() => {
      for (let i = 0; i < 3; i++) hiss({ t: i * 0.16, d: 0.12, vol: 0.12, type: 'bandpass', f: 900 + i * 300, f1: 1800 + i * 300, q: 3 });
      tone({ f0: 660, f1: 990, t: 0.55, d: 0.18, vol: 0.08 });
    }),
    /** Rope and planks creaking. */
    creak: safe((pitch = 1) => {
      tone({ f0: 150 * pitch, f1: 230 * pitch, type: 'sawtooth', a: 0.05, d: 0.22, vol: 0.025 });
      tone({ f0: 310 * pitch, f1: 260 * pitch, type: 'triangle', t: 0.05, a: 0.04, d: 0.2, vol: 0.04 });
    }),
    /** A big springy boing for a wobbly bridge. */
    boing: safe((pitch = 1) => {
      const ctx = A.ctx;
      const when = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(130 * pitch, when);
      o.frequency.exponentialRampToValueAtTime(330 * pitch, when + 0.3);
      lfo.frequency.value = 18;
      lg.gain.value = 30 * pitch;
      lfo.connect(lg).connect(o.frequency);
      env(g, when, 0.01, 0.25, 0.45);
      o.connect(g).connect(A.sfxGain);
      o.start(when);
      lfo.start(when);
      o.stop(when + 0.55);
      lfo.stop(when + 0.55);
    }),
    /** Salon chair spin: a happy swirl. */
    swirl: safe(() => {
      for (let i = 0; i < 6; i++) tone({ f0: 700 + i * 140, f1: 900 + i * 160, t: i * 0.07, a: 0.004, d: 0.1, vol: 0.07 });
      hiss({ d: 0.6, vol: 0.05, type: 'bandpass', f: 800, f1: 3000, q: 1.2 });
    }),
    /** Hair dryer whoosh. */
    dryer: safe(() => {
      hiss({ d: 0.9, vol: 0.09, type: 'bandpass', f: 1400, q: 0.6, a: 0.1 });
      tone({ f0: 210, f1: 240, type: 'sawtooth', a: 0.1, d: 0.8, vol: 0.012 });
    }),
    /** Crickets for a night in the tent. */
    crickets: safe(() => {
      for (let i = 0; i < 4; i++) {
        const t = i * 0.35 + Math.random() * 0.1;
        for (let k = 0; k < 3; k++) tone({ f0: 4200, t: t + k * 0.045, a: 0.003, d: 0.03, vol: 0.025 });
      }
    }),
    /** Cheerful little arpeggio (golden marshmallow, a perfect landing). */
    yay: safe(() => {
      [76, 79, 84, 88].forEach((m, i) => tone({ f0: 440 * Math.pow(2, (m - 69) / 12), t: i * 0.08, a: 0.005, d: 0.3, vol: 0.09 }));
    }),
  };
}
