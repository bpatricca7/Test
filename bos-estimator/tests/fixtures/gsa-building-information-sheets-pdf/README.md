# gsa-building-information-sheets-pdf

This is the same package as `gsa-building-information-sheets`, rendered as an **11-page Letter PDF with a text
layer** instead of a DOCX. The HTML source `j1-building-information-sheets.html` is byte-identical between the
two fixtures. In `truth.json`, `expect` is identical. Only `id`, `title`, `inputs[0].as` and the
format-specific wording of a few traps differ (page layout, banner placement, two-row header, running
header).

```bash
node scripts/render-fixtures.mjs tests/fixtures/gsa-building-information-sheets-pdf
npx tsx scripts/eval.ts tests/fixtures/gsa-building-information-sheets-pdf
```

Page layout:

| Page | Content |
|---|---|
| 1 | Cover block and Summary of Changes, Amendment 0001 (deleted building, revised SF, Q&A: floors serviced, child care, the incumbent with its contract value and scope, glass, plowing) |
| 2 | Section B schedule excerpt (one CLIN per building, with a Custodial Sq. Ft. column and a total row) |
| 3–5 | Section C PWS excerpt (scope, J.1 / Custodial Square Footage Tool, term, hours, C.1.5 Service Contract Labor Standards, frequency table, window washing, snow, grounds, C.15), ending with the Section J list of attachments (J.1–J.5, with the wage determinations as J.2) |
| 6–11 | Section J, Exhibit J.1, Building Information Sheet: one building per page (VA0123ZZ, VA0187ZZ, VA0241ZZ, VA0318ZZ, VA0402ZZ, then VA0355ZZ marked DELETED BY AMENDMENT 0001) |

PDF-specific behavior:

- In `pdftotext -layout`, the key/value form prints as two label/value pairs per line, for example
  `Gross Square Feet (GSF)  118,460  Rentable Square Feet (RSF)  97,315`. A line-based reader can therefore
  pair the wrong label with a number.
- Labels that wrap ("Landscaped / Improved Grounds") split across two lines.
- On page 11 the boxed DELETED banner sits between the running header and the VA0355ZZ sheet heading. A reader
  that splits at the heading instead of the page boundary attaches it to the VA0402ZZ chunk.
- The renderer adds a "Page n of 11" footer in addition to the document's own running header ("Page J.1-n of
  6"), so every page has two page-numbering schemes.

## Provenance (fidelity: real-format)

The provenance is the same as for the DOCX fixture. Layout and wording follow these GSA documents:

- National Consolidated Maintenance Specification v1.2, Dec 2024: https://www.gsa.gov/system/files/National_Consolidated_Services__PWS_20241205.pdf
- National Consolidated Facilities Engineering Specification, Dec 2022: https://www.gsa.gov/system/files/National_Facility_Engineering_Consolidated_Services_w_VTS_PWS-20221215.pdf
- DRAFT PWS 2020 National Custodial: https://govtribe.com/file/government-file/draft-pws-2020-national-custodial-dot-pdf
- National O&M Specification, Mar 2025: https://www.gsa.gov/system/files?file=2025+National+OM+Spec-030525.pdf
- 2024 National Custodial Specification: https://www.gsa.gov/system/files/2024_National_Custodial_Specification_October_2024-1.pdf

The specific wording borrowed: Exhibit J.1 "Building Information Sheet" prepared with the Custodial Square
Footage Tool, one sheet per building, custodial SF counting only space cleaned routinely, standard versus
Above Standard (C.15) services, once-a-year window washing, and snow and ice removal at entrances and walks.

Only the pattern of the building numbers comes from a real GSA number, `AR0057ZZ`. Sections A–F of the J.1
form are a reconstruction, because the real field list did not appear in any search excerpt. Every
building, number, square footage, fixture count, grounds quantity, the incumbent, the wage determination
numbers and every dollar value are made up. Some details are kept plausible on purpose:

- The incumbent PIID `47PC0322C0042` carries FY digits `22` because it was awarded in December 2021, which is
  FY2022.
- The courthouse is in Harrisonburg, where the W.D. Va. holds court.
- Rentable/ABOA ratios are 1.11–1.22.

The `47PC03` activity code and the `3PQ` office symbol could not be verified.

## Expected answers and traps

These are the same as `gsa-building-information-sheets`; see that README and `truth.json`. In short:

- **Facilities:** five, with gross SF 118,460 / 64,920 / 38,750 / 18,640 / 46,300 and cleanable SF 88,900 /
  52,060 / 22,860 / 15,360 / 40,670.
- **Floors and fixtures:** floors 5 / 3 / 3 / 1 / 2 (above plus below grade, per A1) and restroom fixtures
  80 / 48 / 20 / 21 / 24.
- **Service level:** `daily_5` for four buildings. VA0402ZZ is not scored: 28,870 of its 40,670 custodial SF
  is Weekly and 11,800 SF is Daily, which no single facility-level service level can represent.
- **Deleted building:** VA0355ZZ is deleted by Amendment 0001.
- **Revised value:** VA0241ZZ custodial SF is revised to 22,860.
- **Grounds:** improved turf, parking and sidewalks for four buildings. VA0318ZZ turf is in SF. The grounds
  for VA0241ZZ belong to USPS and are excluded.
- **Section B schedule:** it lists custodial SF, not gross SF.
- **Prior award:** it is in the amendment Q&A (A3), contract 47PC0322C0042. The incumbent's scope was 235,370
  custodial SF: it included VA0355ZZ and its grounds and excluded VA0241ZZ Suite 210. The new scope is 219,850
  custodial SF, 93.4% of the incumbent's, so a top-down cross-check from the $1,146,880 option-year value must
  be scaled down to match.
