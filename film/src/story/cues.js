// Sound-effect cues (seconds), in sync with the animation in shots.js.
// Read by `node export-cues.mjs` -> audio/build/cues.json -> audio/mix.py.
import { VOICE, BEAT } from './timeline.js';

const c = (t, sfx, opts = {}) => ({ t, sfx, ...opts });
const hi = [880, 1320, 1760];

export const SFX = [
  // --- ambience beds
  c(0, 'wind', { dur: 53.5, gain: 0.55, args: { gust: 0.7 }, fadeIn: 2.5, fadeOut: 1.5 }),
  c(53, 'wind', { dur: 59.5, gain: 0.3, args: { gust: 0.5 }, fadeIn: 1.0, fadeOut: 2.0 }),
  c(112, 'wind', { dur: 12.6, gain: 0.16, args: { gust: 0.3 }, fadeIn: 1.5, fadeOut: 1.0 }),
  c(124, 'wind', { dur: 35, gain: 0.12, args: { gust: 0.4 }, fadeIn: 2.0, fadeOut: 3.0 }),
  c(124.5, 'rustle', { dur: 8, gain: 0.5, fadeIn: 0.5, fadeOut: 3 }),
  c(128, 'birds', { dur: 20, gain: 0.5, fadeIn: 2, fadeOut: 3 }),
  c(140.5, 'crickets', { dur: 16, gain: 0.55, fadeIn: 3, fadeOut: 2.5 }),
  c(73.3, 'hover', { dur: 39, gain: 0.3, fadeIn: 1.0, fadeOut: 2.0 }),
  c(112, 'hover', { dur: 12.5, gain: 0.14, fadeIn: 1.0, fadeOut: 1.0 }),
  c(124.5, 'hover', { dur: 28, gain: 0.2, fadeIn: 1.0, fadeOut: 2.5 }),

  // --- A: meet Bolt
  c(10.9, 'motor', { dur: 4.2, gain: 0.08, pan: -0.5 }),
  c(15.0, 'motor', { dur: 5.2, gain: 0.45, args: { speed: 1, decel: 0.2 } }),
  c(20.2, 'chirp', { gain: 0.35, args: { notes: [600, 1100] } }),
  c(20.45, 'motor', { dur: 0.6, gain: 0.25, args: { speed: 0.5 } }),
  c(21.05, 'servo', { dur: 0.3, gain: 0.25 }),
  c(21.85, 'chirp', { gain: 0.35, args: { notes: [900, 1300, 1800], each: 0.07 } }),
  c(22.1, 'thud', { gain: 0.25, args: { f: 150, vel: 0.5 } }),

  // --- B: work
  c(24.5, 'motor', { dur: 2.0, gain: 0.45, args: { speed: 1.1, decel: 0.35 } }),
  c(26.4, 'motor', { dur: 0.6, gain: 0.25, args: { speed: 0.5 } }),
  c(27.15, 'chirp', { gain: 0.3, args: { notes: [700, 700, 1400], each: 0.08, glide: 0.1 } }),
  c(27.1, 'servo', { dur: 0.25, gain: 0.2 }), c(27.45, 'servo', { dur: 0.25, gain: 0.2 }), c(27.8, 'servo', { dur: 0.25, gain: 0.2 }),
  c(28.35, 'clank', { gain: 0.35, args: { vel: 0.6, pitch: 0.7 } }),
  c(28.4, 'servo', { dur: 0.5, gain: 0.2, args: { f0: 400, f1: 700 } }),
  ...[0, 1, 2, 3, 4, 5].map((i) => c(28.95 + i * 0.06, 'clank', { gain: 0.22, args: { vel: 0.5, pitch: 1.2 + i * 0.15 }, pan: 0.1 })),
  c(29.33, 'clank', { gain: 0.4, args: { vel: 0.7, pitch: 0.65 } }),
  c(29.5, 'crunch', { gain: 0.8 }), c(29.9, 'crunch', { gain: 0.8 }),
  c(30.33, 'clank', { gain: 0.3, args: { vel: 0.6, pitch: 0.7 } }),
  c(30.4, 'thud', { gain: 0.35, args: { f: 180, vel: 0.6 } }),
  ...BEAT.stack.flatMap((s, i) => [
    c(s - 0.12, 'whoosh', { dur: 0.3, gain: 0.35, args: { f0: 500, f1: 2500 } }),
    c(s + 0.19, 'thud', { gain: 0.5, args: { f: 150 + i * 20, vel: 0.8 } }),
    c(s + 0.19, 'clank', { gain: 0.2, args: { vel: 0.5, pitch: 0.6 } }),
  ]),
  c(32.6, 'chirp', { gain: 0.35, args: { notes: [800, 1000, 1600], each: 0.08 } }),
  c(33.2, 'creak', { dur: 2.2, gain: 0.55, pan: -0.3 }),
  c(33.62, 'chirp', { gain: 0.25, args: { notes: [1200, 800, 1200, 800], each: 0.1 } }),
  c(BEAT.cubeFall, 'slide_whistle', { gain: 0.6 }),
  c(BEAT.bonk, 'bonk', { gain: 0.95 }),
  c(BEAT.bonk + 0.02, 'thud', { gain: 0.4, args: { f: 90, vel: 0.8 } }),
  c(BEAT.cubeLand, 'thud', { gain: 0.55, args: { f: 120, vel: 0.9 } }),
  c(BEAT.cubeLand + 0.28, 'thud', { gain: 0.2, args: { f: 150, vel: 0.5 } }),
  c(35.95, 'tweety', { dur: 2.3, gain: 0.55 }),
  c(38.12, 'rattle', { gain: 0.45 }),
  c(38.75, 'chirp', { gain: 0.25, args: { notes: [700, 900, 650], each: 0.1 } }),

  // --- C: sunset
  c(45.3, 'power_down', { gain: 0.12 }),
  c(51.0, 'chirp', { gain: 0.2, args: { notes: [700, 450], each: 0.25, glide: 0.8 } }),

  // --- D: discovery
  ...BEAT.tosses.flatMap((s, i) => [
    c(s - 0.3, 'servo', { dur: 0.3, gain: 0.18 }),
    c(s, 'whoosh', { dur: 0.35, gain: 0.3, args: { f0: 400, f1: 1800 } }),
    c(s + 0.75, 'clank', { gain: 0.35, args: { vel: 0.7, pitch: 0.9 + i * 0.3 } }),
  ]),
  c(54.2, 'clank', { gain: 0.15, args: { vel: 0.4, pitch: 1.6 } }), c(55.1, 'clank', { gain: 0.15, args: { vel: 0.4, pitch: 1.9 } }),
  c(BEAT.squeak, 'squeak', { gain: 0.8 }),
  c(56.9, 'chirp', { gain: 0.22, args: { notes: [900, 1250], each: 0.12, glide: 0.8 } }),
  c(BEAT.duckToss, 'whoosh', { dur: 0.4, gain: 0.3 }),
  c(BEAT.duckToss + 0.9, 'squeak', { gain: 0.35, args: { dur: 0.15, f0: 1300 } }),
  c(BEAT.glint, 'sparkle', { gain: 0.6, args: { vel: 0.6, n: 6 } }),
  c(BEAT.canLift, 'servo', { dur: 0.6, gain: 0.2, args: { f0: 450, f1: 650 } }),
  c(59.45, 'chirp', { gain: 0.35, args: { notes: [500, 1500], each: 0.3, glide: 0.9 } }),
  c(59.5, 'sparkle', { gain: 0.5, args: { vel: 0.5, n: 10 } }),
  c(60.4, 'pop', { gain: 0.5, args: { f: 800 } }),
  c(BEAT.alive, 'shimmer', { dur: 1.4, gain: 0.8, args: { vel: 0.7, rise: false } }),
  c(BEAT.alive, 'sparkle', { gain: 0.6, args: { vel: 0.6, n: 12 } }),

  // --- E: Luma arrives
  c(BEAT.whoosh - 0.05, 'big_whoosh', { gain: 0.9, pan: 0.3 }),
  c(BEAT.impact, 'boom', { gain: 1.0 }),
  c(BEAT.impact + 0.25, 'debris', { gain: 0.6, pan: 0.3 }),
  c(BEAT.impact + 0.05, 'chirp', { gain: 0.3, args: { notes: [1500, 2200], each: 0.1, glide: 0.5 } }),
  ...[74.0, 74.9, 75.8, 76.7, 78.4].map((t) => c(t, 'scan_beep', { gain: 0.35, pan: 0.4 })),
  c(BEAT.duckHide, 'chirp', { gain: 0.3, args: { notes: [1400, 700], each: 0.08, glide: 0.8 } }),
  c(78.3, 'servo', { dur: 0.4, gain: 0.15 }),
  c(79.0, 'motor', { dur: 0.9, gain: 0.3, args: { speed: 0.5, decel: 0.3 } }),
  c(BEAT.lumaStartle, 'chirp', { gain: 0.5, args: { notes: [600, 1800], each: 0.12, glide: 0.9, wave: 'rich' } }),
  c(BEAT.lumaStartle + 0.05, 'whoosh', { dur: 0.55, gain: 0.35, args: { f0: 800, f1: 3000 } }),
  c(BEAT.lumaTwirl, 'whoosh', { dur: 0.55, gain: 0.3, args: { f0: 1000, f1: 3500 } }),
  c(BEAT.lumaTwirl + 0.1, 'sparkle', { gain: 0.5 }),
  c(BEAT.boltHop - 0.02, 'chirp', { gain: 0.3, args: { notes: [800, 1600], each: 0.1 } }),
  c(84.7, 'giggle', { gain: 0.35, pan: -0.3 }),
  c(85.3, 'giggle', { gain: 0.25, pan: -0.3 }),
  c(BEAT.heartEyes, 'sparkle', { gain: 0.5, args: { vel: 0.5, n: 6 } }),
  c(BEAT.heartEyes, 'pop', { gain: 0.4, args: { f: 900 } }),
  c(BEAT.loopUp, 'whoosh', { dur: 1.4, gain: 0.35, args: { f0: 600, f1: 3000 } }),
  c(BEAT.loopUp + 0.3, 'shimmer', { dur: 1.2, gain: 0.4 }),
  ...[88.4, 88.6, 88.85].map((t, i) => c(t, 'pop', { gain: 0.3, args: { f: 700 + i * 150 } })),
  c(BEAT.hug, 'chirp', { gain: 0.3, args: { notes: [900, 1200, 1500], each: 0.12, glide: 0.5 } }),

  // --- F: friendship montage
  ...[92.0, 93.3, 94.9].map((t) => c(t, 'whoosh', { dur: 0.7, gain: 0.3, args: { f0: 700, f1: 2800 } })),
  c(92.4, 'chirp', { gain: 0.3, args: { notes: [1000, 1500, 1200, 1800], each: 0.08 } }),
  c(91.5, 'motor', { dur: 4.9, gain: 0.18, args: { speed: 0.6 } }),
  c(BEAT.chase, 'motor', { dur: 2.6, gain: 0.5, args: { speed: 1.4, decel: 0.25 } }),
  c(96.7, 'whoosh', { dur: 0.6, gain: 0.3 }), c(97.6, 'whoosh', { dur: 0.6, gain: 0.3 }),
  c(97.0, 'chirp', { gain: 0.3, args: { notes: [1200, 1800, 2400], each: 0.1 } }),
  ...[100.05, 100.25, 100.45, 100.65].map((t, i) => c(t, 'pop', { gain: 0.25, args: { f: 600 + i * 120 } })),
  c(99.9, 'chirp', { gain: 0.22, args: { notes: [800, 1000], each: 0.2, glide: 0.6 } }),

  // --- G: planting
  ...Array.from({ length: 10 }, (_, i) => c(102.45 + i * 0.21, 'dig', { gain: 0.5, pan: 0.1 })),
  c(104.95, 'sparkle', { gain: 0.35, args: { vel: 0.4, n: 5 } }),
  c(106.05, 'pat', { gain: 0.4 }),
  ...BEAT.pats.map((t) => c(t, 'pat', { gain: 0.6 })),
  ...[106.35, 106.65, 106.95, 107.25].map((t) => c(t, 'clap', { gain: 0.3, pan: 0.3 })),
  c(107.9, 'servo', { dur: 0.4, gain: 0.15 }),
  c(BEAT.pour[0], 'pour', { dur: BEAT.pour[1] - BEAT.pour[0], gain: 0.3 }),
  c(110.7, 'shimmer', { dur: 1.2, gain: 0.25, args: { vel: 0.4, rise: false } }),

  // --- H: night
  c(115.1, 'chirp', { gain: 0.12, args: { notes: [500, 350], each: 0.3, glide: 0.9 } }),
  c(BEAT.asleep, 'power_down', { gain: 0.3 }),
  c(117.4, 'snore', { dur: 1.5, gain: 0.5 }),
  c(BEAT.shootingStar, 'sparkle', { gain: 0.3, args: { vel: 0.4, n: 7 } }),

  // --- I: dawn + bloom
  c(BEAT.glowUp, 'shimmer', { dur: 2.1, gain: 0.8, args: { vel: 0.8, rise: true } }),
  c(BEAT.pulse, 'boom', { gain: 0.6 }),
  c(BEAT.pulse, 'whoosh', { dur: 1.5, gain: 0.5, args: { f0: 300, f1: 4000 } }),
  c(BEAT.pulse + 0.1, 'shimmer', { dur: 3.0, gain: 0.6, args: { vel: 0.6, rise: false } }),
  c(BEAT.wake, 'power_up', { gain: 0.5 }),
  c(BEAT.wake + 0.1, 'chirp', { gain: 0.35, args: { notes: [700, 1400, 2100], each: 0.07 } }),
  c(125.15, 'chirp', { gain: 0.25, args: { notes: [1500, 2200], each: 0.1 } }),
  ...Array.from({ length: 34 }, (_, i) => 124.2 + i * 0.19 + ((i * 7919) % 13) * 0.01).map((t, i) => (t > 125.5 && t < 126.6) || (t > 126.9 && t < 128.1) ? null : c(t, 'pop', { gain: 0.1, pan: ((i * 37) % 17) / 8.5 - 1, args: { f: 500 + ((i * 613) % 900) } })).filter(Boolean),
  c(128.2, 'shimmer', { dur: 3.0, gain: 0.4, args: { vel: 0.6, rise: false } }),
  c(128.1, 'whoosh', { dur: 1.0, gain: 0.3, args: { f0: 900, f1: 3500 } }),
  c(127.4, 'motor', { dur: 0.8, gain: 0.2, args: { speed: 0.4 } }),
  c(134.5, 'motor', { dur: 4.9, gain: 0.15, args: { speed: 0.7 } }),
  c(135.2, 'chirp', { gain: 0.3, args: { notes: hi, each: 0.08 } }),
  c(136.4, 'chirp', { gain: 0.3, args: { notes: [1320, 1760, 2640], each: 0.08 } }),

  // --- J: ending
  c(143.3, 'chirp', { gain: 0.25, args: { notes: [800, 1100], each: 0.15, glide: 0.6 } }),
  c(145.4, 'sparkle', { gain: 0.3, args: { vel: 0.4, n: 6 } }),
  ...[145.5, 145.7, 145.9].map((t, i) => c(t, 'pop', { gain: 0.18, args: { f: 700 + i * 140 } })),
  c(150.5, 'chirp', { gain: 0.25, args: { notes: [900, 1300, 1700], each: 0.1 } }),
  c(BEAT.iris[1] - 0.45, 'iris', { gain: 0.5 }),
];

export const VOICES = Object.entries(VOICE).map(([id, t]) => ({ id, t }));
export { VOICE, BEAT };
