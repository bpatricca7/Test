// Sea animal sounds, synthesized on the game's audio context and sfx bus (no files; the
// structure of src/things/outdoor/sfx.js): a dolphin's clicks and rising whistle, the whale's
// low soft hum with a spout whoosh, a jelly's boop, a crab's clack and a blowhole's pff.
// Everything else goes to the pets' sounds (bloop, giggle, ding, pop) or the core (splash).
// Silent until the first user gesture unlocked audio; quieter than 0.05 is dropped.

import { sfx as petSfx } from '../../things/pets/sfx.js';

const OWN = new Set(['chirp', 'whale', 'boop', 'clack', 'pff']);

export function createSeaSfx(game) {
  const A = game.audio;
  const ready = () => !!A && !!A.ctx && A.ctx.state === 'running' && !!A.sfxGain;
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
  function hiss({ t = 0, d = 0.2, vol = 0.2, f = 1200, f1 = null, q = 1, a = 0.01 }) {
    const ctx = A.ctx;
    const when = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(f, when);
    if (f1) filt.frequency.exponentialRampToValueAtTime(f1, when + d);
    filt.Q.value = q;
    const g = ctx.createGain();
    env(g, when, a, vol, d);
    src.connect(filt).connect(g).connect(A.sfxGain);
    src.start(when, Math.random() * 0.5);
    src.stop(when + a + d + 0.05);
  }
  const last = new Map();

  /** play(name, { volume, pitch }): one of ours, else the pets' or the core's. */
  return function play(name, { volume = 1, pitch = 1 } = {}) {
    if (!(volume >= 0.05)) return;
    if (!OWN.has(name)) {
      petSfx(game, name, { volume, pitch });
      return;
    }
    if (!ready()) return;
    const now = performance.now();
    if (now - (last.get(name) || 0) < 60) return;
    last.set(name, now);
    const v = volume, p = pitch;
    try {
      switch (name) {
        case 'chirp': // a few quick clicks and a rising whistle
          for (let i = 0; i < 4; i++) tone({ f0: 2600 * p, f1: 3200 * p, type: 'square', t: i * 0.035, a: 0.002, d: 0.012, vol: 0.035 * v });
          tone({ f0: 1300 * p, f1: 2900 * p, type: 'sine', t: 0.16, a: 0.02, d: 0.22, vol: 0.13 * v });
          tone({ f0: 2900 * p, f1: 2200 * p, type: 'sine', t: 0.4, a: 0.01, d: 0.1, vol: 0.08 * v });
          break;
        case 'whale': // a low, soft hum and a spout whoosh
          tone({ f0: 140 * p, f1: 210 * p, type: 'sine', a: 0.3, d: 1.1, vol: 0.18 * v });
          tone({ f0: 280 * p, f1: 260 * p, type: 'triangle', t: 0.2, a: 0.25, d: 0.9, vol: 0.05 * v });
          hiss({ t: 0.9, a: 0.05, d: 0.7, vol: 0.12 * v, f: 900, f1: 2400, q: 0.6 });
          break;
        case 'boop':
          tone({ f0: 520 * p, f1: 380 * p, type: 'sine', a: 0.01, d: 0.16, vol: 0.16 * v });
          tone({ f0: 780 * p, f1: 620 * p, type: 'sine', t: 0.12, a: 0.01, d: 0.14, vol: 0.1 * v });
          break;
        case 'clack':
          for (let i = 0; i < 2; i++) hiss({ t: i * 0.09, a: 0.002, d: 0.035, vol: 0.18 * v, f: 2400 * p, q: 6 });
          break;
        case 'pff':
          hiss({ a: 0.01, d: 0.25, vol: 0.09 * v, f: 1600, f1: 700, q: 0.7 });
          break;
        default:
      }
    } catch (err) {
      console.warn('[ocean] sound failed', err);
    }
  };
}
