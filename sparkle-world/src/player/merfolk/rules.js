// Sea forms: the pure rules (docs/teams/merfolk.md §3.4). No three.js, no DOM, so the Node tests
// import this file as is. When she swims in deep water she turns into a mermaid or a sea dragon
// (or swims as herself, "Just Me"); these helpers decide which form, which tail color, when the
// water is deep enough and when she turns in and back.

import { normalizeLook, lookFits, SEA_COLORS } from '../wardrobe-data.js';

export const SEA_IN = 0.25;        // s of deep swimming before she turns
export const SEA_OUT_LAND = 0.35;  // s on the ground out of the water before she turns back
export const SEA_OUT_AIR = 1.4;    // s out of the water (a leap) before she turns back anyway
export const SEA_GROW = 0.35;      // s for the tail to grow or shrink
export const SEA_CUT = 0.12;       // s for a cut (flying, mounting, teleport, Just Me)
export const SEA_SWIM = 4.6;       // blocks/s with a tail (the plain swim is 2.8)
export const SEA_SWIM_FAST = 6.2;  // fast (Shift, or the joystick pushed to its edge)
export const ME_SWIM = 4.0;        // Just Me in deep water
export const ME_SWIM_FAST = 5.4;
export const SEA_VY = 3.4;         // up / down speed
export const SEA_VY_RATE = 6;      // 1/s easing of the vertical speed toward its target
export const BUOY_DELAY = 1.0;     // s with no Up / Down before she floats up
export const BUOY_VY = 1.0;        // blocks/s of the gentle float up
export const SHALLOW_VY = -1.5;    // with no input in shallow water she settles onto the bottom
export const HOP_HOLD = 0.35;      // s after a shore / step hop with plain gravity (no easing)
export const LEAP_V = 9.2;         // leap start speed: 9.2^2 / (2 * 24) = 1.76 blocks of rise
export const LEAP_MIN_HS = 3.0;    // horizontal speed needed for a leap
export const LEAP_COOLDOWN = 0.9;  // s between leaps
export const FP_DIVE_DEAD = 0.2;   // first person: camera pitch (rad) before look-to-dive starts
export const BUOY_PROBE = 0.95;    // she floats up while the water reaches this far above her feet
export const SEA_DEFAULT_HEX = { mermaid: '#3FD8B0', sea_dragon: '#2FB5B0' };

/** The underwater tint per liquid block key: [top, bottom] of a vertical gradient (§5.6). */
export const UNDERWATER_TINT = {
  water: ['rgba(120,210,255,.18)', 'rgba(30,110,200,.38)'],
  choco_milk: ['rgba(150,90,50,.22)', 'rgba(90,50,25,.45)'],
  strawberry_milk: ['rgba(255,190,220,.2)', 'rgba(240,110,170,.4)'],
};

const FORMS = new Set(['mermaid', 'sea_dragon', 'me']);

/** 'mermaid' | 'sea_dragon' for 'auto'. style: 'girl'|'boy'|'mix'|null (device only).
 *  With no style, the worn look decides (only the look, which is already in the profile). */
export function autoSeaForm(style, look) {
  if (style === 'boy') return 'sea_dragon';
  if (style === 'girl' || style === 'mix') return 'mermaid';
  return look && lookFits(look, 'b') && !lookFits(look, 'g') ? 'sea_dragon' : 'mermaid';
}

/** The form a look shows: its own choice, or autoSeaForm(style, look) for 'auto'. */
export function resolveSeaForm(look, style) {
  const f = look && look.sea && typeof look.sea === 'object' ? look.sea.form : null;
  return FORMS.has(f) ? f : autoSeaForm(style, look);
}

/** A NEW normalized look with 'auto' replaced (what friends receive in lk). Never mutates `look`. */
export function withResolvedSea(look, style) {
  const n = normalizeLook(look);
  n.sea = { form: resolveSeaForm(n, style), color: n.sea.color };
  return n;
}

// ---------- tail colors ----------

function hsl(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}
const PALETTE_HSL = SEA_COLORS.map((c) => ({ c, ...hsl(c) }));
const PEARL = '#E6DDFF';

/** Snap any hex to a bright sea color (see seaColorOf). */
export function snapSeaColor(hex, form) {
  const dflt = SEA_DEFAULT_HEX[form] || SEA_DEFAULT_HEX.mermaid;
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return dflt;
  const up = hex.toUpperCase();
  if (SEA_COLORS.includes(up)) return up;
  const { h, s, l } = hsl(up);
  if (s < 0.35 || l < 0.22 || l > 0.9 || (h >= 15 && h <= 45 && l < 0.5)) return dflt;
  let best = dflt, bestD = Infinity;
  for (const p of PALETTE_HSL) {
    if (p.c === PEARL) continue;
    const dh = Math.abs(p.h - h);
    const d = Math.min(dh, 360 - dh) + 20 * Math.abs(p.l - l);
    if (d < bestD) { bestD = d; best = p.c; }
  }
  return best;
}

