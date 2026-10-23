// Rule-based reader (server/heuristic.ts): one focused test per rule on synthetic text in the shape server/extract.ts
// produces ("cell | cell" rows, [^n] markers, ~~struck~~ text, "--- page N ---"), plus a score floor per rendered fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorize, groundsKindFromText, heuristicExtract, heuristicPriorAward, normalizeBuildingNumber, parseNumberCell, serviceLevelFromText, statusFromText } from '../server/heuristic';
import { closeReaders, orderDocuments, readDocument, type DocInput } from '../server/extract';
import { groundsAcres, groundsSqft } from '../shared/estimate';
import type { DocumentRole, Facility, GroundsArea, Inventory } from '../shared/types';
import { scoreInventory } from './harness/score';
import type { FixtureTruth } from './harness/truth';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');

type DocSpec = string | { text: string; name?: string; role?: DocumentRole; amendment?: number };
const doc = (d: DocSpec, i = 0): DocInput => {
  const o = typeof d === 'string' ? { text: d } : d;
  return { name: o.name ?? `doc${i + 1}.txt`, mode: 'text', text: o.text, chars: o.text.length, bytes: o.text.length, role: o.role ?? 'pws', amendment: o.amendment };
};
const read = (...docs: DocSpec[]): Inventory => heuristicExtract(docs.map(doc));
const lines = (...l: string[]) => l.join('\n');
const fac = (inv: Inventory, bn: string): Facility => { const f = inv.facilities.find((x) => x.buildingNumber === bn); assert.ok(f, `facility ${bn} not found in ${inv.facilities.map((x) => x.buildingNumber).join(', ')}`); return f!; };
const inScope = (inv: Inventory) => inv.facilities.filter((f) => !f.status);
const acres = (gs: GroundsArea[], kind: string) => gs.filter((g) => g.kind === kind).reduce((s, g) => s + groundsAcres(g), 0);
const sqft = (gs: GroundsArea[], kind: string) => gs.filter((g) => g.kind === kind).reduce((s, g) => s + groundsSqft(g), 0);
const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-3), `${a} ≉ ${b}`);

const H = 'Bldg No. | Facility Name | Use | Floors | Gross SF | Cleanable SF | Frequency';

// ---------------------------------------------------------------------------------------------- numbers and cells

test('numbers: thousands separators, footnote markers, qualifiers and decimal commas', () => {
  assert.equal(parseNumberCell('45,200'), 45200);
  assert.equal(parseNumberCell('45,200[^1]'), 45200);
  assert.equal(parseNumberCell('18,750*'), 18750);
  assert.equal(parseNumberCell('approx. 9.40'), 9.4);
  assert.equal(parseNumberCell('64±'), 64);
  assert.equal(parseNumberCell('4.312,8 m²'), 4312.8);
  assert.equal(parseNumberCell('96,4 m²'), 96.4);
  assert.equal(parseNumberCell('2,35'), 2.35);
  assert.equal(parseNumberCell('1.240', true), 1240, 'a table in Italian format reads 1.240 as 1,240');
  assert.equal(parseNumberCell('1,240'), 1240);
  assert.equal(parseNumberCell('—'), undefined);
});

test('building numbers keep letters, hyphens and leading zeros; prefixes are dropped', () => {
  assert.equal(normalizeBuildingNumber('Bldg 0012'), '0012');
  assert.equal(normalizeBuildingNumber('T – 2401'), 'T-2401');
  assert.equal(normalizeBuildingNumber('00205A'), '00205A');
  assert.equal(normalizeBuildingNumber('P-114'), 'P-114');
  assert.equal(normalizeBuildingNumber('VA0123ZZ'), 'VA0123ZZ');
  assert.equal(normalizeBuildingNumber('1201A13'), '1201A13');
  assert.equal(normalizeBuildingNumber('118[^3]'), '118');
  assert.equal(normalizeBuildingNumber('FACILITY NAME / USE'), undefined);
  assert.equal(normalizeBuildingNumber('Industrial area (all facilities)'), undefined);
});

test('frequency wording maps to service levels (monthly and 2x/month before weekly wording)', () => {
  const cases: [string, string | undefined][] = [
    ['Daily (5 days)', 'daily_5'], ['Daily (M–F)', 'daily_5'], ['Monday – Friday', 'daily_5'], ['M-F (12 mo.)', 'daily_5'], ['5X/WK', 'daily_5'], ['5/7', 'daily_5'], ['Twice daily', 'daily_5'], ['M–Sa', 'daily_6'], ['Mon–Sat', 'daily_6'], ['6X/WK', 'daily_6'], ['6 days/week', 'daily_6'],
    ['Daily (7 Days)', 'daily_7'], ['7X/WK', 'daily_7'], ['7 days / week, including holidays', 'daily_7'], ['7/7', 'daily_7'],
    ['3x Weekly', '3x_week'], ['M/W/F', '3x_week'], ['Monday, Wednesday, Friday', '3x_week'],
    ['2X/WK', '2x_week'], ['T/Th', '2x_week'], ['Tuesday and Thursday', '2x_week'], ['2 v/sett.', '2x_week'], ['Two services per week', '2x_week'],
    ['Weekly', 'weekly'], ['1X/WK', 'weekly'], ['1/7', 'weekly'], ['settimanale', 'weekly'], ['1x/wk', 'weekly'],
    ['Bi-weekly', 'biweekly'], ['BI-WKLY', 'biweekly'], ['2x/month', 'biweekly'], ['quindicinale', 'biweekly'], ['every other week', 'biweekly'],
    ['1X/MO', 'monthly'], ['Monthly', 'monthly'], ['QTRLY', 'quarterly'], ['Quarterly', 'quarterly'],
    ['N/A', undefined], ['Each cycle', undefined],
    // rates per month / year are converted to visits per week before any weekly wording is read
    ['3x/month', 'biweekly'], ['3X/MO', 'biweekly'], ['Three times per month', 'biweekly'], ['4x/month', 'weekly'], ['Four times per month', 'weekly'], ['Twice monthly', 'biweekly'], ['2 X MONTHLY', 'biweekly'], ['Once a month', 'monthly'],
    ['2x/yr', 'quarterly'], ['1x/yr', 'quarterly'], ['Annually', 'quarterly'], ['Semi-annually', 'quarterly'], ['6x/yr', 'quarterly'], ['4x/yr', 'quarterly'], ['12x/yr', 'monthly'], ['24x/yr', 'biweekly'], ['26x/yr', 'biweekly'], ['52x/yr', 'weekly'], ['52/yr', 'weekly'],
    ['Mon-Sun', 'daily_7'], ['Monday through Sunday', 'daily_7'], ['Daily (Mon–Sun)', 'daily_7'], ['Every Other Day', '3x_week'], ['2x/day', 'daily_5'], ['5 days a week', 'daily_5'], ['Once weekly', 'weekly'],
    ['Daily; carpets 2x/yr', 'daily_5'],
  ];
  for (const [t, want] of cases) assert.equal(serviceLevelFromText(t), want, t);
});

test('row statuses: whole-building wording only, partial exclusions are not statuses', () => {
  assert.equal(statusFromText('DEMO FY27 – EXCLUDE')?.status, 'demolished');
  assert.equal(statusFromText('VACANT - PENDING DISPOSAL - NOT IN SCOPE')?.status, 'demolished');
  assert.equal(statusFromText('CLOSED – renovation through FY27')?.status, 'vacant');
  assert.equal(statusFromText('NOT IN SCOPE – ITALIAN ARMY USE')?.status, 'excluded');
  assert.equal(statusFromText('Storage – no custodial service')?.status, 'excluded');
  assert.equal(statusFromText('Self-Service Supply Center – DELETED')?.status, 'deleted_by_amendment');
  assert.equal(statusFromText('N/A', { frequencyCell: true })?.status, 'excluded');
  assert.equal(statusFromText('Option item only')?.status, 'option_only');
  for (const partial of ['Server rooms 110–114 excluded; escort required', 'Holding cells excluded', 'Racquetball court wing demolished October 2025', 'Escluse cucine / kitchens excluded', 'Renovation planned 2027–2028', 'Open Saturdays; no Saturday service',
    'Kitchen area not included', 'Mechanical rooms not serviced', 'Server room - no custodial service', 'Window washing not included', 'Floor refinishing not included in this contract', 'Gym floor not part of the contract', 'Mechanical rooms – excluded', 'Kitchens - excluded', 'Carpet - excluded', 'Lobby closed for renovation',
    'Closed weekends and federal holidays', 'Closed on Saturdays', 'Closed at 1800 hrs', 'Closed 1200-1300 for lunch', 'Pool closed in winter', 'To be demolished FY29; service through FY28', 'Programmed for demolition in FY27', 'N/A', 'n/a', 'None', '-']) assert.equal(statusFromText(partial), undefined, partial);
  // the whole building still reads as a status
  assert.equal(statusFromText('Building is closed')?.status, 'vacant');
  assert.equal(statusFromText('Closed 1 NOV 2024. Not in scope.')?.status, 'vacant');
  assert.equal(statusFromText('Restroom Building – CLOSED')?.status, 'vacant');
  assert.equal(statusFromText('Scheduled for demolition FY28; not in scope')?.status, 'demolished');
  assert.equal(statusFromText('Excluded')?.status, 'excluded');
  assert.equal(statusFromText('N/A - not in scope')?.status, 'excluded');
  assert.equal(statusFromText('Motor Pool (DEMOLISHED FY26)', { nameCell: true })?.status, 'demolished');
  assert.equal(statusFromText('Brigade HQ (annex wing demolished)', { nameCell: true }), undefined);
  assert.equal(statusFromText('-', { frequencyCell: true })?.status, 'excluded');
});

test('grounds terminology: Type I/II/III, Category A/B/C, BASH, fields, beds, trees, paving', () => {
  assert.equal(groundsKindFromText('Type I (improved)'), 'improved_turf');
  assert.equal(groundsKindFromText('Type II'), 'semi_improved');
  assert.equal(groundsKindFromText('Type III'), 'unimproved');
  assert.equal(groundsKindFromText('Type IV'), 'unimproved');
  assert.equal(groundsKindFromText('Category B'), 'semi_improved');
  assert.equal(groundsKindFromText('Category C'), 'unimproved');
  assert.equal(groundsKindFromText('BASH area around the runway'), 'semi_improved');
  assert.equal(groundsKindFromText('Burke Sports Complex playing fields'), 'athletic_field');
  assert.equal(groundsKindFromText('Shrub and planting beds, all improved areas'), 'shrub_bed');
  assert.equal(groundsKindFromText('Ornamental and shade trees under 30 ft'), 'tree_canopy');
  assert.equal(groundsKindFromText('POV parking lots – main post'), 'parking');
  assert.equal(groundsKindFromText('Sidewalks, building entrance walks and plazas'), 'sidewalk');
  assert.equal(groundsKindFromText('Rough mow (natural areas)'), 'unimproved');
  assert.equal(groundsKindFromText('Prato rasato / Improved turf'), 'improved_turf');
});

test('categories: use / CATCODE description first, office-only buildings are admin, descriptions only break ties', () => {
  assert.equal(categorize('Harmon Park Community Center (multipurpose rooms, gymnasium, catering kitchen)'), 'community');
  assert.equal(categorize('Tactical Equipment Maintenance Facility (TEMF), Administrative Areas Only'), 'admin');
  assert.equal(categorize('DIRECTORATE OF PLANS, TRAINING, MOBILIZATION AND SECURITY'), 'admin');
  assert.equal(categorize('UEPH BARRACKS'), 'barracks');
  assert.equal(categorize('Physical Plant'), 'maintenance');
  assert.equal(categorize('Warrior Restaurant (DFAC)'), 'dining');
  const inv = read(lines('Bldg No. | Facility Name | CATCODE DESCRIPTION | GSF', '02217 | LRC SUPPLY AND SERVICES | ADMIN GEN PURPOSE | 7,750', '00402 | SUPPORT CENTER | Warehouse / Office / Shops | 46,300'));
  assert.equal(fac(inv, '02217').category, 'admin');
  assert.equal(fac(inv, '00402').category, 'warehouse');
});

// ---------------------------------------------------------------------------------------------- facility tables

test('total, subtotal and grand-total rows are not facilities; footnote markers never glue into numbers', () => {
  const inv = read(lines(H,
    '1201 | Brigade HQ | Admin | 2 | 45,200[^1] | 38,400 | Daily',
    '1205 | Annex | Admin | 1 | 18,750* | 15,900 | Daily',
    'Subtotal - Cantonment |  |  |  | 63,950 | 54,300 |',
    ' | ZONE 1 SUBTOTAL - 2 FACILITIES IN SCOPE |  |  | 63,950 |  |',
    'GRAND TOTAL – ALL ZONES (2 FACILITIES) |  |  |  | 63,950 |  |',
    'TOTAL |  |  |  | 63,950 | 54,300 |'));
  assert.deepEqual(inv.facilities.map((f) => f.buildingNumber), ['1201', '1205']);
  assert.equal(fac(inv, '1201').grossSqft, 45200);
  assert.equal(fac(inv, '1205').grossSqft, 18750);
});

test('excluded, demolished, vacant, struck and zero-day rows stay in the inventory with a status', () => {
  const inv = read(lines('Bldg No. | Facility Name | Floors | Gross SF | Service Days/Week | Remarks',
    '~~5100~~ | ~~Central Issue Facility~~ | 1 | ~~82,000~~ | 2 |',
    '5230 | Motor Pool (DEMOLISHED FY26) | 1 | 44,000 | N/A - excluded |',
    '6010 | Hangar 1 | 1 | 120,000 | 5 | Vacant - not in scope',
    '0030 | Ballman Speer | 1 | 12,466 | 0 | Storage – no custodial service',
    '7020 | Range Control | 2 | 26,500 | 5 | Server rooms excluded'));
  assert.equal(fac(inv, '5100').status, 'deleted_by_amendment');
  assert.equal(fac(inv, '5230').status, 'demolished');
  assert.equal(fac(inv, '6010').status, 'vacant');
  assert.equal(fac(inv, '0030').status, 'excluded');
  assert.equal(fac(inv, '7020').status, undefined);
  assert.ok(fac(inv, '6010').statusReason);
  assert.equal(inScope(inv).length, 1);
});

test('campus columns and campus grouping rows: the same number on two campuses is two facilities', () => {
  const inv = read(lines('Campus | Bldg No. | Facility Name | Gross SF | Frequency',
    'Main Post | 0012 | Brigade HQ | 31,395 | Daily',
    'North Annex | 0012 | Annex Ops | 12,000 | Daily',
    'North Annex | 12 | Annex Ops | 12,000 | Daily'));
  assert.equal(inv.facilities.length, 2);
  assert.deepEqual(inv.facilities.map((f) => [f.campus, f.grossSqft]).sort(), [['Main Post', 31395], ['North Annex', 12000]]);
  assert.notEqual(inv.facilities[0].id, inv.facilities[1].id);
  const grouped = read(lines('Item | Building | Est. Gross Square Footage | Floors | Days of Service',
    'WINTER HAVEN CAMPUS – 4100 Lake Region Boulevard, Winter Haven, Florida 33881',
    '1 | WAD – Administration | 47,863 | 2 | M–F',
    '15 | Chain of Lakes (COL) | 14,540 | 2 | M–F',
    ' | Winter Haven Campus Subtotal | 62,403 |  |',
    'LAKELAND CAMPUS – 1850 Lakeridge Parkway, Lakeland, Florida 33805',
    '17 | LTB – Technology Building | 127,050 | 3 | M–Sa',
    '23 | Four (4) Modular Buildings – LMA, LMB, LMC, LMD | 7,752 | 1 | M/W/F'));
  assert.equal(fac(grouped, 'WAD').name, 'Administration');
  assert.equal(fac(grouped, 'WAD').campus, 'WINTER HAVEN CAMPUS');
  assert.equal(fac(grouped, 'COL').grossSqft, 14540);
  assert.equal(fac(grouped, 'LTB').campus, 'LAKELAND CAMPUS');
  assert.ok(grouped.facilities.some((f) => !f.buildingNumber && f.grossSqft === 7752), 'a group billing line without a code is one facility');
  assert.equal(grouped.facilities.length, 4);
});

test('zone banner rows inside a table carry onto the rows below and are not facilities', () => {
  const inv = read(lines('FAC NO | FACILITY NAME | FLRS | GSF | CUSTODIAL FREQ',
    'CANTONMENT AREA A – MAIN POST |  |  |  |',
    'P-100 | GARRISON HEADQUARTERS | 3 | 48,620 | 5X/WK',
    'CANTONMENT AREA B – TROOP AREA |  |  |  |',
    '01201 | 1ST BRIGADE COMBAT TEAM HEADQUARTERS | 3 | 31,640 | 5X/WK'));
  assert.equal(inv.facilities.length, 2);
  assert.equal(fac(inv, 'P-100').campus, 'CANTONMENT AREA A – MAIN POST');
  assert.equal(fac(inv, '01201').campus, 'CANTONMENT AREA B – TROOP AREA');
});

test('units: UM column, header unit, cell suffix and caption; converted to SF with the printed area kept', () => {
  const um = read(lines('Bldg No. | Facility Name | Gross Area | UM | Frequency', '1201 | Brigade HQ | 4,200 | SM | Daily', '1205 | Annex | 18,750 | SF | Daily'));
  assert.equal(fac(um, '1201').grossSqft, 45208);
  assert.deepEqual(fac(um, '1201').originalArea, { gross: 4200, cleanable: undefined, unit: 'sm' });
  assert.equal(fac(um, '1205').grossSqft, 18750);
  const header = read(lines('BLDG NO. | FACILITY NAME | FLRS | GROSS AREA (SM) | CLEANABLE AREA (SM) | SERVICE FREQ', '47 | GARRISON HQ | 3 | 3,960.0 | 3,105.8 | 5X/WK'));
  assert.equal(fac(header, '47').grossSqft, 42625);
  assert.equal(fac(header, '47').cleanableSqft, 33431);
  const italian = read(lines('Host nation data, Italian number format. Superficie lorda in metri quadrati (mq).', '', 'N. ED. Bldg no. | DESCRIZIONE / DESCRIPTION | PIANI Floors | SUP. LORDA (mq) Gross area | FREQUENZA Frequency', '12 | UFFICI – U.S. ADMINISTRATIVE OFFICES | PT+1 | 1.240 | 2 v/sett.', '15 | MAGAZZINO – STORAGE | PT | 680 | quindicinale'));
  assert.equal(fac(italian, '12').grossSqft, 13347);
  assert.equal(fac(italian, '12').floors, 2, 'PT+1 = two floors');
  assert.equal(fac(italian, '12').serviceLevel, '2x_week');
  assert.equal(fac(italian, '15').serviceLevel, 'biweekly');
  const suffix = read(lines('N. ED. Bldg no. | DESTINAZIONE D’USO / FACILITY | PIANI Floors | LORDA (m²) Gross | NETTA PULIBILE (m²) Cleanable | FREQ. gg/sett.', 'D-01 | BRIGADE HEADQUARTERS | S1+PT+2 | 4.312,8 m² | 3.520,0 m² | 5/7', 'D-15 | ACCESS CONTROL POINT | PT | 96,4 m² | 82,0 m² | 7/7'));
  assert.equal(fac(suffix, 'D-01').grossSqft, 46423);
  assert.equal(fac(suffix, 'D-01').floors, 4);
  assert.equal(fac(suffix, 'D-15').grossSqft, 1038);
  assert.equal(fac(suffix, 'D-15').serviceLevel, 'daily_7');
});

