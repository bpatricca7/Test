#!/usr/bin/env node
// Generator for the af-custodial-workbook-xlsx holdout fixture.
//   cd bos-estimator && node tests/holdout/af-custodial-workbook-xlsx/gen.mjs
// Writes appendix-b.json (the multi-sheet workbook source that scripts/render-fixtures.mjs renders to XLSX) and
// truth.json (ground truth per tests/harness/truth.ts) from ONE table of rows, so the zone tabs, level subtotals,
// zone totals, the Summary tab, the Amendment 0001 change log and truth.json always agree.
// No randomness: every value below is written out by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOLICITATION = 'FA4693-27-R-0007';
const INSTALLATION = 'Tallgrass Air Force Base';
const OUT_XLSX = `${SOLICITATION} Atch 2 - Appendix B Est SF and Cleaning Level (Amd 0001).xlsx`;

const LEVELS = {
  1: { label: 'Cleaning Level 1 - Prestige', short: '1 - Prestige', clin: '0001' },
  2: { label: 'Cleaning Level 2 - Basic', short: '2 - Basic', clin: '0002' },
  4: { label: 'Cleaning Level 4 - Special Requirements', short: '4 - Special Req', clin: '0003' },
};
// Svc Freq wording as printed -> ServiceLevel id (null = no single level; truth leaves serviceLevel out)
const FREQ = {
  '5 x Week': 'daily_5',
  '7 x Week': 'daily_7',
  '6 x Week (Mon-Sat)': 'daily_6',
  '3 x Week': '3x_week',
  '2 x Week': '2x_week',
  '1 x Week': 'weekly',
  '1x every two weeks': 'biweekly',
  '3 x Week (APR-OCT only)': null,
};
// Annual service days used ONLY for the Summary "Total Per Year" workload line (stated on the Notes tab).
const ANNUAL_DAYS = {
  '5 x Week': 260, '7 x Week': 365, '6 x Week (Mon-Sat)': 312, '3 x Week': 156, '2 x Week': 104,
  '1 x Week': 52, '1x every two weeks': 26, '3 x Week (APR-OCT only)': 90,
};

