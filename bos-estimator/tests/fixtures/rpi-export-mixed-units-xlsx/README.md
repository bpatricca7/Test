# rpi-export-mixed-units-xlsx

Army facility-support solicitation `W9124Q-27-R-0058` (custodial and grounds maintenance) for the fictional
**Fort Tolland**. Section J **Attachment J-2** is an unedited real property inventory (RPI) extract from GFEBS,
delivered with a one-page cover memorandum that says which records are in scope.

| input | renders to | content |
|---|---|---|
| `cover-memo.html` | `build/W9124Q-27-R-0058 Att J-2 Cover Memo - RPI Extract Scope.pdf` | DPW Real Property Branch memo, routed THRU the contracting officer FOR prospective offerors and incorporated in Section J. Defines RPA types and units of measure, has a scope table by RPA type / CATCODE / unit, the status rule (only ACTIVE), and notes on FLOORS, YEAR_BUILT, RPUID and dropped leading zeros |
| `rpi-extract.json` | `build/W9124Q-27-R-0058 Att J-2 RPI Extract Fort Tolland 30SEP2026.xlsx` | one sheet `RPI_EXTRACT_20260930`: header row, 89 records sorted by facility number, and a trailer row `*** END OF REPORT - 89 RECORDS ***` |

Workbook columns are `RPUID | FACILITY_NUMBER | FACILITY_NAME | RPA_TYPE | CATCODE | CATCODE_TITLE | PRIMARY_UM |
TOTAL_UM_QTY | FLOORS | YEAR_BUILT | FAC_STATUS`. TOTAL_UM_QTY is formatted `#,##0.00`. RPA_TYPE is BUILDING,
STRUCTURE, LINEAR STRUCTURE or LAND. CATCODE and RPUID are numeric in the source JSON as well as in the workbook, so
the cell types do not depend on the renderer's number coercion.

The workbook keeps the renderer's defaults: every column is 16 characters wide, the header is not bold, and there
are no frozen panes or autofilter. Long names (for example "NON-ORGANIZATIONAL VEHICLE PARKING, SURFACED") look
cut off in Excel because the next cell is not empty, but the cell values are complete. A raw report export
usually looks like this.

```bash
node scripts/render-fixtures.mjs tests/fixtures/rpi-export-mixed-units-xlsx
npx tsx scripts/eval.ts tests/fixtures/rpi-export-mixed-units-xlsx
```

## Provenance (fidelity: real-format)

The column set and unit codes follow real DoD records. Every value is made up.

- **Column set.** The facility number, CATCODE, primary unit of measure and quantity per real property record follow
  DD Form 1354 (https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1354.pdf) and DoDI 4165.14
  (https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodi/416514p.pdf). DoDI 4165.14 lists facility number
  and RPA total UM quantity/code among the validated asset fields.
- **Asset types and units.**
  - RPA_TYPE uses the four DoD real property asset types (building, structure, linear structure, land). The KV
    (kilovolt-ampere) unit for the substation and KW for the standby generator follow DoD unit-of-measure
    practice. Both come from memory: I could not check them in this session because the web search budget was
    used up.
  - "AC" is the required total unit of measure for land: DoD BEA business rule,
    https://bea.osd.mil/bea11.2/reports/definitions1_businessrule_172534.htm
  - SY for 85210 organizational vehicle parking, the 72111 UEPH and 72210 dining titles, and the 851XX/852XX
    pavement series come from the USACE Army facilities unit-cost table:
    https://www.usace.army.mil/LinkClick.aspx?fileticket=bdnXSYCqMYI%3D&portalid=2
- **CATCODE system.** AR 415-28 and DA Pam 415-28 (memo reference b):
  https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/r415_28.pdf. NG Pam 210-20 describes RPLANS working from the
  RPI:
  https://www.ngbpmc.ng.mil/Portals/27/Publications/NGPAM/ngpam%20210-20.pdf?ver=oRUMEnfm1FpHJToG0Kuskg%3D%3D
- **Made up:**
  - the installation, solicitation number, office symbol, signer and phone number;
  - every RPUID, facility number, name and quantity;
  - all RPA type and CATCODE assignments, and the abbreviated titles other than the three confirmed above;
  - every floor count, year built and status.

  Non-building records use ordinary five-digit facility numbers (00191 parking, 08101 substation, 08501 road,
  08720 fence, 09301 grounds). Earlier versions used mnemonic numbers (PK101, RD001, GR001…), which gave the
  classification away.

  I found no public GFEBS export with exactly these column names. The names follow the task brief and the DD 1354
  fields.

