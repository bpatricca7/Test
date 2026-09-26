// Unit formatting for the texts the sim writes (ticker messages, crash / hard-landing reasons).
// Honours game.settings.units: 'imperial' (Apollo: ft, ft/s, nmi — the default) or 'metric'.
// Keep in step with ui/format.js: the HUD and tapes show the same units.

const FT = 0.3048;
const NMI = 1852;

const imperial = (game) => (game?.settings?.units ?? 'imperial') !== 'metric';

/** Group thousands: 1290 -> "1,290". */
function group(x, digits) {
  const s = Math.abs(x).toFixed(digits);
  const [i, f] = s.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (x < 0 ? '-' : '') + (f ? `${g}.${f}` : g);
}

/**
 * Speed: "2.1 ft/s" / "0.64 m/s". `digits` applies to the metric value; imperial speeds (about
 * 3.3x larger numbers) use one fewer decimal, never below zero.
 */
export function fmtSpeed(game, mps, digits = 1) {
  if (!Number.isFinite(mps)) return '—';
  if (imperial(game)) {
    const ft = mps / FT;
    const d = Math.abs(ft) >= 100 ? 0 : Math.max(0, digits - (digits > 1 ? 1 : 0));
    return `${group(ft, d)} ft/s`;
  }
  return `${group(mps, Math.abs(mps) >= 100 ? 0 : digits)} m/s`;
}

/** Short distance: "3.2 ft" / "0.98 m". */
export function fmtLen(game, m, digits = 1) {
  if (!Number.isFinite(m)) return '—';
  if (imperial(game)) return `${group(m / FT, Math.abs(m / FT) >= 100 ? 0 : digits)} ft`;
  return `${group(m, Math.abs(m) >= 100 ? 0 : digits)} m`;
}

/** Orbit altitude pair: "47.5 × 9.1 nmi" / "88.0 × 16.9 km". */
export function fmtOrbit(game, apo, peri) {
  if (imperial(game)) return `${(apo / NMI).toFixed(1)} × ${(peri / NMI).toFixed(1)} nmi`;
  return `${(apo / 1000).toFixed(1)} × ${(peri / 1000).toFixed(1)} km`;
}
