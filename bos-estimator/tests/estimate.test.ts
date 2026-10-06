import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { heuristicExtract } from '../server/heuristic';
import { estimateFacility, estimateGrounds, estimateInventory, DEFAULT_ASSUMPTIONS } from '../shared/estimate';
import { FACTORS } from '../shared/factors';
import type { Facility, GroundsArea } from '../shared/types';

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
  const b = estimateFacility(f, DEFAULT_ASSUMPTIONS, { cust_trash: 0.24 });
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
  assert.ok(est.totalFte > 100 && est.totalFte < 200, `unexpected FTE ${est.totalFte}`);
});
