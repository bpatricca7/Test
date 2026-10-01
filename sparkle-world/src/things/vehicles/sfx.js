// Vehicle sounds, synthesized on the game's audio context and sfx bus (no files): one engine
// voice while she drives (its pitch and loudness follow the speed), a horn per vehicle, the
// soft boing of a bump, a splash, reversing beeps. Every one-shot voice is tracked
// (audio.track) so it is disconnected when it ends. Silent until the first user gesture
// unlocked audio.

// engine voices: two detuned oscillators through a lowpass, some noise, an optional putt-putt
const ENGINES = {
  buzz: { type: 'square', f0: 70, f1: 150, cut: 600, noise: 0.02, vol: 0.022 },
  purr: { type: 'sawtooth', f0: 48, f1: 110, cut: 500, noise: 0.015, vol: 0.03 },
  rumble: { type: 'sawtooth', f0: 38, f1: 85, cut: 380, noise: 0.03, vol: 0.04 },
  zip: { type: 'square', f0: 95, f1: 230, cut: 900, noise: 0.01, vol: 0.02 },
  hum: { type: 'triangle', f0: 55, f1: 120, cut: 450, noise: 0.02, vol: 0.045 },
  putt: { type: 'sawtooth', f0: 52, f1: 120, cut: 520, noise: 0.03, vol: 0.035, lfo: [7, 16] },
  pedal: { type: 'triangle', f0: 90, f1: 140, cut: 400, noise: 0.03, vol: 0.012, lfo: [2, 5] },
  sail: { type: 'sine', f0: 60, f1: 70, cut: 200, noise: 0.06, vol: 0.0, lfo: null },
};

