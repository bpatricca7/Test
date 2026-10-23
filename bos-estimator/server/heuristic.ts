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
//  - excluded / not in scope / vacant / closed / demolished / struck rows stay in the inventory with a status;
//  - the building area is the column the others add up to (restroom + carpet + hard floor SF = total cleaned SF), never a
//    part of it; under a two-row header the sub-title names the column and the group label only qualifies a measure;
//  - a header repeated over later blocks of a list keeps the list's column roles; the same number on two lines of one list
//    with two names and areas is two line items; rows under a "reference only" / "optional" banner carry that status;
//  - service days are read as written ("5 x Week", "M–Su", "Tu, Th", "alt. Wed.") or through a code legend anywhere in
//    the package; change logs (Was / Is columns, "Add Building …") and facilities described in headed paragraphs are read.
import type { AreaUnit, DiningProfile, Facility, FacilityCategory, FacilityStatus, FloorMix, GroundsArea, GroundsKind, GroundsUnit, Inventory, MealPeriodHeadcount, PriorAward, ServiceLevel, SiteInfo, SourceRef } from '../shared/types';
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
  // a tracked or conformed cell ("~~45,200~~ 47,900") reads the figure that was not struck
  const live = raw.replace(/~~[^~]*~~/g, ' ');
  if (live !== raw && /\d/.test(live)) raw = live;
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

/** Number format a figure is written in: "45,200" / "2,148.6" / "612.4" are U.S., "4.312,8" / "96,4" European; "1.240"
 *  and "680" could be either. */
function numberStyle(raw: string | undefined): 'us' | 'eu' | undefined {
  const t = clean(raw);
  if (!t) return undefined;
  if (/^\D{0,4}\d{1,3}(?:\.\d{3})+,\d+(?![\d.,])/.test(t)) return 'eu';
  if (/^\D{0,4}\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,])/.test(t)) return 'us';
  if (/^\D{0,4}\d+,\d{1,2}(?![\d.,])/.test(t)) return 'eu';
  if (/^\D{0,4}\d+\.\d{1,2}(?![\d.,])/.test(t)) return 'us';
  return undefined;
}

const NUMERIC_CELL =/^[~±≈]?\s*(?:approx\.?\s*)?\$?\s*\d[\d.,]*\s*(?:%|[a-z²]{1,6}\.?)?$/i;
const isNumericCell = (c: string) => NUMERIC_CELL.test(clean(c));
const isBlankish = (c: string | undefined) => /^(?:[-–—.]+|n\/?a|n\/s|none|nil)?$/i.test(clean(c));

type QUnit = 'sf' | 'sm' | 'sy' | 'ac' | 'ha' | 'lf' | 'ea' | 'other';
/** Unit of measure printed in a header, a UM cell or after a number. */
function unitOf(raw: string | undefined): QUnit | undefined {
  if (!raw) return undefined;
  const t = ` ${clean(raw).toLowerCase()} `;
  const B = '[\\s(\\d/]', E = '(?=[\\s).,;:/]|$)';
  const has = (p: string) => new RegExp(`${B}(?:${p})${E}`).test(t);
  if (has('sm|sqm|sq\\.?\\s*m\\.?|m²|m2|mq|qm|square met(?:er|re)s?|metri quadrati|quadratmeter')) return 'sm';
  if (has('sf|s\\.f\\.|gsf|csf|nsf|sq\\.?\\s*f(?:ee|oo)?t\\.?|sq\\.?\\s*ft\\.?|square f(?:ee|oo)t(?:age)?|ft²|ft2')) return 'sf';
  if (has('sy|sq\\.?\\s*yds?\\.?|square yards?|yd²')) return 'sy';
  if (has('ha|hectares?|ettari')) return 'ha';
  if (has('ac|acres?|acreage')) return 'ac';
  if (has('lf|lin\\.?\\s*ft\\.?|linear f(?:ee|oo)t')) return 'lf';
  if (has('ea|each|n\\.|nr\\.?|trees?')) return 'ea';
  if (/^\s*(?:kv|kva|kw|ga|gal|mb|mbh|mo|lt|hr|hrs|ls|job|cy|cf|ton)\s*$/.test(t)) return 'other';
  return undefined;
}
/** Unit of the figure a cell holds: the unit printed right after the number parseNumberCell reads, else any unit outside
 *  a parenthesised conversion ("45,208 SF (4,200 SM)" is in SF, "1,742 m² (18,750 SF)" in SM, "4,200 (SM)" in SM). */
function cellUnit(raw: string | undefined): QUnit | undefined {
  if (!raw) return undefined;
  let t = clean(raw);
  const live = raw.replace(/~~[^~]*~~/g, ' ');
  if (live !== raw && /\d/.test(live)) t = clean(live);
  const m = t.match(/\d[\d.,]*/);
  if (m) {
    const after = t.slice((m.index ?? 0) + m[0].length).match(/^\s*\(?\s*([a-zA-Z²][a-zA-Z².\s]{0,16})/);
    if (after) { const u = unitOf(` ${after[1]} `); if (u) return u; }
  }
  return unitOf(t.replace(/\([^)]*\d[^)]*\)|\[[^\]]*\d[^\]]*\]/g, ' '));
}
/** "~~45,200~~ 47,900": the struck figure, for a note. */
function struckNote(raw: string | undefined): string | undefined {
  if (!raw || !/~~[^~]*\d[^~]*~~/.test(raw)) return undefined;
  const live = raw.replace(/~~[^~]*~~/g, ' ');
  if (!/\d/.test(live)) return undefined;
  const old = raw.match(/~~([^~]*\d[^~]*)~~/)?.[1];
  return `${clean(old)} is struck through; ${clean(live)} used.`;
}
const AREA_U: Record<string, AreaUnit> = { sf: 'sf', sm: 'sm', sy: 'sy' };
const GROUNDS_U: Record<string, GroundsUnit> = { ac: 'acres', ha: 'hectares', sf: 'sqft', sm: 'sqm', sy: 'sqyd', lf: 'lf', ea: 'each' };

// =====================================================================================================================
// Building numbers, frequencies, statuses, grounds kinds
// =====================================================================================================================

const BN_TOKEN = /^(?:[A-Z]{0,4}-?\d{1,7}(?:[A-Z]{1,3}\d{0,4})?(?:-[A-Z0-9]{1,6})*|[A-Z]{2,5}\d{1,6}[A-Z]{0,3}(?:-[A-Z0-9]{1,4})?)$/;
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

const LEVEL_ORDER: ServiceLevel[] = ['daily_7', 'daily_6', 'daily_5', '3x_week', '2x_week', 'weekly', 'biweekly', 'monthly', 'quarterly'];
const RATE_WORD: Record<string, number> = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
/** Explicit rates per month / year / quarter ("3x/month", "Four times per month", "Twice monthly", "24x/yr", "52/yr",
 *  "Semi-annually", "Annually") as visits per week, with the text they were read from. */
function ratesPerWeek(t: string): { perWeek: number; text: string }[] {
  const out: { perWeek: number; text: string }[] = [];
  const N = '(\\d+(?:\\.\\d+)?|once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  const per = (u: string) => (/^(?:mo|mos|mon|month|months|monthly)$/.test(u) ? 1 / 4.33 : /^(?:yr|yrs|year|years|annum|annually|yearly|annual|a)$/.test(u) ? 1 / 52 : /^(?:qtr|quarter|quarterly|q)$/.test(u) ? 1 / 13 : /^(?:wk|wks|week|weeks|weekly)$/.test(u) ? 1 : NaN);
  const num = (s: string) => (/^\d/.test(s) ? Number(s) : RATE_WORD[s]);
  // "5 x Week", "3x Month": a multiplier sign directly before the period needs no "per"
  const re = new RegExp(`(?:^|[^\\d.,/])${N}\\s*(?:x|×|times?|visits?|services?|cleanings?|cycles?|days?|nights?|evenings?|mornings?|shifts?)?\\s*(?:\\/|per\\s+|a\\s+|each\\s+|every\\s+|an?\\s+)\\s*(mos?|mon|months?|yrs?|years?|annum|qtr|quarter|wks?|weeks?)\\b|(?:^|[^\\d.,/])${N}\\s*(?:x|×|times)?\\s+(monthly|yearly|annually|quarterly|weekly)\\b|(?:^|[^\\d.,/])${N}\\s*(?:x|×)\\s*(mos?|months?|yrs?|years?|qtrs?|quarters?|wks?|weeks?)\\b`, 'g');
  for (const m of t.matchAll(re)) {
    const n = num(m[1] ?? m[3] ?? m[5]), f = per((m[2] ?? m[4] ?? m[6]).replace(/^(qtr|quarter)s$/, '$1'));
    if (n != null && isFinite(f) && n > 0) out.push({ perWeek: n * f, text: m[0] });
  }
  for (const m of t.matchAll(/\bsemi-?annual(?:ly)?\b|\bbi-?annual(?:ly)?\b|\btwice (?:a|per|each) year\b/g)) out.push({ perWeek: 2 / 52, text: m[0] });
  for (const m of t.matchAll(/(?<!semi-?|bi-?)\b(?:annual(?:ly)?|yearly|once (?:a|per|each) year)\b/g)) if (!/(?:semi-?|bi-?)$/.test(t.slice(0, m.index))) out.push({ perWeek: 1 / 52, text: m[0] });
  return out;
}
const levelFromRate = (w: number): ServiceLevel => (w >= 6.5 ? 'daily_7' : w >= 5.5 ? 'daily_6' : w >= 4.5 ? 'daily_5' : w >= 2.5 ? '3x_week' : w >= 1.5 ? '2x_week' : w >= 0.75 ? 'weekly' : w >= 0.35 ? 'biweekly' : w >= 0.15 ? 'monthly' : 'quarterly');
/** Visits per year when the text states a rate below quarterly ("2x/yr", "Annually"), for a note. */
export function lessThanQuarterly(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const rates = ratesPerWeek(` ${dash(clean(raw)).toLowerCase().replace(/\s*\/\s*/g, '/')} `);
  if (!rates.length) return undefined;
  const best = Math.max(...rates.map((r) => r.perWeek));
  return best * 52 < 3.5 ? Math.round(best * 52 * 10) / 10 : undefined;
}

/** Service frequency wording → service level. Explicit per-month / per-year rates are read first and converted to visits
 *  per week; the weekly wording is then read from what is left ("3x/month" is never "3x per week"). With several
 *  frequencies in one cell the most frequent wins. */
export function serviceLevelFromText(raw: string | undefined): ServiceLevel | undefined {
  if (!raw) return undefined;
  // "five (5) nights per week", "three (3) times per week": the figure in parentheses repeats the word
  let t = ` ${dash(clean(raw)).toLowerCase().replace(/\b([a-z]+(?:-[a-z]+)?)\s*\((\d{1,3})\)/g, (m, w: string, d: string) => (WORD_NUM[w] === Number(d) || RATE_WORD[w] === Number(d) ? d : m)).replace(/\s*\/\s*/g, '/')} `;
  if (!/[a-z0-9]/.test(t)) return undefined;
  const rates = ratesPerWeek(t);
  for (const r of rates) t = t.replace(r.text, (x) => ' '.repeat(x.length));
  // "twice monthly", "2x/month" were rates; "twice daily" and "N per day" are daily service
  const fromRates = rates.length ? levelFromRate(Math.max(...rates.map((r) => r.perWeek))) : undefined;
  const fromWords = levelFromWords(t);
  if (fromRates && fromWords) return LEVEL_ORDER.indexOf(fromRates) <= LEVEL_ORDER.indexOf(fromWords) ? fromRates : fromWords;
  return fromRates ?? fromWords ?? levelFromWeekdays(t);
}

/** Service days written as the days themselves: "M–Su", "Tu, F", "Wed", "Mon, Wed & Fri", "Tuesday and Friday evenings",
 *  "Friday, Saturday and Sunday mornings"; every other / alternate weekday is every two weeks. One-letter days ("M, W, F")
 *  count only when the text is nothing but days. */
