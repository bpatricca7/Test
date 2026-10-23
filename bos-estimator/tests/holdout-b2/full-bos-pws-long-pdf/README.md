# full-bos-pws-long-pdf

This fixture is a full Army Base Operations Support (BOS) Performance Work Statement: Section J, Attachment 0001 to
solicitation `W9131B-27-R-0006` for the fictional **U.S. Army Garrison Fort Brannock, Wisconsin**. It is one 27-page
PDF with a text layer. The PWS covers six Common Levels of Support (CLS): 402 Custodial, 403 Refuse, 404 Grounds,
408 Snow, 420 Demand Maintenance Orders and 510 Pest Management.

The document is laid out the way real BOS PWSs are. Parts 1–7 come first, then the Technical Exhibits. The facility
workload does not appear until page 20. The 19 pages before it hold general information, definitions, Government-
and Contractor-furnished property, the functional tasks and four summary exhibits. Those pages are full of numbers
that are not facility square footage: CLINs, DMO counts and limits, pest-control acres, refuse tons and lifts, snow
events and lane-miles, PRS dollar remedies, installation acreage, and SF for buildings that are not serviced.

| Pages | Content |
|---|---|
| 1 | Cover: Section J Attachment 0001, solicitation number, version date, CLS list, distribution statement |
| 2 | Table of contents (no page numbers, like the Laughlin AFB PWS) |
| 3–6 | **Part 1, General Information**: background (14,860 acres, 418 buildings, 3.1 million SF); 1.2.1 facilities *not* serviced; Table 1-1 CLS / CLIN table; 1.4 period of performance; hours and holidays; 1.7 climatic conditions; QC/QA; key personnel; security; phase-in; ECMRA; 1.14 workload changes; 1.15–1.20 boilerplate |
| 7–8 | **Part 2, Definitions and Acronyms**: capability levels, CSF vs GSF, the **2.1.9 facility frequency-code table** (7W / 6W / 5W / 3W / 2W / W / M), task frequencies, grounds types, snow event, lane-mile |
| 9–10 | **Parts 3–4, GFP / CFP**: Table 3-1 Government-furnished facilities *with GSF* (2410, 2412, 2414, 2416); Table 3-2 GFE |
| 11–15 | **Part 5, Specific Tasks**: 5.1 Custodial (prose totals, barracks common areas, vacant 1407, wood gym floor SF, optional facilities, facilities not serviced), 5.2 Refuse, 5.3 Grounds, 5.4 Snow, 5.5 Pest, 5.6 DMOs, 5.7 Meetings |
| 16 | Part 6 Applicable Publications; Part 7 Technical Exhibit listing |
| 17 | TE 1 Performance Requirements Summary; TE 2 Deliverables Schedule |
| 18 | TE 3 Estimated Workload Summary, which restates the custodial, grounds, refuse, snow, pest and DMO totals |
| 19 | TE 4 Custodial Cleaning Standards and Frequencies, a task × capability matrix ("1X daily", "2X yearly") |
| 20–21 | **TE 5, Custodial Facility List** (landscape, 14 columns, three-row header repeated on page 21): Part A, 48 lines in three capability groups with subtotals and a Part A total; Part B, 2 optional facilities; Notes 1–12 |
| 22 | **TE 6, Grounds Maintenance Areas**: Table 6-1 areas by type with an excluded RCI row and subtotals; Table 6-2 athletic fields; Table 6-3 beds and paved areas, with edging in LF |
| 23 | TE 7, Refuse Collection Workload: 21 container lines keyed by building number, roll-offs, tonnage |
| 24 | TE 8, Snow and Ice Removal: lane-miles by priority, and parking and sidewalk subsets of TE 6 by priority |
| 25 | TE 9, Pest Management Workload: 17 scheduled buildings, installation-wide structural SF, and treatment acres that overlap TE 6 |
| 26–27 | TE 10, Historical Workload Data: **Table 10-1 current contract (prior award)**, DMO history, custodial / grounds / refuse / snow / pest history |

