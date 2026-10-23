#!/usr/bin/env node
// Generates the Attachment A workbook source (attachment-a-facility-list.json) and the expected
// facility list (printed as JSON, pasted into truth.json) from ONE table, so the workbook rows, the
// group subtotals in the ITB summary (Section 3), the Addendum No. 1 Was/Is tables and truth.json agree.
//   node gen.mjs            -> writes attachment-a-facility-list.json, prints totals and the expected facilities
//   GEN_OUT=<dir> node gen.mjs -> same, but writes the expected facilities to <dir>/facilities.gen.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// [no, name, address, floors, gross, cleanable, restrooms, days, window, remarks, carpetShare, woodSf, cat]
const GROUPS = [
  { id: 'A', title: 'GROUP A – GOVERNMENT CENTER CAMPUS, MARLOW SPRINGS', rows: [
    [101, 'County Administration Building', '200 N. Palmetto Ave., Marlow Springs', 4, 86400, 71250, 16, 'Mon-Fri', '6:00 PM - 2:30 AM', 'BOCC Chambers (3rd fl.) cleaned after evening meetings, see ITB 2.5', 0.62, 0, 'admin'],
    [102, 'Coquina County Judicial Center', '225 N. Palmetto Ave., Marlow Springs', 5, 168900, 128640, 34, 'Mon-Fri', '6:00 PM - 2:30 AM; 2 day porters 7:30 AM - 4:00 PM', 'Floors include basement. Holding cells, sally port and secure prisoner corridors excluded (Sheriff)', 0.48, 0, null],
    [103, 'Historic Courthouse (History Museum / Clerk Archives)', '101 E. Main St., Marlow Springs', 3, 22760, 18420, 4, 'M/W/F', 'After 5:00 PM', 'Museum galleries: dust only; do not wet-clean exhibit cases', 0.2, 0, null],
    [104, 'Tax Collector / Property Appraiser Building', '240 N. Palmetto Ave., Marlow Springs', 2, 31580, 26940, 6, 'Mon-Fri', 'After 5:30 PM', '', 0.58, 0, 'admin'],
    [105, 'Supervisor of Elections Office and Warehouse', '310 W. Orange St., Marlow Springs', 1, 38200, 9860, 4, 'Mon-Fri', 'After 5:00 PM', 'Office, lobby, training room and restrooms only. Ballot warehouse (28,340 SF) excluded, see Note 4', 0.55, 0, null],
    [106, 'Emergency Operations Center', '2400 Twin Oaks Blvd., Marlow Springs', 2, 24600, 19850, 6, 'Mon-Fri', 'After 5:00 PM', 'Cleaning during EOC activations (24/7) ordered as Additional Services, ITB 2.9', 0.5, 0, null],
  ] },
  { id: 'B', title: 'GROUP B – LIBRARIES, COMMUNITY AND HUMAN SERVICES', rows: [
    [201, 'Marlow Springs Main Library', '410 W. Orange St., Marlow Springs', 2, 48300, 42180, 8, 'Mon-Sat', '5:00 AM - 9:30 AM', 'Library opens 10:00 AM; work must be complete before opening', 0.7, 0, null],
    [202, 'Westshore Branch Library', '7720 Gulf Blvd., Westshore', 1, 14250, 12960, 3, 'Mon-Sat', '5:00 AM - 9:30 AM', '', 0.72, 0, null],
    [203, 'Palm Hollow Branch Library', '1515 Palm Hollow Rd., Palm Hollow', 1, 11800, 10740, 2, 'Mon-Sat', '5:00 AM - 9:30 AM', '', 0.72, 0, null],
    [204, 'Cypress Point Branch Library', '960 Cypress Point Dr., Cypress Point', 1, 9640, 8820, 2, 'Tue-Sat', '5:00 AM - 9:30 AM', 'Branch closed Sunday and Monday', 0.7, 0, null],
    [205, 'North County Branch Library', '18350 US Highway 19 N, Pine Ridge', 1, 12400, 11260, 3, 'Mon-Sat', '5:00 AM - 9:30 AM', '', 0.72, 0, null],
    [206, 'Marlow Springs Senior Center', '600 S. Magnolia Ave., Marlow Springs', 1, 16900, 14320, 4, 'Mon-Fri', 'After 4:00 PM', 'Kitchen cleaned by meal-site vendor; dining room floor by Contractor', 0.25, 0, 'community'],
    [207, 'Westshore Community Center', '7800 Gulf Blvd., Westshore', 1, 21480, 18900, 6, 'Mon-Sat', 'After 9:30 PM (after rentals)', 'Gymnasium wood floor (7,200 SF) dust-mopped each service', 0.1, 7200, 'community'],
    [208, 'UF/IFAS Extension Office and Auditorium', '3100 Fairgrounds Rd., Marlow Springs', 1, 13260, 11480, 4, 'M/W/F', 'After 5:00 PM', '', 0.3, 0, null],
    [209, 'Florida Department of Health in Coquina County – Marlow Springs Clinic', '515 S. Magnolia Ave., Marlow Springs', 2, 34700, 29980, 12, 'Mon-Fri', 'After 5:30 PM', 'Clinical areas per ITB 2.7. Pharmacy and laboratory excluded', 0.2, 0, 'medical'],
  ] },
  { id: 'C', title: 'GROUP C – PUBLIC SAFETY AND OPERATIONS', rows: [
    [301, "Sheriff's Office Administration Building", '2600 Twin Oaks Blvd., Marlow Springs', 3, 52900, 44100, 10, '7 days', '6:00 PM - 2:30 AM', '24-hour facility; CJIS/FDLE screening, ITB 4.3. Evidence and armory excluded', 0.5, 0, 'admin'],
    [302, "Sheriff's District 2 Substation", '7650 Gulf Blvd., Westshore', 1, 7840, 6920, 3, 'M/W/F', 'After 6:00 PM', '', 0.4, 0, null],
    [303, 'Public Safety Communications (911) Center', '2450 Twin Oaks Blvd., Marlow Springs', 1, 12600, 10240, 4, '7 days', '10:00 AM - 2:00 PM', 'Dispatch floor occupied 24/7: quiet work only, escort required', 0.65, 0, null],
    [304, 'Animal Services Center', '4150 Industrial Pkwy., Marlow Springs', 1, 26500, 5180, 4, 'Mon-Sat', '6:00 AM - 9:00 AM', 'Lobby, adoption rooms, offices and restrooms only. Kennels, clinic and isolation cleaned by shelter staff', 0.1, 0, null],
    [305, 'Public Works Operations Complex – Administration Building', '4300 Industrial Pkwy., Marlow Springs', 2, 18450, 15600, 6, 'Mon-Fri', 'After 4:30 PM', '', 0.55, 0, 'admin'],
    [306, 'Public Works Fleet Maintenance Shop', '4320 Industrial Pkwy., Marlow Springs', 1, 32800, 4950, 4, 'M/W/F', 'After 4:30 PM', 'Offices, parts counter, break room, restrooms and locker rooms only; shop bays excluded', 0.15, 0, 'maintenance'],
    [307, 'Solid Waste Transfer Station – Scale House', '9900 Landfill Rd., Marlow Springs', 1, 2140, 1980, 1, 'Tue & Thu', 'After 5:00 PM', '', 0, 0, null],
    [308, 'Utilities Administration and Customer Service', '1200 Commerce Blvd., Marlow Springs', 1, 15700, 13420, 4, 'Mon-Fri', 'After 5:30 PM', 'Includes drive-thru teller area', 0.5, 0, 'admin'],
    [309, 'Mosquito Control Office', '1180 Industrial Pkwy., Marlow Springs', 1, 4860, 3920, 2, 'Weekly (Wed)', 'After 4:30 PM', '', 0.4, 0, 'admin'],
    [310, 'Fire Rescue Administration and Training Center', '2500 Twin Oaks Blvd., Marlow Springs', 2, 22300, 18760, 8, 'Mon-Fri', 'After 5:00 PM', 'Fire Rescue stations are not part of this ITB (ITB 2.2)', 0.45, 0, null],
  ] },
  { id: 'D', title: 'GROUP D – NORTH COUNTY AND PARKS', rows: [
    [401, 'North County Government Annex', '18400 US Highway 19 N, Pine Ridge', 2, 27400, 23560, 8, 'Mon-Fri', 'After 5:30 PM', 'Includes Tax Collector branch office and County Court hearing room', 0.55, 0, 'admin'],
    [402, 'Pine Ridge Community Center', '2210 Ridge Rd., Pine Ridge', 1, 9950, 8700, 4, 'M/W/F', 'After 9:00 PM', '', 0.15, 0, 'community'],
    [403, 'Clerk of Court Records Center', '17900 Commerce Way, Pine Ridge', 1, 19800, 3450, 2, 'Bi-weekly (Wed)', 'After 4:30 PM', 'Office, research room and restrooms only; records stacks excluded', 0.3, 0, null],
    [404, 'Gulf Breeze Beach Park – Restroom/Concession Building', '12 Gulf Breeze Dr., Westshore', 1, 1280, 1280, 2, '7 days', '6:00 AM - 8:00 AM', 'Second service 2:00 PM - 3:00 PM Memorial Day through Labor Day (included in monthly price)', 0, 0, null],
    [405, 'Cypress Lake Regional Park – Restroom Building', '3300 Cypress Lake Rd., Palm Hollow', 1, 860, 860, 2, '7 days', '6:00 AM - 8:00 AM', '', 0, 0, null],
    [406, 'Bayside Sports Complex – Concession/Restroom Building', '5100 Bayside Pkwy., Westshore', 1, 2240, 2240, 2, 'Sat & Sun', '7:00 AM - 9:00 AM', 'Year-round', 0, 0, null],
  ] },
];