test('a later grounds or acres table never overwrites a building gross; the acres become grounds tied to the building', () => {
  const inv = read(lines(H, '1201 | Brigade HQ | Admin | 2 | 45,200 | 38,400 | Daily', '', 'Bldg No. | Facility Name | Improved Area (acres) | Frequency', '1201 | Brigade HQ | 2.5 | Weekly'));
  assert.equal(fac(inv, '1201').grossSqft, 45200);
  assert.equal(fac(inv, '1201').serviceLevel, 'daily_5');
  assert.equal(inv.grounds.length, 1);
  assert.equal(inv.grounds[0].kind, 'improved_turf');
  assert.equal(inv.grounds[0].quantity, 2.5);
  assert.equal(inv.grounds[0].facilityId, fac(inv, '1201').id);
});

test('the column map is suspended at blank lines and page breaks and resumed only by rows that fit', () => {
  const inv = read(lines('--- page 1 ---', H, '1201 | Brigade HQ | Admin | 2 | 45,200 | 38,400 | Daily', '', 'Page 1 of 2', '', '--- page 2 ---', '1205 | Annex | Admin | 1 | 18,750 | 15,900 | Daily', '', 'Table 6-4. Grounds Type Definitions', 'Improved (Type I) | Developed areas with lawns | 2 to 4 inches | Weekly'));
  assert.deepEqual(inv.facilities.map((f) => f.buildingNumber), ['1201', '1205']);
  assert.equal(fac(inv, '1205').source?.page, 2);
  assert.equal(inv.grounds.length, 0, 'a definitions table is not a grounds workload');
});

test('a gross area is overwritten only by a later-ranked document, whatever the upload order', () => {
  const amendment = { name: 'Amendment 0002.txt', role: 'amendment' as const, amendment: 2, text: lines(H, '1201 | Brigade HQ | Admin | 2 | 47,900 | 40,100 | Daily') };
  const base = { name: 'PWS.txt', role: 'pws' as const, text: lines(H, '1201 | Brigade HQ | Admin | 2 | 45,200 | 38,400 | Daily') };
  const inv = read(amendment, base);
  assert.equal(fac(inv, '1201').grossSqft, 47900);
  assert.equal(fac(inv, '1201').cleanableSqft, 40100);
  assert.match(fac(inv, '1201').notes ?? '', /Superseded 45,200 SF/);
  const sameRank = read(base, { ...base, name: 'Attachment.txt', text: lines('Bldg No. | Facility Name | Pricing Area (SF)', '1201 | Brigade HQ | 6,850') });
  assert.equal(fac(sameRank, '1201').grossSqft, 45200, 'a second schedule of the same rank does not replace the gross');
});

test('Was / Is Changed To columns: the new value wins', () => {
  const inv = read(
    { name: 'TE-1.txt', role: 'attachment', text: lines('Item | Bldg No. | Facility Name | No. of Floors | Gross Square Feet (GSF) | Service Frequency', '2 | 104 | DPW Administration | 2 | 18,240 | Daily (M–F)') },
    { name: 'Amendment 0002.txt', role: 'amendment', amendment: 2, text: lines('TE-1 Item | Bldg No. | Facility Name / Description | Gross Square Feet (GSF) Was | Gross Square Feet (GSF) Is Changed To | Change (+/−) | Basis for Change', '2 | 104 | DPW Administration | 18,240 | 19,860 | +1,620 | Racquetball court wing demolished; record corrected.') });
  assert.equal(fac(inv, '104').grossSqft, 19860);
  assert.equal(fac(inv, '104').status, undefined, 'a demolished wing is not a demolished building');
  assert.equal(fac(inv, '104').floors, 2);
});

test('portable classrooms "N @ SF" are added to the permanent building area', () => {
  const inv = read(lines('Loc. No. | School / Facility | Floors | Permanent Building SF | Portable Classrooms No. @ SF each | Gym Wood Floor SF | Cleaning Schedule', '205 | Fernhill Elementary School | 1 | 44,286 | 2 @ 960 1 @ 1,792 (dbl.) | — | M–F', '402 | Summit Ridge High School | 3 | 245,600 | — | 13,920 + 7,680 aux. | M–F'));
  assert.equal(fac(inv, '205').grossSqft, 47998);
  assert.equal(fac(inv, '402').grossSqft, 245600);
});

test('fixtures: a total column, WC / UR / LAV / SH columns, or "10 / 4 / 9 / 2" in one cell', () => {
  const inv = read(lines('Bldg. No. | Building | Floors | Gross SF | Cleanable SF | Restroom Fixtures WC / UR / LAV / SH | Cleaning Days', 'PB-1 | Harmon Park Community Center | 2 | 14,860 | 12,415 | 10 / 4 / 9 / 2 | Monday – Friday', '', 'Campus | Bldg | Facility Name | GSF | WC | UR | LAV | Frequency', 'Main Post | 0012 | Brigade Headquarters | 31,395 | 9 | 5 | 8 | Daily (5 days)'));
  assert.equal(fac(inv, 'PB-1').restroomFixtures, 25);
  assert.equal(fac(inv, '0012').restroomFixtures, 22);
});

test('floor-finish SF columns give the floor mix', () => {
  const inv = read(lines('Bldg | Facility Name | GSF | Carpet SF | VCT SF | Ceramic SF', '0012 | Brigade HQ | 31,395 | 10,000 | 8,000 | 2,000'));
  assert.deepEqual(fac(inv, '0012').floorMix, { carpet: 0.5, resilient: 0.4, hardTile: 0.1 });
});

test('real property extracts: only BUILDING rows in area units are facilities; status, UM and CATCODE scope rules apply', () => {
  const memo = { name: 'Cover Memo.txt', role: 'attachment' as const, text: lines('Records | Identified by | Unit | Applicability', 'Unimproved grounds and training lands | CATCODE 93230 | AC | Not in scope – maintained by Range Control', 'Utility systems | CATCODE 81xxx – 84xxx | EA, KV | Not in scope') };
  const rpi = { name: 'RPI.xlsx', role: 'attachment' as const, text: lines('=== RPI.xlsx :: sheet "RPI" (9 rows) ===',
    'RPUID | FACILITY_NUMBER | FACILITY_NAME | RPA_TYPE | CATCODE | CATCODE_TITLE | PRIMARY_UM | TOTAL_UM_QTY | FLOORS | YEAR_BUILT | FAC_STATUS',
    '1377897 | 00101 | GARRISON HEADQUARTERS | BUILDING | 61050 | ADMIN GEN PURPOSE | SF | 34210 | 3 | 1958 | ACTIVE',
    '1166641 | 00130 | OLD POST HEADQUARTERS | BUILDING | 61050 | ADMIN GEN PURPOSE | SF | 22600 | 2 | 1941 | CLOSED',
    '1632809 | 02221 | COVERED STORAGE SHED | STRUCTURE | 44250 | COVERED STORAGE SHED | SF | 6000 |  | 2008 | ACTIVE',
    '1399419 | 00191 | POV PARKING - BLDG 00101 | STRUCTURE | 85215 | VEHICLE PARKING, SURFACED | SY | 6850 |  | 1958 | ACTIVE',
    '1814902 | 08501 | KNOX AVENUE | LINEAR STRUCTURE | 85110 | ROAD, SURFACED | SY | 24600 |  | 1941 | ACTIVE',
    '1304929 | 08201 | CENTRAL HEATING PLANT | BUILDING | 82110 | HEATING PLANT | MB | 24500 | 1 | 1962 | ACTIVE',
    '1977651 | 09301 | IMPROVED GROUNDS - MAIN POST | LAND | 93210 | IMPROVED GROUNDS | AC | 42.62 |  |  | ACTIVE',
    '1861176 | 09320 | UNIMPROVED GROUNDS - TRAINING AREAS | LAND | 93230 | UNIMPROVED GROUNDS | AC | 8640 |  |  | ACTIVE',
    '1160935 | 1101 | UEPH BARRACKS | BUILDING | 72111 | UEPH | SF | 58750 | 3 | 2009 | ACTIVE',
    '*** END OF REPORT - 9 RECORDS ***') };
  const inv = read(memo, rpi);
  assert.deepEqual(inScope(inv).map((f) => f.buildingNumber).sort(), ['00101', '1101']);
  assert.equal(fac(inv, '00130').status, 'vacant');
  assert.equal(inv.facilities.find((f) => f.buildingNumber === '08201'), undefined, 'a heating plant measured in MB is not floor area');
  assert.equal(fac(inv, '1101').category, 'barracks');
  assert.deepEqual(inv.grounds.map((g) => [g.kind, g.quantity, g.unit]).sort(), [['improved_turf', 42.62, 'acres'], ['parking', 6850, 'sqyd']]);
  assert.equal(inv.grounds.find((g) => g.kind === 'parking')?.facilityId, fac(inv, '00101').id);
});

test('tab-separated text exports keep their empty cells and read like pipe rows', () => {
  const inv = read(['Bldg No.\tFacility Name\tUse\tFloors\tGross SF\tCleanable SF\tFrequency', '1201\tBrigade HQ\tAdmin\t2\t45,200\t\tDaily', 'Subtotal\t\t\t\t45,200\t\t'].join('\n'));
  assert.equal(inv.facilities.length, 1);
  assert.equal(fac(inv, '1201').grossSqft, 45200);
  assert.equal(fac(inv, '1201').cleanableSqft, undefined);
  assert.equal(fac(inv, '1201').serviceLevel, 'daily_5');
});

test('header synonyms in any column order; a Service Level column in a building table is the cleaning frequency', () => {
  const inv = read(lines('Frequency | Area (SF) | Building No | Description | Levels | Cleanable Area', 'Daily (5 days) | 45,200 | 1201 | Brigade Headquarters | 2 | 38,400'), lines('Service Level | Facility Description | Bldg # | Square Footage | Serviced SF | # Floors', '7X/WK | Barracks | T-2401 | 96,000 | 28,800 | 4'));
  assert.deepEqual([fac(inv, '1201').grossSqft, fac(inv, '1201').cleanableSqft, fac(inv, '1201').floors], [45200, 38400, 2]);
  assert.deepEqual([fac(inv, 'T-2401').grossSqft, fac(inv, 'T-2401').cleanableSqft, fac(inv, 'T-2401').floors, fac(inv, 'T-2401').serviceLevel], [96000, 28800, 4, 'daily_7']);
});

test('"qm" and a lone d.ddd building area read as thousands; "bi-weekly" is flagged as ambiguous', () => {
  const inv = read(lines('Bldg No. | Facility Name | Gross Area | UM | Frequency', '3105 | Kaserne Admin | 1.200 | qm | BI-WKLY'));
  assert.equal(fac(inv, '3105').grossSqft, 12917);
  assert.equal(fac(inv, '3105').serviceLevel, 'biweekly');
  assert.match(fac(inv, '3105').notes ?? '', /every two weeks/);
});

test('comma-separated tables pasted as text are read as rows', () => {
  const inv = read(lines('Bldg No.,Facility Name,Use,Floors,Gross SF,Cleanable SF,Frequency', '1201,Brigade HQ,Admin,2,"45,200","38,400",Daily', '1205,Annex,Admin,1,18750,15900,Daily'));
  assert.equal(fac(inv, '1201').grossSqft, 45200);
  assert.equal(fac(inv, '1205').cleanableSqft, 15900);
});

test('facility lines with no table header: lettered and hyphenated numbers, SF suffixes', () => {
  const inv = read(lines('Bldg T-2401, Barracks, 96,000 SF, daily', 'Building A-101 Battalion HQ 18,750 SF', 'Facility P-114 Dining Facility 28,500 GSF', 'Bldg 1201A Brigade HQ 45,200 SF', 'Building 131 (6,400 SF) is vehicle storage maintained by the using unit.'));
  assert.deepEqual(inv.facilities.map((f) => [f.buildingNumber, f.grossSqft]), [['T-2401', 96000], ['A-101', 18750], ['P-114', 28500], ['1201A', 45200]]);
});

// ---------------------------------------------------------------------------------------------- key / value sheets

test('GSA building information sheets: label | value pairs gathered per building, spacer cells skipped', () => {
  const sheet = (bn: string, name: string, gsf: string, csf: string, extra: string[] = []) => lines(
    'EXHIBIT J.1 – BUILDING INFORMATION SHEET',
    `GSA Building Number | ${bn} | Ownership | Federally Owned`,
    `Building Name | ${name}`,
    `Gross Square Feet (GSF) | ${gsf} | Rentable Square Feet (RSF) | 97,315`,
    'ABOA Square Feet | 84,902 | Days of Custodial Service | Monday – Friday, excluding Federal holidays',
    'Floors Above Grade | 4 | Floors Below Grade | 1 (basement)',
    'Space Type | Custodial Sq. Ft. | Frequency | Remarks',
    'Office / general administrative space | 41,280 | Daily |',
    `TOTAL CUSTODIAL (CLEANABLE) SQUARE FEET |  | ${csf} |  |`,
    'Restroom Type | No. of Restrooms | Plumbing Fixtures |  |  |  | Fixtures',
    ' |  | Water Closets | Urinals | Lavatories | Showers',
    'TOTAL | 26 | 34 | 12 | 32 | 2 | 80',
    ...extra);
  const inv = read(lines(
    sheet('VA0123ZZ', 'Thomas R. Whitcomb Federal Building', '118,460', '88,900', ['Total Site Area | 3.10 acres | Grounds Maintenance in Contract | Yes – Contractor (C.4)', 'Landscaped / Improved Grounds | 1.25 acres | Snow and Ice Removal | Yes', 'Parking Areas | 38,600 SF (surface lot, 118 spaces)', 'Sidewalks, Plazas and Steps | 11,250 SF']),
    sheet('VA0241ZZ', 'Federal Office Building', '38,750', '22,860 (revised A0001; was 21,460)', ['Total Site Area | 0.82 acre | Grounds Maintenance in Contract | No – USPS', 'Landscaped / Improved Grounds | 0.30 acre – Not in contract (maintained by USPS) | Snow and Ice Removal | Yes'])));
  const a = fac(inv, 'VA0123ZZ');
  assert.equal(a.name, 'Thomas R. Whitcomb Federal Building');
  assert.equal(a.grossSqft, 118460);
  assert.equal(a.cleanableSqft, 88900);
  assert.equal(a.floors, 5, 'floors above + below grade');
  assert.equal(a.restroomFixtures, 80);
  assert.equal(a.serviceLevel, 'daily_5');
  assert.equal(fac(inv, 'VA0241ZZ').cleanableSqft, 22860);
  assert.deepEqual(inv.grounds.map((g) => [g.kind, g.quantity, g.unit]), [['improved_turf', 1.25, 'acres'], ['parking', 38600, 'sqft'], ['sidewalk', 11250, 'sqft']], 'site area is information only; a sheet with grounds not in contract adds none');
});

test('key / value sheets in "Label: value" form, and two labels merged into one cell', () => {
  const inv = read(lines('BUILDING INFORMATION SHEET', 'Building Number: MD0012ZZ', 'Building Name: Federal Office Building', 'Gross Square Feet: 125,400', 'Cleanable Square Feet: 98,300', 'Number of Floors: 6', '', 'BUILDING INFORMATION SHEET', 'Building Number: Building Name: | A-101 Battalion Headquarters Annex', 'Gross Square Feet: | 57,862', 'Cleanable Square Feet: | 42,466', 'Number of Floors: | 3'));
  assert.equal(fac(inv, 'MD0012ZZ').grossSqft, 125400);
  assert.equal(fac(inv, 'MD0012ZZ').floors, 6);
  assert.equal(fac(inv, 'A-101').name, 'Battalion Headquarters Annex');
  assert.equal(fac(inv, 'A-101').grossSqft, 57862);
  assert.equal(fac(inv, 'A-101').cleanableSqft, 42466);
});

// ---------------------------------------------------------------------------------------------- grounds tables

test('grounds: repeated ACRES columns take Type I / II / III from the group labels above; totals and dashes are skipped', () => {
  const inv = read(lines('IMPROVED | SEMI-IMPROVED | UNIMPROVED', '(TYPE I) | (TYPE II) | (TYPE III)',
    'AREA NO | AREA DESCRIPTION | FACILITIES SERVED | ACRES | MOWS/YR | ACRES | MOWS/YR | ACRES | MOWS/YR | REMARKS',
    'GA-1 | Headquarters quadrangle | P-100, P-101 | 18.4 | 30 | 3.2 | 12 | — | — |',
    'GA-4 | Child and youth area | 00230 | 9.6 | 30 | — | — | — | — | Playground surfacing excluded',
    'GD-2 | Range control complex | Range Control (R-5101 through R-5130) | 1.9 | 30 | 8.7 | 12 | 412.5 | 1 | Range fans and impact areas excluded',
    'TOTAL – ALL GROUNDS MAINTENANCE AREAS |  |  | 29.9 |  | 11.9 |  | 412.5 |  |'));
  near(acres(inv.grounds, 'improved_turf'), 29.9);
  near(acres(inv.grounds, 'semi_improved'), 11.9);
  near(acres(inv.grounds, 'unimproved'), 412.5);
  assert.ok(!inv.grounds.some((g) => /TOTAL/.test(g.name)));
});

