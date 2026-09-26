// Continuous sound "voices": rocket engines, RCS jet hiss, cabin ambience, master alarm, dust.
// Each voice owns a small Web Audio graph and exposes set*(...) called once per frame with target
// levels; parameters glide (setTargetAtTime) so nothing clicks.

import { noiseSource, biquad, gainNode, osc, chain, glide } from './synth.js';

/**
 * Character of each main engine as heard through the structure.
 *  DPS  deep, soft roar with slow combustion flutter (throttleable: pitch/brightness follow thrust)
 *  APS  sharper, buzzier — a lighter vehicle, the engine bolted right under the crew's feet
 *  SPS  a heavy rumble with a strong sub-bass shudder
 */
const ENGINE_SPECS = {
  DPS: { level: 0.4, rumbleHz: 85, lowHz: [110, 380], midHz: 520, midQ: 0.7, mid: 0.25, sub: [33, 49], subLevel: 0.35, flutterHz: 6, flutter: 0.35, buzz: 0 },
  APS: { level: 0.42, rumbleHz: 140, lowHz: [240, 240], midHz: 950, midQ: 0.55, mid: 0.55, sub: [46, 71], subLevel: 0.22, flutterHz: 11, flutter: 0.28, buzz: 0.16, buzzHz: 96 },
  SPS: { level: 0.46, rumbleHz: 60, lowHz: [170, 170], midHz: 330, midQ: 0.8, mid: 0.3, sub: [27, 41], subLevel: 0.5, flutterHz: 4, flutter: 0.4, buzz: 0 },
};

/** One main-engine voice (DPS / APS / SPS). */
export function createEngineVoice(ac, noise, dest, name) {
  const S = ENGINE_SPECS[name] || ENGINE_SPECS.DPS;
  const out = gainNode(ac, 0);
  const shape = gainNode(ac, 1); // flutter modulation target
  shape.connect(out);
  out.connect(dest);
  // low roar: brown noise through a low-pass that opens with thrust
  const low = biquad(ac, 'lowpass', S.lowHz[0], 0.6);
  chain(noiseSource(ac, noise.brown), low, gainNode(ac, 1.0), shape);
  // body resonance: pink noise band around the structural rumble
  chain(noiseSource(ac, noise.pink), biquad(ac, 'bandpass', S.rumbleHz, 1.1), gainNode(ac, 0.9), shape);
  // mid roar / hiss
  const midG = gainNode(ac, S.mid);
  chain(noiseSource(ac, noise.white, 0.9), biquad(ac, 'bandpass', S.midHz, S.midQ), midG, shape);
  // sub-bass shudder: two slightly detuned sines beating slowly
  const subG = gainNode(ac, S.subLevel);
  chain(osc(ac, 'sine', S.sub[0]), subG);
  chain(osc(ac, 'sine', S.sub[1] * 1.013), gainNode(ac, 0.5), subG);
  subG.connect(shape);
  // combustion buzz (APS)
  if (S.buzz > 0) chain(osc(ac, 'sawtooth', S.buzzHz), biquad(ac, 'lowpass', 420, 1.2), gainNode(ac, S.buzz), shape);
  // flutter: very-low-passed noise modulating the amplitude (random, not a periodic wobble)
  const flutter = gainNode(ac, 0);
  chain(noiseSource(ac, noise.white, 0.05), biquad(ac, 'lowpass', S.flutterHz, 0.5), flutter);
  flutter.connect(shape.gain);
  return {
    name,
    /** @param {number} level 0..1 audible thrust (already scaled by listening position) @param {number} thr throttle 0..1 */
    set(level, thr, t) {
      const L = level > 1e-4 ? S.level * Math.pow(level, 0.7) : 0;
      glide(out.gain, L, t, L > out.gain.value ? 0.12 : 0.25);
      glide(low.frequency, S.lowHz[0] + (S.lowHz[1] - S.lowHz[0]) * thr, t, 0.2);
      glide(midG.gain, S.mid * (0.4 + 0.6 * thr), t, 0.2);
      glide(flutter.gain, level > 1e-4 ? S.flutter * 20 : 0, t, 0.2); // lowpassed noise is ~0.04 rms
    },
  };
}

/** RCS quad voice: sustained hiss of the jets on that quad, stereo-panned. */
export function createQuadVoice(ac, noise, dest) {
  const pan = typeof ac.createStereoPanner === 'function' ? ac.createStereoPanner() : null;
  const g = gainNode(ac, 0);
  const hiss = biquad(ac, 'bandpass', 2600, 0.8);
  const body = biquad(ac, 'lowpass', 700, 0.9);
  const bodyG = gainNode(ac, 0.45);
  const src = noiseSource(ac, noise.white, 0.95 + Math.random() * 0.1);
  src.connect(hiss).connect(g);
  src.connect(body).connect(bodyG).connect(g);
  if (pan) g.connect(pan).connect(dest);
  else g.connect(dest);
  return {
    pan,
    set(level, panValue, t) {
      glide(g.gain, level, t, level > g.gain.value ? 0.008 : 0.03);
      if (pan) glide(pan.pan, Math.max(-1, Math.min(1, panValue)), t, 0.03);
    },
  };
}

