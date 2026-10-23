#!/usr/bin/env node
// Generator for the va-medical-evs-pdf holdout fixture.
//   cd bos-estimator && node tests/holdout/va-medical-evs-pdf/gen.mjs
// Writes attachment-b-36c25227r0014.html (rendered to PDF by scripts/render-fixtures.mjs) and truth.json from ONE
// table of rows, so Table B-1 / B-2 / B-3 / B-4, the group subtotals, the Amendment 0001 Was/Is figures and
// truth.json always agree. No randomness: every value below is written out by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOL = '36C25227R0014';
const VAMC = 'Elk Prairie VA Medical Center';
const HCS = 'Elk Prairie VA Health Care System';
const HTML_NAME = 'attachment-b-36c25227r0014.html';

// Service Schedule Codes (Note 5) -> ServiceLevel id
const CODES = {
  A: { text: '24 hours a day, 7 days a week, including Federal holidays (24/7/365)', level: 'daily_7' },
  B: { text: '7 days a week, 0600-2230 (day and evening shifts), including Federal holidays', level: 'daily_7' },
  C: { text: 'Monday through Saturday, excluding Federal holidays', level: 'daily_6' },
  D: { text: 'Monday through Friday, excluding Federal holidays', level: 'daily_5' },
  E: { text: 'Monday, Wednesday and Friday, excluding Federal holidays', level: '3x_week' },
  F: { text: 'Tuesday and Thursday, excluding Federal holidays', level: '2x_week' },
  G: { text: 'Once per week, on a day designated by the COR', level: 'weekly' },
};

// ---------------------------------------------------------------------------------------------------------------
// Table B-3: Building 1 by floor / unit. Building 1's CSF in Table B-1 is the sum of these rows.
// [floor, areas, H, M, L, code, remarks]
const B3 = [
  ['B', 'Main corridors, loading dock, staff locker rooms, mail room, EMS offices and housekeeping closets', 0, 0, 21460, 'A', 'Locker rooms and corridors 24/7'],
  ['1', 'Emergency Department (incl. 2 trauma/resuscitation rooms), Radiology / CT, Main Lobby and Information Desk, Outpatient Pharmacy waiting', 14820, 38640, 9880, 'A', 'ED terminal cleaning on call within 30 min.'],
  ['2', 'Operating Room suite (8 ORs), PACU, Same-Day Surgery, Cardiac Cath Lab, GI Endoscopy', 32560, 9215, 4340, 'A', 'Between-case cleaning on call; nightly terminal clean of all ORs. SPS excluded (see below)'],
  ['3', 'Medical / Surgical ICU (24 beds), Step-Down Unit, Respiratory Therapy', 11580, 21960, 3820, 'A', ''],
  ['4', 'Medical / Surgical Inpatient Units 4 East and 4 West', 0, 36450, 4120, 'A', ''],
  ['5', 'Telemetry 5 East; Med / Surg 5 West (incl. 6 negative-pressure isolation rooms)', 0, 35980, 4250, 'A', 'Isolation rooms: discharge / terminal cleaning per Note 4'],
  ['6', 'Pathology and Laboratory Medicine (24/7 core lab); Specialty Clinics (Cardiology, Pulmonary)', 0, 31640, 10980, 'A / D', 'Specialty Clinic areas (9,150 SF) Code D'],
  ['7', 'Executive and Service Line offices, Medical Media, Medical Library, Education classrooms', 0, 0, 27920, 'D', 'Restrooms and elevator lobbies on floor 7 follow Code A'],
];
const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
const B1H = sum(B3, (r) => r[2]), B1M = sum(B3, (r) => r[3]), B1L = sum(B3, (r) => r[4]);

