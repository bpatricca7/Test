# multi-file-package

This fixture is a county janitorial solicitation as a bidder downloads it from a county e-procurement portal:
**three separate files**, uploaded together. The issuer is "Coquina County, Florida", a fictional Gulf-coast county,
and the solicitation is `ITB 27-014 Janitorial Services – County Facilities`. The base ITB carries only a summary by
Group. The facility rows are in a separate Excel attachment. A later addendum changes six of those rows and states that
"A revised Excel workbook will not be posted."

| # | Built file (`build/`) | Source | Format | Content |
|---|---|---|---|---|
| 1 | `ITB 27-014 Janitorial Services - County Facilities.pdf` | `itb-27-014-janitorial.html` | PDF, 7 pp, text layer | The Invitation to Bid as issued October 5, 2026 |
| 2 | `ITB 27-014 Attachment A - Facility List and Service Schedule.xlsx` | `attachment-a-facility-list.json` | XLSX, 2 tabs | **Attachment A**, the facility list and the periodic floor-care quantities |
| 3 | `ITB 27-014 Addendum No. 1.pdf` | `addendum-01.html` | PDF, 3 pp, text layer | Addendum No. 1 (October 28, 2026): row changes, revised totals, Q&A |

### Page and sheet map

| File | Page / tab | Content |
|---|---|---|
| ITB | 1 | Cover: key dates (mandatory pre-bid, site visits by Group, bids due November 12, 2026, start February 1, 2027), Procurement Agent, list of solicitation documents ("Attachment A ... posted as a separate Microsoft Excel workbook with two tabs") |
| ITB | 2 | Section 1, General Information: purpose, **1.2 current contract** (incumbent, contract number, award date, 3 + 1 + 1 term), **1.3 term** (3 years + two 1-year renewals), pre-bid conference, questions and addenda, award by Group, submission |
| ITB | 3 | Section 2, Scope: 2.1 general; **2.2 included and excluded facilities**; **2.3 gross vs cleanable SF**, and additions and deletions; **2.4 service-day definitions** (table with "services per year") and the 10 County holidays |
| ITB | 4 | 2.5 routine task table; 2.6 periodic services; 2.7 clinical areas; 2.8 County-furnished supplies; 2.9 Additional Services; **2.10 Option Items**; 2.11 hurricanes |
| ITB | 5 | **Section 3, Summary of Facilities by Group** (4 Groups, totals, and an Option row), plus Section 4 personnel: day porters, FDLE / CJIS screening, deductions |
| ITB | 6 | Section 5: insurance, invoicing, the public records clause, Florida statutory clauses, termination, transition |
| ITB | 7 | Attachment B, Bid Form: monthly price by Group × 36, unit price per cleanable SF, option items, hourly rates, addenda acknowledgment |
| XLSX | `Facility List` | 4 title / source rows, a two-row merged header (`SQUARE FEET` over `GROSS` / `CLEANABLE`), 4 merged Group banners, 31 facility rows, 4 Group subtotals, a grand total, an "OPTIONAL FACILITIES" block (O-1, O-2) and 6 merged NOTES rows. Columns: FAC. NO., FACILITY NAME, ADDRESS, FLOORS, GROSS, CLEANABLE, RESTROOMS, SERVICE DAYS, SERVICE WINDOW, REMARKS |
| XLSX | `Periodic Services` | Same 31 facilities, with carpet / hard / wood-gym SF (these add up to the cleanable SF), floor-care and glass frequencies per year, and a TOTAL row |
| Addendum | 1 | Letterhead, metadata box, the "This addendum is issued to modify ..." statement, acknowledgment requirement. **Item 1** is a Was / Is changed to table for 101, 202, 208, 403, 309 (deleted) and 210 (added), followed by the complete new row for 210 |
| Addendum | 2 | **Item 2**, periodic-tab changes; **Item 3**, revised Group totals (Was / Is); Item 4, Option O-2 date; Item 5, pre-bid attendees; Item 6, Q&A Q1–Q4 |
| Addendum | 3 | Running header, Q&A Q5–Q13, the issuer's signature, and the acknowledgment block |

