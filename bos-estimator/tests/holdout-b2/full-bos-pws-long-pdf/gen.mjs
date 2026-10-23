#!/usr/bin/env node
// Generates the fixture source (att-0001-bos-pws.html) and the facility/grounds part of truth.json
// from one set of tables, so the TE 5 rows, subtotals, TE 3 summary, prose totals and truth stay consistent.
//   node tests/holdout-b2/full-bos-pws-long-pdf/gen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fmt = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US'));
const f1 = (n) => n.toFixed(1);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sum = (a, k) => a.reduce((t, r) => t + (typeof k === 'function' ? k(r) : r[k] || 0), 0);

// ---------------------------------------------------------------- TE 5 data
// line, fac, name, org, catcd, yr, flrs, gsf, rr, carpet, hard, freq, notes, cat (truth category or null)
const FREQ = { '7W': 'daily_7', '6W': 'daily_6', '5W': 'daily_5', '3W': '3x_week', '2W': '2x_week', W: 'weekly', M: 'monthly' };
const capI = [
  ['3101', 'Child Development Center I', 'CYS', '74028', 2009, 1, 28640, 1860, 9420, 13950, '5W', '3', 'child_care'],
  ['3104', 'Child Development Center II', 'CYS', '74028', 2016, 1, 32180, 2140, 10860, 15320, '5W', '3', 'child_care'],
  ['3108', 'School Age Center', 'CYS', '74029', 2004, 1, 18450, 1020, 4980, 9870, '5W', '', 'child_care'],
  ['3110', 'Youth Center', 'CYS', '74085', 1998, 1, 21760, 1310, 3240, 14050, '6W', '', null],
  ['3112', 'CYS Parent Central Services', 'CYS', '61050', 1987, 1, 4820, 210, 3060, 980, '5W', '', null],
];
const capII = [
  ['1520', 'Physical Fitness Center (Bergstrom)', 'DFMWR', '74046', 1992, 2, 46300, 4860, 1120, 31640, '7W', '3, 10', 'fitness'],
  ['1524', 'Physical Fitness Center (North)', 'DFMWR', '74046', 2012, 1, 38900, 3920, 760, 28450, '7W', '3, 10', 'fitness'],
  ['1530', 'Indoor Pool', 'DFMWR', '74054', 1979, 1, 24600, 3450, 0, 6980, '7W', '11', 'fitness'],
  ['1532', 'Outdoor Pool Bathhouse', 'DFMWR', '74055', 1968, 1, 2940, 1180, 0, 1240, '7W', '6', null],
  ['1540', 'Bowling Center', 'DFMWR', '74012', 1984, 1, 19800, 860, 4920, 3260, '7W', '7', null],
  ['1544', 'Outdoor Recreation Center', 'DFMWR', '74056', 1990, 1, 7460, 240, 610, 2880, '3W', '', null],
];
const capIII = [
  ['1001', 'Garrison Headquarters', 'GARRISON', '61050', 1941, 3, 52880, 2460, 26350, 9870, '5W', '3', 'admin'],
  ['1002', 'DPW Administration', 'DPW', '61050', 1958, 2, 18240, 740, 9880, 4120, '5W', '', 'admin'],
  ['1004', 'Military Personnel Division / DHR', 'DHR', '61050', 1962, 2, 21600, 880, 11240, 5690, '5W', '', 'admin'],
  ['1006', 'Installation Transportation Office', 'LRC', '61050', 1965, 1, 9350, 420, 3980, 3640, '5W', '', 'admin'],
  ['1010', 'Main Post Chapel', 'RSO', '73017', 1943, 1, 11420, 520, 5860, 2460, '2W', '', 'community'],
  ['1012', 'Religious Education Center', 'RSO', '73018', 1974, 2, 13280, 610, 6420, 3940, '2W', '', null],
  ['1020', 'Army Community Service', 'DFMWR', '74016', 1971, 1, 12640, 560, 7320, 2870, '5W', '', null],
  ['1022', 'Education Center', 'DHR', '74021', 1988, 2, 24180, 1040, 13460, 5210, '5W', '', 'education'],
  ['1024', 'Post Library', 'DFMWR', '74034', 1966, 1, 14960, 480, 9610, 1950, '6W', '', null],
  ['1026', 'Transition Assistance Center (SFL-TAP)', 'DHR', '61050', 1999, 1, 7840, 330, 4970, 1180, '5W', '', 'admin'],
  ['1030', 'Military Police Station', 'DES', '73024', 1976, 2, 16720, 760, 4980, 8630, '7W', '3', null],
  ['1032', 'Fire Station No. 1', 'DES', '73016', 1993, 1, 13860, 920, 1240, 3960, '7W', '8', null],
  ['1034', 'Visitor Control Center', 'DES', '73075', 2011, 1, 3180, 220, 0, 2340, '7W', '', null],
  ['1040', 'Logistics Readiness Center Headquarters', 'LRC', '61050', 1981, 2, 17960, 720, 9140, 3860, '5W', '', 'admin'],
  ['1044', 'Network Enterprise Center', 'NEC', '13115', 1997, 1, 12480, 410, 5880, 1960, '5W', '', null],
  ['1050', 'Fort Brannock Museum', 'GARRISON', '76010', 1939, 2, 9720, 280, 1640, 5480, '2W', '', null],
  ['1402', 'UPH Barracks', 'GARRISON (UH)', '72111', 1987, 3, 46800, 2380, 0, 6940, '5W', '5', 'barracks'],
  ['1403', 'UPH Barracks', 'GARRISON (UH)', '72111', 1987, 3, 46800, 2380, 0, 6940, '5W', '5', 'barracks'],
  ['1404', 'UPH Barracks', 'GARRISON (UH)', '72111', 2006, 4, 61240, 2960, 0, 8720, '5W', '5', 'barracks'],
  ['1405', 'Battalion Headquarters / Company Operations', 'TNG BN', '14185', 2006, 2, 28450, 1140, 10980, 9460, '5W', '', 'admin'],
  ['1407', 'UPH Barracks', 'VACANT', '72111', 1962, 3, 38200, null, null, null, '—', '4', null, 'vacant'],
  ['2104A', 'NCO Academy Classroom Building', 'NCOA', '17120', 1983, 2, 22940, 980, 8860, 9170, '5W', '', 'education'],
  ['2104B', 'NCO Academy Classroom Annex', 'NCOA', '17120', 1983, 1, 9860, 420, 3640, 4380, '5W', '', 'education'],
  ['2110', 'Simulation Training Center', 'DPTMS', '17136', 2014, 1, 26780, 760, 14120, 3980, '3W', '', null],
  ['2120', 'Range Control', 'DPTMS', '14190', 1995, 2, 8640, 380, 3120, 3410, '5W', '', null],
  ['2302', 'Tactical Equipment Maintenance Facility (TEMF)', 'TNG BN', '21410', 2009, 2, 64300, 1620, 1860, 4240, '5W', '8', 'maintenance'],
  ['2306', 'Vehicle Maintenance Shop (Motor Pool B)', 'LRC', '21410', 1978, 1, 21450, 640, 0, 2180, '3W', '8', 'maintenance'],
  ['2310', 'DPW Shops and Yard Office', 'DPW', '21910', 1964, 1, 33600, 560, 980, 2140, '3W', '8', 'maintenance'],
  ['2402', 'Central Issue Facility', 'LRC', '44220', 1985, 1, 42800, 620, 2460, 9880, '5W', '', 'warehouse'],
  ['2404', 'General Purpose Warehouse', 'LRC', '44220', 1956, 1, 56400, 380, 1240, 5980, 'W', '', 'warehouse'],
  ['2406', 'Self-Service Supply Center', 'LRC', '44222', 1972, 1, 6720, 160, 0, 4840, '2W', '', 'warehouse'],
  ['2408', 'Records Holding Area', 'GARRISON', '44224', 1958, 1, 8400, 0, 0, 1200, 'M', '', 'warehouse'],
  ['2602', 'Airfield Operations Building', 'AAF', '14112', 1990, 2, 15320, 640, 6180, 4520, '7W', '', null],
  ['2604', 'Aircraft Maintenance Hangar', 'AAF', '21110', 1990, 1, 48600, 760, 2240, 3960, '5W', '8', 'hangar'],
  ['2702', 'ASP Office and Break Facility', 'LRC', '42210', 1981, 1, 2860, 120, 0, 1840, 'W', '9', null],
  ['2812', 'Range 12 Control Tower and Classroom', 'DPTMS', '17140', 2005, 2, 1840, 160, 0, 1260, 'W', '', null],
  ['2818', 'Range 18 Ammunition Breakdown / Latrine Building', 'DPTMS', '17140', 2007, 1, 960, 240, 0, 420, 'W', '', null],
];
const partB = [
  ['1410', 'UPH Barracks (under construction)', 'GARRISON (UH)', '72111', '2028 est.', 4, 72600, 3260, 0, 10180, '5W', '5, 12'],
  ['3116', 'Child Development Center III (programmed)', 'CYS', '74028', '2029 est.', 1, 30400, 2040, 10120, 14560, '5W', '3, 12'],
];

const mk = (r, cap) => ({ fac: r[0], name: r[1], org: r[2], catcd: r[3], yr: r[4], flrs: r[5], gsf: r[6], rr: r[7], carpet: r[8], hard: r[9], freq: r[10], notes: r[11], cat: r[12], status: r[13] || 'in_scope', cap, csf: r[7] === null ? null : r[7] + r[8] + r[9] });
const groups = [
  { key: 'I', title: 'CAPABILITY I – ENHANCED SERVICE (CHILD, YOUTH AND SCHOOL SERVICES FACILITIES)', rows: capI.map((r) => mk(r, 'I')) },
  { key: 'II', title: 'CAPABILITY II – STANDARD SERVICE (PHYSICAL FITNESS AND RECREATION FACILITIES)', rows: capII.map((r) => mk(r, 'II')) },
  { key: 'III', title: 'CAPABILITY III – BASIC SERVICE (ADMINISTRATIVE, TRAINING, MAINTENANCE, WAREHOUSE AND OTHER FACILITIES)', rows: capIII.map((r) => mk(r, 'III')) },
];
let line = 0;
for (const g of groups) for (const r of g.rows) r.line = ++line;
const optRows = partB.map((r, i) => ({ ...mk(r, 'opt'), line: `B-${i + 1}` }));
const all = groups.flatMap((g) => g.rows);
const served = all.filter((r) => r.status === 'in_scope');
const tot = (rows) => ({ n: rows.length, gsf: sum(rows, 'gsf'), rr: sum(rows, 'rr'), carpet: sum(rows, 'carpet'), hard: sum(rows, 'hard'), csf: sum(rows, 'csf') });
const gt = groups.map((g) => tot(g.rows.filter((r) => r.status === 'in_scope')));
const T = tot(served);
const TB = tot(optRows);
const carpetIII = sum(groups[2].rows.filter((r) => r.status === 'in_scope'), 'carpet');

// ---------------------------------------------------------------- TE 6 grounds
const g61 = [
  ['G-01', 'Cantonment core – Garrison HQ, chapel, community and administrative facilities (Bldgs 1001–1050)', 'Improved', 21.6, 24, '5.3.2'],
  ['G-02', 'Barracks and battalion area (Bldgs 1402–1410)', 'Improved', 17.3, 24, '5.3.2'],
  ['G-03', 'Child, Youth and School Services campus (Bldgs 3101–3116)', 'Improved', 8.9, 24, '5.3.2'],
  ['G-04', 'Fitness and recreation complex (Bldgs 1520–1544), excluding athletic fields', 'Improved', 12.4, 24, '5.3.2'],
  ['G-05', 'Main Gate and North Gate, Brannock Boulevard medians, road rights-of-way to 30 ft', 'Improved', 19.8, 24, '5.3.2'],
  ['G-06', 'Post cemetery (hand trim at headstones)', 'Improved', 3.1, 24, '5.3.2'],
  ['G-07', 'Industrial area, motor pools and DPW yard (Bldgs 2302–2416)', 'Semi-Improved', 41.7, 8, '5.3.3'],
  ['G-08', 'Brannock AAF – airfield infield, clear zones and runway shoulders (BASH height, Note 3)', 'Semi-Improved', 86.4, 6, '5.3.3'],
  ['G-09', 'Ammunition Supply Point – inside fence (Bldg 2702) (Note 4)', 'Semi-Improved', 18.2, 8, '5.3.3'],
  ['G-10', 'Range complex – Range Control, Ranges 12 and 18, range road shoulders', 'Semi-Improved', 27.6, 4, '5.3.3'],
  ['G-11', 'Firebreaks and perimeter fence lines', 'Unimproved', 264.0, 1, '5.3.4'],
  ['G-12', 'Stormwater ponds, drainage channels and retention basins', 'Unimproved', 38.5, 2, '5.3.4'],
];
const g61x = ['G-13', 'Family housing areas (Residential Communities Initiative) – NOT IN CONTRACT (Note 5)', 'Improved', 146.0];
const byType = (t) => +sum(g61.filter((r) => r[2] === t), (r) => r[3]).toFixed(1);
const IMP = byType('Improved'), SEMI = byType('Semi-Improved'), UNIMP = byType('Unimproved');
const GT61 = +(IMP + SEMI + UNIMP).toFixed(1);
const g62 = [
  ['F-1', 'Softball Field 1 (east of Bldg 1524)', 2.3],
  ['F-2', 'Softball Field 2 (east of Bldg 1524)', 2.3],
  ['F-3', 'Brannock Stadium – football / soccer (natural turf)', 2.9],
  ['F-4', 'Multi-purpose / PT field (south of Bldg 1405)', 4.1],
];
const ATH = +sum(g62, (r) => r[2]).toFixed(1);
const BEDS = 58400, PARK = 131800, WALK = 196300, EDGE = 54600;

// ---------------------------------------------------------------- TE 7 refuse
const t71 = [
  ['Garrison Headquarters', '1001', 'MSW', 6, 2, 2],
  ['Garrison Headquarters', '1001', 'OCC', 6, 1, 1],
  ['DPW / DHR / ITO administrative cluster', '1002, 1004, 1006', 'MSW', 6, 2, 2],
  ['Chapel / Religious Education Center', '1010, 1012', 'MSW', 4, 1, 1],
  ['ACS / Education Center / Library', '1020, 1022, 1024', 'MSW', 6, 2, 2],
  ['MP Station / Fire Station / VCC', '1030, 1032, 1034', 'MSW', 4, 2, 2],
  ['Army Health Clinic (MEDCOM) (Note 2)', '1100', 'MSW', 6, 2, 3],
  ['Dining Facility (Warrior Restaurant)', '1310', 'MSW', 8, 2, 6],
  ['Dining Facility (Warrior Restaurant)', '1310', 'OCC', 8, 1, 2],
  ['UPH Barracks', '1402, 1403, 1404', 'MSW', 8, 4, 3],
  ['UPH Barracks', '1402, 1403, 1404', 'CMR', 6, 2, 1],
  ['Battalion HQ / NCO Academy', '1405, 2104A, 2104B', 'MSW', 6, 2, 2],
  ['Fitness Centers / Indoor Pool', '1520, 1524, 1530', 'MSW', 6, 2, 2],
  ['Bowling Center / Brannock Club (NAF)', '1540, 1550', 'MSW', 8, 2, 3],
  ['Commissary (DeCA)', '1600', 'MSW', 8, 2, 3],
  ['Commissary (DeCA)', '1600', 'OCC', 8, 2, 2],
  ['TEMF / Motor Pool B', '2302, 2306', 'MSW', 8, 3, 2],
  ['DPW Shops / CIF / Warehouse', '2310, 2402, 2404', 'MSW', 8, 2, 1],
  ['Brannock AAF', '2602, 2604', 'MSW', 6, 2, 2],
  ['CYS campus', '3101–3112', 'MSW', 6, 3, 3],
  ['Range complex (Note 3)', '2120, 2812, 2818', 'MSW', 4, 2, 1],
];
const CONT = sum(t71, (r) => r[4]);
const LIFTS = sum(t71, (r) => r[4] * r[5]);
const t72 = [
  ['DPW yard – construction and demolition debris', '2310', 30, 1, 26],
  ['TEMF – scrap metal (non-hazardous)', '2302', 30, 1, 12],
  ['Range complex – range cleanup debris', '2120', 20, 1, 8],
  ['Self-Service Supply Center – bulky items', '2406', 40, 1, 18],
];
const PULLS = sum(t72, (r) => r[4]);
const t73 = [['Municipal solid waste (MSW)', 1146], ['Old corrugated cardboard (OCC)', 168], ['Commingled recyclables (CMR)', 120], ['Construction and demolition (C&D) debris', 410]];
const TONS = sum(t73, (r) => r[1]);

