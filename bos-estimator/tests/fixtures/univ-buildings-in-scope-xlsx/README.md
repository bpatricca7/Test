# univ-buildings-in-scope-xlsx

University custodial RFP (`RFP #27031`, fictional "Kessler State University", Cape Bluff, Missouri), delivered
the way the University of Missouri delivered RFP #23027 "Custodial Services for Various Buildings": a short
RFP PDF plus Excel exhibits. A separate addendum, issued three weeks after the RFP, changes the building
list. The package has three files, in issue order:

1. **The RFP.** `rfp-27031-custodial.html` → `build/rfp-27031-custodial.pdf`, 3 pages. It has a cover
   block with a named buyer, an index of the RFP documents and the contract term. It also has the current
   contract (Section 3.1), the scope summary (Section 4), the staffing workbook instructions (Section 5) and
   submission, evaluation and Missouri requirements (Section 6).
2. **Exhibit A workbook.** `exhibit-a-buildings-in-scope.json` → `build/27031 Exhibit A - Buildings in
   Scope.xlsx`, with two sheets:
   - **Exhibit A - Buildings in Scope.** A merged title row, a blank row, the header row, 51 building rows
     and a TOTAL row. Columns: Building # | Building Name | Campus | Gross Sq Ft | Cleanable Sq Ft | #
     Floors | Restroom Fixtures | Service Days/Week | Remarks.
   - **Notes.** 10 numbered free-text notes.
3. **Addendum No. 1.** `rfp-27031-addendum-1.html` → `build/RFP 27031 Addendum No. 1.pdf`, 2 pages, dated
   November 3, 2026. Part A is a changes table for Exhibit A. Part B has Q1-Q7 questions and answers. The
   addendum ends with an acknowledgment block. The app classifies it as amendment 1, so it ranks after the
   RFP and the workbook.

Exhibits B-D (Scope of Cleaning Services, Staffing Workbook, Pricing Pages) are listed in the RFP index but
not supplied. This is a partial package, as an estimator often receives one.

Render and score:

```bash
node scripts/render-fixtures.mjs tests/fixtures/univ-buildings-in-scope-xlsx
npx tsx scripts/eval.ts tests/fixtures/univ-buildings-in-scope-xlsx
```

## Provenance (fidelity: real-format)

- **Package structure** follows MU RFP #23027. Its exhibits are Exhibit A Buildings in Scope, Exhibit B
  Scope of Cleaning Services and Exhibit C RFP Staffing Workbook, each an Excel spreadsheet:
  https://www.umsystem.edu/sites/default/files/2022-10/Custodial%20Services%20for%20Various%20Buildings%20RFP%20Final%2010-12-2022.pdf
