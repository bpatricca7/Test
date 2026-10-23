# univ-custodial-inline-pdf

Community-college custodial RFP (`RFP #27-04`, "Lakeridge State College") delivered as one 7-page PDF
with a text layer. The buildings to price are in an inline table (Table 2-1, "List of Buildings to be used
for Billing Purposes"), grouped by campus, with campus subtotal rows and a grand total. The document also has
the parts a real Florida College System RFP carries: a purchasing contact, proposal format and evaluation
points (Section 3), insurance and background-screening requirements (Section 4), and a price proposal form
on its own page (Section 5).

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

An independent verification search re-confirmed LTB 127,050 and CPS/ITB 101,488 in the RFP #16-03
billing list. The other rows could not be re-checked from search excerpts.

**Why the college has a different name.** Because those rows are copied, anyone who knows Polk State will
recognise the package: the building codes, the Winter Haven and Lakeland campuses, the JD Alexander and Lake
Wales Arts centers. The name "Lakeridge State College" does not hide that. It is a stand-in so that the
invented parts of the package are not presented as Polk State's real data. Those invented parts are the
other 18 buildings, every floor, APPA level and days-of-service value, and the contract history with its
dollar figures. For the same reason:

- Invented buildings get generic names. An earlier version gave invented square footage to two real Polk
  State centers (Airside Center and Clear Springs Advanced Technology Center). They are now "Flightline
  Aviation Center" and "Bartow Advanced Manufacturing Center".
- Every street address is invented.
- The purchasing contact is fictional and uses a 555 telephone number.

**Made up for this fixture:**

- the college name, the solicitation number and the purchasing contact
- all street addresses
- the other 18 buildings and their square footage
- every floor count, APPA level and days-of-service value
- the hours narrative and the excluded-facility list
- the wording of Sections 3-4
- the current contract: Meridian Building Care, Inc., Contract No. LSC-22-117, awarded April 2022 for
  July 1, 2022 – June 30, 2027, annual amount $2,186,400

Sections 3-4 cite the requirements a Florida college RFP normally carries:

- the Public Entity Crimes statement, s. 287.133, F.S.
- the E-Verify affidavit, s. 448.095, F.S.
- Jessica Lunsford Act screening for the building that houses a collegiate high school, s. 1012.465, F.S.
- Level 2 screening for the child development center, Chapter 435, F.S.
- the 72-hour bid protest window, s. 120.57(3), F.S.
- the Florida minimum wage, $15.00 per hour from September 30, 2026

The APPA-level column follows UAFS AX-24-003 Appendix 1, and the price-per-SF form follows UCA RFP
UCA-23-033.

Rough economics, as a sanity check: $2,186,400 / 880,522 GSF is about $2.48 per GSF per year, or $0.207
per SF per month. The app's top-down defaults back that into roughly 30-33 FTEs, about 27,000-29,000 GSF per FTE,
which fits a mostly APPA Level 2 scope.

## Expected answers

- **29 facilities** (`facilitiesComplete: true`). Building numbers are the codes shown in the name cell
  (WAD, WCH, …, CPS/ITB). The two modular groups and the six centers have no code.
- **Service levels.** Days of service map as follows: M–F → `daily_5`, 7 days → `daily_7`,
  M/W/F → `3x_week`, T/Th → `2x_week`, 1x/wk → `weekly`. M–Sa (six days) has no exact level, so truth
  leaves it out.
- **Site.**
  - 5 contract years (3-year base plus two 1-year options).
  - Climate `hot_humid` (central Florida).
  - Installation "Lakeridge State College", solicitation "RFP #27-04".
- **Prior award.**
  - Annual value $2,186,400. Section 1.3 states this as "the current annual contract amount", so it is
    an annual value, not spend to date.
  - Incumbent Meridian Building Care, Inc., contract LSC-22-117, awarded 2022.
  - No total contract value is stated, so `totalValue` and `periodMonths` are not asserted.
- No grounds and no dining.

## Traps

1. **Subtotal and total rows.** The Winter Haven (440,633), Lakeland (336,849) and Centers (103,040)
   subtotals and the GRAND TOTAL (880,522) are not buildings. The Section 5 price form repeats all four.
2. **Campus header rows** span the whole table and include street addresses.
3. **TBD square footage.** WSC – Science Center (Renovation) shows "TBD – see Addendum" and is left out of
   the subtotal (footnote 3). It is **excluded** from the expected facilities, so a reader that guesses
   its square footage is counted as an extra.
4. **Codes inside the name cell**, in three styles:
   - en dash: "WAD – …"
   - parentheses: "Chain of Lakes (COL)"
   - slash: "CPS/ITB – …"
5. **Wrapped names.** CPS/ITB, WFO and Flightline Aviation Center wrap to two lines in the Building
   column.
6. **Grouped rows.** Each modular-building group is one billing line. Section 2.3.3 says the groups are
   billed as one line and individual modules are not listed or priced separately. The per-module sizes it
   gives are for information only and must not become extra facilities.
7. **Excluded facilities** are named in prose: WPE (demolished), LCH (cleaned by the school board) and
   WEP (energy plant).
8. **Two-row header.** "Cleaning" spans the APPA Level and Days of Service columns, and the APPA column
   (1/2/3) sits next to Floors.
9. **Prior award in prose.**
   - The paragraph gives the annual amount and the monthly amount ($182,200). The monthly figure is not
     the annual value.
   - It also states the prior 3+2 term, which is not the new contract's term.
   - Hourly event rates and event hours are not part of the award.
10. **Distractor numbers.** None of these are facilities or award values:
    - evaluation points (25/20/15/5/35, total 100)
    - insurance limits ($1,000,000 / $2,000,000 / $500,000 / $100,000)
    - the $15.00 minimum wage
    - the 250,000 SF reference-account threshold
11. **Running header and footnote markers.** The header "Lakeridge State College – Purchasing Department |
    RFP #27-04 Custodial Services | Issued October 5, 2026" repeats on every page. Footnote markers sit on
    the table header text. A plain text layer (pdftotext) glues them on ("Footage1", "Level2",
    "Addendum3"). The app's layout reader marks them as `[^1]`, `[^2]`, `[^3]`.