const OPTIONS = [
  ['O-1', 'Coquina County Fairgrounds – Exhibition Hall', '3200 Fairgrounds Rd., Marlow Springs', 1, 24000, 21600, 6, 'Per event', 'As scheduled', 'OPTION ITEM 1 – event cleaning priced per event on Bid Form Part 3'],
  ['O-2', 'Bayside Branch Library (under construction)', '5150 Bayside Pkwy., Westshore', 1, 16500, 15000, 3, 'Mon-Sat', '5:00 AM - 9:30 AM', 'OPTION ITEM 2 – anticipated occupancy August 2027; added only by written change order. SF are design estimates'],
];

// ---- Addendum No. 1 changes ----
const ADD = {
  remeasure: { 101: { gross: 88880, cleanable: 73635 }, 202: { gross: 15870, cleanable: 14410 } },
  deleted: [309],
  freq: { 208: 'Mon-Fri', 403: 'Weekly (Wed)' },
  added: { group: 'B', row: [210, 'Veterans and Human Services Office', '4400 Commerce Blvd., Suite 100, Marlow Springs', 1, 7920, 7140, 3, 'Mon-Fri', 'After 5:30 PM', 'Leased suite; building common areas cleaned by landlord', 0.6, 0, 'admin'] },
};

const LEVEL = { 'Mon-Fri': 'daily_5', 'Tue-Sat': 'daily_5', 'Mon-Sat': 'daily_6', '7 days': 'daily_7', 'M/W/F': '3x_week', 'Tue & Thu': '2x_week', 'Sat & Sun': '2x_week', 'Weekly (Wed)': 'weekly', 'Bi-weekly (Wed)': 'biweekly' };

