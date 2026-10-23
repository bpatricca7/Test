# large-installation-420-xlsx

A scale test for solicitation `W9124Z-27-R-0420`, Base Operations Support Services (custodial and grounds
maintenance) at the fictional **Fort Brannock**. Section J **Attachment J-0302** is a single workbook with three
sheets:

- a facility list of 428 rows, 420 of them in scope;
- a sheet of grounds acres by cantonment zone and training area;
- a Notes sheet that defines the codes.

The fixture checks that the readers, the estimate and the 3D campus still work at 400+ buildings. That means no row
caps, no de-duplication by name, and no truncated tool output. Theme: `military-bos`.

| input | renders to | content |
|---|---|---|
| `facility-list.json` (written by `gen.mjs`) | `build/W9124Z-27-R-0420 Att J-0302 Facility List Fort Brannock.xlsx` | sheets `J-0302 Facility List` (456 rows × 10 columns), `Grounds` (51 × 7), `Notes` (17 × 3) |

```bash
cd bos-estimator
node tests/fixtures/large-installation-420-xlsx/gen.mjs        # rewrites facility-list.json and truth.json
node scripts/render-fixtures.mjs tests/fixtures/large-installation-420-xlsx
npx tsx scripts/eval.ts tests/fixtures/large-installation-420-xlsx
```

`gen.mjs` uses a seeded mulberry32 PRNG (seed `4202027`) and never calls `Math.random`, so every run produces
byte-identical `facility-list.json` and `truth.json`. Edit the generator, not the JSON. The script stops with an
error if the in-scope count is not exactly 420 or if a building number repeats.

## Workbook layout

**J-0302 Facility List.** The sheet opens with three merged title rows:

1. the solicitation line;
2. the attachment title;
3. a "Source: DPW Real Property Branch (GFEBS) extract" line.

A two-row merged header follows:

`ITEM | BLDG NO. | FACILITY DESCRIPTION | CATCODE | NO. OF FLOORS | AREA (SQUARE FEET): GROSS, CLEANABLE |
RESTROOM FIXTURES (EA) | CUSTODIAL FREQUENCY | REMARKS`

Both SF columns are formatted `#,##0`. The rows are grouped into six zones. Each zone opens with a merged section
row and closes with a `ZONE n SUBTOTAL - n FACILITIES IN SCOPE` row. Then come a `GRAND TOTAL - 420 FACILITIES IN
SCOPE` row and six numbered notes.

| zone | rows listed | in scope | gross SF (in scope) | cleanable SF |
|---|---:|---:|---:|---:|
| ZONE 1 - MAIN CANTONMENT (10xxx) | 74 | 71 | 1,308,356 | 1,045,437 |
| ZONE 2 - NORTH TROOP AREA (20xxx–21xxx, two BCTs) | 118 | 117 | 4,638,416 | 1,850,711 |
| ZONE 3 - SOUTH TROOP AREA (30xxx–31xxx, sustainment bde, DIVARTY, MI bn, T-numbers) | 95 | 94 | 3,782,338 | 1,514,704 |
| ZONE 4 - LOGISTICS AND INDUSTRIAL AREA (40xxx) | 47 | 46 | 1,907,813 | 231,420 |
| ZONE 5 - ARMY AIRFIELD (50xxx) | 21 | 20 | 681,731 | 247,511 |
| ZONE 6 - RANGES AND TRAINING AREAS (90xxx–97xxx) | 73 | 72 | 52,848 | 50,574 |
| **total** | **428** | **420** | **12,371,502** | **4,940,357** |

Facility List note 5 says the Zone 6 range and training-area latrines, range control towers and range buildings
are serviced at the listed frequency **year-round (52 weeks)**, whether or not the range is scheduled. The Range
Control schedule sets only the day of service. So the frequency codes need no range-use discount, and an estimator
can turn every row into an annual service count.

The 420 in-scope facilities break down as follows.

By category (truth only; the workbook prints no category, see "Category rule" below):

| category | count |
|---|---:|
| admin | 136 |
| barracks | 65 |
| other | 62 |
| warehouse | 53 |
| maintenance | 31 |
| education | 15 |
| community | 7 |
| medical | 7 |
| hangar | 6 |
| fitness | 5 |
| child_care | 5 |
| dining | 5 |
| none asserted | 23 |

