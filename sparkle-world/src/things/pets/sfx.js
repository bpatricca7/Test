// Synthesized sounds for pets, garden and cooking (WebAudio, no files). Uses the core audio
// engine's context and sfx bus (so the Sound volume setting applies); silent until the first
// user gesture unlocked audio. Core names (bark, meow, neigh, pop, eat...) go to audio.play.

const CORE = new Set(['pop', 'place', 'remove', 'click', 'sparkle', 'chime', 'whoosh', 'splash', 'jump', 'step', 'eat', 'pet', 'bark', 'meow', 'neigh', 'magic', 'success', 'page', 'camera']);
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const last = new Map();

function out(game) {
  const a = game.audio;
  if (!a || !a.ctx || a.ctx.state !== 'running' || !a.sfxGain) return null;
  return a;
}

function env(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(a, { f0, f1 = null, type = 'sine', t = 0, attack = 0.006, decay = 0.15, vol = 0.3, vib = 0 }) {
  const ctx = a.ctx, when = ctx.currentTime + t;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, when);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, when + attack + decay);
  if (vib) {
    const l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = 14;
    lg.gain.value = vib;
    l.connect(lg).connect(o.frequency);
    l.start(when);
    l.stop(when + attack + decay + 0.05);
  }
  env(g, when, attack, vol, decay);
  o.connect(g).connect(a.sfxGain);
  o.start(when);
  o.stop(when + attack + decay + 0.06);
}

let noiseBuf = null;
function noise(a, { t = 0, decay = 0.2, vol = 0.2, type = 'bandpass', freq = 1200, freq1 = null, q = 1, attack = 0.004 }) {
  const ctx = a.ctx, when = ctx.currentTime + t;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, when);
  if (freq1) f.frequency.exponentialRampToValueAtTime(freq1, when + attack + decay);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, when, attack, vol, decay);
  s.connect(f).connect(g).connect(a.sfxGain);
  s.start(when, Math.random() * 0.4);
  s.stop(when + attack + decay + 0.06);
}

/**
 * Play one of our sounds. Names: squeak peep quack mew purr yip unicorn plop stir ding
 * sizzle whirr freeze tick pour till harvest crunch slurp tada boing bloop shell whinny
 * giggle babble hello nope, or any core name.
 */
