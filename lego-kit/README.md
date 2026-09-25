# lego-kit: from a design script to a LEGO instruction booklet

The shared toolkit behind [`../riviera-lego`](../riviera-lego) and
[`../house-lego`](../house-lego). A model is written as Python on the stud grid.
The kit checks that it is buildable, renders the steps, maps every part to LEGO
element IDs, and prints an instruction booklet and shopping lists.

| File | Purpose |
|---|---|
| `bricks.py` | Part catalogue (read from the LDraw library), `Model` with steps, sections and submodels, `Offset` for building a submodel in parent coordinates, fill helpers, colour/size rules, and `validate()` (no overlaps, every part attached by at least one stud) |
| `walls.py` | Brick courses around a right-angled outline, with interlocking corners, staggered joints, openings and mixed-colour masonry |
| `roofs.py` | Gable roofs from 33° or 45° slopes; overlapping blocks form valleys, gable-end walls, trim-coloured rake slopes, ridge caps and hidden supports |
| `ldraw_geom.py` | Reads LDraw part geometry (bounding boxes, stud positions) |
| `project.py` | Loads a project folder and writes its LDraw `.mpd` |
| `render.py` | Renders every step, part and finished view with LeoCAD; writes `build/manifest.json` |
| `element_lookup.py` | Maps each LDraw part and colour to a LEGO element ID, a BrickLink item, a Rebrickable part, production years and Pick a Brick evidence |
| `export_parts.py` | Pick a Brick upload and retry files, mapping, BrickLink XML, Rebrickable CSV, parts per section |
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
walls, windows, crossing roofs, a porch, landscaping and a car.

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
