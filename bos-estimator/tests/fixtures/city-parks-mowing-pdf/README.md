# city-parks-mowing-pdf

A city grounds-maintenance RFP: **City of Ashby Creek, Missouri, RFP No. 2027-014, "Park, Median and Right-of-Way
Mowing, Grounds Maintenance and Park Building Custodial Services"**. It comes as one 9-page PDF with a text layer.
The city is fictional. The package covers:

| Page | Content | Orientation |
|---|---|---|
| 1 | Cover with the key-dates table | portrait |
| 2 | Section 1, General Information: purpose, **term (1.2)**, **current contract (1.3)**, addenda, basis of payment | portrait |
| 3-4 | Sections 2-3, Scope: definitions (mowing cycle, Total vs Mowable Turf Acres, rough mow, ballfield acres), the service-level table, litter, athletic fields, beds, trees, medians, chemical limits, custodial tasks | portrait |
| 5-6 | **Attachment A, Table A-1**: 26 park and municipal sites, with a two-row header repeated on page 6, a TOTAL row and footnotes | landscape |
| 7 | **Attachment A, Table A-2**: 11 median and right-of-way segments in LF with an average width and a Sides column, plus a TOTAL LENGTH row | landscape |
| 8 | **Attachment C, Table C-1**: 5 park buildings (gross SF, cleanable SF, fixtures, cleaning days) with a TOTAL row. **Table C-2** lists open-air picnic shelters | portrait |
| 9 | **Addendum No. 1**: deletes a site, revises three quantities, Q&A | portrait |

Render and score it with:

```bash
node scripts/render-fixtures.mjs tests/fixtures/city-parks-mowing-pdf
npx tsx scripts/eval.ts tests/fixtures/city-parks-mowing-pdf
```

## Provenance (fidelity: real-format)

The layout, columns and wording follow real municipal park, median and right-of-way mowing solicitations. I found
these with web search; the sandbox could not download the PDFs, so I worked from the search excerpts:

