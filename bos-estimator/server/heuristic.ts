// Rule-based fallback extractor. Used when no ANTHROPIC_API_KEY is configured, when the user picks the
// rule-based parser, or when the AI call fails — so the workbench still produces an inventory from
// reasonably structured workload tables (pipe / tab / multi-space delimited rows).
import type { Facility, FacilityCategory, GroundsArea, GroundsKind, GroundsUnit, Inventory, PriorAward, ServiceLevel, SiteInfo } from '../shared/types';
import type { DocInput } from './extract';

const num = (s: string) => parseFloat(String(s).replace(/[,\s]/g, ''));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const BLDG_RE = /\b(?:bldgs?|buildings?|bld|facility|fac)\.?\s*#?\s*([0-9]{1,5}[A-Z]?)\b/i;
const BLDG_LIST_RE = /\b(?:bldgs?|buildings?)\.?\s*#?\s*((?:[0-9]{1,5}[A-Z]?)(?:\s*(?:,|and|&)\s*(?:[0-9]{1,5}[A-Z]?))*)/gi;

export function categorize(name: string): FacilityCategory {
  const n = ` ${name.toLowerCase()} `;
  if (/dining|dfac|mess hall|galley|cafeteria|food service|restaurant/.test(n)) return 'dining';
  if (/barracks|dormitor|\bdorm\b|bachelor|\bquarters\b|billet|lodging|\buph\b|\bbeq\b|\bboq\b/.test(n)) return 'barracks';
  if (/clinic|medical|dental|hospital|\bhealth\b|pharmacy/.test(n)) return 'medical';
  if (/hangar/.test(n)) return 'hangar';
  if (/warehouse|supply|storage|depot|\bcif\b|logistic|issue facility/.test(n)) return 'warehouse';
  if (/motor pool|maintenance|\bshop\b|vehicle|\btmp\b|\bdol\b|repair|wash rack/.test(n)) return 'maintenance';
  if (/\bgym\b|fitness|physical|\bpool\b|sports|athletic|aquatic/.test(n)) return 'fitness';
  if (/child|\bcdc\b|youth|daycare|day care|school age/.test(n)) return 'child_care';
  if (/chapel|religious|community|\bmwr\b|\bclub\b|recreation|theater|bowling|exchange|commissary|museum|arts and crafts/.test(n)) return 'community';
  if (/school|education|training|classroom|academy|learning|library/.test(n)) return 'education';
  if (/\blab\b|laborator|research|simulat|range control|test facility/.test(n)) return 'lab';
  if (/headquarters|\bhq\b|admin|office|command|brigade|battalion|center|annex|operations|\bops\b|finance|personnel|legal|\bjag\b|post office|police|fire station|security|visitor|service center/.test(n)) return 'admin';
  return 'other';
}

