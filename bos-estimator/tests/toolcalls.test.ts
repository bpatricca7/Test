// Tool-call handling shared by the live Claude loop and recorded replays (server/toolcalls.ts, server/ai.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {
  applyToolCall, appaLevel, beginPass, buildingKey, cleanBuildingNumber, createState, diningMealsPerDay, docRank, extractionTools, facilityIdentity, finalize,
  finishClass, isTotalRow, mapGroundsLabel, parseNumber, parseServiceFrequency, replayToolCalls, seasonDay, seasonServiceDays, type ToolCall,
} from '../server/toolcalls';
import { describeRequests, extractWithClaude, facilityId, mergeFacility, replayToolCalls as replayFromAi } from '../server/ai';
import { estimateInventory } from '../shared/estimate';
import { normBn, scoreInventory, siteFieldOk } from './harness/score';
import type { FixtureTruth } from './harness/truth';
import type { ExtractionEvent, Facility, PriorAward } from '../shared/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'sample-fort-example');

const J4 = 'Attachment J-4 Facility List.xlsx';
const AM2 = 'Amendment 0002.pdf';
const DOCS = [{ name: 'Solicitation W912QR-26-R-0042.pdf' }, { name: J4 }, { name: AM2 }];
const row = (o: Record<string, unknown>) => ({ source: { file: J4, page: 3, excerpt: '' }, confidence: 0.9, area_unit: 'sf', status: 'in_scope', ...o });
const reg = (...facilities: Record<string, unknown>[]): ToolCall => ({ name: 'register_facilities', input: { facilities } });
const byBn = (fs: Facility[], bn: string, campus?: string) => fs.filter((f) => buildingKey(f.buildingNumber ?? '') === buildingKey(bn) && (campus == null || f.campus === campus));

// ------------------------------------------------------------------------------------------------
// recorded run
// ------------------------------------------------------------------------------------------------

test('replaying the recorded sample-fort-example run scores 100', () => {
  const truth = JSON.parse(fs.readFileSync(path.join(FIX, 'truth.json'), 'utf8')) as FixtureTruth;
  const rec = JSON.parse(fs.readFileSync(path.join(FIX, 'sim', 'recorded.calls.json'), 'utf8')) as { calls: ToolCall[] };
  const r = replayToolCalls(rec.calls, [{ name: 'pws.pdf' }]);
  // the recording has no set_previous_award call (eval falls back to the rule-based award reader), so score the award as given
  const rep = scoreInventory(truth, r.inventory, 'replay', truth.expect.priorAward as PriorAward);
  assert.equal(rep.score, 100, JSON.stringify({ misses: rep.misses, extras: rep.extras, grounds: rep.grounds, dining: rep.dining }));
  assert.equal(rep.facilities.matched, 16);
  assert.equal(rep.facilities.sfExactRate, 1);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.results.every((x) => !x.isError), JSON.stringify(r.results));
  const dfac = r.inventory.facilities.find((f) => f.buildingNumber === '2410')!;
  assert.equal(dfac.dining?.mealsPerDay, 2650);
  assert.equal(dfac.dining?.mealPeriods, 4);
  assert.equal(dfac.dining?.mealPeriodsDetail?.length, 4);
  // ai.ts re-exports the same function for scripts/eval.ts --provider replay
  assert.equal(replayFromAi, replayToolCalls);
});

// ------------------------------------------------------------------------------------------------
// parsing helpers
// ------------------------------------------------------------------------------------------------

test('numbers: footnote markers, commas, units and placeholders', () => {
  assert.equal(parseNumber('45,200[^1]'), 45200);
  assert.equal(parseNumber('2,650 SM'), 2650);
  assert.equal(parseNumber('~~1,200~~'), 1200);
  assert.equal(parseNumber('118,640*'), 118640);
  assert.equal(parseNumber('TBD'), null);
  assert.equal(parseNumber(null), null);
  assert.ok(Number.isNaN(parseNumber('see addendum')));
});

test('building numbers: printed form kept, key normalised', () => {
  assert.equal(cleanBuildingNumber('Bldg. No. 0012'), '0012');
  assert.equal(cleanBuildingNumber('Building #1201'), '1201');
  assert.equal(cleanBuildingNumber('Bldg1201'), '1201');
  assert.equal(cleanBuildingNumber('T–2401'), 'T-2401');
  assert.equal(cleanBuildingNumber('B-45'), 'B-45');
  assert.equal(buildingKey('0012'), buildingKey('12'));
  assert.equal(buildingKey('T-0012'), buildingKey('T12'));
  assert.notEqual(buildingKey('3105-B'), buildingKey('3105'));
  // a separator between a letter run and a digit run is dropped; between two digit runs it is kept
  assert.equal(buildingKey('T-2401'), buildingKey('T2401'));
  assert.equal(buildingKey('3105-B'), buildingKey('3105B'));
  assert.equal(buildingKey('P 114'), buildingKey('P-114'));
  for (const [a, b] of [['1-10', '110'], ['12-3', '123'], ['4-2120', '42120'], ['101-A', '10-1A']]) assert.notEqual(buildingKey(a), buildingKey(b), `${a} vs ${b}`);
  assert.equal(buildingKey('12-03'), buildingKey('12-3'));
  // site / location numbering ("Site 4" in a narrative or addendum, "4" in the summary table)
  for (const s of ['Site 4', 'Site No. 4', 'SITE-4', 'Location 4', 'Loc. 4', 'No. 4', 'No 4', 'Facility 4', 'Facility No. 4', '#4']) assert.equal(cleanBuildingNumber(s), '4', s);
  // "No" only as a word: letters of real numbers are kept
  for (const s of ['NOSC 1', 'NORTH 12', 'NOLF-3', 'Site A', 'Location TBD']) assert.equal(cleanBuildingNumber(s), s);
  assert.equal(cleanBuildingNumber('Bldg NOSC 1'), 'NOSC 1');
  assert.notEqual(buildingKey(cleanBuildingNumber('NOSC 1')!), buildingKey(cleanBuildingNumber('SC 1')!));
});

test('"Site 4" in an addendum revises site "4" of the summary table; a number printed with a letter prefix matches by name outside its table', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: '3-1', row_count: 1, printed_total_gross_area: 41750 }));
  applyToolCall(st, reg(row({ table_id: '3-1', building_number: '4', name: 'Human Services Building', gross_area: 41750, source: { file: J4, excerpt: '4 | Human Services Building | 41,750' } })));
  const r = applyToolCall(st, reg(row({ building_number: 'Site 4', name: 'Human Services Building', gross_area: 46210, source: { file: AM2, excerpt: 'Site 4 – revised to 46,210 SF' } })));
  assert.match(r.resultText, /1 update of already-registered buildings/);
  assert.deepEqual([...st.facilities.values()].map((f) => [f.buildingNumber, f.grossSqft]), [['4', 46210]]);
  assert.equal(applyToolCall(st, finishCall()).isError, false);
  // "Building 41 (B-41)" added by an amendment, later revised as "41": the same building (same name, not from its table)
  const st2 = createState(DOCS);
  applyToolCall(st2, reg(row({ building_number: 'B-41', name: 'Whole Health Center', gross_area: 9600, source: { file: AM2, excerpt: 'Add Building 41 (B-41) Whole Health Center 9,600 GSF' } })));
  const r2 = applyToolCall(st2, reg(row({ building_number: '41', name: 'Whole Health Center', gross_area: null, cleanable_area: 7960, source: { file: AM2, page: 2, excerpt: 'Bldg 41: 7,960 CSF' } })));
  assert.match(r2.resultText, /41: matched to building B-41 \(same name; the number is printed with and without a letter prefix\)/);
  assert.equal(st2.facilities.size, 1);
  assert.equal([...st2.facilities.values()][0].cleanableSqft, 7960);
  // two printed rows of one table are two buildings, even with the same name (T-41 is not 41)
  const st3 = createState(DOCS);
  applyToolCall(st3, reg(row({ table_id: 'J-4', building_number: 'T-41', name: 'Latrine', gross_area: 400, source: { file: J4, excerpt: 'T-41 | Latrine | 400' } }), row({ table_id: 'J-4', building_number: '41', name: 'Latrine', gross_area: 600, source: { file: J4, excerpt: '41 | Latrine | 600' } })));
  assert.equal(st3.facilities.size, 2);
  // only a "B" (building) prefix aliases: an amendment adding "T-12 Latrine" next to the listed "12 Latrine" adds a building
  const st4 = createState(DOCS);
  applyToolCall(st4, reg(row({ table_id: 'J-4', building_number: '12', name: 'Latrine', gross_area: 600, source: { file: J4, excerpt: '12 | Latrine | 600' } })));
  applyToolCall(st4, reg(row({ building_number: 'T-12', name: 'Latrine', gross_area: 400, source: { file: AM2, excerpt: 'Add T-12 Latrine 400 SF' } })));
  assert.deepEqual([...st4.facilities.values()].map((f) => [f.buildingNumber, f.grossSqft]), [['12', 600], ['T-12', 400]]);
});

test('distinct numbers that differ only by a separator stay distinct buildings', () => {
  const st = createState(DOCS);
  const r = applyToolCall(st, reg(row({ building_number: '1-10', name: 'Barracks 1-10', gross_area: 30000, source: { file: J4, excerpt: '1-10' } }), row({ building_number: '110', name: 'Chapel', gross_area: 8000, source: { file: J4, excerpt: '110' } })));
  assert.match(r.resultText, /2 facilities in total/);
  const inv = finalize(st).inventory;
  assert.deepEqual(inv.facilities.map((f) => [f.id, f.buildingNumber, f.name, f.grossSqft]), [['b-1-10', '1-10', 'Barracks 1-10', 30000], ['b-110', '110', 'Chapel', 8000]]);
  const st2 = createState(DOCS);
  applyToolCall(st2, reg(row({ building_number: '12-3', name: 'A', gross_area: 100 }), row({ building_number: '123', name: 'B', gross_area: 200 })));
  assert.equal(st2.facilities.size, 2);
});

test('ids keep the printed number (append mode merges by id), campus-prefixed only when a campus is set', () => {
  assert.equal(facilityId('0012', 'HQ'), 'b-0012');
  assert.equal(facilityId('T-2401', 'X'), 'b-t-2401');
  assert.equal(facilityId('0012', 'HQ', 'Main Post'), 'b-main-post--0012');
  assert.equal(facilityId(undefined, 'Comfort Station'), 'b-comfort-station');
  const st = createState(DOCS);
  applyToolCall(st, reg(row({ building_number: 'Bldg 0012', name: 'HQ', gross_area: 47900, source: { file: AM2, excerpt: 'am2' } }), row({ building_number: 'T-2401', name: 'Ops', gross_area: 1000 })));
  const incoming = finalize(st).inventory.facilities;
  assert.deepEqual(incoming.map((f) => f.id), ['b-0012', 'b-t-2401']);
  // the append merge in index.ts: map by id, mergeFacility on a hit
  const existing: Facility[] = [{ id: 'b-0012', buildingNumber: '0012', name: 'HQ', category: 'admin', grossSqft: 45200, floors: 2, serviceLevel: 'daily_5', scope: ['custodial', 'floor_care'], confidence: 0.9 }];
  const map = new Map(existing.map((f) => [f.id, f]));
  for (const f of incoming) map.set(f.id, map.has(f.id) ? mergeFacility(map.get(f.id)!, f) : f);
  assert.deepEqual([...map.values()].map((f) => [f.id, f.grossSqft]), [['b-0012', 47900], ['b-t-2401', 1000]]);
  // identity across runs whatever the printed form
  assert.equal(facilityIdentity({ buildingNumber: '0012', name: 'HQ' }), facilityIdentity({ buildingNumber: 'Bldg 12', name: 'Brigade HQ' }));
  assert.notEqual(facilityIdentity({ buildingNumber: '0012', name: 'HQ', campus: 'Main Post' }), facilityIdentity({ buildingNumber: '0012', name: 'HQ', campus: 'North Annex' }));
});

test('service frequency wording', () => {
  assert.equal(parseServiceFrequency('M–F'), 'daily_5');
  assert.equal(parseServiceFrequency('Daily (7 days)'), 'daily_7');
  assert.equal(parseServiceFrequency('2x/month'), 'biweekly');
  assert.equal(parseServiceFrequency('Bi-weekly'), 'biweekly');
  assert.equal(parseServiceFrequency('Monthly'), 'monthly');
  assert.equal(parseServiceFrequency('Quarterly'), 'quarterly');
  assert.equal(parseServiceFrequency('3x/week'), '3x_week');
  assert.equal(parseServiceFrequency('N/A'), undefined);
  for (const t of ['Mon–Sat', 'M-Sa', '6 days/week', 'Six days a week', '6x/wk']) assert.equal(parseServiceFrequency(t), 'daily_6', t);
});

test('a stated service calendar overrides the level\'s day count', () => {
  const st = createState(DOCS);
  applyToolCall(st, reg(
    row({ building_number: '101', name: 'Elementary School', gross_area: 60000, service_level: 'daily_5', service_days_per_year: 200 }),
    row({ building_number: '102', name: 'Admin', gross_area: 10000, service_level: 'daily_5', service_days_per_year: 9000 }),
    row({ building_number: '103', name: 'Library', gross_area: 8000, service_frequency_text: 'Mon–Sat' }),
  ));
  const fs = finalize(st).inventory.facilities;
  const by = (n: string) => fs.find((f) => f.buildingNumber === n)!;
  assert.equal(by('101').serviceDaysPerYear, 200);
  assert.equal(by('102').serviceDaysPerYear, undefined, 'an impossible day count is dropped');
  assert.equal(by('103').serviceLevel, 'daily_6');
});

test('APPA levels 1–3 are read from a printed cleaning standard', () => {
  for (const [t, want] of [['APPA Level 2', 2], ['APPA level III', 3], ['APPA Custodial Level 1 (orderly spotlessness)', 1], ['Level 3 per APPA', 3], ['appa lvl. 2', 2]] as const) assert.equal(appaLevel(t), want, t);
  for (const t of ['APPA Level 4', 'Level V (APPA)', 'Service Class B', 'COL 2', 'Level 2', '', null]) assert.equal(appaLevel(t), undefined, String(t));
  const st = createState(DOCS);
  applyToolCall(st, reg(row({ building_number: '12', name: 'HQ', gross_area: 20000, cleaning_detail: { restroom_rooms: null, cleaning_standard: 'APPA Level 3', area_by_class: null } }), row({ building_number: '13', name: 'Shop', gross_area: 8000 })));
  const fs = finalize(st).inventory.facilities;
  assert.equal(fs.find((f) => f.buildingNumber === '12')!.cleaningLevel, 3);
  assert.equal(fs.find((f) => f.buildingNumber === '13')!.cleaningLevel, undefined);
});

test('total rows are recognised without catching real names', () => {
  for (const n of ['TOTAL', 'Subtotal - Cantonment', 'GRAND TOTAL – ALL LOCATIONS', 'Winter Haven Campus Subtotal', 'Total Custodial Square Feet – CLIN 0001', 'CANTONMENT AREA A TOTAL']) assert.ok(isTotalRow(n), n);
  assert.ok(!isTotalRow('Total Fitness Center', 'P-114'));
  assert.ok(!isTotalRow('Total Fitness Center'));
  assert.ok(isTotalRow('Total improved acreage', undefined, true));
});

test('document precedence: role / amendment number from the reader, else from the file name', () => {
  assert.ok(docRank({ name: 'pws.pdf', role: 'pws' }, 0) < docRank({ name: 'J-4.xlsx', role: 'attachment' }, 1));
  assert.ok(docRank({ name: 'qa.pdf', role: 'qa' }, 0) < docRank({ name: 'x.pdf', role: 'amendment', amendment: 1 }, 1));
  assert.ok(docRank({ name: 'a.pdf', role: 'amendment', amendment: 2 }, 0) > docRank({ name: 'b.pdf', role: 'amendment', amendment: 1 }, 5));
  assert.ok(docRank({ name: 'Amendment 0002.pdf' }, 0) > docRank({ name: 'Attachment J-4 Facility List.xlsx' }, 1));
  assert.ok(docRank({ name: 'W912QR26R0042_A0001.pdf' }, 0) > docRank({ name: 'Questions and Answers.pdf' }, 1));
  assert.ok(docRank({ name: 'A101 Floor Plan.pdf' }, 5) < docRank({ name: 'Questions and Answers.pdf' }, 1));
});

// ------------------------------------------------------------------------------------------------
// adversarial tool calls
// ------------------------------------------------------------------------------------------------

test('subtotal and total rows are rejected; real rows in the same call still register', () => {
  const st = createState(DOCS);
  const r = applyToolCall(st, reg(
    row({ building_number: '1201', name: 'Brigade HQ', gross_area: 45200 }),
    row({ building_number: null, name: 'Subtotal - Cantonment', gross_area: 45200 }),
    row({ building_number: null, name: 'TOTAL', gross_area: 45200 }),
  ));
  assert.equal(st.facilities.size, 1);
  assert.equal(r.isError, false);
  assert.match(r.resultText, /Rejected 2/);
  assert.match(r.resultText, /subtotal\/total row/);
});

