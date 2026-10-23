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
