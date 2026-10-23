# large-installation-420-xlsx

A scale test for solicitation `W9124Z-27-R-0420`, Base Operations Support Services (custodial and grounds
maintenance) at the fictional **Fort Brannock**. Section J **Attachment J-0302** is a single workbook with three
sheets:

- a facility list of 428 rows, 420 of them in scope;
- a sheet of grounds acres by cantonment zone and training area;
- a Notes sheet that defines the codes.

The fixture checks that the readers, the estimate and the 3D campus still work at 400+ buildings. That means no row
caps, no de-duplication by name, and no truncated tool output.

| input | renders to | content |
|---|---|---|
| `facility-list.json` (written by `gen.mjs`) | `build/W9124Z-27-R-0420 Att J-0302 Facility List Fort Brannock.xlsx` | sheets `J-0302 Facility List` (456 rows × 10 columns), `Grounds` (50 × 7), `Notes` (17 × 3) |

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
| ZONE 1 - MAIN CANTONMENT (10xxx) | 74 | 71 | 1,592,711 | 1,298,688 |
| ZONE 2 - NORTH TROOP AREA (20xxx–21xxx, two BCTs) | 118 | 117 | 4,623,505 | 1,869,717 |
| ZONE 3 - SOUTH TROOP AREA (30xxx–31xxx, sustainment bde, DIVARTY, MI bn, T-numbers) | 95 | 94 | 3,672,674 | 1,509,218 |
| ZONE 4 - LOGISTICS AND INDUSTRIAL AREA (40xxx) | 47 | 46 | 1,924,695 | 269,744 |
| ZONE 5 - ARMY AIRFIELD (50xxx) | 21 | 20 | 771,436 | 290,521 |
| ZONE 6 - RANGES AND TRAINING AREAS (90xxx–97xxx) | 73 | 72 | 50,758 | 48,326 |
| **total** | **428** | **420** | **12,635,779** | **5,286,214** |

The 420 in-scope facilities break down as follows.

By category:

| category | count |
|---|---:|
| admin | 136 |
| other | 67 |
| barracks | 65 |
| warehouse | 53 |
| maintenance | 31 |
| education | 15 |
| community | 9 |
| medical | 7 |
| hangar | 6 |
| fitness | 5 |
| child_care | 5 |
| dining | 5 |
| none asserted | 16 |

By service level:

| service level | count |
|---|---:|
| daily_5 | 248 |
| weekly | 59 |
| monthly | 25 |
| biweekly | 25 |
| daily_7 | 23 |
| 2x_week | 21 |
| 3x_week | 17 |
| quarterly | 2 |

Gross SF runs from **120** (the RANGE 03 KD LATRINE and the ACP 1 overwatch booth) to **250,000** (the installation
general purpose warehouse). The restroom-fixture total is 3,736.

**Grounds.** The sheet has two title rows and a two-row header: `AREA NO. | GROUNDS AREA | ACRES BY GROUNDS CATEGORY:
IMPROVED, SEMI-IMPROVED, UNIMPROVED | TOTAL ACRES | REMARKS`. Two sections follow:

- **CANTONMENT ZONES:** C-1 to C-8. C-7 FAMILY HOUSING (RCI) and C-8 GOLF COURSE (NAF) are NOT IN SCOPE.
- **TRAINING AREAS:** TA 01 to TA 24, plus IA-1 IMPACT AREA (DUDDED), which is NOT IN SCOPE.

Each section ends with a SUBTOTAL row, and the sheet ends with a `GRAND TOTAL (IN SCOPE)` row and notes. A dash `-`
means zero. In-scope totals:

| category | acres |
|---|---:|
| improved | 580.67 |
| semi-improved | 3,741.26 |
| unimproved | 117,197.10 |

These come from 78 truth grounds rows across 30 in-scope areas.