/**
 * Cabin ambience: ECS fans, suit-loop air, glycol pump whine. LM and CSM differ (the LM's cabin
 * fans were famously loud; the CM had quieter fans but more pump noise).
 */
export function createAmbience(ac, noise, dest) {
  const out = gainNode(ac, 0);
  out.connect(dest);
  const fanNoise = gainNode(ac, 0.05);
  chain(noiseSource(ac, noise.pink), biquad(ac, 'bandpass', 480, 0.5), fanNoise, out);
  const airG = gainNode(ac, 0.05);
  chain(noiseSource(ac, noise.brown), biquad(ac, 'lowpass', 240, 0.7), airG, out);
  const hum = osc(ac, 'sawtooth', 118);
  const humG = gainNode(ac, 0.01);
  chain(hum, biquad(ac, 'lowpass', 320, 1.0), humG, out);
  const hum2 = osc(ac, 'sine', 237);
  const hum2G = gainNode(ac, 0.004);
  chain(hum2, hum2G, out);
  const pump = osc(ac, 'sine', 1480);
  const vib = osc(ac, 'sine', 0.27);
  const vibG = gainNode(ac, 5);
  chain(vib, vibG);
  vibG.connect(pump.frequency);
  const pumpG = gainNode(ac, 0.0035);
  chain(pump, pumpG, out);
  const pump2 = osc(ac, 'triangle', 2960);
  const pump2G = gainNode(ac, 0.0012);
  chain(pump2, pump2G, out);
  const P = {
    LM: { fan: 0.075, air: 0.06, hum: 0.012, hum2: 0.005, humHz: 118, pump: 0.003, pumpHz: 1180 },
    CSM: { fan: 0.045, air: 0.05, hum: 0.008, hum2: 0.004, humHz: 124, pump: 0.0045, pumpHz: 1620 },
  };
  return {
    set(type, level, t) {
      const p = P[type] || P.LM;
      glide(out.gain, level, t, 0.4);
      glide(fanNoise.gain, p.fan, t, 0.5);
      glide(airG.gain, p.air, t, 0.5);
      glide(humG.gain, p.hum, t, 0.5);
      glide(hum2G.gain, p.hum2, t, 0.5);
      glide(hum.frequency, p.humHz, t, 0.5);
      glide(hum2.frequency, p.humHz * 2.01, t, 0.5);
      glide(pumpG.gain, p.pump, t, 0.5);
      glide(pump.frequency, p.pumpHz, t, 0.5);
      glide(pump2.frequency, p.pumpHz * 2, t, 0.5);
      glide(pump2G.gain, p.pump * 0.35, t, 0.5);
    },
  };
}

/** Headset radio hiss (comm loop), louder while the ground is transmitting. */
export function createRadioHiss(ac, noise, dest) {
  const g = gainNode(ac, 0);
  chain(noiseSource(ac, noise.white), biquad(ac, 'highpass', 1800, 0.7), biquad(ac, 'lowpass', 6500, 0.7), g, dest);
  return {
    set(level, t) {
      glide(g.gain, level, t, 0.08);
    },
  };
}

/**
 * Master alarm: the harsh C&W tone in the headsets — a square wave switching between 750 Hz and
 * 2 kHz 2.5 times a second, softened a little by a band-pass.
 */
export function createAlarm(ac, dest) {
  const g = gainNode(ac, 0);
  const tone = osc(ac, 'square', 1375);
  const lfo = osc(ac, 'square', 2.5);
  const depth = gainNode(ac, 625);
  chain(lfo, depth);
  depth.connect(tone.frequency);
  chain(tone, biquad(ac, 'bandpass', 1300, 0.45), biquad(ac, 'lowpass', 4200, 0.7), g, dest);
  return {
    set(on, level, t) {
      glide(g.gain, on ? level : 0, t, 0.015);
    },
  };
}

/** Regolith blast hiss under the descent engine at low altitude. */
export function createDust(ac, noise, dest) {
  const g = gainNode(ac, 0);
  chain(noiseSource(ac, noise.white, 1.1), biquad(ac, 'bandpass', 4200, 0.45), g, dest);
  const lowG = gainNode(ac, 0);
  chain(noiseSource(ac, noise.pink), biquad(ac, 'bandpass', 900, 0.6), lowG, dest);
  return {
    set(level, t) {
      glide(g.gain, level, t, 0.2);
      glide(lowG.gain, level * 0.6, t, 0.2);
    },
  };
}
