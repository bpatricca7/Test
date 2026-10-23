# scanned-facility-exhibit

A janitorial-services facility exhibit delivered as an **image-only scanned PDF**. The PDF has no text layer, so the
rule-based reader finds nothing. The ground truth is still the full table, so a vision / OCR reader (Claude with
native PDF input) can be scored against it.

The document is **Attachment 3 to Solicitation W912KS-27-Q-0006**, *Janitorial Services – Kestrel Air National
Guard Base*, PWS **Appendix B – Building Numbers and Estimated Square Footages**. It is a two-page "conformed copy
through Amendment 0001" scan.

| page | content |
|---|---|
| B-1 | Fax/scan header line, CONFORMED COPY / AMENDMENT 0001 stamp, title block, para B.1 (cleaning-area and modification clause), para B.2 (frequency codes including UTA), table rows 100–131 |
| B-2 | Table continued (header repeated): rows 135–175, one handwritten added row, a blank row, the printed TOTAL, note on facility 125, an Amendment 0001 pen-and-ink change box, and the contracting officer's initials |

Source: `appendix-b-building-list.html` → `build/W912KS-27-Q-0006 Att 3 PWS Appendix B Bldg List (conformed thru Amd 0001) - scan.pdf`.

The renderer's `scanned-pdf` mode prints the HTML to PDF, rasterizes it at 110 dpi and rebuilds a grayscale
image-only PDF. The HTML adds the scan look before that step:
- about 0.5° of skew, in opposite directions on the two pages;
- speckle noise and a dark scanner-edge strip;
- a staple mark, a fax/scan header line and a rotated rubber stamp;
- "handwritten" blue-ink pen-and-ink changes, drawn in a bold italic serif.

```bash
node scripts/render-fixtures.mjs tests/fixtures/scanned-facility-exhibit
npx tsx scripts/eval.ts tests/fixtures/scanned-facility-exhibit                      # rule-based: 0 facilities (no text layer)
npx tsx scripts/eval.ts --provider claude tests/fixtures/scanned-facility-exhibit    # needs ANTHROPIC_API_KEY
```

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
- `floors` is set for every facility.
- Service levels: 5X/WK → `daily_5`, 3X/WK → `3x_week`, 2X/WK → `2x_week`, 1X/WK → `weekly`, UTA → `monthly`.
  Para B.2 defines UTA as one drill weekend a month. Facility 106 ("1X/WK + UTA") has no single level, so truth
  leaves it out.
- `category` is set only where the activity is clear.
- No grounds, dining workload or prior award. Site: solicitation `W912KS-27-Q-0006`, installation "Kestrel".

## Traps

1. **No text layer at all.** Text extraction returns 0 characters, and only OCR or vision can read the table.
2. **A row lined out by hand.** Facility 141, Fuels Management Office (1,240 SF), has a pen line through it and a
   handwritten note "DELETED – DEMO'D AMD 0001". It is excluded.
3. **A handwritten correction.** Facility 160 shows 10,350 struck through with 11,020 written above it. Truth is 11,020.
4. **A handwritten added row.** Facility 185, Small Arms Range Classroom, 1 floor, 1,320 SF, 1X/WK, is written into
   a blank row above the total. It is included.
5. **A stale printed total.** The TOTAL ESTIMATED CLEANING AREA reads 129,545. It predates the amendment: it still
   counts 141 and the old 160 value, and leaves out 185. The correct total is 130,295 SF, and the TOTAL row is not a
   facility.
6. **Scan furniture is not data.**
   - The table runs over two pages with the header repeated and "(continued on page B-2)".
   - The fax/scan header, the CONFORMED COPY stamp (which overlaps the header line), and the page labels B-1/B-2
     and "Page n of 2".
7. **UTA frequency codes** need para B.2 to interpret.
8. **The square footage is the estimated cleaning area.** The hangar figure covers office and latrine areas only, and
   the fire station figure covers admin areas only. It is the only area given, so truth uses it as `grossSqft` and
   sets no cleanable SF.
9. **An asterisk after the facility 125 name** points to a note below the table.