// Row: [facNo, description, userAgency, level, freq, floors, rrCount, rrSF, carpetSF, hardSF, otherSF, opts]
// otherSF null = blank cell. opts: { cat, rev, remarks, show: {col: printedValue} } where show overrides how a
// zero component prints (blank '', '-', 'N/A'); the number used in sums is always the component value.
const Z = [
  {
    id: '1', tab: 'Zone 1 - Flightline', title: 'ZONE 1 - FLIGHTLINE (Facility Nos. 1100-1199)',
    rows: [
      ['1102', 'Base Operations', '726 OSS', 1, '5 x Week', 2, 4, 412, 3186, 2904, null, { remarks: 'Airfield Management & Base Ops lobby' }],
      ['1110', 'Passenger Terminal', '726 LRS', 1, '7 x Week', 1, 6, 1038, 1220, 7846, null, { remarks: 'Terminal lobby open 24 hrs during exercises/contingencies; see PWS 1.2' }],
      ['1114', 'Air Traffic Control Tower', '726 OSS', 2, '5 x Week', 6, 2, 96, 588, 412, null, { remarks: 'Cab level cleaned only with ATC escort' }],
      ['1120', 'Squadron Operations / Life Support', '726 ARS', 2, '5 x Week', 2, 6, 1284, 9412, 6950, null, {}],
      ['1124', 'Squadron Operations', '727 ARS', 2, '5 x Week', 2, 4, 862, 7330, 4118, null, { cat: 'admin' }],
      ['1130', 'Maintenance Hangar (Admin & Shop Areas Only)', '726 AMXS', 2, '3 x Week', '1 + Mezz', 4, 744, 1312, 2860, 5880, { remarks: 'Hangar bay floor NOT included. Other SF = shop floors only' }],
      ['1132', 'Fuel Cell Hangar (Admin Only)', '726 MXS', 2, '2 x Week', 1, 2, 238, 0, 1146, null, { remarks: 'Hangar bay NOT included' }],
      ['1140', 'Aircraft Maintenance Unit (AMU)', '726 AMXS', 2, '5 x Week', 2, 4, 618, 4870, 3915, null, {}],
      ['1146', 'Aerospace Ground Equipment (AGE)', '726 MXS', 2, '2 x Week', 1, 2, 312, 0, 2240, 1875, { cat: 'maintenance' }],
      ['1150', 'Fire Station / Crash Rescue', '726 CES', 2, '7 x Week', 2, 5, 902, 1160, 5488, null, { remarks: 'Apparatus bays and dormitory rooms cleaned by occupants' }],
      ['1158A', 'Munitions Squadron Admin', '726 MUNS', 2, '5 x Week', 1, 2, 205, 2310, 840, null, { cat: 'admin' }],
      ['1158B', 'Munitions Inspection Bay (Break Room & Latrine Only)', '726 MUNS', 2, '2 x Week', 1, 1, 148, 0, 296, null, { remarks: 'Escort required inside MSA' }],
      ['1166', 'Weather Flight', '726 OSS', 2, '1 x Week', 1, 1, 64, 980, 210, null, { cat: 'admin' }],
      ['1172', 'Aircrew Flight Equipment (Parachute Shop)', '726 OSS', 2, '1x every two weeks', 1, 2, 220, 0, 3140, null, {}],
      ['1176', 'Flight Simulator Facility', '726 OSS', 2, '5 x Week', 1, 2, 284, 3650, 1420, null, { remarks: 'Simulator bays excluded' }],
    ],
    deleted: [
      // printed inside the Level 2 block, after 1176, with zero SF
      ['1180', 'Squadron Operations (Old)', '726 ARS', 2, 'DELETED', 1, 0, 0, 0, 0, 0, { rev: 'A1', remarks: 'DELETED per Amendment 0001 - vacated 15 Jan 2027, programmed for demolition. Was Level 2, 5 x Week, 4,868 SF', was: { rr: 330, c: 2915, h: 1623, o: 0, t: 4868 } }],
    ],
    notes: [
      'NOTES:',
      '1. Square footages are estimated CLEANING AREAS, not gross building area (see Notes & Instructions tab, Note 1).',
      '2. Hangar bays, aircraft parking, simulator bays and munitions storage igloos are not serviced under this contract.',
      '3. Flightline access requires a restricted area badge; escort will be provided for facilities 1114 and 1158B.',
    ],
  },
  {
    id: '2', tab: 'Zone 2 - Cantonment', title: 'ZONE 2 - CANTONMENT / MISSION SUPPORT (Facility Nos. 2000-2099)',
    rows: [
      ['2000', 'Wing Headquarters - Command Section', '726 ABW/CC', 1, '5 x Week', 2, 2, 310, 4860, 1045, null, { cat: 'admin', remarks: 'Wing CC/CV/CCC suites, conference room & lobby. Remainder of bldg is Level 2 (see below)' }],
      ['2080', 'Education Center & Base Library', '726 FSS', 1, '6 x Week (Mon-Sat)', 2, 4, 692, 9880, 3214, null, { remarks: 'Library open Saturdays 1000-1600' }],
      ['2000', 'Wing Headquarters - Staff Agencies', '726 ABW (JA/IG/PA/XP)', 2, '5 x Week', 2, 6, 1120, 13452, 3968, null, { cat: 'admin', remarks: 'Same facility as Level 1 line above' }],
      ['2004', 'Military Personnel Flight', '726 FSS', 2, '5 x Week', 1, 4, 486, 5214, 2170, null, { cat: 'admin' }],
      ['2010', 'Comptroller / Finance', '726 CPTS', 2, '5 x Week', 1, 2, 260, 3955, 615, null, { cat: 'admin' }],
      ['2016', 'Mission Support Group HQ', '726 MSG', 2, '5 x Week', 2, 4, 532, 6744, 1902, null, { cat: 'admin' }],
      ['2022', 'Civil Engineer Squadron Admin', '726 CES', 2, '5 x Week', 2, 4, 590, 7215, 2488, null, { cat: 'admin' }],
      ['2024', 'CE Operations Flight Shops (Admin & Break Areas)', '726 CES', 2, '3 x Week', 1, 3, 418, 640, 3312, 2960, { rev: 'A1', remarks: 'Other SF re-measured, Amd 0001', was: { o: 2580, t: 6950 } }],
      ['2030', 'Base Supply Warehouse', '726 LRS', 2, '2 x Week', 1, 3, 380, 1260, 1945, 14600, { cat: 'warehouse', remarks: 'Other SF = warehouse floor, dust mop only' }],
      ['2034', 'Vehicle Maintenance', '726 LRS', 2, '3 x Week', 1, 3, 410, 0, 2035, 6480, { cat: 'maintenance', remarks: 'Service bays: sweep only' }],
      ['2040', 'Communications Squadron', '726 CS', 2, '5 x Week', 2, 4, 504, 8120, 2615, null, { cat: 'admin' }],
      ['2042', 'Network Control Center', '726 CS', 2, '7 x Week', 1, 2, 180, 0, 3860, null, { show: { c: 'N/A' }, remarks: 'Raised access floor; no wet mopping' }],
      ['2048', 'Security Forces Squadron / BDOC', '726 SFS', 2, '7 x Week', 2, 6, 846, 4390, 6872, null, { remarks: 'BDOC manned 24/7; service between 0800-1600' }],
      ['2052', 'Visitor Control Center (Pass & ID)', '726 SFS', 2, '6 x Week (Mon-Sat)', 1, 2, 140, 0, 1315, null, {}],
      ['2060', 'Contracting Squadron', '726 CONS', 2, '5 x Week', 1, 2, 236, 4412, 508, null, { cat: 'admin' }],
      ['2066', 'AFOSI Detachment', 'AFOSI', 2, '1 x Week', 1, 2, 128, 1980, 344, null, { cat: 'admin', remarks: 'Escort required' }],
      ['2070', 'Bioenvironmental Engineering', '726 AMDS', 2, '1 x Week', 1, 1, 72, 860, 1206, null, {}],
      ['2076', 'Airman Leadership School', '726 FSS', 2, '5 x Week', 1, 4, 515, 0, 4930, null, { cat: 'education' }],
      ['2094', 'USSF Space Operations Admin Annex', 'USSF Det 2', 2, '5 x Week', 1, 2, 244, 3610, 720, null, { cat: 'admin', rev: 'A1', remarks: 'ADDED per Amendment 0001 (new occupancy)' }],
    ],
    reference: {
      title: 'FACILITIES LISTED FOR REFERENCE ONLY - NOT ON CONTRACT (not included in totals above)',
      rows: [
        ['2090', 'Space Operations Facility (SCIF)', 'USSF Det 2', 2, 'Not on contract', 2, 4, 610, 14240, 7580, null, { remarks: 'Controlled area - custodial performed by cleared unit personnel. Contractor services NOT required' }],
      ],
    },
    notes: [
      'NOTES:',
      '1. Square footages are estimated CLEANING AREAS, not gross building area (see Notes & Instructions tab, Note 1).',
      '2. Facility 2000 is listed twice: the Command Section at Level 1 and the Staff Agencies at Level 2. Each line is priced at its own level.',
      '3. Facility 2090 is shown for reference only. Do not include in pricing.',
    ],
  },
  {
    id: '3', tab: 'Zone 3 - Community Spt', title: 'ZONE 3 - COMMUNITY SUPPORT / QUALITY OF LIFE (Facility Nos. 3000-3099)',
    rows: [
      ['3002', 'Base Chapel', '726 ABW/HC', 1, '5 x Week', 1, 4, 508, 4822, 2610, null, { cat: 'community', remarks: 'Sanctuary set-up for Sunday services by Chapel staff' }],
      ['3006', 'Community Activity Center', '726 FSS', 1, '7 x Week', 1, 6, 1145, 6280, 7935, null, { cat: 'community' }],
      ['3010', 'Airman & Family Readiness Center', '726 FSS', 1, '5 x Week', 1, 2, 266, 3410, 1128, null, {}],
      ['3014', 'Bowling Center (Restrooms & Snack Bar Seating Only)', '726 FSS', 2, '7 x Week', 1, 2, 320, 0, 1860, null, { remarks: 'Lanes and approaches maintained by NAF staff' }],
      ['3018', 'Outdoor Recreation', '726 FSS', 2, '5 x Week', 1, 2, 154, 0, 1690, 2240, {}],
      ['3020', 'Arts & Crafts / Auto Skills Center', '726 FSS', 2, '3 x Week', 1, 2, 210, 0, 2415, 3630, { remarks: 'Auto bays: sweep only' }],
      ['3024', 'Housing Management Office', '726 CES', 2, '5 x Week', 1, 2, 164, 1872, 655, null, { cat: 'admin' }],
      ['3028', 'Dining Facility', '726 FSS', 2, '7 x Week', 1, 4, 590, 0, 6210, null, { cat: 'dining', remarks: 'Dining room, entry & restrooms only. Kitchen and serving line by food service contractor' }],
      ['3032', 'Youth Sports Complex Restrooms', '726 FSS', 2, '3 x Week (APR-OCT only)', 1, 2, 236, 0, 0, null, { show: { c: '-', h: '-' }, remarks: 'SEASONAL - restrooms winterized NOV-MAR' }],
      ['3040', 'Fitness Center', '726 FSS', 4, '7 x Week', 2, 8, 5240, 2815, 38960, null, { cat: 'fitness', remarks: 'Restroom SF includes locker/shower rooms. Hard floor includes wood courts' }],
      ['3044', 'Child Development Center', '726 FSS', 4, '5 x Week', 1, 10, 1180, 7915, 6640, null, { cat: 'child_care' }],
      ['3048', 'Youth Center / School Age Program', '726 FSS', 4, '6 x Week (Mon-Sat)', 1, 6, 965, 5410, 14230, null, { rev: 'A1', remarks: 'Svc Freq changed by Amd 0001 (Saturday programs)', wasFreq: '5 x Week' }],
    ],
    reference: {
      title: 'OPTIONAL FACILITY - OPTIONAL CLIN 0006 (not included in base totals above)',
      rows: [
        ['3052', 'Fitness Center Annex (New Construction)', '726 FSS', 4, 'Option - CLIN 0006', 1, 4, 880, 0, 8970, null, { remarks: 'Est. beneficial occupancy Jun 2028. Exercised only by unilateral modification' }],
      ],
    },
    notes: [
      'NOTES:',
      '1. Square footages are estimated CLEANING AREAS, not gross building area (see Notes & Instructions tab, Note 1).',
      '2. Level 4 (Special Requirements) facilities are cleaned to the Fitness Center / CDC / Youth Center standards in Appendix A.',
      '3. Facility 3032 is seasonal (APR-OCT). No service NOV-MAR.',
      '4. Facility 3052 is an optional line item (CLIN 0006) and is not part of the base workload.',
    ],
  },
  {
    id: 'GSU', tab: 'GSU - Cottonwood Annex', totalLabel: 'GSU TOTAL', title: 'GEOGRAPHICALLY SEPARATED UNIT - COTTONWOOD ANNEX (approx. 38 miles NW of main base)',
    decimals: true,
    rows: [
      ['101', 'Det 1 Operations / Admin', 'USSF Det 1', 2, '2 x Week', 1, 2, 186.25, 1411.62, 609.88, null, { cat: 'admin' }],
      ['104', 'Power Production Shop (Break Room & Latrine Only)', 'USSF Det 1', 2, '1 x Week', 1, 1, 91.5, 0, 344.17, null, {}],
    ],
    notes: [
      'NOTES:',
      '1. Areas taken from Det 1 CAD floor plans (Appendix C); shown to two decimals as measured.',
      '2. Gate access coordinated with Det 1 (24 hr notice). Travel time from main base is not included in the square footage.',
    ],
  },
];

