# oconus-metric-sm-pdf

An OCONUS custodial and grounds solicitation for **U.S. Army Garrison Italy**: Caserma Ederle and Caserma Del Din in
Vicenza, plus the small U.S. compound at Poggio Renatico (FE). The facility list uses square meters throughout.
The package is one 5-page PDF, Section J **Attachment 0004 – PWS Technical Exhibit 3 (TE-3)** of the made-up
solicitation `W912PF-27-R-0012`.

| page | content | orientation |
|---|---|---|
| 1 | Cover with the table list and nine General Notes: 1 base + 4 option periods, units, number format, area definitions, PT/S1 floor notation, frequency codes, exclusions, totals, access | portrait |
| 2 | **Table 3-1 Caserma Carlo Ederle**: GFEBS extract in **SM**, U.S. number format (`2,148.6`). Two-row header, footnotes 1/–3/, subtotal | landscape |
| 3 | **Table 3-2 Caserma Renato Del Din**: host-nation data in **m²**, Italian number format (`4.312,8 m²`), floors as `PT+3` / `S1+PT+2`, frequency as `5/7` | landscape |
| 4 | **Table 3-3 Poggio Renatico**: host-nation data in **mq**, whole numbers with thousands periods (`3.460`), frequencies in Italian (`settimanale`), plus a prose summary of the facility count | landscape |
| 5 | **Table 3-4 Grounds / Aree verdi**: hectares with decimal commas (`2,35 ha`), m² with thousands periods (`18.600 m²`), trees (`312 n.`), totals for each unit, and an information-only site area row | landscape |

Source: `te3-facility-list.html` → `build/W912PF-27-R-0012 Att 0004 - TE-3 Facility List and Grounds Areas (SM).pdf`.

```bash
node scripts/render-fixtures.mjs tests/fixtures/oconus-metric-sm-pdf
npx tsx scripts/eval.ts tests/fixtures/oconus-metric-sm-pdf
```

## Provenance (fidelity: real-format)

Web search shaped the structure and wording. Almost every number is made up.

**Real:**
- **Sites and contract structure.** Presolicitation W912PF24Q0047 (414th CSB) is for custodial services at USAG Italy
  Vicenza and Poggio Renatico (FE). Its sites are Caserma Ederle, Caserma Del Din and Poggio Renatico, with a base
  period plus four periods:
  https://www.highergov.com/contract-opportunity/custodial-services-at-usag-italy-vicenza-and-poggi-w912pf24q0047-p-f2bc1/
- **OCONUS Army custodial work is measured in square meters.** W912CM24R0005 (Wiesbaden) covers "approximately
  500,000 square meters of facility spaces":
  https://usfcr.com/search/opportunities/?oppId=9eca291e3fb640d1811e560c84547668
- **Caserma Ederle site area.** The U.S.–Italy technical arrangement gives 613,260 m². It appears in Table 3-4 as an
  information-only row:
  https://2009-2017.state.gov/documents/organization/109191.pdf
- **Caserma Ederle building numbers and names.** Taken from public directory listings; the areas are made up.
  - 108 Davis Soldier and Family Readiness Center, 126 Education Center, 202 Automotive Skills, 302 Barber/Beauty,
    and the address Viale della Pace 193:
    https://installationguide.militarytimes.com/installation_service/usag-italy/
  - 398 CDC Ederle: https://home.army.mil/italy/contact/phonebook
  - 395 Spiritual Life: https://crg.health.mil/guides/usareur/vicenza/pages/azindex.aspx
  - 29 Chapel: https://installations.militaryonesource.mil/search?program-service=ALL%2Finstallation%3Dusag-italy
  - 10 Dining facility (from a walk-in freezer repair listing):
    https://www.govconinabox.com/explore/contractors/profile/R8LZLYBG7UK5
- **Caserma Del Din.** It was built on the former Dal Molin airfield and is home to most of the 173rd IBCT:
  https://www.army.mil/article/106769/new_installation_opens_in_italy
- **Italian cleaning-tender style.** Net areas in m² by building and room (*superficie netta*), from the Italian Army
  COMFOTER cleaning capitolato:
  https://www.esercito.difesa.it/comunicazione/Bandi-di-gara-Esercito/Comfoter-di-Supporto/Documents/Bandi-e-Avvisi/Allegato_A__CAPITOLATO__PULIZIE__2021.pdf
