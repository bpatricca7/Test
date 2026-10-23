// Scores an extracted inventory against fixture ground truth.
import type { Facility, GroundsArea, Inventory, PriorAward } from '../../shared/types';
import { groundsAcres, groundsSqft } from '../../shared/estimate';
import type { FixtureTruth, TruthFacility } from './truth';

export interface FacilityMatch { truth: TruthFacility; got?: Facility; via?: 'number' | 'name'; sfOk?: boolean; cleanOk?: boolean; floorsOk?: boolean; levelOk?: boolean; catOk?: boolean; sfGot?: number }

export interface ScoreReport {
  fixture: string;
  provider: string;
  facilities: { expected: number; extracted: number; matched: number; recall: number; precision: number | null; sfExact: number; sfExactRate: number; cleanableExactRate: number | null; floorsRate: number | null; serviceLevelRate: number | null; categoryRate: number | null; totalSfExpected: number; totalSfGot: number; totalSfErrPct: number };
  grounds: { kind: string; unit: string; expected: number; got: number; errPct: number }[];
  dining: { expected: number; got: number; ok: boolean }[];
  priorAward: { field: string; expected: unknown; got: unknown; ok: boolean }[];
  site: { field: string; expected: unknown; got: unknown; ok: boolean }[];
  /** Facilities not found, then SF mismatches, then cleanable / service level / floors / category mismatches, then site fields. */
  misses: string[];
  extras: string[];
  /**
   * 0..100 headline, one decimal: 30% recall, 25% SF exact, 5% cleanable exact and 5% service level (each over the truth
   * facilities that give one; the SF rate stands in when none do), 10% precision, 15% grounds, 5% dining, 5% prior award.
   */
  score: number;
}

export const normBn = (s?: string) => (s ?? '').toUpperCase().replace(/\b(BLDG|BUILDING|BLD|FAC|FACILITY|NO|#)\.?/g, '').replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
const tokens = (s: string) => new Set(s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !['the', 'and', 'of', 'bldg', 'building'].includes(t)));
export function nameSim(a: string, b: string): number {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}
const close = (a: number | undefined, b: number | undefined, rel = 0.01, abs = 5) => a != null && b != null && Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);

/** Canonical quantity for a grounds kind: acres for turf, square feet for beds and paving, each for trees. */
export function canonical(kind: string, g: { quantity: number; unit: GroundsArea['unit'] }): { qty: number; unit: string } {
  const area = { id: '', name: '', kind: kind as GroundsArea['kind'], quantity: g.quantity, unit: g.unit, confidence: 1 } as GroundsArea;
  if (['improved_turf', 'semi_improved', 'unimproved', 'athletic_field'].includes(kind)) return { qty: g.unit === 'acres' ? g.quantity : g.unit === 'lf' ? 0 : groundsAcres(area), unit: 'acres' };
  if (kind === 'tree_canopy') return { qty: g.quantity, unit: 'each' };
  return { qty: groundsSqft(area), unit: 'sqft' };
}

