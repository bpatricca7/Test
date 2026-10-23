# gsa-building-information-sheets

A GSA Public Buildings Service custodial and grounds solicitation (fictional `47PC0326R0014`, "Shenandoah
Valley Federal Buildings", Winchester, Harrisonburg and Staunton, Virginia) delivered as one **DOCX**. It is a
conformed copy through Amendment 0001 and contains:

1. A Summary of Changes for Amendment 0001, with questions and answers (deleted building, revised custodial
   SF, floors to be serviced, the incumbent, its contract value and scope, window washing, snow plowing).
2. A Section B price schedule excerpt: one CLIN per building, priced per month, with a **Custodial Sq. Ft.**
   column.
3. A Section C PWS excerpt: scope, Building Information Sheets, period of performance, hours, Service Contract
   Labor Standards (wage determinations), a standard-services frequency table, courtrooms, public areas,
   historic finishes, window washing, snow and ice removal, grounds maintenance, Above Standard Services, and
   the Section J list of attachments.
4. **Section J, Exhibit J.1, Building Information Sheet**: six sheets, one per building, each a key/value
   form rather than a row table. One of the six was deleted by the amendment.

The PDF sibling `gsa-building-information-sheets-pdf` is rendered from the same HTML (byte-identical) and has
the same expected answers.

```bash
node scripts/render-fixtures.mjs tests/fixtures/gsa-building-information-sheets
npx tsx scripts/eval.ts tests/fixtures/gsa-building-information-sheets
```

## What the DOCX looks like

The shared DOCX renderer (`scripts/render-fixtures.mjs`, not part of this fixture) maps headings, paragraphs
and tables only. As a result:

- There are **no page breaks and no Word header/footer parts**. The running header ("Solicitation No.
  47PC0326R0014 … Section J, Exhibit J.1 – Page J.1-n of 6") and the CUI line are ordinary body paragraphs that
  repeat in the flow before and after each section and each sheet.
- Each J.1 form is five Word tables (Sections A–B, C, excluded space, D, and E–F with remarks) plus caption
  paragraphs. mammoth's raw text puts every cell on its own line, so each label and its value sit on
  consecutive lines.
- The deleted-building banner for VA0355ZZ comes **before** that sheet's "EXHIBIT J.1 – BUILDING INFORMATION
  SHEET" heading, so a reader that splits at the heading attaches it to the end of the VA0402ZZ chunk.
- Known renderer limitations (not fixable from the fixture source): the page size is A4 (the HTML asks for
  Letter), the dark shading on the section-header rows is dropped, the two-row fixture header has no vertical
  merge (empty cells under Restroom Type, No. of Restrooms and Fixtures), and table columns are equal width.
  Nothing is cut off; every cell, including "15,330 (revised A0001; was 13,930)" and "22,860 (revised A0001;
  was 21,460)", reads correctly.

## Provenance (fidelity: real-format)

The format and wording follow GSA's national custodial and consolidated-services specifications. All values
are made up.

- GSA National Consolidated Maintenance Specification v1.2 (December 2024):
  https://www.gsa.gov/system/files/National_Consolidated_Services__PWS_20241205.pdf
  The fixture copies these points: "Regions are required to use the Custodial Square Footage Tool … to
  prepare custodial square feet in Exhibit J.1 'Building Information Sheet'"; contractors complete the
  Building Information Sheet for each building covered under the contract; the building block is Building
  Number / Building Name / Building Address; snow and ice removal from entrances and walks is a standard
  service, and heavy plowing is ordered under C.15 Above Standard Services.
- GSA National Consolidated Facilities Engineering Specification (December 2022):
  https://www.gsa.gov/system/files/National_Facility_Engineering_Consolidated_Services_w_VTS_PWS-20221215.pdf
  Source for "Custodial Building Information Sheets" as a Section J exhibit, restrooms cleaned daily at
  minimum or once per shift, and window washing ordered as an Above Standard Service (C.15).
- GSA DRAFT PWS 2020 National Custodial: https://govtribe.com/file/government-file/draft-pws-2020-national-custodial-dot-pdf
  Source for: the tool counts only square feet cleaned on a routine basis, and regions remove space not
  cleaned routinely (file room storage, electrical closets); "Windows shall be cleaned once per year", with
  extra cleanings reimbursable; glass within ten feet of the floor.
- GSA National O&M Specification (March 2025): https://www.gsa.gov/system/files?file=2025+National+OM+Spec-030525.pdf
  Source for: "Be sure to complete the Building Information Sheet (See Exhibit 1) for each building that is
  covered under the Contract."
- GSA 2024 National Custodial Specification: https://www.gsa.gov/system/files/2024_National_Custodial_Specification_October_2024-1.pdf
- GSA historic building page for the Texarkana U.S. Post Office and Courthouse:
  https://www.gsa.gov/real-estate/historic-preservation/explore-historic-buildings/find-a-building/us-post-office-and-courthouse-texarkana-ar
  Source for the real building number `AR0057ZZ`. Only its pattern (state code, four digits, `ZZ`) is used.

**Not seen in any source:** the J.1 field list beyond Building Number / Name / Address. Search excerpts did not
show the real form, so Sections A–F of the sheet are a reconstruction. They hold the fields an estimator
needs and GSA's custodial program actually uses: GSF / RSF / ABOA, custodial SF by space type from the
Custodial Square Footage Tool, restroom fixtures, glass SF, grounds, and snow removal.

**Made up for this fixture:** the solicitation and contract numbers, every building, building number,
address, square footage, floor and fixture count, grounds quantity and remark, the incumbent (Caldera Ridge
Facility Services, LLC), the wage determination numbers in Attachment J.2 and every dollar value. The building
names use fictional people so they cannot be mistaken for real federal buildings. Details kept plausible on
purpose:

- The incumbent PIID `47PC0322C0042` carries FY digits `22` because it was awarded in December 2021 (FY2022);
  the solicitation `47PC0326R0014` was issued in September 2026 (FY2026). The `47PC03` activity code and the
  `3PQ` office symbol follow the GSA pattern but could not be verified (the web search budget was used up).
- The courthouse (VA0123ZZ) is in Harrisonburg, where the Western District of Virginia holds court; there is
  no federal courthouse in Winchester.
- Rentable/ABOA ratios are 1.11–1.22 on every sheet. ABOA includes warehouse, records storage and
  USPS-occupied space, as GSA measures it.
- The base period ends February 29, 2028 (a leap year).

## Expected answers

| GSA No. | Building | Gross SF | Custodial (cleanable) SF | Floors | Restroom fixtures | Service level |
|---|---|---:|---:|---:|---:|---|
| VA0123ZZ | Thomas R. Whitcomb Federal Building and U.S. Courthouse | 118,460 | 88,900 | 5 (4 + basement) | 80 | `daily_5` |
| VA0187ZZ | Margaret E. Halloran Federal Building | 64,920 | 52,060 | 3 | 48 | `daily_5` |
| VA0241ZZ | Federal Office Building and U.S. Post Office | 38,750 | 22,860 (A0001) | 3 (2 + basement) | 20 | `daily_5` |
| VA0318ZZ | Valley Federal Office Building | 18,640 | 15,360 | 1 | 21 | `daily_5` |
| VA0402ZZ | Shenandoah Federal Support Center | 46,300 | 40,670 | 2 (incl. mezzanine) | 24 | not scored (see trap 16) |

- `facilitiesComplete: true`. Category is `admin` for four buildings and `warehouse` for VA0402ZZ.
- Grounds, per building and in the document's units:

  | Building | Improved turf | Parking | Sidewalks |
  |---|---:|---:|---:|
  | VA0123ZZ | 1.25 ac | 38,600 SF | 11,250 SF |
  | VA0187ZZ | 2.35 ac | 52,400 SF | 6,980 SF |
  | VA0318ZZ | **9,600 SF** | 31,500 SF | 2,860 SF |
  | VA0402ZZ | 3.10 ac | 96,800 SF | 2,150 SF |

  Totals: about 6.92 acres of improved turf, 219,300 SF of parking and 23,240 SF of sidewalks.
- Site: 5 contract years, `temperate`, installation "Shenandoah Valley Federal Buildings", solicitation
  `47PC0326R0014`.
- Prior award: contract 47PC0322C0042, Caldera Ridge Facility Services, LLC, awarded 2021, 60 months,
  $5,612,350 total, $1,146,880 for the current option year. The values are recorded as stated; see trap 19
  for the scope adjustment.

## Traps

1. **Key/value sheets, not a row table.** Each building's numbers are spread across label/value cells, in
   pairs (label | value | label | value), over five tables per sheet.
2. **Several square-footage figures per building.** GSF is the facility size. RSF and ABOA are for
   information only. The Section C total is the cleanable SF. ABOA can be close to or below custodial SF
   (VA0402ZZ: 40,390 vs 40,670).
3. **The Section B schedule is the only row table, and it lists custodial SF, not gross SF.** It also uses
   abbreviated names ("Whitcomb FB-USCH, Harrisonburg") and has a "Total Custodial Square Feet" row (219,850).
4. **A deleted building.** Amendment 0001 deletes VA0355ZZ Federal Records Annex (22,480 GSF). Its sheet
   stays in the package under a "DELETED BY AMENDMENT 0001 – RETAINED FOR REFERENCE ONLY" banner, and CLIN
   0001AF reads DELETED.
5. **Banner before the heading.** In the DOCX flow the banner precedes the VA0355ZZ sheet heading, so a
   heading-based split puts it at the end of the VA0402ZZ chunk. The banner names VA0355ZZ.
6. **A revised value.** VA0241ZZ custodial SF reads "22,860 (revised A0001; was 21,460)".
7. **Excluded space with square footage.** Mechanical rooms, the USMS cellblock, the child care center, USPS
   space, the secure cage and the inactive records vault are listed with SF but are not cleanable.
8. **Floors split above/below grade.** Amendment answer A1 says floors serviced are above plus below grade
   (five at VA0123ZZ, three at VA0241ZZ) and that the VA0402ZZ mezzanine is its second floor.
9. **Fixture counts.** The TOTAL row is the answer. The number of restrooms sits next to it, the header is
   two rows, and drinking fountains and service sinks are listed outside the total.
10. **Glass SF** is a window-washing quantity, not floor area.
11. **Grounds units.** VA0318ZZ gives landscaped area in SF. Total Site Area is information only.
12. **Grounds by others.** VA0241ZZ grounds are "Not in contract (USPS)".
13. **Remarks mention land maintained by nobody or by others:** an unmaintained wooded buffer and a playground
    maintained by the child care provider.
14. **Alphanumeric building numbers** (`VA0123ZZ`).
15. **Contract term.** One base year plus four option years is 5 years. The FAR 52.217-8 six-month extension
    does not count.
16. **VA0402ZZ has mixed frequencies.** It is serviced Monday to Friday, but 28,870 of its 40,670 custodial SF
    (warehouse floor, shops, loading dock, stairwells) is scheduled Weekly and only 11,800 SF (office, lobby,
    restrooms and locker rooms, break room) is Daily. One facility-level service level cannot represent that.
    `daily_5` would bill 250 sweeps a year on 22,400 SF of warehouse floor, and `weekly` would under-service the
    office and restrooms. The truth therefore leaves `serviceLevel` out for VA0402ZZ, so it is not scored. An
    estimator should split the building or set the warehouse floor tasks to weekly.
17. **Prior award is in Q&A prose.** The $75,000 NTE for CLIN 0003 is not a prior-award value.
18. **Wage determinations and the attachment list** (C.1.5, Section J) carry numbers, dates and page counts that
    are not building data.
19. **Prior-award scope is not the new scope.** A3 says the incumbent contract covers six buildings including
    VA0355ZZ (235,370 custodial SF), grounds at five buildings including VA0355ZZ (0.65 ac turf, 18,900 SF
    parking, 1,480 SF walks), and not VA0241ZZ Suite 210. The new scope is 219,850 custodial SF
    (= 235,370 − 16,920 + 1,400). That is 93.4% of the incumbent's custodial scope, 6.6% less. A top-down
    cross-check from $1,146,880 has to be scaled down to match before it is compared with the bottom-up FTEs.
20. **Running header and CUI line** repeat inline in the DOCX body. They are not Word headers or footers.
