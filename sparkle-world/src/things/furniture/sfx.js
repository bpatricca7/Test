// Little synthesized sounds for furniture (WebAudio, no files): door creaks, a polite flush,
// fire crackles, trampoline boings, bird chirps, running water, bubbles, toy squeaks...
// Everything goes through the game's sfx bus so the Sound settings apply. Silent until the
// first user gesture has unlocked audio.

export function createSfx(game) {
  const A = game.audio;
  const ready = () => !!A.ctx && A.ctx.state === 'running' && !!A.sfxGain;
  let noiseBuf = null;
  const noise = () => {
    if (!noiseBuf) {
      const len = A.ctx.sampleRate;
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
    src.start(when, Math.random() * 0.4);
    src.stop(when + a + d + 0.05);
  }
  const safe = (fn) => (...args) => {
    if (!ready()) return;
    try {
      fn(...args);
    } catch (err) {
      console.warn('[furniture] sound failed', err);
    }
  };

  return {
    creak: safe((open = true) => {
      tone({ f0: open ? 180 : 240, f1: open ? 260 : 150, type: 'triangle', a: 0.04, d: 0.28, vol: 0.12 });
      tone({ f0: open ? 520 : 600, f1: open ? 700 : 420, type: 'sine', t: 0.05, a: 0.03, d: 0.2, vol: 0.05 });
      if (!open) hiss({ t: 0.26, d: 0.06, vol: 0.25, type: 'lowpass', f: 500 });
    }),
    flush: safe(() => {
      hiss({ d: 1.1, vol: 0.28, type: 'bandpass', f: 1800, f1: 300, q: 0.8, a: 0.08 });
      for (let i = 0; i < 6; i++) tone({ f0: 400 + Math.random() * 500, f1: 800 + Math.random() * 600, t: 0.3 + i * 0.1, d: 0.07, vol: 0.06 });
      tone({ f0: 880, f1: 1320, t: 1.1, d: 0.25, vol: 0.08 });
    }),
    crackle: safe((dur = 1.2) => {
      const n = Math.round(dur * 14);
      for (let i = 0; i < n; i++) hiss({ t: Math.random() * dur, d: 0.02 + Math.random() * 0.03, vol: 0.12 + Math.random() * 0.15, type: 'highpass', f: 1500 + Math.random() * 2000 });
      hiss({ d: dur, vol: 0.05, type: 'lowpass', f: 400, a: 0.2 });
    }),
    boing: safe((pitch = 1) => {
      const ctx = A.ctx;
      const when = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150 * pitch, when);
      o.frequency.exponentialRampToValueAtTime(420 * pitch, when + 0.25);
      lfo.frequency.value = 22;
      lg.gain.value = 40 * pitch;
      lfo.connect(lg).connect(o.frequency);
      env(g, when, 0.01, 0.35, 0.4);
      o.connect(g).connect(A.sfxGain);
      o.start(when);
      lfo.start(when);
      o.stop(when + 0.5);
      lfo.stop(when + 0.5);
    }),
    chirp: safe(() => {
      for (let i = 0; i < 3; i++) {
        tone({ f0: 2600 + Math.random() * 400, f1: 3800 + Math.random() * 600, t: i * 0.13, a: 0.005, d: 0.07, vol: 0.12 });
        tone({ f0: 3600, f1: 2400, t: i * 0.13 + 0.06, a: 0.004, d: 0.05, vol: 0.08 });
      }
    }),
    water: safe((dur = 2) => {
      hiss({ d: dur, vol: 0.14, type: 'bandpass', f: 2600, q: 0.6, a: 0.15 });
      for (let i = 0; i < dur * 5; i++) tone({ f0: 900 + Math.random() * 900, f1: 1500 + Math.random() * 900, t: Math.random() * dur, d: 0.05, vol: 0.035 });
    }),
    bubbles: safe((n = 6) => {
      for (let i = 0; i < n; i++) tone({ f0: 500 + Math.random() * 400, f1: 1100 + Math.random() * 700, t: i * 0.07 + Math.random() * 0.05, a: 0.004, d: 0.06, vol: 0.1 });
    }),
    squeak: safe(() => {
      tone({ f0: 900, f1: 1600, type: 'triangle', a: 0.03, d: 0.12, vol: 0.14 });
      tone({ f0: 1600, f1: 1000, type: 'triangle', t: 0.14, a: 0.02, d: 0.12, vol: 0.12 });
    }),
    blip: safe((up = true) => {
      tone({ f0: up ? 600 : 900, f1: up ? 1200 : 400, type: 'square', a: 0.005, d: 0.08, vol: 0.05 });
      tone({ f0: up ? 1200 : 400, type: 'sine', t: 0.08, d: 0.1, vol: 0.08 });
    }),
    ding: safe((n = 2) => {
      for (let i = 0; i < n; i++) {
        tone({ f0: 1046, t: i * 0.45, a: 0.003, d: 0.9, vol: 0.2 });
        tone({ f0: 2093, t: i * 0.45, a: 0.003, d: 0.4, vol: 0.06 });
      }
    }),
    whee: safe(() => {
      tone({ f0: 500, f1: 1400, type: 'triangle', a: 0.05, d: 0.35, vol: 0.14 });
      hiss({ d: 0.8, vol: 0.12, type: 'bandpass', f: 600, f1: 2400, q: 1.4 });
    }),
    fluff: safe(() => {
      hiss({ d: 0.25, vol: 0.2, type: 'lowpass', f: 900, f1: 300, a: 0.03 });
      tone({ f0: 330, f1: 440, d: 0.2, vol: 0.06 });
    }),
    /** Play a list of [midi, beat] notes on the game's note voice (gentle lullabies, jingles). */
    tune(notes, beat = 0.28) {
      let t = 0;
      for (const [m, len] of notes) {
        const at = t;
        setTimeout(() => game.audio.play('note:' + m, { volume: 0.7 }), at * 1000);
        t += (len || 1) * beat;
      }
      return t;
    },
  };
}