// ---------------------------------------------------------------- truth
const truthFacilities = served.map((r) => {
  const o = { buildingNumber: r.fac, name: r.name, grossSqft: r.gsf, cleanableSqft: r.csf, floors: r.flrs, serviceLevel: FREQ[r.freq] };
  if (r.cat) o.category = r.cat;
  return o;
});
const truthGrounds = [
  ...g61.map((r) => ({ kind: { Improved: 'improved_turf', 'Semi-Improved': 'semi_improved', Unimproved: 'unimproved' }[r[2]], quantity: r[3], unit: 'acres', name: `${r[0]} ${r[1]}` })),
  ...g62.map((r) => ({ kind: 'athletic_field', quantity: r[2], unit: 'acres', name: `${r[0]} ${r[1]}` })),
  { kind: 'shrub_bed', quantity: BEDS, unit: 'sqft', name: 'Shrub and planting beds (mulched)' },
  { kind: 'parking', quantity: PARK, unit: 'sqyd', name: 'Parking lots – policing and sweeping' },
  { kind: 'sidewalk', quantity: WALK, unit: 'sqft', name: 'Sidewalks, walkways and building entrances' },
];

// ---------------------------------------------------------------- HTML helpers
const HDR_L = 'PWS – Base Operations Support (BOS) Services, USAG Fort Brannock, WI &nbsp;|&nbsp; W9131B-27-R-0006, Section J, Attachment 0001';
const sec = (label, body, cls = '') => `
<div class="sec ${cls}"><table class="frame"><thead><tr><td><div class="rh"><span>${HDR_L}</span><span class="rr">${label}</span></div></td></tr></thead>
<tbody><tr><td>
${body}
</td></tr></tbody></table></div>`;
const P = (num, title, text) => `<p>${num ? `<b>${num}${title ? ` ${title}` : ''}</b> ` : ''}${text}</p>`;

// ---------------------------------------------------------------- TE 5 table
const te5Head = `<thead>
<tr><th rowspan="2" style="width:3%">LINE</th><th rowspan="2" style="width:4.6%">FAC NO</th><th rowspan="2" style="width:25.4%">FACILITY DESCRIPTION</th><th rowspan="2" style="width:9.4%">USING ORG</th><th rowspan="2" style="width:4.6%">CATCD</th><th rowspan="2" style="width:4.8%">YR BLT</th><th rowspan="2" style="width:3.4%">FLRS</th><th rowspan="2" style="width:6.2%">GSF<sup>1</sup></th><th colspan="4" class="g">CLEANABLE SQUARE FEET (CSF)<sup>2</sup></th><th rowspan="2" style="width:4%">FREQ</th><th rowspan="2" style="width:4.4%">NOTES</th></tr>
<tr><th style="width:5.4%">RESTROOM SF</th><th style="width:5.6%">CARPET SF</th><th style="width:5.8%">HARD FLOOR SF</th><th style="width:6%">TOTAL CSF</th></tr>
<tr class="colno"><td>(1)</td><td>(2)</td><td>(3)</td><td>(4)</td><td>(5)</td><td>(6)</td><td>(7)</td><td>(8)</td><td>(9)</td><td>(10)</td><td>(11)</td><td>(12)</td><td>(13)</td><td>(14)</td></tr>
</thead>`;
const te5Row = (r) => r.status === 'vacant'
  ? `<tr><td class="c">${r.line}</td><td class="c">${r.fac}</td><td>${esc(r.name)} – VACANT, NO SERVICE</td><td>${r.org}</td><td class="c">${r.catcd}</td><td class="c">${r.yr}</td><td class="c">${r.flrs}</td><td class="num">${fmt(r.gsf)}</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="c">—</td><td class="c">${r.notes}</td></tr>`
  : `<tr><td class="c">${r.line}</td><td class="c">${r.fac}</td><td>${esc(r.name)}</td><td>${r.org}</td><td class="c">${r.catcd}</td><td class="c">${r.yr}</td><td class="c">${r.flrs}</td><td class="num">${fmt(r.gsf)}</td><td class="num">${fmt(r.rr)}</td><td class="num">${fmt(r.carpet)}</td><td class="num">${fmt(r.hard)}</td><td class="num">${fmt(r.csf)}</td><td class="c">${r.freq}</td><td class="c">${r.notes}</td></tr>`;
const subRow = (label, t) => `<tr class="sub"><td></td><td colspan="6">${label} &nbsp;(${t.n} Facilities)</td><td class="num">${fmt(t.gsf)}</td><td class="num">${fmt(t.rr)}</td><td class="num">${fmt(t.carpet)}</td><td class="num">${fmt(t.hard)}</td><td class="num">${fmt(t.csf)}</td><td></td><td></td></tr>`;
const te5Body = `<tbody>
<tr class="part"><td colspan="14">PART A – FACILITIES SERVICED (BASE REQUIREMENT, CLIN 0002 / x002)</td></tr>
${groups.map((g, i) => `<tr class="grp"><td colspan="14">${g.title}</td></tr>
${g.rows.map(te5Row).join('\n')}
${subRow(`Capability ${g.key} Total`, gt[i])}`).join('\n')}
<tr class="grand"><td></td><td colspan="6">TOTAL – PART A, ALL CAPABILITY LEVELS (excludes vacant Bldg 1407, Note 4)&nbsp; (${T.n} Facilities)</td><td class="num">${fmt(T.gsf)}</td><td class="num">${fmt(T.rr)}</td><td class="num">${fmt(T.carpet)}</td><td class="num">${fmt(T.hard)}</td><td class="num">${fmt(T.csf)}</td><td></td><td></td></tr>
<tr class="part"><td colspan="14">PART B – OPTIONAL FACILITIES (NOT IN BASE REQUIREMENT; OPTIONAL CLIN 0010 / x010, NOTE 12)</td></tr>
${optRows.map(te5Row).join('\n')}
${subRow('Total – Part B, Optional Facilities', TB)}
</tbody>`;
const te5Notes = `<div class="fn">
<p><b>NOTES:</b></p>
<p>1. GSF (column 8) is the gross area recorded for the facility in the Army real property inventory (RPLANS / GFEBS) as of 30 SEP 2026. GSF is provided for information only and is not the basis for payment.</p>
<p>2. CSF (column 12) is the area to be serviced and is the basis for pricing CLIN 0002 / x002 and for workload adjustments under PWS 1.14. Column 12 = column 9 + column 10 + column 11. Mechanical, electrical and communications rooms, kitchens and food-preparation areas, vaults, attics, crawl spaces, and the areas excluded by Notes 5, 7, 8 and 11 are not included in CSF.</p>
<p>3. Restrooms (and locker rooms in Bldgs 1520 and 1524) are serviced 2X daily on each service day (TE 4).</p>
<p>4. Bldg 1407 was vacated 30 SEP 2026 and is programmed for demolition (FY28). It is listed for real property reference only. No custodial service is required; it is not included in any total in this exhibit.</p>
<p>5. UPH barracks: common areas only (entry lobbies, dayrooms, laundry rooms, corridors, stairwells and common latrines). Soldier living modules are excluded.</p>
<p>6. Seasonal operation, Memorial Day weekend through Labor Day (approximately 15 weeks), plus one opening clean and one closing clean. No service outside the season.</p>
<p>7. Bowling lanes, approaches, pinsetter area and the snack bar kitchen are maintained by the NAF activity and are not included in CSF.</p>
<p>8. Maintenance, shop, fire station and hangar facilities: offices, break rooms, latrines, locker / shower rooms, dayrooms and classrooms only. Work bays, apparatus bays, shop floors and hangar floors are excluded.</p>
<p>9. Escort required. Access shall be scheduled with the ASP supervisor not less than 24 hours in advance.</p>
<p>10. Hard floor SF includes the wood gymnasium floors (Bldg 1520: 14,200 SF; Bldg 1524: 11,600 SF). See PWS 5.1.9.</p>
<p>11. The pool basin and natatorium deck are maintained by NAF aquatics staff; CSF is lobby, offices, locker rooms and showers.</p>
<p>12. Part B facilities are not part of the base requirement and shall not be serviced until the Contracting Officer exercises Optional CLIN 0010 (x010 in option periods) by written modification after beneficial occupancy (PWS 5.1.12). GSF and CSF for Part B are design estimates.</p>
<p>Frequency codes (column 13) are defined in PWS 2.1.9: 7W, 6W, 5W, 3W, 2W, W and M.</p>
</div>`;

// ---------------------------------------------------------------- document
const css = `
  @page { size: Letter portrait; }
  @page land { size: Letter landscape; }
  .land { page: land; }
  body { font-family: "Times New Roman", Times, serif; font-size: 10.8pt; color: #000; margin: 0; }
  p { margin: 0 0 5.5pt; line-height: 1.2; text-align: justify; }
  .sec { break-before: page; }
  .sec.first { break-before: auto; }
  table.frame { width: 100%; border-collapse: collapse; }
  table.frame > thead > tr > td, table.frame > tbody > tr > td { padding: 0; vertical-align: top; }
  .rh { font-family: Arial, Helvetica, sans-serif; font-size: 7.6pt; border-bottom: 0.75pt solid #000; padding-bottom: 2pt; margin-bottom: 8pt; display: flex; justify-content: space-between; gap: 10pt; }
  .rh .rr { font-weight: bold; white-space: nowrap; }
  h1 { font-size: 13pt; text-align: center; margin: 2pt 0 8pt; text-transform: uppercase; }
  h2 { font-size: 11.5pt; margin: 9pt 0 5pt; text-transform: uppercase; }
  h3 { font-size: 11pt; margin: 7pt 0 3pt; }
  .cover { text-align: center; padding-top: 30pt; }
  .cover .att { font-family: Arial, sans-serif; font-size: 10pt; font-weight: bold; letter-spacing: 1.5pt; }
  .cover .t1 { font-size: 22pt; font-weight: bold; margin: 26pt 0 6pt; }
  .cover .t2 { font-size: 17pt; font-weight: bold; margin: 6pt 0 4pt; }
  .cover .t3 { font-size: 13.5pt; font-weight: bold; margin: 18pt 0 2pt; }
  .cover .t4 { font-size: 11.5pt; margin: 2pt 0; }
  .box { border: 0.75pt solid #000; padding: 6pt 9pt; margin: 18pt auto 0; width: 82%; text-align: left; font-family: Arial, sans-serif; font-size: 8.8pt; }
  .box p { text-align: left; margin-bottom: 3pt; }
  .dist { font-family: Arial, sans-serif; font-size: 8pt; margin-top: 30pt; text-align: left; border-top: 0.75pt solid #000; padding-top: 4pt; }
  .toc p { margin: 0 0 2.2pt; text-align: left; font-size: 10.5pt; }
  .toc .i1 { padding-left: 18pt; } .toc .i2 { padding-left: 36pt; font-size: 10pt; }
  table.t { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; line-height: 1.16; margin: 4pt 0 8pt; }
  table.t th { border: 0.75pt solid #000; background: #d9d9d9; padding: 2pt 3pt; vertical-align: bottom; font-size: 7.6pt; text-align: center; }
  table.t td { border: 0.5pt solid #000; padding: 1.8pt 3pt; vertical-align: top; }
  table.t tr { break-inside: avoid; }
  table.t tr.sub td { background: #ececec; font-weight: bold; }
  table.t tr.grand td { background: #d0d0d0; font-weight: bold; border-top: 1.5pt double #000; }
  table.t tr.grp td { background: #404040; color: #fff; font-weight: bold; }
  table.t tr.x td { color: #333; font-style: italic; }
  table.ex { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 7.4pt; line-height: 1.13; table-layout: fixed; }
  table.ex th { border: 0.75pt solid #000; background: #d9d9d9; padding: 1.5pt 2pt; vertical-align: bottom; font-size: 6.9pt; }
  table.ex th.g { background: #bfbfbf; vertical-align: middle; }
  table.ex td { border: 0.5pt solid #000; padding: 1.3pt 2.5pt; vertical-align: top; overflow-wrap: break-word; }
  table.ex tr { break-inside: avoid; }
  table.ex tr.colno td { text-align: center; font-size: 6pt; padding: 0.4pt; background: #f2f2f2; }
  table.ex tr.part td { background: #000; color: #fff; font-weight: bold; padding: 2pt 4pt; letter-spacing: 0.3pt; }
  table.ex tr.grp td { background: #595959; color: #fff; font-weight: bold; padding: 1.5pt 4pt; }
  table.ex tr.sub td { background: #ececec; font-weight: bold; }
  table.ex tr.grand td { background: #d0d0d0; font-weight: bold; border-top: 1.5pt double #000; }
  td.c { text-align: center; } td.num { text-align: right; white-space: nowrap; } th.l, td.l { text-align: left; }
  sup { font-size: 5.6pt; vertical-align: super; line-height: 0; }
  p.tcap { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; font-weight: bold; text-align: center; margin: 2pt 0 1pt; }
  p.tsub { font-family: Arial, Helvetica, sans-serif; font-size: 7.6pt; text-align: center; margin: 0 0 4pt; }
  p.tt { font-family: Arial, Helvetica, sans-serif; font-size: 8.4pt; font-weight: bold; margin: 7pt 0 1pt; text-align: left; }
  div.fn { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; line-height: 1.17; margin-top: 4pt; }
  .land div.fn { font-size: 6.6pt; line-height: 1.12; margin-top: 3pt; }
  .land div.fn p { margin-bottom: 0.8pt; }
  .blk { break-inside: avoid; }
  table.t.sm { font-size: 7.6pt; line-height: 1.12; margin-bottom: 5pt; }
  table.t.sm td { padding: 1.4pt 3pt; }
  div.fn p { margin: 0 0 1.6pt; text-align: left; }
  ul.b { margin: 0 0 5pt 22pt; padding: 0; } ul.b li { margin-bottom: 2pt; line-height: 1.18; }
  .ind { padding-left: 18pt; }
`;

const cover = `
<div class="cover">
  <div class="att">SECTION J – ATTACHMENT 0001</div>
  <div class="t1">PERFORMANCE WORK STATEMENT (PWS)</div>
  <div class="t2">BASE OPERATIONS SUPPORT (BOS) SERVICES</div>
  <div class="t3">U.S. ARMY GARRISON FORT BRANNOCK, WISCONSIN</div>
  <div class="t4">Directorate of Public Works (DPW)</div>
  <div class="t4" style="margin-top:14pt">Solicitation No. W9131B-27-R-0006</div>
  <div class="t4">Version 1.0 &nbsp;–&nbsp; 16 November 2026</div>
  <div class="box">
    <p><b>Common Levels of Support (CLS) in this PWS:</b> 402 Custodial Services; 403 Refuse Removal and Recycling; 404 Maintenance – Grounds; 408 Snow, Ice and Sand Removal; 420 Facility Maintenance (Demand Maintenance Orders); 510 Pest Management.</p>
    <p><b>Technical Exhibits:</b> TE 1 through TE 10 are bound at the end of this attachment. TE 11 (Installation Maps) is provided electronically in the solicitation technical library.</p>
    <p><b>Prepared by:</b> Directorate of Public Works, Business Operations and Integration Division, Fort Brannock, WI 54409. <b>Contracting activity:</b> Mission and Installation Contracting Command (MICC) – Fort Brannock.</p>
  </div>
  <div class="dist">DISTRIBUTION STATEMENT A. Approved for public release; distribution is unlimited. This PWS is part of the solicitation package and is subject to change by solicitation amendment.</div>
</div>`;

