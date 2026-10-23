// Tool-call handling for the Claude reader, as pure functions over an explicit state, so the live loop in
// server/ai.ts and recorded replays (tests, `npm run eval -- --provider replay`) share exactly one code path:
//
//   const st = createState(docs)
//   beginPass(st, passDocNames)                       // optional; replays without passes use every document
//   const r = applyToolCall(st, { name, input }, { truncated })   // r.resultText / r.isError go back as the tool_result
//   const { inventory, priorAward, warnings } = finalize(st)
//
// What the code does instead of the model:
//  * facility identity: campus + normalised building number ("Bldg 0012" == "Site 12" == "12" == "0012", "T-2401" ==
//    "T2401", but "1-10" != "110"; 0012 on two campuses = two buildings) + line item: a building one table prints on
//    several separately priced rows (one per cleaning level, wing, schedule) is one inventory line per row (line_item,
//    or a second printed row of the same table under another name and with another area); ids keep the printed form
//    (b-0012, b-main-post--0012, b-0012--level-2); unnumbered buildings get table/row-scoped ids
//  * unit conversion (SM × 10.7639, SY × 9 → SF; ha × 2.4710538 → acres; m² → ft²), with the printed area kept; printed
//    SF keep their decimals; floor finishes printed in SF become the floor mix; a seasonal service window becomes days
//  * merge precedence by document rank (base < attachments < Q&A < amendment N), field group by field group (gross,
//    cleanable, status, category, frequency), never by confidence: every row of a building is kept and re-folded in
//    (rank, seq) order, so read order does not matter; a status only counts when stated (an update row's default
//    in_scope never brings an excluded building back); a later cleanable-only correction wins over the base cleanable
//  * status rows (excluded / deleted / demolished / vacant / option-only) kept visible but out of the estimate
//  * rows without area rejected (unless area_missing), except rows that only add data to a numbered building: those are
//    held until the building is registered; subtotal / total rows rejected, cut-off calls not applied
//  * areas listed outside the area column (portables, modulars, annexes: "4 @ 960 SF") summed into the gross; the
//    printed column figure is kept for the table total; cleanable larger than gross rejected
//  * completeness: declared workload tables are reconciled (rows, printed total SF, grounds totals per unit and kind)
//    before finish is accepted; table rows are counted per printed row (out-of-scope rows included, several areas
//    registered from one printed row counted once, a revision row from outside the table's pages / file not counted);
//    a gap only counts as explained once finish has shown it and unresolved names it
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
  /** The kept cleanable area was printed (cleanable_area, or cleanable_equals_gross on a printed gross), not estimated. */
  cleanPrinted: boolean;
  /** Rank and document of the row the kept cleanable area came from. */
  cleanRank: number;
  cleanFile?: string;
  /** Line item (normalised, and as printed): one of several separately priced rows of the same building. */
  line?: string;
  lineLabel?: string;
  /**
   * How firmly the kept status was stated: 0 = not stated (status null, or in_scope on a row with no area and no reason,
   * i.e. an update row), 1 = in_scope on a row that lists the building with its area, 2 = any other status, or in_scope with a reason.
   */
  statusStrength: 0 | 1 | 2;
  statusRank: number;
  categoryExplicit: boolean;
  levelExplicit: boolean;
  /** Service days the document adds on top of the routine frequency (e.g. weekend drill service); added after the fold. */
  extraDays?: { days: number; label?: string };
}

/** One registered row of a facility; the facility is re-folded from all of them, ordered by (rank, seq), on every registration. */
interface Contribution { f: Facility; meta: FacMeta }

/** One printed row of a declared table. sf is the area as printed (converted to SF, without added areas). */
interface TableRowInfo {
  sf: number; inScope: boolean; areaMissing: boolean; name: string; ref?: string;
  /** Out of scope as option-only (an optional site or CLIN, which a base total often leaves out). */
  option?: boolean;
  /** Grounds: the site the row belongs to (see groundsStem). */
  stem?: string;
  /** From outside the table's declared document / pages (an amendment or Q&A row tagged with the table's id). */
  outside?: boolean;
}

/**
 * The table's printed rows: a grounds row from outside the table that revises a site the table lists (same stem) is
 * not one of them. Decided here, not at registration, so the count does not depend on the order rows were read in.
 */
function printedRows(t: { rows: Map<string, TableRowInfo> }): TableRowInfo[] {
  const rows = [...t.rows.values()];
  const insideStems = new Set(rows.filter((r) => !r.outside && r.stem).map((r) => r.stem));
  return rows.filter((r) => !(r.outside && r.stem && insideStems.has(r.stem)));
}

/** Grounds quantities are reconciled in canonical units: acres (acres, hectares), sqft (sqft, sqm, sqyd), lf, each. */
type CanonUnit = 'acres' | 'sqft' | 'lf' | 'each';

/** A printed total other than the gross area column (grounds totals by unit, optionally for some grounds kinds only). */
export interface PrintedTotal { value: number; unit: GroundsUnit; kinds: GroundsKind[]; canon: { unit: CanonUnit; qty: number } }

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
  /** Grounds totals as printed (acres, hectares, sqft, sqm, sqyd, lf, each). */
  totals?: PrintedTotal[];
  pass: number;
  declared: boolean;
  rows: Map<string, TableRowInfo>;
}

interface GroundsLink { key?: string; campusSlug?: string; bn?: string }

/** Identity and provenance of a registered grounds area (revisions are matched on campus + site + kind + canonical unit). */
interface GroundsMeta {
  rank: number; file?: string; page?: number;
  /** table_id the row was tagged with, and whether it is a printed row of that table (not from outside its document / pages). */
  table?: string; inTable: boolean;
  campusSlug?: string; key?: string;
  /** The site (groundsStem of the name, without the building number), the whole name normalised, and the words after the site. */
  site: string; nameKey: string; desc: string[];
  kind: GroundsKind; canonUnit: CanonUnit;
  /** Where the row is printed, for messages ("RFP.pdf p. 11"). */
  where: string;
  /** Rank and page of the row the current quantity / status comes from (the area's own row, or its latest revision). */
  qtyRank: number; qtyPage?: number;
  /** Set once a later row revised the area. */
  revisedBy?: string;
}

/** A printed grounds quantity of a table, reconciled against the table's printed totals with the area's current status. */
interface GroundsPrinted { id: string; table: string; kind: GroundsKind; canon: { unit: CanonUnit; qty: number }; counted: boolean }

/** A grounds row outside the estimate: out of scope by status, or a length (lf), which is never an area. */
export interface OtherGrounds {
  id: string; name: string; status: FacilityStatus; reason?: string; quantity: number; unit: string; table?: string; kind: GroundsKind;
  canon: { unit: CanonUnit; qty: number };
  /** The area as it would be estimated (kept so a later row can bring it back in scope). */
  area?: GroundsArea;
}

export interface ExtractionState {
  docs: DocEntry[];
  pass: number;
  passDocs: string[];
  facilities: Map<string, Facility>;
  meta: Map<string, FacMeta>;
  /** Every row registered for a facility (merge input; the merged facility does not depend on read order). */
  contribs: Map<string, Contribution[]>;
  byKey: Map<string, Set<string>>;
  grounds: GroundsArea[];
  groundsLinks: Map<string, GroundsLink>;
  /** Registered grounds rows (name, kind, quantity, unit, building, campus, printed row) → the area they registered or revised. */
  groundsSeen: Map<string, { id: string; revision: boolean }>;
  groundsMeta: Map<string, GroundsMeta>;
  /** Current status of every grounds area, out-of-scope row and length, by id. */
  groundsStatus: Map<string, FacilityStatus>;
  /** Printed quantities of declared tables (reconciliation keeps the figures as printed when a later row revises an area). */
  groundsPrinted: GroundsPrinted[];
  excludedGrounds: OtherGrounds[];
  /** Lengths (lf: edging, curbs, fences): recorded and reconciled, never estimated as an area. */
  lengths: OtherGrounds[];
  /** Snow plowing / walk-clearing events per season as stated (set_site_info); kept in the site notes. */
  snowEvents?: { lots?: number; walks?: number };
  /** Rows that only add data to a numbered building that is not registered yet; applied when it is. */
  pending: PendingRow[];
  site: SiteInfo;
  priorAward?: PriorAward;
  tables: Map<string, DeclaredTable>;
  seq: number;
  gIdx: number;
  /** Counter for grounds rows registered out of scope (ids apart from the in-scope areas'). */
  gxIdx: number;
  finishAttempts: number;
  /** Gap messages a refused finish has shown the model; only a shown gap can be explained in unresolved. */
  shownGaps: Set<string>;
  finishes: Map<number, { summary: string; unresolved: string[]; gaps: string[] }>;
}

interface PendingRow { row: PreparedRow; key: string; label: string; pass: number }

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

/**
 * "Bldg. No. 0012" → "0012", "Site 4" → "4" (display form: prefix stripped, dashes unified, letters / zeros kept). "Site",
 * "Location" and "Loc" are prefixes only before a number; "No" only as a word ("No. 12", "No 12"), so "NOSC 1",
 * "NORTH 12" and "NOLF-3" keep their letters.
 */