// ---------- helpers ----------
const COLS = 15; // A..O
const pad = (r) => { const a = r.slice(); while (a.length < COLS) a.push(''); return a; };
const col = (i) => String.fromCharCode(65 + i);
const r2 = (x) => Math.round(x * 100) / 100;
const total = (r) => r2(r[7] + r[8] + r[9] + (r[10] ?? 0));
const fmt = (n) => n.toLocaleString('en-US');

function dataRow(zid, r, inScope = true) {
  const [no, desc, ua, lvl, freq, flrs, rrN, rr, c, h, o, opts] = r;
  const show = opts.show ?? {};
  return pad([
    zid, no, desc, ua, inScope ? LEVELS[lvl].short : 'N/A', freq, flrs, rrN,
    show.rr ?? rr, show.c ?? c, show.h ?? h, o == null ? '' : o, total(r),
    opts.rev ?? '', opts.remarks ?? '',
  ]);
}

const HDR1 = ['Zone', 'Facility\nNo.', 'Facility Description', 'User/Agency', 'Cleaning\nLevel', 'Svc Freq', 'No.\nFlrs', 'No.\nof RR', 'ESTIMATED SQUARE FOOTAGE (SF)', '', '', '', '', 'Rev', 'Remarks'];
const HDR2 = ['', '', '', '', '', '', '', '', 'Restroom\nSF', 'Carpet\nSF', 'Hard Floor SF\n(VCT/Ceramic/Wood)', 'Other SF\n(Sealed Conc.)', 'Total Cleaned\nSF per Facility', '', ''];
const TITLE = [
  'ATTACHMENT 2 - APPENDIX B - ESTIMATED SQUARE FOOTAGES AND CLEANING LEVEL',
  `CUSTODIAL SERVICES, ${INSTALLATION.toUpperCase()}, KANSAS - SOLICITATION ${SOLICITATION}`,
  'Revised 12 Feb 2027 - Amendment 0001 (changed lines marked "A1" in the Rev column)',
];