const toc = `
<h1>Table of Contents</h1>
<div class="toc">
<p><b>PART 1 – GENERAL INFORMATION</b></p>
<p class="i1">1.1 General &nbsp;·&nbsp; 1.2 Background &nbsp;·&nbsp; 1.3 Scope – Common Levels of Support &nbsp;·&nbsp; 1.4 Period of Performance</p>
<p class="i1">1.5 Place of Performance and Hours of Operation &nbsp;·&nbsp; 1.6 Recognized Holidays &nbsp;·&nbsp; 1.7 Climatic Conditions</p>
<p class="i1">1.8 Quality Control &nbsp;·&nbsp; 1.9 Quality Assurance &nbsp;·&nbsp; 1.10 Key Personnel &nbsp;·&nbsp; 1.11 Security Requirements</p>
<p class="i1">1.12 Phase-In and Phase-Out &nbsp;·&nbsp; 1.13 Contractor Manpower Reporting &nbsp;·&nbsp; 1.14 Workload Changes &nbsp;·&nbsp; 1.15 Safety and Environmental</p>
<p class="i1">1.16 Mission-Essential Services &nbsp;·&nbsp; 1.17 Contractor Employee Conduct &nbsp;·&nbsp; 1.18 Organizational Conflict of Interest &nbsp;·&nbsp; 1.19 Service Contract Labor Standards &nbsp;·&nbsp; 1.20 Invoicing</p>
<p><b>PART 2 – DEFINITIONS AND ACRONYMS</b></p>
<p><b>PART 3 – GOVERNMENT-FURNISHED PROPERTY, FACILITIES AND SERVICES</b></p>
<p><b>PART 4 – CONTRACTOR-FURNISHED ITEMS AND SERVICES</b></p>
<p><b>PART 5 – SPECIFIC TASKS</b></p>
<p class="i1">5.1 CLS 402 – Custodial Services</p>
<p class="i1">5.2 CLS 403 – Refuse Removal and Recycling</p>
<p class="i1">5.3 CLS 404 – Maintenance – Grounds</p>
<p class="i1">5.4 CLS 408 – Snow, Ice and Sand Removal</p>
<p class="i1">5.5 CLS 510 – Pest Management</p>
<p class="i1">5.6 CLS 420 – Facility Maintenance (Demand Maintenance Orders)</p>
<p class="i1">5.7 Meetings and Recurring Reports</p>
<p><b>PART 6 – APPLICABLE PUBLICATIONS</b></p>
<p><b>PART 7 – ATTACHMENT / TECHNICAL EXHIBIT LISTING</b></p>
<p class="i1">TE 1 – Performance Requirements Summary</p>
<p class="i1">TE 2 – Deliverables Schedule</p>
<p class="i1">TE 3 – Estimated Workload Summary</p>
<p class="i1">TE 4 – Custodial Cleaning Standards and Frequencies</p>
<p class="i1">TE 5 – Custodial Facility List (Part A – Facilities Serviced; Part B – Optional Facilities)</p>
<p class="i1">TE 6 – Grounds Maintenance Areas</p>
<p class="i1">TE 7 – Refuse Collection Workload</p>
<p class="i1">TE 8 – Snow and Ice Removal Areas and Priorities</p>
<p class="i1">TE 9 – Pest Management Workload</p>
<p class="i1">TE 10 – Historical Workload Data</p>
<p class="i1">TE 11 – Installation Maps (electronic only; not bound)</p>
</div>
<p style="margin-top:14pt;font-size:9.5pt"><i>Note: Paragraph numbers in this PWS are referenced by the Performance Requirements Summary (TE 1), the Deliverables Schedule (TE 2) and Section B. Where a Technical Exhibit and the text of Parts 1–5 conflict, the text governs, except that the facilities, areas and quantities to be serviced are those stated in the Technical Exhibits.</i></p>`;

const part1 = `
<h1>Part 1 – General Information</h1>
${P('1.1', 'General.', 'This is a non-personal services contract to provide Base Operations Support (BOS) services for the U.S. Army Garrison (USAG) Fort Brannock, Wisconsin. The Government will not exercise any supervision or control over the contract service providers performing the services herein. Such contract service providers shall be accountable solely to the Contractor who, in turn, is responsible to the Government.')}
${P('1.1.1', 'Description of Services.', 'The Contractor shall provide all personnel, equipment, supplies, facilities, transportation, tools, materials, supervision, and other items and non-personal services necessary to perform the Common Levels of Support (CLS) functions listed in paragraph 1.3 as defined in this Performance Work Statement (PWS), except for those items specified as Government-furnished property and services in Part 3. The Contractor shall perform to the standards in this contract.')}
${P('1.1.2', 'Objectives.', 'The Government\'s objectives are clean, safe and sanitary facilities; well-kept grounds that present a professional military appearance; timely collection of refuse and recyclables; safe passage on installation roads, parking areas and walks during the winter season; protection of people, facilities and stored products from pests; and responsive minor maintenance of real property. The intent is to establish work requirements that are performance-based and results-oriented, allowing the Contractor to determine the most cost-effective way to meet the standards, emphasizing innovation and commercial best practices.')}
${P('1.2', 'Background.', 'Fort Brannock is located in Langlade County in north-central Wisconsin, approximately nine miles northwest of Antigo. The installation was established in 1939 as a National Guard summer training camp, was federalized in 1940, and today supports Active and Reserve Component training, the Regional NCO Academy and Brannock Army Airfield (AAF). The installation comprises approximately 14,860 acres. About 1,240 acres make up the cantonment area and the airfield; the remaining acreage consists of ranges and maneuver training areas managed by the Directorate of Plans, Training, Mobilization and Security (DPTMS). The real property inventory includes 418 buildings with approximately 3.1 million square feet of floor area. The daily population is approximately 4,300 military, civilian and contractor personnel, rising to as many as 6,500 during Reserve Component annual training from June through August.')}
${P('1.2.1', 'Facilities and Areas in Scope.', 'Not every installation facility is serviced under this contract. The facilities, areas and quantities to be serviced under each CLS are identified in the Technical Exhibits (TE) listed in Part 7. Family housing (privatized under the Residential Communities Initiative), the Army Health Clinic (Bldg 1100, U.S. Army Medical Command), the Commissary (Bldg 1600, Defense Commissary Agency), the Dining Facility (Bldg 1310, serviced under the installation food service contract) and the Brannock Club (Bldg 1550, Nonappropriated Fund) are not serviced under CLS 402 Custodial Services. Some of these facilities are included in the refuse, snow removal and pest management workload where they are listed in TE 7, TE 8 and TE 9.')}
${P('1.2.2', 'Current Contract.', 'These services are currently performed under a BOS contract that expires 30 June 2027. Historical contract and workload information is provided in TE 10 for information only. Historical workload is not a guarantee of future workload.')}
${P('1.3', 'Scope – Common Levels of Support.', 'The Contractor shall perform the CLS functions in Table 1-1 IAW the paragraphs and Technical Exhibits shown. Contract line item numbers (CLINs) are shown for the base period; option period CLINs are numbered 1001–1010, 2001–2010, 3001–3010 and 4001–4010.')}
<p class="tt">Table 1-1. Common Levels of Support and Contract Line Items</p>
<table class="t">
<tr><th>CLS</th><th class="l">Service Title</th><th>PWS Section</th><th>Technical Exhibit(s)</th><th>CLIN (Base Period)</th><th>Pricing Basis</th></tr>
<tr><td class="c">—</td><td>Phase-in</td><td class="c">1.12</td><td class="c">—</td><td class="c">0001</td><td>Firm-fixed price (FFP)</td></tr>
<tr><td class="c">402</td><td>Custodial Services</td><td class="c">5.1</td><td class="c">TE 4, TE 5 Part A</td><td class="c">0002</td><td>FFP, per CSF per month</td></tr>
<tr><td class="c">403</td><td>Refuse Removal and Recycling</td><td class="c">5.2</td><td class="c">TE 7</td><td class="c">0003</td><td>FFP</td></tr>
<tr><td class="c">404</td><td>Maintenance – Grounds</td><td class="c">5.3</td><td class="c">TE 6</td><td class="c">0004</td><td>FFP</td></tr>
<tr><td class="c">408</td><td>Snow, Ice and Sand Removal (first 14 snow events per season)</td><td class="c">5.4</td><td class="c">TE 8</td><td class="c">0005</td><td>FFP</td></tr>
<tr><td class="c">420</td><td>Facility Maintenance – Demand Maintenance Orders</td><td class="c">5.6</td><td class="c">TE 10</td><td class="c">0006</td><td>FFP (labor); cost-reimbursable material</td></tr>
<tr><td class="c">510</td><td>Pest Management</td><td class="c">5.5</td><td class="c">TE 9</td><td class="c">0007</td><td>FFP</td></tr>
<tr><td class="c">408</td><td>Additional snow events (above 14 per season)</td><td class="c">5.4.7</td><td class="c">TE 8</td><td class="c">0008</td><td>Fixed unit price per event</td></tr>
<tr><td class="c">402</td><td>Special and emergency cleaning</td><td class="c">5.1.10</td><td class="c">TE 10</td><td class="c">0009</td><td>Fixed unit price per request</td></tr>
<tr><td class="c">402</td><td>Optional facilities (TE 5 Part B) – OPTIONAL</td><td class="c">5.1.12</td><td class="c">TE 5 Part B</td><td class="c">0010</td><td>FFP, per CSF per month</td></tr>
</table>
${P('1.4', 'Period of Performance.', 'The period of performance consists of a 30-day phase-in period (1 June 2027 through 30 June 2027), a 12-month base period (1 July 2027 through 30 June 2028) and four 12-month option periods: Option Period 1, 1 July 2028 through 30 June 2029; Option Period 2, 1 July 2029 through 30 June 2030; Option Period 3, 1 July 2030 through 30 June 2031; and Option Period 4, 1 July 2031 through 30 June 2032. If all options are exercised, the total period of performance, excluding phase-in, is five (5) years.')}
${P('1.5', 'Place of Performance and Hours of Operation.', '')}
${P('1.5.1', 'Place of Performance.', 'Work shall be performed on the Fort Brannock main cantonment, Brannock AAF, the Range Complex (Range Control, Ranges 12 and 18) and the Ammunition Supply Point (ASP). Maps of these areas are provided in TE 11.')}
${P('1.5.2', 'Hours of Operation.', 'Normal installation duty hours are 0730 to 1630, Monday through Friday, excluding Federal holidays. The Contractor shall maintain an adequate workforce for the uninterrupted performance of all tasks defined within this PWS. Custodial services in occupied administrative facilities shall be performed between 1700 and 0600 unless otherwise approved by the Contracting Officer\'s Representative (COR). Child, Youth and School Services (CYS) facilities shall be cleaned after the facility closes (1830) and completed before 0500. Grounds maintenance shall be performed between 0700 and 1700 Monday through Friday, except that mowing adjacent to CYS facilities and barracks shall not begin before 0800. Snow and ice removal is performed 24 hours a day, 7 days a week during snow events (5.4).')}
${P('1.5.3', 'DPW Work Reception.', 'The Government operates the DPW Work Reception desk (Bldg 1002) from 0700 to 1630, Monday through Friday. After hours, emergency calls are routed to the Installation Operations Center. The Contractor shall provide a telephone number staffed 24 hours a day, 7 days a week for emergency Demand Maintenance Orders (DMOs), pest emergencies and snow call-outs.')}
${P('1.6', 'Recognized Holidays.', 'The Contractor is not required to perform services on the following Federal holidays, except in facilities assigned a 7W frequency in TE 5, for emergency DMOs, and for snow and ice removal: New Year\'s Day, Martin Luther King Jr.\'s Birthday, Washington\'s Birthday, Memorial Day, Juneteenth National Independence Day, Independence Day, Labor Day, Columbus Day, Veterans Day, Thanksgiving Day and Christmas Day. Holidays falling on a weekend are observed as directed by the Federal calendar (5 U.S.C. 6103). Services missed on a holiday shall be performed on the next service day unless the COR waives them.')}
${P('1.7', 'Climatic Conditions.', 'Fort Brannock has a humid continental climate with long, cold winters. Average annual precipitation is approximately 32 inches. The 30-year normal annual snowfall is 64 inches, with measurable snow expected from late October through April. The January mean temperature is 12 °F with recorded extremes of –35 °F; the July mean is 69 °F. Frost penetration commonly exceeds 48 inches. The average frost-free period is about 120 days, from mid-May to mid-September. For this contract the mowing season is 1 May through 15 October (24 weeks) and the snow season is 15 October through 30 April.')}
${P('1.8', 'Quality Control.', 'The Contractor shall develop and maintain an effective quality control program to ensure services are performed IAW this PWS. The Contractor shall develop and implement procedures to identify, prevent and ensure non-recurrence of defective services. The Contractor\'s Quality Control Plan (QCP) (CDRL A002) shall describe the inspection system for each CLS, including the frequency of inspections, the names and qualifications of inspectors, and the method of documenting and correcting deficiencies. A copy of each completed inspection report shall be provided to the COR by the 5th business day of the following month.')}
${P('1.9', 'Quality Assurance.', 'The Government will evaluate the Contractor\'s performance under this contract using the methods of surveillance in the Quality Assurance Surveillance Plan (QASP), including random sampling, periodic inspection, 100 percent inspection of selected outputs, and validated customer complaints. The Performance Requirements Summary (TE 1) states the performance objectives, the performance thresholds (Acceptable Quality Levels, AQLs) and the remedies the Government may apply.')}
${P('1.10', 'Key Personnel.', 'The following positions are key personnel: Project Manager; Alternate Project Manager; Custodial Manager; Grounds and Snow Removal Supervisor; and Pest Management Supervisor. The Project Manager or Alternate shall be available on the installation during normal duty hours and reachable by telephone within 30 minutes at all other times. The Pest Management Supervisor shall hold current Wisconsin Department of Agriculture, Trade and Consumer Protection (DATCP) commercial applicator certification in the categories required for turf and ornamental and structural pest control, and shall obtain DoD certification under DoDI 4150.07 within one year of contract start. Resumes for key personnel are due with the proposal and for any replacement not later than 10 business days before the change (CDRL A003).')}
${P('1.11', 'Security Requirements.', 'All Contractor employees requiring access to the installation shall be vetted through the Defense Biometric Identification System (DBIDS) and shall complete Antiterrorism Level I awareness training within 30 calendar days of contract start or of the employee\'s start of work, and annually thereafter. Employees shall complete iWATCH Army and Operations Security (OPSEC) awareness training within 30 days of start. Contractor employees working in CYS facilities shall complete the background checks required by AR 608-10 and DoDI 1402.05 before working unescorted in those facilities. The Contractor shall establish a key control program; lost keys shall be reported to the COR within four hours of discovery. The cost of re-keying or core replacement caused by lost Contractor-issued keys will be deducted from the Contractor\'s invoice.')}
${P('1.12', 'Phase-In and Phase-Out.', 'During the 30-day phase-in period (CLIN 0001) the Contractor shall hire and train its workforce, obtain installation access, complete the joint inventory of Government-furnished property (Part 3), and observe the incumbent\'s operations. The Phase-In Plan (CDRL A001) is due 10 business days after contract award. On the first day of the base period the Contractor shall provide a fully qualified workforce capable of performing all work required under this contract. During the 30 days before contract completion the Contractor shall cooperate fully with any successor contractor and shall not defer required work for the purpose of transferring responsibility to the successor.')}
${P('1.13', 'Contractor Manpower Reporting.', 'The Contractor shall report ALL Contractor labor hours (including subcontractor labor hours) required for performance of services provided under this contract via the Enterprise Contractor Manpower Reporting Application (ECMRA) in SAM.gov. The reporting period is the period of performance not to exceed 12 months ending September 30 of each Government fiscal year, and the data must be reported by October 31 of each calendar year (CDRL A010).')}
${P('1.14', 'Workload Changes.', 'The Government reserves the right to add, delete or suspend facilities and areas listed in the Technical Exhibits when facilities are constructed, renovated, closed, vacated or demolished. The Contracting Officer will issue a written modification identifying the facility, the CSF or area added or deleted, and the effective date. Adjustments to CLIN 0002 will be computed as the CSF added or deleted multiplied by the contract unit price per CSF per month. Adjustments to grounds areas will be computed using the unit prices per acre or square foot in Section B. Cumulative changes within plus or minus 10 percent of the TE 5 Part A CSF will be made at the contract unit prices; changes beyond 10 percent may be negotiated. Suspensions of 30 calendar days or longer will be credited at the same rates.')}
${P('1.15', 'Safety and Environmental.', 'The Contractor shall comply with 29 CFR 1910 and 1926, EM 385-1-1 and installation safety requirements. The Contractor shall provide a verbal report of any accident involving injury, death or damage to Government property to the COR within one hour, and a written report within five business days (CDRL A009). The Contractor shall comply with the installation Environmental Management System, the Spill Prevention, Control and Countermeasure Plan and the Integrated Pest Management Plan, and shall immediately report any spill of petroleum, pesticide or other hazardous material to the Fort Brannock Fire Department (911) and the DPW Environmental Division.')}
${P('1.16', 'Mission-Essential Services.', 'Priority 1 snow and ice removal (5.4.3), emergency DMOs (5.6.2), emergency cleaning (5.1.10) and custodial services in facilities with a 7W frequency are mission-essential services under DFARS 252.237-7023. The Contractor\'s Mission-Essential Contractor Services Plan, submitted with the proposal, shall describe how these services will continue during a crisis, pandemic or installation emergency, including alternate staffing and the time required to restore full service.')}
${P('1.17', 'Contractor Employee Conduct.', 'The Contractor shall ensure its employees present a neat appearance, are easily recognized as Contractor personnel, and comply with installation rules on traffic, smoking, firearms and the use of Government telephones and computers. The Contracting Officer may require the Contractor to remove from the installation any employee who endangers persons or property, whose continued employment is inconsistent with the interest of military security, or whose conduct is otherwise unacceptable.')}
${P('1.18', 'Organizational Conflict of Interest.', 'Contractor and subcontractor personnel performing work under this contract may receive, have access to, or participate in the development of proprietary or source selection information, or may perform evaluation services that create a current or subsequent organizational conflict of interest as defined in FAR Subpart 9.5. The Contractor shall notify the Contracting Officer immediately whenever it becomes aware that such access or participation may create an actual or potential conflict.')}
${P('1.19', 'Service Contract Labor Standards.', 'This contract is subject to the Service Contract Labor Standards (41 U.S.C. chapter 67). The applicable Department of Labor wage determination for Langlade County, Wisconsin, is incorporated in Section J. Snow removal equipment operators who also perform grounds maintenance shall be paid the rate for the classification of the work performed in each hour.')}
${P('1.20', 'Invoicing.', 'The Contractor shall submit one invoice per month through the Procurement Integrated Enterprise Environment (PIEE) Wide Area WorkFlow, itemized by CLIN. Invoices for CLIN 0002 shall show the CSF serviced for the month and any credits for suspended areas; invoices for CLINs 0008 and 0009 shall list each snow event or special cleaning request with the date and the COR\'s acceptance.')}`;

