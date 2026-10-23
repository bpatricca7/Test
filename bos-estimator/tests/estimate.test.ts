import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { heuristicExtract } from '../server/heuristic';
import { diningMealsPerDay, estimateFacility, estimateGrounds, estimateInventory, mealsPerDayFromPeriods, resolveDining, resolveMealsPerDay, ACRES_PER_HECTARE, SQFT_PER_SQM, DEFAULT_ASSUMPTIONS } from '../shared/estimate';
import { diningMealsPerDay as readerDiningMealsPerDay } from '../server/toolcalls';
import { FACTORS, factorById } from '../shared/factors';
import type { Facility, GroundsArea, Inventory, MealPeriodHeadcount, ServiceLevel } from '../shared/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = fs.readFileSync(path.resolve(here, '../samples/sample-rfp-pws.txt'), 'utf8');

test('heuristic parser reads the sample workload tables', () => {
  const inv = heuristicExtract([{ name: 'sample.txt', mode: 'text', text: sample, chars: sample.length, bytes: sample.length }]);
  assert.equal(inv.facilities.length, 16);
  const hq = inv.facilities.find((f) => f.buildingNumber === '1201')!;
  assert.equal(hq.grossSqft, 45200);
  assert.equal(hq.cleanableSqft, 38400);
  assert.equal(hq.floors, 2);
  assert.equal(hq.restroomFixtures, 24);
  assert.equal(hq.category, 'admin');
  assert.equal(hq.serviceLevel, 'daily_5');
  const dfac = inv.facilities.find((f) => f.category === 'dining')!;
  assert.equal(dfac.dining?.mealsPerDay, 2650);
  assert.equal(dfac.dining?.mealPeriods, 4);
  assert.ok(inv.grounds.some((g) => g.kind === 'unimproved' && g.quantity === 640));
  assert.ok(inv.grounds.some((g) => g.kind === 'parking' && g.quantity === 1_420_000));
  assert.equal(inv.site.contractYears, 5);
  assert.equal(inv.site.climateZone, 'temperate');
});

test('facility estimate scales linearly with cleanable area', () => {
  const base: Facility = { id: 'a', name: 'A', category: 'admin', grossSqft: 10000, cleanableSqft: 10000, floors: 1, restroomFixtures: 10, serviceLevel: 'daily_5', scope: ['custodial', 'floor_care'], confidence: 1 };
  const small = estimateFacility(base, DEFAULT_ASSUMPTIONS);
  const big = estimateFacility({ ...base, cleanableSqft: 20000, restroomFixtures: 20 }, DEFAULT_ASSUMPTIONS);
  assert.ok(small.totalHours > 0);
  assert.ok(Math.abs(big.totalHours / small.totalHours - 2) < 0.01);
  assert.ok(small.lines.every((l) => FACTORS.some((f) => f.id === l.factorId)));
});

test('factor overrides change the hours', () => {
  const f: Facility = { id: 'a', name: 'A', category: 'admin', grossSqft: 10000, floors: 1, serviceLevel: 'daily_5', scope: ['custodial'], confidence: 1 };
  const a = estimateFacility(f, DEFAULT_ASSUMPTIONS);
  const b = estimateFacility(f, DEFAULT_ASSUMPTIONS, { cust_trash: factorById('cust_trash')!.lhPerUnit * 2 });
  const la = a.lines.find((l) => l.factorId === 'cust_trash')!; const lb = b.lines.find((l) => l.factorId === 'cust_trash')!;
  assert.ok(Math.abs(lb.annualHours / la.annualHours - 2) < 0.01);
});

test('grounds mowing follows growing season, snow follows climate', () => {
  const turf: GroundsArea = { id: 'g', name: 'turf', kind: 'improved_turf', quantity: 10, unit: 'acres', confidence: 1 };
  const temperate = estimateGrounds(turf, { ...DEFAULT_ASSUMPTIONS, growingSeasonWeeks: 30 });
  const hot = estimateGrounds(turf, { ...DEFAULT_ASSUMPTIONS, growingSeasonWeeks: 40 });
  const mowT = temperate.lines.find((l) => l.factorId === 'gr_mow_improved')!; const mowH = hot.lines.find((l) => l.factorId === 'gr_mow_improved')!;
  assert.equal(mowT.frequencyPerYear, 30); assert.equal(mowH.frequencyPerYear, 40);
  const walk: GroundsArea = { id: 'w', name: 'walks', kind: 'sidewalk', quantity: 100000, unit: 'sqft', confidence: 1 };
  const noSnow = estimateGrounds(walk, { ...DEFAULT_ASSUMPTIONS, snowEventsPerYear: 0 });
  assert.ok(!noSnow.lines.some((l) => l.factorId === 'gr_snow_walk'));
});

