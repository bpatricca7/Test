# Yacht Club Resort (compact): LEGO® display kit with build instructions

![The finished model](images/yacht_club_compact_front_right.jpg)

A compact display model of Disney's Yacht Club Resort at Walt Disney World, part of the [resort collection](../resort-collection/README.md). The Yacht Club as a New England seaside hotel: grey-blue clapboard walls with rows of windows, two tall end pavilions with crisp white-trimmed front gables under dark grey roofs, a lower centre range with a white entrance porch and the white cupola on its ridge, and the lighthouse at the end of its pier out in the water.

**Signature features in this kit**

- Grey-blue clapboard walls (sand blue) with rows of windows
- Two end pavilions with white-trimmed front gables under dark grey roofs
- Crisp white eaves, gable rakes and entrance porch with a railing
- The white cupola with a dark dome on the centre ridge
- The lighthouse at the end of its pier, white with a red top, in a patch of blue water

**Left out to keep it compact**

- The long guest wings and the Beach Club next door
- The porte-cochere, the marina and the boardwalk on Crescent Lake
- The balconies and window trim (shown as plain rows of windows)

| | |
|---|---|
| Pieces | **319** (38 part/colour lines, 27 kinds of part, 10 colours) |
| Display base | 24 × 16 studs (19.2 × 12.8 cm), the same for every compact kit in the collection |
| Overall size | 19.2 × 12.8 cm, 9.8 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 31-page PDF, 36 steps, 4 sections |
| Parts cost | **$41.79 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $45.97 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Mid-size version | [`../yacht-club-midsize-lego`](../yacht-club-midsize-lego) |

![Front view](images/yacht_club_compact_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Yacht_Club_Resort_Compact_Instructions.pdf`](instructions/Yacht_Club_Resort_Compact_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 36 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (38 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (3,190 pieces) and **25 kits** (7,975 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 10 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/yacht_club_compact.mpd`](model/yacht_club_compact.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 87 times, so one order holds up to **11 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 30 |
| On Pick a Brick (late-2025 listing) | 8 |

**Sourcing uncertainties:**

- 30 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 10 lines have newer element IDs (retry file); an upload may match either.
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
| Parts | $41.79 | $45.97 | $50.15 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (319 pieces) | $5.49 | $5.49 | $5.49 |
| Before shipping | $50.28 | $54.46 | $58.64 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 87× Brick 1 x 2 (Sand Blue) $8.70, 78× Brick 1 x 1 (Black) $5.46, 1× Plate 16 x 16 (Dark Stone Grey) $3.04.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $79.99 (25¢/piece) | $6.98 | 9% | $16.49 | 21% |
| $99.99 (31¢/piece) | $25.08 | 25% | $34.59 | 35% |
| $119.99 (38¢/piece) | $43.18 | 36% | $52.69 | 44% |

Break-even price: $72.27 with free shipping, $61.77 when the buyer pays postage (2026 estimate). The stress case adds about $4.18 per kit.

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
  1. The display base, the lawn and the water
  2. The centre range
  3. The end pavilions (build 2)
  4. The lighthouse
- Each storey is one course of sand blue 1×2 bricks with black 1×1 bricks for the windows, then a band of light grey plates. The top band is a white plate: the eaves.
- Roofs go up one row of slopes at a time. The white slopes go at the gable ends.
- The lighthouse's lantern and cap sit on the centre stud of the white dome.
- A “Build 2” badge means you build that module twice.

![Aerial view](images/yacht_club_compact_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's compact format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Yacht Club Resort at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
