# rpi-export-mixed-units-xlsx

Army facility-support solicitation `W9124Q-27-R-0058` (custodial and grounds maintenance) for the fictional
**Fort Tolland**. Section J **Attachment J-2** is an unedited real property inventory (RPI) extract from GFEBS,
delivered with a one-page cover memorandum that says which records are in scope.

| input | renders to | content |
|---|---|---|
| `cover-memo.html` | `build/W9124Q-27-R-0058 Att J-2 Cover Memo - RPI Extract Scope.pdf` | DPW Real Property Branch memo. Lists units of measure, a scope table by record type / CATCODE / unit, the status rule (only ACTIVE), and notes on FLOORS, RPUID and dropped leading zeros |
| `rpi-extract.json` | `build/W9124Q-27-R-0058 Att J-2 RPI Extract Fort Tolland 30SEP2026.xlsx` | one sheet `RPI_EXTRACT_20260930`: header row, 89 records sorted by facility number, and a trailer row `*** END OF REPORT - 89 RECORDS ***` |

Workbook columns are `RPUID | FACILITY_NUMBER | FACILITY_NAME | CATCODE | CATCODE_TITLE | PRIMARY_UM | TOTAL_UM_QTY |
FLOORS | FAC_STATUS`. TOTAL_UM_QTY is formatted `#,##0.00`.

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
- **Units.**
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
  - all CATCODE assignments and abbreviated titles other than the three confirmed above;
  - every floor count and status.

  I found no public GFEBS export with exactly these column names. The names follow the task brief and the DD 1354
  fields.

## Expected answers

- **48 facilities** (`facilitiesComplete: true`): every `PRIMARY_UM = SF` row with `FAC_STATUS = ACTIVE`. Total gross
  area is 946,200 SF. Floors are given for all but 02221 (blank cell). Category is given where the CATCODE title is
  unambiguous.
- **Grounds**, in the document's units:
  - Parking: 98,810 SY over 8 rows (CATCODE 85210/85215, ACTIVE). Rows named "… BLDG 0xxxx" carry that building
    number.
  - Improved turf: 77.37 AC (GR001–GR003).
  - Semi-improved: 102.58 AC (GR010, GR011).
- **Site:** installation "Fort Tolland", solicitation "W9124Q-27-R-0058".

## Traps

1. **Mixed units in one quantity column.** SF, SY, AC, LF, EA, KW, GA and MB all share TOTAL_UM_QTY. Only SF rows are
   facilities.
2. **Status filter.** Five SF building rows are DISPOSED or CLOSED and are excluded: 00130, 00132, 1115, 02207, T0230.
   The same applies to parking PK130 (CLOSED) and improved grounds GR004 (DISPOSED).
3. **Square-yard rows that are not parking.** Roads (85110/85120: 5 rows, 126,050 SY) and the vehicle wash platform
   (21470) are out of scope per the memo. Only 85210/85215 rows are parking.
4. **Acre rows that are out of scope.** Unimproved grounds and training lands (93230: 8,640 AC and 1,215.75 AC) are
   excluded by the memo. Adding every AC row would overstate grounds by 9,855.75 acres.
5. **Large non-building quantities.** Fences (LF) and utilities (a 7,500 KW substation, a 500,000 GA tank, 58,200 LF
   of water main, 142 EA hydrants, 24,500 MB heating plant) must not become facilities or grounds.
6. **Scope lives in a separate file.** The rules are only in the memo PDF; the workbook has no scope column.
7. **Facility number cell types.** FACILITY_NUMBER mixes text with leading zeros ("00101", "T0230") and numeric cells
   that lost them (1101–1125). The memo says 1101 is 01101. Truth uses the exported value.
8. **Numbers that are not quantities.** RPUID (7 digits) and CATCODE (5 digits) are numeric but are not quantities.
9. **Same names, different facilities.**
   - 1101/1103/1105 are three UEPH barracks of 58,750 SF each.
   - 02205 (ACTIVE) and 02207 (CLOSED) are both "GENERAL PURPOSE WAREHOUSE". The facility number decides.
10. **Trailer row.** `*** END OF REPORT - 89 RECORDS ***` is not a record.
11. **Building references in the memo text.** "1200 KNOX AVENUE, BUILDING 00103" and "01101" are references, not new
    facilities.