test('dining facility produces meal-driven hours and manning by year escalates cost only', () => {
  const inv = heuristicExtract([{ name: 's', mode: 'text', text: sample, chars: sample.length, bytes: sample.length }]);
  const est = estimateInventory(inv, { contractYears: 3, wageEscalationPerYear: 0.1, workloadGrowthPerYear: 0 });
  const dfac = est.facilities.find((f) => f.resolved.category === 'dining')!;
  assert.ok(dfac.lines.some((l) => l.factorId === 'dn_prep' && l.quantity === 2650 * 364));
  assert.equal(est.years.length, 3);
  assert.equal(est.years[0].fte, est.years[2].fte);
  assert.ok(est.years[2].laborCost > est.years[0].laborCost * 1.2);
  // recalibrated library (APPA Level 2 custodial): 120.7 FTE; the pre-calibration library gave 145.7
  assert.ok(est.totalFte >= 105 && est.totalFte <= 135, `unexpected FTE ${est.totalFte}`);
});

import { computeTopDown, DEFAULT_TOPDOWN, annualValueBasis } from '../shared/topdown';
import { heuristicPriorAward } from '../server/heuristic';

test('heuristic prior-award parser finds the incumbent contract in the sample', () => {
  const pa = heuristicPriorAward([{ name: 's', mode: 'text', text: sample, chars: sample.length, bytes: sample.length }])!;
  assert.ok(pa, 'no prior award found');
  assert.equal(pa.contractNumber, 'W912QR-20-C-0015');
  assert.equal(pa.totalValue, 31_850_000);
  assert.equal(pa.periodMonths, 60);
  assert.equal(pa.awardYear, 2020);
  assert.equal(pa.spendToDate, 26_100_000);
});

test('top-down math backs FTEs out of the award with the stated assumptions', () => {
  const inv = heuristicExtract([{ name: 's', mode: 'text', text: sample, chars: sample.length, bytes: sample.length }]);
  const est = estimateInventory(inv);
  const pa = { totalValue: 31_850_000, periodMonths: 60 };
  assert.equal(annualValueBasis(pa).value, 6_370_000);
  const a = { ...DEFAULT_TOPDOWN, loadedCostPerFte: 60000, loadedCostLow: 50000, loadedCostHigh: 70000, odcMaterialsPct: 0.1, subcontractPct: 0, gaPct: 0.1, feePct: 0.08, escalationPct: 0, yearsSinceAward: 0 };
  const t = computeTopDown(pa, a, est, { rationale: 'x', risks: [], provider: 'heuristic' });
  const costBase = 6_370_000 / (1.1 * 1.08);
  const labor = costBase - 637_000;
  assert.equal(t.priceBreakdown.loadedLabor, Math.round(labor));
  assert.equal(t.impliedFte.base, Math.round((labor / 60000) * 10) / 10);
  assert.ok(t.impliedFte.low < t.impliedFte.base && t.impliedFte.base < t.impliedFte.high);
  // price identity: loaded labor + odc + ga + fee ≈ annual value
  const sum = t.priceBreakdown.loadedLabor + t.priceBreakdown.odc + t.priceBreakdown.subcontract + t.priceBreakdown.ga + t.priceBreakdown.fee;
  assert.ok(Math.abs(sum - t.annualValue) < 5, `price identity off by ${sum - t.annualValue}`);
  assert.equal(t.bottomUpFte, est.totalFte);
  // spend basis wins over award basis when present
  assert.equal(annualValueBasis({ ...pa, spendToDate: 26_100_000, spendPeriodMonths: 48 }).basis, 'spend');
});

