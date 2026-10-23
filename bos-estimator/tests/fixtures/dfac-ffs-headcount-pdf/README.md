# dfac-ffs-headcount-pdf

Army garrison food service solicitation (`W9124J-27-R-0047`, fictional "Fort Branford, Georgia") delivered as one
6-page PDF with a text layer: Section J, Attachment J-0502, *PWS Technical Exhibits – Estimated Workload Data*.
It covers Full Food Service (FFS) at two dining facilities, Dining Facility Attendant (DFA) services at a third,
and custodial (facility sanitation) services for 16 buildings.

| Page | Orientation | Content |
|---|---|---|
| 1 | portrait | Cover, exhibit list, 1.1 Purpose, 1.2 Scope (FFS vs DFA, AR 30-22 TDA/TOE rule) |
| 2 | portrait | 1.3 Period of performance, **1.4 Current contract** (values as modified after the Bldg 2240 deletion), 1.5 basis of estimate (typical 5 + 2 week, 52 weeks a year), 1.6 headcount, 1.7 maximum feeding capacity, 1.8 workload changes, abbreviations |
| 3 | landscape | **TE 5-1 DFAC workload**: Bldg, name, seats, max feeding capacity, FFS/DFA, Mon–Fri average headcount (Breakfast, Lunch, Dinner, Late/Midnight), Weekends & Holidays (Brunch, Supper), remarks, 7 footnotes |
| 4 | landscape | TE 5-2 serving hours; TE 5-3 historical meals served (AFMIS) FY24 / FY25 / 9-month FY26, for information only |
| 5 | portrait | **TE 6-1 custodial facility list**: Item, Bldg, name, floors, GSF, custodial service area, frequency, remarks |
| 6 | portrait | TE 6-1 notes, facilities not included, building access |

Render and score:

```bash
node scripts/render-fixtures.mjs tests/fixtures/dfac-ffs-headcount-pdf
npx tsx scripts/eval.ts tests/fixtures/dfac-ffs-headcount-pdf
```

## Provenance (fidelity: real-format)

The layout and wording follow real military food service documents found in search excerpts. No rows are
copied: every value is made up.