function sums(rows) {
  const s = { n: rows.length, rr: 0, c: 0, h: 0, o: 0, t: 0, year: 0 };
  for (const r of rows) { s.rr += r[7]; s.c += r[8]; s.h += r[9]; s.o += r[10] ?? 0; s.t += total(r); s.year += total(r) * ANNUAL_DAYS[r[4]]; }
  for (const k of ['rr', 'c', 'h', 'o', 't', 'year']) s[k] = r2(s[k]);
  return s;
}

const sheets = [];
const truthFacilities = [];
const zoneSums = [];
const levelRows = { 1: [], 2: [], 4: [] };

for (const z of Z) {
  const rows = []; const merges = [];
  const add = (r) => { rows.push(r); return rows.length; }; // returns 1-based row number
  for (const t of TITLE) add(pad([t]));
  add([]);
  add(pad([z.title]));
  add([]);
  for (const lvl of [1, 2, 4]) {
    const lr = z.rows.filter((r) => r[3] === lvl);
    if (!lr.length) continue;
    const b = add(pad([LEVELS[lvl].label]));
    merges.push(`A${b}:O${b}`);
    const h1 = add(HDR1.slice()); const h2 = add(HDR2.slice());
    for (let i = 0; i < 8; i++) merges.push(`${col(i)}${h1}:${col(i)}${h2}`);
    merges.push(`I${h1}:M${h1}`, `N${h1}:N${h2}`, `O${h1}:O${h2}`);
    for (const r of lr) {
      add(dataRow(z.id, r));
      levelRows[lvl].push(r);
      const [no, desc, , , freq, flrs, , , , , , opts] = r;
      const t = total(r);
      const f = { buildingNumber: no, name: desc, grossSqft: t, cleanableSqft: t };
      if (typeof flrs === 'number') f.floors = flrs;
      if (FREQ[freq]) f.serviceLevel = FREQ[freq];
      if (opts.cat) f.category = opts.cat;
      truthFacilities.push(f);
    }
    if (lvl === 2) for (const r of z.deleted ?? []) add(dataRow(z.id, r, false));
    const s = sums(lr);
    add(pad(['', s.n, `Level ${lvl} Total - # Facilities`, '', '', '', '', '', s.rr, s.c, s.h, s.o, s.t]));
    add([]);
  }
  const zs = sums(z.rows);
  zoneSums.push({ z, s: zs });
  add(pad(['', zs.n, `${z.totalLabel ?? `ZONE ${z.id} TOTAL`} - # Facilities`, '', '', '', '', '', zs.rr, zs.c, zs.h, zs.o, zs.t]));
  add([]);
  if (z.reference) {
    const rt = add(pad([z.reference.title]));
    merges.push(`A${rt}:O${rt}`);
    const h1 = add(HDR1.slice()); const h2 = add(HDR2.slice());
    for (let i = 0; i < 8; i++) merges.push(`${col(i)}${h1}:${col(i)}${h2}`);
    merges.push(`I${h1}:M${h1}`, `N${h1}:N${h2}`, `O${h1}:O${h2}`);
    for (const r of z.reference.rows) { const d = dataRow(z.id, r); d[4] = LEVELS[r[3]].short; add(d); }
    add([]);
  }
  for (const n of z.notes) add(pad([n]));
  const numFmt = Array(COLS).fill(null);
  for (let i = 8; i <= 12; i++) numFmt[i] = z.decimals ? '#,##0.00' : '#,##0';
  sheets.push({ name: z.tab, rows, merges, numFmt });
}