test('less-than-weekly service levels flow through: visits per year drive routine custodial, weekly tasks capped at visits', () => {
  const f = (serviceLevel: ServiceLevel): Facility => ({ id: serviceLevel, name: serviceLevel, category: 'admin', grossSqft: 20000, cleanableSqft: 17000, floors: 1, restroomFixtures: 10, serviceLevel, scope: ['custodial', 'floor_care'], confidence: 1 });
  const at = (level: ServiceLevel) => estimateFacility(f(level), DEFAULT_ASSUMPTIONS);
  const line = (e: ReturnType<typeof at>, id: string) => e.lines.find((l) => l.factorId === id);
  const expected: [ServiceLevel, number][] = [['weekly', 50], ['biweekly', 26], ['monthly', 12], ['quarterly', 4]];
  for (const [level, days] of expected) {
    const e = at(level);
    assert.equal(e.resolved.serviceDaysPerYear, days, level);
    assert.equal(line(e, 'cust_trash')!.frequencyPerYear, days, `${level} trash runs`);
    assert.equal(line(e, 'cust_restroom')!.frequencyPerYear, days, `${level} restroom services`);
    assert.equal(line(e, 'cust_dusting')!.frequencyPerYear, Math.min(50, days), `${level} weekly dusting capped at visits`);
    assert.equal(line(e, 'cust_high_dust')!.frequencyPerYear, 4, `${level} quarterly high dusting`);
    assert.equal(line(e, 'cust_windows')!.frequencyPerYear, 2, `${level} semi-annual windows`);
    assert.equal(line(e, 'fc_strip_wax')!.frequencyPerYear, 1, `${level} floor care keeps its own program`);
    const perVisit = e.dailyHoursByCrew.custodial ?? 0;
    assert.ok(perVisit > 0 && Number.isFinite(perVisit), `${level} hours per visit ${perVisit}`);
  }
  const cust = expected.map(([level]) => at(level).hoursByCrew.custodial!);
  for (let i = 1; i < cust.length; i++) assert.ok(cust[i] < cust[i - 1], `custodial hours fall with fewer visits: ${cust.join(' > ')}`);
  // hours = visits × (cost per visit) + the few tasks rarer than every visit (high dusting 4×, windows 2×): linear in visits
  const slopeHigh = (cust[0] - cust[1]) / (50 - 26); const slopeLow = (cust[2] - cust[3]) / (12 - 4);
  assert.ok(Math.abs(slopeHigh / slopeLow - 1) < 0.02, `cost per visit ${slopeHigh.toFixed(2)} vs ${slopeLow.toFixed(2)}`);
  // an unknown level falls back to the category default (admin: daily_5)
  assert.equal(estimateFacility({ ...f('weekly'), serviceLevel: 'fortnightly' as ServiceLevel }, DEFAULT_ASSUMPTIONS).resolved.serviceDaysPerYear, 250);
});

test('metric grounds units: hectares and square metres price like their acre / sq ft equivalents', () => {
  const A = { ...DEFAULT_ASSUMPTIONS, growingSeasonWeeks: 30, snowEventsPerYear: 6, climateZone: 'temperate' as const };
  const g = (kind: GroundsArea['kind'], quantity: number, unit: GroundsArea['unit']): GroundsArea => ({ id: `${kind}-${unit}`, name: kind, kind, quantity, unit, confidence: 1 });
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= Math.max(0.5, 0.002 * b), `${what}: ${a} vs ${b}`);
  for (const kind of ['improved_turf', 'semi_improved', 'unimproved', 'athletic_field'] as const) {
    const ha = estimateGrounds(g(kind, 10, 'hectares'), A);
    const ac = estimateGrounds(g(kind, 10 * ACRES_PER_HECTARE, 'acres'), A);
    const sqm = estimateGrounds(g(kind, 100_000, 'sqm'), A); // 10 ha
    near(ha.acres, 24.71, `${kind} acres from hectares`);
    near(ha.totalHours, ac.totalHours, `${kind} hectares vs acres`);
    near(sqm.totalHours, ac.totalHours, `${kind} sqm vs acres`);
    assert.deepEqual(ha.lines.map((l) => l.factorId), ac.lines.map((l) => l.factorId));
  }
  for (const kind of ['parking', 'sidewalk', 'shrub_bed'] as const) {
    const sqm = estimateGrounds(g(kind, 10_000, 'sqm'), A);
    const sqft = estimateGrounds(g(kind, 10_000 * SQFT_PER_SQM, 'sqft'), A);
    const ha = estimateGrounds(g(kind, 1, 'hectares'), A);
    assert.ok(sqm.totalHours > 0, `${kind} sqm priced`);
    near(sqm.totalHours, sqft.totalHours, `${kind} sqm vs sqft`);
    near(ha.totalHours, sqft.totalHours, `${kind} 1 ha vs 10,000 m²`);
  }
  const inv: Inventory = { site: { climateZone: 'temperate' }, facilities: [], grounds: [g('improved_turf', 10, 'hectares'), g('parking', 10_000, 'sqm'), g('tree_canopy', 40, 'each'), g('tree_canopy', 2, 'hectares')] };
  const est = estimateInventory(inv);
  near(est.metrics.acres, 24.71, 'metrics.acres');
  near(est.metrics.pavedSqft, 107_639, 'metrics.pavedSqft');
  assert.equal(est.metrics.trees, 40, 'canopy given as area is not a tree count');
});