By service level:

| service level | count |
|---|---:|
| daily_5 | 249 |
| weekly | 61 |
| monthly | 25 |
| daily_7 | 23 |
| 2x_week | 22 |
| biweekly | 20 |
| 3x_week | 18 |
| quarterly | 2 |

Gross SF runs from **120** (the ACP 1 MAIN GATE OVERWATCH BOOTH and the RANGE 03 KD LATRINE) to **250,000** (the
installation general purpose warehouse). The restroom-fixture total is 3,664, in 367 rows. The other 53 cells are
blank: 27 storage buildings, 19 range control towers, 6 range classrooms and the open overwatch booth.

Building sizes and fixture counts follow what is plausible at a real installation:

- Staff offices (Public Affairs, Inspector General, Safety, Retention, Red Cross, ID card) are 2,400 to 6,000 SF on
  one floor.
- Directorates and centers (SJA, NEC, Soldier Support Center) are 10,000 to 34,000 SF.
- Range latrines are CMU comfort stations with roughly 55 to 80 SF per fixture (2 to 8 fixtures). TA vault latrines
  have 2.
- An open booth under 200 SF has no restroom. Gatehouses have 1 or 2 fixtures.

**Grounds.** The sheet has two title rows and a two-row header: `AREA NO. | GROUNDS AREA | ACRES BY GROUNDS CATEGORY:
IMPROVED, SEMI-IMPROVED, UNIMPROVED | TOTAL ACRES | REMARKS`. Two sections follow:

- **CANTONMENT ZONES:** C-1 to C-8. C-7 FAMILY HOUSING AREAS (RCI) and C-8 GOLF COURSE (NAF) are NOT IN SCOPE.
- **TRAINING AREAS:** TA 01 to TA 24, plus IA-1 IMPACT AREA (DUDDED), which is NOT IN SCOPE.

Each section ends with a SUBTOTAL row, and the sheet ends with a `GRAND TOTAL (IN SCOPE)` row and five notes. A dash
`-` means zero. Note 5 says the unimproved training-area acreage is in scope for brush control and firebreak
maintenance only. That follows the Fort Benning grounds requirement cited below, which takes in unimproved acres.
In-scope totals:

| category | acres |
|---|---:|
| improved | 557.17 |
| semi-improved | 3,971.71 |
| unimproved | 125,436.75 |

These come from 78 truth grounds rows across 30 in-scope areas.

**Notes.** This sheet defines the frequency codes (`7X/WK`, `5X/WK`, `3X/WK`, `2X/WK`, `1X/WK`, `BI-WKLY`, `1X/MO`,
`QTRLY`, `N/A`) with nominal services per year (365, 250, 150, 100, 52, 26, 12, 4, 0). It also gives the improved,
semi-improved and unimproved definitions.

The document's own counts differ from the app's `SERVICE_LEVELS` table in `shared/types.ts`, which uses 360 for
daily_7 and 50 for weekly. Truth asserts only the level id, so scoring is unaffected. An estimate built from the
app's table will still not match the workbook's nominal counts exactly.

**Column widths.** Each sheet in `facility-list.json` carries a `colWidths` array with the intended Excel widths: a
66-character FACILITY DESCRIPTION column, wide REMARKS columns, and a 110-character Notes definition column. This is
the same convention as `univ-buildings-in-scope-xlsx`.

`scripts/render-fixtures.mjs` does not read `colWidths` yet. It sets every column to width 16, with no wrap, bold,
borders or freeze panes. Until it does, a person opening the workbook sees long names, the `RESTROOM FIXTURES (EA)` and
`CUSTODIAL FREQUENCY` headers, and the Notes definitions clipped next to filled cells. The cell values are intact,
so machine readers are unaffected.

The renderer also writes blank RESTROOM FIXTURES cells as empty-string cells, not truly empty ones, because JSON
sources cannot express an absent cell. Readers must treat `''` as blank.

## Expected answers (truth.json)

- **420 facilities** (`facilitiesComplete: true`). Every facility has a building number, name, gross SF, cleanable
  SF, floors and service level. Restroom fixtures are given where the cell is not blank. No dining profile is
  asserted, because the workbook has no meals/day.
