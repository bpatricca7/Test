# usmc-messhall-food-service-pdf

This is a Marine Corps garrison food service solicitation attachment (`M67443-27-R-0019`) for the fictional "MCB Camp
Halloran" and "MCAS Pell River", North Carolina. It is one 10-page PDF with a text layer. The first eight pages are
Section J, **Attachment J-2, PWS Technical Exhibits**, issued 9 November 2026. They cover Full Food Service (FFS) and
Management and Mess Attendant (M&MA) halls, plus two satellite facilities, with the sanitation and custodial scope
inside each hall. The last two pages are **Amendment 0001** (18 December 2026), saved into the same file the way a
proposer would. The original pages never mention what the amendment changes.

| Page | Orientation | Content |
|---|---|---|
| 1 | portrait | Attachment header block, contents, Part 1: purpose, scope (FFS / M&MA / SAT), definitions (headcount, Midrats, brunch/supper, training schedule, field day) |
| 2 | portrait | 1.4 facilities not included, **Part 2 basis of estimates** (52 typical weeks: 5+2, 5+1, 5+0), Part 3 period of performance and **current contract**, abbreviations |
| 3 | landscape | **TE-1 Mess Hall Facility Data (1 of 2)**: 13 columns, three-row header, Items 1–11 |
| 4 | landscape | TE-1 (2 of 2): Items 12–20, subtotals, total, notes 1–7 |
| 5 | landscape | TE-2 hours of operation (weekday B/L/D/Midrats; weekend Breakfast/Brunch/Lunch/Supper/Midrats) |
| 6 | landscape | **TE-3 Estimated Workload**: average headcount per meal period, Mon–Fri and Sat/Sun/holidays, weekly meals, total, notes |
| 7 | landscape | TE-3A optional line item projection (Bldg D-1720); TE-4 historical meals served FY24–FY26 (MCFMIS) |
| 8 | portrait | TE-5 sanitation and custodial tasks and frequencies; Government-performed work |
| 9 | portrait | **Amendment 0001 changes**: D-512 deleted, D-450 headcount revised, Bldg 227 SF corrected, revised totals |
| 10 | portrait | Amendment 0001 Q&A (satellites, TC-410, gross vs sanitation area, Midrats, W-133 Saturdays, contract value / invoiced to date, grounds, option) |

Render:

```bash
node tests/holdout-b2/usmc-messhall-food-service-pdf/gen.mjs      # regenerates the HTML and expect.facilities
node scripts/render-fixtures.mjs tests/holdout-b2/usmc-messhall-food-service-pdf
pdftotext -layout tests/holdout-b2/usmc-messhall-food-service-pdf/build/m67443-27-r-0019-att-j2.pdf - | less
```

## Provenance (fidelity: real-format)

Everything is made up. That includes the installation, its areas, the solicitation and contract numbers, the
incumbent, the building numbers, and every seat count, square footage, headcount, serving window, historical count
and dollar value. No rows are copied. The layout and wording follow real documents. The session's network proxy
allowed only S3-hosted files, so the Schriever PWS is the only source that was downloaded and read in full. The
Marine Corps sources were read through search-result excerpts only, because marines.mil, sam.gov, gao.gov and the
bid sites were blocked.