test('missing area: rejected with an instruction; area_missing accepted with capped confidence; updates allowed', () => {
  const st = createState(DOCS);
  // an unnumbered row cannot be held for a later building (see the held-rows test): it is rejected
  const r1 = applyToolCall(st, reg(row({ building_number: null, name: 'Range Control', gross_area: null })));
  assert.equal(r1.isError, true);
  assert.match(r1.resultText, /Range Control: gross_area missing - copy it from the row/);
  assert.match(r1.resultText, /area_missing=true/);
  assert.equal(st.facilities.size, 0);

  const r2 = applyToolCall(st, reg(row({ building_number: '7020', name: 'Range Control', gross_area: null, area_missing: true, estimated_gross_area: 3200, confidence: 0.9, notes: 'Similar to 7021' })));
  assert.equal(r2.isError, false);
  const f = [...st.facilities.values()][0];
  assert.equal(f.grossSqft, 3200);
  assert.ok(f.confidence <= 0.4);
  assert.match(f.notes ?? '', /Area not printed/);
  assert.ok(finalize(st).warnings.some((w) => /no printed area/.test(w)));

  // a later printed area replaces the estimate and its capped confidence, whatever the order
  applyToolCall(st, reg(row({ building_number: '7020', name: 'Range Control', gross_area: '3,450', confidence: 0.95 })));
  assert.equal(f.id, [...st.facilities.values()][0].id);
  assert.equal([...st.facilities.values()][0].grossSqft, 3450);
  assert.equal([...st.facilities.values()][0].confidence, 0.95);

  // a row that only adds data to a registered building needs no area
  const r3 = applyToolCall(st, reg(row({ building_number: '7020', name: 'Range Control', gross_area: null, service_level: 'weekly', service_frequency_text: '1x/week' })));
  assert.equal(r3.isError, false);
  const g = [...st.facilities.values()][0];
  assert.equal(g.grossSqft, 3450);
  assert.equal(g.serviceLevel, 'weekly');
  assert.equal(g.serviceFrequencyText, '1x/week');
});

test('a call cut off by max_tokens is not applied and asks for smaller batches', () => {
  const st = createState(DOCS);
  const r = applyToolCall(st, reg(row({ building_number: '5230', name: 'Motor Pool', gross_area: 18000 })), { truncated: true });
  assert.equal(r.isError, true);
  assert.match(r.resultText, /cut off.*NOT applied.*smaller batches/s);
  assert.equal(st.facilities.size, 0);
  assert.ok(r.events.some((e) => e.type === 'warning'));
  // recorded calls carry the flag
  const rr = replayToolCalls([{ ...reg(row({ building_number: '5230', name: 'Motor Pool', gross_area: 18000 })), truncated: true }], DOCS);
  assert.equal(rr.inventory.facilities.length, 0);
  assert.equal(rr.results[0].isError, true);
});

test('campus duplicates: the same number on two campuses is two buildings; a bare number must say which', () => {
  const st = createState(DOCS);
  applyToolCall(st, reg(
    row({ campus: 'Main Post', building_number: '0012', name: 'Brigade HQ', gross_area: 31395 }),
    row({ campus: 'North Annex', building_number: '0012', name: 'Annex Ops', gross_area: 12000 }),
  ));
  assert.equal(st.facilities.size, 2);
  const ids = [...st.facilities.keys()];
  assert.notEqual(ids[0], ids[1]);
  const r = applyToolCall(st, reg(row({ building_number: '12', name: 'Brigade HQ', gross_area: 31500 })));
  assert.equal(r.isError, true);
  assert.match(r.resultText, /exists on 2 campuses \(Main Post, North Annex\) - set campus/);
  const inv = finalize(st).inventory;
  assert.equal(byBn(inv.facilities, '0012', 'Main Post')[0].grossSqft, 31395);
  assert.equal(byBn(inv.facilities, '0012', 'North Annex')[0].grossSqft, 12000);
});

test('leading zeros and "Bldg" prefixes merge into one building, keeping the printed number', () => {
  const st = createState(DOCS);
  applyToolCall(st, reg(row({ building_number: 'Bldg 0012', name: 'Brigade HQ', gross_area: 45200, floors: 3 })));
  applyToolCall(st, reg(row({ building_number: '12', name: 'Brigade HQ', gross_area: null, fixtures: { water_closets: 8, urinals: 4, lavatories: 10, showers: 2 } })));
  const inv = finalize(st).inventory;
  assert.equal(inv.facilities.length, 1);
  const f = inv.facilities[0];
  assert.equal(f.buildingNumber, '0012');
  assert.equal(f.grossSqft, 45200);
  assert.equal(f.floors, 3);
  assert.equal(f.restroomFixtures, 24); // WC + UR + LAV + showers summed in code
  // a campus given later is adopted when the number is unique
  applyToolCall(st, reg(row({ campus: 'Main Post', building_number: '0012', name: 'Brigade HQ', gross_area: 45200 })));
  assert.equal(st.facilities.size, 1);
  assert.equal([...st.facilities.values()][0].campus, 'Main Post');
});

test('unnumbered buildings get table/row-scoped ids (twelve comfort stations stay twelve)', () => {
  const st = createState(DOCS);
  const rows = Array.from({ length: 12 }, (_, i) => row({ table_id: 'J-4', building_number: null, name: 'Comfort Station', gross_area: 400, source: { file: J4, page: 4, excerpt: `Comfort Station | Area ${String.fromCharCode(65 + i)} | 400` } }));
  applyToolCall(st, reg(...rows));
  assert.equal(st.facilities.size, 12);
  // identical rows in one call are still separate buildings
  const st2 = createState(DOCS);
  applyToolCall(st2, reg(row({ table_id: 'T', building_number: null, name: 'Latrine', gross_area: 200, source: { file: J4, excerpt: 'Latrine | 200' } }), row({ table_id: 'T', building_number: null, name: 'Latrine', gross_area: 200, source: { file: J4, excerpt: 'Latrine | 200' } })));
  assert.equal(st2.facilities.size, 2);
});

test('units are converted in code and the printed area is kept', () => {
  const st = createState(DOCS);
  applyToolCall(st, reg(
    row({ building_number: '2410', name: 'DFAC', gross_area: '2,650', cleanable_area: 2100, area_unit: 'sm' }),
    row({ building_number: '2411', name: 'Warehouse', gross_area: 1000, area_unit: 'SY' }),
  ));
  const f = byBn([...st.facilities.values()], '2410')[0];
  assert.equal(f.grossSqft, 28524); // 2,650 × 10.7639
  assert.equal(f.cleanableSqft, 22604);
  assert.deepEqual(f.originalArea, { gross: 2650, cleanable: 2100, unit: 'sm' });
  assert.match(f.notes ?? '', /converted from 2,650 SM/i);
  assert.equal(byBn([...st.facilities.values()], '2411')[0].grossSqft, 9000);
  const bad = applyToolCall(st, reg(row({ building_number: '9', name: 'X', gross_area: 10, area_unit: 'furlongs' })));
  assert.equal(bad.isError, true);

  const g = applyToolCall(st, { name: 'register_grounds', input: { areas: [
    { name: 'Airfield infield', kind: 'Type II', document_label: 'Type II', quantity: 86, unit: 'hectares', status: 'in_scope', source: { excerpt: 'Airfield infield | Type II | 86.0 | HA' }, confidence: 0.9 },
    { name: 'Plaza beds', kind: 'shrub_bed', quantity: 1000, unit: 'sqm', status: 'in_scope', source: { excerpt: '' }, confidence: 0.9 },
    { name: 'Lot 12', kind: 'parking', quantity: 2000, unit: 'sqyd', status: 'in_scope', source: { excerpt: '' }, confidence: 0.9 },
  ] } });
  assert.equal(g.isError, false);
  const inv = finalize(st).inventory;
  const infield = inv.grounds.find((x) => x.name === 'Airfield infield')!;
  assert.equal(infield.unit, 'acres');
  assert.equal(infield.quantity, 212.511); // 86 ha × 2.4710538
  assert.equal(infield.kind, 'semi_improved');
  assert.equal(infield.documentLabel, 'Type II');
  const beds = inv.grounds.find((x) => x.name === 'Plaza beds')!;
  assert.equal(beds.unit, 'sqft');
  assert.equal(beds.quantity, 10763.9);
  assert.equal(inv.grounds.find((x) => x.name === 'Lot 12')!.unit, 'sqyd');
});

test('amendments supersede and delete regardless of the order they are read in', () => {
  for (const amendmentFirst of [false, true]) {
    const st = createState(DOCS);
    const base = reg(
      row({ table_id: 'J-4', building_number: '0012', name: 'Brigade HQ', gross_area: 45200 }),
      row({ table_id: 'J-4', building_number: '5100', name: 'CIF Warehouse', gross_area: 82000 }),
    );
    const amend = reg(
      row({ building_number: '12', name: 'Brigade HQ (revised)', gross_area: 47900, confidence: 0.6, source: { file: AM2, excerpt: 'Bldg 12 revised to 47,900 SF' } }),
      row({ building_number: '5100', name: 'CIF Warehouse', gross_area: null, status: 'deleted_by_amendment', status_reason: 'Deleted by Amendment 0002', source: { file: AM2, excerpt: 'Delete Bldg 5100' } }),
    );
    for (const c of amendmentFirst ? [amend, base] : [base, amend]) assert.equal(applyToolCall(st, c).isError, false);
    const inv = finalize(st).inventory;
    assert.equal(inv.facilities.length, 2, `amendmentFirst=${amendmentFirst}`);
    const hq = byBn(inv.facilities, '12')[0];
    assert.equal(hq.grossSqft, 47900, `amendment wins although less confident (amendmentFirst=${amendmentFirst})`);
    assert.equal(hq.buildingNumber, '0012');
    assert.match(hq.notes ?? '', /Superseded 45,200 SF from Attachment J-4 Facility List\.xlsx/);
    const cif = byBn(inv.facilities, '5100')[0];
    assert.equal(cif.status, 'deleted_by_amendment');
    assert.equal(cif.statusReason, 'Deleted by Amendment 0002');
    assert.equal(cif.grossSqft, 82000); // kept for reference, not estimated
    const est = estimateInventory(inv);
    assert.equal(est.metrics.facilitiesCount, 1);
    assert.equal(est.metrics.grossSqft, 47900);
  }
});

test('precedence is per field group: an update row that supplies no area does not decide the area (any read order)', () => {
  const docs = [{ name: 'PWS.pdf', role: 'pws' as const }, { name: 'Attachment J-4.xlsx', role: 'attachment' as const }, { name: 'Amendment 0002.pdf', role: 'amendment' as const, amendment: 2 }];
  const calls: Record<string, ToolCall> = {
    base: reg(row({ building_number: '0012', name: 'HQ', gross_area: 40000, source: { file: 'PWS.pdf', excerpt: 'pws' } })),
    amend: reg(row({ building_number: '0012', name: 'HQ', gross_area: null, status: null, service_level: 'weekly', service_frequency_text: 'weekly', source: { file: 'Amendment 0002.pdf', excerpt: 'am2 freq' } })),
    j4: reg(row({ building_number: '0012', name: 'HQ', gross_area: 45200, source: { file: 'Attachment J-4.xlsx', excerpt: 'j4' } })),
  };
  // (an update row sent before its building exists is rejected, so it never comes first)
  const orders = [['base', 'amend', 'j4'], ['base', 'j4', 'amend'], ['j4', 'base', 'amend'], ['j4', 'amend', 'base']];
  const out = orders.map((order) => {
    const st = createState(docs);
    for (const k of order) assert.equal(applyToolCall(st, calls[k]).isError, false, `${order.join('>')}: ${k}`);
    const f = finalize(st).inventory.facilities[0];
    return { gross: f.grossSqft, level: f.serviceLevel, text: f.serviceFrequencyText, notes: f.notes, status: f.status };
  });
  for (const o of out) assert.deepEqual(o, out[0]);
  assert.equal(out[0].gross, 45200);
  assert.equal(out[0].level, 'weekly');
  assert.equal(out[0].status, 'in_scope');
  assert.equal(out[0].notes, 'Superseded 40,000 SF from PWS.pdf');
});

test('an update row (no area) never brings an out-of-scope building back; a stated change does', () => {
  const docs = [{ name: 'PWS.pdf', role: 'pws' as const }, { name: 'Attachment J-4.xlsx', role: 'attachment' as const }, { name: 'Questions and Answers.pdf', role: 'qa' as const }];
  const vacant = reg(row({ building_number: '6010', name: 'Hangar 1', gross_area: 120000, status: 'vacant', status_reason: 'VACANT - no service', source: { file: 'Attachment J-4.xlsx', page: 4, excerpt: '6010 | Hangar 1 | 120,000 | VACANT' } }));
  // the old schema required status, so recorded update rows carry in_scope; the new one sends null
  for (const status of ['in_scope', null]) {
    const st = createState(docs);
    applyToolCall(st, vacant);
    const r = applyToolCall(st, reg(row({ building_number: '6010', name: 'Hangar 1', gross_area: null, status, service_level: 'weekly', source: { file: 'Questions and Answers.pdf', page: 2, excerpt: 'Q12: frequency for 6010? A: weekly' } })));
    assert.equal(r.isError, false);
    const inv = finalize(st).inventory;
    assert.equal(inv.facilities.length, 1);
    assert.equal(inv.facilities[0].status, 'vacant', `status=${status}`);
    assert.equal(inv.facilities[0].statusReason, 'VACANT - no service');
    assert.equal(inv.facilities[0].serviceLevel, 'weekly');
    assert.equal(estimateInventory(inv).metrics.grossSqft, 0);
  }
  // a higher-ranked document that says the building is back in scope (with a reason) does bring it back
  const st = createState(docs);
  applyToolCall(st, vacant);
  applyToolCall(st, reg(row({ building_number: '6010', name: 'Hangar 1', gross_area: null, status: 'in_scope', status_reason: 'Q&A 14: Hangar 1 will be reoccupied and serviced', source: { file: 'Questions and Answers.pdf', excerpt: 'Q14' } })));
  assert.equal(finalize(st).inventory.facilities[0].status, 'in_scope');
  // and so does a later listing of the building with its area
  const st2 = createState(docs);
  applyToolCall(st2, reg(row({ building_number: '6010', name: 'Hangar 1', gross_area: 120000, status: 'vacant', status_reason: 'vacant', source: { file: 'PWS.pdf', excerpt: 'pws' } })));
  applyToolCall(st2, reg(row({ building_number: '6010', name: 'Hangar 1', gross_area: 121500, status: 'in_scope', source: { file: 'Attachment J-4.xlsx', excerpt: 'j4' } })));
  assert.equal(finalize(st2).inventory.facilities[0].status, 'in_scope');
  // the schema lets the model say "unchanged"
  const facility = (extractionTools().find((t) => t.name === 'register_facilities')!.input_schema as unknown as { properties: { facilities: { items: { properties: Record<string, { type: unknown; enum?: unknown[] }> } } } }).properties.facilities.items.properties;
  assert.deepEqual(facility.status.type, ['string', 'null']);
  assert.ok(facility.status.enum?.includes(null));
});

test('amendment precedence follows DocInput.role / amendment, not upload order or names', () => {
  const docs = [{ name: 'b.pdf', role: 'amendment' as const, amendment: 2 }, { name: 'c.pdf', role: 'amendment' as const, amendment: 1 }, { name: 'a.pdf', role: 'pws' as const }];
  const st = createState(docs);
  applyToolCall(st, reg(row({ building_number: '1', name: 'HQ', gross_area: 1000, source: { file: 'b.pdf', excerpt: 'A2' } })));
  applyToolCall(st, reg(row({ building_number: '1', name: 'HQ', gross_area: 900, source: { file: 'c.pdf', excerpt: 'A1' } })));
  applyToolCall(st, reg(row({ building_number: '1', name: 'HQ', gross_area: 800, source: { file: 'a.pdf', excerpt: 'base' } })));
  assert.equal([...st.facilities.values()][0].grossSqft, 1000);
  // "Amendment 2" cited loosely still resolves to the amendment document
  const st2 = createState([{ name: 'PWS.pdf', role: 'pws' }, { name: 'Amendment 0002 - SF30.pdf', role: 'amendment', amendment: 2 }]);
  applyToolCall(st2, reg(row({ building_number: '1', name: 'HQ', gross_area: 1200, source: { file: 'Amendment 2', excerpt: '' } })));
  applyToolCall(st2, reg(row({ building_number: '1', name: 'HQ', gross_area: 1000, source: { file: 'PWS.pdf', excerpt: '' } })));
  assert.equal([...st2.facilities.values()][0].grossSqft, 1200);
});

test('status rows stay visible but out of the estimate', () => {
  const st = createState(DOCS);
  applyToolCall(st, reg(
    row({ building_number: '6010', name: 'Hangar 1', gross_area: 120000, status: 'vacant', status_reason: 'vacant pending demolition' }),
    row({ building_number: 'T-2308', name: 'Admin (WWII wood)', gross_area: 4712, status: 'demolished', status_reason: 'DEMO FY27 – EXCLUDE' }),
    row({ building_number: '1201', name: 'HQ', gross_area: 45200 }),
  ));
  const inv = finalize(st).inventory;
  assert.equal(inv.facilities.length, 3);
  assert.deepEqual(inv.facilities.map((f) => f.status), ['vacant', 'demolished', 'in_scope']);
  assert.equal(estimateInventory(inv).metrics.grossSqft, 45200);
  const bad = applyToolCall(st, reg(row({ building_number: '1', name: 'X', gross_area: 1, status: 'maybe' })));
  assert.match(bad.resultText, /status "maybe" must be one of/);
});

