// Calibration guard-rails for the factor library (shared/factors.ts). Each composite must land inside an
// industry benchmark band (APPA custodial staffing levels, ISSA 540 / 612 cleaning times, sports-field and
// mowing production, military full-food-service productivity). The values in comments are the measured
// results before → after the 2026 benchmark recalibration.
//
// Bases:
//   "SF per shift"      = cleanable SF ÷ (custodial hours per service day ÷ 8) — the APPA / NCES basis
//                         (the area one custodian cleans in an 8-h shift on a service day).
//   "SF per 5-day post" = cleanable SF ÷ (annual custodial hours ÷ 2,000) — for less-than-daily service.
//   "SF per FTE"        = cleanable SF ÷ (annual custodial hours ÷ 1,776 productive hours) — the engine's FTE;
//                         = SF per shift × 0.888 for 5-day service, × 0.617 for 7-day service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { heuristicExtract, heuristicPriorAward } from '../server/heuristic';
import { estimateFacility, estimateGrounds, estimateInventory, DEFAULT_ASSUMPTIONS } from '../shared/estimate';
import { CATEGORY_DEFAULTS, FACTORS, GROWING_WEEKS_BY_CLIMATE, factorById } from '../shared/factors';
import { computeTopDown, heuristicAssumptions } from '../shared/topdown';
import type { ClimateZone, Facility, FacilityCategory, GroundsArea, ServiceLevel } from '../shared/types';

const A = DEFAULT_ASSUMPTIONS;
const between = (v: number, lo: number, hi: number, what: string) =>
  assert.ok(v >= lo && v <= hi, `${what}: ${Math.round(v * 100) / 100} not in [${lo}, ${hi}]`);
const rate = (id: string) => {
  const f = factorById(id);
  assert.ok(f, `factor ${id} missing`);
  return f.lhPerUnit;
};

/** 100,000 cleanable SF of one category at one service level, default floor mix and fixtures. */
function custodial(category: FacilityCategory, serviceLevel: ServiceLevel, extra: Partial<Facility> = {}) {
  const csf = 100_000;
  const f: Facility = { id: category, name: category, category, grossSqft: Math.round(csf / CATEGORY_DEFAULTS[category].cleanableShare), cleanableSqft: csf, floors: 1, serviceLevel, scope: ['custodial', 'floor_care'], confidence: 1, ...extra };
  const e = estimateFacility(f, A);
  const annual = e.hoursByCrew.custodial ?? 0;
  const perDay = e.dailyHoursByCrew.custodial ?? 0;
  assert.ok(annual > 0 && perDay > 0, `${category}: no custodial hours`);
  return { e, sfPerShift: csf / (perDay / 8), sfPerPost: csf / (annual / 2000), sfPerFte: csf / (annual / A.productiveHoursPerFte) };
}

test('office, daily 5 days → APPA Level 2 (ordinary tidiness)', () => {
  const r = custodial('admin', 'daily_5');
  // NCES L2 11–18k, APPA L2 ≈18–20k per shift, APPA office L2 16,900, FL DOE 19,000 GSF per FTE
  between(r.sfPerShift, 15_000, 21_000, 'office SF per 8-h shift'); // 9,014 → 17,815
  between(r.sfPerFte, 13_500, 18_500, 'office SF per productive FTE'); // 8,004 → 15,820
});

test('barracks common areas, daily 7 days → APPA Level 2, restroom-heavy', () => {
  between(custodial('barracks', 'daily_7').sfPerShift, 10_000, 18_000, 'barracks (default fixtures) SF per shift'); // 7,073 → 11,847
  // the sample's common-area exhibit density: 2.2 fixtures per 1,000 SF cleanable
  between(custodial('barracks', 'daily_7', { restroomFixtures: 222 }).sfPerShift, 11_000, 18_000, 'barracks (2.2 fx/MSF) SF per shift'); // 7,635 → 13,514
});

test('clinic, daily 7 days → APPA Level 1–2, above the hospital EVS floor', () => {
  const r = custodial('medical', 'daily_7');
  // hospital EVS ≈1,300 SF per worked hour ≈ 10,400 per shift is the floor for an outpatient clinic
  between(r.sfPerShift, 10_000, 15_000, 'clinic SF per shift'); // 7,872 → 12,441
  assert.ok(r.e.lines.some((l) => l.factorId === 'cust_med_disinfect'), 'medical disinfection line missing');
  assert.ok(!custodial('admin', 'daily_5').e.lines.some((l) => l.factorId === 'cust_med_disinfect'), 'disinfection line is medical-only');
});

test('warehouse, 2x per week → APPA Level 4–5 on an annual-post basis', () => {
  const r = custodial('warehouse', '2x_week');
  between(r.sfPerPost, 40_000, 90_000, 'warehouse SF per 5-day post'); // 40,181 → 63,341
  between(r.sfPerShift, 20_000, 40_000, 'warehouse SF per visit-shift'); // 16,072 → 25,337
});