test('grounds: Quantity + UM columns in AC / HA / SY / SM / EA, type columns and labels', () => {
  const inv = read(lines('Area | Type | Quantity | UM', 'Cantonment | Type I | 42.5 | AC', 'Airfield infield | Type II | 86.0 | HA', 'Training buffer | Type III | 640 | AC', 'Parking Lot 12 | Paved | 18,400 | SY', 'Planting beds | Beds | 2,300 | SM', 'Street trees | Ornamental | 140 | EA'));
  const got = Object.fromEntries(inv.grounds.map((g) => [g.kind, [g.quantity, g.unit]]));
  assert.deepEqual(got, { improved_turf: [42.5, 'acres'], semi_improved: [86, 'hectares'], unimproved: [640, 'acres'], parking: [18400, 'sqyd'], shrub_bed: [2300, 'sqm'], tree_canopy: [140, 'each'] });
  near(acres(inv.grounds, 'semi_improved'), 212.51, 0.01);
  assert.equal(inv.facilities.length, 0, 'grounds rows in SM are not buildings');
});

test('grounds: an "Area | Quantity" table with units and kinds in the quantity cell; two equal fields are two areas', () => {
  const inv = read(lines('Area | Quantity', 'Improved grounds, cantonment area (Bldgs 1201, 1205 vicinity) | 42.5 acres improved', 'Ball field north | 5.0 acres athletic', 'Ball field south | 5.0 acres athletic', 'Shrub and planting beds, all improved areas | 86,000 SF shrub beds', 'Parking lots, cantonment | 1,420,000 SF parking', 'Ornamental and shade trees under 30 ft | 1,250 trees'));
  near(acres(inv.grounds, 'improved_turf'), 42.5);
  near(acres(inv.grounds, 'athletic_field'), 10);
  near(sqft(inv.grounds, 'shrub_bed'), 86000);
  near(sqft(inv.grounds, 'parking'), 1_420_000);
  assert.equal(inv.grounds.find((g) => g.kind === 'tree_canopy')?.quantity, 1250);
});

test('grounds: site schedules with mowable / rough-mow / ballfield acres, service levels, beds and trees; total site acres are information only', () => {
  const inv = read(lines('Site No. | Park / Site Name and Address | Total Site Acres | TURF MOWING Mowable Turf Acres | TURF MOWING Svc Lvl | TURF MOWING Mowing Cycle | Rough Mow Acres (Svc Lvl 3) | BALLFIELDS No. | BALLFIELDS Acres | LANDSCAPE Planting Beds (SF) | LANDSCAPE Trees (EA)',
    '1 | Harmon Park 1100 Harmon Parkway | 38.6 | 21.40 | 1 | 7-day | 6.20 | 4 | 7.80 | 6,850 | 214',
    '4 | Pioneer Park 640 Pioneer Drive | 6.8 | 5.10 | 2 | 14-day | — | — | — | 640 | 38',
    '25 | Old Mill Park (restroom building closed – see Table C-1) | 8.6 | 5.30 | 2 | 14-day | — | — | — | 950 | 47',
    ' | TOTAL – ALL SITES (3) |  | 54.0 | 31.80 |  |  | 6.20 | 4 | 7.80 | 8,440 | 299'));
  near(acres(inv.grounds, 'improved_turf'), 21.4);
  near(acres(inv.grounds, 'semi_improved'), 10.4);
  near(acres(inv.grounds, 'unimproved'), 6.2);
  near(acres(inv.grounds, 'athletic_field'), 7.8);
  near(sqft(inv.grounds, 'shrub_bed'), 8440);
  assert.equal(inv.grounds.filter((g) => g.kind === 'tree_canopy').reduce((s, g) => s + g.quantity, 0), 299);
});

test('grounds: medians and rights-of-way in LF × width × sides; paved segments are hardscape, street trees counted', () => {
  const inv = read(lines('Seg. No. | Street / Corridor | Limits (From – To) | Length (LF) | Avg. Width (FT) | Sides | Surface | Svc Lvl | Mowing Cycle',
    'M-1 | Ashby Creek Parkway | Main Street to Delmar Court | 2,450 | 18 | 1 | Turf | 1 | 7-day',
    'M-2 | Ashby Creek Parkway | Delmar Court to Pioneer Drive | 3,120 | 22 | 1 | Turf with street trees (34 EA) | 1 | 7-day',
    'M-5 | Florence Boulevard | Civic Center Drive to Main Street | 1,050 | 8 | 1 | Stamped concrete / pavers – no turf | — | —',
    'R-1 | County Line Road | Sports Complex to east city limits | 5,280 | 15 | 2 | Turf | 1 | 7-day',
    ' | TOTAL LENGTH – 4 SEGMENTS |  | 11,900 |  |  |  |  |'));
  near(acres(inv.grounds, 'improved_turf'), (2450 * 18 + 3120 * 22 + 5280 * 15 * 2) / 43560);
  near(sqft(inv.grounds, 'sidewalk'), 8400);
  assert.equal(inv.grounds.find((g) => g.kind === 'tree_canopy')?.quantity, 34);
});

test('grounds: rows out of scope, information only, or maintained by others carry no workload', () => {
  const inv = read(lines('AREA NO. | GROUNDS AREA | ACRES BY GROUNDS CATEGORY IMPROVED | ACRES BY GROUNDS CATEGORY SEMI-IMPROVED | ACRES BY GROUNDS CATEGORY UNIMPROVED | TOTAL ACRES | REMARKS',
    'C-1 | MAIN CANTONMENT | 187.14 | 55.29 | - | 242.43 | Parade field lawns',
    'C-7 | FAMILY HOUSING AREAS (RCI) | 350.42 | 44.19 | - | 394.61 | RCI PARTNER MAINTAINED - NOT IN SCOPE',
    ' | SUBTOTAL - CANTONMENT | 537.56 | 99.48 | 0 | 637.04 |'));
  near(acres(inv.grounds, 'improved_turf'), 187.14);
  near(acres(inv.grounds, 'semi_improved'), 55.29);
  assert.equal(acres(inv.grounds, 'unimproved'), 0);
});

test('grounds in sentences count only for kinds that no table of the document gave', () => {
  const prose = read('6.1 Type I (improved) grounds total 12.0 acres; Type II (semi-improved) 30 acres. Approximately 4.2 acres of wooded buffer are not maintained.');
  near(acres(prose.grounds, 'improved_turf'), 12);
  near(acres(prose.grounds, 'semi_improved'), 30);
  assert.equal(acres(prose.grounds, 'unimproved'), 0);
  const both = read(lines('Improved grounds total 97.4 acres.', '', 'Area | Quantity', 'Improved grounds, cantonment | 42.5 acres improved', 'Improved grounds, barracks | 54.9 acres improved'));
  near(acres(both.grounds, 'improved_turf'), 97.4);
});

// ---------------------------------------------------------------------------------------------- dining

test('dining: headcount by meal period, weekday and weekend columns (brunch / supper), several DFACs, DFA only, closed DFAC', () => {
  const inv = read(lines('BLDG NO. | DINING FACILITY (WARRIOR RESTAURANT) | SEATING CAPACITY | CAPACITY PER MEAL | SERVICE TYPE | AVERAGE HEADCOUNT BREAKFAST | AVERAGE HEADCOUNT LUNCH | AVERAGE HEADCOUNT DINNER | AVERAGE HEADCOUNT LATE / MIDNIGHT | HEADCOUNT BRUNCH | HEADCOUNT SUPPER | REMARKS',
    '2240 | Dragon Warrior Restaurant | 400 | 1,200 | FFS | CLOSED FOR RENOVATION THROUGH FY27 – NO WORKLOAD |  |  |  |  |  | Not in scope.',
    '4120 | Patriot Warrior Restaurant | 600 | 1,800 | FFS | 410 | 905 | 520 | — | 465 | 330 |',
    '7031 | Ironhorse Warrior Restaurant | 450 | 1,350 | FFS | 285 | 640 | 390 | 115[^5] | 310 | 240 |',
    '9215 | Sentinel Warrior Restaurant | 300 | 900 | DFA | 140 | 315 | 188 | — | 150 | 105 | DFA services only.',
    'TOTAL – DINING FACILITIES IN SCOPE (3) |  | 1,350 | 4,050 |  | 835 | 1,860 | 1,098 | 115 | 925 | 675 |',
    '',
    'BLDG NO. | DINING FACILITY | DAYS OPEN | MONDAY – FRIDAY BREAKFAST | MONDAY – FRIDAY LUNCH | WEEKENDS & HOLIDAYS BRUNCH',
    '4120 | Patriot Warrior Restaurant | 7 | 0730 – 0900 | 1130 – 1300 | 0930 – 1300',
    '',
    'ITEM | BLDG NO. | FACILITY NAME / USE | FLOORS | GROSS AREA (GSF) | CUSTODIAL SERVICE AREA (SF) | FREQUENCY | REMARKS',
    '9 | 4120 | Patriot Warrior Restaurant (DFAC) | 1 | 28,460 | 4,860 | 7X/WK |',
    '15 | 7031 | Ironhorse Warrior Restaurant (DFAC) | 1 | 22,740 | 3,720 | 7X/WK |',
    '17 | 9215 | Sentinel Warrior Restaurant (DFAC) | 1 | 16,380 | 2,940 | 7X/WK |'));
  assert.equal(inv.facilities.length, 4, 'one facility per DFAC building, dining profile and custodial row merged');
  const d = fac(inv, '4120');
  assert.equal(d.grossSqft, 28460);
  assert.equal(d.cleanableSqft, 4860);
  assert.equal(d.dining?.mealsPerDay, 1538);
  assert.equal(d.dining?.mealPeriods, 3);
  assert.equal(d.dining?.seats, 600);
  assert.equal(d.dining?.mealPeriodsDetail?.length, 5);
  assert.equal(fac(inv, '7031').dining?.mealsPerDay, 1179);
  assert.equal(fac(inv, '7031').dining?.mealPeriods, 4);
  assert.equal(fac(inv, '9215').dining?.mealsPerDay, 532);
  assert.equal(fac(inv, '9215').dining?.serviceStyle, 'dining_facility_attendant');
  assert.equal(fac(inv, '2240').status, 'vacant');
  assert.equal(fac(inv, '2240').dining, undefined);
});

test('dining: a meal-period table in rows, with one column per DFAC or weekday / weekend columns', () => {
  const perDfac = read(lines('Bldg 2410 | Warrior Restaurant DFAC | Dining | 1 | 28,500 SF', 'Bldg 3300 | Lightning Inn DFAC | Dining | 1 | 21,000 SF', '', 'Meal Period | Warrior Restaurant | Lightning Inn', 'Breakfast | 620 | 300', 'Lunch | 1,150 | 640', 'Dinner | 740 | 410', 'Midnight | 140 | 0', 'Total | 2,650 | 1,350'));
  assert.equal(fac(perDfac, '2410').dining?.mealsPerDay, 2650);
  assert.equal(fac(perDfac, '2410').dining?.mealPeriods, 4);
  assert.equal(fac(perDfac, '3300').dining?.mealsPerDay, 1350);
  const week = read(lines('Bldg No. | Facility Name | Gross SF', '2410 | Warrior Restaurant (DFAC) | 28,500', '', 'Meal Period | Weekday Avg Headcount | Weekend Avg Headcount', 'Breakfast | 620 | 410', 'Lunch | 1,150 | 780', 'Dinner | 740 | 650', 'Midnight | 140 | 90', 'Total | 2,650 | 1,930'));
  assert.equal(fac(week, '2410').dining?.mealsPerDay, Math.round((5 * 2650 + 2 * 1930) / 7));
});

test('dining: meals per day stated in prose attach to the building named nearby, with seats and kitchen area', () => {
  const inv = read(lines(H, 'Bldg 2410 | Dining Facility (Warrior Restaurant) | Dining | 1 | 28,500 SF | 25,600 SF | Daily (7 days)', '', '7.1 The Contractor shall operate Dining Facility Bldg 2410 (Warrior Restaurant) providing full food service.', '', '7.2 Workload. The facility serves an average of 2,650 meals per day across four meal periods (breakfast, lunch, dinner, and midnight meal), seven days per week. Seating capacity is 450 seats. The kitchen and serving area is approximately 11,000 SF.'));
  const d = fac(inv, '2410').dining!;
  assert.equal(d.mealsPerDay, 2650);
  assert.equal(d.mealPeriods, 4);
  assert.equal(d.seats, 450);
  assert.equal(d.kitchenSqft, 11000);
  assert.equal(d.daysPerWeek, 7);
});

// ---------------------------------------------------------------------------------------------- amendments and Q&A

test('amendment statements: deletions, revisions by value or by field, floor corrections; "may be deleted" is not applied', () => {
  const base = { name: 'TE-1.txt', role: 'attachment' as const, text: lines('Item | Facility Bldg No. | Facility Name / Description | No. of Floors | Gross Square Feet (GSF)[^1] | Service Frequency', '7 | 118[^3] | Education Center Annex | 1 | 7,920 | Weekly', '13 | 1207 | Company Operations Facility | 1 | 14,880 | Daily (M–F)', '14 | 1210 | Mission Training Complex | 1 | 31,640 | 3x Weekly', '15 | 1214 | Digital Training Facility | 1 | 9,275 | 2x Weekly', '16 | 901 | Administrative Service Center | 2 | 18,240 | M–F') };
  const qa = { name: 'Questions and Answers No 1.docx', role: 'qa' as const, text: lines('No. | Solicitation Reference | Question | Government Response',
    '5 | TE-1, Item 7, Bldg 118 | Will Building 118 still be serviced? | No. Building 118 is deleted from the requirement in its entirety by Amendment 0002.',
    '6 | TE-1, Item 13, Bldg 1207 | TE-1 shows Building 1207 as one floor. | The Government concurs. The number of floors for Building 1207 in TE-1 is corrected from 1 to 2.',
    '7 | General | Will buildings be added later? | Building 1214 may be deleted during the term by modification.') };
  const amd = { name: 'Amendment 0002.txt', role: 'amendment' as const, amendment: 2, text: lines('Item 3 – Location 901, Administrative Service Center', 'Exhibit A, Column (9) for Location 901 is revised from 18,240 SF to 22,960 SF.', '', 'Amendment 0002 revises Building 1210 to 33,120 GSF.') };
  const inv = read(base, qa, amd);
  assert.equal(fac(inv, '118').status, 'deleted_by_amendment');
  assert.equal(fac(inv, '1207').floors, 2);
  assert.equal(fac(inv, '1207').grossSqft, 14880);
  assert.equal(fac(inv, '1214').status, undefined, 'a possible future deletion is not a deletion');
  assert.equal(fac(inv, '901').grossSqft, 22960);
  assert.equal(fac(inv, '1210').grossSqft, 33120);
});

test('amendment change tables: "Added to scope" with labelled values, "Corrected … changed from", "Removed from scope"', () => {
  const exhibit = { name: 'Exhibit A.xlsx', role: 'attachment' as const, text: lines('Building # | Building Name | Campus | Gross Sq Ft | Cleanable Sq Ft | # Floors | Restroom Fixtures | Service Days/Week', '2210 | Nursing and Allied Health | Health Sciences | 48210 | 36400 | 3 | 22 | 5', '0084 | Hawthorne Hall | Main | 34750 | 28500 | 3 | 18 | 5') };
  const add = { name: 'Addendum No. 1.pdf', role: 'amendment' as const, amendment: 1, text: lines('Item | Building # | Building Name | Change | Revised Information',
    'A-1 | 1114 | Ridgeview Commons | Added to scope | Gross Sq Ft 11,000; Cleanable Sq Ft 9,350; 1 floor; 14 restroom fixtures; 7 service days per week; Campus: Main.',
    'A-2 | 2210 | Nursing and Allied Health | Corrected | Gross Sq Ft is changed from 48,210 to 42,810. Cleanable Sq Ft (36,400) and all other columns are unchanged.',
    'A-3 | 0084 | Hawthorne Hall | Removed from scope | Do not price.') };
  const inv = read(exhibit, add);
  const n = fac(inv, '1114');
  assert.deepEqual([n.grossSqft, n.cleanableSqft, n.floors, n.restroomFixtures, n.serviceLevel, n.campus], [11000, 9350, 1, 14, 'daily_7', 'Main']);
  assert.equal(fac(inv, '2210').grossSqft, 42810);
  assert.equal(fac(inv, '2210').cleanableSqft, 36400);
  assert.equal(fac(inv, '0084').status, 'deleted_by_amendment');
});

test('addenda bound into the same document: a deleted site removes its grounds; revised turf acres and median length are applied', () => {
  const inv = read(lines('Site No. | Park / Site Name | TURF MOWING Mowable Turf Acres | TURF MOWING Svc Lvl | LANDSCAPE Trees (EA)',
    '9 | Creekside Greenway | 6.40 | 2 | —', '14 | Wexford Commons Pocket Park | 0.48 | 2 | 9',
    '',
    'Seg. No. | Street / Corridor | Length (LF) | Avg. Width (FT) | Sides | Surface | Svc Lvl', 'M-6 | Kingsridge Road | 2,640 | 14 | 1 | Turf | 1',
    '',
    'ADDENDUM NO. 1',
    'a. Site 14, Wexford Commons Pocket Park, is DELETED in its entirety. Delete all quantities for Site 14 (0.48 mowable turf acres, 9 trees).',
    'b. Site 9, Creekside Greenway: Mowable Turf Acres are REVISED from 6.40 to 7.15 acres (trailhead lawn expansion).',
    'c. Segment M-6, Kingsridge Road: Limits are REVISED to read “Pioneer Drive to Westfield Boulevard.” Length is REVISED from 2,640 LF to 3,180 LF.'));
  near(acres(inv.grounds, 'semi_improved'), 7.15);
  assert.equal(inv.grounds.filter((g) => g.kind === 'tree_canopy').length, 0);
  near(acres(inv.grounds, 'improved_turf'), (3180 * 14) / 43560);
});

test('a deletion banner before a building sheet names the building it deletes', () => {
  const inv = read({ name: 'J1 conformed.docx', role: 'amendment', amendment: 1, text: lines(
    'GSA Building Number | VA0402ZZ | Ownership | Federally Owned', 'Building Name | Support Center', 'Gross Square Feet (GSF) | 46,300 | Rentable Square Feet (RSF) | 44,860',
    'DELETED BY AMENDMENT 0001 – RETAINED FOR REFERENCE ONLY. Building VA0355ZZ is not part of this solicitation; see Summary of Changes, Item 1.',
    'EXHIBIT J.1 – BUILDING INFORMATION SHEET',
    'GSA Building Number | VA0355ZZ | Ownership | Federally Owned', 'Building Name | Federal Records Annex', 'Gross Square Feet (GSF) | 22,480 | Rentable Square Feet (RSF) | 21,390', 'Landscaped / Improved Grounds | 0.65 acre | Snow and Ice Removal | Yes') });
  assert.equal(fac(inv, 'VA0402ZZ').status, undefined);
  assert.equal(fac(inv, 'VA0355ZZ').status, 'deleted_by_amendment');
  assert.equal(inv.grounds.length, 0, 'grounds of a deleted building are dropped');
});

