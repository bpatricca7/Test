# lego-kit: from a design script to a LEGO instruction booklet

The shared toolkit behind [`../riviera-lego`](../riviera-lego),
[`../house-lego`](../house-lego), [`../grand-floridian-lego`](../grand-floridian-lego),
[`../boardwalk-lego`](../boardwalk-lego), and the drink kits
[`../pumpkin-spice-latte-lego`](../pumpkin-spice-latte-lego),
[`../pumpkin-spice-latte-clear-lego`](../pumpkin-spice-latte-clear-lego),
[`../whipped-latte-lego`](../whipped-latte-lego) and
[`../iced-pumpkin-latte-lego`](../iced-pumpkin-latte-lego).
A model is written as Python on the stud grid. The kit checks that it is buildable,
renders the steps, maps every part to LEGO element IDs, and prints an instruction
booklet and shopping lists.

| File | Purpose |
|---|---|
| `bricks.py` | Part catalogue (read from the LDraw library), `Model` with steps, sections and submodels, `Offset` for building a submodel in parent coordinates, fill helpers, colour/size rules, and `validate()` (no overlaps, every part attached by at least one stud) |
| `walls.py` | Brick courses around a right-angled outline, with interlocking corners, staggered joints, openings and mixed-colour masonry |
| `roofs.py` | Gable and hipped roofs from 33° or 45° slopes. Overlapping blocks form valleys, and a block can start higher up (a dormer on a roof slope). Also builds gable-end walls, trim-coloured rake slopes, ridge caps (with open cells for a chimney or turret) and hidden supports, in a step of their own just before the slopes they hold up |
| `ldraw_geom.py` | Reads LDraw part geometry (bounding boxes, stud positions) |
| `project.py` | Loads a project folder and writes its LDraw `.mpd` |
| `preview.py` | Quick check while designing: builds, validates and renders the finished model (or one submodel) from five angles |
| `render.py` | Renders every step, part and finished view with LeoCAD; writes `build/manifest.json` |
| `element_lookup.py` | Maps each LDraw part and colour to a LEGO element ID, a BrickLink item, a Rebrickable part, production years and Pick a Brick evidence |
| `export_parts.py` | Pick a Brick upload and retry files, mapping, BrickLink XML, Rebrickable CSV, parts per section; for kits, upload files for several copies and a cost sheet |
| `make_booklet.py` | Lays out the booklet in HTML and prints it to PDF with headless Chromium |
| `compact.py` | The compact resort collection's format: the 24×16 display base and black band, storey blocks, the shared palm, ground fill with Bestseller tile and plate sizes, and `compact_project()` for PROJECT |
| `checks.py` | Digital checks of every model (collisions, connections, assembly order, stability), written to `checks.md` |
| `pricing.py` | Cost and resale assumptions (parts uplift, packaging, labour, Etsy fees, shipping, price points), with sources and dates |
| `kit_readme.py` | Writes a compact kit's README from its design, parts files, checks and booklet |
| `collection_report.py` | Lineup, completion checklist and cost/resale comparison for `../resort-collection`, one kit per process |
| `avail.py`, `zoom.py`, `readme_images.py`, `compact_build.sh` | Part availability check, close-up renders, README images, and the compact kits' build script |
| `pab_live.py` | Converts a live snapshot of the US Pick a Brick Bestseller list into `DATA_DIR/pab_live.json`, which `element_lookup.py`, `export_parts.py` and `avail.py` then use for Bestseller status and prices |
| `pab_check.cjs` | Checks every element against Pick a Brick live (needs lego.com access; not yet run against the live site) |

## A project folder

```
my-model/
  design.py      PROJECT = dict(...)  # names and booklet text
                 def build(): return main_model, [main_model, submodel, ...]
  build.sh       copy from ../house-lego/build.sh
```

`./build.sh` writes `model/`, `build/` (renders, ignored by git), `data/elements.csv`,
`parts/` and `instructions/`. See `house-lego/design.py` for a full example with
walls, windows, crossing roofs, a porch, landscaping and a car, and
`grand-floridian-lego/design.py` for verandas, hipped roofs with gables and dormers,
a cupola and chimneys. `boardwalk-lego/design.py` builds a round arch from inverted
slopes and mounts parts on side studs (the gold lettering).

