// Review model (UI spec §6): issues per row, the needs-review status and progress counts.
// Pure functions; rowMetaFor() memoizes per row object, so a 420-row inventory recomputes only the rows that changed.
// derived.ts builds the per-row meta for the whole app; the inventory query publisher (query.ts) reuses the same
// cached context (stableContext keeps one canonical object), so both hit the same per-row cache.

import { FACILITY_STATUSES, isInScope, type AreaUnit, type Facility, type GroundsArea } from '@shared/types';
import { confBand, REVIEW_CONF_THRESHOLD, type ConfBand, type RowReview } from './theme';

export type IssueCode =
  | 'low_conf' | 'no_bldg_no' | 'zero_sf' | 'clean_gt_gross' | 'sf_not_in_excerpt' | 'dup_bldg'
  | 'unit_converted' | 'out_of_scope' | 'no_source' | 'rerun_changed' | 'zero_qty';

export const ISSUE_INFO: Record<IssueCode, { label: string; short: string; counts: boolean }> = {
  low_conf: { label: 'Low confidence', short: 'Low conf', counts: true },
  no_bldg_no: { label: 'No building number', short: 'No #', counts: true },
  zero_sf: { label: 'No gross SF', short: 'No SF', counts: true },
  clean_gt_gross: { label: 'Cleanable SF exceeds gross', short: 'Clean > gross', counts: true },
  sf_not_in_excerpt: { label: 'SF not found in the source excerpt', short: 'SF not in source', counts: true },
  dup_bldg: { label: 'Duplicate building number', short: 'Duplicate #', counts: true },
  unit_converted: { label: 'Area converted from another unit', short: 'Converted unit', counts: true },
  out_of_scope: { label: 'Not in scope (confirm the exclusion)', short: 'Out of scope', counts: true },
  no_source: { label: 'No source document', short: 'No source', counts: false },
  rerun_changed: { label: 'Changed by the last re-read', short: 'Changed', counts: true },
  zero_qty: { label: 'No quantity', short: 'No qty', counts: true },
};
export const ISSUE_CODES = Object.keys(ISSUE_INFO) as IssueCode[];

export type ReviewStatus = 'unreviewed' | 'verified' | 'flagged';
export interface ReviewEntry {
  status: ReviewStatus;
  /** ms timestamp of the last change (the post-run merge keeps local entries newer than the run start) */
  at: number;
  note?: string;
  /** P1: field → extracted value captured on the first manual edit */
  edited?: Record<string, unknown>;
}
export type ReviewMap = Record<string, ReviewEntry>;

export interface RowMeta { conf: ConfBand; review: RowReview; issues: IssueCode[]; inScope: boolean; edited: boolean }

