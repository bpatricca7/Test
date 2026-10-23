export const n0 = (v: number) => Math.round(v).toLocaleString();
export const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const n2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const confClass = (c: number) => (c >= 0.75 ? 'conf-hi' : c >= 0.45 ? 'conf-mid' : 'conf-lo');
export const unitLabel: Record<string, string> = { msf: 'MSF', fixture: 'fixture', acre: 'acre', msf_bed: 'MSF bed', msf_paved: 'MSF paved', each: 'ea', meal: 'meal', day: 'day' };
export const usdCompact = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v).toLocaleString()}`);
/** 15.3M / 811.6K / 966 — for the top-bar metric strip */
export const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(Math.abs(v) >= 1e8 ? 0 : 1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(Math.abs(v) >= 1e6 ? 0 : 1)}K` : Math.round(v).toLocaleString());
/** Never negative, never NaN (streaming totals, §5.1) */
export const nonNeg = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
/** +70% / −12% */
export const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
/** 3m 12s / 48s */
export const duration = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
/** 03:12 */
export const clockMs = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
