# Riviera Resort (mid-size): LEGO® display kit with build instructions

![The finished model](images/riviera_midsize_front_right.jpg)

A mid-size display model of Disney's Riviera Resort at Walt Disney World, part of the [resort collection](../resort-collection/README.md). The entrance front of the Riviera, laid out like the large Riviera build on a smaller base: a symmetric white European facade with black window grids, the central pavilion under a steep grey mansard with oval dormers and a white centre dormer, two taller corner towers with square grey domes and white lanterns, and two lower guest wings with red awnings and flat grey roofs. In front, the arched porte-cochere with its own mansard and round dormers stands over the drive, behind a garden of clipped hedges and red flowers, with palms along the drive.

**Signature features in this kit**

- A symmetric white entrance front with black window grids: the central pavilion between two towers and two wings, as in the large build
- The central pavilion's steep grey mansard with two oval dormers and the white centre dormer, over red awnings
- Two domed corner towers, six storeys tall, with square grey domes and white lanterns: the tallest point of the model
- Two lower guest wings with red awnings over the top-floor windows and flat grey roofs
- The porte-cochere over the drive: three white arches front and back and a grey mansard with three round dormers
- A formal garden of clipped hedges and red flowers, and four palms along the drive

**Left out**

- Storeys: three to six here, against eight to ten in the large build
- Most of the length of the guest wings, and the outer guest buildings
- The flags, the Skyliner station, the terraces and the pools

| | |
|---|---|
| Pieces | **604** (66 part/colour lines, 42 kinds of part, 9 colours) |
| Display base | 32 × 24 studs (25.6 × 19.2 cm), the same for every mid-size kit in the collection |
| Overall size | 25.6 × 19.2 cm, 13.9 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 51-page PDF, 61 steps, 6 sections |
| Parts cost | **$77.64 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $85.40 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Compact version | [`../riviera-compact-lego`](../riviera-compact-lego) |
| Large version | [`../riviera-lego`](../riviera-lego) |

![Front view](images/riviera_midsize_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Riviera_Resort_Midsize_Instructions.pdf`](instructions/Riviera_Resort_Midsize_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 61 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (66 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (6,040 pieces) and **25 kits** (15,100 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 26 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/riviera_midsize.mpd`](model/riviera_midsize.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 80 times, so one order holds up to **12 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 46 |
| On Pick a Brick (late-2025 listing) | 19 |
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 (including sets listed for 2027) | 1 |

**Sourcing uncertainties:**

- 47 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 26 lines have newer element IDs (retry file); an upload may match either.
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
| Parts | $77.64 | $85.40 | $93.17 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (604 pieces) | $9.05 | $9.05 | $9.05 |
| Before shipping | $89.69 | $97.45 | $105.22 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 44× Slope 75 2 x 1 x 3 (Dark Stone Grey) $7.92, 2× Plate 16 x 16 (Dark Stone Grey) $6.08, 80× Brick 1 x 1 (Black) $5.60.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $139.99 (23¢/piece) | $18.29 | 13% | $27.79 | 20% |
| $179.99 (30¢/piece) | $54.49 | 30% | $63.99 | 36% |
| $219.99 (36¢/piece) | $90.69 | 41% | $100.19 | 46% |

Break-even price: $119.78 with free shipping, $109.28 when the buyer pays postage (2026 estimate). The stress case adds about $7.76 per kit.

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
  2. The central pavilion
  3. The domed towers (build 2)
  4. The guest wings (build 2)
  5. The porte-cochere
  6. The garden and the palms
- Each storey is one course of white bricks with black bricks for the windows, then a band of white plates. Check the window pattern against the picture before you add the band, and keep black and white parts in separate trays.
- The red awnings are 1×1 slopes set into the top band, right above the top-floor windows. Point them outward.
- The mansards and the domes are rings of steep grey slopes. The oval dormers are white bricks with a hole, stacked between them.
- A “Build 2” badge means you build that module twice. Build both at the same time, one step at a time.

![Aerial view](images/riviera_midsize_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's mid-size format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Riviera Resort at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
