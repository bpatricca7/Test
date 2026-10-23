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
/** European formatting ("4.312,8 m²", "1.846,5"): dot thousands, comma decimals. Read as an extra candidate. */
const EU_RE = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d{1,2})(?![\d,]|\.\d)/g;

/** Every number printed in an excerpt ("46,500", "46500", "46.5K" → 46500; "4.312,8" → also 4312.8). Cached per excerpt string. */
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
  EU_RE.lastIndex = 0;
  for (let m = EU_RE.exec(excerpt); m; m = EU_RE.exec(excerpt)) {
    const v = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(v)) out.push(v);
  }
  if (excerptCache.size > 5000) excerptCache.clear();
  excerptCache.set(excerpt, out);
  return out;
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 0.005;
const fmtN = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** "4 @ 960" / "1 @ 1,792" terms (portables, annexes) printed next to a main area. */
const AT_RE = /(\d{1,3})\s*@\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g;
function atTerms(excerpt: string): { k: number; m: number; text: string }[] {
  const out: { k: number; m: number; text: string }[] = [];
  AT_RE.lastIndex = 0;
  for (let x = AT_RE.exec(excerpt); x; x = AT_RE.exec(excerpt)) {
    const k = Number(x[1]); const m = Number(x[2].replace(/,/g, '') + (x[3] ? `.${x[3]}` : ''));
    if (k > 0 && m > 0) out.push({ k, m, text: x[0].replace(/\s+/g, ' ') });
  }
  return out;
}

/** "N + k @ m" sums: the gross equals a printed area plus the "k @ m" terms (all of them, or one). */
function sumMatch(excerpt: string, target: number): { base: number; text: string } | null {
  const terms = atTerms(excerpt); if (!terms.length || !(target > 0)) return null;
  const parts = new Set(terms.map((t) => t.m));
  const total = terms.reduce((s, t) => s + t.k * t.m, 0);
  for (const n of excerptNumbers(excerpt)) {
    if (n < 100 || parts.has(n)) continue;
    if (near(n + total, target)) return { base: n, text: `${fmtN(n)} + ${terms.map((t) => t.text).join(' + ')}` };
    for (const t of terms) if (terms.length > 1 && near(n + t.k * t.m, target)) return { base: n, text: `${fmtN(n)} + ${t.text}` };
  }
  return null;
}

const REV_RES = [
  /\bfrom\s+(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:G?SF|SM|m²|sq\.?\s*ft\.?)?\s+to\s+(\d{1,3}(?:,\d{3})+|\d+)/gi,
  /\bsuperseded\s+(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:G?SF)?[^.;]{0,120}?\bwith\s+(\d{1,3}(?:,\d{3})+|\d+)/gi,
];
/** An amendment / Q&A revision recorded in the notes that explains the gross ("revised from 18,240 to 19,860 SF"). */
function revisedFrom(f: Pick<Facility, 'grossSqft' | 'notes'>, nums: number[], excerpt?: string): number | null {
  const notes = f.notes; if (!notes || !(f.grossSqft > 0)) return null;
  for (const re of REV_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(notes); m; m = re.exec(notes)) {
      const was = Number(m[1].replace(/,/g, '')); const now = Number(m[2].replace(/,/g, ''));
      if (near(now, f.grossSqft) && (nums.some((n) => near(n, was)) || (excerpt && sumMatch(excerpt, was)))) return was;
    }
  }
  return null;
}

type SfRow = Pick<Facility, 'grossSqft' | 'cleanableSqft' | 'originalArea' | 'source'> & Partial<Pick<Facility, 'notes'>>;

/**
 * Whether the row's SF is backed by its excerpt (±0.5%): gross, the gross as printed, cleanable, a "N + k @ m" sum, or
 * a revision the notes record (the excerpt then shows the superseded number). null when there is no excerpt.
 */
export function sfInExcerpt(f: SfRow): boolean | null {
  const ex = f.source?.excerpt; if (!ex) return null;
  const nums = excerptNumbers(ex);
  const cands = [f.grossSqft, f.originalArea?.gross, f.cleanableSqft, f.originalArea?.cleanable].filter((v): v is number => typeof v === 'number' && v > 0);
  if (cands.some((c) => nums.some((n) => near(n, c)))) return true;
  const target = f.originalArea?.gross ?? f.grossSqft;
  if (sumMatch(ex, target)) return true;
  return revisedFrom({ grossSqft: f.grossSqft, notes: f.notes }, nums, ex) != null;
}