/** The tail's hex. sea.color if set; else Match: the dress color, else the bottom color,
 *  snapped: an exact SEA_COLORS entry stays; a color with saturation < 0.35, lightness < 0.22
 *  or > 0.9, or a brown (hue 15-45 and lightness < 0.5) gives SEA_DEFAULT_HEX[form]; anything
 *  else gives the SEA_COLORS entry (Pearl left out) with the nearest hue. */
export function seaColorOf(look, form) {
  const sea = look && look.sea;
  if (sea && typeof sea.color === 'string' && SEA_COLORS.includes(sea.color.toUpperCase())) return sea.color.toUpperCase();
  const g = look && look.dress ? look.dress : look && look.bottom ? look.bottom : null;
  return snapSeaColor(g && g.color, form);
}

// ---------- water ----------

/** Deep enough to turn: liquid at the waist and (one more liquid cell below the feet or
 *  liquid at head height). liquidAt(x, y, z) -> bool. Puddles one block deep never count. */
export function seaDeep(liquidAt, x, y, z) {
  return !!liquidAt(x, y + 0.6, z) && (!!liquidAt(x, y - 0.4, z) || !!liquidAt(x, y + 1.4, z));
}

/** Liquid cells straight below the feet (0..cap), for the dive hint (≥ 3) and the pool tip. */
export function depthBelow(liquidAt, x, y, z, cap = 4) {
  let n = 0;
  while (n < cap && liquidAt(x, y - 0.4 - n, z)) n++;
  return n;
}

/** The dolphin leap: swimming fast with Up held, head out of the water, rising, not too soon.
 *  f = { jump, hs, vy, headWet, now (ms), leapAt (ms) }. */
export function leapCheck(f) {
  return !!f.jump && f.hs > LEAP_MIN_HS && f.vy > 1.5 && !f.headWet && f.now - f.leapAt > LEAP_COOLDOWN * 1000;
}

/**
 * The vertical speed while sea swimming (§6.2), one step. s = { idleVT, hopT } (mutable, one
 * per swimmer). f = { dt, vy, up, down, fpWant (first-person look-to-dive, -1..1 or 0), deep,
 * chestWet (liquid at y + BUOY_PROBE), gravity }. Returns the new vy. A shore / step hop (hopT > 0)
 * gets plain gravity so the easing does not eat it.
 */
export function seaVy(s, f) {
  const dt = Number.isFinite(f.dt) ? Math.min(Math.max(f.dt, 0), 0.1) : 0;
  const vy0 = Number.isFinite(f.vy) ? f.vy : 0;
  if (s.hopT > 0) {
    s.hopT -= dt;
    return Math.max(-SEA_VY * 2, vy0 - f.gravity * dt);
  }
  let want = f.up ? SEA_VY : f.down ? -SEA_VY : 0;
  if (want === 0 && f.fpWant) want = Math.max(-1, Math.min(1, f.fpWant)) * SEA_VY;
  s.idleVT = want !== 0 ? 0 : s.idleVT + dt;
  if (want === 0) {
    if (!f.deep) want = SHALLOW_VY; // settle onto the bottom
    else if (s.idleVT >= BUOY_DELAY && f.chestWet) want = BUOY_VY; // float up
  }
  const vy = vy0 + (want - vy0) * Math.min(1, SEA_VY_RATE * dt);
  return Math.max(-SEA_VY, Math.min(LEAP_V, vy));
}

/** The speed of a shore / step hop out of the water onto a bank `rise` above her feet. */
export function hopVy(rise, gravity, jumpV) {
  const r = Number.isFinite(rise) ? Math.max(0, Math.min(2.2, rise)) : 1;
  return Math.max(jumpV * 0.92, Math.sqrt(2 * gravity * (r + 0.25)));
}

/** The turn-in / turn-back timer with hysteresis (one per swimmer). */
export class SeaGate {
  constructor() { this.on = false; this.inT = 0; this.outT = 0; }
  reset() { this.on = false; this.inT = this.outT = 0; }
  /** f = { deep, swimming, onGround, blocked }. Returns 'in' | 'out' | 'cut' | null. */
  step(dt, f) {
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    if (f.blocked) { const was = this.on; this.reset(); return was ? 'cut' : null; }
    if (!this.on) {
      this.inT = f.deep && f.swimming ? this.inT + dt : 0;
      if (this.inT >= SEA_IN - 1e-9) { this.on = true; this.inT = this.outT = 0; return 'in'; }
      return null;
    }
    this.outT = f.swimming ? 0 : this.outT + dt;
    if ((f.onGround && this.outT >= SEA_OUT_LAND) || this.outT >= SEA_OUT_AIR) { this.reset(); return 'out'; }
    return null;
  }
  /** Turn on at once (mounting a dolphin before the 0.25 s are up). */
  force() { this.on = true; this.inT = this.outT = 0; }
}