export function cleanBuildingNumber(v: unknown): string | undefined {
  if (v == null) return undefined;
  let s = String(v).replace(DASHES, '-').replace(/\s+/g, ' ').trim();
  const no = String.raw`(?:no\.?(?![a-z])|number(?![a-z])|nbr\.?(?![a-z])|#)`;
  s = s.replace(new RegExp(String.raw`^(?:building|bldg|bld|facility|fac)\.?(?=[\s#:\-\d]|$)\s*${no}?\s*[:#-]?\s*`, 'i'), '')
    .replace(new RegExp(String.raw`^(?:site|location|loc)\.?\s*${no}?\s*[:#-]?\s*(?=\d)`, 'i'), '')
    .replace(/^(?:no\.(?=\s*\d)|no(?=\s+\d)|number(?=\s*[:#]?\s*\d)|#)\s*[:#]?\s*/i, '').trim();
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
/** Normalised line item ("Level 1 – North Wing" = "level 1 north wing"). */
const lineKey = (s?: string) => (s ? s.toLowerCase().replace(DASHES, '-').replace(/[^a-z0-9]+/g, ' ').trim() || undefined : undefined);
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

/** Unit of a printed total, as printed (hectares and sqm kept). */
function printedUnitOf(v: unknown): GroundsUnit | null {
  const u = groundsUnitOf(v);
  if (!u) return null;
  return u.convert === 'ha' ? 'hectares' : u.convert === 'sqm' ? 'sqm' : u.unit;
}

/** Same conversions as registerGrounds (ha → acres, m² → ft²), plus SY → ft² so all square measures compare. */
function canonGrounds(qty: number, unit: GroundsUnit): { unit: CanonUnit; qty: number } {
  switch (unit) {
    case 'acres': return { unit: 'acres', qty };
    case 'hectares': return { unit: 'acres', qty: qty * ACRES_PER_HECTARE };
    case 'sqft': return { unit: 'sqft', qty };
    case 'sqm': return { unit: 'sqft', qty: qty * SQFT_PER_SQM };
    case 'sqyd': return { unit: 'sqft', qty: qty * 9 };
    case 'lf': return { unit: 'lf', qty };
    default: return { unit: 'each', qty };
  }
}
const UNIT_LABEL: Record<GroundsUnit, string> = { acres: 'acres', hectares: 'ha', sqft: 'SF', sqm: 'm²', sqyd: 'SY', lf: 'LF', each: 'each' };
const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Page ranges of a declared table ("6-7", "12–19, 21", "pp. 3, 5"); undefined when the text is not a plain page list. */
function pageRanges(pages?: string): [number, number][] | undefined {
  if (!pages) return undefined;
  const s = pages.replace(DASHES, '-').replace(/\bpp?\.?\s*/gi, '').trim();
  if (!/^\d+(?:\s*-\s*\d+)?(?:\s*[,;&]\s*\d+(?:\s*-\s*\d+)?)*$/.test(s)) return undefined;
  return s.split(/\s*[,;&]\s*/).map((r) => { const [a, b] = r.split(/\s*-\s*/).map(Number); return [a, b ?? a] as [number, number]; });
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
  if (/\b6 ?days?\b|six days|\b6d\b|6 ?x ?(?:\/|per) ?w|\bm\s*-\s*sa(?:t)?\b|mon(?:day)?\s*-\s*sat/.test(t)) return 'daily_6';
  if (/\b5 ?days?\b|five days|\b5d\b|5 ?x ?(?:\/|per) ?w|\bm\s*-\s*f\b|mon(?:day)?\s*-\s*fri|weekdays|\bdaily\b/.test(t)) return 'daily_5';
  if (/\b(?:3|three)\s*(?:x|times)|\bmwf\b|m\/w\/f/.test(t)) return '3x_week';
  if (/\b(?:2|two)\s*(?:x|times)|twice|t\/th|tu\/th|tue\/thu/.test(t)) return '2x_week';
  if (/weekly|\b(?:1|once|one)\s*(?:x|time)?\s*(?:\/|per|a)\s*w(?:ee)?k/.test(t)) return 'weekly';
  return undefined;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Floating holidays at their typical date (the middle of the week they move within), fixed ones at their date. */
const HOLIDAYS: [RegExp, number, number][] = [
  [/memorial\s+day/, 5, 28], [/labou?r\s+day/, 9, 4], [/independence\s+day|fourth\s+of\s+july/, 7, 4], [/columbus\s+day|indigenous\s+peoples/, 10, 11],
  [/veterans\s+day/, 11, 11], [/thanksgiving/, 11, 25], [/christmas/, 12, 25], [/new\s+year/, 1, 1],
];
const dayOfYear = (m: number, d: number) => MONTH_DAYS.slice(0, m - 1).reduce((a, b) => a + b, 0) + Math.min(d, MONTH_DAYS[m - 1]);

/**
 * A season boundary as printed ("May 29", "29 May", "5/29", "APR", "Memorial Day") → day of the year (1–365). A month
 * without a day is its first day as a start and its last day as an end.
 */
export function seasonDay(v: unknown, end: boolean): number | undefined {
  const s = String(v ?? '').toLowerCase().replace(DASHES, '-').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  for (const [re, m, d] of HOLIDAYS) if (re.test(s)) return dayOfYear(m, d);
  const iso = s.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/);
  const md = iso ?? s.match(/^(\d{1,2}) ?[/.-] ?(\d{1,2})(?: ?[/.-] ?\d{2,4})?$/);
  if (md) { const m = Number(md[1]); const d = Number(md[2]); return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? dayOfYear(m, d) : undefined; }
  const mi = MONTHS.findIndex((m) => new RegExp(`\\b${m}`).test(s));
  if (mi < 0) return undefined;
  const day = s.replace(/\b\d{4}\b/g, '').match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  const d = day ? Number(day[1]) : end ? MONTH_DAYS[mi] : 1;
  return d >= 1 && d <= 31 ? dayOfYear(mi + 1, d) : undefined;
}

/**
 * Service days in a season printed as a window ("May 1 – Oct 15", "Memorial Day through Labor Day", "APR-OCT"): the
 * calendar days from start through end (inclusive; across the year end when the end comes first) × days per week / 7.
 */
export function seasonServiceDays(start: unknown, end: unknown, daysPerWeek: number): { days: number; calendarDays: number } | undefined {
  let a: unknown = start; let b: unknown = end;
  if ((b == null || b === '') && typeof a === 'string') {
    // the whole window printed in one field
    const parts = a.replace(DASHES, '-').split(/\s+(?:-|to|through|thru|until)\s+|\s*-\s*(?=[a-z])|(?<=[a-z])\s*-\s*/i);
    if (parts.length === 2) [a, b] = parts;
  }
  const from = seasonDay(a, false); const to = seasonDay(b, true);
  if (from == null || to == null || !(daysPerWeek > 0)) return undefined;
  const calendarDays = to >= from ? to - from + 1 : 365 - from + 1 + to;
  return { calendarDays, days: Math.max(1, Math.round((calendarDays * Math.min(7, daysPerWeek)) / 7)) };
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
    facilities: new Map(), meta: new Map(), contribs: new Map(), byKey: new Map(),
    grounds: [], groundsLinks: new Map(), groundsSeen: new Map(), groundsMeta: new Map(), groundsStatus: new Map(), groundsPrinted: [], excludedGrounds: [], lengths: [], pending: [],
    site: {}, tables: new Map(), seq: 0, gIdx: 0, gxIdx: 0, finishAttempts: 0, shownGaps: new Set(), finishes: new Map(),
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
  cleanable_equals_gross: z.boolean().nullish(),
  added_areas: z.array(z.object({ label: z.string().nullish(), count: looseNum, unit_area: looseNum })).nullish(),
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
  service_days_per_year: z.coerce.number().nullish(),
  service_frequency_text: z.string().nullish(),
  scope: z.array(z.string()).nullish(),
  floor_mix: z.object({ carpet: looseNum, resilient: looseNum, hard_tile: looseNum, concrete: looseNum, wood: looseNum }).partial().nullish(),
  floor_areas: z.union([
    z.array(z.object({ finish: z.string().nullish(), area: looseNum, included_in: z.string().nullish() })),
    z.object({ carpet: looseNum, resilient: looseNum, hard_tile: looseNum, concrete: looseNum, wood: looseNum, other: looseNum }).partial(), // earlier schema
  ]).nullish(),
  line_item: z.union([z.string(), z.number()]).nullish(),
  service_season: z.object({ start: z.union([z.string(), z.number()]).nullish(), end: z.union([z.string(), z.number()]).nullish(), days_per_week: looseNum }).partial().nullish(),
  events_per_year: looseNum,
  additional_service_days: z.object({ days_per_year: looseNum, label: z.string().nullish() }).partial().nullish(),
  cleaning_detail: z.object({ restroom_rooms: looseNum, cleaning_standard: z.string().nullish(), area_by_class: z.array(z.object({ label: z.string().nullish(), area: looseNum })).nullish() }).partial().nullish(),
  // the same fields flat (lenient input)
  restroom_rooms: looseNum,
  area_by_class: z.array(z.object({ label: z.string().nullish(), area: looseNum })).nullish(),
  cleaning_standard: z.string().nullish(),
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
  printed_totals: z.array(z.object({ value: looseNum, unit: z.string().nullish(), kinds: z.array(z.string()).nullish(), kind: z.string().nullish() })).nullish(),
  total_gross_sqft: looseNum, // recorded runs from the previous schema
});

const SiteIn = z.object({
  installation_name: z.string().nullish(), location: z.string().nullish(), solicitation: z.string().nullish(), contract_name: z.string().nullish(),
  climate_zone: z.string().nullish(), growing_season_weeks: looseNum, contract_years: looseNum, notes: z.string().nullish(),
  snow_events_per_year: looseNum, walk_clearing_events_per_year: looseNum,
});
const SNOW_NOTE = 'Snow and ice events per season as stated';

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
  /** The area as printed in the row's area column, in SF (added areas not included); 0 when none. */
  printedSqft: number;
  /** cleanable_equals_gross on a row that gives no area: resolved against the registered building. */
  cleanableEqualsGross: boolean;
  fileUnresolved?: string;
  notesForResult: string[];
  /** line_item as printed. */
  lineLabel?: string;
}

/** Shown once per result when rows are rejected because cleanable exceeds gross. */
const CLEANABLE_HINT = 'cleanable is part of gross. If the larger figure includes separately listed structures (portables, annexes), it is the gross area: give the building area in gross_area and the structures in added_areas. If the columns are swapped, swap them.';
const cleanableError = (label: string, cleanable: number, gross: number) => `${label}: cleanable_area (${fmt(cleanable)} SF) exceeds the gross area (${fmt(gross)} SF)`;

/** added_areas: [{label, count, unit_area}] → parts in the printed unit, or an error. */
function addedAreasOf(v: FacilityRow['added_areas']): { parts: { label: string; count: number; unitArea: number }[]; error?: string } {
  const parts: { label: string; count: number; unitArea: number }[] = [];
  for (const a of v ?? []) {
    const unitArea = parseNumber(a.unit_area);
    const count = a.count == null || a.count === '' ? 1 : parseNumber(a.count);
    const label = str(a.label) ?? 'added area';
    if (unitArea == null && (count == null || count === 0)) continue;
    if (unitArea == null || Number.isNaN(unitArea) || unitArea <= 0) return { parts, error: `added_areas "${label}": unit_area "${String(a.unit_area)}" must be the printed area of one unit` };
    if (count == null || Number.isNaN(count) || count < 0) return { parts, error: `added_areas "${label}": count "${String(a.count)}" must be the number of units printed` };
    if (count > 0) parts.push({ label, count, unitArea });
  }
  return { parts };
}

type FinishClass = 'carpet' | 'resilient' | 'hardTile' | 'concrete' | 'wood';
const FINISH_LABEL: Record<FinishClass, string> = { carpet: 'carpet', resilient: 'resilient', hardTile: 'hard tile', concrete: 'concrete', wood: 'wood' };

/**
 * Finish class of a printed floor finish (name or legend code): carpet, carpet tile, CPT → carpet; VCT, LVT, sheet vinyl,
 * rubber, linoleum, and a "hard floor" figure that mixes finishes → resilient; wood and gym floors → wood; ceramic, quarry,
 * terrazzo, stone and restroom floor area → hard tile; sealed, polished or exposed concrete and epoxy → concrete.
 * undefined when the finish is not one the tool knows.
 */
export function finishClass(label: string): FinishClass | undefined {
  const l = ` ${label.toLowerCase().replace(DASHES, '-').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const code = (...codes: string[]) => codes.some((c) => l.includes(` ${c} `));
  if (/carpet|broadloom|\brugs?\b/.test(l) || code('cpt', 'crpt')) return 'carpet';
  if (/vinyl|linoleum|\blino\b|rubber|resilient|composition|asphalt tile|hard ?floor|hard ?surface/.test(l) || code('vct', 'vat', 'vt', 'lvt', 'lvp', 'sv', 'shv', 'rb', 'rbr')) return 'resilient';
  if (/wood|maple|parquet|bamboo|gym(?:nasium)? floor|sports? floor/.test(l) || code('wd', 'hdwd')) return 'wood';
  if (/ceramic|quarry|terrazzo|stone|marble|granite|porcelain|slate|\btiles?\b|restroom|toilet|latrine/.test(l) || code('ct', 'qt', 'tz', 'cer')) return 'hardTile';
  if (/concrete|sealed|epoxy|polished|exposed|cement/.test(l) || code('sc', 'ep', 'conc')) return 'concrete';
  return undefined;
}

/**
 * floor_areas → square feet by finish class. A list holds each finish as printed (the tool maps the codes to classes and
 * sums them; an entry printed inside another figure - included_in - is taken out of that figure's class). The earlier
 * object form holds one figure per class.
 */
function floorAreasOf(v: NonNullable<FacilityRow['floor_areas']>, k: number): { by: Record<FinishClass, number>; other: number; detail?: string; notes: string[] } {
  const val = (x: unknown) => Math.max(0, numOrUndef(x) ?? 0) * k;
  if (!Array.isArray(v)) return { by: { carpet: val(v.carpet), resilient: val(v.resilient), hardTile: val(v.hard_tile), concrete: val(v.concrete), wood: val(v.wood) }, other: val(v.other), notes: [] };
  const by: Record<FinishClass, number> = { carpet: 0, resilient: 0, hardTile: 0, concrete: 0, wood: 0 };
  const items = v.map((e) => ({ finish: str(e.finish) ?? '', area: val(e.area), inc: str(e.included_in) })).filter((e) => e.finish && e.area > 0);
  let other = 0; const parts: string[] = []; const unknown: string[] = []; const notes: string[] = [];
  for (const e of items) {
    const c = finishClass(e.finish);
    if (c) by[c] += e.area; else { other += e.area; unknown.push(e.finish); }
    parts.push(`${e.finish} ${fmt(e.area)} → ${c ? FINISH_LABEL[c] : 'other'}`);
  }
  for (const e of items.filter((x) => x.inc)) {
    const host = items.find((x) => x !== e && lineKey(x.finish) === lineKey(e.inc));
    const hc = host ? finishClass(host.finish) : finishClass(e.inc!);
    if (!host && !hc) { notes.push(`floor_areas: "${e.finish}" is included_in "${e.inc}", which is not a finish of this row - send that finish with its printed area`); continue; }
    if (hc) by[hc] = Math.max(0, by[hc] - e.area); else other = Math.max(0, other - e.area);
    parts.push(`${e.finish} taken out of ${host?.finish ?? e.inc}`);
  }
  if (unknown.length) notes.push(`floor_areas: ${unknown.map((x) => `"${x}"`).join(', ')} is not a finish the tool knows - spread over the named finishes (name it as the legend defines it, e.g. "sealed concrete", "sheet vinyl")`);
  return { by, other, detail: items.length > 1 || items.some((e) => e.inc) ? parts.join(', ') : undefined, notes };
}

function prepareFacility(st: ExtractionState, d: FacilityRow): { row?: PreparedRow; error?: string; label?: string; hint?: string } {
  const bn = cleanBuildingNumber(d.building_number);
  const name = d.name.trim();
  const label = bn ?? name;
  if (isTotalRow(name, bn)) return { label, error: `"${name}" is a subtotal/total row - never register it; put the printed total in declare_tables.printed_total_gross_area` };
  const status = statusOf(d.status);
  if (status === null) return { label, error: `${label}: status "${d.status}" must be one of ${STATUS_IDS.join(', ')}` };
  const unit = unitOf(d.area_unit);
  if (unit === null) return { label, error: `${label}: area_unit "${d.area_unit}" must be sf, sm or sy (copy the area as printed and name its unit)` };
  const k = SQFT_PER[unit ?? 'sf'];
  const st0: FacilityStatus = status ?? 'in_scope';

  const grossRaw = d.gross_area !== undefined ? parseNumber(d.gross_area) : d.gross_sqft !== undefined ? parseNumber(d.gross_sqft) : null;
  const cleanRaw = d.cleanable_area !== undefined ? parseNumber(d.cleanable_area) : d.cleanable_sqft !== undefined ? parseNumber(d.cleanable_sqft) : null;
  if (Number.isNaN(grossRaw)) return { label, error: `${label}: gross_area "${String(d.gross_area ?? d.gross_sqft)}" is not a number - copy the printed number, or set gross_area null with area_missing=true` };
  if (grossRaw != null && grossRaw < 0) return { label, error: `${label}: gross_area must not be negative` };
  const areaGiven = grossRaw != null && grossRaw > 0;
  const areaMissing = !areaGiven && Boolean(d.area_missing);
  const added = addedAreasOf(d.added_areas);
  if (added.error) return { label, error: `${label}: ${added.error}` };
  if (added.parts.length && !areaGiven && !areaMissing) return { label, error: `${label}: added_areas need the building area too - give gross_area as printed (the tool adds the units to it), or area_missing=true` };

  const doc = resolveDoc(st, d.source?.file);
  const file = doc?.name ?? str(d.source?.file);
  const rank = doc ? doc.rank : fallbackRank(st);
  const campus = str(d.campus);
  const key = bn ? buildingKey(bn) : undefined;

  // printed square feet keep their decimals (to the cent); converted SM / SY are rounded to whole square feet
  const toSqft = (v: number) => (k === 1 ? Math.round(v * 100) / 100 : Math.round(v * k));
  const printedSqft = areaGiven ? toSqft(grossRaw!) : 0;
  let gross = printedSqft;
  const notes: (string | undefined)[] = [];
  const lineLabel = d.line_item != null ? str(String(d.line_item)) : undefined;
  const line = lineKey(lineLabel);
  if (lineLabel) notes.push(`Line item: ${lineLabel}`);
  if (areaGiven && unit && unit !== 'sf') notes.push(`Area converted from ${grossRaw!.toLocaleString('en-US')} ${unit.toUpperCase()}`);
  if (areaMissing) {
    const est = numOrUndef(d.estimated_gross_area);
    if (est && est > 0) { gross = Math.round(est * k); notes.push(`Area not printed; estimated ${fmt(gross)} SF`); } else notes.push('Area not printed in the package');
  }
  if (added.parts.length) {
    const base = gross;
    const addedSf = toSqft(added.parts.reduce((s, p) => s + p.count * p.unitArea, 0));
    gross = Math.round((gross + addedSf) * 100) / 100;
    const u = unit && unit !== 'sf' ? ` ${unit.toUpperCase()}` : '';
    notes.push(`Gross = ${fmt(base)} SF ${areaGiven ? 'printed' : 'estimated'} + ${added.parts.map((p) => `${p.label} ${fmtQty(p.count)} @ ${fmtQty(p.unitArea)}${u}`).join(' + ')} (${fmt(addedSf)} SF) = ${fmt(gross)} SF`);
  }
  const cleanPrintedSf = cleanRaw != null && !Number.isNaN(cleanRaw) && cleanRaw > 0 ? toSqft(cleanRaw) : undefined;
  // cleanable_equals_gross: the gross (with added areas) is the cleaning basis; a cleanable_area that just repeats the
  // printed gross is replaced, a different printed cleanable area is kept
  const eqGross = d.cleanable_equals_gross === true;
  let cleanable = cleanPrintedSf;
  if (eqGross && gross > 0 && (cleanPrintedSf == null || Math.abs(cleanPrintedSf - printedSqft) <= 1 || Math.abs(cleanPrintedSf - gross) <= 1)) {
    cleanable = gross;
    notes.push('Cleanable = gross (the document gives the gross area as the cleaning basis)');
  }
  if (cleanable != null && gross > 0 && (areaGiven || areaMissing) && cleanable > gross + 5) return { label, error: cleanableError(label, cleanable, gross), hint: 'cleanable' };
  // a cleanable area the document prints (or states to be the printed gross) - not one derived from an estimate
  const cleanIsPrinted = cleanable != null && ((cleanPrintedSf != null && cleanable === cleanPrintedSf) || (eqGross && areaGiven));
  const resultNotes: string[] = [];

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

  // service calendar: a stated number of days wins; else a seasonal window (counted here), else events per year
  const statedDays = (() => { const n = numOrUndef(d.service_days_per_year); return n != null && n >= 1 && n <= 366 ? Math.round(n) : undefined; })();
  let serviceDays = statedDays;
  const season = d.service_season;
  if (season && (season.start != null || season.end != null)) {
    const window = `${season.start ?? ''}${season.end != null ? ` – ${season.end}` : ''}`;
    const dpwPrinted = numOrUndef(season.days_per_week);
    const dpw = dpwPrinted && dpwPrinted > 0 ? Math.min(7, dpwPrinted) : (SERVICE_LEVELS.find((l) => l.id === serviceLevel)!.daysPerYear * 7) / 365;
    const r = seasonServiceDays(season.start, season.end, dpw);
    if (!r) resultNotes.push(`${label}: service_season "${window}" was not understood - give start and end as printed ("May 1", "Oct 15", "APR", "Memorial Day"), or set service_days_per_year`);
    else {
      serviceDays ??= Math.min(366, r.days);
      notes.push(`Service season ${window}: ${r.calendarDays} calendar days × ${fmtQty(dpw)} days/week = ${r.days} service days${statedDays != null && Math.abs(statedDays - r.days) > 2 ? ` (the document states ${statedDays})` : ''}`);
    }
  }
  const events = numOrUndef(d.events_per_year);
  if (events != null && events > 0) {
    // events_per_year replaces the routine calendar (on-call or per-event service); service on top of a routine level
    // goes in additional_service_days
    const levelDays = SERVICE_LEVELS.find((l) => l.id === serviceLevel)!.daysPerYear;
    if (serviceDays == null && LEVEL_IDS.includes(levelGiven) && events < levelDays) {
      resultNotes.push(`${label}: events_per_year (${fmtQty(events)}) replaces the ${serviceLevel} calendar (${levelDays} days a year) - if the events come on top of the routine service, send them in additional_service_days instead`);
    }
    serviceDays ??= Math.min(366, Math.round(events));
    notes.push(`On call: ${fmtQty(events)} events per year (one service day per event)`);
  }
  // service the document adds on top of the routine frequency (weekend drill service, opening / closing cleans)
  const extraIn = numOrUndef(d.additional_service_days?.days_per_year);
  const extraDays = extraIn != null && extraIn > 0 ? { days: Math.min(366, Math.round(extraIn)), label: str(d.additional_service_days?.label) } : undefined;
  const detail = d.cleaning_detail ?? {};
  const roomCount = numOrUndef(detail.restroom_rooms ?? d.restroom_rooms);
  if (roomCount != null && roomCount >= 0) notes.push(`Restroom rooms: ${fmtQty(roomCount)}`);
  const classes = (detail.area_by_class ?? d.area_by_class ?? []).map((c) => ({ label: str(c.label), area: numOrUndef(c.area) })).filter((c): c is { label: string; area: number } => Boolean(c.label) && c.area != null && c.area >= 0);
  if (classes.length) {
    const sf = classes.map((c) => ({ label: c.label, sf: toSqft(c.area) }));
    const sum = sf.reduce((s, c) => s + c.sf, 0);
    notes.push(`Area by class: ${sf.map((c) => `${c.label} ${fmt(c.sf)} SF`).join(', ')}`);
    const basis = cleanable ?? (gross > 0 ? gross : undefined);
    if (basis && Math.abs(sum - basis) > Math.max(5, 0.01 * basis)) resultNotes.push(`${label}: area_by_class sums to ${fmt(sum)} SF, not the ${cleanable != null ? 'cleanable' : 'gross'} area (${fmt(basis)} SF) - check the class columns`);
  }
  const standard = str(detail.cleaning_standard ?? d.cleaning_standard);
  if (standard) notes.push(`Cleaning standard: ${standard}`);

  const f: Facility = {
    id: '',
    buildingNumber: bn,
    // two lines of one building under the same printed name stay apart in lists
    name: lineLabel && line && !` ${lineKey(name) ?? ''} `.includes(` ${line} `) ? `${name} – ${lineLabel}` : name,
    category,
    grossSqft: gross,
    cleanableSqft: cleanable,
    floors: Math.max(0, Math.round(numOrUndef(d.floors) ?? 0)),
    restroomFixtures: fixtures != null ? Math.round(fixtures) : undefined,
    occupancy: numOrUndef(d.occupancy),
    serviceLevel,
    serviceDaysPerYear: serviceDays,
    scope: scope.length ? [...new Set(scope)] : ['custodial', 'floor_care'],
    confidence: areaMissing ? Math.min(confidence0, 0.4) : confidence0,
    campus,
    status: st0,
    statusReason: st0 !== 'in_scope' ? str(d.status_reason) : undefined,
    originalArea: unit && unit !== 'sf' && (areaGiven || cleanPrintedSf != null)
      ? (areaGiven ? { gross: grossRaw!, cleanable: cleanPrintedSf != null && cleanable === cleanPrintedSf ? cleanRaw! : undefined, unit } : { cleanable: cleanRaw!, unit })
      : undefined,
    serviceFrequencyText: str(d.service_frequency_text),
    tableId: str(d.table_id),
    source: { file, page: numOrUndef(d.source?.page), excerpt: (str(d.source?.excerpt) ?? '').slice(0, 240) },
    siteHint: d.site_hint ?? undefined,
  };
  if (d.floor_areas) {
    // square feet by finish as printed → shares of the named finishes (an unnamed "other" finish is spread over them)
    const fa = floorAreasOf(d.floor_areas, k);
    const { by, other } = fa;
    if (fa.notes.length) resultNotes.push(...fa.notes.map((x) => `${label}: ${x}`));
    const named = Object.values(by).reduce((s, x) => s + x, 0);
    if (named > 0) {
      f.floorMix = Object.fromEntries(Object.entries(by).map(([kk, x]) => [kk, Math.round((x / named) * 10000) / 10000])) as typeof by;
      notes.push(`Floor mix from printed SF by finish: ${(Object.entries(by) as [FinishClass, number][]).filter(([, x]) => x > 0).map(([kk, x]) => `${FINISH_LABEL[kk]} ${fmt(x)}`).join(', ')}${other > 0 ? `, other ${fmt(other)} (spread over the named finishes)` : ''}${fa.detail ? ` (${fa.detail})` : ''}`);
      const basis = cleanable ?? (gross > 0 ? gross : undefined);
      const total = named + other;
      if (basis && Math.abs(total - basis) > Math.max(5, 0.01 * basis)) resultNotes.push(`${label}: floor_areas sum to ${fmt(total)} SF, not the ${cleanable != null ? 'cleanable' : 'gross'} area (${fmt(basis)} SF) - check the finish columns (the mix uses the printed shares)`);
    } else if (other > 0) notes.push('Floor areas printed only for an unnamed finish; category floor mix used');
  } else if (d.floor_mix) {
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
    cleanPrinted: cleanIsPrinted, cleanRank: rank, cleanFile: file,
    statusStrength, statusRank: rank, categoryExplicit, levelExplicit,
    ...(line ? { line, lineLabel } : {}),
    ...(extraDays ? { extraDays } : {}),
  };
  return { row: { f, meta, key, tableId: f.tableId, areaGiven, printedSqft, cleanableEqualsGross: eqGross && !(areaGiven || areaMissing), fileUnresolved: d.source?.file && !doc ? d.source.file : undefined, notesForResult: resultNotes, lineLabel } };
}

/**
 * The facilities a numbered row can belong to: same number on the row's campus (a campus-less building adopts the campus
 * when it is the only one with the number). Several only when the building has separate line items.
 */
function campusCandidates(st: ExtractionState, key: string, campusSlug: string | undefined, label: string): { ids: string[]; adopt?: boolean; error?: string } {
  const all = [...(st.byKey.get(key) ?? [])].filter((id) => st.facilities.has(id));
  if (!all.length) return { ids: [] };
  const campusOf = (id: string) => st.meta.get(id)?.campusSlug;
  if (campusSlug) {
    const exact = all.filter((id) => campusOf(id) === campusSlug);
    if (exact.length) return { ids: exact };
    if (all.length === 1 && !campusOf(all[0])) return { ids: all, adopt: true };
    return { ids: [] };
  }
  const bare = all.filter((id) => !campusOf(id));
  if (bare.length) return { ids: bare };
  const campuses = [...new Set(all.map(campusOf))];
  if (campuses.length === 1) return { ids: all };
  const names = [...new Set(all.map((id) => st.facilities.get(id)?.campus).filter(Boolean))].join(', ');
  return { ids: [], error: `${label}: building number exists on ${campuses.length} campuses (${names}) - set campus` };
}

/** A facility with this number (the first line item when there are several): for links from grounds and held rows. */
function lookupNumbered(st: ExtractionState, key: string, campusSlug: string | undefined, label: string): { id?: string; error?: string } {
  const c = campusCandidates(st, key, campusSlug, label);
  return { id: c.ids[0], error: c.error };
}

/** Printed-row references of the rows registered for a facility (all, or only those that printed an area). */
const refsOf = (st: ExtractionState, id: string, withArea = false) => new Set((st.contribs.get(id) ?? []).filter((c) => !withArea || (c.meta.hasArea && !c.meta.areaMissing)).map((c) => rowRefOf(c.f.source)).filter(Boolean));
const namesOf = (st: ExtractionState, id: string) => new Set((st.contribs.get(id) ?? []).map((c) => c.meta.nameSlug));
/** How a line item is named in messages: its line_item, else its name. */
const lineName = (st: ExtractionState, id: string) => { const m = st.meta.get(id); return `"${m?.line ? m.lineLabel ?? m.line : st.facilities.get(id)?.name ?? id}"`; };

/** The table rows (printed rows) of a facility in one table: its own row and rows counted twice ("id#ref"). */
const tableRowsOf = (t: DeclaredTable, id: string) => [...t.rows.entries()].filter(([k]) => k === id || k.startsWith(`${id}#`)).map(([, r]) => r);

/**
 * A row of a table that prints this building number again - another printed row of the same document, under another
 * name and with another area - is a separate line item (a building listed once per cleaning level, wing or schedule),
 * not a revision of the row before: the rule-based reader counts it the same way. A re-sent row (same printed row, same
 * name or same area) and a revision from outside the table (another document or page) still merge.
 */
function splitsFrom(st: ExtractionState, row: PreparedRow, ids: string[]): boolean {
  const { f, meta } = row;
  if (!row.areaGiven || !f.tableId) return false;
  const ref = rowRefOf(f.source);
  const t = st.tables.get(f.tableId);
  if (!ref || !t || outsideTable(st, t, f.source?.file, f.source?.page)) return false;
  // a table whose declared rows are all registered prints no further row: this one revises a building (an amendment
  // or correction tagged with the table's id, e.g. in a Word or Excel file without page numbers) - it merges, and the
  // gate asks for line items if the rows really were separate
  if (t.rowCount != null && printedRows(t).length >= t.rowCount) return false;
  let seen = false;
  for (const id of ids) {
    const rows = tableRowsOf(t, id);
    if (!rows.length) continue;
    if (rows.some((r) => r.outside || r.areaMissing || !r.ref || r.ref === ref || Math.abs(r.sf - row.printedSqft) <= 1)) return false;
    const inTable = (st.contribs.get(id) ?? []).filter((c) => c.f.tableId === f.tableId);
    if (inTable.some((c) => c.meta.nameSlug === meta.nameSlug || (c.f.source?.file ?? '') !== (f.source?.file ?? ''))) return false;
    seen = true;
  }
  return seen;
}

/**
 * A number printed with a "B" (building) prefix in one place and without it in another ("Building 41 (B-41)" in an
 * amendment, "41" in the facility list): when the row's number is new, the one building whose number differs only by
 * that prefix and that was registered under exactly this name is the same building - for a revision row (no table) or a
 * row from another document, never for a row of that building's own table. Other letter prefixes name other building
 * series (T-41 temporary, P-41 permanent, S-41 ...), so they never alias: an amendment adding "T-12 Latrine" is not
 * building "12 Latrine".
 */
function prefixAlias(st: ExtractionState, row: PreparedRow): string | undefined {
  const { key, meta, f } = row;
  if (!key) return undefined;
  const keys = new Set<string>();
  const m = key.match(/^B(\d.*)$/);
  if (m) keys.add(m[1]);
  if (st.byKey.has(`B${key}`)) keys.add(`B${key}`);
  const ids = [...keys].flatMap((k) => campusCandidates(st, k, meta.campusSlug, '').ids).filter((id) => {
    const cs = st.contribs.get(id) ?? [];
    if (!cs.some((c) => c.meta.nameSlug === meta.nameSlug)) return false;
    if (f.tableId && cs.some((c) => c.f.tableId === f.tableId)) return false;
    return !f.tableId || !cs.some((c) => (c.f.source?.file ?? '') === (f.source?.file ?? ''));
  });
  return ids.length === 1 ? ids[0] : undefined;
}

interface Resolved {
  id?: string;
  /** Campus-less building adopting the row's campus. */
  adopt?: boolean;
  /** Register as a new facility: a new line item, or another printed row of the table (splitsFrom). */
  line?: 'line' | 'split';
  error?: string;
  info?: string;
}

/**
 * Identity of a numbered row: campus + number, then the line item. With line_item: that line, else the facility that
 * holds the same printed row without a line item (it becomes this line), else a new line. Without: the only facility with
 * the number (unless the row is another printed row of its table, see splitsFrom), else the line holding the same
 * printed row or registered under the same name; when that is still ambiguous the row must say which line it belongs to.
 */
function resolveNumbered(st: ExtractionState, row: PreparedRow, label: string): Resolved {
  const { f, meta, key } = row;
  const c = campusCandidates(st, key!, meta.campusSlug, label);
  if (c.error) return { error: c.error };
  const ids = c.ids;
  const ref = rowRefOf(f.source);
  const lineOf = (id: string) => st.meta.get(id)?.line;
  if (!ids.length) {
    if (meta.line) return { line: 'line' };
    const alias = prefixAlias(st, row);
    return alias ? { id: alias, info: `${label}: matched to building ${st.facilities.get(alias)?.buildingNumber ?? alias} (same name; the number is printed with and without a letter prefix)` } : {};
  }
  if (meta.line) {
    const exact = ids.find((id) => lineOf(id) === meta.line);
    if (exact) return { id: exact, adopt: c.adopt };
    // a line registered without line_item (a second printed row split off by name, or the row it was split from) is
    // addressed by its name - the name the "separate line items" error lists for it
    const named = ids.filter((id) => !lineOf(id) && (st.contribs.get(id) ?? []).some((x) => lineKey(x.f.name) === meta.line));
    if (named.length === 1) return { id: named[0], adopt: c.adopt };
    // the same printed row registered before without a line item: that facility is this line, when it holds no other
    // printed row with an area
    const holder = ref ? ids.find((id) => !lineOf(id) && refsOf(st, id).has(ref)) : undefined;
    if (holder && [...refsOf(st, holder, true)].every((r) => r === ref)) return { id: holder, adopt: c.adopt };
    // a row that only adds data to a building registered once (from one printed row) applies to it
    if (!row.areaGiven && !meta.areaMissing && ids.length === 1 && !lineOf(ids[0]) && refsOf(st, ids[0], true).size <= 1) return { id: ids[0], adopt: c.adopt };
    return { line: 'line' };
  }
  if (ids.length === 1) return splitsFrom(st, row, ids) ? { line: 'split' } : { id: ids[0], adopt: c.adopt };
  if (ref) { const byRef = ids.filter((id) => refsOf(st, id).has(ref)); if (byRef.length === 1) return { id: byRef[0] }; }
  const byName = ids.filter((id) => namesOf(st, id).has(meta.nameSlug));
  if (byName.length === 1) return { id: byName[0] };
  if (splitsFrom(st, row, ids)) return { line: 'split' };
  return { error: `${label}: this building is registered as ${ids.length} separate line items (${ids.map((id) => lineName(st, id)).join(', ')}) - set line_item to the line this row belongs to, or send the row once for each line it applies to` };
}

/**
 * Takes one printed row (its reference) out of a facility: the row was registered again as another line item. The table
 * keeps the facility's other printed rows; a facility left without rows is removed.
 */
function detachRow(st: ExtractionState, id: string, ref: string): void {
  const list = st.contribs.get(id);
  if (!list || !ref) return;
  const keep = list.filter((c) => rowRefOf(c.f.source) !== ref);
  if (keep.length === list.length) return;
  for (const t of st.tables.values()) {
    for (const [k, r] of [...t.rows]) if ((k === id || k.startsWith(`${id}#`)) && r.ref === ref) t.rows.delete(k);
    if (!t.rows.has(id)) {
      const dk = [...t.rows.keys()].find((k) => k.startsWith(`${id}#`));
      if (dk && keep.length) { t.rows.set(id, t.rows.get(dk)!); t.rows.delete(dk); }
    }
  }
  if (!keep.length) {
    st.facilities.delete(id); st.meta.delete(id); st.contribs.delete(id);
    for (const set of st.byKey.values()) set.delete(id);
    for (const t of st.tables.values()) for (const k of [...t.rows.keys()]) if (k === id || k.startsWith(`${id}#`)) t.rows.delete(k);
    return;
  }
  st.contribs.set(id, keep);
  const { f, meta } = foldContributions(keep);
  st.facilities.set(id, f); st.meta.set(id, meta);
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
  // cleanable is its own field group: the higher-ranked (later) row's printed cleanable area wins when it fits the kept
  // gross, also when that row prints no gross (a correction of the cleanable / serviced area only); the other row's only
  // while it still fits (a revised, smaller gross makes it stale)
  const fits = (c?: number) => c != null && (!A.grossSqft || c <= A.grossSqft + 5);
  const cleanFrom = hm.cleanPrinted && fits(hi.cleanableSqft) ? 'hi' : lm.cleanPrinted && fits(lo.cleanableSqft) ? 'lo' : undefined;
  const cleanableSqft = cleanFrom === 'hi' ? hi.cleanableSqft : cleanFrom === 'lo' ? lo.cleanableSqft : A.cleanableSqft ?? (fits(B.cleanableSqft) ? B.cleanableSqft : undefined);
  const C = cleanFrom === 'hi' ? hi : cleanFrom === 'lo' ? lo : A; const Cm = cleanFrom === 'hi' ? hm : cleanFrom === 'lo' ? lm : Am;
  // (not when the cleanable area just follows a replaced gross: the gross note says it)
  if (cleanFrom === 'hi' && lm.cleanPrinted && lo.cleanableSqft != null && hi.cleanableSqft !== lo.cleanableSqft && !(lo.cleanableSqft === lo.grossSqft && cleanableSqft === A.grossSqft && A === hi)) {
    notes.push(hm.cleanRank > lm.cleanRank ? `Superseded ${fmt(lo.cleanableSqft)} cleanable SF from ${lm.cleanFile ?? 'an earlier document'}` : `Re-registered: ${fmt(lo.cleanableSqft)} cleanable SF replaced`);
  }
  if (hm.cleanPrinted && hi.cleanableSqft != null && !fits(hi.cleanableSqft)) notes.push(`Cleanable ${fmt(hi.cleanableSqft)} SF from ${hm.cleanFile ?? 'a later row'} not applied: larger than the gross area (${fmt(A.grossSqft)} SF)`);
  // the printed (metric) figures of the kept gross and cleanable areas
  let originalArea = A.originalArea;
  if (C !== A && cleanableSqft != null) {
    const oc = C.originalArea?.cleanable != null && C.originalArea.unit === (A.originalArea?.unit ?? C.originalArea.unit) ? C.originalArea.cleanable : undefined;
    originalArea = A.originalArea ? { ...A.originalArea, cleanable: oc } : oc != null ? { cleanable: oc, unit: C.originalArea!.unit } : undefined;
  }
  const f: Facility = {
    ...lo, ...hi,
    id: old.id,
    buildingNumber: bnPick,
    name: hi.name || lo.name,
    campus: hi.campus ?? lo.campus,
    category: hm.categoryExplicit ? hi.category : lm.categoryExplicit ? lo.category : hi.category,
    serviceLevel: hm.levelExplicit ? hi.serviceLevel : lm.levelExplicit ? lo.serviceLevel : hi.serviceLevel,
    serviceDaysPerYear: hm.levelExplicit ? hi.serviceDaysPerYear : lm.levelExplicit ? lo.serviceDaysPerYear : hi.serviceDaysPerYear ?? lo.serviceDaysPerYear,
    serviceFrequencyText: hm.levelExplicit ? hi.serviceFrequencyText ?? lo.serviceFrequencyText : lo.serviceFrequencyText ?? hi.serviceFrequencyText,
    grossSqft: A.grossSqft,
    cleanableSqft,
    originalArea,
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
    cleanPrinted: cleanFrom != null, cleanRank: Cm.cleanRank, cleanFile: Cm.cleanFile,
    line: om.line ?? rm.line, lineLabel: om.lineLabel ?? rm.lineLabel,
    statusStrength: S.statusStrength, statusRank: S.statusRank,
    categoryExplicit: om.categoryExplicit || rm.categoryExplicit, levelExplicit: om.levelExplicit || rm.levelExplicit,
    extraDays: hm.extraDays ?? lm.extraDays,
  };
  if (!meta.extraDays) delete meta.extraDays;
  return { f, meta };
}

/**
 * Service days added on top of the routine calendar (the kept level's days, or the stated / seasonal / on-call days).
 * Applied to the folded facility only, so a later frequency revision is never cut short or counted twice.
 */
function withExtraDays(f: Facility, meta: FacMeta): Facility {
  if (!meta.extraDays) return f;
  const base = f.serviceDaysPerYear ?? SERVICE_LEVELS.find((l) => l.id === f.serviceLevel)?.daysPerYear ?? 0;
  const days = Math.min(366, base + meta.extraDays.days);
  return { ...f, serviceDaysPerYear: days, notes: joinNotes(f.notes, `Service days: ${base} routine + ${meta.extraDays.days} additional${meta.extraDays.label ? ` (${meta.extraDays.label})` : ''} = ${days}`) };
}

/** Merges every row registered for one facility, lowest (rank, seq) first. */
function foldContributions(list: Contribution[]): Contribution {
  const sorted = [...list].sort((a, b) => a.meta.rank - b.meta.rank || a.meta.seq - b.meta.seq);
  let acc: Contribution = { f: { ...sorted[0].f }, meta: { ...sorted[0].meta } };
  for (const k of Object.keys(acc.f) as (keyof Facility)[]) if (acc.f[k] === undefined) delete acc.f[k];
  for (const c of sorted.slice(1)) acc = mergeRows(acc.f, acc.meta, c.f, c.meta);
  return { f: withExtraDays(acc.f, acc.meta), meta: acc.meta };
}

/** Merge two facilities outside a run (append mode): b is treated as the newer registration and its listed status wins. */
export function mergeFacilities(a: Facility, b: Facility): Facility {
  const m = (f: Facility, seq: number): FacMeta => ({
    rank: 0, seq, file: f.source?.file, nameSlug: idSlug(f.name), hasArea: f.grossSqft > 0, areaMissing: false, areaRank: 0, areaFile: f.source?.file,
    cleanPrinted: f.cleanableSqft != null, cleanRank: 0, cleanFile: f.source?.file,
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

/**
 * A row lies outside a declared table when it comes from another package document than the table, or from a page
 * outside the table's declared pages (amendment / Q&A revision rows tagged with the base table's id).
 */
function outsideTable(st: ExtractionState, t: DeclaredTable, file: string | undefined, page: number | undefined): boolean {
  if (!t.declared) return false;
  const isDoc = (n?: string) => Boolean(n && st.docs.some((d) => d.name === n));
  if (isDoc(t.file) && isDoc(file) && t.file !== file) return true;
  const r = pageRanges(t.pages);
  return Boolean(r && page != null && !r.some(([a, b]) => page >= a && page <= b));
}

interface RegCtx {
  events: ExtractionEvent[];
  info: string[];
  notes: string[];
  undeclared: Set<string>;
  seenThisCall: Set<string>;
  updates: number;
  heldApplied: string[];
}

/**
 * Puts one prepared row into the inventory: identity, merge with the building's other rows, table-row accounting.
 * A row that only adds data to a numbered building that is not registered yet is held (st.pending) instead.
 */
function commitRow(st: ExtractionState, row: PreparedRow, ctx: RegCtx): { id?: string; merged?: Facility; error?: string; hint?: string; held?: boolean } {
  const { f, meta, key } = row;
  const label = f.buildingNumber ?? f.name;

  // identity
  let id: string | undefined; let adopt = false; let lineBase: string | undefined; let detachFrom: string[] = [];
  const lineSuffix = (s: string) => `--${idSlug(s) || 'x'}`;
  if (key) {
    const r = resolveNumbered(st, row, label);
    if (r.error) return { error: r.error };
    id = r.id; adopt = Boolean(r.adopt);
    if (r.info) ctx.notes.push(r.info);
    if (r.line) {
      // a separate line item of a numbered building is its own facility (b-0012--level-2)
      lineBase = `${facilityKey(f.buildingNumber, f.name, f.campus)}${lineSuffix(r.line === 'line' ? row.lineLabel ?? meta.line! : meta.nameSlug)}`;
      if (r.line === 'split') {
        const first = campusCandidates(st, key, meta.campusSlug, label).ids.map((x) => st.facilities.get(x)?.name).filter(Boolean);
        ctx.notes.push(`${label} is printed again in ${f.tableId} under another name and with another area: "${f.name}" is registered as a separate line item of the building (re-sent rows and corrections under the same name still merge; if this row revises ${first.map((n) => `"${n}"`).join(' / ')} instead, resend it with line_item set to that name)`);
      }
      else if (row.areaGiven) {
        // the building is also registered as a whole from another table: the line items would count its area twice
        const whole = campusCandidates(st, key, meta.campusSlug, label).ids.filter((x) => !st.meta.get(x)?.line && st.meta.get(x)?.hasArea && !(st.contribs.get(x) ?? []).some((c) => c.f.tableId != null && c.f.tableId === f.tableId));
        if (whole.length) ctx.info.push(`${label} is also registered without a line item (${whole.map((x) => `"${st.facilities.get(x)?.name}" ${fmt(st.facilities.get(x)?.grossSqft ?? 0)} SF`).join(', ')}): if that row is the whole building and the line items are its parts, resend it with status excluded and a status_reason naming the line items; if the line items only break the building down (floors, units), resend them with status excluded and a status_reason saying so`);
      }
    }
    // a printed row registered again as another line item leaves the facility it was registered with before
    const ref = rowRefOf(f.source);
    if (meta.line && ref) detachFrom = campusCandidates(st, key, meta.campusSlug, label).ids.filter((other) => other !== id && st.meta.get(other)?.line !== meta.line && refsOf(st, other).has(ref));
  } else {
    const excerpt = f.source?.excerpt ?? '';
    const scope = f.tableId ? `--${slug(f.tableId)}` : '';
    const rowRef = excerpt ? `-${fnv(`${f.source?.page ?? ''}|${excerpt}`)}` : '';
    const base = `b-${meta.campusSlug ? `${meta.campusSlug}--` : ''}${meta.nameSlug}${meta.line ? lineSuffix(row.lineLabel ?? meta.line) : ''}${scope}${rowRef}`;
    if (!scope && !rowRef) {
      const same = [...st.meta.entries()].filter(([, m]) => !m.key && m.nameSlug === meta.nameSlug && m.campusSlug === meta.campusSlug && m.line === meta.line).map(([k]) => k);
      id = same.length === 1 ? same[0] : st.facilities.has(base) ? base : undefined;
    } else id = st.facilities.has(base) && !ctx.seenThisCall.has(base) ? base : undefined;
    if (!id) { id = newId(st, base); }
    ctx.seenThisCall.add(id);
  }
  const exists = Boolean(id && st.facilities.has(id));
  const counts = f.status === 'in_scope' || f.status === 'option_only';
  if (!row.areaGiven && !meta.areaMissing && counts && !exists) {
    // an update row read before its building (a dining or frequency table before the table that prints the areas)
    if (key) { st.pending.push({ row, key, label, pass: st.pass }); return { held: true }; }
    return { error: `${label}: gross_area missing - copy it from the row (in its printed unit, with area_unit), or set gross_area null and area_missing=true with your estimate in estimated_gross_area and the basis in notes` };
  }
  for (const other of detachFrom) detachRow(st, other, rowRefOf(f.source));
  if (exists && !row.areaGiven && !meta.areaMissing) {
    // a row that adds data to a registered building: its cleanable area is checked against the building's gross
    const cur = st.facilities.get(id!)!;
    if (row.cleanableEqualsGross && cur.grossSqft > 0) { f.cleanableSqft = cur.grossSqft; meta.cleanPrinted = true; }
    else if (f.cleanableSqft && cur.grossSqft > 0 && f.cleanableSqft > cur.grossSqft + 5) return { error: cleanableError(label, f.cleanableSqft, cur.grossSqft), hint: 'cleanable' };
  }
  let merged: Facility; let mm: FacMeta;
  if (exists) {
    const list = st.contribs.get(id!) ?? [{ f: st.facilities.get(id!)!, meta: st.meta.get(id!)! }];
    if (adopt) for (const c of list) { c.meta.campusSlug = meta.campusSlug; c.f.campus = f.campus; }
    list.push({ f: { ...f, id: id! }, meta });
    st.contribs.set(id!, list);
    // re-fold every row of this building in (rank, seq) order: the result does not depend on read order
    ({ f: merged, meta: mm } = foldContributions(list));
    ctx.updates++;
    if (meta.cleanPrinted && f.cleanableSqft != null && merged.cleanableSqft !== f.cleanableSqft && merged.grossSqft > 0 && f.cleanableSqft > merged.grossSqft + 5) {
      ctx.info.push(`${label}: cleanable_area ${fmt(f.cleanableSqft)} SF was not applied - it is larger than the building's gross area (${fmt(merged.grossSqft)} SF)`);
    }
  } else {
    id = id ?? newId(st, lineBase ?? facilityKey(f.buildingNumber, f.name, f.campus));
    merged = withExtraDays({ ...f, id }, meta);
    for (const k of Object.keys(merged) as (keyof Facility)[]) if (merged[k] === undefined) delete merged[k];
    mm = meta;
    st.contribs.set(id, [{ f: { ...f, id }, meta }]);
  }
  st.facilities.set(id!, merged); st.meta.set(id!, mm);
  if (key) { const set = st.byKey.get(key) ?? new Set<string>(); set.add(id!); st.byKey.set(key, set); }
  if (f.tableId) {
    if (!st.tables.get(f.tableId)?.declared) ctx.undeclared.add(f.tableId);
    const t = tableFor(st, f.tableId);
    const ref = rowRefOf(f.source);
    const prev = t.rows.get(id!);
    const outside = outsideTable(st, t, f.source?.file, f.source?.page);
    if (prev && outside && !prev.outside) {
      // a revision (amendment, Q&A) of a building already counted from the table: merged into the building above, while
      // the table keeps its row as printed, so it still reconciles against its printed count and total
      const where = [f.source?.file && f.source.file !== t.file ? f.source.file : '', f.source?.page != null ? `p. ${f.source.page}` : ''].filter(Boolean).join(' ');
      ctx.notes.push(`${label}: the row from ${where || 'another document'} lies outside ${f.tableId}${t.pages ? ` (pages ${t.pages})` : ''}; it revises the building, and ${f.tableId} keeps its printed row`);
    } else if (prev?.outside && !outside) {
      // the printed row arrives after a revision of it that was tagged with this table: the printed row is the table's
      t.rows.set(id!, { sf: row.areaGiven ? row.printedSqft : prev.sf, inScope: merged.status === 'in_scope' || !merged.status, option: merged.status === 'option_only', areaMissing: !row.areaGiven && prev.areaMissing, name: label, ref });
    } else {
      // A table row is counted once per building; a re-sent row (same printed row or same area) updates it. A second,
      // different printed row of the same building with a different area that is not a separate line item (same name,
      // or another document) counts as its own table row, so the gate does not ask for rows that were registered - but
      // the building keeps one area, so completeness reports it until the rows are resent as line items or explained.
      let rowKey = id!;
      if (prev && row.areaGiven && !prev.areaMissing && ref && prev.ref && prev.ref !== ref && Math.abs(prev.sf - row.printedSqft) > 1) {
        rowKey = `${id}#${ref}`;
        if (!t.rows.has(rowKey)) ctx.info.push(`${label} is listed twice in ${f.tableId} with different areas (${fmt(prev.sf)} and ${fmt(row.printedSqft)} SF) and only one area is kept (${fmt(merged.grossSqft)} SF) - if the rows are separately priced parts of the building (one line per cleaning level, wing or schedule), resend both rows with line_item set to what tells them apart; if one row corrects the other, name ${f.tableId} in finish.unresolved`);
      }
      // the area as printed in the table's column (added areas such as portables are not in the printed total)
      t.rows.set(rowKey, { sf: row.areaGiven ? row.printedSqft : prev?.sf ?? merged.grossSqft, inScope: merged.status === 'in_scope' || !merged.status, option: merged.status === 'option_only', areaMissing: !row.areaGiven && (prev?.areaMissing ?? true), name: label, ref: rowKey === id ? prev?.ref ?? ref : ref, ...(outside && (!prev || prev.outside) ? { outside: true } : {}) });
    }
  }
  ctx.events.push({ type: 'facility', facility: merged });
  return { id: id!, merged };
}

/** Applies held update rows whose building (same number) is now registered. */
function applyPending(st: ExtractionState, key: string, ctx: RegCtx): void {
  for (const p of st.pending.filter((x) => x.key === key)) {
    const r = resolveNumbered(st, p.row, p.label);
    if (r.error) { st.pending.splice(st.pending.indexOf(p), 1); ctx.info.push(`held row ${r.error}`); continue; }
    if (!r.id) continue;
    st.pending.splice(st.pending.indexOf(p), 1);
    p.row.meta.seq = ++st.seq; // as if registered now, after its building
    const res = commitRow(st, p.row, ctx);
    if (res.id) ctx.heldApplied.push(p.label);
    else if (res.error) ctx.info.push(`held row ${res.error}`);
  }
}

const listLabels = (labels: string[], max = 12) => `${labels.slice(0, max).join(', ')}${labels.length > max ? `, … ${labels.length - max} more` : ''}`;

function registerFacilities(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const events: ExtractionEvent[] = [];
  const rows = Array.isArray(input.facilities) ? input.facilities : [];
  if (!rows.length) return { resultText: 'No facilities in the call - pass them in "facilities": [...].', isError: true, events };
  const ok: string[] = []; const bad: { label: string; text: string }[] = []; const hints = new Set<string>(); const held: string[] = [];
  const unresolvedFiles = new Set<string>();
  const ctx: RegCtx = { events, info: [], notes: [], undeclared: new Set(), seenThisCall: new Set(), updates: 0, heldApplied: [] };
  let outOfScope = 0;
  rows.forEach((raw, i) => {
    const p = FacilityRowIn.safeParse(raw);
    if (!p.success) { bad.push({ label: `row ${i + 1}`, text: `row ${i + 1}: ${zIssues(p.error)}` }); return; }
    const prep = prepareFacility(st, p.data);
    if (prep.error || !prep.row) { bad.push({ label: prep.label ?? `row ${i + 1}`, text: prep.error ?? `row ${i + 1}: invalid` }); if (prep.hint) hints.add(prep.hint); return; }
    if (prep.row.fileUnresolved) unresolvedFiles.add(prep.row.fileUnresolved);
    ctx.info.push(...prep.row.notesForResult);
    const label = prep.row.f.buildingNumber ?? prep.row.f.name;
    const r = commitRow(st, prep.row, ctx);
    if (r.error) { bad.push({ label, text: r.error }); if (r.hint) hints.add(r.hint); return; }
    if (r.held) { held.push(label); return; }
    if (r.merged?.status && r.merged.status !== 'in_scope') outOfScope++;
    ok.push(r.id!);
    if (prep.row.key) applyPending(st, prep.row.key, ctx);
  });
  events.push(progressEvent(st));
  const heldBy = (tid: string) => st.pending.filter((x) => x.row.tableId === tid).length;
  const tableProgress = [...new Set(rows.map((r) => (r && typeof r === 'object' ? str((r as Record<string, unknown>).table_id) : undefined)).filter((x): x is string => Boolean(x)))]
    .map((tid) => { const t = st.tables.get(tid); const h = heldBy(tid); return t ? `${tid}: ${printedRows(t).length}${t.rowCount != null ? ` of ${t.rowCount}` : ''} rows${h ? ` (+${h} held)` : ''}` : ''; }).filter(Boolean);
  const u = ctx.updates;
  const text = [
    `Registered ${ok.length} of ${rows.length} rows (${st.facilities.size} facilities in total${outOfScope ? `; ${outOfScope} in this call recorded as out of scope` : ''}${u ? `; ${u} ${u === 1 ? 'update' : 'updates'} of already-registered buildings` : ''}).`,
    tableProgress.length ? `Progress: ${tableProgress.join('; ')}.` : '',
    bad.length ? `Rejected ${bad.length}: ${bad.slice(0, 8).map((b) => b.text).join(' | ')}${bad.length > 8 ? ` | … ${bad.length - 8} more (${listLabels(bad.slice(8).map((b) => b.label), 40)})` : ''}.${hints.has('cleanable') ? ` ${CLEANABLE_HINT}` : ''} Fix and resend only the rejected rows.` : '',
    held.length ? `Held ${held.length} ${held.length === 1 ? 'row' : 'rows'} without an area for buildings not registered yet (${listLabels(held)}): ${held.length === 1 ? 'it is' : 'they are'} applied when the building is registered with its area. If such a row prints the area, resend it with gross_area; if the area is printed nowhere, register the building with area_missing=true.` : '',
    ctx.heldApplied.length ? `Applied ${ctx.heldApplied.length} held ${ctx.heldApplied.length === 1 ? 'row' : 'rows'} to ${listLabels([...new Set(ctx.heldApplied)])}.` : '',
    ctx.undeclared.size ? `Table(s) ${[...ctx.undeclared].join(', ')} were not declared - call declare_tables with their row counts and printed totals.` : '',
    unresolvedFiles.size ? `source.file ${[...unresolvedFiles].map((f) => `"${f}"`).join(', ')} is not one of the package documents (${st.docs.map((d) => d.name).join(', ')}); use the document name exactly.` : '',
    ctx.info.length ? `Check: ${ctx.info.slice(0, 6).join(' | ')}${ctx.info.length > 6 ? ` | … ${ctx.info.length - 6} more` : ''}.` : '',
    ctx.notes.length ? `Note: ${ctx.notes.slice(0, 4).join(' | ')}${ctx.notes.length > 4 ? ` | … ${ctx.notes.length - 4} more` : ''}.` : '',
  ].filter(Boolean).join(' ');
  return { resultText: text, isError: ok.length === 0 && held.length === 0, events };
}

// ------------------------------------------------------------------------------------------------
// grounds
// ------------------------------------------------------------------------------------------------

/** The site a grounds row belongs to: its building number, else its name up to the first " – " / "(" / ":" ("Site 9 Creekside Greenway – rough mow" → "site 9 creekside greenway"). */
const groundsStem = (name: string, bn?: string) => (bn ? `bn:${buildingKey(bn)}` : name.toLowerCase().replace(DASHES, '-').split(/\s+-\s+|\s*[(:;,]\s*|\s+\/\s+/)[0].replace(/[^a-z0-9]+/g, ' ').trim());

const isOut = (s?: FacilityStatus) => s != null && s !== 'in_scope';
/** in scope / option-only (an optional site or CLIN) / any other out-of-scope status. */
const bucketOf = (s?: FacilityStatus): 'in' | 'option' | 'out' => (!s || s === 'in_scope' ? 'in' : s === 'option_only' ? 'option' : 'out');
const tierOf = (rank: number) => Math.floor(rank / 1e7);
/** Last page of a declared table, when its pages are a plain page list. */
const lastPageOf = (t?: DeclaredTable) => { const r = t?.declared ? pageRanges(t.pages) : undefined; return r ? Math.max(...r.map(([, b]) => b)) : undefined; };

const DESCRIPTOR_STOP = new Set(['and', 'the', 'for', 'with', 'per', 'area', 'areas', 'total', 'revised', 'revision', 'amended', 'amendment', 'item']);
/** The words of a grounds name after its site ("Eagan USARC – Improved Mow & Trim" → improved, mow, trim). */
const descriptorOf = (nameKey: string, site: string) => (nameKey.startsWith(site) ? nameKey.slice(site.length) : nameKey).split(' ').filter((w) => w.length >= 3 && /[a-z]/.test(w) && !DESCRIPTOR_STOP.has(w));

/** A walk or path by name (normalised with lineKey), and a linear feature (edging, curbs, fences ...) that is never a walk. */
const WALK_NAME = /\b(?:side)?walks?\b|\bwalkways?\b|\bpath(?:way)?s?\b|\btrails?\b/;
const LINEAR_FEATURE = /edg|curb|gutter|fenc|ditch|swale|channel|trim|border|rail|strip|hedge|shoulder/;

/** Words that name an area added beside a registered one ("Site 4 – additional turf", "Bldg 100 – new lawn"). */
const ADDED_AREA = /\b(?:new|adds?|added|addition|additional|expansion|expanded|extension)\b/;

/**
 * The same grounds area: same kind and canonical unit, same campus (when both give one), and the same building number
 * (when both give one), else the same name, or the same site (groundsStem: "Eagan USARC – Improved" = "Eagan USARC")
 * unless both names go on to say different things ("Site 4 – POV parking" is not "Site 4 – roads and drives"). A name
 * that says the area is new or added, where the other's does not, is another area (an addition, never a revision).
 */
function sameGroundsArea(x: GroundsMeta, y: GroundsMeta): boolean {
  if (x.kind !== y.kind || x.canonUnit !== y.canonUnit) return false;
  if (x.campusSlug && y.campusSlug && x.campusSlug !== y.campusSlug) return false;
  if (x.key && y.key && x.key !== y.key) return false;
  if (x.nameKey === y.nameKey) return true;
  if (ADDED_AREA.test(x.nameKey) !== ADDED_AREA.test(y.nameKey)) return false;
  if (x.key && y.key) return true;
  if (!x.site || x.site !== y.site) return false;
  return !x.desc.length || !y.desc.length || x.desc.some((w) => y.desc.includes(w));
}

/**
 * Row r states a later quantity or status for area a: r is not another printed row of a's table, and r comes from a Q&A or
 * amendment ranked above a's document, or - in a file that holds a base document followed by its amendment - from the
 * same file, outside every declared table, on a page after a's table. Two rows of the base documents never revise each
 * other (an attachment that restates or subsets another's areas is not a revision).
 */
function groundsRevises(st: ExtractionState, r: GroundsMeta, a: GroundsMeta): boolean {
  if (r.inTable && r.table === a.table) return false;
  if ((r.file ?? '') !== (a.file ?? '')) return r.rank > a.rank && tierOf(r.rank) >= 2;
  if (r.inTable || !a.table || !a.inTable) return false;
  const last = lastPageOf(st.tables.get(a.table));
  return last != null && r.page != null && r.page > last;
}

/** Registered areas (in scope or out of scope, never lengths) that row m revises, or that revise m; an exact name wins. */
function groundsMatches(st: ExtractionState, m: GroundsMeta, dir: 'revises' | 'revisedBy'): string[] {
  const ids = [...st.groundsMeta.entries()]
    .filter(([, x]) => sameGroundsArea(m, x) && (dir === 'revises' ? groundsRevises(st, m, x) : groundsRevises(st, x, m)))
    .map(([id]) => id);
  const exact = ids.filter((id) => st.groundsMeta.get(id)!.nameKey === m.nameKey);
  return exact.length ? exact : ids;
}

/** Takes a grounds area out of the estimate (a later row deletes it, or a re-sent row states an out-of-scope status). */
function retireGrounds(st: ExtractionState, id: string, status: FacilityStatus, reason?: string): void {
  const i = st.grounds.findIndex((g) => g.id === id);
  if (i >= 0) {
    const g = st.grounds[i]; st.grounds.splice(i, 1);
    st.excludedGrounds.push({ id, name: g.name, status, reason, quantity: g.quantity, unit: g.unit, table: st.groundsMeta.get(id)?.table, kind: g.kind, canon: canonGrounds(g.quantity, g.unit), area: g });
  } else {
    const e = st.excludedGrounds.find((x) => x.id === id) ?? st.lengths.find((x) => x.id === id);
    if (e) { e.status = status; e.reason = reason ?? e.reason; }
  }
  st.groundsStatus.set(id, status);
}

/** Puts an out-of-scope grounds area back in scope (a stated in_scope with a reason). */
function restoreGrounds(st: ExtractionState, id: string, events: ExtractionEvent[]): void {
  const i = st.excludedGrounds.findIndex((x) => x.id === id);
  const e = i >= 0 ? st.excludedGrounds[i] : undefined;
  if (e?.area) { st.excludedGrounds.splice(i, 1); st.grounds.push(e.area); events.push({ type: 'grounds', area: e.area }); }
  else { const l = st.lengths.find((x) => x.id === id); if (l) { l.status = 'in_scope'; l.reason = undefined; } }
  st.groundsStatus.set(id, 'in_scope');
}

function registerGrounds(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const events: ExtractionEvent[] = [];
  const rows = Array.isArray(input.areas) ? input.areas : [];
  if (!rows.length) return { resultText: 'No areas in the call - pass them in "areas": [...].', isError: true, events };
  let n = 0; let dup = 0; let out = 0; let revised = 0; let retired = 0;
  const bad: string[] = []; const notes: string[] = []; const tablesTouched = new Set<string>(); const lengths: string[] = []; const walks: string[] = [];
  rows.forEach((raw, i) => {
    const p = GroundsRowIn.safeParse(raw);
    if (!p.success) { bad.push(`area ${i + 1}: ${zIssues(p.error)}`); return; }
    const d = p.data; const name = d.name.trim();
    if (isTotalRow(name, undefined, true)) { bad.push(`"${name}" is a total row - never register totals; put printed totals in declare_tables.printed_totals`); return; }
    const qty = parseNumber(d.quantity);
    if (qty == null || Number.isNaN(qty) || qty < 0) { bad.push(`${name}: quantity "${String(d.quantity)}" is not a number`); return; }
    const u = groundsUnitOf(d.unit);
    if (!u) { bad.push(`${name}: unit "${String(d.unit)}" must be acres, hectares, sqft, sqm, sqyd, lf or each`); return; }
    const status = statusOf(d.status);
    if (status === null) { bad.push(`${name}: status "${d.status}" must be one of ${STATUS_IDS.join(', ')}`); return; }
    const statusEff: FacilityStatus = status ?? 'in_scope';
    const reason = str(d.status_reason);
    const kindIn = String(d.kind ?? '').toLowerCase().trim();
    const kind = (KIND_IDS.includes(kindIn) ? kindIn : mapGroundsLabel(`${d.kind ?? ''} ${d.document_label ?? ''} ${name}`, d.mowing_frequency_text)) as GroundsKind;
    const quantity = u.convert === 'ha' ? qty * ACRES_PER_HECTARE : u.convert === 'sqm' ? qty * SQFT_PER_SQM : qty;
    const canon = canonGrounds(quantity, u.unit);
    const printedUnit = u.convert === 'ha' ? 'ha' : u.convert === 'sqm' ? 'm²' : '';
    const doc = resolveDoc(st, d.source?.file);
    const bn = cleanBuildingNumber(d.facility_building_number);
    const campus = str(d.campus);
    const tableId = str(d.table_id);
    const page = numOrUndef(d.source?.page);
    const source = { file: doc?.name ?? str(d.source?.file), page, excerpt: (str(d.source?.excerpt) ?? '').slice(0, 240) };
    const where = [doc?.name ?? str(d.source?.file), page != null ? `p. ${page}` : ''].filter(Boolean).join(' ') || 'a later row';
    const rank = doc ? doc.rank : fallbackRank(st);
    const tbl = tableId ? tableFor(st, tableId) : undefined;
    const meta: GroundsMeta = {
      // a row tagged with a table that was never declared is outside every declared table
      rank, file: doc?.name, page, table: tableId, inTable: Boolean(tbl?.declared) && !outsideTable(st, tbl!, doc?.name, page),
      campusSlug: campus ? slug(campus) || undefined : undefined, key: bn ? buildingKey(bn) : undefined,
      site: groundsStem(name), nameKey: lineKey(name) ?? '', desc: [], kind, canonUnit: canon.unit, where, qtyRank: rank, qtyPage: page,
    };
    meta.desc = descriptorOf(meta.nameKey, meta.site);
    // Table rows are counted per printed row: every area registered from one printed row (several quantities by type,
    // beds, trees; or one quantity split between buildings) carries that row as source.excerpt and counts once; out-of-
    // scope rows count too (they are rows of the printed table). A revision row from outside the table (an amendment
    // revising a site the table already lists) is not a printed row of the table.
    const ref = rowRefOf({ page, excerpt: d.source?.excerpt });
    const stem = groundsStem(name, bn);
    const tableRow = (fallbackKey: string, inScope: boolean) => {
      if (!tableId) return;
      tablesTouched.add(tableId);
      const t = tableFor(st, tableId);
      const k = ref ? `row:${ref}` : fallbackKey;
      const prev = t.rows.get(k);
      const outside = outsideTable(st, t, doc?.name, page);
      if (outside && !prev && [...t.rows.values()].some((r) => !r.outside && r.stem === stem)) {
        notes.push(`"${name}" (${[doc?.name && doc.name !== t.file ? doc.name : '', page != null ? `p. ${page}` : ''].filter(Boolean).join(' ') || 'another document'}) lies outside ${tableId}${t.pages ? ` (pages ${t.pages})` : ''}; it is counted as a revision of a site ${tableId} already lists, not as another printed row`);
      }
      t.rows.set(k, { sf: 0, inScope: inScope || Boolean(prev?.inScope), areaMissing: false, name, ref, stem, outside: outside && (prev?.outside ?? true) });
    };
    /**
     * The row's quantity as printed, for its table's totals: a printed row of the table, or a row tagged with it from outside
     * that revises nothing (it may be the only registration of a printed row); an outside row that revises an area is not.
     */
    const printed = (id: string, counted = true) => { if (tableId) st.groundsPrinted.push({ id, table: tableId, kind, canon, counted }); };
    const fmtNow = `${fmtQty(qty)} ${printedUnit || UNIT_LABEL[u.unit]}`;

    // 1. the same printed row again (same quantity): a duplicate, or a stated change of its status (the table row is
    //    already counted)
    const dedupe = [name, kind, quantity.toFixed(4), u.unit, bn ? buildingKey(bn) : '', campus ?? '', str(d.source?.excerpt) ?? ''].join('|').toLowerCase();
    const seen = st.groundsSeen.get(dedupe);
    if (seen) {
      const cur = st.groundsStatus.get(seen.id);
      if (bucketOf(cur) === bucketOf(statusEff) && (cur === statusEff || !isOut(statusEff))) { dup++; return; }
      if (isOut(statusEff)) {
        const m = st.groundsMeta.get(seen.id);
        if (!seen.revision && m?.revisedBy && !isOut(cur)) {
          // the printed figure was superseded by a later row: that revision stays in scope
          notes.push(`"${name}" ${fmtNow}: the printed figure is already superseded by the revision from ${m.revisedBy}, which stays in scope (to remove the area, register the revising row again with this status)`);
          dup++; return;
        }
        retireGrounds(st, seen.id, statusEff, reason); retired++;
        notes.push(`"${name}" ${fmtNow} is now ${statusEff}${reason ? ` (${reason})` : ''}`);
        return;
      }
      if (!reason) { notes.push(`"${name}" is registered as ${cur}; to put it back in scope, send status in_scope with a status_reason quoting the document`); dup++; return; }
      restoreGrounds(st, seen.id, events); retired++;
      notes.push(`"${name}" ${fmtNow} is back in scope (${reason})`);
      return;
    }

    // 2. a length (edging, curbs, fence lines): recorded and reconciled, never an area of any kind. A walk printed only as
    //    a length (no width) stays a sidewalk area in LF, which the estimate prices at an assumed width.
    const walkLength = u.unit === 'lf' && kind === 'sidewalk' && WALK_NAME.test(meta.nameKey) && !LINEAR_FEATURE.test(meta.nameKey);
    if (walkLength) walks.push(`"${name}" ${fmt(qty)} LF`);
    if (u.unit === 'lf' && !walkLength) {
      const id = `len-${st.lengths.length + 1}-${slug(name) || kind}`;
      st.lengths.push({ id, name, status: statusEff, reason, quantity: qty, unit: 'lf', table: tableId, kind, canon });
      st.groundsStatus.set(id, statusEff);
      st.groundsSeen.set(dedupe, { id, revision: false });
      printed(id);
      tableRow(id, !isOut(statusEff));
      lengths.push(`"${name}" ${fmt(qty)} LF`);
      return;
    }

    // 3. a later row (Q&A, amendment, or the amendment part of a combined file) that revises one registered area
    const targets = groundsMatches(st, meta, 'revises');
    if (targets.length === 1) {
      const id = targets[0]; const m = st.groundsMeta.get(id)!;
      st.groundsSeen.set(dedupe, { id, revision: true });
      if (meta.inTable) printed(id); // a printed row of its own table (a conformed or amendment table) still counts there
      else if (tableId) st.groundsPrinted.push({ id, table: tableId, kind, canon, counted: false });
      tableRow(`rev-${id}`, !isOut(statusEff));
      if (rank < m.qtyRank || (rank === m.qtyRank && (page ?? 0) < (m.qtyPage ?? 0))) {
        notes.push(`"${name}" (${where}) ranks below the revision already applied from ${m.revisedBy ?? m.where}; that one is kept`);
        return;
      }
      m.qtyRank = rank; m.qtyPage = page; m.revisedBy = where; revised++;
      const cur = st.groundsStatus.get(id);
      const g = st.grounds.find((x) => x.id === id) ?? st.excludedGrounds.find((x) => x.id === id)?.area;
      const was = g ? `${fmtQty(g.quantity)} ${UNIT_LABEL[g.unit]}` : '';
      const kept = tableId && meta.inTable ? tableId : m.table ?? 'its table';
      const setQuantity = () => {
        if (!g) return;
        g.quantity = Math.round(quantity * 1000) / 1000; g.unit = u.unit; g.source = source;
        g.notes = joinNotes(g.notes, `Revised by ${where}: was ${was}`);
        const e = st.excludedGrounds.find((x) => x.id === id);
        if (e) { e.quantity = g.quantity; e.unit = g.unit; e.canon = canonGrounds(g.quantity, g.unit); }
      };
      if (isOut(statusEff)) {
        // a deletion keeps the area's last in-scope figure; a revised figure of an area already out of scope is kept
        if (isOut(cur) && quantity > 0) setQuantity();
        retireGrounds(st, id, statusEff, reason ?? `per ${where}`);
        notes.push(isOut(cur) ? `"${g?.name ?? name}" (${statusEff}) revised to ${fmtNow} per ${where}; ${kept} keeps the printed figure` : `"${g?.name ?? name}" is now ${statusEff} per ${where}${g ? ` (was ${was} in scope)` : ''}`);
        return;
      }
      setQuantity();
      if (g) notes.push(`"${g.name}" revised from ${was} to ${fmtNow} per ${where}; ${kept} keeps the printed figure`);
      if (isOut(cur)) {
        if (reason) { restoreGrounds(st, id, events); notes.push(`"${g?.name ?? name}" is back in scope (${reason})`); }
        else notes.push(`"${g?.name ?? name}" stays ${cur}; to put it back in scope, send status in_scope with a status_reason quoting the document`);
      } else if (g) events.push({ type: 'grounds', area: g });
      return;
    }
    if (targets.length > 1) {
      notes.push(`"${name}" (${where}) may revise ${targets.length} registered areas (${targets.map((id) => `"${st.grounds.find((g) => g.id === id)?.name ?? st.excludedGrounds.find((x) => x.id === id)?.name ?? id}"`).join(', ')}); it is registered as a separate area - if it revises one of them, resend it with that area's exact name (and facility_building_number / campus)`);
    }

    // 4. a printed row that a revision registered earlier already supersedes (the revision was read first)
    const later = targets.length ? [] : groundsMatches(st, meta, 'revisedBy');
    if (later.length === 1) {
      const id = later[0]; const m = st.groundsMeta.get(id)!;
      st.groundsSeen.set(dedupe, { id, revision: false });
      // the revision, tagged with this table from outside it, was counted while nothing it revises was known: this printed
      // row is the table's (a revision is never a printed row of this table, see groundsRevises)
      if (tableId) for (const e of st.groundsPrinted) if (e.id === id && e.table === tableId) e.counted = false;
      printed(id);
      tableRow(`rev-${id}`, !isOut(statusEff));
      if (!m.revisedBy) m.revisedBy = m.where;
      const g = st.grounds.find((x) => x.id === id) ?? st.excludedGrounds.find((x) => x.id === id)?.area;
      if (g) g.notes = joinNotes(g.notes, `Revises ${fmtNow} printed in ${tableId ?? where}`);
      notes.push(`"${name}" ${fmtNow} (${where}) is superseded by the revision from ${m.where} registered earlier; ${tableId ?? 'its table'} keeps the printed figure`);
      return;
    }

    // 5. a new area (in scope), or a row out of the estimate (excluded, option-only, deleted ...); out-of-scope rows are
    //    numbered apart, so the ids of in-scope areas do not depend on them
    const outRow = isOut(statusEff);
    const g: GroundsArea = {
      id: outRow ? `gx-${++st.gxIdx}-${slug(name) || kind}` : `g-${++st.gIdx}-${slug(name) || kind}`,
      name, kind,
      quantity: Math.round(quantity * 1000) / 1000,
      unit: u.unit,
      campus,
      documentLabel: str(d.document_label),
      confidence: clamp01(d.confidence, 0.7),
      notes: joinNotes(printedUnit ? `Converted from ${qty.toLocaleString('en-US')} ${printedUnit}` : '', walkLength ? 'Printed only as a length; the estimate assumes a 5-ft width' : '', d.mowing_frequency_text ? `Mowing as printed: ${d.mowing_frequency_text}` : '', str(d.notes)),
      source,
    };
    for (const k of Object.keys(g) as (keyof GroundsArea)[]) if (g[k] === undefined) delete g[k];
    st.groundsSeen.set(dedupe, { id: g.id, revision: false });
    st.groundsMeta.set(g.id, meta);
    st.groundsStatus.set(g.id, statusEff);
    st.groundsLinks.set(g.id, { key: meta.key, campusSlug: meta.campusSlug, bn });
    printed(g.id);
    if (outRow) {
      // option-only areas (an optional site or CLIN) are out of the base estimate, like option-only buildings
      st.excludedGrounds.push({ id: g.id, name, status: statusEff, reason, quantity: qty, unit: String(d.unit), table: tableId, kind, canon, area: g }); out++;
      tableRow(`out-${g.id}`, false);
      return;
    }
    st.grounds.push(g);
    tableRow(g.id, true);
    events.push({ type: 'grounds', area: g });
    n++;
  });
  events.push(progressEvent(st));
  const progress = [...tablesTouched].map((tid) => { const t = st.tables.get(tid)!; return `${tid}: ${printedRows(t).length}${t.rowCount != null ? ` of ${t.rowCount}` : ''} rows`; });
  const text = [
    `Registered ${n} grounds areas in scope${out ? ` and ${out} out of scope` : ''} (${st.grounds.length} in scope + ${st.excludedGrounds.length} out of scope in total)${dup ? `; ${dup} duplicates of already-registered areas skipped` : ''}.`,
    revised || retired ? `Applied ${revised ? `${revised} ${revised === 1 ? 'revision' : 'revisions'} of registered areas` : ''}${revised && retired ? ' and ' : ''}${retired ? `${retired} status ${retired === 1 ? 'change' : 'changes'}` : ''}.` : '',
    lengths.length ? `Recorded as ${lengths.length === 1 ? 'a length' : 'lengths'}, not areas: ${listLabels(lengths, 3)}. A length is never added to sidewalk, parking or any other area (edging and trimming are priced with the turf they border); its LF still counts toward the table's rows and LF totals.` : '',
    walks.length ? `${listLabels(walks, 3)} ${walks.length === 1 ? 'is a walk' : 'are walks'} printed only as a length: kept as a sidewalk area (the estimate assumes a 5-ft width).` : '',
    progress.length ? `Progress: ${progress.join('; ')}.` : '',
    bad.length ? `Rejected ${bad.length}: ${bad.slice(0, 6).join(' | ')}${bad.length > 6 ? ` | … ${bad.length - 6} more` : ''}.` : '',
    notes.length ? `Note: ${notes.slice(0, 4).join(' | ')}${notes.length > 4 ? ` | … ${notes.length - 4} more` : ''}.` : '',
  ].filter(Boolean).join(' ');
  return { resultText: text, isError: n === 0 && dup === 0 && out === 0 && revised === 0 && retired === 0 && lengths.length === 0, events };
}

// ------------------------------------------------------------------------------------------------
// tables and completeness
// ------------------------------------------------------------------------------------------------

function declareTables(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const list = Array.isArray(input.tables) ? input.tables : [];
  if (!list.length) return { resultText: 'No tables in the call - pass them in "tables": [...].', isError: true, events: [] };
  const done: string[] = []; const bad: string[] = []; const notes: string[] = [];
  list.forEach((raw, i) => {
    const p = TableIn.safeParse(raw);
    if (!p.success) { bad.push(`table ${i + 1}: ${zIssues(p.error)}`); return; }
    const d = p.data;
    const id = str(d.table_id) ?? str(d.title) ?? `T${st.tables.size + 1}`;
    const unit = unitOf(d.area_unit);
    if (unit === null) { bad.push(`${id}: area_unit "${d.area_unit}" must be sf, sm or sy (or null for a grounds or dining table)`); return; }
    const printed = d.printed_total_gross_area !== undefined ? numOrUndef(d.printed_total_gross_area) : undefined;
    const legacy = numOrUndef(d.total_gross_sqft);
    const kindIn = String(d.kind ?? '').toLowerCase();
    const kind: DeclaredTable['kind'] = /ground|landscap|turf|acre/.test(kindIn) ? 'grounds' : /dining|food|meal|headcount/.test(kindIn) ? 'dining' : /other|info|price|schedule/.test(kindIn) ? 'other' : 'facilities';
    const totals: PrintedTotal[] = []; let badTotal = '';
    for (const pt of d.printed_totals ?? []) {
      const value = numOrUndef(pt.value); const u = printedUnitOf(pt.unit);
      if (value == null || !u) { badTotal = `${id}: printed_totals entry ${JSON.stringify({ value: pt.value, unit: pt.unit })} needs a number and a unit (acres, hectares, sqft, sqm, sqyd, lf or each)`; break; }
      const kinds = [...new Set([...(pt.kinds ?? []), ...(pt.kind ? [pt.kind] : [])].map((k) => String(k).toLowerCase().trim()).filter(Boolean).map((k) => (KIND_IDS.includes(k) ? k : mapGroundsLabel(k)) as GroundsKind))];
      totals.push({ value, unit: u, kinds, canon: canonGrounds(value, u) });
    }
    if (badTotal) { bad.push(badTotal); return; }
    const t = tableFor(st, id);
    t.title = str(d.title) ?? t.title; t.kind = kind; t.file = resolveDoc(st, d.file)?.name ?? str(d.file) ?? t.file;
    t.pages = d.pages != null ? String(d.pages) : t.pages;
    const rc = numOrUndef(d.row_count); t.rowCount = rc != null ? Math.round(rc) : t.rowCount;
    if (kind === 'grounds') {
      // grounds totals are reconciled per unit (and kind) against the areas registered from the table
      if (!totals.length && printed != null) {
        if (unit) totals.push({ value: printed, unit: ({ sf: 'sqft', sm: 'sqm', sy: 'sqyd' } as const)[unit], kinds: [], canon: canonGrounds(printed, ({ sf: 'sqft', sm: 'sqm', sy: 'sqyd' } as const)[unit]) });
        else notes.push(`${id}: printed_total_gross_area ignored (no area_unit) - give grounds totals in printed_totals with their unit`);
      }
      if (totals.length) t.totals = totals;
    } else {
      const areaTotal = totals.find((x) => (x.unit === 'sqft' || x.unit === 'sqm' || x.unit === 'sqyd') && !x.kinds.length);
      const fromTotals = printed == null && legacy == null && areaTotal ? { value: areaTotal.value, unit: ({ sqft: 'sf', sqm: 'sm', sqyd: 'sy' } as Record<string, AreaUnit>)[areaTotal.unit] } : undefined;
      if (printed != null && !unit) notes.push(`${id}: no area_unit given, so the printed total is read as SF - re-declare with area_unit if it is in SM or SY`);
      // printed square feet keep their decimals; converted totals are rounded like the rows
      const totalSqft = (v: number, u: AreaUnit) => (u === 'sf' ? Math.round(v * 100) / 100 : Math.round(v * SQFT_PER[u]));
      if (printed != null) { t.totalPrinted = { value: printed, unit: unit ?? 'sf' }; t.totalGrossSqft = totalSqft(printed, unit ?? 'sf'); }
      else if (legacy != null) { t.totalPrinted = { value: legacy, unit: 'sf' }; t.totalGrossSqft = totalSqft(legacy, 'sf'); }
      else if (fromTotals) { t.totalPrinted = fromTotals; t.totalGrossSqft = totalSqft(fromTotals.value, fromTotals.unit); }
      if (totals.length) t.totals = totals;
    }
    t.pass = st.pass; t.declared = true;
    const shown: string[] = [];
    if (t.rowCount != null) shown.push(`${t.rowCount} rows`);
    if (t.kind !== 'grounds' && t.totalPrinted && t.totalGrossSqft) shown.push(`total ${fmtQty(t.totalPrinted.value)} ${t.totalPrinted.unit.toUpperCase()}${t.totalPrinted.unit !== 'sf' ? ` = ${fmt(t.totalGrossSqft)} SF` : ''}`);
    if (t.kind === 'grounds') for (const x of t.totals ?? []) shown.push(`total ${fmtQty(x.value)} ${UNIT_LABEL[x.unit]}${x.kinds.length ? ` ${x.kinds.join('/')}` : ''}`);
    done.push(`${id}${shown.length ? ` (${shown.join('; ')})` : ''}`);
  });
  const events: ExtractionEvent[] = done.length ? [progressEvent(st)] : [];
  return {
    resultText: `${done.length ? `Declared ${done.join(', ')}. Tag every row with its table_id; finish is checked against these counts and totals.` : 'No tables declared.'}${notes.length ? ` Note: ${notes.join(' | ')}.` : ''}${bad.length ? ` Rejected: ${bad.join(' | ')}` : ''}`,
    isError: done.length === 0, events,
  };
}

export interface TableGap { table: string; title: string; message: string }

/** Smallest tolerance for a grounds total, per canonical unit (printed totals are often rounded). */
const MIN_TOL: Record<CanonUnit, number> = { acres: 0.05, sqft: 5, lf: 1, each: 0.5 };

/**
 * Grounds quantities of a table as printed (a later revision of an area does not change them), in canonical units, with
 * the area's current status: in scope, option-only, or another out-of-scope status. Lengths (lf) included.
 */
function groundsOfTable(st: ExtractionState, tableId: string): { kind: GroundsKind; canon: { unit: CanonUnit; qty: number }; bucket: 'in' | 'option' | 'out' }[] {
  return st.groundsPrinted.filter((e) => e.table === tableId && e.counted).map((e) => ({ kind: e.kind, canon: e.canon, bucket: bucketOf(st.groundsStatus.get(e.id)) }));
}

/**
 * Which registered rows a printed total covers: all rows, the in-scope rows, the base rows (in scope + excluded, without
 * option-only rows: optional sites and CLINs printed below a base total), or in scope + option-only. undefined = none.
 */
function totalBasis(inQ: number, exQ: number, opQ: number, target: number, tol: number): string | undefined {
  const near = (x: number) => Math.abs(x - target) <= tol;
  if (near(inQ)) return 'in-scope rows';
  if (near(inQ + exQ + opQ)) return 'all rows';
  if (exQ && opQ && near(inQ + exQ)) return 'in-scope and out-of-scope rows without the option-only rows';
  if (exQ && opQ && near(inQ + opQ)) return 'in-scope and option-only rows';
  return undefined;
}
/** "(+13,820 SF out of scope, +16,540 SF option-only)" */
const outBreakdown = (exQ: number, opQ: number, f: (n: number) => string) => (exQ || opQ ? ` (${[exQ ? `+${f(exQ)} out of scope` : '', opQ ? `+${f(opQ)} option-only` : ''].filter(Boolean).join(', ')})` : '');

/** Tables whose registered rows, SF or grounds quantities do not reconcile with the declared row count / printed totals. */
export function completeness(st: ExtractionState, onlyPass?: number): TableGap[] {
  return reconcile(st, onlyPass).gaps;
}

/** completeness, plus the printed totals that reconciled on a basis other than the in-scope or all rows (for finish). */
function reconcile(st: ExtractionState, onlyPass?: number): { gaps: TableGap[]; bases: string[] } {
  const out: TableGap[] = []; const bases: string[] = [];
  for (const t of st.tables.values()) {
    if (!t.declared || (onlyPass != null && t.pass !== onlyPass)) continue;
    const rows = printedRows(t);
    const outCount = rows.filter((r) => !r.inScope).length;
    const label = t.title && t.title !== t.id ? `${t.id} (${t.title})` : t.id;
    // facilities registered from several printed rows of this table with different areas: the inventory keeps one area
    const doubledIds = [...new Set([...t.rows.keys()].filter((k) => k.includes('#')).map((k) => k.slice(0, k.indexOf('#'))))];
    if (t.rowCount != null) {
      if (rows.length < t.rowCount) out.push({ table: t.id, title: t.title, message: `${label}: ${rows.length} of ${t.rowCount} rows registered${outCount ? ` (${outCount} out of scope)` : ''}` });
      else if (rows.length > t.rowCount) {
        const doubled = doubledIds.map((id) => t.rows.get(id)?.name ?? id);
        const why = doubled.length ? `; ${doubled.join(', ')} counted on more than one row (printed twice with different areas)` : '';
        out.push({ table: t.id, title: t.title, message: `${label}: ${rows.length} rows registered but the table was declared with ${t.rowCount}${why} - re-declare it if row_count was wrong (a printed row with several quantities is one row); never register subtotal or total rows` });
      }
    }
    for (const id of doubledIds) {
      const areas = tableRowsOf(t, id).map((r) => r.sf);
      const kept = st.facilities.get(id)?.grossSqft ?? 0;
      out.push({ table: t.id, title: t.title, message: `${label}: ${t.rows.get(id)?.name ?? id} is printed on ${areas.length} rows with different areas (${areas.map(fmt).join(' and ')} SF) but the inventory keeps one building of ${fmt(kept)} SF - if the rows are separately priced parts of it (one line per cleaning level, wing or schedule), resend each row with line_item set to what tells them apart; if one row corrects the other, name ${t.id} in unresolved` });
    }
    if (t.totalGrossSqft && t.kind !== 'grounds') {
      const sum = (f: (r: TableRowInfo) => boolean) => rows.filter((r) => f(r) && !r.areaMissing).reduce((s, r) => s + r.sf, 0);
      const inSf = sum((r) => r.inScope);
      const opSf = sum((r) => !r.inScope && Boolean(r.option));
      const exSf = sum((r) => !r.inScope && !r.option);
      const tol = Math.max(5, t.totalGrossSqft * 0.005, rows.length);
      const basis = totalBasis(inSf, exSf, opSf, t.totalGrossSqft, tol);
      if (!basis) {
        const printed = t.totalPrinted && t.totalPrinted.unit !== 'sf' ? ` (${fmt(t.totalPrinted.value)} ${t.totalPrinted.unit.toUpperCase()})` : '';
        out.push({ table: t.id, title: t.title, message: `${label}: registered ${fmt(inSf)} SF${outBreakdown(exSf, opSf, (x) => `${fmt(x)} SF`)} vs printed total ${fmt(t.totalGrossSqft)} SF${printed}` });
      } else if (!['in-scope rows', 'all rows'].includes(basis)) bases.push(`${t.id} total ${fmt(t.totalGrossSqft)} SF = its ${basis}`);
    }
    if (t.kind === 'grounds' && t.totals?.length) {
      const areas = groundsOfTable(st, t.id);
      for (const tot of t.totals) {
        // lengths are not areas of a kind: a table's only LF total covers all its lengths; with several LF totals, each covers
        // the lengths of the kinds it names (all of them when none carries those kinds)
        const anyKind = tot.canon.unit === 'lf' && (t.totals.filter((x) => x.canon.unit === 'lf').length === 1 || !areas.some((a) => a.canon.unit === 'lf' && tot.kinds.includes(a.kind)));
        const sel = areas.filter((a) => a.canon.unit === tot.canon.unit && (!tot.kinds.length || anyKind || tot.kinds.includes(a.kind)));
        const q = (b: string) => sel.filter((a) => a.bucket === b).reduce((s, a) => s + a.canon.qty, 0);
        const inQ = q('in'); const exQ = q('out'); const opQ = q('option');
        const tol = Math.max(Math.abs(tot.canon.qty) * 0.005, MIN_TOL[tot.canon.unit]);
        // shown in the printed unit
        const per = tot.value ? tot.canon.qty / tot.value : 1;
        const u = UNIT_LABEL[tot.unit];
        const kinds = tot.kinds.length ? ` ${tot.kinds.join('/')}` : '';
        const basis = totalBasis(inQ, exQ, opQ, tot.canon.qty, tol);
        if (basis) { if (!['in-scope rows', 'all rows'].includes(basis)) bases.push(`${t.id} total ${fmtQty(tot.value)} ${u}${kinds} = its ${basis}`); continue; }
        out.push({ table: t.id, title: t.title, message: `${label}: registered ${fmtQty(inQ / per)} ${u}${kinds}${outBreakdown(exQ / per, opQ / per, (x) => `${fmtQty(x)} ${u}`)} vs printed total ${fmtQty(tot.value)} ${u}${kinds}` });
      }
    }
  }
  return { gaps: out, bases };
}

/** Held update rows whose building was never registered (one gap per building). */
function pendingGaps(st: ExtractionState, onlyPass?: number): TableGap[] {
  const by = new Map<string, PendingRow[]>();
  for (const p of st.pending) if (onlyPass == null || p.pass === onlyPass) by.set(p.label, [...(by.get(p.label) ?? []), p]);
  return [...by.entries()].map(([label, ps]) => {
    const tables = [...new Set(ps.map((p) => p.row.tableId).filter(Boolean))];
    return { table: label, title: '', message: `${label}: ${ps.length} ${ps.length === 1 ? 'row' : 'rows'}${tables.length ? ` from ${tables.join(', ')}` : ''} add data to building ${label}, which was never registered with an area - register it (gross_area as printed, or area_missing=true), or name it in unresolved if it is not part of the inventory` };
  });
}

const mentions = (texts: string[], g: TableGap) => texts.some((u) => { const l = u.toLowerCase(); return l.includes(g.table.toLowerCase()) || (g.title.length > 3 && l.includes(g.title.toLowerCase())); });

export const noFinishWarning = (pass: number) => `AI pass ${pass} ended without calling finish - the inventory may be incomplete.`;

function finish(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const events: ExtractionEvent[] = [];
  const p = FinishIn.safeParse(input);
  const summary = p.success ? str(p.data.summary) ?? '' : '';
  const unresolved = p.success ? (p.data.unresolved ?? []).map(String).filter((s) => s.trim()) : [];
  st.finishAttempts++;
  const rec = reconcile(st, st.pass);
  const gaps = [...rec.gaps, ...pendingGaps(st, st.pass)];
  // A gap counts as explained only when an earlier refused finish showed it (with these figures) and unresolved names
  // it: an unresolved entry written before the model saw the gap must not waive it.
  const explainedOk = (g: TableGap) => st.shownGaps.has(g.message) && mentions(unresolved, g);
  const unexplained = gaps.filter((g) => !explainedOk(g));
  if (unexplained.length && st.finishAttempts <= 2) {
    const namedUnseen = unexplained.filter((g) => mentions(unresolved, g) && !st.shownGaps.has(g.message));
    for (const g of gaps) st.shownGaps.add(g.message);
    const ids = [...new Set(namedUnseen.map((g) => g.table))];
    return {
      resultText: `Not finished - ${unexplained.length === 1 ? 'this does' : 'these do'} not reconcile: ${unexplained.map((g) => g.message).join(' | ')}. Register the missing rows (or correct them), or call finish again naming each table_id in unresolved with the reason the printed figures differ.${ids.length ? ` ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} named in unresolved, but these figures are shown here for the first time: if your explanation accounts for them, call finish again with it.` : ''}`,
      isError: true, events,
    };
  }
  for (const g of gaps) st.shownGaps.add(g.message);
  st.finishes.set(st.pass, { summary, unresolved, gaps: gaps.map((g) => g.message) });
  if (unexplained.length) events.push({ type: 'warning', message: `Finish accepted after ${st.finishAttempts - 1} refusals with unreconciled tables: ${unexplained.map((g) => g.message).join(' | ')}` });
  const explained = gaps.filter((g) => !unexplained.includes(g));
  if (explained.length) events.push({ type: 'warning', message: `Tables that do not reconcile (explained by the model): ${explained.map((g) => g.message).join(' | ')}` });
  events.push({ type: 'ai_text', text: `Finished: ${summary}${unresolved.length ? `\nUnresolved: ${unresolved.join('; ')}` : ''}`, kind: 'text' });
  const inScope = [...st.facilities.values()].filter((f) => !f.status || f.status === 'in_scope').length;
  return {
    resultText: [
      `Acknowledged: ${inScope} in-scope facilities, ${st.facilities.size - inScope} out of scope; ${st.grounds.length} grounds areas in scope + ${st.excludedGrounds.length} out of scope${st.lengths.length ? `; ${st.lengths.length} ${st.lengths.length === 1 ? 'length' : 'lengths'} (LF) recorded, not areas` : ''}.`,
      rec.bases.length ? `Reconciled: ${rec.bases.join('; ')}.` : '',
      explained.length ? `Accepted with ${explained.length} unreconciled ${explained.length === 1 ? 'item' : 'items'} explained in unresolved: ${explained.map((g) => g.message).join(' | ')}.` : '',
      unexplained.length ? `Accepted after ${st.finishAttempts - 1} refusals with ${unexplained.length} unexplained ${unexplained.length === 1 ? 'gap' : 'gaps'}: ${unexplained.map((g) => g.message).join(' | ')}.` : '',
    ].filter(Boolean).join(' '),
    isError: false, events,
  };
}

// ------------------------------------------------------------------------------------------------
// site / previous award
// ------------------------------------------------------------------------------------------------

function setSite(st: ExtractionState, input: Record<string, unknown>): ApplyResult {
  const p = SiteIn.safeParse(input);
  if (!p.success) return { resultText: `Invalid site info: ${zIssues(p.error)}`, isError: true, events: [] };
  const s = p.data; const climate = String(s.climate_zone ?? '').toLowerCase();
  const years = numOrUndef(s.contract_years); const weeks = numOrUndef(s.growing_season_weeks);
  // stated snow / ice event counts (plowing, walk clearing) are kept in the site notes; the estimate's snow factors use
  // the climate default until the site record carries them. A count left null keeps the one stated earlier, and
  // restated notes keep the counts.
  const lots = numOrUndef(s.snow_events_per_year); const walks = numOrUndef(s.walk_clearing_events_per_year);
  if (lots != null || walks != null) st.snowEvents = { lots: lots ?? st.snowEvents?.lots, walks: walks ?? st.snowEvents?.walks };
  const ev = st.snowEvents;
  const snow = ev ? `${SNOW_NOTE}: ${[ev.lots != null ? `${fmtQty(ev.lots)} plowing` : '', ev.walks != null ? `${fmtQty(ev.walks)} walk clearing` : ''].filter(Boolean).join(', ')}` : undefined;
  const keptNotes = (str(s.notes) ?? st.site.notes)?.split('; ').filter((x) => !x.startsWith(SNOW_NOTE)).join('; ');
  st.site = {
    ...st.site,
    installationName: str(s.installation_name) ?? st.site.installationName,
    location: str(s.location) ?? st.site.location,
    solicitation: str(s.solicitation) ?? st.site.solicitation,
    contractName: str(s.contract_name) ?? st.site.contractName,
    climateZone: ((CLIMATES as readonly string[]).includes(climate) ? climate : st.site.climateZone) as SiteInfo['climateZone'],
    growingSeasonWeeks: weeks != null ? Math.round(weeks) : st.site.growingSeasonWeeks,
    contractYears: years != null ? years : st.site.contractYears,
    notes: snow ? [keptNotes, snow].filter(Boolean).join('; ') : str(s.notes) ?? st.site.notes,
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
  if (st.pending.length) {
    const labels = [...new Set(st.pending.map((p) => `${p.label}${p.row.tableId ? ` (${p.row.tableId})` : ''}`))];
    warnings.push(`${st.pending.length} ${st.pending.length === 1 ? 'row' : 'rows'} without an area that only add data were never matched to a registered building and were dropped: ${listLabels(labels)}.`);
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
    st.lengths.length ? `Lengths (LF, not priced as areas): ${st.lengths.map((e) => `${e.name} ${fmt(e.quantity)} LF${isOut(e.status) ? ` (${e.status})` : ''}`).join('; ')}` : '',
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

/** Compact "bn [line item]|campus|sf|status" lines of everything registered so far (for later AI passes). */
export function registeredSummary(st: ExtractionState): string {
  const perKey = new Map<string, number>();
  for (const m of st.meta.values()) if (m.key) { const k = `${m.campusSlug ?? ''}|${m.key}`; perKey.set(k, (perKey.get(k) ?? 0) + 1); }
  return [...st.facilities.values()].map((f) => {
    const m = st.meta.get(f.id);
    // separate line items of one building: say which line
    const line = m?.line ? m.lineLabel ?? m.line : m?.key && (perKey.get(`${m.campusSlug ?? ''}|${m.key}`) ?? 0) > 1 ? `"${f.name.slice(0, 40)}"` : '';
    const bn = f.buildingNumber ? `${f.buildingNumber}${line ? ` [${line}]` : ''}` : `"${f.name.slice(0, 40)}"`;
    return [bn, f.campus ?? '', f.grossSqft, f.status && f.status !== 'in_scope' ? f.status : ''].join('|').replace(/\|+$/, '');
  }).join('\n');
}
/** Compact "name|kind|quantity unit|building" lines of the grounds registered so far (for continuation requests). */
export function groundsSummary(st: ExtractionState): string {
  return [
    ...st.grounds.map((g) => [`"${g.name.slice(0, 40)}"`, g.kind, `${g.quantity} ${g.unit}`, st.groundsLinks.get(g.id)?.bn ?? ''].join('|').replace(/\|+$/, '')),
    ...st.excludedGrounds.map((e) => [`"${e.name.slice(0, 40)}"`, e.status, `${e.quantity} ${e.unit}`].join('|')),
    ...st.lengths.map((e) => [`"${e.name.slice(0, 40)}"`, isOut(e.status) ? `length, ${e.status}` : 'length', `${e.quantity} lf`].join('|')),
  ].join('\n');
}
export function tablesSummary(st: ExtractionState): string {
  return [...st.tables.values()].filter((t) => t.declared).map((t) => `${t.id}${t.title !== t.id ? ` "${t.title}"` : ''}${t.file ? ` in ${t.file}` : ''}: ${printedRows(t).length}${t.rowCount != null ? ` of ${t.rowCount}` : ''} rows registered`).join('\n');
}

// ------------------------------------------------------------------------------------------------
// tool definitions (JSON schema mirrors the zod validation above)
// ------------------------------------------------------------------------------------------------

type Schema = Record<string, unknown>;
const nullable = (type: string | string[], description?: string, extra: Schema = {}): Schema => ({ type: [...(Array.isArray(type) ? type : [type]), 'null'], ...(description ? { description } : {}), ...extra });
const obj = (properties: Record<string, Schema>, required: string[] = Object.keys(properties), description?: string): Schema => ({ type: 'object', ...(description ? { description } : {}), properties, required, additionalProperties: false });
const sourceSchema = obj({
  file: nullable('string', 'Document name exactly as listed in the package.'),
  page: nullable('integer', 'Page number ("--- page N ---" in text documents). Null for spreadsheets and Word files (name the sheet or section in the excerpt).'),
  excerpt: { type: 'string', description: 'The row or sentence the numbers came from (≤ 200 chars).' },
}, ['file', 'page', 'excerpt']);
const STATUS_KINDS = 'excluded (not in scope, N/A, information only, no service); deleted_by_amendment (struck through or deleted by an amendment / Q&A); demolished (demolished or scheduled for demolition, disposed); vacant (vacant, closed); option_only (only in an option period, as an optional site or optional CLIN; out of the base estimate like the other statuses)';
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
    table_id: nullable('string', 'table_id from declare_tables for the table this row is printed in, including rows a conformed or reissued table marks as revised in place. A row from an amendment\'s own change list or a Q&A answer (Item / Was / Is) gets that document\'s own declared table_id, or null - never the base table\'s id.'),
    campus: nullable('string', 'Installation, campus or site, when the package covers more than one. Same number on two campuses = two buildings.'),
    building_number: nullable('string', 'Exactly as printed, including letters, hyphens and leading zeros (0012, T-2401, 3105-B, P-114). Null if the row has no number.'),
    line_item: nullable('string', 'Only when one table prints this building on several rows that are separately priced parts of it (one row per cleaning level, wing, schedule or service class): what tells this row apart, as printed. Each line item is its own inventory line; a later revision of one line uses the same line_item. Null otherwise - never for tables that break down a building listed elsewhere (by floor, unit or room).'),
    name: { type: 'string', description: 'Facility name as printed.' },
    status: nullable('string', FACILITY_STATUS_DESC, { enum: [...STATUS_IDS, null] }),
    status_reason: nullable('string', 'Why the row is (not) in scope, quoting the document (e.g. "DEMO FY27 – EXCLUDE", "Deleted by Amendment 0002").'),
    category: nullable('string', 'Best-fit category.', { enum: [...CATEGORY_IDS, null] }),
    gross_area: nullable('number', 'Gross area exactly as printed, in area_unit (never converted, never added up). The gross is the whole area the contract covers at the facility: when the document counts separately listed units (portables, modulars, annexes) as part of it, give the building area here and the units in added_areas. Null only when the row prints no area (then set area_missing) or the row only adds data to a building whose area is printed elsewhere.'),
    added_areas: nullable('array', 'Units printed outside the area column that the document counts as part of this facility (portables, modulars, annexes: "4 @ 960" = {label: "portable classrooms", count: 4, unit_area: 960}; one entry per unit size), in area_unit. The tool adds count × unit_area to the gross and reconciles the table against gross_area as printed.', {
      items: obj({ label: { type: 'string' }, count: { type: 'number', description: 'Number of units as printed (1 for a single annex).' }, unit_area: { type: 'number', description: 'Area of one unit as printed.' } }),
    }),
    cleanable_area: nullable('number', 'Cleanable / serviced / custodial area as printed, in area_unit. Part of the gross and never larger: a larger "pricing" or "serviced" figure that includes extra structures is the gross (use added_areas). Null when the row prints none. A revision that changes only this area: gross_area null and cleanable_area the new figure.'),
    cleanable_equals_gross: nullable('boolean', 'true when the document says the gross area is the cleaning basis (no net / cleanable area surveyed, "gross area applies", "no deduction is made"); the tool sets the cleanable area to the gross, added_areas included. Leave null when the package says nothing about it.'),
    area_unit: { type: 'string', enum: ['sf', 'sm', 'sy'], description: 'Unit the areas are printed in: sf (square feet), sm (square meters), sy (square yards). The tool converts.' },
    area_missing: nullable('boolean', 'true when the document prints no area for this building anywhere. false (with gross_area null) for a row that only adds data to a building whose area another table prints.'),
    estimated_gross_area: nullable('number', 'Only with area_missing: your estimate in area_unit; give the basis in notes.'),
    floors: nullable('integer', 'Number of stories.'),
    fixtures: nullable('object', 'Restroom fixtures (toilets, urinals, sinks, showers - not rooms). When WC / UR / LAV / shower are separate columns fill them separately; the tool sums them.', {
      properties: { total: nullable('integer'), water_closets: nullable('integer'), urinals: nullable('integer'), lavatories: nullable('integer'), showers: nullable('integer') },
      required: ['total', 'water_closets', 'urinals', 'lavatories', 'showers'], additionalProperties: false,
    }),
    cleaning_detail: nullable('object', 'Only when the document prints any of these for this facility; null otherwise.', {
      properties: {
        restroom_rooms: nullable('integer', 'Number of restrooms (rooms, not fixtures) as printed, or the number of restroom rows a room list prints for the building.'),
        cleaning_standard: nullable('string', 'The cleaning level, standard or service class the document assigns to this facility, as printed.'),
        area_by_class: nullable('array', 'Areas split by cleaning class or infection-risk class, each with the class as printed, in area_unit.', { items: obj({ label: { type: 'string' }, area: { type: 'number' } }) }),
      },
      required: ['restroom_rooms', 'cleaning_standard', 'area_by_class'], additionalProperties: false,
    }),
    occupancy: nullable('integer'),
    service_level: nullable('string', 'Routine cleaning frequency. Mon–Sat / six days a week = daily_6. Bi-weekly = every two weeks (biweekly) unless the document defines it as twice a week.', { enum: [...LEVEL_IDS, null] }),
    service_days_per_year: nullable('integer', 'Only when the document states a number of service days per year that the levels cannot express (e.g. 180 school days + 20 summer days = 200). Otherwise null; for a seasonal window use service_season.'),
    service_season: nullable('object', 'Service for part of the year only, printed as a window: start and end as printed (a date, a month or a holiday) and the days per week in season; the tool counts the service days. service_level stays the in-season pattern.', {
      properties: { start: { type: 'string' }, end: { type: 'string' }, days_per_week: nullable('number') },
      required: ['start', 'end', 'days_per_week'], additionalProperties: false,
    }),
    events_per_year: nullable('integer', 'On-call or per-event cleaning with no routine frequency: the number of events per year the document states; each is one service day and they replace the routine calendar. Service on top of a routine frequency goes in additional_service_days.'),
    additional_service_days: nullable('object', 'Service days the document adds on top of the routine frequency (an extra weekend day on each drill or reserve weekend, opening and closing cleans of a seasonal building): days per year and what they are. The tool adds them to the routine days.', {
      properties: { days_per_year: { type: 'integer' }, label: { type: 'string' } }, required: ['days_per_year', 'label'], additionalProperties: false,
    }),
    service_frequency_text: nullable('string', 'The frequency exactly as printed (e.g. "M–F", "Daily (7 days)", "2x/month").'),
    scope: { type: 'array', items: { type: 'string', enum: [...SCOPES] }, description: 'Services that apply to this facility.' },
    floor_areas: nullable('array', 'Floor area by finish: one entry per finish column or legend code as printed ("CPT", "CPT-T", "VCT", "Sealed concrete", "Wood gym floor", "Restroom"), area in area_unit as printed - never converted, added up or divided. The tool maps finishes to carpet / resilient (VCT, vinyl, rubber, linoleum, a mixed hard-floor figure) / hard tile (ceramic, quarry, terrazzo, restroom floors) / concrete (sealed or polished concrete, epoxy) / wood, sums them, derives the floor mix and checks the sum against the cleanable area. included_in: only when the figure is also counted inside another printed figure of the row (a wood gym floor included in the hard-floor SF): that finish as sent; the tool takes it out of it.', {
      items: obj({ finish: { type: 'string' }, area: { type: 'number' }, included_in: nullable('string') }),
    }),
    floor_mix: nullable('object', 'Only when the document prints shares (percent or fractions) of floor area by finish (sum ≈ 1); when it prints square feet by finish use floor_areas.', {
      properties: { carpet: { type: 'number' }, resilient: { type: 'number' }, hard_tile: { type: 'number' }, concrete: { type: 'number' }, wood: { type: 'number' } },
      required: ['carpet', 'resilient', 'hard_tile', 'concrete', 'wood'], additionalProperties: false,
    }),
    dining: nullable('object', 'Food-service workload (headcounts, meals) of a dining facility; register each dining facility separately with its own headcount. Null when only custodial cleaning of a dining building is in scope.', {
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
        service_style: { type: 'string', enum: [...SERVICE_STYLES], description: 'full_food_service = the contractor cooks and serves (also satellite lines fed from a contractor-run kitchen); dining_facility_attendant = the contractor provides attendants and sanitation, with or without management, and Government staff cook; management_only = the contractor manages only.' },
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
    table_id: nullable('string', 'table_id of the table this area was printed in. A revision (an amendment change list, a Q&A answer): null, or that document\'s own table_id - never the base table\'s id; the tool matches it to the registered area by campus, name (or site / building) and kind.'),
    kind: { type: 'string', enum: KIND_IDS, description: 'Type I = improved_turf; Type II = semi_improved; Type III / IV = unimproved; BASH, airfield infield and clear zones are semi_improved or unimproved per the mowing frequency. Paved areas the contract plows or sweeps: lots, roads and drives = parking; walks, ramps, steps and slabs = sidewalk. For a length (unit lf): the kind of area it runs along.' },
    document_label: nullable('string', 'The document\'s own label ("Type II", "Category B", "BASH area").'),
    mowing_frequency_text: nullable('string', 'Mowing / service frequency as printed.'),
    status: { type: 'string', enum: STATUS_IDS, description: STATUS_DESC },
    status_reason: nullable('string'),
    quantity: { type: 'number', description: 'As printed, in unit.' },
    unit: { type: 'string', enum: ['acres', 'hectares', 'sqft', 'sqm', 'sqyd', 'lf', 'each'], description: 'Unit as printed; the tool converts hectares and sqm. lf is a length (edging, curbs, fence lines): recorded as a length, never added to an area (a walk printed in LF alone stays a sidewalk area).' },
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
              pages: nullable('string', 'Page range, e.g. "12-19". Null for spreadsheets and Word files (name the sheet or section in the title).'),
              row_count: nullable('integer', 'Number of printed building (or area) rows, excluding header, subtotal and total rows. A printed row with several quantities (areas by type, beds, trees) is one row.'),
              printed_total_gross_area: nullable('number', 'Facility tables: the printed total / grand total of the gross area column, as printed (in area_unit): the total of all rows, of the in-scope rows, or of the base rows without option-only rows (the check accepts each). A block with its own total (optional facilities or sites) may be declared as its own table. Grounds totals go in printed_totals.'),
              area_unit: nullable('string', 'Unit of the facility areas and of printed_total_gross_area. Null for a grounds or dining table.', { enum: ['sf', 'sm', 'sy', null] }),
              printed_totals: {
                type: 'array',
                description: 'Grounds tables: each printed total of a quantity you register from the table, as printed, with its unit, and the grounds kinds it covers when it is a column total for some kinds only (a Type I column, beds, trees; [] = every area of the table in that unit). Length totals (edging LF) are given with unit lf. Leave out totals that are information only, in a unit you do not register (site or parcel acres, lane-miles), or of a column that sums other columns. [] when there are none.',
                items: obj({
                  value: { type: 'number' },
                  unit: { type: 'string', enum: ['acres', 'hectares', 'sqft', 'sqm', 'sqyd', 'lf', 'each'] },
                  kinds: { type: 'array', items: { type: 'string', enum: KIND_IDS } },
                }),
              },
            }),
          },
        },
        required: ['tables'],
        additionalProperties: false,
      },
    }),
    {
      name: 'register_facilities',
      description: 'Register facilities (buildings) in table order, in batches of up to 50 rows per call. Keep each call short enough to finish well within the output limit; if a call is reported as cut off, resend exactly those rows in smaller batches. Register every row, including excluded / deleted / demolished / vacant rows with their status. Never register subtotal or total rows. A building seen again (other table, amendment, Q&A) is merged by building number + campus (+ line_item when one table prints it on several separately priced rows); a row without an area for a numbered building not registered yet is held until that building is registered.',
      input_schema: { type: 'object', properties: { facilities: { type: 'array', items: facility } }, required: ['facilities'], additionalProperties: false },
    },
    {
      name: 'register_grounds',
      description: 'Register grounds maintenance areas (turf acreage by type, athletic fields, beds, paved areas, walks, trees) as printed. A printed row with several quantities is registered as several areas that all carry that row as source.excerpt; the table counts it as one row. Never register total rows. Lengths (unit lf: edging, curbs, fences) are recorded as lengths, never as areas. A later row for a registered area (an amendment or Q&A) replaces its quantity: send it with the same name, campus and kind and the new quantity; to remove the area, send it with status deleted_by_amendment.',
      input_schema: { type: 'object', properties: { areas: { type: 'array', items: area } }, required: ['areas'], additionalProperties: false },
    },
    s({
      name: 'set_site_info',
      description: 'Record installation-level facts: name, location, solicitation, climate, growing season, contract period.',
      input_schema: obj({
        installation_name: nullable('string', 'The main installation, campus or agency name as printed on the title block, without location, state or the names of other sites (other sites go in facility campus and notes).'),
        location: nullable('string', 'City and state / country.'),
        solicitation: nullable('string'),
        contract_name: nullable('string'),
        climate_zone: nullable('string', 'From the stated climate, else inferred from the stated state or region.', { enum: [...CLIMATES, null] }),
        growing_season_weeks: nullable('integer'),
        snow_events_per_year: nullable('integer', 'Snow plowing events per season the document states for pricing.'),
        walk_clearing_events_per_year: nullable('integer', 'Sidewalk clearing / ice-control events per season, when stated separately from plowing.'),
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
        period_months: nullable('integer', 'Only with total_value: the months of performance it covers (base + options). For a stated term without a total, put the term in notes.'),
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
      description: 'Call once every facility and grounds area has been registered. Refused while declared tables do not reconcile; the refusal lists each gap. A gap counts as explained once a refusal has shown it and unresolved names its table_id with the reason the printed figures differ.',
      input_schema: obj({ summary: { type: 'string' }, unresolved: { type: 'array', items: { type: 'string' } } }) as Anthropic.Beta.BetaTool['input_schema'],
    }),
  ];
}