// ---------- Summary tab ----------
const all = Z.flatMap((z) => z.rows);
const grand = sums(all);
const distinct = new Set(all.map((r) => r[0])).size;
const sRows = [];
const sAdd = (r) => { sRows.push(r); return sRows.length; };
const SCOLS = 8;
const spad = (r) => { const a = r.slice(); while (a.length < SCOLS) a.push(''); return a; };
for (const t of TITLE) sAdd(spad([t]));
sAdd([]);
sAdd(spad(['SUMMARY OF ESTIMATED CLEANED SQUARE FOOTAGE BY ZONE']));
sAdd(spad(['Zone', 'Line Items', 'Restroom SF', 'Carpet SF', 'Hard Floor SF', 'Other SF', 'Total Cleaned SF', 'Tab']));
for (const { z, s } of zoneSums) sAdd(spad([z.title.split(' (')[0], s.n, s.rr, s.c, s.h, s.o, s.t, z.tab]));
sAdd(spad(['TOTAL - ALL ZONES', grand.n, grand.rr, grand.c, grand.h, grand.o, grand.t, '']));
sAdd([]);
sAdd(spad(['SUMMARY BY CLEANING LEVEL']));
sAdd(spad(['Cleaning Level', 'Line Items', 'Restroom SF', 'Carpet SF', 'Hard Floor SF', 'Other SF', 'Total Cleaned SF', 'Base Yr CLIN']));
for (const lvl of [1, 2, 4]) { const s = sums(levelRows[lvl]); sAdd(spad([LEVELS[lvl].label, s.n, s.rr, s.c, s.h, s.o, s.t, LEVELS[lvl].clin])); }
sAdd(spad(['TOTAL - ALL LEVELS', grand.n, grand.rr, grand.c, grand.h, grand.o, grand.t, '']));
sAdd([]);
sAdd(spad(['WORKLOAD (SF SERVICED)']));
sAdd(spad(['Zone', 'Line Items', 'Per Occurrence (SF)', 'Total Per Year (SF x Annual Svc Days)', '', '', '', '']));
for (const { z, s } of zoneSums) sAdd(spad([z.title.split(' (')[0], s.n, s.t, s.year]));
sAdd(spad(['TOTAL', grand.n, grand.t, grand.year]));
sAdd([]);
const delRow = Z[0].deleted[0];
const optRow = Z[2].reference.rows[0];
const refRow = Z[1].reference.rows[0];
sAdd(spad(['NOTES:']));
sAdd(spad([`1. Line Items is the number of Appendix B lines. Facility 2000 is listed under both Level 1 and Level 2 and is counted on each line (${grand.n} line items, ${distinct} facility numbers).`]));
sAdd(spad([`2. Totals exclude Facility ${delRow[0]} (deleted by Amendment 0001), Facility ${refRow[0]} (reference only, ${fmt(total(refRow))} SF) and Facility ${optRow[0]} (Optional CLIN 0006, ${fmt(total(optRow))} SF).`]));
sAdd(spad(['3. Annual service days for the workload line are defined on the Notes & Instructions tab (Note 6). Workload figures are for evaluation only.']));
sAdd(spad(['4. Unit prices for modifications are computed from these totals per PWS 4.20.3.']));
const sNum = Array(SCOLS).fill(null); for (const i of [2, 3, 4, 5, 6]) sNum[i] = '#,##0';
// ---------- Amendment 0001 change log values ----------
const r2024 = Z[1].rows.find((r) => r[0] === '2024');
const r2094 = Z[1].rows.find((r) => r[0] === '2094');
const r3048 = Z[2].rows.find((r) => r[0] === '3048');
const wasGrand = grand.t - total(r2094) + delRow[11].was.t - (total(r2024) - r2024[11].was.t);

