// The elves' sounds, made on the core audio context and its sound-effects bus (the Sound
// slider and mute apply; silent until a gesture unlocked audio): a soft sleigh-bell jingle
// (the "an elf is near" hint), a giggle, a knock-knock, and a twinkly "all found" tune.
// Every voice is tracked (audio.track) so it is let go when it ends.

function out(game) {
  const a = game && game.audio;
  if (!a || !a.ctx || a.ctx.state !== 'running' || !a.sfxGain) return null;
  return a;
}

function tone(a, { f0, f1 = null, type = 'sine', t = 0, attack = 0.005, decay = 0.2, vol = 0.1 }) {
  const ctx = a.ctx, when = ctx.currentTime + Math.max(0, t);
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

/** One little bell: a few bright, slightly out-of-tune partials that ring and fade. */
function bell(a, t, f, vol) {
  tone(a, { f0: f, t, decay: 0.32, vol: vol * 0.5 });
  tone(a, { f0: f * 2.76, t, decay: 0.18, vol: vol * 0.25 });
  tone(a, { f0: f * 5.4, t, decay: 0.09, vol: vol * 0.12 });
}

/**
 * name: 'jingle' (opts.volume 0..1: how near the elf is), 'giggle', 'knock', 'tada', 'hello'.
 */
export function elfSfx(game, name, { volume = 1, pitch = 1 } = {}) {
  const a = out(game);
  if (!a) return;
  const v = Math.max(0, Math.min(1.2, Number(volume) || 0));
  const p = Math.max(0.5, Math.min(2, Number(pitch) || 1));
  if (!v) return;
  try {
    switch (name) {
      case 'jingle': {
        // a soft shake of sleigh bells: four bells, a tiny swing between them
        const notes = [1568, 1760, 1568, 1976];
        for (let i = 0; i < 4; i++) bell(a, i * 0.07 + (i % 2) * 0.015, notes[i] * p, 0.09 * v);
        break;
      }
      case 'giggle': {
        // "hee hee hee": quick chirps that bounce up and down
        const f = [880, 1175, 988, 1319, 1047];
        for (let i = 0; i < 5; i++) tone(a, { f0: f[i] * p, f1: f[i] * p * 1.18, type: 'triangle', t: i * 0.085, attack: 0.008, decay: 0.07, vol: 0.075 * v });
        break;
      }
      case 'knock':
        for (let i = 0; i < 2; i++) tone(a, { f0: 190, f1: 120, type: 'square', t: i * 0.16, attack: 0.002, decay: 0.06, vol: 0.06 * v });
        bell(a, 0.4, 1568 * p, 0.08 * v);
        break;
      case 'hello':
        tone(a, { f0: 784 * p, f1: 1047 * p, type: 'triangle', attack: 0.01, decay: 0.16, vol: 0.07 * v });
        tone(a, { f0: 1047 * p, f1: 1319 * p, type: 'triangle', t: 0.14, attack: 0.01, decay: 0.2, vol: 0.07 * v });
        break;
      case 'tada': {
        const notes = [1047, 1319, 1568, 2093];
        for (let i = 0; i < 4; i++) bell(a, i * 0.12, notes[i] * p, 0.12 * v);
        tone(a, { f0: 523 * p, type: 'triangle', t: 0.36, attack: 0.02, decay: 0.7, vol: 0.06 * v });
        break;
      }
      default:
        break;
    }
  } catch {
    // a sound is never worth an error
  }
}