const part2 = `
<h1>Part 2 – Definitions and Acronyms</h1>
${P('2.1', 'Definitions.', '')}
${P('2.1.1', 'Acceptable Quality Level (AQL).', 'The maximum allowable deviation from a performance standard before a remedy is applied (TE 1).')}
${P('2.1.2', 'Capability Level.', 'The level of custodial service assigned to a facility in TE 5. <i>Capability I – Enhanced Service</i> applies to CYS facilities and requires a sanitized environment suitable for infants and children. <i>Capability II – Standard Service</i> applies to physical fitness and recreation facilities with locker rooms, showers and high traffic. <i>Capability III – Basic Service</i> applies to administrative, training, maintenance, warehouse and other facilities. Task frequencies for each level are in TE 4.')}
${P('2.1.3', 'Cleanable Square Feet (CSF).', 'The floor area of a facility to be serviced, as shown in TE 5, column 12. CSF is the sum of restroom, carpeted and hard floor areas to be serviced and is the basis for payment under CLIN 0002 and for workload adjustments under 1.14.')}
${P('2.1.4', 'Gross Square Feet (GSF).', 'The total area of all floors of a facility measured to the outside face of the exterior walls, as recorded in the Army real property inventory. GSF is shown in TE 5 for information.')}
${P('2.1.5', 'Contracting Officer\'s Representative (COR).', 'An individual designated in writing by the Contracting Officer to perform specific technical or administrative functions. The COR has no authority to make any commitments or changes that affect price, quality, quantity, delivery or other terms and conditions of the contract.')}
${P('2.1.6', 'Demand Maintenance Order (DMO).', 'A request for minor maintenance or repair of real property that is not scheduled, requiring not more than 16 labor hours and not more than $2,500 in material per order (5.6). DMOs are classified as Emergency (Priority 1), Urgent (Priority 2) or Routine (Priority 3).')}
${P('2.1.7', 'Defect.', 'A failure to meet a performance standard in TE 1 that is observed by the Government and validated by the COR.')}
${P('2.1.8', 'Facility Number (FAC NO).', 'The real property building or facility number assigned by the DPW Real Property Office. Facility numbers may include an alphabetic suffix for separate buildings sharing a base number (for example, 2104A and 2104B).')}
${P('2.1.9', 'Facility Service Frequency.', 'The number of days per week (or per month) on which routine custodial service is performed at a facility, shown in TE 5, column 13:')}
<table class="t" style="width:92%;margin-left:4%">
<tr><th>Code</th><th class="l">Definition</th><th>Service days</th></tr>
<tr><td class="c">7W</td><td>Seven days per week, Monday through Sunday, including Federal holidays.</td><td class="c">7 per week</td></tr>
<tr><td class="c">6W</td><td>Six days per week, Monday through Saturday, excluding Federal holidays.</td><td class="c">6 per week</td></tr>
<tr><td class="c">5W</td><td>Five days per week, Monday through Friday, excluding Federal holidays.</td><td class="c">5 per week</td></tr>
<tr><td class="c">3W</td><td>Three days per week, Monday, Wednesday and Friday (or as scheduled with the COR), excluding Federal holidays.</td><td class="c">3 per week</td></tr>
<tr><td class="c">2W</td><td>Twice weekly, such as Monday and Thursday or Tuesday and Friday.</td><td class="c">2 per week</td></tr>
<tr><td class="c">W</td><td>Weekly; 52 times during each 12-month period at intervals of six to eight calendar days.</td><td class="c">1 per week</td></tr>
<tr><td class="c">M</td><td>Monthly; 12 times during each 12-month period at intervals of 28 to 31 calendar days.</td><td class="c">1 per month</td></tr>
</table>
${P('2.1.10', 'Task Frequency.', 'The frequency at which an individual cleaning task is performed (TE 4). "1X daily" and "2X daily" mean once or twice on each service day of the facility. Weekly, monthly, quarterly (four times per 12 months at intervals of 80 to 100 days), semiannual (twice per 12 months at intervals of 160 to 200 days) and annual (once per 12 months at intervals of 335 to 395 days) tasks are performed regardless of the facility service frequency.')}
${P('2.1.11', 'Improved Grounds.', 'Developed areas with lawns and landscape plantings that receive intensive maintenance, such as areas around administrative, community, CYS and barracks facilities, parade and ceremonial areas, gates and primary road medians. Improved turf is maintained between 2½ and 4 inches.')}
${P('2.1.12', 'Semi-Improved Grounds.', 'Areas maintained to a lesser degree than improved grounds, such as industrial areas, airfield infields and clear zones, road shoulders, and outlying or low-visibility locations, where vegetation is controlled for operational, safety, fire-prevention or appearance reasons. Semi-improved turf is maintained between 4 and 10 inches, except airfield areas (5.3.3).')}
${P('2.1.13', 'Unimproved Grounds.', 'All other grounds, such as firebreaks, fence lines and drainage areas, where vegetation is controlled once or twice per season to prevent encroachment, maintain access and reduce fire hazard.')}
${P('2.1.14', 'Mowing Cycle.', 'One complete mowing, including trimming, of all areas in a grounds area.')}
${P('2.1.15', 'Snow Event.', 'A period of snowfall producing an accumulation of 2 inches or more, measured at the DPW weather station at Bldg 2310, or any freezing rain or ice accumulation for which the COR directs treatment of Priority 1 routes. Snowfall that continues after a break of less than 12 hours is part of the same event. Drifting that requires plowing of Priority 1 or 2 routes with no new snowfall is a separate event only when directed by the COR.')}
${P('2.1.16', 'Lane-Mile.', 'One mile of a single 12-foot traffic lane. A two-lane road one mile long is two lane-miles.')}
${P('2.1.17', 'Container Lift / Roll-off Pull.', 'One emptying of a front-load container into a collection vehicle, or one removal of a roll-off container to a disposal or recycling facility and its return.')}
${P('2.1.18', 'Integrated Pest Management (IPM).', 'A sustainable approach to managing pests that combines biological, cultural, physical and chemical tools in a way that minimizes health, environmental and economic risks, as described in DoDI 4150.07 and the Fort Brannock Integrated Pest Management Plan (IPMP).')}
${P('2.2', 'Acronyms.', '')}
<table class="t">
<tr><th>Acronym</th><th class="l">Meaning</th><th>Acronym</th><th class="l">Meaning</th></tr>
<tr><td>AAF</td><td>Army Airfield</td><td>ECMRA</td><td>Enterprise Contractor Manpower Reporting Application</td></tr>
<tr><td>AQL</td><td>Acceptable Quality Level</td><td>FFP</td><td>Firm-Fixed Price</td></tr>
<tr><td>ASP</td><td>Ammunition Supply Point</td><td>GFE / GFF / GFP</td><td>Government-Furnished Equipment / Facilities / Property</td></tr>
<tr><td>BASH</td><td>Bird/Wildlife Aircraft Strike Hazard</td><td>GSF</td><td>Gross Square Feet</td></tr>
<tr><td>BOD</td><td>Beneficial Occupancy Date</td><td>IPMC</td><td>Installation Pest Management Coordinator</td></tr>
<tr><td>BOS</td><td>Base Operations Support</td><td>LM</td><td>Lane-Mile</td></tr>
<tr><td>CATCD</td><td>Facility Category Code (DA Pam 415-28)</td><td>LRC</td><td>Logistics Readiness Center</td></tr>
<tr><td>CDRL</td><td>Contract Data Requirements List</td><td>MSW / OCC / CMR</td><td>Municipal Solid Waste / Old Corrugated Cardboard / Commingled Recyclables</td></tr>
<tr><td>CIF</td><td>Central Issue Facility</td><td>NAF</td><td>Nonappropriated Fund</td></tr>
<tr><td>CLIN</td><td>Contract Line Item Number</td><td>NCOA</td><td>Noncommissioned Officer Academy</td></tr>
<tr><td>CLS</td><td>Common Levels of Support</td><td>NEC</td><td>Network Enterprise Center</td></tr>
<tr><td>COR</td><td>Contracting Officer's Representative</td><td>PRS</td><td>Performance Requirements Summary</td></tr>
<tr><td>CSF</td><td>Cleanable Square Feet</td><td>QASP / QCP</td><td>Quality Assurance Surveillance Plan / Quality Control Plan</td></tr>
<tr><td>CY</td><td>Cubic Yard</td><td>RCI</td><td>Residential Communities Initiative</td></tr>
<tr><td>CYS</td><td>Child, Youth and School Services</td><td>RPLANS</td><td>Real Property Planning and Analysis System</td></tr>
<tr><td>DES</td><td>Directorate of Emergency Services</td><td>RSO</td><td>Religious Support Office</td></tr>
<tr><td>DFMWR</td><td>Directorate of Family and Morale, Welfare and Recreation</td><td>SF / SY / LF</td><td>Square Feet / Square Yards / Linear Feet</td></tr>
<tr><td>DHR</td><td>Directorate of Human Resources</td><td>TE</td><td>Technical Exhibit</td></tr>
<tr><td>DMO</td><td>Demand Maintenance Order</td><td>TEMF</td><td>Tactical Equipment Maintenance Facility</td></tr>
<tr><td>DPTMS</td><td>Directorate of Plans, Training, Mobilization and Security</td><td>UH / UPH</td><td>Unaccompanied Housing / Unaccompanied Personnel Housing</td></tr>
<tr><td>DPW</td><td>Directorate of Public Works</td><td>VCC</td><td>Visitor Control Center</td></tr>
</table>`;

const part34 = `
<h1>Part 3 – Government-Furnished Property, Facilities and Services</h1>
${P('3.1', 'General.', 'The Government will provide, without cost to the Contractor, the facilities, equipment, materials and services listed in this Part. Government-furnished property (GFP) shall be used only in performance of this contract. An initial joint inventory of GFP shall be conducted by the Contractor and the COR on or before the first day of the base period IAW DA Pam 710-2-1 and recorded on DA Form 2062, Hand Receipt.')}
${P('3.2', 'Government-Furnished Facilities (GFF).', 'The Government will provide the facilities in Table 3-1 for the Contractor\'s administrative offices, shops, storage and vehicle parking.')}
<p class="tt">Table 3-1. Government-Furnished Facilities</p>
<table class="t">
<tr><th>Bldg No.</th><th class="l">Facility</th><th>GSF</th><th class="l">Contractor Use</th></tr>
<tr><td class="c">2410</td><td>BOS Contractor Administration Building</td><td class="num">7,200</td><td>Project management office, quality control, work reception, training room</td></tr>
<tr><td class="c">2412</td><td>Shops and Storage Building</td><td class="num">12,800</td><td>Grounds equipment maintenance, custodial supply storage, pest management shop</td></tr>
<tr><td class="c">2414</td><td>Covered Vehicle and Equipment Storage (pole building)</td><td class="num">4,000</td><td>Snow removal and mowing equipment storage</td></tr>
<tr><td class="c">2416</td><td>Salt and Sand Storage Dome</td><td class="num">6,360</td><td>Government deicing material stockpile (1,200-ton capacity) (4.5)</td></tr>
</table>
${P('3.2.1', '', 'The Contractor shall keep GFF clean, orderly and free of pests and fire hazards, and shall perform custodial services in GFF at no additional cost to the Government. GFF is not included in TE 5 and shall not be invoiced under CLIN 0002. Pesticides shall be stored only in the pest management shop in Bldg 2412.')}
${P('3.3', 'Government-Furnished Equipment (GFE).', 'The Government will provide the equipment in Table 3-2. The Contractor shall perform operator maintenance and scheduled services on GFE IAW the manufacturer\'s instructions. Repairs to GFE caused by Contractor negligence or abuse are at the Contractor\'s expense.')}
<p class="tt">Table 3-2. Government-Furnished Equipment</p>
<table class="t">
<tr><th>Item</th><th class="l">Description</th><th>Qty</th><th class="l">Remarks</th></tr>
<tr><td class="c">1</td><td>Dump truck, 10-wheel, with 11-ft reversible plow, wing and 10-CY spreader</td><td class="c">4</td><td>Model years 2016–2021</td></tr>
<tr><td class="c">2</td><td>Wheel loader, 3-CY bucket, with 14-ft snow pusher</td><td class="c">2</td><td></td></tr>
<tr><td class="c">3</td><td>Compact tractor with 60-in. broom and 54-in. snow blower (sidewalk unit)</td><td class="c">3</td><td></td></tr>
<tr><td class="c">4</td><td>Zero-turn mower, 72-in. deck</td><td class="c">6</td><td>Replacement by Contractor after FY29 (Part 4)</td></tr>
<tr><td class="c">5</td><td>Wide-area rotary mower, 16-ft</td><td class="c">2</td><td></td></tr>
<tr><td class="c">6</td><td>Tractor, 85 hp, with 15-ft batwing rotary cutter</td><td class="c">1</td><td>Semi-improved and unimproved areas</td></tr>
<tr><td class="c">7</td><td>Pest management vehicle with locking chemical compartment and spill kit</td><td class="c">1</td><td></td></tr>
</table>
${P('3.4', 'Utilities.', 'The Government will furnish electricity, water, sewer, heat and natural gas for GFF and for the performance of work in Government facilities. The Contractor shall conserve utilities and shall turn off lights and close windows and doors in facilities after cleaning.')}
${P('3.5', 'Government-Furnished Services.', 'The Government will provide installation fire and emergency medical response, police services, and access to the installation telephone system and the GFEBS work management system for DMO processing (5.6.4). Government computers and network accounts will be provided for up to six Contractor personnel.')}

<h1 style="margin-top:14pt">Part 4 – Contractor-Furnished Items and Services</h1>
${P('4.1', 'General.', 'Except for the items specifically stated as Government-furnished in Part 3, the Contractor shall furnish everything required to perform this PWS.')}
${P('4.2', 'Custodial Supplies and Equipment.', 'The Contractor shall furnish all custodial equipment, cleaning chemicals, floor finishes, and consumable supplies, including toilet tissue, paper towels, hand soap, seat covers, feminine hygiene product bags and trash can liners, for all TE 5 Part A facilities. Products shall meet the recycled-content and environmentally preferable purchasing requirements of FAR Subpart 23.1. Vacuum cleaners shall be certified under the Carpet and Rug Institute Seal of Approval program. Dispensers installed by the Government shall be used; the Contractor shall not install proprietary dispensers without COR approval.')}
${P('4.3', 'Refuse Containers and Vehicles.', 'The Contractor shall furnish all front-load and roll-off containers, collection vehicles and disposal or recycling facility access required by 5.2 and TE 7, including tipping fees.')}
${P('4.4', 'Pesticides.', 'The Contractor shall furnish all pesticides, baits, traps and application equipment. Only EPA-registered pesticides approved by the Installation Pest Management Coordinator (IPMC) and listed in the IPMP may be used. Safety Data Sheets shall be maintained on site.')}
${P('4.5', 'Deicing Materials.', 'The Government will furnish rock salt and sand from the stockpile at Facility 2416. The Contractor shall load, transport and apply the material and shall furnish any liquid anti-icing material and sidewalk ice-melt (calcium magnesium acetate or equivalent approved by the COR) used at building entrances.')}
${P('4.6', 'Vehicles and Uniforms.', 'Contractor vehicles shall display the company name. Contractor employees shall wear a uniform or other distinctive clothing and an identification badge that clearly identifies them as Contractor personnel.')}`;

