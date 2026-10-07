# All-Star Music Resort (compact): LEGO® display kit with build instructions

![The finished model](images/all_star_music_compact_front_right.jpg)

A compact display model of Disney's All-Star Music Resort at Walt Disney World, part of the [compact resort collection](../resort-collection/README.md). A short section of one of the bright guest buildings of All-Star Music: three storeys of rooms opening onto outdoor walkways with yellow railings, under a purple-capped parapet. Its stair tower is a giant jukebox with a rounded top, glowing light tubes and a speaker grille. A giant guitar stands on end at the other end of the building, and two giant drums sit on the lawn.

**Signature features in this kit**

- Three-storey guest building with open walkways, yellow railings, purple doors and a purple-capped parapet
- The jukebox stair tower: red and yellow light tubes, a glowing window, a speaker grille and a rounded red top with a white and orange arch
- A giant red guitar standing on end, its neck reaching far above the roofline
- Two giant drums by the walk

**Left out to keep it compact**

- The rest of the guest buildings and the other music-themed sections
- Melody Hall, the pools and the parking lots
- The other giant instruments (maracas, saxophones, cowboy boots)

| | |
|---|---|
| Pieces | **278** (46 part/colour lines, 30 kinds of part, 12 colours) |
| Display base | 24 × 16 studs (19.2 × 12.8 cm), the same for every kit in the collection |
| Overall size | 19.2 × 12.8 cm, 12.6 cm tall |
| Scale | about 1:250 (one storey = 4 plates, 1 stud ≈ 2 m), like the large resort models |
| Instructions | 36-page PDF, 33 steps, 5 sections |
| Parts cost | **$33.58 per kit** at the Pick a Brick prices last seen (2022 and late 2025); about $36.94 with 2026 price rises (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |

![Front view](images/all_star_music_compact_front.jpg)

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/All-Star_Music_Resort_Compact_Instructions.pdf`](instructions/All-Star_Music_Resort_Compact_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 33 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (46 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (2,780 pieces) and **25 kits** (6,950 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |
| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer element IDs for 14 of the parts, for lines the upload doesn't match |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/all_star_music_compact.mpd`](model/all_star_music_compact.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The design, written as code on the stud grid |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the retry file or in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this kit uses most is needed 23 times, so one order holds up to **43 kits**.

**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in 2026 | 30 |
| On Pick a Brick (late-2025 listing) | 16 |

**Sourcing uncertainties:**

- 30 lines are backed only by LEGO's 2022 Bestseller list, so their range and price today are not confirmed.
- 14 lines have newer element IDs (retry file); an upload may match either.
- Parts in fewer than 10 sets since 2024 (more likely to sell out): Slope 65 2 x 1 x 2 Bright Red (9 sets).
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
| Parts | $33.58 | $36.94 | $40.30 |
| Packaging | $3.00 | $3.00 | $3.00 |
| Labour (278 pieces) | $4.97 | $4.97 | $4.97 |
| Before shipping | $41.55 | $44.91 | $48.27 |
| Seller-paid shipping | $10.50 | $10.50 | $10.50 |

Biggest cost lines: 1× Plate 16 x 16 (Dark Stone Grey) $3.04, 23× Brick 1 x 2 (Medium Azur) $2.30, 3× Plate 4 x 12 (White) $2.10.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $59.99 (22¢/piece) | $-1.57 | -3% | $7.93 | 13% |
| $79.99 (29¢/piece) | $16.53 | 21% | $26.03 | 33% |
| $99.99 (36¢/piece) | $34.63 | 35% | $44.13 | 44% |

Break-even price: $61.73 with free shipping, $51.23 when the buyer pays postage (2026 estimate). The stress case adds about $3.36 per kit.

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
  3. The jukebox stair tower
  4. The giant guitar
  5. The drums
- Each storey of the guest building is one course of bricks with round white columns in front, then a white deck that reaches out over the walkway. On the upper storeys the yellow railing tiles sit on the edge of the deck, between the columns.
- Slopes shape the jukebox top and the guitar body. Check which way each slope faces in the picture before pressing it down.
- Keep the white, purple and yellow parts in separate trays.

![Aerial view](images/all_star_music_compact_aerial.jpg)

## How it was made

The model is generated by [`design.py`](design.py) with the shared toolkit in [`../lego-kit`](../lego-kit), in the collection's compact format (`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)
```

lego.com, BrickLink and Rebrickable could not be reached from the environment this was made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` checks every element live.

## Disclaimer

An unofficial fan design (MOC) inspired by Disney's All-Star Music Resort at Walt Disney World. It is not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark note in the [collection README](../resort-collection/README.md) before selling.