| Source | What the fixture takes from it |
|---|---|
| [Schriever AFB Full Food Service draft PWS, FA255020R0010 Att. 1](https://imlive.s3.amazonaws.com/Federal%20Government/ID294263761115844501071154752929531886007/DRAFT%20PWS_CDRLS.pdf) (read in full) | Appendix 1 "Hours of Operation": Meal / Weekday Hours / "Weekends, Holidays and Family Days", including Midnight 2300–0100. Appendix 2 "Workload Meal Estimates": "Average daily meal count for normal workweek (week days only)" per meal period including Midnight, a separate weekend/holiday count, and "Approximately 22,000 – 23,000 meals total served per month". Also weekly headcount data to the COR and the housekeeping tasks. These are the models for TE-2, the TE-3 weekday/weekend split, Midrats as a meal period, and the convenience weekly total. |
| [Camp Lejeune "RGFSC III CLNC MH Hours of Operation"](https://www.lejeune.marines.mil/Portals/27/Documents/G4/FSD/RGFSC-III-CLNC-MH-Hours-of-Operation.pdf) (excerpt) | Per-mess-hall weekday serving windows (breakfast 0600–0800, lunch 1100–1300), separate weekend windows (0630–0800, 1130–1300, 1630–1800), holidays on weekend hours, and a 2300–0100 midnight ration window (TE-2) |
| [Commander's Guidance for the CONUS Regional Garrison Food Service](https://www.lejeune.marines.mil/Portals/27/Documents/G4/FSD/COMMANDERS%20GUIDANCE%20FOR%20THE%20CONUS%20REGIONAL%20GARRISON%20-%20Final%203_10_2023.pdf?ver=DLdDNCV9hQ_bIONk1cb6Tg%3D%3D) (excerpt) | FFS vs M&MA mess halls, and "M&MA mess halls are designated to provide a training platform for Marine Food Service Specialists (MOS 3381)" (paragraph 1.2, TE-1 Svc Type) |
| [Regional Garrison Food Services IV sources sought (SAM.gov)](https://sam.gov/opp/6f3123416ba44a2cbe8480ef3834c2e3/view) (excerpt) | A multi-mess-hall garrison requirement: "year-round meal preparation, meal service, and facility management" |
| [MCB Hawaii Management and Mess Hall Attendant Services, M0031824R0003](https://www.bidnetdirect.com/public/supplier/solicitations/statewide/2524880752/abstract) (excerpt) | Anderson Hall plus "the Flight-Line satellite facility" as service locations (the AS-219 Flight Line Satellite) |
| [MARADMIN, FY26 MajGen W.P.T. Hill awards](https://www.marines.mil/News/Messages/Messages-Display/Article/4558339/fy26-major-general-william-pendleton-thompson-wpt-hill-memorial-awards-for-food/) (excerpt) | The "Full Food Service" / "Management and Mess Attendant" terminology |
| [CY 2025 Meal Rates message](https://www.quantico.marines.mil/Portals/147/Offices_and_Staff/G4/Food_Services/Meal_Rates/CY%202025%20Meal%20Rates%20(Message).pdf), [Base Food Service Memo 11-17](https://www.quantico.marines.mil/Portals/147/Offices_and_Staff/G4/Food_Services/Memos/BASE%20FOOD%20SERVICE%20MEMO%2011-17.pdf) (excerpts) | NAVMC 565-1 headcount report, the MCFMIS headcount tab and "Cash Meal Regular" (paragraphs 1.3 and 2.1, TE-3 source line) |
| [Camp Pendleton press release (2012)](https://www.pendleton.marines.mil/In-the-News/Press-Releases/Article/537679/mess-halls-to-offer-corps-birthday-meal) (excerpt) | Mess halls identified by building number (1365, 14036, 210802, "22 Temp Site") |
| [Camp Lejeune "messhall FC303" listing](https://www.restaurantji.com/nc/camp-lejeune/messhall-fc303-/) (excerpt) | Area-prefixed building numbers, and a hall closed Saturday and Sunday (TC-303, the M–F halls) |
| [Sodexo Food Service Manager 2 posting, Camp Lejeune](https://www.themuse.com/jobs/sodexo/food-service-manager-2-9d4b54) (excerpt) | "Mess Hall 227 feeds approximately 9,000–12,000 meals per week", "two separate service floors and two kitchens". This is the model for the weekly-meals figure and for the two-floor Mess Hall 227, whose area the amendment corrects. The fixture's 227 figures are made up. |
| [DVIDS, Camp Pendleton 14 Area Mess Hall](https://dvidshub.net/image/3466592/14-area-mess-hall) (excerpt) | A mess hall closed for renovation for two years while its diners ate elsewhere (TC-410) |
| [Whiteman AFB Mess Attendant PWS (2023)](https://www.waru.edu/sites/default/files/2024-01/Mess+Attendant+PWS+dtd+23+Feb+2023.pdf) (excerpt) | "estimated quantities of work are listed in Technical Exhibit 2, Workload Estimates" (the paragraph 1.1 disclaimer) |
| [MCO 10110.14N](https://www.marines.mil/Portals/1/Publications/MCO%2010110.14N.pdf) (excerpt) | The garrison mess hall policy setting. No wording copied. |

Known tells:

- The real Marine Corps sources were read only through search excerpts. The TE layout is a composite. It is not a
  copy of one USMC exhibit, because no USMC TE headcount table could be downloaded.
- Some Lejeune features (Mess Hall 227 with two floors, a weekday-only "303" hall) are borrowed onto the fictional
  base. All of the figures are invented.
- Every figure reconciles exactly, apart from the deliberate amendment corrections.

## Expected answers

- **17 facilities** (`facilitiesComplete: true`): 15 mess halls and 2 satellites. These are the TE-1 rows that have
  numeric (unparenthesized) figures, after Amendment 0001.
  - Excluded: TC-410 (closed for renovation), D-1720 (optional line item) and D-512 (deleted by Amendment Item 1).
  - `grossSqft` is TE-1 Column (8). `cleanableSqft` is Column (9), "Sanitation Area SF".
  - Bldg 227 takes the amended figures: **46,920 / 41,380**, not 23,460 / 20,690.
  - `floors` comes from Column (7). `category` is `dining` for all 17.
  - The sum is 452,615 GSF, which equals the Amendment Item 5 revised TE-1 total.
- **Service level** follows Days of Opn (Column 12), because TE-5 sanitation runs on each day of operation:
  - `7` is `daily_7`.
  - `M–F` is `daily_5`: 260, TC-303, SP-24 and AS-219.
  - `M–Sa` is `daily_6`: W-133, which is closed Sundays and holidays.
- **Dining.** No meals-per-day figure is printed. TE-3 gives the average headcount per meal period on a typical weekday
  and a typical weekend or holiday day. Paragraph 2.2 says to price 52 typical weeks: 5 + 2 days at seven-day halls,
  5 + 1 at W-133, and 5 + 0 at the M–F halls. So:
  - `mealsPerDay` = (5 × weekday total + weekend days × weekend total) ÷ days open per week, rounded to the nearest meal.
    For a weekday-only hall this is simply the weekday total.
  - `daysPerWeek` is 7, 6 or 5.
  - `mealPeriods` is the number of weekday meal periods served (B/L/D, plus Midrats where served).
  - This matches the convention in `shared/types.ts` (`DiningProfile`) and `shared/estimate.ts`
    (`diningMealsPerDay`). The printed "Est. Weekly Meals" column is the numerator.

| Bldg | Days | Mon–Fri B / L / D / Midrats = total | Sat/Sun/Hol (Brkfst / Brunch / Lunch / Supper / Midrats) = total | weekly ÷ days | mealsPerDay | periods |
|---|---|---|---|---|---:|---:|
| 211 | 7 | 385 / 760 / 410 / – = 1,555 | – / 330 / – / 270 / – = 600 | 8,975 ÷ 7 = 1,282.1 | 1,282 | 3 |
| 227 | 7 | 540 / 1,180 / 610 / 150 = 2,480 | – / 470 / – / 390 / 95 = 955 | 14,310 ÷ 7 = 2,044.3 | 2,044 | 4 |
| 260 | M–F | 140 / 365 / 120 / – = 625 | closed | 3,125 ÷ 5 = 625 | 625 | 3 |
| 408 | 7 | 310 / 645 / 355 / – = 1,310 | – / 285 / – / 230 / – = 515 | 7,580 ÷ 7 = 1,082.9 | 1,083 | 3 |
| 1104 | 7 | 470 / 980 / 540 / – = 1,990 | – / 420 / – / 345 / – = 765 | 11,480 ÷ 7 = 1,640 | 1,640 | 3 |
| TC-303 | M–F | 210 / 520 / 190 / – = 920 | closed | 4,600 ÷ 5 = 920 | 920 | 3 |
| TC-575 | 7 | 365 / 830 / 445 / – = 1,640 | – / 350 / – / 285 / – = 635 | 9,470 ÷ 7 = 1,352.9 | 1,353 | 3 |
| OB-160 | 7 | 190 / 415 / 215 / – = 820 | – / 160 / – / 125 / – = 285 | 4,670 ÷ 7 = 667.1 | 667 | 3 |
| W-48 | 7 | 255 / 470 / 280 / – = 1,005 | – / 230 / – / 180 / – = 410 | 5,845 ÷ 7 = 835 | 835 | 3 |
| W-133 | M–Sa | 340 / 690 / 395 / – = 1,425 | Saturday only: – / 260 / – / 195 / – = 455 | 7,580 ÷ 6 = 1,263.3 | 1,263 | 3 |
| D-301 | 7 | 480 / 505 / 495 / – = 1,480 | 455 / – / 470 / 460 / – = 1,385 | 10,170 ÷ 7 = 1,452.9 | 1,453 | 3 |
| D-450 (amended) | 7 | 845 / 905 / 870 / – = 2,620 | 810 / – / 830 / 815 / – = 2,455 | 18,010 ÷ 7 = 2,572.9 | 2,573 | 3 |
| D-615 | 7 | 175 / 340 / 190 / – = 705 | – / 150 / – / 120 / – = 270 | 4,065 ÷ 7 = 580.7 | 581 | 3 |
| SP-24 | M–F | 95 / N/S / 110 / – = 205 | closed | 1,025 ÷ 5 = 205 | 205 | 2 |
| AS-4150 | 7 | 330 / 815 / 400 / 210 = 1,755 | – / 290 / – / 240 / 140 = 670 | 10,115 ÷ 7 = 1,445 | 1,445 | 4 |
| AS-219 | M–F | – / 240 / – / 85 = 325 | closed | 1,625 ÷ 5 = 325 | 325 | 2 |
| AS-505 | 7 | 160 / 390 / 205 / – = 755 | – / 140 / – / 115 / – = 255 | 4,285 ÷ 7 = 612.1 | 612 | 3 |

  Service style cannot be expressed in `truth.json`, so it is not scored. FFS halls are `full_food_service`. M&MA halls
  (260, TC-303, D-615, AS-505) are closest to `dining_facility_attendant`, because Marine cooks prepare the food.
- **Site:**
  - 5 contract years: a 12-month base and four 12-month options. The phase-in and the FAR 52.217-8 extension are not
    contract years.
  - No climate zone is expected. The document gives only "North Carolina" and never states a climate or that the
    bases are coastal. North Carolina sits between the `temperate` and `hot_humid` buckets, so the field is left out
    rather than scoring a guess. Climate would also not change this estimate, because there are no grounds.
  - Installation "Camp Halloran".
  - Solicitation "M67443-27-R-0019".
- **Prior award** (paragraph 3.2 and Q6):
  - Incumbent Longleaf Garrison Dining, LLC, Contract M67443-22-C-0004, awarded 2022.
  - Total $298,746,215 over 60 months, as modified through P00011.
  - Annual value $63,215,480 (Option Period 4, the current period).
  - Spend to date $233,418,605 over 48 months.
- **No grounds.** Grounds maintenance is performed by the Government. The contractor only polices litter within 50 ft
  of each facility.

## Traps

1. **Meals per day is derived.** It depends on days of operation: 5+2, 5+1 (W-133) or 5 (four M–F facilities).
   Dividing the weekly column by 7 everywhere, or ×5/7 on a weekday-only hall, is wrong.
2. **Midrats is a fourth meal period** at 227 and AS-4150, including weekends. The satellites serve only two periods:
   AS-219 serves lunch and Midrats, and SP-24 serves breakfast and dinner, with lunch N/S (MREs are not contract meals).
3. **Two weekend patterns.** Most halls serve Brunch and Supper. The training-schedule halls (D-301, D-450) serve
   B/L/D every day.
4. **Amendment 0001 controls** and appears only at the end.
   - It deletes D-512.
   - It replaces D-450's headcount: 1,861/day as issued becomes 2,573/day.
   - It corrects Bldg 227 from 23,460 / 20,690 to 46,920 / 41,380. The issued figures covered the first floor only.
5. **Closed hall (TC-410)** shown with parenthesized, italic figures. It appears in TE-1, TE-2, TE-3 and TE-4 (with
   history) and is excluded.
6. **Option-only hall (D-1720)** has projected SF and seats, plus a TE-3A projected headcount. It is excluded.
7. **Three area columns.** Gross SF, Sanitation Area SF (cleanable) and Dining Room SF (a subset, not an extra area).
8. **Prefixed building numbers.** The table mixes TC-303, OB-160, W-48, D-450, SP-24, AS-4150 and AS-505 with plain
   numbers. Names repeat the number. Item numbers 1–20 are not building numbers.
9. **Totals and subtotals.**
   - TE-1 subtotals per installation and the TE-1 total of 18.
   - The TE-3 TOTAL row.
   - The TE-4 total.
   - The amendment's revised totals (17 facilities, 452,615 GSF).
10. **Group header rows** for installations and areas.
11. **Satellites are separate in-scope buildings.** Their parent hall's figures exclude them (Note 7, Q1).
12. **Facilities named in prose but not included:** MCCS club (1210), food court (1108), Naval Hospital galley (H-1)
    and Base Brig (1041).
13. **Distractor numbers:**
    - seats
    - year built / renovated, wrapped over two lines
    - floors
    - serving windows
    - weekly meals
    - TE-4 fiscal-year history with anomalies: a deployment, a range closure, an opening part-way through FY25,
      TC-575 receiving TC-410's diners, and FY26 covering only nine months
    - TE-3A projections
    - the 15% / 90-day clause
14. **Layout.** TE-1 is landscape and split over two pages, with a three-row header repeated on each. Superscript
    note markers are glued to header words in the text layer ("SF1", "Area SF2", "Opn4"). The notes are only on the
    second page.
15. **Service levels from days of operation:** `daily_7` / `daily_5` / `daily_6`.
16. **Prior-award distractors:** the FAR 52.217-8 estimate ($31,607,740), the special-event BPA ceiling ($3,500,000)
    and FY26 subsistence (about $38.9M).
17. **Contract years** exclude the phase-in and the 52.217-8 extension.
18. **No grounds.** The "police within 50 feet" duty is not a grounds area.

## Regenerating

`gen.mjs` holds one table of facilities. From it, it writes the HTML (all TE pages and the amendment) and
`expect.facilities` in `truth.json`, so the rows, subtotals, totals, amendment figures and truth always reconcile.
Edit the table, rerun `gen.mjs`, then re-render. `provenance`, `site`, `priorAward` and `traps` in `truth.json` are
written by hand. If you change dollar values or dates in the HTML template, update them as well.