Render (from the repository root):

```bash
node scripts/render-fixtures.mjs tests/holdout-b3/multi-file-package
```

`gen.mjs` holds the one data table that the workbook rows, the Group subtotals in the ITB, the addendum Was/Is tables
and the expected facilities come from. Run `node gen.mjs` to rewrite `attachment-a-facility-list.json` and print the
totals and the expected facility list. The ITB and addendum HTML are written by hand. If you change a value, update every
place it appears: the workbook (via `gen.mjs`), ITB Section 3, addendum Items 1–3 and Q4/Q9, and `truth.json`.

## Provenance (fidelity: real-format)

Everything in the fixture is made up and no rows were copied. That covers the county, place names, addresses, areas,
schedules, the solicitation, the incumbent (Gulfview Facility Services, Inc., Contract No. C21-0457) and its
expenditures. The package structure and wording follow the real solicitations below.

**How the sources were read.** During authoring, WebFetch could not resolve any host, and the network proxy refused
direct downloads (HTTP 403). Every detail below therefore comes from the **WebSearch result excerpts** of these
documents, not from reading the full files. The Florida statutory clauses in ITB Section 5 come from the author's
knowledge and were not re-verified: ss. 287.133, 287.135, 448.095, 787.06(13) and 119.0701, and the Local Government
Prompt Payment Act. None of them affects an expected value.