**Notes.** This sheet defines the frequency codes (`7X/WK`, `5X/WK`, `3X/WK`, `2X/WK`, `1X/WK`, `BI-WKLY`, `1X/MO`,
`QTRLY`, `N/A`) with nominal services per year, and gives the improved, semi-improved and unimproved definitions.

## Expected answers (truth.json)

- **420 facilities** (`facilitiesComplete: true`). Every facility has a building number, name, gross SF, cleanable
  SF, floors and service level. A category is given where the CATCODE or name is unambiguous: 404 of 420. Restroom
  fixtures are given where the cell is not blank. No dining profile is asserted, because the workbook has no
  meals/day.
- **Grounds:** each in-scope area row becomes one entry per non-zero category, in acres, named
  `<AREA NO.> <GROUNDS AREA>`.
- **Site:** installationName `Fort Brannock`, solicitation `W9124Z-27-R-0420`. No prior award.

## Traps

- **Scale.** There are 428 facility rows and 420 expected facilities. A reader that caps rows, pages tool output or
  stops after a few hundred rows loses recall.
- **Repeated names.** 66 rows are named "COMPANY OPERATIONS FACILITY (COF)", 42 "UEPH BARRACKS", 23 "ORGANIZATIONAL
  STORAGE BLDG", 22 "TACTICAL EQUIPMENT MAINT FACILITY (TEMF)" and 22 "GENERAL PURPOSE WAREHOUSE". In all, 262
  rows share a name with another row, and only the building number tells them apart.
- **Rows that are not facilities.**
  - **ITEM** is a row counter.
  - **CATCODE** is a 5-digit number cell, such as 72111.
  - **Section and total rows:** zone section rows, 6 zone subtotals and the grand total.
  - **Notes sheet:** the "SERVICES PER YEAR" values (365, 250, ...).
- **8 NOT IN SCOPE rows.** Each still prints its SF, with frequency `N/A`:
  - 10804 WWII wood admin building (vacant)
  - 10807 AAFES shoppette
  - 10813 NAF bowling center
  - 21917 rolling-pin barracks (demolished)
  - 31839 UEPH barracks (under renovation)
  - 40133 warehouse (demolished)
  - 50042 hangar (transferred to ARNG)
  - 93101 RANGE 31 latrine (range closed)

  Subtotals and totals already leave these out.
- **Building number forms.**
  - Suffixed storage annexes, such as `20150A` next to TEMF `20150`, are text cells.
  - Relocatable buildings use `T`-prefixed numbers, such as `T32001`.
  - All other building numbers are numeric cells.
- **Cleanable well below gross.**
  - UEPH barracks: common areas only (note 2).
  - TEMFs: admin, break and latrine areas only (note 3).
  - Hangars, shops and warehouses: office and latrine areas.
  - DFACs: the kitchen is serviced by the food service contractor.
  - Fire stations: the apparatus bay and quarters are excluded.
- **Frequency codes.** The codes must be mapped through the Notes sheet: `BI-WKLY` → biweekly, `1X/MO` → monthly,
  `QTRLY` → quarterly.
- **Grounds.**
  - The merged category header must be read correctly, and a dash means zero.
  - Three NOT IN SCOPE areas must be skipped. IA-1 alone is 18,884.92 AC unimproved.
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
  unimproved grounds. It excludes the golf course, cemetery, airfield and some MWR areas, which is the basis for the
  NOT IN SCOPE golf course row:
  https://app.g2xchange.com/opportunities/sam/7c36ee60-7ed0-4dec-bdae-6eba76a41dce
- The improved and semi-improved definitions are paraphrased from
  https://www.patrick.spaceforce.mil/Portals/14/AFD-150612-026.pdf

### Made up

- the installation, the solicitation number and the attachment number;
- every building number, name, area, floor count, fixture count, frequency, remark and acreage;
- the zone and training-area layout.

The column layout follows common Army Technical Exhibit practice and the other workbook fixtures here, not a specific
public document.
