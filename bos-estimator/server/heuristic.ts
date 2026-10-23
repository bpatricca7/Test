// Rule-based fallback reader. Used when no ANTHROPIC_API_KEY is configured, when the user picks the rule-based
// parser, or when the AI call fails, so the workbench still produces an inventory from the documents.
//
// It reads the layout-preserving text server/extract.ts produces: table rows as "cell | cell" with empty cells kept in
// position, flattened multi-row headers ("Square Feet Gross"), "--- page N ---" markers, [^n] footnote markers,
// ~~struck~~ text, XLSX sheets as "=== file :: sheet ===" blocks and key/value sheets as "Label | value" lines.
// Documents are read in precedence order (base → attachments → Q&A → amendments); within a document its tables are
// read first and its prose statements ("Building 118 is deleted…", "revised from 18,240 SF to 22,960 SF") after.
//
// Every rule here is meant to hold across real solicitations, not one package:
//  - a header row assigns a role to each column (building number, name, gross / cleanable area, unit of measure,
//    floors, fixtures, frequency, status, campus, meal periods, grounds quantities …); the map is suspended at blank
//    lines and page breaks, resumed only by rows that fit it, and replaced by the next header;
//  - total / subtotal / grand-total rows are skipped, grouping rows (campus / zone) are carried onto the rows below;
//  - areas are converted from SM / m² / mq / SY to square feet (originalArea keeps the printed value), decimal commas
//    ("1.234,5") are read when the table or its caption uses them;
//  - a building's gross area is never overwritten except by a later-ranked document;
//  - excluded / not in scope / vacant / closed / demolished / struck rows stay in the inventory with a status.
import type { AreaUnit, DiningProfile, Facility, FacilityCategory, FacilityStatus, GroundsArea, GroundsKind, GroundsUnit, Inventory, MealPeriodHeadcount, PriorAward, ServiceLevel, SiteInfo, SourceRef } from '../shared/types';
import { SQFT_PER } from '../shared/types';
import { mealsPerDayFromPeriods } from '../shared/estimate';
import { classifyDocument, type DocInput } from './extract';

// =====================================================================================================================
// Small text helpers
// =====================================================================================================================

const WORD_NUM: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, 'twenty-four': 24, thirty: 30, 'thirty-six': 36, forty: 40, 'forty-eight': 48, sixty: 60 };
const ORDINAL: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const dash = (s: string) => s.replace(/[‐‑‒–—―−]/g, '-');
/** Footnote markers ([^1], *, †), strike-through marks and surplus space removed. */
const clean = (s: string | undefined): string => (s == null ? '' : s.replace(/\[\^[^\]]*\]/g, '').replace(/~~/g, '').replace(/[*†‡§¶]+/g, '').replace(/\s+/g, ' ').trim());
const isStruck = (s: string | undefined) => !!s && /~~[^~]+~~/.test(s);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const wordOrNum = (s: string | undefined): number | undefined => { if (!s) return undefined; const t = s.toLowerCase().replace(/[()]/g, ''); if (/^\d+$/.test(t)) return Number(t); return WORD_NUM[t]; };

/** Number in a cell: the first numeric token after footnote markers and qualifiers ("approx.", "±") are removed. Reads
 *  U.S. ("1,234.5") and, when `eu` is set or the cell can only be European ("1.234,5", "96,4"), European formats. */
export function parseNumberCell(raw: string | undefined, eu = false): number | undefined {
  if (raw == null) return undefined;
  const s = clean(raw).replace(/\b(?:approx(?:imately)?|appx|ca|circa|about|est)\.?\s*/gi, '').replace(/[±~≈]/g, ' ');
  if (!/\d/.test(s)) return undefined;
  const euLike = eu || /\d{1,3}(?:\.\d{3})+,\d+/.test(s) || /(?:^|[^\d.,])\d+,\d{1,2}(?![\d,])/.test(s);
  if (euLike) {
    const m = s.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)|\d+(?:,\d+)?/);
    return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : undefined;
  }
  const m = s.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d*\.\d+|\d+/);
  return m ? Number(m[0].replace(/,/g, '')) : undefined;
}

const NUMERIC_CELL = /^[~±≈]?\s*(?:approx\.?\s*)?\$?\s*\d[\d.,]*\s*(?:%|[a-z²]{1,6}\.?)?$/i;
const isNumericCell = (c: string) => NUMERIC_CELL.test(clean(c));
const isBlankish = (c: string | undefined) => /^(?:[-–—.]+|n\/?a|n\/s|none|nil)?$/i.test(clean(c));

type QUnit = 'sf' | 'sm' | 'sy' | 'ac' | 'ha' | 'lf' | 'ea' | 'other';
/** Unit of measure printed in a header, a UM cell or after a number. */
function unitOf(raw: string | undefined): QUnit | undefined {
  if (!raw) return undefined;
  const t = ` ${clean(raw).toLowerCase()} `;
  const B = '[\\s(\\d/]', E = '(?=[\\s).,;:/]|$)';
  const has = (p: string) => new RegExp(`${B}(?:${p})${E}`).test(t);
  if (has('sm|sqm|sq\\.?\\s*m\\.?|m²|m2|mq|square met(?:er|re)s?|metri quadrati')) return 'sm';
  if (has('sf|s\\.f\\.|gsf|csf|nsf|sq\\.?\\s*f(?:ee|oo)?t\\.?|sq\\.?\\s*ft\\.?|square f(?:ee|oo)t(?:age)?|ft²|ft2')) return 'sf';
  if (has('sy|sq\\.?\\s*yds?\\.?|square yards?|yd²')) return 'sy';
  if (has('ha|hectares?|ettari')) return 'ha';
  if (has('ac|acres?|acreage')) return 'ac';
  if (has('lf|lin\\.?\\s*ft\\.?|linear f(?:ee|oo)t')) return 'lf';
  if (has('ea|each|n\\.|nr\\.?|trees?')) return 'ea';
  if (/^\s*(?:kv|kva|kw|ga|gal|mb|mbh|mo|lt|hr|hrs|ls|job|cy|cf|ton)\s*$/.test(t)) return 'other';
  return undefined;
}
const AREA_U: Record<string, AreaUnit> = { sf: 'sf', sm: 'sm', sy: 'sy' };
const GROUNDS_U: Record<string, GroundsUnit> = { ac: 'acres', ha: 'hectares', sf: 'sqft', sm: 'sqm', sy: 'sqyd', lf: 'lf', ea: 'each' };

// =====================================================================================================================
// Building numbers, frequencies, statuses, grounds kinds
// =====================================================================================================================