const DAY_WORDS: [RegExp, number][] = [[/^mon(?:day)?s?$/, 1], [/^tue(?:s(?:day)?)?s?$/, 2], [/^wed(?:nesday)?s?$/, 3], [/^thu(?:r(?:s(?:day)?)?)?s?$/, 4], [/^fri(?:day)?s?$/, 5], [/^sat(?:urday)?s?$/, 6], [/^sun(?:day)?s?$/, 7]];
/** one- and two-letter days, read only in a cell that holds nothing but days ("we", "th" are words in prose) */
const DAY_SHORT: Record<string, number> = { m: 1, mo: 1, t: 2, tu: 2, w: 3, we: 3, th: 4, f: 5, fr: 5, sa: 6, su: 7 };
const DAY_FILLER = /^(?:evenings?|mornings?|nights?|afternoons?|days?|only|service[sd]?|cleaning|each|every|other|alt|alternate|alternating|week|weekly|per|excluding|except|including|federal|holidays?|and|or|the|of|on|a|after|before|closing|plus)$/;
function levelFromWeekdays(t: string): ServiceLevel | undefined {
  const words = t.replace(/\([^)]*\)/g, ' ').match(/[a-z]+|[-–—,&/]|\d+/g) ?? [];
  const compact = words.every((w) => /^[-–—,&/]$/.test(w) || DAY_WORDS.some(([re]) => re.test(w)) || w in DAY_SHORT || DAY_FILLER.test(w) || /^(?:through|thru|to)$/.test(w));
  const dayOf = (w: string): number | undefined => DAY_WORDS.find(([re]) => re.test(w))?.[1] ?? (compact ? DAY_SHORT[w] : undefined);
  const days = new Set<number>();
  let prev: number | undefined; let range = false; let any = 0; let longest = 0;
  for (const w of words) {
    const d = dayOf(w);
    if (d != null) {
      longest = Math.max(longest, w.length);
      if (range && prev != null) { for (let k = prev; ; k = (k % 7) + 1) { days.add(k); if (k === d) break; } }
      else days.add(d);
      prev = d; range = false; any++;
      continue;
    }
    if (/^[-–—]$|^(?:through|thru|to)$/.test(w)) { range = prev != null; continue; }
    if (!/^[,&/]$|^(?:and|or)$/.test(w)) prev = undefined;
    range = false;
  }
  // a lone letter ("M", "F", "W") is as likely a code (Monthly, a legend letter) as a day
  if (!any || (!compact && !/[a-z]{3,}day/.test(t)) || (any === 1 && longest < 2)) return undefined;
  if (days.size === 1 && /\b(?:every other|alternate|alternating|alt\.?)\s+[a-z]*day|\balt\.?\s+(?:mon|tue|wed|thu|fri|sat|sun)/.test(t)) return 'biweekly';
  return levelFromDays(days.size);
}
function levelFromWords(t: string): ServiceLevel | undefined {
  if (!/[a-z0-9]/.test(t)) return undefined;
  if (/\b(?:\d+x?|once|twice|two times|\d+ times)\s*(?:\/|per |a |each )\s*day\b/.test(t) && !/\b7x|\b7 ?days|seven days|including weekends|mon(?:day)?\s*(?:-|through|thru|to)\s*sun|sun(?:day)?-sat/.test(t)) return 'daily_5';
  if (/every other day|alternate days|alternating days/.test(t)) return '3x_week';
  if (/quarterly|qtrly|\b1x\/q(?:tr|uarter)|once (?:a|per|each) (?:calendar )?quarter|\b4x\/(?:yr|year)|trimestral/.test(t)) return 'quarterly';
  if (/\b(?:2x|twice|two times)\s*(?:\/|per |a |each )?\s*mo(?:nth)?\b|semi-?monthly|\b2\/mo\b/.test(t)) return 'biweekly';
  if (/monthly|\b1x\/mo(?:nth)?\b|once (?:a|per|each) month|mensil|\b12x\/(?:yr|year)/.test(t)) return 'monthly';
  if (/bi-?weekly|bi-?wkly|every (?:two|2|other) weeks?|fortnight|quindicinal|alternate weeks|\b14-day/.test(t)) return 'biweekly';
  if (/\b7x|\b7\/7\b|\b7 ?days|seven days|daily \(7|24\/7|including weekends|every day|sun(?:day)?\s*(?:-|through|thru|to)\s*sat|mon(?:day)?\s*(?:-|through|thru|to)\s*sun|\b365 days|7 d\/w/.test(t)) return 'daily_7';
  if (/\b6x|\b6\/7\b|\b6 ?days|six days|\bm-sa(?:t)?\b|mon(?:day)?\s*(?:-|through|thru|to)\s*sat/.test(t)) return 'daily_6';
  if (/\b5x|\b5\/7\b|\b5 ?days|five days|\bm-f\b|mon(?:day)?\s*(?:-|through|thru|to)\s*fri|weekdays?|\bdaily\b|each workday|every workday|workdays/.test(t)) return 'daily_5';
  if (/\b4x\/(?:wk|week)|\b4\/7\b|four times|\b4 ?days|\bm-th\b/.test(t)) return '3x_week';
  if (/\b3x|\b3\/7\b|three times|\b3 times|\b3\/wk|\b3 ?days|\bm\/w\/f\b|mon(?:day)?,? wed(?:nesday)?,? (?:and )?fri|tri-?weekly|three (?:services|visits|days) (?:per|a) week/.test(t)) return '3x_week';
  if (/\b2x|\b2\/7\b|twice|two times|\b2 times|\b2\/wk|\b2 ?days|\bt\/th\b|tue(?:sday)?s?\s*(?:and|&|\/)\s*thu|\b2 v\/sett|two (?:services|visits|days) (?:per|a) week/.test(t)) return '2x_week';
  if (/\b1x|\b1\/7\b|weekly|once (?:a|per|each) week|\b1\/wk|settimanal|one day (?:per|a) week/.test(t)) return 'weekly';
  return undefined;
}
/** Service days per week (a numeric "Service Days/Week" column). */
const levelFromDays = (n: number): ServiceLevel | undefined => (n >= 7 ? 'daily_7' : n >= 6 ? 'daily_6' : n >= 5 ? 'daily_5' : n >= 3 ? '3x_week' : n >= 2 ? '2x_week' : n >= 1 ? 'weekly' : undefined);

/** Whole-building status wording in a row (remarks, frequency, name or status cell). Partial exclusions ("server rooms
 *  excluded", "kitchens excluded") are not statuses. */
export function statusFromText(raw: string | undefined, opts: { frequencyCell?: boolean; nameCell?: boolean } = {}): { status: FacilityStatus; reason: string } | undefined {
  const t = clean(raw);
  if (!t) return undefined;
  const l = dash(t).toLowerCase();
  const reason = t.slice(0, 160);
  // a bare "N/A", "none" or "-" means no remark; only in the frequency cell does it mean "not serviced"
  if (isBlankish(t)) return opts.frequencyCell && /^(?:n\/?a|none|-)$/.test(l) ? { status: 'excluded', reason: `Frequency "${t}"` } : undefined;
  // "racquetball court wing demolished", "Kitchen area not included", "Mechanical rooms – excluded", "Window washing not
  // included": a part of the building or one service, not the building
  const whole = (re: RegExp) => { for (const m of l.matchAll(new RegExp(re.source, 'g'))) if (!partSubject(l, m.index ?? 0, !!opts.nameCell)) return true; return false; };
  if (whole(/\bdeleted\b|\bremoved from (?:the )?(?:scope|requirement|list|contract)\b|\bdelete(?: from)? (?:scope|requirement)/)) return { status: 'deleted_by_amendment', reason };
  // demolition planned for later ("To be demolished FY29; service through FY28") is not a status unless the row also says
  // the building is out of scope (futureDemolition() gives the note)
  const future = futureDemolition(l);
  if (!future && whole(/demolish|\bdemo\b(?=\s*(?:fy|\d|-|$))|da demolire|\brazed\b|\bdisposed\b|pending disposal|for disposal/)) return { status: 'demolished', reason };
  // "Closed weekends and federal holidays", "Closed on Saturdays", "closed at 1800": a schedule, not a closure
  if (whole(/\bvacant\b|(?<!(?:to|will) be )\bvacated\b|\bclosed\b(?!-)(?!\s*(?:(?:on|in|from|at|between|after|before|during|for|over|each|every|all)\s+)?(?:the\s+)?(?:(?:federal|public|national|legal|school|university|district)\s+)?(?:weekends?|holidays?|saturdays?|sundays?|sat\b|sun\b|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|nights?|evenings?|overnight|lunch|noon|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\b|p\.?m\b)|\d{3,4}\s*(?:hrs?|hours|h)\b|\d{3,4}\s*-\s*\d{3,4}\b|\d{1,2}:\d{2}|(?:summer|winter|spring|fall|autumn|off[- ]season|christmas|school breaks?|breaks?|recess|intersession)\b))|warm[- ]closure|mothball|\bunoccupied\b/)) return { status: 'vacant', reason };
  if (future && !EXCLUDED_RE.test(l)) return undefined;
  if (whole(EXCLUDED_RE)) return { status: future ? 'demolished' : 'excluded', reason };
  if (whole(/option(?:al)? (?:item|clin)s? only|option period only|\boption only\b|\boption(?:al)?\s*[-:]?\s*(?:clin|line item)\b/)) return { status: 'option_only', reason };
  if (opts.frequencyCell && /^(?:n\/?a\b.*|not serviced|0)$/.test(l)) return { status: 'excluded', reason: `Frequency "${t}"` };
  return undefined;
}
const EXCLUDED_RE = /not in scope|out of scope|not included|not part of (?:this|the)|do not price|shall not be priced|not to be priced|\bnot priced\b|no custodial service|not serviced|no routine service|no workload|uso italiano|^\s*exclude[ds]?\b|-\s*exclude[ds]?\b|\b(?:facility|building|bldg) (?:is )?excluded|for information only|information only|for reference only|not (?:in|on) (?:the )?contract|removed from scope/;
/** "To be demolished FY29", "scheduled for demolition", "programmed for demolition in FY27": demolition still to come. */
function futureDemolition(l: string): boolean {
  return /\bto be (?:demolished|razed|disposed)\b|\b(?:scheduled|programmed|planned|slated|proposed|identified|approved)\s+(?:for\s+)?(?:demolition|disposal)\b|\bdemolition\s+(?:is\s+)?(?:scheduled|planned|programmed)\b|\bwill be (?:demolished|razed|disposed)\b/.test(l)
    || (/\bservice[sd]?\s+(?:through|thru|until|till|to)\b|\bin service (?:through|thru|until)\b|\bremains? in scope\b/.test(l) && /demoli|dispos/.test(l));
}
/** Note for a row whose remark announces a later demolition, while the building stays in scope. */
export function futureDemolitionNote(raw: string | undefined): string | undefined {
  const t = clean(raw);
  return t && futureDemolition(dash(t).toLowerCase()) && !statusFromText(t) ? `Demolition planned ("${t.slice(0, 100)}"); priced as in scope.` : undefined;
}
/** Part-of-building and single-service nouns: a status word after one of them in the same clause applies to that part. */
/** After a deletion verb: its scope ("from the requirement", "in its entirety", "by Amendment 0001") or the end of the clause. */
const DELETION_SCOPE = /^\s*(?:(?:(?:from|in)\s+(?:the\s+|this\s+|its\s+|their\s+|all\s+)?(?:scope|requirements?|contract|solicitation|rfp|rfq|ifb|pws|sow|list|facility list|inventory|te[- ]?\d|technical exhibit|exhibit|attachment|appendix|table|section|entirety|clin|schedule|work|custodial|services?|pricing)\b)|(?:by|per|under|pursuant to)\s+(?:amendment|addendum|modification|change order)|(?:effective|as of|upon)\b|and\s+(?:will|shall)\s+not\b|$|[.;,(])/i;
/** The building references open the clause (after "Item 1.", "a.", "No.", "Per Amendment 0002,") and are followed only by a
 *  name, address or campus ("Building 0012 at North Annex", "Site 14, Wexford Commons Pocket Park,") before the verb. */
function deletionSubject(s: string, segStart: number, targets: Ref[], vi: number): boolean {
  const pre = s.slice(segStart, Math.min(...targets.map((r) => r.at)));
  const mid = s.slice(Math.max(...targets.map((r) => r.end)), vi);
  const OPENER = /^\s*(?:(?:item|line|para(?:graph)?|no\.?|change|question|answer|response|q|a)\s*\d[\w.-]{0,6}[.:)\-–]?\s+|[a-z0-9]{1,3}[.)]\s*|\d{1,2}\/\s*|\(\w{1,3}\)\s*|\d+(?:\.\d+)*[.)]?\s+|(?:yes|no)[.,]?\s+|the\s+|also,?\s+|further(?:more)?,?\s+|in addition,?\s+|additionally,?\s+|accordingly,?\s+|therefore,?\s+|(?:per|under|by|with|pursuant to|in accordance with|effective|as of|upon)\s+[^,]{1,60},\s*)*$/i;
  if (pre.length > 120 || !OPENER.test(pre)) return false;
  const NON_BUILDING = /\b(?:trash|refuse|garbage|debris|litter|carpets?|furniture|equipment|snow|ice|waste|recycl\w*|graffiti|tiles?|flooring|fixtures?|materials?|furnishings|boxes|items|signs?|vehicles?|occupants|personnel|staff|contents)\b/i;
  if (mid.length > 170 || NON_BUILDING.test(pre) || NON_BUILDING.test(mid.replace(/\([^)]*\)/g, ' '))) return false;
  if (/\b(?:shall|will|was|were|has|have|had|must|should)\b/i.test(mid.replace(/\([^)]*\)/g, ' '))) return false;
  return /^\s*(?:\([^)]*\)\s*)?(?:,[^;:]{0,150}?,\s*|,\s*|\s*[-–—]\s*[^;:]{1,80}?\s*[-–—]\s*|\s+(?:at|on|in|located (?:at|on|in))\s+(?:the\s+)?[^,;:]{1,60}?\s*(?:,[^;:]{0,100}?,\s*)?)?(?:(?:is|are)\s+[^,;:]{1,80}?\s+and\s+)?$/i.test(mid);
}
/** The text names this campus ("Building 0012 at North Annex"). */
const mentions = (text: string, campus: string) => { const k = nameKey(campus); return !!k && ` ${nameKey(text)} `.includes(` ${k} `); };
const PART_NOUN = /\b(?:wings?|rooms?|courts?|additions?|portions?|parts?|sections?|bays?|suites?|floors?|space|spaces|areas?|canopy|canopies|sheds?|porch(?:es)?|decks?|kitchens?|lobby|lobbies|mezzanines?|stair(?:well)?s?|elevators?|restrooms?|closets?|basements?|attics?|windows?|window washing|glass|carpets?|refinishing|stripping|waxing|burnishing|shampooing|servers?|mechanical|electrical|telecom|hvac|classrooms?|locker rooms?|showers?|exterior|roofs?|loading docks?|vaults?|serving line)\b/g;
function partSubject(l: string, at: number, nameCell: boolean): boolean {
  const pre = l.slice(Math.max(0, at - 40), at);
  // in a name cell the name itself is the building ("Motor Pool (DEMOLISHED FY26)", "Restroom – CLOSED"); only a part
  // named inside the parenthesis or after the dash is a part ("Brigade HQ (annex wing demolished)")
  const cut = nameCell ? Math.max(pre.lastIndexOf('('), pre.lastIndexOf(' - '), pre.lastIndexOf('/')) : -1;
  const clause = pre.slice(Math.max(pre.lastIndexOf('.'), pre.lastIndexOf(';'), pre.lastIndexOf(','), pre.lastIndexOf(':'), cut) + 1);
  let last: RegExpExecArray | undefined;
  for (const m of clause.matchAll(PART_NOUN)) last = m as RegExpExecArray;
  if (!last) return false;
  // "Restroom building – not in scope" is the building
  return !/\b(?:building|bldg|facility|structure)\b/.test(clause.slice((last.index ?? 0) + last[0].length));
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

// "Level 2 Total - # Facilities", "ZONE 1 TOTAL – 15 facilities", "Building 1 Total (agrees with …)": "Total" followed by
// a dash, colon, count or parenthesis labels a total row wherever the word sits ("Joint Total Force Center" is a name)
const TOTAL_RE = /^(?:grand\s+)?(?:sub-?\s*)?totale?s?\b|\bsub-?\s*totale?s?\b|\bgrand\s+totals?\b|\btotals?\s*$|\btotals?\s*(?:[-–—:=(#]|\d|(?:of|for|all)\b)|^sum\b|^\s*in all\b/i;
const isTotalRow = (cells: string[]) => cells.map(clean).filter(Boolean).slice(0, 3).some((c) => TOTAL_RE.test(c));

export function categorize(name: string): FacilityCategory {
  // descriptions in parentheses ("Community Center (multipurpose rooms, gymnasium, …)") only break ties
  const head = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const c = categorizeText(head || name);
  return c === 'other' && head !== name ? categorizeText(name) : c;
}
function categorizeText(name: string): FacilityCategory {
  const n = ` ${name.toLowerCase()} `;
  // a building serviced in its office areas only is office space, whatever the building is
  if (/administrative (?:areas?|core|offices?|space) only|office (?:and restroom |and latrine )?areas? only|offices? only/.test(n)) return 'admin';
  if (/dining|dfac|mess hall|galley|cafeteria|food service|restaurant|mensa\b/.test(n)) return 'dining';
  if (/barracks|dormitor|\bdorm\b|bachelor|\bquarters\b|billet|lodging|\buph\b|\bueph\b|\buoph\b|\bbeq\b|\bboq\b|unaccompanied|residence hall|alloggi/.test(n)) return 'barracks';
  if (/clinic|medical|dental|hospital|\bhealth\b|pharmacy|ambulatorio|\b(?:in|out)patient|\bpatient care|dialysis|imaging|radiology|surgery|surgical|dispensary|infirmary|\bcboc\b|hospice/.test(n)) return 'medical';
  if (/hangar/.test(n)) return 'hangar';
  if (/gatehouse|guard ?house|overwatch|\bacp\b|access control point/.test(n)) return 'other';
  // offices of a directorate or division are admin, even when the directorate runs shops, training or supply
  if (/headquarters|\bhq\b|administration|\badmin\b|directorate|\boffices?\b|dispatch/.test(n)) return 'admin';
  if (/physical plant|motor pool|maintenance|\bshops?\b|vehicle|\btmp\b|\bdol\b|repair|wash rack|\btemf\b|officina/.test(n)) return 'maintenance';
  if (/warehouse|supply|storage|depot|\bcif\b|logistic|issue facility|magazzino|hazmat|hazardous material/.test(n)) return 'warehouse';
  if (/\bgym\b|gymnasium|fitness|physical (?:fitness|training)|\bpool\b|sports|athletic|aquatic|natatorium|palestra/.test(n)) return 'fitness';
  if (/child|\bcdc\b|daycare|day care|school age|asilo/.test(n)) return 'child_care';
  if (/chapel|religious|spiritual|community|\bmwr\b|\bclub\b|recreation|theater|bowling|exchange|commissary|museum|arts and crafts|cappella|readiness center|library|youth|conference|family (?:assistance|support|readiness)/.test(n)) return 'community';
  if (/school|education|training|classroom|academy|learning|instruction|istruzione/.test(n)) return 'education';
  if (/\blab\b|laborator|research|simulat|range control|test facility/.test(n)) return 'lab';
  if (/command|brigade|battalion|squadron|detachment|center|annex|operations|\bops\b|finance|personnel|legal|\bjag\b|post office|police|fire station|security|visitor|service center|federal building|courthouse|comando|uffici|\bdivision\b/.test(n)) return 'admin';
  return 'other';
}

// =====================================================================================================================
// Column roles
// =====================================================================================================================

type Role = 'item' | 'number' | 'numberWeak' | 'name' | 'use' | 'typeish' | 'catcode' | 'rpaType' | 'floors' | 'gross' | 'cleanable' | 'area' | 'qty' | 'unit'
  | 'portable' | 'fixtures' | 'fixWC' | 'fixUR' | 'fixLAV' | 'fixSH' | 'freq' | 'daysOpen' | 'status' | 'remarks' | 'campus' | 'zone' | 'address' | 'year'
  | 'meal' | 'seats' | 'svcType' | 'gQty' | 'mows' | 'cycle' | 'svcLvl' | 'length' | 'width' | 'sides' | 'surface' | 'served' | 'rowKey' | 'change' | 'revised' | 'mix' | 'info';
interface Col {
  i: number; role: Role; text: string; unit?: QUnit; kind?: GroundsKind; meal?: string; weekend?: boolean; old?: boolean; newer?: boolean; slash?: boolean; days?: boolean; mix?: keyof FloorMix;
  /** length / width columns: printed in meters or feet */
  len?: 'm' | 'ft';
  /** a bare "Area" title: the grounds area name, or the building area when another name column exists or the values are figures */
  bareArea?: boolean;
  /** a generic area column titled as a pricing / service / custodial / net area */
  serviceArea?: boolean;
}
/** Unit of a length or width column title: "Length (m)", "Larghezza (metri)", "Width (ft)". */
function lengthUnit(h: string): 'm' | 'ft' | undefined {
  if (/\((?:m|mt|mtr|ml)\.?\)|met(?:er|re)s?|metri|in m|m\.?l\.?/.test(h)) return 'm';
  if (/\((?:ft|lf|feet)\.?\)|feet|ft|lf|linear f/.test(h)) return 'ft';
  return undefined;
}

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
  // floor finish areas ("Carpet SF", "VCT SF", "Ceramic SF", "Gym Wood Floor SF")
  if (!/gross|cleanable|total/.test(h) && (u === 'sf' || u === 'sm' || /\barea\b|\bsf\b/.test(h))) {
    const mix: keyof FloorMix | undefined = /\bcarpet/.test(h) ? 'carpet' : /\bvct\b|resilient|vinyl|\blvt\b|linoleum/.test(h) ? 'resilient' : /ceramic|terrazzo|quarry|\btile\b|marble/.test(h) ? 'hardTile' : /concrete|sealed/.test(h) ? 'concrete' : /\bwood\b|maple|hardwood/.test(h) ? 'wood' : undefined;
    if (mix) return { role: 'mix', mix };
  }
  if (/wood floor|glass|window|capacity|enroll|population|occupan|price|\$|cost|rate\b|amount\b|definition|height|standard|requirement|dimension|\bsize\b/.test(h)) return { role: 'info' };
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
  if (/\blength\b|lunghezza/.test(h)) return { role: 'length', len: lengthUnit(h) };
  if (/\bwidth\b|larghezza/.test(h)) return { role: 'width', len: lengthUnit(h) };
  if (/^sides?\b/.test(h)) return { role: 'sides' };
  if (/^surface\b|surface type|^pavement\b|^material\b/.test(h)) return { role: 'surface' };
  const was = /\b(?:was|old|from|previous|prior|original|existing|before)\b/.test(h);
  const isNew = !was && /\b(?:is|new|revised|changed|corrected|now|after|amended)\b/.test(h);
  const areaUnit = u === 'sf' || u === 'sm' || u === 'sy';
  const areaWord = /\barea\b|superficie|square f|sq\.?\s*f|footage|floor area/.test(h);
  // "Floors Serviced", "Days Serviced per Week", "Times Cleaned per Week", "Restrooms Serviced" count things, they are not areas
  const countHdr = !areaUnit && !areaWord && /\b(?:floors?|stor(?:e)?ys?|stories|levels?|days?|times|visits?|restrooms?|toilets?|fixtures?|rooms?|units|buildings|bldgs|occupants|per (?:week|wk|day|month|year))\b/.test(h);
  if (countHdr && /\b(?:days?|times|visits?)\b/.test(h) && /serviced|cleaned|service|per (?:week|wk)|\/\s*(?:week|wk)/.test(h)) return { role: 'freq', days: true };
  if (countHdr && /\b(?:restrooms?|toilets?|rooms?|units|buildings|bldgs|occupants)\b/.test(h) && !/fixture/.test(h)) return { role: 'info' };
  if (!countHdr && /cleanable|\bclean(?:ed)?\b|\bcsf\b|\bnet\b|netta|pulibile|serviced|service area|custodial (?:service )?(?:area|sq|sf|square|space)|\bnsf\b|area to be cleaned/.test(h)) return { role: 'cleanable', unit: u, old: was, newer: isNew };
  if (/gross|\bgsf\b|lorda|\bgfa\b/.test(h)) return { role: 'gross', unit: u, old: was, newer: isNew };
  if (/\b(?:qty|quantity|quantit\w*)\b|um qty/.test(h)) return { role: 'qty', unit: u };
  if (areaUnit || areaWord || /pricing area/.test(h)) {
    if (/^(?:grounds )?area(?: description| name)?$/.test(h)) return { role: 'name', bareArea: h === 'area' };
    // grounds and envelope schedules ("Lawn Area (SF)", "Roof Area (SF)", "Parking Lot SY") are not building areas
    if (/\blawns?\b|\bturf\b|landscap|\bmow(?:ed|able|ing)?\b|\bgrass\b|\bprato\b/.test(h)) return { role: 'gQty', kind: 'improved_turf', unit: u && u !== 'other' ? u : 'sf' };
    if (/parking|\blots?\b|\bpaved\b|pavement|asphalt|\broads?\b|driveway/.test(h)) return { role: 'gQty', kind: 'parking', unit: u && u !== 'other' ? u : 'sf' };
    if (/sidewalks?|walkways?|\bwalks\b|plazas?/.test(h)) return { role: 'gQty', kind: 'sidewalk', unit: u && u !== 'other' ? u : 'sf' };
    if (/\broofs?\b|\bwalls?\b|façade|facade|envelope|\bsite\b|\bland\b|exterior|wall covering|curtain/.test(h)) return { role: 'info' };
    return { role: 'area', unit: u, old: was, newer: isNew, serviceArea: /pricing|service|serviced|custodial|cleanable|\bclean(?:ed)?\b|\bnet\b|workload|janitorial|to be cleaned/.test(h) };
  }
  if (/^(?:u\.?\s*m\.?|um|uom|unit|units|unit of measure|primary um|measure|unita)\b/.test(h) || (/\bu\.m\./.test(h) && h.length < 16)) return { role: 'unit' };
  if (/days open|operating days|days of operation/.test(h)) return { role: 'daysOpen' };
  if (/frequen|\bfreq\b|days of service|cleaning days|service days|days\s*\/\s*week|days per week|gg\s*\/\s*sett|schedule|\bsched\b|\b(?:service|svc) code\b|custodial freq|times per week|visits per/.test(h) && !/hours|window|\btime\b|serving/.test(h)) return { role: 'freq', days: /days/.test(h) };
  if (/\bfloors?\b|\bstor(?:e)?ys?\b|stories|\bflrs?\b|piani|no\.? of levels|number of levels|^levels$/.test(h)) return { role: 'floors' };
  if (/fac status|^status$|facility status|building status|^condition|\bstato\b|record status/.test(h)) return { role: 'status' };
  if (/remark|\bnotes?\b|comment|osservaz|basis for change|explanation/.test(h)) return { role: 'remarks' };
  if (/^change\s*\(\+|net change|^difference|^delta\b|^variance/.test(h)) return { role: 'info' };
  if (/^change\b|^action\b|type of change|change type/.test(h)) return { role: 'change' };
  if (/revised information|revision|new information|revised data|description of change|change description/.test(h)) return { role: 'revised' };
  if (/service type|type of service|service style|food service type/.test(h)) return { role: 'svcType' };
  if (/rpa type|asset type|record type|property type|real property type/.test(h)) return { role: 'rpaType' };
  if (/catcode (?:description|title|desc)|category (?:code )?(?:description|title)|cat code desc|ccn title/.test(h)) return { role: 'use' };
  // "Facility Name CCN" (a name column whose title ran into the next one) is still the name column
  if (/\bname\b/.test(h) && !/(?:cat\s*code|category(?: code)?|ccn|rpa|asset|property type)\s+name/.test(h)) return { role: 'name' };
  if (/catcode|cat code|category code|\bccn\b|fac code/.test(h)) return { role: 'catcode' };
  if (/\btipo\b|grounds type|grounds category|^type\b|^class\b|category$|\btype$/.test(h)) return { role: 'typeish' };
  if (/^(?:campus|installation|caserma|base|post|site|location|sede|garrison)$|\bcampus\b/.test(h)) return { role: 'campus' };
  if (/^(?:te-?\d+ )?zone$|^district$|^sector$|^region$/.test(h)) return { role: 'zone' };
  if (/\baddress\b/.test(h) && !/\bname\b/.test(h)) return { role: 'address' };
  if (/\bname\b|description|descrizione|denominazione|destinazione|^(?:facility|building|school|park|dining facility|shelter|street|structure|grounds area)\b|\/\s*(?:facility|building|description)\b|\b(?:facility|building|school)$/.test(h)) return { role: 'name' };
  if (/address|indirizzo|^limits\b/.test(h)) return { role: 'address' };
  if (/^(?:use|function|occupancy|primary use|building use|facility use|usage)\b/.test(h)) return { role: 'use' };
  return null;
}

/** Old-value and new-value columns of a change log ("Was | Is", "From | To", "Previous | Revised"). */
const WAS_HEAD = /^(?:was|old|from|previous(?:ly)?|prior|original(?:ly)?|existing|before|formerly|current(?:ly)?)\b/;
const IS_HEAD = /^(?:is|new|to|now|revised|change[sd]? to|corrected|amended|becomes|after|proposed)\b/;
const ANCHORS = new Set<Role>(['number', 'numberWeak', 'name', 'gross', 'cleanable', 'area', 'qty', 'gQty', 'meal', 'length', 'rowKey', 'fixtures', 'fixWC', 'change', 'freq']);

interface TableMap {
  id: string; cols: Col[]; n: number; sig: string; kind: 'facility' | 'grounds' | 'change' | 'meals' | 'other';
  eu: boolean; unit?: QUnit; gross?: Col; grossOld?: Col; cleanable?: Col; codeRows: number; caption: string;
  /** the header cells as printed (flattened), for columns no role was given to ("Was" / "Is") */
  heads?: string[];
  get(r: Role): Col | undefined; all(r: Role): Col[];
}

/** Role of a column under a two-row header (group label over sub-title). The sub-title names the column ("BUILDING DATA"
 *  over "Line No." is a line number, not a building name); the group label only qualifies a measure ("GROSS AREA" over
 *  "SF", "CLEANABLE SQUARE FEET" over "High Risk") and never makes a column an identity column on its own. */
const MEASURE_ROLES = new Set<Role>(['area', 'gross', 'cleanable', 'mix', 'gQty', 'qty', 'unit']);
const IDENTITY_ROLES = new Set<Role>(['item', 'number', 'numberWeak', 'name', 'use', 'typeish', 'campus', 'zone', 'address', 'rowKey', 'catcode', 'rpaType']);
function stackedRole(full: string, sub: string | undefined): ReturnType<typeof roleOf> {
  const fr = roleOf(full);
  const s = clean(sub);
  if (!s || s === clean(full)) return fr;
  const sr = roleOf(s);
  if (sr && !MEASURE_ROLES.has(sr.role)) return sr;
  if (sr) return fr && MEASURE_ROLES.has(fr.role) ? fr : sr;
  return fr && IDENTITY_ROLES.has(fr.role) ? null : fr;
}

/** Building-area columns that are parts of another column of the same row ("Restroom SF + Carpet SF + Hard Floor SF =
 *  Total Cleaned SF", "High + Moderate + Low Risk = Total CSF"): the total is the facility's area, the parts never are.
 *  The figures decide (the total equals the sum of the parts on most rows); without enough figures, a single column
 *  titled "Total" right after two or more untitled area columns of its kind is the total of those. */
function areaTotal(cols: Col[], body: string[], eu: boolean): { total?: Col; parts: Col[] } {
  const areaLike = cols.filter((c) => c.role === 'area' || c.role === 'gross' || c.role === 'cleanable' || c.role === 'mix');
  const titledTotal = (c: Col) => /\btotal\b/.test(normHeader(c.text));
  if (areaLike.length < 3) return { parts: [] };
  const rows = body.map(splitPipe).filter((cs) => !isTotalRow(cs)).map((cs) => new Map(areaLike.map((c) => [c.i, isBlankish(cs[c.i]) ? 0 : parseNumberCell(cs[c.i], eu) ?? 0])));
  const sumMatches = (T: Col, parts: Col[]) => {
    let ok = 0, bad = 0;
    for (const v of rows) {
      const t = v.get(T.i) ?? 0, ps = parts.map((c) => v.get(c.i) ?? 0);
      if (!(t > 0) || ps.filter((x) => x > 0).length < 2) continue;
      if (Math.abs(ps.reduce((a, b) => a + b, 0) - t) <= Math.max(1, t * 0.002)) ok++; else bad++;
    }
    return ok >= 2 && ok >= 3 * bad;
  };
  // a gross or plain area total is split into plain area parts; a cleanable total may also be split into cleanable parts
  // (gross = cleanable + non-cleanable is the gross / cleanable pair, not a split)
  const partOf = (T: Col, c: Col) => c !== T && c.role !== 'gross' && !titledTotal(c) && (T.role === 'cleanable' || c.role !== 'cleanable');
  for (const T of areaLike) {
    const others = areaLike.filter((c) => partOf(T, c));
    // all the other untitled area columns, or the run of area columns just left of the total
    const run: Col[] = [];
    for (let k = areaLike.indexOf(T) - 1; k >= 0 && partOf(T, areaLike[k]); k--) run.unshift(areaLike[k]);
    for (const parts of [others, run]) if (parts.length >= 2 && sumMatches(T, parts)) return { total: T, parts };
  }
  const tt = areaLike.filter(titledTotal);
  if (tt.length === 1) {
    const T = tt[0];
    const run: Col[] = [];
    for (let k = areaLike.indexOf(T) - 1; k >= 0 && areaLike[k].role !== 'gross' && (T.role === 'cleanable' || areaLike[k].role !== 'cleanable'); k--) run.unshift(areaLike[k]);
    if (run.length >= 2) return { total: T, parts: run };
  }
  return { parts: [] };
}

function buildMap(cells: string[], id: string, caption: string, above: string[][], body: string[], subs?: string[]): TableMap | null {
  // headcount by meal period in rows ("Meal Period | Weekday Avg Headcount | Weekend Avg Headcount", or one column per DFAC)
  if (/^(?:meals?(?: periods?)?|periods?|service periods?|pasto|meal service)$/.test(normHeader(cells[0] ?? '')) && cells.length >= 2 && body.some((l) => MEAL_RE.test(normHeader(splitPipe(l)[0] ?? '')))) {
    const mcols: Col[] = cells.map((c, i) => ({ i, role: 'info' as Role, text: clean(c) }));
    const get = (r: Role) => mcols.find((c) => c.role === r);
    return { id, cols: mcols, n: cells.length, sig: `meals:${cells.length}`, kind: 'meals', eu: false, codeRows: 0, caption, get, all: (r: Role) => mcols.filter((c) => c.role === r) };
  }
  const cols: Col[] = [];
  const seen = new Set<Role>();
  const roles = cells.map((c, i) => stackedRole(c, subs?.[i]));
  const colText = (i: number) => body.slice(0, 80).map((l) => clean(splitPipe(l)[i])).filter((v) => v && !isBlankish(v));
  // a "Site" / "Location" column of short identifiers ("1", "14", "B-2") next to a name column is the site number, not a
  // campus, when the table has no building-number column
  if (!roles.some((r) => r?.role === 'number' || r?.role === 'numberWeak') && roles.some((r) => r?.role === 'name')) {
    roles.forEach((r, i) => {
      if (r?.role !== 'campus' || !/^(?:site|location|loc|sites?\s*#)$/.test(normHeader(cells[i]))) return;
      const vs = colText(i);
      if (vs.length >= 2 && vs.filter((v) => /\d/.test(v) && v.length <= 8 && !!normalizeBuildingNumber(v)).length >= 0.8 * vs.length) roles[i] = { role: 'number' };
    });
  }
  // a "Site No." / "Location #" key over a building list (a building area column, no acreage) is the facility number; over
  // acreage it keys grounds areas
  if (!roles.some((r) => r?.role === 'number' || r?.role === 'numberWeak') && !roles.some((r) => r?.role === 'gQty') && roles.some((r) => r && ['gross', 'cleanable', 'area'].includes(r.role))) {
    roles.forEach((r, i) => {
      if (r?.role !== 'rowKey' || !/^(?:site|location|loc|facility|building)\b/.test(normHeader(cells[i]))) return;
      const vs = colText(i);
      if (vs.length >= 1 && vs.every((v) => v.length <= 10 && !!normalizeBuildingNumber(v))) roles[i] = { role: 'number' };
    });
  }
  // a building-area table with neither a number nor a name column ("Clinic | Address | … | Gross SF"), whose area column
  // holds figures: its first text column under a plain title holds the facility names
  // (a room / space / task breakdown inside one building is not a facility list: its rows are parts of a building, and it
  // carries no building-level column such as an address, floors or a service schedule)
  const figuresIn = (i: number) => { const vs = colText(i); return vs.length >= 2 && vs.filter((v) => isNumericCell(v)).length >= 0.6 * vs.length; };
  const PART_TITLE = /^(?:spaces?|rooms?|areas?|space type|room type|area type|zones?|floors?|levels?|wings?|units?|tasks?|work items?|items?|components?|elements?|finish(?:es)?|surfaces?|types?|description|categor(?:y|ies)|classification|function)\b/;
  if (!roles.some((r) => r && ['number', 'numberWeak', 'name'].includes(r.role)) && roles.some((r, i) => r && ['gross', 'cleanable', 'area'].includes(r.role) && figuresIn(i))
    && roles.some((r) => r && ['address', 'floors', 'year', 'campus'].includes(r.role))) {
    for (let i = 0; i < Math.min(cells.length, 4); i++) {
      if (roles[i] || !clean(cells[i]) || /\d/.test(clean(cells[i])) || clean(cells[i]).length > 30 || PART_TITLE.test(normHeader(cells[i]))) continue;
      const vs = colText(i);
      if (vs.length >= 2 && vs.filter((v) => /[a-z]{3}/i.test(v) && !isNumericCell(v)).length >= 0.8 * vs.length) { roles[i] = { role: 'name' }; break; }
    }
  }
  // a column under a title the reader does not know ("Svc", "Sched.") whose cells read as service frequencies ("5 x Week",
  // "M–F", "Tu, Th") is the frequency column
  if (!roles.some((r) => r?.role === 'freq' || r?.role === 'svcLvl')) {
    for (let i = 0; i < cells.length; i++) {
      if (roles[i] || !clean(cells[i])) continue;
      const vs = colText(i);
      // (a lone weekday, "Monday", is a pickup or delivery day as often as a cleaning schedule)
      if (vs.length >= 2 && vs.filter((v) => serviceLevelFromText(v) && !/^\W*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\W*$/i.test(v)).length >= 0.7 * vs.length) { roles[i] = { role: 'freq' }; break; }
    }
  }
  // a bare "Area" column names grounds areas ("Area | Quantity"), but next to a facility name column, or over figures
  // ("Fac No. | Facility Name | Area | UM"), it is the building area
  roles.forEach((r, i) => {
    if (!r || r.role !== 'name' || !r.bareArea) return;
    const otherName = roles.some((o, k) => k !== i && o?.role === 'name' && !o.bareArea);
    let figures = 0, words = 0;
    for (const l of body.slice(0, 60)) { const v = clean(splitPipe(l)[i]); if (!v || isBlankish(v)) continue; if (isNumericCell(v)) figures++; else words++; }
    if (otherName || figures > words) roles[i] = { role: 'area', unit: undefined };
  });
  cells.forEach((c, i) => {
    const r = roles[i];
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
  const capL = caption.toLowerCase();
  let eu = /italian (?:number )?format|formato numerico italiano|european (?:number )?format|decimal comma|comma (?:separates|as the) decimal|virgola/.test(capL) && !/u\.s\. number format|us number format/.test(capL);
  // otherwise the figures in the area and quantity columns vote; notes, numbers and remarks ("1,2" footnote refs) never do
  if (!eu && !/u\.s\. number format|us number format/.test(capL)) {
    const qcols = new Set([...all('area'), ...all('gross'), ...all('cleanable'), ...all('gQty'), ...all('qty'), ...all('mix'), ...all('length'), ...all('width')].map((c) => c.i));
    let us = 0, euN = 0;
    for (const l of body) { const cs = splitPipe(l); for (const i of qcols) { const s = numberStyle(cs[i]); if (s === 'us') us++; else if (s === 'eu') euN++; } }
    eu = euN > 0 && euN >= 2 * us;
  }
  // parts of a total area column (restroom / carpet / hard-floor SF, risk-class CSF) are never the facility's area
  const split = areaTotal(cols, body, eu);
  const isPart = (c: Col) => split.parts.includes(c);
  // gross: the newest gross column (Was / Is Changed To tables), else a generic area column
  const grossCands = all('gross').filter((c) => !isPart(c));
  const areaCands = all('area').filter((c) => !isPart(c));
  const pickNew = (cs: Col[]) => cs.find((c) => c.newer) ?? cs.find((c) => !c.old) ?? undefined;
  let gross = pickNew(grossCands) ?? pickNew(areaCands);
  const grossOld = [...grossCands, ...areaCands].find((c) => c.old && c !== gross);
  let cleanable = pickNew(all('cleanable').filter((c) => !isPart(c)));
  if (split.total?.role === 'cleanable') cleanable = split.total;
  else if (split.total && (!gross || gross.role !== 'gross')) gross = split.total;
  const roleCount = cols.filter((c) => c.role !== 'info').length + cols.filter((c) => c.role === 'info').length;
  const nonEmpty = cells.filter((c) => clean(c)).length;
  if (nonEmpty < 2 || roleCount < 2 || roleCount / nonEmpty < 0.6 || !cols.some((c) => ANCHORS.has(c.role))) return null;
  const has = (r: Role) => !!get(r);
  const identity = has('number') || has('name');
  const bldgAreas = !!gross || !!cleanable || has('portable');
  let kind: TableMap['kind'] = 'other';
  if ((has('change') || has('revised')) && has('number') && !gross && !cleanable) kind = 'change';
  else if (meals.length >= 2 && identity) kind = 'facility';
  else if (identity && bldgAreas && !(has('rowKey') && !has('number'))) kind = 'facility';
  else if (has('number') && has('qty') && has('unit')) kind = 'facility';
  else if (/meal|period|pasto|service/.test(normHeader(cells[0] ?? '')) && cells.length >= 2 && !identity) kind = 'meals';
  else if ((identity || has('rowKey')) && (has('gQty') || has('qty') || (has('length') && has('width')))) kind = 'grounds';
  // a grounds summary keyed by its type column ("Type | Spec. Item | Installation | Acreage")
  else if (has('typeish') && has('gQty') && !bldgAreas) kind = 'grounds';
  // in a building table a "Service Level" column is the cleaning frequency, not a grounds service level
  if (kind === 'facility' && !has('freq')) { const sl = get('svcLvl'); if (sl) sl.role = 'freq'; }
  let unit: QUnit | undefined;
  if (/(?:areas?|superfici\w*)[^.]{0,40}\b(?:in square met|in metri quadrati|in m²|\(sm\)|in sm\b)|square met(?:er|re)s \(sm\)|metri quadrati/.test(capL)) unit = 'sm';
  else if (/areas? (?:are )?(?:stated |shown |given )?in square (?:feet|yards)/.test(capL)) unit = /yards/.test(capL) ? 'sy' : 'sf';
  const sig = cols.map((c) => `${c.i}:${c.role}`).join(',');
  return { id, cols, n: cells.length, sig, kind, eu, unit, gross, grossOld, cleanable, codeRows: 0, caption, get, all, heads: cells.map(clean) };
}

// =====================================================================================================================
// Records
// =====================================================================================================================

interface DiningAcc { periods: MealPeriodHeadcount[]; mealsPerDay?: number; mealPeriods?: number; seats?: number; daysPerWeek?: number; kitchenSqft?: number; diningRoomSqft?: number; serviceStyle?: DiningProfile['serviceStyle'] }
interface RowData {
  bn?: string; name?: string; campus?: string; gross?: number; cleanable?: number; unit?: AreaUnit; grossPrinted?: number; cleanPrinted?: number; wasGross?: number;
  floors?: number; fixtures?: number; level?: ServiceLevel; freqText?: string; status?: { status: FacilityStatus; reason: string }; active?: boolean; use?: string;
  dining?: Partial<DiningAcc>; portableSf?: number; source: SourceRef; tableId: string; notes?: string[]; confidence?: number; strongName?: boolean;
  /** the area came from a generic area column ("Pricing Area (SF)"), not a column titled gross */
  grossGeneric?: boolean;
  /** …and that column is titled as a pricing / service / custodial area */
  grossService?: boolean;
  /** the grouping row (banner) above the row, campus word or not */
  group?: string;
  floorMix?: Facility['floorMix'];
  /** the facility list the row belongs to: its document with its column titles, and with its column layout (a list
   *  continued under repeated headers) */
  listing?: string[];
}
interface FacRec {
  bn?: string; key?: string; nameKey: string; name: string; strongName: boolean; campus?: string; use: string;
  gross: number; grossRank: number; grossFrom?: string; unit?: AreaUnit; grossPrinted?: number;
  cleanable?: number; cleanRank: number; cleanPrinted?: number; floors?: number; floorsRank: number; fixtures?: number; fixRank: number;
  level?: ServiceLevel; freqText?: string; levelRank: number; status?: FacilityStatus; statusReason?: string; statusRank: number;
  dining?: DiningAcc; diningRank: number; portableSf?: number; source: SourceRef; tableId: string; tables: Set<string>; notes: string[]; confidence: number;
  floorMix?: Facility['floorMix'];
  grossGeneric?: boolean; grossService?: boolean; group?: string;
  listings: Set<string>;
}
/** dims: a median or right-of-way as printed (length, width, sides) with feet per printed unit (lFt / wFt: 1, or 3.28084 for meters). */
interface GRec { g: GroundsArea; rank: number; doc: string; tableId?: string; rowKey?: string; served: string[]; dims?: { lf: number; width: number; sides: number; hard: boolean; lFt?: number; wFt?: number }; label: string }
const FT_PER_M = 3.28084;
/** The area a row or record carries: its gross, else its cleanable area. */
const areaOf = (x: { gross?: number; cleanable?: number }) => ((x.gross ?? 0) > 0 ? x.gross! : x.cleanable ?? 0);

interface Ctx { doc: DocInput; rank: number; amendLike: boolean; page?: number; inAmend: boolean }
interface Para { text: string; line: number; page?: number; subjects?: string[]; cell?: boolean; inAmend: boolean; context?: string }

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
/** Space-aligned text splits at runs of 3+ spaces (tab-separated rows were already turned into pipe rows). */
const splitLoose = (line: string): string[] => (/\S {3,}\S/.test(line.trim()) ? line.trim().split(/ {3,}/).map((c) => c.trim()) : [line.trim()]);
/** Text exports: tab-separated rows become "cell | cell" rows with their empty cells kept, and comma-separated
 *  tables pasted as text are read the same way. */
function normalizeRows(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => (l.includes('\t') && !l.includes('|') && l.trim() ? l.replace(/^[ ]+|[ ]+$/g, '').split('\t').map((c) => c.trim().replace(/\|/g, '/')).join(' | ') : l));
  return csvBlocksToRows(lines);
}

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
/** at: where the reference (its "Building" prefix) starts; end: where its identifier ends. */
interface Ref { id: string; key: string; at: number; end: number; site: boolean }
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
      if (prev) {
        // a list item looks like the first one ("1201, 1205"), never a figure ("Building 1210 to 33,120 GSF")
        const first = out[out.length - 1]?.id ?? '';
        const digits = (x: string) => x.replace(/\D/g, '').length;
        if (/^\s*(?:sf|gsf|sq|square|acres?|ac\b|lf|sy|sm|m²)/i.test(rest.slice(id.length)) || (/^\d+$/.test(id) && digits(id) < digits(first) - 1)) break;
      }
      if (prev && /^(?:through|thru|to|-)$/i.test(prev) && out.length) {
        const a = out[out.length - 1].id, b = id;
        const pa = a.match(/^(.*?)(\d+)$/), pb = b.match(/^(.*?)(\d+)$/);
        if (!(pa && pb && pa[1] === pb[1] && Number(pb[2]) > Number(pa[2]) && Number(pb[2]) - Number(pa[2]) <= 400)) break; // "1210 to 33,120" is not a range
        for (let n = Number(pa[2]) + 1; n <= Number(pb[2]); n++) {
          const cand = `${pa[1]}${String(n).padStart(pa[2].length, '0')}`;
          if (!known || known(bnKey(cand)) || n === Number(pb[2])) out.push({ id: cand, key: bnKey(cand), at: m.index, end: pos + id.length, site });
        }
      } else out.push({ id, key: bnKey(id), at: m.index, end: pos + id.length, site });
      if (!sep) break;
      prev = sep[1];
      pos += id.length + sep[0].length;
    }
  }
  // bare identifiers that are known building numbers or grounds rows ("PB-3, Sports Complex …", "VA0355ZZ")
  if (known) for (const m of t.matchAll(/\b([A-Z]{1,4}-\d{1,6}[A-Z]?|[A-Z]{2}\d{4}[A-Z]{2}|\d{3,6}[A-Z])\b/g)) { const k = bnKey(m[1]); if (known(k) && !out.some((r) => r.key === k)) out.push({ id: m[1], key: k, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, site: false }); }
  return out;
}

const ABBR = /(?:\b(?:no|nos|bldg|bldgs|inc|co|corp|ltd|st|ave|blvd|rd|dr|mr|mrs|ms|approx|para|sec|fig|vs|etc|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|ft|sq|exh|att|rev|vol|pt|al|u\.s|e\.g|i\.e|a\.m|p\.m|nr|ref|cf)|\b[A-Z])\.$/i;
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
  if (/\d/.test(l.replace(/\([^)]*\)/g, '')) || l.length > 60) return undefined; // "Custodial Sq. Ft. 15,330" is a value, not a label
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
  /** rows read under each header so far (by document and column titles): a header repeated over a later block of the
   *  same list is mapped with the rows of every block, so a block of one or two rows reads like the rest of its list */
  bodiesByHeader = new Map<string, string[]>();
  mealTables: { periodsByTarget: Map<string, MealPeriodHeadcount[]>; hint?: string; source: SourceRef; rank: number }[] = [];
  proseGroundsPending: Parameters<Reader['pushGrounds']>[0][] = [];
  /** coded service schedules defined in a legend anywhere in the package ("A  24 hours a day, 7 days a week", "D  Monday
   *  through Friday"): code → level */
  codeLevels = new Map<string, { level: ServiceLevel; text: string }>();
  /** change-log rows with Was / Is columns, applied after the document's statements */
  changeRows: { cells: string[]; wasI: number; isI: number; subjects: string[]; source: SourceRef }[] = [];
  /** the package asks for food service (DFAC operation, full food service, dining facility attendants) */
  diningScope = false;
  /** the package says grounds maintenance is not part of the work: acreage in its prose is context, not workload */
  groundsOut = false;

  knownKey = (k: string) => this.byBn.has(k) || this.grounds.some((g) => g.rowKey && bnKey(g.rowKey) === k);

  // ---------------------------------------------------------------- facility registration
  register(row: RowData, rank: number): FacRec {
    let rec: FacRec | undefined;
    if (row.bn) {
      const k = bnKey(row.bn);
      const list = this.byBn.get(k) ?? [];
      const same = (c?: string) => !!c && !!row.campus && nameKey(c) === nameKey(row.campus);
      rec = list.find((r) => same(r.campus));
      // a row with no campus that could be either record goes to the one with its name ("0012 | Annex Ops" → North Annex)
      if (!rec) { const cands = list.filter((r) => !r.campus || !row.campus); rec = (cands.length > 1 && row.name ? cands.find((r) => r.nameKey === nameKey(row.name!)) : undefined) ?? cands[0]; }
      if (!rec && list.length === 1 && !list[0].tables.has(row.tableId)) rec = list[0];
      // the same number on two lines of one facility list, each with its own name and area, is two line items (a building
      // listed once per cleaning level or zone, "Wing HQ – Command Section" and "Wing HQ – Staff Agencies"): each is priced
      if (rec && row.listing?.some((l) => rec!.listings.has(l)) && !rec.tables.has(row.tableId) && areaOf(rec) > 0 && areaOf(row) > 0 && Math.abs(areaOf(rec) - areaOf(row)) > 0.5 && row.name && nameKey(row.name) !== rec.nameKey && !rec.status && !row.status) {
        rec = list.find((r) => r !== rec && !r.tables.has(row.tableId) && r.nameKey === nameKey(row.name!));
        if (!rec) { rec = this.newRec(row); this.byBn.set(k, [...list, rec]); rec.bn = row.bn; rec.key = k; }
      }
      // the same number twice in one table, both with an area, is two buildings (two sites under group rows such as
      // "CASTLE ROCK" / "PINE BLUFF"); the group label tells them apart
      if (rec && rec.tables.has(row.tableId) && !/:(?:lines|dining|meals|added:.*)$/.test(row.tableId) && areaOf(rec) > 0 && areaOf(row) > 0 && Math.abs(areaOf(rec) - areaOf(row)) > 0.5 && !same(rec.campus)) {
        if (!rec.campus && rec.group && rec.group !== row.group) rec.campus = rec.group;
        rec = undefined;
        if (!row.campus && row.group) row = { ...row, campus: row.group };
      }
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
    const r: FacRec = { nameKey: nameKey(row.name ?? ''), name: '', strongName: false, use: '', gross: 0, grossRank: -1, cleanRank: -1, floorsRank: -1, fixRank: -1, levelRank: -1, statusRank: -1, diningRank: -1, source: row.source, tableId: row.tableId, tables: new Set(), notes: [], confidence: row.confidence ?? 0.75, group: row.group, listings: new Set() };
    this.recs.push(r);
    return r;
  }
  merge(rec: FacRec, row: RowData, rank: number) {
    rec.tables.add(row.tableId);
    for (const l of row.listing ?? []) rec.listings.add(l);
    const nm = clean(row.name);
    if (nm && (!rec.name || /^Building\b/.test(rec.name) || (row.strongName && !rec.strongName))) { rec.name = nm.slice(0, 120); rec.strongName = !!row.strongName; }
    if (!rec.campus && row.campus) rec.campus = row.campus;
    if (row.use && !rec.use) rec.use = row.use;
    if (row.gross != null && row.gross > 0) {
      const takeGross = () => { rec.gross = row.gross!; rec.grossRank = rank; rec.unit = row.unit; rec.grossPrinted = row.grossPrinted; rec.grossFrom = row.source.file; rec.portableSf = row.portableSf; rec.grossGeneric = row.grossGeneric; rec.grossService = row.grossService; };
      if (!(rec.gross > 0)) takeGross();
      else if (rank > rec.grossRank && Math.abs(rec.gross - row.gross) > 0.5) {
        rec.notes.push(`Superseded ${fmt(rec.gross)} SF${rec.grossFrom ? ` (${rec.grossFrom})` : ''} with ${fmt(row.gross)} SF from ${row.source.file}.`);
        takeGross();
      } else if (Math.abs(rec.gross - row.gross) > 0.5 && rank === rec.grossRank) {
        // a second table of the same rank listing a smaller pricing / service / custodial area for the building gives
        // the serviced area, never a new gross
        if (row.grossService && row.gross < rec.gross * 0.95 && rec.cleanable == null && row.cleanable == null) { rec.cleanable = row.gross; rec.cleanRank = rank; rec.notes.push(`Listed as ${fmt(row.gross)} SF in a second schedule (${row.source.file}); recorded as the serviced (cleanable) area.`); }
        else if (rec.grossGeneric && !row.grossGeneric) {
          // a column titled gross beats a generic area column of the same rank, whatever the table order
          const old = rec.gross, oldService = rec.grossService;
          rec.notes.push(`Also listed as ${fmt(old)} SF in another table; kept the ${fmt(row.gross)} SF gross area.`);
          takeGross();
          if (oldService && old < row.gross * 0.95 && rec.cleanable == null && row.cleanable == null) { rec.cleanable = old; rec.cleanRank = rank; rec.notes.push(`The ${fmt(old)} SF schedule is recorded as the serviced (cleanable) area.`); }
        } else if (!rec.notes.some((n) => n.startsWith('Also listed'))) rec.notes.push(`Also listed as ${fmt(row.gross)} SF in another ${row.tableId === rec.tableId ? 'row' : 'table'}; kept ${fmt(rec.gross)} SF.`);
      }
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
    if (row.floorMix && !rec.floorMix) rec.floorMix = row.floorMix;
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
    const lines = normalizeRows(doc.text);
    const counts = new Map<string, number>();
    for (const l of lines) { const t = l.trim(); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
    const furniture = (t: string) => /^(?:--- page \d+ ---|page \d+(?:\s+of\s+\d+)?|cui|(?:continued|cont\.).*|.*\bcontinue[sd]? (?:on|from) (?:the )?(?:next|previous|page).*|.*\bpage [a-z]?[\d.-]+ of \d+.*)$/i.test(t) || ((counts.get(t) ?? 0) >= 3 && t.length < 220);
    let map: TableMap | null = null;
    let suspended = false;
    let group: string | undefined;
    let lastSig = '';
    let recentPlain: string[] = [];
    let lastPlain: { t: string; i: number } | undefined;
    // column titles of a table no column map could be built for (a change log "No. | Reference | Description | Was | Is")
    let looseHeads: string[] | undefined;
    let kv: KvRec | null = null;
    const paras: Para[] = [];
    let para: string[] = [];
    let paraLine = 0;
    const endPara = () => { if (para.length) paras.push({ text: para.join(' ').replace(/\s+/g, ' '), line: paraLine, page: ctx.page, inAmend: ctx.inAmend }); para = []; };
    const src = (line: string): SourceRef => ({ file: doc.name, page: ctx.page, excerpt: clean(line).slice(0, 200) });
    const flushKv = () => { if (kv) this.flushKv(kv, ctx); kv = null; };
    // one-building-per-line facility lists are read after the document's tables, like its prose
    const linesPending: { cells: string[]; t: string; source: SourceRef }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) { endPara(); if (map) suspended = true; continue; }
      const pg = t.match(/^--- page (\d+) ---$/);
      if (pg) { ctx.page = Number(pg[1]); endPara(); if (map) suspended = true; recentPlain = []; continue; }
      if (/^===\s.*\s===$/.test(t)) { endPara(); flushKv(); map = null; group = undefined; recentPlain = []; continue; }
      // an amendment heading, or the Standard Form 30 title ("AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT")
      if (t.length < 90 && /^(?:addendum|amendment)\s*(?:no\.?|number|#)?\s*\d{1,4}\b|^amendment of solicitation\b/i.test(t) && !/\|/.test(t)) ctx.inAmend = true;
      const isPipe = t.includes('|');
      const cells = isPipe ? splitPipe(t) : splitLoose(t);

      // key / value building information sheets
      if (!isPipe && /^(?:building|facility|property)\s+(?:information|data)\s+sheet\b|^exhibit\s+[a-z0-9.]+\s*[-–]\s*building information/i.test(t)) flushKv();
      const kvPairs = map && !suspended && map.kind !== 'other' ? null : this.kvPairs(cells, t, !!kv);
      if (kvPairs) {
        endPara();
        const repeats = kv && kvPairs.some(([f]) => (f === 'gross' && kv!.gross != null) || (f === 'name' && kv!.name != null));
        if (kvPairs.some(([f]) => f === 'number') || repeats) { flushKv(); kv = { grounds: [], source: src(t) }; }
        if (kv) this.kvApply(kv, kvPairs, map);
        continue;
      }

      // header rows
      if (cells.length >= 2 && !isNumericRow(cells)) {
        const above: string[][] = [];
        for (let k = i - 1, n = 0; k >= 0 && n < 5; k--) { const l = lines[k].trim(); if (!l) continue; n++; if (l.includes('|')) above.push(splitPipe(l)); }
        // inside a running table only a row with no figures at all can start a new header
        const live: boolean = !!map && !suspended;
        const hdr: { map: TableMap; extra: number } | null = live && (cells.some((c) => /\d/.test(clean(c).replace(/\(\d+\)/g, ''))) || cells.some((c) => clean(c).length > 50)) ? null : this.tryHeader(lines, i, cells, recentPlain.join(' '), above, doc.name);
        if (hdr) {
          endPara();
          if (hdr.map.kind !== 'other') flushKv();
          // a group label on the line just above the header belongs to this table
          const prev = lastPlain && lastPlain.i >= i - 3 ? groupText(lastPlain.t) : undefined;
          if (hdr.map.sig !== lastSig) group = prev;
          else if (prev) group = prev;
          lastSig = hdr.map.sig;
          map = hdr.map; suspended = false; i += hdr.extra; recentPlain = []; looseHeads = undefined;
          continue;
        }
        if (isPipe && cells.every((c) => !/\d/.test(clean(c))) && cells.filter((c) => clean(c)).length >= 2) looseHeads = cells.map(clean);
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
            if (map.kind === 'other') this.tableProse(cells, i, ctx, paras, src(t), map.heads);
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
        this.tableProse(cells, i, ctx, paras, src(t), looseHeads && Math.abs(looseHeads.length - cells.length) <= 1 ? looseHeads : undefined);
        linesPending.push({ cells, t, source: src(t) });
        continue;
      }
      if (furniture(t)) continue;
      looseHeads = undefined;
      // a table / exhibit title closes the running table
      if (/^(?:table|tabella|exhibit|attachment|appendix|technical exhibit|te[- ]?\d+[.:]|section\s+[a-z0-9])\b/i.test(t) && t.length < 160) { map = null; group = undefined; }
      lastPlain = { t, i };
      recentPlain.push(t); if (recentPlain.length > 6) recentPlain.shift();
      if (/^(?:[a-z]|\d{1,2}|[ivx]{1,4})[.)]\s|^(?:item|q|a)\s*\d+\s*[.:\-–]|^\d+(?:\.\d+)+\s|^\d+\.\s+[A-Z]/i.test(t)) endPara();
      if (!para.length) paraLine = i;
      para.push(t);
      linesPending.push({ cells: [t], t, source: src(t) });
      if (!kv) this.proseGrounds(t, ctx, src(t));
    }
    endPara();
    flushKv();
    // facility lines with no table header: only buildings no table or sheet of this or a later-ranked document gave
    for (const l of linesPending) this.fallbackFacility(l.cells, l.t, ctx, l.source);
    // facilities described in headed paragraphs ("Site 18 – Lakeview Beach House … approximately 1,840 sq. ft. …")
    this.narrativeFacilities(lines, ctx);
    // "Where no cleanable area is given, the gross area applies" (host-nation and GSA notes)
    if (/(?:where|if|when) no (?:cleanable|net|custodial) area is (?:given|shown|stated|recorded|listed)[^.]{0,40}gross area (?:applies|shall apply|is used)|gross area applies/i.test(doc.text.replace(/\s+/g, ' '))) {
      for (const r of this.recs) if (r.cleanable == null && r.gross > 0 && [...r.tables].some((t) => t.startsWith(`${doc.name}:`))) { r.cleanable = r.gross; r.cleanRank = ctx.rank; r.notes.push('No cleanable area listed; the document says the gross area applies.'); }
    }
    // grounds stated in sentences count only for kinds the document's tables and sheets did not give
    const tableKinds = new Set(this.grounds.filter((g) => g.doc === doc.name).map((g) => g.g.kind));
    for (const g of this.proseGroundsPending) if (!tableKinds.has(g.kind) && !this.groundsOut) this.pushGrounds(g);
    this.proseGroundsPending = [];
    // statements after the document's own tables, then the Was / Is values of its change logs
    paras.sort((a, b) => a.line - b.line);
    for (let p = 0; p < paras.length; p++) this.statements(paras[p], ctx, paras);
    for (const c of this.changeRows) this.changeLogRow(c, ctx);
    this.changeRows = [];
    for (let p = 0; p < paras.length; p++) if (!paras[p].cell) this.proseDining(paras, p, ctx);
  }

  /** Long text cells of a table row that is not a facility or grounds row (Q&A answers, change descriptions) are read as
   *  prose, with the buildings its short cells name as subjects; a row under "Was" and "Is" columns is a change log. */
  tableProse(cells: string[], line: number, ctx: Ctx, paras: Para[], source: SourceRef, heads?: string[]) {
    const subjects = cells.filter((c) => c.length < 40).flatMap((c) => refsIn(c, this.knownKey).map((r) => r.id));
    const context = cells.join(' | ');
    const wasI = heads?.findIndex((h) => WAS_HEAD.test(normHeader(h))) ?? -1, isI = heads?.findIndex((h) => IS_HEAD.test(normHeader(h))) ?? -1;
    // a row of a change log (Was / Is columns) is an amendment's text, whatever the file is called
    const changeLog = wasI >= 0 && isI >= 0 && wasI !== isI;
    for (const c of cells) if (clean(c).length >= 30 && /\s/.test(c)) paras.push({ text: clean(c), line, page: ctx.page, subjects, cell: true, inAmend: ctx.inAmend || changeLog, context });
    if (changeLog) this.changeRows.push({ cells, wasI, isI, subjects, source });
  }

  /** Service level of a schedule cell: a legend code ("D", "Code F (Tuesday and Thursday)") or the wording itself. */
  scheduleLevel(raw: string | undefined): ServiceLevel | undefined {
    const t = clean(raw);
    if (!t) return undefined;
    const code = t.match(/^(?:(?:[Ss]ervice\s+)?(?:[Ss]chedule\s+)?(?:[Cc]ode|CODE)\s+)?([A-Z]{1,2}\d?)(?:\s*\(|$)/)?.[1] ?? t.match(/\b(?:[Cc]ode|CODE)\s+([A-Z]{1,2}\d?)\b/)?.[1];
    if (code && this.codeLevels.has(code)) return this.codeLevels.get(code)!.level;
    return serviceLevelFromText(t.replace(/\b(?:[Cc]ode|CODE)\s+[A-Z]{1,2}\d?\b/g, ' '));
  }

  /** Legend of service schedule codes: two or more consecutive lines "<code> <wording>" or "<code> | <wording>" whose
   *  wording reads as a frequency. */
  scanCodes(text: string) {
    let run: [string, ServiceLevel, string][] = [];
    const flush = () => { if (run.length >= 2) for (const [c, l, d] of run) if (!this.codeLevels.has(c)) this.codeLevels.set(c, { level: l, text: d }); run = []; };
    for (const raw of normalizeRows(text)) {
      const t = raw.trim();
      if (!t) continue;
      const cells = t.includes('|') ? splitPipe(t).map(clean).filter(Boolean) : [clean(t)];
      let code: string | undefined, desc: string | undefined;
      if (cells.length >= 2 && /^(?:(?:[Cc]ode|CODE)\s+)?[A-Z]{1,2}\d?$/.test(cells[0])) { code = cells[0].replace(/^code\s+/i, ''); desc = cells.slice(1).join(' '); }
      else if (cells.length === 1) { const m = cells[0].match(/^(?:(?:[Cc]ode|CODE)\s+)?([A-Z]{1,2}\d?)\s*(?:[-–—=:.)]\s*|\s+)(\S.{3,200})$/); if (m) { code = m[1]; desc = m[2]; } }
      const level = desc && desc.length <= 200 ? serviceLevelFromText(desc) : undefined;
      if (code && level) { run.push([code, level, desc!]); continue; }
      flush();
      // a legend on one line: "A = 7 days per week; B = Monday through Friday; C = three times per week"
      const inline = [...t.matchAll(/(?:^|[;,(]\s*|:\s+)([A-Z]{1,2}\d?)\s*[=:]\s*([^;=|]{3,80}?)(?=\s*(?:;|$|\||,\s*[A-Z]{1,2}\d?\s*[=:]))/g)].map((m) => [m[1], serviceLevelFromText(m[2]), m[2]] as const);
      if (inline.length >= 2 && inline.every(([, l]) => l)) for (const [c, l, d] of inline) if (!this.codeLevels.has(c)) this.codeLevels.set(c, { level: l!, text: d });
    }
    flush();
  }

  /** A change-log row: labelled figures in the Was and Is cells ("Low Risk 6,910; Total CSF 25,150" → "Low Risk 8,450;
   *  Total CSF 26,690") revise the field each label names; a new schedule ("Code G (once per week)" → "Code F (Tuesday and
   *  Thursday)") revises the service level. The row must name one building. */
  changeLogRow(c: { cells: string[]; wasI: number; isI: number; subjects: string[]; source: SourceRef }, ctx: Ctx) {
    const was = clean(c.cells[c.wasI]), is = clean(c.cells[c.isI]);
    if (!is || isBlankish(is) || /^(?:deleted|removed|excluded|not listed)\b/i.test(is)) return;
    const rest = c.cells.filter((_, k) => k !== c.wasI && k !== c.isI).join(' | ');
    const ids = [...c.subjects, ...refsIn(rest, this.knownKey).filter((r) => !r.site).map((r) => r.id)];
    const keys = [...new Set(ids.map(bnKey))];
    if (keys.length !== 1 || this.findRecs(keys[0]).length !== 1) return;
    const ref: Ref = { id: ids[0], key: keys[0], at: 0, end: 0, site: false };
    const figures = (s: string) => new Map(s.split(/\s*;\s*/).flatMap((seg) => {
      const m = seg.match(/^(.*?)(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]{2,5}\b)?/);
      if (!m) return [];
      const label = clean(m[1]).replace(/[:=]$/, '').trim() || clean(m[3]);
      return label ? [[nameKey(label), { label, v: m[2], unit: m[1].trim() ? m[3] ?? '' : '' }] as const] : [];
    }));
    const before = figures(was), after = figures(is);
    for (const [k, a] of after) {
      const b = before.get(k);
      if (b && parseNumberCell(b.v) !== parseNumberCell(a.v)) this.revision(`${a.label} revised from ${b.v} to ${a.v}${a.unit ? ` ${a.unit}` : ''}`, [ref], [ref], undefined, [], ctx, true);
    }
    const lvIs = this.scheduleLevel(is), lvWas = this.scheduleLevel(was);
    if (lvIs && lvIs !== lvWas && (lvWas || /schedul|frequen|\bcode\b|service days|\bsvc\b/i.test(`${rest} ${is}`))) {
      const r = this.findRecs(keys[0])[0];
      r.notes.push(`Service schedule revised to "${is}" (${ctx.doc.name}).`);
      r.level = lvIs; r.freqText = is; r.levelRank = Math.max(r.levelRank, ctx.rank);
    }
  }

  tryHeader(lines: string[], i: number, cells: string[], caption: string, above: string[][], docName = ''): { map: TableMap; extra: number } | null {
    if (cells.some((c) => clean(c).length > 90)) return null;
    let hcells = cells;
    let subs: string[] | undefined;
    let extra = 0;
    const next = lines[i + 1]?.trim();
    if (next && next.includes('|')) {
      const nc = splitPipe(next);
      // a group-label row over sub-titles: a sub-title under an empty cell of the row above, or a label repeated across the
      // columns it spans ("BUILDING DATA | BUILDING DATA | …"); the label row may be shorter when its last spans were empty
      const spans = cells.some((c, k) => k > 0 && clean(c) && clean(c) === clean(cells[k - 1]));
      const under = nc.some((c, k) => clean(c) && !clean(cells[k]));
      const widthOk = Math.abs(nc.length - cells.length) <= 1 || (nc.length > cells.length && (spans || cells.some((c) => !clean(c))));
      if (nc.every((c) => !clean(c) || /^\(\d+\)$/.test(clean(c)))) extra = 1;
      else if (widthOk && !isNumericRow(nc) && !nc.some((c) => isNumericCell(c)) && nc.every((c) => clean(c).length <= 60) && (under || spans)) {
        hcells = mergeHeader(cells, nc); subs = nc; extra = 1;
        const nn = lines[i + 2]?.trim();
        if (nn && nn.includes('|') && splitPipe(nn).every((c) => !clean(c) || /^\(\d+\)$/.test(clean(c)))) extra = 2;
      }
    }
    if (hcells.some((c) => isNumericCell(c) && !/^\(\d+\)$/.test(clean(c)))) return null;
    // a figure followed by a unit ("42.5 acres improved", "45,200 SF") is data, not a column title
    if (hcells.some((c) => /^[~±≈]?\s*(?:approx\.?\s*)?\d[\d,.]*\s*(?:acres?|ac|sf|gsf|sq\.?\s*ft|sy|ha|m²|trees|fixtures|floors?)\b/i.test(clean(c)))) return null;
    const body: string[] = [];
    for (let k = i + 1 + extra; k < lines.length && body.length < 300; k++) { const l = lines[k]; if (!l.includes('|')) { if (l.trim() && !/^--- page/.test(l.trim()) && body.length > 3) break; continue; } body.push(l); }
    const key = `${docName}\u0000${hcells.map(normHeader).join('|')}`;
    const seen = this.bodiesByHeader.get(key) ?? [];
    const map = buildMap(hcells, `t${++this.tableSeq}`, caption, above, seen.length ? [...body, ...seen].slice(0, 600) : body, subs);
    if (map) this.bodiesByHeader.set(key, [...seen, ...body].slice(-300));
    return map ? { map, extra } : null;
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
    const gUnit = cellUnit(gTxt) ?? rowUnit ?? gCol?.unit ?? map.unit ?? 'sf';
    if (rpa && !/build|bldg|edificio/i.test(rpa)) return false;
    if ((fromQty || unitCol) && !['sf', 'sm', 'sy'].includes(gUnit)) return false;
    if (fromQty && groundsKindFromText(`${name} ${clean(cell(map.get('use')))}`) && !/build|bldg/i.test(rpa)) return false;
    // a facility list with a UM column also lists grounds and paving in SF ("Improved Grounds – Main Post | 1,856,000 | SF")
    if (unitCol && !fromQty && !/build|bldg/i.test(rpa) && !/\b(?:building|center|hall|facility|garage|structure|house|office|shop|barracks|school)\b/i.test(name)) {
      const gk = groundsKindFromText(name);
      if (gk && ['improved_turf', 'semi_improved', 'unimproved', 'parking', 'sidewalk'].includes(gk)) return false;
    }
    const eu = map.eu;
    const toSf = (v: number | undefined, u: QUnit) => (v == null ? undefined : u === 'sm' ? Math.round(v * SQFT_PER.sm) : u === 'sy' ? Math.round(v * SQFT_PER.sy) : v);
    // "1.200 qm": no building measures 1.2 units, so a lone d.ddd value is a thousands separator
    const areaNum = (t: string) => { const v = parseNumberCell(t, eu); return v != null && v < 10 && /^\D{0,3}\d{1,3}\.\d{3}(?!\d|,)/.test(clean(t)) ? parseNumberCell(t, true) : v; };
    const grossPrinted = gTxt && !isBlankish(gTxt) ? areaNum(gTxt) : undefined;
    let gross = toSf(grossPrinted, gUnit);
    const cTxt = cell(map.cleanable);
    const cUnit = cellUnit(cTxt) ?? rowUnit ?? map.cleanable?.unit ?? (gUnit === 'sm' || gUnit === 'sy' ? gUnit : map.unit) ?? 'sf';
    const cleanPrinted = cTxt && !isBlankish(cTxt) ? areaNum(cTxt) : undefined;
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
    // status: struck numbers or names, the status / frequency / remarks / name cells; the most specific wins
    // (a row marked "DEMOLISHED FY26" in its name and "N/A - excluded" in its frequency is demolished)
    let active = false;
    const found: NonNullable<RowData['status']>[] = [];
    if (isStruck(rawBn) || (!numCol && nameCol && isStruck(cells[nameCol.i])) || (numCol && !clean(rawBn) && nameCol && isStruck(cells[nameCol.i]))) found.push({ status: 'deleted_by_amendment', reason: 'Struck through in the facility list' });
    const stCol = map.get('status');
    if (stCol) {
      const v = clean(cell(stCol)).toLowerCase();
      if (/^(?:active|in service|occupied|in scope|yes|operational)$/.test(v)) active = true;
      else if (/closed|inactive/.test(v)) found.push({ status: 'vacant', reason: `Status ${clean(cell(stCol))}` });
      else if (/disposed|demolish|excess/.test(v)) found.push({ status: 'demolished', reason: `Status ${clean(cell(stCol))}` });
      else if (v) { const x = statusFromText(cell(stCol)); if (x) found.push(x); }
    }
    const freqCol = map.get('freq');
    const fTxt = clean(cell(freqCol));
    if (fTxt) { const x = statusFromText(fTxt, { frequencyCell: true }); if (x) found.push(x); }
    // information columns that only describe the building (Year Built, Historic, RPUID, …) never carry a status
    const descriptive = (c: Col) => c.role === 'info' && /\b(?:rpuid|rpsuid|uid|id|record|year|yr|built|historic\w*|eligib\w*|registry|nrhp|code|age|height|capacity|enroll\w*|population|price|cost|rate|amount|\$)\b/i.test(c.text);
    for (const c of map.cols) {
      if (!['remarks', 'name', 'meal', 'info', 'change', 'revised', 'svcType'].includes(c.role) || descriptive(c)) continue;
      const x = statusFromText(cells[c.i], { nameCell: c.role === 'name' });
      if (x) found.push(x);
    }
    for (let k = 0; k < cells.length; k++) if (!map.cols.some((c) => c.i === k)) { const x = statusFromText(cells[k]); if (x) found.push(x); }
    const demoNote = [...map.cols.filter((c) => c.role === 'remarks' || c.role === 'status').map((c) => cells[c.i]), fTxt].map(futureDemolitionNote).find(Boolean);
    if (demoNote) notes.push(demoNote);
    const STATUS_ORDER: FacilityStatus[] = ['deleted_by_amendment', 'demolished', 'vacant', 'excluded', 'option_only'];
    let status: RowData['status'] = found.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))[0];
    // a banner over the rows ("Facilities listed for reference only – not on contract", "Optional CLIN 0006 (not in the
    // base totals)") puts every row under it in that status, unless the row says otherwise
    // (a caption about some of the rows, "Buildings marked * are not included", is not such a banner)
    if (!status && !active && group && !/\b(?:marked|shaded|highlighted|asterisk|flagged|noted|indicated|denoted|where|if|unless|except)\b|[*†]/i.test(group)) { const g = statusFromText(group); if (g) status = { status: g.status, reason: `Listed under "${clean(group).slice(0, 120)}"` }; }
    // frequency
    let level: ServiceLevel | undefined;
    if (fTxt) {
      if (freqCol?.days && /^\d$/.test(fTxt)) { const d = Number(fTxt); level = levelFromDays(d); if (d === 0 && !status) status = { status: 'excluded', reason: '0 service days per week' }; }
      else level = this.scheduleLevel(fTxt);
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
        if (!txt || !isNumericCell(txt) || /\d{3,4}\s*-\s*\d{3,4}|\d{1,2}:\d{2}|a\.m\.|p\.m\./i.test(dash(txt))) continue;
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
    // a row with no area, status or dining workload ("TBD – see Addendum") is not registered
    if (!((gross ?? 0) > 0 || (cleanable ?? 0) > 0 || status || dining || active)) return true;
    const floorsTxt = cell(map.get('floors'));
    const floors = floorsTxt ? parseFloors(floorsTxt) : undefined;
    const fixtures = this.rowFixtures(cells, map);
    const campus = clean(cell(map.get('campus'))) || (group && CAMPUS_WORD.test(group) ? group : undefined);
    if (struckNote(gTxt)) notes.push(`Gross ${struckNote(gTxt)}`);
    if (struckNote(cTxt)) notes.push(`Cleanable ${struckNote(cTxt)}`);
    const use = [clean(cell(map.get('use'))), clean(cell(map.get('typeish')))].filter(Boolean).join(' ');
    // floor finishes in SF columns (Carpet SF | VCT SF | Ceramic SF) give the floor mix
    let floorMix: Facility['floorMix'];
    const mix = map.all('mix').map((c) => ({ k: c.mix!, v: parseNumberCell(cells[c.i], eu) ?? 0 }));
    const mixSum = mix.reduce((a, b) => a + b.v, 0);
    if (mix.length >= 2 && mixSum > 0) { floorMix = {}; for (const m of mix) floorMix[m.k] = round((floorMix[m.k] ?? 0) + m.v / mixSum, 3); }
    this.register({
      bn, name: name || (bn ? `Building ${bn}` : undefined), campus: campus || undefined, gross, cleanable, unit: AREA_U[gUnit], grossPrinted: gUnit !== 'sf' ? grossPrinted : undefined, cleanPrinted: cUnit !== 'sf' ? cleanPrinted : undefined,
      wasGross, floors, fixtures, level, freqText: fTxt || undefined, status, active, use, dining, portableSf, floorMix, source, tableId: `${ctx.doc.name}:${map.id}`, listing: [`${ctx.doc.name}:s:${map.sig}`, `${ctx.doc.name}:t:${(map.heads ?? []).map(normHeader).join('|')}`], notes, confidence: codeFromName ? 0.7 : 0.8, grossGeneric: !!gCol && gCol.role !== 'gross', grossService: !!gCol && gCol.role !== 'gross' && !!gCol.serviceArea, group,
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
    const label = clean(cell(map.get('name')) || cell(map.get('use')) || (map.get('name') || map.get('number') || map.get('rowKey') ? '' : cell(map.get('typeish'))));
    const rowKeyRaw = clean(cell(map.get('rowKey')));
    const numRaw = map.get('number') ? normalizeBuildingNumber(cell(map.get('number'))) : undefined;
    const rowKey = rowKeyRaw && !isBlankish(rowKeyRaw) ? rowKeyRaw : undefined;
    if (!label && !rowKey && !numRaw) return;
    // rows that are out of scope, information only, or maintained by others carry no workload
    const textCells = map.cols.filter((c) => ['remarks', 'status', 'name', 'info', 'use', 'typeish'].includes(c.role)).map((c) => clean(cells[c.i])).join(' ; ');
    if (/not in scope|out of scope|not in contract|information only|for reference only|by others|not maintained|maintained by (?!the contractor)|dato informativo/i.test(textCells)) return;
    const remarks = map.cols.filter((c) => c.role === 'remarks').map((c) => clean(cells[c.i])).join(' ; ');
    if (/\bdeleted\b|\bdisposed\b|^\s*excluded?\b/i.test(remarks) || isStruck(cells[map.get('rowKey')?.i ?? map.get('name')?.i ?? -1])) return;
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
    // a facility list with a UM column: grounds and paving rows carry their quantity in the area column
    const qCol = map.get('qty') ?? (map.kind === 'facility' && map.get('unit') ? map.gross : undefined);
    if (qCol) {
      const qTxt = clean(cells[qCol.i]);
      const v = parseNumberCell(qTxt, eu);
      const u = unitOf(` ${clean(cell(map.get('unit')))} `) ?? cellUnit(qTxt) ?? qCol.unit ?? map.unit;
      if (v && v > 0 && u && u !== 'other') {
        const lk2 = groundsKindFromText(`${label} ${qTxt.replace(/[\d.,]+/g, ' ')}`);
        let kind = lk2 && ['tree_canopy', 'shrub_bed', 'athletic_field', 'parking', 'sidewalk'].includes(lk2) ? lk2 : tk ?? lk2;
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
        // lengths and widths in meters ("Length (m)", or a metric caption) are converted to feet
        const metric = /\b(?:lengths?|widths?|dimensions?)\b[^.]{0,40}\b(?:in )?(?:met(?:er|re)s|metri)\b|\bin metri\b/i.test(map.caption) || map.unit === 'sm';
        const lU = lCol.len ?? (metric ? 'm' : 'ft'), wU = wCol.len ?? (metric ? 'm' : 'ft');
        const lFt = lU === 'm' ? FT_PER_M : 1, wFt = wU === 'm' ? FT_PER_M : 1;
        const sqft = L * lFt * W * wFt * S;
        const hard = /paver|concrete|asphalt|paved|no turf|hardscape|brick|stone/i.test(surface);
        const dims = { lf: L, width: W, sides: S, hard, lFt, wFt };
        const how = lU === 'm' || wU === 'm'
          ? `${fmt(L)} ${lU === 'm' ? 'm' : 'LF'} × ${W} ${wU === 'm' ? 'm' : 'FT'}${S !== 1 ? ` × ${S} sides` : ''}${lU === 'm' && wU === 'm' ? ` = ${fmt(L * W * S)} m²` : ''} = ${fmt(sqft)} SF`
          : `${fmt(L)} LF × ${W} FT${S !== 1 ? ` × ${S} sides` : ''} = ${fmt(sqft)} SF`;
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
    const para: Para = { text, line: 0, page: ctx.page, subjects: [bn], cell: true, inAmend: true, context: cells.join(' ') };
    const wasI = map.heads?.findIndex((h) => WAS_HEAD.test(normHeader(h))) ?? -1, isI = map.heads?.findIndex((h) => IS_HEAD.test(normHeader(h))) ?? -1;
    const isTxt = isI >= 0 && wasI >= 0 && isI !== wasI ? clean(cells[isI]) : '';
    if (isTxt) this.changeRows.push({ cells, wasI, isI, subjects: [bn], source });
    if (/\badd(?:ed|ition)?\b/i.test(change)) this.addFacility(bn, name, [revised, isTxt].filter(Boolean).join('. '), ctx, source);
    else if (/remov|delet|exclud|not in scope|withdrawn/i.test(change)) this.setStatus(bn, { status: ctx.amendLike ? 'deleted_by_amendment' : 'excluded', reason: `${change}${revised ? `: ${revised}` : ''}`.slice(0, 160) }, ctx, cells.join(' '));
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
    if (cells.length >= 2) {
      // label | value pairs; a layout extractor may leave empty spacer cells between a label and its value
      const isLabel = (c: string) => !!kvField(c) || (c.includes(':') && c.split(/:\s*/).filter(Boolean).length >= 2 && c.split(/:\s*/).filter(Boolean).every((x) => !!kvField(x)));
      for (let k = 0; k < cells.length; k++) {
        if (!clean(cells[k]) || !isLabel(clean(cells[k]))) continue;
        let v = k + 1;
        while (v < cells.length && !clean(cells[v])) v++;
        if (v < cells.length && !isLabel(clean(cells[v]))) { pairs.push([cells[k], cells[v]]); k = v; }
      }
    } else { const m = line.match(/^([A-Za-z][A-Za-z0-9 /()&.,'-]{2,60}?):\s+(.+)$/); if (m) pairs = [[m[1], m[2]]]; }
    const out: [KvField, string, string][] = [];
    for (const [l, v] of pairs) {
      const f = kvField(clean(l));
      // figures need a figure ("Gross Square Feet | Rentable Square Feet" is two labels, not a pair)
      if (f && clean(v) && (!['gross', 'cleanable', 'floors', 'above', 'below', 'fixtures', 'improved', 'semi', 'unimproved', 'parking', 'sidewalk', 'beds', 'trees'].includes(f) || /\d/.test(v))) { out.push([f, clean(l), v]); continue; }
      // two labels merged into one cell, values merged into the next: "Building Number: Building Name: | A-101 Battalion HQ"
      const labels = clean(l).split(/:\s*/).map((x) => x.trim()).filter(Boolean);
      const fs = labels.map((x) => kvField(x));
      const m = clean(v).match(/^(\S+)\s+(.+)$/);
      if (labels.length === 2 && fs[0] === 'number' && fs[1] === 'name' && m && normalizeBuildingNumber(m[1])) { out.push(['number', labels[0], m[1]], ['name', labels[1], m[2]]); }
    }
    // a building number must read as one; a row of column titles is a table header, not a key / value line
    const valid = out.filter(([f, , v]) => f !== 'number' || !!normalizeBuildingNumber(v));
    if (!valid.length) return null;
    if (!open && !valid.some(([f]) => f === 'number')) return null;
    if (cells.length >= 3 && cells.every((c) => !/\d/.test(clean(c))) && cells.filter((c) => clean(c) && roleOf(c)).length >= cells.filter((c) => clean(c)).length * 0.6) return null;
    if (valid.length === 1 && valid[0][0] === 'number' && isNumericCell(valid[0][2]) && cells.length > 2) return null;
    out.length = 0; out.push(...valid);
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
        case 'gross': { const u = cellUnit(v); const n = parseNumberCell(v); if (n) { kv.gross = u === 'sm' ? Math.round(n * SQFT_PER.sm) : n; if (u === 'sm') kv.unit = 'sm'; } break; }
        case 'cleanable': { const u = cellUnit(v); const n = parseNumberCell(v); if (n) kv.cleanable = u === 'sm' ? Math.round(n * SQFT_PER.sm) : n; break; }
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
          const u = cellUnit(v) ?? (kind === 'tree_canopy' ? 'ea' : ['parking', 'sidewalk', 'shrub_bed'].includes(kind) ? 'sf' : 'ac');
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
    // summaries ("Buildings 1201 and 1205 together total 63,950 SF") name more than one building
    if (/\b(?:totals?|together|combined|altogether|aggregate|sum|in all|subtotal)\b|\b(?:and|&|through|thru)\s+(?:bldgs?\.?\s*|buildings?\s+)?[A-Z]{0,3}-?\d/i.test(t) || new Set(refsIn(t.replace(/\d[\d,.]*\s*(?:gsf|csf|sf|s\.f\.|sq\.?\s*ft\.?|square\s*feet|ft²|sm|m²)/gi, ' ')).map((r) => r.key)).size > 1) return;
    const bn0 = normalizeBuildingNumber(m[1]);
    // a building a table or information sheet of this or a later-ranked document already gave is not re-read from a line
    if (bn0 && this.findRecs(bnKey(bn0)).some((r) => r.gross > 0 && r.grossRank >= ctx.rank && [...r.tables].some((id) => !/:(?:lines|dining|meals)$/.test(id)))) return;
    // a parenthesised conversion ("45,200 SF (4,200 SM)") is the same area
    const tv = t.replace(/\([^)]*\d[^)]*\)/g, ' ');
    const sf = [...tv.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,7})(?:\.\d+)?\s*(gsf|csf|sf|s\.f\.|sq\.?\s*ft\.?|square\s*feet|ft²|sm|m²)(?![a-z])/gi)];
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

  // ---------------------------------------------------------------- facilities described in prose
  /** A facility described under its own heading or run-in label, "Site 18 – Lakeview County Park, Beach House, …" or
   *  "Building 1201: Brigade HQ", followed by prose that states its area, cleaning area, stories and service days. The
   *  section runs to the next such heading, a numbered section, a table or an Item / Q&A entry. A facility a table or
   *  sheet already gave only takes the attributes the table left out (cleaning area, floors, schedule); one no table gave
   *  is added when its section states a building area. Change statements ("revised from … to …") are left to the
   *  amendment reader. */
  narrativeFacilities(lines: string[], ctx: Ctx) {
    const HEAD = /^(?:\d{1,2}(?:\.\d{1,2})*\.?\s+)?(?:site|building|bldg\.?|facility|location|loc\.|property|structure)\s*(?:no\.?|number|#)?\s*([A-Z]{0,3}-?\d{1,6}[A-Z]?)\s*(?:[–—:]|-\s)\s*(\S.*)$/i;
    const BOUNDARY = /^(?:section\s+\d|\d{1,2}(?:\.\d{1,2})+\.?\s+[A-Z]|\d{1,2}\.\s+[A-Z]|item\s*\d+\s*[.:\-–—]|(?:q|a)\s*\d+\s*[.:)]\s|(?:attachment|appendix|exhibit|annex|table)\s+[A-Z0-9][\w.-]*\b|end of\b)/i;
    const allCaps = (t: string) => t.length >= 6 && t.split(/\s+/).length >= 2 && !/[a-z]/.test(t) && /[A-Z]{3}/.test(t);
    type Block = { id: string; rest: string; body: string[]; source: SourceRef };
    let page: number | undefined;
    let cur: Block | null = null;
    const blocks: Block[] = [];
    const close = () => { if (cur) blocks.push(cur); cur = null; };
    for (const raw of lines) {
      const t = raw.trim();
      const pg = t.match(/^--- page (\d+) ---$/);
      if (pg) { page = Number(pg[1]); continue; }
      if (!t) continue;
      if (t.includes('|') || /^===\s/.test(t)) { close(); continue; }
      const m = t.match(HEAD);
      if (m && normalizeBuildingNumber(m[1])) { close(); cur = { id: normalizeBuildingNumber(m[1])!, rest: m[2], body: [], source: { file: ctx.doc.name, page, excerpt: clean(t).slice(0, 200) } }; continue; }
      const open = cur as Block | null;
      if (!open) continue;
      if (BOUNDARY.test(t) || allCaps(t) || open.body.length >= 25) { close(); continue; }
      open.body.push(t);
    }
    close();
    for (const b of blocks) this.narrativeBlock(b, ctx);
  }

  narrativeBlock(b: { id: string; rest: string; body: string[]; source: SourceRef }, ctx: Ctx) {
    const text = dash([b.rest, ...b.body].join(' ').replace(/\s+/g, ' '));
    if (/\b(?:is|are|was|were|has been|have been|hereby)\s+(?:hereby\s+)?(?:revised|changed|corrected|deleted|removed|added|increased|decreased)\b|\bfrom\s+[\d,.]+\s*(?:[a-z.]+\s+){0,3}to\s+[\d,.]+/i.test(text)) return;
    // abbreviations lose their periods so that sentences and clauses can be told apart
    const norm = text.replace(/\bsq\.\s*ft\.?/gi, 'sqft').replace(/\bs\.f\./gi, 'sf').replace(/\b(approx|est|no|bldg|ft|sq|st|ave|rd|blvd|dr)\./gi, '$1');
    const clauses = norm.split(/(?<=[.;!?])\s+/);
    const AREA_AFTER = /(\d{1,3}(?:,\d{3})+|\d{3,7})(?:\.\d+)?\s*(?:\+\/-\s*|±\s*)?(?:sqft|square\s+feet|sf\b|gsf\b|gross square feet)/gi;
    const AREA_LABEL = /(?:square\s+footage|square\s+feet|sqft|\barea)\s*(?:is|of|:)\s*(?:approximately|approx|about)?\s*(\d{1,3}(?:,\d{3})+|\d{3,7})\b/gi;
    const CLEAN_CL = /cleaning area|cleanable|area to be cleaned|custodial (?:area|sqft|sf|square)|serviced area|area serviced|\blimited to\b/i;
    const EXCL_CL = /not included|not part of|\bexclude[ds]?\b|not cleaned|\bcleaned by\b(?! the contractor)|maintained by|operated by|\bseparate\b|volunteers|\bby\s+(?:the\s+)?[a-z’'& ]{0,30}\bstaff\b/i;
    // parts of the building, finishes, and outdoor areas ("a 40-space parking lot of 12,000 sq. ft.") are not its area
    const PART_BEFORE = /\b(?:floor|level|basement|mezzanine|wing|addition|carpet|vct|tile|ceramic|terrazzo|resident rooms?|rooms?|suite|units?|parking|lots?|yard|site|grounds|lawn|land|parcel|paved|pavement|exterior|outdoor|deck|patio|porch|canopy|shed)\b[^,;]{0,25}$/i;
    let gross: number | undefined, cleanable: number | undefined;
    for (const cl of clauses) {
      const hits = [...cl.matchAll(AREA_AFTER), ...cl.matchAll(AREA_LABEL)].sort((a, c) => (a.index ?? 0) - (c.index ?? 0));
      for (const h of hits) {
        const v = Number(h[1].replace(/,/g, ''));
        if (!(v >= 50)) continue;
        const before = cl.slice(Math.max(0, (h.index ?? 0) - 60), h.index ?? 0);
        const after = cl.slice((h.index ?? 0) + h[0].length, (h.index ?? 0) + h[0].length + 30);
        if (CLEAN_CL.test(cl)) { cleanable ??= v; continue; }
        if (EXCL_CL.test(cl) || PART_BEFORE.test(before) || /^\s*(?:of|in)\s+(?:carpet|vct|tile|ceramic|resilient|hard|wood|the building is)/i.test(after)) continue;
        gross ??= v;
      }
    }
    const fl = norm.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})[- ](?:story|stories|storey|storeys)\b/i) ?? norm.match(/\b(?:on|over|of)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+(?:floors|levels|stories)\b/i);
    const floors = fl ? wordOrNum(fl[1].toLowerCase()) : undefined;
    // schedule: a fragment after a dash or colon in the lines under the heading, else the first sentence about service
    // or cleaning that is not about work done by others
    const frags = [b.rest, b.body[0] ?? ''].flatMap((l) => dash(l).split(/\s+-\s+|:\s+/).slice(1));
    const OTHERS = /\bby\s+(?:the\s+)?(?!contractor)[a-z’'& ]{0,30}(?:staff|volunteers|personnel|workers|occupants|residents|others)\b|\bexcluded\b|not included|not part/i;
    let level: ServiceLevel | undefined, freqText: string | undefined;
    for (const f of [...frags, ...clauses.filter((c) => /\b(?:service[sd]?|cleaning|cleaned|clean)\b/i.test(c) && !OTHERS.test(c))]) {
      const l = this.scheduleLevel(f);
      if (l) { level = l; freqText = clean(f).slice(0, 120); break; }
    }
    // a status in the heading itself ("Site 5 – Former Town Hall (vacant)"); statements further down the section usually
    // concern a part of the building or a neighbouring one
    const status = statusFromText(b.rest.split(/\.\s/)[0], { nameCell: true });
    const name = clean(b.rest.split(/\s+[–—]\s+|\s+-\s+|,\s*(?=\d)|\.\s|\s*\(?(?:approximately|approx\.?|estimated)\b/i)[0]).replace(/[,.:;]+$/, '');
    const key = bnKey(b.id);
    const known = this.findRecs(key).some((r) => r.grossRank >= ctx.rank && [...r.tables].some((id) => !/:(?:narrative|lines|added:.*)$/.test(id)));
    if (!known && !(gross && gross > 0)) return;
    this.register({ bn: b.id, name: name.length > 2 && name.length < 120 ? name : undefined, gross: known ? undefined : gross, cleanable, floors, level, freqText, status, active: !known && !status, source: b.source, tableId: `${ctx.doc.name}:narrative`, notes: known ? undefined : ['Read from the facility description in the text.'], confidence: 0.6 }, ctx.rank);
  }

  // ---------------------------------------------------------------- grounds sentences ("Type II (semi-improved) 30 acres")
  proseGrounds(line: string, ctx: Ctx, source: SourceRef) {
    const t = clean(line);
    if (!/\d/.test(t) || !/acre|\bac\b|hectare|\bha\b|\bsf\b|square (?:feet|yards)|\bsy\b|trees/i.test(t)) return;
    if (/\b(?:means|defined|definition|minimum|maximum|height|inches|per (?:acre|sf)|\$)/i.test(t)) return;
    for (let clause of t.split(/;\s*|\.\s+(?=[A-Z])/)) {
      // the size of a park, campus or site ("Lakeview Park is approximately 46 acres, including about 14 acres of mowed
      // turf") is not a maintained area; what the clause says after it may be
      const size = clause.match(SITE_SIZE);
      if (size) clause = clause.slice((size.index ?? 0) + size[0].length);
      // summaries ("a total of …", "total improved acreage …", "in all") would double count listed areas
      if (/\b(?:grand |sub)?total\s+(?:of\s+)?(?:all\s+)?(?:improved|semi|unimproved|grounds|acre|area|site|turf|mowed|maintained)|\btotals?\s*[:=]|\bin all\b|\baltogether\b|\bcombined\b|site area|total site|\ba total of\b/i.test(clause)) continue;
      if (/not (?:maintained|included|in scope|part)|exclud|by others|maintained by (?!the contractor)|information only|not mowed/i.test(clause)) continue;
      if (/\brevis|\bchang|\bcorrect|\bdelet|\bfrom\s+[\d.,]+\s*(?:\w+\s+)?to\s+[\d.,]/i.test(clause)) continue;
      if (/\(\s*(?:approx(?:imately)?\.?|about|ca\.|i\.e\.|or|≈)?\s*\d[\d,.]*\s*(?:acres?|ac|ha|sf|sq\.?\s*ft|sy)\b[^)]*\)/i.test(clause)) continue;
      const q = clause.replace(/^\s*(?:\d+(?:\.\d+)+|[a-z]\.|\(\w\))\s+/i, '').match(/(\d[\d,]*(?:\.\d+)?)\s*(acres?|ac\.?|hectares?|ha|sf|square feet|sq\.?\s*ft\.?|sy|square yards|trees)\b/i);
      if (!q) continue;
      const kind = groundsKindFromText(clause);
      if (!kind) continue;
      const u = unitOf(` ${q[2]} `) ?? 'ac';
      if ((kind === 'tree_canopy') !== (u === 'ea')) continue;
      if (kind === 'tree_canopy' && !/^\d[\d,]*$/.test(q[1])) continue;
      if (['improved_turf', 'semi_improved', 'unimproved', 'athletic_field'].includes(kind) && !['ac', 'ha', 'sf', 'sm', 'sy'].includes(u)) continue;
      const served = refsIn(clause).filter((r) => !r.site).map((r) => r.id);
      this.proseGroundsPending.push({ kind, qty: Number(q[1].replace(/,/g, '')), unit: u, label: clause.replace(q[0], '').replace(/[:,\s]+$/, '').slice(0, 100), served, source, tableId: `${ctx.doc.name}:prose`, rank: ctx.rank });
    }
  }

  // ---------------------------------------------------------------- amendment / Q&A / prose statements
  statements(p: Para, ctx: Ctx, all: Para[]) {
    const text = p.text;
    if (!/delet|remov|exclud|not part of|not in scope|revis|chang|correct|amend|\badd\b|added|addition|increas|decreas|shall not be priced|no longer|is now/i.test(text)) return;
    const known = this.knownKey;
    const paraRefs = refsIn(text, known);
    const paraKeys = [...new Set(paraRefs.map((r) => r.key))];
    const paraSubject = paraKeys.length === 1 ? paraRefs[0] : undefined;
    const subjectRefs: Ref[] = (p.subjects ?? []).map((id) => ({ id, key: bnKey(id), at: 0, end: 0, site: false }));
    const amend = ctx.amendLike || p.inAmend || /amendment|addendum/i.test(text);
    const sentences = splitSentences(text);
    for (let si = 0; si < sentences.length; si++) {
      const s = sentences[si];
      const refs = refsIn(s, known);
      // deletions / exclusions
      const del = s.match(/\b(?:is|are|was|were|has been|have been|hereby|will be|shall be)\s+(?:hereby\s+)?(?:deleted|removed|excluded|eliminated|withdrawn)\b|\b(?:is|are)\s+not\s+(?:a\s+)?part\s+of\s+(?:this|the)\s+(?:solicitation|contract|requirement|scope|rfp|work)|\bremoved\s+from\s+(?:the\s+)?scope\b|\bno\s+longer\s+(?:in\s+scope|required|part\s+of)\b|\bis\s+DELETED\b/i);
      if (del && !/\b(?:may|might|could|if|unless|whether|would)\b[^.]{0,40}$/i.test(s.slice(0, del.index))) {
        // the subject of the verb: references in the same clause, near its start ("Building 118 is deleted …",
        // "Site 14, Wexford Commons Pocket Park, is DELETED …"); a list after a colon ("… are deleted: 118, 120")
        const vi = del.index ?? 0;
        const segStart = Math.max(s.lastIndexOf(';', vi), s.lastIndexOf(':', vi)) + 1;
        const after = s.slice(vi + del[0].length);
        // the reference must be the subject of the verb ("Building 118 is deleted", "Site 14, Wexford Commons Pocket Park,
        // is DELETED", "Building 0012 at North Annex is deleted"), never an object ("Trash from Building 1210 shall be
        // removed daily", "The carpet in Building 1201 was removed"); "removed" / "excluded" also need their scope
        // ("… from the requirement", "in its entirety") or the end of the clause
        const scoped = !/\b(?:removed|excluded)\b/i.test(del[0]) || /removed\s+from|not\s+(?:a\s+)?part|no\s+longer/i.test(del[0]) || DELETION_SCOPE.test(after);
        let targets = scoped ? refs.filter((r) => r.at >= segStart && r.at < vi) : [];
        if (targets.length && !deletionSubject(s, segStart, targets, vi)) targets = [];
        if (!targets.length && scoped && /^[^.]*:/.test(after)) {
          // a list after the colon: a building named as the item ("Building 20, Parking Garage") is excluded whole; one that
          // only locates the excluded part ("sterile storage areas in Building 1") is not
          // (items separated by semicolons run on into the following "sentences")
          let list = after.slice(after.indexOf(':'));
          for (let k = si + 1; k < sentences.length && /;\s*$/.test(sentences[k - 1]); k++) list += ` ${sentences[k]}`;
          targets = refsIn(list, known).filter((r) => !/\b(?:in|at|of|within|inside|from)\s+(?:the\s+)?$/i.test(list.slice(Math.max(0, list.lastIndexOf(';', r.at), list.lastIndexOf(':', r.at)), r.at)));
        }
        if (!targets.length && scoped && p.cell && subjectRefs.length === 1 && !refs.length && /^\s*(?:(?:yes|no)[.,]?\s*)?(?:(?:it|they|this|that|these|those|the)(?:\s+(?:building|facility|location|site|structure|buildings|facilities))?)?\s*$/i.test(s.slice(segStart, vi))) targets = subjectRefs;
        for (const r of targets) {
          const reason = s.slice(0, 160);
          let campus: string | null | undefined;
          // a numbered site is a facility when the package lists facilities, not grounds areas, under that number
          if (!r.site || (this.findRecs(r.key).length && !this.grounds.some((g) => g.rowKey && bnKey(g.rowKey) === r.key))) campus = this.setStatus(r.id, { status: amend && (/delet|remov|withdraw|eliminat/i.test(del[0]) || /deleted by (?:amendment|addendum)/i.test(text)) ? 'deleted_by_amendment' : 'excluded', reason }, ctx, `${s} ${text} ${p.context ?? ''}`);
          if (campus !== null) this.deleteGrounds(r.key, ctx, `${s} ${text} ${p.context ?? ''}`);
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
      // an instruction to add a building ("Add Building 41 (B-41), Whole Health Center, a new modular building …"), with
      // its figures in the sentence or in the rest of the change-log row
      const addCmd = amend ? s.match(/^\s*(?:(?:item\s+)?\d{1,3}[.):]?\s+)?(?:please\s+)?add(?:\s+the\s+following)?\s*:?\s+(?=(?:new\s+)?(?:bldgs?|buildings?|facilit(?:y|ies)|sites?|locations?|structures?)\b)/i) : null;
      if (addCmd) {
        const target = refs.find((r) => r.at >= addCmd[0].length - 1 && !r.site) ?? refs.find((r) => r.at >= addCmd[0].length - 1);
        if (target) {
          const nm = s.slice(target.end).replace(/^\s*\([^)]*\)/, '').replace(/^\s*[,:–—-]\s*/, '').split(/\s*(?:[,;.(]|\s[–—-]\s)/)[0].trim();
          this.addFacility(target.id, nm.length > 3 && nm.length < 100 && !/\d{2,}/.test(nm) && /[A-Z]/.test(nm[0] ?? '') ? nm : undefined, `${s.slice(addCmd[0].length)} ${p.context ?? ''}`, ctx, { file: ctx.doc.name, page: p.page, excerpt: s.slice(0, 200) });
        }
      }
      // revisions ("Gross SF is REVISED from 2,240 to 2,420", "Amendment 0002 revises Building 2101 to 52,980 GSF")
      if (/revis|chang|correct|amend|increas|decreas|reduc|updat|is now/i.test(s)) {
        for (const clause of s.split(/;\s+|,\s+and\s+(?=the\s|[A-Z])/)) this.revision(clause, refsIn(clause, known), refs, paraSubject, subjectRefs, ctx, amend);
      } else if (amend && /\b(?:gross|cleanable|custodial)\s+(?:square\s+(?:footage|feet)|sq\.?\s*ft|sf|area)\s+(?:of|for)\s+/i.test(s)) {
        this.revision(s, refs, refs, paraSubject, subjectRefs, ctx, amend);
      }
    }
    void all;
  }

  revision(clause: string, refs: Ref[], sentenceRefs: Ref[], paraSubject: Ref | undefined, subjects: Ref[], ctx: Ctx, amend: boolean) {
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
    const seg = before.split(/:\s+|\.\s+(?=[a-z]{4,}\s+(?:is|are|was|were|has|have)\b)/).slice(-1)[0] ?? before;
    let field: 'gross' | 'cleanable' | 'floors' | 'fixtures' | 'length' | 'width' | 'acres' | 'portable' | 'area' | undefined;
    if (/@/.test(oldTxt ?? '') || /@/.test(newTxt ?? '')) field = 'portable';
    else if (/cleanable|custodial (?:\(cleanable\) )?(?:square|sq|sf|area)|\bcsf\b|net area|service area/.test(seg)) field = 'cleanable';
    else if (/\bfloors?\b|stories|levels/.test(seg) || /floor/.test(unitTxt)) field = 'floors';
    else if (/fixtures/.test(seg) || /fixture/.test(unitTxt)) field = 'fixtures';
    else if (/\blength\b|\blf\b/.test(seg) || /lf|linear/.test(unitTxt)) field = 'length';
    else if (/\bwidth\b/.test(seg)) field = 'width';
    else if (/acres?|turf|mow|grounds/.test(seg) || /acre|^ac$/.test(unitTxt)) field = 'acres';
    else if (/gross|gsf|pricing area|building sf|permanent building/.test(seg) || (/^gsf$/.test(unitTxt))) field = 'gross';
    else if (/sf|square|sq|area|gsf/.test(seg + ' ' + unitTxt)) field = 'area';
    else if (/portables?|number of|count/.test(seg)) return;
    if (!field) return;
    const isFixtures = field === 'fixtures';
    const parse = (s?: string) => { if (!s) return undefined; if (isFixtures && /\//.test(s)) return parseFixtures(s, true); return parseNumberCell(s); };
    const oldV = parse(oldTxt), newV = parse(newTxt);
    if (newV == null || !isFinite(newV)) return;
    let targets = refs.filter((r) => r.at <= at + 5);
    if (!targets.length) targets = refs.length ? refs : sentenceRefs.length ? sentenceRefs : paraSubject ? [paraSubject] : subjects.length === 1 ? subjects : [];
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
          const sqft = d.lf * (d.lFt ?? 1) * d.width * (d.wFt ?? 1) * d.sides;
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

  /** Applies a deletion / exclusion to the building. When the number is used on several campuses, only the record whose
   *  campus the statement names changes; if it names none (or several), nothing changes and the records get a note.
   *  Returns the campus applied to (undefined: no campus involved), or null when the statement was ambiguous. */
  setStatus(id: string, st: { status: FacilityStatus; reason: string }, ctx: Ctx, context = ''): string | null | undefined {
    let recs = this.findRecs(bnKey(id));
    let campus: string | undefined;
    if (recs.length > 1) {
      const hit = recs.filter((r) => r.campus && mentions(context, r.campus));
      if (hit.length !== 1) {
        for (const r of recs) if (!r.notes.some((n) => n.startsWith('Deletion ambiguous'))) r.notes.push(`Deletion ambiguous across campuses: ${ctx.doc.name} says "${st.reason.slice(0, 100)}" without naming one campus for building ${id}; status not changed.`);
        return null;
      }
      recs = hit; campus = hit[0].campus;
    }
    for (const r of recs) {
      // a statement never turns a specific status (deleted, demolished, vacant) into a generic "excluded"
      if (r.status && st.status === 'excluded') continue;
      r.status = st.status; r.statusReason = st.reason; r.statusRank = Math.max(r.statusRank, ctx.rank);
    }
    return campus;
  }
  deleteGrounds(key: string, ctx: Ctx, context = '') {
    let hits = this.grounds.filter((g) => g.rowKey && bnKey(g.rowKey) === key && g.rank <= ctx.rank);
    // the same site or area number on two campuses: only the one the statement names
    if (new Set(hits.map((g) => nameKey(g.g.campus ?? ''))).size > 1) {
      const named = hits.filter((g) => g.g.campus && mentions(context, g.g.campus));
      if (new Set(named.map((g) => nameKey(g.g.campus ?? ''))).size !== 1) return;
      hits = named;
    }
    this.grounds = this.grounds.filter((g) => !hits.includes(g));
  }
  addFacility(id: string, name: string | undefined, text: string, ctx: Ctx, source: SourceRef) {
    const t = dash(clean(text));
    const num = (re: RegExp) => { const m = t.match(re); return m ? parseNumberCell(m[1]) : undefined; };
    const gross = num(/gross\s+(?:sq\.?\s*ft\.?|square\s+f(?:ee|oo)t(?:age)?|sf|area)\s*(?:of|is|:)?\s*([\d,]+)/i) ?? num(/([\d,]{3,})\s*(?:gross\s+(?:square\s+feet|sq\.?\s*ft\.?|sf)|gsf)\b/i);
    const cleanable = num(/(?:cleanable|custodial)\s+(?:sq\.?\s*ft\.?|square\s+f(?:ee|oo)t|sf|area)\s*(?:of|is|:)?\s*([\d,]+)/i) ?? num(/([\d,]{3,})\s*(?:(?:cleanable|custodial)\s+(?:square\s+feet|sq\.?\s*ft\.?|sf)|csf\b)/i);
    const fl = t.match(/\b(\d{1,2}|one|two|three|four|five|six)\s*(?:\(\d+\)\s*)?floors?\b/i) ?? t.match(/\bfloors?\s*:?\s*(\d{1,2})(?![\d-])/i);
    const fx = t.match(/(\d{1,4})\s*(?:restroom\s+|plumbing\s+)?fixtures/i);
    const dy = t.match(/\b(\d|one|two|three|four|five|six|seven)\s*(?:\(\d\)\s*)?(?:service\s+)?days?\s*(?:per|a|\/)\s*week/i);
    const days = wordOrNum(dy?.[1]);
    // a schedule code from the package's legend ("Service Schedule Code D")
    const code = t.match(/\b(?:[Ss]chedule\s+|[Ss]ervice\s+)?(?:[Cc]ode|CODE)\s+([A-Z]{1,2}\d?)\b/);
    const codeLevel = code ? this.codeLevels.get(code[1].toUpperCase())?.level : undefined;
    const freqText = dy?.[0] ?? (codeLevel ? code![0] : undefined);
    const campus = t.match(/\bcampus:\s*([A-Za-z][A-Za-z .'-]{1,40})/i)?.[1]?.trim().replace(/\.$/, '');
    if (!gross && !this.findRecs(bnKey(id)).length) return;
    this.register({ bn: normalizeBuildingNumber(id) ?? id, name: name || `Building ${id}`, campus, gross, cleanable, floors: wordOrNum(fl?.[1]), fixtures: fx ? Number(fx[1]) : undefined, level: days != null ? levelFromDays(days) : codeLevel, freqText, active: true, source, tableId: `${ctx.doc.name}:added:${id}`, notes: [`Added by ${ctx.doc.name}.`], confidence: 0.7 }, ctx.rank + 0.0001);
  }

  // ---------------------------------------------------------------- dining workload in prose ("2,650 meals per day across four meal periods")
  proseDining(paras: Para[], idx: number, ctx: Ctx) {
    const p = paras[idx];
    const t = dash(p.text);
    const m = t.match(/(\d[\d,]*)\s*(?:meals?|headcounts?|patrons?|rations?|diners?|customers?)\s*(?:are\s+served\s+)?(?:per|a|\/|each)\s*day/i) ?? t.match(/average daily (?:headcount|census|meals?) (?:is|of)\s*(\d[\d,]*)/i);
    if (!m) return;
    // meals served under another contract, by others, or stated for information carry no workload here
    if (/separate (?:contract|agreement)|another contract|other contracts?|not part of|not included|by others|information only|for reference only|not in (?:scope|contract)/i.test(t)) return;
    const meals = Number(m[1].replace(/,/g, ''));
    // "3 meals per day" is a ration rule, not a dining workload
    if (!(meals >= 20 || (meals > 0 && /\b(?:average|avg|headcount|census|served|serves|feeds|patrons|diners)\b/i.test(t) && meals >= 10))) return;
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
    // target: a building named in this or the previous paragraphs, else the dining facility the paragraph names
    // ("The Lightning Inn serves …"), else the only dining facility
    let target: FacRec | undefined;
    for (let k = idx; k >= Math.max(0, idx - 3) && !target; k--) {
      for (const r of refsIn(paras[k].text, this.knownKey)) { const recs = this.findRecs(r.key); if (recs.length === 1) { target = recs[0]; break; } }
    }
    const dfacs = this.recs.filter((r) => categorize(`${r.name} ${r.use}`) === 'dining' || r.dining);
    if (!target && dfacs.length) {
      const scored = dfacs.map((r) => ({ r, s: nameSimilarity(r.name, p.text) })).sort((a, b) => b.s - a.s);
      if (scored[0].s >= 0.5 && (scored.length === 1 || scored[0].s > scored[1].s)) target = scored[0].r;
      else if (dfacs.length === 1) target = dfacs[0];
    }
    const source: SourceRef = { file: ctx.doc.name, page: p.page, excerpt: p.text.slice(0, 200) };
    if (target) this.merge(target, { dining, source, tableId: `${ctx.doc.name}:dining` }, ctx.rank);
    else if (dfacs.length > 1) {
      for (const r of dfacs) if (!r.notes.some((n) => n.startsWith('Unassigned dining workload'))) r.notes.push(`Unassigned dining workload: ${ctx.doc.name} states ${fmt(meals)} meals per day without naming which dining facility serves them ("${p.text.slice(0, 90)}").`);
    }
    // a dining facility is created from prose only when the package has food-service scope
    else if (this.diningScope) this.register({ name: 'Dining Facility', gross: (dining.kitchenSqft ?? 0) + (dining.diningRoomSqft ?? 0) || undefined, dining, source, tableId: `${ctx.doc.name}:dining`, notes: ['Dining headcount found but no facility row; verify square footage.'], confidence: 0.4, active: true }, ctx.rank);
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
        if (!rec && !dfacs.length && mt.periodsByTarget.size === 1) rec = this.register({ name: 'Dining Facility', dining: {}, source: mt.source, tableId: `${mt.source.file}:meals`, notes: ['Headcount by meal period found but no dining facility row; enter the building and its square footage.'], confidence: 0.3, active: true }, mt.rank);
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
      // the use / CATCODE description column decides when it maps to a category ("Warehouse / Office / Shops" → warehouse)
      const useCat = r.use ? categorize(r.use.split(/\s*[/,;]\s*|\s+-\s+/)[0]) : 'other';
      let category = useCat !== 'other' ? useCat : categorize(name);
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
      const yearly = r.level === 'quarterly' ? lessThanQuarterly(r.freqText) : undefined;
      if (yearly != null) notes.push(`"${r.freqText}" is about ${yearly} visits a year, less often than quarterly; estimated as quarterly.`);
      if (r.level === 'biweekly' && /bi-?weekly|bi-?wkly/i.test(r.freqText ?? '')) notes.push(`"${r.freqText}" read as every two weeks; check whether the PWS defines it as twice a week.`);
      const scope: Facility['scope'] = dining ? ['custodial', 'floor_care', 'dining'] : ['custodial', 'floor_care'];
      const f: Facility = {
        id, buildingNumber: r.bn, name: name.replace(/\s+/g, ' ').slice(0, 120), category, grossSqft: Math.round(gross * 100) / 100, cleanableSqft: r.cleanable, floors: r.floors ?? 0,
        restroomFixtures: r.fixtures, serviceLevel: level, scope, dining, floorMix: r.floorMix, source: r.source, confidence: gross > 0 ? r.confidence : 0.3,
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

/** Comma-separated tables pasted as text (a header row of titles, then rows with the same field count) become
 *  "cell | cell" rows; quoted fields keep their commas ("45,200"). */
function csvSplit(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"' && !cur.trim()) q = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
function csvBlocksToRows(lines: string[]): string[] {
  const out = [...lines];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i];
    if (h.includes('|') || h.includes('\t') || (h.match(/,/g)?.length ?? 0) < 2) continue;
    const hc = csvSplit(h);
    if (hc.length < 3 || hc.some((c) => /\d/.test(c) || !c || c.length > 40) || hc.filter((c) => roleOf(c)).length < 2) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].includes('|') && lines[j].trim() && csvSplit(lines[j]).length === hc.length) j++;
    if (j - i < 2) continue;
    for (let k = i; k < j; k++) out[k] = csvSplit(lines[k]).map((c) => c.replace(/\|/g, '/')).join(' | ');
    i = j - 1;
  }
  return out;
}

function isNumericRow(cells: string[]): boolean {
  const ne = cells.map(clean).filter(Boolean);
  return ne.length > 0 && ne.filter((c) => isNumericCell(c)).length / ne.length > 0.5;
}

function fits(cells: string[], map: TableMap): boolean {
  if (cells.length < map.n - 1 || cells.length > map.n + 1) return false;
  const num = map.get('number');
  if (num && clean(cells[num.i]) && !normalizeBuildingNumber(cells[num.i])) return false;
  for (const g of [map.gross, map.cleanable, map.get('qty'), ...map.all('gQty')]) {
    if (!g) continue;
    const v = clean(cells[g.i]);
    if (v && !isBlankish(v) && !/^\s*[~±≈]?\s*(?:approx\.?\s*)?\d[\d.,]*(?:\s|$|[a-z²]{1,6}\.?(?:\s|$)|\s*@)/i.test(v) && !/^tbd\b/i.test(v)) return false;
  }
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
    // a title merged down over both header rows is printed in each ("Zone" over "Zone"): once
    out.push(head && head === b ? b : [head, b].filter(Boolean).join(' '));
  }
  return out;
}

function splitCode(name: string, allowParen: boolean): { code?: string; name: string } {
  const n = dash(name);
  const m = n.match(/^([A-Z][A-Z0-9]{1,5}(?:\/[A-Z0-9]{1,6})?)\s+-\s+(.+)$/);
  if (m && !/^(?:THE|AND|FOR|NEW|OLD|NORTH|SOUTH|EAST|WEST|MAIN|BLDG|AREA)$/.test(m[1])) return { code: m[1], name: m[2] };
  if (allowParen) { const p = n.match(/^(.+?)\s*\(([A-Z]{2,5})\)$/); if (p) return { code: p[2], name: p[1] }; }
  // "Bldg 1201 Brigade Headquarters", "1201 – Brigade Headquarters", "T-2401 Barracks"
  const b = n.match(/^(?:(?:bldg|building|facility|fac)\.?\s*(?:no\.?|#)?\s*)?([A-Z]{0,3}-?\d{3,6}[A-Z]?)(?:\s*[-:,]\s*|\s+)([A-Za-z(].{2,})$/i);
  if (b && !/^\d{3,6}\s+[A-Z][a-z]+\s+(?:st|street|ave|avenue|rd|road|blvd|drive|dr|way|lane|ln|pkwy|parkway)\b/i.test(n)) return { code: b[1].toUpperCase(), name: b[2] };
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

const STATE_CLIMATE: [RegExp, RegExp, NonNullable<SiteInfo['climateZone']>][] = [
  [/\b(?:florida|georgia|louisiana|mississippi|alabama|south carolina|hawaii|guam|puerto rico|okinawa)\b/i, /,\s*(?:FL|GA|LA|MS|AL|SC|HI)\b/, 'hot_humid'],
  [/\b(?:arizona|nevada|new mexico|utah|el paso|kuwait|qatar|bahrain|djibouti|iraq)\b/i, /,\s*(?:AZ|NV|NM|UT)\b/, 'arid'],
  [/\b(?:alaska|minnesota|north dakota|south dakota|montana|wisconsin|michigan|iowa|idaho|nebraska|maine|vermont|new hampshire|wyoming)\b/i, /,\s*(?:AK|MN|ND|SD|MT|WI|MI|IA|ID|NE|ME|VT|NH|WY)\b/, 'cold'],
  [/\b(?:kentucky|missouri|kansas|virginia|west virginia|washington|oregon|tennessee|north carolina|maryland|delaware|pennsylvania|ohio|indiana|illinois|new york|new jersey|massachusetts|connecticut|rhode island|district of columbia|california|oklahoma|arkansas|colorado|italy|germany|korea|japan)\b/i, /,\s*(?:KY|MO|KS|VA|WV|WA|OR|TN|NC|MD|DE|PA|OH|IN|IL|NY|NJ|MA|CT|RI|DC|CA|OK|AR|CO)\b/, 'temperate'],
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
  const title = (x: string) => x.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  for (const m of all.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?|[A-Z]{3,}(?: [A-Z]{3,})?) (?:Air Force Base|AIR FORCE BASE)\b/g)) bump(`${/[a-z]/.test(m[1]) ? m[1] : title(m[1])} Air Force Base`);
  // county and VA health care owners ("Kessling County", "Elk Prairie VA Medical Center")
  for (const m of all.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) County\b(?!\s+(?:Road|Rd|Park|Fair|Line|Highway|Hwy|Route)\b)/g)) bump(`${m[1]} County`, 0.6);
  for (const m of all.matchAll(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) VA (?:Medical Center|Health ?Care System|Healthcare System)\b/g)) bump(`${m[1]} VA`, 1);
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
    const bo = s.match(/\b(?:base|initial)\s+(?:period|term|year)\b[^.]{0,160}?\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\((\d+)\))?\s*(?:additional\s+)?(?:(?:one|1|twelve|12)[- ](?:year|month)\s+|\(\d+\)\s*(?:one|1)?[- ]?(?:year\s+)?)?(?:option|renewal|extension)/i)
      ?? s.match(/\b(?:initial term|base period)[^.]{0,120}?(?:renew(?:ed|als?)?|option)[^.]{0,40}?\b(?:up to\s+)?(\w+)\s*(?:\((\d+)\))?\s*(?:additional\s+)?(?:one[- ]year|1-year|twelve-month|12-month)?/i);
    if (bo && !site.contractYears) {
      const opts = Number(bo[2] ?? NaN) || wordOrNum(bo[1]);
      const baseY = s.match(/\b(?:base|initial)\s+(?:period|term)[^.]{0,30}?(?:of|shall be)\s+(\w+)\s*(?:\((\d+)\))?\s*(years?|months?)/i) ?? s.match(/\b(\w+)[- ](year|month)\s+(?:base|initial)/i);
      let baseYears = 1;
      if (baseY) { const v = Number(baseY[2] ?? NaN) || wordOrNum(baseY[1]) || 1; baseYears = /month/i.test(baseY[3] ?? baseY[2] ?? '') ? Math.max(1, Math.round(v / 12)) : v; }
      if (opts != null && opts >= 1 && opts <= 10) { site.contractYears = baseYears + opts; }
    }
  }
  // climate: stated in words, else from the state / country on the first pages, else "heavy snow" wording
  const climate = all.match(/\b(humid subtropical|hot[- ]humid|arid|desert|semi-arid|cold climate|temperate)\b/i);
  if (climate) { const c = climate[1].toLowerCase(); site.climateZone = /humid|subtropical/.test(c) ? 'hot_humid' : /arid|desert/.test(c) ? 'arid' : /cold/.test(c) ? 'cold' : 'temperate'; }
  else {
    let best: { at: number; z: NonNullable<SiteInfo['climateZone']> } | undefined;
    for (const [names, abbr, z] of STATE_CLIMATE) for (const re of [names, abbr]) { const m = head.match(re); if (m && (best == null || (m.index ?? 0) < best.at)) best = { at: m.index ?? 0, z }; }
    if (best) site.climateZone = best.z;
    else if (/heavy snow|severe winter/i.test(all)) site.climateZone = 'cold';
  }
  const gs = all.match(/growing season[^.\n]{0,60}?(\d{2})\s*weeks/i) ?? all.match(/(\d{2})\s*weeks[^.\n]{0,30}growing season/i);
  if (gs) site.growingSeasonWeeks = Number(gs[1]);
  return site;
}

// =====================================================================================================================
// Public API
// =====================================================================================================================

/** "The park is approximately 46 acres", "the campus covers 186 acres": the size of a property. */
const SITE_SIZE = /\b(?:park|campus|site|property|installation|base|post|fairgrounds?|complex|reservation|preserve|compound|parcel|grounds)\s+(?:is|covers|comprises|encompasses|totals|occupies|sits on|consists of|spans)\s+(?:approximately\s+|approx\.?\s+|about\s+|roughly\s+|some\s+|over\s+|nearly\s+|almost\s+)?\d[\d,.]*\s*(?:acres?|ac\b|hectares?|ha\b)/i;
/** Grounds maintenance stated to be outside the contract ("grounds maintenance and snow removal are performed by County
 *  staff and are not part of this RFP", "Work Not Included: … grounds maintenance, lawn care …"). */
const GROUNDS_OUT = [
  /\b(?:grounds?\s+(?:maintenance|care|keeping)|groundskeeping|landscap(?:e|ing)(?:\s+maintenance)?|lawn\s+(?:care|mowing|maintenance)|mowing)\b(?:(?!\b(?:at|for|of|in)\s)[^.;]){0,160}?\b(?:(?:is|are)\s+not\s+(?:part\s+of|included\s+in|within)\s+(?:this|the)\s+(?:rfp|rfq|ifb|itb|contract|solicitation|scope|requirement|pws|sow|bid|procurement)|(?:is|are)\s+(?:performed|provided|done)\s+by\s+(?:the\s+)?(?:county|city|town|government|installation|district|university|college|owner|agency|state|parks|engineering|others|facilit(?:y|ies)\s+(?:management|staff))\b)/i,
  /\b(?:work|services?|items?)\s+not\s+included\b[^.]{0,250}?\b(?:grounds\s+maintenance|lawn\s+care|mowing)\b/i,
];
const DINING_SCOPE = /\b(?:food services?|full food service|\bffs\b|dining facility (?:operations?|attendants?|services?|management)|dfac (?:operations?|services?|attendants?)|\bdfa\b|mess attendants?|food preparation|meal preparation|subsistence|serving line|galley operations?)/i;

export function heuristicExtract(docs: DocInput[]): Inventory {
  const r = new Reader();
  const ordered = orderDocs(docs);
  for (const o of ordered) { r.scanScope(o.doc.text); r.scanCodes(o.doc.text); }
  r.diningScope = ordered.some((o) => DINING_SCOPE.test(o.doc.text));
  r.groundsOut = ordered.some((o) => { const t = o.doc.text.replace(/\s+/g, ' '); return GROUNDS_OUT.some((re) => re.test(t)); });
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
  for (const raw of normalizeRows(text)) {
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
          // all-caps text (SF 30 continuation pages): the joining words are lower-cased, the company name keeps its case
          const sc = /[a-z]/.test(s.replace(/\b(?:LLC|Inc|Corp|Ltd|JV|LP)\b/g, '')) ? s : s.replace(/\b(?:THE|INCUMBENT|CONTRACTOR|CURRENT|CONTRACT|IS|PERFORMED|PERFORMING|PROVIDED|OPERATED|SERVICED|BY|AWARDED|AWARD|TO|UNDER|PURSUANT|THROUGH|SINCE|AS|FOR|WHICH|WITH|ON|IN|WHO|HOLDS|HAS|NO)\b/g, (w) => w.toLowerCase());
          const pats = [
            new RegExp(`(?:performed|provided|operated|serviced)\\s+by\\s+${COMPANY.source}(?=\\s+(?:under|pursuant|through|since|as)\\b|,|\\.|\\s*\\()`),
            new RegExp(`incumbent(?:\\s+contractor)?(?:\\s+is|:|,)?\\s+${COMPANY.source}(?=,|\\.|\\s+(?:under|performing|which|who|holds|has)\\b|\\s*\\()`),
            new RegExp(`award(?:ed)?\\b[^.]{0,80}?\\bto\\s+${COMPANY.source}(?=,|\\.|$|\\s+(?:for|under|which|with|on|in|as)\\b)`),
            new RegExp(`^(?:A\\d+\\.\\s*(?:See [^.]+\\.\\s*)?)?${COMPANY.source}(?=,?\\s+(?:under|\\(contract))`),
          ];
          for (const re of pats) {
            const m = sc.match(re);
            const nm = m?.[1]?.trim();
            if (nm && CORP.test(nm) && !/^(?:The|This|Contract|City|District|Government|University|College)\b/.test(nm)) { pa.incumbent = nm.replace(/,$/, '').replace(/(?<!\b(?:Inc|Co|Corp|Ltd))\.$/, ''); touched = true; break; }
          }
        }
        if (!pa.awardYear) { const y = s.match(/\bawarded\b[^.]{0,90}?\b((?:19|20)\d{2})\b/i) ?? s.match(/\b(?:since|in)\s+((?:19|20)\d{2})\b.*\bawarded/i); if (y) { pa.awardYear = Number(y[1]); touched = true; } }
        // a figure stated per month ("$91,240 per month", "the monthly contract amount is $91,240") is not the year's value;
        // one stated per year ("$1,094,880 annually") is
        const amounts = moneyAll(s).filter((a) => !/^\s*(?:\)|,)?\s*(?:per|\/|a|each)\s*(?:month|mo\b|hour|hr|sf|square|day)|^\s*monthly/i.test(a.tail) && !/\bmonthly\b[^$.;]{0,40}$/i.test(s.slice(Math.max(0, a.at - 50), a.at)));
        if (!amounts.length) continue;
        const yearly = amounts.find((a) => /^\s*(?:\)|,)?\s*(?:(?:per|\/|a|each)\s*(?:year|yr|annum)\b|annually\b|yearly\b)/i.test(a.tail) || /\b(?:annual(?:ly)?|yearly|per year)\b[^$.;]{0,30}$/i.test(s.slice(Math.max(0, a.at - 40), a.at)));
        const amt = (yearly ?? amounts[0]).v;
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
