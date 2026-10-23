# army-reserve-multisite-pdf

This is an Army Reserve custodial, grounds maintenance and snow removal solicitation covering twelve geographically
separate U.S. Army Reserve Centers in one contract (`W91XPN-27-R-0007`, issued for the fictional "89th Readiness
Division"; sites in Minnesota, North Dakota and South Dakota). It is one 12-page PDF with a text layer. It contains the
solicitation summary, the Performance Work Statement, Technical Exhibits 1–3 and Section B as issued on 2 November
2026, followed by Amendment 0001 (24 November 2026). That is how a proposer saves the package and its amendment into one
file. The original pages do not mention what the amendment changes.

| Pages | Content |
|---|---|
| 1 | Solicitation summary (SF 1449 key blocks): solicitation no., dates, issuing office, set-aside / NAICS / size standard, deliver-to activity, PSC codes, list of attachments and exhibits as issued on 2 November (the later amendment is not listed) |
| 2–5 | Attachment 1, PWS: Part 1 general information (incl. 1.4 current contract, 1.5 period of performance, 1.6 N/S and optional-site rules), Part 2 definitions and acronyms, Parts 3–4 GFP / CFP, Part 5 tasks (frequency codes, Battle Assembly weekend service, grounds, snow) |
| 6 | **Technical Exhibit 1, Site List**: FACID, Site Code, USARC NAME AND ADDRESS, county, buildings, wage determination; BASE SITES and OPTIONAL SITES blocks |
| 7–8 | **Technical Exhibit 2, Facility and Custodial Workload Data** (landscape, 14 columns, two-row grouped header, split over two pages with header repeated): state group rows, site rows with address and site code, building rows, site totals, grand total, optional site block, Notes 1–7 |
| 9 | **Technical Exhibit 3, Grounds Maintenance and Snow Removal Workload Data** (landscape): per-site acres / SY / SF / LF, totals, optional site row, Notes 1–6 |
| 10 | Section B, Schedule of Supplies / Services: per-site CLIN ranges and estimated event quantities |
| 11–12 | **Amendment 0001**: deletes a building, revises one building's area and another's frequency, revises one site's turf, revised totals, Q&A |

Render and score:

```bash
node scripts/render-fixtures.mjs tests/holdout-b2/army-reserve-multisite-pdf
npx tsx scripts/eval.ts tests/holdout-b2/army-reserve-multisite-pdf
```

## Provenance (fidelity: real-format)

All values are made up: sites, street addresses, FAC IDs, site codes, building areas, fixture counts, acreages, wage
determination numbers, people, the 89th Readiness Division (no such unit exists), the contracting office, the
solicitation number and the incumbent contract (Red River Prairie Facility Services, LLC, W91XPN-22-C-0009). Real towns
are used so the climate is real. No rows were copied.

Outbound access from the authoring session was limited: SAM.gov, GovTribe, HigherGov and SweetSpot were blocked. The
real attachments below were downloaded from the imlive.s3.amazonaws.com mirror of SAM.gov attachments and read with
`pdftotext -layout`. The rows marked "search summary only" could be seen only through web-search result summaries.

| Source | What the fixture takes from it |
|---|---|
| [99th RD PWS, Snow and Ice Removal, 1LT John A. Fera USARC, Danvers MA (2020)](https://imlive.s3.amazonaws.com/Federal%20Government/ID208733132576233572635640274329101090190/PWS%20-%20Snow%20Danvers%20MA%20dated%203%20November%202020.pdf) | PWS 1.1 non-personal-services wording; RFOS / COR; two-hour response; plow to bare pavement, no trailing windrows; plow back four feet from the curb; sidewalks at each four-inch interval; time-stamped photos before invoice approval; $50.00 lost-key charge; holidays; manpower reporting; AT Level I |
| [ACC-NJ W15QKN-20-Q-5112, Grounds Maintenance, Fort Drum AFRC (NY112)](https://imlive.s3.amazonaws.com/Federal%20Government/ID45363605888517050669573297100202210448/SOLICITATION_W15QKN-20-Q-5112_GROUNDS_FORT_DRUM_NY112.pdf) | SF 1449 blocks; RFOS as site contact; PSC S208; base + four options; per-site, per-event CLINs ("OY1 - Mowing - NY112" 16 EA, Trimming 8 EA, Edging 2 EA). Basis for Section B and the 16 / 8 / 2 event counts |
| [99th RD Grounds Maintenance Map, Greencastle USARC/AMSA #113 (PA041)](https://imlive.s3.amazonaws.com/Federal%20Government/ID27844027503540687246707627059792134406/MAP%20-%20PA041_GROUNDSMAINTENANCE_FEB2020.pdf) | Site naming "USARC/ AMSA # 113"; SITE CODE / FAC ID header; "Grounds Maintained: Mowed ... SF, Edged ... LF" |
| [99th RD site plan, Cranberry USARC (PA168)](https://imlive.s3.amazonaws.com/Federal%20Government/ID108535287746971914821987983569269661259/PA168%20Cranberry%20PA%20Site%20Plan%20FY20.pdf), [Penn Yan USARC (NY052)](https://imlive.s3.amazonaws.com/Federal%20Government/ID214969480013759314117254883035996687836/Attch%20001%20Site%20Plan%20Refuse%20Penn%20Yan%20NY%20dated%2010Feb20.pdf) | Parking, road, sidewalk and slab areas in SF and SY; MEP vs POV; USARC + VEH MAINT CENTER + STORAGE on one site |
| [99th RD Snow Removal Map, PFC Reynolds USARC (WV046)](https://imlive.s3.amazonaws.com/Federal%20Government/ID312499471085589993415345730749368320641/Attachment%200001%20-%20Site%20Map%20Snow%20Removal%20Sept2019%20-%20WV046.pdf), [CPL Harry R. Harr USARC (PA003)](https://imlive.s3.amazonaws.com/Federal%20Government/ID317675974346998636165337084876955678353/Attachment_0001_-_Site_Map_(PA003).pdf), [Londonderry AFRC/AMSA #160 (NH014)](https://imlive.s3.amazonaws.com/Federal%20Government/ID126998343683552168225688958127218385479/001_Site_Map_-_Londonderry_NH014.pdf) | "Plowed" vs "Shoveled" SF / SY; MEP "NOT TO BE PLOWED"; the legacy "99th REGIONAL SUPPORT COMMAND" title block in a Readiness Division package (TE-3 cites "89th RSC / 89th RD"); AFRC/AMSA naming |
| [Crawford County Mem USARC floor plans (PA062)](https://imlive.s3.amazonaws.com/Federal%20Government/ID87169707134461761846770593062156594283/PA062_FP_OCT2019.pdf) | One GSF total per building at one site: "USARC ... BLDG TOTAL: 12,129 GSF", "OMS ... BLDG TOTAL: 2,649 GSF" |
| [Custodial Service Plan, Gloucester Township AFRC (NJ050)](https://imlive.s3.amazonaws.com/Federal%20Government/ID54085907355448807878298158865095195436/MAP%20CUST%20NJ050%20Blackwood%2014APR21.pdf) | Rooms tagged AR / NG in an AFRC: the ARNG tenant area excluded from Custodial SF |
| [FY22 LA MUNI SITE LIST](https://imlive.s3.amazonaws.com/Federal%20Government/ID42724764694378381637641466712085539787/DRAFT%20Site%20List%20LA%20Muni%20FY22.pdf) | TE-1 layout: "FACID / USARC NAME AND ADDRESS", upper-case name and address rows, a separate "OPTIONAL SITES" block, exhibit number "J-0200000-08" |
| [Fort Wainwright custodial PWS (2019)](https://imlive.s3.amazonaws.com/Federal%20Government/ID31544869489761803466574390107441771546/Attachment_A_-_Custodial_Performance_Work_Statement.pdf) | Workload data as Technical Exhibits; frequency definitions; additions / deletions priced on SF added or deleted (PWS 5.7); "USARC = U.S. Army Reserve Command" in the acronym list |
| [Dyess AFB custodial PWS, Appendix B (2021)](https://imlive.s3.amazonaws.com/Federal%20Government/ID297162707687379821580624672536441025401/Attachment%201%20-%20Custodial%20PWS.pdf) | A per-building workload table with total cleaned SF per facility and totals rows |
| [USACE Missouri River Project grounds PWS](https://imlive.s3.amazonaws.com/Federal%20Government/ID192537321191818757700041718476319285269/20-Q-0036%20%20MRPO%20PWS%20Grounds%20Maintenance.pdf) | Mowing areas "approximately N acres" scaled from maps; mow heights; secondary areas mowed three times a year; clippings removal (PWS 5.5) |
| [W15QKN26QA063, Indiana / Washington PA](https://console.sweetspotgov.com/federal-contracts/6e1734b3-c918-5f2e-9d4d-b41da240c7bd) (search summary only) | A custodial area printed next to the total building area at a USARC, with a separate OMS building: Gross SF and Custodial SF side by side |
| [W15QKN-26-Q-A068, Brookville / Clearfield / Saint Marys PA](https://console.sweetspotgov.com/federal-contracts/669e160e-3129-5dbe-bb20-d5aa3a5d0d4d) (search summary only) | Per-floor SF with commodes, urinals, sinks and showers; one building "does not require custodial service for any area or fixtures" (the latrine fixture columns and the N/S buildings) |
| [Army Reserve Center, Rockford IL (Korte)](https://www.korteco.com/construction-projects/army-reserve-center-rockford-illinois/) (search summary only) | Building mix and relative sizes: training center + OMS + unheated storage with POV and MEP parking (same search: Fort A.P. Hill 32,917 SF center, 7,433 SF OMS, 1,065 SF unheated storage) |

Known remaining tells:

- No real Army Reserve custodial attachment with a multi-site building table could be downloaded. TE-2 is assembled from
  the real per-site pieces above (site maps, floor plans, custodial service plan, site list) and from Army and Air Force
  workload exhibits. Real packages often ship one site map per center and a separate workbook rather than one table.
- The package is 12 pages. Real ones run 40–80 with FAR clauses, wage determinations and the site maps bound in. Here
  Attachments 2 and 3 are "posted separately".
- Every figure reconciles exactly. Real exhibits often carry small inconsistencies (one source above had a custodial
  area larger than the building area), but adding them on purpose would make the ground truth ambiguous.

## Expected answers

- 27 facilities (`facilitiesComplete: true`). Building numbers are the TE-2 Bldg IDs (FAC ID + sequence, e.g. `MN012-01`).
  - 13 training buildings (12 training centers or AFRC training buildings, plus the Eagan Training Annex). No category,
    because the document does not say whether a reserve training center is admin, education or community space.
  - 11 maintenance shops (OMS / AMSA): `maintenance`.
  - 3 unheated storage buildings swept quarterly (MN027-03, ND008-03, SD004-03): `warehouse`, `quarterly`.
- Not expected:
  - 7 N/S buildings: 5 unheated storage, 1 fire pump house, 1 hazmat storage.
  - MN066-02, deleted by Amendment 0001.
  - The 2 buildings of the optional Watertown site (SD033).
- Post-amendment values:
  - MN050-01 Duluth Training Center: 38,955 gross / 34,250 cleanable.
  - ND035-01 Minot Training Center: `daily_5`.
- `grossSqft` is TE-2 Gross SF. `cleanableSqft` is Custodial SF. `floors` is Flrs. `restroomFixtures` is
  WC + UR + LAV + SH, on the 24 buildings that print counts.
- Sum of expected `grossSqft`: **508,230**. Sum of `cleanableSqft`: 371,792, which equals the Amendment's revised
  Custodial SF total. The revised Gross SF total, 522,050, is 508,230 plus 13,820 SF of N/S buildings.
- Service levels: 5/W is `daily_5` (8 buildings), 3/W is `3x_week` (4), 2/W is `2x_week` (5), 1/W is `weekly` (4),
  BW is `biweekly` (2), M is `monthly` (1), Q is `quarterly` (3). The BA Wknd column adds a monthly Sunday service and
  does not change the level.
- Grounds, per base site; the scorer sums each kind:
  - `improved_turf`: 56.75 acres. TE-3 prints 57.20; Amendment Item 4 cuts Eagan from 6.30 to 5.85.
  - `semi_improved`: 17.15 acres, at five sites.
  - `parking`: 80,653 SY (725,877 SF), the paved area the contract plows: POV Parking 62,097 + Roads & Drives 18,556.
    PWS 5.6 orders "POV parking lots, roads and drives" plowed to bare pavement, and TE-3 Notes 5–6 make the Plow
    Area (= POV + Roads, MEP excluded) the area cleared at each event. `parking` is the only grounds kind priced for
    plowing, so the roads belong there. The Plow Area column registered alone gives the same quantity; registered on
    top of POV + Roads it double-counts.
  - `sidewalk`: 42,485 SF, the Shovel / Blow column.
  - Site Acres, MEP, Edging LF (a length, not an area; edging is priced with the improved turf) and the optional site
    are not expected.
- Site: 5 contract years (12-month base + four 12-month options; the FAR 52.217-8 extension is not counted), `cold`
  (MN / ND / SD, snow season 15 Oct – 30 Apr), solicitation `W91XPN-27-R-0007`. `installationName` is left out on
  purpose: twelve separate sites, no single installation named.
- Prior award (PWS 1.4, repeated in Amendment Q5):
  - total $5,912,400 over 60 months
  - annual $1,214,880 (Option Period 4)
  - incumbent Red River Prairie Facility Services, LLC
  - contract W91XPN-22-C-0009, awarded 2022

## Traps

1. **Multi-site table.** Site identity (FAC ID, name, address, Site Code) sits in shaded group rows. Building rows
   carry only a Bldg ID, a use code and a generic description that repeats at every site.
2. **Identifier distractors:**
   - FAC ID, 5-digit Site Code and ZIP+4
   - AMSA #81 / #92 / #94
   - "(Bldg 1)" / "(Bldg 2)" inside the Eagan descriptions
   - Section B line numbers and CLINs 0001–0091
   - wage determination numbers and the purchase request number
3. **N/S buildings.** Seven buildings are listed with Gross SF but no custodial service. Three other storage
   buildings marked Q are in scope.
4. **Optional site.** SD033 appears in TE-1, TE-2, TE-3 and Section B, always as an option. Neither its buildings nor
   its grounds are expected.
5. **Amendment supersedes.** It deletes MN066-02, revises MN050-01 area (TE-2 Note 7 had said the addition was
   excluded), revises ND035-01 frequency, revises MN073 turf, and prints revised totals.
6. **Gross vs cleanable.**
   - OMS / AMSA Custodial SF is only offices, latrines and break areas: about 15–20% of gross.
   - AFRCs exclude the ARNG tenant area.
7. **Totals are not facilities:**
   - 13 site-total rows, whose Gross SF includes N/S buildings
   - the TE-2 grand total
   - the Amendment's revised-totals table
   - the TE-3 totals row
   - the Section B total
8. **Distractor numeric columns:**
   - Year Built, including "1964 / 2026"
   - Floors
   - four latrine fixture columns
   Superscript note markers are glued to header words in the text layer ("SF3", "Fixtures4", "Freq.5", "Wknd6",
   "Acres1", "(SY)4").
9. **Frequency codes.** 5/W, 3/W, 2/W, 1/W, BW, M, Q and N/S are defined in PWS 5.2. "BA Wknd" is a separate
   add-on column.
10. **Mixed grounds units.** Acres, SY, SF and LF all appear. Some columns are information only (Site Acres, MEP).
    Plow Area = POV + Roads, so registering it on top of POV and Roads double-counts parking. Edging LF is a length,
    not walk area.
11. **Event counts are not areas:** 16 / 8 / 2 / 3 mowing, trimming and edging events, 18 / 24 snow events,
    12 MO, about 12 BA weekends, 4-inch snow interval, 4 ft plow-back, 2-hour response.
12. **Non-award dollar amounts** sit near the prior-award text: the $50.00 key charge and the $22.0 million size
    standard.
13. **Contract term.** Base + four options = 5 years. The six-month 52.217-8 extension is "not an option period".
14. **Acronyms.** USARC is both "Reserve Center" and "Reserve Command". TE-3 cites the legacy "RSC" name next to "RD".

## Regenerating

The HTML and the facility and grounds rows in `truth.json` were generated together from one table of site data, so
these all stay consistent:

- TE-1 building counts
- TE-2 rows, site totals and grand total
- TE-3 rows and totals
- Section B lines
- the Amendment items and revised totals

The rendered PDF was then checked by parsing `pdftotext -layout` output. That check:

- re-derived all 27 expected facilities from the TE-2 rows plus the Amendment items
- confirmed every printed site total, the grand total and the revised totals
- re-derived the grounds sums from TE-3 plus Amendment Item 4

If you edit a value by hand, update every place it appears: TE-1, TE-2 (row, site total, grand total), TE-3, the
Amendment (Items 1–5, Q2, Q7) and `truth.json`.