// ---- source check with a safe suggestion (Inspector source line, table Src column and popover) ----
export interface SourceContext {
  /** normalized building numbers of every facility (a printed building number is not an area) */
  bldgNos: ReadonlySet<string>;
  /** tableId → excerpt cell index where that table prints the gross */
  areaCol: ReadonlyMap<string, number>;
}
const cellsOf = (ex: string) => (ex.includes('|') ? ex.split('|').map((c) => c.trim()) : null);
const srcCtxCache = new WeakMap<readonly Facility[], SourceContext>();
/** Built once per facilities array. */
export function sourceContext(facilities: readonly Facility[]): SourceContext {
  const hit = srcCtxCache.get(facilities); if (hit) return hit;
  const bldgNos = new Set<string>();
  const votes = new Map<string, Map<number, number>>();
  for (const f of facilities) {
    const b = normBldg(f.buildingNumber); if (b) bldgNos.add(b);
    const ex = f.source?.excerpt; if (!ex || !f.tableId) continue;
    const cells = cellsOf(ex); if (!cells) continue;
    const target = f.originalArea?.gross ?? f.grossSqft; if (!(target > 0)) continue;
    const i = cells.findIndex((c) => excerptNumbers(c).some((n) => near(n, target)));
    if (i < 0) continue;
    const v = votes.get(f.tableId) ?? new Map<number, number>(); v.set(i, (v.get(i) ?? 0) + 1); votes.set(f.tableId, v);
  }
  const areaCol = new Map<string, number>();
  for (const [t, v] of votes) { let best = -1, bn = 0; for (const [i, n] of v) if (n > bn) { bn = n; best = i; } if (bn >= 2) areaCol.set(t, best); }
  const ctx = { bldgNos, areaCol };
  srcCtxCache.set(facilities, ctx);
  return ctx;
}

export interface SourceCheck {
  /** ok: an SF value is printed · revised: the notes record a revision from the printed number · differs: cleanable is
   *  printed but the excerpt prints a different gross · miss: no SF value is printed · none: no excerpt */
  status: 'ok' | 'revised' | 'differs' | 'miss' | 'none';
  match?: 'gross' | 'original' | 'sum' | 'cleanable';
  /** "51,340 + 4 @ 960" */
  sumText?: string;
  /** the superseded number the excerpt prints (status 'revised') */
  revisedFrom?: number;
  /** a gross figure the excerpt prints that differs from the row, and why it is believed to be the gross */
  shows?: number;
  showsWhy?: 'extracted' | 'column' | 'near';
  /** a value for gross that is safe to offer as a one-click fix (in the table's area column or within ±25 %) */
  suggest?: number;
}