// ---------- Notes & Instructions tab ----------
const N = [];
const nAdd = (r) => { N.push(r); return N.length; };
const NCOLS = 6;
const npad = (r) => { const a = r.slice(); while (a.length < NCOLS) a.push(''); return a; };
for (const t of TITLE) nAdd(npad([t]));
nAdd([]);
nAdd(npad(['NOTES AND INSTRUCTIONS']));
const notes = [
  '1. Square footages in this Appendix are Government ESTIMATES of the areas to be cleaned, taken from facility floor plans (Appendix C). They are cleaning areas, not gross building areas. Mechanical, electrical and communications rooms, janitor closets, vaults, hangar bays, aircraft and vehicle service bays (except where shown in Other SF) and areas cleaned by occupants are not included.',
  '2. Total Cleaned SF per Facility = Restroom SF + Carpet SF + Hard Floor SF + Other SF. Restroom SF includes locker and shower rooms where present.',
  '3. Cleaning Level is per Appendix A, Air Force Custodial Standards: Level 1 - Prestige; Level 2 - Basic; Level 4 - Special Requirements (Fitness Center, Child Development Center, Youth Center / School Age Program). Level 3 (Academic Facilities) is not used on this contract.',
  '4. Svc Freq is the number of days per week the facility receives routine service. 5 x Week = Monday through Friday, excluding Federal holidays. 6 x Week (Mon-Sat) = Monday through Saturday. 7 x Week = every day including weekends and holidays. 3 x Week = Mon/Wed/Fri. 2 x Week = Tue/Thu. 1 x Week = same day each week. 1x every two weeks = alternate weeks. Tasks with lesser frequencies in Appendix A are performed on scheduled service days.',
  '5. No. of RR is the number of restroom/latrine rooms (for soap and paper product replenishment). It is not a fixture count.',
  '6. Annual service days used for the Summary workload line: 5 x Week = 260; 6 x Week = 312; 7 x Week = 365; 3 x Week = 156; 2 x Week = 104; 1 x Week = 52; 1x every two weeks = 26; 3 x Week (APR-OCT only) = 90. Holidays are not deducted.',
  '7. A facility with areas at more than one Cleaning Level is listed once per level (e.g., Facility 2000). Facility numbers with a letter suffix (1158A, 1158B) are separate facilities.',
  '8. Rows listed below a zone total (reference-only or optional facilities) are NOT part of the base workload and are not included in any total.',
  '9. Modification unit pricing (PWS 4.20.3): the annual price of each Level CLIN is divided by the total SF of that category in this Appendix (Restroom SF for restroom $/SF; Carpet SF + Hard Floor SF + Other SF for basic and periodic cleaning $/SF).',
  '10. Facility managers and building custodian POCs will be provided at the post-award conference.',
];
for (const n of notes) nAdd(npad([n]));
nAdd([]);
nAdd(npad(['AMENDMENT 0001 - SUMMARY OF CHANGES TO APPENDIX B (12 Feb 2027)']));
nAdd(npad(['Item', 'Tab', 'Facility No.', 'Change', 'Was', 'Is']));
nAdd(npad([1, Z[0].tab, delRow[0], 'Facility deleted - vacated 15 Jan 2027, programmed for demolition', `${fmt(delRow[11].was.t)} SF, Level 2, 5 x Week`, 'Deleted']));
nAdd(npad([2, Z[1].tab, r2024[0], 'Other SF re-measured; Total Cleaned SF corrected', `${fmt(r2024[11].was.o)} / ${fmt(r2024[11].was.t)}`, `${fmt(r2024[10])} / ${fmt(total(r2024))}`]));
nAdd(npad([3, Z[1].tab, r2094[0], 'Facility added - new USSF occupancy, Level 2, 5 x Week', '-', `${fmt(total(r2094))} SF`]));
nAdd(npad([4, Z[2].tab, r3048[0], 'Svc Freq changed for Saturday youth programs', r3048[11].wasFreq, r3048[4]]));
nAdd(npad([5, 'Summary', '-', 'Totals revised (all zones)', `${fmt(wasGrand)} SF`, `${fmt(grand.t)} SF`]));
nAdd([]);
nAdd(npad(['TAB INDEX']));
nAdd(npad(['Tab', 'Content']));
nAdd(npad(['Notes & Instructions', 'This tab']));
nAdd(npad(['Summary', 'Totals by zone and by cleaning level (duplicates the zone tabs)']));
for (const z of Z) nAdd(npad([z.tab, z.title]));
sheets.unshift({ name: 'Summary', rows: sRows, numFmt: sNum });
sheets.unshift({ name: 'Notes & Instructions', rows: N });

fs.writeFileSync(path.join(here, 'appendix-b.json'), JSON.stringify({ sheets }, null, 1) + '\n');