test('"where no cleanable area is given, the gross area applies" fills cleanable from gross', () => {
  const inv = read(lines('4. Where no cleanable area is given, the gross area applies.', '', 'N. ED. Bldg no. | DESCRIPTION | SUP. LORDA (SF) Gross area | FREQUENZA Frequency', '12 | ADMINISTRATIVE OFFICES | 13,347 | 2 v/sett.'));
  assert.equal(fac(inv, '12').cleanableSqft, 13347);
});

// ---------------------------------------------------------------------------------------------- previous award and site

test('prior award: incumbent, contract number, award year, total value and period from a current-contract paragraph', () => {
  const pa = heuristicPriorAward([doc('1.4 Current Contract (For Information Only). The services are currently performed by Sandhill Garrison Services, LLC under Contract No. W9124J-21-C-0012, a firm-fixed-price (FFP) contract awarded on 24 September 2021. The contract consists of a twelve-month base period and four twelve-month option periods, with a total contract value, inclusive of all option periods, of $71,284,960. The annual value of the current option period (Option Period 4) is $14,962,415. An extension of services under FAR 52.217-8 was exercised in the amount of $7,481,208. Field feeding is ordered separately under Contract No. W9124J-24-D-0019 (ceiling $4,950,000) and is not part of this requirement.')]);
  assert.ok(pa);
  assert.equal(pa!.incumbent, 'Sandhill Garrison Services, LLC');
  assert.equal(pa!.contractNumber, 'W9124J-21-C-0012');
  assert.equal(pa!.awardYear, 2021);
  assert.equal(pa!.totalValue, 71_284_960);
  assert.equal(pa!.periodMonths, 60);
  assert.equal(pa!.annualValue, 14_962_415);
});

test('prior award: unhyphenated PIIDs, spend to date vs one year of obligations, monthly figures ignored, Q&A rows', () => {
  const gsa = heuristicPriorAward([doc('Q3. Who is the incumbent contractor? A3. The current contract, 47PC0322C0042, was awarded in December 2021 to Caldera Ridge Facility Services, LLC for a base year and four option years (60 months). The total awarded value including all options is $5,612,350. The value of the current option year (Option Year 4) is $1,146,880.')]);
  assert.deepEqual([gsa?.contractNumber, gsa?.incumbent, gsa?.awardYear, gsa?.totalValue, gsa?.periodMonths, gsa?.annualValue], ['47PC0322C0042', 'Caldera Ridge Facility Services, LLC', 2021, 5_612_350, 60, 1_146_880]);
  const k12 = heuristicPriorAward([doc('1.3 Current Contract. Custodial services are presently provided by Sound & Summit Building Care, LLC under Contract No. CPSD-C-22-031, awarded by the Board in May 2022. Payments under the contract for the 2025-26 school year totaled $3,412,860. Total payments from July 1, 2022 through June 30, 2026 (48 months) were $12,904,115.')]);
  assert.deepEqual([k12?.incumbent, k12?.contractNumber, k12?.annualValue, k12?.spendToDate, k12?.spendPeriodMonths], ['Sound & Summit Building Care, LLC', 'CPSD-C-22-031', 3_412_860, 12_904_115, 48]);
  const college = heuristicPriorAward([doc('1.3 Current Contract. Custodial services are presently provided by Meridian Building Care, Inc. under Contract No. LSC-22-117, which was awarded in April 2022. The current annual contract amount is $2,186,400 ($182,200 per month).')]);
  assert.equal(college?.annualValue, 2_186_400);
  assert.equal(college?.incumbent, 'Meridian Building Care, Inc.');
  const qa = heuristicPriorAward([doc(lines('No. | Solicitation Reference | Question | Government Response', '1 | General | Who is the incumbent? | The incumbent contractor is Ostrander Facility Group, LLC, performing under contract W9124D-21-C-0007, a firm-fixed-price contract awarded 24 September 2021. Total obligations for FY2025 were $4,812,330 (1 October 2024 through 30 September 2025).'))]);
  assert.deepEqual([qa?.incumbent, qa?.contractNumber, qa?.annualValue, qa?.spendToDate], ['Ostrander Facility Group, LLC', 'W9124D-21-C-0007', 4_812_330, undefined]);
  assert.equal(heuristicPriorAward([doc('5.1 Insurance. Commercial General Liability, $1,000,000 each occurrence. The Contract is valued at $100,000 or more.')]), undefined);
});

test('site: solicitation numbers with or without hyphens, installation, contract term and climate', () => {
  const army = read('SOLICITATION W9124J-27-R-0031\nBASE OPERATIONS SUPPORT SERVICES – FORT KEARSLEY\nFort Kearsley is located near Columbus, Georgia.\n1.3 Period of Performance. The period of performance consists of one (1) twelve-month base period and four (4) twelve-month option periods.');
  assert.equal(army.site.solicitation, 'W9124J-27-R-0031');
  assert.equal(army.site.contractYears, 5);
  assert.equal(army.site.climateZone, 'hot_humid');
  const gsa = read('Solicitation No. 47PC0326R0014 — Shenandoah Valley Federal Buildings\nC.1.3 Period of Performance. A twelve (12) month base period and four (4) twelve-month option periods, for a total of five (5) years if all options are exercised. Harrisonburg, Virginia.');
  assert.equal(gsa.site.solicitation, '47PC0326R0014');
  assert.equal(gsa.site.contractYears, 5);
  assert.equal(gsa.site.installationName, 'Shenandoah Valley Federal Buildings');
  assert.equal(gsa.site.climateZone, 'temperate');
  const city = read('CITY OF ASHBY CREEK\nRFP No. 2027-014\n1.2 Term of Contract. The initial term of the Contract shall be two (2) years. The Contract may be renewed for up to three (3) additional one (1) year terms, for a maximum total term of five (5) years. The City of Ashby Creek, Missouri.\n1.3 Current Services. The incumbent contract was a one-year initial term with four renewals.');
  assert.equal(city.site.contractYears, 5);
  assert.match(city.site.solicitation ?? '', /2027-014/);
});

// ---------------------------------------------------------------------------------------------- review regressions

test('number format: only the area and quantity columns vote; a "1,2" footnote or number cell never flips a U.S. table', () => {
  const notes = read(lines('Bldg No. | Facility Name | Floors | Gross SF | Cleanable SF | Frequency | Notes',
    '1201 | Brigade HQ | 2 | 45,200 | 38,400 | Daily | 1,2', '1205 | Annex | 1 | 18,750 | 15,900 | Daily | 3', '1210 | Training Center | 1 | 31,640 | 28,000 | Daily |'));
  assert.deepEqual(notes.facilities.map((f) => [f.buildingNumber, f.grossSqft, f.cleanableSqft]), [['1201', 45200, 38400], ['1205', 18750, 15900], ['1210', 31640, 28000]]);
  const bn = read(lines('Bldg No. | Facility Name | Floors | Gross SF | Frequency', '12,14 | Barracks pair | 3 | 58,000 | Daily', '1205 | Annex | 1 | 18,750 | Daily'));
  assert.equal(fac(bn, '1205').grossSqft, 18750);
  const long = read(lines('Bldg No. | Facility Name | Floors | Gross SF | Frequency | Notes', ...Array.from({ length: 250 }, (_, i) => `${3000 + i} | Facility ${i} | 1 | 10,${String(100 + i).padStart(3, '0')} | Daily | ${i === 249 ? '1,2' : ''}`)));
  assert.equal(fac(long, '3000').grossSqft, 10100);
  assert.equal(fac(long, '3249').grossSqft, 10349);
  // a European table with no caption is still read as European from its area columns
  const eu = read(lines('N. ED. | DESCRIZIONE | LORDA (m²) | NETTA (m²) | NOTE', 'D-01 | COMANDO | 4.312,8 | 3.520,0 | 1,2', 'D-15 | GUARDIOLA | 96,4 | 82,0 |', 'D-16 | MAGAZZINO | 1.240 | 1.100 |'));
  assert.deepEqual(eu.facilities.map((f) => f.originalArea?.gross), [4312.8, 96.4, 1240]);
});

test('N/A, none and "-" in remarks or information columns are blank, not exclusions', () => {
  const inv = read(lines('Bldg No. | Facility Name | Gross SF | Year Built | Historic | RPUID | Frequency | Remarks',
    '1201 | Brigade HQ | 45,200 | 1988 | No | 112233 | Daily | N/A',
    '1205 | Annex | 18,750 | N/A | N/A | N/A | Daily | none',
    '1210 | Training | 31,640 | 1999 | No | - | Daily | Mechanical rooms – excluded',
    '1214 | Storage | 9,275 | 1975 | No | 445566 | N/A |'));
  assert.deepEqual(inScope(inv).map((f) => f.buildingNumber), ['1201', '1205', '1210']);
  assert.equal(fac(inv, '1214').status, 'excluded', 'N/A in the frequency cell still means not serviced');
});

test('partial-scope, schedule and planned-demolition remarks keep the building in scope', () => {
  const inv = read(lines('Bldg No. | Facility Name | Floors | Gross SF | Cleanable SF | Frequency | Remarks',
    '1201 | Brigade HQ | 2 | 45,200 | 38,400 | Daily | Closed weekends and federal holidays',
    '1205 | Annex | 1 | 18,750 | 15,900 | Daily | Kitchen area not included',
    '1210 | Training Center | 1 | 31,640 | 28,000 | 3x Weekly | Mechanical rooms not serviced',
    '1214 | Digital Training | 1 | 9,275 | 8,000 | 2x Weekly | Window washing not included',
    '1220 | Supply | 1 | 12,000 | 10,000 | Weekly | To be demolished FY29; service through FY28',
    '1230 | Old Supply | 1 | 6,000 | 5,000 | Weekly | Scheduled for demolition FY28; not in scope',
    '1240 | Gym | 1 | 20,000 | 18,000 | Daily | Closed for renovation'));
  assert.deepEqual(inScope(inv).map((f) => f.buildingNumber), ['1201', '1205', '1210', '1214', '1220']);
  assert.match(fac(inv, '1220').notes ?? '', /Demolition planned/);
  assert.equal(fac(inv, '1230').status, 'demolished');
  assert.equal(fac(inv, '1240').status, 'vacant');
});

test('deletion statements apply only when the building is the subject of the verb', () => {
  const T = lines('Bldg No. | Facility Name | Gross SF | Frequency', '1102 | A | 10,000 | Daily', '1104 | B | 11,000 | Daily', '1106 | C | 12,000 | Daily', '1201 | Brigade HQ | 45,200 | Daily', '1205 | Annex | 18,750 | Daily', '1210 | Training Center | 31,640 | Daily');
  const objects = read(lines(T, '', '5.3 Trash from Building 1210 shall be removed daily and taken to the dumpster.', '', '5.4 The carpet in Building 1201 was removed and replaced with VCT in 2024.', '', '5.5 In Building 1205, furniture shall be removed by the occupants before floor stripping.', '', '5.6 Snow shall be removed from Building 1102 entrances within 4 hours.', '', '5.7 Area around Building 1104 is excluded from mowing.'));
  assert.equal(inScope(objects).length, 6, objects.facilities.filter((f) => f.status).map((f) => `${f.buildingNumber}: ${f.statusReason}`).join('; '));
  const amend = (text: string) => read({ text: T, name: 'TE-1.txt', role: 'attachment' }, { text, name: 'Amendment 0003.txt', role: 'amendment', amendment: 3 });
  for (const [text, want] of [
    ['Buildings 1102, 1104 and 1106 are deleted from the requirement.', ['1102', '1104', '1106']],
    ['Per Amendment 0002, Building 1201 is deleted.', ['1201']],
    ['Building 1201 (Brigade HQ) is hereby deleted.', ['1201']],
    ['Bldg 1201 – Brigade HQ – is deleted from TE-1.', ['1201']],
    ['Item 1. Building 1205, Annex, 100 Main Street, Fort Example, KY, is deleted from the scope of this solicitation in its entirety.', ['1205']],
    ['Building 1210 shall be removed from the contract effective 1 October 2027.', ['1210']],
    ['If funding is not available, Building 1201 may be deleted.', []],
  ] as [string, string[]][]) assert.deepEqual(amend(text).facilities.filter((f) => f.status).map((f) => f.buildingNumber), want, text);
});

test('dual-unit cells and key / value entries take the unit printed after the figure that is read', () => {
  const inv = read(lines('Bldg No. | Facility Name | Gross Area | Frequency', '1201 | Brigade HQ | 45,208 SF (4,200 SM) | Daily', '1205 | Annex | 1,742 m² (18,750 SF) | Daily', '1210 | Training | 4,200 (SM) | Daily'));
  assert.equal(fac(inv, '1201').grossSqft, 45208);
  assert.equal(fac(inv, '1205').grossSqft, 18751);
  assert.equal(fac(inv, '1210').grossSqft, 45208);
  const kv = read(lines('BUILDING INFORMATION SHEET', 'Building Number: VA0001ZZ', 'Building Name: Federal Building', 'Gross Square Feet: 113,504 SF (10,545 SM)', 'Cleanable Square Feet: 90,000'));
  assert.equal(fac(kv, 'VA0001ZZ').grossSqft, 113504);
  const line = read('Bldg 1201, Brigade HQ, 45,200 SF (4,200 SM), daily');
  assert.deepEqual([fac(line, '1201').grossSqft, fac(line, '1201').cleanableSqft], [45200, undefined]);
});

test('count columns titled "… Serviced" are floors, frequencies or information, never cleanable area', () => {
  const read1 = (h: string) => read(lines(`Bldg No. | Facility Name | Gross SF | ${h}`, '1201 | Brigade HQ | 45,200 | 3')).facilities[0];
  assert.deepEqual([read1('Floors Serviced').cleanableSqft, read1('Floors Serviced').floors], [undefined, 3]);
  assert.deepEqual([read1('Days Serviced per Week').cleanableSqft, read1('Days Serviced per Week').serviceLevel], [undefined, '3x_week']);
  assert.deepEqual([read1('Times Serviced per Week').cleanableSqft, read1('Times Serviced per Week').serviceLevel], [undefined, '3x_week']);
  assert.equal(read1('Restrooms Serviced').cleanableSqft, undefined);
  assert.equal(read1('Serviced SF').cleanableSqft, 3);
  assert.equal(read1('Area Serviced').cleanableSqft, 3);
});

test('lawn, roof and paving area columns are not building areas; a titled gross column beats a generic area column', () => {
  const H2 = 'Bldg No. | Facility Name | Floors | Gross SF | Frequency';
  const lawn = read(lines(H2, '1201 | Brigade HQ | 2 | 45,200 | Daily', '', 'Bldg No. | Facility Name | Lawn Area (SF) | Mowing Frequency', '1201 | Brigade HQ | 12,000 | Weekly'));
  assert.deepEqual([fac(lawn, '1201').grossSqft, fac(lawn, '1201').cleanableSqft], [45200, undefined]);
  assert.equal(sqft(lawn.grounds, 'improved_turf'), 12000);
  const roof = read(lines(H2, '1201 | Brigade HQ | 2 | 45,200 | Daily', '', 'Bldg No. | Facility Name | Roof Area (SF) | Roof Type', '1201 | Brigade HQ | 22,600 | Built-up'));
  assert.deepEqual([fac(roof, '1201').grossSqft, fac(roof, '1201').cleanableSqft], [45200, undefined]);
  const amendLawn = read({ text: lines('Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | 45,200 | Daily'), name: 'TE-1.txt', role: 'attachment' }, { text: lines('Bldg No. | Facility Name | Lawn Area (SF) | Mowing Cycle', '1201 | Brigade HQ | 12,000 | 7-day'), name: 'Amendment 0001.txt', role: 'amendment', amendment: 1 });
  assert.equal(fac(amendLawn, '1201').grossSqft, 45200);
  const lawnFirst = read(lines('Bldg No. | Facility Name | Lawn Area (SF)', '1201 | Brigade HQ | 12,000', '', 'Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | 45,200 | Daily'));
  assert.equal(fac(lawnFirst, '1201').grossSqft, 45200);
  const genericFirst = read(lines('Bldg No. | Facility Name | Area (SF)', '1201 | Brigade HQ | 40,000', '', 'Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | 45,200 | Daily'));
  assert.deepEqual([fac(genericFirst, '1201').grossSqft, fac(genericFirst, '1201').cleanableSqft], [45200, undefined]);
  const genericAfter = read(lines('Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | 45,200 | Daily', '', 'Bldg No. | Facility Name | Floor Area (SF)', '1201 | Brigade HQ | 40,000'));
  assert.deepEqual([fac(genericAfter, '1201').grossSqft, fac(genericAfter, '1201').cleanableSqft], [45200, undefined]);
  // a pricing / service-area schedule is the serviced area, before or after the gross table
  for (const order of [0, 1]) {
    const tables = [lines('Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | 45,200 | Daily'), lines('Line | Bldg No. | Facility | Pricing Area (SF) | Monthly Price', '1 | 1201 | Brigade HQ | 40,000 | $')];
    const inv = read(lines(tables[order], '', tables[1 - order]));
    assert.deepEqual([fac(inv, '1201').grossSqft, fac(inv, '1201').cleanableSqft], [45200, 40000], `order ${order}`);
  }
});

test('a bare "Area" column next to a facility name column is the building area', () => {
  for (const h of ['Fac No. | Facility Name | Area | UM | Frequency', 'Fac No. | Facility Name | Area | Frequency']) {
    const um = /UM/.test(h);
    const inv = read(lines(h, `1201 | Brigade HQ | 45,200 |${um ? ' SF |' : ''} Daily`, `1205 | Annex | 18,750 |${um ? ' SF |' : ''} Daily`));
    assert.deepEqual(inv.facilities.map((f) => [f.buildingNumber, f.grossSqft]), [['1201', 45200], ['1205', 18750]], h);
  }
  // grounds and paving rows in a facility list with a UM column are grounds, not buildings
  const mixed = read(lines('Fac No. | Facility Name | Area | UM | Frequency', '1201 | Brigade HQ | 45,200 | SF | Daily', '9301 | Improved Grounds - Main Post | 1,856,000 | SF | Weekly', '8520 | POV Parking Lot - Bldg 1201 | 38,600 | SF | Monthly'));
  assert.deepEqual(mixed.facilities.map((f) => f.buildingNumber), ['1201']);
  assert.equal(sqft(mixed.grounds, 'parking'), 38600);
  // "Area | Quantity" still names grounds areas
  const g = read(lines('Area | Quantity', 'Improved grounds, cantonment | 42.5 acres', 'Parking lots | 18,000 SY'));
  assert.equal(g.facilities.length, 0);
  near(acres(g.grounds, 'improved_turf'), 42.5);
});