const serviceFromText = (s: string): ServiceLevel | undefined => {
  const t = s.toLowerCase();
  if (/7\s*days|daily\s*\(7|seven days|\b7x\b|7\/wk/.test(t)) return 'daily_7';
  if (/5\s*days|daily|m-f|mon(day)?\s*[-–]\s*fri|\b5x\b|5\/wk/.test(t)) return 'daily_5';
  if (/\b3x\b|three times|3 times|3\/wk|3 days|tri-?weekly/.test(t)) return '3x_week';
  if (/\b2x\b|twice|2 times|2\/wk|2 days|bi-?weekly/.test(t)) return '2x_week';
  if (/weekly|\b1x\b|once a week|1\/wk/.test(t)) return 'weekly';
  return undefined;
};

interface ColMap { number?: number; name?: number; use?: number; floors?: number; gross?: number; cleanable?: number; fixtures?: number; freq?: number }

function splitCells(line: string): string[] {
  const sep = line.includes('|') ? /\s*\|\s*/ : line.includes('\t') ? /\t+/ : /\s{3,}/;
  return line.split(sep).map((c) => c.trim()).filter((c, i, arr) => !(c === '' && (i === 0 || i === arr.length - 1)));
}

function headerMap(cells: string[]): ColMap | null {
  const m: ColMap = {};
  cells.forEach((c, i) => {
    const h = c.toLowerCase();
    if (m.number == null && /(bldg|building|facility)\s*(no|#|number|id)|^(bldg|building|fac(ility)?)\.?$|^no\.?$|^number$/.test(h)) m.number = i;
    else if (m.name == null && /name|description|facility$|^building$/.test(h)) m.name = i;
    else if (m.use == null && /^(use|type|category|cat|function|occupancy type)$/.test(h)) m.use = i;
    else if (m.floors == null && /floors?|stories|levels/.test(h)) m.floors = i;
    else if (m.cleanable == null && /cleanable|csf|serviced|net/.test(h) && /sf|sq|area|ft/.test(h + ' sf')) m.cleanable = i;
    else if (m.gross == null && /gross|gsf|^sf$|sq\.?\s*ft|square\s*f|area|ft²/.test(h)) m.gross = i;
    else if (m.fixtures == null && /fixture/.test(h)) m.fixtures = i;
    else if (m.freq == null && /freq|frequency|service level|schedule|days/.test(h)) m.freq = i;
  });
  return m.gross != null && (m.name != null || m.number != null) ? m : null;
}

export function heuristicExtract(docs: DocInput[]): Inventory {
  const facilities = new Map<string, Facility>();
  const grounds: GroundsArea[] = [];
  const site: SiteInfo = {};
  let gIdx = 0;

  for (const doc of docs) {
    const text = doc.text;
    const sol = text.match(/\b([A-Z0-9]{5,8}-\d{2}-[RQ]-\d{4})\b/);
    if (sol && !site.solicitation) site.solicitation = sol[1];
    const inst = text.match(/\b(Fort [A-Z][a-z]+(?: [A-Z][a-z]+)?|Camp [A-Z][a-z]+|Naval (?:Air )?Station [A-Z][a-z]+(?: [A-Z][a-z]+)?|[A-Z][a-z]+ Air Force Base|Marine Corps Base [A-Z][a-z]+|Joint Base [A-Z][a-z]+(?:[- ][A-Z][a-z]+)*)\b/);
    if (inst && !site.installationName) site.installationName = inst[1];
    const loc = text.match(/\b(?:Fort|Camp|Base|Station)\s+[A-Z][a-z]+,\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?|[A-Z]{2})\b/);
    if (loc && !site.location) site.location = `${site.installationName ?? ''}, ${loc[1]}`.replace(/^, /, '');
    const yrs = text.match(/base (?:year|period)[^.]{0,80}?\b(one|two|three|four|five|six|seven|eight|nine|\d)\b\s*(?:\(\d\))?\s*(?:one-year |1-year |12-month )?option/i);
    if (yrs) { const map: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }; const n = map[yrs[1].toLowerCase()] ?? parseInt(yrs[1]); if (n) site.contractYears = 1 + n; }
    const climate = text.match(/\b(humid subtropical|hot[- ]humid|arid|desert|cold climate|heavy snow|temperate)\b/i);
    if (climate && !site.climateZone) { const c = climate[1].toLowerCase(); site.climateZone = /humid|subtropical/.test(c) ? 'hot_humid' : /arid|desert/.test(c) ? 'arid' : /cold|snow/.test(c) ? 'cold' : 'temperate'; }
    const gs = text.match(/growing season[^.\n]{0,40}?(\d{2})\s*weeks/i);
    if (gs) site.growingSeasonWeeks = parseInt(gs[1]);

    let cols: ColMap | null = null;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const cells = splitCells(line);

      // ---- header detection for workload tables
      if (cells.length >= 3) {
        const hm = headerMap(cells);
        if (hm && !/\d{3,}/.test(line)) { cols = hm; continue; }
      }

      // ---- facility rows (table-aware first, regex fallback second)
      let number: string | undefined; let name: string | undefined; let use = ''; let gross = NaN; let cleanable: number | undefined; let floors = 0; let fixtures: number | undefined; let freq: ServiceLevel | undefined;
      if (cols && cells.length >= 3) {
        const g = cols.gross != null ? cells[cols.gross] : undefined;
        if (g && /\d/.test(g)) {
          gross = num(g.replace(/[^\d.,]/g, ''));
          number = cols.number != null ? cells[cols.number]?.replace(BLDG_RE, '$1').replace(/[^0-9A-Za-z-]/g, '') : undefined;
          name = cols.name != null ? cells[cols.name] : undefined;
          use = cols.use != null ? cells[cols.use] ?? '' : '';
          if (cols.cleanable != null && cells[cols.cleanable]) cleanable = num(cells[cols.cleanable].replace(/[^\d.,]/g, '')) || undefined;
          if (cols.floors != null && cells[cols.floors]) floors = parseInt(cells[cols.floors]) || 0;
          if (cols.fixtures != null && cells[cols.fixtures]) fixtures = parseInt(cells[cols.fixtures].replace(/[^\d]/g, '')) || undefined;
          if (cols.freq != null && cells[cols.freq]) freq = serviceFromText(cells[cols.freq]);
        }
      }
      if (!isFinite(gross) || gross <= 0) {
        const b = line.match(BLDG_RE) || line.match(/^\|?\s*([0-9]{3,5}[A-Z]?)\s*[|\t]/);
        const sf = [...line.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,7})(?:\.\d+)?\s*(?:gsf|csf|sf|s\.f\.|sq\.?\s*ft\.?|square\s*feet|ft²)\b/gi)].map((m) => num(m[1]));
        if (b && sf.length) {
          number = b[1];
          gross = Math.max(...sf);
          if (sf.length > 1 && Math.min(...sf) < gross) cleanable = Math.min(...sf);
          name = cells.find((c) => !/^\d/.test(c) && !BLDG_RE.test(c) && c.length > 3 && !/\b(sf|sq|gsf)\b/i.test(c) && !/^(daily|weekly|\dx)/i.test(c));
          const fl = line.match(/\b(\d)\s*(?:-?\s*(?:stories|story|floors?|fl|levels?))\b/i); if (fl) floors = parseInt(fl[1]);
          const fx = line.match(/(\d{1,3})\s*(?:fixtures|fixt)/i); if (fx) fixtures = parseInt(fx[1]);
          freq = serviceFromText(line);
        }
      }
      if (isFinite(gross) && gross > 0 && (number || name)) {
        const nm = (name && name.length > 2 ? name : `Building ${number}`).replace(/\s+/g, ' ').slice(0, 90);
        const id = `b-${slug(number || nm)}`;
        const existing = facilities.get(id);
        let category = categorize(`${nm} ${use}`);
        if (category === 'other' && use) category = categorize(use);
        const f: Facility = {
          id, buildingNumber: number || undefined, name: nm, category, grossSqft: gross, cleanableSqft: cleanable, floors: floors || existing?.floors || 0,
          restroomFixtures: fixtures ?? existing?.restroomFixtures, serviceLevel: freq ?? existing?.serviceLevel ?? (category === 'dining' || category === 'barracks' || category === 'medical' || category === 'fitness' ? 'daily_7' : 'daily_5'),
          scope: category === 'dining' ? ['custodial', 'floor_care', 'dining'] : ['custodial', 'floor_care'],
          confidence: cols ? 0.7 : 0.55, source: { file: doc.name, excerpt: line.slice(0, 200) },
        };
        facilities.set(id, existing ? { ...existing, ...f, dining: existing.dining } : f);
        continue;
      }

      // ---- grounds rows
      const acres = line.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:acres?|ac\.?)\b[^\n]*?(improved|semi[- ]improved|unimproved|athletic|turf|lawn)/i) || line.match(/(improved|semi[- ]improved|unimproved|athletic)[^\n]*?(\d[\d,]*(?:\.\d+)?)\s*(?:acres?|ac\.?)\b/i);
      if (acres) {
        const qty = num(/^\d/.test(acres[1]) ? acres[1] : acres[2]);
        const kindWord = (/^\d/.test(acres[1]) ? acres[2] : acres[1]).toLowerCase();
        const kind: GroundsKind = /semi/.test(kindWord) ? 'semi_improved' : /unimproved/.test(kindWord) ? 'unimproved' : /athletic/.test(kindWord) ? 'athletic_field' : 'improved_turf';
        if (!/\btotal\b/i.test(line)) pushGrounds(kind, qty, 'acres', line, doc.name);
        continue;
      }
      const paved = line.match(/(\d[\d,]*)\s*(sf|sy|sq\.?\s*(?:ft|yd)|square (?:feet|yards))\b[^\n]*?(parking|sidewalk|walkway|walks|pavement)/i) || line.match(/(parking|sidewalk|walkway|walks)[^\n]*?(\d[\d,]*)\s*(sf|sy|sq\.?\s*(?:ft|yd)|square (?:feet|yards))\b/i);
      if (paved) {
        const qtyStr = /^\d/.test(paved[1]) ? paved[1] : paved[2];
        const unitStr = (/^\d/.test(paved[1]) ? paved[2] : paved[3]).toLowerCase();
        const kindStr = (/^\d/.test(paved[1]) ? paved[3] : paved[1]).toLowerCase();
        pushGrounds(/park/.test(kindStr) ? 'parking' : 'sidewalk', num(qtyStr), /sy|yd|yard/.test(unitStr) ? 'sqyd' : 'sqft', line, doc.name);
        continue;
      }
      const beds = line.match(/(\d[\d,]*)\s*(sf|sy|sq\.?\s*(?:ft|yd))\b[^\n]*?(shrub|planting|flower|bed|mulch)/i) || line.match(/(shrub|planting|flower)[^\n]*?(\d[\d,]*)\s*(sf|sy|sq\.?\s*(?:ft|yd))\b/i);
      if (beds) { const q = /^\d/.test(beds[1]) ? beds[1] : beds[2]; const u = (/^\d/.test(beds[1]) ? beds[2] : beds[3]).toLowerCase(); pushGrounds('shrub_bed', num(q), /sy|yd/.test(u) ? 'sqyd' : 'sqft', line, doc.name); continue; }
      const trees = line.match(/(\d[\d,]*)\s*(?:ornamental |shade |street )?trees\b/i);
      if (trees) { pushGrounds('tree_canopy', num(trees[1]), 'each', line, doc.name); continue; }

      // ---- dining
      const meals = line.match(/(\d[\d,]*)\s*(?:meals?|headcount|patrons?|rations?)\s*(?:per|a|\/|each)\s*day/i);
      if (meals) {
        const target = [...facilities.values()].find((f) => f.category === 'dining') ?? [...facilities.values()].find((f) => BLDG_RE.test(line) && f.buildingNumber === line.match(BLDG_RE)![1]);
        const seats = text.match(/(?:seating capacity (?:is|of)|capacity of)\s*(\d[\d,]*)\s*(?:seats?)?|(\d[\d,]*)\s*seats?/i);
        const periods = /four meal|4 meal|midnight meal/i.test(text) ? 4 : 3;
        const kitchen = text.match(/kitchen[^.\n]{0,60}?(\d[\d,]*)\s*sf/i);
        const dining = text.match(/dining room[^.\n]{0,60}?(\d[\d,]*)\s*sf/i);
        const style = /attendant[- ]only|dfa only|dining facility attendant services? only/i.test(text) ? 'dining_facility_attendant' : /management only/i.test(text) ? 'management_only' : 'full_food_service';
        const profile = { mealsPerDay: num(meals[1]), mealPeriods: periods, daysPerWeek: /365 days|seven days|7 days/i.test(text) ? 7 : 7, seats: seats ? num(seats[1] ?? seats[2]) : undefined, kitchenSqft: kitchen ? num(kitchen[1]) : undefined, diningRoomSqft: dining ? num(dining[1]) : undefined, serviceStyle: style as NonNullable<Facility['dining']>['serviceStyle'] };
        if (target) { target.dining = profile; if (!target.scope.includes('dining')) target.scope.push('dining'); }
        else facilities.set('b-dining-facility', { id: 'b-dining-facility', name: 'Dining Facility', category: 'dining', grossSqft: (profile.kitchenSqft ?? 0) + (profile.diningRoomSqft ?? 0), floors: 1, serviceLevel: 'daily_7', scope: ['dining'], dining: profile, confidence: 0.4, source: { file: doc.name, excerpt: line.slice(0, 200) }, notes: 'Dining headcount found but no facility row; verify square footage.' });
      }
    }
  }

  function pushGrounds(kind: GroundsKind, quantity: number, unit: GroundsUnit, line: string, file: string) {
    if (!isFinite(quantity) || quantity <= 0) return;
    const ids: string[] = [];
    for (const m of line.matchAll(BLDG_LIST_RE)) for (const n of m[1].split(/\s*(?:,|and|&)\s*/)) if (n) ids.push(`b-${slug(n)}`);
    const known = [...new Set(ids)].filter((id) => facilities.has(id));
    const targets = known.length ? known : [undefined];
    const share = quantity / targets.length;
    for (const facilityId of targets) {
      if (grounds.some((g) => g.kind === kind && Math.abs(g.quantity - share) < 1e-6 && g.unit === unit && g.facilityId === facilityId)) continue;
      gIdx += 1;
      const f = facilityId ? facilities.get(facilityId) : undefined;
      grounds.push({ id: `g-${gIdx}-${kind}`, name: `${labelKind(kind)}${f ? ` — Bldg ${f.buildingNumber ?? f.name}` : ''}`, facilityId, kind, quantity: Math.round(share * 1000) / 1000, unit, confidence: 0.55, source: { file, excerpt: line.slice(0, 200) }, notes: targets.length > 1 ? `Split evenly across ${targets.length} buildings from a shared quantity of ${quantity.toLocaleString()} ${unit}.` : undefined });
    }
  }

  return { site, facilities: [...facilities.values()], grounds };
}

