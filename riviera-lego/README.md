# Riviera Resort: micro-scale LEGO® model with build instructions

![The finished model](images/riviera_front_right.jpg)

A buildable LEGO model of the grand entrance of the Riviera Resort (Walt Disney
World). It includes:
- the arched porte-cochère
- the central pavilion with its steep mansard roof and oval dormers
- two domed corner pavilions
- two guest wings with red awnings
- the lawn, lined with palms

Every part is a real LEGO element in current production. Each one is listed with
its LEGO Element ID, so you can order it from LEGO Pick a Brick on lego.com.

| | |
|---|---|
| Pieces | **1,746** (87 kinds, 10 colours) |
| Footprint | 48 × 32 studs (38.4 × 25.6 cm) |
| Height | 16 cm at the domes |
| Scale | about 1:250 (1 stud ≈ 2 m, one storey = 4 plates) |
| Instructions | 74-page PDF, 94 steps, 6 sections |
| Estimated cost | about US$205 for the 1,628 pieces with a known Pick a Brick price (2022–2025 prices); allow about US$220–240 in total |

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Riviera_Resort_Instructions.pdf`](instructions/Riviera_Resort_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 94 numbered steps with parts callouts, gallery, full inventory with Element IDs, ordering guide |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Shopping list for **LEGO Pick a Brick**: Element ID, quantity, description, LEGO colour, design ID, alternate IDs, availability notes, last price seen |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml) | BrickLink wanted list (BrickLink → Want → Upload) |
| [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | Rebrickable part-list import (`Part,Color,Quantity`) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, to pre-sort before you build |
| [`model/riviera_resort.mpd`](model/riviera_resort.mpd) | The digital model (LDraw MPD with build steps and submodels). Opens in BrickLink Studio, LeoCAD, LDCad and LDView |
| [`data/elements.csv`](data/elements.csv) | How each LDraw part and colour maps to a LEGO Element ID, BrickLink item, Rebrickable part and production data |
| `tools/` | The generator: design, validation, rendering, element lookup, booklet |

## Ordering the parts

1. Open **lego.com → Pick and Build → Pick a Brick**.
2. Work down `parts/pick_a_brick_list.csv`. Search each **Element ID** and add the
   quantity. The same list, with pictures, is at the back of the booklet.
3. If an ID doesn't show up, try the IDs in the *Alternate element IDs* column. For
   example, LEGO gave many white parts new IDs in 2025. You can also search by
   design ID and colour.
4. For anything Pick a Brick doesn't have, upload `parts/bricklink_wanted_list.xml`
   to BrickLink, or import `parts/rebrickable_parts.csv` into Rebrickable and
   compare stores.

The biggest line items are 378 white and 360 black 1×1 bricks (3005). If Pick a
Brick caps the quantity per element, split them across two orders. Order a few
spares of the small parts.

### How confident the IDs are

Every element was checked against an August 2026 snapshot of Rebrickable's element
database. Every element in the model appears in LEGO sets released in 2026, so all
of them are in current production.
- **21 line items** were listed on Pick a Brick in a late-2025 scrape. That scrape
  only covers bricks and plates.
- **The other 66** are current parts, most of them also listed in a 2022 Pick a
  Brick scrape. They are marked *likely*.

Pick a Brick stock changes all the time, so none of this guarantees it has a part
today.

Two substitutions to know about:
- **Flags**: the model draws the 2×2 flag with LDraw part 2335, the old mould.
  Order the current flag, **design 80326** (Red 6365459, Blue 6365486).
- **Domes**: the tower domes are built from steep slopes (60481), a 4×4 plate and
  a 2×2 dish, instead of the retired dark grey 4×4 dish.

## Building notes

- **Sections**:
  1. The grounds
  2. The central pavilion
  3. The domed pavilions (build 2)
  4. The guest wings (build 2)
  5. The porte-cochère, built in place
  6. Palms (build 12), flowers and flags
- **Modules**: each building is built separately and then set on the base, like a
  LEGO modular building.
- **Facades**: every storey is one course of bricks (a black 1×1 for each window,
  white for the pillars) topped with a band of white plates. Some floors are solid
  white plates, which stiffens the hollow buildings.
- **Top floors**: red 1×1 cheese slopes over the top-floor windows make the red
  awnings.
- **Base**: six 16×16 dark grey plates. The lawn, drive and pavement layers are
  laid so that none of their joints line up with the joints between the base
  plates, which locks the base together.

![Instruction page samples](images/sample_step_page.jpg)

## How it was made (and how to change it)

The model is written as code (`tools/riviera.py`) on a stud grid. `tools/bricks.py`
reads each part's real shape from the official LDraw parts library. Before any
files are written, it checks two things:
- no two elements overlap;
- every element is clutched by at least one stud to the rest of the model, so
  there are no floating pieces.

The booklet renders come from LeoCAD. Parts added in each step are outlined in
orange.

To rebuild after changing the design:

```bash
sudo apt-get install leocad ldraw-parts xvfb fonts-inter   # Ubuntu 24.04
pip install numpy pillow pymupdf
# node + playwright (with Chromium) are used to print the PDF
DATA_DIR=/path/to/element-data tools/build_all.sh
```

`DATA_DIR` is only needed to refresh `data/elements.csv`. Without it, the existing
file is used.

### Where the element IDs come from

- [Rebrickable](https://rebrickable.com/downloads/) database dump: elements,
  parts, sets and inventories (August 2026 snapshot).
- Two community scrapes of LEGO Pick a Brick, from 2022 and late 2025, used for
  "was it listed" and the prices.
- The BrickLink Studio element map, used for BrickLink item numbers.

## Disclaimer

This is an unofficial fan design (a "MOC"). It is not affiliated with, sponsored
by or endorsed by The LEGO Group or Disney. LEGO® is a trademark of The LEGO Group.
The Riviera Resort is a Disney property. This model is an architectural tribute
for personal use.
