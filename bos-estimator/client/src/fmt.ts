export const n0 = (v: number) => Math.round(v).toLocaleString();
export const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const n2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const confClass = (c: number) => (c >= 0.75 ? 'conf-hi' : c >= 0.45 ? 'conf-mid' : 'conf-lo');
export const unitLabel: Record<string, string> = { msf: 'MSF', fixture: 'fixture', acre: 'acre', msf_bed: 'MSF bed', msf_paved: 'MSF paved', each: 'ea', meal: 'meal', day: 'day' };
