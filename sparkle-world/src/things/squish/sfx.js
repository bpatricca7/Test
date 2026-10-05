// Squishy toy sounds, synthesized on the core audio context and sfx bus (the Sound slider and
// mute apply; silent until the first gesture unlocked audio): squish, rise, stretch, snap,
// shake, rustle, unwrap. Noise buffers are filled with mulberry32 (seeded).

import { mulberry32 } from '../../core/util.js';
import { shopSfx } from '../shops/sfx.js';
import { sfx as lifeSfx } from '../pets/sfx.js';

function out(game) {
  const a = game.audio;
  if (!a || !a.ctx || a.ctx.state !== 'running' || !a.sfxGain) return null;
  return a;
}

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const n = Math.floor(ctx.sampleRate * 0.6);
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  const rand = mulberry32(4242);
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

export function squishSfx(game, name, { volume = 1 } = {}) {
  const a = out(game);
  if (!a) return;
  const v = volume;
  try {
    switch (name) {
      case 'squish':
        hiss(a, { d: 0.18, vol: 0.16 * v, f: 900, f1: 250 });
        tone(a, { f0: 260, f1: 180, decay: 0.16, vol: 0.08 * v });
        break;
      case 'rise':
        tone(a, { f0: 200, f1: 340, attack: 0.2, decay: 1.4, vol: 0.04 * v });
        break;
      case 'stretch':
        tone(a, { f0: 220, f1: 520, type: 'triangle', decay: 0.33, vol: 0.08 * v });
        hiss(a, { d: 0.3, vol: 0.04 * v, type: 'bandpass', f: 1200, f1: 2400 });
        break;
      case 'snap':
        lifeSfx(game, 'boing', { volume: v, pitch: 1.3 });
        break;
      case 'shake':
        hiss(a, { d: 0.07, vol: 0.14 * v, f: 700, attack: 0.005 });
        hiss(a, { t: 0.11, d: 0.07, vol: 0.12 * v, f: 650, attack: 0.005 });
        break;
      case 'rustle':
        hiss(a, { d: 0.25, vol: 0.1 * v, type: 'bandpass', f: 2000, f1: 4000, q: 1.2 });
        break;
      case 'unwrap':
        hiss(a, { d: 0.25, vol: 0.1 * v, type: 'bandpass', f: 2000, f1: 4000, q: 1.2 });
        setTimeout(() => shopSfx(game, 'gift', { volume: v }), 180);
        break;
      default:
        lifeSfx(game, name, { volume });
    }
  } catch {
    // a sound is never worth an error
  }
}
