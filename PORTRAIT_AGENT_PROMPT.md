# Prompt: design a brick portrait figure kit from a photo

Copy everything below the line into the agent's first message, and attach or link the photo(s).
Fill in the three items in **[brackets]**.

---

You are designing a **brick portrait kit**: one or more big, chunky, brick-built figures of real
people, made from a customer's photo and sold as a pack of LEGO® parts with a PDF instruction
booklet. Work in the repository `bpatricca7/Test`, on your own branch.

**This order:** [who the figures are, e.g. "a couple: the woman on the left, the man on the right"],
from [the photo path(s) or attachment]. Kit folder: [`brick-portrait-<name>-lego`].

## 1. What "good" looks like

The reference kits are `brick-portrait-couple-lego/` and `brick-portrait-single-lego/`. Open
their `images/` and `README.md` first and match their quality. A good figure:

- **Shape:**
  - a big near-cube head (6 × 6-stud face, 8 studs wide with hair) on a short neck;
  - a 6 × 3 torso, blocky arms with skin-tone hands;
  - two 2 × 2 legs (or a skirt) and shoes;
  - about 16–18 cm tall, on a white tiled display base.
- **Recognition:** reads as *that person* from 1 metre away, through four or five strong cues:
  hair shape and colour, facial hair, skin tone, the outfit's main colour and one detail (V-neck,
  tie, lapels, dress), and trouser and shoe colours. Get these right before anything finer.
- **Face:**
  - friendly: round eyes, arched brows, an open "D" smile;
  - flush, so a printed face sticker can cover it;
  - no stern brows, no "fangs", no blank stare.
- **Build quality:** one connected piece per model, sturdy, buildable in step order, and every
  part currently orderable.

## 2. Read before you start

- `lego-kit/portrait.py`: the figure generator. Read the module notes (layout, panel tokens),
  `Figure(...)` and `OPTION_TABLE`. A kit's `design.py` is a few `pt.Figure(...)` lines plus
  `pt.display_base(...)`, optional `pt.heart_cells(...)` and `pt.photo_frame(...)`. Copy the
  reference kit's folder (`design.py`, `build.sh`, `readme.py`, `.gitignore`) and change it.
  Rewrite the kit-specific wording in `readme.py` (intro, base, which figure is which) and the
  title and subtitle in `design.py`.
- `lego-kit/README.md`: the toolkit, the data folder and the live Bestseller list.
- `resort-collection/DESIGN_GUIDE.md`: toolkit pitfalls (step notes, part keys, size tables).

## 3. Read the photo: fill this in before designing

Write it at the top of your notes, and then in the README:

| Cue | What you see | Generator option |
|---|---|---|
| Skin tone | lightest / light-medium / medium / deep | `skin=` `LNOUGAT` / `MNOUGAT` / `TAN` / `RBROWN` |
| Hair length and style | short, spiky, wavy shoulder-length, long straight; fringe? parting? | `hair=` `short` / `spiky` / `wavy` / `long`, `hairline=` |
| Hair colour | nearest LEGO colour (black, dark brown, reddish brown, tan for blonde, white/grey, red) | `hair_colour=` |
| Facial hair | none / beard / moustache; colour | `beard=True`, `beard_colour=` |
| Glasses, freckles, other marks | | draw a custom face with `face_rows=[...]` |
| Top | colour; neckline; shirt-and-tie or blazer; dress | `top=` `vneck` / `shirt_tie` / `dress` / `plain`, `top_colour=`, `accent=`, `shirt=`, `tie=`, `sleeves=` |
| Bottoms | trousers or skirt; colour | `bottoms=`, `bottoms_colour=` |
| Shoes | colour; toe caps or contrast soles | `shoes=`, `toe=` |
| Extras | hearts, photo frame, pet, prop | base helpers; keep extras small |

Choose colours by eye against the photo under normal light. Pick the nearest LEGO colour, not the
literal pixel colour: blonde → Tan, auburn → Reddish Brown, navy → Dark Blue, burgundy → Dark Red.

## 4. Parts rules (hard)

**Setup:** `DATA_DIR` is the parts-data folder. If you don't have the offline Rebrickable dump, use
the live list committed in the repo: `export DATA_DIR=$PWD/lego-kit/pab_live`, run from the repo
root. `element_lookup.py` then takes element IDs and prices from the live list alone. You also need
LeoCAD and the LDraw library (`leocad ldraw-parts xvfb`), Python `pillow pymupdf`, and Node with
Playwright and Chromium for the PDF; see `lego-kit/README.md`.

- **Bestseller only:** set `bestseller_only=True` and `batch_sizes=[10, 25]` in PROJECT. The
  authority is the live US Pick a Brick Bestseller list (`lego-kit/pab_live/pab_live_<date>.json`,
  read through `DATA_DIR/pab_live.json`).
  - Check every part/colour with `DATA_DIR=... python3 lego-kit/avail.py <parts>:<colours>`.
  - `OK` means it is on the live list.
  - `ok` (lowercase) means it is NOT on the live list: avoid it.
  - `--` means not a Bestseller.
  - `export_parts.py` must finish with no "not on the live Bestseller list" warning.
  - If the snapshot is more than a few weeks old, say so and ask for a fresh one (`lego-kit/pab_live.py` imports it).
- **No printed parts, no minifigure parts, no stickers in the parts list.** A face sticker or a
  photo print for a frame is an optional, separate, non-LEGO extra. Say so in the README.
- **No logos, brand names, team crests, characters or lettering**, even if the person is wearing them.
  Replace them with plain colour.
