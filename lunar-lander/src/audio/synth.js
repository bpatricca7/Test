// Web Audio synthesis building blocks: noise buffers, looping noise sources, parameter helpers and
// one-shot percussive sounds (thumps, clicks, clanks, crunches, tones). Everything is generated —
// no audio files. All functions take the AudioContext explicitly and never throw on their own.

/** Create white / pink / brown noise buffers (mono, `seconds` long). */
export function createNoiseBuffers(ac, seconds = 4) {
  const n = Math.floor(ac.sampleRate * seconds);
  const white = ac.createBuffer(1, n, ac.sampleRate);
  const pink = ac.createBuffer(1, n, ac.sampleRate);
  const brown = ac.createBuffer(1, n, ac.sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  // deterministic PRNG so the sound is identical every run
  let s = 0x2545f491;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; // Paul Kellet's pink filter
  let last = 0;
  for (let i = 0; i < n; i++) {
    const x = rnd();
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  // loop seams: cross-fade the last 20 ms into the start
  const fade = Math.floor(ac.sampleRate * 0.02);
  for (const d of [w, p, b]) {
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[n - fade + i] = d[n - fade + i] * (1 - k) + d[i] * k;
    }
  }
  return { white, pink, brown };
}

/** A looping noise source started at a random offset (so several copies are decorrelated). */
export function noiseSource(ac, buffer, rate = 1) {
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(ac.currentTime, Math.random() * buffer.duration * 0.9);
  return src;
}

export function biquad(ac, type, freq, Q = 0.7, gain = 0) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  f.gain.value = gain;
  return f;
}

export function gainNode(ac, value = 0) {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

export function osc(ac, type, freq) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start();
  return o;
}

/** Chain nodes a -> b -> c ...; returns the last. */
export function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

/** Glide an AudioParam toward `v` with time constant `tau` (s). Skips tiny changes. */
export function glide(param, v, t, tau = 0.05) {
  if (!Number.isFinite(v)) return;
  const cur = param.value;
  if (Math.abs(cur - v) < 1e-5 && Math.abs(v) < 1e-4) return;
  param.setTargetAtTime(v, t, tau);
}

// ---------------------------------------------------------------------------------- one-shots
// Each one-shot builds a tiny graph that stops itself; `dest` is the node to connect to.

/** Low "thump": a sine that drops in pitch with an exponential decay (RCS bang, impacts). */
export function thump(ac, dest, { t = ac.currentTime, f0 = 90, f1 = 45, dur = 0.12, level = 0.5 } = {}) {
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  o.onended = () => g.disconnect();
}

/** Filtered noise burst. */
export function noiseBurst(ac, dest, buffer, { t = ac.currentTime, type = 'bandpass', freq = 1200, Q = 0.8, attack = 0.002, dur = 0.05, level = 0.3, rate = 1 } = {}) {
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const f = biquad(ac, type, freq, Q);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * (buffer.duration - 1));
  src.stop(t + attack + dur + 0.05);
  src.onended = () => g.disconnect();
}

/** Metallic ring: inharmonic partials with individual decays (latches, clanks, guillotines). */
export function clank(ac, dest, { t = ac.currentTime, partials = [330, 760, 1260, 2100], decay = 0.6, level = 0.2 } = {}) {
  const g = ac.createGain();
  g.gain.value = 1;
  g.connect(dest);
  let longest = 0;
  partials.forEach((f, i) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
    const pg = ac.createGain();
    const d = decay / (1 + i * 0.6);
    longest = Math.max(longest, d);
    const l = level / (1 + i * 0.7);
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.exponentialRampToValueAtTime(Math.max(0.0002, l), t + 0.002);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(pg).connect(g);
    o.start(t);
    o.stop(t + d + 0.05);
  });
  setTimeout(() => g.disconnect(), (longest + 0.3) * 1000);
}

/** Pure tone with soft edges (Quindar tones, beeps). */
export function tone(ac, dest, { t = ac.currentTime, freq = 2525, dur = 0.25, level = 0.1, type = 'sine' } = {}) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.006);
  g.gain.setValueAtTime(level, t + dur - 0.006);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
  o.onended = () => g.disconnect();
}

/** Granular crunch (crushing honeycomb, regolith under the footpads): many tiny noise grains. */
export function crunch(ac, dest, buffer, { t = ac.currentTime, dur = 0.35, grains = 14, level = 0.25, freq = 900 } = {}) {
  for (let i = 0; i < grains; i++) {
    const u = Math.random();
    const tt = t + u * u * dur; // denser at the start
    noiseBurst(ac, dest, buffer, { t: tt, type: 'bandpass', freq: freq * (0.6 + Math.random() * 1.2), Q: 1.4, attack: 0.001, dur: 0.008 + Math.random() * 0.025, level: level * (1 - u * 0.7) * (0.5 + Math.random() * 0.5) });
  }
}