/** Numbers in the excerpt that can be a gross area: not ids, years, building numbers, headcounts or "k @ m" parts. */
function areaCandidates(f: Facility, ex: string, sctx?: SourceContext): { value: number; cell: number }[] {
  const own = normBldg(f.buildingNumber);
  const skip: number[] = [f.occupancy, f.restroomFixtures, f.dining?.seats, f.dining?.mealsPerDay, f.dining?.kitchenSqft, ...(f.dining?.mealPeriodsDetail ?? []).flatMap((p) => [p.weekdayHeadcount, p.weekendHeadcount])].filter((v): v is number => typeof v === 'number' && v > 0);
  const parts = new Set(atTerms(ex).flatMap((t) => [t.k, t.m]));
  const out: { value: number; cell: number }[] = [];
  const cells = cellsOf(ex) ?? [ex];
  cells.forEach((cell, ci) => {
    const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g;
    for (let m = re.exec(cell); m; m = re.exec(cell)) {
      const raw = m[1]; const v = Number(raw.replace(/,/g, '') + (m[2] ? `.${m[2]}` : ''));
      if (!Number.isFinite(v) || v < 100) continue;
      const before = cell.slice(Math.max(0, m.index - 12), m.index);
      const prevCh = cell[m.index - 1] ?? ' ';
      if (/[A-Za-z_\-/]/.test(prevCh)) continue;                                  // part of an id (TE-5, W912…)
      if (/(?:\bbldg\.?|\bbuilding|\bfacility|\bno\.?|#)\s*$/i.test(before)) continue; // "Bldg 2240"
      if (!raw.includes(',') && raw.length === 4 && v >= 1900 && v <= 2100) continue; // years
      if (!raw.includes(',') && (normBldg(raw) === own || sctx?.bldgNos.has(normBldg(raw)))) continue; // building numbers
      if (parts.has(v) || skip.some((x) => near(v, x))) continue;                 // portables, headcounts, seats
      out.push({ value: v, cell: ci });
    }
  });
  return out;
}

/** The source check the Inspector, the table Src column and its popover show. `entry` names the extracted gross of a hand-edited row. */
export function sourceCheck(f: Facility, entry?: ReviewEntry, sctx?: SourceContext): SourceCheck {
  const ex = f.source?.excerpt; if (!ex) return { status: 'none' };
  const nums = excerptNumbers(ex);
  const has = (v: number | undefined) => typeof v === 'number' && v > 0 && nums.some((n) => near(n, v));
  if (has(f.grossSqft)) return { status: 'ok', match: 'gross' };
  if (has(f.originalArea?.gross)) return { status: 'ok', match: 'original' };
  const target = f.originalArea?.gross ?? f.grossSqft;
  const sum = sumMatch(ex, target);
  if (sum) return { status: 'ok', match: 'sum', sumText: sum.text };
  const was = revisedFrom(f, nums, ex);
  if (was != null) return { status: 'revised', revisedFrom: was };
  // the gross is not printed: which printed number is the gross, if any?
  const cands = areaCandidates(f, ex, sctx);
  const extracted = entry?.edited && typeof entry.edited.grossSqft === 'number' ? entry.edited.grossSqft : undefined;
  const col = f.tableId ? sctx?.areaCol.get(f.tableId) : undefined;
  let shows: number | undefined; let why: SourceCheck['showsWhy'];
  if (extracted != null && !f.originalArea && cands.some((c) => near(c.value, extracted))) { shows = extracted; why = 'extracted'; }
  else {
    const inCol = col != null ? cands.find((c) => c.cell === col) : undefined;
    if (inCol) { shows = inCol.value; why = 'column'; }
    else if (target > 0) {
      let best: number | undefined; let bd = Infinity;
      for (const c of cands) { const d = Math.abs(Math.log(c.value / target)); if (d < bd) { bd = d; best = c.value; } }
      if (best != null && bd <= Math.log(1.25)) { shows = best; why = 'near'; }
    }
  }
  const clean = has(f.cleanableSqft) || has(f.originalArea?.cleanable);
  // a converted row needs the unit, not the raw number, so it never gets a one-click value
  const suggest = shows != null && !f.originalArea && !near(shows, f.grossSqft) ? Math.round(shows) : undefined;
  if (clean) return shows != null ? { status: 'differs', match: 'cleanable', shows, showsWhy: why, suggest } : { status: 'ok', match: 'cleanable' };
  return { status: 'miss', shows, showsWhy: why, suggest };
}

/** Compat: the Src column's ✓ / ✗ (revised counts as backed; differs as backed with a warning). */
export function excerptCheck(f: Facility, entry?: ReviewEntry, sctx?: SourceContext): { status: 'ok' | 'miss' | 'none'; shows?: number } {
  const c = sourceCheck(f, entry, sctx);
  return { status: c.status === 'none' ? 'none' : c.status === 'miss' ? 'miss' : 'ok', shows: c.shows };
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

// ---- edited markers (§6.3 P1): field → extracted value, captured on the first manual edit ----
type AnyRow = Facility | GroundsArea;
export const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Rows added by hand have no extracted values, so they never carry markers. */
export const isManualRow = (id: string) => id.startsWith('b-manual-') || id.startsWith('g-manual-');

/** Field paths a marker uses: top-level keys, plus "dining.mealsPerDay". */
export function fieldValue(row: AnyRow, path: string): unknown {
  if (path === 'dining.mealsPerDay') return (row as Facility).dining?.mealsPerDay;
  return (row as unknown as Record<string, unknown>)[path];
}

/** [path, before, after] for every field the patch actually changes. */
export function changedFields(row: AnyRow, patch: Partial<Facility> | Partial<GroundsArea>): [string, unknown, unknown][] {
  const out: [string, unknown, unknown][] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'dining') { const before = (row as Facility).dining?.mealsPerDay; const after = (v as Facility['dining'])?.mealsPerDay; if (!sameValue(before, after)) out.push(['dining.mealsPerDay', before, after]); continue; }
    const before = (row as unknown as Record<string, unknown>)[k];
    if (!sameValue(before, v)) out.push([k, before, v]);
  }
  return out;
}

/**
 * The review entry after a manual edit: the first time a field moves away from its extracted value the extracted
 * value is kept in `edited[field]`; editing it back removes the marker. Returns `prev` when nothing changes.
 */
export function withEditMarkers(prev: ReviewEntry | undefined, changes: [string, unknown, unknown][], at: number): ReviewEntry | undefined {
  if (!changes.length) return prev;
  const edited: Record<string, unknown> = { ...(prev?.edited ?? {}) };
  let touched = false;
  for (const [k, before, after] of changes) {
    if (!(k in edited)) { edited[k] = before ?? null; touched = true; }
    else if (sameValue(edited[k], after)) { delete edited[k]; touched = true; }
  }
  if (!touched) return prev;
  const entry: ReviewEntry = { ...(prev ?? { status: 'unreviewed' as const }), at };
  if (Object.keys(edited).length) entry.edited = edited; else delete entry.edited;
  return entry;
}

/** The patch that puts edited fields back to their extracted values. */
export function revertPatch(row: AnyRow, paths: string[], edited: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const path of paths) {
    const v = edited[path] ?? undefined;
    if (path === 'dining.mealsPerDay') {
      const d = (row as Facility).dining;
      if (d) patch.dining = { ...d, mealsPerDay: typeof v === 'number' ? v : 0 };
    } else patch[path] = v;
  }
  return patch;
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
