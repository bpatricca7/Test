// Pure display formatting for the UI: mission clock, units (Apollo imperial or metric), numbers.
// No DOM, no three.js — unit-tested in test/ui.format.test.js.
//
// Apollo conventions (imperial): altitude and altitude rate in feet and ft/s during the descent,
// orbital altitudes and ranges in nautical miles, orbital speed in ft/s.

export const FT = 0.3048;
export const NMI = 1852;
export const MINUS = '−'; // typographic minus: same width as '+' in tabular fonts

/** Group thousands with commas: 12500 -> "12,500". */
export function group(n) {
  const s = Math.abs(n).toString();
  const [i, f] = s.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? MINUS : '') + (f ? `${g}.${f}` : g);
}

/** Fixed decimals with grouping and a typographic minus. `plus` adds '+' for positive values. */
export function num(x, decimals = 0, { plus = false } = {}) {
  if (!Number.isFinite(x)) return '—';
  const r = Number(x.toFixed(decimals)); // rounded first, so -0.04 -> "0.0" (no stray minus)
  const [ip, fp] = Math.abs(r).toFixed(decimals).split('.');
  const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fp ? '.' + fp : '');
  if (r < 0) return MINUS + grouped;
  if (plus && r > 0) return '+' + grouped;
  return grouped;
}

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

/** Apollo Ground Elapsed Time: "HHH:MM:SS" (e.g. 102:45:40). Negative times get a minus sign. */
export function fmtMET(sec) {
  if (!Number.isFinite(sec)) return '---:--:--';
  const neg = sec < 0;
  let s = Math.floor(Math.abs(sec));
  const hh = Math.floor(s / 3600);
  s -= hh * 3600;
  const mm = Math.floor(s / 60);
  const ss = s - mm * 60;
  return `${neg ? MINUS : ''}${pad(hh, 3)}:${pad(mm)}:${pad(ss)}`;
}

/** Short countdown / duration: "42", "1:05", "1:02:03" (no leading zeros on the first field). */
export function fmtDuration(sec, { tenths = false } = {}) {
  if (!Number.isFinite(sec)) return '—';
  const neg = sec < 0;
  const a = Math.abs(sec);
  let out;
  if (a < 60) out = tenths && a < 10 ? a.toFixed(1) : String(Math.floor(a));
  else if (a < 3600) out = `${Math.floor(a / 60)}:${pad(a % 60)}`;
  else out = `${Math.floor(a / 3600)}:${pad((a % 3600) / 60)}:${pad(a % 60)}`;
  return (neg ? MINUS : '') + out;
}