// ---------------------------------------------------------------------------------------------------------------
// Table B-1 rows. grp A/B/C = in contract scope, D = not in scope (information only).
// { b: bldg no, n: building name, u: primary use / occupant, f: floors above grade, bs: basement, beds, gsf, h, m, l,
//   code, rem: remarks, cat: truth category (omitted when the use is not clear-cut), st: status for group D / deleted }
const GROUPS = {
  A: 'GROUP A - INPATIENT AND RESIDENTIAL CARE BUILDINGS',
  B: 'GROUP B - OUTPATIENT CLINICAL BUILDINGS',
  C: 'GROUP C - ADMINISTRATIVE AND SUPPORT BUILDINGS',
  D: 'GROUP D - BUILDINGS AND AREAS NOT IN CONTRACT SCOPE (FOR INFORMATION ONLY - DO NOT PRICE)',
};
const ROWS = [
  // Group A
  { g: 'A', b: '1', n: 'Main Hospital', u: 'Acute inpatient, Surgery, ICU, Emergency Dept., Imaging, Laboratory', f: 7, bs: 'Y', beds: '152', gsf: 486240, h: B1H, m: B1M, l: B1L, code: 'A', rem: 'CSF by floor and unit in Table B-3. SPS (11,420 SF) not in CSF - Note 7(a).', cat: 'medical', star: true },
  { g: 'A', b: '2', n: 'Behavioral Health Inpatient', u: 'Acute inpatient mental health (locked units)', f: 3, bs: 'Y', beds: '44', gsf: 62410, h: 0, m: 37880, l: 9470, code: 'A', rem: 'Escort required on locked units - Note 9.', cat: 'medical' },
  { g: 'A', b: '7', n: 'Domiciliary', u: 'Domiciliary Residential Rehabilitation Treatment Program (DRRTP)', f: 3, bs: 'Y', beds: '80', gsf: 54300, h: 0, m: 9860, l: 14215, code: 'B', rem: 'Resident rooms (21,640 SF) cleaned by residents; not in CSF - Note 8.' },
  { g: 'A', b: '7A', n: 'Domiciliary Annex', u: 'DRRTP group therapy rooms, dining room, laundry room', f: 1, bs: 'N', beds: '', gsf: 8920, h: 0, m: 2880, l: 4360, code: 'B', rem: 'Dining room after each meal; no food prep (meals delivered by NFS).' },
  { g: 'A', b: '200', n: 'Community Living Center (CLC)', u: 'Long-term care, short-stay rehab, hospice / palliative care', f: 2, bs: 'N', beds: '120', gsf: 104780, h: 0, m: 70260, l: 12350, code: 'A', rem: 'Six neighborhoods; resident rooms daily + terminal clean on discharge.', cat: 'medical' },
  { g: 'A', b: '210', n: 'Spinal Cord Injury / Disorders (SCI/D) Center', u: 'SCI/D inpatient unit, outpatient SCI clinic, aquatic therapy', f: 2, bs: 'Y', beds: '30', gsf: 88450, h: 4120, m: 52980, l: 9105, code: 'A', rem: 'High risk = SCI wound care suite and aquatic therapy pool deck.', cat: 'medical' },
  // Group B
  { g: 'B', b: '6', n: 'Prosthetics and Audiology Building', u: 'Prosthetic & Sensory Aids Service; Audiology & Speech Pathology clinics', f: 2, bs: 'N', beds: '', gsf: 22640, h: 0, m: 12430, l: 5215, code: 'D', rem: 'Orthotic lab shop floor (2,300 SF) cleaned by PSAS staff.', cat: 'medical' },
  { g: 'B', b: '9', n: 'Mental Health Outpatient Clinic', u: 'General MH clinic, PTSD Clinical Team, Primary Care-MH Integration', f: 2, bs: 'Y', beds: '', gsf: 31880, h: 0, m: 18240, l: 6910, code: 'D', rem: 'Evening group therapy Tue/Thu until 2000.', cat: 'medical', amdL: 8450 },
  { g: 'B', b: '27', n: 'Community Resource and Referral Center (CRRC)', u: 'Homeless Programs, HUD-VASH, walk-in resource center, shower and laundry for Veterans', f: 2, bs: 'N', beds: '', gsf: 18960, h: 0, m: 7950, l: 6230, code: 'C', rem: 'Veteran shower rooms cleaned twice daily.' },
  { g: 'B', b: '100', n: 'Ambulatory Care Center', u: 'Primary Care (PACT), Specialty Clinics, Ambulatory Surgery / Endoscopy, Outpatient Lab', f: 4, bs: 'N', beds: '', gsf: 148600, h: 9840, m: 82315, l: 22940, code: 'C', rem: 'Saturday clinics 0700-1600. High risk = Ambulatory Surgery suite.', cat: 'medical' },
  { g: 'B', b: '101', n: 'Dental Clinic', u: 'Dental Service, Oral Surgery', f: 1, bs: 'N', beds: '', gsf: 14280, h: 2960, m: 6840, l: 2105, code: 'D', rem: 'Oral surgery rooms: between-case cleaning on call.', cat: 'medical' },
  { g: 'B', b: '102', n: 'Imaging Annex', u: 'MRI (2 suites), PET-CT, Nuclear Medicine', f: 1, bs: 'N', beds: '', gsf: 12450, h: 0, m: 7880, l: 1960, code: 'B', rem: 'MRI Zone IV: MRI-safe equipment only. Hot lab not cleaned.', cat: 'medical' },
  { g: 'B', b: '103', n: 'Dialysis Center', u: 'Outpatient hemodialysis, home dialysis training', f: 1, bs: 'N', beds: '24 sta.', gsf: 15360, h: 8940, m: 2810, l: 1375, code: 'C', rem: 'Stations cleaned between patient shifts (3 shifts / day).', cat: 'medical' },
  { g: 'B', b: 'T-37', n: "Women's Health Modular", u: "Women's Health Center swing space (temporary modular)", f: 1, bs: 'N', beds: '', gsf: 6720, h: 0, m: 4260, l: 1140, code: 'D', rem: 'Temporary building - Note 10.', cat: 'medical' },
  // Group C
  { g: 'C', b: '3', n: 'Administration Building', u: "Director's Office, Human Resources, Fiscal, Business Office, Contracting", f: 3, bs: 'Y', beds: '', gsf: 41250, h: 0, m: 0, l: 34180, code: 'D', rem: 'Basement records storage (4,120 SF) not cleaned.', cat: 'admin' },
  { g: 'C', b: '4', n: 'Nutrition and Food Service Building', u: 'Central production kitchen, tray line, NFS offices', f: 1, bs: 'Y', beds: '', gsf: 32600, h: 0, m: 0, l: 4980, code: 'B', rem: 'Offices, staff restrooms and locker rooms only. Kitchen, tray line and dish room cleaned by NFS staff - Note 7(b).' },
  { g: 'C', b: '5A', n: 'Voluntary Service Building', u: 'Voluntary Service, DAV transportation office, Veterans Service Organization offices', f: 1, bs: 'N', beds: '', gsf: 5980, h: 0, m: 0, l: 4870, code: 'D', rem: '', cat: 'admin' },
  { g: 'C', b: '10', n: 'Education and Conference Center', u: 'Auditorium (320 seats), classrooms, simulation lab', f: 2, bs: 'N', beds: '', gsf: 19840, h: 0, m: 0, l: 16320, code: 'D', rem: 'Weekend events cleaned on request as additional work.' },
  { g: 'C', b: '11', n: 'Engineering Service Building', u: 'Facilities Management offices and maintenance shops', f: 2, bs: 'N', beds: '', gsf: 36920, h: 0, m: 0, l: 5840, code: 'E', rem: 'Offices, restrooms, locker and break rooms only; shop floors by Engineering.', cat: 'maintenance' },
  { g: 'C', b: '12', n: 'Warehouse', u: 'Logistics / Supply Chain Management receiving and storage', f: 1, bs: 'N', beds: '', gsf: 48600, h: 0, m: 0, l: 3260, code: 'F', rem: 'Offices, receiving restroom and break room only; storage bays not cleaned.', cat: 'warehouse' },
  { g: 'C', b: '14', n: 'VA Police Building', u: 'VA Police Service, Emergency Management, Badge Office', f: 1, bs: 'N', beds: '', gsf: 7480, h: 0, m: 0, l: 6150, code: 'A', rem: 'Holding room cleaned on request.' },
  { g: 'C', b: '16', n: 'Chapel', u: 'Chaplain Service chapel and offices', f: 1, bs: 'N', beds: '', gsf: 6240, h: 0, m: 0, l: 5310, code: 'G', rem: '', cat: 'community', amdCode: 'F' },
  { g: 'C', b: '17', n: 'Employee Wellness and Fitness Center', u: 'Employee fitness center, locker rooms, Employee Whole Health', f: 1, bs: 'N', beds: '', gsf: 9860, h: 0, m: 0, l: 8420, code: 'D', rem: 'Locker rooms and showers twice daily.', cat: 'fitness' },
  { g: 'C', b: '24', n: 'Office of Information and Technology (OIT) Building', u: 'OIT offices, Help Desk', f: 2, bs: 'N', beds: '', gsf: 21340, h: 0, m: 0, l: 14760, code: 'D', rem: 'Data center and telecom rooms (4,980 SF) not cleaned.', cat: 'admin' },
  { g: 'C', b: '25', n: 'Fleet Garage', u: 'Fleet vehicle maintenance, Patient Transportation, Grounds shop', f: 1, bs: 'N', beds: '', gsf: 18200, h: 0, m: 0, l: 2140, code: 'F', rem: 'Dispatch office, driver lounge and restrooms only.', cat: 'maintenance' },
  { g: 'C', b: 'T-38', n: 'Telehealth Modular', u: 'Telehealth hub, release-of-information scanning (temporary modular)', f: 1, bs: 'N', beds: '', gsf: 4320, h: 0, m: 0, l: 3860, code: 'D', rem: 'Temporary building - Note 10.', cat: 'admin', deleted: true },
  // Group D: not in scope
  { g: 'D', b: '5', n: 'Research and Development Building', u: 'Research Service laboratories, Veterinary Medical Unit (VMU)', f: 3, bs: 'Y', gsf: 58740, rem: 'EXCLUDED - cleaned under separate Research Service contract - Note 7(c).' },
  { g: 'D', b: '13', n: 'Boiler Plant', u: 'Central steam plant', f: 1, bs: 'N', gsf: 12860, rem: 'EXCLUDED - cleaned by Engineering boiler plant operators.' },
  { g: 'D', b: '15', n: 'Canteen Building', u: 'Veterans Canteen Service (VCS) retail store and Patriot Cafe', f: 1, bs: 'N', gsf: 14520, rem: 'EXCLUDED - cleaned by VCS - Note 7(d).' },
  { g: 'D', b: '18', n: 'Child Development Center', u: 'Out-leased to a non-VA operator (enhanced-use lease)', f: 1, bs: 'N', gsf: 11640, rem: 'EXCLUDED - out-leased; tenant provides janitorial - Note 7(e).' },
  { g: 'D', b: '19', n: 'Fisher House', u: 'Family lodging (Fisher House Foundation)', f: 2, bs: 'N', gsf: 15200, rem: 'EXCLUDED - Note 7(e).' },
  { g: 'D', b: '20', n: 'Parking Garage', u: 'Five-level parking structure (1,150 spaces)', f: 5, bs: 'N', gsf: 412000, rem: 'EXCLUDED - elevator lobbies and stairs swept by Engineering - Note 7(f).' },
  { g: 'D', b: '21', n: "Former Nurses' Quarters", u: 'Vacant since 2019', f: 3, bs: 'Y', gsf: 28300, rem: 'VACANT - no service - Note 7(i).' },
  { g: 'D', b: '23', n: 'Former Laundry', u: 'Vacant; demolition planned FY2029', f: 1, bs: 'N', gsf: 22450, rem: 'VACANT - no service - Note 7(i).' },
  { g: 'D', b: '300', n: 'New Community Living Center', u: 'Under construction; estimated occupancy FY2029', f: 2, bs: 'N', gsf: 96400, h: 0, m: 61250, l: 13550, code: 'A', rem: 'OPTIONAL LINE ITEM 1001 ONLY - est. CSF shown; not included in totals - Note 11.', option: true },
];
// Building 41 is added by Amendment 0001 (Group C)
const ADD41 = { g: 'C', b: '41', n: 'Whole Health and Telehealth Center', u: 'Whole Health, Telehealth hub (new modular, occupancy 1 May 2027)', f: 1, bs: 'N', beds: '', gsf: 9600, h: 0, m: 6140, l: 1820, code: 'D' }; // category left out: Whole Health + Telehealth is neither clearly clinical nor admin

// Table B-2: CBOCs (no building numbers)
const CBOC = [
  { n: 'Pine Hollow CBOC', addr: '1180 Commerce Drive, Pine Hollow, WI', own: 'Leased (janitorial by VA)', mi: 38, f: 1, gsf: 24800, h: 0, m: 14260, l: 6180, code: 'D', rem: 'Clinic hours M-F 0730-1630.', cat: 'medical' },
  { n: 'Ellery CBOC', addr: '455 Mill Street, Ellery, WI', own: 'VA-owned', mi: 61, f: 1, gsf: 11250, h: 0, m: 6720, l: 2410, code: 'D', rem: 'Includes Mobile Medical Unit pad restroom.', cat: 'medical' },
  { n: 'Marston CBOC', addr: '2900 Lakeshore Road, Suite 100, Marston, WI', own: 'Leased (full service)', mi: 74, f: 2, gsf: 18400, rem: 'EXCLUDED - janitorial provided by Lessor under the lease - Note 7(h).', excluded: true },
  { n: 'Tamarack Lake CBOC', addr: '72 Harbor Street, Tamarack Lake, WI', own: 'Leased (janitorial by VA)', mi: 92, f: 1, gsf: 4860, h: 0, m: 2640, l: 1170, code: 'E', rem: 'Part-time clinic open Mon, Wed, Fri.', cat: 'medical' },
];

// ---------------------------------------------------------------------------------------------------------------
const fmt = (n) => n.toLocaleString('en-US');
const dash = (n) => (n ? fmt(n) : '&ndash;');
const csf = (r) => r.h + r.m + r.l;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&rsquo;');

const inScope = ROWS.filter((r) => r.g !== 'D');
const grp = (g, rows = inScope) => rows.filter((r) => r.g === g);
const totals = (rows) => ({ n: rows.length, gsf: sum(rows, (r) => r.gsf), h: sum(rows, (r) => r.h), m: sum(rows, (r) => r.m), l: sum(rows, (r) => r.l) });
const tot = (t) => t.h + t.m + t.l;
const T = { A: totals(grp('A')), B: totals(grp('B')), C: totals(grp('C')) };
const TB1 = totals(inScope);
const cbocIn = CBOC.filter((c) => !c.excluded);
const TB2 = totals(cbocIn);
const TD = { n: grp('D', ROWS).length, gsf: sum(grp('D', ROWS), (r) => r.gsf) };
const campusGsf = sum(ROWS.filter((r) => !r.option), (r) => r.gsf); // existing campus buildings (not Bldg 300)
const campusCount = ROWS.filter((r) => !r.option).length;

// Amended rows (post-Amendment 0001)
const amended = inScope.filter((r) => !r.deleted).map((r) => ({ ...r, l: r.amdL ?? r.l, code: r.amdCode ?? r.code }));
amended.push(ADD41);
const AT = { A: totals(amended.filter((r) => r.g === 'A')), B: totals(amended.filter((r) => r.g === 'B')), C: totals(amended.filter((r) => r.g === 'C')) };
const ATB1 = totals(amended);