| Source | What the fixture takes from it |
|---|---|
| [Jefferson County, TX RFP 23-052/MR Addendum No. 1](https://jeffersoncountytx.gov/blobs/purchasing/nfb/ADD/236.pdf) | Cost form that gives each location its square feet ("Square feet: 115,490"), floors, elevators and service days, priced per visit × 52. Model for the per-facility FLOORS / SQUARE FEET / SERVICE DAYS / SERVICE WINDOW columns |
| [Jefferson County, TX RFP 23-052/MR Addendum No. 2](https://jeffersoncountytx.gov/blobs/purchasing/nfb/ADD/239.pdf) | Q&A answers that cite RFP section numbers. Model for the addendum Q&A citing ITB sections and Attachment A notes |
| [Jefferson County, TX IFB 10-001/KJS specs](https://jeffersoncountytx.gov/purchasing/Bid_Notices/20100413_IFB%2010-001KJS_Janitorial-Specs.pdf) | Service hours stated per building ("Monday to Friday, 5:30 pm to midnight"). Model for SERVICE WINDOW |
| [Loudoun County, VA IFB RFQ 4752](https://www.loudoun.gov/DocumentCenter/View/131408/RFQ-4752) and [RFQ 4753](https://loudoun.gov/DocumentCenter/View/131897/RFQ-4753?bidId=) | Exhibit A schedule by facility; gross SF "currently occupied" given with a separate cleanable figure. Model for the paired GROSS / CLEANABLE columns |
| [Bay County BOCC, FL ITB 21-13](https://baycountyfl.gov/DocumentCenter/View/6654/21-13-Janitorial-Services) | Florida county ITB structure: bid checklist, Attachment 1 required forms, Attachment 2 scope, and a bid form with facility, address, cleaning schedule ("Monday thru Friday, after 5:00 PM"), size in SF and monthly price |
| [Polk County, FL Bid 24-610 package](https://www.polkfl.gov/wp-content/uploads/2024/08/Bid-24-610-Bid-Package.pdf), [Addendum 6](https://www.polkfl.gov/wp-content/uploads/2024/08/Bid-24-610-Addendum-6.pdf), [site-visit attendance](https://www.polkfl.gov/wp-content/uploads/2024/08/Bid-24-610-Day-2-Site-Visits-Attendance.pdf) | Janitorial bid split into Groups A/B/C, with award "by individual item, group of items"; site visits by facility; attendance list. Model for the four Groups, award by Group, site-visit days and addendum Item 5 |
| [Lauderdale County, MS Bid 3975 Addendum No. 1](https://lauderdalecounty.org/wp-content/uploads/2024/03/BID-3975-BID-ADDENDUM-NO.-1_-Additional-Building-Added.pdf) | Addendum adds a building ("The number of buildings for bid increased from three (3) to four (4)") with its address block; Tuesday & Thursday schedules. Model for adding Facility 210 by addendum |
| [Ogden City, UT Janitorial RFP Addendum 1](https://events.ogdencity.com/DocumentCenter/View/35730/ADDENDUM-1-RFP---JANITORIAL-AND-WINDOW-CLEANING-SERVICES_FINAL-10-23-2025) | Opening statement ("This addendum is issued to modify the previously released solicitation documents and/or given for informational purposes"); revised proposal sheets with one schedule removed. Model for deleting Facility 309 |
| [Missouri OA FMDC RFQ FMDC20-0013](https://archive.oa.mo.gov/fmdc/facilitiesoperations/rfq/FMDC20-0013_rfq.pdf) | "janitorial services for the cleanable square feet of the buildings"; the agency "may add or delete areas", which changes the cleanable footage. Model for ITB 2.3 |
| [Buncombe County, NC Addendum 1](https://www.buncombecounty.org/common/purchasing/Addendum%201%20Janitorial%20Services.pdf) | Q&A: square footage "not relevant" for the animal shelter because only specific areas are cleaned. Model for 304 Animal Services and the other partly serviced buildings |
| [State of Alaska janitorial amendment](https://aws.state.ak.us/OnlinePublicNotices/Notices/Attachment.aspx?id=141274) | Q&A giving gross (287,850) and usable (169,800) SF for one building. Model for addendum Q1 |
| [City of Melissa, TX janitorial RFP](https://www.cityofmelissa.com/DocumentCenter/View/1838/RFP-Janitorial-Services---City-of-Melissa?bidId=) | Five-days and two-days-per-week facilities, with "at least one day in between" two-day cleanings. Source of the Tue & Thu definition in ITB 2.4 |
| [Maryland DGS, Janitorial Services for the Annapolis Complex and Crownsville](https://www.highergov.com/sl/contract-opportunity/md-janitorial-services-for-the-annapolis-co-65557431/) | 16 State facilities, State-provided supplies, three-year base with two one-year renewals. Model for the 3 + 1 + 1 term and County-furnished paper products |
| [Michigan DTMB Statewide Janitorial Standards](https://www.michigan.gov/documents/dtmb/Statewide_Janitorial_Standards_OVER_500_square_feet-_Lease_715017_7.pdf) | Task-by-frequency grid and building forms with SF by floor type and number of restrooms. Model for the ITB 2.5 task table, the Periodic Services tab and the RESTROOMS (rooms) column |

Known remaining tells:

- The e-mail domain (`coquinacountyfl.example.org`) and the (352) 555- phone numbers are placeholders, on purpose.
- The ITB is 7 pages. Real county ITBs run 30–60 and include the full required-forms packet; here Attachment C is
  "posted separately".
- The XLSX is rendered with the repo's generic writer: every column is the same width, nothing wraps, and blank cells
  hold empty strings. A real county workbook would have hand-set widths and wrapped text.
- All figures reconcile exactly: workbook subtotals and totals, ITB Section 3, addendum Item 3, and the Periodic
  Services areas, which sum to cleanable SF.

**Independent review (October 23, 2026).** A second agent read the three rendered files without truth.json, listed
31 facilities after Addendum No. 1 and compared them with `expect` field by field (number, name, gross, cleanable,
floors, service level): no differences. It also re-checked every subtotal, total, Item 3 figure and Periodic Services
row sum, and the prior award. It made these changes:
- Addendum Q5 was missing its question mark.
- Addendum page 3 had no running header. Q5–Q13 now start page 3 under the same header as page 2, and the page map
  above was updated.
- Two trap descriptions in truth.json were corrected. Mon-Sat covers four libraries, not five. "24" is hours, not days.

No expected value changed. WebFetch still could not resolve any host during the review, so realism was checked
against WebSearch excerpts. Real county addenda (Lincoln NE 121776 O5, Prince William County SA 2508, Alaska ITB
amendments) revise facility-stat sheets and give cleanable SF by floor type, as this fixture does.

## Expected answers

**31 facilities, 819,950 gross SF and 607,815 cleanable SF** (`facilitiesComplete: true`). These are the 31 workbook
rows with Addendum No. 1 applied:

| Change | Where | Workbook value | Truth |
|---|---|---|---|
| 101 County Administration Building | Addendum Item 1.1 (re-measured after the 4th-floor renovation) | 86,400 / 71,250 | **88,880 / 73,635** |
| 202 Westshore Branch Library | Addendum Item 1.2 (2025 meeting-room addition) | 14,250 / 12,960 | **15,870 / 14,410** |
| 208 UF/IFAS Extension Office and Auditorium | Addendum Item 1.3 | M/W/F (`3x_week`) | **Mon-Fri (`daily_5`)** |
| 403 Clerk of Court Records Center | Addendum Item 1.4 | Bi-weekly (Wed) (`biweekly`) | **Weekly (Wed) (`weekly`)** |
| 309 Mosquito Control Office | Addendum Item 1.5 and Q5: "deleted from the ITB in its entirety" | 4,860 / 3,920, Weekly | **not expected** |
| 210 Veterans and Human Services Office | Addendum Item 1.6 (new Group B row, only in the addendum) | n/a | **added**: 1 floor, 7,920 / 7,140, Mon-Fri |

- **Building numbers** are the FAC. NO. values: 101–106, 201–210, 301–308, 310, and 401–406.
- **Areas.** `grossSqft` is GROSS and `cleanableSqft` is CLEANABLE, for every row. ITB 2.3, Note 1 and Q1 say pricing is
  on cleanable.
- **Floors** come from the FLOORS column. Q4 says the Judicial Center's 5 floors include the basement.
- **Service levels:**
  - `Mon-Fri` → `daily_5`
  - `Mon-Sat` → `daily_6` (201, 202, 203, 205, 207, 304)
  - `Tue-Sat` → `daily_5` (204; five services a week per ITB 2.4 and Q7)
  - `7 days` → `daily_7` (301, 303, 404, 405)
  - `M/W/F` → `3x_week` (103, 302, 306, 402)
  - `Tue & Thu` → `2x_week` (307)
  - `Sat & Sun` → `2x_week` (406)
  - `Weekly (Wed)` → `weekly` (403, after the addendum)
- **Categories** are given only where a building's function maps to a category without judgment:
  - `admin`: 101, 104, 210, 301, 305, 308, 401 (offices and administration buildings)
  - `community`: 206, 207, 402 (senior center and community centers)
  - `medical`: 209 (Health Department clinic)
  - `maintenance`: 306 (fleet shop)

  The rest are left out on purpose: the courthouse buildings, libraries, Elections, EOC, 911, Animal Services, scale
  house, Records Center and park restrooms.
- **Not given:**
  - `restroomFixtures`: the RESTROOMS column counts rooms (Note 3, Q3).
  - `dining`: none applies.
- **Not expected:**
  - Option facilities O-1 and O-2. They are option-only (ITB 2.10, Note 5, Item 4, Q6).
  - Narrative exclusions (ITB 2.2, Note 6): Detention Facility, Fire Rescue stations, Civic Center, Airport terminal.
- **Grounds: `[]`.** Exterior work is limited to litter within 25 feet of entrances and emptying entrance receptacles.
  No grounds areas or quantities are given.
- **Site.**
  - `contractYears` 5: 3 years plus two 1-year renewals (ITB 1.3).
  - `climateZone` `hot_humid`: Florida Gulf coast.
  - `installationName` "Coquina County".
  - `solicitation` "ITB 27-014".
- **Prior award:**
  - Incumbent Gulfview Facility Services, Inc.
  - Contract No. C21-0457, awarded December 14, 2021 (ITB 1.2)
  - `annualValue` 1,146,820 for FY 2025-26 (Q2)
  - `spendToDate` 4,968,515.40 over 56 months, February 1, 2022 – September 30, 2026 (Q2)
  - `totalValue` and `periodMonths` are left out on purpose. No total contract value is stated, and the incumbent's
    60-month term (3 + 1 + 1) is not paired with any amount.

## Traps

1. **Three files, read together.** The rows are only in the XLSX, the corrections are only in the addendum PDF, and the
   ITB has only Group totals. The base files never mention what the addendum changes.
2. **Addendum supersedes.** It re-measures 101 and 202, deletes 309, adds 210 (the row exists only in the addendum),
   and changes the frequencies at 208 and 403. Item 3 restates every Group total (A, B and C change; D does not). The
   Section 3 table and the workbook subtotals still show the original values.
3. **Gross vs cleanable.** Both columns are under one merged header. Four buildings are serviced only in part, so
   cleanable is far below gross:

   | Bldg | Gross / cleanable | Excluded area |
   |---|---|---|
   | 105 | 38,200 / 9,860 | ballot warehouse |
   | 304 | 26,500 / 5,180 | kennels |
   | 306 | 32,800 / 4,950 | shop bays |
   | 403 | 19,800 / 3,450 | records stacks |
4. **Workbook structure:**
   - title and source rows above a two-row merged header
   - merged Group banner rows
   - 4 subtotals and a grand total
   - an OPTIONAL FACILITIES block below the total
   - six merged NOTES rows

   FAC. NO. cells are numbers, and areas are numbers formatted `#,##0`.
5. **Option facilities** O-1 and O-2 have full rows with areas and service days, but they are not in scope. Addendum
   Item 4 changes O-2's date without adding it.
6. **Second tab, Periodic Services**, repeats every facility, including deleted 309. It gives carpet, hard and wood SF
   (portions of cleanable) and times per year, plus a TOTAL row. These are not facilities and not extra area.
7. **Service-day wording.** `Tue-Sat` is five days (`daily_5`, not `daily_6`). `Sat & Sun` is `2x_week`. The ITB 2.4
   "services per year" numbers are definitions, not facility data.
8. **Extras that are not service levels:**
   - day porters, written inside 102's SERVICE WINDOW cell
   - 404's second summer service
   - cleaning the BOCC Chambers after meetings
   - EOC activations and the elections warehouse, both Additional Services
9. **RESTROOMS counts rooms, not fixtures** (Note 3, Q3).
10. **Exclusions appear only in prose** (ITB 2.2, Note 6), and excluded areas are named in Remarks with their own SF:
    "Ballot warehouse (28,340 SF)" and "Gymnasium wood floor (7,200 SF)". The 7,200 SF gym floor is part of 207's
    cleanable area (Q9).
11. **Numbers that are not facility data:**
    - "approximately 813,000 gross square feet" and the 100,000 SF threshold for reference contracts
    - insurance limits and deductions
    - statute numbers
    - the 10 holidays, 36 months and 5 percent
    - Bid Form line items
12. **Prior award split across files.** The ITB gives the incumbent, the contract number and the award date. The
    addendum Q&A gives the FY spend and the spend to date. In the ITB text layer the contract number wraps at its hyphen
    ("C21-" / "0457"); the addendum prints it on one line.
13. **Contract term distractor.** The new term is 3 + 1 + 1 = 5 years. The incumbent's own 3 + 1 + 1 term appears next
    to it in ITB 1.2.
14. **Long names** contain en dashes and parentheses, and long Remarks or Service Window text sits next to the numbers.