test('a summary line that names several buildings never sets a building; table rows win over lines of the same rank', () => {
  const inv = read(lines('Buildings 1201 and 1205 together total 63,950 SF.', '', 'Bldg No. | Facility Name | Floors | Gross SF | Frequency', '1201 | Brigade HQ | 2 | 45,200 | Daily', '1205 | Annex | 1 | 18,750 | Daily', '', 'Bldg 1201, Brigade HQ, 47,900 SF, daily'));
  assert.deepEqual(inv.facilities.map((f) => [f.buildingNumber, f.name, f.grossSqft]), [['1201', 'Brigade HQ', 45200], ['1205', 'Annex', 18750]]);
  // a later-ranked document's line still supersedes
  const amended = read({ text: lines('Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | 45,200 | Daily'), name: 'TE-1.txt', role: 'attachment' }, { text: 'Bldg 1201, Brigade HQ, 47,900 SF, daily', name: 'Amendment 0001.txt', role: 'amendment', amendment: 1 });
  assert.equal(fac(amended, '1201').grossSqft, 47900);
});

test('a deletion of a number used on two campuses applies to the campus it names, or to none', () => {
  const te1 = { text: lines('Campus | Bldg No. | Facility Name | Gross SF | Frequency', 'Main Post | 0012 | Brigade HQ | 31,395 | Daily', 'North Annex | 0012 | Annex Ops | 12,000 | Daily'), name: 'TE-1.txt', role: 'attachment' as const };
  const named = read(te1, { text: 'Item 1. Building 0012 at North Annex is deleted from the requirement.', name: 'Amendment 0001.txt', role: 'amendment', amendment: 1 });
  assert.deepEqual(named.facilities.map((f) => [f.campus, f.status ?? null]), [['Main Post', null], ['North Annex', 'deleted_by_amendment']]);
  const unnamed = read(te1, { text: 'Item 1. Building 0012 is deleted from the requirement.', name: 'Amendment 0001.txt', role: 'amendment', amendment: 1 });
  assert.equal(inScope(unnamed).length, 2);
  assert.ok(unnamed.facilities.every((f) => /Deletion ambiguous across campuses/.test(f.notes ?? '')));
  // a campus-less row of a later document goes to the record with the same name
  const fx = read(te1, { text: lines('Bldg No. | Facility Name | Gross SF', '0012 | Annex Ops | 12,500'), name: 'Amendment 0001.txt', role: 'amendment', amendment: 1 });
  assert.deepEqual(fx.facilities.map((f) => [f.campus, f.grossSqft]), [['Main Post', 31395], ['North Annex', 12500]]);
});

test('the same number twice in one table under different group rows is two buildings', () => {
  const inv = read(lines('Bldg No. | Facility Name | Gross SF | Frequency', 'CASTLE ROCK |  |  |', '100 | Admin | 10,000 | Daily', 'PINE BLUFF |  |  |', '100 | Admin | 8,000 | Daily'));
  assert.deepEqual(inv.facilities.map((f) => [f.campus, f.grossSqft]), [['CASTLE ROCK', 10000], ['PINE BLUFF', 8000]]);
  assert.equal(new Set(inv.facilities.map((f) => f.id)).size, 2);
  // a repeated identical row is still one building
  assert.equal(read(lines('Bldg No. | Facility Name | Gross SF | Frequency', '100 | Admin | 10,000 | Daily', '100 | Admin | 10,000 | Daily')).facilities.length, 1);
});

test('a struck figure in a tracked or conformed cell is superseded by the figure after it', () => {
  const inv = read({ text: lines('Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | ~~45,200~~ 47,900 | Daily', '~~5100~~ | ~~Central Issue Facility~~ | ~~82,000~~ | Daily'), name: 'J-1 conformed.docx', role: 'amendment', amendment: 1 });
  assert.equal(fac(inv, '1201').grossSqft, 47900);
  assert.match(fac(inv, '1201').notes ?? '', /45,200 is struck through/);
  assert.equal(parseNumberCell('~~45,200~~ 47,900'), 47900);
  assert.equal(parseNumberCell('~~82,000~~'), 82000);
  assert.deepEqual([fac(inv, '5100').grossSqft, fac(inv, '5100').status], [82000, 'deleted_by_amendment']);
});

test('medians in meters are converted to feet before the area is computed', () => {
  const inv = read(lines('Seg. No. | Street / Corridor | Length (m) | Width (m) | Sides | Surface', 'M-1 | Via Roma | 1,000 | 10 | 1 | Turf'));
  near(acres(inv.grounds, 'improved_turf'), 2.471, 0.001);
  assert.match(inv.grounds[0].notes ?? '', /10,000 m²/);
  const ft = read(lines('Seg. No. | Street / Corridor | Length (LF) | Width (FT) | Sides | Surface', 'M-1 | Main St | 1,000 | 10 | 1 | Turf'));
  near(acres(ft.grounds, 'improved_turf'), 10000 / 43560, 0.001);
});

test('prose meals per day: no phantom DFAC in a custodial PWS; a DFAC named in the paragraph gets the workload', () => {
  const phantom = read(lines('Bldg No. | Facility Name | Gross SF | Frequency', '1201 | Brigade HQ | 45,200 | Daily', '', 'Residents of the barracks receive 3 meals per day at the installation dining facility operated under a separate contract.'));
  assert.deepEqual(phantom.facilities.map((f) => f.buildingNumber), ['1201']);
  const two = read(lines('Bldg No. | Facility Name | Gross SF | Frequency', '2410 | Warrior Restaurant DFAC | 28,500 | 7X/WK', '3300 | Lightning Inn DFAC | 21,000 | 7X/WK', '', '7.2 The Lightning Inn serves an average of 1,350 meals per day.'));
  assert.equal(fac(two, '3300').dining?.mealsPerDay, 1350);
  assert.equal(fac(two, '2410').dining, undefined);
  const unnamed = read(lines('Bldg No. | Facility Name | Gross SF | Frequency', '2410 | Warrior Restaurant DFAC | 28,500 | 7X/WK', '3300 | Lightning Inn DFAC | 21,000 | 7X/WK', '', '7.2 The dining facilities serve an average of 2,650 meals per day.'));
  assert.ok(unnamed.facilities.every((f) => !f.dining && /Unassigned dining workload/.test(f.notes ?? '')));
  const ffs = read('5.1 Full Food Service. The Contractor shall provide full food service at the installation dining facility. The dining facility serves 2,650 meals per day across four meal periods.');
  assert.equal(ffs.facilities[0]?.dining?.mealsPerDay, 2650);
});

// ---------------------------------------------------------------------------------------------- generalization rules
// Each rule below was found on a held-out solicitation the reader had never seen; the tests use different wording.

test('a total column whose figures are the sum of part columns is the facility area; the parts never are', () => {
  // three space-type columns add up to a "Total SF" column: the total is the building area, not the first part
  const sum = read(lines('Bldg | Building Name | Office SF | Shop SF | Storage SF | Total SF | Days',
    '410 | Motor Transport Operations | 2,000 | 5,500 | 1,200 | 8,700 | 5',
    '412 | Supply Annex | 900 | 0 | 4,100 | 5,000 | 3'));
  assert.deepEqual([fac(sum, '410').grossSqft, fac(sum, '412').grossSqft], [8700, 5000]);
  // cleanable area split by infection-risk class beside a gross column: the gross stays gross, the total is the cleanable
  const risk = read(lines('Facility No. | Facility | Gross Area SF | Critical CSF | Patient Care CSF | Admin CSF | Total CSF',
    'H-1 | Surgical Pavilion | 120,000 | 20,000 | 50,000 | 15,000 | 85,000',
    'H-2 | Outpatient Clinic | 40,000 | — | 22,000 | 8,000 | 30,000',
    'H-3 | Rehab Center | 30,000 | 1,000 | 16,000 | 5,500 | 22,500'));
  assert.deepEqual([fac(risk, 'H-1').grossSqft, fac(risk, 'H-1').cleanableSqft], [120000, 85000]);
  assert.equal(fac(risk, 'H-2').cleanableSqft, 30000);
  // too few figures to add up: a single column titled "Total" right after untitled part columns is still the total
  const titled = read(lines('Bldg | Name | Restrooms (SF) | Offices (SF) | Corridors (SF) | Total Area (SF)', '31 | Gatehouse | 120 | — | — | 120'));
  assert.equal(fac(titled, '31').grossSqft, 120);
  // a table whose only area columns are cleaned parts and a "Total Cleaned" column: that total is gross and cleanable
  const cleaned = read(lines('Bldg | Name | Restroom SF | Carpet SF | Tile SF | Total Cleaned SF', '7 | Chapel | 300 | 2,500 | 1,200 | 4,000', '9 | Library | 500 | 6,000 | 1,500 | 8,000'));
  assert.deepEqual([fac(cleaned, '7').grossSqft, fac(cleaned, '7').cleanableSqft], [4000, 4000]);
  // gross = cleanable + non-cleanable is the usual gross / cleanable pair, not a split of the gross into parts
  const pair = read(lines('Bldg | Name | Gross SF | Cleanable SF | Non-Cleanable SF', '5 | Gym | 10,000 | 8,000 | 2,000', '6 | Pool | 6,000 | 4,500 | 1,500'));
  assert.deepEqual([fac(pair, '5').grossSqft, fac(pair, '5').cleanableSqft], [10000, 8000]);
});

test('subtotal and total rows are not facilities wherever "Total" sits in the label or whatever column holds it', () => {
  const inv = read(lines('Zone | Facility # | Facility | Sq Ft | Frequency',
    'North | 101 | Admin Building | 5,000 | M–F',
    'North | 102 | Fire Station | 4,000 | 7 days',
    ' | 2 | North Zone Total – Facilities | 9,000',
    'South | 201 | Warehouse | 3,000 | 1 x Week',
    ' | 3 | ALL ZONES TOTAL (3 bldgs) | 12,000',
    ' |  | Campus Total: | 12,000'));
  assert.deepEqual(inv.facilities.map((f) => f.buildingNumber), ['101', '102', '201']);
  // "Total" inside a name is not a total label
  assert.equal(read(lines('Bldg | Facility Name | Gross SF', '55 | Joint Total Force Training Center | 12,000')).facilities.length, 1);
});

test('rows under a banner that puts them outside the contract, and "option CLIN" / "not on contract" cells, carry that status', () => {
  const inv = read(lines('Bldg | Building | Gross SF | Frequency',
    '100 | Headquarters | 5,000 | Daily',
    '',
    'STRUCTURES SHOWN FOR REFERENCE ONLY (NOT INCLUDED IN THE PRICED WORKLOAD)',
    'Bldg | Building | Gross SF | Frequency',
    '900 | Post Museum | 7,000 | Weekly',
    '',
    'ANNEX BUILDINGS',
    'Bldg | Building | Gross SF | Frequency',
    '950 | Future Clinic | 3,000 | Option – CLIN 0010',
    '960 | Tenant Annex | 2,000 | Not on contract'));
  assert.equal(fac(inv, '100').status, undefined);
  assert.equal(fac(inv, '900').status, 'excluded');
  assert.equal(fac(inv, '950').status, 'option_only');
  assert.equal(fac(inv, '960').status, 'excluded');
  assert.match(fac(inv, '900').statusReason ?? '', /REFERENCE ONLY/);
  // a caption about some of the rows is not a banner over all of them
  const caption = read(lines('Buildings marked * are not included in the base period', 'Bldg | Building | Gross SF | Frequency', '100 | Headquarters | 5,000 | Daily', '101* | Annex | 2,000 | Daily'));
  assert.equal(fac(caption, '100').status, undefined);
  assert.equal(statusFromText('Optional line item – priced separately')?.status, 'option_only');
});

test('the same building number on two lines of one list, each with its own name and area, is two line items', () => {
  const inv = read(lines('Level A',
    'Fac | Description | Svc | Sq Ft',
    '520 | Clinic – Exam Wing | 5 x Week | 4,000',
    '530 | Pharmacy | 5 x Week | 2,000',
    'Level B',
    'Fac | Description | Svc | Sq Ft',
    '520 | Clinic – Admin Offices | 2 x Week | 1,500'));
  const lines520 = inv.facilities.filter((f) => f.buildingNumber === '520');
  assert.deepEqual(lines520.map((f) => [f.name, f.grossSqft, f.serviceLevel]), [['Clinic – Exam Wing', 4000, 'daily_5'], ['Clinic – Admin Offices', 1500, '2x_week']]);
  // the same building in a second table with another layout is one building
  const two = read(lines('Bldg | Name | Gross SF', '520 | Clinic | 5,500', '', 'Bldg | Name | Floors | Frequency', '520 | Clinic Building | 2 | Daily'));
  assert.equal(two.facilities.length, 1);
  // a room list continued after a page break (the same building on both sides of the break, the room named per row)
  // is one building's rooms, not line items
  const rooms = read(lines('Bldg | Room | Description | Net SF', '610 | 101 | Lobby | 900', '610 | 102 | Office | 150', '612 | 101 | Shop | 2,000',
    '--- page 2 ---', 'Bldg | Room | Description | Net SF', '612 | 102 | Tool Room | 300', '614 | 101 | Office | 120', '--- page 3 ---', 'Bldg | Room | Description | Net SF', '614 | 102 | Storage | 400'));
  assert.deepEqual(rooms.facilities.map((f) => f.buildingNumber), ['610', '612', '614']);
});

test('frequencies: "N x Week", days written out or abbreviated, alternate weekdays, "(5)" after a number word', () => {
  const cases: [string, string | undefined][] = [
    ['4 x Week', '3x_week'], ['2 x Mo', 'biweekly'], ['Sa–Su', '2x_week'], ['Thurs', 'weekly'], ['Mo/We/Fr', '3x_week'],
    ['Mon, Tue, Wed, Thu', '3x_week'], ['M–Su', 'daily_7'], ['Tu, F', '2x_week'], ['alternate Thursdays', 'biweekly'], ['Alt. Tue.', 'biweekly'],
    ['Mon & Thu mornings', '2x_week'], ['seven (7) nights per week', 'daily_7'], ['three (3) visits per week', '3x_week'],
    ['M', undefined], ['W', undefined], ['On call', undefined],
  ];
  for (const [t, want] of cases) assert.equal(serviceLevelFromText(t), want, t);
  // "we" and "th" are words in a sentence, not days
  assert.equal(serviceLevelFromText('we will clean the th floor lobby'), undefined);
});

test('schedule codes resolve through a legend anywhere in the package, on separate lines or on one line', () => {
  const lined = read(lines('Cleaning Schedule Codes', 'X1  Seven days per week, including holidays', 'X2  Monday through Friday', 'X3  Tuesday and Thursday only', '',
    'Bldg | Building | Gross SF | Schedule', '55 | Barracks | 20,000 | X1', '56 | Admin | 8,000 | X2', '57 | Warehouse | 9,000 | X3'));
  assert.deepEqual(['55', '56', '57'].map((b) => fac(lined, b).serviceLevel), ['daily_7', 'daily_5', '2x_week']);
  const inline = read({ text: 'Frequency codes: A = daily (Monday–Friday); B = twice weekly; C = once a week.', name: 'PWS.docx', role: 'pws' },
    { text: lines('Bldg | Building | Gross SF | Svc Code', '61 | Shop | 4,000 | B', '62 | Office | 5,000 | A', '63 | Shed | 900 | C'), name: 'Attachment 1.xlsx', role: 'attachment' });
  assert.deepEqual(['61', '62', '63'].map((b) => fac(inline, b).serviceLevel), ['2x_week', 'daily_5', 'weekly']);
  // an untitled column reads as the frequency when its cells are schedules, not when they are single weekdays (pickup days)
  const svc = read(lines('Bldg | Building | Gross SF | Svc', '81 | Depot | 3,000 | 3 x Week', '82 | Office | 2,000 | M–F'));
  assert.deepEqual([fac(svc, '81').serviceLevel, fac(svc, '82').serviceLevel], ['3x_week', 'daily_5']);
  const pickup = read(lines('Bldg | Building | Gross SF | Pickup', '91 | Depot | 3,000 | Monday', '92 | Clinic | 2,000 | Thursday'));
  assert.deepEqual([fac(pickup, '91').serviceFrequencyText, fac(pickup, '92').serviceLevel], [undefined, 'daily_7']);
  // a lone letter with no legend is not read as a weekday
  assert.equal(fac(read(lines('Bldg | Building | Gross SF | Frequency', '70 | Depot | 3,000 | F')), '70').serviceLevel, 'daily_5');
});

test('two-row headers: the sub-title names the column; the group label only qualifies a measure', () => {
  const inv = read(lines('FACILITY RECORD |  |  | FLOOR AREA | ',
    'Seq. | Fac. No. | Facility Name | Gross | Net',
    '1 | 300 | Records Center | 12,000 | 10,500',
    '2 | 310 | Print Plant | 8,000 | 6,000'));
  assert.deepEqual([fac(inv, '300').name, fac(inv, '300').grossSqft, fac(inv, '300').cleanableSqft], ['Records Center', 12000, 10500]);
  assert.equal(fac(inv, '310').name, 'Print Plant');
  // a title merged down over both header rows is printed in each: it is one title, not "Bldg Bldg"
  const merged = read(lines('Bldg | Facility | AREA (SQ FT) | ', 'Bldg | Facility | Gross | Cleanable', '44 | Armory | 15,000 | 12,000'));
  assert.deepEqual([fac(merged, '44').grossSqft, fac(merged, '44').cleanableSqft], [15000, 12000]);
  // group labels repeated across the columns they span (a full top row), and a top row shorter than the titles below it
  // (its last spans were empty and trimmed)
  const repeated = read(lines('SITE RECORD | SITE RECORD | SITE RECORD | AREA (SQ FT) | AREA (SQ FT) | Remarks', 'Ln | Bldg No. | Facility Name | Gross | Cleanable', '1 | 610 | Supply Office | 5,000 | 4,100 | Daily'));
  assert.deepEqual([fac(repeated, '610').name, fac(repeated, '610').grossSqft, fac(repeated, '610').cleanableSqft], ['Supply Office', 5000, 4100]);
  const short = read(lines('FACILITY |  | AREA (SF) |  | SERVICE', 'No. | Name | Gross | Net | Days | Hours | Remarks', '12 | Motor Pool | 9,000 | 2,000 | M–F | 1800–2200 |'));
  assert.deepEqual([fac(short, '12').name, fac(short, '12').grossSqft, fac(short, '12').cleanableSqft, fac(short, '12').serviceLevel], ['Motor Pool', 9000, 2000, 'daily_5']);
});

