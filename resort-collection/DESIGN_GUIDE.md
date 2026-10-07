# Designing a compact resort kit

How to make one kit of the [compact resort collection](README.md) with the shared
toolkit in [`../lego-kit`](../lego-kit). The reference kit is
[`../grand-floridian-compact-lego`](../grand-floridian-compact-lego): copy its
structure.

## Goal

A small souvenir/display model that someone who knows the resort recognises at once.
Show only:
- the iconic entrance or central facade;
- the roof or tower silhouette;
- the characteristic colours;
- at most one or two small details (a palm, a lamp, a totem, a tree).

Leave out:
- the long wings, repeated guest-room blocks and interiors;
- parking, big grounds and extensive landscaping.

The kits share one format, but **each resort must have its own shape**. Use
A-frames, towers, thatched roofs, arcades, turrets or balconies as the resort calls
for, not the same box with different colours.

## Targets and rules

- **Size:** about 250–550 pieces and about $30–55 of parts at listed prices.
  Smaller is better when it still looks right. Over $60 means simplify before
  adding anything.
- **Bestseller only:** every element must be in Pick a Brick's Bestseller range and
  in 2025–2026 sets. Check parts before you design with them:
  `DATA_DIR=... python3 ../lego-kit/avail.py 3001,3004:15,19`. Use only lines
  marked `OK`. `export_parts.py` refuses to finish otherwise.
- **Few colours and shared parts:** a limited palette per kit, built from the
  shared parts in `compact.SHARED_PARTS`, the standard `palm()`, the lawn plate and
  ground tile sizes in `compact.py`, and Bestseller roof slopes. Fewer unique
  part/colour lines is better.
- **No custom, printed or sticker parts, and no rare colours.**
- **No Disney characters, logos or lettering.** For the character-themed Value
  resorts, use generic icons only.

## The format (`lego-kit/compact.py`)

- `display_base(m)` lays the 24 × 16 base (a dark bluish gray 16×16 and two 8×8
  plates) and the black two-row band at z = 0..1. It returns the band cells.
- The building or buildings stand behind the band, usually toward the back, as
  submodels placed on layer 1: `m.sub(model, x, z, 1)`. Each submodel starts with
  a plinth at its own layer 0. Submodels can't be rotated.
- `block(m, w, d, floors, material)` builds a plinth, storeys and a roof slab.
  Each storey is one brick course laid with `WallRing`, then a plate band, so one
  storey = 4 plates, as in the large models. `material(x, z, floor)` returns a
  colour, or None to leave a cell open. It returns the roof base layer. For
  non-box shapes (A-frames, towers, arcades), build with `row`, `fill_rect`,
  `place_rect` and `m.add` directly.
- `finish_ground(m, reserved, colour, colour_at=...)` covers every base cell not
  in `reserved`:
  - green lawns become studded plates;
  - other colours become tiles (paths, paving, sand, water).

  Put the band, building footprints and detail cells in `reserved`.
- `palm()` is the shared palm (a 1×1 footprint).
- `compact_project(...)` builds PROJECT. Give it:
  - `slug` (for example "contemporary"), `title`, `resort` (the full Disney name),
    `category` and `merged`;
  - `about`, `features` (the signature features included) and `omitted` (what
    was left out);
  - `colour_rows`, `organisation` (section names), `sub_info` for every
    submodel, `legend` (a small submodel and step, for example
    `("palm.ldr", 1)`), `tips` and `build_time`.

  Don't change the shared settings it fills in.
- **Sections in the main model:**
  1. "The display base" (`display_base` and `finish_ground`)
  2. the building or buildings, one submodel each
  3. the details

## Toolkit notes and pitfalls

- **Grid:** x to the right, z toward the back, layer = plates (a brick is 3).
  Call it as `m.add(key, colour, x, z, layer, rot=0/90/180/270)`. Part keys are in
  `bricks.PARTS` (see `lego-kit/bricks.py`). A part that isn't there can be
  registered in your `design.py` with `bricks.P(key, "1234.dat", "Name")` (check
  the LDraw file exists in `/usr/share/ldraw/parts`). Prefix the key with the kit's
  slug (for example `fw_log1x2`) so two kits can't register different parts under
  one key.
