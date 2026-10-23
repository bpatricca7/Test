# scanned-bos-facility-exhibit

This is a **scanned, image-only PDF** of the kind often posted to SAM.gov as an amendment attachment. It is Amendment 0001
to Solicitation **70Z08427QTCPA0019**, *Janitorial Services, U.S. Coast Guard Training Center Port Arden, Alabama* (a
fictional installation), followed by the **conformed copy of PWS Technical Exhibit 5**, *Buildings Requiring Janitorial
Service, Square Footage and Service Schedule*. On that copy the contracting officer has entered the amendment changes in
ink: a row struck through, a value struck and rewritten, a code changed, a row added by hand, and the subtotals and the
total corrected by hand. The PDF has no text layer, so the rule-based reader finds nothing. This fixture measures the AI
reader's vision path.

| Page | Content |
|---|---|
| 1 | **SF 30**, Amendment of Solicitation/Modification of Contract: Amendment 0001, effective 21-Oct-2026. Block 11 says the closing date is not extended. Block 14 gives the purpose and says the conformed TE 5 is on pages 3–5. Signed by the CO. |
| 2 | **OF 336 continuation sheet**: Section C changes (1)–(5) to TE 5 (delete T-47, Bldg 17 code D→A, Bldg 3 service area 18,450→22,610, add M-115, revised totals). Q&A 1–6 cover the vacant Bldg 41, the recruit barracks, the option Bldg 118, the incumbent and its contract value, the period of performance, and gross vs service-area SF. |
| 3 | TE 5 page 1: running header, CONFORMED COPY / AMENDMENT 0001 stamp and CO initials, para 5.1 (gross SF for information only, price the service area, "shall only bill for the square footage serviced"), para 5.2 with the seven-code service schedule legend, para 5.3 (418 acres; grounds not in this PWS). Then the table: Area I, items 1–11, the handwritten item 11A, and the Area I subtotal. |
| 4 | TE 5 page 2 (header and the (1)…(8) column-number row repeated): Areas II, III and IV, the subtotals, and the TOTAL row (struck and corrected by hand). |
| 5 | TE 5 page 3: notes 1–9 to the table, para 5.4 *Buildings Not Included in This PWS (For Information Only)*, paras 5.5–5.6, the "Changes entered by Amendment 0001 … Conformed by" box, and the end of the exhibit. |

Source: `70z08427qtcpa0019-amd0001-te5-conformed.html` → `build/70Z08427QTCPA0019_Amd0001_TE5_Bldg_List_Conformed_SCAN.pdf`
(`scanned-pdf`: the renderer prints the HTML, rasterizes it at 110 dpi and rebuilds an image-only gray PDF).

```bash
cd /home/user/Test/bos-estimator
node scripts/render-fixtures.mjs <path-to>/scanned-bos-facility-exhibit
pdffonts  "<path-to>/scanned-bos-facility-exhibit/build/70Z08427QTCPA0019_Amd0001_TE5_Bldg_List_Conformed_SCAN.pdf"   # no fonts
pdftoppm -r 110 -png "<same pdf>" /tmp/pages                                                                        # look at the pages
```