const carpetOf = (cleanable, share, wood) => Math.round((cleanable - wood) * share / 10) * 10;
const fmt = (n) => n.toLocaleString('en-US');

// ---------- workbook ----------
const sheet1 = [];
const merges1 = [];
const push = (r, mergeAll) => { sheet1.push(r); if (mergeAll) merges1.push(`A${sheet1.length}:J${sheet1.length}`); };
push(['COQUINA COUNTY BOARD OF COUNTY COMMISSIONERS – PROCUREMENT DIVISION'], true);
push(['ITB 27-014  JANITORIAL SERVICES – COUNTY FACILITIES'], true);
push(['ATTACHMENT A – FACILITY LIST AND SERVICE SCHEDULE'], true);
push(['Source: Facilities Management Division real property inventory, FY 2026 (prepared 09/22/2026). Areas in square feet. Service days are defined in ITB Section 2.4; see Notes below the table.'], true);
push([]);
sheet1.push(['FAC. NO.', 'FACILITY NAME', 'ADDRESS', 'FLOORS', 'SQUARE FEET', '', 'RESTROOMS', 'SERVICE DAYS', 'SERVICE WINDOW', 'REMARKS']);
const h = sheet1.length;
sheet1.push(['', '', '', '', 'GROSS', 'CLEANABLE', '', '', '', '']);
merges1.push(`A${h}:A${h + 1}`, `B${h}:B${h + 1}`, `C${h}:C${h + 1}`, `D${h}:D${h + 1}`, `E${h}:F${h}`, `G${h}:G${h + 1}`, `H${h}:H${h + 1}`, `I${h}:I${h + 1}`, `J${h}:J${h + 1}`);

