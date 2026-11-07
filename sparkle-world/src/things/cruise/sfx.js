// Cruise sounds, synthesized on the game's audio context and sfx bus (no files): the ship's
// horn, the lift's ding, the slide's rushing water (a looping voice that follows her speed),
// the big splash, the bell, arcade blips and cheers, deck-game swishes and the dance party's
// own bouncy beat (a little sequencer on the effects bus). Silent until the first user gesture
// unlocked audio; every voice is tracked so it is disconnected when it ends.

export function createCruiseSfx(game) {
  const A = game.audio;
  const ready = () => !!A && !!A.ctx && A.ctx.state === 'running' && !!A.sfxGain;
  const track = (src, ...nodes) => {
    if (A && typeof A.track === 'function') A.track(src, ...nodes);
  };
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
  function tone({ f0, f1 = null, type = 'sine', t = 0, a = 0.005, d = 0.2, vol = 0.3, out = null }) {
    const ctx = A.ctx;
    const when = ctx.currentTime + t;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, when + a + d);
    env(g, when, a, vol, d);
    o.connect(g).connect(out || A.sfxGain);
    o.start(when);
    o.stop(when + a + d + 0.05);
    track(o, g);
  }
  function hiss({ t = 0, d = 0.2, vol = 0.2, type = 'bandpass', f = 1200, f1 = null, q = 1, a = 0.01, out = null }) {
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
    src.connect(filt).connect(g).connect(out || A.sfxGain);
    src.start(when, Math.random() * 1.5);
    src.stop(when + a + d + 0.05);
    track(src, filt, g);
  }
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const safe = (fn) => (...args) => {
    if (!ready()) return;
    try {
      fn(...args);
    } catch (err) {
      console.warn('[cruise] sound failed', err);
    }
  };

  // ---------- the slide's rushing water: one looping voice that follows her speed ----------
  let rush = null;
  function rushStart() {
    if (!ready() || rush) return;
    try {
      const ctx = A.ctx;
      const src = ctx.createBufferSource();
      src.buffer = noise();
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 700;
      band.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(band).connect(g).connect(A.sfxGain);
      src.start();
      rush = { src, band, g };
    } catch (err) {
      console.warn('[cruise] slide sound failed', err);
      rush = null;
    }
  }
  function rushSpeed(v) {
    if (!rush || !ready()) return;
    const now = A.ctx.currentTime;
    const s = Math.max(0, Math.min(14, v));
    rush.g.gain.setTargetAtTime(0.04 + s * 0.022, now, 0.1);
    rush.band.frequency.setTargetAtTime(500 + s * 160 + Math.sin(now * 9) * 120, now, 0.08);
  }
  function rushStop() {
    if (!rush) return;
    const r = rush;
    rush = null;
    try {
      if (ready()) {
        const now = A.ctx.currentTime;
        r.g.gain.setTargetAtTime(0.0001, now, 0.1);
        r.src.stop(now + 0.5);
      } else r.src.stop();
    } catch (err) {
      // already stopped
    }
    try {
      setTimeout(() => {
        try { r.src.disconnect(); r.band.disconnect(); r.g.disconnect(); } catch (e) { /* gone */ }
      }, 700);
    } catch (e) { /* no timers */ }
  }

  // ---------- the dance party: a bouncy beat on the music bus ----------
  // Four songs of our own (bpm, root, a bass line and a sparkly hook in scale steps)
  const SONGS = [
    { bpm: 118, root: 57, bass: [0, 0, 7, 0, 5, 5, 3, 4], hook: [7, 9, 11, 9, 7, 4, 7, 9] },
    { bpm: 124, root: 60, bass: [0, 7, 5, 7, 3, 7, 4, 7], hook: [12, 11, 9, 7, 9, 11, 12, 14] },
    { bpm: 112, root: 55, bass: [0, 0, 3, 3, 5, 5, 4, 4], hook: [9, 7, 9, 12, 11, 9, 7, 4] },
    { bpm: 128, root: 62, bass: [0, 5, 0, 7, 0, 5, 3, 4], hook: [7, 7, 9, 7, 12, 11, 9, 7] },
  ];
  const MAJ = [0, 2, 4, 5, 7, 9, 11];
  const deg = (root, step) => root + 12 * Math.floor(step / 7) + MAJ[((step % 7) + 7) % 7];
  let party = null; // { timer, song, next, step, gain, vol }

  function partyStart(songIndex = 0) {
    if (!ready()) return false;
    const ctx = A.ctx;
    const song = SONGS[((songIndex % SONGS.length) + SONGS.length) % SONGS.length];
    if (party) {
      party.song = song;
      return true;
    }
    try {
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(A.sfxGain); // an activity's sound: the effects volume, like the zip line's wind
      party = { song, next: ctx.currentTime + 0.1, step: 0, gain, vol: 0, timer: null };
      party.timer = setInterval(schedule, 60);
      return true;
    } catch (err) {
      console.warn('[cruise] party music failed', err);
      party = null;
      return false;
    }
  }
  function schedule() {
    if (!party || !ready()) return;
    const ctx = A.ctx;
    const p = party;
    const beat = 60 / p.song.bpm / 2; // eighth notes
    // never schedule a pile of notes after a stall: skip ahead
    if (p.next < ctx.currentTime - 0.2) p.next = ctx.currentTime + 0.05;
    for (let guard = 0; guard < 8 && p.next < ctx.currentTime + 0.25; guard++) {
      const t = p.next - ctx.currentTime;
      const s = p.step % 16;
      const bar = Math.floor(p.step / 16) % 4;
      // kick on the beat, a soft clap on 2 and 4, shaker on the off beats
      if (s % 4 === 0) tone({ f0: 150, f1: 48, type: 'sine', t, a: 0.003, d: 0.2, vol: 0.5, out: p.gain });
      if (s % 8 === 4) hiss({ t, d: 0.12, vol: 0.22, type: 'bandpass', f: 1600, q: 0.9, out: p.gain });
      if (s % 2 === 1) hiss({ t, d: 0.04, vol: 0.08, type: 'highpass', f: 7000, out: p.gain });
      // bass on every eighth, from the song's line
      const b = p.song.bass[(Math.floor(s / 2) + bar * 2) % p.song.bass.length];
      if (s % 2 === 0) tone({ f0: midiHz(deg(p.song.root - 12, b)), type: 'triangle', t, a: 0.01, d: beat * 1.6, vol: 0.32, out: p.gain });
      // the hook: two bars on, two bars of sparkly answer
      const h = p.song.hook[s % p.song.hook.length];
      if (bar < 2 ? s % 2 === 0 : s % 4 === 2) tone({ f0: midiHz(deg(p.song.root + 12, h)), type: 'square', t, a: 0.006, d: beat * 0.9, vol: 0.06, out: p.gain });
      if (bar >= 2 && s % 4 === 0) tone({ f0: midiHz(deg(p.song.root + 24, h + 2)), type: 'sine', t, a: 0.004, d: 0.35, vol: 0.08, out: p.gain });
      p.next += beat;
      p.step++;
    }
  }
  /** Party volume 0..1 (she walks away: it fades; 0 is silent but keeps the beat going). */
  function partyVolume(v) {
    if (!party || !ready()) return;
    const k = Math.max(0, Math.min(1, v));
    if (Math.abs(k - party.vol) < 0.01) return;
    party.vol = k;
    party.gain.gain.setTargetAtTime(Math.max(0.0001, k * 0.55), A.ctx.currentTime, 0.25);
  }
  function partyStop() {
    if (!party) return;
    const p = party;
    party = null;
    clearInterval(p.timer);
    try {
      if (ready()) p.gain.gain.setTargetAtTime(0.0001, A.ctx.currentTime, 0.2);
      setTimeout(() => {
        try { p.gain.disconnect(); } catch (e) { /* gone */ }
      }, 1500);
    } catch (err) {
      // fine
    }
  }

  return {
    rushStart,
    rushSpeed,
    rushStop,
    partyStart,
    partyVolume,
    partyStop,
    get partyOn() { return !!party; },
    /** The ship's horn: a deep, friendly two-note toot. */
    horn: safe(() => {
      for (const [t, f, d] of [[0, 110, 0.55], [0.7, 110, 1.0]]) {
        tone({ f0: f, type: 'sawtooth', t, a: 0.08, d, vol: 0.12 });
        tone({ f0: f * 1.5, type: 'sawtooth', t, a: 0.09, d, vol: 0.07 });
        tone({ f0: f * 2.01, type: 'triangle', t, a: 0.1, d, vol: 0.05 });
      }
    }),
    /** The lift's ding-dong. */
    ding: safe(() => {
      tone({ f0: midiHz(84), type: 'sine', a: 0.004, d: 0.9, vol: 0.2 });
      tone({ f0: midiHz(80), type: 'sine', t: 0.32, a: 0.004, d: 1.1, vol: 0.2 });
      tone({ f0: midiHz(96), type: 'sine', a: 0.004, d: 0.4, vol: 0.04 });
    }),
    /** The ship's bell: ding ding. */
    bell: safe(() => {
      for (const t of [0, 0.42]) {
        tone({ f0: 880, type: 'sine', t, a: 0.003, d: 1.4, vol: 0.18 });
        tone({ f0: 880 * 2.76, type: 'sine', t, a: 0.003, d: 0.6, vol: 0.05 });
        tone({ f0: 880 * 5.4, type: 'sine', t, a: 0.002, d: 0.25, vol: 0.03 });
      }
    }),
    /** A big happy splash into the pool. */
    splash: safe((big = 1) => {
      hiss({ d: 0.6 * big, vol: 0.32, type: 'lowpass', f: 2600, f1: 500, q: 0.6, a: 0.005 });
      hiss({ t: 0.05, d: 0.35, vol: 0.12, type: 'highpass', f: 3000 });
      tone({ f0: 300, f1: 90, type: 'sine', a: 0.005, d: 0.25, vol: 0.2 });
      for (let i = 0; i < 4; i++) tone({ f0: 500 + Math.random() * 600, f1: 1200 + Math.random() * 900, type: 'sine', t: 0.15 + i * 0.07, a: 0.003, d: 0.06, vol: 0.05 });
    }),
    /** The slide gate swings open. */
    gate: safe(() => {
      tone({ f0: 520, f1: 780, type: 'triangle', a: 0.01, d: 0.18, vol: 0.12 });
      tone({ f0: 780, f1: 1170, type: 'triangle', t: 0.12, a: 0.01, d: 0.2, vol: 0.1 });
    }),
    /** A little "wheee" voice-like slide whistle. */
    whee: safe(() => {
      tone({ f0: 700, f1: 1500, type: 'sine', a: 0.05, d: 0.5, vol: 0.12 });
    }),
    /** Arcade: a catch / pop (pitch rises with a streak). */
    blip: safe((n = 0) => {
      const f = midiHz(76 + ((n | 0) % 12));
      tone({ f0: f, f1: f * 1.5, type: 'square', a: 0.004, d: 0.09, vol: 0.06 });
      tone({ f0: f * 2, type: 'sine', t: 0.04, a: 0.003, d: 0.12, vol: 0.05 });
    }),
    /** A soft bubble pop. */
    pop: safe(() => {
      tone({ f0: 500 + Math.random() * 300, f1: 1400, type: 'sine', a: 0.003, d: 0.07, vol: 0.14 });
    }),
    /** A card flips. */
    flip: safe(() => {
      hiss({ d: 0.08, vol: 0.08, type: 'bandpass', f: 2400, q: 1.5 });
      tone({ f0: 900, f1: 1300, type: 'triangle', a: 0.004, d: 0.06, vol: 0.05 });
    }),
    /** A match / a goal: a happy arpeggio. */
    yay: safe((big = false) => {
      const notes = big ? [72, 76, 79, 84, 88] : [76, 79, 84];
      notes.forEach((m, i) => tone({ f0: midiHz(m), type: 'triangle', t: i * 0.07, a: 0.005, d: 0.3, vol: 0.1 }));
    }),
    /** The end of a round: a cheer (a bright fanfare plus crowd-ish noise). */
    cheer: safe(() => {
      [67, 72, 76, 79, 84].forEach((m, i) => tone({ f0: midiHz(m), type: 'square', t: i * 0.09, a: 0.006, d: 0.25, vol: 0.05 }));
      tone({ f0: midiHz(84), type: 'triangle', t: 0.45, a: 0.01, d: 0.9, vol: 0.1 });
      hiss({ t: 0.3, d: 1.2, vol: 0.06, type: 'bandpass', f: 1800, q: 0.4, a: 0.2 });
    }),
    /** A throw / a putt: a soft whoosh. */
    throw: safe((power = 0.5) => {
      hiss({ d: 0.25 + power * 0.2, vol: 0.1, type: 'bandpass', f: 600, f1: 1800 + power * 1500, q: 1.2 });
    }),
    /** Swish (a basket), clink (a ring), thunk (a puck), plop (the golf cup). */
    swish: safe(() => {
      hiss({ d: 0.3, vol: 0.14, type: 'highpass', f: 2500, a: 0.02 });
    }),
    clink: safe(() => {
      tone({ f0: 1900, type: 'sine', a: 0.002, d: 0.3, vol: 0.12 });
      tone({ f0: 2850, type: 'sine', a: 0.002, d: 0.2, vol: 0.06 });
    }),
    thunk: safe(() => {
      tone({ f0: 220, f1: 140, type: 'triangle', a: 0.003, d: 0.12, vol: 0.18 });
      hiss({ d: 0.06, vol: 0.06, type: 'lowpass', f: 900 });
    }),
    boing: safe(() => {
      tone({ f0: 220, f1: 520, type: 'sine', a: 0.005, d: 0.18, vol: 0.12 });
    }),
    plop: safe(() => {
      tone({ f0: 900, f1: 260, type: 'sine', a: 0.004, d: 0.18, vol: 0.18 });
      tone({ f0: 300, f1: 160, type: 'sine', t: 0.12, a: 0.004, d: 0.14, vol: 0.12 });
    }),
    /** The DJ's record scratch when the song changes. */
    scratch: safe(() => {
      hiss({ d: 0.18, vol: 0.14, type: 'bandpass', f: 600, f1: 2400, q: 3 });
      hiss({ t: 0.18, d: 0.14, vol: 0.12, type: 'bandpass', f: 2400, f1: 500, q: 3 });
    }),
    /** The meter's tick for the deck games. */
    tick: safe(() => {
      tone({ f0: 1400, type: 'sine', a: 0.002, d: 0.03, vol: 0.04 });
    }),
  };
}