/** Normalized building number: trimmed, upper case, leading zeros stripped ("0059" → "59"). */
export function normBldg(n: string | undefined | null): string {
  const s = (n ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return s.replace(/^0+(?=[0-9A-Z])/, '');
}
export const normCampus = (c: string | undefined | null) => (c ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const normName = (n: string | undefined | null) => (n ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const NUM_RE = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*([kK])?/g;

/** Every number printed in an excerpt ("46,500", "46500", "46.5K" → 46500). Cached per excerpt string. */
const excerptCache = new Map<string, number[]>();
export function excerptNumbers(excerpt: string): number[] {
  const hit = excerptCache.get(excerpt); if (hit) return hit;
  const out: number[] = [];
  NUM_RE.lastIndex = 0;
  for (let m = NUM_RE.exec(excerpt); m; m = NUM_RE.exec(excerpt)) {
    let v = Number(m[1].replace(/,/g, '') + (m[2] ? `.${m[2]}` : ''));
    if (m[3]) v *= 1000;
    if (Number.isFinite(v)) out.push(v);
  }
  if (excerptCache.size > 5000) excerptCache.clear();
  excerptCache.set(excerpt, out);
  return out;
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 0.005;

/** Whether any SF value of the row is printed in its excerpt (±0.5%). null when there is no excerpt. */
export function sfInExcerpt(f: Pick<Facility, 'grossSqft' | 'cleanableSqft' | 'originalArea' | 'source'>): boolean | null {
  const ex = f.source?.excerpt; if (!ex) return null;
  const nums = excerptNumbers(ex);
  const cands = [f.grossSqft, f.originalArea?.gross, f.cleanableSqft, f.originalArea?.cleanable].filter((v): v is number => typeof v === 'number' && v > 0);
  return cands.some((c) => nums.some((n) => near(n, c)));
}

/**
 * The excerpt check the table Src column and the Inspector show: 'ok' when an SF value is printed in the excerpt,
 * 'miss' with the closest area-like number the excerpt does show, 'none' without an excerpt.
 */
export function excerptCheck(f: Pick<Facility, 'grossSqft' | 'cleanableSqft' | 'originalArea' | 'source' | 'buildingNumber'>): { status: 'ok' | 'miss' | 'none'; shows?: number } {
  const ok = sfInExcerpt(f);
  if (ok === null) return { status: 'none' };
  if (ok) return { status: 'ok' };
  const nums = excerptNumbers(f.source!.excerpt!);
  const bldg = Number(normBldg(f.buildingNumber));
  const target = f.originalArea?.gross ?? f.grossSqft;
  let best: number | undefined; let bestD = Infinity;
  for (const n of nums) {
    if (n < 100 || n === bldg || (Number.isInteger(n) && n >= 1900 && n <= 2100)) continue; // ids and years are not areas
    const d = target > 0 ? Math.abs(Math.log(n / target)) : n;
    if (d < bestD) { bestD = d; best = n; }
  }
  return { status: 'miss', shows: best };
}

/** Inventory-wide context the per-row rules need. Build once per inventory. */
export interface ReviewContext {
  numbersCommon: boolean;
  dupKeys: ReadonlySet<string>;
  changed: ReadonlySet<string>;
  /** campus|bldg → rows sharing it (only keys with more than one row) */
  dupCount?: ReadonlyMap<string, number>;
}
export const dupKey = (f: Pick<Facility, 'campus' | 'buildingNumber'>) => `${normCampus(f.campus)}|${normBldg(f.buildingNumber)}`;

let lastBuilt: { facilities: readonly Facility[]; changedKey: string; ctx: ReviewContext } | null = null;
export function reviewContext(facilities: readonly Facility[], changedIds: readonly string[] = []): ReviewContext {
  const changedKey = changedIds.join('\u0001');
  if (lastBuilt && lastBuilt.facilities === facilities && lastBuilt.changedKey === changedKey) return lastBuilt.ctx;
  let withNo = 0;
  const seen = new Map<string, number>();
  for (const f of facilities) {
    const b = normBldg(f.buildingNumber);
    if (!b) continue;
    withNo++;
    const k = dupKey(f);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupKeys = new Set<string>();
  const dupCount = new Map<string, number>();
  for (const [k, n] of seen) if (n > 1) { dupKeys.add(k); dupCount.set(k, n); }
  const ctx: ReviewContext = { numbersCommon: facilities.length > 0 && withNo / facilities.length >= 0.5, dupKeys, changed: new Set(changedIds), dupCount };
  lastBuilt = { facilities, changedKey, ctx };
  return ctx;
}

const setEq = (a: ReadonlySet<string>, b: ReadonlySet<string>) => { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; };
const mapEq = (a: ReadonlyMap<string, number> | undefined, b: ReadonlyMap<string, number> | undefined) => {
  if (a === b) return true; if (!a || !b || a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};
const sameFacts = (a: ReviewContext, b: ReviewContext) => a === b || (a.numbersCommon === b.numbersCommon && setEq(a.dupKeys, b.dupKeys) && setEq(a.changed, b.changed) && mapEq(a.dupCount, b.dupCount));
/** The context every caller converges on, so the per-row cache is shared by derived.ts and query.ts. */
let canonical: ReviewContext | null = null;
/** Returns `prev` (or the shared canonical context) when `next` carries the same facts, so per-row memoization survives unrelated edits. */
export function stableContext(next: ReviewContext, prev: ReviewContext | null | undefined): ReviewContext {
  if (prev && sameFacts(prev, next)) { canonical = prev; return prev; }
  if (canonical && sameFacts(canonical, next)) return canonical;
  canonical = next;
  return next;
}
/** reviewContext + stableContext against the shared canonical context. */
export function sharedContext(facilities: readonly Facility[], changedIds: readonly string[] = []): ReviewContext {
  return stableContext(reviewContext(facilities, changedIds), canonical);
}

export function facilityIssues(f: Facility, ctx: ReviewContext): IssueCode[] {
  const out: IssueCode[] = [];
  if (f.confidence < REVIEW_CONF_THRESHOLD) out.push('low_conf');
  const b = normBldg(f.buildingNumber);
  if (!b && ctx.numbersCommon) out.push('no_bldg_no');
  if (!(f.grossSqft > 0)) out.push('zero_sf');
  if (f.cleanableSqft != null && f.grossSqft > 0 && f.cleanableSqft > f.grossSqft) out.push('clean_gt_gross');
  if (sfInExcerpt(f) === false) out.push('sf_not_in_excerpt');
  if (b && ctx.dupKeys.has(dupKey(f))) out.push('dup_bldg');
  if (f.originalArea) out.push('unit_converted');
  if (!isInScope(f)) out.push('out_of_scope');
  if (!f.source?.file) out.push('no_source');
  if (ctx.changed.has(f.id)) out.push('rerun_changed');
  return out;
}

export function groundsIssues(g: GroundsArea, ctx: ReviewContext): IssueCode[] {
  const out: IssueCode[] = [];
  if (g.confidence < REVIEW_CONF_THRESHOLD) out.push('low_conf');
  if (!(g.quantity > 0)) out.push('zero_qty');
  if (!g.source?.file) out.push('no_source');
  if (ctx.changed.has(g.id)) out.push('rerun_changed');
  return out;
}

export const countsTowardReview = (issues: readonly IssueCode[]) => issues.some((i) => ISSUE_INFO[i].counts);

export function reviewKey(entry: ReviewEntry | undefined, issues: readonly IssueCode[]): RowReview {
  if (entry?.status === 'verified') return 'verified';
  if (entry?.status === 'flagged') return 'flagged';
  return countsTowardReview(issues) ? 'needs' : 'ok';
}

// ---- memoized per row ----
interface Cached { ctx: ReviewContext; entry: ReviewEntry | undefined; meta: RowMeta }
const rowCache = new WeakMap<object, Cached>();

/** RowMeta for a facility or grounds row; recomputed only when the row object, the context or its review entry changed. */
export function rowMetaFor(row: Facility | GroundsArea, kind: 'facility' | 'grounds', ctx: ReviewContext, entry: ReviewEntry | undefined): RowMeta {
  const c = rowCache.get(row);
  if (c && c.ctx === ctx && c.entry === entry) return c.meta;
  const issues = kind === 'facility' ? facilityIssues(row as Facility, ctx) : groundsIssues(row as GroundsArea, ctx);
  const meta: RowMeta = {
    conf: confBand(row.confidence),
    review: reviewKey(entry, issues),
    issues,
    inScope: kind === 'facility' ? isInScope(row as Facility) : true,
    edited: Boolean(entry?.edited && Object.keys(entry.edited).length),
  };
  rowCache.set(row, { ctx, entry, meta });
  return meta;
}

export interface ReviewCounts { total: number; verified: number; flagged: number; needs: number; outOfScope: number; edited: number }
export function reviewCounts(rowMeta: ReadonlyMap<string, RowMeta>): ReviewCounts {
  const c: ReviewCounts = { total: 0, verified: 0, flagged: 0, needs: 0, outOfScope: 0, edited: 0 };
  for (const m of rowMeta.values()) {
    c.total++;
    if (m.review === 'verified') c.verified++;
    else if (m.review === 'flagged') c.flagged++;
    else if (m.review === 'needs') c.needs++;
    if (!m.inScope) c.outOfScope++;
    if (m.edited) c.edited++;
  }
  return c;
}

// ---- human-readable issue details (tooltips, Inspector chips, CSV) ----
const fmtInt = (v: number) => Math.round(v).toLocaleString();
const fmtArea = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
export const AREA_UNIT_LABEL: Record<AreaUnit, string> = { sf: 'SF', sm: 'm²', sy: 'SY' };

/** "As printed 2,148.6 m² (cleanable 1,702.3 m²)" for a converted row; null otherwise. */
export function asPrinted(f: Pick<Facility, 'originalArea'>): string | null {
  const oa = f.originalArea; if (!oa) return null;
  const u = AREA_UNIT_LABEL[oa.unit] ?? oa.unit;
  const parts: string[] = [];
  if (oa.gross != null) parts.push(`${fmtArea(oa.gross)} ${u}`);
  if (oa.cleanable != null) parts.push(`${oa.gross != null ? 'cleanable ' : ''}${fmtArea(oa.cleanable)} ${u}`);
  return parts.length ? `As printed ${parts[0]}${parts[1] ? ` (${parts[1]})` : ''}` : `As printed in ${u}`;
}

/** One line per issue, e.g. "Confidence 44% (below 60%)" or "As printed 2,148.6 m² → 23,127 SF". */
export function issueDetail(code: IssueCode, row: Facility | GroundsArea, ctx?: ReviewContext): string {
  const f = row as Facility;
  switch (code) {
    case 'low_conf': return `Confidence ${Math.round(row.confidence * 100)}% (below ${Math.round(REVIEW_CONF_THRESHOLD * 100)}%)`;
    case 'no_bldg_no': return 'No building number, while most rows have one';
    case 'zero_sf': return 'Gross SF is 0 or missing';
    case 'clean_gt_gross': return `Cleanable ${fmtInt(f.cleanableSqft ?? 0)} SF is more than gross ${fmtInt(f.grossSqft)} SF`;
    case 'sf_not_in_excerpt': {
      const c = excerptCheck(f);
      return `Gross SF ${fmtInt(f.grossSqft)} is not in the excerpt${c.shows != null ? ` (it shows ${fmtArea(c.shows)})` : ''}`;
    }
    case 'dup_bldg': {
      const n = ctx?.dupCount?.get(dupKey(f));
      return `Building ${f.buildingNumber} appears ${n ? `${n} times` : 'more than once'}${f.campus ? ` on ${f.campus}` : ''}`;
    }
    case 'unit_converted': {
      const p = asPrinted(f);
      return `${p ?? 'Converted'} → ${fmtInt(f.grossSqft)} SF`;
    }
    case 'out_of_scope': {
      const label = FACILITY_STATUSES.find((s) => s.id === f.status)?.label ?? 'Not in scope';
      return `${label}${f.statusReason ? `: ${f.statusReason}` : ''} · confirm the exclusion`;
    }
    case 'no_source': return 'No source document cited';
    case 'rerun_changed': return 'Changed by the last re-read';
    case 'zero_qty': return 'Quantity is 0 or missing';
  }
}

/** Multi-line tooltip text for a row's issues (counting issues first). */
export function issuesTooltip(issues: readonly IssueCode[], row: Facility | GroundsArea, ctx?: ReviewContext): string {
  const sorted = [...issues].sort((a, b) => Number(ISSUE_INFO[b].counts) - Number(ISSUE_INFO[a].counts));
  return sorted.map((i) => `${ISSUE_INFO[i].counts ? '•' : '◦'} ${issueDetail(i, row, ctx)}`).join('\n');
}