- **Frequencies and host-nation rules.** The IMCOM-Europe custodial MATOC sets frequencies from daily to quarterly
  and requires work to follow host-nation rules:
  https://www.highergov.com/vehicle/installation-management-command-europe-imcom-e-custodial-services-8810/

**Made up:**
- the solicitation number and contracting-office mailing address;
- every other building number and name, including all Del Din (`D-xx`) and Poggio Renatico numbers;
- every floor count, gross and cleanable area and frequency;
- every grounds quantity and mowing count;
- the Genio Militare / Aeronautica Militare report dates.

## Expected answers

- **30 facilities** (`facilitiesComplete: true`): 15 at Ederle, 12 at Del Din and 3 at Poggio Renatico.
  - `grossSqft` = m² × 10.7639, rounded to whole SF. Total: 866,311 SF.
  - `cleanableSqft` is converted the same way where a cleanable area is given. Poggio Renatico has none.
  - `floors` comes from the FLRS column or the PT/S1 notation.
  - `serviceLevel` comes from 7X/WK, 5/7, `2 v/sett.`, `settimanale`, `quindicinale` and the other codes.
  - `category` is set only where the use is clear.
- **Excluded:**
  - Bldg 71 DEPOSITO (USO ITALIANO, Italian Army use), 842.0 SM.
  - Bldg 222 EX LAVANDERIA (DA DEMOLIRE FY27), 655.5 SM.
- **Grounds**, kept in the document's units (hectares / sqm / each) and converted by the scorer:
  - Improved turf 8.12 ha (20.1 ac).
  - Semi-improved 11.35 ha (28.0 ac).
  - Unimproved 12.40 ha (30.6 ac).
  - Athletic fields 23,650 m² (5.8 ac).
  - Planting beds 1,420 m².
  - Parking 45,050 m².
  - Sidewalks 6,350 m².
  - Trees 798.
  - Areas that list "Edifici serviti" carry those numbers as `buildingNumbers`.
- **Site:** solicitation `W912PF-27-R-0012`, 5 contract years (base + 4 options), installation "USAG Italy". There
  is no prior award in this attachment.

## Traps

1. **Square meters everywhere.** SM, m² and mq are all used, and no SF appears anywhere. Reading 3,960.0 SM as SF
   understates Bldg 47 (42,625 SF) by 90%.
2. **Two number formats in one package.**
   - Table 3-1 uses U.S. format: `2,148.6`.
   - Tables 3-2 to 3-4 use Italian format: `4.312,8 m²` = 4,312.8.
   - `96,4 m²` is 96.4, not 964.
   - Whole numbers with a thousands period: `1.240` / `3.460` mq are 1,240 / 3,460 m², not 1.24 / 3.46.
3. **Italian floor notation.** `PT` = 1 floor, `PT+1` = 2, `PT+3` = 4, `S1+PT+2` = 4.
4. **Mixed frequency codes.** `5X/WK`, `5/7`, `2 v/sett.`, `settimanale` and `quindicinale` all appear.
5. **Excluded rows inside the table.**
   - `USO ITALIANO` (Italian Army use) and `DA DEMOLIRE FY27` are listed but not in scope.
   - The Ederle SUBTOTALE includes both, and says so.
6. **Rows that are not facilities.** SUBTOTALE and TOTALE rows, plus a prose summary saying "total 30 facilities".
7. **Twins.** 141/143, D-02/D-03 and D-05/D-06 have identical data and are separate facilities.
8. **Bilingual names.** Long Italian–English names wrap inside cells. Footnote markers 1/ to 3/ are superscripts
   after names.
9. **Cleanable area far below gross.** This applies to barracks (common areas only), CIF, COF, the vehicle shop and
   auto skills.
10. **Grounds units.**
    - Hectares use decimal commas: `2,35 ha` = 5.81 acres.
    - m² uses thousands periods: `18.600 m²` = 200,209 SF.
    - Trees are given as `n.`.
11. **Grounds rows that are not areas.**
    - TOTALE rows for each unit.
    - The 613.260 m² site-area row, which is information only.
    - Mowing-cycle counts (26, 8, 30), which are not areas.
12. **Athletic fields.** They are maintained to Type I but are not in the Type I hectares. Count them once as
    `athletic_field`.