/** Countdown clock "m:ss" (always with minutes, like a mission event timer): 39 -> "0:39". */
export function fmtClock(sec) {
  if (!Number.isFinite(sec)) return '-:--';
  const a = Math.max(0, Math.floor(Math.abs(sec)));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Altitude / height. Imperial: feet up to 99,999 ft, then nautical miles. Metric: metres up to
 * 9,999 m, then km. Small heights get one decimal so the last metres of a landing read smoothly.
 * @returns {{v: string, u: string}}
 */
export function fmtAlt(m, units = 'imperial') {
  if (!Number.isFinite(m)) return { v: '—', u: units === 'metric' ? 'M' : 'FT' };
  if (units === 'metric') {
    if (Math.abs(m) < 10000) return { v: num(m, Math.abs(m) < 100 ? 1 : 0), u: 'M' };
    return { v: num(m / 1000, Math.abs(m) < 100000 ? 2 : 1), u: 'KM' };
  }
  const ft = m / FT;
  if (Math.abs(ft) < 100000) return { v: num(ft, Math.abs(ft) < 100 ? 1 : 0), u: 'FT' };
  return { v: num(m / NMI, 1), u: 'NMI' };
}

/** Speed: ft/s (imperial) or m/s. Decimals shrink as the magnitude grows. */
export function fmtSpeed(ms, units = 'imperial', { plus = false } = {}) {
  const u = units === 'metric' ? 'M/S' : 'FT/S';
  if (!Number.isFinite(ms)) return { v: '—', u };
  const x = units === 'metric' ? ms : ms / FT;
  const a = Math.abs(x);
  return { v: num(x, a < 100 ? 1 : 0, { plus }), u };
}

/** Ground / slant distance: ft below 1 nmi then nmi (imperial); m below 1 km then km (metric). */
export function fmtDist(m, units = 'imperial') {
  if (!Number.isFinite(m)) return { v: '—', u: units === 'metric' ? 'M' : 'FT' };
  const a = Math.abs(m);
  if (units === 'metric') {
    if (a < 1000) return { v: num(m, a < 10 ? 1 : 0), u: 'M' };
    return { v: num(m / 1000, a < 100000 ? 2 : 0), u: 'KM' };
  }
  if (a < NMI) return { v: num(m / FT, a < 3 ? 1 : 0), u: 'FT' };
  return { v: num(m / NMI, a < 100 * NMI ? 2 : 0), u: 'NMI' };
}

/** Orbital altitude (apolune / perilune): always nmi (imperial) or km. */
export function fmtOrbitAlt(m, units = 'imperial') {
  if (!Number.isFinite(m)) return { v: '—', u: units === 'metric' ? 'KM' : 'NMI' };
  if (units === 'metric') return { v: num(m / 1000, 1), u: 'KM' };
  return { v: num(m / NMI, 1), u: 'NMI' };
}

/** Joins a {v,u} pair: "1,234 FT". */
export const vu = (o) => `${o.v} ${o.u}`;

/** Compass bearing "274°". */
export const fmtBearing = (deg) => (Number.isFinite(deg) ? `${pad(((Math.round(deg) % 360) + 360) % 360, 3)}°` : '—');

/** Signed angle "+12.4°" (one decimal under 100). */
export const fmtAngle = (deg, decimals = 1) => (Number.isFinite(deg) ? `${num(deg, decimals, { plus: true })}°` : '—');

/** Percent "73%" (or "4.5%" under 10 with fine=true). */
export function fmtPct(f, { fine = false } = {}) {
  if (!Number.isFinite(f)) return '—';
  const p = f * 100;
  return `${num(p, fine && Math.abs(p) < 10 ? 1 : 0)}%`;
}

/**
 * Warp label: "1×", "10×", "PAUSED"; "10× (req 100×)" when the sim limits the requested warp
 * (engine firing, near the ground...), "100× (37×)" when the CPU could not keep up.
 */
export function fmtWarp(time) {
  if (!time) return '';
  if (time.paused) return 'PAUSED';
  const a = time.warpActual ?? 1;
  const e = time.warpEffective;
  let s = `${a}×`;
  if (Number.isFinite(time.warp) && time.warp > a) s += ` (req ${time.warp}×)`;
  else if (a > 1 && Number.isFinite(e) && e < a * 0.9) s += ` (${e < 10 ? e.toFixed(1) : Math.round(e)}×)`;
  return s;
}

/** Human names of the guidance programs flown in the game. */
export const PROGRAM_NAMES = {
  P00: 'IDLE',
  P12: 'POWERED ASCENT',
  P47: 'THRUST MONITOR',
  P63: 'BRAKING',
  P64: 'APPROACH',
  P66: 'RATE OF DESCENT',
  P67: 'MANUAL',
  P68: 'LANDING CONFIRM',
  P70: 'DPS ABORT',
  P71: 'APS ABORT',
};

/** Human names of the attitude autopilot modes. */
export const AUTOPILOT_NAMES = {
  OFF: 'OFF',
  KILLROT: 'KILL ROT',
  PROGRADE: 'PROGRADE',
  RETROGRADE: 'RETROGRADE',
  RADIAL_OUT: 'RADIAL OUT',
  RADIAL_IN: 'RADIAL IN',
  NORMAL: 'NORMAL',
  ANTINORMAL: 'ANTI-NORMAL',
  LOCAL_VERTICAL: 'LOCAL VERT',
  TARGET: 'TARGET',
  GUIDANCE: 'GUIDANCE',
};

/** What a flashing DSKY verb/noun asks the crew to do (the HUD prompt). */
export function dskyPrompt(agc) {
  if (!agc || !agc.flashVerbNoun) return null;
  const v = agc.verb;
  if (v === '05') return { title: `PROGRAM ALARM ${agc.alarmCode || ''}`.trim(), hint: 'ENTER resets the master alarm', level: 'alarm' };
  if (v === '99') return { title: 'ENGINE ON ENABLE', hint: 'PRO (Space) to fire the engine', level: 'warn' };
  if (v === '37') return { title: 'SELECT PROGRAM', hint: 'PRO (Space) to proceed', level: 'warn' };
  return { title: `V${v} N${agc.noun}`, hint: 'PRO (Space) to proceed', level: 'warn' };
}

/** Rating label for the landing result card. */
export const RATING_LABEL = { perfect: 'Perfect landing', good: 'Good landing', hard: 'Hard landing' };

/** Letter grade for a 0..100 score (shown next to the numeric score). */
export function grade(score) {
  if (!Number.isFinite(score)) return '—';
  if (score >= 95) return 'A+';
  if (score >= 88) return 'A';
  if (score >= 80) return 'B';
  if (score >= 68) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