const totals = { n: 0, g: 0, c: 0 };
const groupTotals = {};
for (const g of GROUPS) {
  push([g.title], true);
  let gg = 0, gc = 0;
  for (const r of g.rows) {
    sheet1.push([String(r[0]), r[1], r[2], String(r[3]), fmt(r[4]), fmt(r[5]), String(r[6]), r[7], r[8], r[9]]);
    gg += r[4]; gc += r[5];
  }
  groupTotals[g.id] = { n: g.rows.length, g: gg, c: gc };
  sheet1.push(['', `GROUP ${g.id} SUBTOTAL (${g.rows.length} FACILITIES)`, '', '', fmt(gg), fmt(gc), '', '', '', '']);
  totals.n += g.rows.length; totals.g += gg; totals.c += gc;
}
sheet1.push(['', `TOTAL – GROUPS A THROUGH D (${totals.n} FACILITIES)`, '', '', fmt(totals.g), fmt(totals.c), '', '', '', '']);
push([]);
push(['OPTIONAL FACILITIES – PRICED ON BID FORM PART 3 ONLY. NOT PART OF ANY GROUP AND NOT INCLUDED IN THE TOTALS ABOVE.'], true);
for (const o of OPTIONS) sheet1.push([o[0], o[1], o[2], String(o[3]), fmt(o[4]), fmt(o[5]), String(o[6]), o[7], o[8], o[9]]);
push([]);
push(['NOTES:'], true);
const notes = [
  '1. GROSS = gross building area from the County real property inventory, for information only. CLEANABLE = area to be serviced by the Contractor and the basis of the Bid Form unit price (ITB 2.3). Cleanable excludes mechanical/electrical rooms, shafts, unconditioned storage and the areas named in Remarks.',
  '2. SERVICE DAYS: Mon-Fri, Mon-Sat, Tue-Sat, M/W/F, Tue & Thu, Sat & Sun, Weekly and Bi-weekly are defined in ITB 2.4. Weekday schedules exclude the ten County holidays; "7 days" includes holidays.',
  '3. RESTROOMS = number of restroom rooms (single- and multi-occupant). Fixture counts are not available.',
  '4. Supervisor of Elections ballot warehouse is cleaned only when ordered as Additional Services (ITB 2.9), typically before and after each election.',
  '5. Optional facilities O-1 and O-2 are listed for pricing only (ITB 2.10) and become part of the Contract only by written change order.',
  '6. Facilities not listed (Detention Facility, Fire Rescue stations, Coquina County Civic Center, Marlow Springs Airport terminal) are not part of this ITB.',
];
for (const n of notes) push([n], true);

// Periodic services sheet
const sheet2 = [];
const merges2 = [];
const push2 = (r, mergeAll) => { sheet2.push(r); if (mergeAll) merges2.push(`A${sheet2.length}:J${sheet2.length}`); };
push2(['ITB 27-014  ATTACHMENT A – PERIODIC SERVICES (FLOOR CARE AND GLASS)'], true);
push2(['Frequencies are times per year. Floor areas are portions of the CLEANABLE SF on the Facility List tab and are not additional area.'], true);
push2([]);
sheet2.push(['FAC. NO.', 'FACILITY', 'CARPET SF', 'HARD FLOOR SF', 'WOOD GYM SF', 'CARPET EXTRACTION / YR', 'STRIP & REFINISH / YR', 'SCRUB & RECOAT / YR', 'INTERIOR GLASS / YR', 'REMARKS']);
const periodic = {};
let pc = 0, ph = 0, pw = 0;
const perRow = (r, cleanable) => {
  const [no, name] = r; const share = r[10]; const wood = r[11];
  const carpet = carpetOf(cleanable, share, wood); const hard = cleanable - carpet - wood;
  const park = no >= 404 && no <= 406 || no === 307;
  const lib = no >= 201 && no <= 205;
  const extr = carpet ? (lib || no === 303 ? 4 : 2) : 0;
  const strip = park ? 0 : 1;
  const recoat = park ? 0 : ([102, 201, 209].includes(no) ? 3 : 2);
  const glass = [101, 102, 201].includes(no) ? 4 : 2;
  const rem = park ? (no === 307 ? 'Sealed concrete; scrub monthly (12)' : 'Pressure-wash restroom floors and walls monthly (12)') : wood ? 'Wood gym floor screen & recoat 1/yr (July)' : '';
  return { no, name, carpet, hard, wood, extr, strip, recoat, glass, rem };
};
for (const g of GROUPS) for (const r of g.rows) {
  const p = perRow(r, r[5]); periodic[r[0]] = p; pc += p.carpet; ph += p.hard; pw += p.wood;
  sheet2.push([String(p.no), p.name, fmt(p.carpet), fmt(p.hard), p.wood ? fmt(p.wood) : '-', String(p.extr), String(p.strip), String(p.recoat), String(p.glass), p.rem]);
}
sheet2.push(['', 'TOTAL', fmt(pc), fmt(ph), fmt(pw), '', '', '', '', '']);

