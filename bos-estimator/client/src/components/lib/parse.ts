// Number, money and area parsing for NumField / MoneyInput / table cells (UI spec §5.12).
// Accepts what estimators type or paste: "46,500", "46500", "46.5k", "1.2M", "$48,500,000", "(1,200)", "12%".
// Blank input is not a number: callers decide whether blank means "unset" (optional field) or "revert" (required).

import { SQFT_PER, type AreaUnit } from '@shared/types';

export type ParseResult = { ok: true; value: number | undefined } | { ok: false; error: string };

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, mm: 1e6 };

/** Parse a plain or abbreviated number. `percent` divides a trailing % by 100. */
export function parseNumber(raw: string, opts: { percent?: boolean } = {}): ParseResult {
  let s = raw.trim();
  if (!s) return { ok: true, value: undefined };
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^\$\s*/, '').replace(/^usd\s*/i, '').replace(/[\s_  ]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/^\$/, '');
  let pct = false;
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
  const m = /^((?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d*)?)([a-z]{0,2})$/i.exec(s);
  if (!m || !m[1] || m[1] === '.') return { ok: false, error: 'Not a number' };
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return { ok: false, error: 'Not a number' };
  const suf = m[2].toLowerCase();
  let mult = 1;
  if (suf) { const k = SUFFIX[suf]; if (!k) return { ok: false, error: `Unknown suffix "${m[2]}"` }; mult = k; }
  let v = base * mult;
  if (pct) v = opts.percent ? v / 100 : v;
  return { ok: true, value: neg ? -v : v };
}

/** Money: same grammar as parseNumber ("$48.5M", "485k", "$48,500,000"). */
export function parseMoney(raw: string): ParseResult { return parseNumber(raw); }

const AREA_UNIT_RE = /\s*(m²|m2|sq\.?\s*m|sqm|sm|sq\.?\s*yd|sy|sqyd|sf|sq\.?\s*ft|ft²|ft2)\.?$/i;

/** Area in square feet. "4,320 m²" / "4320 sqm" / "4320 SM" convert to SF and report the printed unit. */
export function parseArea(raw: string): (ParseResult & { unit?: AreaUnit; printed?: number }) {
  const m = AREA_UNIT_RE.exec(raw.trim());
  if (!m) return parseNumber(raw);
  const u = m[1].toLowerCase().replace(/[\s.]/g, '');
  const unit: AreaUnit = /^(m²|m2|sqm|sm)$/.test(u) ? 'sm' : /^(sqyd|sy)$/.test(u) ? 'sy' : 'sf';
  const r = parseNumber(raw.trim().slice(0, m.index));
  if (!r.ok || r.value === undefined) return r;
  return { ok: true, value: Math.round(r.value * SQFT_PER[unit]), unit: unit === 'sf' ? undefined : unit, printed: unit === 'sf' ? undefined : r.value };
}

export interface NumberRule { min?: number; max?: number; integer?: boolean; positive?: boolean }

/** Validate a parsed value against simple bounds; returns an error message or null. */
export function checkNumber(v: number, rule: NumberRule = {}): string | null {
  if (!Number.isFinite(v)) return 'Not a number';
  if (rule.positive && v <= 0) return 'Must be greater than 0';
  if (rule.integer && !Number.isInteger(v)) return 'Must be a whole number';
  if (rule.min != null && v < rule.min) return `Must be at least ${rule.min.toLocaleString()}`;
  if (rule.max != null && v > rule.max) return `Must be at most ${rule.max.toLocaleString()}`;
  return null;
}

/** "$48,500,000" (rounded to whole dollars unless cents are present). */
export function formatMoney(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  const cents = Math.abs(v % 1) > 1e-9;
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}

/** Plain grouping for display at rest ("46,500", "1.25"). */
export function formatNumber(v: number | undefined | null, maxFrac = 2): string {
  if (v == null || !Number.isFinite(v)) return '';
  return v.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}