const BN_TOKEN = /^(?:[A-Z]{0,4}-?\d{1,7}[A-Z]{0,3}(?:-[A-Z0-9]{1,6})*|[A-Z]{2,5}\d{1,6}[A-Z]{0,3}(?:-[A-Z0-9]{1,4})?|[A-Z]{1,4}\d{0,3}\/[A-Z0-9]{1,6})$/;
/** Building number as printed (letters, hyphens and leading zeros kept): "Bldg 0012" → "0012", "T – 2401" → "T-2401". */
export function normalizeBuildingNumber(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = dash(clean(raw)).replace(/^(?:gsa\s+)?(?:bldgs?|buildings?|bld|facility|fac|loc(?:ation)?|site|structure)\.?\s*(?:no\.?|nr\.?|number|#)?\s*/i, '').replace(/^(?:no\.?|#)\s*/i, '').trim();
  s = s.replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
  if (!s || s.length > 16) return undefined;
  const u = s.toUpperCase();
  return BN_TOKEN.test(u) ? u : undefined;
}
/** Merge key: case, separators and leading zeros do not matter ("0012" = "12", "T-2401" = "T2401"). */
const bnKey = (bn: string) => bn.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
const nameKey = (s: string) => clean(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Service frequency wording → service level (monthly / quarterly / 2x per month are checked before weekly wording). */
export function serviceLevelFromText(raw: string | undefined): ServiceLevel | undefined {
  if (!raw) return undefined;
  const t = ` ${dash(clean(raw)).toLowerCase().replace(/\s*\/\s*/g, '/')} `;
  if (!/[a-z0-9]/.test(t)) return undefined;
  if (/quarterly|qtrly|\b1x\/q(?:tr|uarter)|once (?:a|per|each) (?:calendar )?quarter|\b4x\/(?:yr|year)|trimestral/.test(t)) return 'quarterly';
  if (/\b(?:2x|twice|two times)\s*(?:\/|per |a |each )?\s*mo(?:nth)?\b|semi-?monthly|\b2\/mo\b/.test(t)) return 'biweekly';
  if (/monthly|\b1x\/mo(?:nth)?\b|once (?:a|per|each) month|mensil|\b12x\/(?:yr|year)/.test(t)) return 'monthly';
  if (/bi-?weekly|bi-?wkly|every (?:two|2|other) weeks?|fortnight|quindicinal|alternate weeks|\b14-day/.test(t)) return 'biweekly';
  if (/\b7x|\b7\/7\b|\b7 ?days|seven days|daily \(7|24\/7|including weekends|every day|sun(?:day)?-sat|\b365 days|7 d\/w/.test(t)) return 'daily_7';
  if (/\b6x|\b6\/7\b|\b6 ?days|six days|\bm-sa(?:t)?\b|mon(?:day)?\s*(?:-|through|thru|to)\s*sat/.test(t)) return 'daily_5';
  if (/\b5x|\b5\/7\b|\b5 ?days|five days|\bm-f\b|mon(?:day)?\s*(?:-|through|thru|to)\s*fri|weekdays?|\bdaily\b|each workday|every workday|workdays/.test(t)) return 'daily_5';
  if (/\b4x\/(?:wk|week)|\b4\/7\b|four times|\b4 ?days|\bm-th\b/.test(t)) return '3x_week';
  if (/\b3x|\b3\/7\b|three times|\b3 times|\b3\/wk|\b3 ?days|\bm\/w\/f\b|mon(?:day)?,? wed(?:nesday)?,? (?:and )?fri|tri-?weekly|three (?:services|visits|days) (?:per|a) week/.test(t)) return '3x_week';
  if (/\b2x|\b2\/7\b|twice|two times|\b2 times|\b2\/wk|\b2 ?days|\bt\/th\b|tue(?:sday)?s?\s*(?:and|&|\/)\s*thu|\b2 v\/sett|two (?:services|visits|days) (?:per|a) week/.test(t)) return '2x_week';
  if (/\b1x|\b1\/7\b|weekly|once (?:a|per|each) week|\b1\/wk|settimanal|one day (?:per|a) week/.test(t)) return 'weekly';
  return undefined;
}
/** Service days per week (a numeric "Service Days/Week" column). */
const levelFromDays = (n: number): ServiceLevel | undefined => (n >= 7 ? 'daily_7' : n >= 5 ? 'daily_5' : n >= 3 ? '3x_week' : n >= 2 ? '2x_week' : n >= 1 ? 'weekly' : undefined);

/** Whole-building status wording in a row (remarks, frequency, name or status cell). Partial exclusions ("server rooms
 *  excluded", "kitchens excluded") are not statuses. */
export function statusFromText(raw: string | undefined, opts: { frequencyCell?: boolean } = {}): { status: FacilityStatus; reason: string } | undefined {
  const t = clean(raw);
  if (!t) return undefined;
  const l = dash(t).toLowerCase();
  const reason = t.slice(0, 160);
  if (/\bdeleted\b|\bremoved from (?:the )?(?:scope|requirement|list|contract)\b|\bdelete(?: from)? (?:scope|requirement)/.test(l)) return { status: 'deleted_by_amendment', reason };
  if (/demolish|\bdemo\b(?=\s*(?:fy|\d|-|$))|da demolire|to be razed|\brazed\b|\bdisposed\b|pending disposal|for disposal/.test(l)) return { status: 'demolished', reason };
  if (/\bvacant\b|\bclosed\b(?!-)|warm[- ]closure|mothball|\bunoccupied\b/.test(l)) return { status: 'vacant', reason };
  if (/not in scope|out of scope|not included|not part of (?:this|the)|do not price|shall not be priced|not to be priced|\bnot priced\b|no custodial service|not serviced|no routine service|no workload|uso italiano|^\s*exclude[ds]?\b|-\s*exclude[ds]?\b|\b(?:facility|building|bldg) (?:is )?excluded|^n\/a\b|for information only|information only|for reference only|not in contract|removed from scope/.test(l)) return { status: 'excluded', reason };
  if (/option(?:al)? (?:item|clin)s? only|option period only|\boption only\b/.test(l)) return { status: 'option_only', reason };
  if (opts.frequencyCell && /^(?:n\/?a|none|not serviced|0|-)$/.test(l)) return { status: 'excluded', reason: `Frequency "${t}"` };
  return undefined;
}

/** Grounds terminology → kind: Type I / II / III / IV, Category A / B / C, improved / semi-improved / unimproved,
 *  BASH, playing fields, beds, trees, paving. The most specific wording wins (a "planting bed in improved areas" is a bed). */
export function groundsKindFromText(raw: string | undefined): GroundsKind | undefined {
  if (!raw) return undefined;
  const t = ` ${dash(clean(raw)).toLowerCase()} `;
  if (/\btrees?\b|alberatur/.test(t)) return 'tree_canopy';
  if (/shrub|planting|flower ?beds?|\bbeds?\b|mulch|aiuol|\bhedges?\b|siep/.test(t)) return 'shrub_bed';
  if (/athletic|ball ?fields?|playing fields?|sports? fields?|soccer|softball|baseball|football field|campo sportiv|campi sportiv/.test(t)) return 'athletic_field';
  if (/parking|parchegg|hardstand|\bpov\b|\blots?\b/.test(t)) return 'parking';
  if (/sidewalk|walkway|\bwalks?\b|\bplazas?\b|marciapied|vialett|\bpavers?\b|stamped concrete|hardscape|\bslabs?\b|\bpaved\b|\bsteps\b/.test(t)) return 'sidewalk';
  const ty = typeKind(t);
  if (ty) return ty;
  if (/semi[- ]?improved|semi-?migliorat/.test(t)) return 'semi_improved';
  if (/\bbash\b/.test(t) && !/unimproved/.test(t)) return 'semi_improved';
  if (/unimproved|rough[- ]?mow|incolt|natural areas?|woodland|bush[- ]?hog/.test(t)) return 'unimproved';
  if (/improved|prato rasato|\blawns?\b|\bturf\b|\bmow(?:ed|able|ing)?\b|\bgrass\b|landscaped/.test(t)) return 'improved_turf';
  return undefined;
}
function typeKind(t: string): GroundsKind | undefined {
  if (/\b(?:type|tipo|class|category|cat\.?|grounds level)\s*(?:iv|iii|3|4|c|d)\b/.test(t)) return 'unimproved';
  if (/\b(?:type|tipo|class|category|cat\.?|grounds level)\s*(?:ii|2|b)\b/.test(t)) return 'semi_improved';
  if (/\b(?:type|tipo|class|category|cat\.?|grounds level)\s*(?:i|1|a)\b/.test(t)) return 'improved_turf';
  const r = t.trim().replace(/[()]/g, '');
  if (/^(?:iv|iii)$/.test(r)) return 'unimproved';
  if (r === 'ii') return 'semi_improved';
  if (r === 'i') return 'improved_turf';
  return undefined;
}
/** Grounds service level / mowing cycle → kind (Level 1 = improved, 2 = semi-improved, 3+ = unimproved; ≤10-day cycle = improved). */
function kindFromLevel(raw: string | undefined): GroundsKind | undefined {
  const t = clean(raw).toLowerCase();
  if (!t || isBlankish(t)) return undefined;
  const k = typeKind(` ${t} `) ?? groundsKindFromText(t);
  if (k) return k;
  const n = t.match(/^(?:level\s*)?(\d)\b/);
  if (n) return n[1] === '1' ? 'improved_turf' : n[1] === '2' ? 'semi_improved' : 'unimproved';
  return undefined;
}
function kindFromCycle(raw: string | undefined): GroundsKind | undefined {
  const m = clean(raw).toLowerCase().match(/(\d{1,3})[- ]?day/);
  if (!m) return undefined;
  const d = Number(m[1]);
  return d <= 10 ? 'improved_turf' : d <= 31 ? 'semi_improved' : 'unimproved';
}

const TOTAL_RE = /^(?:grand\s+)?(?:sub-?\s*)?totale?s?\b|\bsub-?\s*totale?s?\b|\bgrand\s+totals?\b|\btotals?\s*$|^sum\b|^\s*in all\b/i;
const isTotalRow = (cells: string[]) => cells.map(clean).filter(Boolean).slice(0, 3).some((c) => TOTAL_RE.test(c));

export function categorize(name: string): FacilityCategory {
  const n = ` ${name.toLowerCase()} `;
  if (/dining|dfac|mess hall|galley|cafeteria|food service|restaurant|mensa\b/.test(n)) return 'dining';
  if (/barracks|dormitor|\bdorm\b|bachelor|\bquarters\b|billet|lodging|\buph\b|\bueph\b|\buoph\b|\bbeq\b|\bboq\b|unaccompanied|residence hall|alloggi/.test(n)) return 'barracks';
  if (/clinic|medical|dental|hospital|\bhealth\b|pharmacy|ambulatorio/.test(n)) return 'medical';
  if (/hangar/.test(n)) return 'hangar';
  if (/warehouse|supply|storage|depot|\bcif\b|logistic|issue facility|magazzino|hazmat|hazardous material/.test(n)) return 'warehouse';
  if (/motor pool|maintenance|\bshops?\b|vehicle|\btmp\b|\bdol\b|repair|wash rack|\btemf\b|officina/.test(n)) return 'maintenance';
  if (/\bgym\b|gymnasium|fitness|physical|\bpool\b|sports|athletic|aquatic|natatorium|palestra/.test(n)) return 'fitness';
  if (/child|\bcdc\b|youth|daycare|day care|school age|asilo/.test(n)) return 'child_care';
  if (/chapel|religious|community|\bmwr\b|\bclub\b|recreation|theater|bowling|exchange|commissary|museum|arts and crafts|cappella|readiness center/.test(n)) return 'community';
  if (/school|education|training|classroom|academy|learning|library|instruction|istruzione/.test(n)) return 'education';
  if (/\blab\b|laborator|research|simulat|range control|test facility/.test(n)) return 'lab';
  if (/headquarters|\bhq\b|admin|office|command|brigade|battalion|center|annex|operations|\bops\b|finance|personnel|legal|\bjag\b|post office|police|fire station|security|visitor|service center|federal building|courthouse|comando|uffici/.test(n)) return 'admin';
  return 'other';
}

// =====================================================================================================================
// Column roles
// =====================================================================================================================

type Role = 'item' | 'number' | 'numberWeak' | 'name' | 'use' | 'typeish' | 'catcode' | 'rpaType' | 'floors' | 'gross' | 'cleanable' | 'area' | 'qty' | 'unit'
  | 'portable' | 'fixtures' | 'fixWC' | 'fixUR' | 'fixLAV' | 'fixSH' | 'freq' | 'daysOpen' | 'status' | 'remarks' | 'campus' | 'zone' | 'address' | 'year'
  | 'meal' | 'seats' | 'svcType' | 'gQty' | 'mows' | 'cycle' | 'svcLvl' | 'length' | 'width' | 'sides' | 'surface' | 'served' | 'rowKey' | 'change' | 'revised' | 'info';
interface Col { i: number; role: Role; text: string; unit?: QUnit; kind?: GroundsKind; meal?: string; weekend?: boolean; old?: boolean; newer?: boolean; slash?: boolean; days?: boolean }

const MEAL_RE = /\b(breakfast|brunch|lunch|dinner|supper|midnight|late\s*\/\s*midnight|late meal|late night|colazione|pranzo|cena)\b/;
function mealName(m: string): string {
  const t = m.toLowerCase();
  if (/midnight|late/.test(t)) return 'Midnight';
  if (/colazione/.test(t)) return 'Breakfast';
  if (/pranzo/.test(t)) return 'Lunch';
  if (/cena/.test(t)) return 'Dinner';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const normHeader = (c: string) => dash(clean(c)).toLowerCase().replace(/_/g, ' ').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** Role of one header cell. Order matters: specific roles are tested before generic ones. */
function roleOf(cell: string): Omit<Col, 'i' | 'text'> | null {
  const h = normHeader(cell);
  if (!h || /^\(\d+\)$/.test(h)) return null;
  const u = unitOf(h);
  const meal = h.match(MEAL_RE);
  if (meal && !/\b(?:time|hours?|serving|window|schedule)\b/.test(h)) return { role: 'meal', meal: mealName(meal[1]), weekend: /weekend|\bsat|\bsun|holiday/.test(h) ? true : /weekday|\bmon|m-f|week day/.test(h) ? false : undefined };
  if (/\b(?:rpuid|rpsuid|rpa ?uid|record id)\b/.test(h)) return { role: 'info' };
  if (h.length <= 18 && /^(?:item|line|seq|ser|row|ln|clin|te-?\d+ item|item no\.?|line no\.?)\b\.?/.test(h)) return { role: 'item' };
  if (/^(?:area|field|seg(?:ment)?|site|park|lot|plot|parcel|zone)\.?\s*(?:no\.?|nr\.?|id|#|number|code)$/.test(h) || h === 'area id') return { role: 'rowKey' };
  if (/\b(?:bldg|bld|building|fac|facility|loc|location|asset|property|structure|edificio|ed)\b\.?\s*(?:(?:no|nr|num|number|id|code)\b|#)|^(?:bldg|bldg\.|fac)$|facility number|building number|\bn\.\s*ed\b/.test(h)) return { role: 'number' };
  if (/^(?:no\.?|#|nr\.?|number)$/.test(h)) return { role: 'numberWeak' };
  if (/year built|yr\.? built|year constructed|\bbuilt\b|modernized|^year$|^yr$/.test(h)) return { role: 'year' };
  if (/portable|relocatable/.test(h)) return { role: 'portable' };
  if (/\b(?:restrooms?|toilet rooms?)\b/.test(h) && /\b(?:no\.?|number|count|#)\b|^no\. of/.test(h) && !/fixture/.test(h)) return { role: 'info' };
  if (/fixture/.test(h) && /\bwc\b|water closet/.test(h) && /\bur\b|urinal|\blav/.test(h)) return { role: 'fixtures', slash: true };
  if (/water closets?|\bw\.?c\.?s?\b|\btoilets?\b/.test(h)) return { role: 'fixWC' };
  if (/urinals?|\bur\b/.test(h)) return { role: 'fixUR' };
  if (/lavator|\blavs?\b|\bsinks?\b/.test(h) && !/service sink|janitor/.test(h)) return { role: 'fixLAV' };
  if (/\bshowers?\b/.test(h)) return { role: 'fixSH' };
  if (/fixture/.test(h)) return { role: 'fixtures' };
  if (/total (?:site )?(?:acres|area)|site (?:acres|area)|gross site|site size|total acres|lot size|land area|parcel area/.test(h)) return { role: 'info' };
  if (/seat/.test(h)) return { role: 'seats' };
  if (/wood floor|glass|window|capacity|enroll|population|occupan|price|\$|cost|rate\b|amount\b/.test(h)) return { role: 'info' };
  if (/mows?\s*\/\s*(?:yr|year)|mows per|mowings|cuts per|sfalci|cycles? per (?:yr|year|season)/.test(h)) return { role: 'mows' };
  if (/(?:facilities|buildings|bldgs?|areas?) served|edifici serviti|served facilities/.test(h)) return { role: 'served' };
  if (/slab|hardscape|\bpaved\b|pavement area/.test(h) && (u === 'sf' || u === 'sm' || u === 'sy' || /area/.test(h))) return { role: 'gQty', kind: 'sidewalk', unit: u && u !== 'other' ? u : 'sf' };
  if (/planting|shrub|\bbeds?\b|mulch/.test(h)) return { role: 'gQty', kind: 'shrub_bed', unit: u === 'sm' || u === 'sy' ? u : 'sf' };
  if (/\btrees?\b|alberat/.test(h) && !/height|canopy height/.test(h)) return { role: 'gQty', kind: 'tree_canopy', unit: 'ea' };
  if (u === 'ac' || u === 'ha' || /\bacres?\b|hectares?|acreage/.test(h)) {
    if (/\b(?:no\.?|number|count)$/.test(h)) return { role: 'info' };
    let kind: GroundsKind | undefined;
    if (/ball ?fields?|athletic|playing fields?|sports? fields?/.test(h)) kind = 'athletic_field';
    else if (/rough[- ]?mow|unimproved|type iii|type iv|tipo iii/.test(h)) kind = 'unimproved';
    else if (/semi[- ]?improved|type ii\b|tipo ii\b/.test(h)) kind = 'semi_improved';
    else if (/\bimproved\b|type i\b|tipo i\b/.test(h)) kind = 'improved_turf';
    return { role: 'gQty', unit: u === 'ha' ? 'ha' : 'ac', kind };
  }
  if (/ball ?fields?|athletic fields?/.test(h) && /\b(?:no\.?|number|count)$/.test(h)) return { role: 'info' };
  if (/svc\.? lvl|service level|level of service/.test(h)) return { role: 'svcLvl' };
  if (/\bcycle\b/.test(h)) return { role: 'cycle' };
  if (/\blength\b|lunghezza/.test(h)) return { role: 'length' };
  if (/\bwidth\b|larghezza/.test(h)) return { role: 'width' };
  if (/^sides?\b/.test(h)) return { role: 'sides' };
  if (/^surface\b|surface type|^pavement\b|^material\b/.test(h)) return { role: 'surface' };
  const was = /\b(?:was|old|from|previous|prior|original|existing|before)\b/.test(h);
  const isNew = !was && /\b(?:is|new|revised|changed|corrected|now|after|amended)\b/.test(h);
  if (/cleanable|\bclean(?:ed)?\b|\bcsf\b|\bnet\b|netta|pulibile|serviced|service area|custodial (?:service )?(?:area|sq|sf|square|space)|\bnsf\b|area to be cleaned/.test(h)) return { role: 'cleanable', unit: u, old: was, newer: isNew };
  if (/gross|\bgsf\b|lorda|\bgfa\b/.test(h)) return { role: 'gross', unit: u, old: was, newer: isNew };
  if (/\b(?:qty|quantity|quantit\w*)\b|um qty/.test(h)) return { role: 'qty', unit: u };
  if (u === 'sf' || u === 'sm' || u === 'sy' || /\barea\b|superficie|square f|footage|pricing area|floor area/.test(h)) {
    if (/^(?:grounds )?area(?: description| name)?$/.test(h)) return { role: 'name' };
    return { role: 'area', unit: u, old: was, newer: isNew };
  }
  if (/^(?:u\.?\s*m\.?|um|uom|unit|units|unit of measure|primary um|measure|unita)\b/.test(h) || (/\bu\.m\./.test(h) && h.length < 16)) return { role: 'unit' };
  if (/days open|operating days|days of operation/.test(h)) return { role: 'daysOpen' };
  if (/frequen|\bfreq\b|days of service|cleaning days|service days|days\s*\/\s*week|days per week|gg\s*\/\s*sett|schedule|custodial freq|times per week|visits per/.test(h) && !/hours|window|\btime\b|serving/.test(h)) return { role: 'freq', days: /days/.test(h) };
  if (/\bfloors?\b|\bstor(?:e)?ys?\b|stories|\bflrs?\b|piani|no\.? of levels|number of levels|^levels$/.test(h)) return { role: 'floors' };
  if (/fac status|^status$|facility status|building status|^condition|\bstato\b|record status/.test(h)) return { role: 'status' };
  if (/remark|\bnotes?\b|comment|osservaz|basis for change|explanation/.test(h)) return { role: 'remarks' };
  if (/^change\b|^action\b|type of change|change type/.test(h)) return { role: 'change' };
  if (/revised information|revision|new information|revised data|description of change|change description/.test(h)) return { role: 'revised' };
  if (/service type|type of service|service style|food service type/.test(h)) return { role: 'svcType' };
  if (/rpa type|asset type|record type|property type|real property type/.test(h)) return { role: 'rpaType' };
  if (/catcode (?:description|title|desc)|category (?:code )?(?:description|title)|cat code desc|ccn title/.test(h)) return { role: 'use' };
  if (/catcode|cat code|category code|\bccn\b|fac code/.test(h)) return { role: 'catcode' };
  if (/\btipo\b|grounds type|grounds category|^type\b|^class\b|category$|\btype$/.test(h)) return { role: 'typeish' };
  if (/^(?:campus|installation|caserma|base|post|site|location|sede|garrison)$|\bcampus\b/.test(h)) return { role: 'campus' };
  if (/^(?:te-?\d+ )?zone$|^district$|^sector$|^region$/.test(h)) return { role: 'zone' };
  if (/\bname\b|description|descrizione|denominazione|destinazione|^(?:facility|building|school|park|dining facility|shelter|street|structure|grounds area)\b|\/\s*(?:facility|building|description)\b|\b(?:facility|building|school)$/.test(h)) return { role: 'name' };
  if (/address|indirizzo|^limits\b/.test(h)) return { role: 'address' };
  if (/^(?:use|function|occupancy|primary use|building use|facility use|usage)\b/.test(h)) return { role: 'use' };
  return null;
}

const ANCHORS = new Set<Role>(['number', 'numberWeak', 'name', 'gross', 'cleanable', 'area', 'qty', 'gQty', 'meal', 'length', 'rowKey', 'fixtures', 'fixWC', 'change', 'freq']);

interface TableMap {
  id: string; cols: Col[]; n: number; sig: string; kind: 'facility' | 'grounds' | 'change' | 'meals' | 'other';
  eu: boolean; unit?: QUnit; gross?: Col; grossOld?: Col; cleanable?: Col; codeRows: number; caption: string;
  get(r: Role): Col | undefined; all(r: Role): Col[];
}

function buildMap(cells: string[], id: string, caption: string, above: string[][], body: string[]): TableMap | null {
  const cols: Col[] = [];
  const seen = new Set<Role>();
  cells.forEach((c, i) => {
    const r = roleOf(c);
    if (!r) return;
    // the first name / campus / freq / floors column wins; later look-alikes are information only
    if (['name', 'campus', 'freq', 'floors', 'number', 'use', 'status', 'unit', 'qty', 'svcLvl', 'cycle', 'rowKey', 'served'].includes(r.role) && seen.has(r.role)) { cols.push({ i, text: clean(c), role: 'info' }); return; }
    seen.add(r.role);
    cols.push({ i, text: clean(c), ...r });
  });
  const all = (r: Role) => cols.filter((c) => c.role === r);
  const get = (r: Role) => cols.find((c) => c.role === r);
  // numberless "No." column is the building number only when no better one exists
  if (!get('number')) { const w = get('numberWeak'); if (w) w.role = 'number'; } else for (const w of all('numberWeak')) w.role = 'item';
  // kind-less grounds quantity columns take their kinds from a group-label line above ("IMPROVED | SEMI-IMPROVED | UNIMPROVED")
  const kindless = all('gQty').filter((c) => !c.kind && (c.unit === 'ac' || c.unit === 'ha'));
  if (kindless.length > 1) {
    for (const line of above) {
      const kinds = line.map(clean).filter(Boolean).map((t) => groundsKindFromText(t) ?? typeKind(` ${t.toLowerCase()} `));
      if (kinds.length === kindless.length && kinds.every(Boolean)) { kindless.forEach((c, k) => { c.kind = kinds[k]; }); break; }
    }
  }
  // weekday / weekend split of meal columns: brunch and supper are weekend meals when weekday dinner / breakfast columns exist
  const meals = all('meal');
  if (meals.length) {
    const hasWeekdayCore = meals.some((m) => m.weekend !== true && /Breakfast|Lunch|Dinner/.test(m.meal ?? ''));
    for (const m of meals) if (m.weekend == null) m.weekend = hasWeekdayCore && /Brunch|Supper/.test(m.meal ?? '');
  }
  // gross: the newest gross column (Was / Is Changed To tables), else a generic area column
  const grossCands = all('gross');
  const areaCands = all('area');
  const pickNew = (cs: Col[]) => cs.find((c) => c.newer) ?? cs.find((c) => !c.old) ?? undefined;
  const gross = pickNew(grossCands) ?? pickNew(areaCands);
  const grossOld = [...grossCands, ...areaCands].find((c) => c.old && c !== gross);
  const cleanable = pickNew(all('cleanable'));
  const roleCount = cols.filter((c) => c.role !== 'info').length + cols.filter((c) => c.role === 'info').length;
  const nonEmpty = cells.filter((c) => clean(c)).length;
  if (nonEmpty < 2 || roleCount < 2 || roleCount / nonEmpty < 0.6 || !cols.some((c) => ANCHORS.has(c.role))) return null;
  const has = (r: Role) => !!get(r);
  const identity = has('number') || has('name');
  const bldgAreas = !!gross || !!cleanable || has('portable');
  let kind: TableMap['kind'] = 'other';
  if ((has('change') || has('revised')) && has('number')) kind = 'change';
  else if (meals.length >= 2 && identity) kind = 'facility';
  else if (identity && bldgAreas && !(has('rowKey') && !has('number'))) kind = 'facility';
  else if (has('number') && has('qty') && has('unit')) kind = 'facility';
  else if (/meal|period|pasto|service/.test(normHeader(cells[0] ?? '')) && cells.length >= 2 && !identity) kind = 'meals';
  else if ((identity || has('rowKey')) && (has('gQty') || has('qty') || (has('length') && has('width')))) kind = 'grounds';
  const capL = caption.toLowerCase();
  let eu = /italian (?:number )?format|formato numerico italiano|european (?:number )?format|decimal comma|comma (?:separates|as the) decimal|virgola/.test(capL) && !/u\.s\. number format|us number format/.test(capL);
  if (!eu && !/u\.s\. number format/.test(capL)) eu = body.some((l) => l.split('|').some((c) => { const t = clean(c); return /^\D{0,4}\d{1,3}(?:\.\d{3})+,\d+\b/.test(t) || /^\D{0,4}\d+,\d{1,2}(?:\s|$|[a-z²]|\s*(?:ha|m²|mq|sm))/i.test(t); }));
  let unit: QUnit | undefined;
  if (/(?:areas?|superfici\w*)[^.]{0,40}\b(?:in square met|in metri quadrati|in m²|\(sm\)|in sm\b)|square met(?:er|re)s \(sm\)|metri quadrati/.test(capL)) unit = 'sm';
  else if (/areas? (?:are )?(?:stated |shown |given )?in square (?:feet|yards)/.test(capL)) unit = /yards/.test(capL) ? 'sy' : 'sf';
  const sig = cols.map((c) => `${c.i}:${c.role}`).join(',');
  return { id, cols, n: cells.length, sig, kind, eu, unit, gross, grossOld, cleanable, codeRows: 0, caption, get, all };
}

// =====================================================================================================================
// Records
// =====================================================================================================================

interface DiningAcc { periods: MealPeriodHeadcount[]; mealsPerDay?: number; mealPeriods?: number; seats?: number; daysPerWeek?: number; kitchenSqft?: number; diningRoomSqft?: number; serviceStyle?: DiningProfile['serviceStyle'] }
interface RowData {
  bn?: string; name?: string; campus?: string; gross?: number; cleanable?: number; unit?: AreaUnit; grossPrinted?: number; cleanPrinted?: number; wasGross?: number;
  floors?: number; fixtures?: number; level?: ServiceLevel; freqText?: string; status?: { status: FacilityStatus; reason: string }; active?: boolean; use?: string;
  dining?: Partial<DiningAcc>; portableSf?: number; source: SourceRef; tableId: string; notes?: string[]; confidence?: number; strongName?: boolean;
}
interface FacRec {
  bn?: string; key?: string; nameKey: string; name: string; strongName: boolean; campus?: string; use: string;
  gross: number; grossRank: number; grossFrom?: string; unit?: AreaUnit; grossPrinted?: number;
  cleanable?: number; cleanRank: number; cleanPrinted?: number; floors?: number; floorsRank: number; fixtures?: number; fixRank: number;
  level?: ServiceLevel; freqText?: string; levelRank: number; status?: FacilityStatus; statusReason?: string; statusRank: number;
  dining?: DiningAcc; diningRank: number; portableSf?: number; source: SourceRef; tableId: string; tables: Set<string>; notes: string[]; confidence: number;
}
interface GRec { g: GroundsArea; rank: number; doc: string; tableId?: string; rowKey?: string; served: string[]; dims?: { lf: number; width: number; sides: number; hard: boolean }; label: string }

interface Ctx { doc: DocInput; rank: number; amendLike: boolean; page?: number; inAmend: boolean }
interface Para { text: string; line: number; page?: number; subjects?: string[]; cell?: boolean; inAmend: boolean }

const ROLE_RANK: Record<string, number> = { solicitation: 0, pws: 0, other: 0, attachment: 1, qa: 2, amendment: 3 };
function docRank(d: DocInput): { rank: number; amendLike: boolean } {
  const c = d.role ? { role: d.role, amendment: d.amendment } : classifyDocument(d);
  const base = ROLE_RANK[c.role] ?? 0;
  return { rank: base + (c.role === 'amendment' ? Math.min(c.amendment ?? 999, 999) / 1000 : 0), amendLike: c.role === 'amendment' || c.role === 'qa' };
}
function orderDocs(docs: DocInput[]): { doc: DocInput; rank: number; amendLike: boolean }[] {
  return docs.map((doc, i) => ({ doc, i, ...docRank(doc) })).sort((a, b) => a.rank - b.rank || a.i - b.i);
}

const splitPipe = (line: string): string[] => {
  const t = line.trim();
  const cells = t.split('|').map((c) => c.trim());
  if (t.startsWith('|') && cells[0] === '' && t.endsWith('|')) cells.shift();
  if (t.endsWith('|') && cells[cells.length - 1] === '') cells.pop();
  return cells;
};
const splitLoose = (line: string): string[] => (line.includes('\t') ? line.split(/\t+/).map((c) => c.trim()) : /\S {3,}\S/.test(line.trim()) ? line.trim().split(/ {3,}/).map((c) => c.trim()) : [line.trim()]);

/** A one-cell row inside a table that names a campus / zone / group of rows ("CANTONMENT AREA B – TROOP AREA"). */
function groupLabel(cells: string[]): string | undefined {
  const ne = cells.map(clean).filter(Boolean);
  if (ne.length !== 1) return undefined;
  return groupText(ne[0]);
}
function groupText(raw: string): string | undefined {
  let t = clean(raw).replace(/\s*\((?:continued|cont\.?|cont'd)\)\s*$/i, '').trim();
  if (t.length < 5 || t.length > 140 || TOTAL_RE.test(t) || !/[A-Za-z]{3}/.test(t)) return undefined;
  if (/^(?:notes?|footnotes?|sources?|continued|see\b|table\b|page\b|section\b|exhibit\b|attachment\b|appendix\b|prepared by|issued|\*{2,}|end of)/i.test(t) || /:\s*$/.test(t)) return undefined;
  if (t.split(/\s+/).length < 2) return undefined;
  if (/[.;]\s*$/.test(t) && t.split(/\s+/).length > 6) return undefined;
  if (/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/.test(t) && /\b(?:is|are|shall|will|the|of|and)\b.*\b(?:is|are|shall|will)\b/.test(t)) return undefined;
  // "WINTER HAVEN CAMPUS – 4100 Lake Region Boulevard, …": drop the address part
  const parts = t.split(/\s+-\s+|\s+–\s+|\s+—\s+/);
  if (parts.length > 1 && /\d{2,}/.test(parts.slice(1).join(' ')) && /campus|center|base|station|site|caserma|post|annex/i.test(parts[0])) t = parts[0];
  return t;
}
const CAMPUS_WORD = /\b(?:campus|campuses|caserma|installation|garrison|annex|base|station|post|site|compound|centers?|kaserne|camp|fort|cantonment|airfield|zone|area|sector|range|training area)\b/i;

/** Building / site references in prose: "Bldg 1201", "Buildings 1102, 1104 and 1106", "Location 208", "Site 14",
 *  "Segment M-6", "R-5101 through R-5130" (expanded only against known numbers). */
const REF_PREFIX = /\b(bldgs?|buildings?|bld|facilit(?:y|ies)|fac|locations?|loc|sites?|segments?|seg|structures?|parks?|dfacs?)\.?\s*(?:nos?\.?|numbers?|#)?\s*(?=[A-Z0-9])/gi;
const REF_ID = /^(?:[A-Z]{0,4}-?\d{1,7}[A-Z]{0,3}(?:-[A-Z0-9]{1,4})?|[A-Z]{2,5}\d{2,6}[A-Z]{0,3}|[A-Z]{1,4}\/[A-Z]{1,4}|[A-Z]{3,5}(?![a-z]))/;
interface Ref { id: string; key: string; at: number; site: boolean }
function refsIn(text: string, known?: (key: string) => boolean): Ref[] {
  const out: Ref[] = [];
  const t = dash(text);
  REF_PREFIX.lastIndex = 0;
  for (let m = REF_PREFIX.exec(t); m; m = REF_PREFIX.exec(t)) {
    const site = /^(?:sites?|segments?|seg|parks?)$/i.test(m[1]);
    let pos = m.index + m[0].length;
    let prev: string | undefined;
    for (let guard = 0; guard < 60; guard++) {
      const rest = t.slice(pos);
      const idm = rest.match(REF_ID);
      if (!idm) break;
      const id = idm[0];
      if (/^[A-Z]{3,5}$/.test(id) && !/^(?:bldg|building)/i.test(m[1])) break; // bare letter codes only after "Building"
      if (/^(?:THE|AND|FOR|NOT|ALL|NEW|OLD|ARE|WAS|HAS|LIST|TABLE|AREA|NO)$/.test(id)) break;
      const sep = rest.slice(id.length).match(/^\s*(,|and\b|&|or\b|through\b|thru\b|to\b|-)\s*/i);
      if (prev && /^(?:through|thru|to|-)$/i.test(prev) && out.length) {
        const a = out[out.length - 1].id, b = id;
        const pa = a.match(/^(.*?)(\d+)$/), pb = b.match(/^(.*?)(\d+)$/);
        if (pa && pb && pa[1] === pb[1] && Number(pb[2]) > Number(pa[2]) && Number(pb[2]) - Number(pa[2]) <= 400) {
          for (let n = Number(pa[2]) + 1; n <= Number(pb[2]); n++) {
            const cand = `${pa[1]}${String(n).padStart(pa[2].length, '0')}`;
            if (!known || known(bnKey(cand)) || n === Number(pb[2])) out.push({ id: cand, key: bnKey(cand), at: m.index, site });
          }
        } else out.push({ id, key: bnKey(id), at: m.index, site });
      } else out.push({ id, key: bnKey(id), at: m.index, site });
      if (!sep) break;
      prev = sep[1];
      pos += id.length + sep[0].length;
    }
  }
  // bare identifiers that are known building numbers or grounds rows ("PB-3, Sports Complex …", "VA0355ZZ")
  if (known) for (const m of t.matchAll(/\b([A-Z]{1,4}-\d{1,6}[A-Z]?|[A-Z]{2}\d{4}[A-Z]{2}|\d{3,6}[A-Z])\b/g)) { const k = bnKey(m[1]); if (known(k) && !out.some((r) => r.key === k)) out.push({ id: m[1], key: k, at: m.index ?? 0, site: false }); }
  return out;
}

const ABBR = /(?:\b(?:no|nos|bldg|bldgs|inc|co|corp|ltd|st|ave|blvd|rd|dr|mr|mrs|ms|approx|para|sec|fig|vs|etc|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|ft|sq|exh|att|rev|vol|pt|al|u\.s|e\.g|i\.e|a\.m|p\.m|nr|ref|cf)|\b[A-Z]|\d)\.$/i;
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?;](?=\s+[“"(A-Z0-9])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const head = text.slice(start, m.index + 1);
    if (m[0] === '.' && ABBR.test(head)) continue;
    out.push(head.trim());
    start = m.index + 1;
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

// =====================================================================================================================
// The reader
// =====================================================================================================================

const KV = {
  number: /^(?:gsa |property |real property )?(?:building|bldg|facility|fac)\.?\s*(?:number|no\.?|#|id)$/,
  name: /^(?:building|facility|property) name$/,
  gross: /^gross (?:square feet|sq\.? ?ft\.?|sf|area|floor area)(?: \(gsf\))?$|^gsf$|^gross$|^gross square footage$/,
  cleanable: /^(?:total )?(?:custodial|cleanable)(?: \(cleanable\))?(?: square feet| sq\.? ?ft\.?| sf| area| square footage)|^cleanable|^total custodial/,
  floors: /^(?:number of |no\.? of )?(?:floors|stories)$|^floors(?: serviced)?$/,
  above: /^floors above grade|^stories above grade/,
  below: /^floors below grade|^basement (?:levels|floors)|^levels below grade/,
  fixtures: /^(?:restroom |plumbing )?fixtures(?: total)?$|^total (?:restroom |plumbing )?fixtures/,
  freq: /^days of (?:custodial )?service|^service days|^cleaning (?:days|frequency)|^custodial (?:frequency|service days)|^frequency$|^service frequency/,
  use: /^(?:building|facility) type$|^primary use$/,
  status: /^(?:building |facility )?status$/,
  improved: /^(?:landscaped|improved)(?: \/ improved)?(?: grounds| area| turf)?$|^lawns?(?: area)?$|^turf(?: area)?$|^mowed area/,
  semi: /^semi-improved/, unimproved: /^unimproved/,
  parking: /^parking(?: areas?| lots?)?$/, sidewalk: /^(?:sidewalks?|walks|plazas?)(?:,|\b)/, beds: /^(?:planting|shrub) beds?/, trees: /^trees?$/,
  site: /site area|total site|^site acreage/, groundsIn: /^grounds maintenance(?: in contract)?$/,
  info: /rentable|aboa|usable|^street address|^address|^ownership|year built|^historic|population|^normal hours|^custodial shift|elevators|^snow|glass|window washing/,
};
type KvField = keyof typeof KV;
const kvField = (label: string): KvField | undefined => {
  const l = normHeader(label).replace(/:$/, '').trim();
  for (const k of Object.keys(KV) as KvField[]) if (KV[k].test(l)) return k;
  return undefined;
};
interface KvRec { bn?: string; name?: string; gross?: number; cleanable?: number; floors?: number; above?: number; below?: number; fixtures?: number; freqText?: string; use?: string; status?: { status: FacilityStatus; reason: string }; groundsOut?: boolean; grounds: { kind: GroundsKind; qty: number; unit: QUnit; text: string }[]; source: SourceRef; unit?: AreaUnit }

class Reader {
  recs: FacRec[] = [];
  byBn = new Map<string, FacRec[]>();
  byName = new Map<string, FacRec[]>();
  grounds: GRec[] = [];
  site: SiteInfo = {};
  exCat: RegExp[] = [];
  inCat: RegExp[] = [];
  tableSeq = 0;
  mealTables: { periodsByTarget: Map<string, MealPeriodHeadcount[]>; hint?: string; source: SourceRef; rank: number }[] = [];

  knownKey = (k: string) => this.byBn.has(k) || this.grounds.some((g) => g.rowKey && bnKey(g.rowKey) === k);

  // ---------------------------------------------------------------- facility registration
  register(row: RowData, rank: number): FacRec {
    let rec: FacRec | undefined;
    if (row.bn) {
      const k = bnKey(row.bn);
      const list = this.byBn.get(k) ?? [];
      const same = (c?: string) => !!c && !!row.campus && nameKey(c) === nameKey(row.campus);
      rec = list.find((r) => same(r.campus));
      if (!rec) rec = list.find((r) => !r.campus || !row.campus);
      if (!rec && list.length === 1 && !list[0].tables.has(row.tableId)) rec = list[0];
      if (!rec) { rec = this.newRec(row); this.byBn.set(k, [...list, rec]); rec.bn = row.bn; rec.key = k; }
    } else {
      const nk = nameKey(row.name ?? '');
      const list = this.byName.get(nk) ?? [];
      rec = list.find((r) => !r.tables.has(row.tableId));
      if (!rec) { rec = this.newRec(row); this.byName.set(nk, [...list, rec]); }
    }
    this.merge(rec, row, rank);
    return rec;
  }
  newRec(row: RowData): FacRec {
    const r: FacRec = { nameKey: nameKey(row.name ?? ''), name: '', strongName: false, use: '', gross: 0, grossRank: -1, cleanRank: -1, floorsRank: -1, fixRank: -1, levelRank: -1, statusRank: -1, diningRank: -1, source: row.source, tableId: row.tableId, tables: new Set(), notes: [], confidence: row.confidence ?? 0.75 };
    this.recs.push(r);
    return r;
  }
  merge(rec: FacRec, row: RowData, rank: number) {
    rec.tables.add(row.tableId);
    const nm = clean(row.name);
    if (nm && (!rec.name || /^Building\b/.test(rec.name) || (row.strongName && !rec.strongName))) { rec.name = nm.slice(0, 120); rec.strongName = !!row.strongName; }
    if (!rec.campus && row.campus) rec.campus = row.campus;
    if (row.use && !rec.use) rec.use = row.use;
    if (row.gross != null && row.gross > 0) {
      if (!(rec.gross > 0)) { rec.gross = row.gross; rec.grossRank = rank; rec.unit = row.unit; rec.grossPrinted = row.grossPrinted; rec.grossFrom = row.source.file; rec.portableSf = row.portableSf; }
      else if (rank > rec.grossRank && Math.abs(rec.gross - row.gross) > 0.5) {
        rec.notes.push(`Superseded ${fmt(rec.gross)} SF${rec.grossFrom ? ` (${rec.grossFrom})` : ''} with ${fmt(row.gross)} SF from ${row.source.file}.`);
        rec.gross = row.gross; rec.grossRank = rank; rec.unit = row.unit; rec.grossPrinted = row.grossPrinted; rec.grossFrom = row.source.file; rec.portableSf = row.portableSf;
      } else if (Math.abs(rec.gross - row.gross) > 0.5 && rank === rec.grossRank && !rec.notes.some((n) => n.startsWith('Also listed'))) rec.notes.push(`Also listed as ${fmt(row.gross)} SF (${row.tableId.split(':').slice(-1)[0]}); kept ${fmt(rec.gross)} SF.`);
    }
    if (row.wasGross && row.gross && Math.abs(row.wasGross - row.gross) > 0.5) rec.notes.push(`Changed from ${fmt(row.wasGross)} SF to ${fmt(row.gross)} SF (${row.source.file}).`);
    if (row.cleanable != null && row.cleanable > 0 && (rec.cleanable == null || rank > rec.cleanRank)) { rec.cleanable = row.cleanable; rec.cleanRank = rank; rec.cleanPrinted = row.cleanPrinted; if (!rec.unit) rec.unit = row.unit; }
    if (row.floors != null && row.floors > 0 && (rec.floors == null || rank > rec.floorsRank)) { rec.floors = row.floors; rec.floorsRank = rank; }
    if (row.fixtures != null && row.fixtures >= 0 && (rec.fixtures == null || rank > rec.fixRank)) { rec.fixtures = row.fixtures; rec.fixRank = rank; }
    if ((row.level || row.freqText) && (rec.levelRank < 0 || rank > rec.levelRank || (!rec.level && row.level))) { if (row.level) rec.level = row.level; if (row.freqText) rec.freqText = row.freqText; rec.levelRank = rank; }
    if (row.status && (rec.statusRank < 0 || rank >= rec.statusRank || !rec.status)) { rec.status = row.status.status; rec.statusReason = row.status.reason; rec.statusRank = rank; }
    else if (!row.status && rec.status && rank > rec.statusRank && ((row.gross ?? 0) > 0 || row.active)) { rec.notes.push(`Listed again in ${row.source.file}; earlier status "${rec.status}" cleared.`); rec.status = undefined; rec.statusReason = undefined; rec.statusRank = rank; }
    else if (row.active && rec.status && rank >= rec.statusRank && rec.statusRank < 0) { rec.status = undefined; }
    if (row.dining) {
      const d = rec.dining ?? (rec.dining = { periods: [] });
      if (row.dining.periods?.length && (rank >= rec.diningRank || !d.periods.length)) d.periods = row.dining.periods;
      for (const k of ['mealsPerDay', 'mealPeriods', 'seats', 'daysPerWeek', 'kitchenSqft', 'diningRoomSqft', 'serviceStyle'] as const) {
        const v = row.dining[k];
        if (v != null && (d[k] == null || rank > rec.diningRank)) (d as unknown as Record<string, unknown>)[k] = v;
      }
      rec.diningRank = Math.max(rec.diningRank, rank);
    }
    if (row.notes) for (const n of row.notes) if (!rec.notes.includes(n)) rec.notes.push(n);
    rec.confidence = Math.max(rec.confidence, row.confidence ?? 0);
  }
  findRecs(key: string): FacRec[] { return this.byBn.get(key) ?? []; }

  // ---------------------------------------------------------------- grounds registration
  pushGrounds(o: { kind: GroundsKind; qty: number; unit: QUnit; label: string; rowKey?: string; served?: string[]; source: SourceRef; tableId?: string; rank: number; docLabel?: string; notes?: string; dims?: GRec['dims']; campus?: string }) {
    if (!isFinite(o.qty) || o.qty <= 0) return;
    const unit = GROUNDS_U[o.unit] ?? (o.kind === 'tree_canopy' ? 'each' : o.kind === 'shrub_bed' || o.kind === 'parking' || o.kind === 'sidewalk' ? 'sqft' : 'acres');
    if (o.kind === 'tree_canopy' && unit !== 'each') return;
    const label = clean(o.label).slice(0, 110);
    // a later-ranked document repeating the same grounds row replaces it
    const dupIdx = this.grounds.findIndex((g) => g.doc !== o.source.file && g.g.kind === o.kind && ((o.rowKey && g.rowKey && bnKey(g.rowKey) === bnKey(o.rowKey)) || (!o.rowKey && !g.rowKey && nameKey(g.label) === nameKey(label))) && g.rank <= o.rank);
    const g: GroundsArea = { id: '', name: `${o.rowKey ? `${o.rowKey} ` : ''}${label || labelKind(o.kind)}`.slice(0, 120), kind: o.kind, quantity: round(o.qty, 4), unit, confidence: 0.6, source: o.source, documentLabel: o.docLabel, notes: o.notes, campus: o.campus };
    const rec: GRec = { g, rank: o.rank, doc: o.source.file ?? '', tableId: o.tableId, rowKey: o.rowKey, served: o.served ?? [], dims: o.dims, label };
    if (dupIdx >= 0) this.grounds[dupIdx] = rec; else this.grounds.push(rec);
  }

  // ---------------------------------------------------------------- scope rules (RPI cover memos: "CATCODE 93230 … Not in scope")
  scanScope(text: string) {
    for (const line of text.split('\n')) {
      if (!/cat\s*code|catcode|category code/i.test(line)) continue;
      const neg = /not in scope|out of scope|excluded|not included|not part of/i.test(line);
      const pos = !neg && /\bin scope\b/i.test(line);
      if (!neg && !pos) continue;
      const pats: RegExp[] = [];
      for (const m of dash(line).matchAll(/\b(\d{2,5})(x{0,3})\b(?:\s*-\s*(\d{2,5})(x{0,3})\b)?/gi)) {
        const a = m[1] + m[2], b = m[3] ? m[3] + m[4] : undefined;
        if (a.length !== 5) continue;
        if (b && b.length === 5 && m[2] && m[4]) {
          const pa = Number(m[1]), pb = Number(m[3]);
          for (let p = pa; p <= pb && p - pa < 20; p++) pats.push(new RegExp(`^${p}\\d{${m[2].length}}$`));
        } else pats.push(new RegExp(`^${m[1]}${m[2] ? `\\d{${m[2].length}}` : ''}$`));
      }
      (neg ? this.exCat : this.inCat).push(...pats);
    }
  }
  catExcluded(cat: string | undefined): boolean {
    const c = clean(cat);
    if (!/^\d{5}$/.test(c)) return false;
    return this.exCat.some((r) => r.test(c)) && !this.inCat.some((r) => r.test(c));
  }

  // ---------------------------------------------------------------- one document
  readDoc(doc: DocInput, rank: number, amendLike: boolean) {
    const ctx: Ctx = { doc, rank, amendLike, inAmend: amendLike };
    const lines = doc.text.split(/\r?\n/);
    const counts = new Map<string, number>();
    for (const l of lines) { const t = l.trim(); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
    const furniture = (t: string) => /^(?:--- page \d+ ---|page \d+(?:\s+of\s+\d+)?|cui|(?:continued|cont\.).*|.*\bcontinue[sd]? (?:on|from) (?:the )?(?:next|previous|page).*|.*\bpage [a-z]?[\d.-]+ of \d+.*)$/i.test(t) || ((counts.get(t) ?? 0) >= 3 && t.length < 220);
    let map: TableMap | null = null;
    let suspended = false;
    let group: string | undefined;
    let lastSig = '';
    let recentPlain: string[] = [];
    let lastPlain: { t: string; i: number } | undefined;
    let kv: KvRec | null = null;
    const paras: Para[] = [];
    let para: string[] = [];
    let paraLine = 0;
    const endPara = () => { if (para.length) paras.push({ text: para.join(' ').replace(/\s+/g, ' '), line: paraLine, page: ctx.page, inAmend: ctx.inAmend }); para = []; };
    const src = (line: string): SourceRef => ({ file: doc.name, page: ctx.page, excerpt: clean(line).slice(0, 200) });
    const flushKv = () => { if (kv) this.flushKv(kv, ctx); kv = null; };

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) { endPara(); if (map) suspended = true; continue; }
      const pg = t.match(/^--- page (\d+) ---$/);
      if (pg) { ctx.page = Number(pg[1]); endPara(); if (map) suspended = true; recentPlain = []; continue; }
      if (/^===\s.*\s===$/.test(t)) { endPara(); flushKv(); map = null; group = undefined; recentPlain = []; continue; }
      if (t.length < 90 && /^(?:addendum|amendment)\s*(?:no\.?|number|#)?\s*\d{1,4}\b/i.test(t) && !/\|/.test(t)) ctx.inAmend = true;
      const isPipe = t.includes('|');
      const cells = isPipe ? splitPipe(t) : splitLoose(t);

      // key / value building information sheets
      const kvPairs = this.kvPairs(cells, t, !!kv);
      if (kvPairs) {
        endPara();
        if (kvPairs.some(([f]) => f === 'number')) { flushKv(); kv = { grounds: [], source: src(t) }; }
        if (kv) this.kvApply(kv, kvPairs, map);
        continue;
      }

      // header rows
      if (cells.length >= 2 && !isNumericRow(cells)) {
        const above: string[][] = [];
        for (let k = i - 1, n = 0; k >= 0 && n < 5; k--) { const l = lines[k].trim(); if (!l) continue; n++; if (l.includes('|')) above.push(splitPipe(l)); }
        const hdr = this.tryHeader(lines, i, cells, recentPlain.join(' '), above);
        if (hdr) {
          endPara();
          if (hdr.map.kind === 'facility') flushKv();
          // a group label on the line just above the header belongs to this table
          const prev = lastPlain && lastPlain.i >= i - 3 ? groupText(lastPlain.t) : undefined;
          if (hdr.map.sig !== lastSig) group = prev;
          else if (prev) group = prev;
          lastSig = hdr.map.sig;
          map = hdr.map; suspended = false; i += hdr.extra; recentPlain = [];
          continue;
        }
      }

      if (map) {
        if (suspended) {
          if (isPipe && fits(cells, map)) suspended = false;
          else if (isPipe && groupLabel(cells)) { group = groupLabel(cells); continue; }
        }
        if (!suspended) {
          if (isPipe || cells.length >= 2) {
            const g = groupLabel(cells);
            if (g && !isTotalRow(cells)) { group = g; continue; }
            this.row(cells, map, ctx, src(t), group, kv);
            recentPlain = [];
            continue;
          }
          const g = groupText(t);
          if (g && !/[a-z]{4,}\s+[a-z]{4,}/.test(t)) { group = g; continue; }
          suspended = true;
        }
      }

      if (isPipe) {
        // an unmapped table row: long text cells (Q&A responses, change descriptions) are read as prose
        const subjects = cells.filter((c) => c.length < 40).flatMap((c) => refsIn(c, this.knownKey).map((r) => r.id));
        for (const c of cells) if (clean(c).length >= 30 && /\s/.test(c)) paras.push({ text: clean(c), line: i, page: ctx.page, subjects, cell: true, inAmend: ctx.inAmend });
        this.fallbackFacility(cells, t, ctx, src(t));
        continue;
      }
      if (furniture(t)) continue;
      lastPlain = { t, i };
      recentPlain.push(t); if (recentPlain.length > 6) recentPlain.shift();
      if (/^(?:[a-z]|\d{1,2}|[ivx]{1,4})[.)]\s|^(?:item|q|a)\s*\d+\s*[.:\-–]|^\d+(?:\.\d+)+\s|^\d+\.\s+[A-Z]/i.test(t)) endPara();
      if (!para.length) paraLine = i;
      para.push(t);
      this.fallbackFacility([t], t, ctx, src(t));
      this.proseGrounds(t, ctx, src(t));
    }
    endPara();
    flushKv();
    // statements after the document's own tables
    paras.sort((a, b) => a.line - b.line);
    for (let p = 0; p < paras.length; p++) this.statements(paras[p], ctx, paras);
    for (let p = 0; p < paras.length; p++) if (!paras[p].cell) this.proseDining(paras, p, ctx);
  }

  tryHeader(lines: string[], i: number, cells: string[], caption: string, above: string[][]): { map: TableMap; extra: number } | null {
    if (cells.some((c) => clean(c).length > 90)) return null;
    let hcells = cells;
    let extra = 0;
    const next = lines[i + 1]?.trim();
    if (next && next.includes('|')) {
      const nc = splitPipe(next);
      if (nc.every((c) => !clean(c) || /^\(\d+\)$/.test(clean(c)))) extra = 1;
      else if (!isNumericRow(nc) && !nc.some((c) => isNumericCell(c)) && nc.every((c) => clean(c).length <= 60) && nc.some((c, k) => clean(c) && !clean(cells[k]))) {
        hcells = mergeHeader(cells, nc); extra = 1;
        const nn = lines[i + 2]?.trim();
        if (nn && nn.includes('|') && splitPipe(nn).every((c) => !clean(c) || /^\(\d+\)$/.test(clean(c)))) extra = 2;
      }
    }
    if (hcells.some((c) => isNumericCell(c) && !/^\(\d+\)$/.test(clean(c)))) return null;
    const body: string[] = [];
    for (let k = i + 1 + extra; k < lines.length && body.length < 300; k++) { const l = lines[k]; if (!l.includes('|')) { if (l.trim() && !/^--- page/.test(l.trim()) && body.length > 3) break; continue; } body.push(l); }
    const map = buildMap(hcells, `t${++this.tableSeq}`, caption, above, body);
    if (!map) return null;
    return { map, extra };
  }

  // ---------------------------------------------------------------- table rows
  row(cells: string[], map: TableMap, ctx: Ctx, source: SourceRef, group: string | undefined, kv: KvRec | null) {
    if (map.kind === 'facility') { if (!this.facilityRow(cells, map, ctx, source, group)) this.groundsRow(cells, map, ctx, source, group); return; }
    if (map.kind === 'grounds') { this.groundsRow(cells, map, ctx, source, group); return; }
    if (map.kind === 'change') { this.changeRow(cells, map, ctx, source); return; }
    if (map.kind === 'meals') { this.mealsRow(cells, map, ctx, source); return; }
    // other tables: a fixtures TOTAL row belongs to the open building information sheet
    if (kv && isTotalRow(cells)) {
      const tot = map.all('fixtures').find((c) => /^(?:total )?fixtures(?: total)?$/i.test(c.text)) ?? map.all('fixtures').slice(-1)[0];
      const v = tot ? parseNumberCell(cells[tot.i]) : undefined;
      const parts = (['fixWC', 'fixUR', 'fixLAV', 'fixSH'] as Role[]).map((r) => map.get(r)).filter((c): c is Col => !!c).map((c) => parseNumberCell(cells[c.i]) ?? 0);
      const val = v ?? (parts.length ? parts.reduce((a, b) => a + b, 0) : undefined);
      if (val != null && kv.fixtures == null) kv.fixtures = val;
    }
  }

  facilityRow(cells: string[], map: TableMap, ctx: Ctx, source: SourceRef, group: string | undefined): boolean {
    const cell = (c?: Col) => (c ? cells[c.i] ?? '' : '');
    if (isTotalRow(cells)) return true;
    const numCol = map.get('number');
    const nameCol = map.get('name');
    const rawBn = cell(numCol);
    let bn = normalizeBuildingNumber(rawBn);
    if (numCol && clean(rawBn) && !bn) return true; // a text row (sub-header, grouping) in the number column
    let name = clean(cell(nameCol));
    let codeFromName = false;
    if (!numCol && name) {
      const sc = splitCode(name, map.codeRows > 0);
      if (sc.code) { bn = sc.code; name = sc.name; map.codeRows++; codeFromName = true; }
    }
    if (!bn && !name) return true;
    // units: a unit cell or suffix, the column header, the table caption; non-building units are grounds or utilities
    const unitCol = map.get('unit');
    const rowUnit = unitCol ? unitOf(` ${clean(cell(unitCol))} `) : undefined;
    const rpa = clean(cell(map.get('rpaType')));
    const qtyCol = map.get('qty');
    let gCol = map.gross;
    let fromQty = false;
    if (!gCol && qtyCol && numCol) { gCol = qtyCol; fromQty = true; }
    const gTxt = cell(gCol);
    const gUnit = unitOf(gTxt) ?? rowUnit ?? gCol?.unit ?? map.unit ?? 'sf';
    if (rpa && !/build|bldg|edificio/i.test(rpa)) return false;
    if ((fromQty || unitCol) && !['sf', 'sm', 'sy'].includes(gUnit)) return false;
    if (fromQty && groundsKindFromText(`${name} ${clean(cell(map.get('use')))}`) && !/build|bldg/i.test(rpa)) return false;
    const eu = map.eu;
    const toSf = (v: number | undefined, u: QUnit) => (v == null ? undefined : u === 'sm' ? Math.round(v * SQFT_PER.sm) : u === 'sy' ? Math.round(v * SQFT_PER.sy) : v);
    const grossPrinted = gTxt && !isBlankish(gTxt) ? parseNumberCell(gTxt, eu) : undefined;
    let gross = toSf(grossPrinted, gUnit);
    const cTxt = cell(map.cleanable);
    const cUnit = unitOf(cTxt) ?? rowUnit ?? map.cleanable?.unit ?? (gUnit === 'sm' || gUnit === 'sy' ? gUnit : map.unit) ?? 'sf';
    const cleanPrinted = cTxt && !isBlankish(cTxt) ? parseNumberCell(cTxt, eu) : undefined;
    const cleanable = toSf(cleanPrinted, cUnit);
    const notes: string[] = [];
    // portable classrooms "4 @ 960" (and "2 @ 960 1 @ 1,792") are added to the building area
    let portableSf: number | undefined;
    const pTxt = clean(cell(map.get('portable')));
    if (pTxt && /@/.test(pTxt)) {
      portableSf = [...pTxt.matchAll(/(\d+)\s*@\s*([\d,]+)/g)].reduce((s, m) => s + Number(m[1]) * Number(m[2].replace(/,/g, '')), 0);
      if (portableSf > 0 && gross) { notes.push(`Gross includes ${fmt(portableSf)} SF of portable classrooms (${pTxt}) added to ${fmt(gross)} SF.`); gross += portableSf; }
    }
    if (gUnit === 'sm' || gUnit === 'sy') notes.push(`Areas printed in ${gUnit === 'sm' ? 'square meters' : 'square yards'}${grossPrinted ? ` (${grossPrinted.toLocaleString('en-US')} ${gUnit.toUpperCase()} gross)` : ''}; converted at ${SQFT_PER[gUnit]} SF per ${gUnit.toUpperCase()}.`);
    const wasTxt = cell(map.grossOld);
    const wasGross = toSf(wasTxt ? parseNumberCell(wasTxt, eu) : undefined, gUnit);
    // status: struck numbers, status / frequency / remarks / name cells
    let status: RowData['status'];
    let active = false;
    if (isStruck(rawBn) || (nameCol && isStruck(cells[nameCol.i]) && !clean(cells[nameCol.i]).match(/[a-z]/i)?.length === false)) status = { status: 'deleted_by_amendment', reason: 'Struck through in the facility list' };
    if (!status && isStruck(rawBn || cells[nameCol?.i ?? -1])) status = { status: 'deleted_by_amendment', reason: 'Struck through in the facility list' };
    const stCol = map.get('status');
    if (!status && stCol) {
      const v = clean(cell(stCol)).toLowerCase();
      if (/^(?:active|in service|occupied|in scope|yes)$/.test(v)) active = true;
      else if (/closed|inactive/.test(v)) status = { status: 'vacant', reason: `Status ${clean(cell(stCol))}` };
      else if (/disposed|demolish|excess/.test(v)) status = { status: 'demolished', reason: `Status ${clean(cell(stCol))}` };
      else if (v) status = statusFromText(cell(stCol));
    }
    const freqCol = map.get('freq');
    const fTxt = clean(cell(freqCol));
    if (!status && fTxt) status = statusFromText(fTxt, { frequencyCell: true });
    if (!status) for (const c of map.cols) {
      if (!['remarks', 'name', 'meal', 'info', 'change', 'revised', 'svcType'].includes(c.role)) continue;
      const s = statusFromText(cells[c.i]);
      if (s) { status = s; break; }
    }
    if (!status) { for (let k = 0; k < cells.length; k++) if (!map.cols.some((c) => c.i === k)) { const s = statusFromText(cells[k]); if (s) { status = s; break; } } }
    // frequency
    let level: ServiceLevel | undefined;
    if (fTxt) {
      if (freqCol?.days && /^\d$/.test(fTxt)) { const d = Number(fTxt); level = levelFromDays(d); if (d === 0 && !status) status = { status: 'excluded', reason: '0 service days per week' }; }
      else level = serviceLevelFromText(fTxt);
    }
    // catcode scope rules
    const cat = clean(cell(map.get('catcode')));
    if (!status && this.catExcluded(cat)) status = { status: 'excluded', reason: `CATCODE ${cat} is not in scope` };
    // dining columns (headcount per meal period, seats, service type, days open)
    let dining: Partial<DiningAcc> | undefined;
    const mealCols = map.all('meal');
    if (mealCols.length) {
      const periods: MealPeriodHeadcount[] = [];
      for (const m of mealCols) {
        const txt = clean(cells[m.i]);
        if (!txt || /\d{3,4}\s*-\s*\d{3,4}|\d{1,2}:\d{2}|a\.m\.|p\.m\./i.test(dash(txt))) continue;
        const v = parseNumberCell(txt, eu);
        if (v == null || !isFinite(v)) continue;
        const name = m.meal ?? 'Meal';
        let p = periods.find((x) => x.period === name);
        if (!p) { p = { period: name }; periods.push(p); }
        if (m.weekend) p.weekendHeadcount = v; else p.weekdayHeadcount = v;
      }
      if (periods.length) dining = { periods };
    }
    const seats = parseNumberCell(cell(map.get('seats')));
    const svc = clean(cell(map.get('svcType')));
    const days = parseNumberCell(cell(map.get('daysOpen')));
    if (seats || svc || (days && dining)) {
      dining = dining ?? {};
      if (seats) dining.seats = seats;
      if (svc) dining.serviceStyle = /\bdfa\b|attendant/i.test(svc) ? 'dining_facility_attendant' : /management/i.test(svc) ? 'management_only' : /ffs|full/i.test(svc) ? 'full_food_service' : undefined;
      if (days && days <= 7) dining.daysPerWeek = days;
    }
    if (!(gross && gross > 0) && !(cleanable && cleanable > 0) && !status && !dining?.periods?.length) {
      if (!dining && !active) return !!(gTxt && /\btbd\b|to be determined/i.test(gTxt)) || true;
    }
    const floorsTxt = cell(map.get('floors'));
    const floors = floorsTxt ? parseFloors(floorsTxt) : undefined;
    const fixtures = this.rowFixtures(cells, map);
    const campus = clean(cell(map.get('campus'))) || (group && CAMPUS_WORD.test(group) ? group : undefined);
    const use = [clean(cell(map.get('use'))), clean(cell(map.get('typeish')))].filter(Boolean).join(' ');
    if (!(gross && gross > 0) && dining?.periods?.length === undefined && !status && !active && !dining) return true;
    if (gross == null && cleanable == null && !status && !dining && !active) return true;
    this.register({
      bn, name: name || (bn ? `Building ${bn}` : undefined), campus: campus || undefined, gross, cleanable, unit: AREA_U[gUnit], grossPrinted: gUnit !== 'sf' ? grossPrinted : undefined, cleanPrinted: cUnit !== 'sf' ? cleanPrinted : undefined,
      wasGross, floors, fixtures, level, freqText: fTxt || undefined, status, active, use, dining, portableSf, source, tableId: `${ctx.doc.name}:${map.id}`, notes, confidence: codeFromName ? 0.7 : 0.8,
    }, ctx.rank);
    return true;
  }

  rowFixtures(cells: string[], map: TableMap): number | undefined {
    const tot = map.all('fixtures');
    for (const c of [...tot].reverse()) { const v = parseFixtures(cells[c.i], c.slash); if (v != null) return v; }
    const parts = (['fixWC', 'fixUR', 'fixLAV', 'fixSH'] as Role[]).map((r) => map.get(r)).filter((c): c is Col => !!c);
    if (parts.length) { const vs = parts.map((c) => parseNumberCell(cells[c.i])); if (vs.some((v) => v != null)) return vs.reduce<number>((a, b) => a + (b ?? 0), 0); }
    return undefined;
  }

  groundsRow(cells: string[], map: TableMap, ctx: Ctx, source: SourceRef, group: string | undefined) {
    if (isTotalRow(cells)) return;
    const cell = (c?: Col) => (c ? cells[c.i] ?? '' : '');
    const label = clean(cell(map.get('name')) || cell(map.get('use')));
    const rowKeyRaw = clean(cell(map.get('rowKey')));
    const numRaw = map.get('number') ? normalizeBuildingNumber(cell(map.get('number'))) : undefined;
    const rowKey = rowKeyRaw && !isBlankish(rowKeyRaw) ? rowKeyRaw : undefined;
    if (!label && !rowKey && !numRaw) return;
    // rows that are out of scope, information only, or maintained by others carry no workload
    const textCells = map.cols.filter((c) => ['remarks', 'status', 'name', 'info', 'use', 'typeish'].includes(c.role)).map((c) => clean(cells[c.i])).join(' ; ');
    if (/not in scope|out of scope|not in contract|information only|for reference only|by others|not maintained|maintained by (?!the contractor)|excluded from|\bdeleted\b|\bdisposed\b|\bclosed\b|dato informativo/i.test(textCells)) return;
    const st = clean(cell(map.get('status'))).toLowerCase();
    if (st && !/^(?:active|in service|yes)$/.test(st)) return;
    const cat = clean(cell(map.get('catcode')));
    if (this.catExcluded(cat)) return;
    const served: string[] = [];
    const sv = clean(cell(map.get('served')));
    if (sv && !isBlankish(sv)) served.push(...this.servedIds(sv));
    if (numRaw) served.push(numRaw);
    for (const r of refsIn(label)) if (!r.site && !served.includes(r.id)) served.push(r.id);
    const typeTxt = clean(cell(map.get('typeish')));
    const tk = typeTxt && !isBlankish(typeTxt) ? (typeKind(` ${typeTxt.toLowerCase()} `) ?? groundsKindFromText(typeTxt)) : undefined;
    const lk = kindFromLevel(cell(map.get('svcLvl'))) ?? kindFromCycle(cell(map.get('cycle')));
    const campus = clean(cell(map.get('campus'))) || (group && CAMPUS_WORD.test(group) ? group : undefined);
    const base = { label: label || rowKey || '', rowKey: rowKey ?? numRaw, served, source, tableId: `${ctx.doc.name}:${map.id}`, rank: ctx.rank, campus };
    const eu = map.eu;
    let any = false;
    for (const c of map.all('gQty')) {
      const v = parseNumberCell(cells[c.i], eu);
      if (v == null || v <= 0 || isBlankish(cells[c.i])) continue;
      const kind = c.kind ?? tk ?? lk ?? groundsKindFromText(label) ?? 'improved_turf';
      this.pushGrounds({ ...base, kind, qty: v, unit: c.unit ?? 'ac', docLabel: [c.text, typeTxt].filter(Boolean).join(' · ') || undefined });
      any = true;
    }
    const qCol = map.get('qty');
    if (qCol) {
      const qTxt = clean(cells[qCol.i]);
      const v = parseNumberCell(qTxt, eu);
      const u = unitOf(` ${clean(cell(map.get('unit')))} `) ?? unitOf(qTxt) ?? qCol.unit ?? map.unit;
      if (v && v > 0 && u && u !== 'other') {
        let kind = tk ?? groundsKindFromText(`${label} ${qTxt.replace(/[\d.,]+/g, ' ')}`);
        if (!kind && (u === 'ac' || u === 'ha')) kind = lk ?? 'improved_turf';
        if (kind === 'tree_canopy' && u !== 'ea') kind = undefined;
        if (u === 'ea' && kind !== 'tree_canopy') kind = /tree/i.test(`${label} ${qTxt}`) ? 'tree_canopy' : undefined;
        if (kind && ((u !== 'ac' && u !== 'ha') || ['improved_turf', 'semi_improved', 'unimproved', 'athletic_field'].includes(kind))) { this.pushGrounds({ ...base, kind, qty: v, unit: u, docLabel: typeTxt || undefined }); any = true; }
      }
    }
    // medians and rights-of-way: length × width × sides
    const lCol = map.get('length'), wCol = map.get('width');
    if (lCol && wCol) {
      const L = parseNumberCell(cells[lCol.i], eu), W = parseNumberCell(cells[wCol.i], eu);
      const S = parseNumberCell(cell(map.get('sides')), eu) || 1;
      const surface = clean(cell(map.get('surface')));
      if (L && W && L > 0 && W > 0) {
        const sqft = L * W * S;
        const hard = /paver|concrete|asphalt|paved|no turf|hardscape|brick|stone/i.test(surface);
        const dims = { lf: L, width: W, sides: S, hard };
        const how = `${fmt(L)} LF × ${W} FT${S !== 1 ? ` × ${S} sides` : ''} = ${fmt(sqft)} SF`;
        if (hard) this.pushGrounds({ ...base, kind: /parking|lot/i.test(surface) ? 'parking' : 'sidewalk', qty: sqft, unit: 'sf', notes: how, dims, docLabel: surface || undefined });
        else this.pushGrounds({ ...base, kind: lk ?? tk ?? 'improved_turf', qty: sqft / 43560, unit: 'ac', notes: `${how} (${round(sqft / 43560, 3)} acres)`, dims, docLabel: surface || undefined });
        any = true;
        const tr = surface.match(/(\d[\d,]*)\s*(?:ea|each|trees?)\b/i);
        if (tr && /tree/i.test(surface)) this.pushGrounds({ ...base, label: `${base.label} street trees`, kind: 'tree_canopy', qty: Number(tr[1].replace(/,/g, '')), unit: 'ea' });
      }
    }
    void any;
  }

  servedIds(text: string): string[] {
    const out: string[] = [];
    const t = dash(clean(text));
    const tokens = t.split(/\s*[,;]\s*|\s+and\s+/);
    for (const tok of tokens) {
      const rng = tok.match(/([A-Z]{0,4}-?\d{1,7}[A-Z]?)\s+(?:through|thru|to|-)\s+([A-Z]{0,4}-?\d{1,7}[A-Z]?)/i);
      if (rng) {
        const pa = rng[1].toUpperCase().match(/^(.*?)(\d+)$/), pb = rng[2].toUpperCase().match(/^(.*?)(\d+)$/);
        if (pa && pb && pa[1] === pb[1]) {
          const lo = Number(pa[2]), hi = Number(pb[2]);
          for (const r of this.recs) { if (!r.bn) continue; const m = r.bn.toUpperCase().match(/^(.*?)(\d+)$/); if (m && m[1] === pa[1] && Number(m[2]) >= lo && Number(m[2]) <= hi) out.push(r.bn); }
          if (!out.length) out.push(rng[1], rng[2]);
          continue;
        }
      }
      const bn = normalizeBuildingNumber(tok);
      if (bn) out.push(bn);
    }
    return out;
  }

  changeRow(cells: string[], map: TableMap, ctx: Ctx, source: SourceRef) {
    const bn = normalizeBuildingNumber(cells[map.get('number')!.i]);
    if (!bn) return;
    const name = clean(cells[map.get('name')?.i ?? -1]);
    const change = clean(cells[map.get('change')?.i ?? -1]);
    const revised = clean(cells[map.get('revised')?.i ?? -1]);
    const text = [change, revised].filter(Boolean).join('. ');
    const para: Para = { text, line: 0, page: ctx.page, subjects: [bn], cell: true, inAmend: true };
    if (/\badd(?:ed|ition)?\b/i.test(change)) this.addFacility(bn, name, revised, ctx, source);
    else if (/remov|delet|exclud|not in scope|withdrawn/i.test(change)) this.setStatus(bn, { status: ctx.amendLike ? 'deleted_by_amendment' : 'excluded', reason: `${change}${revised ? `: ${revised}` : ''}`.slice(0, 160) }, ctx);
    this.statements(para, ctx, [para]);
  }

  mealsRow(cells: string[], map: TableMap, ctx: Ctx, source: SourceRef) {
    const first = clean(cells[0]);
    const mm = first.toLowerCase().match(MEAL_RE);
    if (!mm || isTotalRow(cells)) return;
    let mt = this.mealTables.find((m) => m.source.file === source.file && (m as { mapId?: string }).mapId === map.id);
    if (!mt) { mt = { periodsByTarget: new Map(), source, rank: ctx.rank }; (mt as { mapId?: string }).mapId = map.id; this.mealTables.push(mt); }
    const period = mealName(mm[1]);
    for (let k = 1; k < cells.length; k++) {
      const v = parseNumberCell(cells[k], map.eu);
      if (v == null) continue;
      const h = normHeader(map.cols.find((c) => c.i === k)?.text ?? (mt as { headers?: string[] }).headers?.[k] ?? '');
      const weekend = /weekend|\bsat|\bsun|holiday/.test(h);
      const target = h.replace(/\b(?:weekday|weekend|week day|average|avg|headcount|mon(?:day)?\s*-\s*fri(?:day)?|sat(?:urday)?|sun(?:day)?|holidays?|&|and)\b/g, ' ').replace(/\s+/g, ' ').trim() || '_';
      const list = mt.periodsByTarget.get(target) ?? [];
      let p = list.find((x) => x.period === period);
      if (!p) { p = { period }; list.push(p); }
      if (weekend) p.weekendHeadcount = v; else p.weekdayHeadcount = v;
      mt.periodsByTarget.set(target, list);
    }
  }

  // ---------------------------------------------------------------- key / value sheets
  kvPairs(cells: string[], line: string, open: boolean): [KvField, string, string][] | null {
    let pairs: [string, string][] = [];
    if (cells.length >= 2) { for (let k = 0; k + 1 < cells.length; k += 2) pairs.push([cells[k], cells[k + 1]]); }
    else { const m = line.match(/^([A-Za-z][A-Za-z0-9 /()&.,'-]{2,60}?):\s+(.+)$/); if (m) pairs = [[m[1], m[2]]]; }
    const out: [KvField, string, string][] = [];
    for (const [l, v] of pairs) { const f = kvField(clean(l)); if (f && clean(v)) out.push([f, clean(l), v]); }
    if (!out.length) return null;
    if (!open && !out.some(([f]) => f === 'number')) return null;
    if (out.length === 1 && out[0][0] === 'number' && (isNumericCell(out[0][2]) && cells.length > 2)) return null;
    if (out[0][0] === 'number' && !normalizeBuildingNumber(out[0][2])) return null;
    // a table header is not a key / value line
    if (cells.length >= 3 && cells.every((c) => !isNumericCell(c)) && out.length === 1 && out[0][0] !== 'number' && !/\d/.test(out[0][2])) return null;
    return out;
  }
  kvApply(kv: KvRec, pairs: [KvField, string, string][], _map: TableMap | null) {
    for (const [f, , raw] of pairs) {
      const v = clean(raw);
      switch (f) {
        case 'number': kv.bn = normalizeBuildingNumber(v); break;
        case 'name': kv.name = v; break;
        case 'gross': { const u = unitOf(v); const n = parseNumberCell(v); if (n) { kv.gross = u === 'sm' ? Math.round(n * SQFT_PER.sm) : n; if (u === 'sm') kv.unit = 'sm'; } break; }
        case 'cleanable': { const u = unitOf(v); const n = parseNumberCell(v); if (n) kv.cleanable = u === 'sm' ? Math.round(n * SQFT_PER.sm) : n; break; }
        case 'floors': kv.floors = parseFloors(v); break;
        case 'above': kv.above = parseFloors(v); break;
        case 'below': { const n = parseNumberCell(v); kv.below = n != null && n < 20 ? n : undefined; break; }
        case 'fixtures': kv.fixtures = parseFixtures(v); break;
        case 'freq': kv.freqText = v; break;
        case 'use': kv.use = v; break;
        case 'status': kv.status = statusFromText(v); break;
        case 'groundsIn': if (/^no\b|not in contract|by others/i.test(v)) kv.groundsOut = true; break;
        case 'improved': case 'semi': case 'unimproved': case 'parking': case 'sidewalk': case 'beds': case 'trees': {
          const n = parseNumberCell(v); if (!n) break;
          const kind: GroundsKind = f === 'improved' ? 'improved_turf' : f === 'semi' ? 'semi_improved' : f === 'unimproved' ? 'unimproved' : f === 'parking' ? 'parking' : f === 'sidewalk' ? 'sidewalk' : f === 'beds' ? 'shrub_bed' : 'tree_canopy';
          const u = unitOf(v) ?? (kind === 'tree_canopy' ? 'ea' : ['parking', 'sidewalk', 'shrub_bed'].includes(kind) ? 'sf' : 'ac');
          kv.grounds.push({ kind, qty: n, unit: u, text: v });
          break;
        }
        default: break;
      }
    }
  }
  flushKv(kv: KvRec, ctx: Ctx) {
    if (!kv.bn) return;
    const floors = kv.above != null ? kv.above + (kv.below ?? 0) : kv.floors;
    this.register({ bn: kv.bn, name: kv.name ?? `Building ${kv.bn}`, strongName: !!kv.name, gross: kv.gross, cleanable: kv.cleanable, unit: kv.unit, floors, fixtures: kv.fixtures, level: serviceLevelFromText(kv.freqText), freqText: kv.freqText, use: kv.use, status: kv.status, source: kv.source, tableId: `${ctx.doc.name}:kv:${kv.bn}`, confidence: 0.75, active: true }, ctx.rank);
    if (kv.groundsOut) return;
    for (const g of kv.grounds) {
      if (/not in contract|by others|not maintained|maintained by (?!the contractor)|information only|excluded|not included/i.test(g.text)) continue;
      this.pushGrounds({ kind: g.kind, qty: g.qty, unit: g.unit, label: `${kv.bn} ${labelKind(g.kind).toLowerCase()}`, served: [kv.bn], source: kv.source, tableId: `${ctx.doc.name}:kv:${kv.bn}`, rank: ctx.rank, docLabel: g.text.slice(0, 80) });
    }
  }

  // ---------------------------------------------------------------- facility lines with no table header ("Bldg 1201, Brigade HQ, 45,200 SF, daily")
  fallbackFacility(cells: string[], line: string, ctx: Ctx, source: SourceRef) {
    const t = dash(clean(line));
    const m = t.match(/^(?:bldgs?|buildings?|bld|facility|fac)\.?\s*(?:no\.?|#)?\s*([A-Z]{0,3}-?\d{1,6}[A-Z]{0,2}(?:-[A-Z0-9]{1,3})?)\b/i);
    if (!m || t.length > 220) return;
    if (/\b(?:is|are|was|were|shall|will|includ\w*|exclud\w*|not|has|have|see|per)\b/i.test(t)) return;
    const sf = [...t.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,7})(?:\.\d+)?\s*(gsf|csf|sf|s\.f\.|sq\.?\s*ft\.?|square\s*feet|ft²|sm|m²)(?![a-z])/gi)];
    if (!sf.length) return;
    const bn = normalizeBuildingNumber(m[1]);
    if (!bn) return;
    const vals = sf.map((x) => ({ v: Number(x[1].replace(/,/g, '')), u: /sm|m²/i.test(x[2]) ? 'sm' as const : 'sf' as const, c: /csf/i.test(x[2]) }));
    const toSf = (x: { v: number; u: 'sf' | 'sm' }) => (x.u === 'sm' ? Math.round(x.v * SQFT_PER.sm) : x.v);
    const grossV = vals.find((x) => !x.c) ?? vals[0];
    const gross = Math.max(...vals.filter((x) => !x.c).map(toSf), toSf(grossV));
    const others = vals.map(toSf).filter((v) => v < gross);
    const parts = (cells.length > 1 ? cells : t.split(/\s*[,;]\s*/)).map(clean);
    const name = parts.map((p) => p.replace(m[0], '').trim()).find((p) => p.length > 3 && /[a-z]{3}/i.test(p) && !/\d[\d,]*\s*(?:sf|gsf|sq)/i.test(p) && !serviceLevelFromText(p) && !/^\d/.test(p)) ?? t.replace(m[0], '').replace(/[\d,]+\s*(?:gsf|sf|sq\.?\s*ft\.?|square feet).*/i, '').replace(/^[\s,–-]+|[\s,–-]+$/g, '');
    const fl = t.match(/\b(\d{1,2})\s*-?\s*(?:stories|story|floors?|fl\.?|levels?)\b/i);
    const fx = t.match(/(\d{1,3})\s*(?:restroom\s+)?(?:fixtures|fixt)\b/i);
    this.register({ bn, name: name || `Building ${bn}`, gross, cleanable: others.length ? Math.max(...others) : undefined, floors: fl ? Number(fl[1]) : undefined, fixtures: fx ? Number(fx[1]) : undefined, level: serviceLevelFromText(t.replace(/\d[\d,]*\s*(?:gsf|sf|sq\.?\s*ft\.?)/gi, '')), source, tableId: `${ctx.doc.name}:lines`, confidence: 0.55 }, ctx.rank);
  }

  // ---------------------------------------------------------------- grounds sentences ("Type II (semi-improved) 30 acres")
  proseGrounds(line: string, ctx: Ctx, source: SourceRef) {
    const t = clean(line);
    if (!/\d/.test(t) || !/acre|\bac\b|hectare|\bha\b|\bsf\b|square (?:feet|yards)|\bsy\b|trees/i.test(t)) return;
    if (/\b(?:means|defined|definition|minimum|maximum|height|inches|per (?:acre|sf)|\$)/i.test(t)) return;
    for (const clause of t.split(/;\s*|\.\s+(?=[A-Z])/)) {
      if (/\b(?:total|totals|totaling|in all|altogether|combined|site area|total site)\b/i.test(clause)) continue;
      if (/not (?:maintained|included|in scope|part)|exclud|by others|maintained by (?!the contractor)|information only|not mowed/i.test(clause)) continue;
      const q = clause.match(/(\d[\d,]*(?:\.\d+)?)\s*(acres?|ac\.?|hectares?|ha|sf|square feet|sq\.?\s*ft\.?|sy|square yards|trees)\b/i);
      if (!q) continue;
      const kind = groundsKindFromText(clause);
      if (!kind) continue;
      const u = unitOf(` ${q[2]} `) ?? 'ac';
      if ((kind === 'tree_canopy') !== (u === 'ea')) continue;
      if (['improved_turf', 'semi_improved', 'unimproved', 'athletic_field'].includes(kind) && !['ac', 'ha', 'sf', 'sm', 'sy'].includes(u)) continue;
      const served = refsIn(clause).filter((r) => !r.site).map((r) => r.id);
      this.pushGrounds({ kind, qty: Number(q[1].replace(/,/g, '')), unit: u, label: clause.replace(q[0], '').replace(/[:,\s]+$/, '').slice(0, 100), served, source, tableId: `${ctx.doc.name}:prose:${source.excerpt?.slice(0, 30)}`, rank: ctx.rank });
    }
  }

  // ---------------------------------------------------------------- amendment / Q&A / prose statements
  statements(p: Para, ctx: Ctx, all: Para[]) {
    const text = p.text;
    if (!/delet|remov|exclud|not part of|not in scope|revis|chang|correct|amend|added|addition|increas|decreas|shall not be priced|no longer|is now/i.test(text)) return;
    const known = this.knownKey;
    const paraRefs = refsIn(text, known);
    const paraKeys = [...new Set(paraRefs.map((r) => r.key))];
    const paraSubject = paraKeys.length === 1 ? paraRefs[0] : undefined;
    const subjectRefs = (p.subjects ?? []).map((id) => ({ id, key: bnKey(id), at: 0, site: false }));
    const amend = ctx.amendLike || p.inAmend || /amendment|addendum/i.test(text);
    for (const s of splitSentences(text)) {
      const refs = refsIn(s, known);
      // deletions / exclusions
      const del = s.match(/\b(?:is|are|was|were|has been|have been|hereby|will be|shall be)\s+(?:hereby\s+)?(?:deleted|removed|excluded|eliminated|withdrawn)\b|\b(?:is|are)\s+not\s+(?:a\s+)?part\s+of\s+(?:this|the)\s+(?:solicitation|contract|requirement|scope|rfp|work)|\bremoved\s+from\s+(?:the\s+)?scope\b|\bno\s+longer\s+(?:in\s+scope|required|part\s+of)\b|\bis\s+DELETED\b/i);
      if (del && !/\b(?:may|might|could|if|unless|whether|would)\b[^.]{0,40}$/i.test(s.slice(0, del.index))) {
        let targets = refs.filter((r) => r.at < (del.index ?? 0));
        if (!targets.length) { const after = s.slice((del.index ?? 0) + del[0].length); if (/^[^.]*:/.test(after)) targets = refsIn(after.slice(after.indexOf(':')), known); }
        if (!targets.length && p.cell && subjectRefs.length === 1 && !refs.length) targets = subjectRefs;
        for (const r of targets) {
          const reason = s.slice(0, 160);
          if (!r.site) this.setStatus(r.id, { status: amend ? 'deleted_by_amendment' : 'excluded', reason }, ctx);
          this.deleteGrounds(r.key, ctx);
        }
      }
      // additions with their values ("Building 1114, Ridgeview Commons, is added …: 11,000 gross square feet, …")
      const add = s.match(/\b(?:is|are|has been|have been|will be)\s+(?:hereby\s+)?added\b|\badded\s+to\s+(?:the\s+)?(?:scope|exhibit|te-?\d|list|facility list|requirement|contract)\b/i);
      if (add && amend) {
        const targets = refs.filter((r) => r.at < (add.index ?? 0) && !r.site);
        if (targets.length === 1) {
          const nm = s.slice(0, add.index).replace(/^.*?\b(?:bldg|building|facility|location)\.?\s*#?\s*[A-Z0-9-]+\s*,?\s*/i, '').replace(/,\s*$/, '').trim();
          this.addFacility(targets[0].id, nm.length > 3 && nm.length < 100 && !/\d{2,}/.test(nm) ? nm : undefined, s.slice(add.index), ctx, { file: ctx.doc.name, page: p.page, excerpt: s.slice(0, 200) });
        }
      }
      // revisions ("Gross SF is REVISED from 2,240 to 2,420", "Amendment 0002 revises Building 2101 to 52,980 GSF")
      if (/revis|chang|correct|amend|increas|decreas|reduc|updat|is now/i.test(s)) {
        for (const clause of s.split(/;\s+|,\s+and\s+(?=the\s|[A-Z])/)) this.revision(clause, refs.length ? refs : refsIn(clause, known), paraSubject, subjectRefs, ctx, p, amend);
      } else if (amend && /\b(?:gross|cleanable|custodial)\s+(?:square\s+(?:footage|feet)|sq\.?\s*ft|sf|area)\s+(?:of|for)\s+/i.test(s)) {
        this.revision(s, refs, paraSubject, subjectRefs, ctx, p, amend);
      }
    }
    void all;
  }

  revision(clause: string, refs: Ref[], paraSubject: Ref | undefined, subjects: Ref[], ctx: Ctx, p: Para, amend: boolean) {
    const NUM = '(\\d[\\d.,]*(?:\\s*(?:\\/|@)\\s*\\d[\\d.,]*)*)';
    const UNIT = '(?:\\s*(sf|gsf|square feet|sq\\.?\\s*ft\\.?|acres?|ac\\b|lf|linear feet|sy|sm|m²|floors?|fixtures))?';
    const c = dash(clean(clause));
    const fromTo = c.match(new RegExp(`\\bfrom\\s+["“]?${NUM}["”]?${UNIT}\\s+to\\s+["“]?${NUM}["”]?${UNIT}`, 'i'));
    let oldTxt: string | undefined, newTxt: string | undefined, unitTxt = '', at = 0;
    if (fromTo) { oldTxt = fromTo[1]; newTxt = fromTo[3]; unitTxt = (fromTo[2] ?? fromTo[4] ?? '').toLowerCase(); at = fromTo.index ?? 0; }
    else {
      const to = c.match(new RegExp(`\\b(?:revise[sd]?|change[sd]?|correct(?:ed|s)?|amend(?:ed|s)?|increase[sd]?|decrease[sd]?|reduce[sd]?)\\b[^.]{0,60}?\\bto\\s+${NUM}${UNIT}`, 'i'))
        ?? (amend ? c.match(new RegExp(`\\b(?:gross|cleanable|custodial)\\s+(?:square\\s+(?:footage|feet)|sq\\.?\\s*ft|sf|area)\\s+(?:of|for)\\s+[^.]{1,60}?\\s+is\\s+${NUM}${UNIT}`, 'i')) : null);
      if (!to) return;
      newTxt = to[1]; unitTxt = (to[2] ?? '').toLowerCase(); at = to.index ?? 0;
      if (!/sf|gsf|square|sq|acre|lf|sy|sm|m²|floor|fixture/i.test(unitTxt + c.slice(0, at + to[0].length))) return;
    }
    const before = c.slice(0, at).toLowerCase();
    const seg = before.split(/[:.]\s+/).slice(-1)[0] ?? before;
    let field: 'gross' | 'cleanable' | 'floors' | 'fixtures' | 'length' | 'width' | 'acres' | 'portable' | 'area' | undefined;
    if (/@/.test(oldTxt ?? '') || /@/.test(newTxt ?? '')) field = 'portable';
    else if (/cleanable|custodial (?:\(cleanable\) )?(?:square|sq|sf|area)|\bcsf\b|net area|service area/.test(seg)) field = 'cleanable';
    else if (/\bfloors?\b|stories|levels/.test(seg) || /floor/.test(unitTxt)) field = 'floors';
    else if (/fixtures/.test(seg) || /fixture/.test(unitTxt)) field = 'fixtures';
    else if (/\blength\b|\blf\b/.test(seg) || /lf|linear/.test(unitTxt)) field = 'length';
    else if (/\bwidth\b/.test(seg)) field = 'width';
    else if (/acres?|turf|mow|grounds/.test(seg) || /acre|^ac$/.test(unitTxt)) field = 'acres';
    else if (/gross|gsf|pricing area|building sf|permanent building/.test(seg)) field = 'gross';
    else if (/sf|square|sq|area|gsf/.test(seg + ' ' + unitTxt)) field = 'area';
    else if (/portables?|number of|count/.test(seg)) return;
    if (!field) return;
    const isFixtures = field === 'fixtures';
    const parse = (s?: string) => { if (!s) return undefined; if (isFixtures && /\//.test(s)) return parseFixtures(s, true); return parseNumberCell(s); };
    const oldV = parse(oldTxt), newV = parse(newTxt);
    if (newV == null || !isFinite(newV)) return;
    let targets = refs.filter((r) => r.at <= at + 5);
    if (!targets.length) targets = refs.length ? refs : paraSubject ? [paraSubject] : subjects.length === 1 ? subjects : [];
    if (!targets.length) return;
    const keys = [...new Set(targets.map((r) => r.key))];
    if (keys.length !== 1) return;
    const key = keys[0];
    const why = `${clean(clause).slice(0, 140)} (${ctx.doc.name})`;
    // grounds rows (sites, segments)
    if (field === 'acres' || field === 'length' || field === 'width') {
      for (const g of this.grounds) {
        if (!g.rowKey || bnKey(g.rowKey) !== key) continue;
        if ((field === 'length' || field === 'width') && g.dims) {
          const d = g.dims;
          if (field === 'length' && (oldV == null || Math.abs(d.lf - oldV) < 1)) d.lf = newV;
          else if (field === 'width' && (oldV == null || Math.abs(d.width - oldV) < 0.1)) d.width = newV;
          else continue;
          const sqft = d.lf * d.width * d.sides;
          g.g.quantity = round(g.g.unit === 'acres' ? sqft / 43560 : sqft, 4);
          g.g.notes = `${g.g.notes ? `${g.g.notes}; ` : ''}revised: ${why}`;
        } else if (field === 'acres' && ['acres', 'hectares'].includes(g.g.unit) && oldV != null && Math.abs(g.g.quantity - oldV) <= Math.max(0.005, oldV * 0.002)) {
          g.g.quantity = newV; g.g.notes = `${g.g.notes ? `${g.g.notes}; ` : ''}revised from ${oldV}: ${why}`;
        }
      }
      if (field === 'acres') return;
      return;
    }
    const recs = this.findRecs(key);
    if (recs.length !== 1) return;
    const r = recs[0];
    const close = (a: number | undefined, b: number | undefined) => a != null && b != null && Math.abs(a - b) <= Math.max(1, b * 0.002);
    const set = (f: 'gross' | 'cleanable' | 'floors' | 'fixtures', v: number) => {
      if (f === 'gross') { if (Math.abs(r.gross - v) > 0.5) r.notes.push(`Gross revised from ${fmt(r.gross)} to ${fmt(v)} SF: ${why}`); r.gross = v; r.grossRank = Math.max(r.grossRank, ctx.rank); r.unit = 'sf'; r.grossPrinted = undefined; }
      else if (f === 'cleanable') { if (r.cleanable !== v) r.notes.push(`Cleanable revised to ${fmt(v)} SF: ${why}`); r.cleanable = v; r.cleanRank = Math.max(r.cleanRank, ctx.rank); }
      else if (f === 'floors') { if (v >= 1 && v < 150) { r.floors = v; r.floorsRank = Math.max(r.floorsRank, ctx.rank); r.notes.push(`Floors revised to ${v}: ${why}`); } }
      else { r.fixtures = v; r.fixRank = Math.max(r.fixRank, ctx.rank); r.notes.push(`Fixtures revised to ${v}: ${why}`); }
    };
    if (field === 'portable') {
      const sum = (s?: string) => [...(s ?? '').matchAll(/(\d+)\s*@\s*([\d,]+)/g)].reduce((a, m) => a + Number(m[1]) * Number(m[2].replace(/,/g, '')), 0);
      const o = sum(oldTxt), n = sum(newTxt);
      if (r.portableSf != null && Math.abs(r.portableSf - o) < 1 && n !== o) { set('gross', r.gross - o + n); r.portableSf = n; }
      return;
    }
    if (field === 'floors' || field === 'fixtures') { if (oldV == null || field === 'fixtures' || close(r[field] ?? undefined, oldV) || r[field] == null || amend) set(field, newV); return; }
    if (field === 'gross' || field === 'cleanable') { if (newV >= 50) set(field, newV); return; }
    // a bare area: match the old value to the field it revises
    if (oldV != null && oldV >= 50) {
      if (close(r.gross, oldV)) set('gross', newV);
      else if (close(r.cleanable, oldV)) set('cleanable', newV);
    }
  }

  setStatus(id: string, st: { status: FacilityStatus; reason: string }, ctx: Ctx) {
    for (const r of this.findRecs(bnKey(id))) { r.status = st.status; r.statusReason = st.reason; r.statusRank = Math.max(r.statusRank, ctx.rank); }
  }
  deleteGrounds(key: string, ctx: Ctx) {
    const before = this.grounds.length;
    this.grounds = this.grounds.filter((g) => !(g.rowKey && bnKey(g.rowKey) === key && g.rank <= ctx.rank));
    void before;
  }
  addFacility(id: string, name: string | undefined, text: string, ctx: Ctx, source: SourceRef) {
    const t = dash(clean(text));
    const num = (re: RegExp) => { const m = t.match(re); return m ? parseNumberCell(m[1]) : undefined; };
    const gross = num(/gross\s+(?:sq\.?\s*ft\.?|square\s+f(?:ee|oo)t(?:age)?|sf|area)\s*(?:of|is|:)?\s*([\d,]+)/i) ?? num(/([\d,]{3,})\s*(?:gross\s+(?:square\s+feet|sq\.?\s*ft\.?|sf)|gsf)\b/i);
    const cleanable = num(/(?:cleanable|custodial)\s+(?:sq\.?\s*ft\.?|square\s+f(?:ee|oo)t|sf|area)\s*(?:of|is|:)?\s*([\d,]+)/i) ?? num(/([\d,]{3,})\s*(?:cleanable|custodial)\s+(?:square\s+feet|sq\.?\s*ft\.?|sf)/i);
    const fl = t.match(/\b(\d{1,2}|one|two|three|four|five|six)\s*(?:\(\d+\)\s*)?floors?\b/i);
    const fx = t.match(/(\d{1,4})\s*(?:restroom\s+|plumbing\s+)?fixtures/i);
    const dy = t.match(/\b(\d|one|two|three|four|five|six|seven)\s*(?:\(\d\)\s*)?(?:service\s+)?days?\s*(?:per|a|\/)\s*week/i);
    const days = wordOrNum(dy?.[1]);
    const freqText = dy?.[0];
    const campus = t.match(/\bcampus:\s*([A-Za-z][A-Za-z .'-]{1,40})/i)?.[1]?.trim().replace(/\.$/, '');
    if (!gross && !this.findRecs(bnKey(id)).length) return;
    this.register({ bn: normalizeBuildingNumber(id) ?? id, name: name || `Building ${id}`, campus, gross, cleanable, floors: wordOrNum(fl?.[1]), fixtures: fx ? Number(fx[1]) : undefined, level: days != null ? levelFromDays(days) : undefined, freqText, active: true, source, tableId: `${ctx.doc.name}:added:${id}`, notes: [`Added by ${ctx.doc.name}.`], confidence: 0.7 }, ctx.rank + 0.0001);
  }

  // ---------------------------------------------------------------- dining workload in prose ("2,650 meals per day across four meal periods")
  proseDining(paras: Para[], idx: number, ctx: Ctx) {
    const p = paras[idx];
    const t = dash(p.text);
    const m = t.match(/(\d[\d,]*)\s*(?:meals?|headcounts?|patrons?|rations?|diners?|customers?)\s*(?:are\s+served\s+)?(?:per|a|\/|each)\s*day/i) ?? t.match(/average daily (?:headcount|census|meals?) (?:is|of)\s*(\d[\d,]*)/i);
    if (!m) return;
    const meals = Number(m[1].replace(/,/g, ''));
    if (!(meals > 0)) return;
    const near = [p.text, paras[idx - 1]?.text ?? '', paras[idx + 1]?.text ?? ''].join(' ');
    const cnt = t.match(/\b(two|three|four|five|2|3|4|5)\s*(?:\(\d\)\s*)?meal(?:s|\s+periods?)\b/i);
    const named = new Set([...t.toLowerCase().matchAll(new RegExp(MEAL_RE.source, 'g'))].map((x) => mealName(x[1])));
    const mealPeriods = cnt ? wordOrNum(cnt[1]) ?? 3 : named.size >= 2 ? named.size : /midnight meal/i.test(near) ? 4 : 3;
    const seats = near.match(/seating capacity (?:is|of)\s*(\d[\d,]*)|(\d[\d,]*)\s*seats?\b/i);
    const kitchen = near.match(/kitchen[^.]{0,60}?(\d[\d,]*)\s*(?:sf|square feet|sq\.?\s*ft)/i);
    const room = near.match(/dining room[^.]{0,60}?(\d[\d,]*)\s*(?:sf|square feet|sq\.?\s*ft)/i);
    const style: DiningProfile['serviceStyle'] = /attendant[- ]only|dfa (?:services? )?only|dining facility attendant (?:services? )?only/i.test(near) ? 'dining_facility_attendant' : /management only/i.test(near) ? 'management_only' : 'full_food_service';
    const daysPerWeek = /seven days|7 days|365 days|daily including weekends/i.test(near) ? 7 : /five days|monday through friday|weekdays only/i.test(near) ? 5 : 7;
    const dining: Partial<DiningAcc> = { mealsPerDay: meals, mealPeriods, daysPerWeek, seats: seats ? Number((seats[1] ?? seats[2]).replace(/,/g, '')) : undefined, kitchenSqft: kitchen ? Number(kitchen[1].replace(/,/g, '')) : undefined, diningRoomSqft: room ? Number(room[1].replace(/,/g, '')) : undefined, serviceStyle: style };
    // target: a building named in this or the previous paragraphs, else the only dining facility
    let target: FacRec | undefined;
    for (let k = idx; k >= Math.max(0, idx - 3) && !target; k--) {
      for (const r of refsIn(paras[k].text, this.knownKey)) { const recs = this.findRecs(r.key); if (recs.length === 1) { target = recs[0]; break; } }
    }
    if (!target) { const dfacs = this.recs.filter((r) => categorize(`${r.name} ${r.use}`) === 'dining'); if (dfacs.length >= 1) target = dfacs[0]; }
    const source: SourceRef = { file: ctx.doc.name, page: p.page, excerpt: p.text.slice(0, 200) };
    if (target) this.merge(target, { dining, source, tableId: `${ctx.doc.name}:dining` }, ctx.rank);
    else this.register({ name: 'Dining Facility', gross: (dining.kitchenSqft ?? 0) + (dining.diningRoomSqft ?? 0) || undefined, dining, source, tableId: `${ctx.doc.name}:dining`, notes: ['Dining headcount found but no facility row; verify square footage.'], confidence: 0.4, active: true }, ctx.rank);
  }

  // ---------------------------------------------------------------- per-meal tables in the other orientation ("Breakfast | 620 | 410")
  resolveMealTables() {
    for (const mt of this.mealTables) {
      for (const [target, periods] of mt.periodsByTarget) {
        let rec: FacRec | undefined;
        const dfacs = this.recs.filter((r) => categorize(`${r.name} ${r.use}`) === 'dining' || r.dining);
        if (target !== '_') {
          const refs = refsIn(target.toUpperCase());
          const bnm = target.match(/\b([a-z]{0,3}-?\d{2,6}[a-z]?)\b/i);
          const key = refs[0]?.key ?? (bnm ? bnKey(bnm[1]) : undefined);
          if (key) rec = this.findRecs(key)[0];
          if (!rec) rec = dfacs.map((r) => ({ r, s: nameSimilarity(r.name, target) })).sort((a, b) => b.s - a.s).find((x) => x.s >= 0.5)?.r;
        }
        if (!rec && dfacs.length === 1) rec = dfacs[0];
        if (!rec) continue;
        this.merge(rec, { dining: { periods }, source: mt.source, tableId: `${mt.source.file}:meals` }, mt.rank);
      }
    }
  }

  // ---------------------------------------------------------------- inventory
  finish(): Inventory {
    this.resolveMealTables();
    const facilities: Facility[] = [];
    const usedIds = new Set<string>();
    const idOf = new Map<FacRec, string>();
    const keyCount = new Map<string, number>();
    for (const r of this.recs) if (r.key) keyCount.set(r.key, (keyCount.get(r.key) ?? 0) + 1);
    for (const r of this.recs) {
      let base = r.bn ? `b-${slug(r.bn)}` : `b-${slug(r.name || 'facility')}`;
      if (r.key && (keyCount.get(r.key) ?? 0) > 1 && r.campus) base = `b-${slug(r.campus)}--${slug(r.bn ?? '')}`;
      let id = base; let n = 2;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      usedIds.add(id); idOf.set(r, id);
      let gross = r.gross;
      const notes = [...r.notes];
      if (!(gross > 0) && (r.cleanable ?? 0) > 0) { gross = r.cleanable!; notes.push('Gross area not stated; cleanable area used as gross.'); }
      if (!(gross > 0) && r.dining && ((r.dining.kitchenSqft ?? 0) + (r.dining.diningRoomSqft ?? 0)) > 0) gross = (r.dining.kitchenSqft ?? 0) + (r.dining.diningRoomSqft ?? 0);
      const name = r.name || (r.bn ? `Building ${r.bn}` : 'Facility');
      let category = categorize(`${name} ${r.use}`);
      if (category === 'other' && r.use) category = categorize(r.use);
      if (r.dining && category !== 'dining' && (r.dining.periods.length || r.dining.mealsPerDay)) category = 'dining';
      let dining: DiningProfile | undefined;
      if (r.dining && (r.dining.periods.length || r.dining.mealsPerDay)) {
        const d = r.dining;
        const periods = d.periods;
        const weekdayN = periods.filter((x) => (x.weekdayHeadcount ?? 0) > 0).length;
        const weekendN = periods.filter((x) => (x.weekendHeadcount ?? 0) > 0).length;
        let mealsPerDay = d.mealsPerDay ?? 0;
        if (periods.length) {
          // weekday-only tables: the weekday sum is the daily headcount
          mealsPerDay = weekendN ? mealsPerDayFromPeriods(periods) : periods.reduce((s, x) => s + (x.weekdayHeadcount ?? 0), 0);
        }
        dining = { mealsPerDay, mealPeriods: periods.length ? weekdayN || weekendN : d.mealPeriods ?? 3, daysPerWeek: d.daysPerWeek ?? 7, seats: d.seats, kitchenSqft: d.kitchenSqft, diningRoomSqft: d.diningRoomSqft, serviceStyle: d.serviceStyle ?? 'full_food_service', mealPeriodsDetail: periods.length ? periods : undefined };
        if (periods.length) notes.push(`Meals per day from headcount by meal period: (5 × weekday + 2 × weekend) ÷ 7${weekendN ? '' : ' (weekday table only)'}.`);
      }
      const level: ServiceLevel = r.level ?? (category === 'dining' || category === 'barracks' || category === 'medical' || category === 'fitness' ? 'daily_7' : 'daily_5');
      if (!r.level && r.freqText) notes.push(`Frequency "${r.freqText}" not recognised; defaulted to ${level}.`);
      const scope: Facility['scope'] = dining ? ['custodial', 'floor_care', 'dining'] : ['custodial', 'floor_care'];
      const f: Facility = {
        id, buildingNumber: r.bn, name: name.replace(/\s+/g, ' ').slice(0, 120), category, grossSqft: Math.round(gross * 100) / 100, cleanableSqft: r.cleanable, floors: r.floors ?? 0,
        restroomFixtures: r.fixtures, serviceLevel: level, scope, dining, source: r.source, confidence: gross > 0 ? r.confidence : 0.3,
        campus: r.campus, tableId: r.tableId, serviceFrequencyText: r.freqText,
      };
      if (r.status && r.status !== 'in_scope') { f.status = r.status; f.statusReason = r.statusReason; }
      if (r.unit && r.unit !== 'sf' && (r.grossPrinted != null || r.cleanPrinted != null)) f.originalArea = { gross: r.grossPrinted, cleanable: r.cleanPrinted, unit: r.unit };
      if (!(gross > 0)) notes.push('No floor area found for this facility; enter it before relying on the estimate.');
      if (notes.length) f.notes = notes.join(' ');
      facilities.push(f);
    }
    // grounds: link served buildings; drop areas whose buildings are all out of scope
    const grounds: GroundsArea[] = [];
    let gi = 0;
    for (const g of this.grounds) {
      const recs = g.served.flatMap((id) => this.findRecs(bnKey(id)));
      if (g.served.length && recs.length && recs.every((r) => r.status && r.status !== 'in_scope') && g.served.every((id) => this.findRecs(bnKey(id)).length)) continue;
      const inScope = recs.filter((r) => !r.status);
      const area = { ...g.g, id: `g-${++gi}-${g.g.kind}` };
      if (inScope.length) area.facilityId = idOf.get(inScope[0]);
      if (g.served.length > 1) area.notes = `${area.notes ? `${area.notes}; ` : ''}serves ${g.served.join(', ')}`;
      grounds.push(area);
    }
    return { site: this.site, facilities, grounds };
  }
}

function labelKind(k: GroundsKind) {
  return ({ improved_turf: 'Improved turf', semi_improved: 'Semi-improved grounds', unimproved: 'Unimproved grounds', athletic_field: 'Athletic fields', shrub_bed: 'Shrub beds', parking: 'Parking', sidewalk: 'Sidewalks', tree_canopy: 'Trees' } as Record<GroundsKind, string>)[k];
}

function isNumericRow(cells: string[]): boolean {
  const ne = cells.map(clean).filter(Boolean);
  return ne.length > 0 && ne.filter((c) => isNumericCell(c)).length / ne.length > 0.5;
}

function fits(cells: string[], map: TableMap): boolean {
  if (cells.length < map.n - 1 || cells.length > map.n + 1) return false;
  const num = map.get('number');
  if (num && clean(cells[num.i]) && !normalizeBuildingNumber(cells[num.i])) return false;
  const g = map.gross ?? map.get('qty');
  if (g && clean(cells[g.i]) && !/\d|tbd|n\/a|—|-/i.test(clean(cells[g.i]))) return false;
  return true;
}

/** Two-row header flattening: a colspan label in the first row is prefixed onto each sub-column below it. */
function mergeHeader(top: string[], sub: string[]): string[] {
  const n = Math.max(top.length, sub.length);
  const out: string[] = [];
  let span = '';
  for (let i = 0; i < n; i++) {
    const a = clean(top[i]), b = clean(sub[i]);
    if (a) span = b ? a : '';
    const head = a || (b && span ? span : '');
    out.push([head, b].filter(Boolean).join(' '));
  }
  return out;
}

function splitCode(name: string, allowParen: boolean): { code?: string; name: string } {
  const n = dash(name);
  const m = n.match(/^([A-Z][A-Z0-9]{1,5}(?:\/[A-Z0-9]{1,6})?)\s+-\s+(.+)$/);
  if (m && !/^(?:THE|AND|FOR|NEW|OLD|NORTH|SOUTH|EAST|WEST|MAIN|BLDG|AREA)$/.test(m[1])) return { code: m[1], name: m[2] };
  if (allowParen) { const p = n.match(/^(.+?)\s*\(([A-Z]{2,5})\)$/); if (p) return { code: p[2], name: p[1] }; }
  return { name };
}

function parseFloors(raw: string): number | undefined {
  const t = dash(clean(raw)).toUpperCase();
  if (!t || isBlankish(t)) return undefined;
  if (/\bPT\b/.test(t)) { // Italian notation: PT = ground floor, S1 = one basement level, "PT+2" = three floors
    let n = 1;
    const up = t.match(/PT\s*\+\s*(\d+)/); if (up) n += Number(up[1]);
    const bel = t.match(/\bS(\d)\b/); if (bel) n += Number(bel[1]);
    return n;
  }
  const m = t.match(/^\D{0,3}(\d{1,3})(?![\d,])/);
  const v = m ? Number(m[1]) : wordOrNum(t.split(/\s+/)[0]);
  return v != null && v >= 1 && v <= 150 ? v : undefined;
}
function parseFixtures(raw: string | undefined, slash = false): number | undefined {
  const t = clean(raw);
  if (!t || isBlankish(t)) return undefined;
  if (slash || /^\d+\s*\/\s*\d+(?:\s*\/\s*\d+)+$/.test(t)) {
    const nums = t.split('/').map((x) => parseInt(x.trim(), 10)).filter((x) => isFinite(x));
    if (nums.length >= 2) return nums.reduce((a, b) => a + b, 0);
  }
  const n = parseNumberCell(t);
  return n != null && Number.isInteger(n) && n < 5000 ? n : undefined;
}
function nameSimilarity(a: string, b: string): number {
  const tok = (s: string) => new Set(nameKey(s).split(' ').filter((x) => x.length > 2 && !['the', 'and', 'dfac', 'dining', 'facility', 'bldg', 'building'].includes(x)));
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

// =====================================================================================================================
// Site information
// =====================================================================================================================

const STATE_CLIMATE: [RegExp, SiteInfo['climateZone']][] = [
  [/\b(?:florida|georgia|louisiana|mississippi|alabama|south carolina|hawaii|guam|puerto rico|texas gulf|okinawa)\b|,\s*(?:FL|GA|LA|MS|AL|SC|HI)\b/, 'hot_humid'],
  [/\b(?:arizona|nevada|new mexico|utah|el paso|kuwait|qatar|bahrain|djibouti|iraq)\b|,\s*(?:AZ|NV|NM|UT)\b/, 'arid'],
  [/\b(?:alaska|minnesota|north dakota|south dakota|montana|wisconsin|maine|vermont|new hampshire|upper michigan|wyoming)\b|,\s*(?:AK|MN|ND|SD|MT|WI|ME|VT|NH|WY)\b/, 'cold'],
];
function extractSite(ordered: { doc: DocInput }[]): SiteInfo {
  const site: SiteInfo = {};
  const all = ordered.map((o) => o.doc.text).join('\n');
  const head = ordered.map((o) => o.doc.text.slice(0, 6000)).join('\n');
  // solicitation number: federal PIID (R / Q types, hyphens optional), else "RFP No. …"
  const fed = all.match(/\b([A-Z0-9]{6}-\d{2}-[RQ]-\d{4})\b/) ?? all.match(/\b([A-Z0-9]{4,6}\d{2}[RQ]\d{4})\b(?!-)/);
  const loc = head.match(/\b((?:RFP|RFQ|IFB|ITB|RFI|Solicitation)\s*(?:No\.?|Number|#)\s*:?\s*#?\s*[A-Z0-9][A-Z0-9-]{1,20}\d)\b/i);
  if (fed) site.solicitation = fed[1]; else if (loc) site.solicitation = loc[1].replace(/\s+/g, ' ');
  // installation / owner: the most frequent name
  const cands = new Map<string, number>();
  const bump = (s: string, w = 1) => { const k = s.replace(/\s+/g, ' ').trim(); cands.set(k, (cands.get(k) ?? 0) + w); };
  for (const m of all.matchAll(/\b(?:Fort|Ft\.|Camp|Joint Base|Naval (?:Air )?Station|Naval Support Activity|Marine Corps (?:Base|Air Station)|USAG|U\.S\. Army Garrison|Caserma)\s+[A-Z][A-Za-z'-]+(?:[ -][A-Z][a-z][A-Za-z'-]+)?/g)) bump(m[0].replace(/^Ft\./, 'Fort').replace(/\s+(?:Kentucky|Georgia|Kansas|Texas|Virginia|Italy)$/i, (x) => (/italy/i.test(x) ? x : '')));
  for (const m of all.matchAll(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)? Air Force Base\b/g)) bump(m[0]);
  for (const m of all.matchAll(/\b(?:USAG|U\.S\. ARMY GARRISON)\s+([A-Z]{3,}(?: [A-Z]{3,})?)\b/g)) bump(`USAG ${m[1].charAt(0)}${m[1].slice(1).toLowerCase()}`, 2);
  for (const m of all.matchAll(/\bCity of ([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\b/g)) bump(m[1], 0.5);
  for (const m of all.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2} (?:School District|Public Schools|State University|University|State College|Community College|College))\b/g)) bump(m[1], 0.7);
  for (const m of all.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+){0,2} Federal (?:Buildings?|Center|Complex))\b/g)) bump(m[1], 0.8);
  const best = [...cands.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) site.installationName = best[0];
  const st = all.match(/\b(?:Fort|Camp|Base|Station|City of)\s+[A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?|[A-Z]{2})\b/);
  if (st && site.installationName) site.location = `${site.installationName}, ${st[1]}`;
  // contract term: stated total years, else base + options (sentences about the current contract are history)
  for (const s of splitSentences(all.replace(/\s*\n\s*/g, ' '))) {
    if (/incumbent|current(?:ly)? (?:contract|performed|provided)|presently|existing contract|previous contract|prior contract/i.test(s)) continue;
    const tot = s.match(/\b(?:maximum|total)(?: total)?(?: potential)? (?:term|period(?: of performance)?|contract term|length)?[^.]{0,40}?(?:of|is|to)\s+(\w+)\s*(?:\((\d+)\))?\s*years?\b/i) ?? s.match(/\bfor a total of (\w+)\s*(?:\((\d+)\))?\s*years?\b/i);
    if (tot) { const n = Number(tot[2] ?? NaN) || wordOrNum(tot[1]); if (n && n >= 1 && n <= 15) { site.contractYears = n; break; } }
    const bo = s.match(/\b(?:base|initial)\s+(?:period|term|year)\b[^.]{0,160}?\b(\w+)\s*(?:\((\d+)\))?\s*(?:additional\s+)?(?:(?:one|1|twelve|12)[- ](?:year|month)\s+|\(\d+\)\s*(?:one|1)?[- ]?(?:year\s+)?)?(?:option|renewal)/i)
      ?? s.match(/\b(?:initial term|base period)[^.]{0,120}?(?:renew(?:ed|als?)?|option)[^.]{0,40}?\b(?:up to\s+)?(\w+)\s*(?:\((\d+)\))?\s*(?:additional\s+)?(?:one[- ]year|1-year|twelve-month|12-month)?/i);
    if (bo && !site.contractYears) {
      const opts = Number(bo[2] ?? NaN) || wordOrNum(bo[1]);
      const baseY = s.match(/\b(?:base|initial)\s+(?:period|term)[^.]{0,30}?(?:of|shall be)\s+(\w+)\s*(?:\((\d+)\))?\s*(years?|months?)/i) ?? s.match(/\b(\w+)[- ](year|month)\s+(?:base|initial)/i);
      let baseYears = 1;
      if (baseY) { const v = Number(baseY[2] ?? NaN) || wordOrNum(baseY[1]) || 1; baseYears = /month/i.test(baseY[3] ?? baseY[2] ?? '') ? Math.max(1, Math.round(v / 12)) : v; }
      if (opts != null && opts >= 1 && opts <= 10) { site.contractYears = baseYears + opts; }
    }
  }
  const climate = all.match(/\b(humid subtropical|hot[- ]humid|arid|desert|semi-arid|cold climate|heavy snow|temperate)\b/i);
  if (climate) { const c = climate[1].toLowerCase(); site.climateZone = /humid|subtropical/.test(c) ? 'hot_humid' : /arid|desert/.test(c) ? 'arid' : /cold|snow/.test(c) ? 'cold' : 'temperate'; }
  else {
    const where = `${head}`;
    for (const [re, z] of STATE_CLIMATE) if (re.test(where)) { site.climateZone = z; break; }
    if (!site.climateZone && /\b(?:kentucky|missouri|kansas|virginia|washington|oregon|tennessee|north carolina|maryland|pennsylvania|ohio|indiana|illinois|new york|new jersey|california|oklahoma|arkansas|colorado|italy|germany)\b|,\s*(?:KY|MO|KS|VA|WA|OR|TN|NC|MD|PA|OH|IN|IL|NY|NJ|CA|OK|AR|CO)\b/i.test(where)) site.climateZone = 'temperate';
  }
  const gs = all.match(/growing season[^.\n]{0,60}?(\d{2})\s*weeks/i) ?? all.match(/(\d{2})\s*weeks[^.\n]{0,30}growing season/i);
  if (gs) site.growingSeasonWeeks = Number(gs[1]);
  return site;
}

// =====================================================================================================================
// Public API
// =====================================================================================================================

export function heuristicExtract(docs: DocInput[]): Inventory {
  const r = new Reader();
  const ordered = orderDocs(docs);
  for (const o of ordered) r.scanScope(o.doc.text);
  for (const o of ordered) r.readDoc(o.doc, o.rank, o.amendLike);
  r.site = extractSite(ordered);
  return r.finish();
}

// ---------------------------------------------------------------------------------------------------------------------
// Previous award / incumbent facts
// ---------------------------------------------------------------------------------------------------------------------

const AWARD_CUE = /incumbent|current(?:ly)?\s+(?:contract|performed|provided|services|annual|option)|presently\s+(?:performed|provided)|previous\s+contract|existing\s+contract|prior\s+contract|predecessor|current services|current contractor/i;
const AWARD_SKIP = /extension of services|52\.217-8|over-and-above|over and above|not-to-exceed|\bnte\b|insurance|liabilit|\bbonds?\b|liquidated|per hour|hourly|threshold|or more\b|in excess of|ordered separately|not part of this requirement|separate contract|field feeding|bid tabulation/i;
const CORP = /,?\s+(?:LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Company|Co\.|LP|LLP|JV|Ltd\.?|PLLC|Joint Venture|Group)\b/;
const NAME_PART = "[A-Z][\\w&'’.-]*";
const COMPANY = new RegExp(`(${NAME_PART}(?:\\s+(?:&\\s+)?${NAME_PART}){0,6}(?:,?\\s+(?:LLC|L\\.L\\.C\\.|Inc\\.?|Incorporated|Corp\\.?|Corporation|Company|Co\\.|LP|LLP|JV|Ltd\\.?|PLLC|Joint Venture))?)`);

function paragraphsOf(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) out.push(cur.join(' ').replace(/\s+/g, ' ')); cur = []; };
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || /^--- page \d+ ---$/.test(t)) { flush(); continue; }
    if (t.includes('|')) { flush(); const cells = splitPipe(t).map(clean); const long = cells.filter((c) => c.length > 25); if (long.length) out.push(long.join('. ')); continue; }
    if (/^(?:[a-z]|\d{1,2})[.)]\s|^(?:q|a)\s*\d+[.:]|^\d+(?:\.\d+)+\s/i.test(t)) flush();
    cur.push(t);
  }
  flush();
  return out;
}
const moneyAll = (s: string): { v: number; at: number; tail: string }[] => [...s.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(million|m\b|billion|b\b|k\b|thousand)?/gi)].map((m) => {
  let v = Number(m[1].replace(/,/g, '')); const u = (m[2] ?? '').toLowerCase();
  if (u.startsWith('m')) v *= 1e6; else if (u.startsWith('b')) v *= 1e9; else if (u === 'k' || u === 'thousand') v *= 1e3;
  return { v, at: m.index ?? 0, tail: s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24) };
}).filter((x) => isFinite(x.v) && x.v >= 1000);

function monthsOf(s: string): number | undefined {
  const m = s.match(/\b(\d{1,3})[- ]months?\b(?!\s+(?:base|option))/i);
  if (m) return Number(m[1]);
  const y = s.match(/\b(\w+)[- ]year (?:term|period|contract)\b/i);
  if (y) { const n = wordOrNum(y[1]); if (n) return n * 12; }
  const bo = s.match(/\b(?:(\w+)[- ]month|(?:a|one|1))?\s*base (?:period|year)\b[^.]{0,120}?\b(\w+)\s*(?:\((\d+)\)\s*)?(?:(\w+)[- ]month\s+)?(?:option|renewal)/i) ?? s.match(/\bbase year and (\w+) option years/i);
  if (bo) {
    if (bo.length === 2) { const n = wordOrNum(bo[1]); return n ? 12 * (1 + n) : undefined; }
    const baseM = wordOrNum(bo[1]) ?? 12;
    const opts = Number(bo[3] ?? NaN) || wordOrNum(bo[2]);
    const optM = wordOrNum(bo[4]) ?? 12;
    if (opts != null && opts >= 1 && opts <= 10) return baseM + opts * optM;
  }
  const ini = s.match(/\binitial term of (\w+)\s*(?:\((\d+)\)\s*)?years?[^.]{0,120}?(\w+)\s*(?:\((\d+)\)\s*)?(?:one[- ]year\s+)?(?:renewal|option)/i);
  if (ini) { const b = Number(ini[2] ?? NaN) || wordOrNum(ini[1]); const o = Number(ini[4] ?? NaN) || wordOrNum(ini[3]); if (b && o != null) return 12 * (b + o); }
  return undefined;
}

/** Pull incumbent / previous-award facts out of free text (cover letters, Q&A, "current contract" paragraphs). */
export function heuristicPriorAward(docs: DocInput[]): PriorAward | undefined {
  let out: PriorAward | undefined;
  const ordered = orderDocs(docs);
  for (const { doc } of ordered) {
    for (const para of paragraphsOf(doc.text)) {
      if (!AWARD_CUE.test(para) && !/\bcontract (?:no\.?|number)\s*[A-Z0-9]/i.test(para)) continue;
      const pa: PriorAward = out ?? { confidence: 0.5 };
      let touched = false;
      const paraMonths = monthsOf(para);
      for (const sRaw of splitSentences(para)) {
        const s = sRaw.trim();
        if (AWARD_SKIP.test(s)) continue;
        // contract number: federal PIID (hyphens optional, not a solicitation type R / Q), else "Contract No. X"
        const piid = s.match(/\b([A-Z0-9]{6}-\d{2}-[A-HJ-PS-Z]-\d{4})\b/) ?? s.match(/\b([A-Z0-9]{4,6}\d{2}[A-HJ-PS-Z]\d{4})\b/);
        const local = s.match(/\bcontract\s*(?:no\.?|number|#)\s*:?\s*([A-Z0-9]{2,}(?:-[A-Z0-9]{1,8})+)\b/i);
        const cn = piid?.[1] ?? local?.[1];
        if (cn && !pa.contractNumber && /\d/.test(cn)) { pa.contractNumber = cn; touched = true; }
        if (!pa.incumbent) {
          const pats = [
            new RegExp(`(?:performed|provided|operated|serviced)\\s+by\\s+${COMPANY.source}(?=\\s+(?:under|pursuant|through|since|as)\\b|,|\\.|\\s*\\()`),
            new RegExp(`incumbent(?:\\s+contractor)?(?:\\s+is|:|,)?\\s+${COMPANY.source}(?=,|\\.|\\s+(?:under|performing|which|who|holds|has)\\b|\\s*\\()`),
            new RegExp(`award(?:ed)?\\b[^.]{0,80}?\\bto\\s+${COMPANY.source}(?=,|\\.|$|\\s+(?:for|under|which|with|on|in|as)\\b)`),
            new RegExp(`^(?:A\\d+\\.\\s*(?:See [^.]+\\.\\s*)?)?${COMPANY.source}(?=,?\\s+(?:under|\\(contract))`),
          ];
          for (const re of pats) {
            const m = s.match(re);
            const nm = m?.[1]?.trim();
            if (nm && CORP.test(nm) && !/^(?:The|This|Contract|City|District|Government|University|College)\b/.test(nm)) { pa.incumbent = nm.replace(/[.,]$/, ''); touched = true; break; }
          }
        }
        if (!pa.awardYear) { const y = s.match(/\bawarded\b[^.]{0,90}?\b((?:19|20)\d{2})\b/i) ?? s.match(/\b(?:since|in)\s+((?:19|20)\d{2})\b.*\bawarded/i); if (y) { pa.awardYear = Number(y[1]); touched = true; } }
        const amounts = moneyAll(s).filter((a) => !/^\s*(?:\)|,)?\s*(?:per|\/)\s*(?:month|mo\b|hour|hr|sf|square|day)|^\s*monthly/i.test(a.tail));
        if (!amounts.length) continue;
        const amt = amounts[0].v;
        const singleYear = /\bfor (?:fy|fiscal year|calendar year|cy|the)?\s*(?:fy)?\s*'?\d{2,4}(?:\s*-\s*\d{2,4})?\b(?! through)|\bfor (?:the )?\d{4}\s*-\s*\d{2,4} (?:school|fiscal) year|\b(?:school|fiscal|calendar) year\b(?!s)|\bannual|per (?:year|annum)|\ba year\b|\/yr\b|yearly|current option (?:period|year)|option (?:year|period) \d|value of the current option|for (?:20\d\d)\b/i.test(s);
        const spend = /obligat\w*|payments?|\bpaid\b|invoiced|expended|spent|billed/i.test(s) && /to date|through|thru|cumulative|since|\(\d+ months\)|\b(?:first|second|third|fourth|fifth|sixth)\b/i.test(s);
        const total = /total (?:contract |awarded |award )?value|total value|including all (?:options|renewals|option periods)|inclusive of all option|total of all|over (?:its|the|a) [^.]{0,30}(?:term|period)/i.test(s);
        if (singleYear && !total && !(spend && !/\bfor\b/i.test(s))) { if (pa.annualValue == null) { pa.annualValue = amt; touched = true; } }
        else if (spend) {
          if (pa.spendToDate == null) {
            pa.spendToDate = amt; touched = true;
            const mo = s.match(/\((\d{1,3}) months\)|\b(\d{1,3})[- ]months?\b/i);
            const ord = s.match(/\b(first|second|third|fourth|fifth|sixth|\d)(?:st|nd|rd|th)?\s+(?:performance\s+|contract\s+|option\s+)?year/i);
            if (mo) pa.spendPeriodMonths = Number(mo[1] ?? mo[2]); else if (ord) pa.spendPeriodMonths = (ORDINAL[ord[1].toLowerCase()] ?? Number(ord[1])) * 12;
          }
        } else if (total || /contract value|awarded|valued at|total/i.test(s)) {
          if (pa.totalValue == null) { pa.totalValue = amt; touched = true; const m = monthsOf(s) ?? paraMonths; if (m && m >= 6 && m <= 240) pa.periodMonths = m; }
        }
        if (touched && !pa.source) pa.source = { file: doc.name, excerpt: s.slice(0, 220) };
      }
      if (touched && (pa.contractNumber || pa.incumbent || pa.totalValue || pa.annualValue || pa.spendToDate)) { pa.source = pa.source ?? { file: doc.name, excerpt: para.slice(0, 220) }; out = pa; }
    }
  }
  if (out && out.spendToDate && !out.spendPeriodMonths && out.awardYear) out.spendPeriodMonths = Math.max(12, Math.min(out.periodMonths ?? 60, (new Date().getFullYear() - out.awardYear) * 12));
  return out;
}