test('custodial intensity ordering: clinic and barracks below office, office below warehouse', () => {
  const s = (c: FacilityCategory, l: ServiceLevel) => custodial(c, l).sfPerShift;
  assert.ok(s('medical', 'daily_7') < s('admin', 'daily_5'), 'clinic should be more labor-intensive than office');
  assert.ok(s('barracks', 'daily_7') < s('admin', 'daily_5'), 'barracks should be more labor-intensive than office');
  assert.ok(s('admin', 'daily_5') < s('warehouse', '2x_week'), 'warehouse visit should cover more area than an office shift');
});

test('restroom fixture time is 3–6 min (ISSA baseline 3 min; APPA Level 2 above it)', () => {
  between(rate('cust_restroom') * 60, 3, 6, 'min per fixture'); // 4.5
});

test('floor care: 100k SF VCT and 100k SF carpet annual hours and task rates', () => {
  const base: Facility = { id: 'v', name: 'v', category: 'admin', grossSqft: 100_000, cleanableSqft: 100_000, floors: 1, serviceLevel: 'daily_5', scope: ['floor_care'], confidence: 1 };
  const vct = estimateFacility({ ...base, floorMix: { carpet: 0, resilient: 1, hardTile: 0, concrete: 0, wood: 0 } }, A);
  between(vct.totalHours, 1_200, 2_400, 'VCT floor-care hours / 100k SF / yr'); // 2,010 (unchanged)
  between(1000 / rate('fc_strip_wax'), 100, 333, 'strip & refinish SF/h'); // 154: CRI LCC 100–125, Imperial Dade ≈150, field ≈333
  // spray buff with a 17" high-speed machine: 2,000–3,000 SF/h (janitorialstore.com floor-care production rates).
  // ISSA 540's 10,000 SF/h (6 min/MSF) is a 20" 2000-rpm dry burnish, a different task, and is not this line's band.
  between(1000 / rate('fc_spraybuff'), 2_000, 3_000, 'high-speed spray buff SF/h'); // 2,500 (unchanged)
  const cpt = estimateFacility({ ...base, floorMix: { carpet: 1, resilient: 0, hardTile: 0, concrete: 0, wood: 0 } }, A);
  between(cpt.totalHours, 400, 900, 'carpet floor-care hours / 100k SF / yr'); // 720 → 640
  between(1000 / rate('fc_carpet_extract'), 600, 1_500, 'hot-water extraction SF/h'); // 556 → 714 (CMM portable / truckmount wand)
});

test('grounds: acres per FTE for improved turf, athletic and semi-improved hours per acre (30-week season)', () => {
  const a = { ...A, growingSeasonWeeks: 30, climateZone: 'temperate' as const };
  const g = (kind: GroundsArea['kind']) => estimateGrounds({ id: kind, name: kind, kind, quantity: 100, unit: 'acres', confidence: 1 }, a);
  // AS&U K-12 30–47 acres per grounds employee; APPA L4–L5 22–43 whole-campus
  between(100 / (g('improved_turf').totalHours / A.productiveHoursPerFte), 30, 50, 'improved turf acres per FTE'); // 38.1 → 42.2
  between(1 / rate('gr_mow_improved'), 1.8, 3.0, '72" zero-turn acres/h'); // 1.67 → 2.22 (Cornell 60" ≈ 2 ac/h; Exmark 80% formula)
  // SFMA ≈250 h per native-soil field-year (≈125–140 h/acre for a 1.8–2-acre field) to ≈415 h heavy use (≈210–230 h/acre)
  between(g('athletic_field').totalHours / 100, 125, 230, 'athletic field h/acre/yr at 30 weeks'); // 86.5 → 130.5
  assert.ok(g('athletic_field').lines.some((l) => l.factorId === 'gr_athletic_cultural'), 'athletic cultural-practices line missing');
  between(g('semi_improved').totalHours / 100, 1, 4, 'semi-improved h/acre/yr'); // 1.8
  between(1 / rate('gr_mow_unimproved'), 4, 7.3, 'rotary cutter acres/h per pass'); // 8.3 → 6.7 (Exmark 15-ft at 5 mph, 80% = 7.3)
});

test('athletic fields at each climate default season stay inside the SFMA band scaled by season length', () => {
  // The SFMA field-year band (125–230 h/acre) is quoted at the temperate 30-week season. A shorter season can cut a
  // field-year at most in proportion to its length, a longer one raise it at most in proportion; so the band at w weeks
  // is [125 × min(1, w/30), 230 × max(1, w/30)]. estimateInventory picks the climate's default season automatically.
  const perAcre: Record<string, number> = {};
  for (const [zone, weeks] of Object.entries(GROWING_WEEKS_BY_CLIMATE) as [ClimateZone, number][]) {
    const est = estimateInventory({ site: { climateZone: zone }, facilities: [], grounds: [{ id: 'af', name: 'fields', kind: 'athletic_field', quantity: 14, unit: 'acres', confidence: 1 }] });
    perAcre[zone] = est.directHours / 14;
    between(perAcre[zone], 125 * Math.min(1, weeks / 30), 230 * Math.max(1, weeks / 30), `${zone} (${weeks} wk) athletic h/acre/yr`);
  } // cold 108.7, temperate 130.5, arid 145.1, hot_humid 166.9
  assert.ok(perAcre.cold < perAcre.temperate && perAcre.temperate < perAcre.arid && perAcre.arid < perAcre.hot_humid, 'athletic hours follow season length');
});

