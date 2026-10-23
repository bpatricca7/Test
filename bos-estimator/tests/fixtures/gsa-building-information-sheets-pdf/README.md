# gsa-building-information-sheets-pdf

This is the same package as `gsa-building-information-sheets`, rendered as an **11-page PDF with a text
layer** instead of a DOCX. The HTML source `j1-building-information-sheets.html` is byte-identical between the
two fixtures, and `truth.json` differs only in `id`, `title` and `inputs[0].as`.

```bash
node scripts/render-fixtures.mjs tests/fixtures/gsa-building-information-sheets-pdf
npx tsx scripts/eval.ts tests/fixtures/gsa-building-information-sheets-pdf
```

Page layout:

| Page | Content |
|---|---|
| 1 | Cover block and Summary of Changes, Amendment 0001 (deleted building, revised SF, Q&A with the incumbent and contract value) |
| 2 | Section B schedule excerpt (one CLIN per building, with a Custodial Sq. Ft. column and a total row) |
| 3–5 | Section C PWS excerpt (scope, J.1 / Custodial Square Footage Tool, term, hours, frequency table, window washing, snow, grounds, C.15) |
| 6–11 | Section J, Exhibit J.1, Building Information Sheet: one building per page (VA0123ZZ, VA0187ZZ, VA0241ZZ, VA0318ZZ, VA0402ZZ, then VA0355ZZ marked DELETED BY AMENDMENT 0001) |

PDF-specific behavior. In `pdftotext -layout`, the key/value form prints as two label/value pairs per line,
for example `Gross Square Feet (GSF)  118,460  Rentable Square Feet (RSF)  97,315`. A line-based reader can
therefore pair the wrong label with a number. Labels that wrap ("Landscaped / Improved Grounds") split across
two lines. The renderer adds a "Page n of 11" footer in addition to the document's own "Page J.1-n of 6"
running header.

## Provenance (fidelity: real-format)

The provenance matches the DOCX fixture. Layout and wording follow these GSA documents:

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
building, number, square footage, fixture count, grounds quantity, the incumbent and every dollar value are
made up.

## Expected answers and traps

These are the same as `gsa-building-information-sheets`; see that README and `truth.json`. In short:

- **Facilities:** five, with gross SF 118,460 / 64,920 / 38,750 / 18,640 / 46,300 and cleanable SF 88,900 /
  52,060 / 22,860 / 15,360 / 40,670.
- **Floors and fixtures:** floors 5 / 3 / 3 / 1 / 2 (above plus below grade) and restroom fixtures 80 / 48 /
  20 / 21 / 24.
- **Deleted building:** VA0355ZZ is deleted by Amendment 0001.
- **Revised value:** VA0241ZZ custodial SF is revised to 22,860.
- **Grounds:** improved turf, parking and sidewalks for four buildings. VA0318ZZ turf is in SF. The grounds
  for VA0241ZZ belong to USPS and are excluded.
- **Section B schedule:** it lists custodial SF, not gross SF.
- **Prior award:** it is in the amendment Q&A.