While designing, `python3 ../lego-kit/preview.py . [submodel.ldr]` renders quick
views into `build/preview/`. `RENDER_WORKERS=2` limits parallel LeoCAD renders when
several builds share a machine.

The compact resort kits are documented in
[`../resort-collection/DESIGN_GUIDE.md`](../resort-collection/DESIGN_GUIDE.md).

Steps are drawn from the front right. A model that is best seen from another side can
set `model.camera = (lat, lon)`, for example `(28, -32)` for the front left (see
`whipped-latte-lego/design.py`, whose handle and bowl are on the left).

Options in `PROJECT` for a kit you make many copies of (see
`pumpkin-spice-latte-lego/design.py`):
- `bestseller_only=True`: `export_parts.py` stops with a list of parts that aren't
  in Pick a Brick's Bestseller range or aren't in 2025 or later sets.
- `batch_sizes=[10, 25]`: also writes `parts/pick_a_brick_upload_x10.csv` and
  `_x25.csv`, prints how many copies fit under the 999-per-element limit, and writes
  `parts/kit_cost.csv` with the cost of one copy.
- `main_parts_label`: the name of the main model's own parts in
  `parts_by_section.csv`.
- `clear_alpha=48`: draws Trans-Clear parts more see-through in the renders
  (LeoCAD's default alpha is 128). The renders go through a linked copy of the
  LDraw library in `build/ldraw` with that one colour changed. Use it for clear glass
  builds, so what's inside shows as it does in real clear parts.

Clear parts that are Bestsellers include the 1×6×5, 1×4×3, 1×2×3 and 1×2×2 panels
(`panel1x6x5` and so on), the 1×2×5 brick and the 1×2 brick without bottom tube.
The clear 1×1 round brick, 1×2 plate, 1×1 tile and 1×1 round tile are Bestsellers
too. The flat side of a panel is at the back at rotation 0.

## Requirements

- Ubuntu packages: `leocad ldraw-parts xvfb fonts-inter`
- Python: `pillow pymupdf`
- Node with the `playwright` package and a Chromium build (prints the PDF)

## Element data (`DATA_DIR`)

`element_lookup.py` runs offline against a folder holding:
- the Rebrickable database dump: `rb/elements.csv`, `parts.csv`, `sets.csv`,
  `inventories.csv`, `inventory_parts.csv`;
- two Pick a Brick listings: `pab2022.json` (about 1,400 Bestseller elements) and
  `pab2025.json` (bricks and plates);
- the BrickLink Studio element map:
  `repos/vaultcrest_moc-source/cache/studio_reference_files/ElementId.json`;
- optionally `pab_live.json`: the current US Bestseller list with unit prices,
  made by `python3 pab_live.py <snapshot.json> $DATA_DIR` from a snapshot of
  LEGO's `PickABrickQuery` (every AVAILABLE element with `deliveryChannel=pab`).
  The first one is dated 17 October 2026: 10,889 elements, 2,939 designs, 98
  colours. When it is present:
  - element IDs on the live list are chosen first, including new IDs that the
    Rebrickable dump doesn't know yet, matched by design ID and LEGO colour name;
  - its prices are used, shown as "live <date>" in `parts/kit_cost.csv`;
  - a part on it passes the Bestseller-only check;
  - `export_parts.py` warns about parts that pass only the older rule but
    weren't on the list that day, whether out of the range or out of stock.

  A copy of each imported snapshot is kept in `lego-kit/pab_live/`, and is used
  when `DATA_DIR` has no `pab_live.json`.
- **Without the Rebrickable dump**, point `DATA_DIR` at any folder without `rb/`,
  for example `DATA_DIR=lego-kit/pab_live`. Element IDs and prices then come from
  the live list alone (`element_lookup.live_only`), and set years are left blank.
  LDraw numbers that differ from LEGO's design IDs are mapped in `LEGO_DESIGN`.
  A part that isn't on the live list gets no element ID and stops the
  Bestseller check, so add an alias or choose another part. It has no stock counts or order caps,
  and prices change, so a new snapshot should be imported before ordering.

Without `DATA_DIR`, a project keeps its existing `data/elements.csv`.

Element choice rules used by the designs: only parts in Pick a Brick's
Bestseller range (up to 999 per order): on the live list when there is one,
otherwise on the 2022 Bestseller list and still in LEGO sets in 2025 or later.
Standard-range parts (often capped at 10 per order) are used 10 or fewer at a time.