## Expected answers

- **47 facilities** (`facilitiesComplete: true`): every `RPA_TYPE = BUILDING`, `PRIMARY_UM = SF` row with
  `FAC_STATUS = ACTIVE`. Total gross area is 940,200 SF. Every facility has its floor count.
  - 02221 COVERED STORAGE SHED (POLE BARN) is excluded. It is ACTIVE and recorded in SF (6,000), but it is a
    STRUCTURE, and memo paragraph 3 puts structures recorded in SF (open-sided covered storage sheds) out of
    scope.
  - Troop-area numbers are stored in the canonical form from memo paragraph 5 ("01101", not the exported "1101").
    The scorer strips leading zeros, so either form matches.
  - Category is given only where the CATCODE title maps to one category (34 facilities). Airfield operations
    (03303), training simulation (03307), the library (00122) and the post office (00137) have none, nor do fire,
    MP, access control, range, youth center, bathhouse and fuel point codes.
- **Grounds**, in the document's units:
  - Parking: 98,810 SY over 8 rows (CATCODE 85210/85215, ACTIVE). Rows named "… BLDG 0xxxx" carry that building
    number.
  - Improved turf: 77.37 AC (09301–09303).
  - Semi-improved: 102.58 AC (09310, 09311).
- **Site:** installation "Fort Tolland", solicitation "W9124Q-27-R-0058".

## Traps

1. **Mixed units in one quantity column.** SF, SY, AC, LF, EA, KV, KW, GA and MB all share TOTAL_UM_QTY. Only
   BUILDING rows in SF are facilities.
2. **An SF row that is not a building.** 02221 COVERED STORAGE SHED (POLE BARN) is ACTIVE and recorded as 6,000 SF,
   but RPA_TYPE is STRUCTURE and FLOORS is blank. A reader that keys on PRIMARY_UM = SF alone gets one facility
   and 6,000 SF too many.
3. **A building that is not in SF.** 08201 CENTRAL HEATING PLANT is a BUILDING with FLOORS 1, but its unit is MB
   (24,500 thousand BTU/h) and utility plant buildings are out of scope.
4. **Status filter.** Five SF building rows are DISPOSED or CLOSED and are excluded: 00130, 00132, 1115, 02207, T0230.
   The same applies to parking 00194 (CLOSED) and improved grounds 09304 (DISPOSED).
5. **Facility numbers do not reveal the asset type.** Parking lots (00191…), the wash platform (02295), utilities
   (081xx–084xx), roads (085xx), fences (087xx) and grounds (093xx) have ordinary five-digit numbers. RPA_TYPE,
   CATCODE and PRIMARY_UM decide.
6. **Square-yard rows that are not parking.** Roads (85110/85120: 5 rows, 126,050 SY) and the vehicle wash platform
   (21470) are out of scope per the memo. Only 85210/85215 rows are parking.
7. **Acre rows that are out of scope.** Unimproved grounds and training lands (93230: 8,640 AC and 1,215.75 AC) are
   excluded by the memo. Adding every AC row would overstate grounds by 9,855.75 acres.
8. **Large non-building quantities.** Fences (LF) and utilities (a 7,500 KV substation, a 500 KW generator, a
   500,000 GA tank, 58,200 LF of water main, 142 EA hydrants, 24,500 MB heating plant) must not become facilities
   or grounds.
9. **Scope lives in a separate file.** The rules are only in the memo PDF; the workbook has no scope column.
10. **Facility number cell types.** FACILITY_NUMBER mixes text with leading zeros ("00101", "T0230") and numeric
    cells that lost them (1101–1125, 1191, 1192). Memo paragraph 5 says 1101 through 1192 are 01101 through 01192,
    so truth uses "01101".
11. **Numbers that are not quantities.** RPUID (7 digits), CATCODE (5 digits) and YEAR_BUILT (4 digits, next to
    FLOORS) are numeric but are not quantities.
12. **Same names, different facilities.**
   - 1101/1103/1105 are three UEPH barracks of 58,750 SF each.
   - 02205 (ACTIVE) and 02207 (CLOSED) are both "GENERAL PURPOSE WAREHOUSE". The facility number decides.
13. **Trailer row.** `*** END OF REPORT - 89 RECORDS ***` is not a record.
14. **Building references in the memo text.** "1200 KNOX AVENUE, BUILDING 00103" and "01101" are references, not new
    facilities.