// Summary by schedule code (original)
const byCode = {};
for (const r of [...inScope, ...cbocIn]) { byCode[r.code] ??= { n: 0, csf: 0 }; byCode[r.code].n++; byCode[r.code].csf += csf(r); }
const byCodeA = {};
for (const r of [...amended, ...cbocIn]) { byCodeA[r.code] ??= { n: 0, csf: 0 }; byCodeA[r.code].n++; byCodeA[r.code].csf += csf(r); }

// sanity
if (sum(Object.values(byCode), (x) => x.csf) !== tot(TB1) + tot(TB2)) throw new Error('code summary mismatch');

// ---------------------------------------------------------------------------------------------------------------
// HTML
const RH = (right) => `<div class="rh"><span>Department of Veterans Affairs &nbsp;|&nbsp; ${HCS} &nbsp;|&nbsp; Solicitation ${SOL} &nbsp;|&nbsp; EMS Housekeeping Services</span><span class="rr">${right}</span></div>`;
const RF = (mid) => `<div class="rf"><span>Attachment B &ndash; Facility Listing and Estimated Workload Data</span><span>${mid}</span><span>Issued 15 March 2027</span></div>`;
const RFA = (mid) => `<div class="rf"><span>Amendment 0001 to ${SOL}</span><span>${mid}</span><span>Effective 12 April 2027</span></div>`;

const B1_COLS = [3, 4, 12, 17, 3.2, 3.2, 4, 5.8, 5.6, 5.8, 5.8, 6, 5, 19.6];
const B1_HEAD = `<colgroup>${B1_COLS.map((w) => `<col style="width:${w}%">`).join('')}</colgroup><thead>
<tr><th class="g" colspan="8">BUILDING DATA</th><th class="g" colspan="4">ESTIMATED CLEANABLE SQUARE FEET (CSF) BY AREA CLASSIFICATION (Note 4)</th><th class="g">SERVICE</th><th class="g" rowspan="2">Remarks</th></tr>
<tr><th>Line No.</th><th>Bldg No.</th><th>Building Name</th><th>Primary Use / Occupant</th><th>Flrs (Note 12)</th><th>Bsmt</th><th>Oper. Beds / Sta.</th><th>Gross SF (GSF) (Note 2)</th><th>High Risk (Critical Care)</th><th>Moderate Risk (Patient Care)</th><th>Low Risk (Non-Patient Care)</th><th>Total CSF</th><th>Svc Sched Code (Note 5)</th></tr>
<tr class="colno"><td>(1)</td><td>(2)</td><td>(3)</td><td>(4)</td><td>(5)</td><td>(6)</td><td>(7)</td><td>(8)</td><td>(9)</td><td>(10)</td><td>(11)</td><td>(12)</td><td>(13)</td><td>(14)</td></tr>
</thead>`;

let line = 0;
const lineNo = new Map();
for (const r of ROWS) lineNo.set(r.b, ++line);
const b1Row = (r) => {
  const ln = lineNo.get(r.b);
  if (r.g === 'D' && !r.option) {
    return `<tr class="exc"><td class="c">${ln}</td><td class="c">${r.b}</td><td>${esc(r.n)}</td><td class="sm">${esc(r.u)}</td><td class="c">${r.f}</td><td class="c">${r.bs}</td><td class="c"></td><td class="num">${fmt(r.gsf)}</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="c">N/A</td><td class="sm">${esc(r.rem)}</td></tr>`;
  }
  return `<tr${r.option ? ' class="opt"' : ''}><td class="c">${ln}</td><td class="c">${r.b}</td><td>${esc(r.n)}</td><td class="sm">${esc(r.u)}</td><td class="c">${r.f}</td><td class="c">${r.bs}</td><td class="c">${r.beds ?? ''}</td><td class="num">${fmt(r.gsf)}</td><td class="num">${dash(r.h)}</td><td class="num">${dash(r.m)}</td><td class="num">${dash(r.l)}</td><td class="num"><b>${fmt(csf(r))}${r.star ? '*' : ''}</b></td><td class="c">${r.code}</td><td class="sm">${esc(r.rem)}</td></tr>`;
};
const subRow = (label, t) => `<tr class="sub"><td></td><td></td><td colspan="5">${label}</td><td class="num">${fmt(t.gsf)}</td><td class="num">${dash(t.h)}</td><td class="num">${dash(t.m)}</td><td class="num">${dash(t.l)}</td><td class="num">${fmt(tot(t))}</td><td></td><td></td></tr>`;
const grpRow = (g) => `<tr class="grp"><td colspan="14">${GROUPS[g]}</td></tr>`;
const contRow = (g) => `<tr class="grp"><td colspan="14">${GROUPS[g]} (continued)</td></tr>`;

// Split Group C across pages 4 and 5 so a group continues on a new page under a repeated header.
const grpC = grp('C');
const C1 = grpC.slice(0, 2), C2 = grpC.slice(2);

const page = (cls, right, footMid, body, foot = RF, head = RH) => `<div class="pg${cls ? ' ' + cls : ''}">
${head ? head(right) : ''}
${body}
${foot ? foot(footMid) : ''}
</div>`;
const RHA = (right) => `<div class="rh"><span>Solicitation ${SOL} &nbsp;|&nbsp; Amendment 0001</span><span class="rr">${right}</span></div>`;

const notesHead = `
<div class="tb">
  <div class="tb-l">DEPARTMENT OF VETERANS AFFAIRS<br>Network Contracting Office 12<br>${HCS}</div>
  <div class="tb-r"><b>Solicitation No. ${SOL}</b><br>Environmental Management Service (EMS)<br>Housekeeping Services</div>
</div>
<h1>ATTACHMENT B<br>FACILITY LISTING AND ESTIMATED WORKLOAD DATA<br><span class="h1s">(Cleanable Square Feet by Building, Area Classification and Service Schedule)</span></h1>
<table class="box">
<tr><th style="width:28%">Medical Center</th><td>${VAMC}, 2500 North Veterans Parkway, Elk Prairie, Wisconsin 54999</td></tr>
<tr><th>Campus</th><td>Approximately 186 acres; ${campusCount} existing buildings totaling ${fmt(campusGsf)} gross square feet (GSF), including the parking garage, plus one building under construction (Bldg 300)</td></tr>
<tr><th>Community Based Outpatient Clinics</th><td>Pine Hollow, Ellery, Marston and Tamarack Lake (Table B-2)</td></tr>
<tr><th>Period of performance</th><td>Base period 1 October 2027 &ndash; 30 September 2028, plus four (4) 12-month option periods, for a total potential period of performance of five (5) years</td></tr>
<tr><th>Contents</th><td>Notes 1&ndash;12 (pages B-1 and B-2); Table B-1 Facility Listing &ndash; Medical Center Campus (pages B-3 and B-4); Table B-2 Community Based Outpatient Clinics and Table B-3 Building 1 CSF by Floor and Unit (page B-5); Table B-4 Summary of Estimated CSF (page B-6)</td></tr>
</table>`;

const notes1 = `
<h2>Notes</h2>
<p><b>1. Purpose.</b> This attachment identifies the buildings and areas in which the Contractor shall provide housekeeping (environmental) services under the Performance Work Statement (PWS), and the estimated cleanable square feet (CSF) of each, for the base period and each option period. The Contractor shall furnish all management, supervision, labor, equipment, supplies and materials, except as stated in the PWS, to maintain the listed areas in a clean, safe and sanitary condition that meets the current standards of The Joint Commission and the Medical Center&rsquo;s Infection Prevention and Control policies.</p>
<p><b>2. Gross vs. cleanable square feet.</b> Column (8) Gross SF (GSF) is taken from the VA Capital Asset Inventory and is provided <u>for information only</u>. Columns (9)&ndash;(12) are the estimated cleanable square feet (CSF): the floor area the Contractor will clean, measured from the Medical Center&rsquo;s space data. CSF excludes mechanical, electrical and telecommunications rooms, shafts, penthouses, wall thickness, areas cleaned by other services (Note 7) and any area not listed. <b>Offerors shall base their staffing and pricing on Column (12), Total CSF.</b></p>
<p><b>3. Accuracy of data.</b> Square footages are estimates believed accurate to within plus or minus five percent (5%). Offerors are encouraged to attend the site visit and verify areas. Variations within this tolerance will not be the basis for a price adjustment. Areas may be added or deleted during performance by contract modification; unit prices per CSF by area classification will be used to price such changes.</p>
<p><b>4. Area classifications.</b> Each cleanable area is assigned one of three classifications based on infection risk:</p>
<table class="box sm">
<tr><th style="width:24%">Classification</th><th>Typical areas</th><th style="width:30%">Cleaning standard</th></tr>
<tr><td><b>High Risk (Critical Care)</b></td><td>Operating and procedure rooms, PACU, cardiac cath lab, endoscopy, ICU and step-down, ED treatment and trauma rooms, dialysis treatment floor, SCI wound care, oral surgery</td><td>Aseptic cleaning; between-case and terminal cleaning on call; daily terminal clean of ORs</td></tr>
<tr><td><b>Moderate Risk (Patient Care)</b></td><td>Inpatient and resident rooms, exam and treatment rooms, nurses&rsquo; stations, patient restrooms and showers, waiting rooms, laboratories, imaging, pharmacy, therapy areas</td><td>Daily disinfection of high-touch surfaces; discharge / terminal cleaning of patient rooms, including isolation rooms</td></tr>
<tr><td><b>Low Risk (Non-Patient Care)</b></td><td>Offices, conference rooms, classrooms, lobbies, corridors outside patient care units, stairwells, elevators, staff restrooms, locker and break rooms</td><td>Routine housekeeping</td></tr>
</table>
<p><b>5. Service Schedule Codes.</b> Column (13) assigns each building a Service Schedule Code. Restrooms, corridors, elevators and public areas of a building are serviced on the building&rsquo;s code.</p>
<table class="box sm codes">
<tr><th style="width:9%">Code</th><th>Service schedule</th></tr>
${Object.entries(CODES).map(([k, v]) => `<tr><td class="c"><b>${k}</b></td><td>${v.text}</td></tr>`).join('\n')}
</table>
`;

