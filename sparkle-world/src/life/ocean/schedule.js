// The whale's shared visit times and the world's buddy dolphin (docs/teams/ocean.md §5.2, §5.8).
// Pure: every page with the same world seed and game day picks the same moments and the same
// buddy, so two kids playing together see them together.

import { DOLPHIN_NAMES, PALETTES, paletteChoices } from './kinds.js';

/** A 32-bit integer hash of (seed, day, k) as a number in [0, 1). */
export function h01(seed, day = 0, k = 0) {
  let a = ((seed | 0) ^ Math.imul(day | 0, 0x9E3779B1) ^ Math.imul((k | 0) + 1, 0x85EBCA77)) >>> 0;
  a = (a + 0x6D2B79F5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A visit lasts 0.042 day (30 s of a 720 s day). */
export const WHALE_LEN = 0.042;
/** Parts of a visit (by p): rise, three spouts, tail wave and dive. */
export const WHALE_PARTS = { rise: [0, 0.27], spouts: [0.3, 0.45, 0.6], wave: 0.8 };
/** A page that first sees a window this late skips it (a late joiner, a forward snap). */
export const WHALE_LATE = 0.6;
/** While the clock is frozen: a local visit every 360 s of game.time.t. */
export const WHALE_FROZEN_EVERY = 360;

/** Start (day fraction) of the k-th visit (k = 0, 1) on a game day. */
export function whaleTime(seed, day, k) {
  return k === 0 ? 0.32 + 0.12 * h01(seed, day, 0) : 0.52 + 0.12 * h01(seed, day, 1);
}

/** { k, p } with p in 0..1 while a window is open at dayTime, else null. */
export function whalePhase(seed, day, dayTime) {
  for (let k = 0; k < 2; k++) {
    const t0 = whaleTime(seed, day, k);
    if (dayTime >= t0 && dayTime < t0 + WHALE_LEN) return { k, p: (dayTime - t0) / WHALE_LEN };
  }
  return null;
}

/** The predicate game._advanceTime uses (game.js:403): whose frozen flag counts here. */
export function clockFrozen(game) {
  const shared = !!(game.net && game.net.isGuest && typeof game._isShared === 'function' && game._isShared());
  return shared ? !!game.net.hostFrozen : !!(game.profile && game.profile.settings && game.profile.settings.timeFrozen);
}

/** The latch key of a window: shown at most once per (seed, day, k). */
export const latchKey = (seed, day, k) => `${seed}|${day}|${k}`;

/** The world's buddy dolphin: { name, variant } from the seed (the same on every page). */
export function buddyOf(seed, biome) {
  const h = h01(seed, 0, 7);
  const name = DOLPHIN_NAMES[Math.floor(h * 4294967296) % DOLPHIN_NAMES.length];
  const choices = paletteChoices('dolphin', biome);
  const variant = choices[Math.floor(h01(seed, 1, 7) * choices.length) % choices.length];
  return { name, variant: variant >= 0 && variant < PALETTES.dolphin.length ? variant : 0 };
}
