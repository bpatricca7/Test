# scanned-facility-exhibit

A janitorial-services facility exhibit delivered as an **image-only scanned PDF**. The PDF has no text layer, so the
rule-based reader finds nothing. The ground truth is still the full table, so a vision / OCR reader (Claude with
native PDF input) can be scored against it.

The document is **Attachment 3 to Solicitation W912KS-27-Q-0006**, *Janitorial Services – Kestrel Air National
Guard Base*, PWS **Appendix B – Building Numbers and Estimated Square Footages**. It is a two-page "conformed copy
through Amendment 0001" scan: the original printed pages with the contracting officer's pen-and-ink changes.

| page | content |
|---|---|
| B-1 | Fax/scan header line, CONFORMED COPY / AMENDMENT 0001 stamp, title block, para B.1 (cleaning-area and modification clause), para B.2 (frequency codes including UTA), table rows 100–131 |
| B-2 | Table continued (header repeated): rows 135–175, one handwritten added row, a blank row, the printed TOTAL (struck and corrected by hand), the note on facility 125, a handwritten list of the Amendment 0001 changes, and the contracting officer's signature and date |

Source: `appendix-b-building-list.html` → `build/W912KS-27-Q-0006 Att 3 PWS Appendix B Bldg List (conformed thru Amd 0001) - scan.pdf`.

The renderer's `scanned-pdf` mode prints the HTML to PDF, rasterizes it at 110 dpi and rebuilds an image-only PDF
in gray. The HTML adds the scan look before that step:
- full-bleed pages (`@page { margin: 0 }`), so the scanner-edge shadow sits at the paper edge;
- about 0.5° of skew, in opposite directions on the two pages;
- speckle noise, a staple on page 1 and staple holes on page 2;
- a fax/scan header line and a rotated rubber stamp that overlaps it;
- the pen-and-ink changes, **hand-printed** by a small script in the page: a single-stroke capital and digit
  alphabet drawn as wobbly ballpoint strokes, with per-letter size, slant, rotation and baseline jitter. They are not
  a typeface, and they ignore the cell grid (corrections overlap cell borders). The ink is blue in the source; the
  scan turns it gray, so it differs from the print by stroke, not color.

```bash
node scripts/render-fixtures.mjs tests/fixtures/scanned-facility-exhibit
npx tsx scripts/eval.ts tests/fixtures/scanned-facility-exhibit                      # rule-based: 0 facilities (no text layer)
npx tsx scripts/eval.ts --provider claude tests/fixtures/scanned-facility-exhibit    # needs ANTHROPIC_API_KEY
```

### Renderer limits (not fixable from the fixture)

- The renderer prints a small "Page n of 2" footer on every page. On these pages it reads as the scan-to-PDF page
  imprint, under the document's own B-1 / B-2 labels.
- The PDF metadata comes from the renderer's second pass: Title `scan.html`, Creator HeadlessChrome, Producer Skia.
- The page images are RGB with an alpha mask, where a real scanner writes grayscale or bitonal JPEG / CCITT images.

## Provenance (fidelity: real-format)

The layout and wording follow a real Air National Guard janitorial PWS appendix found by web search. Every value is
made up.

- **Appendix B layout.** Copied from the **168th Wing (Eielson AFB) janitorial services PWS**, Attachment 7 to
  ITB 230000022:
  https://aws.state.ak.us/OnlinePublicNotices/Notices/Attachment.aspx?id=140242
  - The title "Appendix B, Building Numbers and Estimated Square Footages".
  - The columns: facility number, activity, estimated square footage, weekly frequency.
  - The abbreviated activity names: "MX Fab Shop", "MX Hangar", "Ops".
  - The clause tying price changes to the Appendix B "cleaning area" square footage, paraphrased in B.1.
- **Floor plans attached separately.** The State of Alaska ITB for the same requirement attaches the floor plans of
  the service areas as a separate file (here, "Attachment 4 (15 pages)"):
  https://aws.state.ak.us/OnlinePublicNotices/Notices/Attachment.aspx?id=140756