const notes2 = `
<p><b>6. Schedules within a building.</b> In Code A and Code B buildings, low-risk office suites are serviced Monday through Friday (Code D) unless noted otherwise; Table B-3 shows the areas of Building 1 that are serviced on Code D. Recognized Federal holidays are the eleven (11) holidays listed in PWS paragraph 1.6. When a holiday falls on a Saturday or Sunday, the preceding Friday or following Monday is observed.</p>
<p><b>7. Areas and services not included.</b> The following are not part of this contract and are not included in any CSF figure:</p>
<ol class="alpha">
<li>Sterile Processing Service (SPS) decontamination, preparation and packaging, and sterile storage areas in Building 1 (11,420 SF), which are cleaned by SPS staff;</li>
<li>Nutrition and Food Service (NFS) food production, tray line and dish room areas in Building 4;</li>
<li>Building 5, Research and Development, including the Veterinary Medical Unit, which is cleaned under a separate Research Service contract;</li>
<li>Veterans Canteen Service (VCS) retail store, Patriot Cafe and VCS storage in Building 15;</li>
<li>out-leased and non-VA operated space: Building 18 (Child Development Center, enhanced-use lease) and Building 19 (Fisher House, operated by the Fisher House Foundation);</li>
<li>Building 20, Parking Garage (412,000 GSF, 1,150 spaces);</li>
<li>Building 13, Boiler Plant, and all mechanical penthouses, which are cleaned by Engineering Service;</li>
<li>Marston CBOC, where janitorial services are provided by the Lessor under the lease;</li>
<li>vacant buildings: Building 21 (Former Nurses&rsquo; Quarters) and Building 23 (Former Laundry); and</li>
<li>grounds maintenance, snow and ice removal, parking lot sweeping and exterior trash enclosures, which are performed by Engineering Service. The Contractor is responsible only for building entrances, vestibules and the exterior area within ten (10) feet of each entrance.</li>
</ol>
<p><b>8. Domiciliary resident rooms.</b> Residents of the Domiciliary (Buildings 7 and 7A) clean their own rooms as part of the treatment program. Resident rooms (21,640 SF) are included in the GSF of Building 7 but not in its CSF. The Contractor cleans common areas, group rooms, restrooms and showers, and the dining room.</p>
<p><b>9. Locked and secured units.</b> Contractor employees shall be escorted on the locked units of Building 2 and in the VA Police holding room (Building 14), and shall follow the Medical Center&rsquo;s environment-of-care rounds for ligature-resistant settings.</p>
<p><b>10. Temporary buildings.</b> Buildings T-37 and T-38 are temporary modular buildings. They remain in the contract until the Contracting Officer issues a modification deleting them.</p>
<p><b>11. Optional Line Item 1001 &ndash; Building 300.</b> Building 300, New Community Living Center (96,400 GSF; estimated 74,800 CSF; Code A), is under construction with an estimated occupancy in FY2029. It is shown in Group D for planning purposes and is priced only as Optional Line Item 1001. It is not included in any total in this attachment. The Government is not obligated to exercise the optional line item.</p>
<p><b>12. Column definitions.</b> Column (1) Line No. is a reference number only. Column (5) counts floors above grade; Column (6) shows whether the building has a basement (Y/N). Column (7) shows operating beds (inpatient buildings) or dialysis stations (sta.) and is provided for information only. An asterisk (*) on a Total CSF figure refers to Table B-3.</p>
<p class="small">Questions concerning this attachment shall be submitted in writing to the Contracting Officer in accordance with the instructions to offerors. Data in this attachment is current as of 1 February 2027.</p>`;

const tableB1p1 = `
<p class="tcap">Table B-1. Facility Listing &ndash; ${VAMC} Campus</p>
<table class="ex">${B1_HEAD}<tbody>
${grpRow('A')}
${grp('A').map(b1Row).join('\n')}
${subRow(`Subtotal &ndash; Group A (${T.A.n} buildings)`, T.A)}
${grpRow('B')}
${grp('B').map(b1Row).join('\n')}
${subRow(`Subtotal &ndash; Group B (${T.B.n} buildings)`, T.B)}
${grpRow('C')}
${C1.map(b1Row).join('\n')}
</tbody></table>
<p class="cont">Group C continued on next page</p>`;

const tableB1p2 = `
<p class="tcap">Table B-1. Facility Listing &ndash; ${VAMC} Campus (continued)</p>
<table class="ex">${B1_HEAD}<tbody>
${contRow('C')}
${C2.map(b1Row).join('\n')}
${subRow(`Subtotal &ndash; Group C (${T.C.n} buildings)`, T.C)}
<tr class="grand"><td></td><td></td><td colspan="5">TOTAL &ndash; TABLE B-1, BUILDINGS IN CONTRACT SCOPE (GROUPS A&ndash;C, ${TB1.n} BUILDINGS)</td><td class="num">${fmt(TB1.gsf)}</td><td class="num">${fmt(TB1.h)}</td><td class="num">${fmt(TB1.m)}</td><td class="num">${fmt(TB1.l)}</td><td class="num">${fmt(tot(TB1))}</td><td></td><td></td></tr>
${grpRow('D')}
${grp('D', ROWS).map(b1Row).join('\n')}
<tr class="sub"><td></td><td></td><td colspan="5">Group D &ndash; GSF for information only (${TD.n} buildings; Bldg 300 design GSF)</td><td class="num">${fmt(TD.gsf)}</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td></td><td></td></tr>
</tbody></table>`;

const B2_HEAD = `<thead>
<tr><th style="width:3%">Line No.</th><th style="width:12%">Clinic</th><th style="width:15%">Address</th><th style="width:10%">Ownership</th><th style="width:4.2%">Miles from VAMC</th><th style="width:3.2%">Flrs</th><th style="width:6%">Gross SF (GSF)</th><th style="width:5.6%">High Risk</th><th style="width:6%">Moderate Risk</th><th style="width:5.8%">Low Risk</th><th style="width:6.2%">Total CSF</th><th style="width:4.6%">Svc Sched Code</th><th>Remarks</th></tr>
</thead>`;
const tableB2 = `
<p class="tcap">Table B-2. Community Based Outpatient Clinics (CBOCs)</p>
<table class="ex">${B2_HEAD}<tbody>
${CBOC.map((c, i) => c.excluded
    ? `<tr class="exc"><td class="c">${i + 1}</td><td>${esc(c.n)}</td><td class="sm">${esc(c.addr)}</td><td class="sm">${esc(c.own)}</td><td class="c">${c.mi}</td><td class="c">${c.f}</td><td class="num">${fmt(c.gsf)}</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="c">N/A</td><td class="sm">${esc(c.rem)}</td></tr>`
    : `<tr><td class="c">${i + 1}</td><td>${esc(c.n)}</td><td class="sm">${esc(c.addr)}</td><td class="sm">${esc(c.own)}</td><td class="c">${c.mi}</td><td class="c">${c.f}</td><td class="num">${fmt(c.gsf)}</td><td class="num">${dash(c.h)}</td><td class="num">${dash(c.m)}</td><td class="num">${dash(c.l)}</td><td class="num"><b>${fmt(csf(c))}</b></td><td class="c">${c.code}</td><td class="sm">${esc(c.rem)}</td></tr>`).join('\n')}
<tr class="grand"><td></td><td colspan="5">TOTAL &ndash; TABLE B-2, CBOCs IN CONTRACT SCOPE (${TB2.n} CLINICS)</td><td class="num">${fmt(TB2.gsf)}</td><td class="num">${dash(TB2.h)}</td><td class="num">${fmt(TB2.m)}</td><td class="num">${fmt(TB2.l)}</td><td class="num">${fmt(tot(TB2))}</td><td></td><td></td></tr>
</tbody></table>`;

const tableB3 = `
<p class="tcap" style="margin-top:12pt">Table B-3. Building 1, Main Hospital &ndash; Cleanable Square Feet by Floor and Unit</p>
<table class="ex b3">
<thead><tr><th style="width:5%">Floor</th><th>Units / Areas</th><th style="width:8%">High Risk CSF</th><th style="width:8%">Moderate Risk CSF</th><th style="width:8%">Low Risk CSF</th><th style="width:8%">Total CSF</th><th style="width:7%">Svc Sched Code</th><th style="width:22%">Remarks</th></tr></thead>
<tbody>
${B3.map((r) => `<tr><td class="c">${r[0]}</td><td class="sm">${esc(r[1])}</td><td class="num">${dash(r[2])}</td><td class="num">${dash(r[3])}</td><td class="num">${dash(r[4])}</td><td class="num">${fmt(r[2] + r[3] + r[4])}</td><td class="c">${r[5]}</td><td class="sm">${esc(r[6])}</td></tr>`).join('\n')}
<tr class="exc"><td class="c">2</td><td class="sm">Sterile Processing Service (SPS): decontamination, prep and pack, sterile storage (11,420 SF)</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="c">N/A</td><td class="sm">Not in CSF - cleaned by SPS staff - Note 7(a)</td></tr>
<tr class="exc"><td class="c">PH</td><td class="sm">Mechanical penthouse, electrical and telecom rooms, shafts (all floors)</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="num">&ndash;</td><td class="c">N/A</td><td class="sm">Not cleaned - Note 2</td></tr>
<tr class="grand"><td></td><td>BUILDING 1 TOTAL (agrees with Table B-1, Line ${lineNo.get('1')})</td><td class="num">${fmt(B1H)}</td><td class="num">${fmt(B1M)}</td><td class="num">${fmt(B1L)}</td><td class="num">${fmt(B1H + B1M + B1L)}</td><td></td><td></td></tr>
</tbody></table>`;

