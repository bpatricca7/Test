# gsa-building-information-sheets

A GSA Public Buildings Service custodial and grounds solicitation (fictional `47PC0326R0014`, "Shenandoah
Valley Federal Buildings", Virginia) delivered as one **DOCX**. It is a conformed copy through Amendment 0001
and contains:

1. A Summary of Changes for Amendment 0001, with questions and answers (deleted building, revised custodial
   SF, how floors are counted, incumbent and contract value, window washing, snow plowing).
2. A Section B price schedule excerpt: one CLIN per building, priced per month, with a **Custodial Sq. Ft.**
   column.
3. A Section C PWS excerpt: scope, Building Information Sheets, period of performance, hours, a
   standard-services frequency table, courtrooms, public areas, historic finishes, window washing, snow and
   ice removal, grounds maintenance, and Above Standard Services.
4. **Section J, Exhibit J.1, Building Information Sheet**: six sheets, one per building, each a key/value
   form rather than a row table. One of the six was deleted by the amendment.

The PDF sibling `gsa-building-information-sheets-pdf` is rendered from the same HTML and has the same truth.

```bash
node scripts/render-fixtures.mjs tests/fixtures/gsa-building-information-sheets
npx tsx scripts/eval.ts tests/fixtures/gsa-building-information-sheets
```

The DOCX renderer does not emit page breaks. In the DOCX, the "one sheet per page" layout therefore shows up
only through the repeated running-header paragraph ("Section J, Exhibit J.1 – Page J.1-n of 6") and the
repeated "EXHIBIT J.1 – BUILDING INFORMATION SHEET" heading. Each J.1 form is five Word tables (Sections A–B, C,
excluded space, D, and E–F with remarks) plus captions. mammoth's raw text puts every cell on its own line, so each label and its value
sit on consecutive lines.

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
Facility Services, LLC) and every dollar value. The building names use fictional people so they cannot be
mistaken for real federal buildings.

## Expected answers

| GSA No. | Building | Gross SF | Custodial (cleanable) SF | Floors | Restroom fixtures |
|---|---|---:|---:|---:|---:|
| VA0123ZZ | Thomas R. Whitcomb Federal Building and U.S. Courthouse | 118,460 | 88,900 | 5 (4 + basement) | 80 |
| VA0187ZZ | Margaret E. Halloran Federal Building | 64,920 | 52,060 | 3 | 48 |
| VA0241ZZ | Federal Office Building and U.S. Post Office | 38,750 | 22,860 (A0001) | 3 (2 + basement) | 20 |
| VA0318ZZ | Valley Federal Office Building | 18,640 | 15,360 | 1 | 21 |
| VA0402ZZ | Shenandoah Federal Support Center | 46,300 | 40,670 | 2 (incl. mezzanine) | 24 |

- `facilitiesComplete: true`. Service level is `daily_5` for all five buildings (Monday to Friday, excluding
  Federal holidays). Category is `admin` for four buildings and `warehouse` for VA0402ZZ.
- Grounds, per building and in the document's units:

  | Building | Improved turf | Parking | Sidewalks |
  |---|---:|---:|---:|
  | VA0123ZZ | 1.25 ac | 38,600 SF | 11,250 SF |
  | VA0187ZZ | 2.35 ac | 52,400 SF | 6,980 SF |
  | VA0318ZZ | **9,600 SF** | 31,500 SF | 2,860 SF |
  | VA0402ZZ | 3.10 ac | 96,800 SF | 2,150 SF |

  Totals: about 6.92 acres of improved turf, 219,300 SF of parking and 23,240 SF of sidewalks.
- Site: 5 contract years, `temperate`, solicitation `47PC0326R0014`.
- Prior award: contract 47PC0321C0042, Caldera Ridge Facility Services, LLC, awarded 2021, 60 months,
  $5,612,350 total, $1,146,880 for the current option year.

## Traps

1. **Key/value sheets, not a row table.** Each building's numbers are spread across label/value cells, in
   pairs (label | value | label | value), over five tables per sheet.
2. **Several square-footage figures per building.** GSF is the facility size. RSF and ABOA are for
   information only. The Section C total is the cleanable SF.
3. **The Section B schedule is the only row table, and it lists custodial SF, not gross SF.** It also uses
   abbreviated names ("Whitcomb FB-USCH, Winchester") and has a "Total Custodial Square Feet" row (219,850).
4. **A deleted building.** Amendment 0001 deletes VA0355ZZ Federal Records Annex (22,480 GSF). Its sheet
   stays in the package under a "DELETED BY AMENDMENT 0001 – RETAINED FOR REFERENCE ONLY" banner, and CLIN
   0001AF reads DELETED.
5. **A revised value.** VA0241ZZ custodial SF reads "22,860 (revised A0001; was 21,460)".
6. **Excluded space with square footage.** Mechanical rooms, the USMS cellblock, the child care center, USPS
   space and the secure cage are listed with SF but are not cleanable.
7. **Floors split above/below grade.** Amendment answer A1 says the total is the sum of the two.
8. **Fixture counts.** The TOTAL row is the answer. The number of restrooms sits next to it, the header is
   two rows, and drinking fountains and service sinks are listed outside the total.
9. **Glass SF** is a window-washing quantity, not floor area.
10. **Grounds units.** VA0318ZZ gives landscaped area in SF. Total Site Area is information only. VA0241ZZ
    grounds are "Not in contract (USPS)". Remarks mention an unmaintained wooded buffer and a playground
    maintained by others.
11. **Alphanumeric building numbers** (`VA0123ZZ`).
12. **Contract term.** One base year plus four option years is 5 years. The FAR 52.217-8 six-month extension
    does not count.
13. **Prior award is in Q&A prose.** The $75,000 NTE for CLIN 0003 is not a prior-award value.
14. **Running header and CUI footer** repeat on every page.