const part5a = `
<h1>Part 5 – Specific Tasks</h1>
<h2>5.1 CLS 402 – Custodial Services</h2>
${P('5.1.1', 'General.', `The Contractor shall provide custodial services in the facilities listed in TE 5, Part A, at the capability level and facility service frequency shown for each facility, to the standards and task frequencies in TE 4. TE 5, Part A contains ${all.length} facility lines; ${T.n} facilities are serviced, with a total of ${fmt(T.csf)} CSF (${fmt(T.gsf)} GSF). Services are required only in the cleanable areas defined in Note 2 to TE 5. Facilities and areas not listed in TE 5, Part A are not part of the base requirement.`)}
${P('5.1.2', 'Capability Levels.', `TE 5 groups facilities by capability level: Capability I – Enhanced Service, ${gt[0].n} facilities (${fmt(gt[0].csf)} CSF); Capability II – Standard Service, ${gt[1].n} facilities (${fmt(gt[1].csf)} CSF); and Capability III – Basic Service, ${gt[2].n} facilities (${fmt(gt[2].csf)} CSF). The Contractor shall perform each task at the frequency shown in TE 4 for the facility\'s capability level.`)}
${P('5.1.3', 'Service Schedule.', 'The Contractor shall submit a cleaning schedule for each facility with its proposal and a monthly schedule to the COR by the 25th day of the preceding month (CDRL A005). Facilities with a 7W frequency (fitness centers, indoor pool, bowling center, military police station, fire station, Visitor Control Center and airfield operations building) shall be serviced every day, including holidays; services in 24-hour facilities shall be coordinated with the building manager to avoid disrupting operations. Services in the Outdoor Pool Bathhouse (Bldg 1532) are seasonal (TE 5, Note 6).')}
${P('5.1.4', 'Restrooms, Locker Rooms and Showers.', 'The Contractor shall clean and disinfect all surfaces of toilets, urinals, lavatories, showers, partitions, mirrors, dispensers and drinking fountains, and shall restock all dispensers so that supplies do not run out between services. Restrooms identified by Note 3 in TE 5 shall be serviced twice on each service day, with one service during the facility\'s operating hours. Floor drains shall be flushed weekly to prevent odors.')}
${P('5.1.5', 'Trash and Recycling.', 'The Contractor shall empty all trash and recycling receptacles, replace liners, and transport trash and recyclables to the nearest container listed in TE 7. Cardboard shall be broken down and placed in OCC containers where provided. Shredded paper and classified waste are removed by the occupant and are excluded.')}
${P('5.1.6', 'Unaccompanied Personnel Housing (Barracks).', 'In UPH barracks Bldgs 1402, 1403 and 1404 the Contractor shall service only the common areas: entry lobbies, dayrooms, laundry rooms, corridors, stairwells and common latrines (TE 5, Note 5). Soldier living modules, the unit supply rooms and the arms rooms are excluded. Barracks Bldg 1407 is vacant (TE 5, Note 4) and shall not be serviced. When the barracks are occupied by Reserve Component units during annual training (June through August), the COR may direct up to two additional services per week in the common latrines of Bldgs 1402–1404, which will be ordered under CLIN 0009.')}
${P('5.1.7', 'Periodic Floor Care.', `The Contractor shall spray buff, strip and refinish resilient floors and extract carpets at the frequencies in TE 4. Strip-and-refinish and carpet extraction shall be scheduled in advance with the COR and building manager and performed when the area is unoccupied, preferably on weekends. Capability III facilities contain approximately ${fmt(carpetIII)} SF of carpet, which shall be hot-water extracted once each year. Floor care shall not be performed in CYS facilities within 12 hours before the facility opens.`)}
${P('5.1.8', 'Windows and Glass.', 'The Contractor shall clean entrance glass and interior glass at the frequencies in TE 4 and shall clean both sides of exterior windows up to 12 feet above grade twice each year in Capability I and II facilities and once each year in Capability III facilities, between 15 May and 30 September. Windows above 12 feet are excluded.')}
${P('5.1.9', 'Wood Gymnasium Floors.', 'The wood gymnasium floors in Bldg 1520 (14,200 SF) and Bldg 1524 (11,600 SF) are included in the hard floor SF in TE 5 (Note 10). The Contractor shall dust-mop the floors twice on each service day, damp-mop with a cleaner approved by the floor finish manufacturer, and screen and recoat each floor once a year during the annual August maintenance closure of not more than five calendar days. Game-line painting and sanding are excluded.')}
${P('5.1.10', 'Special and Emergency Cleaning.', 'The COR may order special cleaning (such as cleaning after a ceremony, change of command or conference) and emergency cleaning (such as clean-up after flooding, sewage back-up or a body-fluid spill). Emergency cleaning shall begin within two hours of notification, 24 hours a day. Special cleaning shall be completed on the date and time stated in the order. Special and emergency cleaning is ordered and priced per request under CLIN 0009. Historical requests are shown in TE 10.')}
${P('5.1.11', 'Closures and Unoccupied Areas.', 'When a facility or a portion of a facility is closed for renovation, or is otherwise unoccupied for 30 calendar days or longer, the COR will suspend services in writing and the CSF will be credited under 1.14. Unoccupied areas of a serviced facility shall receive a monthly cleaning (dust, vacuum or sweep, and flush fixtures) unless the COR suspends the area.')}
${P('5.1.12', 'Optional Facilities.', 'The facilities in TE 5, Part B – UPH Barracks Bldg 1410 (under construction, beneficial occupancy estimated September 2028) and Child Development Center III, Bldg 3116 (programmed, beneficial occupancy estimated FY29) – are not part of the base requirement. They shall be serviced only after the Contracting Officer exercises Optional CLIN 0010 (or x010 in an option period) by written modification. Part B GSF and CSF are design estimates and will be adjusted to the as-built CSF when the option is exercised.')}
${P('5.1.13', 'Facilities Not Serviced.', 'The following are not serviced under CLS 402: the Dining Facility (Bldg 1310), the Army Health Clinic (Bldg 1100) and the Veterinary Treatment Facility (Bldg 1106), the Commissary (Bldg 1600), the Brannock Club (Bldg 1550), family housing, the Government-furnished facilities in Table 3-1, and any facility not listed in TE 5, Part A. Mechanical, electrical and communications rooms, food-preparation areas, vaults and the areas excluded by the notes to TE 5 are not serviced in any facility.')}

<h2>5.2 CLS 403 – Refuse Removal and Recycling</h2>
${P('5.2.1', 'General.', `The Contractor shall collect municipal solid waste (MSW), old corrugated cardboard (OCC) and commingled recyclables (CMR) from the containers listed in TE 7 at the frequencies shown, transport the material, and dispose of MSW at a permitted Subtitle D landfill and recyclables at a permitted materials recovery facility selected by the Contractor. TE 7 lists ${CONT} front-load containers requiring an estimated ${LIFTS} lifts per week, and ${t72.length} roll-off containers requiring an estimated ${PULLS} pulls per year. The estimated annual quantity is ${fmt(TONS)} tons. All tipping and recycling fees are included in CLIN 0003.`)}
${P('5.2.2', 'Containers.', 'The Contractor shall furnish, place, maintain and replace all containers. Containers shall be labeled with the waste stream, the Contractor\'s name and a telephone number, and shall be kept clean, painted, and free of holes and odors. Damaged containers shall be repaired or replaced within two business days of notification. Container sizes and locations shall not be changed without COR approval. Containers serving the Dining Facility (Bldg 1310) shall be steam-cleaned monthly from May through September.')}
${P('5.2.3', 'Collection Schedule.', 'Collections shall occur on the days agreed with the COR. Collections near barracks and CYS facilities shall not begin before 0700. Collections at the Dining Facility shall be made six days per week, Monday through Saturday. The area within 10 feet of each container shall be left free of spilled refuse after each lift. Containers at the Range Complex are serviced only from 1 April through 30 November (TE 7, Note 3).')}
${P('5.2.4', 'Overflow and Additional Lifts.', 'Containers shall not overflow. The Contractor shall perform additional lifts within 24 hours of a COR request; up to 50 additional lifts per year are included in CLIN 0003.')}
${P('5.2.5', 'Reporting.', 'The Contractor shall submit a monthly report of tons collected by waste stream, supported by scale tickets (CDRL A007). The data is used for the Army Solid Waste Annual Report and the installation diversion rate.')}
${P('5.2.6', 'Exclusions.', 'Hazardous waste, universal waste, regulated medical waste from the Army Health Clinic and Veterinary Treatment Facility, ammunition residue and range brass, and household waste from family housing (collected by the RCI partner) are excluded.')}

<h2>5.3 CLS 404 – Maintenance – Grounds</h2>
${P('5.3.1', 'General.', `The Contractor shall maintain the improved, semi-improved and unimproved grounds, athletic fields, landscaped beds and paved areas listed in TE 6. TE 6 lists ${f1(GT61)} acres of improved, semi-improved and unimproved grounds (${f1(IMP)} acres improved; ${f1(SEMI)} acres semi-improved; ${f1(UNIMP)} acres unimproved) and ${f1(ATH)} acres of athletic fields. Family housing areas and training areas are excluded.`)}
${P('5.3.2', 'Improved Grounds.', 'The Contractor shall mow improved grounds once each week during the mowing season (24 mowing cycles) and maintain turf between 2½ and 4 inches. Mowing shall include trimming around buildings, trees, signs, fences, headstones and other obstacles. Walks and curbs adjacent to improved grounds (TE 6, Table 6-3) shall be edged every other week during the mowing season (12 times). Clippings shall be removed from walks, streets and parking areas the same day. Fallen leaves shall be removed from improved grounds and beds by 15 November.')}
${P('5.3.3', 'Semi-Improved Grounds.', 'The Contractor shall mow semi-improved grounds at the frequencies in TE 6 to maintain vegetation between 4 and 10 inches. Airfield infields, clear zones and runway shoulders at Brannock AAF shall be maintained between 7 and 14 inches IAW the Brannock AAF BASH Plan, and mowing shall be coordinated with Airfield Operations (Bldg 2602) at least 24 hours in advance. Mowing inside the ASP fence requires an escort (TE 6, Note 4).')}
${P('5.3.4', 'Unimproved Grounds.', 'Firebreaks and fence lines shall be mowed or cut once each year after 15 July to protect ground-nesting birds, and vegetation shall be kept at least 3 feet from perimeter fences. Stormwater ponds, drainage channels and retention basins shall be cut twice each year and kept free of woody vegetation and debris that restricts flow.')}
${P('5.3.5', 'Athletic Fields.', 'The Contractor shall mow athletic fields twice each week during the mowing season to 2 to 2½ inches, aerate twice each year, and line the fields before each scheduled game or event (estimated 120 linings per season). Infields shall be dragged and leveled before each scheduled game.')}
${P('5.3.6', 'Landscaped Beds.', 'The Contractor shall weed shrub and planting beds monthly from May through October, prune shrubs and hedges once each year to maintain their natural form, and apply shredded hardwood mulch to a 3-inch depth once each year by 1 June.')}
${P('5.3.7', 'Paved Areas.', 'The Contractor shall police litter and debris from parking lots, sidewalks and walkways weekly during the mowing season and every other week during the rest of the year, and shall sweep parking lots four times each year. Winter sand shall be swept from all parking lots, sidewalks and curb lines by 15 May.')}
${P('5.3.8', 'Trees.', 'Tree pruning and removal are performed by DMO (5.6) only. The Contractor shall report hazardous trees to the COR within one business day of discovery and shall remove storm-damaged limbs blocking roads, walks or parking areas within 24 hours.')}
${P('5.3.9', 'Fertilizer and Herbicide.', 'Fertilizer and herbicide applications on turf are performed by the Pest Management Supervisor\'s certified applicators under 5.5.5 and are reported under CDRL A006. The Contractor shall not apply fertilizer within 25 feet of a stormwater pond or channel.')}`;

const part5b = `
<h2>5.4 CLS 408 – Snow, Ice and Sand Removal</h2>
${P('5.4.1', 'General.', 'The Contractor shall clear snow and ice from the roads, parking areas, sidewalks and building entrances listed in TE 8, in the priority order shown, IAW the Fort Brannock Snow and Ice Removal Plan. The parking areas and sidewalks in TE 8 are part of the paved areas listed in TE 6, Table 6-3; TE 8 assigns their snow removal priorities.')}
${P('5.4.2', 'Start of Operations.', 'Snow removal operations shall begin when accumulation reaches 2 inches, or at the direction of the COR for freezing rain or ice, and shall continue until all Priority 1, 2 and 3 areas are cleared. The Contractor shall have equipment and operators on site within one hour of a call-out at any hour.')}
${P('5.4.3', 'Priorities and Response Times.', 'Priority 1 routes and areas (emergency routes, the Main Gate, Army Health Clinic, Military Police Station, Fire Station, Visitor Control Center and Airfield Operations) shall be passable within two hours after operations begin and kept passable throughout the event. Priority 2 areas shall be cleared by 0600 on the next duty day or within six hours after Priority 1 areas are cleared, whichever is later. Priority 3 areas shall be cleared within 24 hours after the end of the snow event. Roads shall be plowed to bare pavement or a compact snow surface treated with salt and sand, curb to curb, without leaving windrows across intersections, driveways or entrances.')}
${P('5.4.4', 'Sidewalks and Entrances.', 'Sidewalks, steps, ramps and entrances to Priority 1 facilities and to CYS facilities shall be cleared by 0600 and treated with ice-melt. Other sidewalks shall be cleared within the time allowed for the priority of the adjoining parking area. Seasonal walks at the outdoor pool, outdoor recreation center and athletic fields are not cleared (TE 8, Note 2).')}
${P('5.4.5', 'Ice Control.', 'The Contractor shall apply salt and sand from the Government stockpile at Facility 2416 at rates that maintain safe traction, not exceeding 300 pounds of salt per lane-mile per application except as directed by the COR. Salt shall not be applied on the airfield; only airfield-approved deicers furnished by the Government shall be used there.')}
${P('5.4.6', 'Snow Storage.', 'Snow shall be pushed or hauled to the snow storage areas shown in TE 11. Snow shall not be piled on shrub beds, against buildings, on fire hydrants, or where it blocks sight lines at intersections. Turf damaged by snow removal shall be repaired by 15 May.')}
${P('5.4.7', 'Snow Events Included in the Fixed Price.', 'CLIN 0005 includes up to 14 snow events in each snow season (15 October through 30 April), all ice-control call-outs, and spring sand clean-up (5.3.7). Each event above 14 in a season will be paid at the fixed unit price per event under CLIN 0008. Historical snow events are shown in TE 10.')}
${P('5.4.8', 'Snow Event Log.', 'The Contractor shall submit a snow event log within 24 hours after each event showing the start and end times, accumulation, equipment and labor hours used, tons of salt and sand applied, and the time each priority was cleared (CDRL A008).')}