const codeOrder = Object.keys(CODES);
const tableB4 = `
<p class="tcap">Table B-4. Summary of Estimated Cleanable Square Feet</p>
<div class="two">
<table class="ex sum">
<thead><tr><th style="width:34%">Table</th><th>High Risk</th><th>Moderate Risk</th><th>Low Risk</th><th>Total CSF</th></tr></thead>
<tbody>
<tr><td>B-1 Campus, Groups A&ndash;C (${TB1.n} bldgs)</td><td class="num">${fmt(TB1.h)}</td><td class="num">${fmt(TB1.m)}</td><td class="num">${fmt(TB1.l)}</td><td class="num">${fmt(tot(TB1))}</td></tr>
<tr><td>B-2 CBOCs (${TB2.n} clinics)</td><td class="num">${dash(TB2.h)}</td><td class="num">${fmt(TB2.m)}</td><td class="num">${fmt(TB2.l)}</td><td class="num">${fmt(tot(TB2))}</td></tr>
<tr class="grand"><td>GRAND TOTAL CSF</td><td class="num">${fmt(TB1.h + TB2.h)}</td><td class="num">${fmt(TB1.m + TB2.m)}</td><td class="num">${fmt(TB1.l + TB2.l)}</td><td class="num">${fmt(tot(TB1) + tot(TB2))}</td></tr>
<tr><td>Percent of total</td><td class="num">${((TB1.h + TB2.h) / (tot(TB1) + tot(TB2)) * 100).toFixed(1)}%</td><td class="num">${((TB1.m + TB2.m) / (tot(TB1) + tot(TB2)) * 100).toFixed(1)}%</td><td class="num">${((TB1.l + TB2.l) / (tot(TB1) + tot(TB2)) * 100).toFixed(1)}%</td><td class="num">100.0%</td></tr>
</tbody></table>
<table class="ex sum">
<thead><tr><th style="width:18%">Svc Sched Code</th><th>No. of Bldgs / Clinics</th><th>Total CSF</th></tr></thead>
<tbody>
${codeOrder.filter((k) => byCode[k]).map((k) => `<tr><td class="c">${k}</td><td class="c">${byCode[k].n}</td><td class="num">${fmt(byCode[k].csf)}</td></tr>`).join('\n')}
<tr class="grand"><td class="c">Total</td><td class="c">${sum(Object.values(byCode), (x) => x.n)}</td><td class="num">${fmt(sum(Object.values(byCode), (x) => x.csf))}</td></tr>
</tbody></table>
</div>
<p class="small" style="margin-top:6pt">Buildings in Group D, Building 300 (Optional Line Item 1001) and Marston CBOC are not included in Table B-4. Table B-4 counts Building 1 once under Code A; the Code D areas of Building 1 shown in Table B-3 are not counted separately.</p>`;

// Amendment pages

const amd0 = `
<div class="sf30form">
<table class="f30">
<tr><td colspan="3" class="t30">AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT</td><td>1. CONTRACT ID CODE</td><td>PAGE 1 OF 3 PAGES</td></tr>
<tr><td>2. AMENDMENT/MODIFICATION NUMBER<br><b>0001</b></td><td>3. EFFECTIVE DATE<br><b>04-12-2027</b></td><td colspan="2">4. REQUISITION/PURCHASE REQ. NUMBER<br>&nbsp;</td><td>5. PROJECT NUMBER (if applicable)<br>None</td></tr>
<tr><td colspan="2">6. ISSUED BY &nbsp;&nbsp; CODE 36C252<br><b>Department of Veterans Affairs<br>Network Contracting Office 12</b></td><td colspan="3">7. ADMINISTERED BY (If other than Item 6) &nbsp;&nbsp; CODE<br>&nbsp;</td></tr>
<tr><td colspan="3">8. NAME AND ADDRESS OF CONTRACTOR (Number, street, county, State and ZIP Code)<br><br><b>To all Offerors/Bidders</b></td><td colspan="2">9A. AMENDMENT OF SOLICITATION NUMBER<br><b>${SOL}</b><br>9B. DATED (SEE ITEM 11)<br><b>03-15-2027</b><br>10A. MODIFICATION OF CONTRACT/ORDER NUMBER<br>&nbsp;<br>10B. DATED (SEE ITEM 13)</td></tr>
<tr><td colspan="5" class="c30"><b>11. THIS ITEM ONLY APPLIES TO AMENDMENTS OF SOLICITATIONS</b></td></tr>
<tr><td colspan="5">The above numbered solicitation is amended as set forth in Item 14. The hour and date specified for receipt of Offers &#9744; is extended, &#9746; is not extended. Offers must acknowledge receipt of this amendment prior to the hour and date specified in the solicitation or as amended, by one of the following methods: (a) By completing Items 8 and 15, and returning one (1) copy of the amendment; (b) By acknowledging receipt of this amendment on each copy of the offer submitted; or (c) By separate letter or electronic communication which includes a reference to the solicitation and amendment numbers. FAILURE OF YOUR ACKNOWLEDGMENT TO BE RECEIVED AT THE PLACE DESIGNATED FOR THE RECEIPT OF OFFERS PRIOR TO THE HOUR AND DATE SPECIFIED MAY RESULT IN REJECTION OF YOUR OFFER.</td></tr>
<tr><td colspan="5">12. ACCOUNTING AND APPROPRIATION DATA (If required)<br>N/A</td></tr>
<tr><td colspan="5" class="c30"><b>13. THIS ITEM APPLIES ONLY TO MODIFICATIONS OF CONTRACTS/ORDERS. IT MODIFIES THE CONTRACT/ORDER NO. AS DESCRIBED IN ITEM 14.</b><br>(Not applicable to this amendment)</td></tr>
<tr><td colspan="5">E. IMPORTANT: Contractor &#9746; is not &#9744; is required to sign this document and return ___ copies to the issuing office.</td></tr>
<tr><td colspan="5" class="i14">14. DESCRIPTION OF AMENDMENT/MODIFICATION (Organized by UCF section headings, including solicitation/contract subject matter where feasible.)<br><br>
Solicitation ${SOL}, Environmental Management Service (EMS) Housekeeping Services, ${VAMC}.<br><br>
The purpose of this Amendment is to revise Attachment B, Facility Listing and Estimated Workload Data, and to post responses to vendor questions. See continuation pages 2 and 3. The due date for receipt of proposals remains 28 April 2027, 2:00 PM Central Time.<br><br>
Except as provided herein, all terms and conditions of the document referenced in Item 9A or 10A, as heretofore changed, remain unchanged and in full force and effect.</td></tr>
<tr><td colspan="2">15A. NAME AND TITLE OF SIGNER (Type or print)<br>&nbsp;</td><td colspan="3">16A. NAME AND TITLE OF CONTRACTING OFFICER (Type or print)<br><b>Contracting Officer, NCO 12</b></td></tr>
<tr><td>15B. CONTRACTOR/OFFEROR<br><br>(Signature of person authorized to sign)</td><td>15C. DATE SIGNED</td><td colspan="2">16B. UNITED STATES OF AMERICA<br><br>(Signature of Contracting Officer)</td><td>16C. DATE SIGNED<br>04-12-2027</td></tr>
</table>
<div class="f30foot"><span>PREVIOUS EDITION NOT USABLE</span><span>STANDARD FORM 30 (REV. 11/2016)<br>Prescribed by GSA - FAR (48 CFR) 53.243</span></div>
</div>`;
const b9 = ROWS.find((r) => r.b === '9');
const b16 = ROWS.find((r) => r.b === '16');
const t38 = ROWS.find((r) => r.b === 'T-38');
const amd1 = `
<div class="sf30">
<div class="sf30h">AMENDMENT OF SOLICITATION/MODIFICATION OF CONTRACT<br>CONTINUATION PAGE</div>
<table class="box sm"><tr><th style="width:25%">Solicitation No.</th><td>${SOL}</td><th style="width:22%">Amendment No.</th><td>0001</td></tr>
<tr><th>Issued by</th><td>Department of Veterans Affairs, Network Contracting Office 12</td><th>Effective date</th><td>12 April 2027</td></tr></table>
</div>
<p><b>14. DESCRIPTION OF AMENDMENT/MODIFICATION (CONTINUED)</b></p>
<p>The purpose of this Amendment is to (1) revise Attachment B, Facility Listing and Estimated Workload Data, as set forth in Part I, and (2) post responses to vendor questions received through 2 April 2027 (Part II). The proposal due date is not extended. Offerors shall acknowledge this Amendment with their proposal.</p>
<h3>PART I &ndash; CHANGES TO ATTACHMENT B</h3>
<table class="box sm was">
<tr><th style="width:6%">Item</th><th style="width:15%">Location</th><th>Change</th><th style="width:19%">Was</th><th style="width:19%">Is</th></tr>
<tr><td class="c">1</td><td>Table B-1, Line ${lineNo.get('T-38')}, Bldg T-38</td><td>Building T-38, Telehealth Modular, is <b>deleted</b> from the contract. The building was vacated on 26 February 2027 and is scheduled for removal.</td><td>${fmt(t38.gsf)} GSF; ${fmt(csf(t38))} CSF (Low Risk); Code D</td><td>Deleted</td></tr>
<tr><td class="c">2</td><td>Table B-1, Group C (new line ${line + 1})</td><td><b>Add</b> Building 41 (B-41), Whole Health and Telehealth Center, a new modular building scheduled for occupancy on 1 May 2027. Telehealth functions from T-38 relocate to B-41. Floors 1; basement N; High Risk &ndash;; Moderate Risk ${fmt(ADD41.m)}; Low Risk ${fmt(ADD41.l)}; Service Schedule Code D.</td><td>Not listed</td><td>${fmt(ADD41.gsf)} GSF; ${fmt(csf(ADD41))} CSF; Code D</td></tr>
<tr><td class="c">3</td><td>Table B-1, Line ${lineNo.get('9')}, Bldg 9</td><td>Building 9, Mental Health Outpatient Clinic: Low Risk CSF corrected to include the basement group rooms and staff lounge omitted from the original count. GSF is unchanged.</td><td>Low Risk ${fmt(b9.l)}; Total CSF ${fmt(csf(b9))}</td><td>Low Risk ${fmt(b9.amdL)}; Total CSF ${fmt(b9.h + b9.m + b9.amdL)}</td></tr>
<tr><td class="c">4</td><td>Table B-1, Line ${lineNo.get('16')}, Bldg 16</td><td>Building 16, Chapel: Service Schedule Code revised. Services now include a Tuesday memorial service and a Thursday interfaith service.</td><td>Code ${b16.code} (once per week)</td><td>Code ${b16.amdCode} (Tuesday and Thursday)</td></tr>
<tr><td class="c">5</td><td>Table B-1 subtotals and total; Table B-4</td><td>Revised totals resulting from Items 1&ndash;3 (Table B-2 is unchanged):</td><td>Group B ${fmt(tot(T.B))}; Group C ${fmt(tot(T.C))}; Table B-1 total ${fmt(tot(TB1))} CSF (${TB1.n} bldgs); Grand total ${fmt(tot(TB1) + tot(TB2))} CSF</td><td>Group B ${fmt(tot(AT.B))}; Group C ${fmt(tot(AT.C))}; Table B-1 total ${fmt(tot(ATB1))} CSF (${ATB1.n} bldgs); Grand total ${fmt(tot(ATB1) + tot(TB2))} CSF</td></tr>
</table>
<p class="small">Revised Table B-4 by area classification: High Risk ${fmt(ATB1.h + TB2.h)}; Moderate Risk ${fmt(ATB1.m + TB2.m)}; Low Risk ${fmt(ATB1.l + TB2.l)}; Grand Total ${fmt(tot(ATB1) + tot(TB2))} CSF. A conformed Attachment B will not be issued; offerors shall price the attachment as revised by this Amendment.</p>`;

