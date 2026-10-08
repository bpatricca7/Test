# Grand Floridian Resort (mid-size): LEGO® display kit with build instructions

![The finished model](images/grand_floridian_midsize_front_right.jpg)

A mid-size display model of Disney's Grand Floridian Resort & Spa at Walt Disney World, part of the [resort collection](../resort-collection/README.md). The main building of the Grand Floridian with its entrance: the five-storey central block wrapped in white verandas, its steep red roof and big front gable with an arched window, and the cupola with its red spire on top; two lower wings with verandas, hipped red roofs, a white-trimmed gable and a dormer each; and the porte-cochere over the drive, with white columns, an arched entrance and its own red gable. A round fountain and two palms stand on the lawn in front.

This kit covers The Villas at Disney's Grand Floridian Resort as well: they share the property, and the mid-size model shows the part that makes it recognisable.

**Signature features in this kit**

- Five-storey central block wrapped in white verandas: railings and slim columns in front of dark recesses
- The steep front gable with an arched window and a louvre, and the cupola with its red spire
- Two wings with verandas, red hipped roofs, a white-trimmed gable and a dormer
- The porte-cochere over the drive: white columns, the entrance arch and a red roof with its own gable
- A round white fountain on the entrance walk and two palms on the lawn

**Left out**

- The outer guest lodges, the villas and the marina
- The chimneys, turrets and the smaller gables of the roofs
- The lamp posts, hedges and flower beds of the gardens

| | |
|---|---|
| Pieces | **550** (58 part/colour lines, 43 kinds of part, 8 colours) |
| Display base | 32 × 24 studs (25.6 × 19.2 cm), the same for every mid-size kit in the collection |
| Overall size | 25.6 × 19.2 cm, 13.9 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 63-page PDF, 82 steps, 6 sections |
| Parts cost | **$76.54 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $84.19 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Compact version | [`../grand-floridian-compact-lego`](../grand-floridian-compact-lego) |
| Large version | [`../grand-floridian-lego`](../grand-floridian-lego) |

![Front view](images/grand_floridian_midsize_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Grand_Floridian_Resort_Midsize_Instructions.pdf`](instructions/Grand_Floridian_Resort_Midsize_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 82 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (58 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (5,500 pieces) and **25 kits** (13,750 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 24 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/grand_floridian_midsize.mpd`](model/grand_floridian_midsize.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 74 times, so one order holds up to **13 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 43 |
| On Pick a Brick (late-2025 listing) | 14 |
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 (including sets listed for 2027) | 1 |

**Sourcing uncertainties:**

- 44 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 24 lines have newer element IDs (retry file); an upload may match either.
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
| Parts | $76.54 | $84.19 | $91.85 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (550 pieces) | $8.38 | $8.38 | $8.38 |
| Before shipping | $87.92 | $95.57 | $103.22 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 74× Slope 45 2 x 2 (Bright Red) $10.36, 2× Plate 16 x 16 (Dark Stone Grey) $6.08, 42× Brick 1 x 2 (Black) $4.20.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $139.99 (25¢/piece) | $20.17 | 14% | $29.67 | 21% |
| $169.99 (31¢/piece) | $47.32 | 28% | $56.82 | 33% |
| $219.99 (40¢/piece) | $92.57 | 42% | $102.07 | 46% |

Break-even price: $117.70 with free shipping, $107.20 when the buyer pays postage (2026 estimate). The stress case adds about $7.65 per kit.

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
  1. The display base, the drive and the lawns
  2. The main building
  3. The left wing
  4. The right wing
  5. The porte-cochere
  6. The fountain and the palms
- Each storey takes three steps: the walls (black behind the veranda), the veranda railing with its slim round columns, then the white floor band that ties them together. Keep black and white parts in separate trays.
- The two wings are mirror images, each with its own pages: the gable goes at the outer end.
- Roofs go up one row of slopes at a time. Red bricks hidden under the gables and dormers have a step of their own, just before the slopes that rest on them.
- The cupola's spire sits on a 1×2 plate with one stud, laid across the two below it.
- A “Build 2” badge means you build that module twice.

![Aerial view](images/grand_floridian_midsize_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's mid-size format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Grand Floridian Resort & Spa at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
