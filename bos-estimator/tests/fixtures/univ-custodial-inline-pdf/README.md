# univ-custodial-inline-pdf

Community-college custodial RFP (`RFP #27-04`, fictional "Lakeridge State College") delivered as one
5-page PDF with a text layer. The buildings to price are in an inline table (Table 2-1, "List of
Buildings to be used for Billing Purposes"), grouped by campus, with campus subtotal rows and a grand total.

Render and score:

```bash
node scripts/render-fixtures.mjs tests/fixtures/univ-custodial-inline-pdf
npx tsx scripts/eval.ts tests/fixtures/univ-custodial-inline-pdf
```

## Provenance (fidelity: real-rows, partial)

The layout and wording follow **Polk State College RFP #16-03, Custodial Services** (2016) and its executed
contract. That RFP's Scope of Work has a "List of Buildings to be used for Billing Purposes" with codes
embedded in the name ("WAD – Administration") and an "Estimated Gross Square Footage" column. It also says
"Floor plans and a list of rooms and square footage of each room is available for review at the Purchasing
Department", prices per square foot per month x 12 by campus, and reduces the monthly payment for square
footage taken out of service.

- RFP: https://www.polk.edu/wp-content/uploads/RFP-16-03-Custodial-Services-REVISED-11-4-2016-FINAL.pdf
- Contract: https://www.polk.edu/wp-content/uploads/16-03-Custodial-Services-Contract-FINAL-.pdf

**Rows copied verbatim from those documents (name and gross SF), as seen in search excerpts:**

| Row | Gross SF |
|---|---:|
| WAD – Administration | 47,863 |
| WCH – Club House | 2,000 |
| WRH – Rehabilitative Health | 6,030 |
| Seven (7) Modular Buildings – Winter Haven Campus | 7,502 |
| Chain of Lakes (COL) | 14,540 |
| CPS/ITB – Center for Public Safety Immersive Training Building | 101,488 |
| LTB – Technology Building | 127,050 |
| LAC – Academic Center | 72,852 |
| Modular buildings LMA, LMB, LMC, LMD (Lakeland) | 7,752 |
| JD Alexander Center | 16,143 |
| Lake Wales Art(s) Center | 12,422 |

**Made up for this fixture:** the college name, the solicitation number, all street addresses, the other
18 buildings and their square footage, every floor count, APPA level and days-of-service value, the hours
narrative, the excluded-facility list, and the current contract (Meridian Building Care, Inc., Contract No.
LSC-21-117, awarded 2021, $2,186,400 for FY 2025-26). The college is fictional on purpose, so the made-up
contract figures can't be mistaken for Polk State's. The APPA-level column follows UAFS AX-24-003
Appendix 1, and the price-per-SF form follows UCA RFP UCA-23-033.

## Expected answers

- 29 facilities (`facilitiesComplete: true`). Building numbers are the codes shown in the name cell (WAD,
  WCH, …, CPS/ITB). The modular groups and the six centers have no code.
- Days of service map to service levels: M–F → `daily_5`, 7 days → `daily_7`, M/W/F → `3x_week`,
  T/Th → `2x_week`, 1x/wk → `weekly`. M–Sa (six days) has no exact level, so truth leaves it out.
- Site: 5 contract years (3-year base plus two 1-year options), `hot_humid` (central Florida),
  installation "Lakeridge State College", solicitation "RFP #27-04".
- Prior award: annual value $2,186,400, incumbent Meridian Building Care, Inc., contract LSC-21-117, awarded 2021.
- No grounds and no dining.

## Traps

1. **Subtotal and total rows.** The Winter Haven (440,633), Lakeland (336,849) and Centers (103,040)
   subtotals and the GRAND TOTAL (880,522) are not buildings. The Section 3 price form repeats all four.
2. **Campus header rows** span the whole table and include street addresses.
3. **TBD square footage.** WSC – Science Center (Renovation) shows "TBD – see Addendum" and is left out of
   the subtotal (footnote 3). It is **excluded** from the expected facilities, so a reader that guesses
   its square footage is counted as an extra.
4. **Codes inside the name cell**, in three styles: en dash ("WAD – …"), parentheses ("Chain of Lakes (COL)")
   and slash ("CPS/ITB – …").
5. **Wrapped names.** CPS/ITB and WFO wrap to two lines in the Building column.
6. **Grouped rows.** Each modular-building group is one billing line. The sizes of individual modules in
   Section 2.3.3 must not become extra facilities.
7. **Excluded facilities** are named in prose (WPE demolished, LCH cleaned by the school board, WEP energy
   plant).
8. **Two-row header.** "Cleaning" spans the APPA Level and Days of Service columns, and the APPA column
   (1/2/3) sits next to Floors.
9. **Prior award in prose.** Hourly event rates and event hours are not part of it.
10. **Running header** repeats on every page, and footnote markers are glued to numbers in the text layer
    ("Addendum3", "Footage1").