const amd2 = `
<h3>PART II &ndash; QUESTIONS AND ANSWERS</h3>
<div class="qa">
<p><b>1. Question:</b> Should pricing be based on the gross square footage or the cleanable square footage?</p>
<p><b>Response:</b> Cleanable square footage. Offerors shall price Column (12), Total CSF, as revised by this Amendment. Column (8) GSF is information only (Attachment B, Note 2).</p>
<p><b>2. Question:</b> Are the resident rooms in the Domiciliary (Building 7) included in the CSF?</p>
<p><b>Response:</b> No. Residents clean their own rooms (Note 8). The 21,640 SF of resident rooms is not in the CSF. When a resident is discharged, the Contractor shall perform a move-out clean of the room on request; this is included in the Building 7 price.</p>
<p><b>3. Question:</b> Please identify the incumbent contractor, the current contract number and the current contract value.</p>
<p><b>Response:</b> The current contract is 36C25222C0087, awarded on 26 September 2022 to Brightwater Environmental Services Group, LLC for a base year and four option years. Option Year 4 (1 October 2026 &ndash; 30 September 2027) was exercised at $7,316,480.00 for the 12-month period. Payments under the contract from 1 October 2022 through 28 February 2027 (53 months) total $30,912,764.18. The scope of the current contract differs from this solicitation; Buildings 102 and 103 were added by modification in 2024.</p>
<p><b>4. Question:</b> Will the Contractor be required to clean the elevator lobbies or stairwells in the parking garage (Building 20)?</p>
<p><b>Response:</b> No. Building 20 is excluded in its entirety (Note 7(f)).</p>
<p><b>5. Question:</b> Is the new Community Living Center (Building 300) part of the base requirement?</p>
<p><b>Response:</b> No. Building 300 is priced only as Optional Line Item 1001 (Note 11). If the optional line item is exercised, the estimated CSF is 74,800 at Service Schedule Code A, with an estimated occupancy of 1 June 2029.</p>
<p><b>6. Question:</b> Does the Code A schedule for Building 1 apply to the administrative offices on the 7th floor?</p>
<p><b>Response:</b> No. Per Note 6 and Table B-3, the 7th floor offices are serviced on Code D. Restrooms and elevator lobbies on the 7th floor follow Code A.</p>
<p><b>7. Question:</b> What are the hours of the CBOCs, and is Marston CBOC included?</p>
<p><b>Response:</b> Pine Hollow and Ellery CBOCs are open Monday through Friday, 0730&ndash;1630. Tamarack Lake CBOC is open Monday, Wednesday and Friday, 0800&ndash;1630. Cleaning may be performed after clinic hours. Marston CBOC is not included; janitorial services there are provided by the Lessor (Note 7(h)).</p>
<p><b>8. Question:</b> Can CAD floor plans be provided?</p>
<p><b>Response:</b> CAD files will not be released. Floor plans were available for review at the site visit held 30 March 2027 and will be provided to the awardee after contract award.</p>
<p><b>9. Question:</b> Who provides paper products, soap and can liners?</p>
<p><b>Response:</b> The Contractor provides all cleaning chemicals, equipment and can liners. The Government provides paper towels, toilet tissue, hand soap and hand sanitizer refills (PWS paragraph 5.2).</p>
</div>
<p class="small" style="margin-top:8pt">Except as provided herein, all terms and conditions of the document referenced in Item 9A, as heretofore changed, remain unchanged and in full force and effect.</p>`;

const css = `
  @page { size: Letter portrait; }
  @page land { size: Letter landscape; }
  .land { page: land; }
  body { font-family: "Times New Roman", Times, serif; font-size: 10pt; color: #000; margin: 0; }
  p { margin: 0 0 4.5pt; line-height: 1.18; text-align: justify; }
  .rh { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; border-bottom: 0.75pt solid #000; padding-bottom: 2pt; margin-bottom: 8pt; display: flex; justify-content: space-between; gap: 12pt; }
  .rh .rr { font-weight: bold; white-space: nowrap; }
  .rf { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; border-top: 0.5pt solid #000; padding-top: 2pt; margin-top: 6pt; display: flex; justify-content: space-between; }
  .pg { page-break-after: always; }
  .pg:last-child { page-break-after: auto; }
  .tb { display: flex; justify-content: space-between; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; font-weight: bold; border-bottom: 2pt solid #000; padding-bottom: 4pt; margin-bottom: 8pt; }
  .tb-r { text-align: right; }
  h1 { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; text-align: center; margin: 2pt 0 5pt; line-height: 1.2; }
  h1 .h1s { font-size: 9.5pt; font-weight: normal; }
  h2 { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; margin: 5pt 0 4pt; text-transform: uppercase; }
  h3 { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; margin: 8pt 0 4pt; }
  table.box { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 3pt 0 6pt; }
  table.box td, table.box th { border: 0.75pt solid #000; padding: 1.5pt 5pt; vertical-align: top; text-align: left; }
  table.box th { background: #d9d9d9; }
  table.box.sm { font-size: 8pt; }
  table.box.codes td, table.box.codes th { padding: 1.2pt 5pt; }
  table.ex { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 7.1pt; line-height: 1.08; table-layout: fixed; }
  table.ex th { border: 0.75pt solid #000; background: #d9d9d9; padding: 1.5pt 2pt; vertical-align: bottom; font-size: 6.8pt; }
  table.ex th.g { background: #bfbfbf; vertical-align: middle; }
  table.ex td { border: 0.5pt solid #000; padding: 1pt 2.5pt; vertical-align: top; overflow-wrap: break-word; }
  table.ex tr.colno td { text-align: center; font-size: 6pt; padding: 0.5pt; background: #f2f2f2; }
  table.ex tr.grp td { background: #404040; color: #fff; font-weight: bold; padding: 1.5pt 4pt; }
  table.ex tr.sub td { background: #ececec; font-weight: bold; }
  table.ex tr.grand td { background: #d0d0d0; font-weight: bold; border-top: 1.5pt double #000; }
  table.ex tr.exc td { color: #333; background: #f7f7f7; font-style: italic; }
  table.ex tr.opt td { background: #fff8dc; font-style: italic; }
  table.ex.b3 { font-size: 7.4pt; }
  table.ex.sum { font-size: 7.6pt; }
  .two { display: flex; gap: 14pt; align-items: flex-start; } .two table:first-child { flex: 1.6; } .two table:last-child { flex: 1; }
  td.c { text-align: center; } td.num { text-align: right; white-space: nowrap; } td.sm { font-size: 6.6pt; }
  p.tcap { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; font-weight: bold; margin: 2pt 0 3pt; text-align: center; }
  p.cont { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; font-style: italic; text-align: right; margin: 2pt 0; }
  ol.alpha { list-style: lower-alpha; margin: 0 0 5pt 22pt; padding: 0; } ol.alpha li { margin-bottom: 1.5pt; line-height: 1.18; }
  .small { font-family: Arial, sans-serif; font-size: 8pt; }
  .sf30 { border: 1.25pt solid #000; padding: 4pt 6pt; margin-bottom: 8pt; }
  .sf30h { font-family: Arial, Helvetica, sans-serif; font-weight: bold; font-size: 9.5pt; text-align: center; margin-bottom: 4pt; }
  table.was td { font-size: 8.2pt; }
  .qa p { margin-bottom: 3.5pt; }
  table.f30 { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 7.6pt; line-height: 1.2; }
  table.f30 td { border: 0.75pt solid #000; padding: 3pt 4pt; vertical-align: top; }
  table.f30 td.t30 { font-size: 10pt; font-weight: bold; text-align: center; vertical-align: middle; }
  table.f30 td.c30 { text-align: center; background: #eee; }
  table.f30 td.i14 { height: 190pt; font-size: 8.6pt; }
  .f30foot { display: flex; justify-content: space-between; font-family: Arial, sans-serif; font-size: 7pt; margin-top: 2pt; }
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${SOL} Attachment B - Facility Listing and Estimated Workload Data (with Amendment 0001)</title>
<style>${css}</style></head><body>
${page('', 'Page B-1', 'Page B-1', notesHead + notes1)}
${page('', 'Page B-2', 'Page B-2', notes2)}
${page('land', 'Page B-3', 'Page B-3', tableB1p1)}
${page('land', 'Page B-4', 'Page B-4', tableB1p2)}
${page('land', 'Page B-5', 'Page B-5', tableB2 + tableB3)}
${page('land', 'Page B-6', 'Page B-6', tableB4)}
${page('', '', '', amd0, null, null)}
${page('', 'Page 2 of 3', 'Page 2 of 3', amd1, RFA, RHA)}
${page('', 'Page 3 of 3', 'Page 3 of 3', amd2, RFA, RHA)}
</body></html>
`;
fs.writeFileSync(path.join(here, HTML_NAME), html);