test('a building table with no number or name column takes its names from the first text column; a room breakdown is not a facility list', () => {
  const inv = read(lines('Branch | Street Address | Stories | Gross Sq Ft | Days',
    'Eastside Branch Library | 12 Oak St | 1 | 8,400 | Tu, Th, Sa',
    'Northgate Branch Library | 400 Pine Ave | 2 | 15,100 | M–Sa'));
  assert.deepEqual(inv.facilities.map((f) => [f.name, f.grossSqft, f.serviceLevel]), [['Eastside Branch Library', 8400, '3x_week'], ['Northgate Branch Library', 15100, 'daily_6']]);
  const rooms = read(lines('Room Type | Sq Ft | Frequency | Remarks', 'Restrooms | 1,200 | Daily |', 'Offices | 9,800 | Weekly |'));
  assert.equal(rooms.facilities.length, 0);
});

test('a "Site" or "Location" column of short identifiers next to a name column is the facility number', () => {
  const inv = read(
    { text: lines('Location | Facility | Sq. Ft. | Service', '1 | City Hall | 40,000 | M–F', '2 | Police Headquarters | 22,000 | 7 days'), name: 'RFP.docx', role: 'solicitation' },
    { text: 'Addendum No. 2. The square footage for Location 2 is revised from 22,000 to 24,500.', name: 'Addendum 2.docx', role: 'amendment', amendment: 2 });
  assert.deepEqual(inv.facilities.map((f) => [f.buildingNumber, f.grossSqft]), [['1', 40000], ['2', 24500]]);
  // a deleted site is a deleted facility when the sites are buildings (and a grounds area when they are grounds areas)
  const del = read({ text: lines('Site | Facility | Sq. Ft.', '1 | Library | 9,000', '2 | Senior Center | 6,000'), name: 'RFP.docx', role: 'solicitation' },
    { text: 'Addendum No. 1. Site 2, Senior Center, is deleted from the requirement.', name: 'Addendum 1.docx', role: 'amendment', amendment: 1 });
  assert.deepEqual(del.facilities.map((f) => [f.buildingNumber, f.status]), [['1', undefined], ['2', 'deleted_by_amendment']]);
  // a "Site #" key over building areas (no acreage) numbers facilities, not grounds areas
  const keyed = read(lines('Site # | Facility | Address | Sq Ft | Cleaning Days', '1 | Eastside Pool House | 12 Oak St | 2,400 | Sa, Su', '2 | Senior Center | 400 Pine Ave | 9,100 | M–F'));
  assert.deepEqual(keyed.facilities.map((f) => [f.buildingNumber, f.grossSqft, f.serviceLevel]), [['1', 2400, '2x_week'], ['2', 9100, 'daily_5']]);
  // a campus column of names stays a campus
  assert.equal(fac(read(lines('Site | Bldg | Facility | Gross SF', 'North Campus | 12 | Gym | 9,000')), '12').campus, 'North Campus');
});

test('facilities described in headed paragraphs: area, cleaning area, stories and service days from the prose', () => {
  const inv = read(lines('4.2 Building Descriptions',
    'Building 12 – Public Works Garage',
    '1800 Industrial Way',
    "A one-story pre-engineered building of 8,400 square feet. Truck bays (about 6,000 sq. ft.) are swept by city crews and are excluded; the contractor's cleaning area is approximately 2,100 sq. ft. Service is required twice per week (Tuesday and Thursday).",
    'Building 14: Westside Branch Library. The branch has 12,600 gross square feet on two floors. Custodial service five nights a week, Monday through Friday.',
    '4.3 Exclusions',
    'Building 16 – Old Armory. The armory was demolished in 2019.'));
  const g = fac(inv, '12');
  assert.deepEqual([g.name, g.grossSqft, g.cleanableSqft, g.floors, g.serviceLevel], ['Public Works Garage', 8400, 2100, 1, '2x_week']);
  const l = fac(inv, '14');
  assert.deepEqual([l.name, l.grossSqft, l.floors, l.serviceLevel], ['Westside Branch Library', 12600, 2, 'daily_5']);
  assert.ok(!inv.facilities.some((f) => f.buildingNumber === '16'), 'a heading with no stated area adds nothing');
  // an outdoor area stated before the building's own is not the building area
  const lot = read(lines('Site 3 – Westside Pool House', 'A 40-space parking lot of 12,000 sq. ft. serves the one-story pool house of 2,600 square feet. Service: Saturday and Sunday mornings.'));
  assert.deepEqual([fac(lot, '3').grossSqft, fac(lot, '3').serviceLevel], [2600, '2x_week']);
  // a building a table already gave keeps the table's area and takes the cleaning area the table left out
  const both = read(lines('Bldg | Facility | Gross SF | Frequency', '12 | Public Works Garage | 9,000 | 2 x Week', '',
    'Building 12 – Public Works Garage', 'A one-story building of 8,400 square feet; the cleaning area is approximately 2,100 sq. ft.'));
  assert.deepEqual([fac(both, '12').grossSqft, fac(both, '12').cleanableSqft, both.facilities.length], [9000, 2100, 1]);
  // a heading that states a change is an amendment statement, not a new description
  const amd = read(lines('Bldg | Facility | Gross SF', '12 | Garage | 9,000'), { text: 'Building 12 – Garage: the gross area is revised from 9,000 to 9,600 square feet.', name: 'Amendment 1.docx', role: 'amendment', amendment: 1 });
  assert.equal(fac(amd, '12').grossSqft, 9600);
});

test('a list of exclusions after a colon excludes the buildings it names, not the buildings that only locate an excluded part', () => {
  const inv = read(lines('Bldg | Facility | Gross SF', '7 | Hospital | 90,000', '9 | Old Gym | 12,000', '11 | Warehouse | 30,000', '',
    'Note 4. The following are not part of this contract: sterile storage areas in Building 7; Building 9, Old Gym; and the loading dock at Building 11.'));
  assert.deepEqual(['7', '9', '11'].map((b) => fac(inv, b).status), [undefined, 'excluded', undefined]);
});

test('change logs without a building-number column: deletions and additions in the text, Was / Is figures and schedules', () => {
  const base = { name: 'Attachment 3.pdf', role: 'attachment' as const, text: lines('Bldg | Name | Gross SF | Net SF | Frequency', '330 | Records Center | 12,000 | 9,800 | 5 x Week', '331 | Motor Pool Office | 3,000 | 2,500 | 3 x Week', '332 | Tool Crib | 1,000 | 800 | 1 x Week') };
  const amd = { name: 'Amendment 0003.pdf', role: 'amendment' as const, amendment: 3, text: lines('No. | Reference | Description | Previous | Revised',
    '1 | Bldg 330 | Net area corrected after re-measurement of the second floor | Gross SF 12,000; Net SF 9,800 | Gross SF 12,000; Net SF 10,250',
    '2 | Bldg 331 | Cleaning schedule changed for the new dispatch shift | 3 x Week | 5 x Week',
    '3 | Attachment 3, Bldg 332 | Building 332, Tool Crib, is deleted from the requirement. | 1,000 SF | Deleted',
    '4 | Attachment 3 (new line) | Add Building 340, Fuel Point Office, a relocated modular office; one floor; 5 days per week. | Not listed | 1,600 GSF; 1,400 CSF') };
  const inv = read(base, amd);
  assert.equal(fac(inv, '330').cleanableSqft, 10250);
  assert.equal(fac(inv, '330').grossSqft, 12000);
  assert.equal(fac(inv, '331').serviceLevel, 'daily_5');
  assert.equal(fac(inv, '332').status, 'deleted_by_amendment');
  const n = fac(inv, '340');
  assert.deepEqual([n.name, n.grossSqft, n.cleanableSqft, n.floors, n.serviceLevel], ['Fuel Point Office', 1600, 1400, 1, 'daily_5']);
  // a Was / Is change log is an amendment's text even in a file named as an attachment
  const att = read(base, { ...amd, name: 'Attachment 3 revised.pdf', role: 'attachment' as const, amendment: undefined });
  assert.equal(fac(att, '340').grossSqft, 1600);
});

test('grounds: a summary keyed by its type column; acreage in prose is ignored when grounds maintenance is not in the contract', () => {
  const sum = read(lines('Category | Site | Acres', 'Improved | Main Campus | 40.5', 'Semi-Improved | Main Campus | 22.0', 'Unimproved | Range Area | 110.0', 'Total |  | 172.5'));
  near(acres(sum.grounds, 'improved_turf'), 40.5);
  near(acres(sum.grounds, 'semi_improved'), 22);
  near(acres(sum.grounds, 'unimproved'), 110);
  const out = read(lines('1.4 Landscaping and snow removal are performed by the City and are not part of this contract.', '', 'Mowed lawn at the civic center: 12 acres.'));
  assert.equal(out.grounds.length, 0);
  const inScope = read('Mowed lawn at the civic center: 12 acres.');
  near(acres(inScope.grounds, 'improved_turf'), 12);
  // the size of a park is not a maintained area; the mowed part stated after it is
  const park = read('Riverside Park is approximately 60 acres, including about 9 acres of mowed turf.');
  near(acres(park.grounds, 'improved_turf'), 9);
});

test('prior award: a monthly figure beside the annual one is not the annual value', () => {
  const a = heuristicPriorAward([doc('The incumbent, Acme Facility Services, LLC, is paid $42,500 per month ($510,000 per year) under Contract No. AB-21-0099.')]);
  assert.equal(a?.annualValue, 510000);
  const b = heuristicPriorAward([doc('The current contract is held by Acme Facility Services, LLC. The current monthly billing is $42,500, or $510,000 annually.')]);
  assert.equal(b?.annualValue, 510000);
});

test('site: initial term plus extensions, Midwestern states, county and VA owners', () => {
  const inv = read(lines('MARLOW COUNTY, MICHIGAN', 'Janitorial services for Marlow County buildings.', 'The initial term shall be two (2) years with the option of three (3) additional one-year extensions.'));
  assert.equal(inv.site.contractYears, 5);
  assert.equal(inv.site.climateZone, 'cold');
  assert.equal(inv.site.installationName, 'Marlow County');
  assert.equal(read('Housekeeping at the Pine Ridge VA Medical Center and its clinics.').site.installationName, 'Pine Ridge VA');
  assert.equal(read('CUSTODIAL SERVICES, BRIARWOOD AIR FORCE BASE, NEBRASKA').site.installationName, 'Briarwood Air Force Base');
});

test('header titles: a "Campus Name" column is the campus and "Title" under a building group is the name', () => {
  const inv = read(lines('Campus Name | Bldg No. | Building Name | GSF | Cleaning Frequency',
    'Riverside Campus | 101 | Hamilton Hall | 54,200 | 5 nights per week',
    'Hilltop Campus | 201 | Student Union | 61,900 | 7 days per week'));
  assert.deepEqual(inv.facilities.map((f) => [f.buildingNumber, f.name, f.campus]), [['101', 'Hamilton Hall', 'Riverside Campus'], ['201', 'Student Union', 'Hilltop Campus']]);
  // two header rows: "Building" spans "Number" and "Title"; "Building" over "ID" is the number
  const two = read(lines('Site | Building |  | Square Footage |  | Days', 'Site | Number | Title | Offices | Total | Days', 'Salem | B-101 | Executive Building | 41,200 | 57,000 | 5'));
  assert.deepEqual([fac(two, 'B-101').name, fac(two, 'B-101').campus], ['Executive Building', 'Salem']);
  const id = read(lines('Building |  | Area', 'ID | Description | GSF', 'K-7 | Pump House | 900'));
  assert.deepEqual([fac(id, 'K-7').name, fac(id, 'K-7').grossSqft], ['Pump House', 900]);
  // a two-row header the document already printed on one line, its group label repeated over each column it spans
  const flat = read(lines('FACILITY Bldg | FACILITY Description | AREA (SQ FT) Gross | AREA (SQ FT) Cleanable | Svc Days',
    '4410 | Battalion Headquarters | 18,500 | 15,200 | M-F', '4414 | Company Operations Facility | 9,800 | 8,100 | M, W, F'));
  assert.deepEqual(flat.facilities.map((f) => [f.buildingNumber, f.name, f.grossSqft, f.cleanableSqft, f.serviceLevel]),
    [['4410', 'Battalion Headquarters', 18500, 15200, 'daily_5'], ['4414', 'Company Operations Facility', 9800, 8100, '3x_week']]);
});

test('a status banner covers the rows printed under it, not rows after a later caption', () => {
  const inv = read(lines('Facility | Facility Title | GSF | Service',
    'Option Period Facilities - Optional Line Item 0004',
    'B-301 | New Hangar Offices | 9,000 | 5 days',
    'Facilities marked * are not included in the base year',
    'B-401 | Supply Office * | 4,000 | 3 days',
    'B-402 | Ordnance Office | 2,200 | 3 days'));
  assert.deepEqual(['B-301', 'B-401', 'B-402'].map((b) => inv.facilities.find((f) => f.name === b || f.buildingNumber === b)?.status), ['option_only', undefined, undefined]);
});

test('an outline list of tasks is not a schedule-code legend', () => {
  const inv = read(lines('C.3 Task frequencies', 'A. Classrooms shall be cleaned once per week.', 'B. Gymnasium floors shall be dust mopped monthly.', '',
    'Bldg No. | School | Square Feet | Service Code', 'S-1 | Adams Elementary | 48,000 | A', 'S-2 | Baker Middle | 96,000 | B'));
  assert.deepEqual([fac(inv, 'S-1').serviceLevel, fac(inv, 'S-2').serviceLevel], ['daily_5', 'daily_5']);
});

test('area columns: a total of one kind of space is not the building area; a column titled cleanable beats a net total', () => {
  const rr = read(lines('Bldg | Name | Office SF | Shop SF | Total Restroom SF', '40 | Fleet Shop | 2,000 | 6,000 | 300', '41 | Sign Shop | 1,000 | 3,000 | 150'));
  assert.notEqual(fac(rr, '40').grossSqft, 300);
  const net = read(lines('Bldg | Name | Gross SF | Net Assignable SF | Non-Assignable SF | Total Net SF | Cleanable SF', '50 | Hall A | 10,000 | 5,000 | 3,000 | 8,000 | 7,600', '51 | Hall B | 20,000 | 11,000 | 6,000 | 17,000 | 16,100'));
  assert.deepEqual([fac(net, '50').grossSqft, fac(net, '50').cleanableSqft], [10000, 7600]);
});

test('two lines of one building in a single table, each with its own name and area, are two line items unless the table lists rooms', () => {
  const inv = read(lines('Site | Bldg | Building Title | Gross SF | Days', 'Portland | B-201 | Portland State Office Bldg | 200,000 | 5', 'Portland | B-201 | Portland SOB - Annex Wing | 27,500 | 3'));
  assert.deepEqual(inv.facilities.map((f) => [f.name, f.grossSqft]), [['Portland State Office Bldg', 200000], ['Portland SOB - Annex Wing', 27500]]);
  const rooms = read(lines('Bldg | Room No. | Room Name | Net SF', '700 | 101 | Lobby | 900', '700 | 102 | Office | 150', '701 | 101 | Shop | 2,000'));
  assert.deepEqual(rooms.facilities.map((f) => f.buildingNumber), ['700', '701']);
});

test('amendments: Previous / Revised logs beside a building column, "Insert new Building …", "Delete Building …"; date changes change nothing', () => {
  const base = { name: 'TE 3 Facility List.pdf', role: 'attachment' as const, text: lines('Bldg No | Facility Name | GSF | Frequency', '210 | Range Control | 4,000 | 5 days per week', '310 | Battalion HQ | 22,000 | 5 days per week', '320 | Company Ops | 9,000 | 3 days per week', '330 | Supply Warehouse | 15,000 | 1 day per week') };
  const amd = { name: 'Amendment 0002.pdf', role: 'amendment' as const, amendment: 2, text: lines('AMENDMENT 0002', 'Item | Bldg | Description | Previous | Revised',
    '1 | 310 | Gross area re-measured | 22,000 GSF | 23,450 GSF', '2 | 320 | Service frequency | 3 days per week | 5 days per week', '3 | 330 | Proposal due date | 1 Oct 2027 | 15 Oct 2027',
    'Item 5. Insert new Building 7720, Vehicle Wash Facility, 3,200 SF, serviced one day per week.', 'Item 6. Delete Building 210 in its entirety.') };
  const inv = read(base, amd);
  assert.equal(fac(inv, '310').grossSqft, 23450);
  assert.equal(fac(inv, '320').serviceLevel, 'daily_5');
  assert.deepEqual([fac(inv, '330').grossSqft, fac(inv, '330').serviceLevel, fac(inv, '330').status], [15000, 'weekly', undefined]);
  assert.equal(fac(inv, '210').status, 'deleted_by_amendment');
  assert.deepEqual([fac(inv, '7720').name, fac(inv, '7720').grossSqft, fac(inv, '7720').serviceLevel], ['Vehicle Wash Facility', 3200, 'weekly']);
  const dates = read(base, { name: 'Amendment 0003.pdf', role: 'amendment', amendment: 3, text: lines('No. | Reference | From | To', '1 | Proposal due date | 1 October 2027 | 15 October 2027', '2 | Site visit, Building 310 | 9:00 a.m., 12 Sept | 1:00 p.m., 14 Sept') });
  assert.deepEqual(dates.facilities.map((f) => [f.buildingNumber, f.grossSqft, f.serviceLevel, f.status]), read(base).facilities.map((f) => [f.buildingNumber, f.grossSqft, f.serviceLevel, f.status]));
});

test('narrative facilities: "sq ft" without periods, "single-story", and a parking lot heading adds nothing', () => {
  const inv = read(lines('SECTION 4. BUILDING DESCRIPTIONS',
    'Building 2: Public Safety Complex',
    'Police and fire share this 26,000 sq ft facility on one floor; the apparatus bay (8,000 sq ft) is cleaned by fire personnel. Custodial service seven days per week.',
    'Building 3: Senior Center',
    'Single-story, 7,200 square feet. Service three (3) days per week, Monday, Wednesday and Friday.',
    'Site 4 - Commuter Lot',
    'The commuter parking lot of approximately 45,000 sq ft is swept monthly by the Public Works Department.'));
  assert.deepEqual([fac(inv, '2').grossSqft, fac(inv, '2').serviceLevel], [26000, 'daily_7']);
  assert.deepEqual([fac(inv, '3').grossSqft, fac(inv, '3').floors, fac(inv, '3').serviceLevel], [7200, 1, '3x_week']);
  assert.ok(!inv.facilities.some((f) => f.buildingNumber === '4'));
});