- **Grounds:** each in-scope area row becomes one entry per non-zero category, in acres, named
  `<AREA NO.> <GROUNDS AREA>`.
- **Site:** installationName `Fort Brannock`, solicitation `W9124Z-27-R-0420`. The workbook has no contract term,
  climate zone, incumbent or prior award, so none is asserted.

### Category rule

The workbook prints a CATCODE, not an app category. Truth asserts a category for **397 of 420** facilities, only
where the CATCODE family maps to exactly one app category:

| CATCODE family | category |
|---|---|
| 72111 UEPH | barracks |
| 14182 / 14183 / 14185 / 61050 / 14112 / 14114 headquarters, COF, admin, airfield ops, CID | admin |
| 17120 / 17150 / 17892 instruction, simulator, range classroom | education |
| 21410 / 21910 TEMF and shops | maintenance |
| 21110 hangar | hangar |
| 44220 / 44224 / 44260 storage and warehouses (incl. aviation unit storage, hazmat storage, self service supply) | warehouse |
| 54010 / 55010 dental and medical clinics | medical |
| 72210 DFAC | dining |
| 73017 chapels, 74010 ACS / SFAC, 74044 library | community |
| 74028 / 74042 fitness center, indoor pool | fitness |
| 74046 CDC, school age center | child_care |

`other` is asserted only for small unoccupied structures that fit no specific category:

- 14113 gatehouses and booths;
- 12410 fuel point control buildings;
- 17890 range control towers (2–3 level observation towers);
- 73046 range and TA latrines.

**No category** is asserted for building types an estimator could reasonably file two ways:

- 73010 fire stations and the aircraft crash rescue station. The serviced areas are admin and latrines, so either
  admin or other fits.
- 73075 DES / MP station and 73070 post office (admin or other).
- 14171 air traffic control tower. It is a six-floor occupied operations building, unlike the range towers, so admin
  or other fits.
- 17891 range operations and storage buildings and the range control ammunition breakdown building (warehouse or
  other).
- The visitor control center (admin or other).
- The religious education center (community or education).
- The youth center (community or child_care).

## Traps

- **Scale.** There are 428 facility rows and 420 expected facilities. A reader that caps rows, pages tool output or
  stops after a few hundred rows loses recall.
- **Repeated names.** Among the in-scope rows, 66 are named "COMPANY OPERATIONS FACILITY (COF)", 34 "UEPH BARRACKS",
  23 "ORGANIZATIONAL STORAGE BLDG", 22 "TACTICAL EQUIPMENT MAINT FACILITY (TEMF)" and 22 "GENERAL PURPOSE
  WAREHOUSE". Including NOT IN SCOPE rows, 35 UEPH BARRACKS and 23 GENERAL PURPOSE WAREHOUSE rows are listed. In
  all, 262 in-scope rows share a name with another in-scope row, and only the building number tells them apart.
- **Rows that are not facilities.**
  - **ITEM** is a row counter.
  - **CATCODE** is a 5-digit number cell, such as 72111.
  - **Section and total rows:** zone section rows, 6 zone subtotals and the grand total.
  - **Notes sheet:** the "SERVICES PER YEAR" values (365, 250, ...).
- **8 NOT IN SCOPE rows.** Each still prints its SF, with frequency `N/A`:
  - 10809 WWII wood admin building (vacant)
  - 10814 AAFES shoppette
  - 10816 NAF bowling center
  - 21926 rolling-pin barracks (demolished)
  - 31832 UEPH barracks (under renovation)
  - 40141 warehouse (demolished)
  - 50061 hangar (transferred to ARNG)
  - 93101 RANGE 31 latrine (range closed)

  Subtotals and totals already leave these out.
- **Building number forms.**
  - Suffixed storage annexes, such as `20146A` next to TEMF `20146`, are text cells.
  - Relocatable buildings use `T`-prefixed numbers, such as `T32001`.
  - All other building numbers are numeric cells.
- **Cleanable well below gross.** Do not default cleanable to gross.
  - **Far below gross** (office, break and latrine areas only):

    | building type | cleanable share of gross |
    |---|---:|
    | warehouses | 4–10% |
    | TEMFs (note 3) | 12–20% |
    | DOL maintenance shops | 12–16% |
    | hangars | 15–25% |
    | UEPH barracks, common areas only (note 2) | 18–26% |

  - **Partial share:**

    | building type | cleanable share of gross | why |
    |---|---:|---|
    | DPW shops | 33–44% | |
    | DFACs | 63–69% | the kitchen is serviced by the food service contractor |
    | fire and crash rescue stations | 66–70% | the apparatus bay and quarters are excluded |
