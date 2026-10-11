# Saratoga Springs Resort (mid-size): LEGO® display kit with build instructions

![The finished model](images/saratoga_springs_midsize_front_right.jpg)

A mid-size display model of Disney's Saratoga Springs Resort & Spa at Walt Disney World, part of the [resort collection](../resort-collection/README.md). The arrival front of the Carriage House at Saratoga Springs, in the colours the resort wears today: mint-green shingle with tan trim, a deeper green under the porch, red-and-white striped awnings and warm brown roofs. The round lobby tower stands at the centre, built as an octagon with clipped corners: a tan band runs up its front to a white louvre that pokes into the brown cone roof, under a tan cornice and a black finial. A porch on slim tan posts curves round the foot of the tower behind a red-and-white striped edge, and a white picket fence between chunky river-stone pillars runs along the sidewalk. On the left, a two-storey mint-green wing has a front gable, a balcony with a brown railing beside the tower, a green awning over the shop front and a grey roof with a chimney; on the right, a cream building has red awnings over its windows and a small white-trimmed gable and a white cupola with a spire on its terracotta roof. Two trees stand behind.

This kit covers The Treehouse Villas at Disney's Saratoga Springs Resort as well: they share the property, and the mid-size model shows the part that makes it recognisable.

**Signature features in this kit**

- The round lobby tower, five storeys tall: an octagon with clipped corners in mint-green shingle over a deeper green ground floor
- A tan band up the front of the tower to a white louvre that pokes into the brown cone roof, a tan cornice under the eaves and a black finial on top
- The porch round the foot of the tower: slim tan posts and a red-and-white striped edge in front of a brown porch roof
- A white picket fence between chunky river-stone pillars of tan and grey round bricks, along the sidewalk
- A two-storey mint-green wing: a front gable with a small window, a balcony with tan posts and a brown railing, a green awning over the shop front and a grey roof with a chimney
- A cream building with red awnings over its windows, a white-trimmed gable and a white cupola with a spire on its terracotta roof

**Left out**

- The sign and the horse logo on the tower, and all other lettering
- The rest of the guest buildings, the Treehouse Villas, the pools and the spa
- The street, the lamp posts and the rest of the gardens

| | |
|---|---|
| Pieces | **660** (87 part/colour lines, 38 kinds of part, 12 colours) |
| Display base | 32 × 24 studs (25.6 × 19.2 cm), the same for every mid-size kit in the collection |
| Overall size | 25.6 × 19.2 cm, 13.0 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 56-page PDF, 65 steps, 5 sections |
| Parts cost | **$75.85 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $83.44 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Compact version | [`../saratoga-springs-compact-lego`](../saratoga-springs-compact-lego) |

![Front view](images/saratoga_springs_midsize_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Saratoga_Springs_Resort_Midsize_Instructions.pdf`](instructions/Saratoga_Springs_Resort_Midsize_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 65 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (87 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (6,600 pieces) and **25 kits** (16,500 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 14 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/saratoga_springs_midsize.mpd`](model/saratoga_springs_midsize.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 44 times, so one order holds up to **22 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 54 |
| On Pick a Brick (late-2025 listing) | 31 |
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2025 | 1 |
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 (including sets listed for 2027) | 1 |

**Sourcing uncertainties:**

- 56 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 14 lines have newer element IDs (retry file); an upload may match either.
- Parts in fewer than 10 sets since 2024 (more likely to sell out): Fence Spindled 1 x 4 x 2 White (7 sets).
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
| Parts | $75.85 | $83.44 | $91.02 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (660 pieces) | $9.75 | $9.75 | $9.75 |
| Before shipping | $88.60 | $96.19 | $103.77 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 2× Plate 16 x 16 (Dark Stone Grey) $6.08, 44× Brick 1 x 2 (Sand Green) $4.40, 9× Plate 4 x 6 (Dark Green) $3.87.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $139.99 (21¢/piece) | $19.56 | 14% | $29.06 | 21% |
| $169.99 (26¢/piece) | $46.71 | 27% | $56.21 | 33% |
| $209.99 (32¢/piece) | $82.91 | 39% | $92.41 | 44% |

Break-even price: $118.38 with free shipping, $107.88 when the buyer pays postage (2026 estimate). The stress case adds about $7.58 per kit.

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
  1. The display base, the sidewalk and the lawns
  2. The Carriage House tower
  3. The mint-green wing
  4. The cream building
  5. The fence and the garden: the stone pillars, the picket fence, shrubs and trees
- The tower is an octagon: its walls step in at the corners. Lay each course side by side with the picture; its joints cross those of the course below.
- The porch's tan deck plates reach from the posts onto the tower walls and tie the porch to the tower. The striped edge alternates red and white, a plate and a slope on each.
- The cone roof goes up one ring of slopes at a time. Hidden brown bricks under a few slopes hold up the ring above; they have a step of their own.
- The tower's finial and the cupola's spire sit on the centre stud of a 2×2 dish, half a stud off the grid. The cupola's white bar pushes into the top of its cone.
- A “Build 6” or “Build 2” badge means you build that module that many times.

![Aerial view](images/saratoga_springs_midsize_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's mid-size format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's Saratoga Springs Resort & Spa at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