- **Budget:** about $20–30 of parts per figure at live prices, plus the base. Report it. If a
  figure is over $35, simplify hidden structure before visible detail.

## 5. Face and hair: lessons from the reference kits

The face is a 6 × 6 side-stud (SNOT) panel written as rows of tokens (see `portrait.py`): `s` skin,
`e` eyes, `b` brows, `l` lips, `t` teeth, `k` beard, `h` hair. `/TL /TR /BL /BR` makes a quarter-round
tile whose *square* corner is at that corner; `/o` makes a round tile; `@x` sets the plate colour
showing round it.

- **Eyes:** black round tiles on a white backing (`e/o@w`), in row 2, columns 1 and 4.
- **Brows:** arched, with the round side up: left `b/BR@s`, right `b/BL@s`. The other way round
  (`TL`/`TR`) reads stern or worried.
- **Smile:** teeth in the middle of row 4 with lips quarter tiles either side, and the lips rounding
  under the teeth in row 5 (`s s l/TR@s l/TL@s s s`), so it reads as an open "D" smile. Red corners
  with nothing under the teeth read as fangs.
- **Beard:** frame the mouth (sideburns, moustache row, jaw), with the teeth showing.
- **Hairline:** `corners` for most styles, `fringe` for bangs or long straight hair.
- **Hair:**
  - wrap the top, sides and back;
  - long hair falls over the shoulders and upper arms;
  - avoid side pieces that stick straight out at temple height, which read as a hat brim from the front;
  - check the front view specifically.
- **Custom faces:** for glasses, a closed smile, freckles or a goatee, draw `face_rows=[...]` by
  hand. Keep every tile flush.

## 6. Process

1. **Notes:** fill in the table in section 3, then write `design.py` with `pt.Figure(...)` for
   each person. Standing order: left to right as in the photo.
2. **Preview:** run `cd lego-kit && xvfb-run -a python3 preview.py ../<kit folder>`. It must report
   0 problems and 1 connected group per model.
3. **Compare:** open `build/preview/*_front.png` and `*_front_right.png` next to the photo and
   score each figure on the checklist below. Iterate until every line is "yes". Expect three or
   more rounds; crop the face with Pillow to judge it at full size.
4. **Price:** run `python3 lego-kit/element_lookup.py <kit> $DATA_DIR` and then
   `python3 lego-kit/export_parts.py <kit>`. They must pass the Bestseller check with no warnings.
   Simplify anything over budget.
5. **Full build:** run `cd <kit> && DATA_DIR=... xvfb-run -a ./build.sh`, in the background with
   a long timeout. It renders every step, runs `checks.py`, prints the booklet and writes the README.
6. **Review:**
   - `checks.md`: collisions and connections must pass, with no assembly-order or stability
     warnings left that you could fix;
   - the README numbers against `parts/kit_cost.csv`;
   - three booklet pages (cover, a face step, a hair step);
   - the README images.

**Likeness checklist** (every line must be "yes"):

- [ ] Hair shape, length and colour match at a glance.
- [ ] Facial hair (or none) matches.
- [ ] Skin tone is the nearest of the four.
- [ ] The face reads friendly: arched brows, open smile, eyes level.
- [ ] Top colour and its one key detail (V-neck / tie / lapels / dress) are visible from the front.
- [ ] Trouser or skirt and shoe colours match.
- [ ] Nothing sticks out oddly in the front view (brim-like hair, floating tiles).
- [ ] The figures stand at the right relative heights (taller person taller, if obvious).

## 7. Deliverables (in the kit folder)

- `design.py`, `build.sh`, `readme.py`, `.gitignore` (`build/`, `__pycache__/`);
- `model/<kit>.mpd`: the editable model (opens in BrickLink Studio, LeoCAD and LDCad);
- `images/`: front, front_right, aerial, sample pages (`readme_images.py`, plus `pt.extra_images`);
- `instructions/*.pdf`: the booklet;
- `parts/`: the BOM with element and colour IDs, `pick_a_brick_upload.csv` plus x10 and x25,
  `kit_cost.csv` at live prices, and the BrickLink and Rebrickable files;
- `checks.md`;
- `README.md` (from `pt.write_readme`):
  - each figure's options in words (`Figure.summary()`);
  - piece count, part lines, cost per kit and per figure, kits per order, height;
  - resale scenarios from `pricing.py`, with `REPRICE_LIVE` as the base case and `REPRICE` as the stress case;
  - the date of the price snapshot;
  - the face-sticker option;
  - what was simplified and what to test in a physical build.

## 8. Ethics and wording

- Make a likeness only of someone who has agreed to it (the customer, or the people in the photo).
  Never use a photo found online of someone else.
- Don't copy another shop's name, branding or listing text. The style is ours.
- Keep the repo's disclaimer: unofficial fan design, not affiliated with or endorsed by the LEGO
  Group, and LEGO® is a trademark of the LEGO Group.
- Never commit the customer's photo to the repo. Keep it in a scratch folder.

## 9. Finish and report

- Commit the kit folder on your branch, and say whether you pushed.
- Don't change existing toolkit files unless it's unavoidable. If you do, keep every other kit's
  model unchanged and say what changed.
- Reply with:
  - the branch and commit;
  - for each figure: options, pieces, cost;
  - for the kit: pieces, part lines, cost at live prices (and the snapshot date), kits per order,
    booklet pages and steps, height;
  - the checklist results;
  - the front and front-right renders;
  - anything you simplified or are unsure of.