test('meal periods: meals per day derived in code (5 weekday + 2 weekend) and stored per period', () => {
  // TE 5-1 style: weekday B/L/D, weekend brunch/supper (dfac-ffs-headcount-pdf numbers)
  const st = createState([{ name: 'j-0502.pdf' }]);
  applyToolCall(st, reg(row({
    source: { file: 'j-0502.pdf', excerpt: '4120 | Warrior Restaurant' }, building_number: '4120', name: 'Warrior Restaurant', gross_area: 28460, cleanable_area: 4860,
    dining: { meal_periods: [
      { period: 'Breakfast', weekday_headcount: 410, weekend_headcount: null }, { period: 'Lunch', weekday_headcount: 905, weekend_headcount: null },
      { period: 'Dinner', weekday_headcount: 520, weekend_headcount: null }, { period: 'Late/Midnight', weekday_headcount: null, weekend_headcount: null },
      { period: 'Brunch', weekday_headcount: null, weekend_headcount: 465 }, { period: 'Supper', weekday_headcount: null, weekend_headcount: 330 },
    ], meals_per_day: null, days_per_week: 7, service_style: 'full_food_service' },
  })));
  const f = [...st.facilities.values()][0];
  assert.equal(f.dining?.mealsPerDay, 1538);
  assert.equal(f.dining?.mealPeriods, 3);
  assert.equal(f.dining?.daysPerWeek, 7);
  assert.equal(f.dining?.mealPeriodsDetail?.length, 5);
  assert.ok(f.scope.includes('dining'));
  // weekday-only figures for a 7-day DFAC: weekends assumed equal (noted)
  assert.deepEqual(diningMealsPerDay([{ period: 'B', weekdayHeadcount: 620 }, { period: 'L', weekdayHeadcount: 1150 }, { period: 'D', weekdayHeadcount: 740 }, { period: 'M', weekdayHeadcount: 140 }], 7), { mealsPerDay: 2650, mealPeriods: 4, assumedWeekend: true });
  // weekday and weekend per period
  assert.equal(diningMealsPerDay([{ period: 'B', weekdayHeadcount: 620, weekendHeadcount: 410 }, { period: 'L', weekdayHeadcount: 1150, weekendHeadcount: 780 }], 7).mealsPerDay, 1604);
  // a 5-day operation reports meals per operating day
  assert.equal(diningMealsPerDay([{ period: 'L', weekdayHeadcount: 300 }], 5).mealsPerDay, 300);
  // the dining-workload table row merges into the custodial-list row of the same building
  applyToolCall(st, reg(row({ source: { file: 'j-0502.pdf', excerpt: '4120' }, table_id: 'TE 6-1', building_number: '4120', name: 'Warrior Restaurant DFAC', gross_area: 28460, cleanable_area: 4860, floors: 1 })));
  assert.equal(st.facilities.size, 1);
  assert.equal([...st.facilities.values()][0].dining?.mealsPerDay, 1538);
});

test('declare_tables completeness gate: finish refused twice, then accepted with a warning', () => {
  const st = createState(DOCS);
  applyToolCall(st, { name: 'declare_tables', input: { tables: [{ table_id: 'J-4', title: 'J-4 Facility List', kind: 'facilities', file: J4, pages: '3-4', row_count: 3, printed_total_gross_area: 100000, area_unit: 'sf' }] } });
  applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '1', name: 'A', gross_area: 40000 }), row({ table_id: 'J-4', building_number: '2', name: 'B', gross_area: 30000 })));
  const f1 = applyToolCall(st, { name: 'finish', input: { summary: 'done', unresolved: [] } });
  assert.equal(f1.isError, true);
  assert.match(f1.resultText, /J-4 \(J-4 Facility List\): 2 of 3 rows registered/);
  assert.match(f1.resultText, /registered 70,000 SF vs printed total 100,000 SF/);
  assert.equal(applyToolCall(st, { name: 'finish', input: { summary: 'done', unresolved: [] } }).isError, true);
  const f3 = applyToolCall(st, { name: 'finish', input: { summary: 'done', unresolved: [] } });
  assert.equal(f3.isError, false);
  assert.ok(f3.events.some((e) => e.type === 'warning' && /after 2 refusals/.test(e.message)));
  assert.ok(finalize(st).warnings.some((w) => /Completeness: J-4/.test(w)));
});

test('declare_tables completeness gate: reconciled tables and explained gaps finish at once', () => {
  // reconciles, with the printed total in square meters and an out-of-scope row included in the printed total
  const st = createState(DOCS);
  applyToolCall(st, { name: 'declare_tables', input: { tables: [{ table_id: 'T1', title: 'Annex list', kind: 'facilities', file: null, pages: null, row_count: 3, printed_total_gross_area: 3000, area_unit: 'sm' }] } });
  applyToolCall(st, reg(
    row({ table_id: 'T1', building_number: '1', name: 'A', gross_area: 1234.5, area_unit: 'sm' }),
    row({ table_id: 'T1', building_number: '2', name: 'B', gross_area: 765.5, area_unit: 'sm' }),
    row({ table_id: 'T1', building_number: '3', name: 'C', gross_area: 1000, area_unit: 'sm', status: 'demolished', status_reason: 'demolished 2025' }),
  ));
  const ok = applyToolCall(st, { name: 'finish', input: { summary: 'done', unresolved: [] } });
  assert.equal(ok.isError, false, ok.resultText);
  assert.deepEqual(finalize(st).warnings, []);

  // a gap named in unresolved before finish ever showed it is refused once and listed; the same explanation is then accepted
  const st2 = createState(DOCS);
  applyToolCall(st2, { name: 'declare_tables', input: { tables: [{ table_id: 'TE-6', title: 'Custodial list', kind: 'facilities', row_count: 2, printed_total_gross_area: 50000, area_unit: 'sf' }] } });
  applyToolCall(st2, reg(row({ table_id: 'TE-6', building_number: '1', name: 'A', gross_area: 40000 })));
  const why = { summary: 'done', unresolved: ['TE-6: row 2 (Bldg 9) is illegible on the scanned page'] };
  const first = applyToolCall(st2, { name: 'finish', input: why });
  assert.equal(first.isError, true);
  assert.match(first.resultText, /TE-6 \(Custodial list\): 1 of 2 rows registered/);
  assert.match(first.resultText, /TE-6 is named in unresolved, but these figures are shown here for the first time/);
  const ex = applyToolCall(st2, { name: 'finish', input: why });
  assert.equal(ex.isError, false);
  assert.match(ex.resultText, /Accepted with 2 unreconciled items explained in unresolved: TE-6 \(Custodial list\): 1 of 2 rows registered/);
  assert.ok(ex.events.some((e) => e.type === 'warning' && /explained by the model/.test(e.message)));
  assert.match(finalize(st2).inventory.site.notes ?? '', /Unresolved: TE-6: row 2/);
});

test('completeness counts printed rows: out-of-scope grounds rows count, areas split from one printed row count once', () => {
  const area = (name: string, qty: number, o: Record<string, unknown> = {}) => ({ name, table_id: 'G-1', campus: null, facility_building_number: null, kind: 'improved_turf', document_label: 'Type I', status: 'in_scope', status_reason: null, quantity: qty, unit: 'acres', source: { file: J4, page: 9, excerpt: `${name} | ${qty}` }, confidence: 0.9, ...o });
  const st = createState(DOCS);
  applyToolCall(st, { name: 'declare_tables', input: { tables: [{ table_id: 'G-1', title: 'Grounds areas', kind: 'grounds', file: J4, pages: '9', row_count: 3, printed_total_gross_area: null, area_unit: 'sf' }, { table_id: 'G-2', title: 'Grounds by building', kind: 'grounds', file: J4, pages: '10', row_count: 2, printed_total_gross_area: null, area_unit: 'sf' }] } });
  applyToolCall(st, { name: 'register_grounds', input: { areas: [area('Cantonment lawns', 120), area('Parade field', 12), area('Range 7', 640, { status: 'excluded', status_reason: 'ITAM - by others' })] } });
  // SYSTEM step 8: one printed row shared by three buildings, split evenly into three areas
  const split = ['101', '102', '103'].map((bn) => area(`Lawn - Bldg ${bn}`, 1, { table_id: 'G-2', facility_building_number: bn, source: { file: J4, page: 10, excerpt: 'Bldgs 101, 102, 103 lawns | 3.0 AC' }, notes: 'split evenly from a shared quantity of 3.0 AC' }));
  applyToolCall(st, { name: 'register_grounds', input: { areas: [...split, area('Chapel lawn', 0.5, { table_id: 'G-2', source: { file: J4, page: 10, excerpt: 'Chapel lawn | 0.5 AC' } })] } });
  const f = applyToolCall(st, { name: 'finish', input: { summary: 'all registered', unresolved: [] } });
  assert.equal(f.isError, false, f.resultText);
  const fin = finalize(st);
  assert.deepEqual(fin.warnings.filter((w) => /Completeness|finish/.test(w)), []);
  assert.equal(fin.inventory.grounds.length, 6);
});

test('a building printed on two rows of one table under different names and areas is two line items; re-sends and revisions still merge', () => {
  const st = createState(DOCS);
  applyToolCall(st, { name: 'declare_tables', input: { tables: [{ table_id: 'J-4', title: 'J-4', kind: 'facilities', file: J4, pages: '3', row_count: 3, printed_total_gross_area: 50000, area_unit: 'sf' }] } });
  applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '1201', name: 'HQ wing A', gross_area: 30000, source: { file: J4, page: 3, excerpt: '1201 | HQ wing A | 30,000' } })));
  // the same row re-sent (same excerpt) and the same building re-sent with another excerpt but the same area: still one row
  applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '1201', name: 'HQ wing A', gross_area: 30000, source: { file: J4, page: 3, excerpt: '1201 | HQ wing A | 30,000' } })));
  applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '1201', name: 'HQ wing A', gross_area: 30000, source: { file: J4, page: 3, excerpt: '1201 HQ wing A' } })));
  assert.equal(st.tables.get('J-4')!.rows.size, 1);
  assert.equal(st.facilities.size, 1);
  // another printed row of the table with the same number, its own name and its own area: a separate line item (the
  // rule-based reader counts it the same way), so neither area is lost
  const r = applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '1201', name: 'HQ wing B', gross_area: 12000, source: { file: J4, page: 3, excerpt: '1201 | HQ wing B | 12,000' } }), row({ table_id: 'J-4', building_number: '1202', name: 'Gym', gross_area: 8000, source: { file: J4, page: 3, excerpt: '1202 | Gym | 8,000' } })));
  assert.match(r.resultText, /1201 is printed again in J-4 under another name and with another area: "HQ wing B" is registered as a separate line item/);
  assert.doesNotMatch(r.resultText, /listed twice/);
  // a re-send of the second line goes to it, not to the first
  applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '1201', name: 'HQ wing B', gross_area: 12000, source: { file: J4, page: 3, excerpt: '1201 | HQ wing B | 12,000' } })));
  assert.equal(applyToolCall(st, finishCall()).isError, false);
  const fin = finalize(st);
  assert.deepEqual(fin.warnings, []);
  assert.deepEqual(fin.inventory.facilities.map((f) => [f.id, f.buildingNumber, f.name, f.grossSqft]), [['b-1201', '1201', 'HQ wing A', 30000], ['b-1201--hq-wing-b', '1201', 'HQ wing B', 12000], ['b-1202', '1202', 'Gym', 8000]]);
  assert.equal(estimateInventory(fin.inventory).metrics.grossSqft, 50000);
  // a revision from outside the table (another document) under another name merges into the building
  const st2 = createState(DOCS);
  applyToolCall(st2, declare({ table_id: 'J-4', pages: '3', row_count: 1, printed_total_gross_area: 30000 }));
  applyToolCall(st2, reg(row({ table_id: 'J-4', building_number: '1201', name: 'HQ wing A', gross_area: 30000, source: { file: J4, page: 3, excerpt: '1201 | HQ wing A | 30,000' } })));
  applyToolCall(st2, reg(row({ table_id: 'J-4', building_number: '1201', name: 'Headquarters', gross_area: 31000, source: { file: AM2, page: 1, excerpt: 'Bldg 1201 revised to 31,000 SF' } })));
  assert.deepEqual([...st2.facilities.values()].map((f) => f.grossSqft), [31000]);
  assert.equal(applyToolCall(st2, finishCall()).isError, false);
});

test('the same building printed twice in one table under the same name: finish asks for line items; rows resent with line_item become separate lines', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'J-4', pages: '3', row_count: 3, printed_total_gross_area: 32755 }));
  const l1 = { table_id: 'J-4', building_number: '2000', name: 'Wing HQ', gross_area: 6215, source: { file: J4, page: 3, excerpt: '2000 | Wing HQ | Level 1 | 6,215' } };
  const l2 = { table_id: 'J-4', building_number: '2000', name: 'Wing HQ', gross_area: 18540, source: { file: J4, page: 3, excerpt: '2000 | Wing HQ | Level 2 | 18,540' } };
  const gym = row({ table_id: 'J-4', building_number: '2001', name: 'Gym', gross_area: 8000, source: { file: J4, page: 3, excerpt: '2001 | Gym | 8,000' } });
  const r = applyToolCall(st, reg(row(l1), row(l2), gym));
  // the same name could be a correction: the tool cannot tell, so it asks
  assert.match(r.resultText, /Check: 2000 is listed twice in J-4 with different areas \(6,215 and 18,540 SF\) and only one area is kept \(18,540 SF\) - if the rows are separately priced parts of the building .* resend both rows with line_item/);
  const f1 = applyToolCall(st, finishCall());
  assert.equal(f1.isError, true);
  assert.match(f1.resultText, /J-4: 2000 is printed on 2 rows with different areas \(6,215 and 18,540 SF\) but the inventory keeps one building of 18,540 SF - .*resend each row with line_item/);
  // a row that only adds data and names a line not registered yet is held until it is
  const held = applyToolCall(st, reg(row({ building_number: '2000', name: 'Wing HQ', line_item: 'Level 1', gross_area: null, service_level: '3x_week', source: { file: J4, page: 5, excerpt: '2000 Level 1: 3x/week' } })));
  assert.match(held.resultText, /Held 1 row/);
  // resending both rows with line_item moves each printed row to its own line
  const re = applyToolCall(st, reg(row({ ...l1, line_item: 'Level 1' }), row({ ...l2, line_item: 'Level 2' })));
  assert.equal(re.isError, false, re.resultText);
  assert.match(re.resultText, /Applied 1 held row to 2000/);
  const lines = byBn([...st.facilities.values()], '2000').map((f) => [f.name, f.grossSqft, f.serviceLevel]).sort((a, b) => Number(a[1]) - Number(b[1]));
  assert.deepEqual(lines, [['Wing HQ – Level 1', 6215, '3x_week'], ['Wing HQ – Level 2', 18540, 'daily_5']]);
  assert.equal(st.tables.get('J-4')!.rows.size, 3);
  const f2 = applyToolCall(st, finishCall());
  assert.equal(f2.isError, false, f2.resultText);
  // a later revision of one line targets it by line_item; a revision that does not say which line is refused
  const am = applyToolCall(st, reg(row({ building_number: '2000', name: 'Wing HQ', line_item: 'level 2', gross_area: 19000, source: { file: AM2, page: 1, excerpt: 'Bldg 2000 Level 2 re-measured 19,000' } })));
  assert.equal(am.isError, false, am.resultText);
  assert.deepEqual(byBn([...st.facilities.values()], '2000').map((f) => f.grossSqft).sort((a, b) => a - b), [6215, 19000]);
  const amb = applyToolCall(st, reg(row({ building_number: '2000', name: 'Wing Headquarters', gross_area: null, status: 'deleted_by_amendment', status_reason: 'Deleted by Amendment 0002', source: { file: AM2, page: 2, excerpt: 'Delete Bldg 2000' } })));
  assert.equal(amb.isError, true);
  assert.match(amb.resultText, /2000: this building is registered as 2 separate line items \("Level [12]", "Level [12]"\) - set line_item to the line this row belongs to, or send the row once for each line it applies to/);
  const fin = finalize(st);
  assert.deepEqual(fin.warnings, []);
  assert.equal(new Set(fin.inventory.facilities.map((f) => f.id)).size, 3);
  // ids carry the line item, so they do not depend on read order
  assert.ok(fin.inventory.facilities.some((f) => f.id === 'b-2000--level-1'), JSON.stringify(fin.inventory.facilities.map((f) => f.id)));
});

test('line items: rows sent with line_item from the start are separate lines; a line item of a building also registered as a whole is flagged', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'J-4', pages: '3', row_count: 2, printed_total_gross_area: 24755 }));
  const r = applyToolCall(st, reg(
    row({ table_id: 'J-4', building_number: '2000', name: 'Wing HQ', line_item: 'Level 1', gross_area: 6215, source: { file: J4, page: 3, excerpt: '2000 | Wing HQ | Level 1 | 6,215' } }),
    row({ table_id: 'J-4', building_number: '2000', name: 'Wing HQ', line_item: 'Level 2', gross_area: 18540, source: { file: J4, page: 3, excerpt: '2000 | Wing HQ | Level 2 | 18,540' } }),
  ));
  assert.match(r.resultText, /Registered 2 of 2 rows \(2 facilities in total\)/);
  assert.doesNotMatch(r.resultText, /Check:|Note:/);
  assert.equal(applyToolCall(st, finishCall()).isError, false);
  assert.deepEqual(finalize(st).inventory.facilities.map((f) => [f.id, f.name, f.grossSqft, f.notes]), [['b-2000--level-1', 'Wing HQ – Level 1', 6215, 'Line item: Level 1'], ['b-2000--level-2', 'Wing HQ – Level 2', 18540, 'Line item: Level 2']]);
  // a name that already says what the line is stays as printed
  const st2 = createState(DOCS);
  applyToolCall(st2, reg(row({ building_number: '7', name: 'Clinic - East Wing', line_item: 'East Wing', gross_area: 100 })));
  assert.equal([...st2.facilities.values()][0].name, 'Clinic - East Wing');
  // the building registered whole from one table, then line items from another: the double count is pointed out
  const st3 = createState(DOCS);
  applyToolCall(st3, reg(row({ table_id: 'J-1', building_number: '2000', name: 'Wing HQ', gross_area: 24755, source: { file: J4, page: 1, excerpt: '2000 | Wing HQ | 24,755' } })));
  const w = applyToolCall(st3, reg(row({ table_id: 'J-4', building_number: '2000', name: 'Wing HQ', line_item: 'Level 1', gross_area: 6215, source: { file: J4, page: 3, excerpt: '2000 | Level 1 | 6,215' } })));
  assert.match(w.resultText, /2000 is also registered without a line item \("Wing HQ" 24,755 SF\): if that row is the whole building and the line items are its parts, resend it with status excluded/);
});