<h2>5.5 CLS 510 – Pest Management</h2>
${P('5.5.1', 'General.', 'The Contractor shall provide integrated pest management services IAW DoDI 4150.07, AR 200-1, Wisconsin Administrative Code chapter ATCP 29, and the Fort Brannock IPMP. All pesticide applications shall be made by, or under the direct supervision of, a certified applicator. The Contractor shall record all pesticide applications on DD Form 1532-1, Pest Management Maintenance Record, and submit a monthly summary to the IPMC (CDRL A006).')}
${P('5.5.2', 'Scheduled Structural Services.', 'The Contractor shall inspect and, where pests are found, treat the food-service, CYS, medical and barracks facilities listed in TE 9, Table 9-1, at the frequencies shown, and shall inspect all other occupied facilities on the installation quarterly. Pesticides shall not be applied in CYS facilities while children are present; only baits, traps and other low-risk methods approved by the IPMC may be used in CYS facilities.')}
${P('5.5.3', 'Pest Service Calls.', 'The Contractor shall respond to pest management DMOs within one business day. Stinging insects at CYS facilities, the Army Health Clinic or building entrances, and any rodent or bed bug sighting in food-service or CYS facilities shall be responded to within two hours during duty hours and four hours after duty hours. Historical service calls are shown in TE 10.')}
${P('5.5.4', 'Rodent Control.', 'The Contractor shall maintain and inspect monthly the exterior tamper-resistant rodent bait stations listed in TE 9, Table 9-2, and shall replace damaged or missing stations within five business days.')}
${P('5.5.5', 'Vegetation and Turf Pest Control.', 'The Contractor shall apply broadleaf weed control to improved grounds and athletic fields, pre-emergent crabgrass control to athletic fields, and vegetation control along fence lines and pavement edges at the frequencies in TE 9, Table 9-2. Applications shall not be made when wind speed exceeds 10 miles per hour or within 48 hours of forecast rain.')}
${P('5.5.6', 'Mosquito and Tick Surveillance.', 'The Contractor shall set and collect the surveillance traps in TE 9 weekly from 1 June through 30 September, ship specimens to the regional Army public health laboratory as directed by the IPMC, and apply larvicide to the stormwater areas in TE 9 when directed by the IPMC.')}
${P('5.5.7', 'Exclusions.', 'Pest management in family housing (RCI partner), fumigation, termite pre-construction treatment, and wildlife damage management requiring federal permits are excluded.')}