- **City of Clute, TX, 2024-25 Mowing / Landscaping RFQ**
  (https://clutetexas.gov/new/wp-content/uploads/2024/11/Mowing-RFQ-REV-Final-112124.pdf) and its pre-bid Q&A
  (https://clutetexas.gov/new/wp-content/uploads/2024/12/2425-Mowing-RFQ-Pre-Bid-QnA-121724.pdf).
  - Clute states drainage channels and road ROW as *length plus average width*, with no acreage:
    "approximately 4,210 linear feet of drainage channel with an average width of 30'". Road ROW is "6,735 LF ...
    20' easements on each side". Table A-2 follows this (Length (LF), Avg. Width (FT), Sides).
  - Clute nets ballfields, parking and a lake out of a park's gross acreage: Stratton Ridge Park is 24.5 ac total,
    less 8.5 ac of ballfields and 2 ac of parking, which leaves ~14 ac to mow. Table A-1 copies this as its
    Total Site Acres vs Mowable Turf Acres split.
  - Clute answered frequency questions by addendum Q&A. That is the model for the Q&A block in Addendum No. 1.
- **City of Longview, TX, RFP 26-0011, Mowing Services: Parks, Trails, Medians and Facilities**
  (https://longviewtexas.gov/DocumentCenter/View/17798/26-0011RFP--MOWING-SERVICES-PARKS-TRAILSMEDIANS--FACILITIES--RFP-PACKET?bidId=).
  It is one solicitation for parks, trails, medians and facilities. Its site table gives a site number, address and
  acreage (e.g. "Bennie Jackson Park, 2229 Neal St., 5.60"). It requires litter pickup before mowing. It allows only
  push mowers at a historic cemetery because of fragile monuments; footnote 4/ (Hillcrest Cemetery) is adapted from that.
- **City of Ferguson, MO, Park Mowing RFP**
  (https://fergusoncity.com/DocumentCenter/View/6049/Park-Mowing-2023-RFP?bidId=). It covers a community center plus
  twelve parks with a site-by-site acreage table. Cycles are weekly in spring and bi-weekly in the hot summer. This is
  the model for a Missouri city package and the 7-day / 14-day split.
- **City of Walterboro, SC, Landscape Maintenance RFP**
  (https://www.walterborosc.org/sites/default/files/uploads/city_of_walterboro_landscape_services_rfp_2027.pdf). It has a
  two-week base cycle with a weekly alternate, and garbage and litter are collected before mowing.
- **City of Moorpark, CA, Janitorial RFP** (https://www.moorparkca.gov/DocumentCenter/View/10542). Park restrooms are
  serviced seven days a week including holidays and "cleaned and in operation no later than 8:00 a.m.", and door
  handles and light switches are sanitized. Both phrases appear in Section 3 and the Service Window column.
- **City of Scotts Valley, CA, Janitorial RFP** (https://scottsvalley.gov/DocumentCenter/View/3227/Janitorial-RFP-Final?bidId=).
  Park restrooms get 7 days a week in summer and fewer days, including weekends, in winter. PB-4's seasonal schedule
  follows this.
- **Dover Township, MI, 2024 Janitorial RFP** (https://www.dovertownship.org/wp-content/uploads/2024/03/2024-Janitorial-RFP.pdf).
  Restrooms are locked by dusk, no later than 9 p.m. (Section 3.4).
- **City of White Settlement, TX, parks mowing RFP** (https://wstx.us/DocumentCenter/View/4817). Its term is "one-year
  (12 months) with the option of up to four (4) one-year renewals". It is the model for the initial term plus renewals
  wording in Section 1.2.
- Paulding County, GA (https://www.paulding.gov/bids.aspx?bidid=455) and the City of San Antonio
  (https://www.sa.gov/Directory/Departments/PWD/Maintenance/Mowing) both schedule medians and ROW on their own
  cycles, separately from parks.

**Real:** the document structure; the column set (site no., name and address, class, total vs mowable acres, service
level, cycle, ballfields, beds, trees, litter frequency); the LF x average width x sides convention for medians and
ROW; the cemetery push-mower restriction; the park restroom service wording; and the term and renewal pattern.

**Made up:** the City of Ashby Creek and every site, street, address, acreage, LF, width, bed SF, tree count, building,
square footage, fixture count and date. The incumbent (Halvorsen Turf Management, LLC), Contract No. PR-2022-031 and
$612,480 are also invented. No table row is copied from a real document, which is why the fidelity is real-format and
not real-rows.

## Expected answers (truth.json)

- **Facilities (4, complete).** PB-1 Harmon Park Community Center (14,860 GSF / 12,415 cleanable, 2 floors, Mon-Fri,
  `daily_5`, `community`, 25 fixtures), PB-2 Harmon Park Restroom / Concession Building (1,680 / 1,420, `daily_7`,
  13 fixtures), PB-3 Sports Complex Restroom and Concession Building (**2,420 / 2,130 after Addendum No. 1**, M/W/F,
  `3x_week`, 19 fixtures) and PB-4 Lakeshore Park Restroom Building (860 / 720, seasonal so no service level,
  8 fixtures).
- **Grounds** (95 entries, post-addendum; the scorer compares per-kind totals):

  | Kind | Total | Made up of |
  |---|---:|---|
  | improved_turf | 76.789 ac | park Service Level 1 mowable acres 62.22 + medians/ROW 14.569 |
  | semi_improved | 84.99 ac | park Service Level 2 mowable acres |
  | unimproved | 57.90 ac | rough mow |
  | athletic_field | 40.85 ac | 21 ballfields |
  | shrub_bed | 41,310 SF | planting beds |
  | tree_canopy | 1,422 | 1,388 park trees + 34 median street trees on M-2 |

  Sites 1, 3 and 6 carry `buildingNumbers` for the park buildings Table C-1 places on them.
- **Site:** contractYears 5 (two-year initial term plus three one-year renewals), climateZone `temperate`
  (St. Louis County, Missouri), installationName "Ashby Creek", solicitation "2027-014".
- **Prior award:** Halvorsen Turf Management, LLC, Contract No. PR-2022-031, awarded 2022, CY 2025 expenditures
  $612,480 (`annualValue`). It covers mowing only.

## Traps

1. **Addendum supersedes.** Addendum No. 1 is bound at the end of the package and changes four things:
   - Site 14 Wexford Commons Pocket Park is deleted.
   - Site 9 mowable acres go from 6.40 to 7.15.
   - Median M-6 goes from 2,640 to 3,180 LF.
   - PB-3 gross SF goes from 2,240 to 2,420, cleanable SF from 1,960 to 2,130, and fixtures from 8/3/6/0 to 9/3/7/0.

   Truth holds only the post-addendum values.
2. **Total Site Acres vs Mowable Turf Acres.** Total Site Acres is for information only. It includes lakes, woods,
   paving and ballfields; for example, Lakeshore Park's "approx. 31.5" includes an 11-acre lake. Turf truth uses
   Mowable Turf Acres. Ballfield and rough-mow acres are separate columns and are not inside Mowable Turf Acres
   (Section 2.1, Addendum Q1).
3. **Medians and ROW in LF x width x sides.** Table A-2 states no area. Truth converts each turf segment to improved-turf
   acres as LF x width x sides / 43,560. The total is 634,620 SF = 14.569 ac, and the per-segment math is in
   truth.json. R-1, R-2 and R-3 have Sides = 2. M-5 is stamped concrete / pavers with no turf, so it is excluded.
4. **Service levels map to grounds kinds.** Level 1 (7-day, "Improved Turf") maps to `improved_turf`, Level 2 (14-day,
   "Semi-Improved Turf") to `semi_improved`, and Level 3 rough mow to `unimproved`.
5. **Total rows are not data.** The Table A-1 TOTAL (374.63 / 146.94 ac, 41,630 SF, 1,397 trees) is pre-addendum and
   still includes Site 14. The Table A-2 TOTAL LENGTH (30,740 LF) is not an area. The Table C-1 TOTAL (19,640 GSF) is
   not a building.
6. **Approximate quantities.** Some quantities are marked "approx." or with "±", such as "approx. 9.40", "approx. 15.20"
   and "64±". Footnote markers are glued to names and headers, for example "Hillcrest Cemetery4/" and
   "Total Site Acres5/". Names wrap onto a second line (an italic description) and a third (the address).
7. **Excluded buildings and shelters.** PB-5 Old Mill Park Restroom Building is closed and scheduled for demolition, so
   it is excluded. The open-air picnic shelters in Table C-2 are explicitly not custodial buildings.
8. **Fixtures and cleaning days need converting.** Fixtures are printed as "WC / UR / LAV / SH", and truth uses their
   sum. Cleaning days map to service levels; the seasonal PB-4 has no single matching level.
9. **Prior award scope.** The prior award covers mowing only, with no custodial work and not the new ROW segments R-3
   and R-4. A top-down cross-check from $612,480 will therefore understate the new scope.
