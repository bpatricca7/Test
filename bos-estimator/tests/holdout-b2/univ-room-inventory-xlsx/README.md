# univ-room-inventory-xlsx

This is the space inventory attachment of a university custodial RFP: `RFP No. TSU-27-014`, "Custodial Services,
Academic & Administrative Buildings", for the fictional **Tamarack State University** in Pine Falls, Minnesota. The
estimator receives only the attachment workbook: **Attachment C - Space Inventory**, revised 10/02/2026 per Addendum
No. 1. It has four tabs: a notes and legend tab, a building summary, a 587-room export from the campus Space Management
System (SMS), and a floor-covering pivot. The RFP body and Attachment D (price schedule) are referenced but not
supplied, as often happens when a bidder is forwarded only the space data.

| Tab | Rows | Content |
|---|---|---|
| **Notes** | 92 | Title block (university, Purchasing Services address, RFP number, issue and revision dates), tab list, nine General Notes (data source, net vs gross, floor plans at Purchasing, pricing basis, excluded buildings, Cust Svc = N rules, Addendum No. 1 changes, APPA levels, frequency wording), the space category legend, floor covering codes and the FICM room use codes used in C-2 |
| **C-1 Bldg Summary** | 46 | Attachment C-1, "Building Summary of Cleanable Space". Four merged title rows, a stacked two-row header (group row BUILDING / AREA (SQ FT) / CONTRACT over 17 column titles with footnote markers (1)-(6)), **Part A** with 18 buildings in RFP scope (17 INCLUDE plus 045 "DELETED (Add. 1)") and a total, **Part B** with 6 buildings not in the contract and a total, an all-buildings total, and 7 footnote rows |
| **C-2 Room Data** | 728 | Attachment C-2, SMS report SPC-210 "Room Inventory by Building (Cleanable Space Profile)", run 09/14/2026 and **not re-run after the addendum**. A 7-row header block on page 1, then 13 "pages" inside the sheet, each with a repeated title line, "Page k of 13" and the column header. Each building has a group header line (with gross area and floors), room rows, "(continued)" headers after page breaks, and two footer lines (all rooms, Cust Svc = Y). The report ends with totals. Columns: Bldg, Bldg Name, Flr, Room, Room Name, Use Code, Use Description, Cat, Org, Stations, Net Area (SF), Floor Cvrg, Cust Svc, Comments |
| **C-3 Floor Covering** | 23 | Attachment C-3, cleanable SF by floor covering for the 17 included buildings (11 covering columns), a row total equal to the C-1 cleanable SF, and a TOTAL row |

Render, read back and score:

```bash
node tests/holdout-b2/univ-room-inventory-xlsx/gen.mjs        # regenerates the workbook JSON and truth facilities
node scripts/render-fixtures.mjs tests/holdout-b2/univ-room-inventory-xlsx
# -> build/TSU-27-014 Attachment C - Space Inventory (Rev 1 per Addendum 1).xlsx
npx tsx scripts/eval.ts tests/holdout-b2/univ-room-inventory-xlsx
```

## Provenance (fidelity: real-format)

Everything here is made up: the university, city, RFP number, the 24 buildings, all 587 rooms, every area, the
tenant (PFRMC) and the athletics contract number. No rows were copied. The layout, column headers and wording follow
real higher-ed custodial solicitations and space inventories found with web search:

| Source | What the fixture takes from it |
|---|---|
| [UMBC RFP BC-21175-E Janitorial Services (2020)](https://procurement.umbc.edu/wp-content/uploads/sites/145/2020/02/BC-21175-E-Janitorial-Services-RFP.pdf) | Space attachments split into "A - Cleanable Space Profiles" (room level, a separate file) and "D - Summary of Cleanable Spaces". These become C-2 and C-1 |
| [UMBC South Campus RFP BC-21211-E](https://procurement.umbc.edu/wp-content/uploads/sites/145/2020/11/South-Campus-Janitorial-Services-SBR-RFP-BC-21211-E-Final.pdf) | Pricing on "routine cleanable square footage" per building ("Academic 3 144,769"), giving C-1 col K and Notes 4 |
| [UMBC BC-21175-E Addendum 2](https://procurement.umbc.edu/files/2020/03/Janitorial-Services-BC-21175-E-Addendum-2-4March20.pdf) | An addendum that revises the square-footage chart: C-1 "Rev. A1" and Notes 7 |
| [Jackson State University RFP 25-07 Addendum 4](https://jsums.edu/businessfinance/files/2025/01/RFP-25-07-Custodial-and-Maintenance-Addendum-4-1.21.25.pdf) | C-1 column titles "Bldg. No., Building Name, Type of Building, Number of Floors, Gross Sq Ft, Net Assignable Sq Ft, ... Include/Excluded, Site". An addendum adds a cleanable column and adds and removes buildings. Excluded buildings stay on the chart with their figures |
| [Polk State College RFP 16-03](https://www.polk.edu/wp-content/uploads/RFP-16-03-Custodial-Services-REVISED-11-4-2016-FINAL.pdf) and [contract](https://www.polk.edu/wp-content/uploads/16-03-Custodial-Services-Contract-FINAL-.pdf) | "Estimated Gross Square Footage" list; "Floor plans and a list of rooms and square footage of each room is available for review at the Purchasing Department" (Notes 3); square footage taken out of service adjusts payment (Bergstrom 060 rooms) |
| [Iowa State FP&M building room list](https://www.fpm.iastate.edu/maps/buildings/rooms.asp?building=CURTISS) | Room list grouped by floor with Room, Room Type, SqFt, Cost Centers, Capacity and alternate name. These map to the C-2 columns Room, Room Name, Use Code/Description, Org, Stations and Net Area |
| [FICM 2006 (NCES 2006-160)](https://nces.ed.gov/pubs2006/2006160.pdf), [UConn FICM codes](https://space.uconn.edu/resources/glossary/ficm-codes), [Oregon State facility type codes](https://fpm.oregonstate.edu/space/space-tools/space-data-codes/facility-type-codes) | Every room use code and description (110 Classroom ... 750 Central Service). Non-assignable WWW / XXX / YYY, with building service = custodial closets, janitor rooms, public rest rooms and trash rooms. 050 Inactive Area and 060 Alteration or Conversion Area |
| [Bakersfield College Custodial Services Review and Plan (2010)](https://files.bakersfieldcollege.edu/accreditation-archives/2012Accreditation/Evidence/Standards/IIIB/III.B.79.pdf) | Inventory in assignable SF while cleaning uses cleanable SF. Restrooms are not assignable but are cleaned; mechanical and storage rooms are excluded. APPA levels (Level 2 "ordinary tidiness"). These set the Cust Svc rules (Notes 6) and the APPA column |
| [NOCCCD FUSION Space Inventory Report 17](https://www.nocccd.edu/documents/space-inventory-report-2024) | Space inventory printed as a numbered report organized by building and room, with room use detail. Basis for the SPC-210 report header, run date, census date and page numbering |
| [Kent State Ashtabula custodial RFP listing](https://www.ohiobids.com/government-agencies/portage/kent-state-university---procurement-78637/12950463-ksu-ashtabula-custodial-services-rfp.html) | Scope stated per building as "Building Net Cleanable Space", a building-level cleanable figure separate from gross |
| [UAH sealed janitorial solicitation](https://vrapp.vendorregistry.com/Bids/View/Bid/859216d5-777f-40a4-83fa-7a1212537cd2) | GSF and NASF both defined; the Q&A answers "Please use GSF" and has no cleanable SF. This is why Notes 4 states the pricing basis and why NASF is a distractor |
| [Lincoln University RFP B24-1228](https://www.lincolnu.edu/about-lincoln/purchasing/bid-information/rfp-b24-1228-facilities-management-services.pdf) | Campus buildings attachment, with residence halls and athletic facilities handled apart from academic buildings (C-1 Part B) |
| [Ohio State building area definitions](https://fits.osu.edu/kb/building-area-definitions) | Gross vs net (assignable + non-assignable). Cleanable excludes mechanical, structural and custodial areas (Notes 2 and 6, footnotes 2-5) |
| [Georgia comprehensive custodial RFP](https://pur.doas.ga.gov/gpr/downloadAttachment?attachmentId=54085599&sourceSystemType=gpr20) | Building-by-building cleanable vs excluded SF, vacant space and renovations; room counts by type. Basis for the C-1 remarks |
| [Copley Township cleaning bid specifications](https://www.copley.oh.us/DocumentCenter/View/8676/2025-Cleaning-Bid-Specs) | Room-by-room SF with the floor material per room and totals by floor type. Basis for the C-2 Floor Cvrg column and the C-3 pivot |

**Research limits.** The session's egress policy blocked WebFetch and direct downloads for every source host (DNS
failure or proxy 403). Each source above was therefore read only through web-search result excerpts, never opened in
full. Headers and phrases quoted here are the ones those excerpts showed. In particular:

- The JSU column list and the UMBC attachment names are verbatim from the excerpts.
- The X01-X04 sub-codes follow a university FICM code list that search surfaced, but the exact document was not
  confirmed.
- The W01-W05 and Y01-Y03 sub-codes, and the SPC-210 report number, are this fixture's own.

A later review session hit the same block (DNS failure for jsums.edu, procurement.umbc.edu, space.uconn.edu and
umsystem.edu). Its search excerpts agreed with the fixture: JSU Addendum 4 keeps removed buildings on the chart with
their figures ("Excluded - Offline") and adds a net assignable (cleanable) column, and FICM-based code lists define
050 Inactive Area and 060 Alteration or Conversion Area as above.

Known remaining tells:

- The room programs are tidy. Each floor has one or two corridors, two stairs, a pair of restrooms and a janitor
  room. Real SMS exports have more irregular numbering, and more rooms per building.
- Every figure reconciles exactly across C-1, C-2, C-3 and the totals, except the one documented stale value (the
  Bldg 019 gross in the C-2 group header).

## How each building's figures are stated

C-1 states every expected figure for each building directly. Nothing has to be derived from the rooms. The tabs check
against each other as follows:

- **grossSqft** = C-1 col G "Gross Sq Ft (2)", taken from the Facilities Inventory. It cannot be derived from the rooms:
  gross includes walls and shafts, so it is always larger than the room total.
- **cleanableSqft** = C-1 col K "Cleanable Sq Ft (5)". Footnote 5 defines it as the sum of Net Area of the building's
  C-2 rooms with Cust Svc = "Y". The same number is the C-2 footer "Total Bldg nnn (Cust Svc = Y)" and the C-3 row
  total.
- **Room Total Net** (col J) = Net Assignable (H) + Non-Assignable (I) = the C-2 footer "Total Bldg nnn (all rooms)".
  It is neither the gross nor the cleanable figure.
- **floors** = C-1 col E. Footnote 1 says it counts basements and excludes mezzanines, and it matches the distinct
  non-mezzanine C-2 "Flr" codes.
- **serviceLevel** comes from the C-1 col M wording:

  | C-1 wording | serviceLevel |
  |---|---|
  | "5/wk (M-F)" | daily_5 |
  | "6/wk (M-Sa)" | daily_6 |
  | "7/wk (Sun-Sat)" | daily_7 |
  | "3/wk (M/W/F)" | 3x_week |
  | "1/wk (Wed)" | weekly |

## Expected answers

- **17 facilities** (`facilitiesComplete: true`). These are the C-1 Part A rows marked INCLUDE: 010, 012, 014, 016, 018,
  019, 021, 022, 024, 026, 028, 030, 032, 035, 040, 041 and 050. Building numbers keep their leading zeros, and names
  are the C-1 Building Name.
- **Total gross is 372,074 SF** (equal to the C-1 "Total - Buildings Included" row). Total cleanable is 267,430 SF.
- **Addendum No. 1 is applied.** 045 Environmental Field Station is deleted. 019 Thorsen Hall gross is 15,269
  (the C-2 header still prints 14,549). 012 Elmore Library is 7/wk = daily_7.
- **Not expected:**
  - 045 (deleted)
  - 025 Hagen Hall (vacant)
  - 027 STEM Innovation Annex (Option 1, under construction)
  - 060 and 061 residence halls (housing)
  - 062 Lakeside Commons (dining)
  - 070 Wolf Arena (athletics, separate contract)
- **Categories** are set only where "Type of Building" is unambiguous: admin, education, child_care, community,
  fitness, medical and maintenance. 012 Library, 014 "Instruction - Science Labs" and 026 "Instruction - Labs & Shops"
  have none.
- **`grounds: []`**, because the attachment is custodial space only.
- **Site:** installation Tamarack State University, solicitation `TSU-27-014`, climate `cold` (Pine Falls,
  Minnesota). The workbook prints the number both as "RFP No. TSU-27-014" (Notes, C-1, C-3) and as "RFP TSU-27-014"
  (C-2 page titles), so truth keeps only the number, which either form contains. No contract term or prior award is
  stated.

## Traps

1. **Five area columns per building.** Gross, Net Assignable, Non-Assignable, Room Total Net and Cleanable all appear
   side by side. For example, Campus Union is 41,910 / 27,281 / 9,480 / 36,761 / 22,238. Net Assignable is not
   cleanable.
2. **A report export inside one sheet.** The 587 rooms run across 13 "pages", each with a repeated title, a
   "Page k of 13" line and the column header. The sheet also has building group headers (with gross area text),
   "(continued)" headers, two footer lines per building, and report totals that still include the deleted
   building.
3. **Addendum No. 1 applied in C-1 and C-3 only.** The 045 rows and rooms remain in C-2, and C-1 Part A keeps 045
   marked "DELETED (Add. 1)". The 019 gross is stale in the C-2 group header. The library frequency's old wording
   stays in the remarks.
4. **Excluded buildings carry full figures in C-1 Part B.** These are vacant, option, housing, dining and athletics
   buildings, 385,530 gross SF in all.
5. **Totals and subtotals** appear in C-1 (included, not in contract, all buildings), in the C-2 footers and report
   totals, and in the C-3 TOTAL row.
6. **Partial-scope buildings.** In these, cleanable is well below net:
   - Union bookstore and food court (auxiliary operators clean)
   - Allied Health 3rd floor (tenant cleans)
   - shops, warehouse and garage bays (not cleaned)
   - TEC dept. shop and server room (not cleaned)
   - renovation (060) and inactive (050) rooms
7. **Text codes with leading zeros.** Building numbers are text ("010"). Room numbers mix numeric cells and text
   (105A, 1C01, B04, M101), and floor codes are text ("01", "B", "M1").
8. **Floors rule.** Basements count and mezzanines do not. Fine Arts has levels B / 01 / 02 / M1 and counts 3
   floors.
9. **Different names across tabs.** C-2 uses SMS short uppercase names ("CONT ED & WORKFORCE CTR", "OSTRANDER HALL
   (HPE)"), while C-1 has the full names.
10. **Frequency wording.** It is nights per week plus days ("6/wk (M-Sa)", "1/wk (Wed)"). The holiday count (11) and
    "year-round" are not service levels.
11. **Distractor numbers next to the areas.** These include Year Built, APPA Level, Rev., three-digit Use Codes,
    Stations and No. of Floors.
12. **Stacked, merged C-1 header.** It has footnote markers, merged title rows, Part A / Part B section rows and
    trailing footnotes.
13. **C-3 repeats every included building a third time.** The row totals are the cleanable SF. These are not
    additional facilities.
14. **Leased building at a second site.** Bldg 050 is downtown, with gross "per lease exhibit", and is in scope.

## Regenerating

`gen.mjs` (seeded with mulberry32) builds the rooms for every building. From that one room list it computes the C-1
areas, the C-2 footers and pages, and the C-3 pivot. It writes `attachment-c-space-inventory.json` (the multi-sheet
source that `scripts/render-fixtures.mjs` turns into the XLSX) and replaces `expect.facilities` in `truth.json`. The
rest of `truth.json` (provenance, traps, site) is edited by hand. If you change a building, re-run the generator and
re-check the numbers quoted in the traps and in this README.