test('lines split off by name are addressed by that name: a deletion sent with line_item applies to the line, never to a new empty one', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'J-4', pages: '3', row_count: 2, printed_total_gross_area: 24755 }));
  applyToolCall(st, reg(
    row({ table_id: 'J-4', building_number: '2000', name: 'Wing HQ - Command Section', gross_area: 6215, source: { file: J4, page: 3, excerpt: '2000 | Wing HQ - Command Section | 6,215' } }),
    row({ table_id: 'J-4', building_number: '2000', name: 'Wing HQ - Staff Agencies', gross_area: 18540, source: { file: J4, page: 3, excerpt: '2000 | Wing HQ - Staff Agencies | 18,540' } }),
  ));
  const del = (line: string) => row({ building_number: '2000', name: 'Wing HQ', line_item: line, gross_area: null, status: 'deleted_by_amendment', status_reason: 'Deleted by Amendment 0002', source: { file: AM2, page: 1, excerpt: `Delete 2000 ${line}` } });
  const amb = applyToolCall(st, reg(row({ ...del(''), line_item: null })));
  assert.match(amb.resultText, /registered as 2 separate line items \("Wing HQ - Command Section", "Wing HQ - Staff Agencies"\) - set line_item/);
  // the names the error lists work as line_item (the first row and the row split from it)
  applyToolCall(st, reg(del('Wing HQ - Staff Agencies'), del('wing hq – command section')));
  const fs = [...st.facilities.values()];
  assert.equal(fs.length, 2);
  assert.deepEqual(fs.map((f) => [f.grossSqft, f.status]), [[6215, 'deleted_by_amendment'], [18540, 'deleted_by_amendment']]);
});

test('a row tagged with a table whose declared rows are all registered revises the building (no split); an unwanted split is undone by line_item', () => {
  // a Word file holding the base table and its addendum (no page numbers): the addendum row is tagged with the base table
  const DOC = 'Janitorial-RFP-with-Addendum-1.docx';
  const r0 = (o: Record<string, unknown>) => row({ table_id: 'T1', source: { file: DOC, page: null, excerpt: `${o.building_number} | ${o.name} | ${o.gross_area}` }, ...o });
  const base = [r0({ building_number: '1', name: 'Admin', gross_area: 5000 }), r0({ building_number: '2', name: 'Gym', gross_area: 8000 }), r0({ building_number: '3', name: 'Shop', gross_area: 3000 })];
  const addendum = row({ table_id: 'T1', building_number: 'Site 2', name: 'Gymnasium (revised)', gross_area: 9000, source: { file: DOC, page: null, excerpt: 'Addendum 1 item 3: Site 2 Gymnasium revised to 9,000 SF' } });
  const st = createState([{ name: DOC }]);
  applyToolCall(st, { name: 'declare_tables', input: { tables: [{ table_id: 'T1', title: 'Facility Summary', kind: 'facilities', file: DOC, pages: null, row_count: 3, printed_total_gross_area: 16000, area_unit: 'sf' }] } });
  applyToolCall(st, reg(...base));
  const r = applyToolCall(st, reg(addendum));
  assert.doesNotMatch(r.resultText, /separate line item/);
  assert.deepEqual([...st.facilities.values()].map((f) => [f.buildingNumber, f.grossSqft]), [['1', 5000], ['2', 9000], ['3', 3000]]);
  // without a declared row count the second row is split off; resending it with line_item set to the first row's name
  // (as the note says) moves it back onto that building
  const st2 = createState([{ name: DOC }]);
  applyToolCall(st2, reg(...base));
  const s = applyToolCall(st2, reg(addendum));
  assert.match(s.resultText, /"Gymnasium \(revised\)" is registered as a separate line item .* if this row revises "Gym" instead, resend it with line_item set to that name/);
  assert.equal(st2.facilities.size, 4);
  applyToolCall(st2, reg({ ...addendum, line_item: 'Gym' }));
  assert.deepEqual([...st2.facilities.values()].map((f) => [f.buildingNumber, f.grossSqft]), [['1', 5000], ['2', 9000], ['3', 3000]]);
});

test('grounds: Type I/II/III/IV and BASH mapping, frequency wins over label, links resolved at the end', () => {
  assert.equal(mapGroundsLabel('Type I'), 'improved_turf');
  assert.equal(mapGroundsLabel('Type II'), 'semi_improved');
  assert.equal(mapGroundsLabel('Type III'), 'unimproved');
  assert.equal(mapGroundsLabel('Type IV'), 'unimproved');
  assert.equal(mapGroundsLabel('BASH area', 'every 2 weeks'), 'semi_improved');
  assert.equal(mapGroundsLabel('BASH area', '3 times per year'), 'unimproved');
  assert.equal(mapGroundsLabel('Type I', '2x per year'), 'unimproved');
  assert.equal(mapGroundsLabel('Ball field'), 'athletic_field');

  const st = createState(DOCS);
  // grounds registered before their building: the link is made in finalize
  const g = applyToolCall(st, { name: 'register_grounds', input: { areas: [
    { name: 'HQ lawn', kind: 'Type I', document_label: 'Type I', quantity: 2.5, unit: 'acres', facility_building_number: '0012', campus: 'Main Post', source: { excerpt: 'a' }, confidence: 0.9 },
    { name: 'Ball field N', kind: 'athletic_field', quantity: 5, unit: 'acres', source: { excerpt: 'n' }, confidence: 0.9 },
    { name: 'Ball field S', kind: 'athletic_field', quantity: 5, unit: 'acres', source: { excerpt: 's' }, confidence: 0.9 },
    { name: 'Ball field S', kind: 'athletic_field', quantity: 5, unit: 'acres', source: { excerpt: 's' }, confidence: 0.9 },
    { name: 'Total improved', kind: 'improved_turf', quantity: 12.5, unit: 'acres', source: { excerpt: '' }, confidence: 0.9 },
    { name: 'Range 7', kind: 'Type III', quantity: 640, unit: 'acres', status: 'excluded', status_reason: 'ITAM', source: { excerpt: '' }, confidence: 0.9 },
  ] } });
  assert.match(g.resultText, /Registered 3 grounds areas/);
  assert.match(g.resultText, /1 duplicates/);
  assert.match(g.resultText, /total row/);
  applyToolCall(st, reg(row({ campus: 'Main Post', building_number: '12', name: 'HQ', gross_area: 45200 })));
  const inv = finalize(st).inventory;
  assert.equal(inv.grounds.length, 3); // two equal 5-acre fields kept, the duplicate resend and the total dropped
  const lawn = inv.grounds.find((x) => x.name === 'HQ lawn')!;
  assert.equal(lawn.kind, 'improved_turf');
  assert.equal(lawn.facilityId, [...st.facilities.keys()][0]);
  assert.match(inv.site.notes ?? '', /Out-of-scope grounds: Range 7/);
});

test('later passes keep state; each pass needs its own finish', () => {
  const st = createState([{ name: 'a.pdf' }, { name: 'b.pdf' }]);
  beginPass(st, ['a.pdf']);
  applyToolCall(st, reg(row({ building_number: '1', name: 'A', gross_area: 100, source: { file: null, excerpt: '' } })));
  assert.equal([...st.facilities.values()][0].source?.file, 'a.pdf'); // single-document pass attributes the file
  applyToolCall(st, { name: 'finish', input: { summary: 'a', unresolved: [] } });
  beginPass(st, ['b.pdf']);
  applyToolCall(st, reg(row({ building_number: '2', name: 'B', gross_area: 100, source: { file: null, excerpt: '' } })));
  const fin = finalize(st);
  assert.equal(fin.inventory.facilities.length, 2);
  assert.ok(fin.warnings.includes('AI pass 2 ended without calling finish - the inventory may be incomplete.'));
  assert.ok(!fin.warnings.some((w) => w.startsWith('AI pass 1 ')));
});

test('tool schemas: additionalProperties false everywhere, strict tools within the API budget', () => {
  type S = { type?: unknown; properties?: Record<string, S>; items?: S; required?: string[]; additionalProperties?: unknown; anyOf?: S[] };
  const walk = (s: S, visit: (s: S) => void) => { visit(s); for (const v of Object.values(s.properties ?? {})) walk(v, visit); if (s.items) walk(s.items, visit); };
  let unions = 0; let optional = 0; let strictCount = 0;
  for (const t of extractionTools({ strict: true })) {
    const schema = t.input_schema as unknown as S;
    walk(schema, (s) => { if (s.properties) assert.equal(s.additionalProperties, false, `${t.name}: object without additionalProperties: false`); });
    if (!t.strict) continue;
    strictCount++;
    walk(schema, (s) => {
      if (Array.isArray(s.type) && s.type.length > 1) unions++;
      if (s.anyOf) unions++;
      if (s.properties) optional += Object.keys(s.properties).filter((k) => !(s.required ?? []).includes(k)).length;
    });
  }
  assert.ok(strictCount >= 3);
  assert.ok(unions <= 16, `strict union-typed parameters: ${unions}`);
  assert.equal(optional, 0);
  assert.ok(extractionTools({ strict: false }).every((t) => !t.strict));
  assert.deepEqual(extractionTools().map((t) => t.name), ['declare_tables', 'register_facilities', 'register_grounds', 'set_site_info', 'set_previous_award', 'finish']);
});

// ------------------------------------------------------------------------------------------------
// gross vs cleanable, added areas, held rows, revision rows, grounds totals, the finish gate
// ------------------------------------------------------------------------------------------------

const declare = (...tables: Record<string, unknown>[]): ToolCall => ({ name: 'declare_tables', input: { tables: tables.map((t) => ({ title: t.table_id, kind: 'facilities', file: J4, pages: null, row_count: null, printed_total_gross_area: null, area_unit: 'sf', printed_totals: [], ...t })) } });
const finishCall = (unresolved: string[] = []): ToolCall => ({ name: 'finish', input: { summary: 'done', unresolved } });

test('added_areas: units printed outside the area column are added to the gross; the table reconciles against the printed column', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'EX-A', row_count: 3, printed_total_gross_area: 147086 }));
  const r = applyToolCall(st, reg(
    row({ table_id: 'EX-A', building_number: '201', name: 'Alder Creek ES', gross_area: 51340, added_areas: [{ label: 'portable classrooms', count: 4, unit_area: 960 }], cleanable_equals_gross: true }),
    // mixed unit sizes in one cell: one entry per size
    row({ table_id: 'EX-A', building_number: '205', name: 'Fernhill ES', gross_area: '44,286', added_areas: [{ label: 'portables', count: 2, unit_area: 960 }, { label: 'double portable', count: 1, unit_area: '1,792' }] }),
    row({ table_id: 'EX-A', building_number: '202', name: 'Birchwood ES', gross_area: 51460, added_areas: [] }),
  ));
  assert.equal(r.isError, false, r.resultText);
  const inv = finalize(st).inventory;
  const alder = byBn(inv.facilities, '201')[0];
  assert.equal(alder.grossSqft, 55180);
  assert.equal(alder.cleanableSqft, 55180); // cleanable_equals_gross includes the added units
  assert.match(alder.notes ?? '', /Gross = 51,340 SF printed \+ portable classrooms 4 @ 960 \(3,840 SF\) = 55,180 SF/);
  assert.equal(byBn(inv.facilities, '205')[0].grossSqft, 47998);
  assert.equal(byBn(inv.facilities, '202')[0].grossSqft, 51460);
  // the printed total is the sum of the printed column (51,340 + 44,286 + 51,460), not of the summed gross
  assert.equal(applyToolCall(st, finishCall()).isError, false);
  assert.deepEqual(finalize(st).warnings, []);
  // units are in area_unit and converted by the tool; units without a building area are refused
  const sm = createState(DOCS);
  applyToolCall(sm, reg(row({ building_number: '7', name: 'Annexed HQ', gross_area: 1000, area_unit: 'sm', added_areas: [{ label: 'annex', count: null, unit_area: 100 }] })));
  assert.equal([...sm.facilities.values()][0].grossSqft, 11840); // 1,100 m² × 10.7639
  const bad = applyToolCall(sm, reg(row({ building_number: '8', name: 'X', gross_area: null, added_areas: [{ label: 'portables', count: 2, unit_area: 960 }] })));
  assert.equal(bad.isError, true);
  assert.match(bad.resultText, /8: added_areas need the building area too/);
  assert.match(applyToolCall(sm, reg(row({ building_number: '9', name: 'Y', gross_area: 100, added_areas: [{ label: 'portables', count: 2, unit_area: 'n/a?' }] }))).resultText, /unit_area .* must be the printed area of one unit/);
});

test('cleanable larger than gross is rejected for every affected row, with the remedy; within 5 SF is accepted', () => {
  const st = createState(DOCS);
  const rows = Array.from({ length: 11 }, (_, i) => row({ building_number: String(301 + i), name: `School ${i}`, gross_area: 50000, cleanable_area: 50000 + 1000 * (i + 1) }));
  // 1.8 % over (below the old 2 % advisory threshold) and a 4 SF rounding difference
  rows.push(row({ building_number: '320', name: 'Timberline MS', gross_area: 104315, cleanable_area: 106235 }), row({ building_number: '321', name: 'Rounding', gross_area: 10000, cleanable_area: 10004 }));
  const r = applyToolCall(st, reg(...rows));
  assert.equal(st.facilities.size, 1);
  assert.match(r.resultText, /Rejected 12: 301: cleanable_area \(51,000 SF\) exceeds the gross area \(50,000 SF\)/);
  assert.match(r.resultText, /… 4 more \(309, 310, 311, 320\)/); // every rejected row is named
  assert.equal(r.resultText.split('cleanable is part of gross').length - 1, 1); // the remedy once
  assert.match(r.resultText, /it is the gross area: give the building area in gross_area and the structures in added_areas\. If the columns are swapped, swap them\./);
  // a row that only adds a cleanable area is checked against the registered gross
  const u = applyToolCall(st, reg(row({ building_number: '321', name: 'Rounding', gross_area: null, cleanable_area: 12000 })));
  assert.equal(u.isError, true);
  assert.match(u.resultText, /321: cleanable_area \(12,000 SF\) exceeds the gross area \(10,000 SF\)/);
  // a revised (smaller) gross makes an earlier, larger cleanable area stale: it is not carried over
  const st2 = createState(DOCS);
  applyToolCall(st2, reg(row({ building_number: '5', name: 'Gym', gross_area: 20000, cleanable_area: 18000 })));
  applyToolCall(st2, reg(row({ building_number: '5', name: 'Gym', gross_area: 15000, source: { file: AM2, page: 1, excerpt: 'Bldg 5 revised to 15,000 SF' } })));
  const gym = [...st2.facilities.values()][0];
  assert.equal(gym.grossSqft, 15000);
  assert.equal(gym.cleanableSqft, undefined);
});

test('cleanable is its own field group: a later row that prints only a corrected cleanable area wins over the base (any read order)', () => {
  const AM3 = 'Amendment 0003.pdf';
  const docs = [...DOCS, { name: AM3 }];
  const base = reg(row({ table_id: 'J-4', building_number: '9', name: 'MH Clinic', gross_area: 31880, cleanable_area: 25150, source: { file: J4, page: 3, excerpt: '9 | MH Clinic | 31,880 | 25,150' } }));
  const csfOnly = reg(row({ building_number: '9', name: 'MH Clinic', gross_area: null, cleanable_area: 26690, status: null, source: { file: AM2, page: 1, excerpt: 'Bldg 9 Total CSF 25,150 → 26,690; GSF unchanged' } }));
  for (const order of [[base, csfOnly], [csfOnly, base]]) {
    const st = createState(docs);
    for (const c of order) assert.equal(applyToolCall(st, c).isError, false);
    const f = [...st.facilities.values()][0];
    assert.equal(f.grossSqft, 31880);
    assert.equal(f.cleanableSqft, 26690, `${order[0] === csfOnly ? 'amendment first' : 'base first'}`);
    assert.match(f.notes ?? '', /Superseded 25,150 cleanable SF from Attachment J-4 Facility List\.xlsx/);
  }
  // the same document, a later row (an amendment section of a combined file): the later row wins too
  const st = createState(DOCS);
  applyToolCall(st, base);
  applyToolCall(st, reg(row({ building_number: '9', name: 'MH Clinic', gross_area: null, cleanable_area: 26690, status: null, source: { file: J4, page: 8, excerpt: 'Item 3: Total CSF 26,690' } })));
  assert.equal([...st.facilities.values()][0].cleanableSqft, 26690);
  // an estimated area (area_missing) never overrides a printed cleanable area
  const st2 = createState(DOCS);
  applyToolCall(st2, reg(row({ building_number: '5', name: 'Shop', gross_area: 2000, cleanable_area: 1000 })));
  applyToolCall(st2, reg(row({ building_number: '5', name: 'Shop', gross_area: null, area_missing: true, estimated_gross_area: 2500, cleanable_equals_gross: true, source: { file: AM2, excerpt: 'Bldg 5 area TBD' } })));
  assert.deepEqual([...st2.facilities.values()].map((f) => [f.grossSqft, f.cleanableSqft]), [[2000, 1000]]);
  // a later row's cleanable area that no longer fits the kept gross (a higher-ranked document revised it down) is reported
  const st3 = createState(docs);
  applyToolCall(st3, reg(row({ building_number: '6', name: 'Gym', gross_area: 15000, source: { file: AM3, excerpt: 'Bldg 6 revised to 15,000 SF' } })));
  const r = applyToolCall(st3, reg(row({ building_number: '6', name: 'Gym', gross_area: 20000, cleanable_area: 19000, source: { file: AM2, excerpt: 'Bldg 6 | 20,000 | 19,000' } })));
  assert.match(r.resultText, /Check: 6: cleanable_area 19,000 SF was not applied - it is larger than the building's gross area \(15,000 SF\)/);
  assert.deepEqual([...st3.facilities.values()].map((f) => [f.grossSqft, f.cleanableSqft]), [[15000, undefined]]);
});

test('printed square feet keep their decimals; floor areas by finish become the floor mix; seasonal and on-call service become days', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'GSU', row_count: 2, printed_total_gross_area: 2643.42 }));
  const r = applyToolCall(st, reg(
    row({ table_id: 'GSU', building_number: '101', name: 'Ops', gross_area: '2,207.75', cleanable_area: 2207.75, source: { file: J4, excerpt: '101 | 2,207.75' },
      floor_areas: { carpet: 1200, resilient: 700.75, hard_tile: 207, concrete: 0, wood: null, other: 100 } }),
    row({ table_id: 'GSU', building_number: '104', name: 'Restroom', gross_area: 435.67, source: { file: J4, excerpt: '104 | 435.67' },
      floor_areas: { hard_tile: 300 }, service_level: '3x_week', service_frequency_text: '3 x Week (APR-OCT only)', service_season: { start: 'APR', end: 'OCT', days_per_week: 3 } }),
  ));
  assert.equal(r.isError, false, r.resultText);
  assert.match(r.resultText, /104: floor_areas sum to 300 SF, not the gross area \(436 SF\)/);
  assert.doesNotMatch(r.resultText, /101: floor_areas/);
  const by = (bn: string) => byBn([...st.facilities.values()], bn)[0];
  assert.equal(by('101').grossSqft, 2207.75);
  assert.equal(by('104').grossSqft, 435.67);
  assert.deepEqual(by('101').floorMix, { carpet: 0.5693, resilient: 0.3325, hardTile: 0.0982, concrete: 0, wood: 0 }); // shares of the named finishes (2,107.75 SF)
  assert.match(by('101').notes ?? '', /Floor mix from printed SF by finish: carpet 1,200, resilient 701, hard tile 207, other 100 \(spread over the named finishes\)/);
  assert.equal(by('104').serviceDaysPerYear, 92); // Apr 1 – Oct 31 = 214 days × 3/7
  assert.equal(by('104').serviceLevel, '3x_week');
  assert.equal(applyToolCall(st, finishCall()).isError, false); // 2,643.42 printed
  assert.deepEqual(finalize(st).warnings, []);
  // a stated number of days wins over the counted season; on-call events are service days; an unreadable season is reported
  const st2 = createState(DOCS);
  const r2 = applyToolCall(st2, reg(
    row({ building_number: '18', name: 'Beach House', gross_area: 1000, service_level: 'daily_7', service_season: { start: 'May 29', end: 'Sep 6', days_per_week: null } }),
    row({ building_number: '19', name: 'Marina', gross_area: 1000, service_days_per_year: 160, service_season: { start: 'May 1', end: 'Oct 15', days_per_week: 7 } }),
    row({ building_number: '21', name: 'Fairgrounds Hall', gross_area: 1000, events_per_year: 24 }),
    row({ building_number: '22', name: 'Pavilion', gross_area: 1000, service_season: { start: 'summer', end: 'fall', days_per_week: 7 } }),
  ));
  assert.equal(byBn([...st2.facilities.values()], '18')[0].serviceDaysPerYear, 100); // 101 calendar days at the daily_7 level (360 days a year)
  const m = byBn([...st2.facilities.values()], '19')[0];
  assert.equal(m.serviceDaysPerYear, 160);
  assert.match(m.notes ?? '', /Service season May 1 – Oct 15: 168 calendar days × 7 days\/week = 168 service days \(the document states 160\)/);
  assert.equal(byBn([...st2.facilities.values()], '21')[0].serviceDaysPerYear, 24);
  assert.equal(byBn([...st2.facilities.values()], '22')[0].serviceDaysPerYear, undefined);
  assert.match(r2.resultText, /22: service_season "summer – fall" was not understood/);
});

