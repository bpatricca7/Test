# army-bos-te-facility-list-pdf

Army base operations support (BOS) solicitation `W9124J-27-R-0031`, Section J **Attachment 0003**, for the
fictional installation **Fort Kearsley**. The package is one 8-page PDF:

| page | content | orientation |
|---|---|---|
| 1 | Attachment cover: list of PWS Technical Exhibits (TE 1–TE 9), seven General Notes for TE 5 (GSF source, frequency codes, demolition rule, subtotal rule, footnote convention, facility-number prefixes), CUI designation block | portrait |
| 2–6 | **TE 5 – Facility List and Custodial Service Frequencies**: 104 facility rows in four zones | landscape |
| 7–8 | **TE 6 – Grounds Maintenance Workload by Area**: page 7 has Table 6-1 (Type I/II/III acres with mowing counts) and Table 6-2 (playing fields); page 8 has Table 6-3 (paved areas in SY) and Table 6-4 (grounds type definitions) | landscape |

Source: `te5-te6-attachment-0003.html` → `build/W9124J-27-R-0031 Att 0003 - TE5 Facility List and TE6 Grounds Workload.pdf`.

TE 5 columns: `FAC NO | FACILITY NAME | CATCODE | CATCODE DESCRIPTION | YR BUILT | FLRS | GSF | CUSTODIAL FREQ`. The
header has two rows: a group header "REAL PROPERTY DATA (GFEBS, AS OF 30 SEP 2026)" spans CATCODE through GSF. The
header repeats on every page. Each page also carries "CUI" banners, a running header with the solicitation number and
exhibit title, and a footer "Section J, Attachment 0003 | TE 5 – Page x of 5 | Issued 15 OCT 2026". Tables are set in
8 pt Arial and each TE 5 page is filled to the bottom margin (rows were paginated by measuring the rendered layout,
not by a fixed row count); only the last TE 5 page, which ends with the footnotes, and the last TE 6 page are short.

```bash
node scripts/render-fixtures.mjs tests/fixtures/army-bos-te-facility-list-pdf
npx tsx scripts/eval.ts tests/fixtures/army-bos-te-facility-list-pdf
```

## Provenance (fidelity: real-format)

The layout and wording follow real documents found by web search. Every value in the exhibits is made up.

- **Exhibit numbering.** "Technical Exhibit" numbering (TE 1 Performance Requirements Summary, TE 2 Deliverables,
  TE 3 Estimated Workload Data) comes from the Army PWS template:
  https://buy.gsa.gov/api/system/files/documents/ArmyPWS.pdf
- **Facility list from the real property record.** The Fort Irwin BOS annex delivers its facility list as a TE
  (TE A1, "Real Property Asset File"):
  https://govtribe.com/file/government-file/annex-a-to-opord-18-011-20201106-dot-docx
- **Buildings, square footage and frequency in one TE.** Modelled on the Carlisle Barracks custodial package
  ("PWS TE-A Buildings by Floor Types and Sq Footage" plus frequency charts):
  https://sam.gov/workspace/contract/opp/a9afa9c7669b47c29ca139a9e0624ba3/view
- **Grounds types and mowing standards.**
  - Improved grass height 2–4 in and semi-improved 4–10 in: Hurlburt Field grounds PWS,
    https://imlive.s3.amazonaws.com/Federal%20Government/ID300491423083968486543961800045331043182/Hurlburt_Grounds_MX_PWS_2018_Draft.pdf
  - Improved mowed weekly and semi-improved bi-weekly, plus an acres-by-type workload table with mowing counts:
    FA4809-21-Q-0035 grounds SOW,
    https://imlive.s3.amazonaws.com/Federal%20Government/ID7168376420509164332684627085445331919/FF%20Grounds%20SOW_final%20rev%201.pdf
  - The definition of semi-improved grounds as "a lesser degree than improved grounds … outlying or low visibility
    locations" is paraphrased from federal grounds notices:
    https://console.sweetspotgov.com/federal-contracts/6661f812-3141-52f9-9597-828acd3f4096 and
    https://samdaily.us/archive/2012/05-May/17-May-2012/FBO-02747890.htm
- **CATCODE titles and units.**
  - The 72111 UEPH and 72210 Dining Facility titles, and the SY unit for 85210 organizational vehicle parking, come
    from the USACE Army facilities unit-cost table:
    https://www.usace.army.mil/LinkClick.aspx?fileticket=bdnXSYCqMYI%3D&portalid=2
  - Facility number, CATCODE and primary unit of measure as record fields: DD Form 1354,
    https://www.esd.whs.mil/Portals/54/Documents/DD/forms/dd/dd1354.pdf
- **Dates.** The solicitation number carries fiscal year 27 (`-27-R-`), so the attachment is dated 15 OCT 2026,
  inside FY27. The GFEBS data date (30 SEP 2026) is the last day of FY26, which is normal for an extract pulled just
  before issue.
- **Made up:**
  - the installation, solicitation number and every facility number and name;
  - all other CATCODE assignments and descriptions (in the style of DA Pam 415-28);
  - every year built, floor count, GSF, frequency, acreage, mowing count and SY quantity;
  - the CUI designation block and the phone number (555 exchange).

## Expected answers

- **102 facilities** (`facilitiesComplete: true`). The exhibit lists 104 rows; two are marked
  "DEMO FY27 – EXCLUDE" and are left out:
  - T-2308 Administrative General Purpose, 4,712 GSF
  - T-2314 Reserve Component Training Room, 3,960 GSF

  Expected total gross area is 2,318,586 SF. The printed grand total is 2,327,258 because it includes the two
  demolition rows.
