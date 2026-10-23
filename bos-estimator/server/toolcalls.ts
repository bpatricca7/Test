// Tool-call handling for the Claude reader, as pure functions over an explicit state, so the live loop in
// server/ai.ts and recorded replays (tests, `npm run eval -- --provider replay`) share exactly one code path:
//
//   const st = createState(docs)
//   beginPass(st, passDocNames)                       // optional; replays without passes use every document
//   const r = applyToolCall(st, { name, input }, { truncated })   // r.resultText / r.isError go back as the tool_result
//   const { inventory, priorAward, warnings } = finalize(st)
//
// What the code does instead of the model:
//  * facility identity: campus + normalised building number ("Bldg 0012" == "12" == "0012", "T-2401" == "T2401", but
//    "1-10" != "110"; 0012 on two campuses = two buildings); ids keep the printed form (b-0012, b-main-post--0012);
//    unnumbered buildings get table/row-scoped ids
//  * unit conversion (SM × 10.7639, SY × 9 → SF; ha × 2.4710538 → acres; m² → ft²), with the printed area kept
//  * merge precedence by document rank (base < attachments < Q&A < amendment N), field group by field group, never by
//    confidence: every row of a building is kept and re-folded in (rank, seq) order, so read order does not matter;
//    a status only counts when stated (an update row's default in_scope never brings an excluded building back)
//  * status rows (excluded / deleted / demolished / vacant / option-only) kept visible but out of the estimate
//  * rows without area rejected (unless area_missing), subtotal / total rows rejected, cut-off calls not applied
//  * completeness: declared workload tables are reconciled (rows, printed total SF) before finish is accepted; table rows
//    are counted per printed row (out-of-scope rows included, areas split from one printed row counted once)
//  * fixtures summed from WC / UR / LAV / shower columns; dining meals per day derived from per-meal-period headcounts
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  AreaUnit, DocumentRole, ExtractionEvent, Facility, FacilityCategory, FacilityStatus, GroundsArea, GroundsKind, GroundsUnit,
  Inventory, MealPeriodHeadcount, PriorAward, ServiceLevel, SiteInfo,
} from '../shared/types';
import { FACILITY_CATEGORIES, FACILITY_STATUSES, GROUNDS_KINDS, SERVICE_LEVELS, SQFT_PER } from '../shared/types';
import { ACRES_PER_HECTARE, SQFT_PER_SQM, mealsPerDayFromPeriods } from '../shared/estimate';
import { categorize } from './heuristic';
import type { DocInput } from './extract';

// ------------------------------------------------------------------------------------------------
// public types
// ------------------------------------------------------------------------------------------------

export interface ToolCall {
  id?: string;
  name: string;
  input: unknown;
  /** Recorded runs: the call was cut off by max_tokens (it is answered with an error, never applied). */
  truncated?: boolean;
  /** Recorded runs: 0-based AI pass the call belongs to. */
  pass?: number;
}

export interface ApplyResult {
  /** Text for the tool_result block. */
  resultText: string;
  isError: boolean;
  /** SSE events to forward (facility / grounds / site / prior_award / progress / warning / ai_text). */
  events: ExtractionEvent[];
}

export interface FinalizeResult {
  inventory: Inventory;
  priorAward?: PriorAward;
  warnings: string[];
}

export type DocLike = Pick<DocInput, 'name'> & Partial<Pick<DocInput, 'role' | 'amendment' | 'container'>>;

interface DocEntry { name: string; rank: number; role: DocumentRole; amendment?: number; order: number }

interface FacMeta {
  rank: number;
  seq: number;
  file?: string;
  key?: string; // normalised building number
  campusSlug?: string;
  nameSlug: string;
  hasArea: boolean;
  areaMissing: boolean;
  /** Rank and document of the row the kept area came from. */
  areaRank: number;
  areaFile?: string;
  /**
   * How firmly the kept status was stated: 0 = not stated (status null, or in_scope on a row with no area and no reason,
   * i.e. an update row), 1 = in_scope on a row that lists the building with its area, 2 = any other status, or in_scope with a reason.
   */
  statusStrength: 0 | 1 | 2;
  statusRank: number;
  categoryExplicit: boolean;
  levelExplicit: boolean;
}

/** One registered row of a facility; the facility is re-folded from all of them, ordered by (rank, seq), on every registration. */
interface Contribution { f: Facility; meta: FacMeta }

interface TableRowInfo { sf: number; inScope: boolean; areaMissing: boolean; name: string; ref?: string }

export interface DeclaredTable {
  id: string;
  title: string;
  file?: string;
  pages?: string;
  kind: 'facilities' | 'dining' | 'grounds' | 'other';
  rowCount?: number;
  /** Printed total converted to square feet. */
  totalGrossSqft?: number;
  totalPrinted?: { value: number; unit: AreaUnit };
  pass: number;
  declared: boolean;
  rows: Map<string, TableRowInfo>;
}

interface GroundsLink { key?: string; campusSlug?: string; bn?: string }

export interface ExtractionState {
  docs: DocEntry[];
  pass: number;
  passDocs: string[];
  facilities: Map<string, Facility>;
  meta: Map<string, FacMeta>;
  /** Every row registered for a facility (merge input; the merged facility does not depend on read order). */
  contribs: Map<string, Contribution[]>;
  byKey: Map<string, Set<string>>;
  /** Buildings printed twice in one table with different areas (only one area is kept). */
  tableDupes: Map<string, { table: string; id: string; label: string; areas: [number, number] }>;
  grounds: GroundsArea[];
  groundsLinks: Map<string, GroundsLink>;
  groundsSeen: Set<string>;
  excludedGrounds: { name: string; status: string; reason?: string; quantity: number; unit: string }[];
  site: SiteInfo;
  priorAward?: PriorAward;
  tables: Map<string, DeclaredTable>;
  seq: number;
  gIdx: number;
  finishAttempts: number;
  finishes: Map<number, { summary: string; unresolved: string[]; gaps: string[] }>;
}

// ------------------------------------------------------------------------------------------------
// small helpers
// ------------------------------------------------------------------------------------------------

const CATEGORY_IDS = FACILITY_CATEGORIES as string[];
const LEVEL_IDS = SERVICE_LEVELS.map((s) => s.id) as string[];
const KIND_IDS = GROUNDS_KINDS.map((k) => k.id) as string[];
const STATUS_IDS = FACILITY_STATUSES.map((s) => s.id) as string[];
const SCOPES = ['custodial', 'floor_care', 'dining', 'grounds'] as const;
const SERVICE_STYLES = ['full_food_service', 'dining_facility_attendant', 'management_only'] as const;
const CLIMATES = ['cold', 'temperate', 'hot_humid', 'arid'] as const;

const DASHES = /[‐-―−﹘﹣－]/g;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36).slice(0, 6); };
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const joinNotes = (...parts: (string | undefined | null | false)[]) => {
  const seen = new Set<string>(); const out: string[] = [];
  for (const p of parts) for (const piece of String(p || '').split(/; | \| /)) { const t = piece.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return out.length ? out.join('; ') : undefined;
};

/** Parses a printed number: "45,200[^1]" → 45200, "2,650 SM" → 2650, "~~1,200~~" → 1200. null / "" / "TBD" → null; garbage → NaN. */
export function parseNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.replace(/\[\^[^\]]*\]|~~|[*†‡]/g, '').trim();
  if (!s || /^(n\/?a|tbd|none|unknown|-+|—|–)$/i.test(s)) return null;
  const m = s.match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}
const numOrUndef = (v: unknown) => { const n = parseNumber(v); return n == null || Number.isNaN(n) ? undefined : n; };

