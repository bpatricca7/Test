# univ-buildings-in-scope-xlsx

University custodial RFP (`RFP #27031`, fictional "Kessler State University") delivered the way the
University of Missouri delivered RFP #23027 "Custodial Services for Various Buildings": a short RFP PDF
plus Excel exhibits. This package has two files:

1. `rfp-27031-custodial.html` → `build/rfp-27031-custodial.pdf`: a 2-page cover and scope document with
   the contract term, the current contract and **Addendum No. 1 (Q&A)**.
2. `exhibit-a-buildings-in-scope.json` → `build/27031 Exhibit A - Buildings in Scope.xlsx`: two sheets.
   - **Exhibit A - Buildings in Scope**: merged title row, blank row, header row, 51 building rows and a
     TOTAL row. Columns: Building # | Building Name | Campus | Gross Sq Ft | Cleanable Sq Ft | # Floors |
     Restroom Fixtures | Service Days/Week | Remarks.
   - **Notes**: 10 numbered free-text notes.

Render and score:

```bash
node scripts/render-fixtures.mjs tests/fixtures/univ-buildings-in-scope-xlsx
npx tsx scripts/eval.ts tests/fixtures/univ-buildings-in-scope-xlsx
```

## Provenance (fidelity: real-format)

- **Package structure** (Exhibit A Buildings in Scope / Exhibit B Scope of Cleaning Services / Exhibit C
  RFP Staffing Workbook, each an Excel spreadsheet) follows MU RFP #23027:
  https://www.umsystem.edu/sites/default/files/2022-10/Custodial%20Services%20for%20Various%20Buildings%20RFP%20Final%2010-12-2022.pdf
- **Real building names and gross SF (9 of 51 rows):**
  - From UAFS AX-24-003, Appendix 1 – UAFS Facilities
    (https://uafs.edu/about/offices-and-services/finance-and-administration/procurement/_documents/ax24003custodialandlandscaping.pdf):
    Baldor Technology Center 102,000; Boreham Library 68,331; Math Science 82,000; Advancement Center 9,008;
    51st Annex 16,339; Pendergraft Health Sciences 72,230; Ballman Speer 12,466 (storage, no custodial service
    in the source too).
  - From Pima Community College RFP P24/10060L
    (https://www.pima.edu/administration/contracts-purchasing/docs/rfp-p24-10060l-custodial-services.pdf):
    Aviation Technology Center 73,346 (first floor 64,642 + second floor 8,704, so 2 floors) and 29th Street
    Coalition Center 39,751.
- **Patterns:**
  - The addendum adding a building follows Northern Maine Community College's 2026 custodial RFP Q&A.
  - The gross-vs-cleanable Q&A follows TCNJ's custodial bid Addendum No. 1.
  - The residence-hall frequency wording (7 days a week during semesters, a deep clean at the start and end
    of each semester) follows Lincoln University RFP B24-1228.
- **Made up:** the university, every building number, all other buildings and their square footage, all
  cleanable SF, floor, fixture and service-day values (except the Aviation Technology Center floor count),
  the addendum answers, and the current contract (Allpoint Custodial Group, LLC, KSU-C-21-0447, 2021,
  $14,950,000 over 5 years).

## Expected answers

- **50 facilities** (`facilitiesComplete: true`): the 51 workbook rows, minus Ballman Speer (0 service
  days, storage) and Hawthorne Hall (removed by Addendum Q3), plus Ridgeview Commons (added by Addendum Q1).
- Building 2210 gross SF is **42,810** (Addendum Q2 correction), not the workbook's 48,210.
- Service days map to service levels: 5 → `daily_5`, 7 → `daily_7`, 3 → `3x_week`, 2 → `2x_week`,
  1 → `weekly`. A value of 6 has no exact level, so truth leaves it out.
- Cleanable SF, floors and restroom fixtures are given for every facility.
- Site: 5 contract years (1-year base plus four 1-year renewals), "Kessler State University",
  "RFP #27031". No climate zone is asserted.
- Prior award: total $14,950,000, 60 months, incumbent Allpoint Custodial Group, LLC, contract
  KSU-C-21-0447, awarded 2021.

## Traps

1. **Header on row 3.** A merged title row and a blank row sit above it.
2. **TOTAL row** (2,220,646 gross / 1,450,645 cleanable / 1,176 fixtures) is not a building. It also
   includes the two information-only rows and the uncorrected 48,210.
3. **Mixed building-number types.** Some are text with leading zeros ("0012") and some are numeric cells
   (1102).
4. **Zero service days.** Ballman Speer has Service Days 0 and the remark "Storage – no custodial
   service", so it is excluded.
5. **The addendum overrides the workbook.**
   - Hawthorne Hall looks in scope in the workbook but is removed by the PDF addendum.
   - Building 2210's gross SF is corrected to 42,810.
   - Ridgeview Commons (1114: 11,000 GSF, 9,350 cleanable, 1 floor, 14 fixtures, 7 days) appears only in
     the PDF.
6. **Gross much larger than cleanable.**
   - Residence halls count common areas only.
   - Warehouse and shops count office areas only.
   - The Aviation Technology Center excludes its hangar bays.
7. **Twin buildings.** Cedar Hall and Juniper Hall have identical numbers and both must be kept.
8. **Free-text Remarks column and Notes sheet.** Neither contains building rows.
9. **Staffing figures are not award values.** The Q5 FTE counts (118 custodial, 9 supervisors) are staffing
   context, not prior-award value.
