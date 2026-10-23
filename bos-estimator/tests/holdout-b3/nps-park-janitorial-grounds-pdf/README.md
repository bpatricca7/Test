# nps-park-janitorial-grounds-pdf

This is a National Park Service janitorial and grounds maintenance Performance Work Statement: **Attachment J-1** to
Request for Quotes `140P6127Q0018` for "Tamarack Lakes National Recreation Area", a fictional NPS unit in Aitkin and
Itasca Counties, northern Minnesota. It is one 11-page PDF with a text layer. The PWS was issued November 16, 2026, and
**Amendment 0001** (December 8, 2026) follows it, the way an offeror saves the attachment and its amendment as one file.
The original PWS pages never mention what the amendment changes.

The park has a year-round visitor center, headquarters, ranger station and maintenance shop. It also has a 96-site
campground with two shower houses, a swim beach with a beach house, two day use areas, vault toilets at trailheads,
overlooks and boat accesses, and picnic shelters. Most buildings are open only part of the year. Each facility has
its own open and close dates and a separate cleaning frequency for the Peak, Shoulder and Winter seasons.

| Pages | Content |
|---|---|
| 1 | Header block, Part 1 General: location, background, scope, period of performance (base + 4 option years, FAR 52.217-8), season definitions table |
| 2 | 1.6–1.9 (hours, holidays, Government-furnished supplies, SCA wage determination); Part 2 Janitorial: facility types, square footage rules, frequency rules |
| 3 | 2.4–2.7 (opening/closing cleans, **exclusions**, changes, reporting); Part 3 Grounds: Type I/II/III mowing definitions, paved areas, policing, grounds exclusions |
| 4 | Part 4: Quality Control Plan and the Performance Requirements Summary (task / standard / frequency / AQL-deductions) |
| 5–7 | **Technical Exhibit 1, Facility Schedule** (landscape, 15 columns, three-row header repeated on each page; 34 rows in five area groups, with area subtotals, a grand total, footnotes 1–5 and (b)–(g), and a Summary by Facility Type) |
| 8 | Technical Exhibit 2: frequency codes (Table 2-A) and the task-by-facility-type frequency matrix (Table 2-B) |
| 9 | **Technical Exhibit 3, Grounds Maintenance Schedule**: Table 3-A mowing acres by Type, Table 3-B parking lots, walks and paved trail, Table 3-C campsite and site policing counts |
| 10–11 | **Amendment 0001**: SF-30 style block. Part I changes: correct the Visitor Center SF and fixture counts, delete a vault toilet, change a shelter frequency, add a new vault toilet row, add a parking lot, revised totals. Part II Q&A, including the incumbent contract |

Render and score:

```bash
node scripts/render-fixtures.mjs <this directory>
npx tsx scripts/eval.ts <this directory>
```

## Provenance (fidelity: real-format)

All values are made up. That covers the park, the solicitation and amendment, building numbers, FMSS numbers, square
footages, fixture counts, season dates, acreages and lot areas. It also covers the incumbent: North Country Facility
Services, LLC, contract 140P6122C0009, $2,731,460 over 60 months, Option Year 4 price $574,920. No rows were copied.

This session's network allowed only S3-hosted files. Three source documents were downloaded and read: the first three
rows below. The others were reached only through web-search summaries, so their wording is paraphrased from those
summaries and was not checked against the original attachments.

