# va-medical-evs-pdf

This fixture is the workload attachment of a VA medical center housekeeping (EVS) solicitation. VA calls the
service Environmental Management Service (EMS). The document is
**Attachment B, "Facility Listing and Estimated Workload Data"**, of solicitation `36C25227R0014`, EMS
Housekeeping Services, for the fictional **Elk Prairie VA Medical Center** in Wisconsin.

It is one 9-page PDF with a text layer: the attachment as issued on 15 March 2027 (pages B-1 to B-6), followed by
**Amendment 0001** (12 April 2027). The amendment is an SF 30 face page plus two continuation pages, saved into
the same file the way a proposer would combine them. The attachment pages do not mention anything the amendment
changes.

| PDF page | Content |
|---|---|
| 1 (B-1) | Title block (VA / NCO 12 / solicitation). Box with the medical center, a 186-acre campus of 34 existing buildings totaling 1,904,330 GSF, CBOC names, the period of performance (base plus four option periods, five years) and the contents. Notes 1–5: purpose, GSF vs CSF, ±5% accuracy, the area-classification table (High / Moderate / Low Risk), and the Service Schedule Code legend A–G. |
| 2 (B-2) | Notes 6–12: schedules within a building, exclusions 7(a)–(j) (SPS, NFS kitchen, Research, VCS, out-leased CDC, Fisher House, parking garage, boiler plant, lessor-cleaned CBOC, vacant buildings, grounds), Domiciliary resident rooms, locked units, temporary modulars, Optional Line Item 1001 (Bldg 300), and column definitions. |
| 3 (B-3), landscape | **Table B-1** Facility Listing. 14 columns under a three-row header (group row, titles, (1)–(14) column numbers). Group A Inpatient and Residential (6 buildings) and Group B Outpatient Clinical (8), each followed by a subtotal. Group C starts at the bottom of the page. |
| 4 (B-4), landscape | Table B-1 continued, with the header repeated: Group C (continued, 12 buildings including T-38), its subtotal, "TOTAL – TABLE B-1 ... 26 BUILDINGS", then Group D "not in contract scope (for information only – do not price)" with 9 rows, including option-only Bldg 300. |
| 5 (B-5), landscape | **Table B-2** CBOCs: 4 clinics with no building numbers, one of them excluded. **Table B-3** Building 1 by floor and unit, with mixed Code A and D schedules, SPS and penthouse "not in CSF" rows, and a Building 1 total. |
| 6 (B-6), landscape | **Table B-4** Summary: CSF by area classification with a grand total and percentages, and building count and CSF by Service Schedule Code. |
| 7 | Amendment 0001, SF 30 face page (Items 1–16). |
| 8 | Continuation page, Part I "Changes to Attachment B" in Was / Is form: deletes T-38, adds Bldg 41 (B-41), corrects the Bldg 9 CSF, changes the Bldg 16 schedule code, and revises the totals. |
| 9 | Continuation page, Part II "Questions and Answers" (9 Q&As, including the incumbent and current contract value). |

Generate, render and score:

```bash
node tests/holdout/va-medical-evs-pdf/gen.mjs          # writes the HTML and truth.json from one table
node scripts/render-fixtures.mjs tests/holdout/va-medical-evs-pdf
npx tsx scripts/eval.ts tests/holdout/va-medical-evs-pdf
```

The renderer writes `build/36C25227R0014 Attachment B - Facility Listing and Est Workload (w Amd 0001).pdf` (about 176 KB).

## Provenance (fidelity: real-format)

Every value is made up. That includes the medical center, its address, all building numbers, names, GSF, CSF,
bed counts and schedules, the CBOCs, the solicitation and amendment, the incumbent (Brightwater Environmental
Services Group, LLC), contract `36C25222C0087` and its dollar figures. The solicitation number follows the real
NCO 12 `36C252…` format. No rows were copied.

The four sources marked "read" were downloaded as PDFs and read with `pdftotext -layout`:

| Source | What the fixture takes from it |
|---|---|
| [HAMS Performance-Based Work Statement, 35th Medical Group, Misawa AB](https://imlive.s3.amazonaws.com/Federal%20Government/ID135467017274262374363648670899572058680/Attachment%202%20HAMS%20PWS.pdf) (read) | The core structure. This military hospital housekeeping PWS is the closest readable relative of a VA EVS attachment. From it: <ul><li>Appendix A "Estimated Workload Data" (Building # / Name / Sq Ft to be cleaned / TOTAL) and the "Workload by Sq Ft / BASE CODE" crosstab, which are the models for Tables B-1 and B-4.</li><li>The BASE cleaning codes, where each code fuses a day pattern with an area risk ("7 Day Non case-Driven Critical Care", "5 Day All Other Areas", "2 Day ... Tuesday & Thursday", "3 Day ... Monday, Wednesday, Friday", "0 Not Cleaned"). These are the model for the coded schedule column and the Note 5 legend.</li><li>The critical care / patient-use / all-other-areas definitions, used for Note 4.</li><li>The room listings with "Sum" rows, used for Table B-3.</li><li>The holiday exception for wards and the OR, used for Codes A and B.</li></ul> The real appendix also contradicts itself: Bldg 1760 is 3,877 SF in one table and 3,040 in the crosstab total. The fixture does not copy that. |
| [VA clinic lease 36C25018L0003, Section 6.07 Janitorial Services](https://imlive.s3.amazonaws.com/Federal%20Government/ID45087456464175768965815377536122301544/36C25018R0005-064.pdf) (read) | VA wording: the "current standards of the Joint Commission", isolation areas that need terminal cleaning, separate hours for "Direct Patient Care Areas", EPA-registered germicide, and the M–F schedule. In a leased VA clinic the Lessor provides janitorial services, which is why Marston CBOC is excluded (Note 7(h)). |
| [VA NCO 23, Amendment 0003 to janitorial RFQ 36C26321Q0187](https://imlive.s3.amazonaws.com/Federal%20Government/ID58103017219499690749812197545078656787/S06.%2036C26321Q0187%200003.pdf) (read) | The amendment pages: the SF 30 block layout and wording ("To all Offerors/Bidders", "The purpose of this Amendment is to post responses to vendor questions", "Except as provided herein ..."). Also the continuation page in "Question: / Response:" form, asking about SF by floor type, floor plans, the prior contract, consumables and storage rooms. |
| [USCG Base Seattle Janitorial PWS, HSCG84-17-R-PTE001](https://imlive.s3.amazonaws.com/Federal%20Government/ID151682101211780583073746200899112515222/PWS%20Attachment%2009132018.pdf) (read) | Buildings serviced only in part ("Entire bldg", "2nd FLOOR", "Foyer and Restroom"), hours per building, "Contractor shall only bill for the square footage serviced", and escorted cleaning of secure areas. Model for partial-service Bldgs 4, 11, 12 and 25, and for Note 9. |
| [Portland VAMC Sources Sought, NCO 20, 2023](https://sam.gov/opp/9e4ffeb165cc4b5094f8b6ca7f6312e2/view) (not fetched) | Search summaries only: "Hospital Grade Housekeeping Cleaning, Non-Patient Care Areas", about 442,000 SF "across various buildings", 7 days a week, base plus 4 option years. Supports the patient care vs non-patient care split and the term. |
| [Oklahoma City VA HCS janitorial, 2026](https://sam.gov/opp/d5998a3a2f344dc6834296afce37d621/view) (not fetched) | Search summaries only: "The total approximate square footage for each location is shown below", covering the VAMC plus Lawton and Stillwater CBOCs, with aseptic cleaning. Supports one EVS contract covering the medical center and its CBOCs (Table B-2). |
| [Alaska VA HCS Hospital Housekeeping RFP, 2024](https://sam.gov/opp/35e7e4ffb1ee47d6990c815af7ec36d0/view) (not fetched) | Search summaries only: the healthcare center, Domiciliary, transitional housing and three CBOCs in one housekeeping contract; 272,102 SF; patient rooms, patient care rooms, clinics and administrative areas. Supports including the Domiciliary and CBOCs. |
| [Dayton VAMC "Housekeeping Cleaning - 17 Buildings", 36C250-18-Q-9337](https://sam.gov/opp/f4a1d65e35a3de8e92564ad8b3cac1c2/view) (not fetched) | Search summaries only: a campus of numbered buildings under one housekeeping contract; the 2026 follow-on (36C25026Q0740) covers about 20 buildings and 622,750 SF, with a base plus 4 option years starting 1 October. |
| [VA Eastern Colorado (Southern Colorado) janitorial, 2023](https://sam.gov/opp/efa0aba48a1b46baac5a2aa991e6e131/view) (not fetched) | Search summaries only: area stated per location as "Cleanable Square Footage". Supports the CSF terminology. |

### What is and is not verified

- **Verified from documents that were read:**
  - risk-class columns and building codes that fuse day pattern and risk (HAMS);
  - workload total and crosstab rows, and per-room / per-unit listings with sums (HAMS);
  - VA clinic cleaning wording and lessor-provided janitorial (VA lease);
  - the SF 30 and Q&A amendment format (VA NCO 23);
  - partial-building service (USCG).
- **Not seen in a real VA EVS attachment.** SAM.gov, va.gov and all bid mirrors except S3-hosted PDFs are blocked
  from this sandbox, and the search index had no VA EVS workload table on S3. So the following were never checked
  against a real VA table:
  - the exact VA column set;
  - the "High / Moderate / Low Risk" labels (a common healthcare EVS convention);
  - letter codes A–G (HAMS uses numbers 0–10);
  - the Group A–D layout.

  The VA-specific scope comes from the search-indexed notices above and from the author's knowledge of VA medical
  center organization: CBOCs, Domiciliary / DRRTP, CLC, SCI/D, CRRC, VCS, Fisher House, enhanced-use lease, SPS
  and NFS cleaning their own areas, and an Optional Line Item for a new building.
- Every printed subtotal and total reconciles, because the generator builds them from one table. Real attachments
  sometimes don't (see the HAMS example), but a deliberate mismatch would make the truth ambiguous.

## Expected answers

- **29 facilities** (`facilitiesComplete: true`):
  - 26 campus buildings after Amendment 0001: the 26 in Groups A–C, minus T-38, plus Bldg 41;
  - 3 CBOCs with no building number.
- `grossSqft` is Column (8) GSF. `cleanableSqft` is Column (12) Total CSF. Both are stated for every in-scope row.
  The facilities sum to **1,374,810 GSF** and **908,545 CSF**. The CSF sum equals the amendment's revised grand total.
- Post-amendment values:
  - T-38 is deleted.
  - Bldg 41, Whole Health and Telehealth Center, is added: 9,600 GSF / 7,960 CSF, 1 floor, Code D.
  - Bldg 9's CSF is 26,690, not the 25,150 printed in Table B-1.
  - Bldg 16 Chapel is Code F (`2x_week`), not G (`weekly`).
- `floors` is Column (5), floors above grade. Basement is a separate Y/N column.
- `serviceLevel` comes from the building's Column (13) code:
  - A and B → `daily_7`
  - C → `daily_6`
  - D → `daily_5`
  - E → `3x_week`
  - F → `2x_week`
  - G → `weekly`

  Building 1 is `daily_7` even though Table B-3 puts floor 7 offices on Code D.
- `category` is given only where the use is clear-cut:
  - `medical`: hospital, inpatient buildings, clinics, imaging, dialysis, dental, CBOCs
  - `admin`
  - `maintenance`: Engineering, Fleet Garage
  - `warehouse`
  - `fitness`
  - `community`: Chapel

  It is left out for the Domiciliary and its Annex, CRRC, Education Center, NFS building, VA Police and Bldg 41.
- Not expected:
  - all Group D rows (excluded, vacant, out-leased, and option-only Bldg 300);
  - Marston CBOC;
  - T-38;
  - Table B-3 floors and units;
  - every subtotal and total.
- `grounds: []`. The 186 acres are context only, and Note 7(j) assigns grounds to Engineering Service.
- Site: 5 contract years (base plus four options, "five (5) years"), `cold` (Wisconsin), `36C25227R0014`.
  `installationName` is "Elk Prairie VA". Page B-1 names the Elk Prairie VA Medical Center, but the title block and
  every running header name the Elk Prairie VA Health Care System, and the contract also covers that system's CBOCs.
  Truth uses the common stem so that either printed name scores.
- Prior award (Amendment Q&A 3):
  - incumbent Brightwater Environmental Services Group, LLC
  - contract `36C25222C0087`, awarded 2022
  - Option Year 4 at $7,316,480.00 for 12 months (`annualValue`)
  - $30,912,764.18 paid over 53 months (`spendToDate` / `spendPeriodMonths`)

  `totalValue` and `periodMonths` are left out because no total contract value is stated.

## Traps

1. **GSF vs CSF.** Gross SF is information only. CSF is split into three risk columns plus a total. Some buildings
   have large stated gaps between the two:
   - partial service: NFS 32,600 / 4,980; Warehouse 48,600 / 3,260;
   - Domiciliary resident rooms cleaned by residents.
2. **Coded schedules.** A letter code resolves only through the Note 5 legend. Codes A and B both mean 7 days.
3. **Schedules differ by area within a building.** See Note 6 and Table B-3: floor 7 is Code D and floor 6 is "A / D".
4. **Table B-3 units** (ED, OR suite, ICU, 4 East / 4 West, Telemetry) are not facilities. Its total repeats
   Bldg 1, and Bldg 1's Total CSF carries a glued asterisk ("319,615*").
5. **Group D is listed in the table but out of scope**: Research, Boiler Plant, Canteen (VCS), out-leased CDC,
   Fisher House, a 412,000 GSF Parking Garage, and two vacant buildings.
6. **Option-only Bldg 300** prints CSF and Code A like an in-scope row.
7. **CBOC table**: clinics have no building numbers; Marston is lessor-cleaned and excluded; "Miles from VAMC" is
   a distractor.
8. **Amendment supersedes the attachment.** It deletes T-38, adds B-41 (which appears in no table), corrects
   Bldg 9's CSF, and changes Bldg 16's schedule code. No conformed attachment is issued.
9. **Totals and subtotals** appear in many places: group subtotals with counts in the label, the Table B-1 total,
   the Group D GSF line, the Table B-2 total, the Table B-4 crosstab and percentages, the amendment's revised
   totals, and the page B-1 campus prose.
10. **Stacked, repeated header.** The landscape Table B-1 has a three-row header repeated across two pages, and
    Group C continues under a "(continued)" group row. Line numbers 1–35 are not building numbers.
11. **Building-number forms**: 5A in scope next to excluded 5; 7A next to 7; T-37 and T-38; "Building 41 (B-41)".
12. **Distractor numbers**: operating beds, "24 sta.", areas quoted inside remarks, OR, ICU and seat counts,
    garage spaces, acreage.
13. **No grounds**, even though campus acreage is given.
14. **Prior award appears only in a Q&A answer**, near other dates and option-year wording.
15. **Contract term is stated once** on page B-1. The incumbent's own base plus four options is a different contract.

## Regenerating

`gen.mjs` holds every row once. Tables B-1 to B-4, the subtotals, the amendment's Was / Is values and revised
totals, and `truth.json` are all derived from that table. Edit the rows there and run it again; do not edit the
HTML or `truth.json` by hand.