Source: `att-0001-bos-pws.html` → `build/W9131B-27-R-0006 Attachment 0001 - BOS PWS.pdf`. The HTML and the
`expect.facilities` / `expect.grounds` parts of `truth.json` are generated together by `gen.mjs` (see *Regenerating*).

```bash
node scripts/render-fixtures.mjs tests/holdout-b2/full-bos-pws-long-pdf
npx tsx scripts/eval.ts tests/holdout-b2/full-bos-pws-long-pdf
```

The general fixture size rule is 3–12 pages. This fixture's brief asks for one long PWS of 25–40 pages instead, and
the brief governs here. The facility count (47) is inside the 15–60 range.

## Provenance (fidelity: real-format)

All values are made up. That covers the installation (no Fort Brannock exists; Langlade County, Wisconsin is real and
sets a real cold climate), the solicitation and contracting office, every facility number, name, CATCD, year, floor
count, GSF, CSF and floor-type split, all grounds, refuse, snow, pest and historical quantities, and the current
contract (Northwoods Integrated Services, LLC, W9131B-22-C-0003, $38,947,260). CATCDs follow the style of DA Pam
415-28 but are illustrative. No rows were copied.

The authoring session could not reach SAM.gov, GovTribe or home.army.mil. The real PWSs below were downloaded from the
imlive.s3.amazonaws.com mirror of SAM.gov attachments and read with `pdftotext -layout`. Rows marked *search summary
only* could be seen only through web-search result summaries.

