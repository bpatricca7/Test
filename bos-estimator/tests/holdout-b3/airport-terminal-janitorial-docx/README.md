# airport-terminal-janitorial-docx

This is a janitorial services RFP from a regional airport authority (`RFP No. 26-118`, "Ashbury County Regional
Airport Authority", a fictional Wisconsin authority). It is one Word file (`.docx`): the RFP as issued on
November 2, 2026, with Addendum No. 1 (December 1, 2026) appended at the end. That is how many authorities post the
"as amended" Word file. The addendum is not merged into the body, and the original sections do not mention what it
changes.

The DOCX has no fixed pages. With the renderer's defaults (A4, 1-inch margins, Word's 10 pt default font, no
paragraph spacing) it runs to about **11 pages**. The estimate comes from printing the HTML source with the same
metrics. LibreOffice in this sandbox could not open any DOCX, so the page count is approximate.

| Approx. page | Content |
|---|---|
| 1 | Header block (authority, RFP number, title, issue date), schedule-of-events table, procurement contact, Section 1 (purpose, airport description with the 486,000 GSF terminal, term, current contract) |
| 2–3 | Section 2, Scope of Services: Exhibit A structure, **Janitorial Coverage code legend** (table), terminal operations and restrooms, FIS "Per Arrival", floor-care table, areas not included, Option Item 1 (CBP suite), changes clause, exterior areas. Section 3: qualifications, evaluation, compensation, insurance, bond and damages |
| 3–6 | **Exhibit A, Part 1**: Table A-1 Landside Terminal (Levels 1–3) and Table A-2 Concourses A/B and FIS (the "continued" table repeats the two-row header). 9 columns, with Terrazzo / Carpet / Other under a spanning "Floor Area by Finish (SF)" header |
| 6–7 | **Exhibit A, Part 2**: Table A-3 Support Facilities by Building (Gross Bldg. SF vs Contract Cleaning Area), notes (a)–(g) |
| 7–8 | Exhibit A Part 3 (areas not included, with SF), Part 4 (exterior sidewalks), Exhibit A Summary |
| 8 | Exhibit B, Price Proposal Form (Lines 1–6 grouped by coverage, Lines 7–11 unit-priced and option) |
| 8–9 | Exhibit C, Restroom Fixture Inventory (by Area / Bldg. No.) |
| 9 | Exhibit D, Minimum Staffing (posts per shift) |
| 10–11 | **Addendum No. 1**: Items 1–7 (revise T2-03, add CB-04, delete Bldg. 450, change Bldg. 420 coverage, revised totals, Exhibit B and C changes), Item 8 Q&A (prior contract value in A4) |

Render (this fixture lives outside the repository on purpose, so pass its directory):

```bash
cd /home/user/Test/bos-estimator
node scripts/render-fixtures.mjs <path-to>/airport-terminal-janitorial-docx
# -> build/rfp-26-118-janitorial.docx
unzip -p build/rfp-26-118-janitorial.docx word/document.xml   # what a reader sees
```

## Facility granularity (why terminal zones, not one terminal)

Real airport janitorial schedules do not list the passenger terminal as one building with one SF. Memphis's
Addendum 4 gives SF per terminal level and zone (ticketing, mezzanine, concourses) with hours and a secure-area flag
for each. Port of Bellingham restates SF per bid item (International Arrivals Building, Admin Office, CBP,
1st-floor common areas). St. Louis gives cleanable SF by terminal and concourse in its Minimum Service Summary.
Support buildings (admin, ARFF, maintenance, parking) appear as separate buildings (John Wayne, Harrisburg,
Nashville "outlying buildings"). This fixture follows that pattern:

- **Terminal**: 23 Service Areas, each with an **Area No.** (T1-01 … T3-02, CA-01 … CB-04, F-01, F-02). The Area
  No. is the `buildingNumber`, and each Service Area is one facility. "Passenger Terminal (Building 1),
  approximately 486,000 gross square feet" is only a narrative figure, and the terminal totals are subtotals. Neither
  is a facility.
- **Support facilities**: 13 buildings, each with a **Bldg. No.** (100 … 600, 400 … 440).

## Provenance (fidelity: real-format)

All values are made up: the authority, airport, RFP number, every area and square footage, fixture counts,
staffing, and the incumbent (Kinnick & Vail Building Services, Inc., Contract No. ACRAA-C-22-009) with its contract
values. No IATA code is used, so the airport cannot collide with a real one. No rows were copied. The layout and
wording follow real airport janitorial solicitations.

