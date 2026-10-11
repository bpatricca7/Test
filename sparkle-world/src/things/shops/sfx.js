// Shop sounds, synthesized on the core audio context and sfx bus (the Sound volume applies;
// silent until the first gesture unlocked audio): a coin jingle, a tink per landing coin, a
// cute cash-register ka-ching, the gift box opening, a happy "mmm" for eating.

import { sfx as lifeSfx } from '../pets/sfx.js';

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function out(game) {
  const a = game.audio;
  if (!a || !a.ctx || a.ctx.state !== 'running' || !a.sfxGain) return null;
  return a;
}

function tone(a, { f0, f1 = null, type = 'sine', t = 0, attack = 0.005, decay = 0.18, vol = 0.22 }) {
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

/** A bell-like note: sine + a quiet octave sparkle. */
function bell(a, midi, t, vol = 0.18, decay = 0.35) {
  tone(a, { f0: hz(midi), t, vol, decay });
  tone(a, { f0: hz(midi + 12), t, vol: vol * 0.35, decay: decay * 0.6, type: 'triangle' });
}

export function shopSfx(game, name, { volume = 1, pitch = 1 } = {}) {
  const a = out(game);
  if (!a) return;
  const v = volume;
  const up = Math.round(12 * Math.log2(pitch || 1));
  switch (name) {
    case 'jingle': // coins coming: a bright little run
      [84, 88, 91, 96].forEach((m, i) => bell(a, m + up, i * 0.06, 0.13 * v, 0.28));
      break;
    case 'tink':
      bell(a, 96 + up, 0, 0.1 * v, 0.16);
      break;
    case 'kaching': // a toy cash register: a bump, a bell and a coin
      tone(a, { f0: 180, f1: 90, type: 'triangle', vol: 0.18 * v, decay: 0.08 });
      bell(a, 91 + up, 0.07, 0.16 * v, 0.5);
      bell(a, 96 + up, 0.13, 0.12 * v, 0.45);
      break;
    case 'gift': // the lid pops, then a sparkly arpeggio
      tone(a, { f0: 320, f1: 900, type: 'sine', vol: 0.18 * v, decay: 0.12 });
      [79, 83, 86, 91, 95, 98].forEach((m, i) => bell(a, m, 0.12 + i * 0.07, 0.12 * v, 0.4));
      break;
    case 'nope': // not enough coins: a soft two-note "uh-oh"
      tone(a, { f0: hz(76), type: 'triangle', vol: 0.14 * v, decay: 0.14 });
      tone(a, { f0: hz(72), type: 'triangle', t: 0.14, vol: 0.14 * v, decay: 0.2 });
      break;
    case 'mmm': // a happy hum after the last bite
      tone(a, { f0: hz(72), f1: hz(79), type: 'triangle', vol: 0.12 * v, decay: 0.3, attack: 0.04 });
      break;
    default:
      lifeSfx(game, name, { volume, pitch });
  }
}