function labelKind(k: GroundsKind) {
  return ({ improved_turf: 'Improved turf', semi_improved: 'Semi-improved grounds', unimproved: 'Unimproved grounds', athletic_field: 'Athletic fields', shrub_bed: 'Shrub beds', parking: 'Parking', sidewalk: 'Sidewalks', tree_canopy: 'Trees' } as Record<GroundsKind, string>)[k];
}

const money = (s: string) => { const m = s.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(million|m|billion|b|k|thousand)?/i); if (!m) return undefined; let v = parseFloat(m[1].replace(/,/g, '')); const u = (m[2] ?? '').toLowerCase(); if (u.startsWith('m')) v *= 1e6; else if (u.startsWith('b')) v *= 1e9; else if (u === 'k' || u === 'thousand') v *= 1e3; return isFinite(v) ? v : undefined; };

/** Pull incumbent / previous-award facts out of free text (cover letters, Q&A, "current contract" paragraphs). */
export function heuristicPriorAward(docs: DocInput[]): PriorAward | undefined {
  let out: PriorAward | undefined;
  for (const doc of docs) {
    const sentences = doc.text.split(/(?<=[.!?])\s+|\n+/);
    for (const sRaw of sentences) {
      const s = sRaw.trim();
      if (!/incumbent|current contract|previous contract|existing contract|predecessor|prior contract|currently performed|under contract|awarded|obligat|contract value|ceiling|total value/i.test(s)) continue;
      const pa: PriorAward = out ?? { confidence: 0.5 };
      const cn = s.match(/\b([A-Z0-9]{5,8}-\d{2}-[CDFP]-\d{4})\b/); if (cn) pa.contractNumber = cn[1];
      const inc = s.match(/incumbent(?: contractor)?(?: is|,)?\s+([A-Z][\w&.,' -]{2,60}?)(?:,|\.|\s+under|\s+was|\s+holds|\s+\()/) || s.match(/award(?:ed)?\s+(?:in\s+\w+\s+\d{4}\s+|on\s+[\w ,]+\d{4}\s+)?to\s+([A-Z][\w&.' -]*(?:,\s*(?:LLC|Inc\.?|Corp\.?|Co\.?|LP|JV))?)(?=,\s+a\b|\.|\s+under|\s+for|\s+with|,)/); if (inc && !pa.incumbent) pa.incumbent = inc[1].trim();
      const yr = s.match(/(?:awarded|award|since)\s+(?:in\s+|on\s+)?(?:\w+\s+){0,2}(20\d{2})/i); if (yr) pa.awardYear = parseInt(yr[1]);
      const months = s.match(/(\d{1,3})[- ]month/i); const years = s.match(/(\d{1,2})[- ]year|(?:base|one)\s+(?:year|period)[^.]{0,40}?(four|three|two|one|\d)\s+(?:one-year\s+)?option/i);
      const amt = money(s);
      if (amt) {
        if (/per (?:year|annum)|annual(?:ly)?|a year|\/yr/i.test(s) && !/total/i.test(s)) pa.annualValue = amt;
        else if (/obligat|spent|invoiced|expended|to date|through fy/i.test(s)) {
          pa.spendToDate = amt;
          const ord = s.match(/\b(first|second|third|fourth|fifth|sixth|\d)(?:st|nd|rd|th)?\s+(?:performance\s+|contract\s+|option\s+)?year/i);
          const ordN: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };
          if (months) pa.spendPeriodMonths = parseInt(months[1]); else if (ord) pa.spendPeriodMonths = (ordN[ord[1].toLowerCase()] ?? parseInt(ord[1])) * 12;
        }
        else { pa.totalValue = amt; if (months) pa.periodMonths = parseInt(months[1]); else if (years) { const w: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }; const n = years[1] ? parseInt(years[1]) : 1 + (w[years[2]?.toLowerCase()] ?? parseInt(years[2]) ?? 4); pa.periodMonths = n * 12; } }
      }
      if (pa.contractNumber || pa.incumbent || pa.totalValue || pa.annualValue || pa.spendToDate) {
        pa.source = pa.source ?? { file: doc.name, excerpt: s.slice(0, 220) };
        if (!(pa.source.excerpt ?? '').includes(s.slice(0, 40)) && (amt || cn)) pa.source = { file: doc.name, excerpt: s.slice(0, 220) };
        out = pa;
      }
    }
  }
  if (out && out.spendToDate && !out.spendPeriodMonths && out.awardYear) out.spendPeriodMonths = Math.max(12, Math.min(out.periodMonths ?? 60, (new Date().getFullYear() - out.awardYear) * 12));
  return out;
}
