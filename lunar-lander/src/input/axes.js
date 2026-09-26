// Pure helpers for control axes (keyboard ramps, gamepad deadzones and response curves).
// No DOM access: unit-tested in test/io.input.test.js.

/** Keyboard axes reach full deflection in this time (s) — a proportional, stick-like feel. */
export const KEY_RAMP_TIME = 0.12;
/** Releasing a key returns the axis to detent faster than it deflects (spring-loaded grip). */
export const KEY_RELEASE_TIME = 0.06;

/** Throttle lever rates (fraction of full throttle per second). */
export const THROTTLE_RATE = 0.5;
export const THROTTLE_RATE_FINE = 0.1;

/** Clamp x to [a, b]. */
export function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

/**
 * Move a keyboard axis value toward its target (-1, 0 or +1) at a finite rate.
 * Deflection takes KEY_RAMP_TIME from 0 to full; moving back toward 0 (release) uses
 * KEY_RELEASE_TIME; reversing direction first returns through 0 at the release rate.
 * @param {number} value current axis value (-1..1)
 * @param {number} target desired value (-1..1)
 * @param {number} dt seconds
 * @returns {number}
 */
export function rampAxis(value, target, dt, rampTime = KEY_RAMP_TIME, releaseTime = KEY_RELEASE_TIME) {
  if (!(dt > 0)) return value;
  if (value === target) return value;
  // moving toward zero (release or reversal)? -> fast rate until we cross zero
  const towardZero = Math.abs(target) < Math.abs(value) || Math.sign(target) !== Math.sign(value);
  if (towardZero && value !== 0) {
    const step = dt / releaseTime;
    const goal = Math.sign(target) === Math.sign(value) ? target : 0;
    let v = value > goal ? Math.max(goal, value - step) : Math.min(goal, value + step);
    if (v === goal && goal === 0 && target !== 0) {
      // reversed: the remaining time continues outward at the deflection rate
      const used = Math.abs(value) * releaseTime;
      const rest = Math.max(0, dt - used);
      v = Math.sign(target) * Math.min(Math.abs(target), rest / rampTime);
    }
    return v;
  }
  const step = dt / rampTime;
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/**
 * Radial deadzone for a two-axis stick with rescaling, so the output starts from 0 at the edge of
 * the deadzone and still reaches 1 at full throw (no dead band "jump").
 * @returns {[number, number]}
 */
export function stickDeadzone(x, y, dz = 0.12, outer = 0.98) {
  const m = Math.hypot(x, y);
  if (!(m > dz)) return [0, 0];
  const k = clamp((m - dz) / (outer - dz), 0, 1) / m;
  return [clamp(x * k, -1, 1), clamp(y * k, -1, 1)];
}

/** Single-axis deadzone with rescaling. */
export function axisDeadzone(x, dz = 0.12, outer = 0.98) {
  const a = Math.abs(x);
  if (!(a > dz)) return 0;
  return Math.sign(x) * clamp((a - dz) / (outer - dz), 0, 1);
}

/**
 * Exponential response curve (like RC transmitters): out = (1 - e) x + e x^3.
 * e = 0 linear; e = 0.5 gives fine control around the centre and full authority at the stops.
 */
export function expo(x, e = 0.45) {
  return (1 - e) * x + e * x * x * x;
}

/** Sum control contributions and clamp to -1..1. */
export function mix(...values) {
  let s = 0;
  for (const v of values) s += v || 0;
  return clamp(s, -1, 1);
}

/**
 * Repeating "click" generator for a held button: fires on the press, then every `period`
 * seconds after an initial `delay` while held. State object: {held, t}.
 * @returns {number} number of clicks to emit this frame
 */
export function repeatClicks(state, pressed, dt, delay = 0.35, period = 0.25) {
  if (!pressed) {
    state.held = false;
    state.t = 0;
    return 0;
  }
  if (!state.held) {
    state.held = true;
    state.t = -delay;
    return 1;
  }
  state.t += dt;
  let n = 0;
  while (state.t >= period) {
    state.t -= period;
    n++;
  }
  return n;
}