test('season windows: months, dates, holidays and windows across the year end are counted in code', () => {
  assert.deepEqual(seasonServiceDays('Memorial Day', 'Labor Day', 7), { calendarDays: 100, days: 100 });
  assert.deepEqual(seasonServiceDays('May 29', 'Sep 6', 7), { calendarDays: 101, days: 101 });
  assert.deepEqual(seasonServiceDays('May 1 – Oct 15', null, 7), { calendarDays: 168, days: 168 });
  assert.deepEqual(seasonServiceDays('APR-OCT', null, 3), { calendarDays: 214, days: 92 });
  assert.deepEqual(seasonServiceDays('November', 'March', 5), { calendarDays: 151, days: 108 });
  assert.deepEqual(seasonServiceDays('5/1', '10/15', 7), { calendarDays: 168, days: 168 });
  assert.equal(seasonDay('15 October', true), seasonDay('Oct 15th', true));
  assert.equal(seasonServiceDays('spring', 'fall', 7), undefined);
});

test('restroom rooms, cleaning standard and areas by class are kept with the facility (class areas checked against the cleanable area)', () => {
  const st = createState(DOCS);
  const r = applyToolCall(st, reg(
    row({ building_number: '1', name: 'Main Hospital', gross_area: 486240, cleanable_area: 319615, cleaning_detail: { restroom_rooms: 152, cleaning_standard: 'Code A', area_by_class: [{ label: 'High Risk', area: 58960 }, { label: 'Moderate Risk', area: 173885 }, { label: 'Low Risk', area: 86770 }] } }),
    row({ building_number: '2', name: 'Clinic', gross_area: 10000, cleanable_area: 9000, area_by_class: [{ label: 'High Risk', area: 1000 }, { label: 'Low Risk', area: 2000 }] }),
  ));
  assert.equal(r.isError, false);
  const f = byBn([...st.facilities.values()], '1')[0];
  assert.match(f.notes ?? '', /Restroom rooms: 152; Area by class: High Risk 58,960 SF, Moderate Risk 173,885 SF, Low Risk 86,770 SF; Cleaning standard: Code A/);
  assert.equal(f.restroomFixtures, undefined); // rooms are not fixtures
  assert.match(r.resultText, /2: area_by_class sums to 3,000 SF, not the cleanable area \(9,000 SF\)/);
  assert.doesNotMatch(r.resultText, /1: area_by_class/);
});

test('cleanable_equals_gross: the tool sets cleanable to the gross (converted, with added areas); a different printed cleanable is kept', () => {
  const st = createState(DOCS);
  applyToolCall(st, reg(
    row({ building_number: '12', name: 'Uffici', gross_area: 1240, area_unit: 'sm', cleanable_area: null, cleanable_equals_gross: true }),
    row({ building_number: '13', name: 'Repeats gross', gross_area: 1000, cleanable_area: 1000, cleanable_equals_gross: true, added_areas: [{ label: 'annex', count: 1, unit_area: 200 }] }),
    row({ building_number: '14', name: 'Own cleanable', gross_area: 1000, cleanable_area: 800, cleanable_equals_gross: true }),
    row({ building_number: '15', name: 'Later', gross_area: 2000 }),
  ));
  const by = (bn: string) => byBn([...st.facilities.values()], bn)[0];
  assert.equal(by('12').grossSqft, 13347);
  assert.equal(by('12').cleanableSqft, 13347);
  assert.equal(by('13').cleanableSqft, 1200);
  assert.equal(by('14').cleanableSqft, 800);
  // on a row that gives no area it resolves against the registered building
  applyToolCall(st, reg(row({ building_number: '15', name: 'Later', gross_area: null, cleanable_equals_gross: true, source: { file: J4, page: 9, excerpt: 'note 4: gross applies' } })));
  assert.equal(by('15').cleanableSqft, 2000);
});

test('rows without an area for a building not registered yet are held and applied when it is; finish lists rows still held', () => {
  const docs = [{ name: 'TE.pdf', role: 'attachment' as const }];
  const st = createState(docs);
  applyToolCall(st, declare({ table_id: 'TE 5-1', kind: 'dining', file: 'TE.pdf', pages: '3', row_count: 2, area_unit: null }), );
  applyToolCall(st, declare({ table_id: 'TE 6-1', file: 'TE.pdf', pages: '5', row_count: 1, printed_total_gross_area: 28460 }));
  // the dining table comes first in the document and prints no areas
  const dining = (bn: string, hc: number) => ({ table_id: 'TE 5-1', building_number: bn, name: `DFAC ${bn}`, gross_area: null, area_missing: false, area_unit: 'sf', status: null, dining: { meal_periods: [{ period: 'Lunch', weekday_headcount: hc, weekend_headcount: null }], meals_per_day: null, days_per_week: 5, service_style: 'full_food_service' }, source: { file: 'TE.pdf', page: 3, excerpt: `${bn} | ${hc}` }, confidence: 0.9 });
  const r1 = applyToolCall(st, reg(dining('4120', 900), dining('4130', 400)));
  assert.equal(r1.isError, false);
  assert.equal(st.facilities.size, 0);
  assert.match(r1.resultText, /Held 2 rows without an area for buildings not registered yet \(4120, 4130\)/);
  assert.match(r1.resultText, /TE 5-1: 0 of 2 rows \(\+2 held\)/);
  const r2 = applyToolCall(st, reg(row({ table_id: 'TE 6-1', building_number: '4120', name: 'Warrior Restaurant', gross_area: 28460, source: { file: 'TE.pdf', page: 5, excerpt: '4120 | 28,460' } })));
  assert.match(r2.resultText, /Applied 1 held row to 4120/);
  const dfac = byBn([...st.facilities.values()], '4120')[0];
  assert.equal(dfac.grossSqft, 28460);
  assert.equal(dfac.dining?.mealsPerDay, 900);
  assert.equal(st.facilities.size, 1);
  // 4130 is never registered: finish shows it once (and TE 5-1 is one row short), then accepts the explanation
  const f1 = applyToolCall(st, finishCall());
  assert.equal(f1.isError, true);
  assert.match(f1.resultText, /4130: 1 row from TE 5-1 add data to building 4130, which was never registered with an area/);
  assert.match(f1.resultText, /TE 5-1: 1 of 2 rows registered/);
  assert.equal(applyToolCall(st, finishCall(['4130 / TE 5-1: the DFAC is closed; no area anywhere in the package'])).isError, false);
  assert.ok(finalize(st).warnings.some((w) => /1 row without an area that only add data were never matched to a registered building and were dropped: 4130 \(TE 5-1\)/.test(w)));
});

test('a revision row from outside the table (amendment tagged with the base table id) keeps the table as printed, in any order', () => {
  const docs = [{ name: 'RFP.pdf', role: 'solicitation' as const }];
  const base = row({ table_id: 'C-1', building_number: 'PB-3', name: 'Restroom', gross_area: 2240, source: { file: 'RFP.pdf', page: 9, excerpt: 'PB-3 | 2,240' } });
  const other = row({ table_id: 'C-1', building_number: 'PB-4', name: 'Restroom 4', gross_area: 860, source: { file: 'RFP.pdf', page: 9, excerpt: 'PB-4 | 860' } });
  const revision = row({ table_id: 'C-1', building_number: 'PB-3', name: 'Restroom', gross_area: 2420, source: { file: 'RFP.pdf', page: 12, excerpt: 'Addendum d. PB-3 revised from 2,240 to 2,420' } });
  for (const order of [[base, other, revision], [revision, base, other]]) {
    const st = createState(docs);
    applyToolCall(st, declare({ table_id: 'C-1', file: 'RFP.pdf', pages: '9', row_count: 2, printed_total_gross_area: 3100 }));
    const results = order.map((r0) => applyToolCall(st, reg(r0)));
    // (rows of one document merge in call order, so the area check only applies when the revision comes later)
    if (order[2] === revision) assert.equal(byBn([...st.facilities.values()], 'PB-3')[0].grossSqft, 2420);
    const f = applyToolCall(st, finishCall());
    assert.equal(f.isError, false, f.resultText);
    const fin = finalize(st);
    assert.deepEqual(fin.warnings, [], JSON.stringify(fin.warnings));
    if (order[2] === revision) assert.match(results[2].resultText, /PB-3: the row from p\. 12 lies outside C-1 \(pages 9\); it revises the building, and C-1 keeps its printed row/);
  }
  // another document: same rule by file
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'J-4', row_count: 1, printed_total_gross_area: 45200 }));
  applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '12', name: 'HQ', gross_area: 45200, source: { file: J4, page: 3, excerpt: '12 | 45,200' } })));
  applyToolCall(st, reg(row({ table_id: 'J-4', building_number: '12', name: 'HQ', gross_area: 47900, source: { file: AM2, page: 1, excerpt: 'Bldg 12 revised to 47,900' } })));
  assert.equal(applyToolCall(st, finishCall()).isError, false);
  assert.equal([...st.facilities.values()][0].grossSqft, 47900);
});

test('grounds: a printed row with several quantities is one table row; an amendment row revising a listed site is not another', () => {
  const docs = [{ name: 'RFP.pdf', role: 'solicitation' as const }];
  const area = (name: string, kind: string, qty: number, unit: string, page: number, excerpt: string, o: Record<string, unknown> = {}) => ({ name, table_id: 'A-1', campus: null, facility_building_number: null, kind, document_label: null, status: 'in_scope', status_reason: null, quantity: qty, unit, source: { file: 'RFP.pdf', page, excerpt }, confidence: 0.9, ...o });
  const site1 = '1 | Harmon Park | 21.40 | 6.20 | 4 / 7.8 | 6,850 | 214';
  const site9 = '9 | Creekside Greenway | 6.40 | 18.60';
  const rows = [
    area('Site 1 Harmon Park – turf', 'improved_turf', 21.4, 'acres', 6, site1), area('Site 1 Harmon Park – rough', 'unimproved', 6.2, 'acres', 6, site1),
    area('Site 1 Harmon Park – ballfields', 'athletic_field', 7.8, 'acres', 6, site1), area('Site 1 Harmon Park – beds', 'shrub_bed', 6850, 'sqft', 6, site1),
    area('Site 1 Harmon Park – trees', 'tree_canopy', 214, 'each', 6, site1),
    area('Site 14 Wexford – turf', 'semi_improved', 0.48, 'acres', 6, '14 | Wexford | 0.48', { status: 'deleted_by_amendment', status_reason: 'Addendum 1' }),
    // the addendum revises Site 9 turf (registered instead of the base figure) before the base row's other quantity
    area('Site 9 Creekside Greenway – mowable turf', 'semi_improved', 7.15, 'acres', 12, 'Addendum b. Site 9 turf revised from 6.40 to 7.15'),
    area('Site 9 Creekside Greenway – rough mow', 'unimproved', 18.6, 'acres', 6, site9),
  ];
  const st = createState(docs);
  applyToolCall(st, declare({ table_id: 'A-1', kind: 'grounds', file: 'RFP.pdf', pages: '6-7', row_count: 3, area_unit: null }));
  const r = applyToolCall(st, { name: 'register_grounds', input: { areas: rows } });
  assert.match(r.resultText, /Registered 7 grounds areas in scope and 1 out of scope \(7 in scope \+ 1 out of scope in total\)/);
  assert.match(r.resultText, /Progress: A-1: 3 of 3 rows/);
  const f = applyToolCall(st, finishCall());
  assert.equal(f.isError, false, f.resultText);
  assert.match(f.resultText, /7 grounds areas in scope \+ 1 out of scope/);
  // an amendment row for a site the table does not list is counted (it may be the only registration of a printed row)
  const st2 = createState(docs);
  applyToolCall(st2, declare({ table_id: 'A-1', kind: 'grounds', file: 'RFP.pdf', pages: '6-7', row_count: 2, area_unit: null }));
  applyToolCall(st2, { name: 'register_grounds', input: { areas: [area('Site 1 Harmon Park – turf', 'improved_turf', 21.4, 'acres', 6, site1), area('M-6 Kingsridge Road – median turf', 'improved_turf', 44520, 'sqft', 12, 'Addendum c. M-6 revised to 3,180 LF')] } });
  assert.equal(applyToolCall(st2, finishCall()).isError, false);
});

test('grounds printed totals: reconciled per unit and kind (in scope, or in scope + out of scope); gaps shown in the printed unit', () => {
  const area = (name: string, kind: string, qty: number, unit: string, o: Record<string, unknown> = {}) => ({ name, table_id: 'TE6', campus: null, facility_building_number: null, kind, document_label: null, status: 'in_scope', status_reason: null, quantity: qty, unit, source: { file: J4, page: 7, excerpt: `${name} | ${qty}` }, confidence: 0.9, ...o });
  const totals = [{ value: 126.6, unit: 'acres', kinds: ['improved_turf'] }, { value: 180.3, unit: 'acres', kinds: ['semi_improved'] }, { value: 211110, unit: 'sqyd', kinds: [] }, { value: 12, unit: 'hectares', kinds: ['unimproved'] }];
  const st = createState(DOCS);
  const d = applyToolCall(st, declare({ table_id: 'TE6', kind: 'grounds', row_count: null, area_unit: null, printed_totals: totals }));
  assert.match(d.resultText, /TE6 \(total 126\.6 acres improved_turf; total 180\.3 acres semi_improved; total 211,110 SY; total 12 ha unimproved\)/);
  applyToolCall(st, { name: 'register_grounds', input: { areas: [
    area('GA-1 Type I', 'improved_turf', 100.6, 'acres'), area('GA-2 Type I', 'improved_turf', 26, 'acres'),
    area('GA-1 Type II', 'semi_improved', 170.3, 'acres'), // 10 acres short
    area('Lot 1', 'parking', 183510, 'sqyd'), area('Walks', 'sidewalk', 27600, 'sqyd'),
    area('Range', 'unimproved', 10, 'hectares'), area('Old range', 'unimproved', 2, 'hectares', { status: 'excluded', status_reason: 'by others' }),
  ] } });
  const f = applyToolCall(st, finishCall());
  assert.equal(f.isError, true);
  assert.match(f.resultText, /TE6: registered 170\.3 acres semi_improved vs printed total 180\.3 acres semi_improved/);
  assert.doesNotMatch(f.resultText, /improved_turf vs|SY vs|ha unimproved vs/);
  applyToolCall(st, { name: 'register_grounds', input: { areas: [area('GA-3 Type II', 'semi_improved', 10, 'acres')] } });
  assert.equal(applyToolCall(st, finishCall()).isError, false);
  assert.deepEqual(finalize(st).warnings, []);
  // older declarations: a grounds table's printed_total_gross_area in its area_unit is a total too
  const st2 = createState(DOCS);
  applyToolCall(st2, declare({ table_id: 'TE6-3', kind: 'grounds', printed_total_gross_area: 211110, area_unit: 'sy' }));
  applyToolCall(st2, { name: 'register_grounds', input: { areas: [area('Lot 1', 'parking', 183510, 'sqyd', { table_id: 'TE6-3' })] } });
  assert.match(applyToolCall(st2, finishCall()).resultText, /TE6-3: registered 183,510 SY vs printed total 211,110 SY/);
  // a bad total is rejected with the reason
  assert.match(applyToolCall(createState(DOCS), declare({ table_id: 'X', kind: 'grounds', printed_totals: [{ value: 12, unit: 'furlongs', kinds: [] }] })).resultText, /needs a number and a unit/);
});