test('grounds: a "not included" item at one place, or work done by the contractor, leaves the prose acreage in', () => {
  const inv = read(lines('C.5 Grounds Maintenance. The contractor shall maintain 640 acres of improved grounds on the main cantonment.',
    'C.6 Services Not Included: refuse collection at the Reserve Center, lawn care at the Army Reserve Center, and pest control.',
    'C.7 Mowing of the drop zone is performed by the Contractor under CLIN 0004.'));
  near(acres(inv.grounds, 'improved_turf'), 640);
  // performed by anyone but the contractor takes grounds out
  assert.equal(read(lines('Grounds maintenance is performed by the Directorate of Public Works.', 'The campus has 40 acres of improved turf.')).grounds.length, 0);
  // the size of a site that is itself the maintained area counts
  near(acres(read('Site 7 - Oakwood Cemetery. The site covers approximately 6 acres of improved turf, mowed weekly.').grounds, 'improved_turf'), 6);
});

test('site: "The County" and county facility names are not the owner', () => {
  const inv = read(lines('JANITORIAL SERVICES - MARLOW COUNTY BOARD OF EDUCATION, GEORGIA',
    'The County seeks bids. The County will furnish paper. The County may inspect. The County will pay monthly. The County intends to award one contract.',
    'Marlow County Board of Education offices are located at 12 Court Square. North County Service Center and South County Service Center are included.'));
  assert.equal(inv.site.installationName, 'Marlow County');
});

// ---------------------------------------------------------------------------------------------- generalization rules, round 2

test('schedule legends: codes with digits or slashes ("D5", "3/W", "6X", "1M"), and codes for no service', () => {
  const inv = read(lines('3.4 Service Frequency Codes', 'D7 - Seven days per week, including holidays', 'D5 - Monday through Friday', '3/W - Three times per week (Mon, Wed, Fri)',
    'W - Once per week', 'NS - No service required; listed for reference', '',
    'Bldg | Facility | Gross SF | Frequency Code', '101 | Administration Building | 10,000 | D5', '102 | Gymnasium | 20,000 | D7', '103 | Maintenance Shop | 5,000 | 3/W', '104 | Cold Storage | 3,000 | W', '105 | Pump House | 400 | NS'));
  assert.deepEqual(['101', '102', '103', '104'].map((b) => fac(inv, b).serviceLevel), ['daily_5', 'daily_7', '3x_week', 'weekly']);
  assert.equal(fac(inv, '105').status, 'excluded');
  const t = read(lines('Table 2. Cleaning frequency key', 'Key | Meaning', '6X | Six days a week (Monday - Saturday)', '2X | Two days per week', '1M | Once per month', 'NSR | Not serviced', '',
    'Building | Name | Square Feet | Svc Freq', 'A-1 | Library | 12,500 | 6X', 'A-2 | Archive | 4,000 | 1M', 'A-3 | Visitor Kiosk | 300 | NSR', 'A-4 | Chapel | 6,000 | 2X'));
  // ("Building" holding identifiers next to a "Name" column is the building number)
  assert.deepEqual(['A-1', 'A-2', 'A-4'].map((b) => [fac(t, b).name, fac(t, b).serviceLevel]), [['Library', 'daily_6'], ['Archive', 'monthly'], ['Chapel', '2x_week']]);
  assert.equal(fac(t, 'A-3').status, 'excluded');
  // "N/S" in a frequency column is no service
  assert.equal(fac(read(lines(H, '7 | Pump Station | Utility | 1 | 300 | 300 | N/S')), '7').status, 'excluded');
});

const SITE_GROUNDS = lines('EXHIBIT G - SITE GROUNDS DATA',
  'Site No. | Location | Lot Area (AC)[^1] | Mowed Turf (AC) | Semi- Improved (AC) | Asphalt Parking (SY) | Tactical Vehicle Parking (SY)[^2] | Plowing Area (SY)[^3] | Access Roads (SY) | Walks & Steps (SF)',
  'RC-1 | North Reserve Center | 12.0 | 5.50 | 2.00 | 4,000 | 6,000 | 5,500 | 1,500 | 3,100',
  'RC-2 | South Reserve Center | 9.5 | 3.25 | — | 2,500 | 3,000 | 3,400 | 900 | 1,900',
  'Site totals |  | 21.5 | 8.75 | 2.00 | 6,500 | 9,000 | 8,900 | 2,400 | 5,000',
  'OPTIONAL LOCATION – NOT INCLUDED IN THE BASE TOTALS |  |  |  |  |  |  |  |  |',
  'RC-9 | East Reserve Center (option) | 7.0 | 2.10 | — | 1,800 | 1,000 | 2,000 | 400 | 900', '',
  'Notes:', '1. Lot Area is the parcel size from the real property record, shown for information only.',
  '2. Tactical vehicle parking is shown for information only and is not maintained under this contract.', '3. Plowing Area = asphalt parking plus access roads.');

test('site grounds tables: footnoted information-only and sum columns, snow areas, paved-area kinds, optional-site banner', () => {
  const inv = read(SITE_GROUNDS);
  assert.equal(inScope(inv).length, 0, 'no building from a grounds table');
  near(acres(inv.grounds, 'improved_turf'), 8.75);
  near(acres(inv.grounds, 'semi_improved'), 2);
  // asphalt parking and access roads are the paved vehicle areas; the plowing area adds them up again; tactical parking is
  // information only (its footnote)
  near(sqft(inv.grounds, 'parking'), (6500 + 2400) * 9);
  near(sqft(inv.grounds, 'sidewalk'), 5000);
});

test('a banner about totals is not a total row; a subtotal that says what it leaves out still is', () => {
  const inv = read(lines(H, '1 | HQ | Admin | 2 | 10,000 | 9,000 | Daily', 'OPTION FACILITIES – PRICED SEPARATELY, NOT INCLUDED IN BASE TOTALS', '2 | New Annex | Admin | 1 | 5,000 | 4,500 | Daily',
    'Subtotal – option facilities (not included in grand total) |  |  |  | 5,000 | 4,500 |'));
  assert.notEqual(fac(inv, '2').status, undefined);
  assert.equal(inv.facilities.length, 2);
});

test('a status banner directly above a site label covers that site\'s rows; the next site label after rows ends it', () => {
  const inv = read(lines(H, 'NORTH DISTRICT', '11 | North HQ | Admin | 2 | 10,000 | 9,000 | Daily', 'ALTERNATE SITE – OPTIONAL LINE ITEM ONLY', 'WEST DEPOT – 12 Mill Road', '21 | Depot Office | Admin | 1 | 3,000 | 2,700 | Daily',
    '22 | Depot Shop | Shop | 1 | 6,000 | 900 | Weekly', 'EAST DISTRICT', '31 | East HQ | Admin | 2 | 8,000 | 7,200 | Daily'));
  assert.deepEqual(['11', '21', '22', '31'].map((b) => fac(inv, b).status), [undefined, 'option_only', 'option_only', undefined]);
});

test('grounds tables: id keys under a feature title, descriptions in a location column, the table title kind, treatments and edging lengths', () => {
  const inv = read(lines('Table 3. Mowing Areas', 'Zone | Description | Class | Acres | Cuts per Year',
    'Z-1 | Headquarters lawns, not including the softball diamonds | Improved | 10.0 | 26', 'Z-2 | Training area road shoulders | Semi-Improved | 20.0 | 6', 'Z-3 | Range firebreaks | Unimproved | 50.0 | 1', '',
    'Table 4. Sports Fields', 'Field | Location | Quantity | Unit | Mowings per Year', 'SF-1 | Diamond west of Building 210 | 2.5 | AC | 40', 'SF-2 | Pitch at the youth center | 3.0 | AC | 40', ' | Total sports fields | 5.5 | AC |', '',
    'Table 5. Hardscape and Beds', 'No. | Item | Quantity | Unit', '1 | Mulched planting beds | 12,000 | SF', '2 | Curb and walk edging (length of edge) | 8,000 | LF', '3 | Parking areas - policing | 20,000 | SY', '',
    'Table 6. Integrated Pest Management - Turf Treatments', 'Description | Quantity | Unit | Applications per Year', 'Herbicide application - improved areas and sports fields | 15.5 | AC | 2',
    'Fertilizer application - sports fields | 5.5 | AC | 3', 'Fire ant treatment - Zone Z-1 | 10.0 | AC | 2'));
  for (const [k, v] of [['improved_turf', 10], ['semi_improved', 20], ['unimproved', 50], ['athletic_field', 5.5]] as const) near(acres(inv.grounds, k), v);
  near(sqft(inv.grounds, 'shrub_bed'), 12000);
  near(sqft(inv.grounds, 'parking'), 180000);
  assert.ok(!inv.grounds.some((g) => g.unit === 'lf'), 'an edging length is not an area');
  assert.equal(inScope(inv).length, 0);
  // an acreage column holds turf whatever its label says ("North lot and lawns"); a row's service level beats a turf title
  const t = read(lines('Site No. | Location | Mowed Turf (AC) | Parking (SY)', 'RC-1 | North lot and lawns | 5.50 | 4,000'));
  near(acres(t.grounds, 'improved_turf'), 5.5);
  const lv = read(lines('Park No. | Park | Mowable Turf Acres | Svc Lvl', 'P-1 | Lakeside | 4.0 | 1', 'P-2 | Meadow | 6.0 | 2'));
  assert.deepEqual([acres(lv.grounds, 'improved_turf'), acres(lv.grounds, 'semi_improved')], [4, 6]);
});

const BASE_AMEND = lines('Exhibit B - Facility Workload', 'Facility No. | Facility | Gross SF | Cleanable SF | Frequency', 'NC-14 | Storage Barn | 2,100 | 300 | 1X', '5512 | Fitness Annex | 10,000 | 8,000 | 5X',
  '5520 | Records Center | 6,000 | 5,000 | 2X', '5530 | Chapel | 4,000 | 3,600 | 2X', '', 'Frequency key: 5X = five days per week; 2X = two days per week; 1X = once per week.', '',
  'Exhibit G - Grounds', 'Site No. | Location | Mowed Turf (AC) | Parking (SY)', 'RC-1 | North lot and lawns | 5.50 | 4,000', 'RC-2 | South lot and lawns | 3.25 | 2,500');

test('amendment items: locators and place names before the building, "Bldg ID", semicolons in parentheses, "to read", schedule changes, site keys', () => {
  const inv = read(BASE_AMEND, { name: 'Amendment 0003.txt', role: 'amendment', amendment: 3, text: lines('AMENDMENT 0003 TO SOLICITATION W912AB-27-R-0101',
    '1. Exhibit B, North Campus, Facility No. NC-14, Storage Barn (2,100 GSF; 300 CSF), is hereby deleted from the requirement.',
    '2. Exhibit B line 2, Bldg 5512, Fitness Annex: gross area is revised from 10,000 to read 12,400 SF; cleanable area is revised from 8,000 to read 9,900 SF.',
    '3. Bldg 5520, Records Center: the cleaning frequency is changed from 2X to 5X (Monday through Friday).',
    '4. Exhibit G, South Reserve Center (RC-2): Mowed Turf is revised from 3.25 acres to 2.75 acres.') });
  assert.equal(fac(inv, 'NC-14').status, 'deleted_by_amendment');
  assert.deepEqual([fac(inv, '5512').grossSqft, fac(inv, '5512').cleanableSqft], [12400, 9900]);
  assert.equal(fac(inv, '5520').serviceLevel, 'daily_5');
  near(acres(inv.grounds, 'improved_turf'), 8.25);
  // the same changes worded differently, in an addendum bound into the same document
  const one = read(lines(BASE_AMEND, '', 'ADDENDUM NO. 2',
    'Change 1 - Table B rows 3 and 4, Bldg ID 5530, Chapel, Main Post, are DELETED in their entirety. The chaplain\'s staff will clean the chapel.',
    'Change 2 - Facility No. 5520 (Records Center): service frequency is revised from two days per week to three days per week.',
    'Change 3 - Area correction. Table B, Bldg ID 5512: Column 3, Gross SF, is revised from "10,000" to read "11,000".'));
  assert.equal(fac(one, '5530').status, 'deleted_by_amendment');
  assert.equal(fac(one, '5520').serviceLevel, '3x_week');
  assert.equal(fac(one, '5512').grossSqft, 11000);
  assert.equal(inScope(one).length, 3);
  // a building's own name set off by commas may hold any noun ("Vehicle Wash Building")
  const v = read(lines(H, 'W-7 | Vehicle Wash Building | Shop | 1 | 2,000 | 400 | Weekly'), { role: 'amendment', amendment: 1, text: 'Item 2. Table 1, Bldg W-7, Vehicle Wash Building (2,000 SF), is deleted.' });
  assert.equal(fac(v, 'W-7').status, 'deleted_by_amendment');
});

test('column titles: "No. of Floors" / "Number of Stories" count floors; an abbreviation column under the group label is not the name', () => {
  const inv = read(lines('Bldg. No. | Abbrev. | Building Name | No. of Floors | Gross Sq Ft | Cleanable Sq Ft', '101 | HSC | Health Sciences Center | 3 | 40,000 | 33,000'));
  assert.deepEqual([fac(inv, '101').name, fac(inv, '101').floors], ['Health Sciences Center', 3]);
  const g = read(lines('FACILITY Number | FACILITY Code | FACILITY Facility Name | FACILITY Number of Stories | SPACE Gross SF | SPACE Cleanable SF | SERVICE Frequency', 'A-12 | DRM | Dormitory East | 5 | 48,000 | 20,000 | 7/wk'));
  assert.deepEqual([fac(g, 'A-12').name, fac(g, 'A-12').floors, fac(g, 'A-12').serviceLevel], ['Dormitory East', 5, 'daily_7']);
  const a = read(lines('BUILDING No. | BUILDING Abbr. | BUILDING Building Name | AREA Gross SF', '07 | MUS | Music Hall | 9,000'));
  assert.equal(fac(a, '07').name, 'Music Hall');
});

test('remarks about a part of the building ("Tenant suite 2,400 SF … - excluded", "Gallery set-ups not included") are not its status', () => {
  const inv = read(lines('Bldg | Building | Gross SF | Remarks', '101 | Health Sciences | 40,000 | Tenant suite 2,400 SF cleaned by the hospital - excluded', '102 | Art Building | 20,000 | Gallery set-ups not included',
    '103 | Field House | 50,000 | Not included in contract'));
  assert.deepEqual(['101', '102', '103'].map((b) => fac(inv, b).status), [undefined, undefined, 'excluded']);
});

test('facilities the Government furnishes to the Contractor for its own use are not the workload', () => {
  const list = lines('Exhibit 5 - Facilities to be Cleaned', 'Bldg | Facility Name | Gross SF | Frequency', '300 | Headquarters | 30,000 | Daily', '302 | Clinic | 12,000 | Daily');
  const before = read(lines('2.6 The Government will make the following buildings available to the Contractor for offices and equipment storage.', 'Table 2-1. Contractor-Occupied Government Facilities',
    'Bldg | Facility | GSF | Purpose', '9001 | Contractor Office Trailer | 1,440 | Project office', '9002 | Equipment Shed | 2,000 | Mower storage', '', list));
  assert.deepEqual(inScope(before).map((f) => f.buildingNumber), ['300', '302']);
  const after = read(lines(list, '', 'Exhibit 6 - Government-Furnished Space for Contractor Operations', 'Building | Description | Square Feet', 'B-77 | Custodial supply warehouse | 3,200', 'B-78 | Break room trailer | 600'));
  assert.deepEqual(inScope(after).map((f) => f.buildingNumber), ['300', '302']);
});

const DFAC_TABLE = lines('The Contractor shall provide full food service at the dining facilities below.', 'Exhibit D-2. Average Headcount per Meal Period',
  'Bldg | Dining Facility | Operating Days | WEEKDAYS (MON-FRI, NOT INCLUDING HOLIDAYS) Bkfst | WEEKDAYS (MON-FRI, NOT INCLUDING HOLIDAYS) Lunch | WEEKDAYS (MON-FRI, NOT INCLUDING HOLIDAYS) Dinner | WEEKDAYS (MON-FRI, NOT INCLUDING HOLIDAYS) Mid Rats | WEEKENDS AND HOLIDAYS Brunch | WEEKENDS AND HOLIDAYS Supper',
  '1250 | Thunder Inn | 7 days | 300 | 600 | 350 | 50 | 400 | 300', '1260 | Lightning Cafe | Mon-Fri | 150 | 300 | 100 | — | — | —', '1270 | Schoolhouse Galley | Mon-Sat | 200 | 400 | 250 | — | 300 | 200');

test('dining headcounts: abbreviated meal titles, weekday titles that exclude holidays, and the days each facility operates', () => {
  const inv = read(DFAC_TABLE);
  // 7 days: (5 × 1,300 + 2 × 700) / 7; Monday–Friday: the weekday sum; Monday–Saturday: (5 × 850 + 500) / 6
  assert.deepEqual(['1250', '1260', '1270'].map((b) => fac(inv, b).dining?.mealsPerDay), [1129, 550, 792]);
  assert.deepEqual(['1250', '1260', '1270'].map((b) => [fac(inv, b).dining?.daysPerWeek, fac(inv, b).serviceLevel]), [[7, 'daily_7'], [5, 'daily_5'], [6, 'daily_6']]);
  assert.equal(fac(inv, '1250').dining?.mealPeriods, 4);
  // a revision table repeats the building with its old and its new figures
  const rev = read(DFAC_TABLE, { role: 'amendment', amendment: 2, text: lines('AMENDMENT 0002', 'Item 4. Exhibit D-2, Bldg 1250, is revised to read as follows:',
    'Bldg | Weekday Bkfst | Weekday Lunch | Weekday Dinner | Weekday Mid Rats | Weekend Brunch | Weekend Supper', '1250 (as issued) | 300 | 600 | 350 | 50 | 400 | 300', '1250 (revised) | 330 | 650 | 360 | 60 | 420 | 310') });
  assert.equal(fac(rev, '1250').dining?.mealsPerDay, 1209);
});

