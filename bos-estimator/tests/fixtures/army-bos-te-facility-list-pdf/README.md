# army-bos-te-facility-list-pdf

Army base operations support (BOS) solicitation `W9124J-27-R-0031`, Section J **Attachment 0003**, for the
fictional installation **Fort Kearsley**. The package is one 8-page PDF:

| page | content | orientation |
|---|---|---|
| 1 | Attachment cover: list of PWS Technical Exhibits (TE 1–TE 9), seven General Notes for TE 5 (GSF source, frequency codes, demolition rule, subtotal rule, footnote convention, facility-number prefixes), CUI designation block | portrait |
| 2–6 | **TE 5 – Facility List and Custodial Service Frequencies**: 104 facility rows in four zones | landscape |
| 7–8 | **TE 6 – Grounds Maintenance Workload by Area**: Table 6-1 (Type I/II/III acres with mowing counts), Table 6-2 (playing fields), Table 6-3 (paved areas in SY), Table 6-4 (grounds type definitions) | landscape |

Source: `te5-te6-attachment-0003.html` → `build/W9124J-27-R-0031 Att 0003 - TE5 Facility List and TE6 Grounds Workload.pdf`.

TE 5 columns: `FAC NO | FACILITY NAME | CATCODE | CATCODE DESCRIPTION | YR BUILT | FLRS | GSF | CUSTODIAL FREQ`. The
header has two rows: a group header "REAL PROPERTY DATA (GFEBS, AS OF 30 SEP 2026)" spans CATCODE through GSF. The
header repeats on every page. Each page also carries "CUI" banners, a running header with the solicitation number and
exhibit title, and a footer "Section J, Attachment 0003 | TE 5 – Page x of 5 | Issued 18 SEP 2026".

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
  - Service levels: 7X/WK → `daily_7`, 5X/WK → `daily_5`, 3X/WK → `3x_week`, 2X/WK → `2x_week`, 1X/WK → `weekly`.
  - The five 1X/MO facilities (T-2312, 02326, R-5125, R-5127, R-5130) stay in scope but have no service level.
- **Category** is given only where the CATCODE description is unambiguous. Fire, MP, tower, terminal, bathhouse,
  fuel, range and youth-center codes have no category.
- **Grounds**, kept in the document's units (the scorer converts them):
  - Improved turf: 126.6 acres over 10 areas.
  - Semi-improved: 180.3 acres over 11 areas.
  - Unimproved: 611.0 acres over 5 areas.
  - Athletic field: 14.6 acres (PF-1).
  - Parking: 183,510 SY = 1,651,590 SF (PV-1 to PV-4).
  - Sidewalk: 27,600 SY = 248,400 SF (PV-5).
  - Areas that list TE 5 facility numbers under "Facilities Served" carry those numbers as `buildingNumbers`.
- **Site:** installation "Fort Kearsley", solicitation "W9124J-27-R-0031". No contract term, climate zone or prior
  award is in this attachment.

## Traps

1. **Five landscape pages after a portrait cover.** The two-row header repeats on every page, along with the CUI
   banners, running header and footer. The renderer adds a second "Page n of 8" footer.
2. **Rows that are not facilities.**
   - Zone grouping rows, including "(CONTINUED)" rows at the top of a page.
   - Four zone SUBTOTAL rows and a GRAND TOTAL row. These include the demolition rows (General Note 4).
3. **Demolition rows.** Two facilities show "DEMO FY27 – EXCLUDE" in the frequency column, with footnote 2/ on the
   name, and must be excluded.
4. **Footnote markers glued to numbers.** Superscript markers come out of the text layer stuck to the number:
   "61,4501/" means 61,450 GSF with footnote 1/. This affects 00207, 01245, 02322, 02324 (1/) and 00238, 04005,
   04007, 04011 (3/). Markers after names (2/, 4/, 5/) are separate.
5. **Mixed number formats.**
   - 19 GSF values have no thousands separator (7315, 3180, 9950…). The rest use commas.
   - 960 and 860 SF buildings exist.
   - YR BUILT and FLRS sit right next to GSF ("1958 3 48,620").
6. **Facility number formats.**
   - Prefixes: P-114 (permanent), T-2310 (temporary, in scope), S-2340 (semi-permanent), R-5101 (range).
   - 00205 and its annex 00205A are separate records.
7. **Twin rows.** 01203/01204, 01205/01206, 01210/01212/01214 and 01216/01218 have identical data and are all kept.
8. **Footnotes that limit the cleaned area.** Footnotes 3/ (bays), 4/ (kitchens) and 5/ (barracks common areas
   only) reduce the custodial area but give no number. Truth keeps gross SF and has no cleanable SF.
9. **TE 6 Table 6-1 multi-row header.** Each of Type I/II/III has ACRES and MOWS/YR columns. Mowing counts (30, 12,
   8, 3…) sit between acreages and are not acres. "—" means none. The TOTAL row is excluded.
10. **Playing fields.** PF-1 is maintained to the Type I standard but is explicitly not included in the Type I
    acreage. Count it once, as `athletic_field`.
11. **Paved areas in square yards.** Table 6-3 quantities are SY: parking PV-1 to PV-4 and sidewalks PV-5. The TOTAL
    PAVED AREA row (211,110 SY) is excluded. Roads, aprons and runways are stated to be out of scope and are not
    listed.
