# Pop Century Resort (compact): LEGO® display kit with build instructions

![The finished model](images/pop_century_compact_front_right.jpg)

A compact display model of Disney's Pop Century Resort at Walt Disney World, part of the [resort collection](../resort-collection/README.md). A short section of a Pop Century guest building: four storeys of white rooms with the open walkways and turquoise railings along the front, and a bright stair tower at each end. On the lawn in front stand the giant decade icons: two bowling pins, white with a red band, and a yo-yo standing on its edge.

**Signature features in this kit**

- Four-storey white guest building with open walkways and turquoise railings
- Two turquoise stair towers with yellow landings and sign boards
- Two giant bowling pins, white with a red band
- A giant red yo-yo standing on its edge, with the white hub in its groove

**Left out to keep it compact**

- The long guest wings, the other decades' buildings and their icons
- The decade names and signs, and any brand-name toys or characters
- Classic Hall, the pools and the Skyliner station

| | |
|---|---|
| Pieces | **315** (60 part/colour lines, 36 kinds of part, 8 colours) |
| Display base | 24 × 16 studs (19.2 × 12.8 cm), the same for every compact kit in the collection |
| Overall size | 19.2 × 12.8 cm, 8.3 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 43-page PDF, 43 steps, 5 sections |
| Parts cost | **$42.25 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $46.48 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |

![Front view](images/pop_century_compact_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Pop_Century_Resort_Compact_Instructions.pdf`](instructions/Pop_Century_Resort_Compact_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 43 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (60 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (3,150 pieces) and **25 kits** (7,875 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 28 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/pop_century_compact.mpd`](model/pop_century_compact.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 26 times, so one order holds up to **38 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 37 |
| On Pick a Brick (late-2025 listing) | 23 |

**Sourcing uncertainties:**

- 37 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 28 lines have newer element IDs (retry file); an upload may match either.
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
| Parts | $42.25 | $46.48 | $50.70 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (315 pieces) | $5.44 | $5.44 | $5.44 |
| Before shipping | $50.69 | $54.91 | $59.14 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 20× Brick 1 x 4 (Medium Azur) $3.20, 1× Plate 16 x 16 (Dark Stone Grey) $3.04, 20× Plate 2 x 4 (Bright Yellow) $2.80.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $79.99 (25¢/piece) | $6.53 | 8% | $16.03 | 20% |
| $99.99 (32¢/piece) | $24.63 | 25% | $34.13 | 34% |
| $119.99 (38¢/piece) | $42.73 | 36% | $52.23 | 44% |

Break-even price: $72.78 with free shipping, $62.28 when the buyer pays postage (2026 estimate). The stress case adds about $4.23 per kit.

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
  2. The guest building
  3. The stair towers (build 2)
  4. The giant yo-yo
  5. The bowling pins (build 2)
- The walkways have no posts: each band of plates is held by the wall behind it and reaches out one stud over the walkway.
- The bowling pins' necks sit on the single stud in the middle of the dish.
- A “Build 2” badge means you build that module twice.

![Aerial view](images/pop_century_compact_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's compact format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Pop Century Resort at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