- **Fort Stewart Warrior Restaurants** (https://home.army.mil/stewart/my-fort/soldiers/DFACs): "Mon- Fri:
  Breakfast / Lunch / Dinner; Weekends & Holidays Brunch: 0930-1300 / Supper: 1700-1830". This is the source
  for the weekday versus weekend-and-holiday meal periods, the "Warrior Restaurant" names, and the
  Bldg 4120 weekend serving windows in TE 5-2.
- **Schriever AFB Full Food Service draft PWS**, FA255020R0010 Attachment 1
  (https://imlive.s3.amazonaws.com/Federal%20Government/ID294263761115844501071154752929531886007/DRAFT%20PWS_CDRLS.pdf).
  It gives weekday average meal counts per meal period including a Midnight meal (2300–0100), has a separate
  weekend and holiday table, and requires the contractor to send headcount data to the COR weekly. This is the
  model for the TE 5-1 columns and paragraph 1.6.
- **GAO B-402434, Najlaa International Catering Services** (https://www.gao.gov/products/b-402434,b-402434.2).
  That PWS defined maximum feeding capacity per meal as seating capacity times a multiplier, "infrequently
  required" and "for planning, storage, workforce, and equipment purposes", and the RFP included historical
  meal headcounts. This is the model for paragraph 1.7, the max-feeding column and TE 5-3. The multiplier here
  is 3 seat turns.
- **AR 30-22, The Army Food Program**
  (https://www.kansastag.gov/DocumentCenter/View/711/AR-30-22-Army-Food-Program-dated-17-July-2019-PDF): "DFAC
  operations in support of TDA organizations are authorized to contract for FFS … in support of TOE
  organizations are authorized to contract for DFA services only." This is paraphrased in paragraph 1.2.b for the
  DFA-only DFAC, which has Government 92G cooks.
- **Fort Knox Full Food Services, W9124J-19-R-0018**
  (https://govtribe.com/opportunity/federal-contract-opportunity/full-food-services-fort-knox-ky-w9124j19r0018).
  MICC issued it for Army Sustainment Command, with "Technical Exhibits with workload data" and AFMIS historical
  headcount summaries. This is the source for the issuing office, the W9124J prefix and AFMIS sourcing.
- **Whiteman AFB Mess Attendant PWS**
  (https://www.waru.edu/sites/default/files/2024-01/Mess+Attendant+PWS+dtd+23+Feb+2023.pdf): "estimated quantities
  of work are listed in Technical Exhibit 2, Workload Estimates." This is the model for the disclaimer in
  paragraph 1.1.

**Made up for this fixture:** Fort Branford, the solicitation number, the contract numbers, the incumbent
(Sandhill Garrison Services, LLC), all DFAC and building names and numbers, and every seat count, headcount,
serving time, historical meal count, square footage, frequency and dollar value.

## Expected answers

- **16 facilities** (`facilitiesComplete: true`), one per in-scope TE 6-1 row: 13 non-dining buildings plus the
  three in-scope DFACs (4120, 7031, 9215). Each DFAC carries both its TE 6-1 gross SF and its TE 5-1 dining
  profile. `cleanableSqft` is the TE 6-1 "Custodial Service Area (SF)" column.
- **Category** is set only where the building's use is clear: admin (101, 115, 6205, 7040), education, dining,
  fitness, child_care and community. It is deliberately left out for 1450 (TISA), 1462 (CIF) and 5102 (Troop
  Medical Clinic). Their custodial service areas are offices, break rooms, restrooms, customer service and fitting
  rooms, or "non-clinical areas only". In `shared/factors.ts`, `warehouse` (90% concrete, no break-room task) or
  `medical` (exam-room disinfection) would misprice that space, and `admin` contradicts the building name, so
  either answer is defensible. A debatable category is not scored. 3301 (SRP) and 9300 (Range Control) have no
  category for the same reason.
- **Dining** (`daysPerWeek` 7 for all):

| Bldg | Type | Mon–Fri B / L / D / M | Wknd Brunch / Supper | (wkday×5 + wknd×2) ÷ 7 | mealsPerDay | mealPeriods |
|---|---|---|---|---|---:|---:|
| 4120 | FFS | 410 / 905 / 520 / — = 1,835 | 465 / 330 = 795 | 10,765 ÷ 7 = 1,537.86 | 1,538 | 3 |
| 7031 | FFS | 285 / 640 / 390 / 115 = 1,430 | 310 / 240 = 550 | 8,250 ÷ 7 = 1,178.57 | 1,179 | 4 |
| 9215 | DFA | 140 / 315 / 188 / — = 643 | 150 / 105 = 255 | 3,725 ÷ 7 = 532.14 | 532 | 3 |

  Bldg 9215 should be read as `serviceStyle: dining_facility_attendant`. `truth.json` cannot express service
  style, so the scorer does not check it.
- **Site:** 5 contract years (12-month base plus four 12-month options; the FAR 52.217-8 extension is not a
  year), `hot_humid` (Georgia), installation "Fort Branford", solicitation "W9124J-27-R-0047".
- **Prior award** (paragraph 1.4): Sandhill Garrison Services, LLC, Contract No. W9124J-21-C-0012, FFP,
  awarded 2021. Total value $71,284,960 over 60 months, and annual value $14,962,415 for the current option
  period. Contract type FFP is stated but is not in the truth schema. Paragraph 1.4 says both values are *as
  modified*: Modification P00009 deleted the Bldg 2240 line items on 1 NOV 2024 and increased Bldg 4120 for the
  reassigned diners. The Option Period 4 value therefore covers three operating DFACs, the TE 6-1 custodial list,
  and Bldg 1475 through 30 JUN 2026, which is the scope the top-down cross-check compares against.
- No grounds.

## Traps

1. **Meals per day is derived, not stated.** TE 5-1 gives average headcount *per meal period* for a typical
   week (paragraph 1.5: five weekdays and two weekend days). Meals/day = (weekday sum × 5 + weekend sum × 2) ÷ 7,
   rounded to the nearest whole meal. Using only the weekday sum, or adding all six columns, is wrong. Paragraph
   1.5 and Note 1/ say to price 52 typical weeks and not to price weekday holidays as extra weekend days. So
   annualizing with about 250 weekdays and 115 weekend/holiday days (4120: 1,507/day, 2% low) is also wrong.
2. **Meal periods vary:** 3 at 4120 and 9215 (Late/Midnight shown as "—" or N/S), and 4 at 7031 (midnight meal
   Mon–Fri, Note 5/). The two weekend periods are not the count.
3. **Closed DFAC.** Bldg 2240 Dragon Warrior Restaurant appears in TE 5-1 ("CLOSED FOR RENOVATION THROUGH
   FY27 – NO WORKLOAD"), TE 5-2, TE 5-3 (FY24/FY25 history) and TE 6-1 (25,120 GSF, frequency N/A). It is
   excluded everywhere.
4. **Same building in two tables.** The DFACs appear in TE 5-1 and again in TE 6-1 under the same building
   numbers. The reader should produce one facility per building, not a separate SF-less dining facility.
5. **Gross vs custodial area.** DFAC custodial areas cover only restrooms, entries and admin (4,860 / 3,720 /
   2,940 SF). Kitchen and dining-room sanitation fall under Part 5. TISA and CIF are mostly warehouse. These are
   `cleanableSqft`, not `grossSqft`.
6. **Distractor numbers next to headcounts:** seating capacity, maximum feeding capacity (seats × 3), the TE 5-1
   TOTAL row, TE 5-2 serving times, and TE 5-3 annual meals served. The history mixes operating conditions.
   Bldg 4120 FY24 (190,460) is before consolidation. FY25 (514,385, or 1,409 a day over 365 days) includes one
   pre-consolidation month. FY26 (412,650, or 1,512 a day over 273 days) covers nine months. Bldg 9215 FY24
   (131,640) is down 31% because of a brigade deployment. Paragraph 1.5 says to price TE 5-1 (1,538 / 1,179 /
   532).
7. **Deleted building.** Bldg 1475 is struck through and marked DELETED, with 9,640 GSF still printed. The
   TOTAL – FACILITIES IN SCOPE (16) row (461,290 / 299,950) is not a facility.
8. **Facilities named in prose as not included** (6-1.1: 5100/5104, 4810, 8101–8104, Exchange).
9. **Prior-award distractors** in the same paragraph: the FAR 52.217-8 extension amount ($7,481,208) and a
   separate field-feeding IDIQ (W9124J-24-D-0019, ceiling $4,950,000).
10. **Mixed orientation and wrapping.** Landscape TE 5 pages sit between portrait pages. Long names wrap in
    cells ("Ironhorse Warrior Restaurant", the Bldg 115 name). In the text layer, footnote markers are glued to
    words ("CAPACITY2/", "TOTAL – FACILITIES IN SCOPE (16)5/") or split onto their own line after a number
    (the 7031 midnight headcount "115" followed by "5/").

## How the history fits together (TE 5-3)

The historical meals are invented, but they agree with each other and with TE 5-1:

| | Bldg 2240 | Bldg 4120 | 7031 | 9215 | Total |
|---|---:|---:|---:|---:|---:|
| FY24 (366 days) | 352,610 (963/day) | 190,460 (520/day, before consolidation) | 418,960 | 131,640 (deployment MAR–AUG) | 1,093,670 |
| FY25 | 29,840 (OCT 2024 only, 963/day) | 514,385 (OCT at 520/day, then 1,492/day) | 427,145 | 191,035 | 1,162,405 |
| FY26, 9 months (273 days) | Closed | 412,650 (1,512/day) | 318,220 (1,166/day) | 143,880 (527/day) | 874,750 |
| TE 5-1 basis | – | 1,538/day | 1,179/day | 532/day | |

Bldg 2240 (963/day) plus Bldg 4120 before consolidation (520/day) is 1,483/day. That is about what Bldg 4120 served
after 1 NOV 2024 (1,492 rising to 1,512), so the diners really did move. The TE 5-1 basis is the 12-month AFMIS
actual plus the IFPM's stated FY27 stationing adjustment of about 1% to 2% (paragraph 1.5). The installation total
rises from FY24 to FY25 because the Bldg 9215 brigade came back from deployment, not because of the closure.