export function createVehicleSfx(game) {
  const A = game.audio;
  const ready = () => !!A && !!A.ctx && A.ctx.state === 'running' && !!A.sfxGain;
  const track = (src, ...nodes) => { if (A.track) A.track(src, ...nodes); };
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
  function tone({ f0, f1 = null, type = 'sine', t = 0, a = 0.005, d = 0.2, vol = 0.3, vib = 0 }) {
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
    track(o, g);
    if (vib) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = 9;
      lg.gain.value = vib;
      l.connect(lg).connect(o.frequency);
      l.start(when);
      l.stop(when + a + d + 0.05);
      track(l, lg);
    }
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
    track(src, filt, g);
  }
  const safe = (fn) => (...args) => {
    if (!ready()) return;
    try {
      fn(...args);
    } catch (err) {
      console.warn('[vehicles] sound failed', err);
    }
  };
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- horns (v = loudness 0..1: friends' horns fade with distance) ----------
  const HORNS = {
    meep: (v) => { for (const t of [0, 0.2]) tone({ f0: 880, f1: 990, type: 'square', t, a: 0.005, d: 0.12, vol: 0.06 * v }); },
    aooga: (v) => {
      tone({ f0: 180, f1: 420, type: 'sawtooth', a: 0.02, d: 0.32, vol: 0.07 * v });
      tone({ f0: 420, f1: 300, type: 'sawtooth', t: 0.36, a: 0.01, d: 0.3, vol: 0.07 * v });
    },
    honk: (v) => { for (const t of [0, 0.24]) { tone({ f0: 392, type: 'square', t, a: 0.01, d: 0.16, vol: 0.05 * v }); tone({ f0: 494, type: 'square', t, a: 0.01, d: 0.16, vol: 0.04 * v }); } },
    beep: (v) => tone({ f0: 1046, type: 'square', a: 0.005, d: 0.14, vol: 0.05 * v }),
    toot: (v) => { for (const t of [0, 0.3]) tone({ f0: 262, f1: 270, type: 'triangle', t, a: 0.03, d: 0.24, vol: 0.16 * v, vib: 3 }); },
    jingle: (v) => [72, 76, 79, 84, 79, 76].forEach((m, i) => tone({ f0: midi(m), t: i * 0.12, a: 0.004, d: 0.4, vol: 0.09 * v })),
    quack: (v) => {
      for (const t of [0, 0.22]) {
        tone({ f0: 520, f1: 300, type: 'sawtooth', t, a: 0.01, d: 0.13, vol: 0.05 * v });
        hiss({ t, d: 0.12, vol: 0.05 * v, f: 1100, f1: 700, q: 4 });
      }
    },
    ding: (v) => { for (const t of [0, 0.32]) { tone({ f0: 1568, t, a: 0.003, d: 0.6, vol: 0.08 * v }); tone({ f0: 3136, t, a: 0.003, d: 0.3, vol: 0.03 * v }); } },
  };

  // ---------- the engine: one looping voice ----------
  let eng = null;
  function engineStart(kind) {
    if (!ready() || eng) return;
    const spec = ENGINES[kind] || ENGINES.purr;
    try {
      const ctx = A.ctx;
      const now = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = spec.cut;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = o2.type = spec.type;
      o1.frequency.value = spec.f0;
      o2.frequency.value = spec.f0 * 1.007;
      o1.connect(lp);
      o2.connect(lp);
      const src = ctx.createBufferSource();
      src.buffer = noise();
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 600;
      band.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.value = 0.0001;
      src.connect(band).connect(ng).connect(A.sfxGain);
      // a putt-putt: the loudness wobbles with the speed
      const am = ctx.createGain();
      am.gain.value = 1;
      lp.connect(am).connect(out).connect(A.sfxGain);
      let lfo = null, lg = null;
      if (spec.lfo) {
        lfo = ctx.createOscillator();
        lfo.frequency.value = spec.lfo[0];
        lg = ctx.createGain();
        lg.gain.value = 0.45;
        lfo.connect(lg).connect(am.gain);
        lfo.start(now);
      }
      o1.start(now);
      o2.start(now);
      src.start(now);
      out.gain.setTargetAtTime(spec.vol * 0.6, now, 0.08);
      eng = { spec, out, lp, o1, o2, src, band, ng, am, lfo, lg, last: -1 };
      // a little "vroom" as it starts
      if (spec.vol > 0) tone({ f0: spec.f0 * 1.6, f1: spec.f0 * 3, type: spec.type === 'sine' ? 'triangle' : spec.type, a: 0.05, d: 0.25, vol: spec.vol * 0.9 });
    } catch (err) {
      console.warn('[vehicles] engine failed', err);
      eng = null;
    }
  }
  /** u = speed share 0..1 (only touches the audio graph when it changed by more than 2%). */
  function engineSpeed(u) {
    if (!eng || !ready()) return;
    u = Math.max(0, Math.min(1, Number.isFinite(u) ? u : 0));
    if (Math.abs(u - eng.last) < 0.02) return;
    eng.last = u;
    const s = eng.spec, now = A.ctx.currentTime;
    const f = s.f0 + (s.f1 - s.f0) * u;
    eng.o1.frequency.setTargetAtTime(f, now, 0.1);
    eng.o2.frequency.setTargetAtTime(f * 1.007, now, 0.1);
    eng.lp.frequency.setTargetAtTime(s.cut * (1 + u), now, 0.15);
    eng.out.gain.setTargetAtTime(Math.max(0.0001, s.vol * (0.6 + 0.6 * u)), now, 0.12);
    eng.ng.gain.setTargetAtTime(Math.max(0.0001, s.noise * (0.2 + u)), now, 0.15);
    eng.band.frequency.setTargetAtTime(500 + 900 * u, now, 0.15);
    if (eng.lfo) eng.lfo.frequency.setTargetAtTime(s.lfo[0] + (s.lfo[1] - s.lfo[0]) * u, now, 0.2);
  }
  function engineStop() {
    if (!eng) return;
    const e = eng;
    eng = null;
    try {
      const nodes = [e.o1, e.o2, e.src, e.lfo].filter(Boolean);
      if (ready()) {
        const now = A.ctx.currentTime;
        e.out.gain.setTargetAtTime(0.0001, now, 0.1);
        e.ng.gain.setTargetAtTime(0.0001, now, 0.1);
        for (const n of nodes) n.stop(now + 0.5);
      } else {
        for (const n of nodes) n.stop();
      }
      const all = [e.out, e.lp, e.band, e.ng, e.am, e.lg].filter(Boolean);
      e.o1.onended = () => {
        for (const n of [...nodes, ...all]) {
          try { n.disconnect(); } catch { /* already */ }
        }
      };
    } catch (err) {
      // already stopped
    }
  }

  return {
    engineStart,
    engineSpeed,
    engineStop,
    get engineOn() { return !!eng; },
    /** The vehicle's own horn (horn key from def.vehicle.horn), v = loudness 0..1. */
    horn: safe((kind, v = 1) => (HORNS[kind] || HORNS.beep)(Math.max(0.05, Math.min(1, v)))),
    /** A soft springy boing for a bump (never a crash). */
    boing: safe((v = 1) => {
      tone({ f0: 140, f1: 360, a: 0.01, d: 0.4, vol: 0.2 * v, vib: 30 });
      hiss({ d: 0.08, vol: 0.05 * v, type: 'lowpass', f: 600 });
    }),
    /** Water at the bow or the shore. */
    splash: safe((v = 1) => {
      hiss({ d: 0.35, vol: 0.12 * v, f: 900, f1: 400, q: 0.8, a: 0.02 });
      hiss({ t: 0.05, d: 0.2, vol: 0.06 * v, type: 'highpass', f: 2500 });
    }),
    /** Two soft beeps while reversing. */
    reverse: safe(() => { for (const t of [0, 0.3]) tone({ f0: 1250, t, a: 0.005, d: 0.12, vol: 0.035 }); }),
    /** The lights click on or off. */
    click: safe((on) => tone({ f0: on ? 1400 : 900, type: 'square', a: 0.002, d: 0.04, vol: 0.04 })),
  };
}