export function scoreInventory(truth: FixtureTruth, inv: Inventory, provider: string, gotAward?: PriorAward): ScoreReport {
  const exp = truth.expect.facilities;
  // Rows the reader marked excluded / deleted / demolished / vacant are not in the inventory being estimated.
  const got = inv.facilities.filter((f) => !f.status || f.status === 'in_scope');
  const used = new Set<number>();
  const matches: FacilityMatch[] = [];
  // pass 1: building number
  for (const t of exp) {
    let idx = -1;
    if (t.buildingNumber) idx = got.findIndex((g, i) => !used.has(i) && normBn(g.buildingNumber) === normBn(t.buildingNumber) && normBn(t.buildingNumber) !== '');
    if (idx >= 0) { used.add(idx); matches.push({ truth: t, got: got[idx], via: 'number' }); } else matches.push({ truth: t });
  }
  // pass 2: names for the rest (best similarity ≥ 0.6)
  for (const m of matches) {
    if (m.got) continue;
    let best = -1, bestSim = 0;
    got.forEach((g, i) => { if (used.has(i)) return; const s = nameSim(m.truth.name, g.name); if (s > bestSim) { bestSim = s; best = i; } });
    if (best >= 0 && bestSim >= 0.6) { used.add(best); m.got = got[best]; m.via = 'name'; }
  }
  let sfExact = 0, cleanN = 0, cleanOk = 0, floorsN = 0, floorsOk = 0, lvlN = 0, lvlOk = 0, catN = 0, catOk = 0;
  for (const m of matches) {
    if (!m.got) continue;
    m.sfGot = m.got.grossSqft; m.sfOk = close(m.got.grossSqft, m.truth.grossSqft); if (m.sfOk) sfExact++;
    if (m.truth.cleanableSqft != null) { cleanN++; m.cleanOk = close(m.got.cleanableSqft, m.truth.cleanableSqft); if (m.cleanOk) cleanOk++; }
    if (m.truth.floors != null) { floorsN++; m.floorsOk = m.got.floors === m.truth.floors; if (m.floorsOk) floorsOk++; }
    if (m.truth.serviceLevel) { lvlN++; m.levelOk = m.got.serviceLevel === m.truth.serviceLevel; if (m.levelOk) lvlOk++; }
    if (m.truth.category) { catN++; m.catOk = m.got.category === m.truth.category; if (m.catOk) catOk++; }
  }
  const matched = matches.filter((m) => m.got).length;
  const totalSfExpected = exp.reduce((s, f) => s + f.grossSqft, 0);
  const totalSfGot = got.reduce((s, f) => s + (f.grossSqft || 0), 0);

  // grounds: compare totals per kind in canonical units
  const gExp = new Map<string, { qty: number; unit: string }>();
  for (const g of truth.expect.grounds ?? []) { const c = canonical(g.kind, g); const cur = gExp.get(g.kind); gExp.set(g.kind, { qty: (cur?.qty ?? 0) + c.qty, unit: c.unit }); }
  const gGot = new Map<string, number>();
  for (const g of inv.grounds) { const c = canonical(g.kind, g); gGot.set(g.kind, (gGot.get(g.kind) ?? 0) + c.qty); }
  const grounds = [...new Set([...gExp.keys(), ...(truth.expect.grounds ? gGot.keys() : [])])].map((kind) => {
    const e = gExp.get(kind)?.qty ?? 0; const g = gGot.get(kind) ?? 0;
    return { kind, unit: gExp.get(kind)?.unit ?? canonical(kind, { quantity: 0, unit: 'acres' }).unit, expected: round(e), got: round(g), errPct: e > 0 ? round(((g - e) / e) * 100) : g > 0 ? 100 : 0 };
  });

  const dining = exp.filter((f) => f.dining).map((f) => {
    const m = matches.find((x) => x.truth === f);
    const got = m?.got?.dining?.mealsPerDay ?? inv.facilities.find((x) => x.dining)?.dining?.mealsPerDay ?? 0;
    return { expected: f.dining!.mealsPerDay, got, ok: close(got, f.dining!.mealsPerDay, 0.01, 1) };
  });

  const priorAward: ScoreReport['priorAward'] = [];
  for (const [k, v] of Object.entries(truth.expect.priorAward ?? {})) {
    const gv = (gotAward ? (gotAward as Record<string, unknown>)[k] : undefined);
    const ok = typeof v === 'number' ? close(gv as number, v, 0.005, 1) : typeof v === 'string' ? String(gv ?? '').toLowerCase().includes(v.toLowerCase().slice(0, 12)) : gv === v;
    priorAward.push({ field: k, expected: v, got: gv, ok });
  }
  const site: ScoreReport['site'] = [];
  for (const [k, v] of Object.entries(truth.expect.site ?? {})) {
    const gv = (inv.site as Record<string, unknown>)[k];
    const ok = typeof v === 'string' && typeof gv === 'string' ? gv.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(gv.toLowerCase()) : gv === v;
    site.push({ field: k, expected: v, got: gv, ok });
  }

  const recall = exp.length ? matched / exp.length : 1;
  const precision = truth.expect.facilitiesComplete && got.length ? matched / got.length : null;
  const sfRate = matched ? sfExact / exp.length : 0;
  // labor-driving attributes, over every truth facility that gives one (a facility not found counts as wrong)
  const cleanTotal = exp.filter((t) => t.cleanableSqft != null).length;
  const lvlTotal = exp.filter((t) => t.serviceLevel).length;
  const cleanScore = cleanTotal ? cleanOk / cleanTotal : sfRate;
  const lvlScore = lvlTotal ? lvlOk / lvlTotal : sfRate;
  const gScore = grounds.length ? grounds.filter((g) => Math.abs(g.errPct) <= 2).length / grounds.length : 1;
  const dScore = dining.length ? dining.filter((d) => d.ok).length / dining.length : 1;
  const pScore = priorAward.length ? priorAward.filter((p) => p.ok).length / priorAward.length : 1;
  const score = Math.round(1000 * (0.3 * recall + 0.25 * sfRate + 0.05 * cleanScore + 0.05 * lvlScore + 0.1 * (precision ?? 1) + 0.15 * gScore + 0.05 * dScore + 0.05 * pScore)) / 10;
  const idOf = (m: FacilityMatch) => m.truth.buildingNumber ?? m.truth.name;
  const found = matches.filter((m) => m.got);

  return {
    fixture: truth.id, provider,
    facilities: { expected: exp.length, extracted: got.length, matched, recall: round(recall, 3), precision: precision == null ? null : round(precision, 3), sfExact, sfExactRate: round(sfRate, 3), cleanableExactRate: cleanN ? round(cleanOk / cleanN, 3) : null, floorsRate: floorsN ? round(floorsOk / floorsN, 3) : null, serviceLevelRate: lvlN ? round(lvlOk / lvlN, 3) : null, categoryRate: catN ? round(catOk / catN, 3) : null, totalSfExpected, totalSfGot, totalSfErrPct: totalSfExpected ? round(((totalSfGot - totalSfExpected) / totalSfExpected) * 100) : 0 },
    grounds, dining, priorAward, site,
    misses: [
      ...matches.filter((m) => !m.got).map((m) => `${m.truth.buildingNumber ?? ''} ${m.truth.name} (${m.truth.grossSqft} SF)`.trim()),
      ...found.filter((m) => !m.sfOk).map((m) => `SF mismatch ${idOf(m)}: expected ${m.truth.grossSqft}, got ${m.sfGot}`),
      ...found.filter((m) => m.cleanOk === false).map((m) => `cleanable mismatch ${idOf(m)}: expected ${m.truth.cleanableSqft}, got ${m.got!.cleanableSqft ?? 'none'}`),
      ...found.filter((m) => m.levelOk === false).map((m) => `service level mismatch ${idOf(m)}: expected ${m.truth.serviceLevel}, got ${m.got!.serviceLevel}`),
      ...found.filter((m) => m.floorsOk === false).map((m) => `floors mismatch ${idOf(m)}: expected ${m.truth.floors}, got ${m.got!.floors}`),
      ...found.filter((m) => m.catOk === false).map((m) => `category mismatch ${idOf(m)}: expected ${m.truth.category}, got ${m.got!.category}`),
      ...site.filter((x) => !x.ok).map((x) => `site ${x.field}: expected ${String(x.expected)}, got ${String(x.got ?? 'none')}`),
    ],
    extras: got.filter((_, i) => !used.has(i)).map((g) => `${g.buildingNumber ?? ''} ${g.name} (${g.grossSqft} SF)`.trim()),
    score,
  };
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
