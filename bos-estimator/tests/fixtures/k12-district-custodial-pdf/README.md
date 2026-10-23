# k12-district-custodial-pdf

This is a K-12 school district custodial RFP (`RFP No. 27-02`, for "Cedar Prairie School District No. 427", a fictional
King County, Washington district). It is one 10-page PDF with a text layer: the RFP as issued on October 26, 2026,
followed by Addendum No. 1 (November 16, 2026), the way a proposer saves the RFP and its addendum into one file. The
original RFP pages do not mention what the addendum changes.

| Pages | Content |
|---|---|
| 1 | Cover with key dates, named contact and RFP contents |
| 2 | Section 1, General Information: term, current contract, district profile, insurance, background checks |
| 3–4 | Section 2, Scope of Work: square footage and portables rule, school-year schedule, summer deep clean, gym wood floors, additions/deletions, exclusions (including daytime custodians kept in-house) |
| 5 | Section 3, Proposal Requirements and Contract Terms: proposal tabs, Forms 1–6, Washington qualifications, prevailing wages (RCW 39.12), payment, termination, public records |
| 6–7 | **Exhibit A, Schedule of Facilities** (landscape, 13 columns, three-row header, split over two pages) |
| 8 | Exhibit B, Price Proposal Form (Pricing Area per location, unit prices) |
| 9–10 | **Addendum No. 1**: deletes a school, moves portables, corrects the district office SF, revises totals, Q&A |

Render and score:

```bash
node scripts/render-fixtures.mjs tests/fixtures/k12-district-custodial-pdf
npx tsx scripts/eval.ts tests/fixtures/k12-district-custodial-pdf
```

## Provenance (fidelity: real-format)

All values are made up: names, addresses, enrollment, square footage, portable counts, gym floor areas, acreage,
the district, the solicitation and the current contract (Sound & Summit Building Care, LLC, CPSD-C-22-031,
$3,412,860 in 2025-26). No rows were copied. The layout and wording follow real K-12 custodial RFPs found with web
search:

| Source | What the fixture takes from it |
|---|---|
| [Muskegon Public Schools RFP Custodial Services (2024)](https://muskegonpublicschools.org/downloads/requests_for_proposal/rfp_2024_custodial_mps.pdf) | Each school listed with address, student count and gross SF ("Bunker Elementary – 2312 Denmark Ave., 441 students, Square Footage 130,000") |
| [Hamilton Southeastern Schools custodial RFP (March 2025)](https://resources.finalsite.net/images/v1743423065/hsek12inus/upnqub91wobwivgtv5zr/RFPJanitorialServices2025mar.pdf) | Portables counted outside the building SF ("Southeastern Elementary (SES) 93,000 + 7 portables") |
| [Powhatan County Public Schools RFP 23-002](https://core-docs.s3.amazonaws.com/documents/asset/uploaded_file/3586/PCPS/3093779/RFP_23-002_Powhatan_Custodial_Contract.pdf) | Attachment D lists portable classroom units per location; "Custodial services shall be provided at all portable classroom ... units"; the "Additions and Deletions to Building Locations and Square Footage" clause, paraphrased in 2.2 and 2.7 |
| [Williamson County Schools RFP #1199](https://docs.wcs.edu/pdf/purchasing/RFP-1199-Outsourced-Custodial-Services-Final.pdf) | Gross reduced to net cleanable (kitchens and mechanical rooms not cleaned) and a flat monthly fee per portable (Exhibit B Part 3) |
| [Pike County Schools (GA) RFP #04052024](https://pike.k12.ga.us/wp-content/uploads/2024/04/2024-Custodial-RFP-Final-1.pdf) and [its Q&A](https://pike.k12.ga.us/wp-content/uploads/2024/04/CUSTODIAL-RFP-Q-A-042924.pdf) | Central office and support buildings in the same schedule as the schools; stadium handled separately; gross vs cleanable question in the Q&A |
| [Monroe County School District RFP 2023001 Q&A](https://www.keysschools.com/cms/lib/FL02202360/Centricity/Domain/36/RFP%202023001_Notice_QA%20Response%20No.%201.pdf) | Covered walkways and courtyards not in the listed SF; SF taken from the state facility inventory (FISH; the fixture cites Washington's ICOS) |
| [Ferndale Public Schools RFP](https://files-backend.assets.thrillshare.com/documents/asset/uploaded_file/4223/Ferndale_Ps/8dd6c69a-ce37-42ea-be9e-69751323a7b8/RFP_FACILITIES_MAINTENANCE_AND_CUSTODIAL_SERVI.pdf?disposition=inline), [Nashua wood floor RFQ](https://nashuanh.gov/DocumentCenter/View/31752/Wood-Floor-Refinishing-2025-2027?bidId=) | Custodian cleans the gym floor, a third party refinishes; summer screen-and-recoat (Section 2.6) |
| [Oster Elementary portable classrooms notice](https://ceqanet.lci.ca.gov/2020050483/2) | 24 x 40 ft portables of about 960 SF each |
| [RCW 39.12.020](https://app.leg.wa.gov/RCW/default.aspx?cite=39.12.020) (not fetched; see below) | Section 3.4: prevailing wages on "public building service maintenance contracts", the "Janitors" trade rate for King County, the Statement of Intent and Affidavit of Wages Paid (RCW 39.12.040) |

### Washington setting: what is and is not verified

The district is set in Washington on purpose. The ICOS facility inventory, fingerprint checks under RCW 28A.400.303,
the Seattle-Tacoma-Bellevue CPI-U, the "Board of Directors", Open Doors re-engagement and the temperate climate in
`site.climateZone` all depend on it. The format sources are districts in MI, IN, VA, TN, GA and FL, where contracting
out custodial work is common. Washington districts more often use in-house classified custodians. To make the setting
believable, the RFP:

- bids only evening production cleaning (1.1, 2.4);
- keeps daytime custodians as District classified staff (2.8(f));
- requires state prevailing wages for the "Janitors" trade (3.4), with renewal escalation allowed for wage changes (1.2).

The prevailing-wage wording comes from the author's knowledge of RCW 39.12. It was not checked against a real Washington
district custodial RFP, because the WebSearch budget was used up during this revision. The fixture also does not cite
RCW 28A.400.285 (contracting out classified services), because its conditions could not be confirmed. Neither point
changes any expected value.

Known remaining tells:

- The e-mail domain is a reserved `.example.org` placeholder, on purpose.
- The package is 10 pages; real ones run 30–80. Forms 1–6 are referenced but "posted as fillable files" rather than bound in.
- Every figure reconciles exactly. Real schedules often carry small inconsistencies, but adding them on purpose would
  make the ground truth ambiguous.

## How the portables are read (stated in the document)

Section 2.3, Exhibit A Note 2 and Addendum Q1 all say that **Column (9) "Permanent Building SF" excludes portable
classrooms**, and that the area of each school for this contract is Column (9) plus the area of its portables. That
combined area is the "Pricing Area" in Exhibit B. So the expected `grossSqft` for each school is the building SF
plus its portables. For example, Alder Creek is 51,340 + 4 @ 960 = **55,180**, and Cedar Prairie High is
268,940 + 6 @ 960 = **274,700**. Schools without portables keep their Column (9) value.

## Expected answers

- 18 facilities (`facilitiesComplete: true`): 16 schools, the Administrative Service Center (901) and the
  Transportation and Maintenance Facility (902). Building numbers are the Loc. No. values.
- These are post-addendum values:
  - Old Mill Elementary (208) is deleted.
  - Riverbend (209) has 6 portables, so 52,064 + 5,760 = 57,824.
  - The district office (901) is 22,960, not 18,240.
- Transportation (902) has a `grossSqft` of 28,400 and a `cleanableSqft` of 6,850. Service covers only the offices, driver lounge and restrooms.
- Service levels:
  - Schools are cleaned "M–F" on calendar days, plus a summer deep clean. That maps to `daily_5`.
  - The district office is cleaned M–F year-round, which is `daily_5`.
  - Transportation is cleaned M/W/F, which is `3x_week`.
- Categories: schools are `education`, the district office is `admin`, and transportation is `maintenance`.
- `grounds: []`. Site acreage is informational and grounds are out of scope, so a reader that emits turf is penalized.
- Site: 5 contract years (1 + four 1-year renewals), `temperate`, "Cedar Prairie School District", "RFP No. 27-02".
- Prior award (Section 1.3):
  - $3,412,860 annual for 2025-26
  - $12,904,115 over 48 months
  - Incumbent Sound & Summit Building Care, LLC
  - Contract CPSD-C-22-031, awarded 2022
  - `periodMonths` and `totalValue` are left out on purpose. No total contract value is stated, and the incumbent's
    60-month term (1 + four 1-year renewals, July 2022 – June 2027) is not paired with a total. In the schema,
    `periodMonths` is the period that `totalValue` covers. The 48 months belong to the spend-to-date figure.

## Traps

1. **Portables outside the SF column.** They appear as "N @ SF each". Unit sizes vary: 960, a 1,792 "dbl." unit at
   Fernhill (on a second line in the same cell), and 896 at Lincoln Center.
2. **Addendum supersedes the exhibit.** It deletes Old Mill (208), changes Riverbend's portables from 2 to 6, and
   revises the district office from 18,240 to 22,960.
3. **Gross vs cleanable at transportation.** Exhibit B prints 6,850 as the Pricing Area. In Exhibit A the gross area
   reads "28,4006" in the text layer, because footnote 6 is glued to the number.
4. **Totals and subtotals** appear in Exhibit A, in Exhibit B (Part 1 and Part 2 totals and the total pricing area),
   in Addendum Item 4 (revised totals), and in the Section 1.4 prose ("1.51 million square feet ... 44 portable
   classrooms").
5. **Group header rows** span the table.
6. **Exhibit B repeats every location.** Its line numbers 1–19 are not building numbers.
7. **Distractor numbers sit next to the SF:**
   - enrollment
   - year built / modernized, wrapped over two lines
   - site acres
   - floors
   - gym wood floor SF such as "14,880 + 8,050 aux."

   The gym floor area is included in Column (9). It is not added to it, and it is not a facility.
8. **Three-row header.** The group row and the column-number row (1)…(13) are separate rows. Superscript note markers
   are glued to header words ("SF1", "Acres5"). The landscape table spans two pages and repeats its header.
9. **Wrapped names and addresses.** Lincoln Center takes three lines in the name cell.
10. **School-calendar schedule** (about 184 days) plus summer deep clean and summer school M–Th (July 6–29, 2027).
    None of these is a separate service level. Model limitation: `daily_5` is 250 days a year in `shared/types.ts`,
    so routine school labor estimated from this fixture runs high until the app gets a school-calendar service level
    or a day-count override.
11. **Non-award dollar amounts** (insurance limits, bond, liquidated damages) sit near the prior-award paragraph.
12. **Boilerplate numbers in Section 3**: RCW chapter and section numbers, Forms 1–6, Tabs 1–7, payment counts
    (10 / 12) and day limits (30 / 60 / 10). None is a facility, an area or an award value.
13. **Addendum only at the end.** The original pages say only that Old Mill is "under review for consolidation"
    (2.7, Note 7). The deletion, the moved portables and the district office correction appear only in the addendum.

## Regenerating

The HTML and the facility rows in `truth.json` were generated together from one table of site data, so the
Exhibit A rows, Exhibit B pricing areas, addendum figures and totals stay consistent. If you edit a value by
hand, update every place it appears: Exhibit A, Exhibit B, the Addendum (Items 2–4 and Q1) and `truth.json`.