| Source | What the fixture takes from it |
|---|---|
| [FA300222R0002 Att 1, Base Operating Support Services PWS, Laughlin AFB (9 Dec 2021, 546 pp.)](https://imlive.s3.amazonaws.com/Federal%20Government/ID191905819147280301890827662064261035974/Attach%201%20%20Performance%20Work%20Statement%20PWS%2009%20Dec%202021.pdf) | Overall shape: one BOS PWS with a section per service and workload data at the back. Workload tables with "ESTIMATED QUANTITIES – QUANTITY / UNIT" and "ESTIMATED WORKLOAD (# TIMES ANNUALLY)" and PWS paragraph references in the rows (TE 6, TE 9). Edge and trim lengths in linear feet listed among turf acres (TE 6 Table 6-3 item 4). "The workload data provided below is for historical purpose only" (TE 10). Entomology "Treat Facilities … Total: 1,939,817 SF / 5% Annual" (TE 9 structural area). The Government Furnished Facilities table with building number and total square feet (Table 3-1). |
| [Annex A, Overarching PWS, Base Operations and Maintenance Contract, Fort Wainwright AK (15 Mar 2021)](https://imlive.s3.amazonaws.com/Federal%20Government/ID86897817599961419693497399046367681594/Annex%20A-Overarching%20PWS%20-%2018%20Feb%2022.pdf) | Army BOS model. Non-personal-services opening; background with acreage, building count and population; "Climatic Conditions" paragraph; hours; Federal holidays including Juneteenth; phase-in and phase-out; ECMRA wording; GFP inventory on DA Form 2062 per DA PAM 710-2-1; the **CLS table** (404 Grounds, 408 Snow, Ice and Sand Removal, 420, 510 Pest Management, one attachment each). Its TE index (TE 13 Refuse Collection, TE 14 Dumpster Tips Workload, TE 18 Pest Control Facilities List, snow maps, TE 52 DMO Workload Data) is the model for TE 7–10. |
| [Fort Wainwright Custodial Services PWS (08 Jan 2019 v.4)](https://imlive.s3.amazonaws.com/Federal%20Government/ID31544869489761803466574390107441771546/Attachment_A_-_Custodial_Performance_Work_Statement.pdf) | Capability I Enhanced (CYS), II Standard (fitness), III Basic (admin / warehouse / other) as the TE 5 groups. Separate workload, standards-and-frequencies and historical-data TEs. The **5W / 6W / 7W, 2W, W, M** frequency definitions and their interval wording (PWS 2.1.9–2.1.10). The "square footage added, deleted or suspended × rate" change rule (1.14). Key control. |
| [Dyess AFB Custodial Services PWS, Appendix B (13 Aug 2021)](https://imlive.s3.amazonaws.com/Federal%20Government/ID297162707687379821580624672536441025401/Attachment%201%20-%20Custodial%20PWS.pdf) | The TE 5 column set: Facility No. / Description / User-Agency / **Restroom SF / Carpet SF / Hard Floor SF / Total Cleaned SF**, grouped by level with "Total # Facilities" subtotals and an all-levels total. Alphanumeric facility numbers (6030A/B/C → 2104A/B). Appendix A task frequencies → TE 4. |
| [Sheppard AFB / Frederick AAF Custodial PWS, Appendix B](https://imlive.s3.amazonaws.com/Federal%20Government/ID239120740891441165113625913503342013529/Atch_02_Custodial_Services_-_PWS.pdf) | A second real facility list keyed by building number, with SF split by floor type and summed to a total, plus category subtotals. |
| [W911S7-20-R-0001 Att 1, CDTF O&M PWS, Fort Leonard Wood (Dec 2019)](https://imlive.s3.amazonaws.com/Federal%20Government/ID96837023427233783650986366557395196797/W911S720R0001%20ATTACHMENT%201%20%20PWS%20CDTF%2012-20-2019.pdf) | Army "PART 1 GENERAL INFORMATION" structure, "Section J, Technical Exhibit x.x" cross-references, and a custodial Task and Frequency Chart carried as a TE in front of the facility list. |
| [Fort Hamilton BASOPS W15QKN-25-R-5001, Tech Exhibit 0302 Snow and Ice Removal Plan](https://govtribe.com/file/government-file/25r5001-tech-exhibit-0302-snow-and-ice-removal-plan-dot-docx) (*search summary only*) | Grounds areas and the snow plan as separate TEs in one BASOPS package. Snow priorities defined by accumulation, and "passable" defined for streets, walks and lots. |
| [USAG Fort Meade Catalog of Services FY24](https://home.army.mil/meade/8616/9030/9129/Catalog_of_Services_-_FMMD_FY24_Signed.pdf) (*search summary only*) | IMCOM service numbers 402 Custodial, 403 Refuse Removal, 404 Maintenance – Grounds, 408 Snow, Sand and Ice Removal, and grounds kept to improved / semi-improved / unimproved standards. |

Known remaining tells:

- This is the PWS attachment only. Sections B, F and I are referenced but not bound, and TE 11 (maps) is "electronic
  only".
- Every total reconciles exactly. Real exhibits often carry small inconsistencies, but adding them on purpose would make
  the ground truth ambiguous.
- The PWS is dated November 2026 with real property data as of 30 SEP 2026, but the TE 10 history stops at FY25 and
  the 2024–25 snow season. A real DPW would often have added FY26.
- The letter-spaced cover heading extracts as `S E C T I O N J – AT TA C H M E N T`, as Word documents with expanded
  character spacing do.

## How the document is read

- **The facility list is TE 5, Part A.** PWS 5.1.1 says custodial services are required only in TE 5 Part A facilities,
  and 5.1.13 lists what is not serviced. Buildings that appear only in Table 3-1 (GFF), TE 7, TE 8, TE 9 or the prose
  are not facilities for this contract.
- **grossSqft = GSF (column 8), cleanableSqft = Total CSF (column 12).** Note 1 calls GSF "for information only".
  Note 2 makes CSF the basis of payment and defines it as column 9 + 10 + 11. Both values are stated for every row.
- **serviceLevel comes from FREQ (column 13), using the 2.1.9 code table.** TE 4 task frequencies are within-day task
  counts, not service levels.
- **category is given only where the description is unambiguous:** CDCs and the School Age Center are `child_care`;
  fitness centers and the indoor pool are `fitness`; offices and headquarters are `admin`; NCO Academy buildings and the
  Education Center are `education`; UPH buildings are `barracks`; TEMF, motor pool and DPW shops are `maintenance`;
  warehouse, CIF, self-service supply and records holding are `warehouse`; the hangar is `hangar`; the chapel is
  `community`. Category is left out for 19 facilities whose class is debatable: Youth Center, CYS Parent Central
  Services, pool bathhouse, bowling center (TE 5 groups it with "physical fitness and recreation", so `fitness` is as
  defensible as `community`), outdoor recreation, Army Community Service (an office building, so `admin` is as
  defensible as `community`), Religious Education Center, library, MP station, fire station, VCC, NEC, museum,
  simulation center, Range Control, airfield operations, ASP office and the two range buildings.

## Expected answers

- **47 facilities** (`facilitiesComplete: true`): Capability I 5, II 6, III 36. They total **1,060,920 GSF and
  557,560 CSF**, which equals the printed "TOTAL – PART A". Building numbers are FAC NO, including `2104A` and `2104B`.
- Not expected:
  - line 32, Bldg 1407 (vacant, no service, Note 4);
  - Part B, Bldg 1410 and Bldg 3116 (optional CLIN 0010);
  - GFF Bldgs 2410–2416;
  - Bldgs 1100, 1106, 1310, 1550 and 1600 (cleaned by others; they appear only in the refuse, snow and pest exhibits).
- Service levels: 23 × `daily_5`, 9 × `daily_7`, 2 × `daily_6` (3110, 1024), 4 × `3x_week`, 4 × `2x_week`,
  4 × `weekly`, 1 × `monthly` (2408).
- **Grounds**, from TE 6 only. The 19 entries in `truth.json` sum per kind to:
  - improved_turf 83.1 acres
  - semi_improved 173.9 acres
  - unimproved 302.5 acres
  - athletic_field 11.6 acres
  - shrub_bed 58,400 sqft
  - parking 131,800 sqyd
  - sidewalk 196,300 sqft
- Not grounds:
  - G-13 family housing, 146.0 AC (not in contract);
  - edging, 54,600 LF;
  - the subtotals and the 559.5 AC total;
  - the TE 3 restatement;
  - the TE 8 priority subsets (115,600 SY; 172,500 SF);
  - the TE 9 treatment acres (94.7 / 11.6 / 42.1 / 22.0 AC).
- **Site:** 5 contract years (12-month base + four 12-month options; 1.4 says "five (5) years, excluding phase-in"),
  `cold`, "Fort Brannock", "W9131B-27-R-0006".
- **Prior award** (TE 10, Table 10-1):
  - total value $38,947,260 for the base and all option periods;
  - 60 months (1 July 2022 – 30 June 2027);
  - Northwoods Integrated Services, LLC;
  - contract W9131B-22-C-0003;
  - awarded 2022.

  `annualValue` and `spendToDate` are not stated.

## Traps

1. **The workload is buried.** TE 5 starts on page 20. Before it, Parts 1–5 name about 25 buildings by number:
   - with no SF (1100, 1106, 1310, 1550, 1600);
   - with SF that is not a facility area (GFF 2410–2416; wood gym floors 14,200 / 11,600 SF; 177,650 SF of Capability III
     carpet);
   - or with a status that excludes them (1407 vacant, 1410 and 3116 optional).
2. **GFF with GSF** (Table 3-1): 2410 is 7,200 SF, 2412 is 12,800, 2414 is 4,000 and 2416 is 6,360. The Contractor
   occupies them, and 3.2.1 says "not included in TE 5".
3. **Buildings keyed by number in other exhibits.** TE 7 has 21 container lines (1100, 1310, 1550, 1600 …), TE 8 has
   snow priorities, and TE 9 has 17 scheduled pest buildings plus 2,846,300 SF installation-wide. Each exhibit says that
   a listing there does not mean custodial service.
4. **GSF vs CSF, and partial-service buildings.** The large gaps come from Notes 5 and 8:
   - TEMF 2302: 64,300 / 7,720
   - hangar 2604: 48,600 / 6,960
   - DPW shops 2310: 33,600 / 3,680
   - barracks: 46,800 / 9,320 (common areas only)
5. **Floor-type component columns** (Restroom / Carpet / Hard Floor SF) sit between GSF and Total CSF.
6. **Vacant row inside Part A** (line 32, Bldg 1407): it has GSF 38,200, dashes for CSF and FREQ "—", and is excluded
   from all totals.
7. **Part B optional facilities** (1410, 3116) carry design-estimate SF and are not in the base requirement.
8. **Totals are not facilities:** the capability subtotals, "TOTAL – PART A", the Part B total, the prose totals
   (5.1.1, 5.1.2) and TE 3.
9. **Identical rows:** Bldgs 1402 and 1403 match in every column except FAC NO and LINE. Both count.
10. **Alphanumeric FAC NOs:** 2104A and 2104B.
11. **Distractor columns next to FAC NO:** LINE (1–48, B-1/B-2), CATCD (5 digits), YR BLT ("2028 est."), FLRS, a
    column-number row, and note markers glued to header words ("GSF1", "(CSF)2").
12. **Frequency codes defined 13 pages earlier** (2.1.9). They map to 7W / 6W / 5W / 3W / 2W / W / M, alongside TE 4's
    task-level "1X daily" / "2X yearly".
13. **Seasonal 7W** (pool bathhouse 1532, Note 6, about 15 weeks). Expected `daily_7`. Model limitation: `daily_7` is
    360 days/yr in `shared/types.ts`, so this one facility's labor runs high.
14. **Landscape TE 5 split over two pages** with the three-row header repeated and banner and group rows spanning all
    14 columns.
15. **Grounds traps:** the excluded G-13 row, athletic fields stated as separate from Table 6-1, edging LF marked
    "workload only; not an area", subtotals and total, and the TE 3 restatement.
16. **Snow subsets of the TE 6 paved areas** (TE 8 Table 8-2), with roads in lane-miles.
17. **Pest-control acres are not mowing acres** (TE 9 Table 9-2: 94.7 AC = improved + athletic, among others).
18. **Numbers everywhere:**
    - installation acreage, buildings and population;
    - CLINs 0001–0010 and 1001–4010;
    - DMO limits (16 h, $2,500);
    - PRS remedies ($40–$1,000);
    - 14 fixed-price snow events, 64 in. of normal snowfall, a 1,200-ton salt dome;
    - 43 containers, 99 lifts, 64 pulls, 1,844 tons;
    - DMO history.
19. **Historical custodial workload** (TE 10 Table 10-4): 46 / 46 / 47 facilities and 538,215 / 541,880 / 546,680 CSF.
    This is history, not the current list.
20. **The prior award is on the last pages,** next to a second contract number (W9131B-23-P-0118, the old pest contract).
21. **Contract term:** a 30-day phase-in plus 12-month base plus four options. contractYears is 5.
22. **Climate:** north-central Wisconsin, 64 in. snow, January mean 12 °F, so `cold`.

## Regenerating

`gen.mjs` holds the TE 5 rows, the TE 6 / TE 7 tables and every computed total. It writes `att-0001-bos-pws.html` and
merges `expect.facilities`, `expect.facilitiesComplete` and `expect.grounds` into `truth.json`. The other truth fields,
provenance and traps are kept by hand.

```bash
node tests/holdout-b2/full-bos-pws-long-pdf/gen.mjs
node scripts/render-fixtures.mjs tests/holdout-b2/full-bos-pws-long-pdf
```

Check the result by reading the PDF text layer (`pdftotext -layout`). TE 5 rows parsed from the text layer were
compared with `expect.facilities`: all 47 match on FAC NO, name, GSF, CSF, floors and frequency. CSF equals column
9 + 10 + 11 on every row, the three excluded rows are 1407, 1410 and 3116, and the sums equal the printed Part A total.
If you edit a value in the prose by hand (TE 3, 5.1.x, 5.2.1, 5.3.1, TE 8, TE 9, TE 10), update every place it
appears.