test('finish: a named gap is waived only after a refusal showed it; the counts report updates and out-of-scope areas', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', row_count: 12 }));
  // the only mention of G-1 explains something else (the unit), written before the count gap was ever shown
  const g = applyToolCall(st, { name: 'register_grounds', input: { areas: [{ name: 'Lawn', table_id: 'G-1', kind: 'improved_turf', quantity: 3, unit: 'acres', status: 'in_scope', source: { file: J4, page: 2, excerpt: 'Lawn | 3' }, confidence: 0.9 }] } });
  assert.match(g.resultText, /Progress: G-1: 1 of 12 rows/);
  const unresolved = ['G-1: acreage is printed in acres; no SF total could be declared'];
  const f1 = applyToolCall(st, finishCall(unresolved));
  assert.equal(f1.isError, true);
  assert.match(f1.resultText, /G-1: 1 of 12 rows registered/);
  const f2 = applyToolCall(st, finishCall(unresolved));
  assert.equal(f2.isError, false);
  assert.match(f2.resultText, /Accepted with 1 unreconciled item explained in unresolved: G-1: 1 of 12 rows registered/);
  // every merge into a registered building is an update
  const st2 = createState(DOCS);
  applyToolCall(st2, reg(row({ building_number: '1', name: 'A', gross_area: 100 }), row({ building_number: '2', name: 'B', gross_area: 100 })));
  const u = applyToolCall(st2, reg(row({ building_number: '1', name: 'A', gross_area: 120, source: { file: AM2, excerpt: 'a' } }), row({ building_number: '2', name: 'B', gross_area: null, service_level: 'weekly' })));
  assert.match(u.resultText, /2 updates of already-registered buildings/);
  assert.match(applyToolCall(st2, reg(row({ building_number: '1', name: 'A', gross_area: 120 }))).resultText, /1 update of already-registered buildings/);
});

// ------------------------------------------------------------------------------------------------
// grounds lengths, option-only grounds, grounds revisions, total bases, added service days, floor finishes, snow
// ------------------------------------------------------------------------------------------------

const RFP = 'RFP.pdf';
const gArea = (name: string, kind: string, qty: number, unit: string, excerpt: string, o: Record<string, unknown> = {}) => ({ name, table_id: 'G-1', campus: null, facility_building_number: null, kind, document_label: null, status: 'in_scope', status_reason: null, quantity: qty, unit, source: { file: RFP, page: 4, excerpt }, confidence: 0.9, ...o });
const regG = (...areas: Record<string, unknown>[]): ToolCall => ({ name: 'register_grounds', input: { areas } });

test('grounds: lengths (lf) are recorded as lengths, never areas; they count toward table rows and LF totals', () => {
  const st = createState([{ name: RFP, role: 'solicitation' as const }]);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 2, area_unit: null, printed_totals: [{ value: 2400, unit: 'sqft', kinds: ['sidewalk'] }, { value: 1500, unit: 'lf', kinds: ['sidewalk'] }] }));
  const r = applyToolCall(st, regG(
    gArea('North site – walks', 'sidewalk', 1000, 'sqft', 'North | 1,000 | 600'), gArea('North site – edging', 'sidewalk', 600, 'lf', 'North | 1,000 | 600'),
    // a length's kind only says what it runs along: an LF total naming another kind still covers it
    gArea('South site – walks', 'sidewalk', 1400, 'sqft', 'South | 1,400 | 900'), gArea('South site – edging', 'improved_turf', 900, 'lf', 'South | 1,400 | 900'),
  ));
  assert.equal(r.isError, false);
  assert.match(r.resultText, /Registered 2 grounds areas in scope/);
  assert.match(r.resultText, /Recorded as lengths, not areas: "North site – edging" 600 LF, "South site – edging" 900 LF\. A length is never added to sidewalk, parking or any other area/);
  assert.match(r.resultText, /Progress: G-1: 2 of 2 rows/);
  const f = applyToolCall(st, finishCall());
  assert.equal(f.isError, false, f.resultText);
  assert.match(f.resultText, /2 grounds areas in scope \+ 0 out of scope; 2 lengths \(LF\) recorded, not areas/);
  const fin = finalize(st);
  assert.deepEqual(fin.warnings, []);
  assert.deepEqual(fin.inventory.grounds.map((g) => [g.kind, g.quantity, g.unit]), [['sidewalk', 1000, 'sqft'], ['sidewalk', 1400, 'sqft']]);
  assert.match(fin.inventory.site.notes ?? '', /Lengths \(LF, not priced as areas\): North site – edging 600 LF; South site – edging 900 LF/);
  assert.equal(estimateInventory(fin.inventory).metrics.pavedSqft, 2400); // never 2,400 + 1,500 LF × an assumed width
  // a length alone is a valid call; a wrong LF total is a gap in LF
  const st2 = createState([{ name: RFP, role: 'solicitation' as const }]);
  applyToolCall(st2, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 1, area_unit: null, printed_totals: [{ value: 700, unit: 'lf', kinds: [] }] }));
  assert.equal(applyToolCall(st2, regG(gArea('Fence line', 'unimproved', 600, 'lf', 'Fence | 600'))).isError, false);
  assert.match(applyToolCall(st2, finishCall()).resultText, /G-1: registered 600 LF vs printed total 700 LF/);
});

test('grounds: option-only areas (an optional site) are out of the estimate; a base total without them reconciles', () => {
  const st = createState([{ name: RFP, role: 'solicitation' as const }]);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 3, area_unit: null, printed_totals: [{ value: 10, unit: 'acres', kinds: ['improved_turf'] }, { value: 3000, unit: 'sqyd', kinds: ['parking'] }] }));
  const r = applyToolCall(st, regG(
    gArea('Site A – turf', 'improved_turf', 6, 'acres', 'A | 6.0 | 2,000'), gArea('Site A – lot', 'parking', 2000, 'sqyd', 'A | 6.0 | 2,000'),
    gArea('Site B – turf', 'improved_turf', 4, 'acres', 'B | 4.0 | 1,000'), gArea('Site B – lot', 'parking', 1000, 'sqyd', 'B | 4.0 | 1,000'),
    gArea('Site C – turf', 'improved_turf', 2.5, 'acres', 'C | 2.5 | 800', { status: 'option_only', status_reason: 'OPTIONAL SITE – NOT INCLUDED IN BASE TOTALS' }),
    gArea('Site C – lot', 'parking', 800, 'sqyd', 'C | 2.5 | 800', { status: 'option_only', status_reason: 'OPTIONAL SITE – NOT INCLUDED IN BASE TOTALS' }),
  ));
  assert.match(r.resultText, /Registered 4 grounds areas in scope and 2 out of scope \(4 in scope \+ 2 out of scope in total\)/);
  const f = applyToolCall(st, finishCall());
  assert.equal(f.isError, false, f.resultText);
  const inv = finalize(st).inventory;
  assert.deepEqual(inv.grounds.map((g) => g.name), ['Site A – turf', 'Site A – lot', 'Site B – turf', 'Site B – lot']);
  assert.match(inv.site.notes ?? '', /Out-of-scope grounds: Site C – turf 2\.5 acres \(option_only: OPTIONAL SITE/);
  assert.equal(Math.round(estimateInventory(inv).metrics.acres * 100) / 100, 10);
});

test('grounds revisions: an amendment replaces the area\'s quantity, the table keeps its printed figure; a deletion takes it out', () => {
  const docs = [{ name: RFP, role: 'solicitation' as const }, { name: AM2, role: 'amendment' as const, amendment: 2 }];
  const st = createState(docs);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 2, area_unit: null, printed_totals: [{ value: 10, unit: 'acres', kinds: ['improved_turf'] }, { value: 3000, unit: 'sqyd', kinds: ['parking'] }] }));
  applyToolCall(st, regG(
    gArea('Site A – turf', 'improved_turf', 6, 'acres', 'A | 6.0 | 1,200 | 800'), gArea('Site A – POV parking', 'parking', 1200, 'sqyd', 'A | 6.0 | 1,200 | 800'),
    gArea('Site A – roads and drives', 'parking', 800, 'sqyd', 'A | 6.0 | 1,200 | 800'),
    gArea('Site B – turf', 'improved_turf', 4, 'acres', 'B | 4.0 | 1,000'), gArea('Site B – lot', 'parking', 1000, 'sqyd', 'B | 4.0 | 1,000'),
  ));
  const amend = (o: Record<string, unknown>) => ({ table_id: null, source: { file: AM2, page: 1, excerpt: 'Item 3. Site A turf revised from 6.0 to 5.5 acres' }, ...o });
  const r = applyToolCall(st, regG(gArea('Site A – turf', 'improved_turf', 5.5, 'acres', '', amend({}))));
  assert.equal(r.isError, false);
  assert.match(r.resultText, /Applied 1 revision of registered areas\. Note: "Site A – turf" revised from 6 acres to 5\.5 acres per Amendment 0002\.pdf p\. 1; G-1 keeps the printed figure/);
  // the base row sent again as superseded leaves the revision in scope
  const again = applyToolCall(st, regG(gArea('Site A – turf', 'improved_turf', 6, 'acres', 'A | 6.0 | 1,200 | 800', { status: 'deleted_by_amendment', status_reason: 'Amendment 0002 Item 3' })));
  assert.match(again.resultText, /already superseded by the revision from Amendment 0002\.pdf p\. 1, which stays in scope/);
  // a revision named only by its site is matched when the site has one area of the kind (Site B); with two (POV parking,
  // roads and drives at Site A) it is ambiguous - and "POV parking" never matches "roads and drives"
  applyToolCall(st, regG(gArea('Site B', 'parking', 1100, 'sqyd', '', amend({ source: { file: AM2, page: 1, excerpt: 'Item 4. Site B lot 1,100 SY' } }))));
  const amb = applyToolCall(st, regG(gArea('Site A', 'parking', 1300, 'sqyd', '', amend({ source: { file: AM2, page: 2, excerpt: 'Item 5. Site A parking 1,300 SY' } }))));
  assert.match(amb.resultText, /may revise 2 registered areas \("Site A – POV parking", "Site A – roads and drives"\); it is registered as a separate area/);
  const pov = applyToolCall(st, regG(gArea('Site A – POV parking (revised)', 'parking', 1300, 'sqyd', '', amend({ source: { file: AM2, page: 2, excerpt: 'Item 5. Site A POV parking 1,300 SY' } }))));
  assert.match(pov.resultText, /"Site A – POV parking" revised from 1,200 SY to 1,300 SY per Amendment 0002\.pdf p\. 2/);
  // the extra area from the ambiguous row is removed the way the model would: sent again out of scope
  applyToolCall(st, regG(gArea('Site A', 'parking', 1300, 'sqyd', '', amend({ status: 'excluded', status_reason: 'sent twice', source: { file: AM2, page: 2, excerpt: 'Item 5. Site A parking 1,300 SY' } }))));
  const f = applyToolCall(st, finishCall());
  assert.equal(f.isError, false, f.resultText); // G-1 still reconciles against 10 acres and 3,000 SY as printed
  const qty = () => Object.fromEntries(finalize(st).inventory.grounds.map((g) => [g.name, g.quantity]));
  assert.deepEqual(qty(), { 'Site A – turf': 5.5, 'Site A – POV parking': 1300, 'Site A – roads and drives': 800, 'Site B – turf': 4, 'Site B – lot': 1100 });
  assert.match(finalize(st).inventory.grounds[0].notes ?? '', /Revised by Amendment 0002\.pdf p\. 1: was 6 acres/);
  // a later deletion takes the area out of the estimate
  const del = applyToolCall(st, regG(gArea('Site B – turf', 'improved_turf', 4, 'acres', '', amend({ status: 'deleted_by_amendment', status_reason: 'Item 6: Site B grounds deleted', source: { file: AM2, page: 2, excerpt: 'Item 6. Site B grounds deleted' } }))));
  assert.match(del.resultText, /"Site B – turf" is now deleted_by_amendment per Amendment 0002\.pdf p\. 2 \(was 4 acres in scope\)/);
  assert.equal(qty()['Site B – turf'], undefined);
  assert.equal(applyToolCall(st, finishCall()).isError, false); // 10 acres = in scope + out of scope as printed
});

test('grounds revisions: base and amendment in one file (revision after the table, table_id null), in either read order', () => {
  const docs = [{ name: RFP, role: 'solicitation' as const }];
  const base = gArea('Site A – turf', 'improved_turf', 6.3, 'acres', 'A | 6.30 | 2,000');
  const other = gArea('Site B – turf', 'improved_turf', 3.7, 'acres', 'B | 3.70 | 900');
  const revision = gArea('Site A – turf', 'improved_turf', 5.85, 'acres', '', { table_id: null, source: { file: RFP, page: 11, excerpt: 'Item 4. Site A turf revised from 6.30 to 5.85 acres' } });
  for (const order of [[base, other, revision], [revision, base, other]]) {
    const st = createState(docs);
    applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 2, area_unit: null, printed_totals: [{ value: 10, unit: 'acres', kinds: ['improved_turf'] }] }));
    const results = order.map((a) => applyToolCall(st, regG(a)));
    if (order[0] === revision) assert.match(results[1].resultText, /"Site A – turf" 6\.3 acres \(RFP\.pdf p\. 4\) is superseded by the revision from RFP\.pdf p\. 11 registered earlier; G-1 keeps the printed figure/);
    const f = applyToolCall(st, finishCall());
    assert.equal(f.isError, false, f.resultText);
    assert.deepEqual(finalize(st).inventory.grounds.map((g) => [g.name, g.quantity]).sort(), [['Site A – turf', 5.85], ['Site B – turf', 3.7]]);
  }
  // a row printed in the base part before the table (narrative) or in another table of the base documents is not a revision
  const st = createState([{ name: RFP, role: 'solicitation' as const }, { name: J4 }]);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 1, area_unit: null }, { table_id: 'J-6', kind: 'grounds', file: J4, pages: '2', row_count: 1, area_unit: null }));
  applyToolCall(st, regG(base));
  applyToolCall(st, regG(gArea('Site A – turf', 'improved_turf', 6, 'acres', 'Site A turf about 6 acres', { table_id: null, source: { file: RFP, page: 2, excerpt: 'Site A turf about 6 acres' } })));
  applyToolCall(st, regG(gArea('Site A – turf', 'improved_turf', 2, 'acres', 'A | 2.0', { table_id: 'J-6', source: { file: J4, page: 2, excerpt: 'A | 2.0' } })));
  assert.equal(finalize(st).inventory.grounds.length, 3);
});

test('printed totals: a base total that leaves out option-only rows reconciles; gaps split out-of-scope and option-only SF', () => {
  const st = createState(DOCS);
  applyToolCall(st, declare({ table_id: 'TE-2', row_count: 4, printed_total_gross_area: 13000 }));
  applyToolCall(st, reg(
    row({ table_id: 'TE-2', building_number: '1', name: 'Center', gross_area: 10000, source: { file: J4, page: 3, excerpt: '1 | 10,000' } }),
    row({ table_id: 'TE-2', building_number: '2', name: 'Storage', gross_area: 3000, status: 'excluded', status_reason: 'N/S', source: { file: J4, page: 3, excerpt: '2 | 3,000' } }),
    row({ table_id: 'TE-2', building_number: '3', name: 'Option center', gross_area: 5000, status: 'option_only', status_reason: 'OPTIONAL SITE', source: { file: J4, page: 3, excerpt: '3 | 5,000' } }),
    row({ table_id: 'TE-2', building_number: '4', name: 'Option shop', gross_area: 1000, status: 'option_only', status_reason: 'OPTIONAL SITE', source: { file: J4, page: 3, excerpt: '4 | 1,000' } }),
  ));
  const f = applyToolCall(st, finishCall());
  assert.equal(f.isError, false, f.resultText);
  assert.match(f.resultText, /Reconciled: TE-2 total 13,000 SF = its in-scope and out-of-scope rows without the option-only rows/);
  // a total that matches no basis shows both kinds of out-of-scope rows
  const st2 = createState(DOCS);
  applyToolCall(st2, declare({ table_id: 'TE-2', row_count: 3, printed_total_gross_area: 20000 }));
  applyToolCall(st2, reg(
    row({ table_id: 'TE-2', building_number: '1', name: 'Center', gross_area: 10000, source: { file: J4, page: 3, excerpt: '1 | 10,000' } }),
    row({ table_id: 'TE-2', building_number: '2', name: 'Storage', gross_area: 3000, status: 'excluded', status_reason: 'N/S', source: { file: J4, page: 3, excerpt: '2 | 3,000' } }),
    row({ table_id: 'TE-2', building_number: '3', name: 'Option center', gross_area: 5000, status: 'option_only', status_reason: 'OPTIONAL SITE', source: { file: J4, page: 3, excerpt: '3 | 5,000' } }),
  ));
  assert.match(applyToolCall(st2, finishCall()).resultText, /TE-2: registered 10,000 SF \(\+3,000 SF out of scope, \+5,000 SF option-only\) vs printed total 20,000 SF/);
});

