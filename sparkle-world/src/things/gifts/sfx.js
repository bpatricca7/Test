// Gift sounds, synthesized on the core audio context and sfx bus (the Sound slider and mute
// apply; silent until the first gesture unlocked audio): paper crinkle, a scissors snip, the
// ribbon's zip, the bow's pop, a ta-da, the box's wiggle, the unwrap burst and one little
// sound per toy. Noise is filled with mulberry32 (seeded), so nothing here is random.

import { mulberry32 } from '../../core/util.js';
import { shopSfx } from '../shops/sfx.js';
import { sfx as lifeSfx } from '../pets/sfx.js';

function out(game) {
  const a = game && game.audio;
  if (!a || !a.ctx || a.ctx.state !== 'running' || !a.sfxGain) return null;
  return a;
}

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const n = Math.floor(ctx.sampleRate * 0.6);
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  const rand = mulberry32(1225);
  for (let i = 0; i < n; i++) d[i] = rand() * 2 - 1;
  return noiseBuf;
}

function tone(a, { f0, f1 = null, type = 'sine', t = 0, attack = 0.01, decay = 0.2, vol = 0.15 }) {
  const ctx = a.ctx, when = ctx.currentTime + t;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, when);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, when + attack + decay);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  o.connect(g).connect(a.sfxGain);
  if (a.track) a.track(o, g);
  o.start(when);
  o.stop(when + attack + decay + 0.05);
}

function hiss(a, { t = 0, d = 0.2, vol = 0.15, type = 'lowpass', f = 900, f1 = null, q = 0.8, attack = 0.02 }) {
  const ctx = a.ctx, when = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f, when);
  if (f1) filt.frequency.exponentialRampToValueAtTime(f1, when + d);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + d);
  src.connect(filt).connect(g).connect(a.sfxGain);
  if (a.track) a.track(src, filt, g);
  src.start(when);
  src.stop(when + d + 0.05);
}

// a happy major arpeggio (C E G C) from `base` Hz
const arp = (a, base, v, step = 0.07, type = 'triangle') => {
  [1, 1.26, 1.5, 2].forEach((m, i) => tone(a, { f0: base * m, type, t: i * step, decay: 0.28, vol: 0.07 * v }));
};