test('dining with per-period headcounts and no stated meals per day uses mealsPerDayFromPeriods', () => {
  const periods = [
    { period: 'Breakfast', weekdayHeadcount: 600, weekendHeadcount: 350 },
    { period: 'Lunch', weekdayHeadcount: 900, weekendHeadcount: 600 },
    { period: 'Dinner', weekdayHeadcount: 800, weekendHeadcount: 550 },
    { period: 'Midnight', weekdayHeadcount: 120 },
  ];
  const derived = mealsPerDayFromPeriods(periods); // (5 × 2,420 + 2 × 1,500) / 7
  assert.equal(derived, 2157);
  const dfac = (dining: NonNullable<Facility['dining']>): Facility => ({ id: 'd', name: 'DFAC', category: 'dining', grossSqft: 24000, floors: 1, serviceLevel: 'daily_7', scope: ['dining'], confidence: 1, dining });
  const e = estimateFacility(dfac({ mealPeriodsDetail: periods, mealsPerDay: 0, mealPeriods: 0, daysPerWeek: 7 }), DEFAULT_ASSUMPTIONS);
  assert.equal(e.resolved.dining!.mealsPerDay, derived);
  assert.equal(e.resolved.dining!.mealPeriods, 4);
  assert.equal(e.lines.find((l) => l.factorId === 'dn_prep')!.quantity, derived * 364);
  assert.equal(e.lines.find((l) => l.factorId === 'dn_san_dining')!.frequencyPerYear, 364 * 4);
  const stated = estimateFacility(dfac({ mealPeriodsDetail: periods, mealsPerDay: derived, mealPeriods: 4, daysPerWeek: 7 }), DEFAULT_ASSUMPTIONS);
  assert.equal(e.totalHours, stated.totalHours);
  // a stated figure wins over the detail
  assert.equal(estimateFacility(dfac({ mealPeriodsDetail: periods, mealsPerDay: 1800, mealPeriods: 3, daysPerWeek: 7 }), DEFAULT_ASSUMPTIONS).resolved.dining!.mealsPerDay, 1800);
  // reader rules: a 7-day DFAC printing weekday figures only serves weekends alike; a 5-day operation counts weekdays
  const weekdayOnly = periods.map((p) => ({ period: p.period, weekdayHeadcount: p.weekdayHeadcount }));
  assert.equal(resolveMealsPerDay({ mealsPerDay: 0, mealPeriodsDetail: weekdayOnly, daysPerWeek: 7 }), 2420);
  assert.equal(resolveMealsPerDay({ mealsPerDay: 0, mealPeriodsDetail: periods, daysPerWeek: 5 }), 2420);
  // the inventory roll-up uses the derived figure too
  const inv: Inventory = { site: {}, facilities: [dfac({ mealPeriodsDetail: periods, mealsPerDay: 0, mealPeriods: 0, daysPerWeek: 7 })], grounds: [] };
  assert.equal(estimateInventory(inv).metrics.mealsPerYear, derived * 7 * 52);
});