/** "Bldg. No. 0012" → "0012" (display form: prefix stripped, dashes unified, letters / zeros kept). */
export function cleanBuildingNumber(v: unknown): string | undefined {
  if (v == null) return undefined;
  let s = String(v).replace(DASHES, '-').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:building|bldg|bld|facility|fac)\.?(?=[\s#:\-\d]|$)\s*(?:no\.?|number|nbr\.?|#)?\s*[:#-]?\s*/i, '').replace(/^(?:no\.?|number|#)\s*/i, '').trim();
  if (!s || /^(n\/?a|none|tbd|-+)$/i.test(s)) return undefined;
  return s;
}
/**
 * Key used for identity (never shown): upper case, dashes unified, leading zeros of each digit run dropped, and a separator
 * dropped only where it sits between a letter run and a digit run ("T-0012" = "T12", "3105-B" = "3105B", "Bldg 0012" = "12").
 * A separator between two digit runs (or two letter runs) is kept as "-", so "1-10" ≠ "110", "12-3" ≠ "123", "101-A" ≠ "10-1A".
 */
export function buildingKey(bn: string): string {
  const runs = bn.toUpperCase().replace(DASHES, '-').split(/[\s.\-_/\\]+/).filter(Boolean).map((t) => t.replace(/(^|[^0-9])0+(?=\d)/g, '$1'));
  let out = '';
  for (const t of runs) {
    const sameClass = out !== '' && ((/\d$/.test(out) && /^\d/.test(t)) || (/[A-Z]$/.test(out) && /^[A-Z]/.test(t)));
    out += sameClass ? `-${t}` : t;
  }
  return out;
}
/** Id slug in the form the rule-based reader and earlier versions of this reader use (b-0012, b-t-2401), so append-mode merges by id keep matching. */
const idSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
/**
 * Facility id: the printed building number (or name) as a slug, prefixed with the campus only when one is set
 * (b-0012, b-t-2401, b-main-post--0012). Identity is decided by facilityIdentity / buildingKey, not by the id string.
 */
export const facilityKey = (bn: string | undefined, name: string, campus?: string) =>
  `b-${campus && slug(campus) ? `${slug(campus)}--` : ''}${bn ? idSlug(bn) || 'x' : idSlug(name) || 'x'}`;
/**
 * Identity of a facility across runs (campus + normalised building number, else campus + name). Two facilities with the
 * same identity are the same building even when their ids differ ("0012" read in one run, "12" in another).
 */
export const facilityIdentity = (f: Pick<Facility, 'buildingNumber' | 'name' | 'campus'>) => {
  const bn = cleanBuildingNumber(f.buildingNumber);
  return `${f.campus ? slug(f.campus) : ''}|${bn ? buildingKey(bn) : `name:${idSlug(f.name)}`}`;
};

const TOTAL_ROW = /\b(sub-?\s*totals?|grand\s+totals?)\b|^\s*totals?\s*$|^\s*totals?\b(?=\s*([-:(,]|square|sq\b|sf\b|gsf\b|gross|area|custodial|all\b|facilit|building|for\b|of\b|$))|\btotals?\s*$|^\s*sum\b/i;
/** Subtotal / total / sum rows. For grounds any name starting with "Total" is a total; facilities keep names like "Total Fitness Center". */
export const isTotalRow = (name: string, bn?: string, grounds = false) => {
  const n = name.replace(DASHES, '-');
  return (!bn || /^(sub)?totals?$/i.test(bn)) && (TOTAL_ROW.test(n) || (grounds && /^\s*(grand\s+)?totals?\b/i.test(n)));
};

function unitOf(v: unknown): AreaUnit | null | undefined {
  if (v == null || v === '') return undefined;
  const u = String(v).toLowerCase().replace(/[\s.²]/g, '');
  if (['sf', 'sqft', 'ft2', 'gsf', 'nsf', 'squarefeet', 'squarefoot'].includes(u)) return 'sf';
  if (['sm', 'sqm', 'm2', 'm', 'gsm', 'squaremeters', 'squaremetres', 'squaremeter'].includes(u)) return 'sm';
  if (['sy', 'sqyd', 'yd2', 'squareyards', 'squareyard'].includes(u)) return 'sy';
  return null;
}

function groundsUnitOf(v: unknown): { unit: GroundsUnit; convert?: 'ha' | 'sqm' } | null {
  const u = String(v ?? '').toLowerCase().replace(/[\s.²]/g, '');
  if (['acres', 'acre', 'ac'].includes(u)) return { unit: 'acres' };
  if (['hectares', 'hectare', 'ha'].includes(u)) return { unit: 'acres', convert: 'ha' };
  if (['sqft', 'sf', 'ft2', 'squarefeet'].includes(u)) return { unit: 'sqft' };
  if (['sqm', 'sm', 'm2', 'squaremeters', 'squaremetres'].includes(u)) return { unit: 'sqft', convert: 'sqm' };
  if (['sqyd', 'sy', 'yd2', 'squareyards'].includes(u)) return { unit: 'sqyd' };
  if (['lf', 'linearfeet', 'linft', 'ft'].includes(u)) return { unit: 'lf' };
  if (['each', 'ea', 'trees', 'count', 'no'].includes(u)) return { unit: 'each' };
  return null;
}

function statusOf(v: unknown): FacilityStatus | null | undefined {
  if (v == null || v === '') return undefined;
  const s = String(v).toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (STATUS_IDS.includes(s)) return s as FacilityStatus;
  if (/^(active|in|inscope|included|yes)$/.test(s)) return 'in_scope';
  if (/delet|struck|removed_by/.test(s)) return 'deleted_by_amendment';
  if (/demol|disposed/.test(s)) return 'demolished';
  if (/vacan|closed|mothball/.test(s)) return 'vacant';
  if (/option/.test(s)) return 'option_only';
  if (/exclu|not_in_scope|out_of_scope|n\/?a|info/.test(s)) return 'excluded';
  return null;
}

/** Service level from printed frequency wording ("M–F", "2x/month", "Bi-weekly", "Daily (7 days)"). */
export function parseServiceFrequency(text?: string | null): ServiceLevel | undefined {
  if (!text) return undefined;
  const t = ` ${text.toLowerCase().replace(DASHES, '-').replace(/\s+/g, ' ')} `;
  if (/\bn\/?a\b|\bnone\b|no service|not serviced|as required|on call/.test(t)) return undefined;
  if (/quarter/.test(t)) return 'quarterly';
  const perMonth = t.match(/(\d+|once|one|twice|two|three)\s*(?:x|times?)?\s*(?:\/|per|a|each|every)\s*(?:mo\b|mon\b|month)/);
  if (perMonth) { const n = ({ once: 1, one: 1, twice: 2, two: 2, three: 3 } as Record<string, number>)[perMonth[1]] ?? Number(perMonth[1]); return n >= 4 ? 'weekly' : n >= 2 ? 'biweekly' : 'monthly'; }
  if (/\bmonthly\b/.test(t)) return 'monthly';
  if (/bi-?weekly|every (?:two|2|other) weeks?|fortnight/.test(t)) return 'biweekly';
  if (/\b7 ?days?\b|seven days|\b7d\b|7 ?x ?(?:\/|per) ?w|\b365\b|sun(?:day)?\s*-\s*sat|mon(?:day)?\s*-\s*sun|\bdaily 7\b/.test(t)) return 'daily_7';
  if (/\b5 ?days?\b|five days|\b5d\b|5 ?x ?(?:\/|per) ?w|\bm\s*-\s*f\b|mon(?:day)?\s*-\s*fri|weekdays|\bdaily\b/.test(t)) return 'daily_5';
  if (/\b(?:3|three)\s*(?:x|times)|\bmwf\b|m\/w\/f/.test(t)) return '3x_week';
  if (/\b(?:2|two)\s*(?:x|times)|twice|t\/th|tu\/th|tue\/thu/.test(t)) return '2x_week';
  if (/weekly|\b(?:1|once|one)\s*(?:x|time)?\s*(?:\/|per|a)\s*w(?:ee)?k/.test(t)) return 'weekly';
  return undefined;
}

/** Grounds terminology → kind. Type I = improved, II = semi-improved, III / IV = unimproved, BASH by mowing frequency. */
export function mapGroundsLabel(label: string, frequencyText?: string | null): GroundsKind {
  const l = ` ${label.toLowerCase()} `;
  const f = (frequencyText ?? '').toLowerCase();
  const byFrequency = (): GroundsKind | undefined => {
    if (!f.trim()) return undefined;
    if (/(?:per|a|each|\/)\s*(?:year|yr|annum|season)|annual|yearly|quarter|as (?:needed|required)|1-4 times/.test(f)) return 'unimproved';
    if (/every (?:2|3|two|three|other) weeks?|bi-?weekly|(?:per|a|\/)\s*month|monthly|10-14 days|14 days|21 days/.test(f)) return 'semi_improved';
    if (/weekly|every (?:7|seven) days|per week|\/\s*wk|\/\s*week/.test(f)) return 'improved_turf';
    return undefined;
  };
  if (/athletic|ball ?field|sports? field|soccer|softball|baseball|football|parade field/.test(l)) return 'athletic_field';
  if (/shrub|planting bed|\bbeds?\b|mulch|planter|flower/.test(l)) return 'shrub_bed';
  if (/parking|\blots?\b|pavement|paved|hardstand/.test(l)) return 'parking';
  if (/sidewalk|\bwalks?\b|walkway/.test(l)) return 'sidewalk';
  if (/\btrees?\b/.test(l)) return 'tree_canopy';
  const freq = byFrequency();
  if (freq) return freq; // when label and stated mowing frequency disagree, follow the frequency
  if (/semi|type\s*(?:ii|2)\b|category\s*(?:ii|2|b)\b|class\s*(?:ii|2|b)\b|level\s*(?:ii|2)\b/.test(l)) return 'semi_improved';
  if (/unimproved|type\s*(?:iii|3|iv|4)\b|category\s*(?:iii|3|iv|4|c|d)\b|class\s*(?:iii|3|c)\b|level\s*(?:iii|3)\b|rough|natural|wooded|range|training land/.test(l)) return 'unimproved';
  if (/bash|bird.?aircraft|infield|clear.?zone|airfield|runway|taxiway/.test(l)) return 'semi_improved';
  return 'improved_turf';
}

/**
 * Meals per day from per-period headcounts. With days_per_week 7 this is mealsPerDayFromPeriods ((5 × weekday + 2 × weekend) / 7).
 * When no weekend figure is printed anywhere for a 7-day DFAC, weekends are assumed to match weekdays; when some periods
 * have weekend figures (brunch / supper), a missing weekend figure means the period is not served on weekends.
 */
export function diningMealsPerDay(periods: MealPeriodHeadcount[], daysPerWeek = 7): { mealsPerDay: number; mealPeriods: number; assumedWeekend: boolean } {
  const anyWeekend = periods.some((p) => p.weekendHeadcount != null);
  const anyWeekday = periods.some((p) => p.weekdayHeadcount != null);
  let norm = periods; let assumedWeekend = false;
  if (!anyWeekend && daysPerWeek > 5) { norm = periods.map((p) => ({ ...p, weekendHeadcount: p.weekdayHeadcount })); assumedWeekend = true; }
  else if (!anyWeekday && anyWeekend) norm = periods.map((p) => ({ ...p, weekdayHeadcount: p.weekendHeadcount }));
  let mealsPerDay: number;
  if (daysPerWeek >= 7) mealsPerDay = mealsPerDayFromPeriods(norm, 5);
  else if (daysPerWeek <= 5) mealsPerDay = mealsPerDayFromPeriods(norm, 7); // weekday-only operation: meals per operating day = weekday sum
  else {
    const wk = norm.reduce((s, p) => s + Math.max(0, p.weekdayHeadcount ?? 0), 0);
    const we = norm.reduce((s, p) => s + Math.max(0, p.weekendHeadcount ?? 0), 0);
    mealsPerDay = Math.round((5 * wk + (daysPerWeek - 5) * we) / daysPerWeek);
  }
  const weekdayPeriods = norm.filter((p) => (p.weekdayHeadcount ?? 0) > 0).length;
  const weekendPeriods = norm.filter((p) => (p.weekendHeadcount ?? 0) > 0).length;
  return { mealsPerDay, mealPeriods: weekdayPeriods || weekendPeriods || periods.length, assumedWeekend };
}

// ------------------------------------------------------------------------------------------------
// documents and precedence
// ------------------------------------------------------------------------------------------------

/** Role from a file name when the reader did not set one. */
export function inferRole(name: string): { role: DocumentRole; amendment?: number } {
  const n = name.replace(DASHES, '-');
  const am = n.match(/\bamend(?:ment)?s?\.?\s*(?:no\.?\s*|#\s*)?0*(\d{1,4})\b/i)
    ?? n.match(/\bmod(?:ification)?\.?\s*(?:no\.?\s*)?P?0*(\d{1,5})\b/i)
    ?? n.match(/(?:^|[^A-Za-z0-9])A(0\d{2,4})(?!\d)/); // A0001 / A001 (not drawing sheets like A101)
  if (am) return { role: 'amendment', amendment: Number(am[1]) };
  if (/\bamend|\bsf[-\s]?30\b/i.test(n)) return { role: 'amendment' };
  if (/q\s*&\s*a|q\s*and\s*a\b|questions?\s*(?:and|&)\s*answers?|\brfi\b|clarification/i.test(n)) return { role: 'qa' };
  if (/\bpws\b|\bsow\b|performance work statement|statement of work/i.test(n)) return { role: 'pws' };
  if (/attach|exhibit|annex|appendix|\bJ[-\s.]?\d|technical exhibit|\bTE[-\s]?\d|workload|facility list|inventory/i.test(n)) return { role: 'attachment' };
  if (/solicitation|\brfp\b|\brfq\b|\bsf[-\s]?(?:1449|33|18)\b|section\s+[a-m]\b/i.test(n)) return { role: 'solicitation' };
  return { role: 'other' };
}

const ROLE_TIER: Record<DocumentRole, number> = { solicitation: 0, pws: 0, attachment: 1, other: 1, qa: 2, amendment: 3 };
const ROLE_LABEL: Record<DocumentRole, string> = { solicitation: 'solicitation (base)', pws: 'PWS (base)', attachment: 'attachment', other: 'other', qa: 'Q&A', amendment: 'amendment' };

/** Precedence rank: base solicitation / PWS < attachments < Q&A < amendments (by number); ties by package order. */
export function docRank(doc: DocLike, order: number): number {
  const inferred = doc.role ? { role: doc.role, amendment: doc.amendment } : inferRole(doc.name);
  const amendment = doc.amendment ?? inferred.amendment;
  return ROLE_TIER[inferred.role] * 1e7 + (inferred.role === 'amendment' ? Math.min(9999, amendment ?? 0) * 1e3 : 0) + order;
}

/** Documents with their role, ordered by precedence (lowest first). */
export function precedenceList(docs: DocLike[]): { name: string; role: DocumentRole; amendment?: number; label: string; rank: number }[] {
  return docs.map((d, i) => {
    const inf = d.role ? { role: d.role, amendment: d.amendment } : inferRole(d.name);
    const amendment = d.amendment ?? inf.amendment;
    const label = inf.role === 'amendment' ? `amendment${amendment != null ? ` ${String(amendment).padStart(4, '0')}` : ''}` : ROLE_LABEL[inf.role];
    return { name: d.name, role: inf.role, amendment, label, rank: docRank(d, i) };
  }).sort((a, b) => a.rank - b.rank);
}

const normName = (s: string) => s.toLowerCase().replace(/\.(pdf|docx?|xlsx?|csv|txt|md|zip)\b/g, '').replace(/\(part \d+\/\d+\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function resolveDoc(st: ExtractionState, file?: string | null): DocEntry | undefined {
  if (file) {
    const f = file.trim();
    const exact = st.docs.find((d) => d.name === f) ?? st.docs.find((d) => d.name.toLowerCase() === f.toLowerCase());
    if (exact) return exact;
    const nf = normName(f.split(/[\\/]/).pop() ?? f);
    if (nf) {
      const same = st.docs.find((d) => normName(d.name.split(/[\\/]/).pop() ?? d.name) === nf || normName(d.name) === nf);
      if (same) return same;
      const partial = st.docs.filter((d) => { const nd = normName(d.name); return nd.length >= 3 && (nd.includes(nf) || nf.includes(nd)); });
      if (partial.length) return partial.sort((a, b) => b.name.length - a.name.length)[0];
    }
    // "Amendment 2" for "Amendment 0002.pdf", "the Q&A" for "Questions and Answers.pdf"
    const inf = inferRole(f);
    if (inf.role === 'amendment') {
      const ams = st.docs.filter((d) => d.role === 'amendment');
      const hit = inf.amendment != null ? ams.find((d) => d.amendment === inf.amendment) : ams.length === 1 ? ams[0] : undefined;
      if (hit) return hit;
    } else if (inf.role === 'qa') {
      const qa = st.docs.filter((d) => d.role === 'qa');
      if (qa.length === 1) return qa[0];
    }
  }
  const pass = st.docs.filter((d) => st.passDocs.includes(d.name));
  if (pass.length === 1) return pass[0];
  if (!file && st.docs.length === 1) return st.docs[0];
  return undefined;
}
/** Rank of a row whose file could not be resolved: the lowest rank in the current pass (it must not supersede known later documents). */
const fallbackRank = (st: ExtractionState) => { const pass = st.docs.filter((d) => st.passDocs.includes(d.name)); return pass.length ? Math.min(...pass.map((d) => d.rank)) : -1; };

// ------------------------------------------------------------------------------------------------
// state
// ------------------------------------------------------------------------------------------------

export function createState(docs: DocLike[]): ExtractionState {
  return {
    docs: docs.map((d, i) => { const inf = d.role ? { role: d.role, amendment: d.amendment } : inferRole(d.name); return { name: d.name, rank: docRank(d, i), role: inf.role, amendment: d.amendment ?? inf.amendment, order: i }; }),
    pass: 0, passDocs: docs.map((d) => d.name),
    facilities: new Map(), meta: new Map(), contribs: new Map(), byKey: new Map(), tableDupes: new Map(),
    grounds: [], groundsLinks: new Map(), groundsSeen: new Set(), excludedGrounds: [],
    site: {}, tables: new Map(), seq: 0, gIdx: 0, finishAttempts: 0, finishes: new Map(),
  };
}

/** Start an AI pass over a subset of the documents (default: all). Resets the finish gate for the pass. */
export function beginPass(st: ExtractionState, docNames?: string[]): void {
  st.pass += 1;
  st.passDocs = docNames?.length ? docNames : st.docs.map((d) => d.name);
  st.finishAttempts = 0;
}

// ------------------------------------------------------------------------------------------------
// input validation (zod) — lenient on shape, strict on meaning
// ------------------------------------------------------------------------------------------------

const looseNum = z.union([z.number(), z.string()]).nullish();
const loosePeriod = z.object({ period: z.string().nullish(), weekday_headcount: looseNum, weekend_headcount: looseNum });
const SourceIn = z.object({ file: z.string().nullish(), page: looseNum, excerpt: z.string().nullish() }).nullish();

const FacilityRowIn = z.object({
  table_id: z.string().nullish(),
  campus: z.string().nullish(),
  building_number: z.union([z.string(), z.number()]).nullish(),
  name: z.string().trim().min(1, 'name is required'),
  status: z.string().nullish(),
  status_reason: z.string().nullish(),
  category: z.string().nullish(),
  gross_area: looseNum,
  cleanable_area: looseNum,
  area_unit: z.string().nullish(),
  area_missing: z.boolean().nullish(),
  estimated_gross_area: looseNum,
  gross_sqft: looseNum, // recorded runs from the previous schema
  cleanable_sqft: looseNum,
  restroom_fixtures: looseNum,
  floors: looseNum,
  fixtures: z.object({ total: looseNum, water_closets: looseNum, urinals: looseNum, lavatories: looseNum, showers: looseNum }).partial().nullish(),
  occupancy: looseNum,
  service_level: z.string().nullish(),
  service_frequency_text: z.string().nullish(),
  scope: z.array(z.string()).nullish(),
  floor_mix: z.object({ carpet: looseNum, resilient: looseNum, hard_tile: looseNum, concrete: looseNum, wood: looseNum }).partial().nullish(),
  dining: z.object({
    seats: looseNum, meals_per_day: looseNum,
    meal_periods: z.union([z.array(loosePeriod), z.number(), z.string()]).nullish(),
    meal_period_count: looseNum, days_per_week: looseNum, kitchen_sqft: looseNum, dining_room_sqft: looseNum, service_style: z.string().nullish(),
  }).partial().nullish(),
  source: SourceIn,
  confidence: looseNum,
  notes: z.string().nullish(),
  site_hint: z.object({ x: z.number(), y: z.number() }).nullish(),
});
type FacilityRow = z.infer<typeof FacilityRowIn>;

const GroundsRowIn = z.object({
  name: z.string().trim().min(1, 'name is required'),
  campus: z.string().nullish(),
  facility_building_number: z.union([z.string(), z.number()]).nullish(),
  table_id: z.string().nullish(),
  kind: z.string().nullish(),
  document_label: z.string().nullish(),
  mowing_frequency_text: z.string().nullish(),
  status: z.string().nullish(),
  status_reason: z.string().nullish(),
  quantity: looseNum,
  unit: z.string().nullish(),
  source: SourceIn,
  confidence: looseNum,
  notes: z.string().nullish(),
});

const TableIn = z.object({
  table_id: z.string().trim().min(1).nullish(),
  title: z.string().nullish(),
  kind: z.string().nullish(),
  file: z.string().nullish(),
  pages: z.union([z.string(), z.number()]).nullish(),
  row_count: looseNum,
  printed_total_gross_area: looseNum,
  area_unit: z.string().nullish(),
  total_gross_sqft: looseNum, // recorded runs from the previous schema
});

const SiteIn = z.object({
  installation_name: z.string().nullish(), location: z.string().nullish(), solicitation: z.string().nullish(), contract_name: z.string().nullish(),
  climate_zone: z.string().nullish(), growing_season_weeks: looseNum, contract_years: looseNum, notes: z.string().nullish(),
});

const AwardIn = z.object({
  incumbent: z.string().nullish(), contract_number: z.string().nullish(), contract_type: z.string().nullish(),
  total_value: looseNum, period_months: looseNum, annual_value: looseNum, spend_to_date: looseNum, spend_period_months: looseNum, award_year: looseNum,
  source: SourceIn, confidence: looseNum, notes: z.string().nullish(),
});

const FinishIn = z.object({ summary: z.string().nullish(), unresolved: z.array(z.union([z.string(), z.number()])).nullish() });

const zIssues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
const clamp01 = (v: unknown, d: number) => { const n = numOrUndef(v); return n == null ? d : Math.max(0, Math.min(1, n > 1 && n <= 100 ? n / 100 : n)); };

// ------------------------------------------------------------------------------------------------
// facilities
// ------------------------------------------------------------------------------------------------

interface PreparedRow {
  f: Facility;
  meta: FacMeta;
  key?: string;
  tableId?: string;
  areaGiven: boolean;
  fileUnresolved?: string;
  notesForResult: string[];
}

function prepareFacility(st: ExtractionState, d: FacilityRow): { row?: PreparedRow; error?: string } {
  const bn = cleanBuildingNumber(d.building_number);
  const name = d.name.trim();
  const label = bn ?? name;
  if (isTotalRow(name, bn)) return { error: `"${name}" is a subtotal/total row - never register it; put the printed total in declare_tables.printed_total_gross_area` };
  const status = statusOf(d.status);
  if (status === null) return { error: `${label}: status "${d.status}" must be one of ${STATUS_IDS.join(', ')}` };
  const unit = unitOf(d.area_unit);
  if (unit === null) return { error: `${label}: area_unit "${d.area_unit}" must be sf, sm or sy (copy the area as printed and name its unit)` };
  const k = SQFT_PER[unit ?? 'sf'];
  const st0: FacilityStatus = status ?? 'in_scope';

  const grossRaw = d.gross_area !== undefined ? parseNumber(d.gross_area) : d.gross_sqft !== undefined ? parseNumber(d.gross_sqft) : null;
  const cleanRaw = d.cleanable_area !== undefined ? parseNumber(d.cleanable_area) : d.cleanable_sqft !== undefined ? parseNumber(d.cleanable_sqft) : null;
  if (Number.isNaN(grossRaw)) return { error: `${label}: gross_area "${String(d.gross_area ?? d.gross_sqft)}" is not a number - copy the printed number, or set gross_area null with area_missing=true` };
  if (grossRaw != null && grossRaw < 0) return { error: `${label}: gross_area must not be negative` };
  const areaGiven = grossRaw != null && grossRaw > 0;
  const areaMissing = !areaGiven && Boolean(d.area_missing);

  const doc = resolveDoc(st, d.source?.file);
  const file = doc?.name ?? str(d.source?.file);
  const rank = doc ? doc.rank : fallbackRank(st);
  const campus = str(d.campus);
  const key = bn ? buildingKey(bn) : undefined;

  let gross = areaGiven ? Math.round(grossRaw! * k) : 0;
  const notes: (string | undefined)[] = [];
  if (areaGiven && unit && unit !== 'sf') notes.push(`Area converted from ${grossRaw!.toLocaleString('en-US')} ${unit.toUpperCase()}`);
  if (areaMissing) {
    const est = numOrUndef(d.estimated_gross_area);
    if (est && est > 0) { gross = Math.round(est * k); notes.push(`Area not printed; estimated ${fmt(gross)} SF`); } else notes.push('Area not printed in the package');
  }
  const cleanable = cleanRaw != null && !Number.isNaN(cleanRaw) && cleanRaw > 0 ? Math.round(cleanRaw * k) : undefined;
  const resultNotes: string[] = [];
  if (cleanable && gross && cleanable > gross * 1.02 && areaGiven) resultNotes.push(`${label}: cleanable (${fmt(cleanable)}) exceeds gross (${fmt(gross)}) - check the columns`);

  const fx = d.fixtures;
  const parts = fx ? [fx.water_closets, fx.urinals, fx.lavatories, fx.showers].map(numOrUndef) : [];
  const fixtures = numOrUndef(fx?.total) ?? (parts.some((x) => x != null) ? parts.reduce<number>((s, x) => s + (x ?? 0), 0) : undefined) ?? numOrUndef(d.restroom_fixtures);

  const levelGiven = d.service_level ? String(d.service_level).toLowerCase().trim() : '';
  const levelFromText = parseServiceFrequency(d.service_frequency_text);
  const levelExplicit = LEVEL_IDS.includes(levelGiven) || Boolean(levelFromText);
  const serviceLevel = (LEVEL_IDS.includes(levelGiven) ? levelGiven : levelFromText ?? 'daily_5') as ServiceLevel;
  const catGiven = d.category ? String(d.category).toLowerCase().trim() : '';
  const categoryExplicit = CATEGORY_IDS.includes(catGiven);
  const category = (categoryExplicit ? catGiven : categorize(name)) as FacilityCategory;
  const scope = (d.scope ?? []).map((s) => String(s).toLowerCase()).filter((s): s is Facility['scope'][number] => (SCOPES as readonly string[]).includes(s));
  const confidence0 = clamp01(d.confidence, 0.7);

  const f: Facility = {
    id: '',
    buildingNumber: bn,
    name,
    category,
    grossSqft: gross,
    cleanableSqft: cleanable,
    floors: Math.max(0, Math.round(numOrUndef(d.floors) ?? 0)),
    restroomFixtures: fixtures != null ? Math.round(fixtures) : undefined,
    occupancy: numOrUndef(d.occupancy),
    serviceLevel,
    scope: scope.length ? [...new Set(scope)] : ['custodial', 'floor_care'],
    confidence: areaMissing ? Math.min(confidence0, 0.4) : confidence0,
    campus,
    status: st0,
    statusReason: st0 !== 'in_scope' ? str(d.status_reason) : undefined,
    originalArea: areaGiven && unit && unit !== 'sf' ? { gross: grossRaw!, cleanable: cleanRaw != null && !Number.isNaN(cleanRaw) ? cleanRaw : undefined, unit } : undefined,
    serviceFrequencyText: str(d.service_frequency_text),
    tableId: str(d.table_id),
    source: { file, page: numOrUndef(d.source?.page), excerpt: (str(d.source?.excerpt) ?? '').slice(0, 240) },
    siteHint: d.site_hint ?? undefined,
  };
  if (d.floor_mix) {
    const m = d.floor_mix;
    f.floorMix = { carpet: numOrUndef(m.carpet) ?? 0, resilient: numOrUndef(m.resilient) ?? 0, hardTile: numOrUndef(m.hard_tile) ?? 0, concrete: numOrUndef(m.concrete) ?? 0, wood: numOrUndef(m.wood) ?? 0 };
  }
  if (d.dining) {
    const dn = d.dining;
    const dpw = Math.min(7, Math.max(1, Math.round(numOrUndef(dn.days_per_week) ?? 7)));
    const periods: MealPeriodHeadcount[] = Array.isArray(dn.meal_periods)
      ? dn.meal_periods.map((p) => ({ period: str(p.period) ?? 'meal', weekdayHeadcount: numOrUndef(p.weekday_headcount), weekendHeadcount: numOrUndef(p.weekend_headcount) }))
        .filter((p) => p.weekdayHeadcount != null || p.weekendHeadcount != null)
      : [];
    const stated = numOrUndef(dn.meals_per_day);
    const periodCount = numOrUndef(dn.meal_period_count) ?? (Array.isArray(dn.meal_periods) ? undefined : numOrUndef(dn.meal_periods));
    let mealsPerDay = stated; let mealPeriods = periodCount ?? 3;
    if (periods.length) {
      const r = diningMealsPerDay(periods, dpw);
      if (stated && Math.abs(stated - r.mealsPerDay) > Math.max(2, 0.02 * r.mealsPerDay)) notes.push(`Stated ${fmt(stated)} meals/day; derived ${fmt(r.mealsPerDay)} from meal-period headcounts`);
      if (r.assumedWeekend) notes.push('No weekend headcount printed; weekends assumed equal to weekdays');
      mealsPerDay = r.mealsPerDay; mealPeriods = periodCount ?? r.mealPeriods;
    }
    const style = String(dn.service_style ?? '').toLowerCase();
    if (mealsPerDay && mealsPerDay > 0) {
      f.dining = {
        mealsPerDay: Math.round(mealsPerDay), mealPeriods: Math.max(1, Math.round(mealPeriods)), daysPerWeek: dpw,
        mealPeriodsDetail: periods.length ? periods : undefined,
        seats: numOrUndef(dn.seats), kitchenSqft: numOrUndef(dn.kitchen_sqft), diningRoomSqft: numOrUndef(dn.dining_room_sqft),
        serviceStyle: ((SERVICE_STYLES as readonly string[]).includes(style) ? style : /attendant|dfa/.test(style) ? 'dining_facility_attendant' : /manage/.test(style) ? 'management_only' : 'full_food_service') as NonNullable<Facility['dining']>['serviceStyle'],
      };
      if (!f.scope.includes('dining')) f.scope.push('dining');
    } else if (periods.length || stated === 0) resultNotes.push(`${label}: dining headcount is zero - dining profile not recorded`);
  }
  f.notes = joinNotes(...notes, str(d.notes));
  // A row without area and without area_missing is only accepted as an update of an already registered building
  // (it adds dining, frequency, fixtures …); registerFacilities enforces that.
  // "in_scope" on such an update row is the schema default, not a statement: it never brings an excluded building back.
  const statusStrength: FacMeta['statusStrength'] = status == null ? 0 : status !== 'in_scope' || str(d.status_reason) ? 2 : areaGiven || areaMissing ? 1 : 0;
  const meta: FacMeta = {
    rank, seq: ++st.seq, file, key, campusSlug: campus ? slug(campus) || undefined : undefined, nameSlug: idSlug(name) || 'x',
    hasArea: areaGiven || (areaMissing && gross > 0), areaMissing, areaRank: rank, areaFile: file,
    statusStrength, statusRank: rank, categoryExplicit, levelExplicit,
  };
  return { row: { f, meta, key, tableId: f.tableId, areaGiven, fileUnresolved: d.source?.file && !doc ? d.source.file : undefined, notesForResult: resultNotes } };
}

/** Finds the facility a numbered row belongs to. */
function lookupNumbered(st: ExtractionState, key: string, campusSlug: string | undefined, label: string): { id?: string; adopt?: boolean; error?: string } {
  const ids = [...(st.byKey.get(key) ?? [])];
  if (!ids.length) return {};
  const campusOf = (id: string) => st.meta.get(id)?.campusSlug;
  if (campusSlug) {
    const exact = ids.find((id) => campusOf(id) === campusSlug);
    if (exact) return { id: exact };
    const bare = ids.filter((id) => !campusOf(id));
    if (bare.length === 1 && ids.length === 1) return { id: bare[0], adopt: true };
    return {};
  }
  const bare = ids.filter((id) => !campusOf(id));
  if (bare.length) return { id: bare[0] };
  if (ids.length === 1) return { id: ids[0] };
  const campuses = ids.map((id) => st.facilities.get(id)?.campus).filter(Boolean).join(', ');
  return { error: `${label}: building number exists on ${ids.length} campuses (${campuses}) - set campus` };
}

function newId(st: ExtractionState, base: string): string {
  if (!st.facilities.has(base)) return base;
  for (let i = 2; ; i++) if (!st.facilities.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Same building seen twice: each field group comes from the higher-ranked (later) document that actually supplied it
 * (area: a printed area beats an estimate, whatever the rank; status: only a stated status counts, see FacMeta.statusStrength;
 * category / frequency: only when given). Same rank → the later call wins. Callers fold contributions in (rank, seq) order,
 * so the result does not depend on the order the documents were read in.
 */
function mergeRows(old: Facility, om: FacMeta, row: Facility, rm: FacMeta): { f: Facility; meta: FacMeta } {
  const rowWins = rm.rank >= om.rank;
  const [hi, hm, lo, lm] = rowWins ? [row, rm, old, om] as const : [old, om, row, rm] as const;
  const printed = (m: FacMeta) => m.hasArea && !m.areaMissing; // a printed area beats an estimate, whatever the rank
  const areaFrom = printed(hm) ? 'hi' : printed(lm) ? 'lo' : hm.hasArea ? 'hi' : lm.hasArea ? 'lo' : 'hi';
  const A = areaFrom === 'hi' ? hi : lo; const B = areaFrom === 'hi' ? lo : hi;
  const Am = areaFrom === 'hi' ? hm : lm;
  const statusFromHi = hm.statusStrength > 0 && (hm.statusRank > lm.statusRank || hm.statusStrength >= lm.statusStrength);
  const S = statusFromHi || lm.statusStrength === 0 ? hm : lm;
  const status = statusFromHi || lm.statusStrength === 0 ? hi.status : lo.status;
  const statusReason = status === 'in_scope' ? undefined : (status === hi.status ? hi.statusReason : lo.statusReason) ?? hi.statusReason ?? lo.statusReason;
  const bnPick = [old.buildingNumber, row.buildingNumber].filter((x): x is string => Boolean(x)).sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
  const dining = hi.dining && lo.dining ? { ...lo.dining, ...Object.fromEntries(Object.entries(hi.dining).filter(([, v]) => v !== undefined)) } as Facility['dining'] : hi.dining ?? lo.dining;
  const notes: (string | undefined)[] = [lo.notes, hi.notes];
  // only when the higher-ranked row supplied the area that is kept
  if (areaFrom === 'hi' && printed(hm) && printed(lm) && hi.grossSqft !== lo.grossSqft && lo.grossSqft > 0) {
    if (hm.areaRank > lm.areaRank) notes.push(`Superseded ${fmt(lo.grossSqft)} SF from ${lm.areaFile ?? 'an earlier document'}`);
    else notes.push(`Re-registered: ${fmt(lo.grossSqft)} SF replaced`);
  }
  if (areaFrom === 'hi' && printed(hm) && printed(lm) && hi.cleanableSqft && lo.cleanableSqft && hi.cleanableSqft !== lo.cleanableSqft && hm.areaRank > lm.areaRank) notes.push(`Superseded ${fmt(lo.cleanableSqft)} cleanable SF from ${lm.areaFile ?? 'an earlier document'}`);
  const f: Facility = {
    ...lo, ...hi,
    id: old.id,
    buildingNumber: bnPick,
    name: hi.name || lo.name,
    campus: hi.campus ?? lo.campus,
    category: hm.categoryExplicit ? hi.category : lm.categoryExplicit ? lo.category : hi.category,
    serviceLevel: hm.levelExplicit ? hi.serviceLevel : lm.levelExplicit ? lo.serviceLevel : hi.serviceLevel,
    serviceFrequencyText: hm.levelExplicit ? hi.serviceFrequencyText ?? lo.serviceFrequencyText : lo.serviceFrequencyText ?? hi.serviceFrequencyText,
    grossSqft: A.grossSqft,
    cleanableSqft: A.cleanableSqft ?? B.cleanableSqft,
    originalArea: A.originalArea,
    floors: hi.floors || lo.floors,
    restroomFixtures: hi.restroomFixtures ?? lo.restroomFixtures,
    occupancy: hi.occupancy ?? lo.occupancy,
    floorMix: hi.floorMix ?? lo.floorMix,
    footprint: hi.footprint ?? lo.footprint,
    siteHint: hi.siteHint ?? lo.siteHint,
    dining,
    scope: [...new Set([...lo.scope, ...hi.scope])],
    status,
    statusReason,
    tableId: hi.tableId ?? lo.tableId,
    source: hi.source?.excerpt || !lo.source ? hi.source : lo.source,
    confidence: A.confidence,
    notes: joinNotes(...notes),
  };
  for (const k of Object.keys(f) as (keyof Facility)[]) if (f[k] === undefined) delete f[k];
  const meta: FacMeta = {
    ...om,
    rank: Math.max(om.rank, rm.rank), seq: Math.max(om.seq, rm.seq), file: hm.file ?? lm.file,
    campusSlug: om.campusSlug ?? rm.campusSlug,
    hasArea: om.hasArea || rm.hasArea, areaMissing: !printed(om) && !printed(rm) && (om.areaMissing || rm.areaMissing),
    areaRank: Am.areaRank, areaFile: Am.areaFile,
    statusStrength: S.statusStrength, statusRank: S.statusRank,
    categoryExplicit: om.categoryExplicit || rm.categoryExplicit, levelExplicit: om.levelExplicit || rm.levelExplicit,
  };
  return { f, meta };
}

/** Merges every row registered for one facility, lowest (rank, seq) first. */
function foldContributions(list: Contribution[]): Contribution {
  const sorted = [...list].sort((a, b) => a.meta.rank - b.meta.rank || a.meta.seq - b.meta.seq);
  let acc: Contribution = { f: { ...sorted[0].f }, meta: { ...sorted[0].meta } };
  for (const k of Object.keys(acc.f) as (keyof Facility)[]) if (acc.f[k] === undefined) delete acc.f[k];
  for (const c of sorted.slice(1)) acc = mergeRows(acc.f, acc.meta, c.f, c.meta);
  return acc;
}

/** Merge two facilities outside a run (append mode): b is treated as the newer registration and its listed status wins. */
export function mergeFacilities(a: Facility, b: Facility): Facility {
  const m = (f: Facility, seq: number): FacMeta => ({
    rank: 0, seq, file: f.source?.file, nameSlug: idSlug(f.name), hasArea: f.grossSqft > 0, areaMissing: false, areaRank: 0, areaFile: f.source?.file,
    statusStrength: f.status && f.status !== 'in_scope' ? 2 : f.grossSqft > 0 ? 1 : 0, statusRank: seq, categoryExplicit: true, levelExplicit: true,
  });
  return mergeRows(a, m(a, 0), b, m(b, 1)).f;
}

/** Printed-row reference of a row (page + excerpt), '' when the row has no excerpt. */
const rowRefOf = (src?: { page?: number | null; excerpt?: string | null } | null) => {
  const ex = (src?.excerpt ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ex ? fnv(`${src?.page ?? ''}|${ex}`) : '';
};

function tableFor(st: ExtractionState, id: string): DeclaredTable {
  let t = st.tables.get(id);
  if (!t) { t = { id, title: id, kind: 'facilities', pass: st.pass, declared: false, rows: new Map() }; st.tables.set(id, t); }
  return t;
}

const facilityTables = (st: ExtractionState) => [...st.tables.values()].filter((t) => t.kind !== 'grounds');
function progressEvent(st: ExtractionState): ExtractionEvent {
  const expected = facilityTables(st).filter((t) => t.kind === 'facilities' && t.rowCount != null).reduce((s, t) => s + (t.rowCount ?? 0), 0);
  return { type: 'progress', registered: st.facilities.size, expected: expected || undefined, grounds: st.grounds.length };
}

function registerFacilities(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const events: ExtractionEvent[] = [];
  const rows = Array.isArray(input.facilities) ? input.facilities : [];
  if (!rows.length) return { resultText: 'No facilities in the call - pass them in "facilities": [...].', isError: true, events };
  const ok: string[] = []; const bad: string[] = []; const info: string[] = []; const unresolvedFiles = new Set<string>(); const undeclared = new Set<string>();
  let outOfScope = 0; let updates = 0;
  const seenThisCall = new Set<string>();
  rows.forEach((raw, i) => {
    const p = FacilityRowIn.safeParse(raw);
    if (!p.success) { bad.push(`row ${i + 1}: ${zIssues(p.error)}`); return; }
    const prep = prepareFacility(st, p.data);
    if (prep.error || !prep.row) { bad.push(prep.error ?? `row ${i + 1}: invalid`); return; }
    const { f, meta, key } = prep.row;
    const label = f.buildingNumber ?? f.name;
    if (prep.row.fileUnresolved) unresolvedFiles.add(prep.row.fileUnresolved);
    info.push(...prep.row.notesForResult);

    // identity
    let id: string | undefined; let adopt = false;
    if (key) {
      const r = lookupNumbered(st, key, meta.campusSlug, label);
      if (r.error) { bad.push(r.error); return; }
      id = r.id; adopt = Boolean(r.adopt);
    } else {
      const excerpt = f.source?.excerpt ?? '';
      const scope = f.tableId ? `--${slug(f.tableId)}` : '';
      const rowRef = excerpt ? `-${fnv(`${f.source?.page ?? ''}|${excerpt}`)}` : '';
      const base = `b-${meta.campusSlug ? `${meta.campusSlug}--` : ''}${meta.nameSlug}${scope}${rowRef}`;
      if (!scope && !rowRef) {
        const same = [...st.meta.entries()].filter(([, m]) => !m.key && m.nameSlug === meta.nameSlug && m.campusSlug === meta.campusSlug).map(([k]) => k);
        id = same.length === 1 ? same[0] : st.facilities.has(base) ? base : undefined;
      } else id = st.facilities.has(base) && !seenThisCall.has(base) ? base : undefined;
      if (!id) { id = newId(st, base); }
      seenThisCall.add(id);
    }
    const exists = Boolean(id && st.facilities.has(id));
    const counts = f.status === 'in_scope' || f.status === 'option_only';
    if (!prep.row.areaGiven && !meta.areaMissing && counts && !exists) {
      bad.push(`${label}: gross_area missing - copy it from the row (in its printed unit, with area_unit), or set gross_area null and area_missing=true with your estimate in estimated_gross_area and the basis in notes`);
      return;
    }
    let merged: Facility; let mm: FacMeta;
    if (exists) {
      const list = st.contribs.get(id!) ?? [{ f: st.facilities.get(id!)!, meta: st.meta.get(id!)! }];
      if (adopt) for (const c of list) { c.meta.campusSlug = meta.campusSlug; c.f.campus = f.campus; }
      list.push({ f: { ...f, id: id! }, meta });
      st.contribs.set(id!, list);
      // re-fold every row of this building in (rank, seq) order: the result does not depend on read order
      ({ f: merged, meta: mm } = foldContributions(list));
      if (!prep.row.areaGiven && !meta.areaMissing) updates++;
    } else {
      id = id ?? newId(st, facilityKey(f.buildingNumber, f.name, f.campus));
      merged = { ...f, id };
      for (const k of Object.keys(merged) as (keyof Facility)[]) if (merged[k] === undefined) delete merged[k];
      mm = meta;
      st.contribs.set(id, [{ f: { ...f, id }, meta }]);
    }
    st.facilities.set(id!, merged); st.meta.set(id!, mm);
    if (key) { const set = st.byKey.get(key) ?? new Set<string>(); set.add(id!); st.byKey.set(key, set); }
    if (f.tableId) {
      if (!st.tables.get(f.tableId)?.declared) undeclared.add(f.tableId);
      const t = tableFor(st, f.tableId);
      const ref = rowRefOf(f.source);
      // A table row is counted once per building; a re-sent row (same printed row or same area) updates it. A second,
      // different printed row of the same building with a different area counts as its own table row, so the gate does
      // not ask for rows that were registered - but only the later area is kept, which is reported.
      let rowKey = id!;
      const prev = t.rows.get(id!);
      if (prev && prep.row.areaGiven && !prev.areaMissing && ref && prev.ref && prev.ref !== ref && Math.abs(prev.sf - f.grossSqft) > 1) {
        rowKey = `${id}#${ref}`;
        if (!t.rows.has(rowKey)) info.push(`${label} is listed twice in ${f.tableId} with different areas (${fmt(prev.sf)} and ${fmt(f.grossSqft)} SF); only one area is kept for the building (${fmt(merged.grossSqft)} SF) - if the rows are separate buildings or wings, say so in finish.unresolved`);
        st.tableDupes.set(`${f.tableId}|${id}|${ref}`, { table: f.tableId, id: id!, label, areas: [prev.sf, f.grossSqft] });
      }
      t.rows.set(rowKey, { sf: prep.row.areaGiven ? f.grossSqft : prev?.sf ?? merged.grossSqft, inScope: merged.status === 'in_scope' || !merged.status, areaMissing: !prep.row.areaGiven && (prev?.areaMissing ?? true), name: label, ref: rowKey === id ? prev?.ref ?? ref : ref });
    }
    if (merged.status && merged.status !== 'in_scope') outOfScope++;
    events.push({ type: 'facility', facility: merged });
    ok.push(id!);
  });
  events.push(progressEvent(st));
  const tableProgress = [...new Set(rows.map((r) => (r && typeof r === 'object' ? str((r as Record<string, unknown>).table_id) : undefined)).filter((x): x is string => Boolean(x)))]
    .map((tid) => { const t = st.tables.get(tid); return t ? `${tid}: ${t.rows.size}${t.rowCount != null ? ` of ${t.rowCount}` : ''} rows` : ''; }).filter(Boolean);
  const text = [
    `Registered ${ok.length} of ${rows.length} rows (${st.facilities.size} facilities in total${outOfScope ? `; ${outOfScope} in this call recorded as out of scope` : ''}${updates ? `; ${updates} updates of already-registered buildings` : ''}).`,
    tableProgress.length ? `Progress: ${tableProgress.join('; ')}.` : '',
    bad.length ? `Rejected ${bad.length}: ${bad.slice(0, 8).join(' | ')}${bad.length > 8 ? ` | … ${bad.length - 8} more` : ''}. Fix and resend only the rejected rows.` : '',
    undeclared.size ? `Table(s) ${[...undeclared].join(', ')} were not declared - call declare_tables with their row counts and printed totals.` : '',
    unresolvedFiles.size ? `source.file ${[...unresolvedFiles].map((f) => `"${f}"`).join(', ')} is not one of the package documents (${st.docs.map((d) => d.name).join(', ')}); use the document name exactly.` : '',
    info.length ? `Check: ${info.slice(0, 4).join(' | ')}.` : '',
  ].filter(Boolean).join(' ');
  return { resultText: text, isError: ok.length === 0, events };
}

// ------------------------------------------------------------------------------------------------
// grounds
// ------------------------------------------------------------------------------------------------

const SPLIT_NOTE = /\b(split|shared|divided|apportion|prorat)/i;

function registerGrounds(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const events: ExtractionEvent[] = [];
  const rows = Array.isArray(input.areas) ? input.areas : [];
  if (!rows.length) return { resultText: 'No areas in the call - pass them in "areas": [...].', isError: true, events };
  let n = 0; let dup = 0; let out = 0; const bad: string[] = [];
  rows.forEach((raw, i) => {
    const p = GroundsRowIn.safeParse(raw);
    if (!p.success) { bad.push(`area ${i + 1}: ${zIssues(p.error)}`); return; }
    const d = p.data; const name = d.name.trim();
    if (isTotalRow(name, undefined, true)) { bad.push(`"${name}" is a total row - never register totals`); return; }
    const qty = parseNumber(d.quantity);
    if (qty == null || Number.isNaN(qty) || qty < 0) { bad.push(`${name}: quantity "${String(d.quantity)}" is not a number`); return; }
    const u = groundsUnitOf(d.unit);
    if (!u) { bad.push(`${name}: unit "${String(d.unit)}" must be acres, hectares, sqft, sqm, sqyd, lf or each`); return; }
    const status = statusOf(d.status);
    if (status === null) { bad.push(`${name}: status "${d.status}" must be one of ${STATUS_IDS.join(', ')}`); return; }
    const kindIn = String(d.kind ?? '').toLowerCase().trim();
    const kind = (KIND_IDS.includes(kindIn) ? kindIn : mapGroundsLabel(`${d.kind ?? ''} ${d.document_label ?? ''} ${name}`, d.mowing_frequency_text)) as GroundsKind;
    const quantity = u.convert === 'ha' ? qty * ACRES_PER_HECTARE : u.convert === 'sqm' ? qty * SQFT_PER_SQM : qty;
    const printedUnit = u.convert === 'ha' ? 'ha' : u.convert === 'sqm' ? 'm²' : '';
    const doc = resolveDoc(st, d.source?.file);
    const bn = cleanBuildingNumber(d.facility_building_number);
    const campus = str(d.campus);
    const dedupe = [name, kind, quantity.toFixed(4), u.unit, bn ? buildingKey(bn) : '', campus ?? '', str(d.source?.excerpt) ?? ''].join('|').toLowerCase();
    if (st.groundsSeen.has(dedupe)) { dup++; return; }
    st.groundsSeen.add(dedupe);
    // Table rows are counted per printed row: areas split from one printed row (same excerpt, "split" / "shared" in notes,
    // as SYSTEM step 8 asks) count once; out-of-scope rows count too (they are rows of the printed table).
    const ref = rowRefOf({ page: numOrUndef(d.source?.page), excerpt: d.source?.excerpt });
    const split = Boolean(ref) && SPLIT_NOTE.test(d.notes ?? '');
    const tableRow = (fallbackKey: string, inScope: boolean) => {
      if (d.table_id) tableFor(st, d.table_id).rows.set(split ? `split:${ref}` : fallbackKey, { sf: 0, inScope, areaMissing: false, name, ref });
    };
    if (status && status !== 'in_scope' && status !== 'option_only') {
      st.excludedGrounds.push({ name, status, reason: str(d.status_reason), quantity: qty, unit: String(d.unit) }); out++;
      tableRow(`out-${st.excludedGrounds.length}`, false);
      return;
    }
    st.gIdx++;
    const g: GroundsArea = {
      id: `g-${st.gIdx}-${slug(name) || kind}`,
      name, kind,
      quantity: Math.round(quantity * 1000) / 1000,
      unit: u.unit,
      campus,
      documentLabel: str(d.document_label),
      confidence: clamp01(d.confidence, 0.7),
      notes: joinNotes(printedUnit ? `Converted from ${qty.toLocaleString('en-US')} ${printedUnit}` : '', status === 'option_only' ? 'Option item only' : '', d.mowing_frequency_text ? `Mowing as printed: ${d.mowing_frequency_text}` : '', str(d.notes)),
      source: { file: doc?.name ?? str(d.source?.file), page: numOrUndef(d.source?.page), excerpt: (str(d.source?.excerpt) ?? '').slice(0, 240) },
    };
    for (const k of Object.keys(g) as (keyof GroundsArea)[]) if (g[k] === undefined) delete g[k];
    st.grounds.push(g);
    st.groundsLinks.set(g.id, { key: bn ? buildingKey(bn) : undefined, campusSlug: campus ? slug(campus) : undefined, bn });
    tableRow(g.id, true);
    events.push({ type: 'grounds', area: g });
    n++;
  });
  events.push(progressEvent(st));
  const text = `Registered ${n} grounds areas (${st.grounds.length} in total)${dup ? `; ${dup} duplicates of already-registered areas skipped` : ''}${out ? `; ${out} out-of-scope areas recorded` : ''}.${bad.length ? ` Rejected ${bad.length}: ${bad.slice(0, 6).join(' | ')}.` : ''}`;
  return { resultText: text, isError: n === 0 && dup === 0 && out === 0, events };
}

// ------------------------------------------------------------------------------------------------
// tables and completeness
// ------------------------------------------------------------------------------------------------

function declareTables(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const list = Array.isArray(input.tables) ? input.tables : [];
  if (!list.length) return { resultText: 'No tables in the call - pass them in "tables": [...].', isError: true, events: [] };
  const done: string[] = []; const bad: string[] = [];
  list.forEach((raw, i) => {
    const p = TableIn.safeParse(raw);
    if (!p.success) { bad.push(`table ${i + 1}: ${zIssues(p.error)}`); return; }
    const d = p.data;
    const id = str(d.table_id) ?? str(d.title) ?? `T${st.tables.size + 1}`;
    const unit = unitOf(d.area_unit);
    if (unit === null) { bad.push(`${id}: area_unit "${d.area_unit}" must be sf, sm or sy`); return; }
    const printed = d.printed_total_gross_area !== undefined ? numOrUndef(d.printed_total_gross_area) : undefined;
    const legacy = numOrUndef(d.total_gross_sqft);
    const kindIn = String(d.kind ?? '').toLowerCase();
    const kind: DeclaredTable['kind'] = /ground|landscap|turf|acre/.test(kindIn) ? 'grounds' : /dining|food|meal|headcount/.test(kindIn) ? 'dining' : /other|info|price|schedule/.test(kindIn) ? 'other' : 'facilities';
    const t = tableFor(st, id);
    t.title = str(d.title) ?? t.title; t.kind = kind; t.file = resolveDoc(st, d.file)?.name ?? str(d.file) ?? t.file;
    t.pages = d.pages != null ? String(d.pages) : t.pages;
    const rc = numOrUndef(d.row_count); t.rowCount = rc != null ? Math.round(rc) : t.rowCount;
    if (printed != null) { t.totalPrinted = { value: printed, unit: unit ?? 'sf' }; t.totalGrossSqft = Math.round(printed * SQFT_PER[unit ?? 'sf']); }
    else if (legacy != null) { t.totalPrinted = { value: legacy, unit: 'sf' }; t.totalGrossSqft = Math.round(legacy); }
    t.pass = st.pass; t.declared = true;
    done.push(`${id}${t.rowCount != null ? ` (${t.rowCount} rows${t.totalGrossSqft ? `, ${fmt(t.totalGrossSqft)} SF` : ''})` : ''}`);
  });
  const events: ExtractionEvent[] = done.length ? [progressEvent(st)] : [];
  return {
    resultText: `${done.length ? `Declared ${done.join(', ')}. Tag every row with its table_id; finish is checked against these counts and totals.` : 'No tables declared.'}${bad.length ? ` Rejected: ${bad.join(' | ')}` : ''}`,
    isError: done.length === 0, events,
  };
}

export interface TableGap { table: string; title: string; message: string }

/** Tables whose registered rows or SF do not reconcile with the declared row count / printed total. */
export function completeness(st: ExtractionState, onlyPass?: number): TableGap[] {
  const out: TableGap[] = [];
  for (const t of st.tables.values()) {
    if (!t.declared || (onlyPass != null && t.pass !== onlyPass)) continue;
    const rows = [...t.rows.values()];
    const outCount = rows.filter((r) => !r.inScope).length;
    const label = t.title && t.title !== t.id ? `${t.id} (${t.title})` : t.id;
    if (t.rowCount != null) {
      if (rows.length < t.rowCount) out.push({ table: t.id, title: t.title, message: `${label}: ${rows.length} of ${t.rowCount} rows registered${outCount ? ` (${outCount} out of scope)` : ''}` });
      else if (rows.length > t.rowCount) {
        const doubled = [...t.rows.entries()].filter(([k]) => k.includes('#')).map(([, r]) => r.name);
        const why = doubled.length ? `; ${doubled.join(', ')} counted twice (registered from two rows with different areas - if one was a correction, say so in finish.unresolved)` : '';
        out.push({ table: t.id, title: t.title, message: `${label}: ${rows.length} rows registered but the table was declared with ${t.rowCount}${why} - re-declare it if row_count was wrong; never register subtotal or total rows` });
      }
    }
    if (t.totalGrossSqft && t.kind !== 'grounds') {
      const inSf = rows.filter((r) => r.inScope && !r.areaMissing).reduce((s, r) => s + r.sf, 0);
      const exSf = rows.filter((r) => !r.inScope && !r.areaMissing).reduce((s, r) => s + r.sf, 0);
      const tol = Math.max(5, t.totalGrossSqft * 0.005, rows.length);
      const near = (x: number) => Math.abs(x - t.totalGrossSqft!) <= tol;
      if (!near(inSf) && !near(inSf + exSf)) {
        const printed = t.totalPrinted && t.totalPrinted.unit !== 'sf' ? ` (${fmt(t.totalPrinted.value)} ${t.totalPrinted.unit.toUpperCase()})` : '';
        out.push({ table: t.id, title: t.title, message: `${label}: registered ${fmt(inSf)} SF${exSf ? ` (+${fmt(exSf)} SF out of scope)` : ''} vs printed total ${fmt(t.totalGrossSqft)} SF${printed}` });
      }
    }
  }
  return out;
}

const mentions = (texts: string[], g: TableGap) => texts.some((u) => { const l = u.toLowerCase(); return l.includes(g.table.toLowerCase()) || (g.title.length > 3 && l.includes(g.title.toLowerCase())); });

export const noFinishWarning = (pass: number) => `AI pass ${pass} ended without calling finish - the inventory may be incomplete.`;

function finish(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const events: ExtractionEvent[] = [];
  const p = FinishIn.safeParse(input);
  const summary = p.success ? str(p.data.summary) ?? '' : '';
  const unresolved = p.success ? (p.data.unresolved ?? []).map(String).filter((s) => s.trim()) : [];
  st.finishAttempts++;
  const gaps = completeness(st, st.pass);
  const unexplained = gaps.filter((g) => !mentions(unresolved, g));
  if (unexplained.length && st.finishAttempts <= 2) {
    return {
      resultText: `Not finished - these declared tables do not reconcile: ${unexplained.map((g) => g.message).join(' | ')}. Register the missing rows (or correct them), or call finish again naming each table_id in unresolved with the reason the printed figures differ.`,
      isError: true, events,
    };
  }
  st.finishes.set(st.pass, { summary, unresolved, gaps: gaps.map((g) => g.message) });
  if (unexplained.length) events.push({ type: 'warning', message: `Finish accepted after ${st.finishAttempts - 1} refusals with unreconciled tables: ${unexplained.map((g) => g.message).join(' | ')}` });
  const explained = gaps.filter((g) => !unexplained.includes(g));
  if (explained.length) events.push({ type: 'warning', message: `Tables that do not reconcile (explained by the model): ${explained.map((g) => g.message).join(' | ')}` });
  events.push({ type: 'ai_text', text: `Finished: ${summary}${unresolved.length ? `\nUnresolved: ${unresolved.join('; ')}` : ''}`, kind: 'text' });
  const inScope = [...st.facilities.values()].filter((f) => !f.status || f.status === 'in_scope').length;
  return { resultText: `Acknowledged: ${inScope} in-scope facilities, ${st.facilities.size - inScope} out of scope, ${st.grounds.length} grounds areas.`, isError: false, events };
}

// ------------------------------------------------------------------------------------------------
// site / previous award
// ------------------------------------------------------------------------------------------------

function setSite(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const p = SiteIn.safeParse(input);
  if (!p.success) return { resultText: `Invalid site info: ${zIssues(p.error)}`, isError: true, events: [] };
  const s = p.data; const climate = String(s.climate_zone ?? '').toLowerCase();
  const years = numOrUndef(s.contract_years); const weeks = numOrUndef(s.growing_season_weeks);
  st.site = {
    ...st.site,
    installationName: str(s.installation_name) ?? st.site.installationName,
    location: str(s.location) ?? st.site.location,
    solicitation: str(s.solicitation) ?? st.site.solicitation,
    contractName: str(s.contract_name) ?? st.site.contractName,
    climateZone: ((CLIMATES as readonly string[]).includes(climate) ? climate : st.site.climateZone) as SiteInfo['climateZone'],
    growingSeasonWeeks: weeks != null ? Math.round(weeks) : st.site.growingSeasonWeeks,
    contractYears: years != null ? years : st.site.contractYears,
    notes: str(s.notes) ?? st.site.notes,
  };
  for (const k of Object.keys(st.site) as (keyof SiteInfo)[]) if (st.site[k] === undefined) delete st.site[k];
  return { resultText: 'Site info recorded.', isError: false, events: [{ type: 'site', site: st.site }] };
}

function setAward(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const p = AwardIn.safeParse(input);
  if (!p.success) return { resultText: `Invalid previous award: ${zIssues(p.error)}`, isError: true, events: [] };
  const a = p.data;
  const doc = resolveDoc(st, a.source?.file);
  const next: PriorAward = {
    incumbent: str(a.incumbent), contractNumber: str(a.contract_number), contractType: str(a.contract_type),
    totalValue: numOrUndef(a.total_value), periodMonths: numOrUndef(a.period_months), annualValue: numOrUndef(a.annual_value),
    spendToDate: numOrUndef(a.spend_to_date), spendPeriodMonths: numOrUndef(a.spend_period_months), awardYear: numOrUndef(a.award_year),
    source: { file: doc?.name ?? str(a.source?.file), page: numOrUndef(a.source?.page), excerpt: (str(a.source?.excerpt) ?? '').slice(0, 240) },
    confidence: clamp01(a.confidence, 0.5), notes: str(a.notes),
  };
  const hasValue = Boolean(next.totalValue || next.annualValue || next.spendToDate);
  const defined = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as PriorAward;
  st.priorAward = st.priorAward && !hasValue
    ? { ...defined, ...st.priorAward, notes: joinNotes(st.priorAward.notes, next.notes) }
    : { ...(st.priorAward ?? {}), ...defined };
  const pa = st.priorAward;
  const annual = pa.annualValue ?? (pa.totalValue && pa.periodMonths ? (pa.totalValue / pa.periodMonths) * 12 : pa.spendToDate && pa.spendPeriodMonths ? (pa.spendToDate / pa.spendPeriodMonths) * 12 : undefined);
  return { resultText: hasValue ? `Previous award recorded${annual ? ` (≈ $${fmt(annual)}/yr)` : ''}.` : 'Noted: no award value stated.', isError: false, events: [{ type: 'prior_award', award: pa }] };
}

// ------------------------------------------------------------------------------------------------
// entry points
// ------------------------------------------------------------------------------------------------

export function applyToolCall(st: ExtractionState, call: { name: string; input: unknown }, opts: { truncated?: boolean } = {}): ApplyResult {
  if (st.pass === 0) beginPass(st);
  if (opts.truncated) {
    return {
      resultText: 'This tool call was cut off by the output limit and was NOT applied. Resend it in smaller batches (at most 25 rows per call).',
      isError: true,
      events: [{ type: 'warning', message: `A ${call.name} call was cut off by the output limit and not applied; the model was asked to resend it in smaller batches.` }],
    };
  }
  const input = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<string, unknown>;
  try {
    switch (call.name) {
      case 'declare_tables': return declareTables(st, input);
      case 'register_facilities': return registerFacilities(st, input);
      case 'register_grounds': return registerGrounds(st, input);
      case 'set_site_info': return setSite(st, input);
      case 'set_previous_award': return setAward(st, input);
      case 'finish': return finish(st, input);
      default: return { resultText: `Unknown tool ${call.name}`, isError: true, events: [] };
    }
  } catch (err) {
    return { resultText: `Tool failed: ${(err as Error).message}`, isError: true, events: [] };
  }
}

export function finalize(st: ExtractionState): FinalizeResult {
  const warnings: string[] = [];
  // link grounds to buildings at the end, so registration order does not matter
  const grounds = st.grounds.map((g) => {
    const link = st.groundsLinks.get(g.id);
    if (!link?.key) return { ...g };
    const r = lookupNumbered(st, link.key, link.campusSlug, link.bn ?? link.key);
    let id = r.id;
    if (!id && link.campusSlug) { const ids = [...(st.byKey.get(link.key) ?? [])]; if (ids.length === 1) id = ids[0]; }
    if (!id) warnings.push(`Grounds "${g.name}" names building ${link.bn}${r.error ? ' on an ambiguous campus' : ', which is not in the inventory'}; kept as a site-wide area.`);
    return id ? { ...g, facilityId: id } : { ...g };
  });
  for (const g of completeness(st)) warnings.push(`Completeness: ${g.message}`);
  for (const d of st.tableDupes.values()) {
    const kept = st.facilities.get(d.id)?.grossSqft ?? 0;
    warnings.push(`${d.label} is listed twice in ${d.table} with different areas (${fmt(d.areas[0])} and ${fmt(d.areas[1])} SF); the inventory keeps one building of ${fmt(kept)} SF - check whether the rows are separate buildings.`);
  }
  for (let p = 1; p <= st.pass; p++) if (!st.finishes.has(p)) warnings.push(noFinishWarning(p));
  const facilities = [...st.facilities.values()];
  if (facilities.length && ![...st.tables.values()].some((t) => t.declared)) warnings.push('No workload tables were declared, so the facility list could not be checked against printed row counts or totals.');
  const missing = facilities.filter((f) => (!f.status || f.status === 'in_scope') && st.meta.get(f.id)?.areaMissing);
  if (missing.length) warnings.push(`${missing.length} in-scope facilities have no printed area (${missing.slice(0, 8).map((f) => f.buildingNumber ?? f.name).join(', ')}${missing.length > 8 ? ', …' : ''}); their SF is an estimate or 0 - check them.`);
  const unresolved = [...st.finishes.values()].flatMap((f) => f.unresolved);
  const site: SiteInfo = { ...st.site };
  const notes = [
    st.site.notes,
    unresolved.length ? `Unresolved: ${unresolved.join('; ')}` : '',
    st.excludedGrounds.length ? `Out-of-scope grounds: ${st.excludedGrounds.map((e) => `${e.name} ${e.quantity} ${e.unit} (${e.status}${e.reason ? `: ${e.reason}` : ''})`).join('; ')}` : '',
  ].filter(Boolean).join('\n');
  if (notes) site.notes = notes;
  return { inventory: { site, facilities: facilities.map((f) => ({ ...f })), grounds }, priorAward: st.priorAward ? { ...st.priorAward } : undefined, warnings };
}

/** Replays recorded tool calls ({name, input}[]) through the same code path as the live loop. */
export function replayToolCalls(calls: ToolCall[], docs: DocLike[], emit?: (e: ExtractionEvent) => void, opts: { passes?: string[][] } = {}): FinalizeResult & { results: { name: string; resultText: string; isError: boolean }[] } {
  const st = createState(docs);
  const results: { name: string; resultText: string; isError: boolean }[] = [];
  let pass: number | undefined;
  for (const c of calls) {
    if (c.pass != null && c.pass !== pass) { pass = c.pass; beginPass(st, opts.passes?.[c.pass]); }
    const r = applyToolCall(st, c, { truncated: c.truncated });
    for (const e of r.events) emit?.(e);
    results.push({ name: c.name, resultText: r.resultText, isError: r.isError });
  }
  const fin = finalize(st);
  for (const w of fin.warnings) emit?.({ type: 'warning', message: w });
  return { ...fin, results };
}

/** Compact "bn|campus|sf|status" lines of everything registered so far (for later AI passes). */
export function registeredSummary(st: ExtractionState): string {
  return [...st.facilities.values()].map((f) => [f.buildingNumber ?? `"${f.name.slice(0, 40)}"`, f.campus ?? '', f.grossSqft, f.status && f.status !== 'in_scope' ? f.status : ''].join('|').replace(/\|+$/, '')).join('\n');
}
/** Compact "name|kind|quantity unit|building" lines of the grounds registered so far (for continuation requests). */
export function groundsSummary(st: ExtractionState): string {
  return [
    ...st.grounds.map((g) => [`"${g.name.slice(0, 40)}"`, g.kind, `${g.quantity} ${g.unit}`, st.groundsLinks.get(g.id)?.bn ?? ''].join('|').replace(/\|+$/, '')),
    ...st.excludedGrounds.map((e) => [`"${e.name.slice(0, 40)}"`, e.status, `${e.quantity} ${e.unit}`].join('|')),
  ].join('\n');
}
export function tablesSummary(st: ExtractionState): string {
  return [...st.tables.values()].filter((t) => t.declared).map((t) => `${t.id}${t.title !== t.id ? ` "${t.title}"` : ''}${t.file ? ` in ${t.file}` : ''}: ${t.rows.size}${t.rowCount != null ? ` of ${t.rowCount}` : ''} rows registered`).join('\n');
}

// ------------------------------------------------------------------------------------------------
// tool definitions (JSON schema mirrors the zod validation above)
// ------------------------------------------------------------------------------------------------

type Schema = Record<string, unknown>;
const nullable = (type: string | string[], description?: string, extra: Schema = {}): Schema => ({ type: [...(Array.isArray(type) ? type : [type]), 'null'], ...(description ? { description } : {}), ...extra });
const obj = (properties: Record<string, Schema>, required: string[] = Object.keys(properties), description?: string): Schema => ({ type: 'object', ...(description ? { description } : {}), properties, required, additionalProperties: false });
const sourceSchema = obj({
  file: nullable('string', 'Document name exactly as listed in the package.'),
  page: nullable('integer', 'Page number ("--- page N ---" in text documents).'),
  excerpt: { type: 'string', description: 'The row or sentence the numbers came from (≤ 200 chars).' },
}, ['file', 'page', 'excerpt']);
const STATUS_KINDS = 'excluded (not in scope, N/A, information only, no service); deleted_by_amendment (struck through or deleted by an amendment / Q&A); demolished (demolished or scheduled for demolition, disposed); vacant (vacant, closed); option_only (only in an option period / optional CLIN)';
const STATUS_DESC = `in_scope (default); ${STATUS_KINDS}.`;
const FACILITY_STATUS_DESC = `Scope status as the document states it. null when the row says nothing about scope: a new building is then in scope, and a row that only updates an already-registered building (frequency, fixtures, dining, a revised area) leaves its status unchanged. ${STATUS_KINDS}; in_scope only when a document explicitly puts the building in scope or back in scope (give status_reason).`;

/**
 * Tool definitions for the extraction loop. strict: true is set where the API's strict-schema budget allows it
 * (at most 16 union-typed parameters across all strict tools): declare_tables, set_site_info and finish.
 * register_facilities / register_grounds / set_previous_award carry too many nullable fields for strict mode,
 * so they keep additionalProperties: false and are validated with zod in applyToolCall.
 */
export function extractionTools(opts: { strict?: boolean } = {}): Anthropic.Beta.BetaTool[] {
  const strict = opts.strict ?? true;
  const s = (t: Anthropic.Beta.BetaTool): Anthropic.Beta.BetaTool => (strict ? { ...t, strict: true } : t);
  const facility = obj({
    table_id: nullable('string', 'table_id from declare_tables for the table this row came from.'),
    campus: nullable('string', 'Installation, campus or site, when the package covers more than one. Same number on two campuses = two buildings.'),
    building_number: nullable('string', 'Exactly as printed, including letters, hyphens and leading zeros (0012, T-2401, 3105-B, P-114). Null if the row has no number.'),
    name: { type: 'string', description: 'Facility name as printed.' },
    status: nullable('string', FACILITY_STATUS_DESC, { enum: [...STATUS_IDS, null] }),
    status_reason: nullable('string', 'Why the row is (not) in scope, quoting the document (e.g. "DEMO FY27 – EXCLUDE", "Deleted by Amendment 0002").'),
    category: nullable('string', 'Best-fit category.', { enum: [...CATEGORY_IDS, null] }),
    gross_area: nullable('number', 'Gross area exactly as printed, in area_unit (never converted). Null only when the row prints no area (then set area_missing) or the row only adds data to a building already registered.'),
    cleanable_area: nullable('number', 'Cleanable / serviced / custodial area as printed, in area_unit.'),
    area_unit: { type: 'string', enum: ['sf', 'sm', 'sy'], description: 'Unit the areas are printed in: sf (square feet), sm (square meters), sy (square yards). The tool converts.' },
    area_missing: nullable('boolean', 'true when the document prints no area for this building.'),
    estimated_gross_area: nullable('number', 'Only with area_missing: your estimate in area_unit; give the basis in notes.'),
    floors: nullable('integer', 'Number of stories.'),
    fixtures: nullable('object', 'Restroom fixtures. When WC / UR / LAV / shower are separate columns fill them separately; the tool sums them.', {
      properties: { total: nullable('integer'), water_closets: nullable('integer'), urinals: nullable('integer'), lavatories: nullable('integer'), showers: nullable('integer') },
      required: ['total', 'water_closets', 'urinals', 'lavatories', 'showers'], additionalProperties: false,
    }),
    occupancy: nullable('integer'),
    service_level: nullable('string', 'Routine cleaning frequency. Bi-weekly = every two weeks (biweekly) unless the document defines it as twice a week.', { enum: [...LEVEL_IDS, null] }),
    service_frequency_text: nullable('string', 'The frequency exactly as printed (e.g. "M–F", "Daily (7 days)", "2x/month").'),
    scope: { type: 'array', items: { type: 'string', enum: [...SCOPES] }, description: 'Services that apply to this facility.' },
    floor_mix: nullable('object', 'Fractions of floor area by finish if the RFP gives them (sum ≈ 1).', {
      properties: { carpet: { type: 'number' }, resilient: { type: 'number' }, hard_tile: { type: 'number' }, concrete: { type: 'number' }, wood: { type: 'number' } },
      required: ['carpet', 'resilient', 'hard_tile', 'concrete', 'wood'], additionalProperties: false,
    }),
    dining: nullable('object', 'Dining facility workload. Register each dining facility separately with its own headcount.', {
      properties: {
        meal_periods: nullable('array', 'Per meal period as printed: weekday = Monday–Friday average headcount per day, weekend = weekend / holiday average per day (null when the period is not served then). The tool computes meals per day.', {
          items: obj({ period: { type: 'string' }, weekday_headcount: nullable('number'), weekend_headcount: nullable('number') }),
        }),
        meals_per_day: nullable('number', 'Only when the document states a single daily total and no per-period figures.'),
        meal_period_count: nullable('integer', 'Meal periods served per weekday, when stated without headcounts.'),
        days_per_week: nullable('integer'),
        seats: nullable('integer'),
        kitchen_sqft: nullable('number'),
        dining_room_sqft: nullable('number'),
        service_style: { type: 'string', enum: [...SERVICE_STYLES] },
      },
      required: ['meal_periods', 'meals_per_day', 'meal_period_count', 'days_per_week', 'seats', 'kitchen_sqft', 'dining_room_sqft', 'service_style'], additionalProperties: false,
    }),
    source: sourceSchema,
    confidence: { type: 'number', description: '0–1 confidence that name and area are correct.' },
    notes: nullable('string'),
  }, ['table_id', 'campus', 'building_number', 'name', 'status', 'status_reason', 'gross_area', 'cleanable_area', 'area_unit', 'area_missing', 'floors', 'service_level', 'service_frequency_text', 'scope', 'source', 'confidence']);

  const area = obj({
    name: { type: 'string' },
    campus: nullable('string'),
    facility_building_number: nullable('string', 'Building number this area belongs to, if the document ties it to one.'),
    table_id: nullable('string'),
    kind: { type: 'string', enum: KIND_IDS, description: 'Type I = improved_turf; Type II = semi_improved; Type III / IV = unimproved; BASH, airfield infield and clear zones are semi_improved or unimproved per the mowing frequency.' },
    document_label: nullable('string', 'The document\'s own label ("Type II", "Category B", "BASH area").'),
    mowing_frequency_text: nullable('string', 'Mowing / service frequency as printed.'),
    status: { type: 'string', enum: STATUS_IDS, description: STATUS_DESC },
    status_reason: nullable('string'),
    quantity: { type: 'number', description: 'As printed, in unit.' },
    unit: { type: 'string', enum: ['acres', 'hectares', 'sqft', 'sqm', 'sqyd', 'lf', 'each'], description: 'Unit as printed; the tool converts hectares and sqm.' },
    source: sourceSchema,
    confidence: { type: 'number' },
    notes: nullable('string'),
  }, ['name', 'campus', 'facility_building_number', 'kind', 'document_label', 'status', 'quantity', 'unit', 'source', 'confidence']);

  return [
    s({
      name: 'declare_tables',
      description: 'Declare the workload tables you found (facility lists, custodial workload, dining workload, grounds) before registering their rows. finish is checked against the row counts and printed totals declared here. Call again to correct a declaration.',
      input_schema: {
        type: 'object',
        properties: {
          tables: {
            type: 'array',
            items: obj({
              table_id: { type: 'string', description: 'Short id, e.g. "TE-3", "J-4", "TE 5-1".' },
              title: { type: 'string' },
              kind: { type: 'string', enum: ['facilities', 'dining', 'grounds', 'other'] },
              file: nullable('string', 'Document name exactly as listed.'),
              pages: nullable('string', 'Page range, e.g. "12-19".'),
              row_count: nullable('integer', 'Number of building (or area) rows, excluding header, subtotal and total rows.'),
              printed_total_gross_area: nullable('number', 'The printed total / grand total of the gross area column, as printed (in area_unit).'),
              area_unit: { type: 'string', enum: ['sf', 'sm', 'sy'] },
            }),
          },
        },
        required: ['tables'],
        additionalProperties: false,
      },
    }),
    {
      name: 'register_facilities',
      description: 'Register facilities (buildings) in table order, in batches of up to 50 rows per call. Keep each call short enough to finish well within the output limit; if a call is reported as cut off, resend exactly those rows in smaller batches. Register every row, including excluded / deleted / demolished / vacant rows with their status. Never register subtotal or total rows. A building seen again (other table, amendment, Q&A) is merged by building number + campus.',
      input_schema: { type: 'object', properties: { facilities: { type: 'array', items: facility } }, required: ['facilities'], additionalProperties: false },
    },
    {
      name: 'register_grounds',
      description: 'Register grounds maintenance areas (turf acreage by type, athletic fields, beds, parking, walks, trees) as printed. Never register total rows.',
      input_schema: { type: 'object', properties: { areas: { type: 'array', items: area } }, required: ['areas'], additionalProperties: false },
    },
    s({
      name: 'set_site_info',
      description: 'Record installation-level facts: name, location, solicitation, climate, growing season, contract period.',
      input_schema: obj({
        installation_name: nullable('string'),
        location: nullable('string'),
        solicitation: nullable('string'),
        contract_name: nullable('string'),
        climate_zone: nullable('string', undefined, { enum: [...CLIMATES, null] }),
        growing_season_weeks: nullable('integer'),
        contract_years: nullable('number', 'Total years including base and all option periods.'),
        notes: nullable('string'),
      }) as Anthropic.Beta.BetaTool['input_schema'],
    }),
    {
      name: 'set_previous_award',
      description: 'Record what the package says about the incumbent / previous contract and its value or spend.',
      input_schema: obj({
        incumbent: nullable('string'),
        contract_number: nullable('string'),
        contract_type: nullable('string', 'FFP, IDIQ, cost-plus, etc.'),
        total_value: nullable('number', 'Total award / ceiling value in dollars.'),
        period_months: nullable('integer', 'Months of performance that total_value covers (base + options).'),
        annual_value: nullable('number', 'Annual value in dollars if stated directly.'),
        spend_to_date: nullable('number', 'Obligated / invoiced dollars to date.'),
        spend_period_months: nullable('integer', 'Months covered by spend_to_date.'),
        award_year: nullable('integer'),
        source: sourceSchema,
        confidence: { type: 'number' },
        notes: nullable('string'),
      }, ['source', 'confidence']) as Anthropic.Beta.BetaTool['input_schema'],
    },
    s({
      name: 'finish',
      description: 'Call once every facility and grounds area has been registered. Refused while declared tables do not reconcile, unless unresolved names the table_id and explains the difference.',
      input_schema: obj({ summary: { type: 'string' }, unresolved: { type: 'array', items: { type: 'string' } } }) as Anthropic.Beta.BetaTool['input_schema'],
    }),
  ];
}
