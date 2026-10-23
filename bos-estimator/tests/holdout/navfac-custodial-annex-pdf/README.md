# navfac-custodial-annex-pdf

This is a Navy base operating support (BOS) solicitation's Section J extract for **Annex 15 – Facilities Support**, as
one 10-page PDF with a text layer. The solicitation is `N69450-26-R-0014`, for the fictional **Naval Support Activity
(NSA) Tarpon Sound, Florida**, its **Saltmarsh Point Annex**, and the outlying **Navy Operational Support Center (NOSC)
Cypress Landing**. The file holds every attachment to Sub-annex 1503010 Custodial (J-1503010-01 through -09) and the
grounds acreage summary from Sub-annex 1503050 (J-1503050-04). It is "conformed through Amendment 0002": the custodial
inventory is the revised attachment, and the cover lists what the amendment changed.

| Pages | Content | Orientation |
|---|---|---|
| 1 | Cover: Section J / Annex 15 title block, solicitation and sites, attachment index with page locations, **Summary of Changes – Amendment 0002** (old and new values) | portrait |
| 2 | J-1503010-01 Definitions and Acronyms; J-1503010-02 References and Technical Documents | portrait |
| 3 | J-1503010-03 Common Output Level Standards: COL 1–4 by work item, legend (S, D, 3W … Y/2, 0), Notes 1–4 | portrait |
| 4 | J-1503010-04 Service Classes A–D (tenant commands not funded by CNIC), legend | portrait |
| 5 | J-1503010-05 Mandated Service Classes for Hospitals and Clinics (abridged) | portrait |
| 6 | J-1503010-06 Mandated Service Classes for Child Youth Program Facilities (abridged); J-1503010-07 Maps and Locations and J-1503010-08 Floor Plans, both "provided upon award" | portrait |
| 7–9 | **J-1503010-09 Custodial Inventory** (Revised, Amendment 0002): 16 columns, two-row header repeated on each page, General Notes 1–4 on page 7, Notes 5–13 on page 9 | landscape |
| 10 | **J-1503050-04 Area Maps / Total Acreage Summary**: Type / Spec. Item / Installation / Acreage, with a TOTAL row and notes | portrait |

Inventory columns: `Fac. No. | Facility Name | CCN | CCN Title | Flrs | Facility Total SF | Carpet | Resilient (VCT / LVT
/ Rubber) | Ceramic / Quarry / Terrazzo | Wood | Sealed Concrete | Total Custodial SF | Rest-rooms | COL / Class |
Service Days | Remarks`. The group headers are "FACILITY DATA (iNFADS, 30 JUN 2026)", "CUSTODIAL AREA BY FLOOR TYPE (SF)"
and "SERVICE". Rows are grouped by site, each site has a subtotal row with a facility count, and a grand total closes the
table.

Source: `n6945026r0014-sec-j-annex15-amd0002.html` → `build/N6945026R0014 Section J Annex 15 J-1503010 Custodial and
J-1503050-04 (Conformed Amd 0002).pdf`.

```bash
node scripts/render-fixtures.mjs tests/holdout/navfac-custodial-annex-pdf
npx tsx scripts/eval.ts tests/holdout/navfac-custodial-annex-pdf
```

## Provenance (fidelity: real-format)

All values are made up: the installation, sites, facility numbers, names, CCNs, floors, square footage, floor-type
splits, restroom counts, schedules, acreage and the solicitation number. No inventory rows were copied. The frequency
tables on pages 3–6 are copied from real NAVFAC templates; pages 5 and 6 are abridged.

The real documents were downloaded from a public S3 mirror of SAM.gov attachments (`imlive.s3.amazonaws.com`) and read
with `pdftotext -layout`. WebFetch could not resolve any host in this session, and sam.gov, neco.navy.mil, govtribe.com
and wbdg.org were blocked, so the last two sources were seen only as web-search results.