- **Bestseller sizes per colour:** `bricks.ALLOWED` lists the plate, tile and brick
  sizes allowed for some colours only. For a colour with no entry, the fill
  helpers (`row`, `fill_rect`, `fill_cells`, `WallRing`, `build_roofs` ridge tiles)
  may pick any size, including one that isn't a Bestseller. Check the sizes with
  `avail.py`, then either pass `sizes=` explicitly or add the entries to
  `bricks.ALLOWED` inside your `build()` and restore the table afterwards.
  `export_parts.py` catches any size that slips through.
- **Roofs:** use `roofs.Roof(x0, x1, z0, z1, base, axis, pitch, color, trim=,
  trim_ends=, wall=, hips=, priority=)` and `build_roofs(m, [roofs...],
  fill_color=, keep_open=, support_caps=True)`.
  - Many colours only have 45° slopes as Bestsellers (`slope45` 2×1, `s45x2` 2×2;
    `s45x4` 2×4 only in some colours). Red 33° slopes aren't Bestsellers.
  - Where two roofs meet at the same height, the one with lower priority owns the
    cell. A turret or cupola needs `keep_open` cells that the main roof owns.
    Keep crossing gables away from them, or the turret floats.
- **Step notes:** `m.step(note)` attaches the note to the *next* step. Call
  `m.step()` to close the current one, then `m.step("note")` before adding the
  parts of the step the note is for. Notes are HTML-escaped: write "×", not
  `&times;`.
- **Legend:** `legend=("palm.ldr", 1)` names a submodel and a step index that
  counts from 0, so 1 is that submodel's second step.
- **Sections:** a submodel with three steps or fewer gets no section page of its
  own; its steps follow the previous section.
- **Connections:** every model must be one connected group. `preview.py` prints
  the problems. The base plates meet at x = 16 and at z = 8 (for x ≥ 16):
  something must cross those seams, such as a plinth, a ground row or a band row.
- **Bars, flags and lanterns:** these use `add_raw(..., attach_to=part)`.
- **A model placed twice** gets a "Build 2" badge automatically.
- **Clear parts:** a kit with clear parts whose inside should show sets
  `clear_alpha=48` in `compact_project(...)`.

## Process for each kit

1. Create `<slug>-compact-lego/`. Copy `../lego-kit/compact_build.sh` to `build.sh`
   and add a `.gitignore` with `build/` and `__pycache__/`.
2. Write `design.py`.
3. Iterate: run `cd ../lego-kit && xvfb-run -a python3 preview.py ../<folder>`.
   - It must report 0 problems and 1 connected group for every model.
   - Look at `build/preview/*.png`, at least front_right, front_left and high,
     until the resort is recognisable and well proportioned.
   - For close-ups, use `xvfb-run -a python3 zoom.py ../<folder> out.png LAT LON
     x0 x1 z0 z1 l0 l1`.
4. Price it: run `python3 element_lookup.py ../<folder> $DATA_DIR`, then
   `python3 export_parts.py ../<folder>`. It prints the cost and fails on a
   non-Bestseller part. Simplify anything over budget, starting with the
   biggest cost lines in `parts/kit_cost.csv`.
5. Full build: `cd <folder> && DATA_DIR=... xvfb-run -a ./build.sh`. It renders
   every step (about 10–20 minutes), runs the checks, prints the booklet and
   writes the README and its images.
6. Review:
   - `checks.md`: collisions and connections must pass; read every assembly-order
     or stability warning and fix it where you can.
   - the README numbers;
   - two or three booklet pages;
   - the README images.

`DATA_DIR` is the offline element data folder (see `../lego-kit/README.md`).

## Mid-size versions

A mid-size kit shows more of the same resort, at the same scale, on a larger base.
- **Format:** pass `size="midsize"` to `compact_project(...)`,
  `display_base(m, "midsize")` and `finish_ground(..., size="midsize")`. The base
  is 32 × 24 studs (25.6 × 19.2 cm): two 16×16 plates in front and four 8×8 plates
  along the back, with the same black band.
- **Seams:** the plates meet at x = 16 (z < 16), at z = 16, and at x = 8, 16 and 24
  (z ≥ 16). Something must cross each seam; a building plinth or a ground row is
  enough.
- **Size:** about $65–80 of parts at listed prices (aim for $75), roughly 500–800
  pieces.
- **What to add:** keep one storey = 4 plates. Show more of the resort: wings,
  porches, verandas, a porte-cochère, extra storeys and a few more details, not a
  bigger version of the compact model.
- **Folder:** `<resort>-midsize-lego`, with the same `slug` and `title` as the
  compact kit. Copy `../lego-kit/compact_build.sh` as its `build.sh`.