- **Frequency codes.** The codes must be mapped through the Notes sheet: `BI-WKLY` → biweekly, `1X/MO` → monthly,
  `QTRLY` → quarterly. Note 5 makes the range codes year-round.
- **Grounds.**
  - The merged category header must be read correctly, and a dash means zero.
  - Three NOT IN SCOPE areas must be skipped. IA-1 alone is 17,589.12 AC unimproved.
  - The TOTAL ACRES column and the subtotal and grand total rows must not be counted twice.
  - Unimproved training land is in scope and makes up most of the acreage.

## Provenance (fidelity: synthetic)

Everything in the workbook is generated. Real sources set only the CATCODE assignments below, the scale and the
grounds category scheme. WebSearch excerpts could be read, but no document could be downloaded.

### CATCODEs tied to real sources

- **14185** COMPANY OPERATIONS FACILITY (COF), **21410** TEMF and **72210** dining facility, with **72111** among the
  enlisted housing codes. Source: USACE Army Facilities Pricing Guide, PAX 3.2.2 (2017),
  https://www.usace.army.mil/Portals/2/FY2019%202017_PAX_Newsletter_3_2_2_Army_Facilities_Pricing_Guide_Dated_6%20APR%202017___.pdf
- **14183** BATTALION HQS BLDG W/ CLASSROOMS, **14182** brigade headquarters, and **74042** indoor swimming pool as
  a code separate from the fitness center. Source: USACE unit costs,
  https://www.usace.army.mil/LinkClick.aspx?fileticket=KnZFypDe6uQ%3D&portalid=2
- **21410** VEHICLE MAINT SHOP - TRACK and **72111** unaccompanied personnel housing. Source: FY05 unit cost table,
  https://www.usace.army.mil/LinkClick.aspx?fileticket=I5cAMZGFUkE%3D&portalid=2
- **14114** CIDC field operations building. Source:
  https://www.usace.army.mil/LinkClick.aspx?fileticket=bdnXSYCqMYI%3D&portalid=2
- The five-digit CATCD system itself comes from AR 415-28:
  https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/r415_28.pdf

### Plausible CATCODEs, not verified

All other CATCODEs are plausible but were not checked against DA Pam 415-28:

61050, 73017, 74028, 74046, 55010, 54010, 44220, 44224, 44260, 21110, 21910, 17120, 17150, 73010, 73046, 73070,
73075, 74010, 74021, 74044, 74047, 74055, 12410, 14112, 14113, 14171, 17890–17892.

### Scale

The Fort Cavazos Installation Custodial Service sources sought (PANMCC-25-P-0000015172) covers roughly 500 to 600
government facilities under one requirement. Sources:

- https://www.samdaily.us/archive/2025/05-May/18-May-2025/FBO-07446536.htm
- https://oversight.govsignals.ai/opportunity/sources-sought-for-installation-custodial-service-at-fort-cavazos-tx-panmcc-25-p-0000015172

This fixture's 420 in-scope facilities sit just below that range.

### Grounds categories

- The Fort Benning grounds maintenance sources sought covers about 184,000 acres of improved, semi-improved and
  unimproved grounds. It excludes the golf course, cemetery, airfield and some MWR areas. That is the basis for
  keeping unimproved training land in scope and for the NOT IN SCOPE golf course row:
  https://app.g2xchange.com/opportunities/sam/7c36ee60-7ed0-4dec-bdae-6eba76a41dce
- The improved and semi-improved definitions are paraphrased from
  https://www.patrick.spaceforce.mil/Portals/14/AFD-150612-026.pdf

### Made up

- the installation, the solicitation number and the attachment number;
- every building number, name, area, floor count, fixture count, frequency, remark and acreage;
- the zone and training-area layout.

The column layout follows common Army Technical Exhibit practice and the other workbook fixtures here, not a specific
public document. The package is only the J attachment, with no PWS, Section B CLINs, period of performance or
incumbent. That is deliberate for a scale test. Other fixtures exercise those parts.