test('additional service days are added to the routine days, also after a frequency revision; events_per_year with a routine level is flagged', () => {
  const st = createState(DOCS);
  const r = applyToolCall(st, reg(
    row({ building_number: '1', name: 'Training center', gross_area: 20000, service_level: '3x_week', additional_service_days: { days_per_year: 12, label: 'Sunday service on drill weekends' } }),
    row({ building_number: '2', name: 'Shop', gross_area: 5000, service_level: 'daily_5', events_per_year: 12 }),
  ));
  assert.match(r.resultText, /2: events_per_year \(12\) replaces the daily_5 calendar \(250 days a year\) - if the events come on top of the routine service, send them in additional_service_days instead/);
  const tc = () => byBn([...st.facilities.values()], '1')[0];
  assert.equal(tc().serviceDaysPerYear, 162); // 150 (3x_week) + 12
  assert.match(tc().notes ?? '', /Service days: 150 routine \+ 12 additional \(Sunday service on drill weekends\) = 162/);
  // an amendment raises the frequency: the added days stay, counted once
  applyToolCall(st, reg(row({ building_number: '1', name: 'Training center', gross_area: null, service_level: 'daily_5', source: { file: AM2, excerpt: 'Item 3: frequency 5/W' } })));
  assert.equal(tc().serviceLevel, 'daily_5');
  assert.equal(tc().serviceDaysPerYear, 262);
  assert.equal(byBn([...st.facilities.values()], '2')[0].serviceDaysPerYear, 12);
});

test('floor areas by printed finish: codes mapped to classes and summed in code, an included figure taken out of its host', () => {
  assert.equal(finishClass('CPT-T'), 'carpet');
  assert.equal(finishClass('Carpet tile'), 'carpet');
  assert.equal(finishClass('VCT'), 'resilient');
  assert.equal(finishClass('Rubber tile'), 'resilient');
  assert.equal(finishClass('Hard floor SF'), 'resilient');
  assert.equal(finishClass('TZ'), 'hardTile');
  assert.equal(finishClass('Quarry tile'), 'hardTile');
  assert.equal(finishClass('Restroom SF'), 'hardTile');
  assert.equal(finishClass('Epoxy'), 'concrete');
  assert.equal(finishClass('SC'), 'concrete');
  assert.equal(finishClass('Wood gym floor'), 'wood');
  assert.equal(finishClass('Astroturf'), undefined);
  const st = createState(DOCS);
  const r = applyToolCall(st, reg(
    row({ building_number: '24', name: 'Science hall', gross_area: 20000, cleanable_area: 17760, floor_areas: [
      { finish: 'CPT', area: 2000 }, { finish: 'CPT-T', area: 1345 }, { finish: 'VCT', area: 9000 }, { finish: 'LVT', area: 2000 }, { finish: 'SV', area: 1070 }, { finish: 'RB', area: 500 },
      { finish: 'CT', area: 1200 }, { finish: 'TZ', area: 519 }, { finish: 'SC', area: 100 }, { finish: 'EP', area: 26 },
    ] }),
    row({ building_number: '25', name: 'Gym', gross_area: 30000, cleanable_area: 25000, floor_areas: [
      { finish: 'Carpet', area: 5000 }, { finish: 'Hard floor', area: 20000 }, { finish: 'Wood gym floor', area: 8000, included_in: 'Hard floor' },
    ] }),
  ));
  assert.equal(r.isError, false);
  assert.doesNotMatch(r.resultText, /floor_areas/); // both sum to the cleanable area
  const by = (bn: string) => byBn([...st.facilities.values()], bn)[0];
  assert.deepEqual(by('24').floorMix, { carpet: 0.1883, resilient: 0.7078, hardTile: 0.0968, concrete: 0.0071, wood: 0 });
  assert.match(by('24').notes ?? '', /Floor mix from printed SF by finish: carpet 3,345, resilient 12,570, hard tile 1,719, concrete 126 \(CPT 2,000 → carpet, CPT-T 1,345 → carpet, VCT 9,000 → resilient/);
  assert.deepEqual(by('25').floorMix, { carpet: 0.2, resilient: 0.48, hardTile: 0, concrete: 0, wood: 0.32 });
  assert.match(by('25').notes ?? '', /Wood gym floor taken out of Hard floor/);
  // an unknown finish is spread over the named ones and reported; an included_in naming nothing is reported
  const r2 = applyToolCall(st, reg(row({ building_number: '26', name: 'Annex', gross_area: 1000, floor_areas: [{ finish: 'VCT', area: 800 }, { finish: 'Astroturf', area: 200 }, { finish: 'WD', area: 50, included_in: 'Stage' }] })));
  assert.match(r2.resultText, /26: floor_areas: "Astroturf" is not a finish the tool knows/);
  assert.match(r2.resultText, /26: floor_areas: "WD" is included_in "Stage", which is not a finish of this row/);
});

test('set_site_info: stated snow and walk-clearing events are kept in the site notes; a restated count replaces only itself', () => {
  const st = createState(DOCS);
  applyToolCall(st, { name: 'set_site_info', input: { installation_name: 'Northern sites', climate_zone: 'cold', notes: 'Twelve sites', snow_events_per_year: 18, walk_clearing_events_per_year: 24 } });
  assert.equal(st.site.notes, 'Twelve sites; Snow and ice events per season as stated: 18 plowing, 24 walk clearing');
  applyToolCall(st, { name: 'set_site_info', input: { snow_events_per_year: 14, walk_clearing_events_per_year: null } });
  assert.equal(st.site.notes, 'Twelve sites; Snow and ice events per season as stated: 14 plowing, 24 walk clearing');
  // a later call that only restates the notes (strict calls send the counts as null) keeps the stated counts
  applyToolCall(st, { name: 'set_site_info', input: { notes: 'Revised notes', snow_events_per_year: null, walk_clearing_events_per_year: null } });
  assert.equal(st.site.notes, 'Revised notes; Snow and ice events per season as stated: 14 plowing, 24 walk clearing');
  applyToolCall(st, { name: 'set_site_info', input: { notes: null, contract_years: 5 } });
  assert.equal(st.site.notes, 'Revised notes; Snow and ice events per season as stated: 14 plowing, 24 walk clearing');
});

test('grounds revisions: an amendment row that adds an area at a registered site or building is a new area, not a revision', () => {
  const st = createState([{ name: RFP, role: 'solicitation' as const }, { name: AM2, role: 'amendment' as const, amendment: 2 }]);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 3, area_unit: null, printed_totals: [{ value: 58, unit: 'acres', kinds: ['improved_turf'] }] }));
  applyToolCall(st, regG(
    gArea('Type I improved', 'improved_turf', 50, 'acres', 'Type I | 50.0'),
    gArea('Site A – turf', 'improved_turf', 6, 'acres', 'A | 6.0'),
    gArea('Bldg 100 lawn', 'improved_turf', 2, 'acres', '100 | 2.0', { facility_building_number: '100' }),
  ));
  const amend = (name: string, qty: number, excerpt: string, o: Record<string, unknown> = {}) => gArea(name, 'improved_turf', qty, 'acres', excerpt, { table_id: null, source: { file: AM2, page: 1, excerpt }, ...o });
  // additions: a new area named after a registered one, at the same site or building
  applyToolCall(st, regG(
    amend('Type I improved – new CDC lawn', 3, 'Item 2. New CDC lawn, 3.0 acres Type I, added'),
    amend('Site A – additional turf at the new barracks', 1.5, 'Item 3. Site A: 1.5 acres added'),
    amend('Bldg 100 – new addition lawn', 0.5, 'Item 4. Bldg 100 addition lawn 0.5 acre added', { facility_building_number: '100' }),
  ));
  // a revision under the area's own name still replaces it
  const rev = applyToolCall(st, regG(amend('Type I improved', 48, 'Item 5. Type I revised from 50.0 to 48.0 acres')));
  assert.match(rev.resultText, /"Type I improved" revised from 50 acres to 48 acres/);
  const qty = Object.fromEntries(finalize(st).inventory.grounds.map((g) => [g.name, g.quantity]));
  assert.deepEqual(qty, { 'Type I improved': 48, 'Site A – turf': 6, 'Bldg 100 lawn': 2, 'Type I improved – new CDC lawn': 3, 'Site A – additional turf at the new barracks': 1.5, 'Bldg 100 – new addition lawn': 0.5 });
  assert.equal(applyToolCall(st, finishCall()).isError, false); // G-1 reconciles against its printed 58 acres
});

test('grounds revisions: in a combined file, a revision tagged with a table that was never declared still revises', () => {
  const st = createState([{ name: RFP, role: 'solicitation' as const }]);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 2, area_unit: null, printed_totals: [{ value: 10, unit: 'acres', kinds: ['improved_turf'] }] }));
  applyToolCall(st, regG(gArea('Site A – turf', 'improved_turf', 6.3, 'acres', 'A | 6.30'), gArea('Site B – turf', 'improved_turf', 3.7, 'acres', 'B | 3.70')));
  const r = applyToolCall(st, regG(gArea('Site A – turf', 'improved_turf', 5.85, 'acres', '', { table_id: 'Amendment 0001 Item 4', source: { file: RFP, page: 11, excerpt: 'Item 4. Site A turf revised from 6.30 to 5.85 acres' } })));
  assert.match(r.resultText, /"Site A – turf" revised from 6\.3 acres to 5\.85 acres per RFP\.pdf p\. 11/);
  assert.deepEqual(finalize(st).inventory.grounds.map((g) => [g.name, g.quantity]), [['Site A – turf', 5.85], ['Site B – turf', 3.7]]);
  assert.equal(applyToolCall(st, finishCall()).isError, false);
});

test('grounds: a walk printed only as a length stays a walk area (5-ft width assumed); edging, curbs and fences are lengths', () => {
  const st = createState([{ name: RFP, role: 'solicitation' as const }]);
  applyToolCall(st, declare({ table_id: 'G-1', kind: 'grounds', file: RFP, pages: '4', row_count: 4, area_unit: null, printed_totals: [] }));
  const r = applyToolCall(st, regG(
    gArea('Sidewalks – snow removal', 'sidewalk', 12000, 'lf', 'Sidewalks | 12,000 LF'),
    gArea('Sidewalk edging', 'sidewalk', 3000, 'lf', 'Edging | 3,000 LF'),
    gArea('Curb and gutter', 'parking', 2000, 'lf', 'Curb | 2,000 LF'),
    gArea('Perimeter fence line', 'unimproved', 5000, 'lf', 'Fence | 5,000 LF'),
  ));
  assert.match(r.resultText, /Registered 1 grounds areas in scope/);
  assert.match(r.resultText, /"Sidewalks – snow removal" 12,000 LF is a walk printed only as a length: kept as a sidewalk area \(the estimate assumes a 5-ft width\)/);
  assert.match(r.resultText, /Recorded as lengths, not areas: "Sidewalk edging" 3,000 LF, "Curb and gutter" 2,000 LF, "Perimeter fence line" 5,000 LF/);
  const inv = finalize(st).inventory;
  assert.deepEqual(inv.grounds.map((g) => [g.name, g.kind, g.quantity, g.unit]), [['Sidewalks – snow removal', 'sidewalk', 12000, 'lf']]);
  assert.equal(estimateInventory(inv).metrics.pavedSqft, 60000);
});

test('score: cleanable and service level carry weight, attribute and site mismatches are listed after facility misses', () => {
  const truth: FixtureTruth = {
    id: 't', title: 't', theme: 't', provenance: { fidelity: 'synthetic', sources: [] }, inputs: [], traps: [],
    expect: {
      facilities: [
        { buildingNumber: '12', name: 'Uffici', grossSqft: 13347, cleanableSqft: 13347, serviceLevel: '2x_week', floors: 2, category: 'admin' },
        { buildingNumber: '14', name: 'Alloggi', grossSqft: 37243, cleanableSqft: 37243, serviceLevel: 'weekly', floors: 3, category: 'barracks' },
      ],
      facilitiesComplete: true, site: { climateZone: 'temperate' },
    },
  };
  const fac = (bn: string, o: Partial<Facility>): Facility => ({ id: bn, buildingNumber: bn, name: bn, category: 'admin', grossSqft: 0, floors: 0, serviceLevel: 'daily_5', scope: ['custodial'], confidence: 1, ...o });
  const perfect = scoreInventory(truth, { site: { climateZone: 'temperate' }, facilities: [fac('12', { grossSqft: 13347, cleanableSqft: 13347, serviceLevel: '2x_week', floors: 2 }), fac('14', { grossSqft: 37243, cleanableSqft: 37243, serviceLevel: 'weekly', floors: 3, category: 'barracks' })], grounds: [] }, 'test');
  assert.equal(perfect.score, 100);
  assert.deepEqual(perfect.misses, []);
  const rep = scoreInventory(truth, { site: {}, facilities: [fac('12', { grossSqft: 13347, serviceLevel: '2x_week', floors: 2 }), fac('14', { grossSqft: 37243, cleanableSqft: 37243, serviceLevel: 'daily_5', floors: 3, category: 'barracks' })], grounds: [] }, 'test');
  assert.equal(rep.score, 95); // half the cleanable and half the service-level weight lost
  assert.deepEqual(rep.misses, ['cleanable mismatch 12: expected 13347, got none', 'service level mismatch 14: expected weekly, got daily_5', 'site climateZone: expected temperate, got none']);
});

test('score: building numbers match by the reader\'s identity rule; line items pair by area, then name; site names compare as an estimator reads them', () => {
  assert.equal(normBn('Bldg. No. 0012'), normBn('12'));
  assert.equal(normBn('Facility 12'), normBn('12')); // not "ILITY12"
  assert.equal(normBn('Site 4'), normBn('4'));
  assert.equal(normBn('SP-01'), normBn('SP1'));
  assert.notEqual(normBn('NOSC 1'), normBn('SC 1'));
  assert.notEqual(normBn('1-10'), normBn('110'));
  const fac = (bn: string, name: string, grossSqft: number): Facility => ({ id: `${bn}-${name}`, buildingNumber: bn, name, category: 'admin', grossSqft, floors: 1, serviceLevel: 'daily_5', scope: ['custodial'], confidence: 1 });
  const truth = (facilities: FixtureTruth['expect']['facilities'], site?: FixtureTruth['expect']['site']): FixtureTruth => ({ id: 't', title: 't', theme: 't', provenance: { fidelity: 'synthetic', sources: [] }, inputs: [], traps: [], expect: { facilities, facilitiesComplete: true, site } });
  // two line items with one number: each truth line pairs with the line whose area agrees, else the line of its name,
  // whatever the order (a stray row with the number and the right name does not take the place of the right area)
  const lines = truth([{ buildingNumber: '2000', name: 'Wing HQ - Command Section', grossSqft: 6215 }, { buildingNumber: '2000', name: 'Wing HQ - Staff Agencies', grossSqft: 18540 }]);
  const rep = scoreInventory(lines, { site: {}, facilities: [fac('2000', 'Wing HQ - Staff Agencies', 18540), fac('2000', 'Wing HQ - Command Section', 6215)], grounds: [] }, 'test');
  assert.equal(rep.score, 100, JSON.stringify(rep.misses));
  const off = scoreInventory(lines, { site: {}, facilities: [fac('2000', 'Wing HQ - Staff Agencies', 18000), fac('2000', 'Wing HQ - Command Section', 6000)], grounds: [] }, 'test');
  assert.deepEqual(off.misses, ['SF mismatch 2000: expected 6215, got 6000', 'SF mismatch 2000: expected 18540, got 18000']);
  const stray = scoreInventory(truth([{ buildingNumber: '012', name: 'Elmore Library', grossSqft: 49745 }]), { site: {}, facilities: [fac('012', 'LIB', 49745), fac('12', 'Elmore Library', 656)], grounds: [] }, 'test');
  assert.deepEqual([stray.facilities.sfExact, stray.extras], [1, ['12 Elmore Library (656 SF)']]);
  // two lines collapsed into one facility with the second line's area: that line is found, the first is missing (the
  // first truth line does not take it and turn one miss into two)
  const collapsed = scoreInventory(lines, { site: {}, facilities: [fac('2000', 'Wing HQ - Command Section', 18540)], grounds: [] }, 'test');
  assert.deepEqual(collapsed.misses, ['2000 Wing HQ - Command Section (6215 SF)']);
  // a number printed with a letter prefix on one side counts as the same building only when the names agree
  const b41 = truth([{ buildingNumber: '41', name: 'Whole Health Center', grossSqft: 9600 }, { buildingNumber: '42', name: 'Boiler Plant', grossSqft: 5000 }]);
  const r41 = scoreInventory(b41, { site: {}, facilities: [fac('B-41', 'Whole Health and Telehealth Center', 9600), fac('T-42', 'Warehouse', 5000)], grounds: [] }, 'test');
  assert.equal(r41.facilities.matched, 1);
  assert.deepEqual(r41.misses, ['42 Boiler Plant (5000 SF)']);
  // site names: an abbreviation in parentheses and other sites appended do not make a faithful copy wrong; a different
  // installation or solicitation still does
  const site = (installationName: string, solicitation = 'N69450-26-R-0014') => scoreInventory(truth([], { installationName: 'Naval Support Activity Tarpon Sound', solicitation: 'N69450-26-R-0014' }), { site: { installationName, solicitation }, facilities: [], grounds: [] }, 'test').site.map((x) => x.ok);
  assert.deepEqual(site('Naval Support Activity (NSA) Tarpon Sound'), [true, true]);
  assert.deepEqual(site('Naval Support Activity (NSA) Tarpon Sound, Florida (with Saltmarsh Point Annex)'), [true, true]);
  assert.deepEqual(site('NSA Tarpon Sound'), [false, true]);
  assert.deepEqual(site('Naval Support Activity Panama City', 'N69450-26-R-0041'), [false, false]);
  assert.equal(siteFieldOk('installationName', 'USAG Italy', 'U.S. Army Garrison Italy (USAG Italy) – Vicenza'), true);
  // every expected word, in another order, is a match; only some of them is not
  assert.equal(siteFieldOk('installationName', 'Kessling County Government Center', 'Government Center, Kessling County'), true);
  assert.equal(siteFieldOk('installationName', 'Kessling County Government Center', 'County Center'), false);
  assert.equal(siteFieldOk('solicitation', 'RFP No. 2026-041', 'RFP 2026-041'), false);
  assert.equal(siteFieldOk('climateZone', 'cold', 'cold'), true);
});

