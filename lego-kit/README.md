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
views into `build/preview/`.

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
  `repos/vaultcrest_moc-source/cache/studio_reference_files/ElementId.json`.

Without `DATA_DIR`, a project keeps its existing `data/elements.csv`.

Element choice rules used by the designs: only parts that are in current
production and were in Pick a Brick's Bestseller range (up to 999 per order).
Standard-range parts (often capped at 10 per order) are used 10 or fewer at a time.