- Floors and service levels:
  - Every facility has its floor count.
  - Every facility has a service level: 7X/WK → `daily_7`, 5X/WK → `daily_5`, 3X/WK → `3x_week`, 2X/WK → `2x_week`,
    1X/WK → `weekly`, 1X/MO → `monthly` (General Note 2 defines 1X/MO as once per month). The five 1X/MO
    facilities are T-2312, 02326, R-5125, R-5127 and R-5130.
- **Category** is given only where the CATCODE description maps to one category without judgement (79 of 102):
  - 61050 administrative and 14182/14183/14185 headquarters and company operations → `admin`;
  - 72111/72410 → `barracks`; 72210 → `dining`; 54010/55010 → `medical`; 44220/44260/44270 → `warehouse`;
  - 21410/21910/21116 → `maintenance`; 21110 → `hangar`; 74028 → `fitness`; 74046 → `child_care`;
  - 17120 general instruction → `education`; 31010 → `lab`;
  - 73017 chapel, 74010 ACS and 74054 community activity center → `community`.

  No category for: the EOC (P-104, 14160); airfield operations, tower, weather station and terminal (1411x);
  training simulation (17140: 02352 TSC, 02354 simulations building, 04013 flight simulator); the library (P-120)
  and post office (00240); fire, MP, access control, range, bathhouse, fuel and youth/school-age codes; and P-118
  RELIGIOUS EDUCATION CENTER, whose name and chapel CATCODE point to different categories.
- **Grounds**, kept in the document's units (the scorer converts them):
  - Improved turf: 126.6 acres over 10 areas.
  - Semi-improved: 180.3 acres over 11 areas.
  - Unimproved: 611.0 acres over 5 areas.
  - Athletic field: 14.6 acres (PF-1).
  - Parking: 183,510 SY = 1,651,590 SF (PV-1 to PV-4).
  - Sidewalk: 27,600 SY = 248,400 SF (PV-5).
  - Areas that list TE 5 facility numbers under "Facilities Served" carry those numbers as `buildingNumbers`. GD-2
    lists a range, "Range Control (R-5101 through R-5130)", which expands to the nine R- facilities in TE 5.
    GC-1 ("Industrial area (all facilities)"), GC-2 and GX-1 have none.
- **Site:** installation "Fort Kearsley", solicitation "W9124J-27-R-0031". No contract term, climate zone or prior
  award is in this attachment.

## Traps

1. **Five landscape pages after a portrait cover.** The two-row header repeats on every page, along with the CUI
   banners, running header and footer. Pages are full, so the last row of a page runs straight into the
   "Continued on next page" note and the footer. The renderer adds a second "Page n of 8" footer.
2. **Rows that are not facilities.**
   - Zone grouping rows, including "(CONTINUED)" rows at the top of a page.
   - Four zone SUBTOTAL rows and a GRAND TOTAL row. These include the demolition rows (General Note 4).
3. **Demolition rows.** Two facilities show "DEMO FY27 – EXCLUDE" in the frequency column, with footnote 2/ on the
   name, and must be excluded.
4. **Footnote markers glued to numbers.** Superscript markers come out of the text layer stuck to the number:
   "61,4501/" means 61,450 GSF with footnote 1/. This affects 00207, 01245, 02322, 02324 (1/) and 00238 (3/). In
   the KAAF block, which has no separators, it is worse: "1043003/" is 104,300 + 3/ (04005), "1186403/" is
   118,640 + 3/ (04007) and "117603/" is 11,760 + 3/ (04011). Markers after names (2/, 4/, 5/) are separate.
5. **Number format changes by block.**
   - The 20 rows of the KEARSLEY ARMY AIRFIELD (KAAF) AND RANGE CONTROL zone print GSF without thousands separators
     (16420, 104300, 9600 …), as happens when a block is pasted from a separate listing in General format. Areas
     A–C and every subtotal use commas.
   - 960 (02344, Area C) and 860 (R-5115) SF buildings exist.
   - YR BUILT and FLRS sit right next to GSF ("1958 3 48,620", "1993 2 16420").
6. **Facility number formats.**
   - Prefixes: P-114 (permanent), T-2310 (temporary, in scope), S-2340 (semi-permanent), R-5101 (range).
   - 00205 and its annex 00205A are separate records.
7. **Twin rows.** 01203/01204, 01205/01206, 01210/01212/01214 and 01216/01218 have identical data and are all kept.
8. **Footnotes that limit the cleaned area.** Footnotes 3/ (bays), 4/ (kitchens) and 5/ (barracks common areas
   only) reduce the custodial area but give no number. Truth keeps gross SF and has no cleanable SF. Footnote 1/
   (enclosed loading docks) does not reduce the area; it only notes that exterior dock aprons are swept with the
   adjacent paved area in Table 6-3.
9. **TE 6 Table 6-1 multi-row header.** Each of Type I/II/III has ACRES and MOWS/YR columns. Mowing counts (30, 12,
   8, 3…) sit between acreages and are not acres. "—" means none. The TOTAL row is excluded. Mowing counts follow
   Table 6-4: Type I 30/yr, Type II 12/yr except the airfield infield (GD-1) at 8/yr, Type III 1–3/yr.
10. **Playing fields.** PF-1 is maintained to the Type I standard but is explicitly not included in the Type I
    acreage. Count it once, as `athletic_field`.
11. **Paved areas in square yards.** Table 6-3 quantities are SY: parking PV-1 to PV-4 and sidewalks PV-5. The TOTAL
    PAVED AREA row (211,110 SY) is excluded. Roads, aprons and runways are stated to be out of scope and are not
    listed.
