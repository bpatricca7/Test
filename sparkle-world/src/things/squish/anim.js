// The press / squish / slow-rise / stretch curves of the squishy toys (pure functions of time),
// shared by toys in the world, in the hand, on the shelf and in the unwrap.
//
// pressCurve(kind, phase, t, from) -> { sx, sy, done }: the scale of the toy's `toy` part
// (origin at its bottom centre, so it squashes onto the table). sx = 1 / sqrt(sy) keeps the
// volume. kind: 'puff' (Puffum) or 'stretch' (Stretchum). phase:
//   'tap'  the whole squish (a Hand tap on a placed toy, "Squish it!")
//   'down' pressed and held (`from`: the sy when the press began)
//   'up'   released (`from`: the sy at the moment of release)

const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const lerp = (a, b, u) => a + (b - a) * u;
const wobble = (amp, u) => 1 + amp * Math.exp(-5 * u) * Math.cos(14 * u);

export const PUFF_FLAT = 0.45;
export const PUFF_RISE = 2.2;
export const STRETCH_SQUEEZE = 0.6;
export const STRETCH_HELD = 0.75;
export const STRETCH_MAX = 1.6;
/** How long a press must last before a Stretchum starts to stretch (s). */
export const STRETCH_DELAY = 0.3;

function out(sy, done = false) {
  const y = sy > 0.05 ? sy : 0.05;
  return { sx: 1 / Math.sqrt(y), sy: y, done };
}

export function pressCurve(kind, phase, t, from = 1) {
  t = t > 0 ? t : 0;
  const f = typeof from === 'number' && Number.isFinite(from) ? from : 1;
  if (kind === 'stretch') {
    if (phase === 'down') {
      if (t < 0.1) return out(lerp(f, STRETCH_HELD, t / 0.1));
      if (t < STRETCH_DELAY) return out(STRETCH_HELD);
      return out(STRETCH_MAX - (STRETCH_MAX - STRETCH_HELD) * Math.exp(-5 * (t - STRETCH_DELAY)));
    }
    if (phase === 'up') {
      if (t >= 1.0) return out(1, true);
      return out(wobble(f - 1, t));
    }
    // tap: squeeze to 0.6, stretch to 1.4, then a damped wobble back to 1 by 1.3 s
    if (t < 0.1) return out(lerp(1, STRETCH_SQUEEZE, t / 0.1));
    if (t < 0.45) return out(lerp(STRETCH_SQUEEZE, 1.4, easeOut((t - 0.1) / 0.35)));
    if (t >= 1.3) return out(1, true);
    return out(wobble(0.4, t - 0.45));
  }
  // puff
  if (phase === 'down') return out(t < 0.12 ? lerp(f, PUFF_FLAT, t / 0.12) : PUFF_FLAT);
  if (phase === 'up') {
    if (t >= PUFF_RISE) return out(1, true);
    return out(lerp(f, 1, easeOut(clamp01(t / PUFF_RISE))));
  }
  if (t < 0.12) return out(lerp(1, PUFF_FLAT, t / 0.12));
  if (t >= 0.12 + 2.18) return out(1, true);
  return out(lerp(PUFF_FLAT, 1, easeOut((t - 0.12) / 2.18)));
}

/** How long a 'tap' lasts (s). */
export const tapLength = (kind) => (kind === 'stretch' ? 1.3 : 2.3);

/**
 * A little press state machine for one toy: press() / release() / tap(), then step(dt) each
 * frame returns { sx, sy } (or null when it is at rest). Used by the hand, shelf and unwrap.
 */
export function presser(kind) {
  let phase = null, t = 0, from = 1, cur = 1;
  return {
    get busy() { return phase !== null; },
    get sy() { return cur; },
    get held() { return phase === 'down'; },
    press() { phase = 'down'; t = 0; from = cur; },
    release() { if (phase === 'down') { phase = 'up'; t = 0; from = cur; } },
    tap() { phase = 'tap'; t = 0; from = 1; },
    stop() { phase = null; t = 0; cur = 1; },
    step(dt) {
      if (!phase) return null;
      t += dt;
      const c = pressCurve(kind, phase, t, from);
      cur = c.sy;
      if (c.done) { phase = null; cur = 1; }
      return c;
    },
  };
}
