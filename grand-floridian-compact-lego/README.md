# Grand Floridian Resort (compact): LEGO® display kit with build instructions

![The finished model](images/grand_floridian_compact_front_right.jpg)

A compact display model of Disney's Grand Floridian Resort & Spa at Walt Disney World, part of the [compact resort collection](../resort-collection/README.md). The main building of the Grand Floridian: a white Victorian block with rows of windows, a steep red hipped roof, a big front gable and the little cupola on the ridge, flanked by two lower wings with red gables, and two palms out front.

This kit covers The Villas at Disney's Grand Floridian Resort as well: they share the property, and the compact model shows the part that makes it recognisable.

**Signature features in this kit**

- White Victorian main building with a grid of windows
- Steep red hipped roofs with white-trimmed front gables
- The cupola with its red spire on the main roof
- Two palms by the entrance walk

**Left out to keep it compact**

- The long guest wings and the outer buildings
- The porte-cochere, the marina and the gardens
- The veranda railings (shown as the window grid)

| | |
|---|---|
| Pieces | **327** (41 part/colour lines, 30 kinds of part, 7 colours) |
| Display base | 24 × 16 studs (19.2 × 12.8 cm), the same for every kit in the collection |
| Overall size | 19.2 × 12.8 cm, 11.7 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 31-page PDF, 37 steps, 4 sections |
| Parts cost | **$42.34 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $46.57 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Large version | [`../grand-floridian-lego`](../grand-floridian-lego) (the full display model) |

![Front view](images/grand_floridian_compact_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Grand_Floridian_Resort_Compact_Instructions.pdf`](instructions/Grand_Floridian_Resort_Compact_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 37 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (41 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (3,270 pieces) and **25 kits** (8,175 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 13 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/grand_floridian_compact.mpd`](model/grand_floridian_compact.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 41 times, so one order holds up to **24 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 28 |
| On Pick a Brick (late-2025 listing) | 12 |
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 (including sets listed for 2027) | 1 |

**Sourcing uncertainties:**

- 29 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 13 lines have newer element IDs (retry file); an upload may match either.
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
| Parts | $42.34 | $46.57 | $50.81 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (327 pieces) | $5.59 | $5.59 | $5.59 |
| Before shipping | $50.93 | $55.16 | $59.40 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 38× Slope 45 2 x 2 (Bright Red) $5.32, 41× Brick 1 x 2 (White) $4.10, 1× Plate 16 x 16 (Dark Stone Grey) $3.04.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $79.99 (24¢/piece) | $6.28 | 8% | $15.78 | 20% |
| $99.99 (31¢/piece) | $24.38 | 24% | $33.88 | 34% |
| $119.99 (37¢/piece) | $42.48 | 35% | $51.98 | 43% |

Break-even price: $73.05 with free shipping, $62.55 when the buyer pays postage (2026 estimate). The stress case adds about $4.23 per kit.

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
  1. The display base and the lawn
  2. The main building
  3. The wings (build 2)
  4. The palms (build 2)
- Each storey is one course of white bricks with black bricks for the windows, then a band of white plates. Keep black and white in separate trays.
- Roofs go up one row of slopes at a time. A few red bricks hidden under the gables have a step of their own, just before the slopes that rest on them.
- A “Build 2” badge means you build that module twice.

![Aerial view](images/grand_floridian_compact_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's compact format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Grand Floridian Resort & Spa at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