| Source | What the fixture takes from it |
|---|---|
| [Section J-1503010 Custodial, NAVFAC Atlantic, Jan 2022 (BOS Poland, N62470-21-R-0002)](https://imlive.s3.amazonaws.com/Federal%20Government/ID84378411329489519550270390172200117027/J-1503010%20Custodial.pdf) | Attachment index layout; definitions (copied in part); the J-1503010-03 COL 1–4 matrix with "Prestige (HQ Approved)" / "Prestige (REGCOM approved)", Notes 1–4 and the legend; the J-1503010-04 Service Classes A–D matrix; the J-1503010-05 hospital/clinic matrix; the line that the inventory is "provided as a separate attachment" |
| [Section J-1503010 Custodial, Jun 2020](https://imlive.s3.amazonaws.com/Federal%20Government/ID17496671638689343863787266752627103266/J-1503010%20Custodial.pdf) | The nine-attachment numbering used here (-06 CYP, -07 Maps and Locations and -08 Floor Plans "will be provided upon award", -09 Custodial Inventory); the CYP matrix and its OPNAV Instruction 1700.9 Chapter 19 preamble |
| [Section C, N69450-21-R-0056, NSA Panama City and NOSC Tallahassee (Apr 2021)](https://imlive.s3.amazonaws.com/Federal%20Government/ID132007103362279768111943685007714419458/N6945021R0056%20Section%20C.pdf) | One BOS covering a main installation, outlying areas and a NOSC; the Annex 15 sub-annex list; what the inventory carries ("floor types and surface area", Prestige spaces at COL 2, "Hospital, clinic and galley floors to be sanitized"); "additional supplies at NOSC Tallahassee during drill weekends. Drill weekends are once per month" (Note 13); building perimeter "within five feet"; service orders priced from J-0200000-17 ELINs (Note 10) |
| [Section C, N69450-20-R-0010, NS Guantanamo Bay (Dec 2019)](https://imlive.s3.amazonaws.com/Federal%20Government/ID13007136327205386842817887683565179804/N6945020R0010SectionC.pdf) | "perform custodial services at the associated frequencies shown for COL 3"; after-hours facilities "identified [in] the Custodial Inventory" (Note 5); "Prestige grounds are considered improved grounds and shall be maintained at COLS 2" (grounds Note 2) |
| [BOS Poland RFP N62470-21-R-0002 (Jan 2022)](https://imlive.s3.amazonaws.com/Federal%20Government/ID84378411329489519550270390172200117027/N62470-21-R-0002%20BOS%20Poland%20RFP.pdf) | Section J table of contents with annex-numbered attachments (J-1501000-03 Facility Listing, J-1503010-06 Custodial Inventory, J-1503050 Grounds); model for the cover index |
| [J-1503050-04 Area Maps / Total Acreage Summary (Oct 2019)](https://imlive.s3.amazonaws.com/Federal%20Government/ID214896083279806155317518988249053576329/Attach_(4)_J-1503050-04_Total_Acreage_Summary.pdf) | Page 10 layout: `Type | Spec. Item | Installation | Acreage`, tenant-prefixed types ("USMC Prestige", "MCCS Improved", "FENCE LINE Semi-Improved"), several site codes in one cell, TOTAL row |
| [Section C 1503050 Grounds Maintenance and Landscaping, Amendment 0007 (NAVFAC Washington, Feb 2020)](https://imlive.s3.amazonaws.com/Federal%20Government/ID16469748308018354582666070556571127870/C-1503050%20Grounts%20Maint_Landscaping_Amend%200007%20%20(Att35).pdf) | "grounds parcels designated as improved, semi-improved and unimproved areas"; trash cans and debris "within 5 feet of designated buildings ... included in 1503010, Custodial" (grounds Note 5) |
| [NECO, Portsmouth Naval Shipyard custodial N40085-19-R-9047](https://www.neco.navy.mil/biz_ops/840-v5static.aspx?hkey=190867310) (search result only) | Its attachment list includes `J-1503010-09_Custodial_InventoryREV.pdf`, which shows a custodial inventory issued as a PDF and reissued as a revised attachment by amendment |
| [GovTribe, NSF Redzikowo BOS N62470-23-R-0010](https://govtribe.com/opportunity/federal-contract-opportunity/base-operations-support-bos-services-at-naval-support-facility-nsf-redzikowo-poland-n6247023r0010-1) (search result only) | `J-1503010-06 Custodial Inventory.xlsx`. A Sigonella listing in the same search has `J-1503010-06.b Custodial Inventory and Frequencies.xlsx`, so the inventory carries per-facility frequency data (the Service Days column) |

### What is and is not verified

- **Inventory columns.** The real inventories (J-1503010-06 or -09) are Excel workbooks, and none could be opened. The
  column set is built from what the real Section C texts say the inventory contains: floor types and surface area,
  fixtures, Prestige spaces, after-hours facilities, sanitized floors and drill-weekend service. The iNFADS facility
  columns (CCN, CCN title, floors, gross SF) follow the Navy facility listing. The "Service Days" codes (M–F, M–Sa,
  M–Su, M/W/F, T/Th, Wed) are the author's; real files may express days of service differently.
- **CCNs.** The CCNs and titles (610-10 ADMINISTRATIVE OFFICE, 721-11 UNACCOMPANIED ENLISTED HOUSING, 740-74 CHILD
  DEVELOPMENT CENTER, …) follow the NAVFAC P-72 / iNFADS style from the author's knowledge. They were not checked
  against FC 2-000-05N Appendix A because wbdg.org was blocked. No expected value depends on a CCN.
- **Bundling.** Real solicitations usually post each sub-annex's attachments as a separate file. Putting J-1503010 and
  J-1503050-04 in one PDF is a simplification.
- **Not stated.** The document does not state the contract term or a prior award. Section J attachments carry
  neither, so `contractYears` and `priorAward` are not expected.

## Expected answers

- **32 facilities** (`facilitiesComplete: true`): 26 at the Main Base, 4 at Saltmarsh Point Annex and 2 at NOSC Cypress
  Landing. Together they total **726,250 gross SF** and **380,975 custodial SF**, which match the printed grand total.
  - Building numbers are the Fac. No. values: 100–255 at the main base, SP-01–SP-12 at the annex, 1–2 at the NOSC.
  - `grossSqft` is Facility Total SF. `cleanableSqft` is Total Custodial SF (General Notes 1–2). `floors` is Flrs.
- Values are post-Amendment 0002:
  - Fac. 104 is 9,840 gross and 8,730 custodial (not 7,960).
  - Fac. 152 is 68,400 gross (not 64,800).
  - SP-12 (2,880 / 2,610) is included.
  - 240 and 245 are not included.
- Not expected (rows listed "for information" and left out of the subtotals):
  - 175 (option)
  - 190 and 192 (NAF, not in contract)
  - 240 (vacant)
  - 245 and SP-10 (on-call service orders only)
  - NOSC 3 (unoccupied storage)
- `serviceLevel` comes from the Service Days column:

  | Service Days | Service level | Facilities |
  |---|---|---|
  | M–F | `daily_5` | most |
  | M–Sa | `daily_6` | 130 |
  | M–Su | `daily_7` | 120, 122, 140, 160, 250 |
  | M/W/F | `3x_week` | 180, 212 |
  | T/Th | `2x_week` | 225, SP-04 |
  | Wed | `weekly` | 255, SP-07, NOSC 2 |

  - 162 Outdoor Pool Bathhouse is seasonal (M–Su from Memorial Day through Labor Day), so it has no `serviceLevel`.
  - NOSC 1 is `daily_5`. Its drill-weekend restroom servicing (Note 13) is an add-on task.
- `category` is given for 23 facilities, only where the CCN title is unambiguous (see trap 18).
- **Grounds** come from J-1503050-04, as 10 rows in acres totalling 502.50:
  - Improved turf, 167.37 acres: Prestige 6.84 (Prestige counts as improved, grounds Note 2), NAVY Improved 128.47,
    MWR 21.30, CYP 3.15, SPA 4.75, NOSC 2.86.
  - Semi-improved, 98.23 acres: 84.65, 12.18 and 1.40.
  - Unimproved: 236.90 acres.
- **Site:** "Naval Support Activity Tarpon Sound", solicitation "N69450-26-R-0014", `hot_humid` (Florida).
- `contractYears` and `priorAward` are not expected, because the document states neither.

## Traps

1. **Gross vs custodial on every row.** Partial-service buildings have large gaps:
   - Hangar 230: 38,400 / 6,120
   - Warehouse 200: 46,200 / 4,860
   - Unaccompanied Housing 150 and 151: 52,860 / 10,420 (common areas only)
   - Galley 140: 21,300 / 8,640 (the kitchen belongs to Annex 13)
   - Fire Station 120: 11,250 / 3,980
2. **Five floor-type columns** sit between the gross and the custodial total. Their values are not facility areas, and
   many are 0.
3. **Seven out-of-scope rows sit in the same table** with a gross SF and em dashes: an option, two NAF facilities, a
   vacant building, two on-call buildings and an unoccupied shed.
4. **Amendment conformed in place.** The rows carry the new values, but the cover's Summary of Changes prints the old
   ones: 4,010 / 7,960 for Fac. 104, 64,800 for Fac. 152, 14,380 and 1,860 for the deleted service, and old subtotals
   354,935 / 15,100 / 393,835 / 738,190 / 33 facilities.
5. **Totals are not facilities.** These include the three site subtotals with "(n facilities)", "GRAND TOTAL – ALL
   SITES (32 facilities)", the cover's item 6 and the acreage TOTAL 502.50.
6. **Three sites with group-header rows.** The Main Base group continues on page 2 as "(CONTINUED)". "Annex" means both
   PWS Annex 15 and the Saltmarsh Point Annex site.
7. **Three building-number schemes** (100–255, SP-xx, 1–3). The CCN column (610-10, 721-11, …) looks like a number
   but is a category code.
8. **Footnote markers glued to names in the text layer.** Examples: "Unaccompanied Housing Bldg 1508" (Bldg 150 plus
   Note 8), "Fitness Center5", "Center Cypress Landing13", "Building9".
9. **Landscape 16-column table over three pages.** The two-row header is repeated, the group headers carry glued note
   markers, column titles stack over up to four lines, and names, CCN titles and remarks wrap.
10. **Frequency is the Service Days column**, not "COL / Class". COL 3 or Service Class B–D and the S/D/3W/W/2M/…
    matrices on pages 3–6 are per work item. For example, COL 3 empties waste weekly but cleans restrooms once per
    shift. General Note 4 also says a work item more frequent than the Service Days (e.g. 3W in a Wed facility) is
    done on each Service Day, so the Service Days cap the visit frequency.
11. **Seasonal bathhouse.** It is in scope, but no service level is expected.
12. **Drill weekends at the NOSC.** It is still `daily_5`.
13. **Twin buildings.** 150 and 151 have identical figures, and both are facilities.
14. **Remarks and the page-9 notes hold distractor numbers.** Examples: "(2,140 SF) at COL 2 (Prestige)" inside Bldg 100, room numbers,
    service windows, "Annex 13", BOD dates, FY28, Spec Item 3.2, J-0200000-17.
15. **"Rest-rooms" counts rooms, not fixtures.** `restroomFixtures` is not expected.
16. **Grounds use tenant-prefixed labels and combined-site cells** ("NSA TS/SPA"). Prestige is improved turf. The Spec.
    Item column (3.1 / 3.2 / 3.3) is not a quantity.
17. **Front matter is code-heavy but holds no facilities.** It includes attachment numbers, COL and Service Class
    matrices, CFR citations and OPNAVINST 1700.9. (The 5-foot perimeter rule is in grounds Note 5 on page 10.)
18. **Category only where the CCN title is unambiguous** (23 of 32). It is left out for:
    - the fire station and police station
    - 172 Youth Center / School Age Care: CCN 740-76 is in the 740 community-facility series, but the row is a CYP
      facility, so `community` and `child_care` are both defensible (the other holdout and fixture sets also leave
      youth centers without a category)
    - the bathhouses
    - the auto hobby shop
    - the range control tower
    - the reserve training building
    - the NOSC vehicle maintenance / storage building (its CCN title matches 212, but the name adds storage)
19. **No contract term or prior award** in the document. The amendment and iNFADS dates are not contract dates.

## Regenerating

The HTML and the facility and grounds rows in `truth.json` were generated together from one data table, so the
inventory rows, floor-type sums, site subtotals, grand total, the cover's Summary of Changes and the acreage total
all agree. Each was then checked against the rendered PDF's `pdftotext -layout` output, with subtotals recomputed from
the parsed rows. If you edit a value by hand, update every place it appears:

- the inventory row
- its floor-type columns
- the site subtotal and grand total
- cover item 6 (and items 1–5 if the row was revised)
- `truth.json`

### Hand edits after generation (independent review, 23 Oct 2026)

These were made directly in the HTML and `truth.json`, so a rerun of the original generator would undo them:

- **Solicitation number** changed from `N69450-27-R-0014` to `N69450-26-R-0014` (and the source and PDF file names
  to match). The solicitation is dated 24 July 2026, which is FY26, and a PIIN carries the fiscal year in which it is
  assigned (DFARS 204.1603). The cited NAVFAC Southeast numbers follow the same rule.
- **General Note 4** gained one sentence: a work item whose frequency exceeds the Service Days (e.g. 3W in a Wed
  facility) is performed on each Service Day. Without it, the real Service Class D matrix (drinking fountains 3W)
  contradicted the T/Th and Wed schedules of the Class D rows SP-04 and SP-07. No number changed.
- **Category removed from 172** Youth Center / School Age Care (see trap 18), so 23 facilities carry a category.
- **Trap wording.** The 5-foot perimeter rule is on page 10, not in the front matter, and "Spec Item 3.2" and
  "J-0200000-17" are in Note 10, not in Remarks.

The reviewer read the rendered PDF independently (all 32 rows, floor-type sums, the three subtotals, the grand total,
the superseded figures on the cover and the acreage total agree), and fetched two of the cited sources with WebFetch:
the Jan 2022 J-1503010 Custodial PDF (its COL 1–4, Service Class A–D and hospital/clinic matrices match pages 3–5) and
the Oct 2019 J-1503050-04 acreage summary (same `Type | Spec. Item | Installation | Acreage` layout, tenant-prefixed
types, multi-site cells such as `FOS/KIN/LES`, a TOTAL row).
