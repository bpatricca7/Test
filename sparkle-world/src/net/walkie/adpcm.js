// IMA ADPCM (4 bits per sample) for the walkie-talkie: 16 kHz mono speech in about 8 KB/s.
// Pure functions, no DOM; tools/test-walkie.mjs checks the round trip (SNR).

const STEP = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876,
  963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
  5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
  29794, 32767,
]);
const INDEX = new Int8Array([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]);

/** Streaming encoder: its state carries over from frame to frame (each frame stores it). */
export class AdpcmEncoder {
  constructor() {
    this.pred = 0;
    this.index = 0;
  }

  /**
   * Encode n = pcm.length samples (Int16Array) into ceil(n / 2) bytes. Returns
   * { pred, index, data } where pred / index are the state at the START of this block.
   */
  encode(pcm) {
    const n = pcm.length;
    const data = new Uint8Array((n + 1) >> 1);
    const start = { pred: this.pred, index: this.index };
    let pred = this.pred;
    let index = this.index;
    for (let i = 0; i < n; i++) {
      let diff = pcm[i] - pred;
      let nib = 0;
      if (diff < 0) {
        nib = 8;
        diff = -diff;
      }
      let step = STEP[index];
      let vp = step >> 3;
      if (diff >= step) {
        nib |= 4;
        diff -= step;
        vp += step;
      }
      step >>= 1;
      if (diff >= step) {
        nib |= 2;
        diff -= step;
        vp += step;
      }
      step >>= 1;
      if (diff >= step) {
        nib |= 1;
        vp += step;
      }
      pred += nib & 8 ? -vp : vp;
      if (pred > 32767) pred = 32767;
      else if (pred < -32768) pred = -32768;
      index += INDEX[nib];
      if (index < 0) index = 0;
      else if (index > 88) index = 88;
      if (i & 1) data[i >> 1] |= nib << 4;
      else data[i >> 1] = nib;
    }
    this.pred = pred;
    this.index = index;
    return { pred: start.pred, index: start.index, data };
  }
}

/**
 * Decode `samples` samples (default: 2 per byte) from ADPCM bytes that start with decoder state
 * (pred, index) into out (Float32Array, -1..1). Returns out.
 */
export function decodeAdpcm(data, pred, index, samples = data.length * 2, out = new Float32Array(samples)) {
  let p = pred | 0;
  let idx = Math.max(0, Math.min(88, index | 0));
  const n = Math.min(samples, data.length * 2, out.length);
  for (let i = 0; i < n; i++) {
    const byte = data[i >> 1];
    const nib = i & 1 ? byte >> 4 : byte & 15;
    const step = STEP[idx];
    let vp = step >> 3;
    if (nib & 4) vp += step;
    if (nib & 2) vp += step >> 1;
    if (nib & 1) vp += step >> 2;
    p += nib & 8 ? -vp : vp;
    if (p > 32767) p = 32767;
    else if (p < -32768) p = -32768;
    idx += INDEX[nib];
    if (idx < 0) idx = 0;
    else if (idx > 88) idx = 88;
    out[i] = p / 32768;
  }
  return out;
}

/**
 * Streaming resampler for the microphone: float samples at the AudioContext's rate (48 kHz,
 * 44.1 kHz, ...) in, 16-bit samples at `outRate` out (linear interpolation; the capture graph
 * low-passes at 7 kHz first, so nothing folds back).
 */
export class Downsampler {
  constructor(inRate, outRate = 16000) {
    this.step = inRate / outRate;
    this.t = 0; // position of the next output sample; -1 = the last sample of the previous block
    this.prev = 0;
  }

  /** Resample one block (Float32Array); returns an Int16Array (possibly empty). */
  push(input) {
    const n = input.length;
    if (!n) return new Int16Array(0);
    const max = Math.max(0, Math.floor((n - 1 - this.t) / this.step) + 1);
    const out = new Int16Array(max);
    let t = this.t;
    let k = 0;
    while (t <= n - 1 && k < max) {
      const i = Math.floor(t);
      const f = t - i;
      const a = i < 0 ? this.prev : input[i];
      const b = i + 1 < n ? input[i + 1] : a;
      let v = a + (b - a) * f;
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      out[k++] = Math.round(v * 32767);
      t += this.step;
    }
    this.prev = input[n - 1];
    this.t = t - n;
    return k === max ? out : out.subarray(0, k);
  }
}