export function sfx(game, name, { volume = 1, pitch = 1 } = {}) {
  if (CORE.has(name)) {
    game.audio.play(name, { volume, pitch });
    return;
  }
  const a = out(game);
  if (!a) return;
  const now = performance.now();
  if (now - (last.get(name) || 0) < 40) return;
  last.set(name, now);
  const v = volume, p = pitch;
  try {
    switch (name) {
      case 'squeak': // bunny
        tone(a, { f0: 1700 * p, f1: 2500 * p, decay: 0.07, vol: 0.14 * v });
        tone(a, { f0: 1900 * p, f1: 2800 * p, t: 0.11, decay: 0.06, vol: 0.12 * v });
        break;
      case 'peep': // duckling
        tone(a, { f0: 2300 * p, f1: 2900 * p, decay: 0.07, vol: 0.13 * v, type: 'triangle' });
        tone(a, { f0: 2400 * p, f1: 3100 * p, t: 0.14, decay: 0.07, vol: 0.12 * v, type: 'triangle' });
        tone(a, { f0: 2500 * p, f1: 3300 * p, t: 0.28, decay: 0.08, vol: 0.1 * v, type: 'triangle' });
        break;
      case 'quack':
        tone(a, { f0: 520 * p, f1: 380 * p, type: 'sawtooth', decay: 0.14, vol: 0.07 * v });
        noise(a, { decay: 0.12, vol: 0.08 * v, freq: 1400 * p, q: 3 });
        break;
      case 'mew': // panda bleat
        tone(a, { f0: 360 * p, f1: 520 * p, type: 'triangle', attack: 0.04, decay: 0.18, vol: 0.2 * v, vib: 18 });
        tone(a, { f0: 520 * p, f1: 330 * p, type: 'triangle', t: 0.2, decay: 0.24, vol: 0.16 * v, vib: 14 });
        break;
      case 'purr':
        for (let i = 0; i < 6; i++) noise(a, { t: i * 0.11, attack: 0.03, decay: 0.07, vol: 0.12 * v, type: 'lowpass', freq: 260, q: 0.8 });
        break;
      case 'yip': // puppy happy
        tone(a, { f0: 900 * p, f1: 1400 * p, type: 'triangle', decay: 0.07, vol: 0.14 * v });
        tone(a, { f0: 1000 * p, f1: 1500 * p, type: 'triangle', t: 0.12, decay: 0.08, vol: 0.12 * v });
        break;
      case 'unicorn':
        game.audio.play('neigh', { volume: v * 0.8, pitch: 1.25 * p });
        [84, 88, 91, 96].forEach((m, i) => tone(a, { f0: hz(m) * p, t: 0.1 + i * 0.07, decay: 0.35, vol: 0.08 * v }));
        break;
      case 'plop': // something drops into the bowl
        tone(a, { f0: 520 * p, f1: 140 * p, decay: 0.12, vol: 0.28 * v });
        noise(a, { decay: 0.08, vol: 0.1 * v, freq: 900, q: 2 });
        break;
      case 'stir':
        noise(a, { attack: 0.05, decay: 0.2, vol: 0.12 * v, freq: 700 * p, freq1: 1500 * p, q: 1.5 });
        break;
      case 'ding':
        tone(a, { f0: hz(93) * p, decay: 1.4, vol: 0.28 * v });
        tone(a, { f0: hz(93) * 2.76 * p, decay: 0.6, vol: 0.08 * v });
        tone(a, { f0: hz(100) * p, t: 0.02, decay: 1.2, vol: 0.14 * v });
        break;
      case 'sizzle':
        for (let i = 0; i < 8; i++) noise(a, { t: i * 0.07 + Math.random() * 0.04, decay: 0.05, vol: 0.06 * v, type: 'highpass', freq: 4000 + Math.random() * 3000 });
        break;
      case 'whirr':
        tone(a, { f0: 110 * p, f1: 160 * p, type: 'sawtooth', attack: 0.05, decay: 0.5, vol: 0.05 * v });
        noise(a, { attack: 0.05, decay: 0.5, vol: 0.06 * v, freq: 600, freq1: 1200, q: 2 });
        break;
      case 'freeze':
        for (let i = 0; i < 5; i++) tone(a, { f0: hz(96 + [0, 3, 7, 10, 12][i]) * p, t: i * 0.06, decay: 0.3, vol: 0.06 * v });
        noise(a, { decay: 0.5, vol: 0.05 * v, type: 'highpass', freq: 6000 });
        break;
      case 'tick':
        tone(a, { f0: 1800 * p, decay: 0.025, vol: 0.08 * v, type: 'square' });
        break;
      case 'pour': // watering can
        noise(a, { attack: 0.08, decay: 0.7, vol: 0.18 * v, freq: 1800, freq1: 900, q: 0.8 });
        for (let i = 0; i < 5; i++) tone(a, { f0: 700 + Math.random() * 700, f1: 1100 + Math.random() * 700, t: 0.1 + i * 0.11, decay: 0.05, vol: 0.06 * v });
        break;
      case 'till':
        noise(a, { decay: 0.16, vol: 0.28 * v, type: 'lowpass', freq: 700, q: 0.8 });
        tone(a, { f0: 180 * p, f1: 90 * p, type: 'triangle', decay: 0.12, vol: 0.2 * v });
        break;
      case 'harvest':
        tone(a, { f0: 380 * p, f1: 1100 * p, decay: 0.1, vol: 0.3 * v });
        [79, 84, 88].forEach((m, i) => tone(a, { f0: hz(m) * p, t: 0.08 + i * 0.06, decay: 0.25, vol: 0.1 * v }));
        break;
      case 'crunch':
        for (let i = 0; i < 3; i++) noise(a, { t: i * 0.13, decay: 0.06, vol: 0.25 * v, freq: 1600 + Math.random() * 900, q: 1.4 });
        break;
      case 'slurp':
        tone(a, { f0: 300 * p, f1: 900 * p, type: 'triangle', attack: 0.05, decay: 0.3, vol: 0.12 * v, vib: 30 });
        break;
      case 'tada':
        [72, 76, 79].forEach((m, i) => tone(a, { f0: hz(m) * p, t: i * 0.08, decay: 0.3, vol: 0.14 * v, type: 'triangle' }));
        tone(a, { f0: hz(84) * p, t: 0.26, decay: 0.9, vol: 0.18 * v, type: 'triangle' });
        tone(a, { f0: hz(88) * p, t: 0.26, decay: 0.9, vol: 0.1 * v });
        break;
      case 'boing':
        tone(a, { f0: 220 * p, f1: 660 * p, type: 'sine', decay: 0.22, vol: 0.18 * v, vib: 40 });
        break;
      case 'bloop': // turtle: a soft bubbly hello
        tone(a, { f0: 320 * p, f1: 620 * p, decay: 0.12, vol: 0.16 * v });
        tone(a, { f0: 420 * p, f1: 820 * p, t: 0.13, decay: 0.12, vol: 0.12 * v });
        break;
      case 'shell': // tucking into the shell
        tone(a, { f0: 700 * p, f1: 240 * p, type: 'triangle', decay: 0.16, vol: 0.16 * v });
        noise(a, { decay: 0.06, vol: 0.08 * v, type: 'lowpass', freq: 900 });
        break;
      case 'whinny': // horse, happy
        game.audio.play('neigh', { volume: v, pitch: 0.9 * p });
        tone(a, { f0: 700 * p, f1: 520 * p, type: 'triangle', t: 0.05, attack: 0.05, decay: 0.4, vol: 0.05 * v, vib: 40 });
        break;
      case 'giggle': // a friend laughing
        for (let i = 0; i < 5; i++) tone(a, { f0: (900 - i * 45) * p, f1: (1150 - i * 45) * p, type: 'triangle', t: i * 0.09, attack: 0.01, decay: 0.06, vol: 0.09 * v });
        break;
      case 'babble': { // a friend talking: a few sing-song syllables (pitch = her voice)
        const scale = [0, 2, 4, 7, 9, 12];
        const n = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const m = 72 + scale[Math.floor(Math.random() * scale.length)];
          tone(a, { f0: hz(m) * p, f1: hz(m + (Math.random() < 0.5 ? 2 : -1)) * p, type: 'triangle', t: i * 0.085, attack: 0.012, decay: 0.06, vol: 0.075 * v });
        }
        break;
      }
      case 'hello': // a friend arriving: sparkly rising notes
        [76, 79, 83, 88].forEach((m, i) => tone(a, { f0: hz(m) * p, t: i * 0.07, decay: 0.4, vol: 0.09 * v, type: 'triangle' }));
        break;
      case 'nope':
        tone(a, { f0: 420 * p, f1: 300 * p, type: 'triangle', decay: 0.12, vol: 0.15 * v });
        tone(a, { f0: 360 * p, f1: 260 * p, type: 'triangle', t: 0.12, decay: 0.14, vol: 0.13 * v });
        break;
      default:
        game.audio.play('pop', { volume: v, pitch: p });
    }
  } catch (err) {
    console.warn('[life] sound failed', name, err);
  }
}