- **Appendix B square footage drives modification pricing.** From an Air Force custodial PWS whose Appendix B sets
  cleaning levels and estimated square footage:
  https://imlive.s3.amazonaws.com/Federal%20Government/ID297162707687379821580624672536441025401/Attachment%201%20-%20Custodial%20PWS.pdf
- **Amendments change the building list.** Federal RFQ amendments are routinely issued just to supply or change
  per-building square footage:
  https://www.bidnetdirect.com/public/supplier/solicitations/statewide/2530369002/abstract
- **Made up:**
  - the base (Kestrel ANGB is fictional), the solicitation number, the amendment, the initials and the scan header;
  - every facility number, activity, floor count, square footage and frequency.

## Expected answers

- **21 facilities** (`facilitiesComplete: true`), totalling **130,295 SF**:
  - the 21 printed rows,
  - minus facility 141 (lined out),
  - plus facility 185 (handwritten).
- Facility 160 is **11,020 SF**: the handwritten correction replaces the struck 10,350.
- **The square footage is cleaning area.** The only area column is "EST. SQ FT (CLEANING AREA)", and para B.1 says
  the figures are estimates of the areas to be cleaned. So every row sets `cleanableSqft` to the stated value.
  No gross area is given, so `grossSqft` carries the same number.
- `floors` is set for every facility.
- Service levels: 5X/WK → `daily_5`, 3X/WK → `3x_week`, 2X/WK → `2x_week`, 1X/WK → `weekly`, UTA → `monthly`.
  Para B.2 defines UTA as one drill weekend a month. Facility 106 ("1X/WK + UTA") has no single level, so truth
  leaves it out.
- `category` is set only where the activity is clear and matches the space being cleaned. It is left out for 125,
  135 and 140 (see trap 9).
- No grounds, dining workload or prior award. Site: solicitation `W912KS-27-Q-0006`, installation "Kestrel".

## Traps

1. **No text layer at all.** Text extraction returns 0 characters, and only OCR or vision can read the table.
2. **Real-looking handwriting.** The pen-and-ink changes are hand-printed strokes, not a font. They sit off the
   printed baselines and overlap cell borders.
3. **A row lined out by hand.** Facility 141, Fuels Management Office (1,240 SF), has a pen line through it and a
   handwritten note "DELETED – DEMO'D AMD 0001 JRK 2/3/27". It is excluded.
4. **A handwritten correction.** Facility 160 shows 10,350 struck through with 11,020 written above it. Truth is 11,020.
5. **A handwritten added row.** Facility 185, Small Arms Range Classroom, 1 floor, 1,320 SF, 1X/WK, is written into
   a blank row above the total. It is included.
6. **A corrected total.** The printed TOTAL ESTIMATED CLEANING AREA, 129,545, predates the amendment: it still counts
   141 and the old 160 value, and leaves out 185. It is struck through, and 130,295 is written above it (the
   handwritten change list repeats it as item D). 130,295 is the sum of the 21 in-scope rows, so it works as a
   cross-check. A reader that sees only the print gets the stale figure. The TOTAL row is not a facility.
7. **Scan furniture is not data.**
   - The table runs over two pages with the header repeated and "(continued on page B-2)".
   - The fax/scan header, the CONFORMED COPY stamp (which overlaps the header line), the page labels B-1/B-2 and the
     "Page n of 2" imprint.
   - The handwritten Amendment 0001 change list (items A–D), the signature, "CO" and the date.
8. **UTA frequency codes** need para B.2 to interpret.
9. **The square footage is the cleaning area, not the building.** The hangar figure (125) covers offices, latrines, a
   break room and stairwells only; 135 and 140 are office, latrine and issue-counter areas; the fire station (155)
   is admin and latrines only. Truth sets `cleanableSqft` = the stated value on every row. Otherwise the estimator
   would apply a category cleanable share on top of a figure that is already the cleaning area: 125 as a hangar
   (0.25) would drop from 4,415 to 1,104 SF. For the same reason 125, 135 and 140 carry no `category`: a hangar,
   maintenance or warehouse category would give office space a concrete floor mix.
10. **An asterisk after the facility 125 name** points to a note below the table.
