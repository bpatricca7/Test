# Animal Kingdom Lodge (mid-size): LEGO® display kit with build instructions

![The finished model](images/animal_kingdom_lodge_midsize_front_right.jpg)

A mid-size display model of Disney's Animal Kingdom Lodge at Walt Disney World, part of the [resort collection](../resort-collection/README.md). The arrival front of Jambo House at Animal Kingdom Lodge, as a guest sees it from the drive: the porte-cochere over the drive, a tall, steep, thatched kraal-style roof on heavy timber posts; the lobby behind it, a timber-framed glass front under a two-tier thatched roof with a clerestory of timber and glass; and the guest wings with dark timber balconies and hipped roofs, stepping back and down on both sides like the curving horseshoe. An acacia, a rock outcrop and grasses stand on the lawn by the drive.

This kit covers Jambo House, Kidani Village (Disney's Animal Kingdom Villas) as well: they share the property, and the mid-size model shows the part that makes it recognisable.

**Signature features in this kit**

- The porte-cochere over the drive: a tall, steep thatched kraal-style roof with a timber finial, on four heavy timber posts and beams
- The lobby behind it: a timber-framed glass front and a two-tier thatched roof, with a clerestory of timber and glass, a timber ridge beam and two finials
- Guest wings with dark timber balconies and hipped reddish-brown roofs, stepping back and down on both sides (four storeys, then two) like the curving horseshoe
- Warm, earthy walls in tan on a dark tan base, with reddish-brown timber floor bands
- The drive looping under the porte-cochere, an acacia with two flat layers of canopy, a rock outcrop and grasses

**Left out**

- The rest of the horseshoe, the savannas and Kidani Village
- The pool, the lobby interior, the carved details and the lanterns
- Most of the landscaping

| | |
|---|---|
| Pieces | **560** (56 part/colour lines, 34 kinds of part, 6 colours) |
| Display base | 32 × 24 studs (25.6 × 19.2 cm), the same for every mid-size kit in the collection |
| Overall size | 25.6 × 19.2 cm, 14.2 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 52-page PDF, 67 steps, 6 sections |
| Parts cost | **$77.97 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $85.77 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Compact version | [`../animal-kingdom-lodge-compact-lego`](../animal-kingdom-lodge-compact-lego) |

![Front view](images/animal_kingdom_lodge_midsize_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Animal_Kingdom_Lodge_Midsize_Instructions.pdf`](instructions/Animal_Kingdom_Lodge_Midsize_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 67 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (56 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (5,600 pieces) and **25 kits** (14,000 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 3 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/animal_kingdom_lodge_midsize.mpd`](model/animal_kingdom_lodge_midsize.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 56 times, so one order holds up to **17 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 33 |
| On Pick a Brick (late-2025 listing) | 23 |

**Sourcing uncertainties:**

- 33 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 3 lines have newer element IDs (retry file); an upload may match either.
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
| Parts | $77.97 | $85.77 | $93.56 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (560 pieces) | $8.50 | $8.50 | $8.50 |
| Before shipping | $89.47 | $97.27 | $105.06 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 56× Slope 65 2 x 1 x 2 (Brick Yellow) $7.28, 2× Plate 16 x 16 (Dark Stone Grey) $6.08, 36× Slope 45 2 x 2 (Brick Yellow) $5.04.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $139.99 (25¢/piece) | $18.47 | 13% | $27.98 | 20% |
| $179.99 (32¢/piece) | $54.67 | 30% | $64.18 | 36% |
| $219.99 (39¢/piece) | $90.87 | 41% | $100.38 | 46% |

Break-even price: $119.58 with free shipping, $109.08 when the buyer pays postage (2026 estimate). The stress case adds about $7.80 per kit.

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
  2. The lobby
  3. The inner guest wings (build 2)
  4. The outer guest wings (build 2)
  5. The porte-cochere
  6. The acacia, the rocks and the grasses
- The thatched roofs go up one ring of steep slopes at a time. Hidden tan bricks inside each ring hold up the next one; they have a step of their own.
- On the guest wings, each balcony railing is a reddish-brown tile one stud in front of the black glass; the floor plates above tie the walls together.
- The finials sit on plates with one centre stud, half a stud off the grid.
- A “Build 2” badge means you build that module twice.

![Aerial view](images/animal_kingdom_lodge_midsize_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's mid-size format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Animal Kingdom Lodge at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
