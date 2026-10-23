# county-govt-narrative-docx

This is a county government janitorial RFP, `RFP No. 2026-041 – Janitorial Services for County Facilities`, from the
fictional **Kessling County, Michigan** (county seat Ardmore Falls). It is one Word document (.docx): the RFP as issued
on November 2, 2026, followed by **Addendum No. 1** (November 20, 2026), the way a proposer saves the RFP and its
addendum into one file. The original RFP pages say nothing about what the addendum changes.

The facility inventory is mostly narrative. Section 3, "Description of Facilities / Locations", describes each of 21
sites in prose: address, approximate square footage, floors, days and hours of service, special areas (courtrooms,
holding cells, public restrooms, clinic exam rooms) and the areas excluded (the Jail's secure areas and sally port,
garage bays, kennels, kitchens). A short summary table, Table 3-1, covers the 17 County buildings only. It gives no
floors, hours or cleaning areas, and it leaves out the four park buildings.

Word sets the page breaks, so the layout below is approximate. The document is about 5,000 words (about 5,200 counting table cells) and runs to roughly
9–10 Letter pages at Word's default 10 pt font.

| Approx. page | Content |
|---|---|
| 1 | County / Purchasing letterhead, RFP title (Heading 1), key-dates table, "TO WHOM IT MAY CONCERN" cover letter, contents |
| 1–2 | Section 1, General Information: purpose, background (prose total "approximately 480,000 square feet"), 3 + 1 + 1 year term, site tour, addenda, award by site group, additions and deletions |
| 2–3 | Section 2, Scope of Services: supplies, hours (5:30–11:30 p.m.), holidays with open-site exceptions, LEIN / CJIS background checks, **task-frequency table**, winter conditions, work not included (grounds, snow), inspections |
| 3 | Section 3 introduction and **Table 3-1 Summary of Locations** (Sites 1–17, with a total row and an asterisk note) |
| 3–5 | **3.1 Downtown Campus** (Sites 1–5) and **3.2 Justice Complex** (Sites 6–9): Heading 4 per site, address line, narrative paragraph (Site 2 has a plain Grand Traverse-style block under its heading) |
| 5–6 | **3.3 Outlying County Facilities** (Sites 10–17): three-line blocks in the Grand Traverse style, bold site name only ("— estimated square footage: 34,200" / "— Evenings: Monday thru Friday") plus a paragraph |
| 6 | **3.4 Parks and Recreation Facilities** (Sites 18–21): run-in paragraphs; **3.5 Facilities Not Included** |
| 7 | Section 4: proposal tabs, evaluation points, insurance, invoicing, deductions, termination; Attachment A |
| 7–8 | Attachment B Price Proposal Form (Parts A–C, line numbers A-1 … C-4, Est. Qty / Yr, total row) |
| 9–10 | **Addendum No. 1**: opening location change, Site 4 SF revised, **Site 22 added**, revised Table 3-1 total, Attachment B line A-18, Q&A (including the current contract) |

Source: `rfp-2026-041-janitorial.html` → `build/RFP-2026-041-Janitorial-Services-with-Addendum-1.docx`. The renderer
maps headings to Word heading styles, `<p>` to paragraphs, `<br>` to line breaks within a paragraph, and tables to Word
tables. It renders no headers, footers or superscripts, so footnote markers are written as `*`.

```bash
node scripts/render-fixtures.mjs tests/holdout/county-govt-narrative-docx
npx tsx scripts/eval.ts tests/holdout/county-govt-narrative-docx
```

## Provenance (fidelity: real-format)

All values are made up. That covers the county, its towns (Ardmore Falls, Halvorsen, Corwin), the addresses and ZIP
codes, the areas, the schedules, RFP No. 2026-041, the incumbent (Northern Shores Building Services, Inc., Contract
No. KC-23-0412, $91,240 a month) and the contact, which uses the reserved `.example.org` domain. No rows were copied.
The structure and wording follow real county and city janitorial solicitations:

| Source | What the fixture takes from it |
|---|---|
| [Grand Traverse County (MI) Custodial Services RFB, 2020](https://www.gtcountymi.gov/DocumentCenter/View/14906/Custodial-Services-RFB-PDF) and [2017 edition](https://gtcountymi.gov/DocumentCenter/View/7701/Custodial-Services-RFB-PDF?bidId=) | The building block "Governmental Center  estimated square footage: 54,337 / 400 Boardman Avenue  Evenings: Monday thru Friday / Traverse City, MI 49684" (Sites 10–17, 22); "12 County office buildings ... approximately 330,000 total square feet and services for 5 parks" (Section 1.2 and the separate parks group); the holiday rule "no custodial services are required except ... for those buildings noted as open" (2.3); a jail listed as its own location |
| [Clinton County (MI) Janitorial Services RFP](https://clinton-county.org/DocumentCenter/View/7753/Clinton-County-Janitorial-Services-RFP-Final?bidId=) | "It is Clinton County's intent to contract professional cleaning services on an annual basis for the following county facilities" (1.1); "Scope of Work: Clinton County Courthouse (approximately 120,000 sq. ft.) All common areas will be cleaned five (5) nights per week" (Site 1); courtrooms, holding cells, jury rooms, public restrooms; a sheriff's office cleaned three nights a week; a fairgrounds hall (Site 17); background checks and keys (2.4) |
| [Lenoir County (NC) Janitorial Service RFP Addendum #1, March 10, 2023](https://lenoircountync.gov/wp-content/uploads/2023/03/Janitorial-Service-RFP-Addendum-1.pdf) | The addendum header and "Please note the Location and date change for the Bid Opening" (Addendum Item 1); per-building address / floors / SF schedules that include a jail administration office |
| [St. Croix County (WI) Janitorial Services RFP – 2026](https://sccwi.gov/DocumentCenter/View/11885/Janitorial-Services-RFP---2026?bidId=) | The "TO WHOM IT MAY CONCERN" cover letter; "Government Center and Jail" as one location; "Service is to be bid at all of the locations listed, with a separate cost per building" (Attachment B); SF and hours reviewed at the site visit; a three-year term with extensions |
| [Black Hawk County (IA) FY25 RFP Janitorial](https://blackhawkcounty.iowa.gov/DocumentCenter/View/7051/FY25-RFP-Janitorial?bidId=) | Scope limited to "the Jail administration area" (Site 8) |
| [Jefferson County (TX) RFP 23-052/MR addendum](https://jeffersoncountytx.gov/blobs/purchasing/nfb/ADD/236.pdf) | Locations given with floors, elevators, square feet and service days and hours ("Mon-Fri, 5:30 pm–11:30 pm"); the 5:30–11:30 p.m. window in 2.2 and Site 6 |
| [Franklin County (WA) 2025 Janitorial RFP](https://franklincountywa.gov/DocumentCenter/View/4065/2025-Janitorial-RFP-Final?bidId=) | Courthouse, public safety and corrections buildings with square footage by floor and a grand total (the Sites 2, 4 and 6 floor breakdowns) |
| [City of Burlington (WI) Janitorial RFP 2026](https://www.burlington-wi.gov/DocumentCenter/View/4359/RFP-City-of-Burlington-Janitorial-Services-2026) | "Total Sq. Ft." vs "Approx. Area Cleaned" (the gross vs contractor-area split at Sites 6, 8, 10); a short summary table |
| [City of Hendersonville (NC) RFP #221523001](https://www.hendersonvillenc.gov/sites/default/files/uploads/rfp/rfp_221523001_janitorial_services_1.pdf) | Frequency per facility ("City Hall, 3 days per week"; "Downtown Restrooms, 7 days per week"), the model for the park restroom schedules |
| [City of Caribou (ME) Janitorial RFP](https://www.cariboumaine.org/wp-content/uploads/2022/02/RFP-Janitorial-Services.pdf) | "Unless otherwise specified, work shall be on a five-day basis, Monday through Friday, between the hours of ..." (paraphrased in 2.2) |
| [City of Chino Hills (CA) Janitorial RFP](https://www.chinohills.org/DocumentCenter/View/28715/City-of-Chino-Hills-Janitorial-Services-RFP) | Building-specific windows: the police building at night and the library after closing (Sites 5 and 7) |
| [Winnebago County (IL) RFP #24P-2358 Addendum Two](https://wincoil.gov/images/departments/purchasing/open-bids-quotes-rfps/RFP_24P-2358_ADDENDUM_TWO_FINAL_pdf.pdf) and [Addendum One](https://wincoil.gov/images/RFP_24P-2358_ADDENDUM_ONE_docx.pdf) | A bidder Q&A asking for the incumbent and the annual contract value (Addendum Q1/A1); square footage and scope changed by addendum |
| [City of Ventura (CA) janitorial RFP Addendum 1](https://www.cityofventura.ca.gov/DocumentCenter/View/49091/Addendum-1) | The listed SF is the full building size (Addendum Q2/A2) |
| [Missouri OA / FMDC janitorial amendment (Springfield)](https://archive.oa.mo.gov/fmdc/facilitiesoperations/addendum/JLSG0416A_Addendum_1a.pdf) | A location "ADDED PER AMENDMENT 001" with its SF (Addendum Item 3); "may add or delete buildings ... at any time during the term" (1.7) |

**Research limits.** In this session, WebFetch could not resolve any host and the egress proxy refused direct
downloads. The sources above were therefore read only through search-engine excerpts, and the quoted phrases are as
those excerpts gave them. The sally-port / inmate-worker exclusion at the Jail was not found verbatim in any source. It
is the author's own wording, based on scopes that cover only the jail administration area (Black Hawk, Lenoir) and the
Clinton County mention of holding cells. The Michigan details (Friend of the Court, MDOC probation, MSP ICHAT, LEIN,
CPI-U Midwest) are from the author's general knowledge. None of them affects an expected value.

**Independent review (2026-10-23).** WebFetch again failed DNS, and the proxy refused a direct download (403). Search
excerpts confirmed two of the models:

- Black Hawk County's 2024 janitorial bid scopes "Jail (Administration Area and Consolidated Communications Center)".
- Winnebago County's 24P-2358 Addendum Two answers bidder questions on the incumbent and the annual contract value.
  It does so by attaching the prior agreement and an invoice, where this fixture states the amount in A1.

The Grand Traverse and Clinton County phrases could not be re-confirmed from excerpts. Every expected value was
re-derived from the rendered DOCX alone, before `truth.json` was read, and all of them agree. That covers the 22 sites,
the areas, the 3 cleaning areas, the floors, the service levels, the site fields and the prior award.

Known remaining tells:

- The document is about 9–10 pages. Real county RFPs often run 20–40, with full contract boilerplate and forms bound in.
- Every figure reconciles exactly: Table 3-1 sums to its total, and the addendum's revised total equals the old total
  plus the two changes. Real documents often carry small inconsistencies, but adding them on purpose would make the
  ground truth ambiguous.
- The renderer has no Word headers, footers or page numbers. The letterhead is plain body paragraphs.

## Expected answers

- 22 facilities (`facilitiesComplete: true`), Sites 1–22, with the Site number as `buildingNumber`:
  - 17 County buildings (Sites 1–17)
  - 4 park buildings (Sites 18–21)
  - Site 22, added by the addendum
- Post-addendum values:
  - Human Services Building (Site 4) is **46,210**, not 41,750.
  - Community Corrections and Pretrial Services Office (Site 22) is 5,280, one story, Mon / Wed / Fri, so `3x_week`.
- Gross vs `cleanableSqft`:
  - Justice Center: 71,250 / 69,150
  - Jail: 96,800 / 5,850
  - Central Garage: 34,200 / 4,350
- No other site states a cleaning area. Exclusions that have no number leave the building area as is.
- Total gross of the 22 facilities is **496,770**: 489,830 for the 18 buildings in the revised Table 3-1, plus 6,940 for
  the parks.
- Not expected (Section 3.5):
  - Juvenile Detention Center
  - Medical Care Facility
  - former Corwin Township Hall (vacant)
  - Pine Run Park restroom (being demolished)
  - Airport terminal
  - Lakeview concession stand
  - fairgrounds barns, grandstand and outdoor restrooms
- Service levels:
  - `daily_5`: Sites 1, 2, 4, 6, 8, 9, 10, 11
  - `daily_6`: Library (Site 5), Monday–Saturday
  - `daily_7`: LEC (Site 7), plus the seasonal Beach House and Campground Shower Building (Sites 18–19)
  - `3x_week`: Annex (Site 3), Trailhead Restroom (Site 20), Site 22
  - `2x_week`: Sites 12, 15, 16
  - `weekly`: EOC (Site 13)
  - `biweekly`: Records (Site 14)
  - None for the on-call Exhibit Hall (Site 17) and Lodge (Site 21).
- Floors are set where the text gives a story count. They are left out for the Courthouse ("three stories over a full
  basement") and for the Trailhead Restroom (not stated).
- Category is set only where the use is plain:
  - `admin`: offices and the Courthouse
  - `maintenance`: Central Garage
  - `warehouse`: Records Storage Center
  - `community`: Senior Center, Exhibit Hall, Lodge

  It is left out for the Health / Human Services building, the Library, the Justice Center, the LEC, the Jail, Animal
  Control, the EOC and the park restrooms.
- `grounds: []`. Grounds, lawn care and snow removal are County work (1.2, 2.7, 3.4). The acreage in the text is for
  information only.
- Site:
  - 5 contract years (3 years + two 1-year extensions)
  - `cold` (Michigan, with a November–April winter clause)
  - "Kessling County"
  - "RFP No. 2026-041"
- Prior award (Addendum A1 only):
  - $1,094,880 annual ($91,240 a month)
  - Incumbent Northern Shores Building Services, Inc.
  - Contract KC-23-0412, awarded November 2023
  - `totalValue` and `periodMonths` are left out because no total contract value is stated.

## Traps

1. **Narrative inventory.** Square footage, floors, days and exclusions are in prose. Table 3-1 is a partial summary:
   it covers buildings only, with no floors, hours or cleaning areas.
2. **Three narrative layouts:**
   - Heading 4 + address + paragraph (Sites 1–9). Site 2 instead has a plain Grand Traverse-style block under its
     heading.
   - Three-line blocks with a bold site name and `<w:br/>` breaks, where the area sits on the name line and the
     schedule on the address line (Sites 10–17, 22). A reader that drops the breaks glues the area to the street
     number ("34,2002850 County Farm Road", "5,280 sq. ft.610 Orchard Street").
   - Run-in paragraphs with a bold name, followed by the address in the same paragraph (Sites 18–21)
3. **Mixed area wording.** "approximately", "estimated square footage:", "sq. ft. +/-", and "Scope of Work: ... (approximately 38,900 sq. ft.)". Street numbers and ZIP codes sit next to the areas.
4. **Floor-by-floor and floor-finish breakdowns** (Sites 2, 4, 6) sum to the building totals and are not facilities.
5. **Gross vs contractor cleaning area** at the Justice Center, Jail and Central Garage. Table 3-1 shows the gross with
   a glued asterisk ("96,800*").
6. **Excluded sally port and secure areas.** The Jail's secure perimeter and the court holding cells and sally port are
   cleaned by inmate workers or the Sheriff's Office.
7. **Facilities Not Included with areas** (18,600; 84,000; 3,100 vacant; 450 being demolished).
8. **Addendum supersedes.** Site 4 goes from 41,750 to 46,210, and Site 22 is added. Section 1.2's prose total
   ("approximately 480,000") is not revised.
9. **Totals are not facilities:**
   - Table 3-1 total: 480,090
   - Addendum revised total: 489,830
   - Attachment B total price row
10. **Attachment B line numbers ≠ site numbers.** A-17 is Site 20, B-1/B-2 are Sites 18/19, C-1 is Site 17 and A-18 is
    Site 22. "Est. Qty / Yr" values are not facility data.
11. **Names differ** between the narrative, Table 3-1 and Attachment B.
12. **Frequency wording and abbreviations** ("Monday thru Friday", "M, W, F", "Alt. Wed.", "Tu, Th", "On call"). The
    per-task frequency table in 2.5 is not a facility service level. The library is open on Sunday but is cleaned
    Monday–Saturday.
13. **No recurring level for event and rental sites** (17, 21).
14. **Seasonal 7-day park buildings** (18, 19). Model limitation: `daily_7` is 360 days a year in `shared/types.ts`, but
    these buildings are serviced for about 101 and 168 days.
15. **Grounds acreage in sentences** (2.3, 46, 14, 38 and 120 acres; 900 feet of beach). All of it is out of scope.
16. **Distractor counts near the areas.** These are restrooms, courtrooms, 150 jury seats, 212 jail beds, exam rooms,
    campsites, years built and population. Restroom counts are not fixture counts, so `restroomFixtures` is not set.
17. **Prior award only in the addendum Q&A**, among non-award dollar amounts (insurance limits, bond, deductions).

## Regenerating

The facility rows in `truth.json` were written from the same site list as the HTML. If you change a value, update
every place it appears:

- the site narrative
- Table 3-1 and its total
- Attachment B (names only)
- Addendum Items 2–4
- `truth.json`

Then re-render, dump `word/document.xml` (`unzip -p build/*.docx word/document.xml`), and check each site's area,
cleaning area, floors and schedule wording against `truth.json`.
