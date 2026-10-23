# af-custodial-workbook-xlsx

This fixture is the facility listing attachment of an Air Force custodial services solicitation:
**Attachment 2, Appendix B "Estimated Square Footages and Cleaning Level"**, issued as an Excel workbook for the
fictional Tallgrass Air Force Base, Kansas (solicitation `FA4693-27-R-0007`). The workbook is the version
conformed through **Amendment 0001 (12 Feb 2027)**. The amended values are already in the cells. Changed lines
carry "A1" in a Rev column, and the Notes tab logs every change with its Was and Is values, which is how
amended workbooks are usually reissued.

The workbook has six sheets:

| Sheet | Content |
|---|---|
| Notes & Instructions | Title block; Notes 1–10. The notes cover: cleaning area vs gross area; how Total Cleaned SF is summed; cleaning levels per Appendix A; Svc Freq definitions; "No. of RR" is a count of rooms, not fixtures; annual service days for the workload line; facilities listed at more than one level and suffixed numbers; rows below a zone total are out of scope; modification unit pricing. The sheet also holds the Amendment 0001 change log (Item / Tab / Facility No. / Change / Was / Is) and a tab index. |
| Summary | Totals by zone, totals by cleaning level (with base-year CLIN 0001–0003), and a workload block. The workload block gives Per Occurrence SF and Total Per Year (SF x annual service days). Notes on line items vs facility numbers (2000 counted on both of its lines) and on the excluded rows. |
| Zone 1 - Flightline | Level 1 and Level 2 blocks. Each block has a repeated two-row stacked header and a "Level N Total - # Facilities" row. Deleted facility 1180 stays in the Level 2 block with zero SF. Zone total row and zone notes. |
| Zone 2 - Cantonment | Level 1 and Level 2 blocks. Facility 2000 appears in both blocks. Added facility 2094 (A1). Re-measured facility 2024 (A1). Zone total. Below the total, a reference-only block holds 2090, a SCIF cleaned by unit personnel, which is not on contract. |
| Zone 3 - Community Spt | Level 1, Level 2 and Level 4 (Special Requirements) blocks, including seasonal 3032 and 3048 (frequency changed, A1). Zone total. Below the total, an optional block holds 3052 (Optional CLIN 0006). |
| GSU - Cottonwood Annex | Two facilities at a geographically separated unit, numbered 101 and 104, in `#,##0.00` format with measured decimals. |

Each data tab has 15 columns: Zone, Facility No., Facility Description, User/Agency, Cleaning Level, Svc Freq,
No. Flrs, No. of RR, then the merged group "ESTIMATED SQUARE FOOTAGE (SF)" over Restroom SF / Carpet SF / Hard
Floor SF (VCT/Ceramic/Wood) / Other SF (Sealed Conc.) / Total Cleaned SF per Facility, then Rev and Remarks.
Header cells contain line breaks, as exported workbooks do.

Generate, render and score:

```bash
node tests/holdout/af-custodial-workbook-xlsx/gen.mjs          # writes appendix-b.json + truth.json from one table
node scripts/render-fixtures.mjs tests/holdout/af-custodial-workbook-xlsx
npx tsx scripts/eval.ts tests/holdout/af-custodial-workbook-xlsx
```

The renderer writes
`build/FA4693-27-R-0007 Atch 2 - Appendix B Est SF and Cleaning Level (Amd 0001).xlsx` (24 KB).

## Provenance (fidelity: real-format)

Every value is made up. That covers the base and its GSU, the host wing number (726 ABW) and unit symbols, the
solicitation number, the amendment and its date, and every facility number, name and square footage. No rows
were copied. The layout and wording follow real Air Force custodial Appendix B tables. Each was downloaded and
read with `pdftotext -layout`:

| Source | What the fixture takes from it |
|---|---|
| [Dyess AFB Custodial Services PWS, 13 Aug 2021, Appendix B](https://imlive.s3.amazonaws.com/Federal%20Government/ID297162707687379821580624672536441025401/Attachment%201%20-%20Custodial%20PWS.pdf) | The core layout. Columns Facility No. / Description / User/Agency / Restroom SF / Carpet SF / Hard Floor SF / Total Cleaned SF per Facility. One block per cleaning level with the header repeated. "Level N Total" rows that put the facility count in the Facility No. column ("81 Total # Facilities"). The same facility number on several lines (7008, 9203). Letter-suffixed numbers (6030A/B/C, 7316A/B). Partial areas ("3-Bay Hangar (Bay 1 Only)"). The para 4.20.3 unit-pricing rule built on the Appendix B totals, paraphrased in Note 9. |
| [Sheppard AFB / Frederick Aux Airfield Custodial PWS, rev. 3 Aug 2018, Appendix B](https://imlive.s3.amazonaws.com/Federal%20Government/ID239120740891441165113625913503342013529/Atch_02_Custodial_Services_-_PWS.pdf) | Floor-finish split columns with blank cells for zero. SUBTotal / TOTAL rows with the count in the Bldg # column. The same building in two categories (402, 920). Two buildings at a separate airfield, which is the model for the GSU tab. Frequency wording ("1x a week", "1x every two weeks", "3x a week"). |
| [Wright-Patterson AFB CDC and NASIC Custodial PWS, Apr 2018, Appendix B (July 2018)](https://imlive.s3.amazonaws.com/Federal%20Government/ID51452482767498558535584979091168261202/PWS_for_CDC_and_NASIC.pdf) | The spreadsheet-export look: two-decimal SF (510.82), "N/A" cells, stacked headers, Level 2 and Level 4 blocks, a note on a contractor-occupied building. The "Per Occurrence / Total Per Month / Total Per Year" workload rows are the model for the Summary workload block. |
| [Aviano AB DRAFT Appendix B, 1 June 2021](https://imlive.s3.amazonaws.com/Federal%20Government/ID100363056541034031518908095969877301366/DRAFT%20Appendix%20B%20-%20Facility%20Sq%20Meters%2001%20June%202021.pdf) | An AREA (zone) column next to the building number. Level blocks with TOTALS. The same building on two lines (176). Partial-building lines. A seasonal remark ("APR - OCT"). |
| [Appendix A, Air Force Custodial Standards](https://imlive.s3.amazonaws.com/Federal%20Government/ID57155383415613588625416825616511317979/APPENDIX_A,_Air_Force_Custodial_Standards.pdf) | Level 1 Prestige / 2 Basic / 3 Academics / 4 Special Requirements (Fitness Center, CDC, Youth Center, SAP), and the "1 x Week", "1 x every 2 Weeks", "2 x Week" wording. Used for Note 3 and the Level 4 block. |
| [Eielson AFB (168th Wing) custodial PWS, State of Alaska notice attachment](https://aws.state.ak.us/OnlinePublicNotices/Notices/Attachment.aspx?id=140242) (not fetched) | A web-search summary describes a per-facility table of facility number, activity, square footage and service frequency (for example, 2x a week). This is the only support for a per-building Svc Freq column. |
| [Joint Base Charleston Custodial Services FA441826R0011 (2026)](https://samsearch.co/gov-explore/federal/joint-base-charleston-custodial-services/FA441826R0011) (not fetched) | Web-search summaries show the package lists "Attachment 2 - Appendix B 14 April 2026 (XLS)" and reissues it by amendment. This is the only support for issuing Appendix B as a workbook named Attachment 2. |

### What is and is not verified

- **Verified from the four real Appendix B tables:** the columns, level blocks, count-in-the-number-column total
  rows, repeated facility numbers, suffixed numbers, partial-area descriptions, seasonal remark, decimals and
  "N/A" cells, and the workload rows.
- **Not seen in a real workbook:** the XLSX form itself, with a Notes tab, a Summary tab and one tab per zone.
  SAM.gov, GovTribe and the other bid mirrors were blocked from this environment (only S3-hosted PDFs could be
  downloaded). So no real Air Force Appendix B .xlsx was opened. The tab structure follows the task brief and
  the JB Charleston listing, not a file that was inspected.
- **The "Svc Freq" column is an assumption.** It holds service days per week for each facility. The real
  appendices tie frequency to the cleaning level through Appendix A rather than per building. A per-building
  days-per-week column does appear in the Eielson AFB / 168th Wing PWS cited above, but only through a search
  summary (the State of Alaska host was unreachable). Notes tab Note 4 defines the column so the workbook is
  self-consistent.
- **Known tells:**
  - every figure reconciles exactly;
  - unit symbols reuse one wing number;
  - there are no floor-plan references beyond "Appendix C";
  - the deleted row is not struck through, because the renderer writes values only, with no fonts.

## Expected answers

- **48 facilities** (`facilitiesComplete: true`), one per in-scope line on the zone and GSU tabs:
  - Zone 1: 15;
  - Zone 2: 19;
  - Zone 3: 12;
  - GSU: 2.

  The 48 lines cover 47 distinct facility numbers. Facility 2000 has two lines: Command Section at Level 1
  (6,215 SF) and Staff Agencies at Level 2 (18,540 SF). Truth keeps both, in document order, because each line is
  priced at its own level (Zone 2 note 2, Notes tab Note 7). 1158A and 1158B are separate facilities.
- **Total 385,092.42 SF.** This equals the Summary "TOTAL - ALL ZONES" and "TOTAL - ALL LEVELS". The `#,##0`
  format displays it as 385,092.
- **Not facilities:**
  - 1180 (deleted by Amendment 0001; zero SF in the row);
  - 2090 (SCIF, reference only, 22,430 SF);
  - 3052 (Optional CLIN 0006, 9,850 SF);
  - all subtotal, total and Summary rows.
- **Area:** `grossSqft` = `cleanableSqft` = Total Cleaned SF on every row. Notes 1–2 say the figures are
  estimated cleaning areas, not gross areas, and the workbook prints no gross area. GSU values keep their
  decimals (2,207.75 and 435.67).
- **Amendment 0001 is applied:**
  - 2024 is 7,330, not 6,950;
  - 2094 is added at 4,574;
  - 3048 is 6 x Week (Mon-Sat), not 5 x Week;
  - 1180 is gone.
- **Service levels from Svc Freq:**

  | Svc Freq | `serviceLevel` |
  |---|---|
  | 5 x Week | `daily_5` |
  | 6 x Week (Mon-Sat) | `daily_6` |
  | 7 x Week | `daily_7` |
  | 3 x Week | `3x_week` |
  | 2 x Week | `2x_week` |
  | 1 x Week | `weekly` |
  | 1x every two weeks | `biweekly` |

  3032 ("3 x Week (APR-OCT only)") is seasonal and has no single level, so truth leaves it out. The Cleaning
  Level (1 / 2 / 4) is a task standard, not a frequency.
- **Floors:** set from No. Flrs except 1130 ("1 + Mezz"), which truth leaves out.
- **Category:** set only where the facility type is plain and the cleaned area is the building's own use:
  - `admin`: HQ, staff, squadron admin and similar offices;
  - `warehouse`: 2030;
  - `maintenance`: 1146 and 2034;
  - `education`: 2076 (Airman Leadership School);
  - `community`: 3002 (chapel) and 3006;
  - `dining`: 3028. Only the dining room, entry and restrooms are cleaned (kitchen excluded), but that area is
    still dining space, so this is the one partial-area row that keeps a category;
  - `fitness`: 3040;
  - `child_care`: 3044.

  Category is left out for:
  - partial-area rows (hangars, the inspection bay, bowling, shops, the GSU power production shop);
  - the ambiguous ones: Base Ops, the terminal, the tower, the fire station, the network center, SFS/BDOC,
    Pass & ID, the simulator, the library/education center, A&FRC, the Youth Center/SAP and seasonal restrooms.
- **No `restroomFixtures`:** "No. of RR" counts rooms (Note 5), not fixtures.
- **`grounds: []`:** the workbook has no grounds workload, so a reader that emits grounds is penalized.
- **No `dining` headcount and no prior award.**
- **Site:** `installationName` "Tallgrass Air Force Base", `solicitation` "FA4693-27-R-0007". The contract term
  and climate are not stated in this attachment.

## Traps

1. **Multi-sheet workbook.** Facility rows are only on the zone and GSU tabs. The Notes and Summary tabs are full
   of numbers.
2. **The Summary duplicates the totals twice** (by zone and by level). Its workload block holds large numbers:
   Total Per Year 103,276,102.
3. **Title block, zone banner and repeated stacked headers.** The headers use a merged group cell, merged
   two-row single-column headers and line breaks inside header cells.
4. **Counts in the Facility No. column.** Level and zone total rows read "13 | Level 2 Total - # Facilities"
   (Dyess style).
5. **Same facility number on two lines** (2000, Level 1 and Level 2).
6. **Suffixed facility numbers** (1158A / 1158B). They are text cells among numeric ones.
7. **Cleaning area, not gross area.** The rows marked "Admin & Shop Areas Only", "Break Room & Latrine Only",
   "Restrooms & Snack Bar Seating Only" and dining room only are partial areas.
8. **Total = Restroom + Carpet + Hard Floor + Other.** A single split column is not the facility area.
9. **Distractor numbers beside the SF:**
   - No. of RR;
   - No. Flrs;
   - User/Agency unit numbers (726 OSS, 727 ARS);
   - zone ids;
   - CLINs;
   - PWS paragraph numbers;
   - annual service days.
10. **Four styles of empty SF cell:** blank, 0, "-" and "N/A".
11. **Amendment already applied, but the change log still prints the Was values.** These are 4,868 (1180),
    2,580 / 6,950 (2024), 5 x Week (3048) and the old grand total 385,006.42.
12. **The deleted row stays in place** (1180: level N/A, Svc Freq "DELETED", zero SF).
13. **Out-of-scope rows below the zone totals carry real SF and a full header:** 2090 reference-only SCIF and
    3052 optional CLIN.
14. **Frequency wording** "x Week", "6 x Week (Mon-Sat)" and "1x every two weeks", plus one seasonal facility.
15. **Cleaning Level is not frequency.** Several Level 2 facilities are 7 x Week.
16. **"1 + Mezz" floors**, and a 6-level tower with 1,096 cleaned SF.
17. **GSU tab:** a separate site with 3-digit numbers and two-decimal SF. The grand total therefore has
    decimals that the Summary format hides.

## Regenerating

`gen.mjs` holds the single table of rows. It writes `appendix-b.json` (the renderer's multi-sheet input) and
`truth.json` together, so the level subtotals, zone totals, Summary, change log and truth stay consistent. Edit
the table in `gen.mjs`, not the JSON outputs.