test('request intro: a file ranked as an amendment whose name says it is a base document as amended gets the tagging note', () => {
  const doc = (name: string, amendment: number) => ({ name, mode: 'text' as const, text: '--- page 1 ---\nx', chars: 1, bytes: 1, role: 'amendment' as const, amendment });
  const intro = (name: string) => describeRequests([doc(name, 1)]).passes[0].intro;
  for (const name of ['Attachment J-4 Facility List (w Amd 0003).pdf', 'Section C PWS (Conformed Amd 0004).pdf', 'Custodial-RFP-with-Addendum-2.docx', 'Exhibit 5 - Workload Data (Amd 0002).xlsx']) {
    assert.match(intro(name), /is ranked as amendment 0001, but its name says it holds a base document or attachment with the amendment applied or appended: rows printed in its tables \(also rows marked as revised\) get the table's id/, name);
  }
  for (const name of ['Amendment 0002.pdf', 'RFP 27031 Addendum No. 1.pdf', 'SF30 Amendment 0001.pdf']) assert.doesNotMatch(intro(name), /is ranked as/, name);
  // the tagging rule itself is in every intro, and the line_item field is offered to the model
  assert.match(intro('Amendment 0002.pdf'), /A conformed or reissued table \(revised rows marked in place\) is a table like any other: tag every printed row with its id/);
  const facility = (describeRequests([doc('a.pdf', 1)]).tools.find((t) => t.name === 'register_facilities')!.input_schema as { properties: { facilities: { items: { properties: Record<string, unknown> } } } }).properties.facilities.items.properties;
  for (const k of ['line_item', 'floor_areas', 'service_season', 'events_per_year', 'cleaning_detail']) assert.ok(facility[k], k);
});

// ------------------------------------------------------------------------------------------------
// the live loop (server/ai.ts) against a scripted client
// ------------------------------------------------------------------------------------------------

type Block = Record<string, unknown>;
function fakeClient(script: (turn: number, params: Record<string, unknown>) => { content: Block[]; stop_reason: string; usage?: Record<string, number> } | Error) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(structuredClone(params));
          const out = script(requests.length - 1, params);
          return {
            async *[Symbol.asyncIterator]() { if (out instanceof Error) throw out; },
            finalMessage: async () => {
              if (out instanceof Error) throw out;
              return { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: out.content, stop_reason: out.stop_reason, stop_sequence: null, usage: out.usage ?? { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 } };
            },
          };
        },
      },
    },
    files: { upload: async () => { throw new Error('not used'); }, delete: async () => ({}) },
  };
  return { client: client as unknown as Anthropic, requests };
}
const tu = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input });
const sampleRows = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ table_id: 'TE-3', building_number: String(1000 + from + i), name: `Building ${from + i}`, gross_area: 10000, area_unit: 'sf', status: 'in_scope', source: { file: 'pws.txt', page: 1, excerpt: `row ${from + i}` }, confidence: 0.9 }));
const textDoc = { name: 'pws.txt', mode: 'text' as const, text: '--- page 1 ---\nTE-3 | ...', chars: 20, bytes: 20, role: 'pws' as const, scannedPages: [4, 5, 6], warnings: ['hidden sheet "Old" skipped'] };
const cacheMarks = (params: Record<string, unknown>) => JSON.stringify(params).split('"cache_control"').length - 1;

test('live loop: cut-off tool call answered with an error, moving cache breakpoint, usage, warnings, recording', async () => {
  const { client, requests } = fakeClient((turn) => {
    if (turn === 0) return { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'reading', signature: 'x' }, tu('t1', 'declare_tables', { tables: [{ table_id: 'TE-3', title: 'TE-3', kind: 'facilities', file: 'pws.txt', pages: '1', row_count: 6, printed_total_gross_area: 60000, area_unit: 'sf' }] }), tu('t2', 'register_facilities', { facilities: sampleRows(0, 3) })] };
    if (turn === 1) return { stop_reason: 'max_tokens', content: [tu('t3', 'register_facilities', { facilities: sampleRows(3, 4) }), tu('t4', 'register_facilities', { facilities: sampleRows(4, 6).map((r) => ({ ...r, gross_area: 10 })) })] };
    if (turn === 2) return { stop_reason: 'tool_use', content: [tu('t5', 'register_facilities', { facilities: sampleRows(4, 6) }), tu('t6', 'finish', { summary: 'ok', unresolved: [] })] };
    return new Error(`unexpected turn ${turn}`);
  });
  const events: ExtractionEvent[] = [];
  const rec = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bos-ai-')), 'sim', 'run.calls.json');
  const r = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, (e) => events.push(e), undefined, { client, recordCallsTo: rec });

  assert.equal(requests.length, 3);
  assert.equal(r.inventory.facilities.length, 6);
  assert.ok(r.inventory.facilities.every((f) => f.grossSqft === 10000), 'the truncated call (10 SF rows) was not applied');
  // the cut-off call got an error result, the complete one before it was applied
  const turn2User = (requests[2].messages as { role: string; content: Block[] }[]).at(-1)!;
  const results = turn2User.content.filter((b) => b.type === 'tool_result');
  assert.equal(results.find((b) => b.tool_use_id === 't3')!.is_error, undefined);
  assert.equal(results.find((b) => b.tool_use_id === 't4')!.is_error, true);
  assert.match(String(results.find((b) => b.tool_use_id === 't4')!.content), /cut off/);
  // breakpoints: system + intro + last block of the latest user turn, never more than 4
  for (const p of requests) assert.ok(cacheMarks(p) <= 4, `cache breakpoints: ${cacheMarks(p)}`);
  assert.equal(cacheMarks(requests[2]), 3);
  const lastBlock = turn2User.content.at(-1)!;
  assert.deepEqual(lastBlock.cache_control, { type: 'ephemeral' });
  const turn1User = (requests[2].messages as { role: string; content: Block[] }[])[2];
  assert.ok(turn1User.content.every((b) => !b.cache_control), 'older breakpoint moved');
  // request shape
  assert.deepEqual(requests[0].output_config, { effort: 'high' });
  assert.deepEqual(requests[0].tool_choice, { type: 'auto' });
  assert.ok((requests[0].tools as { strict?: boolean }[]).some((t) => t.strict));
  const intro = JSON.stringify(requests[0].messages);
  assert.match(intro, /Documents from lowest to highest precedence \(each one supersedes those listed above it\)/);
  assert.match(intro, /pws\.txt pages 4-6 are scanned images/);
  assert.match(intro, /hidden sheet/);
  // usage kept apart
  assert.deepEqual(r.usage, { input: 300, output: 150, cacheRead: 3000, cacheWrite: 30 });
  // warnings and progress
  assert.ok(events.some((e) => e.type === 'warning' && /cut off/.test(e.message)));
  assert.ok(events.some((e) => e.type === 'progress' && e.registered === 6 && e.expected === 6));
  assert.ok(!r.warnings.some((w) => /without calling finish/.test(w)));
  // the recording replays to the same inventory
  const saved = JSON.parse(fs.readFileSync(rec, 'utf8')) as { model: string; passes: string[][]; calls: ToolCall[] };
  assert.equal(saved.calls.length, 6);
  assert.equal(saved.calls.filter((c) => c.truncated).length, 1);
  assert.deepEqual(saved.passes, [['pws.txt']]);
  const replay = replayToolCalls(saved.calls, [textDoc], undefined, { passes: saved.passes });
  assert.deepEqual(replay.inventory.facilities.map((f) => [f.id, f.grossSqft]), r.inventory.facilities.map((f) => [f.id, f.grossSqft]));
});

test('live loop: ending without finish is nudged once, then warned; the turn limit is warned', async () => {
  const a = fakeClient(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'All done.' }] }));
  const r = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: a.client });
  assert.equal(a.requests.length, 2);
  assert.match(JSON.stringify((a.requests[1].messages as unknown[]).at(-1)), /without calling finish/);
  assert.ok(r.warnings.includes('AI pass 1 ended without calling finish - the inventory may be incomplete.'));

  let n = 0;
  const b = fakeClient(() => ({ stop_reason: 'tool_use', content: [tu(`t${n++}`, 'register_facilities', { facilities: sampleRows(n, n + 1) })] }));
  const r2 = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: b.client, maxTurns: 3 });
  assert.equal(b.requests.length, 3);
  assert.ok(r2.warnings.some((w) => /stopped after 3 turns without calling finish/.test(w)));
  assert.equal(r2.warnings.filter((w) => /AI pass 1/.test(w)).length, 1);
});

test('live loop: a strict-schema 400 on the first turn steps down to non-strict tools', async () => {
  const c = fakeClient((turn) => turn === 0
    ? new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex for compilation.' } }, 'Schema is too complex for compilation.', new Headers())
    : { stop_reason: 'tool_use', content: [tu('f', 'finish', { summary: 'none', unresolved: [] })] });
  const r = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: c.client });
  assert.equal(c.requests.length, 2);
  assert.ok((c.requests[0].tools as { strict?: boolean }[]).some((t) => t.strict));
  assert.ok((c.requests[1].tools as { strict?: boolean }[]).every((t) => !t.strict));
  assert.equal(c.requests[1].fallbacks, 'default'); // other options untouched
  assert.equal(r.inventory.facilities.length, 0);
});

test('live loop: model_context_window_exceeded is a cut-off; the pass continues in a fresh request, never in the full one', async () => {
  const row1201 = { ...sampleRows(0, 1)[0], building_number: '1201', name: 'Brigade HQ', gross_area: 31000 };
  const c = fakeClient((turn) => {
    if (turn === 0) return { stop_reason: 'tool_use', content: [tu('t0', 'declare_tables', { tables: [{ table_id: 'TE-3', title: 'TE-3', kind: 'facilities', file: 'pws.txt', pages: '1', row_count: 2, printed_total_gross_area: 76200, area_unit: 'sf' }] })] };
    // the output filled the context window inside the second call ("45200" cut to "45")
    if (turn === 1) return { stop_reason: 'model_context_window_exceeded', content: [tu('t1', 'register_facilities', { facilities: [row1201] }), tu('t2', 'register_facilities', { facilities: [{ table_id: 'TE-3', building_number: '1202', name: 'Barr', gross_area: 45 }] })] };
    if (turn === 2) return { stop_reason: 'tool_use', content: [tu('t3', 'register_facilities', { facilities: [{ ...row1201, building_number: '1202', name: 'Barracks', gross_area: 45200, source: { file: 'pws.txt', page: 1, excerpt: '1202' } }] }), tu('t4', 'finish', { summary: 'ok', unresolved: [] })] };
    return new Error(`unexpected turn ${turn}`);
  });
  const events: ExtractionEvent[] = [];
  const r = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, (e) => events.push(e), undefined, { client: c.client });
  assert.deepEqual(r.inventory.facilities.map((f) => [f.buildingNumber, f.grossSqft]), [['1201', 31000], ['1202', 45200]]);
  assert.equal(c.requests.length, 3);
  // request 3 is a new conversation: documents + an intro listing what was registered, not the full history
  const msgs = c.requests[2].messages as { role: string; content: Block[] }[];
  assert.equal(msgs.length, 1);
  const intro = String(msgs[0].content.at(-1)!.text);
  assert.match(intro, /continues reading the same documents/);
  assert.match(intro, /^1201\|\|31000$/m);
  assert.match(intro, /TE-3 in pws\.txt: 1 of 2 rows registered/);
  assert.match(intro, /cut off when the context window filled up and NOT applied/);
  assert.ok(r.warnings.some((w) => /filled the model's context window after 2 turns; continuing in a fresh request/.test(w)));
  assert.ok(!r.warnings.some((w) => /without calling finish/.test(w)));
});

test('live loop: a full context with nothing new registered stops the pass with a warning; the proactive check continues before the API rejects', async () => {
  const a = fakeClient(() => ({ stop_reason: 'model_context_window_exceeded', content: [tu('x', 'register_facilities', { facilities: sampleRows(0, 1) })] }));
  const r = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: a.client });
  assert.equal(a.requests.length, 1);
  assert.equal(r.inventory.facilities.length, 0);
  assert.ok(r.warnings.some((w) => /filled the model's context window after 1 turns without registering anything new; stopped/.test(w)), JSON.stringify(r.warnings));

  // proactive: the next request would not leave room for a turn of output, and a fresh conversation frees the history
  const u = (cached: number, output: number) => ({ input_tokens: 1000, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: output });
  let k = 0;
  const p = fakeClient((turn) => turn === 0 ? { stop_reason: 'tool_use', content: [tu('a', 'register_facilities', { facilities: sampleRows(k, ++k) })], usage: u(600_000, 20_000) }
    : turn === 1 ? { stop_reason: 'tool_use', content: [tu('b', 'register_facilities', { facilities: sampleRows(k, ++k) })], usage: u(890_000, 40_000) }
      : { stop_reason: 'tool_use', content: [tu('f', 'finish', { summary: 'ok', unresolved: [] })], usage: u(600_000, 1_000) });
  const rp = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: p.client });
  assert.equal(p.requests.length, 3);
  assert.equal((p.requests[1].messages as unknown[]).length, 3);
  assert.equal((p.requests[2].messages as unknown[]).length, 1);
  assert.match(String((p.requests[2].messages as { content: Block[] }[])[0].content.at(-1)!.text), /Results of the last tool calls in the previous conversation:\nregister_facilities: Registered 1 of 1 rows/);
  assert.equal(rp.inventory.facilities.length, 2);
  assert.ok(rp.warnings.some((w) => /nearly filled the model's context window after 2 turns; continuing/.test(w)));
  // ... but not when the documents alone nearly fill it (a fresh conversation would not help)
  const q = fakeClient((turn) => turn === 0 ? { stop_reason: 'tool_use', content: [tu('a', 'register_facilities', { facilities: sampleRows(0, 1) })], usage: u(930_000, 20_000) }
    : { stop_reason: 'tool_use', content: [tu('f', 'finish', { summary: 'ok', unresolved: [] })], usage: u(950_000, 1_000) });
  await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: q.client });
  assert.equal((q.requests[1].messages as unknown[]).length, 3);

  // a 400 "prompt is too long" after the first turn: continue in a fresh request; on the first turn: no step-down ladder
  const b = fakeClient((turn) => turn === 0
    ? { stop_reason: 'tool_use', content: [tu('a', 'register_facilities', { facilities: sampleRows(0, 2) })] }
    : turn === 1 ? new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 1004331 tokens > 1000000 maximum' } }, 'prompt is too long: 1004331 tokens > 1000000 maximum', new Headers())
      : { stop_reason: 'tool_use', content: [tu('f', 'finish', { summary: 'ok', unresolved: [] })] });
  const rb = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: b.client });
  assert.equal(b.requests.length, 3);
  assert.equal((b.requests[2].messages as unknown[]).length, 1);
  assert.equal(rb.inventory.facilities.length, 2);
  const tooLong = fakeClient(() => new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 1204331 tokens > 1000000 maximum' } }, 'prompt is too long: 1204331 tokens > 1000000 maximum', new Headers()));
  await assert.rejects(extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: tooLong.client }), /prompt is too long/);
  assert.equal(tooLong.requests.length, 1);
});

test('live loop: a refusal or a terminal API error keeps what was registered; it is thrown only when nothing was', async () => {
  // refusal after 40 facilities
  const a = fakeClient((turn) => turn === 0
    ? { stop_reason: 'tool_use', content: [tu('a', 'register_facilities', { facilities: sampleRows(0, 40) })] }
    : { stop_reason: 'refusal', content: [] });
  const ra = await extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: a.client });
  assert.equal(ra.inventory.facilities.length, 40);
  assert.ok(ra.warnings.some((w) => /AI pass 1 stopped after 1 turns because the model declined to continue; keeping what was registered/.test(w)), JSON.stringify(ra.warnings));
  assert.equal(ra.warnings.filter((w) => /without calling finish/.test(w)).length, 0);
  // a refusal before anything was registered still throws (index.ts falls back to the rule-based reader)
  const b = fakeClient(() => ({ stop_reason: 'refusal', content: [] }));
  await assert.rejects(extractWithClaude([textDoc], { model: 'claude-opus-5-5', effort: 'high' }, () => {}, undefined, { client: b.client }), /declined to process this document/);
  // pass 1 finished, pass 2 gets a 529 after the SDK's retries: pass 1 is kept
  // ~575k tokens each: one document per pass
  const big = (name: string) => ({ name, mode: 'text' as const, text: 'y'.repeat(1_900_000), chars: 1_900_000, bytes: 1_900_000, role: 'pws' as const });
  const c = fakeClient((turn) => turn === 0
    ? { stop_reason: 'tool_use', content: [tu('a', 'register_facilities', { facilities: sampleRows(0, 30) }), tu('b', 'finish', { summary: 'ok', unresolved: [] })] }
    : new Anthropic.InternalServerError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers()));
  const events: ExtractionEvent[] = [];
  const rc = await extractWithClaude([big('a.txt'), big('b.txt'), big('c.txt')], { model: 'claude-opus-5-5', effort: 'high' }, (e) => events.push(e), undefined, { client: c.client });
  assert.equal(rc.inventory.facilities.length, 30);
  assert.ok(rc.warnings.some((w) => /AI pass 2 stopped after 0 turns because of an API error .*Overloaded/.test(w)), JSON.stringify(rc.warnings));
  assert.ok(rc.warnings.some((w) => /Not read by the AI because of the error above: c\.txt/.test(w)));
  assert.equal(c.requests.length, 2); // the run stops: pass 3 is not attempted
  assert.equal(events.filter((e) => e.type === 'warning' && /AI pass 2 stopped/.test(e.message)).length, 1);
});
