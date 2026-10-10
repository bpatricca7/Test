# Yacht Club Resort (mid-size): LEGO® display kit with build instructions

![The finished model](images/yacht_club_midsize_front_right.jpg)

A mid-size display model of Disney's Yacht Club Resort at Walt Disney World, part of the [resort collection](../resort-collection/README.md). The entrance front of the Yacht Club, as a guest arriving by car sees it: a long, symmetric New England seaside hotel of grey-blue clapboard with rows of windows. A tall centre block rises under a big white-trimmed front gable with the white cupola on its ridge; end bays carry their own front gables and white louvres; recessed wings between them have white balcony railings on every upper floor; the roofs are dark grey. The white porte-cochere stands over the drive at the front door between two lamp posts, a flagpole stands on the lawn, blue hydrangeas grow along the facade, and a small lighthouse in the water at the front corner is a nod to the one on the lake side.

**Signature features in this kit**

- The entrance front, facing you: a long, symmetric facade of grey-blue clapboard (sand blue) with rows of windows
- Three white-trimmed front gables under dark grey roofs: the tall centre gable with a double window and a louvre, and the two end bays
- The white cupola with its dark dome on the centre ridge
- The white porte-cochere over the drive: six columns, a deck and a low pediment
- Recessed wings with white balcony railings on the upper floors
- Two lamp posts, a flagpole with a blue flag, blue hydrangeas, and a small lighthouse in the water at the front corner

**Left out**

- The long guest wings, the Beach Club next door and the lake side with the marina and the boardwalk
- The lighthouse at its real place on the dock (shown small at the front corner)
- The window trim, shutters and most balconies (shown as rows of windows)

| | |
|---|---|
| Pieces | **606** (60 part/colour lines, 39 kinds of part, 10 colours) |
| Display base | 32 × 24 studs (25.6 × 19.2 cm), the same for every mid-size kit in the collection |
| Overall size | 25.6 × 19.2 cm, 13.3 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 52-page PDF, 66 steps, 6 sections |
| Parts cost | **$76.52 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $84.17 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Compact version | [`../yacht-club-compact-lego`](../yacht-club-compact-lego) |

![Front view](images/yacht_club_midsize_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Yacht_Club_Resort_Midsize_Instructions.pdf`](instructions/Yacht_Club_Resort_Midsize_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 66 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (60 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (6,060 pieces) and **25 kits** (15,150 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 17 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/yacht_club_midsize.mpd`](model/yacht_club_midsize.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 133 times, so one order holds up to **7 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 45 |
| On Pick a Brick (late-2025 listing) | 14 |
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 (including sets listed for 2027) | 1 |

**Sourcing uncertainties:**

- 46 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 17 lines have newer element IDs (retry file); an upload may match either.
- LEGO pauses Standard parts in the US and Canada from November 2, 2026; this kit uses none, but check that no line shows a longer delivery time.

## Cost assumptions and resale scenarios

These are planning numbers, not quotes. Upload the 10-kit file to see today's prices: the bag total is the real parts cost.

| Assumption | Value |
|---|---|
| Parts, as listed | Pick a Brick prices last seen in LEGO's 2022 Bestseller list and a late-2025 listing (offline data; lego.com could not be reached to check current prices) |
| Parts, 2026 estimate | +10% on the listed prices (stress case +20%); LEGO's September 14, 2026 repricing raised about a third of Pick a Brick elements by 16.7% on average, hitting tiles and small parts hardest |
| Packaging | $3.00 per kit: box, bags, a card with a link or QR code to the PDF booklet, tape and label (a printed colour booklet adds about $4.00) |
| Labour | $15.00/hour; 3 s per piece to count and bag from sorted stock, plus 6 min to pack |
| Etsy fees (US) | $0.20 listing + 6.5% transaction + 3% + $0.25 processing, on the price the buyer pays |
| Shipping | seller-paid (free shipping) $10.50 for a 1-2 lb box by USPS Ground Advantage; or the buyer pays postage |
| Prices | 1.6x / 2x / 2.5x the 2026 parts estimate, rounded up to $x9.99; market prices for custom kits were not researched for each resort |

| Per kit | Listed prices | 2026 estimate | Stress case |
|---|---|---|---|
| Parts | $76.52 | $84.17 | $91.82 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (606 pieces) | $9.07 | $9.07 | $9.07 |
| Before shipping | $88.59 | $96.25 | $103.90 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 133× Brick 1 x 2 (Sand Blue) $13.30, 2× Plate 16 x 16 (Dark Stone Grey) $6.08, 32× Plate 1 x 8 (Medium Stone Grey) $5.76.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $139.99 (23¢/piece) | $19.49 | 14% | $29.00 | 21% |
| $169.99 (28¢/piece) | $46.64 | 27% | $56.15 | 33% |
| $219.99 (36¢/piece) | $91.89 | 42% | $101.40 | 46% |

Break-even price: $118.45 with free shipping, $107.95 when the buyer pays postage (2026 estimate). The stress case adds about $7.65 per kit.

## Digital checks and physical prototype

`lego-kit/checks.py` checked the digital model ([`checks.md`](checks.md)):

| Check | Result |
|---|---|
| Collisions | Pass |
| Connections | Pass |
| Assembly order | Pass |
| Stability | Pass |

The model was checked on the computer only: parts fit the stud grid without overlaps and every part is held by a stud. **No physical prototype has been built.** Before selling, build one kit from the uploaded parts and the printed booklet, to confirm the parts arrive as listed, the build holds together when handled, and each step is clear.

## Building notes

- **Sections:**
  1. The display base, the drive, the lawns and the water
  2. The centre
  3. The balcony wings (build 2)
  4. The end bays (build 2)
  5. The porte-cochere
  6. The lighthouse, the lamps, the flagpole and the hydrangeas
- Each storey takes two steps (three on the balcony wings, with the railing): a course of sand blue 1×2 bricks with black bricks for the windows, then a band of light grey plates. The top band is white: the eaves. Sand blue is a Bestseller only as the 1×2 brick, so the walls are laid in pairs.
- The balcony wings have no side walls: the long plates of each floor band run from the balcony edge to the back wall and hold the wing together.
- Roofs go up one row of slopes at a time; the white slopes go at the gable ends.
- The cupola's finial and the lighthouse lantern sit on the single centre stud of a 2×2 dish.
- A “Build 2” badge means you build that module twice.

![Aerial view](images/yacht_club_midsize_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's mid-size format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Yacht Club Resort at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