/** A gift sound by name; unknown names fall back to the pets' sound set. */
export function giftSfx(game, name, { volume = 1, pitch = 1 } = {}) {
  const a = out(game);
  if (!a) return;
  const v = Math.max(0, Math.min(1.5, Number.isFinite(volume) ? volume : 1));
  const p = Math.max(0.5, Math.min(2, Number.isFinite(pitch) ? pitch : 1));
  try {
    switch (name) {
      case 'pick': // a choice tile: a soft paper tap
        hiss(a, { d: 0.07, vol: 0.08 * v, type: 'bandpass', f: 2600 * p, q: 1.4, attack: 0.004 });
        tone(a, { f0: 660 * p, f1: 880 * p, decay: 0.09, vol: 0.05 * v });
        break;
      case 'crinkle': // wrapping paper: three quick crackles
        for (let i = 0; i < 4; i++) hiss(a, { t: i * 0.07, d: 0.06, vol: (0.1 - i * 0.015) * v, type: 'bandpass', f: 2600 + i * 500, q: 2, attack: 0.003 });
        break;
      case 'fold': // the paper folds up round the box
        hiss(a, { d: 0.32, vol: 0.09 * v, type: 'bandpass', f: 1400, f1: 3600, q: 1.1 });
        break;
      case 'snip': // scissors
        hiss(a, { d: 0.04, vol: 0.12 * v, type: 'highpass', f: 3800, attack: 0.002 });
        hiss(a, { t: 0.09, d: 0.04, vol: 0.1 * v, type: 'highpass', f: 4200, attack: 0.002 });
        break;
      case 'zip': // the ribbon runs round the box
        tone(a, { f0: 300 * p, f1: 1300 * p, type: 'triangle', attack: 0.02, decay: 0.32, vol: 0.06 * v });
        hiss(a, { d: 0.32, vol: 0.05 * v, type: 'bandpass', f: 1600, f1: 5000, q: 1.6 });
        break;
      case 'bow': // the bow pops on
        tone(a, { f0: 520 * p, f1: 1040 * p, decay: 0.1, vol: 0.12 * v });
        tone(a, { f0: 1320 * p, t: 0.08, type: 'triangle', decay: 0.25, vol: 0.06 * v });
        break;
      case 'tada': // the gift is ready
        arp(a, 523 * p, v);
        tone(a, { f0: 1046 * p, t: 0.3, type: 'sine', attack: 0.02, decay: 0.7, vol: 0.06 * v });
        break;
      case 'wiggle': // the box shakes in a friend's hands
        hiss(a, { d: 0.06, vol: 0.1 * v, f: 800, attack: 0.004 });
        hiss(a, { t: 0.12, d: 0.06, vol: 0.09 * v, f: 720, attack: 0.004 });
        break;
      case 'unwrap': // the paper bursts open: a rip, then the lid's sparkly pop
        hiss(a, { d: 0.28, vol: 0.13 * v, type: 'bandpass', f: 1800, f1: 5200, q: 1.1 });
        setTimeout(() => shopSfx(game, 'gift', { volume: v }), 160);
        break;
      case 'whoosh':
        hiss(a, { d: 0.35, vol: 0.08 * v, type: 'bandpass', f: 600, f1: 2400, q: 0.9 });
        break;
      case 'coins':
        shopSfx(game, 'jingle', { volume: v * 0.8 });
        break;
      // ---- one sound per toy (data.js TOYS[].sound) ----
      case 'soft': // a plush squeeze
        tone(a, { f0: 700 * p, f1: 950 * p, type: 'sine', attack: 0.03, decay: 0.16, vol: 0.08 * v });
        tone(a, { f0: 950 * p, f1: 700 * p, type: 'sine', t: 0.16, attack: 0.02, decay: 0.16, vol: 0.06 * v });
        break;
      case 'beep': // a robot
        tone(a, { f0: 880 * p, type: 'square', decay: 0.07, vol: 0.04 * v });
        tone(a, { f0: 1175 * p, type: 'square', t: 0.11, decay: 0.07, vol: 0.04 * v });
        tone(a, { f0: 988 * p, type: 'square', t: 0.22, decay: 0.1, vol: 0.04 * v });
        break;
      case 'choo': // a toy train
        tone(a, { f0: 587 * p, type: 'triangle', attack: 0.04, decay: 0.3, vol: 0.06 * v });
        tone(a, { f0: 740 * p, type: 'triangle', attack: 0.04, decay: 0.3, vol: 0.05 * v });
        tone(a, { f0: 587 * p, type: 'triangle', t: 0.38, attack: 0.04, decay: 0.4, vol: 0.06 * v });
        tone(a, { f0: 740 * p, type: 'triangle', t: 0.38, attack: 0.04, decay: 0.4, vol: 0.05 * v });
        break;
      case 'drum':
        for (let i = 0; i < 3; i++) tone(a, { f0: 180, f1: 70, t: i * 0.14, decay: 0.16, vol: 0.16 * v });
        break;
      case 'vroom':
        tone(a, { f0: 90 * p, f1: 260 * p, type: 'sawtooth', attack: 0.05, decay: 0.45, vol: 0.035 * v });
        break;
      case 'click':
        hiss(a, { d: 0.03, vol: 0.12 * v, type: 'highpass', f: 3000, attack: 0.002 });
        tone(a, { f0: 1500 * p, t: 0.02, decay: 0.05, vol: 0.05 * v });
        break;
      case 'magic':
        arp(a, 784 * p, v * 0.9, 0.05, 'sine');
        break;
      case 'jingle':
        for (let i = 0; i < 5; i++) tone(a, { f0: (1568 + (i % 2) * 220) * p, t: i * 0.06, type: 'sine', decay: 0.2, vol: 0.04 * v });
        break;
      case 'page':
        if (game.audio && game.audio.play) game.audio.play('page', { volume: 0.7 * v });
        break;
      default:
        lifeSfx(game, name, { volume: v, pitch: p });
    }
  } catch {
    // a sound is never worth an error
  }
}