test('snow: walks and lots per event', () => {
  const a = { ...A, snowEventsPerYear: 1 };
  const walk = estimateGrounds({ id: 'w', name: 'w', kind: 'sidewalk', quantity: 100_000, unit: 'sqft', confidence: 1 }, a).lines.find((l) => l.factorId === 'gr_snow_walk');
  assert.ok(walk, 'walk snow line missing');
  between(walk.annualHours, 20, 80, 'walk snow lh per event per 100k SF'); // 45 (shovel 1,250 SF/h … blower ≈5,000 SF/h)
  const lot = estimateGrounds({ id: 'p', name: 'p', kind: 'parking', quantity: 435_600, unit: 'sqft', confidence: 1 }, a).lines.find((l) => l.factorId === 'gr_snow_lot');
  assert.ok(lot, 'lot plowing line missing');
  between(lot.annualHours, 5, 20, 'lot plowing lh per event per 10 acres'); // 15.2 (SIMA 0.5–1.9 ac/h)
});

test('dining: full food service 6–9 meals per labor-hour; DFA-only 12–22', () => {
  const dfac = (serviceStyle: 'full_food_service' | 'dining_facility_attendant', mealPeriods = 3) => {
    const f: Facility = { id: 'd', name: 'd', category: 'dining', grossSqft: 25_000, floors: 1, serviceLevel: 'daily_7', scope: ['dining'], confidence: 1, dining: { mealsPerDay: 2000, mealPeriods, daysPerWeek: 7, kitchenSqft: 9_000, diningRoomSqft: 11_000, serviceStyle } };
    return (2000 * 364) / estimateFacility(f, A).totalHours;
  };
  const ffs = dfac('full_food_service');
  const dfa = dfac('dining_facility_attendant');
  // Fort Hood ≈8.3, Fort Leonard Wood ≈7.1, Keesler / NAS Meridian ≈5.8 meals per productive labor-hour
  between(ffs, 6, 9, 'FFS meals per labor-hour'); // 8.15 → 7.77
  between(dfac('full_food_service', 4), 6, 9, 'FFS (4 meal periods) meals per labor-hour'); // 7.97 → 7.61
  between(dfa, 12, 22, 'DFA meals per labor-hour'); // 16.89
  assert.ok(dfa > 1.8 * ffs, 'DFA-only labor should be well under half of full food service');
});

test('every recalibrated or new line carries a benchmark basis', () => {
  const calibrated = [
    'cust_trash', 'cust_vacuum_lanes', 'cust_vacuum_full', 'cust_dustmop', 'cust_dampmop', 'cust_spot', 'cust_entrance', 'cust_kitchenette', 'cust_med_disinfect',
    'fc_spraybuff', 'fc_tile_scrub', 'fc_carpet_extract', 'gr_mow_improved', 'gr_athletic_prep', 'gr_athletic_cultural', 'gr_mow_unimproved', 'dn_serve',
  ];
  for (const id of calibrated) assert.ok((factorById(id)?.basis ?? '').length > 20, `${id} has no basis`);
  assert.equal(new Set(FACTORS.map((f) => f.id)).size, FACTORS.length, 'duplicate factor id');
  for (const f of FACTORS) assert.ok(f.lhPerUnit > 0 && Number.isFinite(f.lhPerUnit), `${f.id} rate`);
});

test('built-in sample: total FTE, custodial SF per FTE and top-down agreement', () => {
  const text = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../samples/sample-rfp-pws.txt'), 'utf8');
  const docs = [{ name: 'sample-rfp-pws.txt', mode: 'text' as const, text, chars: text.length, bytes: text.length }];
  const est = estimateInventory(heuristicExtract(docs));
  between(est.totalFte, 105, 135, 'sample total FTE'); // 145.7 → 120.7
  const cust = est.crews.find((c) => c.crew === 'custodial');
  assert.ok(cust, 'no custodial crew');
  const csf = est.facilities.filter((f) => f.resolved.category !== 'dining').reduce((s, f) => s + f.resolved.cleanableSqft, 0);
  between(csf / cust.fte, 11_000, 17_000, 'sample SF per custodial FTE'); // 7,377 → 13,407 (Level 2 mix)
  const pa = heuristicPriorAward(docs);
  assert.ok(pa, 'sample prior award not found');
  const td = computeTopDown(pa, heuristicAssumptions(est, pa), est, { rationale: '', risks: [], provider: 'heuristic' });
  assert.ok(td.deltaPct != null, 'no top-down delta');
  between(td.deltaPct, -0.2, 0.2, 'bottom-up vs incumbent-implied FTE'); // +30.5% → +9.0%
});