test('area columns: an area column of words is a location; a footnote defining the area cleaned makes it the cleanable area', () => {
  const inv = read(lines('Bldg | Dining Facility | Area | Gross SF[^1] | Scullery and Dining SF[^2] | Seats', 'G-1 | North Galley | Waterfront | 20,000 | 16,500 | 300', 'G-2 | South Galley | Airfield | 14,000 | 11,200 | 200', '',
    'NOTES', '1. Gross SF includes mechanical rooms.', '2. The area in which the Contractor performs sanitation and cleaning.'));
  assert.deepEqual(['G-1', 'G-2'].map((b) => [fac(inv, b).grossSqft, fac(inv, b).cleanableSqft, fac(inv, b).campus]), [[20000, 16500, 'Waterfront'], [14000, 11200, 'Airfield']]);
  const s = read(lines('Bldg | Name | Gross SF | Sanitation Area SF', '5 | Mess Hall 5 | 30,000 | 26,000'));
  assert.equal(fac(s, '5').cleanableSqft, 26000);
  // a name column under a title the reader does not know, right after the number ("Bldg | Galley | Area | …")
  const g = read(lines('Bldg | Galley | Area | Gross SF | Seats', 'G-1 | North Galley | Waterfront | 20,000 | 300', 'G-2 | South Galley | Airfield | 14,000 | 200'));
  assert.deepEqual(['G-1', 'G-2'].map((b) => [fac(g, b).name, fac(g, b).campus]), [['North Galley', 'Waterfront'], ['South Galley', 'Airfield']]);
});

test('prior award in a label / value table of the current contract', () => {
  const pa = heuristicPriorAward([doc(lines('TECHNICAL EXHIBIT 9 - HISTORICAL DATA', 'Table 9-1. Current Contract', 'Item | Information', 'Contract number | W912XY-21-C-0042', 'Contractor | Prairie Facility Services, Inc.',
    'Date of award | 15 June 2021', 'Period of performance | 1 July 2021 – 30 June 2026 (base year and four option years; 60 months)', 'Total contract value, all periods | $12,345,678'))]);
  assert.deepEqual([pa?.contractNumber, pa?.incumbent, pa?.awardYear, pa?.totalValue, pa?.periodMonths], ['W912XY-21-C-0042', 'Prairie Facility Services, Inc.', 2021, 12345678, 60]);
  const pb = heuristicPriorAward([doc(lines('SECTION 8 - INCUMBENT CONTRACT INFORMATION', 'Incumbent: | Blue Heron Services LLC', 'Contract No.: | 47PB0020C0012', 'Awarded: | March 3, 2020',
    'Estimated total value (5 years): | $4,500,000', 'Current annual value: | $905,000'))]);
  assert.deepEqual([pb?.contractNumber, pb?.incumbent, pb?.awardYear, pb?.totalValue, pb?.annualValue, pb?.periodMonths], ['47PB0020C0012', 'Blue Heron Services LLC', 2020, 4500000, 905000, 60]);
  // a blank form field is not an award
  assert.equal(heuristicPriorAward([doc(lines('Offeror Information', 'Contractor | ______________', 'Contract No. | (to be assigned at award)'))]), undefined);
});

test('change tables with "As Issued / As Amended" columns: bare figures take the item label, "Deleted" deletes, codes revise the schedule', () => {
  const inv = read(lines('Exhibit 2 - Facility List', 'Bldg | Facility | Gross SF | Cleanable SF | Frequency', '40 | Admin | 10,000 | 9,000 | 5X', '41 | Shop | 8,000 | 1,200 | 2X', '42 | Store | 3,000 | 2,500 | 2X', '',
    '5X = five days per week; 2X = two days per week; 1X = one day per week.'),
  { role: 'amendment', amendment: 1, text: lines('AMENDMENT 0001', 'The following entries of Exhibit 2 are revised:', 'Bldg | Item | As Issued | As Amended', '40 | Gross SF | 10,000 | 10,600', '41 | Frequency | 2X | 1X', '42 | Status | In scope | Deleted') });
  assert.equal(fac(inv, '40').grossSqft, 10600);
  assert.equal(fac(inv, '41').serviceLevel, 'weekly');
  assert.equal(fac(inv, '42').status, 'deleted_by_amendment');
});

test('multi-site lists: a "Site / Bldg" key column, site rows and site subtotals, "N/W" codes defined inline with a no-service code', () => {
  const inv = read(lines('TECHNICAL EXHIBIT A - SITE AND BUILDING DATA', 'Site / Bldg | Building | Gross SF | Custodial SF | Freq',
    'SITE 1 - LAKEVIEW RESERVE CENTER, 100 Shore Rd |  |  |  |', 'L-01 | Training Building | 20,000 | 17,000 | 5/W', 'L-02 | Maintenance Shop | 6,000 | 900 | 1/W', ' | Site 1 subtotal | 26,000 | 17,900 |',
    'SITE 2 - HILLTOP RESERVE CENTER, 9 Ridge Ave |  |  |  |', 'H-01 | Training Building | 15,000 | 13,000 | 3/W', 'H-02 | Storage | 2,000 | — | N/S', ' | Site 2 subtotal | 17,000 | 13,000 |', ' | GRAND TOTAL | 43,000 | 30,900 |', '',
    'Frequency: 5/W = five days a week; 3/W = three days a week; 1/W = once a week; N/S = no service.'));
  assert.deepEqual(['L-01', 'L-02', 'H-01'].map((b) => [fac(inv, b).grossSqft, fac(inv, b).serviceLevel]), [[20000, 'daily_5'], [6000, 'weekly'], [15000, '3x_week']]);
  assert.equal(fac(inv, 'H-02').status, 'excluded');
  assert.equal(inScope(inv).length, 3);
  assert.deepEqual(['2/w', '1/M'].map(serviceLevelFromText), ['2x_week', 'monthly']);
});

test('prior award prose: "the current contract (…) with <company> expires …" and "$8.2 million"', () => {
  const pa = heuristicPriorAward([doc('1.3 Background. The current contract (W912DY-20-D-0044) with Apex Facility Solutions, Inc. expires 30 September 2027. It was awarded in 2020 and its total value including all options is $8.2 million over 60 months.')]);
  assert.deepEqual([pa?.contractNumber, pa?.incumbent, pa?.awardYear, pa?.totalValue, pa?.periodMonths], ['W912DY-20-D-0044', 'Apex Facility Solutions, Inc.', 2020, 8200000, 60]);
});

test('banner rows: an optional block ("SOUTH CAMPUS (OPTION)") and one not in the base contract put their rows out of the base inventory', () => {
  const inv = read(lines('Bldg | Name | Gross SF | Cleanable SF', 'NORTH CAMPUS', '101 | Admin Building | 10,000 | 9,000', 'SOUTH CAMPUS (OPTION)', '201 | Gym | 30,000 | 26,000',
    'ANNEX – NOT IN BASE CONTRACT', '301 | Annex Office | 5,000 | 4,500'));
  assert.deepEqual(['101', '201', '301'].map((b) => fac(inv, b).status), [undefined, 'option_only', 'excluded']);
  assert.equal(fac(inv, '101').campus, 'NORTH CAMPUS');
});

// ---------------------------------------------------------------------------------------------- round 2 review: where the rules must not fire

const COURTS = lines('C.3 FACILITIES', 'Exhibit 2. Facilities to be cleaned',
  'The Contractor shall clean the facilities below. Government-furnished office space for the Contractor\'s site manager is in Bldg 104 and is not listed.',
  'Facility # | Facility | Rentable SF | Cleanable SF | Service Days', '101 | Federal Office Building | 120,000 | 98,000 | 5 days per week', '102 | Courthouse Annex | 45,000 | 38,500 | 5 days per week',
  '103 | Child Care Center | 9,800 | 8,700 | 5 days per week', '105 | Parking Garage Office | 2,400 | 2,000 | 1 day per week');

test('a sentence under a table title that mentions the Contractor\'s space does not make the listed facilities the Contractor\'s', () => {
  const inv = read(COURTS);
  assert.deepEqual(inScope(inv).map((f) => f.buildingNumber), ['101', '102', '103', '105']);
});

test('amendment items: a part, a service or another service\'s schedule named with the building, and date-only changes, leave the building as listed', () => {
  const inv = read(COURTS, { name: 'Amendment 0002.txt', role: 'amendment', amendment: 2, text: lines('AMENDMENT 0002 TO SOLICITATION 47PF0026R0031',
    '1. The proposal due date is changed from 10 January 2027 to 24 January 2027.',
    '2. Part of Building 102 (the third-floor jury assembly suite) is deleted from the requirement.',
    '3. Window Washing, Building 103, is deleted. The tenant will contract for window washing directly.',
    '4. The frequency of trash pickup at Building 105 is increased to 3 times per week.',
    '5. The carpet extraction frequency for Building 101 is changed from annually to semi-annually.',
    '6. The period of performance start for Building 103 is revised from 1 October 2027 to 1 November 2027.') });
  assert.deepEqual(['101', '102', '103', '105'].map((b) => [fac(inv, b).status, fac(inv, b).serviceLevel]), [[undefined, 'daily_5'], [undefined, 'daily_5'], [undefined, 'daily_5'], [undefined, 'weekly']]);
  // the same kinds of items worded as real deletions and schedule changes still apply
  const del = read(COURTS, { name: 'Amendment 0003.txt', role: 'amendment', amendment: 3, text: lines('AMENDMENT 0003',
    'a. Exhibit 2, Line 3, Building 103 (Child Care Center) is hereby deleted.', 'b. Exhibit 2, Riverside Campus, Building 102 is deleted in its entirety.',
    'c. Facility # 105 service frequency is changed from one day per week to three days per week.') });
  assert.deepEqual(['102', '103'].map((b) => fac(del, b).status), ['deleted_by_amendment', 'deleted_by_amendment']);
  assert.equal(fac(del, '105').serviceLevel, '3x_week');
});

test('change tables: a task or part marked "Deleted" leaves the building in; "(New)" / "(Old)" in a base list only describe the building', () => {
  const inv = read(lines('Bldg | Clinic | Gross SF | Net Cleanable SF | Frequency', 'CL-1 | Eastside Clinic | 18,000 | 15,200 | 5X', 'CL-3 (New) | Northside Clinic | 9,000 | 7,600 | 5X',
    'CL-4 (Old) | Southside Clinic | 6,000 | 5,100 | 3X', '', '5X = five days per week; 3X = three days per week.'),
  { role: 'amendment', amendment: 1, text: lines('AMENDMENT NO. 1', 'Bldg | Item | As Issued | As Amended', 'CL-1 | Window cleaning | Quarterly | Deleted', 'CL-3 | Floor stripping frequency | Quarterly | Semi-annually',
    'CL-4 | Clinic | Southside Clinic | Deleted') });
  assert.deepEqual(['CL-1', 'CL-3', 'CL-4'].map((b) => fac(inv, b).status), [undefined, undefined, 'deleted_by_amendment']);
  assert.equal(fac(inv, 'CL-3').serviceLevel, 'daily_5');
  assert.equal(fac(inv, 'CL-4').grossSqft, 6000);
});

test('column notes: a note about what the column leaves out, a sum of things the table does not list, or "space not cleaned" leave the column as titled', () => {
  const parks = read(lines('ATTACHMENT B - PARKS GROUNDS INVENTORY', 'Park ID | Park Name | Improved Turf (AC)[^1] | Rough Mow (AC)[^2] | Total Mowed (AC)[^3]',
    'P-01 | Riverside Park | 12.5 | 4.0 | 16.5', 'P-02 | Elm Street Commons | 3.2 | — | 3.2', '', 'Notes:',
    '1. Improved turf excludes ball diamonds, which are listed for information only in Attachment C.', '2. Rough mow excludes wetland buffers not mowed under this contract.',
    '3. Total Mowed = Improved Turf + Rough Mow.'));
  near(acres(parks.grounds, 'improved_turf'), 15.7);
  near(acres(parks.grounds, 'unimproved'), 4);
  const turf = read(lines('Park No. | Park | Improved (AC)[^1]', 'P-1 | Lakeside | 4.0', 'P-2 | Meadow | 6.0', '', 'NOTES', '1. Improved = lawns + cemetery grounds.'));
  near(acres(turf.grounds, 'improved_turf'), 10);
  const schools = read(lines('Site Code | School | Building Area (SF)[^1] | Cleanable Area (SF)[^2]', 'ES-01 | Alder Elementary | 52,000 | 46,000', 'ES-02 | Birch Elementary | 48,500 | 43,000', '',
    'NOTES', '1. Building area includes space not cleaned by the Contractor (kitchens operated by Food Services).', '2. Cleanable area is the area to be cleaned nightly.'));
  assert.deepEqual([fac(schools, 'ES-01').grossSqft, fac(schools, 'ES-01').cleanableSqft], [52000, 46000]);
});

test('one-line legends with digit codes are one legend; days open are cleaning days only where food is served', () => {
  const inv = read(lines('3.1 Frequency Legend', '1A Restrooms and break rooms - cleaned daily', '1B Offices - cleaned three times per week', '2W = twice weekly; 4W = four times per week; NS = not serviced', '',
    'Bldg No. | Building Name | Gross SF | Frequency', 'B-10 | Operations Center | 30,000 | 2W', 'B-12 | Paint Shop | 6,000 | NS'));
  assert.equal(fac(inv, 'B-10').serviceLevel, '2x_week');
  assert.equal(fac(inv, 'B-12').status, 'excluded');
  const hosp = read(lines('Bldg | Building Name | Gross SF | Cleanable SF | Days Open', 'H1 | Main Hospital | 220,000 | 180,000 | 7', 'H3 | Central Plant | 18,000 | 1,200 | 7'));
  assert.equal(fac(hosp, 'H3').serviceLevel, 'daily_5');
});

test('a status banner over several sites covers each site under it; a banner over one site ends at the next site', () => {
  const inv = read(lines('Facility Number | Facility Title | Gross Area SF | Janitorial Area SF | Cleaning Days', 'NOSC JACKSONVILLE |  |  |  |', 'J-100 | Drill Hall | 40,000 | 33,000 | 5',
    'SITES NOT ON THE BASE CONTRACT – REFERENCE ONLY |  |  |  |', 'NOSC TAMPA |  |  |  |', 'T-400 | Training Building | 25,000 | 21,000 | 5', 'NOSC MIAMI |  |  |  |', 'X-500 | Training Building | 27,000 | 23,000 | 5'));
  assert.deepEqual(['J-100', 'T-400', 'X-500'].map((b) => fac(inv, b).status), [undefined, 'excluded', 'excluded']);
});

test('paved and snow columns: mowed road shoulders in acres are turf, a parking "Lot Area" in SY is parking, a snow column gives way only to its own paved column', () => {
  const g = read(lines('Zone | Location | Road Shoulder Mowing Area (AC) | Lot Area (SY) | Snow Removal Walks (SF)', 'Z-1 | North gate | 6.0 | 3,000 | 1,200', 'Z-2 | South gate | 4.0 | 2,000 | 800'));
  near(acres(g.grounds, 'improved_turf'), 10);
  near(sqft(g.grounds, 'parking'), 45000);
  near(sqft(g.grounds, 'sidewalk'), 2000);
  const both = read(lines('Site | Location | Parking Lots (SY) | Snow Removal – Parking Lots (SY)', 'S-1 | Depot | 1,000 | 1,000', 'S-2 | Annex | 500 | 500'));
  near(sqft(both.grounds, 'parking'), 13500);
});

test('prior award: a label / value table of another contract (another number, another contractor) adds nothing to the current one', () => {
  const pa = heuristicPriorAward([doc('1.2 The current contract (47PL0021C0007) with Cascade Building Services Inc. expires 30 September 2027.'),
    doc(lines('Previous Contract (Grounds)', 'Contractor | Evergreen Landscape Group LLC', 'Contract No. | 47PL0018C0003', 'Total contract value | $2,900,000', 'Award date | 2018'), 1)]);
  assert.deepEqual([pa?.incumbent, pa?.contractNumber, pa?.totalValue, pa?.awardYear], ['Cascade Building Services Inc.', '47PL0021C0007', undefined, undefined]);
});

// ---------------------------------------------------------------------------------------------- fixtures

// Score floors a little below what the reader achieves (see the eval: npx tsx scripts/eval.ts --provider heuristic).
// The scanned exhibit has no text layer: only the AI reader (or OCR) can read it.
const FLOORS: Record<string, number> = {
  'army-bos-te-facility-list-pdf': 95,
  'city-parks-mowing-pdf': 95,
  'dfac-ffs-headcount-pdf': 95,
  'gsa-building-information-sheets': 95,
  'gsa-building-information-sheets-pdf': 95,
  'k12-district-custodial-pdf': 95,
  'large-installation-420-xlsx': 95,
  'oconus-metric-sm-pdf': 95,
  'rfp-plus-addendum-revisions': 95,
  'rpi-export-mixed-units-xlsx': 95,
  'sample-fort-example': 95,
  'sample-fort-example-docx': 95,
  'sample-fort-example-txt': 95,
  'scanned-facility-exhibit': 30,
  'univ-buildings-in-scope-xlsx': 95,
  'univ-custodial-inline-pdf': 95,
};
const EXT: Record<string, string> = { pdf: 'pdf', 'scanned-pdf': 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv', txt: 'txt' };
const fixtureDirs = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((d) => fs.existsSync(path.join(FIXTURES, d, 'truth.json'))).sort() : [];

for (const id of fixtureDirs) {
  test(`fixture ${id}: rule-based reader score floor`, async (t) => {
    const dir = path.join(FIXTURES, id);
    const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8')) as FixtureTruth;
    const files = truth.inputs.map((i) => path.join(dir, 'build', i.out ?? `${path.basename(i.src).replace(/\.[^.]+$/, '')}${i.as === 'scanned-pdf' ? '-scanned' : ''}.${EXT[i.as]}`));
    if (files.some((f) => !fs.existsSync(f))) { t.skip('fixture not rendered (node scripts/render-fixtures.mjs)'); return; }
    const docs: DocInput[] = [];
    for (const f of files) docs.push(...(await readDocument(path.basename(f), fs.readFileSync(f))));
    const ordered = orderDocuments(docs);
    const rep = scoreInventory(truth, heuristicExtract(ordered), 'heuristic', heuristicPriorAward(ordered));
    const floor = FLOORS[id];
    if (floor == null) { t.diagnostic(`no floor set for ${id}: scored ${rep.score}`); assert.ok(rep.score >= 0); return; }
    assert.ok(rep.score >= floor, `${id} scored ${rep.score} (floor ${floor}); misses: ${rep.misses.slice(0, 5).join('; ')}; extras: ${rep.extras.slice(0, 5).join('; ')}`);
  });
}

test.after(async () => { await closeReaders(); });