// ---------------------------------------------------------------------------------------------------------------
// truth.json
const tf = (r) => {
  const o = {};
  if (r.b) o.buildingNumber = r.b;
  o.name = r.n;
  o.grossSqft = r.gsf;
  o.cleanableSqft = csf(r);
  if (r.f != null) o.floors = r.f;
  o.serviceLevel = CODES[r.code].level;
  if (r.cat) o.category = r.cat;
  return o;
};
const facilities = [...amended.map(tf), ...cbocIn.map(tf)];

const PROVENANCE = {
  fidelity: 'real-format',
  sources: [
    { url: 'https://imlive.s3.amazonaws.com/Federal%20Government/ID135467017274262374363648670899572058680/Attachment%202%20HAMS%20PWS.pdf', note: 'Hospital Aseptic Management Systems (HAMS) Performance-Based Work Statement, 35th Medical Group, Misawa AB (68 pp.; downloaded and read with pdftotext -layout). Military hospital housekeeping, the closest readable analog of a VA EVS workload attachment. Appendix A "Estimated Workload Data" (Building # / Name / Sq Ft to be cleaned / TOTAL) and the "Workload by Sq Ft / BASE CODE" crosstab are the model for Table B-1 and Table B-4; the BASE cleaning code listing, where each code fuses a day pattern with an area risk ("7 Day Non case-Driven Critical Care", "5 Day All Other Areas", "2 Day All Other Areas on Tuesday & Thursday", "3 Day ... Monday, Wednesday, Friday", "0 Not Cleaned"), is the model for the coded Service Schedule column and the Note 5 legend; the critical care / patient use / all other areas definitions are the model for the High / Moderate / Low Risk classes (Note 4); the per-building room listings with "Sum" rows are the model for Table B-3; the holiday exception for wards and the OR is the model for Codes A/B. Format only; no rows copied. The real appendix carries an internal inconsistency (Bldg 1760 is 3,877 SF in the first table but 3,040 in the crosstab total row); the fixture does not reproduce it.' },
    { url: 'https://imlive.s3.amazonaws.com/Federal%20Government/ID45087456464175768965815377536122301544/36C25018R0005-064.pdf', note: 'VA clinic lease 36C25018L0003 (GSA Form L100), Section 6.07 Janitorial Services (downloaded and read). VA wording reused or paraphrased: housekeeping to "the current standards of the Joint Commission", isolation areas that need terminal cleaning, separate hours for "Direct Patient Care Areas", EPA-registered germicide for all patient areas, Monday-Friday work schedule. Shows that in a leased VA clinic the Lessor provides janitorial services, which is the basis for the Marston CBOC exclusion (Table B-2, Note 7(h)).' },
    { url: 'https://imlive.s3.amazonaws.com/Federal%20Government/ID58103017219499690749812197545078656787/S06.%2036C26321Q0187%200003.pdf', note: 'VA Network Contracting Office 23, Amendment 0003 to janitorial RFQ 36C26321Q0187 (SF 30 plus continuation page; downloaded and read). Model for the Amendment 0001 pages: SF 30 block layout and wording (Items 2-16, "To all Offerors/Bidders", "The purpose of this Amendment is to post responses to vendor questions", "Except as provided herein, all terms and conditions ... remain unchanged"), and the continuation page "Questions and Answers" in "Question: / Response:" form with questions on square footage by floor type, floor plans, the prior contract ("Is this a first-time labor and materials contract? Response: No"), consumables and storage rooms.' },
    { url: 'https://imlive.s3.amazonaws.com/Federal%20Government/ID151682101211780583073746200899112515222/PWS%20Attachment%2009132018.pdf', note: 'U.S. Coast Guard Base Seattle Janitorial Services PWS, HSCG84-17-R-PTE001 (downloaded and read). Building list where service covers only part of some buildings ("Entire bldg", "2nd FLOOR", "Foyer and Restroom", "See Exh. 5") with service hours per building, "Contractor shall only bill for the square footage serviced", and escorted cleaning in secure areas. Model for the partial-service rows (Bldgs 4, 11, 12, 25) and Note 9.' },
    { url: 'https://sam.gov/opp/9e4ffeb165cc4b5094f8b6ca7f6312e2/view', note: 'Portland VAMC (VA NCO 20) Sources Sought, Aug 2023, "Janitorial Services - Hospital Grade Housekeeping Cleaning, Non-Patient Care Areas": approximately 442,000 SF across various buildings, cleaning 7 days a week, base plus four option years. NOT FETCHED (SAM.gov is blocked from this sandbox); content known only from web-search summaries. Supports the patient care / non-patient care split, 7-day service and the base + 4 term.' },
    { url: 'https://sam.gov/opp/d5998a3a2f344dc6834296afce37d621/view', note: 'Oklahoma City VA Health Care System janitorial solicitation (base 09-01-2026 to 08-31-2027 plus four option years): "The total approximate square footage for each location is shown below", listing the medical center (about 353,720 SF) with Lawton Main, Lawton North and Stillwater CBOC areas; aseptic cleaning. NOT FETCHED; from web-search summaries. Supports one EVS contract covering a VAMC plus its CBOCs with SF per location (Table B-2).' },
    { url: 'https://sam.gov/opp/35e7e4ffb1ee47d6990c815af7ec36d0/view', note: 'Alaska VA Healthcare System Hospital Housekeeping Services RFP (2024; amendment 36C26024R0015): Muldoon Healthcare Center, the Domiciliary, Transitional Housing Apartments and three CBOCs in one housekeeping contract; the sources-sought notice gave an estimated 272,102 SF total and listed patient rooms, patient restrooms, patient care rooms, outpatient clinics and administrative areas. NOT FETCHED; from web-search summaries. Supports a Domiciliary and CBOCs inside the same EVS workload.' },
    { url: 'https://sam.gov/opp/f4a1d65e35a3de8e92564ad8b3cac1c2/view', note: 'Dayton VAMC "Housekeeping Cleaning - 17 Buildings", 36C250-18-Q-9337 (2018, SDVOSB); web-search summaries also describe the 2026 follow-on 36C25026Q0740 (about 20 buildings, about 622,750 SF, base plus four option years starting 1 October 2026). NOT FETCHED. Supports a VA campus of numbered buildings under one housekeeping contract and the 1 October start.' },
    { url: 'https://sam.gov/opp/efa0aba48a1b46baac5a2aa991e6e131/view', note: 'VA Eastern Colorado Health Care System (Southern Colorado) janitorial / housekeeping solicitation, Nov 2023, PSC S201: web-search summaries report areas stated per location as "Cleanable Square Footage" (e.g. 76,731 for Colorado Springs). NOT FETCHED. Supports the CSF terminology.' },
  ],
  notes: 'Every value is illustrative: the medical center (Elk Prairie VA Medical Center, a fictional campus in Wisconsin), its address, every building number, name, GSF, CSF, bed count and schedule, the CBOCs, the solicitation number (36C25227R0014, in the real NCO 12 "36C252" format), the amendment, the incumbent (Brightwater Environmental Services Group, LLC), contract 36C25222C0087 and its dollar figures. No rows were copied, so fidelity is real-format. Limits of the grounding: SAM.gov, va.gov and every bid mirror except S3-hosted PDFs were blocked from this sandbox, and the search index held no VA EVS workload attachment on S3, so no real VA EVS building table was read. The table layout and the risk-class / coded-schedule structure come from the HAMS appendix (a DoD hospital); the VA wording comes from the VA clinic lease janitorial clause and the VA NCO 23 amendment; the VA-specific scope (CBOCs, Domiciliary, CLC, SCI/D, CRRC, Veterans Canteen Service, Fisher House, enhanced-use lease, SPS and NFS self-cleaning, Optional Line Item for a new building) comes from the search-indexed VA notices above and the author\'s knowledge of VA medical center organization. The High / Moderate / Low Risk labels are a common healthcare EVS convention, not verified against a VA attachment. One file, 9 pages: Attachment B as issued (pages B-1 to B-6) followed by Amendment 0001 (SF 30 and two continuation pages). Generated with gen.mjs from one table, so every printed subtotal and total reconciles.',
};
const TRAPS = () => {
  const b1 = ROWS.find((r) => r.b === '1');
  return [
    `GSF vs CSF. Column (8) Gross SF is "for information only"; Columns (9)-(11) split the cleanable square feet (CSF) into High Risk (Critical Care), Moderate Risk (Patient Care) and Low Risk (Non-Patient Care), and Column (12) is Total CSF. Truth grossSqft = Column (8), cleanableSqft = Column (12), e.g. Main Hospital 486,240 GSF / ${fmt(csf(b1))} CSF. A reader that takes one risk column, or the GSF, as the cleanable area is wrong.`,
    'Large GSF-to-CSF gaps that are stated, not derived: partial-service buildings (Nutrition and Food Service 32,600 / 4,980; Engineering 36,920 / 5,840; Warehouse 48,600 / 3,260; Fleet Garage 18,200 / 2,140) and the Domiciliary, whose 21,640 SF of resident rooms is cleaned by residents (54,300 / 24,075, Note 8).',
    'Service schedule is a letter code (Column 13) defined only in the Note 5 legend on page B-1: A = 24/7/365 and B = 7 days 0600-2230 (both daily_7), C = Mon-Sat (daily_6), D = Mon-Fri (daily_5), E = M/W/F (3x_week), F = Tue/Thu (2x_week), G = weekly. Codes A and B map to the same level.',
    'Schedules differ by area inside a building: Note 6 and Table B-3 put Building 1 floor 7 offices on Code D and floor 6 specialty clinics on "A / D", while the building itself is Code A (truth daily_7). Bldg 100 and the Dialysis Center run Mon-Sat (Code C, daily_6); Engineering is M/W/F; Warehouse and Fleet Garage are Tue/Thu.',
    `Table B-3 lists Building 1 by floor and unit (B, 1-7, SPS on floor 2, mechanical penthouse "PH"). Wards and units (ED, OR suite, ICU, 4 East / 4 West, Telemetry) are not facilities; the "BUILDING 1 TOTAL" row (${fmt(B1H)} / ${fmt(B1M)} / ${fmt(B1L)} / ${fmt(B1H + B1M + B1L)}) repeats Table B-1 line 1. Floor numbers 1-7 and "B" are not building numbers. The Table B-1 Total CSF for Building 1 carries a glued asterisk ("${fmt(csf(b1))}*").`,
    'Group D "not in contract scope (for information only - do not price)" lists 9 buildings with GSF: Research and Development (5, separate Research Service contract), Boiler Plant (13), Canteen Building (15, cleaned by Veterans Canteen Service), Child Development Center (18, out-leased under an enhanced-use lease), Fisher House (19), Parking Garage (20, 412,000 GSF - the largest number in the table), vacant Former Nurses\' Quarters (21) and Former Laundry (23), and Building 300. None is expected; Note 7 repeats the exclusions in prose.',
    'Option-only building: Building 300, New Community Living Center (96,400 GSF), prints estimated CSF (61,250 / 13,550 / 74,800) and Code A like an in-scope row, but it is Optional Line Item 1001 only and "not included in any total" (Note 11, Q&A 5). Not expected.',
    'Table B-2 CBOCs have no building numbers (truth omits buildingNumber). Marston CBOC is listed with 18,400 GSF but excluded because the Lessor provides janitorial under the lease (Note 7(h), Q&A 7). Tamarack Lake CBOC is a part-time M/W/F clinic (Code E, 3x_week). "Miles from VAMC" (38 / 61 / 74 / 92) and the street numbers are distractors.',
    `Amendment 0001 (last three pages, effective 12 April 2027) changes the attachment and says no conformed attachment will be issued: Item 1 deletes Bldg T-38 Telehealth Modular (4,320 GSF / 3,860 CSF; not expected); Item 2 adds Building 41 "B-41" Whole Health and Telehealth Center (9,600 GSF, 7,960 CSF, Code D) that appears in no table; Item 3 corrects Bldg 9 Low Risk 6,910 -> 8,450, so Total CSF 25,150 -> 26,690; Item 4 changes Bldg 16 Chapel from Code G (weekly) to Code F (2x_week). The original pages do not mention the amendment.`,
    `Totals and subtotals are not facilities: Group A ${fmt(tot(T.A))}, Group B ${fmt(tot(T.B))}, Group C ${fmt(tot(T.C))} subtotal rows; "TOTAL - TABLE B-1 ... (GROUPS A-C, 26 BUILDINGS)" ${fmt(TB1.gsf)} GSF / ${fmt(tot(TB1))} CSF; Group D GSF ${fmt(TD.gsf)}; Table B-2 total ${fmt(tot(TB2))}; Table B-4 grand total ${fmt(tot(TB1) + tot(TB2))} with percentages and a by-code count table (29 buildings/clinics); Amendment Item 5 revised totals (${fmt(tot(ATB1))} and ${fmt(tot(ATB1) + tot(TB2))}); the page B-1 prose "${campusCount} existing buildings totaling ${fmt(campusGsf)} gross square feet". Building counts sit inside the subtotal labels.`,
    'Three-row stacked header (group row BUILDING DATA / ESTIMATED CLEANABLE SQUARE FEET (CSF) BY AREA CLASSIFICATION / SERVICE, column titles with "(Note n)" references, and a (1)-(14) column-number row) repeated on both landscape pages of Table B-1; Group C starts at the bottom of page B-3 and continues under "GROUP C ... (continued)" on page B-4. Line numbers 1-35 are not building numbers.',
    'Building-number forms: plain numbers (1, 2, 100, 210), letter suffixes (5A in scope next to excluded 5; 7A next to 7), temporary modulars "T-37" / "T-38", and "Building 41 (B-41)" in the amendment. Excluded Building 5 and in-scope 5A share a stem.',
    'Distractor numbers next to the SF: Column (5) floors above grade with a separate Basement Y/N column (truth floors = Column 5), Column (7) operating beds (152, 44, 80, 120, 30) and "24 sta.", areas inside remarks (SPS 11,420 SF; resident rooms 21,640 SF; data center 4,980 SF; orthotic lab 2,300 SF; records storage 4,120 SF; specialty clinic 9,150 SF), 186 campus acres, 8 ORs / 24 ICU beds / 320 auditorium seats, 1,150 garage spaces, +/-5% tolerance.',
    'Grounds are out of scope: the 186-acre campus figure is context only and Note 7(j) gives grounds maintenance, snow removal and parking lot sweeping to Engineering Service. Expected grounds is an empty list.',
    'Prior award is only in Amendment Q&A 3: contract 36C25222C0087, awarded 26 September 2022 to Brightwater Environmental Services Group, LLC; Option Year 4 exercised at $7,316,480.00 for 12 months (annualValue); $30,912,764.18 paid over 53 months, 1 October 2022 - 28 February 2027 (spendToDate / spendPeriodMonths). No total contract value is stated, so totalValue and periodMonths are absent. The 26 September award date and "Option Year 4" are not the award year or a period length.',
    'Contract term is stated once on page B-1: base period 1 October 2027 - 30 September 2028 plus four 12-month option periods, "a total potential period of performance of five (5) years" (contractYears 5). The incumbent\'s own base + four options is a different contract. Climate: Wisconsin, snow and ice removal mentioned = cold. Installation: page B-1 names the Elk Prairie VA Medical Center while every running header and the title block name the Elk Prairie VA Health Care System (the contract also covers its CBOCs), so truth installationName is the common stem "Elk Prairie VA" and either printed name scores.',
  ];
};
const truth = {
  id: 'va-medical-evs-pdf',
  title: 'VA medical center EMS housekeeping (EVS) workload attachment: campus facility listing with GSF vs CSF split by high / moderate / low risk, coded service schedules, Building 1 by floor, CBOC table, excluded buildings, optional new CLC, Amendment 0001 deletes / adds / corrects (PDF)',
  theme: 'va-medical',
  provenance: PROVENANCE,
  inputs: [{ src: HTML_NAME, as: 'pdf', out: `${SOL} Attachment B - Facility Listing and Est Workload (w Amd 0001).pdf` }],
  expect: {
    facilities,
    facilitiesComplete: true,
    grounds: [],
    site: { contractYears: 5, climateZone: 'cold', installationName: 'Elk Prairie VA', solicitation: SOL }, // stem of both printed names (VA Medical Center on page B-1, VA Health Care System in every running header)
    priorAward: { annualValue: 7316480, spendToDate: 30912764.18, spendPeriodMonths: 53, incumbent: 'Brightwater Environmental Services Group, LLC', contractNumber: '36C25222C0087', awardYear: 2022 },
  },
  traps: TRAPS(),
};
fs.writeFileSync(path.join(here, 'truth.json'), JSON.stringify(truth, null, 2) + '\n');

console.log(`facilities: ${facilities.length}; gross sum ${sum(facilities, (f) => f.grossSqft)}; cleanable sum ${sum(facilities, (f) => f.cleanableSqft)}`);
console.log(`orig B1 total CSF ${tot(TB1)} (${TB1.n}); amended ${tot(ATB1)} (${ATB1.n}); CBOC ${tot(TB2)}; Bldg1 ${B1H + B1M + B1L}`);