<h2>5.6 CLS 420 – Facility Maintenance (Demand Maintenance Orders)</h2>
${P('5.6.1', 'General.', 'The Contractor shall perform DMOs for minor maintenance and repair of real property on the installation, including carpentry, electrical, plumbing, heating and air conditioning, locksmith and painting work. A DMO requires not more than 16 labor hours and not more than $2,500 in material. Work exceeding these limits will be accomplished by the Government by other means unless the COR authorizes completion under this contract.')}
${P('5.6.2', 'Priorities.', 'Emergency (Priority 1) DMOs – conditions that endanger life, health, safety or security, or that will cause serious damage to property or mission – shall be responded to within one hour and made safe or completed within 24 hours. Urgent (Priority 2) DMOs shall be completed within five calendar days. Routine (Priority 3) DMOs shall be completed within 30 calendar days.')}
${P('5.6.3', 'Estimated Workload.', 'The estimated annual workload is 4,700 DMOs. CLIN 0006 is firm-fixed price for labor for up to 110 percent of the estimated quantity in each period; DMO material is reimbursed at cost without fee. Historical DMO data is shown in TE 10, Tables 10-2 and 10-3.')}
${P('5.6.4', 'Work Management.', 'The Contractor shall receive, schedule, document and close all DMOs in the Government\'s General Fund Enterprise Business System (GFEBS), recording labor hours, material and completion date for each order.')}
<h2>5.7 Meetings and Recurring Reports</h2>
${P('5.7.1', 'Post-Award Conference.', 'The Contractor shall attend a post-award conference within 15 calendar days after award.')}
${P('5.7.2', 'Monthly Performance Review.', 'The Project Manager shall meet with the Contracting Officer and COR monthly to review performance, and shall submit a Monthly Performance Report (CDRL A004) by the 5th business day of each month summarizing work completed for each CLS, quality control results, customer complaints and corrective actions.')}`;

const part67 = `
<h1>Part 6 – Applicable Publications</h1>
${P('6.1', '', 'The Contractor shall comply with the following publications, current as of the date of the solicitation. Publications are available from the issuing agency\'s website or will be provided by the COR.')}
<table class="t">
<tr><th>Publication</th><th class="l">Title</th><th>Mandatory / Advisory</th><th>PWS Section</th></tr>
<tr><td>AR 420-1</td><td>Army Facilities Management</td><td class="c">Mandatory</td><td class="c">All</td></tr>
<tr><td>AR 200-1</td><td>Environmental Protection and Enhancement</td><td class="c">Mandatory</td><td class="c">1.15, 5.2, 5.5</td></tr>
<tr><td>AR 608-10</td><td>Child Development Services</td><td class="c">Mandatory</td><td class="c">1.11, 5.1</td></tr>
<tr><td>DA Pam 415-28</td><td>Guide to Army Real Property Category Codes</td><td class="c">Advisory</td><td class="c">TE 5</td></tr>
<tr><td>DA Pam 710-2-1</td><td>Using Unit Supply System (Manual Procedures)</td><td class="c">Mandatory</td><td class="c">3.1</td></tr>
<tr><td>DoDI 4150.07</td><td>DoD Pest Management Program</td><td class="c">Mandatory</td><td class="c">5.5</td></tr>
<tr><td>DoDI 1402.05</td><td>Background Checks on Individuals in DoD Child Care Services Programs</td><td class="c">Mandatory</td><td class="c">1.11</td></tr>
<tr><td>EM 385-1-1</td><td>USACE Safety and Health Requirements Manual</td><td class="c">Mandatory</td><td class="c">1.15</td></tr>
<tr><td>29 CFR 1910 / 1926</td><td>Occupational Safety and Health Standards / Construction</td><td class="c">Mandatory</td><td class="c">1.15</td></tr>
<tr><td>40 CFR 258</td><td>Criteria for Municipal Solid Waste Landfills</td><td class="c">Mandatory</td><td class="c">5.2</td></tr>
<tr><td>Wis. Adm. Code ch. ATCP 29</td><td>Pesticide Use and Control</td><td class="c">Mandatory</td><td class="c">5.5</td></tr>
<tr><td>Fort Brannock IPMP (FY26)</td><td>Integrated Pest Management Plan</td><td class="c">Mandatory</td><td class="c">5.5</td></tr>
<tr><td>Fort Brannock Snow Plan</td><td>Snow and Ice Removal Plan (FY27)</td><td class="c">Mandatory</td><td class="c">5.4</td></tr>
<tr><td>Brannock AAF BASH Plan</td><td>Bird/Wildlife Aircraft Strike Hazard Plan</td><td class="c">Mandatory</td><td class="c">5.3.3</td></tr>
</table>
<h1 style="margin-top:14pt">Part 7 – Attachment / Technical Exhibit Listing</h1>
${P('7.1', '', 'The following Technical Exhibits are part of this PWS. The Contractor shall review the Technical Exhibits annually and recommend updates to the COR; approved updates will be incorporated by contract modification.')}
<table class="t">
<tr><th>TE</th><th class="l">Title</th><th>Pages</th></tr>
<tr><td class="c">1</td><td>Performance Requirements Summary</td><td class="c">1</td></tr>
<tr><td class="c">2</td><td>Deliverables Schedule</td><td class="c">1</td></tr>
<tr><td class="c">3</td><td>Estimated Workload Summary</td><td class="c">1</td></tr>
<tr><td class="c">4</td><td>Custodial Cleaning Standards and Frequencies</td><td class="c">1</td></tr>
<tr><td class="c">5</td><td>Custodial Facility List – Part A, Facilities Serviced; Part B, Optional Facilities</td><td class="c">2</td></tr>
<tr><td class="c">6</td><td>Grounds Maintenance Areas</td><td class="c">1</td></tr>
<tr><td class="c">7</td><td>Refuse Collection Workload</td><td class="c">1</td></tr>
<tr><td class="c">8</td><td>Snow and Ice Removal Areas and Priorities</td><td class="c">1</td></tr>
<tr><td class="c">9</td><td>Pest Management Workload</td><td class="c">1</td></tr>
<tr><td class="c">10</td><td>Historical Workload Data</td><td class="c">2</td></tr>
<tr><td class="c">11</td><td>Installation Maps (electronic only)</td><td class="c">—</td></tr>
</table>`;

const te1 = `
<p class="tcap">TECHNICAL EXHIBIT 1 – PERFORMANCE REQUIREMENTS SUMMARY</p>
<p class="tsub">Remedies are applied to the monthly invoice for the CLIN shown, in addition to re-performance at no cost to the Government.</p>
<table class="t">
<tr><th>No.</th><th class="l">Performance Objective</th><th>PWS Para</th><th class="l">Performance Standard</th><th>AQL</th><th>Method of Surveillance</th><th class="l">Remedy</th></tr>
<tr><td class="c">1</td><td>Custodial services performed in TE 5 Part A facilities</td><td class="c">5.1</td><td>All tasks performed at TE 4 frequencies to TE 4 standards</td><td class="c">95% of areas inspected acceptable</td><td>Random sampling, 10% of facilities per month</td><td>Re-perform within 4 hours; $150 per defective area above AQL (CLIN 0002)</td></tr>
<tr><td class="c">2</td><td>Restroom dispensers stocked</td><td class="c">5.1.4</td><td>No dispenser empty between services</td><td class="c">98%</td><td>Random sampling; validated complaints</td><td>$50 per occurrence above AQL</td></tr>
<tr><td class="c">3</td><td>Emergency cleaning response</td><td class="c">5.1.10</td><td>Begin within 2 hours of notification</td><td class="c">100%</td><td>100% inspection</td><td>$250 per occurrence</td></tr>
<tr><td class="c">4</td><td>Refuse collected on schedule; no overflow</td><td class="c">5.2</td><td>All lifts on scheduled day; area clean after lift</td><td class="c">No more than 2 missed lifts per month</td><td>COR log; validated complaints</td><td>$75 per missed lift above AQL (CLIN 0003)</td></tr>
<tr><td class="c">5</td><td>Improved grounds maintained</td><td class="c">5.3.2</td><td>Turf 2½–4 in.; trimmed; clippings removed</td><td class="c">90% of areas inspected</td><td>Periodic inspection, weekly in season</td><td>$200 per acre out of standard (CLIN 0004)</td></tr>
<tr><td class="c">6</td><td>Priority 1 snow routes passable</td><td class="c">5.4.3</td><td>Within 2 hours after start of operations</td><td class="c">100%</td><td>100% inspection each event</td><td>$1,000 per occurrence (CLIN 0005)</td></tr>
<tr><td class="c">7</td><td>Pest service calls answered</td><td class="c">5.5.3</td><td>Within 1 business day (2 hours for urgent calls)</td><td class="c">95%</td><td>GFEBS records</td><td>$100 per late call above AQL (CLIN 0007)</td></tr>
<tr><td class="c">8</td><td>Emergency DMOs</td><td class="c">5.6.2</td><td>Respond 1 hour; safe or complete 24 hours</td><td class="c">100%</td><td>GFEBS records</td><td>$500 per occurrence (CLIN 0006)</td></tr>
<tr><td class="c">9</td><td>Routine DMOs</td><td class="c">5.6.2</td><td>Completed within 30 calendar days</td><td class="c">92%</td><td>GFEBS records</td><td>$40 per late DMO above AQL</td></tr>
<tr><td class="c">10</td><td>Deliverables</td><td class="c">TE 2</td><td>Submitted complete and on time</td><td class="c">100%</td><td>100% inspection</td><td>Recorded in CPARS</td></tr>
</table>
<p class="tcap" style="margin-top:16pt">TECHNICAL EXHIBIT 2 – DELIVERABLES SCHEDULE</p>
<table class="t">
<tr><th>CDRL</th><th class="l">Deliverable</th><th>PWS Para</th><th class="l">Frequency / Due Date</th><th>Medium</th><th class="l">Submit To</th></tr>
<tr><td class="c">A001</td><td>Phase-In Plan</td><td class="c">1.12</td><td>10 business days after award</td><td class="c">Electronic</td><td>KO, COR</td></tr>
<tr><td class="c">A002</td><td>Quality Control Plan</td><td class="c">1.8</td><td>With proposal; updates within 10 business days of change</td><td class="c">Electronic</td><td>KO, COR</td></tr>
<tr><td class="c">A003</td><td>Key Personnel Resumes</td><td class="c">1.10</td><td>With proposal; 10 business days before any change</td><td class="c">Electronic</td><td>KO</td></tr>
<tr><td class="c">A004</td><td>Monthly Performance Report</td><td class="c">5.7.2</td><td>5th business day of each month</td><td class="c">Electronic</td><td>COR</td></tr>
<tr><td class="c">A005</td><td>Custodial Cleaning Schedule</td><td class="c">5.1.3</td><td>With proposal; monthly by the 25th</td><td class="c">Electronic</td><td>COR</td></tr>
<tr><td class="c">A006</td><td>Pest Management Records (DD Form 1532-1) and Summary</td><td class="c">5.5.1</td><td>Monthly, 5th business day</td><td class="c">Electronic</td><td>IPMC, COR</td></tr>
<tr><td class="c">A007</td><td>Refuse Tonnage Report with Scale Tickets</td><td class="c">5.2.5</td><td>Monthly, 10th business day</td><td class="c">Electronic</td><td>COR, DPW Environmental</td></tr>
<tr><td class="c">A008</td><td>Snow Event Log</td><td class="c">5.4.8</td><td>24 hours after end of each event</td><td class="c">Electronic</td><td>COR</td></tr>
<tr><td class="c">A009</td><td>Accident Report</td><td class="c">1.15</td><td>Verbal 1 hour; written 5 business days</td><td class="c">Electronic</td><td>COR, Safety Office</td></tr>
<tr><td class="c">A010</td><td>ECMRA Labor Hour Report</td><td class="c">1.13</td><td>Annually by 31 October</td><td class="c">SAM.gov</td><td>—</td></tr>
<tr><td class="c">A011</td><td>Key Control Inventory</td><td class="c">1.11</td><td>Semiannually (January, July)</td><td class="c">Electronic</td><td>COR</td></tr>
</table>`;

const te3 = `
<p class="tcap">TECHNICAL EXHIBIT 3 – ESTIMATED WORKLOAD SUMMARY</p>
<p class="tsub">Summary of the estimated annual workload by CLS. Quantities are taken from the detailed Technical Exhibits shown; where they differ, the detailed Technical Exhibit governs.</p>
<table class="t">
<tr><th>CLS</th><th class="l">Workload Element</th><th>Estimated Quantity</th><th>Unit</th><th class="l">Frequency / Annual Occurrence</th><th>Source</th></tr>
<tr class="grp"><td colspan="6">402 – CUSTODIAL SERVICES</td></tr>
<tr><td class="c">402</td><td>Facilities serviced (Part A)</td><td class="num">${T.n}</td><td class="c">EA</td><td>Per TE 5 frequency (7W to M)</td><td class="c">TE 5</td></tr>
<tr><td class="c">402</td><td>Cleanable area serviced (Part A)</td><td class="num">${fmt(T.csf)}</td><td class="c">CSF</td><td>Per TE 4 / TE 5</td><td class="c">TE 5</td></tr>
<tr><td class="c">402</td><td>Optional facilities (Part B) – not in base requirement</td><td class="num">${TB.n}</td><td class="c">EA</td><td>${fmt(TB.csf)} CSF (design estimate)</td><td class="c">TE 5</td></tr>
<tr><td class="c">402</td><td>Special and emergency cleaning requests</td><td class="num">55</td><td class="c">EA</td><td>Per year (estimate)</td><td class="c">TE 10</td></tr>
<tr class="grp"><td colspan="6">403 – REFUSE REMOVAL AND RECYCLING</td></tr>
<tr><td class="c">403</td><td>Front-load containers (4–8 CY)</td><td class="num">${CONT}</td><td class="c">EA</td><td>${LIFTS} lifts per week</td><td class="c">TE 7</td></tr>
<tr><td class="c">403</td><td>Roll-off containers (20–40 CY)</td><td class="num">${t72.length}</td><td class="c">EA</td><td>${PULLS} pulls per year</td><td class="c">TE 7</td></tr>
<tr><td class="c">403</td><td>Refuse and recyclables collected</td><td class="num">${fmt(TONS)}</td><td class="c">TONS</td><td>Per year</td><td class="c">TE 7</td></tr>
<tr class="grp"><td colspan="6">404 – MAINTENANCE – GROUNDS</td></tr>
<tr><td class="c">404</td><td>Improved grounds</td><td class="num">${f1(IMP)}</td><td class="c">AC</td><td>24 mowing cycles</td><td class="c">TE 6</td></tr>
<tr><td class="c">404</td><td>Semi-improved grounds</td><td class="num">${f1(SEMI)}</td><td class="c">AC</td><td>4–8 mowing cycles</td><td class="c">TE 6</td></tr>
<tr><td class="c">404</td><td>Unimproved grounds</td><td class="num">${f1(UNIMP)}</td><td class="c">AC</td><td>1–2 cuttings</td><td class="c">TE 6</td></tr>
<tr><td class="c">404</td><td>Athletic fields</td><td class="num">${f1(ATH)}</td><td class="c">AC</td><td>48 mowing cycles</td><td class="c">TE 6</td></tr>
<tr><td class="c">404</td><td>Shrub and planting beds</td><td class="num">${fmt(BEDS)}</td><td class="c">SF</td><td>Weed 6 times; mulch 1 time</td><td class="c">TE 6</td></tr>
<tr><td class="c">404</td><td>Parking lots (policing and sweeping)</td><td class="num">${fmt(PARK)}</td><td class="c">SY</td><td>Sweep 4 times</td><td class="c">TE 6</td></tr>
<tr><td class="c">404</td><td>Sidewalks and walkways</td><td class="num">${fmt(WALK)}</td><td class="c">SF</td><td>Police weekly in season</td><td class="c">TE 6</td></tr>
<tr class="grp"><td colspan="6">408 – SNOW, ICE AND SAND REMOVAL</td></tr>
<tr><td class="c">408</td><td>Roads and streets, Priorities 1–3</td><td class="num">50.8</td><td class="c">LM</td><td>14 events per season (fixed price)</td><td class="c">TE 8</td></tr>
<tr><td class="c">408</td><td>Parking areas cleared, Priorities 1–3 (part of TE 6 parking)</td><td class="num">115,600</td><td class="c">SY</td><td>Per event</td><td class="c">TE 8</td></tr>
<tr><td class="c">408</td><td>Sidewalks and entrances cleared (part of TE 6 sidewalks)</td><td class="num">172,500</td><td class="c">SF</td><td>Per event</td><td class="c">TE 8</td></tr>
<tr class="grp"><td colspan="6">510 – PEST MANAGEMENT</td></tr>
<tr><td class="c">510</td><td>Scheduled structural services (Table 9-1 facilities)</td><td class="num">17</td><td class="c">BLDG</td><td>Monthly or quarterly</td><td class="c">TE 9</td></tr>
<tr><td class="c">510</td><td>Pest management service calls (DMO)</td><td class="num">320</td><td class="c">EA</td><td>Per year (estimate)</td><td class="c">TE 10</td></tr>
<tr class="grp"><td colspan="6">420 – FACILITY MAINTENANCE</td></tr>
<tr><td class="c">420</td><td>Demand Maintenance Orders</td><td class="num">4,700</td><td class="c">EA</td><td>Per year (estimate)</td><td class="c">TE 10</td></tr>
</table>`;

const te4rows = [
  ['Restrooms, locker rooms and showers – clean and disinfect fixtures, partitions, floors', '2X daily', '2X daily', '1X daily'],
  ['Restock toilet tissue, towels, soap and seat covers', '2X daily', '2X daily', '1X daily'],
  ['Empty trash and recycling receptacles; replace liners', '1X daily', '1X daily', '1X daily'],
  ['Empty and disinfect diaper pails', '2X daily', 'N/A', 'N/A'],
  ['Sanitize cribs, cots, mats, toys, tables and chairs', '1X daily', 'N/A', 'N/A'],
  ['Sweep or dust-mop hard floors', '1X daily', '1X daily', '1X daily'],
  ['Damp-mop hard floors', '1X daily', '1X daily', '1X weekly'],
  ['Vacuum carpet – traffic lanes and open areas', '1X daily', '1X daily', '1X daily'],
  ['Vacuum carpet – edges, corners and under furniture', '1X weekly', '1X weekly', '1X monthly'],
  ['Spot-clean carpet', '1X daily', '1X weekly', '1X monthly'],
  ['Spray buff resilient floors', '1X weekly', '1X weekly', '1X monthly'],
  ['Strip and refinish resilient floors', '2X yearly', '2X yearly', '1X yearly'],
  ['Hot-water extract carpet', '2X yearly', '2X yearly', '1X yearly'],
  ['Clean entrance doors and glass', '1X daily', '1X daily', '1X weekly'],
  ['Clean interior glass and partitions', '1X weekly', '1X weekly', '1X monthly'],
  ['Clean exterior windows to 12 ft (both sides)', '2X yearly', '2X yearly', '1X yearly'],
  ['Dust horizontal surfaces below 7 ft', '1X daily', '1X weekly', '1X weekly'],
  ['High dust above 7 ft; vents and light fixtures', '1X monthly', '1X monthly', '1X quarterly'],
  ['Clean and sanitize drinking fountains', '1X daily', '1X daily', '1X daily'],
  ['Break rooms – counters, sinks, appliance exteriors, tables', '1X daily', '1X daily', '1X daily'],
  ['Disinfect fitness equipment contact surfaces and mats', 'N/A', '1X daily', 'N/A'],
  ['Dust-mop wood gymnasium floors', 'N/A', '2X daily', 'N/A'],
  ['Screen and recoat wood gymnasium floors', 'N/A', '1X yearly', 'N/A'],
  ['Clean saunas and steam rooms', 'N/A', '1X daily', 'N/A'],
  ['Flush floor drains', '1X weekly', '1X weekly', '1X weekly'],
  ['Wash walls, doors and frames (spot)', '1X weekly', '1X weekly', '1X monthly'],
];
const te4 = `
<p class="tcap">TECHNICAL EXHIBIT 4 – CUSTODIAL CLEANING STANDARDS AND FREQUENCIES</p>
<p class="tsub">"Daily" tasks are performed on each service day of the facility (TE 5, column 13; PWS 2.1.9 and 2.1.10). Example: in a 3W facility, a "1X daily" task is performed three times per week.</p>
<table class="t">
<tr><th class="l" style="width:52%">Task</th><th>Capability I<br>Enhanced</th><th>Capability II<br>Standard</th><th>Capability III<br>Basic</th></tr>
${te4rows.map((r) => `<tr><td>${r[0]}</td><td class="c">${r[1]}</td><td class="c">${r[2]}</td><td class="c">${r[3]}</td></tr>`).join('\n')}
</table>
<div class="fn">
<p><b>Standards.</b> Floors: free of dust, dirt, litter, gum, stains, streaks and build-up; uniform gloss on finished floors. Restrooms: fixtures free of soil, scale, stains and odors; dispensers full and operable. Carpets: free of visible soil, litter and spots. Glass: free of smudges and streaks. Trash: receptacles empty, clean and lined. CYS facilities: surfaces sanitized with an EPA-registered sanitizer at the dilution required by the label and AR 608-10.</p>
</div>`;

const te5 = `
<p class="tcap">TECHNICAL EXHIBIT 5 – CUSTODIAL FACILITY LIST</p>
<p class="tsub">Real property data as of 30 SEP 2026 (RPLANS / GFEBS). CSF verified by DPW Operations and Maintenance Division, OCT 2026. Frequency codes per PWS 2.1.9.</p>
<table class="ex">
${te5Head}
${te5Body}
</table>
${te5Notes}`;

const te6 = `
<p class="tcap">TECHNICAL EXHIBIT 6 – GROUNDS MAINTENANCE AREAS</p>
<p class="tsub">Mowing season 1 May – 15 October (24 weeks). Areas measured from DPW GIS, SEP 2026. See TE 11 for maps of each area.</p>
<p class="tt">Table 6-1. Grounds Areas by Type</p>
<table class="t sm">
<tr><th>Area ID</th><th class="l" style="width:52%">Area Description</th><th>Grounds Type</th><th>Quantity</th><th>Unit</th><th>Mowing Cycles<br>(# Times Annually)</th><th>PWS Para</th></tr>
${g61.map((r) => `<tr><td class="c">${r[0]}</td><td>${esc(r[1])}</td><td class="c">${r[2]}</td><td class="num">${f1(r[3])}</td><td class="c">AC</td><td class="c">${r[4]}</td><td class="c">${r[5]}</td></tr>`).join('\n')}
<tr class="x"><td class="c">${g61x[0]}</td><td>${esc(g61x[1])}</td><td class="c">${g61x[2]}</td><td class="num">${f1(g61x[3])}</td><td class="c">AC</td><td class="c">—</td><td class="c">—</td></tr>
<tr class="sub"><td></td><td>Subtotal – Improved (G-01 through G-06)</td><td></td><td class="num">${f1(IMP)}</td><td class="c">AC</td><td></td><td></td></tr>
<tr class="sub"><td></td><td>Subtotal – Semi-Improved (G-07 through G-10)</td><td></td><td class="num">${f1(SEMI)}</td><td class="c">AC</td><td></td><td></td></tr>
<tr class="sub"><td></td><td>Subtotal – Unimproved (G-11 and G-12)</td><td></td><td class="num">${f1(UNIMP)}</td><td class="c">AC</td><td></td><td></td></tr>
<tr class="grand"><td></td><td>TOTAL – CONTRACT GROUNDS, TABLE 6-1 (excludes G-13)</td><td></td><td class="num">${f1(GT61)}</td><td class="c">AC</td><td></td><td></td></tr>
</table>
<p class="tt">Table 6-2. Athletic Fields</p>
<table class="t sm">
<tr><th>Field</th><th class="l" style="width:52%">Location</th><th>Quantity</th><th>Unit</th><th>Mowing<br>(# Times Annually)</th><th>Lining<br>(# Times Annually)</th></tr>
${g62.map((r, i) => `<tr><td class="c">${r[0]}</td><td>${esc(r[1])}</td><td class="num">${f1(r[2])}</td><td class="c">AC</td><td class="c">48</td><td class="c">${[34, 34, 22, 30][i]}</td></tr>`).join('\n')}
<tr class="grand"><td></td><td>TOTAL – ATHLETIC FIELDS (not included in Table 6-1)</td><td class="num">${f1(ATH)}</td><td class="c">AC</td><td></td><td class="c">120</td></tr>
</table>
<p class="tt">Table 6-3. Landscaped Beds and Paved Areas</p>
<table class="t sm">
<tr><th>Item</th><th class="l" style="width:46%">Description</th><th>Quantity</th><th>Unit</th><th class="l">Estimated Workload (# Times Annually)</th><th>PWS Para</th></tr>
<tr><td class="c">1</td><td>Shrub and planting beds (mulched)</td><td class="num">${fmt(BEDS)}</td><td class="c">SF</td><td>Weed 6; prune 1; mulch 1</td><td class="c">5.3.6</td></tr>
<tr><td class="c">2</td><td>Parking lots – policing and sweeping (Note 6)</td><td class="num">${fmt(PARK)}</td><td class="c">SY</td><td>Police 38; sweep 4; spring sand removal 1</td><td class="c">5.3.7</td></tr>
<tr><td class="c">3</td><td>Sidewalks, walkways and building entrances – policing</td><td class="num">${fmt(WALK)}</td><td class="c">SF</td><td>Police 38; blow after each mowing</td><td class="c">5.3.7</td></tr>
<tr><td class="c">4</td><td>Edging – walks and curbs adjacent to improved grounds (workload only; not an area)</td><td class="num">${fmt(EDGE)}</td><td class="c">LF</td><td>Edge 12</td><td class="c">5.3.2</td></tr>
</table>
<div class="fn">
<p><b>NOTES:</b></p>
<p>1. Quantities are horizontal (plan) areas. Building footprints, pavements and beds are excluded from turf acreage.</p>
<p>2. Grounds types are defined in PWS 2.1.11 through 2.1.13. Mowing cycles are the estimated number of complete mowings per year.</p>
<p>3. G-08: maintain 7–14 in. IAW the Brannock AAF BASH Plan; coordinate with Airfield Operations 24 hours in advance (PWS 5.3.3).</p>
<p>4. G-09: escort required inside the ASP fence; schedule with the ASP supervisor 24 hours in advance.</p>
<p>5. G-13 (146.0 AC) is maintained by the RCI partner and is listed for information only. It is not part of this contract and is not included in any subtotal or total.</p>
<p>6. Parking lots include the motor pool hardstands and ASP lots (16,200 SY) that are policed and swept under this contract but cleared of snow by the using units (TE 8, Note 1).</p>
<p>7. Fertilizer, herbicide and pre-emergent applications on grounds areas are listed in TE 9, Table 9-2, and are performed under CLS 510.</p>
</div>`;

const te7 = `
<p class="tcap">TECHNICAL EXHIBIT 7 – REFUSE COLLECTION WORKLOAD</p>
<p class="tsub">Container inventory as of 30 SEP 2026. Building numbers identify the container location and the facilities served; they do not indicate custodial service (see TE 5).</p>
<p class="tt">Table 7-1. Front-Load Containers</p>
<table class="t">
<tr><th>No.</th><th class="l">Location / Facilities Served</th><th>Bldg No(s).</th><th>Stream</th><th>Size (CY)</th><th>Qty</th><th>Pickups per Week</th><th>Lifts per Week</th></tr>
${t71.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r[0])}</td><td class="c">${r[1]}</td><td class="c">${r[2]}</td><td class="c">${r[3]}</td><td class="c">${r[4]}</td><td class="c">${r[5]}</td><td class="c">${r[4] * r[5]}</td></tr>`).join('\n')}
<tr class="grand"><td></td><td colspan="4">TOTAL – FRONT-LOAD CONTAINERS</td><td class="c">${CONT}</td><td></td><td class="c">${LIFTS}</td></tr>
</table>
<p class="tt">Table 7-2. Roll-Off Containers</p>
<table class="t">
<tr><th>No.</th><th class="l">Location / Material</th><th>Bldg No.</th><th>Size (CY)</th><th>Qty</th><th>Estimated Pulls per Year</th></tr>
${t72.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r[0])}</td><td class="c">${r[1]}</td><td class="c">${r[2]}</td><td class="c">${r[3]}</td><td class="c">${r[4]}</td></tr>`).join('\n')}
<tr class="grand"><td></td><td colspan="3">TOTAL – ROLL-OFF</td><td class="c">${t72.length}</td><td class="c">${PULLS}</td></tr>
</table>
<p class="tt">Table 7-3. Estimated Annual Quantities</p>
<table class="t" style="width:70%">
<tr><th class="l">Waste Stream</th><th>Estimated Tons per Year</th></tr>
${t73.map((r) => `<tr><td>${esc(r[0])}</td><td class="num">${fmt(r[1])}</td></tr>`).join('\n')}
<tr class="grand"><td>TOTAL</td><td class="num">${fmt(TONS)}</td></tr>
</table>
<div class="fn">
<p><b>NOTES:</b> 1. MSW = municipal solid waste; OCC = old corrugated cardboard; CMR = commingled recyclables (paper, plastics 1–2, aluminum and steel cans). 2. Bldg 1100: regulated medical waste is removed by the MEDCOM contractor and is excluded (PWS 5.2.6). 3. Range complex containers are serviced 1 April – 30 November only; quantities shown are in-season. 4. Bldgs 1100, 1310, 1550 and 1600 are not serviced under CLS 402 (PWS 1.2.1, 5.1.13).</p>
</div>`;

const te8 = `
<p class="tcap">TECHNICAL EXHIBIT 8 – SNOW AND ICE REMOVAL AREAS AND PRIORITIES</p>
<p class="tsub">Snow season 15 October – 30 April. Priorities and response times per PWS 5.4.3. Maps of each priority are in TE 11.</p>
<p class="tt">Table 8-1. Roads and Streets</p>
<table class="t">
<tr><th>Priority</th><th class="l" style="width:58%">Routes</th><th>Lane-Miles</th><th>Response</th></tr>
<tr><td class="c">1</td><td>Brannock Boulevard (Main Gate to Brannock AAF); Hollister Avenue; access routes to the Army Health Clinic (1100), Military Police Station (1030), Fire Station No. 1 (1032), Visitor Control Center (1034) and Airfield Operations (2602)</td><td class="num">16.4</td><td>Passable within 2 hours; maintained during event</td></tr>
<tr><td class="c">2</td><td>CYS campus loop (3101–3112); barracks and battalion area (1402–1405); NCO Academy (2104A/B); Dining Facility (1310); fitness complex; motor pool access roads</td><td class="num">22.8</td><td>By 0600 next duty day</td></tr>
<tr><td class="c">3</td><td>All other paved installation roads, excluding family housing streets (RCI) and range roads</td><td class="num">11.6</td><td>Within 24 hours after event</td></tr>
<tr class="grand"><td></td><td>TOTAL – ROADS AND STREETS</td><td class="num">50.8</td><td></td></tr>
</table>
<p class="tt">Table 8-2. Parking Areas, Sidewalks and Entrances (areas are part of TE 6, Table 6-3)</p>
<table class="t">
<tr><th>Priority</th><th class="l" style="width:52%">Facilities Served</th><th>Parking (SY)</th><th>Sidewalks and Entrances (SF)</th></tr>
<tr><td class="c">1</td><td>1001, 1030, 1032, 1034, 1100, 2602</td><td class="num">21,600</td><td class="num">38,200</td></tr>
<tr><td class="c">2</td><td>1310, 1402–1405, 1520, 1524, 2104A, 2104B, 3101–3112</td><td class="num">54,300</td><td class="num">81,400</td></tr>
<tr><td class="c">3</td><td>All other lots and walks listed in TE 6, Table 6-3, except Notes 1 and 2</td><td class="num">39,700</td><td class="num">52,900</td></tr>
<tr class="grand"><td></td><td>TOTAL CLEARED BY CONTRACTOR</td><td class="num">115,600</td><td class="num">172,500</td></tr>
</table>
<p class="tt">Table 8-3. Snow Season Planning Data</p>
<table class="t" style="width:80%">
<tr><th class="l">Item</th><th>Quantity</th><th>Unit</th></tr>
<tr><td>Normal seasonal snowfall (30-year normal)</td><td class="num">64</td><td class="c">IN</td></tr>
<tr><td>Snow events of 2 inches or more included in CLIN 0005</td><td class="num">14</td><td class="c">EVENTS / SEASON</td></tr>
<tr><td>Estimated ice-control applications (included in CLIN 0005)</td><td class="num">24</td><td class="c">EA / SEASON</td></tr>
<tr><td>Government salt stockpile capacity (Facility 2416)</td><td class="num">1,200</td><td class="c">TONS</td></tr>
</table>
<div class="fn">
<p><b>NOTES:</b> 1. Motor pool hardstands and ASP lots (16,200 SY of the 131,800 SY in TE 6, Table 6-3) are cleared by the using units and are not included above. 2. Seasonal walks at the outdoor pool, outdoor recreation center and athletic fields (23,800 SF of the 196,300 SF in TE 6, Table 6-3) are not cleared. 3. Airfield pavements are cleared by the Government; the Contractor clears only the Airfield Operations parking lot and entrances.</p>
</div>`;

const te9 = `
<p class="tcap">TECHNICAL EXHIBIT 9 – PEST MANAGEMENT WORKLOAD</p>
<p class="tsub">Facilities and areas are listed for pest management only. Listing in this exhibit does not indicate custodial service (see TE 5).</p>
<p class="tt">Table 9-1. Scheduled Structural Pest Management Services</p>
<table class="t">
<tr><th class="l">Facility Group</th><th>Bldg Nos.</th><th>No. of Bldgs</th><th>Service</th><th>Frequency</th></tr>
<tr><td>Food service (Dining Facility, Commissary, Bowling Center snack bar, Brannock Club)</td><td class="c">1310, 1600, 1540, 1550</td><td class="c">4</td><td class="c">Inspect / treat</td><td class="c">Monthly</td></tr>
<tr><td>Child, Youth and School Services (low-risk methods only)</td><td class="c">3101, 3104, 3108, 3110, 3112</td><td class="c">5</td><td class="c">Inspect / monitor</td><td class="c">Monthly</td></tr>
<tr><td>Medical (Army Health Clinic, Veterinary Treatment Facility)</td><td class="c">1100, 1106</td><td class="c">2</td><td class="c">Inspect / treat</td><td class="c">Monthly</td></tr>
<tr><td>UPH barracks (including bed bug monitoring)</td><td class="c">1402, 1403, 1404</td><td class="c">3</td><td class="c">Inspect / treat</td><td class="c">Quarterly</td></tr>
<tr><td>Warehouses and CIF (stored product pests)</td><td class="c">2402, 2404, 2406</td><td class="c">3</td><td class="c">Inspect / treat</td><td class="c">Quarterly</td></tr>
<tr class="grand"><td colspan="2">TOTAL – SCHEDULED FACILITIES</td><td class="c">17</td><td></td><td></td></tr>
<tr><td>All other occupied facilities, installation-wide (estimated 2,846,300 SF of structural area; approx. 5% treated per year)</td><td class="c">—</td><td class="c">—</td><td class="c">Inspect</td><td class="c">Quarterly</td></tr>
</table>
<p class="tt">Table 9-2. Vegetation, Turf and Outdoor Pest Management</p>
<table class="t">
<tr><th class="l" style="width:50%">Description</th><th>Quantity</th><th>Unit</th><th>Applications / Services (# Times Annually)</th></tr>
<tr><td>Broadleaf weed control – improved grounds and athletic fields (TE 6, Tables 6-1 and 6-2)</td><td class="num">${f1(IMP + ATH)}</td><td class="c">AC</td><td class="c">2</td></tr>
<tr><td>Pre-emergent crabgrass control – athletic fields</td><td class="num">${f1(ATH)}</td><td class="c">AC</td><td class="c">1</td></tr>
<tr><td>Turf fertilization – athletic fields and G-01, G-03</td><td class="num">${f1(ATH + 21.6 + 8.9)}</td><td class="c">AC</td><td class="c">3</td></tr>
<tr><td>Fence-line and pavement-edge vegetation control</td><td class="num">41,800</td><td class="c">LF</td><td class="c">2</td></tr>
<tr><td>Mosquito larviciding – stormwater ponds (portion of TE 6, G-12)</td><td class="num">22.0</td><td class="c">AC</td><td class="c">Up to 6</td></tr>
<tr><td>Mosquito and tick surveillance traps (1 June – 30 September)</td><td class="num">12</td><td class="c">EA</td><td class="c">17 (weekly)</td></tr>
<tr><td>Exterior rodent bait stations</td><td class="num">186</td><td class="c">EA</td><td class="c">12</td></tr>
<tr><td>Termite inspection – wood-frame facilities</td><td class="num">38</td><td class="c">BLDG</td><td class="c">1</td></tr>
</table>
<div class="fn"><p><b>NOTE:</b> Turf and vegetation quantities in Table 9-2 are treatment areas for CLS 510. They overlap the grounds areas in TE 6 and are not additional grounds to be maintained under CLS 404.</p></div>`;

const te10 = `
<p class="tcap">TECHNICAL EXHIBIT 10 – HISTORICAL WORKLOAD DATA</p>
<p class="tsub">The workload data below is provided for historical purposes only. It does not represent a guarantee of future workload.</p>
<p class="tt">Table 10-1. Current Contract</p>
<table class="t">
<tr><th class="l" style="width:34%">Item</th><th class="l">Information</th></tr>
<tr><td>Contract number</td><td>W9131B-22-C-0003</td></tr>
<tr><td>Contractor</td><td>Northwoods Integrated Services, LLC</td></tr>
<tr><td>Contract type</td><td>Firm-fixed price with cost-reimbursable DMO material line items</td></tr>
<tr><td>Date of award</td><td>27 June 2022</td></tr>
<tr><td>Period of performance</td><td>1 July 2022 – 30 June 2027 (12-month base period and four 12-month option periods; 60 months)</td></tr>
<tr><td>Total contract value, base period and all option periods (as awarded)</td><td>$38,947,260</td></tr>
<tr><td>Services included</td><td>CLS 402, 403, 404, 408 and 420. Pest management (CLS 510) was performed under a separate contract, W9131B-23-P-0118, and is consolidated into this requirement.</td></tr>
</table>
<p class="tt">Table 10-2. Demand Maintenance Orders Received, by Priority</p>
<table class="t">
<tr><th class="l">Priority</th><th>FY23</th><th>FY24</th><th>FY25</th></tr>
<tr><td>Emergency (Priority 1)</td><td class="num">412</td><td class="num">388</td><td class="num">431</td></tr>
<tr><td>Urgent (Priority 2)</td><td class="num">1,186</td><td class="num">1,240</td><td class="num">1,207</td></tr>
<tr><td>Routine (Priority 3)</td><td class="num">2,964</td><td class="num">3,102</td><td class="num">3,058</td></tr>
<tr class="grand"><td>TOTAL DMOs</td><td class="num">4,562</td><td class="num">4,730</td><td class="num">4,696</td></tr>
<tr><td>Labor hours recorded</td><td class="num">21,840</td><td class="num">22,615</td><td class="num">22,390</td></tr>
</table>
<p class="tt">Table 10-3. Demand Maintenance Orders by Craft, FY25</p>
<table class="t" style="width:70%">
<tr><th class="l">Craft</th><th>DMOs</th><th>Labor Hours</th></tr>
<tr><td>Carpentry / structural</td><td class="num">812</td><td class="num">4,120</td></tr>
<tr><td>Electrical</td><td class="num">954</td><td class="num">4,385</td></tr>
<tr><td>Plumbing</td><td class="num">1,106</td><td class="num">5,210</td></tr>
<tr><td>Heating, ventilation and air conditioning</td><td class="num">1,018</td><td class="num">5,640</td></tr>
<tr><td>Locksmith</td><td class="num">386</td><td class="num">1,180</td></tr>
<tr><td>Painting</td><td class="num">214</td><td class="num">1,240</td></tr>
<tr><td>Other</td><td class="num">206</td><td class="num">615</td></tr>
<tr class="grand"><td>TOTAL FY25</td><td class="num">4,696</td><td class="num">22,390</td></tr>
</table>
<p class="tt">Table 10-4. Custodial Services</p>
<table class="t">
<tr><th class="l">Item</th><th>FY23</th><th>FY24</th><th>FY25</th></tr>
<tr><td>Facilities serviced (30 September)</td><td class="num">46</td><td class="num">46</td><td class="num">47</td></tr>
<tr><td>CSF serviced (30 September)</td><td class="num">538,215</td><td class="num">541,880</td><td class="num">546,680</td></tr>
<tr><td>Special and emergency cleaning requests</td><td class="num">52</td><td class="num">47</td><td class="num">58</td></tr>
<tr><td>Resilient floor area stripped and refinished (SF)</td><td class="num">186,400</td><td class="num">192,800</td><td class="num">179,600</td></tr>
<tr><td>Carpet area extracted (SF)</td><td class="num">238,400</td><td class="num">244,100</td><td class="num">249,800</td></tr>
<tr><td>Validated customer complaints</td><td class="num">31</td><td class="num">26</td><td class="num">22</td></tr>
</table>
<p class="tt">Table 10-5. Grounds Maintenance</p>
<table class="t">
<tr><th class="l">Item</th><th>FY23</th><th>FY24</th><th>FY25</th></tr>
<tr><td>Special-event mowing and trimming (EA)</td><td class="num">18</td><td class="num">22</td><td class="num">20</td></tr>
<tr><td>Trees removed by DMO (EA)</td><td class="num">31</td><td class="num">26</td><td class="num">38</td></tr>
<tr><td>Storm debris clean-ups (EA)</td><td class="num">3</td><td class="num">1</td><td class="num">4</td></tr>
<tr><td>Athletic field linings (EA)</td><td class="num">114</td><td class="num">126</td><td class="num">119</td></tr>
</table>
<p class="tt">Table 10-6. Refuse Removal and Recycling (tons)</p>
<table class="t">
<tr><th class="l">Stream</th><th>FY23</th><th>FY24</th><th>FY25</th></tr>
<tr><td>Municipal solid waste</td><td class="num">1,182</td><td class="num">1,164</td><td class="num">1,146</td></tr>
<tr><td>Recyclables (OCC and CMR)</td><td class="num">266</td><td class="num">279</td><td class="num">288</td></tr>
<tr><td>Construction and demolition debris</td><td class="num">452</td><td class="num">398</td><td class="num">410</td></tr>
<tr class="grand"><td>TOTAL</td><td class="num">1,900</td><td class="num">1,841</td><td class="num">1,844</td></tr>
<tr><td>Additional lifts requested (EA)</td><td class="num">44</td><td class="num">39</td><td class="num">41</td></tr>
</table>
<p class="tt">Table 10-7. Snow and Ice Removal</p>
<table class="t">
<tr><th class="l">Item</th><th>2022–23</th><th>2023–24</th><th>2024–25</th></tr>
<tr><td>Seasonal snowfall (IN)</td><td class="num">74</td><td class="num">39</td><td class="num">61</td></tr>
<tr><td>Snow events of 2 inches or more (EA)</td><td class="num">18</td><td class="num">9</td><td class="num">15</td></tr>
<tr><td>Ice-control-only call-outs (EA)</td><td class="num">9</td><td class="num">14</td><td class="num">8</td></tr>
<tr><td>Salt applied (TONS)</td><td class="num">812</td><td class="num">540</td><td class="num">705</td></tr>
<tr><td>Sand applied (TONS)</td><td class="num">1,380</td><td class="num">860</td><td class="num">1,240</td></tr>
</table>
<p class="tt">Table 10-8. Pest Management</p>
<table class="t">
<tr><th class="l">Item</th><th>FY23</th><th>FY24</th><th>FY25</th></tr>
<tr><td>Pest management service calls (DMO)</td><td class="num">318</td><td class="num">296</td><td class="num">342</td></tr>
<tr><td>Scheduled structural services performed</td><td class="num">150</td><td class="num">156</td><td class="num">156</td></tr>
<tr><td>Bed bug treatments (rooms)</td><td class="num">14</td><td class="num">9</td><td class="num">11</td></tr>
<tr><td>Surveillance trap collections</td><td class="num">198</td><td class="num">204</td><td class="num">204</td></tr>
</table>`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>W9131B-27-R-0006 Section J Attachment 0001 – PWS, Base Operations Support (BOS) Services, USAG Fort Brannock, WI</title>
<style>${css}</style></head><body>
<div class="sec first"><table class="frame"><tbody><tr><td>${cover}</td></tr></tbody></table></div>
${sec('Table of Contents', toc)}
${sec('PART 1 – GENERAL INFORMATION', part1)}
${sec('PART 2 – DEFINITIONS AND ACRONYMS', part2)}
${sec('PARTS 3 AND 4 – GFP / CFP', part34)}
${sec('PART 5 – SPECIFIC TASKS', part5a + part5b)}
${sec('PARTS 6 AND 7', part67)}
${sec('TE 1 – PRS &nbsp;|&nbsp; TE 2 – DELIVERABLES', te1)}
${sec('TE 3 – ESTIMATED WORKLOAD SUMMARY', te3)}
${sec('TE 4 – CUSTODIAL STANDARDS AND FREQUENCIES', te4)}
${sec('TE 5 – CUSTODIAL FACILITY LIST', te5, 'land')}
${sec('TE 6 – GROUNDS MAINTENANCE AREAS', te6)}
${sec('TE 7 – REFUSE COLLECTION WORKLOAD', te7)}
${sec('TE 8 – SNOW AND ICE REMOVAL', te8)}
${sec('TE 9 – PEST MANAGEMENT WORKLOAD', te9)}
${sec('TE 10 – HISTORICAL WORKLOAD DATA', te10)}
</body></html>
`;

fs.writeFileSync(path.join(here, 'att-0001-bos-pws.html'), html.replace(/(<p class="tt">[\s\S]*?<\/table>)/g, '<div class="blk">$1</div>'));

// merge generated expectations into truth.json (other fields are maintained by hand)
const truthPath = path.join(here, 'truth.json');
const truth = fs.existsSync(truthPath) ? JSON.parse(fs.readFileSync(truthPath, 'utf8')) : { expect: {} };
truth.expect = truth.expect || {};
truth.expect.facilities = truthFacilities;
truth.expect.facilitiesComplete = true;
truth.expect.grounds = truthGrounds;
fs.writeFileSync(truthPath, JSON.stringify(truth, null, 2) + '\n');

console.log(JSON.stringify({
  facilities: truthFacilities.length, lines: all.length, gsf: T.gsf, csf: T.csf, caps: gt.map((g) => [g.n, g.gsf, g.csf]),
  partB: [TB.n, TB.gsf, TB.csf], carpetIII, grounds: { IMP, SEMI, UNIMP, GT61, ATH }, refuse: { CONT, LIFTS, PULLS, TONS },
}, null, 1));