const workbook = { sheets: [
  { name: 'Facility List', rows: sheet1, merges: merges1, numFmt: [null, null, null, null, '#,##0', '#,##0', null, null, null, null] },
  { name: 'Periodic Services', rows: sheet2, merges: merges2, numFmt: [null, null, '#,##0', '#,##0', '#,##0', null, null, null, null, null] },
] };
fs.writeFileSync(path.join(here, 'attachment-a-facility-list.json'), JSON.stringify(workbook, null, 1));

// ---------- post-addendum truth ----------
const facilities = [];
const after = { A: { n: 0, g: 0, c: 0 }, B: { n: 0, g: 0, c: 0 }, C: { n: 0, g: 0, c: 0 }, D: { n: 0, g: 0, c: 0 } };
for (const g of GROUPS) {
  const rows = g.rows.filter((r) => !ADD.deleted.includes(r[0])).map((r) => [...r]);
  if (ADD.added.group === g.id) rows.push([...ADD.added.row]);
  for (const r of rows) {
    if (ADD.remeasure[r[0]]) { r[4] = ADD.remeasure[r[0]].gross; r[5] = ADD.remeasure[r[0]].cleanable; }
    if (ADD.freq[r[0]]) r[7] = ADD.freq[r[0]];
    const f = { buildingNumber: String(r[0]), name: r[1], grossSqft: r[4], cleanableSqft: r[5], floors: r[3], serviceLevel: LEVEL[r[7]] };
    if (!f.serviceLevel) throw new Error('no level for ' + r[7]);
    if (r[12]) f.category = r[12];
    facilities.push(f);
    after[g.id].n++; after[g.id].g += r[4]; after[g.id].c += r[5];
  }
}
const at = Object.values(after).reduce((a, b) => ({ n: a.n + b.n, g: a.g + b.g, c: a.c + b.c }), { n: 0, g: 0, c: 0 });

// periodic rows touched by the addendum
const addPeriodic = {
  101: { was: periodic[101], is: perRow(GROUPS[0].rows[0], ADD.remeasure[101].cleanable) },
  202: { was: periodic[202], is: perRow(GROUPS[1].rows[1], ADD.remeasure[202].cleanable) },
  210: { is: perRow(ADD.added.row, ADD.added.row[5]) },
  309: { was: periodic[309] },
};

console.log('BASE group totals', JSON.stringify(groupTotals), 'TOTAL', JSON.stringify(totals));
console.log('BASE periodic totals carpet', pc, 'hard', ph, 'wood', pw);
console.log('AFTER group totals', JSON.stringify(after), 'TOTAL', JSON.stringify(at));
console.log('ADDENDUM periodic', JSON.stringify(addPeriodic, null, 0));
const sumG = facilities.reduce((s, f) => s + f.grossSqft, 0);
console.log('truth facilities', facilities.length, 'gross', sumG, 'cleanable', facilities.reduce((s, f) => s + f.cleanableSqft, 0));
if (process.env.GEN_OUT) fs.writeFileSync(path.join(process.env.GEN_OUT, 'facilities.gen.json'), JSON.stringify(facilities, null, 2));
else console.log(JSON.stringify(facilities, null, 2));