How the scan look is made (in the HTML, before the renderer's rasterize step):

- full-bleed pages (`@page { margin: 0 }`) with a gray scanner bed showing at the edges;
- 0.22–0.42° of skew per page in alternating directions, plus an edge shadow;
- three-hole-punch shadows on the TE pages, a staple on page 1, and specks, which stay mostly in the margins so that no
  printed digit is changed;
- a rotated double-ruled rubber stamp that overlaps the end of the exhibit title;
- the ink changes are **hand-lettered by a small script in the page**: single-stroke ballpoint capitals and digits with
  random slant, rotation, size and baseline jitter (seeded, so every render is identical). They are not a typeface. The
  ink is blue in the source and comes out dark gray after the renderer's grayscale filter, so it stands apart from the
  print by stroke, not by color. Strike-throughs are hand-drawn lines; the deleted row has one line across the whole row.

Renderer limits (not fixable from the fixture): the renderer adds a small "Page n of 5" footer; the PDF metadata comes
from headless Chromium; the page images are 300-ppi RGB containers holding 110-dpi content, where a real scanner writes
grayscale or bitonal images.

## Provenance (fidelity: real-format)

Every name and value is made up: the installation, solicitation 70Z08427QTCPA0019, the CO, the incumbent (Seawall
Facility Services, LLC, contract 70Z08422CTCPA0007, $5,862,340) and all building data. No rows were copied. The layout
and wording follow real documents.

**Research limits in this session.** WebFetch failed DNS resolution for every host, and direct downloads were refused by
the egress proxy. The four PWS sources marked *(read)* were read in full from local copies of the same public files,
downloaded earlier in this workspace. The other sources were used only through WebSearch result text.

| Source | What the fixture takes from it |
|---|---|
| [USCG Base Seattle Janitorial PWS, HSCG84-17-R-PTE001](https://imlive.s3.amazonaws.com/Federal%20Government/ID151682101211780583073746200899112515222/PWS%20Attachment%2009132018.pdf) *(read)* | The Coast Guard janitorial PWS with its workload in Technical Exhibits ("Technical Exhibit #5 provides the square footage of space to be cleaned by building and level of service"). Para 5.1 copies "Contractor shall only bill for the square footage serviced". Also taken: buildings serviced only in part, unoccupied buildings left unserviced until the KO says otherwise (Bldg 41), secure areas with escorts (Note 7), the solicitation number at the top right, and the "Attachment #1 … PAGE n OF N" footer. |
| [Dyess AFB Custodial PWS, Appendix B (13 Aug 2021)](https://imlive.s3.amazonaws.com/Federal%20Government/ID297162707687379821580624672536441025401/Attachment%201%20-%20Custodial%20PWS.pdf) *(read)* | A table grouped into blocks. Each block ends in a subtotal row that puts the building count in the facility-number column ("6  Total # Facilities … 47,266"), and the table ends in a grand total. "Estimated" cleaned SF is the pricing basis. Modifications are priced on the Appendix B cleaning-area SF. Per-facility hour restrictions appear in the table. |
| [Sheppard AFB / Frederick AAF Custodial PWS, Appendix B](https://imlive.s3.amazonaws.com/Federal%20Government/ID239120740891441165113625913503342013529/Atch_02_Custodial_Services_-_PWS.pdf) *(read)* | "Total Cat …" subtotal rows with the count in the Bldg # column. |
| [Fort Wainwright Custodial PWS (08 Jan 2019)](https://imlive.s3.amazonaws.com/Federal%20Government/ID31544869489761803466574390107441771546/Attachment_A_-_Custodial_Performance_Work_Statement.pdf) *(read)* | Workload exhibits kept separate from the standards-and-frequencies exhibits (here TE 5 vs TE 3). Workload changes are computed from the square footage added or deleted (para 5.1 / PWS 5.7). |
| [Fort Cavazos Custodial Services Policy memo](https://home.army.mil/hood/download_file/force/2d03cdaa-93fd-4ee5-b8bc-a3ef7e4b38ef/418) (search text) | "The baseline custodial services … operate on a bi-weekly schedule". This is the basis for code F, which the legend defines as "Every other week (bi-weekly)". |
| [Leon County Schools Addendum No. 1, RFP 303-2013](https://www.leonschools.net/cms/lib/FL01903265/Centricity/Domain/195/CURRENT%20RFPS/RFP%20303-2013/AddendumNo1RFPNo3032013CustodialServices%20for%20ChilesHSAddendumNo152012.pdf) (search text) | An addendum that deletes buildings and restates the total square footage ("Delete buildings 200, 300 and all portables"). Model for amendment items (1) and (5). |
| [Lee County RFP240120SML Am 2 "HVS Sqft Correction - EXEC OCR"](https://leegov.com/procurement/Project%20Documents/RFP240120SML%20Custodial%20Services%20for%20Downtown%20Buildings/RFP240120SML-%20Custodial%20for%20Downtown%20Buildings%20-%20USSI%20-%20Am%202%20-%20HVS%20Sqft%20Correction%20-%20EXEC%20OCR.pdf) (search text) | An executed amendment posted as a scan that corrects one location's square footage. Model for the scanned posting and for item (3). |
| [Fort Riley custodial solicitation revisions (BidNet abstract)](https://www.bidnetdirect.com/public/supplier/solicitations/statewide/2569597752/abstract) (search text) | "AT 7 Facility List-Job Orders updated. (2 buildings added …)". A facility list revised by amendment to add buildings (item (4), M-115). |
| [Example SF 30 (GSA Advantage 47QSWA21D005Y)](https://www.gsaadvantage.gov/ref_text/47QSWA21D005Y/47QSWA21D005Y_SF30.pdf) (search text) | The Block 14 "See attached" practice and the standard closing sentence ("Except as provided herein, all terms and conditions of the document referenced in Item 9A or 10A, as heretofore changed, remains unchanged and in full force and effect"). The SF 30 (REV. 11/2016) and OF 336 layouts on pages 1–2 come from the author's knowledge of the standard forms. |
| [DHS APFS USCG janitorial forecast record](https://apfs-cloud.dhs.gov/record/69898/public-print) (search text) | The 70Z0-series USCG numbers seen in the same search (70Z03724PLALB0081, 70Z08426QAA850700, 70Z03326QSEAT0020) set the format of the fictional solicitation and contract numbers. |

Known remaining tells:

- The package has 5 pages. A real amendment would usually also carry the revised CLIN schedule and other PWS changes.
- Every figure reconciles exactly. The CO's hand totals are right, and the typed list of changes matches the ink.

## Expected answers

- **31 facilities** (`facilitiesComplete: true`). Gross SF sums to **799,515** and service area to **381,210**; these
  equal the hand-corrected TOTAL row and amendment item (5). Building numbers come from column (2).
- `grossSqft` = column (5) Gross SF. `cleanableSqft` = column (6) Service Area SF (the pricing basis). `floors` = column (4).
- Post-amendment values:
  - T-47 is deleted.
  - M-115 is added (2,880 / 2,640, 1 floor, code A).
  - Bldg 3's service area is 22,610.
  - Bldg 17 is code A (`daily_5`).
- `serviceLevel` comes from the code legend:

  | Code | Schedule | `serviceLevel` |
  |---|---|---|
  | A | Monday–Friday | `daily_5` |
  | B | 7 days a week | `daily_7` |
  | C | Monday–Saturday | `daily_6` |
  | D | Mon/Wed/Fri | `3x_week` |
  | E | 1 day a week | `weekly` |
  | F | every other week | `biweekly` |
  | P | periodic services only | omitted |

  The three code-P recruit barracks are in scope with no service level.
- `category` is given only where the name is unambiguous:
  - `admin`: 10, 1, 3
  - `barracks`: 11, 12, 13, 14
  - `education`: 16, M-115
  - `dining`: 18
  - `medical`: 2
  - `warehouse`: 5, 5A
  - `maintenance`: 6, 31
  - `child_care`: 50
  - `fitness`: 51
  - `community`: 52, 53

  The rest are left out (processing center, drill hall, pool, seamanship and electronics training, gate, engineering office,
  station ops, ATON, DC trainer, library, outdoor recreation).
- Not expected:
  - T-47, deleted by Amendment 0001
  - 41, vacant
  - 118, option CLIN 0005 only
  - the para 5.4 buildings: 21, 60, 35 and 201–236
- `grounds: []`. Para 5.3 states 418 acres, but grounds maintenance is under a separate contract.
- Site:
  - 5 contract years (A5: one base year and four option years)
  - `hot_humid` (Port Arden, Alabama, Gulf Coast)
  - installation "Training Center Port Arden"
  - solicitation 70Z08427QTCPA0019
- Prior award (A4):
  - `totalValue` $5,862,340, the total including options
  - `periodMonths` 60
  - incumbent Seawall Facility Services, LLC
  - contract 70Z08422CTCPA0007
  - awarded 2022

  No annual value is stated.

## Traps

1. **No text layer.** Everything must be read from 110-dpi skewed gray page images.
2. **Amendment pages first.** The SF 30 and continuation sheet come before the exhibit. They are full of numbers that are
   not facilities: requisition, office code, page counts and dates.
3. **Struck-through row.** Item 11, T-47, is struck through with "DELETED A0001 JRM" written in ink.
4. **Handwritten added row.** "11A M-115 MODULAR CLASSROOM 1 2,880 2,640 A ADD A0001" is written in a blank row and is
   also typed in item (4).
5. **Struck value rewritten.** Bldg 3 service area "18,450" is struck and "22,610" is written to its left in the same
   cell. Gross 26,480 is unchanged.
6. **Code changed in ink.** Bldg 17 code "D" is struck and "A" is written beside it.
7. **Subtotals and total struck and corrected by hand:**

   | Row | Column | Printed | Corrected |
   |---|---|---|---|
   | Area I | Gross | 391,535 | 385,775 |
   | Area I | Service area | 158,560 | 153,280 |
   | Area II | Service area | 136,730 | 140,890 |
   | TOTAL | Gross | 805,275 | 799,515 |
   | TOTAL | Service area | 382,330 | 381,210 |

   Area II gross (282,180) and the Area III and IV subtotals are unchanged. The building counts sit in the Bldg No.
   column. None of these rows is a facility.
8. **Gross vs service area.** The service area is a small share of gross for the warehouse, drill hall, boathouse,
   barracks, UPH and galley.
9. **Letter codes.** The frequency is a letter code that needs the legend on page 3. "Bi-weekly" is defined as every
   other week, and code P has no routine service.
10. **Code P barracks are in scope.** Recruits clean berthing; the contractor does periodic floor care (Note 5, A2).
11. **Vacant building in the table.** Bldg 41 has gross SF but "—" for service area and code.
12. **Option-only building with full values.** Bldg 118 shows 68,000 / 15,200 / A but is option-only.
13. **Not-in-contract list with gross SF.** The para 5.4 buildings are listed with their gross SF but are not in the
    contract.
14. **Item numbers collide with building numbers.** Item 12 is Bldg 1, Bldg 12 is Item 3, Item 14 is Bldg 3, and Bldg 14
    is Item 21.
15. **Distractors.** Footnote superscripts are glued to header words. Remarks contain "Note n", times, room numbers and a
    CLIN. The (1)…(8) row numbers the columns.
16. **Acreage stated, grounds out of scope.**
17. **Award and term only in the Q&A.** The prior award and the contract term appear only in the Q&A on page 2.
18. **Rubber stamp.** It overlaps the exhibit title.
19. **Table over two pages.** The table spans two pages with repeated headers and continuation markers. Its notes are on
    the next page. Long names wrap.

## Regenerating

The HTML and `truth.json` were generated together from one data table, so these all come from the same rows:

- the printed rows
- the original subtotals
- the hand-corrected values
- the amendment text
- the expected facilities

The generator, with its stylesheet, hand-lettering script and truth metadata, is kept outside this fixture on purpose.
If you edit a value by hand, update every place it appears:

- the row (and its hand-lettered `data-t` value, if any)
- the area subtotal (printed and corrected)
- the TOTAL row
- continuation item (5)
- `truth.json`
