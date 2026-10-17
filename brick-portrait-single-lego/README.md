# Brick Portrait: Single

**A LEGO® portrait figure kit with build instructions.**

![The finished model](images/brick_portrait_single_front_right.jpg)

A buildable LEGO kit of one brick-built portrait figure beside a small photo frame, designed from a photo of a custom portrait figure. The figure is chunky and about 16 cm tall: a big near-cube head with a flat tiled face and brick-built hair, a short neck, a blocky torso with the outfit in tiles, arms down at the sides ending in hands, and a skirt down to the shoes.

- **The figure** (the woman in the photo): Light Nougat skin, long straight Tan hair, a long Red V-neck dress with bare arms, Black shoes
- A white base of 20 × 10 studs (16 × 8 cm), tiled, with a white photo frame on a tan easel beside the figure.

The kit is sold as a pack of parts with a PDF booklet. Every part is a real LEGO element on Pick a Brick's Bestseller list (up to 999 of an element per order), and one file uploads the whole list for 1, 10 or 25 kits. The figures come from the shared generator [`../lego-kit/portrait.py`](../lego-kit/portrait.py): each one is a few lines of options, which is how a seller makes a custom figure from a customer's photo (see [Custom orders](#making-a-custom-figure-from-a-customer-photo)).

| | |
|---|---|
| Pieces | **255** (67 part/colour lines, 33 kinds of part, 7 colours) |
| Figure | 171 pieces, 8 studs (6.4 cm) wide, with a 6 × 6-stud face; 17 cm tall |
| Overall size | 16.0 × 8.0 cm, 16.6 cm tall on its base |
| Instructions | 46-page PDF, 49 steps, 8 sections |
| Parts cost | **$38.15 per kit** at the US Pick a Brick prices of 2026-10-17 (a snapshot of the Bestseller list); prices and stock change (see [Cost assumptions](#cost-assumptions-and-resale-scenarios)) |
| Cost per figure | the figure **$23.68**; the base $8.09; the photo frame $6.38 |
| Kits per order | up to **41** (the most-used part is needed 24 times) |

![Front view](images/brick_portrait_single_front.jpg)

## The figure

The figure is made by `portrait.Figure` in [`design.py`](design.py):

```python
FIGURE = pt.Figure('her', 'The figure',
    skin=pt.LNOUGAT,
    hair='long',
    hair_colour=pt.TAN,
    top='dress',
    top_colour=pt.RED,
    bottoms='skirt',
    bottoms_colour=pt.RED,
    shoes=pt.BLACK)
```

| Figure | Pieces | Part/colour lines | Parts cost |
|---|---|---|---|
| The figure | 171 | 49 | $23.68 |

Every figure has the same build: two shoes with toe caps, two 2 × 2 legs (or a skirt), hip plates, a 6 × 3 torso of bricks whose front is a panel of tiles on side studs, two 1 × 2 arms with hands, shoulder plates and tiles, a short 2 × 2 neck, and the head: a floor plate, a wall of side-stud bricks with the 6 × 6 tiled face on it, an inner post, and the hair, which wraps the sides, the back and the top and is built on its own. A figure is about 16 cm tall, 8 studs wide (the hair can flare out to 10) and 6 deep.

## The photo frame

A white frame of 1 × 2 bricks round a flat area of light grey tiles, 6 × 6 studs (4.8 cm square), facing forward on side-stud bricks. It stands on two tan easel legs, with the head of the easel on top, and its top is about level with the figure's chin.

The flat area takes a printed photo: a 48 × 48 mm print on sticker paper, an optional extra that the seller makes (for example the customer's photo the figure was made from). It isn't a LEGO part and isn't in the parts lists or the cost. Without it the frame shows its grey tiles.

## Faces: a brick mosaic, or a printed sticker

The figures in the reference photos have custom-printed faces, which stock LEGO parts can't give. This kit offers two ways round that:

1. **Brick-built mosaic (the default, as in this kit).** The face is a 6 × 6-stud panel of tiles facing forward on side studs (SNOT): black round tiles on white for the eyes, quarter-round tiles for the brows, the hairline and the corners of the smile, white tiles for teeth, and for a beard black tiles round the mouth and jaw. Light Nougat tiles fill the rest.
2. **A printed face sticker (optional, not a LEGO part).** Every tile of the face is flush, so the whole 4.8 × 4.8 cm face is one smooth surface. A seller can print the customer's face (48 × 48 mm, rounded corners) on vinyl sticker paper and put it over the mosaic, or build the face with `face="plain"` (all skin tiles) as a blank for the sticker. The sticker is a separate item the seller makes; it isn't in the parts lists or the cost.

Build the mosaic and offer the sticker as an extra: the figure still looks right without it.

## Options in `portrait.py`

| Option | Choices |
|---|---|
| `skin` | `LNOUGAT` (Light Nougat, the lightest), `MNOUGAT` (Medium Nougat), `TAN`, `RBROWN` (Reddish Brown, the deepest) |
| `hair` | `"short"` (neat), `"spiky"` (short, with spikes on top and at the sides), `"wavy"` (shoulder length, flicked out at the temples and the ends), `"long"` (straight, two studs thick, past the shoulders and over the upper arms) |
| `hair_colour` | `BLACK`, `RBROWN` (auburn or brown), `TAN` (blonde), `DKBROWN`, `WHITE`, `LBG` / `DBG` (grey), `RED`; the brows follow it (`brows=` to change) |
| `beard` | `True` for sideburns, a moustache and a beard round the mouth, in `beard_colour` (default: the hair colour) |
| `face` | `"mosaic"` (default: eyes, brows and mouth in tiles) or `"plain"` (all skin tiles, for a printed sticker); `smile=False` for a closed mouth, `nose=True` for a two-stud nose, `hairline=` `"corners"`, `"fringe"` or `None`, `eyes=` and `lips=` colours, or `face_rows=[...]` for a hand-drawn 6 × 6 face |
| `top` | `"vneck"` (`top_colour` with an `accent` V-neck), `"shirt_tie"` (a `top_colour` blazer over a `shirt` and `tie`), `"dress"` (a V-neck top in the dress colour with bare arms) or `"plain"`; `v_depth=2` or `3` rows; `sleeves=` (default: the top colour, skin for a dress) |
| `bottoms` | `"trousers"` (two 2 × 2 legs) or `"skirt"` (a 6 × 4 block down to the shoes), in `bottoms_colour` |
| `shoes` | the shoe colour, and `toe=` for a toe cap in another colour |

All four skin tones are on the Bestseller list. Light Nougat, the lightest, is used for the figures in this kit; Medium Nougat, Tan and Reddish Brown cover medium to deep skin. Each colour and part the generator uses is checked against the Bestseller tables in `portrait.py` (from the US list of 17 October 2026). A choice that isn't a Bestseller (a hair colour without 45° slopes, say) stops the build with a message naming the option to change. `Figure.summary()` describes a figure in words, for the order confirmation.

## Making a custom figure from a customer photo

1. **Pick the options** from the photo, with the customer's permission to make their likeness: skin tone, hair style and colour, beard, the top and its colours, trousers or skirt, shoes. Copy this kit's folder, change the `pt.Figure(...)` lines in `design.py` (and the title), and check the look with `xvfb-run -a python3 ../lego-kit/preview.py .`, which renders it in a minute. For glasses, freckles or a different smile, draw the face as `face_rows=[...]` (six rows of six tokens; see the notes at the top of `portrait.py`).
2. **Run `./build.sh`** with `DATA_DIR` set: it renders every step, maps the parts to LEGO element IDs, checks the model, prints the booklet and writes the parts lists and this README.
3. **Order the parts:** upload `parts/pick_a_brick_upload.csv` (or the 10- or 25-kit file) to Pick a Brick and check the total.
4. **Print the extras (optional):** a 48 × 48 mm face sticker for each figure and the photo for the frame (see above), on sticker paper. They aren't LEGO parts.
5. **Pack** the parts by section (`parts/parts_by_section.csv`) with a card linking to the PDF booklet.

**Cost per extra figure:** a figure's parts cost about $23.68 (its 171–171 pieces, shoulders included). A kit with one more figure also needs a base about 11 studs wider, a few dollars more of plates and tiles.

## What's in this folder

| Path | What it is |
|---|---|
| [`instructions/Brick_Portrait_Single_Instructions.pdf`](instructions/Brick_Portrait_Single_Instructions.pdf) | **The instruction booklet**: cover, section intros with parts lists, 49 numbered steps, gallery, parts inventory with element IDs, ordering guide |
| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload file for **one kit** (67 element IDs) |
| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), [`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files for **10 kits** (2,550 pieces) and **25 kits** (6,375 pieces) |
| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price and when it was seen |
| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour |
| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: Pick a Brick name, evidence it's sold, price, the ID to try next, BrickLink backup |
| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), [`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and Rebrickable import (one kit) |
| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for bagging |
| [`model/brick_portrait_single.mpd`](model/brick_portrait_single.mpd) | The digital model (LDraw, with steps and submodels). Opens in BrickLink Studio, LeoCAD and LDCad |
| [`checks.md`](checks.md) | Results of the digital build checks |
| [`design.py`](design.py) | The kit: the figures' options, the base and the layout |
| [`readme.py`](readme.py) | Writes this README from the build outputs |

## Ordering the parts

1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.
2. Upload the file for 1, 10 or 25 kits.
3. Before you pay, check that every line shows the normal (Bestseller) delivery time and compare the bag total with the cost below.
4. If a line isn't matched, use the ID in the "If not found" column of the mapping, multiplied by the number of kits.

**Kits per order:** the part this kit uses most is needed 24 times, so one order holds up to **41 kits**.

**Sourcing evidence** (every part passes the Bestseller-only check in `export_parts.py`):

| Evidence | Lines |
|---|---|
| On the US Pick a Brick Bestseller list, available (2026-10-17 snapshot) | 67 |

The Bestseller list is a snapshot of what was available on one day, with prices but no stock counts. A part can sell out or change price, so upload the list before quoting a customer.

## Cost assumptions and resale scenarios

These are planning numbers, not quotes: the bag total on Pick a Brick is the real parts cost.

| Assumption | Value |
|---|---|
| Parts | the US Pick a Brick prices of 2026-10-17 (a snapshot of the Bestseller list); prices and stock change, and the snapshot has no stock counts |
| Parts, stress case | +10% on those prices (LEGO repriced about a third of Pick a Brick elements on September 14, 2026, by 16.7% on average) |
| Packaging | $3.00 per kit: box, bags, a card with a link or QR code to the PDF booklet, tape and label (a printed colour booklet adds about $4.00) |
| Labour | $15.00/hour; 3 s per piece to count and bag from sorted stock, plus 6 min to pack |
| Etsy fees (US) | $0.20 listing + 6.5% transaction + 3% + $0.25 processing, on the price the buyer pays |
| Shipping | seller-paid (free shipping) $10.50 for a 1-2 lb box by USPS Ground Advantage; or the buyer pays postage |
| Prices | 1.6x / 2x / 2.5x the parts cost at today's prices, rounded up to $x9.99; market prices for custom portrait figures were not researched |

| Per kit | Today's prices | Stress case |
|---|---|---|
| Parts | $38.15 | $41.96 |
| Packaging | $3.00 | $3.00 |
| Labour (255 pieces) | $4.69 | $4.69 |
| Before shipping | $45.84 | $49.65 |
| Seller-paid shipping | $10.50 | $10.50 |

Biggest cost lines: 24× Brick 1 x 2 x 1 2/3 with Studs on 1 Side (White) $4.56, 12× Brick 2 x 4 (Bright Red) $2.52, 11× Brick 2 x 4 (Brick Yellow) $2.31.

| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |
|---|---|---|---|---|
| $69.99 | $6.55 | 9% | $16.06 | 23% |
| $79.99 | $15.60 | 20% | $25.11 | 31% |
| $99.99 | $33.70 | 34% | $43.21 | 43% |

Break-even price: $62.75 with free shipping, $52.25 when the buyer pays postage. The stress case adds $3.82 per kit. The kit packs into a box of about 16 × 10 × 6 cm (the longest part, a 6 × 10 base plate, is 8 cm); check the shipping weight and size band before setting a free-shipping price. A printed face sticker or photo adds its own small cost.

## Digital checks and physical prototype

`lego-kit/checks.py` checked the digital model ([`checks.md`](checks.md)):

| Check | Result |
|---|---|
| Collisions | Pass |
| Connections | Pass |
| Assembly order | Pass |
| Stability | Pass |

The faces, the torso fronts and the photo area sit on side studs, which the grid checks can't see, so `portrait.check_snot()` also tests every side-stud part for collisions with the rest of the model (none). **No physical prototype has been built.** Before selling, build one kit from the uploaded parts and the printed booklet. Check that the head sits firmly on its 2 × 2 neck and inner post, that the hair cap presses down evenly over the head, that the arms stay put under the shoulder plates, and that the figures stand steadily on the base.

## Building notes

- **Sections:**
  1. The display base
  2. The figure: shoes, skirt, torso, arms, shoulders, head and hair
  3. The photo frame on its easel
- **The hair** is long and straight, two studs thick at the sides. It comes down to the shoulders and rests on them, the tan tops of the arms carry it on past the shoulders, and the face's top row of tiles makes a parted fringe.
- **The dress:** the red front panel has a skin-coloured V-neck (Light Nougat plates showing round red quarter-round tiles). The skirt is a 6 × 4 block of red bricks standing on the two shoes, with a red tile belt in front; the arms are bare.
- **Joints:** the skirt's bottom plate ties the two shoes, the hip plates run across the skirt and out under the arms, the shoulder plates lock the arms at the top, and the head sits on a 2 × 2 neck. Inside the head, a post of 2 × 2 bricks holds the middle of the hair.
- **The frame** stands on its two legs on the base's studs; build it on the base or on its own and then press it on.

![Front left view](images/brick_portrait_single_front_left.jpg)

![Aerial view](images/brick_portrait_single_aerial.jpg)

![Back view](images/brick_portrait_single_back.jpg)

Sample booklet pages: [a section page](images/sample_section_page.jpg) and [a step page](images/sample_step_page.jpg).

## How it was made

The figures are generated by [`../lego-kit/portrait.py`](../lego-kit/portrait.py) from the options in [`design.py`](design.py), with the shared toolkit in [`../lego-kit`](../lego-kit). The toolkit builds on the stud grid with the real part shapes from the LDraw library and checks that no two elements overlap and that every element is held by at least one stud. `./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the booklet and writes this README.

```bash
DATA_DIR=/path/to/element-data ./build.sh   # see ../lego-kit/README.md
```

## Disclaimer

An unofficial fan design (MOC). It is not affiliated with, sponsored or endorsed by The LEGO Group. LEGO® is a trademark of The LEGO Group. The brick portrait style here is this shop's own design and uses no other shop's names or branding. A custom figure is a likeness of a real person and is made only with that person's permission. A printed face sticker or photo print is a separate, non-LEGO item made by the seller.