test('meal periods are the weekday periods: weekend Brunch / Supper rows do not add meal periods', () => {
  // TE 5-1 layout (dfac-ffs-headcount-pdf, Bldg 4120): weekday Breakfast / Lunch / Dinner, weekend Brunch / Supper
  const te51 = [
    { period: 'Breakfast', weekdayHeadcount: 410 }, { period: 'Lunch', weekdayHeadcount: 905 }, { period: 'Dinner', weekdayHeadcount: 520 },
    { period: 'Brunch', weekendHeadcount: 465 }, { period: 'Supper', weekendHeadcount: 330 },
  ];
  const d = resolveDining({ mealsPerDay: 0, mealPeriods: 0, daysPerWeek: 7, mealPeriodsDetail: te51, kitchenSqft: 9000, diningRoomSqft: 11000 });
  assert.equal(d.mealPeriods, 3);
  assert.equal(d.mealsPerDay, 1538); // (5 × 1,835 + 2 × 795) / 7
  const f = (dining: NonNullable<Facility['dining']>): Facility => ({ id: 'd', name: 'DFAC 4120', category: 'dining', grossSqft: 25000, floors: 1, serviceLevel: 'daily_7', scope: ['dining'], confidence: 1, dining });
  const cleared = estimateFacility(f({ mealsPerDay: 0, mealPeriods: 0, daysPerWeek: 7, mealPeriodsDetail: te51, kitchenSqft: 9000, diningRoomSqft: 11000 }), DEFAULT_ASSUMPTIONS);
  const asRead = estimateFacility(f({ mealsPerDay: 1538, mealPeriods: 3, daysPerWeek: 7, mealPeriodsDetail: te51, kitchenSqft: 9000, diningRoomSqft: 11000 }), DEFAULT_ASSUMPTIONS);
  assert.equal(cleared.lines.find((l) => l.factorId === 'dn_san_dining')!.frequencyPerYear, 364 * 3);
  assert.equal(cleared.totalHours, asRead.totalHours, 'a cleared meal-period field prices like the reader');
  // a weekend-only table counts its weekend periods; a stated count wins; no detail at all falls back to 3
  assert.equal(resolveDining({ mealsPerDay: 0, mealPeriods: 0, daysPerWeek: 7, mealPeriodsDetail: te51.slice(3) }).mealPeriods, 2);
  assert.equal(resolveDining({ mealsPerDay: 0, mealPeriods: 4, daysPerWeek: 7, mealPeriodsDetail: te51 }).mealPeriods, 4);
  assert.equal(resolveDining({ mealsPerDay: 1500, mealPeriods: 0, daysPerWeek: 7 }).mealPeriods, 3);
});

test('engine and reader derive meals per day and meal periods with the same rules', () => {
  const cases: { periods: MealPeriodHeadcount[]; days: number }[] = [
    { periods: [{ period: 'Breakfast', weekdayHeadcount: 410 }, { period: 'Lunch', weekdayHeadcount: 905 }, { period: 'Dinner', weekdayHeadcount: 520 }, { period: 'Brunch', weekendHeadcount: 465 }, { period: 'Supper', weekendHeadcount: 330 }], days: 7 },
    { periods: [{ period: 'Breakfast', weekdayHeadcount: 600, weekendHeadcount: 350 }, { period: 'Lunch', weekdayHeadcount: 900, weekendHeadcount: 600 }, { period: 'Dinner', weekdayHeadcount: 800, weekendHeadcount: 550 }, { period: 'Midnight', weekdayHeadcount: 120 }], days: 7 },
    { periods: [{ period: 'Breakfast', weekdayHeadcount: 300 }, { period: 'Lunch', weekdayHeadcount: 700 }], days: 7 },
    { periods: [{ period: 'Breakfast', weekdayHeadcount: 300 }, { period: 'Lunch', weekdayHeadcount: 700 }], days: 5 },
    { periods: [{ period: 'Breakfast', weekdayHeadcount: 300, weekendHeadcount: 100 }, { period: 'Lunch', weekdayHeadcount: 700, weekendHeadcount: 250 }], days: 6 },
    { periods: [{ period: 'Brunch', weekendHeadcount: 465 }, { period: 'Supper', weekendHeadcount: 330 }], days: 7 },
    { periods: [{ period: 'Breakfast', weekdayHeadcount: 0 }, { period: 'Lunch' }], days: 7 },
  ];
  for (const { periods, days } of cases) {
    const reader = readerDiningMealsPerDay(periods, days);
    assert.deepEqual(diningMealsPerDay(periods, days), reader, `${periods.map((p) => p.period).join('/')} × ${days} d`);
    const d = resolveDining({ mealsPerDay: 0, mealPeriods: 0, daysPerWeek: days, mealPeriodsDetail: periods });
    assert.equal(d.mealsPerDay, reader.mealsPerDay);
    assert.equal(d.mealPeriods, reader.mealPeriods || 3);
  }
});