- **Real building names and gross SF (9 of 51 rows).** These were copied as seen in search excerpts when the
  fixture was built. A later verification pass confirmed that the UAFS document and its Appendix 1 exist, but
  could not re-confirm the UAFS square footages from excerpts.
  - From UAFS AX-24-003, Appendix 1 – UAFS Facilities
    (https://uafs.edu/about/offices-and-services/finance-and-administration/procurement/_documents/ax24003custodialandlandscaping.pdf):
    - Baldor Technology Center 102,000
    - Boreham Library 68,331
    - Math Science 82,000
    - Advancement Center 9,008
    - 51st Annex 16,339
    - Pendergraft Health Sciences 72,230
    - Ballman Speer 12,466 (storage with no custodial service in the source too)
  - From Pima Community College RFP P24/10060L
    (https://www.pima.edu/administration/contracts-purchasing/docs/rfp-p24-10060l-custodial-services.pdf):
    - Aviation Technology Center 73,346 (first floor 64,642 plus second floor 8,704, so 2 floors)
    - 29th Street Coalition Center 39,751
  - These names come from an Arkansas university and an Arizona college. They are kept on purpose:
    - Donor-named buildings (Baldor, Boreham, Pendergraft, Ballman Speer) exist at universities everywhere.
    - The street-named buildings ("51st Annex", "29th Street Coalition Center") fit a fictional city.
    - Both street names start with numerals, which tests that a reader keeps them out of the Building #
      column.
- **Patterns:**
  - The addendum that adds a building follows Northern Maine Community College's 2026 custodial RFP Q&A.
  - The gross-vs-cleanable Q&A follows TCNJ's custodial bid Addendum No. 1.
  - The residence-hall frequency wording (7 days a week during semesters, a deep clean at the start and end
    of each semester) follows Lincoln University RFP B24-1228.
- **Missouri requirements.** Section 6.3 cites real statutes (E-Verify affidavit, Section 285.530 RSMo;
  Israel boycott certification, Section 34.600 RSMo; service-disabled veteran preference, Section 34.074
  RSMo). The wording is written for this fixture.
- **Made up:**
  - the university, the buyer (with a 555 telephone number) and every building number
  - all other buildings and their square footage
  - all cleanable SF, floor, fixture and service-day values, except the Aviation Technology Center floor
    count
  - the evaluation points and the addendum
  - the current contract: Allpoint Custodial Group, LLC, KSU-C-22-0447, July 1, 2022 – June 30, 2027,
    $26,480,000

**Economic consistency.** The incumbent figures are sized to agree with each other:

- **Scope.** Truth has 1,431,495 cleanable SF at APPA Level 2, about 1.58M SF in 5-day-equivalents once
  the 6- and 7-day buildings are weighted.
- **Staffing.** Q5 gives about 78 custodial FTEs and 7 supervisors. That is about 18,000 cleanable SF per
  custodian, which fits Level 2 with weekend coverage.
- **Contract value.** $26,480,000 over 60 months is $5.30M a year: about $62k per person, $3.70 per
  cleanable SF and $2.43 per GSF.
- **Top-down check.** The app's defaults (shared/topdown.ts: $58k loaded per FTE, 8% ODC, 8% G&A, 7% fee,
  3% escalation from the 2022 award) back that into about 81 FTEs. That agrees with Q5 to within about 5%.

An earlier version paired $14.95M with 127 staff, which was impossible: base wages alone at Missouri's
$15.00 minimum wage exceeded the contract value.

**Column widths.** The workbook JSON carries a `colWidths` array per sheet with the intended Excel column
widths: a 44-character name column and a wide Remarks column. `scripts/render-fixtures.mjs` does not read
it yet and sets every column to width 16. Until it does, long building names and the "Service Days/Week"
header are clipped in Excel next to filled cells. The cell values are intact.

## Expected answers

- **50 facilities** (`facilitiesComplete: true`). These are the 51 workbook rows, with three changes:
  - minus Ballman Speer (0 service days, storage)
  - minus Hawthorne Hall (removed by addendum A-3 / Q3)
  - plus Ridgeview Commons (added by A-1 / Q1)
- Building 2210 gross SF is **42,810**, per the A-2 / Q2 correction, not the workbook's 48,210.
- **Service levels.** Service days map as follows: 5 → `daily_5`, 7 → `daily_7`, 3 → `3x_week`,
  2 → `2x_week`, 1 → `weekly`. A value of 6 has no exact level, so truth leaves it out. Column H governs
  every building (RFP 4.1). The 7-day residence-hall requirement in RFP 4.3 names Buildings 1102-1108 only,
  so 1110 stays at 3 days and 1120 at 5.
- Cleanable SF, floors and restroom fixtures are given for every facility.
- **Site.**
  - 5 contract years (1-year base plus four 1-year renewals).
  - Climate zone `temperate`: southeast Missouri, and RFP 4.6 gives five to six snow or ice events per
    winter. That matches the app's temperate zone (6 events), not cold (18).
  - Installation "Kessler State University", solicitation "RFP #27031".
- **Prior award.** Total $26,480,000 over 60 months (July 1, 2022 – June 30, 2027). Incumbent Allpoint
  Custodial Group, LLC, contract KSU-C-22-0447, awarded 2022.

## Traps

1. **Header on row 3.** A merged title row and a blank row sit above it.
2. **TOTAL row** (2,220,646 gross / 1,450,645 cleanable / 1,176 fixtures) is not a building. It includes
   the two information-only rows and the uncorrected 48,210, and it ignores the addendum (Q4).
3. **Mixed building-number types.** Some are text with leading zeros ("0012") and some are numeric cells
   (1102).
4. **Zero service days.** Ballman Speer has Service Days 0 and the remark "Storage – no custodial
   service", so it is excluded.
5. **A separate addendum overrides the workbook.** Each change appears twice, in the Part A table and in the
   Part B answer, and must be applied once.
   - Hawthorne Hall looks in scope in the workbook but is removed by the addendum.
   - Building 2210's gross SF is corrected to 42,810. The A-2 row prints both the old and the new value.
   - Ridgeview Commons (1114: 11,000 GSF, 9,350 cleanable, 1 floor, 14 fixtures, 7 days) appears only in
     the addendum.
6. **Gross much larger than cleanable.**
   - Residence halls count common areas only.
   - Warehouse and shops count office areas only.
   - The Aviation Technology Center excludes its hangar bays.
7. **Twin buildings.** Cedar Hall and Juniper Hall have identical numbers, and both must be kept.
8. **Names that start with numerals**: "51st Annex" and "29th Street Coalition Center".
9. **Free-text Remarks column and Notes sheet.** Neither contains building rows.
10. **Numbers that are not award values.**
    - The Q5 staffing figures (78 custodial FTEs, 7 supervisors).
    - The evaluation points (40/25/20/15, total 100).
    - The prior contract's 1+4 term structure, which is history, not the new term.