// ---------- truth.json ----------
const truthPath = path.join(here, 'truth.json');
const S3 = 'https://imlive.s3.amazonaws.com/Federal%20Government';
const provenance = {
  fidelity: 'real-format',
  sources: [
    {
      url: `${S3}/ID297162707687379821580624672536441025401/Attachment%201%20-%20Custodial%20PWS.pdf`,
      note: 'Dyess AFB Custodial Services PWS (13 Aug 2021), Appendix B "Estimated Square Footage and Cleaning Level". Fetched and read with pdftotext. Columns Facility No. / Description / User/Agency / Restroom SF / Carpet SF / Hard Floor SF / Total Cleaned SF per Facility; one block per cleaning level (Level 1 - Prestige, Level 2 - Basic, Level 4 - Special Requirement) with the header repeated; "Level N Total" rows that put the facility count in the Facility No. column ("81 Total # Facilities"); the same facility number on several lines (7008, 9203); letter-suffixed numbers (6030A/B/C, 7316A/B); partial areas ("3-Bay Hangar (Bay 1 Only)"); para 4.20.3 modification unit pricing from the Appendix B category totals (paraphrased in Notes tab Note 9). Format only; no rows copied.',
    },
    {
      url: `${S3}/ID239120740891441165113625913503342013529/Atch_02_Custodial_Services_-_PWS.pdf`,
      note: 'Sheppard AFB / Frederick Auxiliary Airfield Custodial Services PWS (revised 3 Aug 2018), Appendix B "Estimated Square Footage and Cleaning Category". Fetched and read. Floor-finish split columns (Carpet / Vinyl / Ceramic / Concrete / Hardwood / Other / Total Sq Ft) with blank cells for zero; SUBTotal / TOTAL rows with the count in the Bldg # column; the same building in two categories (402, 920); two buildings at a separate auxiliary airfield (model for the GSU tab); Appendix A frequency wording "1x a week", "1x every two weeks", "3x a week". Format only.',
    },
    {
      url: `${S3}/ID51452482767498558535584979091168261202/PWS_for_CDC_and_NASIC.pdf`,
      note: 'Wright-Patterson AFB Custodial PWS for the CDCs and NASIC (2 Apr 2018), Appendix B (July 2018). Fetched and read. Spreadsheet-export look: two-decimal square footage (510.82, 4,545.19), "N/A" cells, stacked headers ("Total Cleaned SF per Facility (Carpet & Hard Floor)"), Level 2 and Level 4 blocks, a note on a contractor-occupied building, and "Per Occurrence / Total Per Month / Total Per Year" workload rows under the facility rows (model for the Summary workload block and the GSU decimals). Format only.',
    },
    {
      url: `${S3}/ID100363056541034031518908095969877301366/DRAFT%20Appendix%20B%20-%20Facility%20Sq%20Meters%2001%20June%202021.pdf`,
      note: 'Aviano AB DRAFT Appendix B, Custodial Services (1 June 2021). Fetched and read. BUILDING NUMBER / AREA (zone code A1, C, D, E, F) / Floor / BUILDING DESCRIPTION / CARPET / NON-CARPET / RESTROOMS / TOTAL, Level 1 and Level 2 blocks with TOTALS rows, the same building on two lines (176), partial-building lines ("Hangar 3 - MAIN GF"), and a seasonal remark ("APR - OCT"). Model for the Zone column and the seasonal facility. Format only (the fixture uses SF, not m2).',
    },
    {
      url: `${S3}/ID57155383415613588625416825616511317979/APPENDIX_A,_Air_Force_Custodial_Standards.pdf`,
      note: 'Appendix A - Air Force Custodial Standards (stand-alone attachment). Fetched and read. Level 1 Prestige / Level 2 Basic / Level 3 Academics / Level 4 Special Requirements (Fitness Centers, CDC, Youth Center, SAP) and frequency wording ("1 x Week", "1 x every 2 Weeks", "2 x Week", "1 x Daily"). Model for Notes tab Note 3 and the Level 4 grouping.',
    },
    {
      url: 'https://aws.state.ak.us/OnlinePublicNotices/Notices/Attachment.aspx?id=140242',
      note: 'Performance Work Statement for Custodial Services at Eielson AFB (168th Wing, Alaska ANG), State of Alaska public notice attachment. Known only from a web-search summary (host unreachable from this environment): a per-facility table of facility number, activity, square footage and service frequency (e.g. 2x a week). Only support for a per-building days-per-week column (Svc Freq). No content copied.',
    },
    {
      url: 'https://samsearch.co/gov-explore/federal/joint-base-charleston-custodial-services/FA441826R0011',
      note: 'Joint Base Charleston Custodial Services, FA441826R0011 (2026): the package lists "Attachment 2 - Appendix B 14 April 2026 (XLS)" and re-issues it with the Rev 1 PWS by amendment. Known only from web-search summaries (the page and SAM.gov were not reachable from this environment); used only for the idea that Appendix B is issued as an Excel workbook named Attachment 2 and conformed by amendment. No content copied.',
    },
  ],
  notes: 'Every value is illustrative: the base (Tallgrass Air Force Base, Kansas, and its Cottonwood Annex GSU are fictional), the host wing number (726 ABW) and unit symbols, the solicitation number FA4693-27-R-0007, Amendment 0001 and its date, all facility numbers, names and square footages. The workbook layout and wording follow the real Air Force custodial Appendix B tables cited (Dyess 2021, Sheppard 2018, Wright-Patterson 2018, Aviano 2021) and the Air Force Custodial Standards appendix. Those real appendices are PDFs; the XLSX form (Notes, Summary and one tab per zone) is the fixture\'s assumption, supported only by search summaries showing Appendix B issued as an XLS attachment (JB Charleston 2026). No rows were copied, so fidelity is real-format. gen.mjs builds the workbook source and this file from one table.',
};
const traps = [
  'Multi-sheet workbook: "Notes & Instructions", "Summary", three zone tabs and a GSU tab. Facility rows are only on the zone and GSU tabs.',
  'The Summary tab repeats the totals twice (by zone and by cleaning level) and adds a workload block ("Per Occurrence" SF and "Total Per Year" = SF x annual service days, 103,276,102). None of these rows is a facility.',
  'Every data tab has a three-row title block and a zone banner. Each cleaning-level block repeats a two-row stacked header with a merged "ESTIMATED SQUARE FOOTAGE (SF)" group cell, merged single-column headers and line breaks inside header cells.',
  'Level subtotal and zone total rows put the facility COUNT in the Facility No. column ("13 | Level 2 Total - # Facilities"), as in the Dyess AFB Appendix B.',
  'Same facility number on two lines: Bldg 2000 Command Section (Level 1, 6,215 SF) and Staff Agencies (Level 2, 18,540 SF). Truth keeps both line items in document order.',
  'Letter-suffixed facility numbers 1158A / 1158B are separate facilities. They are text cells among numeric facility numbers.',
  'Square footage is cleaning area, not gross area. Several rows are partial areas ("Admin & Shop Areas Only", "Break Room & Latrine Only", "Restrooms & Snack Bar Seating Only", dining room only). Truth sets grossSqft = cleanableSqft = Total Cleaned SF and leaves category off the partial-area rows, except the Dining Facility (3028), whose cleaned dining room, entry and restrooms are still dining space (category dining).',
  'Total Cleaned SF is the sum of four split columns (Restroom + Carpet + Hard Floor + Other). Taking one split, or adding Restroom SF to the total again, gives the wrong area.',
  'Distractor numbers sit beside the SF: No. of RR (restroom rooms, not fixtures), No. Flrs, User/Agency unit numbers (726 OSS, 727 ARS), zone ids, CLIN numbers, PWS paragraph numbers and annual service days.',
  'Zero SF cells use four styles: blank, 0, "-" and "N/A".',
  'Amendment 0001 is already applied in the cells. The Notes tab change log still prints the superseded Was values: 1180 at 4,868 SF, 2024 at 2,580 / 6,950, 3048 at 5 x Week, and the old grand total of 385,006.42.',
  'A deleted row stays in place: 1180 sits inside the Zone 1 Level 2 block with level "N/A", Svc Freq "DELETED", zero SF and Rev "A1".',
  'Rows below a zone total are out of scope: 2090 SCIF ("reference only - not on contract", 22,430 SF) and 3052 Optional CLIN 0006 Fitness Center Annex (9,850 SF). Both carry SF in the cells and the full repeated header.',
  'Frequency wording: "5 x Week", "7 x Week", "6 x Week (Mon-Sat)", "3 x Week", "2 x Week", "1 x Week" and "1x every two weeks". 3032 is seasonal ("3 x Week (APR-OCT only)"), so it has no single service level and truth leaves serviceLevel off.',
  'Cleaning Level (1 Prestige / 2 Basic / 4 Special Req) is a task standard, not the visit frequency. The visit frequency is the Svc Freq column (a Level 2 building can be 7 x Week).',
  'Floors are printed as "1 + Mezz" on 1130, so truth leaves floors off. The 6-level control tower has only 1,096 cleaned SF.',
  'The GSU tab is a separate site with 3-digit facility numbers and #,##0.00 format with measured decimals (2,207.75 and 435.67 SF). The grand total 385,092.42 therefore displays as 385,092 on the #,##0 Summary.',
];
const truth = {
  id: 'af-custodial-workbook-xlsx',
  title: 'Air Force custodial PWS Attachment 2 / Appendix B workbook (XLSX): Notes, Summary and three zone tabs plus a GSU tab, Level 1/2/4 blocks with repeated stacked headers, Restroom / Carpet / Hard Floor / Other SF split, Amendment 0001 applied (row deleted, row added, SF re-measured, frequency changed), reference-only SCIF and optional-CLIN rows below the zone totals',
  theme: 'military-bos',
  provenance,
  inputs: [{ src: 'appendix-b.json', as: 'xlsx', out: OUT_XLSX }],
  expect: {
    facilities: truthFacilities,
    facilitiesComplete: true,
    grounds: [],
    site: { installationName: INSTALLATION, solicitation: SOLICITATION },
  },
  traps,
};
fs.writeFileSync(truthPath, JSON.stringify(truth, null, 2) + '\n');
console.log(`line items ${grand.n}, facilities in truth ${truthFacilities.length}, distinct numbers ${distinct}, total cleaned SF ${grand.t}, was ${wasGrand}, per-year ${grand.year}`);
for (const { z, s } of zoneSums) console.log(`  ${z.tab}: ${s.n} lines, ${s.t} SF`);
for (const lvl of [1, 2, 4]) { const s = sums(levelRows[lvl]); console.log(`  Level ${lvl}: ${s.n} lines, ${s.t} SF`); }