**Research limit:** WebFetch and direct downloads were blocked in this session (DNS failure / egress policy), so each
source below was read only through WebSearch result excerpts, which quote or describe the documents. Column names and
wording come from those excerpts, not from a full reading of each PDF.

| Source | What the fixture takes from it |
|---|---|
| [Memphis-Shelby County Airport Authority, Janitorial Services RFP 24-0001, Addendum 4](https://flymemphis.com/wp-content/uploads/2023/10/Janitorial-Services-Addenda-4-Final.pdf) | SF by terminal level and zone, with Hours of Operation, Janitorial Hours and Secure Area columns. Model for Exhibit A Part 1: level group rows, a Zone column, and Hours of Operation printed apart from cleaning coverage |
| [Memphis RFP 24-0001 Q&A](https://flymemphis.com/wp-content/uploads/2023/10/Q-A-24-0001-Janitorial-Services-1st-Final.pdf) | Bidders asking for SF and floor type (terrazzo vs carpet at gates, ceramic tile in restrooms), answered by addendum. Model for the Floor Area by Finish columns and Addendum Q3 |
| [Port of Bellingham, Airport and CBP Janitorial Services, Addendum No. 3](https://portofbellingham.com/DocumentCenter/View/15199/Airport_CBP_Janitorial_ADD3?bidId=) and [bid page](https://www.portofbellingham.com/bids.aspx?bidID=224) | "Item 1 – International Arrivals Building – approximately 2860 sq. ft.", "Customs & Border Protection – 17,480 sq. ft.", an "N/A" item, "Commercial Terminal Exterior" 10,000 SF. Award to Del Sol with a two-year value. Model for CBP/FIS lines, an exterior terminal area in a janitorial scope, and areas restated in an addendum |
| [Bishop International Airport, Request for Rebid for Janitorial Services (Jan 2024)](https://bishopairport.org/application/files/9917/0629/0623/Janitorial_Services_RFP_-_FINAL.pdf) | "The Terminal building consists of approximately 242,000 total square feet, not all of which is included in the scope of services". Attachment A lists service locations with approximate SF. Vestibules are about 3,000 SF. Model for Section 1.2 and the vestibule rows |
| [Bishop Addendum #1](https://bishopairport.org/application/files/4316/9928/4089/Janitorial_and_Skycap_Services_Q_and_A_Addendum_1.pdf) and [Addendum #2](https://bishopairport.org/application/files/2917/0931/1014/Janitorial_Services_Q_and_A_Addendum_2.pdf) | An addendum revising the "Public Open Floor Area" and its hard-floor share (model for Addendum Item 1). A Q&A answer giving the prior-year contract amount ("…in 2023 was $339,960.00") (model for A4) |
| [City of Pensacola RFP 25-023, Airport Janitorial & Specialized Floor Care](https://cityofpensacola.com/DocumentCenter/View/27392/rfp-25023-AirportJanitorial_SpecializedFloorCareSvcs-PDF?bidId=) and [ITB 19-008 listing](https://www.bidnetdirect.com/florida/city-of-pensacola/solicitations/Pensacola-International-Airport-Janitorial-and-Carpet-Cleaning-Services/0000204785) | GSA/CBP spaces listed separately with SF, porcelain tile on the concourse, VCT strip and wax semi-annually at Fire Station #7 (ARFF), a terminal "open 24 hours per day, 7 days per week". Model for the CBP suite as a separately priced option, the ARFF floor task and 24/7 coverage |
| [St. Louis Lambert, Terminal Cleaning Services RFP (Jan 2026)](https://www.flystl.com/wp-content/uploads/2026/01/Terminal-Cleaning-Services-1-20-2026.pdf), [Second Addendum](https://www.flystl.com/wp-content/uploads/2026/02/Second-Addendum-Terminal-Cleaning-Services-RFP.pdf), [2018 agreement](https://www.flystl.com/wp-content/uploads/2025/01/9.6.12_Terminal-Cleaning_Regency_2018.09.05_200311_081633.pdf) | Section 5.0 approximate areas (restrooms, interior service animal relief areas 650 SF, lactation suites 800 SF), Appendix A Minimum Service Summary (cleanable SF, frequency, staffing, cleaning hours), SF "for reference only", quarterly stripping. Model for Exhibit D, the SARA / nursing-suite area added in Item 2, the Section 2.2 disclaimer and the floor-care table |
| [John Wayne Airport staff report](https://files.ocair.com/media/2021-01/Item3_web.pdf) | Janitorial "24 hours a day, seven days a week, 365 days a year" at the terminal, exterior walkways, administrative and maintenance buildings, and parking structure lobbies and stairways. Prior contract stated as a five-year cumulative value. Model for the 24/7 code, the Bldg. 200 lobbies/stair-towers row and the NTE value over the term |
| [Nashville (MNAA) 2010 custodial RFP](https://airportscouncil.org/wp-content/uploads/2018/08/bna_2010_custodial_rfp.pdf) and [RFP 25-020](https://flynashville.com/opportunity/custodial-services) | Pricing forms split by terminal/concourses, leased space, parking garage and outlying buildings. "Add or delete buildings and areas from the Cleanable Square Footage in Exhibit B". Model for Exhibit B grouping and Section 2.9 |
| [Raleigh-Durham Janitorial Services MNT0801 (2008)](https://airportscouncil.org/wp-content/uploads/2018/08/rdu_2008_custodial_rfp.pdf) | Bid form by terminal area type (airline hold rooms, common areas, tenant areas) with SF, plus garage and outlying shelters. Model for pricing by area type and the tenant carve-outs |
| [Harrisburg (SARAA) Janitorial RFQ/RFP (2019)](https://www.flyhia.com/wp-content/uploads/2019/08/Janitorial-RFQ-RFP-.pdf) | Terminal, multi-modal facility (rental car counters), maintenance facilities and fire department in one scope, plus terrazzo SF and price weighting. Model for the support-facility mix and evaluation points |
| [Volusia County, Janitorial Services for Daytona Beach International Airport](https://procurement.opengov.com/portal/volusia/projects/84295/document?section=all) | About 141,738 SF. Daily including weekends and holidays. The County "may add or remove square footage and/or frequency". Model for Section 2.9 |
| [Baton Rouge Metropolitan Airport floor care RFP](https://wwwcfprd.doa.louisiana.gov/osp/lapac/agency/pdf/9004400.pdf) | Areas by finish (about 37,500 SF terrazzo, 11,500 SF tile, 46,650 SF carpet). Model for the finish columns |
| [CVG Passenger Facilities, Commercial Cleaning Services](https://procurement.opengov.com/portal/cvgairport/projects/147046/document?section=all) | Around-the-clock coverage every day of the year for the areas in Attachment B. Model for the 24/7 definition |
| [Duluth Airport Authority RFP 24-4410](https://duluthmn.gov/media/awcdisiq/24-4410-rfp-for-duluth-international-airport-janitorial-services.pdf) | A narrative terminal description with terrazzo and carpet SF and a bathroom count. Model for the Section 1.2 distractor counts |

Known remaining tells:

- The e-mail domain is a reserved `.example.org` placeholder, on purpose.
- The package runs about 11 pages, while real ones run 40–100. Forms 1–5 are "posted as separate fillable files"
  rather than bound in.
- The renderer cannot make landscape sections, merged cells (vertical merge), headers or footers. Exhibit A is
  therefore portrait, and its second header row has blank cells where a real Word table would merge vertically.
- Every figure reconciles exactly. Subtotals, the Exhibit A Summary, Exhibit B line areas, Exhibit C totals and the
  Addendum Item 5 revised totals all equal their rows.

## Expected answers

- **36 facilities** (`facilitiesComplete: true`), all post-addendum:
  - 23 terminal Service Areas: 22 from Tables A-1/A-2, with T2-03 at **11,250** (Addendum Item 1), plus
    **CB-04**, 1,180 SF (Addendum Item 2).
  - 13 support buildings (Bldg. 450 deleted by Item 3).
- Not expected:
  - F-03 CBP Administrative Offices & Hold Rooms (Option Item 1)
  - Bldg. 800 (vacant)
  - Bldg. 450 (deleted)
  - Every row of Part 3 (Bldgs. 310, 700, 710 and the tenant spaces)
  - The exterior areas, which are grounds
- `grossSqft` and `cleanableSqft` (Section 2.2 and Addendum A1 name the area to be serviced in each part):
  - Terminal: the Total SF column is both. The finish columns are not the gross. Section 2.2 says Total SF "is the
    area to be serviced", so `cleanableSqft` = Total SF on all 23 zones. No category cleanable share should be
    applied on top of it, the same convention as `scanned-facility-exhibit`.
  - Support buildings: `grossSqft` is the Gross Bldg. SF and `cleanableSqft` is the Contract Cleaning Area.
  - Bldg. 200 prints "—" for gross (Note b) and a Contract Cleaning Area of 14,600. Truth `cleanableSqft` = 14,600,
    and `grossSqft` carries the same 14,600 because no other area is given.
- Sum of `grossSqft` = **557,150**. This is the 337,690 terminal Service Areas plus the 219,460 gross support area,
  with 14,600 used for Bldg. 200.
- Sum of `cleanableSqft` = **437,340**. This equals the Addendum Item 5 "Total Interior Contract Cleaning Area"
  (337,690 + 99,650).
- `serviceLevel` from the Janitorial Coverage code (Section 2.3):
  - `24/7` and `Daily (7)` → `daily_7`
  - `M–F` → `daily_5` (T3-02, 100, 410)
  - `M–Sa` → `daily_6` (510)
  - `M/W/F` → `3x_week` (440)
  - `Tu/Th` → `2x_week` (400, and 420 after Item 4)
  - `Wkly` → `weekly` (430)
  - F-01 and F-02 are "Per Arrival" (international arrival days, est. 148 per year), which has no service-level
    equivalent, so `serviceLevel` is omitted.
- `floors`: only for support buildings (Table A-3 Floors column). Terminal zones have none.
- `category`: only where unambiguous:
  - admin: Administration Building, Credentialing & Badging Office, Authority Terminal Offices
  - maintenance: SRE building, Facilities Maintenance Shops
  - hangar: Maintenance Hangar
  - warehouse: Central Receiving & Warehouse
  - Terminal zones, ARFF, police, parking and rental car buildings have none, because the type list has no terminal
    or fire-station category.
- `restroomFixtures`: Exhibit C Total Fixtures (WC + UR + LAV + SH), only for the areas listed there.
- `grounds`: two `sidewalk` areas in sqft. E-1 is the terminal curbside sidewalks (28,400). E-2 is the ground
  transportation plaza and crosswalk islands (9,650).
- `site`:
  - 5 contract years (3-year initial term + two 1-year renewals)
  - `cold` (Ashbury, Wisconsin, with a stated snow season)
  - "Ashbury County Regional Airport", "RFP No. 26-118"
- `priorAward` (Section 1.4 and Addendum A4):
  - incumbent Kinnick & Vail Building Services, Inc., Contract No. ACRAA-C-22-009, awarded February 2022
  - **$2,846,520** paid for calendar 2025 (`annualValue`)
  - **$13,750,000** NTE for the 60-month term (`totalValue` / `periodMonths`)
  - **$12,174,880.42** paid through September 30, 2026 over 54 months (`spendToDate` / `spendPeriodMonths`)

Model limitation: `24/7` continuous multi-shift coverage and once-nightly `Daily (7)` both map to `daily_7` (360
days). Labor estimated from this fixture therefore undercounts the 24/7 zones until the app models coverage hours or
posts.

## Traps

1. **Zones, not buildings, for the terminal.** "Passenger Terminal (Building 1)" and its 486,000 GSF appear in the
   prose and in A2. The facilities are the 23 Service Areas keyed by Area No.
2. **Finish split before the total.** Terrazzo / Carpet / Other come before Total SF under a spanning two-row header,
   with blank cells in row 2. Zero finishes print "—".
3. **Group header rows**: LEVEL 1/2/3, CONCOURSE A/B, FIS, LANDSIDE FACILITIES, AIRFIELD SUPPORT FACILITIES.
4. **Totals everywhere**:
   - level, concourse and FIS subtotals
   - Table A-1 and A-2 subtotals and the terminal total (334,860)
   - Part 2 subtotals and total (100,270)
   - Exhibit A Summary (435,130)
   - Exhibit B line areas
   - Exhibit C subtotals
   - Addendum Item 5 revised totals (337,690 / 99,650 / 437,340)
   - prose figures (about 335,000 SF; 185,000 SF terrazzo; 83,000 SF carpet)
5. **Continuation table.** Exhibit A Part 1 is two Word tables. The second sits under "Exhibit A, Part 1
   (continued)" and repeats the header.
6. **Gross vs contract cleaning area** in Table A-3, for example Hangar 3 at 38,600 / 2,940 and the Rental Car CSB
   at 18,900 / 7,350. Bldg. 200 prints "—" for gross, so its Contract Cleaning Area (14,600) is both values. The
   terminal Total SF is the serviced area, so it is both values too.
7. **Tenant, airline and agency areas excluded but listed with SF** (Part 3):
   - airline offices, concessions, TSA, rental car counters, the airline club, BHS rooms
   - Bldg. 310 QTA, Bldg. 700 FAA tower, Bldg. 710 FBO
   - Bldg. 300 note: 11,550 SF leased to rental car companies
8. **Option-only row inside the table.** F-03 sits between the FIS subtotal and the airside subtotal, marked
   "OPTION ITEM 1 – not included in subtotals or totals". It is repeated in Exhibit B Line 11 and Exhibit C.
9. **Vacant building**: Bldg. 800, "No service (vacant)".
10. **Addendum supersedes** (appended at the end; the body only says the Level 2 redevelopment "may change areas"):
    - T2-03 changes from 9,600 to 11,250.
    - CB-04 is added, in a one-row table with the full header.
    - Bldg. 450 is deleted.
    - Bldg. 420 changes from M/W/F to Tu/Th.
11. **Coverage codes vs hours.**
    - The Hours of Operation column ("03:30–01:00", "24 hrs", "Per CBP arrival schedule") is not a frequency.
    - The Section 2.6 floor-care frequencies (nightly, monthly, quarterly, semi-annually, every 2 hours) are tasks.
    - "Per Arrival" has no service level.
12. **Restroom groups vs fixtures.** Exhibit C prints Restroom Groups next to WC/UR/LAV/SH/Total, keyed by number
    only. It also lists F-03 (option) and Bldg. 450 (deleted by Item 7).
13. **Counts inside names**:
    - "Passenger Boarding Bridges (8 @ approx. 1,050 SF)"
    - "Arrivals Vestibules & Entrances (8 vestibules)"
    - "… Service Animal Relief Areas (2) and Nursing Suites (3)", where the parenthesized counts look like the
      note markers "(4)" and "(5)" that also follow names
14. **Exhibit B lines are not facilities**:
    - Lines 1–6 are grouped areas with Area No. lists.
    - Line 7 is FIS per arrival day (148).
    - Lines 8–10 are hourly (600 / 300 / 120).
    - Line 11 is the option (Month × 12).
15. **Numeric distractors**:
    - Year Built
    - 14 gates and 1,146,318 enplanements
    - staffing posts (13 / 11 / 9 / 33), and 41 FT / 9 PT employees
    - 151 FIS arrivals on 139 days
    - badge fees, minimum wage, insurance limits, bond and liquidated damages
    - evaluation points
16. **Prior award split across two places.** Section 1.4 names the incumbent, number, award and term. Only Addendum A4
    gives the dollars, and it warns that scopes differ.

## Review changes (adversarial check before scoring)

- `cleanableSqft` was added to the 23 terminal zones (= Total SF) and to Bldg. 200 (= 14,600). The document says
  these figures are the area to be serviced. Without them, a reader that dropped the serviced area would be
  estimated at the 0.85 default share of gross, and nothing would catch it.
- Exhibit D and A5 were scaled down to match the prior-award dollars. The draft had 60 posts a day (about 84 FTE)
  and 71 full-time plus 12 part-time incumbent employees against $2.85M a year. That is about $34,000 of revenue per
  employee, below the wage cost alone. Now there are 33 posts a day (about 46 FTE) and 41 full-time plus 9 part-time
  employees, which fits $2.85M at a loaded cost of about $47,000–50,000 per FTE plus G&A, fee and supplies. The
  draft's A4 dollars were kept: they sit on the scale of a real airport's prior-contract billing (Memphis RFP 24-0001
  Q&A: a monthly invoice of about $213,000 in October 2022). No facility, area or prior-award truth value changed.
- WebFetch and curl were blocked in this review session too (DNS failure / proxy 403), so the comparison with the
  real sources was again done through WebSearch excerpts.

## Regenerating

The HTML source and the facility rows in `truth.json` were generated together from one data table, so Exhibit A,
Exhibit B, Exhibit C, the Addendum and the totals stay consistent. A read-back check parses the rendered DOCX tables,
applies the addendum, and compares every expected field. If you edit a value by hand, update every place it appears:

- Exhibit A row, level/concourse subtotal, table subtotal and terminal or support total
- Exhibit A Summary
- Exhibit B line area
- Exhibit C row and totals
- Addendum Items 5–7 and the Q&A figures (A2, A3)
- `truth.json`