| Source | What the fixture takes from it |
|---|---|
| [NPS Whiskeytown NRA, 140P8419Q0071 Attachment J01 SOW](https://imlive.s3.amazonaws.com/Federal%20Government/ID202944747771807500442080869327059204931/Updated_Attach_J01_SOW_WHIS_Septic_Pumping.pdf) (read) | The centered running header on every page (solicitation no. / attachment / service / park). The Location and Background sections, with park and lake acreage and an address block. The `140P…` number format. "a base year, with the potential for up to four option years". The "on a weekly basis, or more often, as necessary" wording. Vault toilets pumped under a separate contract |
| [USFS Oconee Ranger District janitorial SOW](https://imlive.s3.amazonaws.com/Federal%20Government/ID167819653642157368861870817738396665411/Attachment%201.%20Statement%20of%20Work%20final%20.pdf) (read) | Area and frequency stated together ("approximately 4,474 sq. feet … twice per week (Wednesday and once on weekend)"). The base + option-year date list. "The frequencies listed are the suggested minimum and are in no way intended to limit…". The "Out of Order" sign duty. The Task / Standard / Frequency / AQL-Deductions table, including "95% – $1.50 per sq. ft. for the entire room or area being serviced" and "$50 for each instance" |
| [USCG Base Seattle janitorial PWS, HSCG84-17-R-PTE001](https://imlive.s3.amazonaws.com/Federal%20Government/ID151682101211780583073746200899112515222/PWS%20Attachment%2009132018.pdf) (read in part) | Numbered "Technical Exhibits" for frequency by task and SF by building. "Contractor shall only bill for the square footage serviced". Stop-service notice "no less than forty-eight (48) hours in advance" |
| [USACE Pine Flat Lake Janitorial (W9123826QA027 / W9123825QA011)](https://g2x.com/app/opportunities/sam/1e0c34db-4374-45f8-9de1-a4d97903a9b1) (search summary) | Headquarters compound plus recreation areas. Separate line items for permanent restrooms in the recreation season and the off season, vault restrooms, and fish cleaning stations. This is the model for season-dependent frequencies and the fish cleaning station row |
| [USACE Winnibigoshish Dam Recreation Area janitorial (W912ES24Q0052)](https://govtribe.com/opportunity/federal-contract-opportunity/janitorial-services-for-winnibigoshish-dam-recreation-area-w912es24q0052) (search summary) | A Minnesota campground: shower and restroom buildings, fish cleaning house and picnic shelter, cleaned 7 days a week from May 1 to October 16. This is the model for shower houses cleaned 7X/WK all season |
| [USFS Olympic NF / Mt. Baker-Snoqualmie vault toilet cleaning (1240BD25Q0023)](https://www.highergov.com/contract-opportunity/vault-toilet-cleaning-olympic-national-forest-and-1240bd25q0023-o-85652/) (search summary) | Single-riser and double-riser vault toilet buildings and multi-stall flush buildings as schedule types, with square footage for each building and May–September servicing. This gives the VT-S / VT-D codes and risers counted as toilets |
| [USACE Coyote Valley Dam / Lake Mendocino janitorial (W912P726QA006)](https://www.highergov.com/contract-opportunity/coyote-valley-dam-and-lake-mendocino-recreation-ar-w912p726qa006-k-013a7/) (search summary) | Scope varies between recreation and non-recreation seasons. Shower-building task list: fixtures, floors, walls, partitions, benches, showers, stalls |
| [Rocky Mountain NP, "Ever Wonder Who Cleans the Toilets?"](https://www.nps.gov/romo/toilets.htm) (search summary) | Comfort stations, roadside and trailhead vault toilets, and campground and visitor center toilets cleaned daily in summer. Seasonal water shut-off |
| [Cuyahoga Valley NP restrooms list](https://www.nps.gov/cuva/restrooms-and-drinking-water.htm) (search summary) | Counts of stalls, urinals and sinks for each restroom building (Exhibit 1, Columns 7–10) |
| [Fredericksburg, VA IFB #26-0044 Janitorial Services](https://fredericksburgva.gov/DocumentCenter/View/31887/IFB-26-0044-Janitorial-Services?bidId=) (search summary) | Days per week that change by date range, with named days ("5 days per week (Tuesday–Saturday) Sept 1 – May 31; 6 days per week … June 1 – Aug 31"). This gives codes like 5X/WK (W–Su) and 5X/WK (Th–M) |
| [USFS T&D "Cleaning Recreation Sites" (9523-1206)](https://www.fs.usda.gov/t-d/pubs/html/95231206/95231206.htm) (search summary) | Site managers set frequency by use. Vaults are pumped before they are three-fourths full (PWS 2.3.1, 2.7) |
| [USACE EM 1110-1-400](https://www.publications.usace.army.mil/Portals/76/Publications/EngineerManuals/EM_1110-1-400.pdf) (search summary) | Restrooms in campgrounds and day use areas, and shower houses at campgrounds and beaches |

Known remaining tells:

- The park, its unit code TALA, and the contracting office's location and name are invented. The requisition number,
  WD revision and the contracting officer are placeholders.
- Real NPS packages put the CLIN price schedule in the solicitation (Section B / SF 1449) and maps in a separate
  attachment. This file has only the PWS and its amendment. CLIN 0004 and Attachment J-2 are referenced but not included.
- Every figure reconciles exactly. Real schedules often carry small FMSS inconsistencies, but adding them on purpose
  would make the ground truth ambiguous.

## Expected answers

- **29 facilities** (`facilitiesComplete: true`), **47,426 gross SF** after Amendment 0001. Building numbers are
  Column (3) "Bldg./Asset No.", not the Item No. and not the six-digit FMSS Loc. No.
- The as-issued exhibit lists 34 rows. Five of them are not serviced: 121 (N/S), 214 (OPT, CLIN 0004 only), 312 and
  412 (CONC), and 413 (N/S, closed for demolition). The amendment makes these changes:
  - 101 changes from 11,860 to 12,940 SF.
  - VT-56 (Item 31) is deleted.
  - VT-60 (Item 35, 144 SF) is added.
  - PS-22's Shoulder frequency changes to 2X/WK.
- Bldg. 120 Maintenance Shop has `grossSqft` 8,960 and `cleanableSqft` 1,240. Note (b), PWS 2.5(b) and Q2 limit
  service to the office, break room and locker/restrooms.
- `floors`: PWS 2.1 says every building and structure is single-story except 101 (two levels) and 102 (two stories).
- `category` is set only where the type code maps unambiguously: ADM to `admin` (102, 104) and MS to `maintenance`
  (120).
- `restroomFixtures` is toilets + urinals + sinks + showers from Columns (7)–(10), after the amendment. For vault
  toilets, toilets are risers (Note 1). It is omitted for picnic shelters and the fish cleaning station, which have no
  fixtures. The fish-cleaning sinks and the Beach House's exterior foot showers are explicitly not counted.
- `serviceLevel` is set only where every open-season frequency column has the same code:

  | Level | Facilities |
  |---|---|
  | `daily_7` | 105, 210, 211, 212, and 310 (2X/DAY = twice daily, 7 days per week; Table 2-A, Q5) |
  | `daily_5` | 102 (M–F) and 411 (Th–M) |
  | `3x_week` | 104 |
  | `2x_week` | VT-55 and the amended PS-22 |
  | `weekly` | 120, PS-32, VT-53, VT-54, VT-58, PS-59 |

  Thirteen facilities have frequencies that change by season and get no `serviceLevel`: 101, 213, VT-21, FC-23, 311,
  PS-31, 410, VT-41, PS-42, VT-51, VT-52, VT-57 and VT-60.
- **Grounds** (16 rows):
  - Table 3-A Type I is `improved_turf`: G-1 6.4 (Bldgs. 101, 102, 104), G-3 9.8, G-4 7.5, G-5 3.6 acres.
  - Type II is `semi_improved`: G-2 2.2 (Bldg. 120), G-6 21.7, G-8 1.9 acres.
  - Type III is `unimproved`: G-7 14.0 acres.
  - Table 3-B parking lots in SF: P-1 52,800, P-2 14,600, P-3 38,400, P-4 71,500, P-5 46,200, and P-6 12,400 (added
    by the amendment).
  - Sidewalks: W-1 9,850 SF and W-2 Lakeshore Paved Trail 76,032 SF. Table 3-B gives W-2 as 9,504 LF, and its
    name states "8 ft wide (1.8 mi)", so truth carries the area, 9,504 LF × 8 ft (the same LF × width convention as
    `city-parks-mowing-pdf`). Keeping 9,504 LF would let the scorer widen it at a default 5 ft (47,520 SF), and reading
    9,504 as SF is wrong. The sidewalk total is 85,882 SF.
  - Table 3-C (campsites, fire rings, grills, containers) holds counts, not areas, and is not expected.
- Site: 5 contract years (base + 4 options; the 52.217-8 extension is not counted), `cold`, "Tamarack Lakes National
  Recreation Area", "140P6127Q0018".
- Prior award, stated only in Amendment Q&A A1:
  - Total $2,731,460 over 60 months
  - Option Year 4 price $574,920 (`annualValue`)
  - Incumbent North Country Facility Services, LLC
  - Contract 140P6122C0009, awarded 2022

## Traps

1. **Three identifier columns.** Item No. (1–35), FMSS Loc. No. (six digits that look like square footages) and
   Bldg./Asset No. The amendment refers to rows by Item No.
2. **Amendment at the end supersedes the exhibit.** The original pages never mention it:
   - The Visitor Center goes from 11,860 to 12,940 SF, and its fixtures from 19 to 23.
   - VT-56 is deleted.
   - VT-60 is added as a full row inside the amendment.
   - PS-22's level changes from mixed to `2x_week`.
   - Parking lot P-6 is added.
   - Revised totals are printed.
3. **Listed but not serviced.** Five rows carry SF and fixtures like serviced rows: N/S, OPT, CONC and closed for
   demolition.
4. **Gross vs serviced area** at the maintenance shop (8,960 vs 1,240).
5. **Seasonal operation.** Open–close dates and Peak / Shoulder / Winter frequency columns, with day qualifiers such
   as `5X/WK (W–Su)`, `(Th–M)` and `(M/W/F)`. Footnote letters sit inside cells (`1X/WK (d)`, `2X/WK (e)`,
   `1X/WK (f)`).
6. **`2X/DAY`** at the Beach House is defined as 7 days per week.
7. **Vault toilets.** Tiny buildings (64–156 SF), risers counted as toilets, and dashes for the other fixtures.
8. **Open-sided structures are facilities.** Picnic shelters and the fish cleaning station are measured at the drip line.
9. **Totals are not facilities.** These include area subtotals with a glued superscript ("(9)5"), the grand total
   (34 listed / 29 serviced / 46,274 SF / fixtures 60-12-44-16), the Summary by Facility Type, the amendment's
   revised-totals table (47,426 SF), the Table 3-A subtotals and 67.1-acre total, and the Table 3-B total line
   ("Total paved parking (Items P-1 – P-5)", 223,500 SF; Change 5 revises it to "Total parking (Items P-1 – P-6)",
   235,900 SF).
10. **Group header rows contain numbers.** For example "Park Road mile 0.4" and "96 sites, Loops A–C".
11. **Landscape table over three pages.** It has a three-row header (group row; titles with glued superscripts
    "Type3", "Gross SF4", "Season2"; a column-number row) repeated on each page, and "Continued on…" lines.
12. **Numbers inside names and notes.** Names carry numeric ranges ("sites A1–A34") and wrap. Notes add distractor
    numbers ("2.3 mi", "6 campsites", "approx. 40 per season").
13. **Floors are stated only in prose** (PWS 2.1).
14. **Grounds.**
    - Type I / II / III labels have to be mapped through the PWS 3.1 definitions.
    - The paved trail is given in LF, with its width and miles in the name. Truth converts it to SF with the stated
      8-ft width.
    - Table 3-C holds counts only.
    - Natural-surface trails (41 miles), snow removal and beach grooming are excluded.
15. **Prior award appears only in the amendment Q&A.** It also notes that the incumbent's scope was smaller
    (janitorial only, with the Beach House cleaned by NPS), which matters for a top-down check.
16. **Dollar amounts that are not award values.** PRS deductions ($50, $25, $1.50/SF, $40/acre, $0.02/SF, $100), the
    requisition number, and the wage-determination and SCA occupation codes.
17. **Contract term and climate.** Base + 4 options = 5 years, plus a 6-month 52.217-8 extension that is not an option
    year. Northern Minnesota with a winter season is `cold`.

## Regenerating

The HTML and `truth.json` were generated together from one data table, by a script kept outside the repository so
that the reader under test cannot see it. If you edit a value by hand, update every place it appears:

- the Technical Exhibit 1 row
- the area subtotal, the grand total and the Summary by Facility Type
- the amendment's Change items and its revised-totals table
- the Technical Exhibit 3 totals
- `truth.json`

An adversarial check made two hand edits after generation that the external generator does not carry:

- Amendment Change 5 now revises the Table 3-B total line to "Total parking (Items P-1 – P-6), 235,900 SF". Before,
  it called a total that includes the aggregate-surface P-6 lot "paved".
- Truth W-2 changed from 9,504 `lf` to 76,032 `sqft`.
