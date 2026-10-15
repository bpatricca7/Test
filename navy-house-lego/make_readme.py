"""Write this kit's README and its extra images, from the design, parts files, checks
and booklet.

    python3 make_readme.py <project>

The shared ../lego-kit/kit_readme.py writes READMEs for the resort collection's
compact and mid-size kits only, so this house kit has its own writer in the style of
../house-lego/README.md, with the numbers taken the same way (kit_readme.kit_stats)
and the cost and resale section from ../lego-kit/pricing.py. Run it last in build.sh,
after readme_images.py.
"""
import os
import sys

from PIL import Image

KIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lego-kit")
sys.path.insert(0, KIT)
import project as projects  # noqa: E402
import pricing as pr  # noqa: E402
from kit_readme import kit_stats, money, plain  # noqa: E402

EXTRA_VIEWS = {"cover_front_left": "front_left", "back": "back"}


def extra_images(proj):
    """Front-left and back views for the README (readme_images.py writes the others)."""
    out = os.path.join(proj.root, "images")
    stem = proj.meta["model_name"]
    for src, dst in EXTRA_VIEWS.items():
        im = Image.open(os.path.join(proj.renders, "final", src + ".png")).convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        bg.thumbnail((1400, 1000))
        bg.save(os.path.join(out, f"{stem}_{dst}.jpg"), quality=85, optimize=True)


def write(proj):
    P, s = proj.meta, kit_stats(proj)
    stem = P["model_name"]
    title = plain(P["title"])
    w, d, h = s["dims"]
    c = pr.unit_costs(s["cost"], s["pieces"])
    hi = pr.unit_costs(s["cost"], s["pieces"], pr.REPRICE_HIGH)
    prices = pr.price_points(s["cost"])
    L = []
    add = L.append

    add(f"# {title}: LEGO® model with build instructions\n")
    add(f"![The finished model](images/{stem}_front_right.jpg)\n")
    add("A buildable LEGO model of a two-storey modern-craftsman house, designed from a photo "
        "and sold as a pack of parts with a PDF instruction booklet. It includes:\n")
    L += [f"- {plain(x)}" for x in P["features"]]
    add("\n**Left out or simplified**\n")
    L += [f"- {plain(x)}" for x in P["omitted"]]
    add("")
    add("| | |\n|---|---|")
    add(f"| Pieces | **{s['pieces']}** ({s['lines']} part/colour lines, {s['designs']} kinds of "
        f"part, {s['colours']} colours) |")
    add("| Footprint | 48 × 32 studs (38.4 × 25.6 cm), on six 16×16 base plates |")
    add(f"| Overall size | {w} × {d} cm, {h} cm tall to the roof ridge |")
    add(f"| Scale | {plain(P['facts'][1][1])}, like [`../house-lego`](../house-lego) |")
    add(f"| Instructions | {s['pages']}-page PDF, {s['steps']} steps, {s['sections']} sections |")
    add(f"| Parts cost | **{money(s['cost'])} per kit** at the Pick a Brick prices last seen (2022 "
        f"and late 2025); about {money(c['parts'])} with 2026 price rises (see "
        "[Cost assumptions](#cost-assumptions-and-resale-scenarios)) |")
    add(f"| Kits per order | up to **{s['copies']}** (999 per element; the most-used part is "
        f"needed {s['max_q']} times) |")
    add(f"\n![Front view](images/{stem}_front.jpg)\n")

    add("## What's in this folder\n")
    add("| Path | What it is |\n|---|---|")
    add(f"| [`instructions/{P['pdf_name']}`](instructions/{P['pdf_name']}) | **The instruction "
        f"booklet**: cover, section intros with parts lists, {s['steps']} numbered steps, gallery, "
        "parts inventory with element IDs, ordering guide |")
    add(f"| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick upload "
        f"file for **one kit** ({s['lines']} element IDs) |")
    add("| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), "
        "[`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload files "
        f"for **10 kits** ({s['pieces'] * 10:,} pieces) and **25 kits** ({s['pieces'] * 25:,} "
        "pieces) |")
    add("| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the "
        "price and when it was seen |")
    add("| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: "
        "element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate "
        "IDs |")
    add("| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part "
        "sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, "
        "BrickLink backup |")
    add("| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer "
        f"element IDs for {s['retry']} of the parts, for lines the upload doesn't match |")
    add("| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), "
        "[`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and "
        "Rebrickable import (one kit) |")
    add("| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, "
        "for bagging |")
    add(f"| [`model/{stem}.mpd`](model/{stem}.mpd) | The digital model (LDraw, with steps and "
        "submodels). Opens in BrickLink Studio, LeoCAD and LDCad |")
    add("| [`checks.md`](checks.md) | Results of the digital build checks |")
    add("| [`design.py`](design.py) | The design, written as code on the stud grid |")
    add("| [`make_readme.py`](make_readme.py) | Writes this README from the parts files, checks "
        "and booklet |\n")

    add("## The booklet\n")
    add(f"The {s['pages']}-page PDF opens with the model and how the build is organised. Each "
        "section starts with a page listing its parts, and every step shows the parts to add "
        "outlined in orange, with a callout of the parts and their counts. At the back are a "
        "gallery, the full inventory with element IDs and an ordering guide.\n")
    add("| A section page | A step page |\n|---|---|")
    add("| ![A section page](images/sample_section_page.jpg) | "
        "![A step page](images/sample_step_page.jpg) |\n")

    add("## Ordering the parts\n")
    add("1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.")
    add("2. Upload the file for 1, 10 or 25 kits.")
    add("3. Before you pay, check that every line shows the normal (Bestseller) delivery time "
        "and compare the bag total with the cost below.")
    add("4. If a line isn't matched, use the ID in the retry file or in the \"If not found\" "
        "column of the mapping, multiplied by the number of kits.\n")
    add(f"**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part "
        f"this kit uses most is needed {s['max_q']} times, so one order holds up to "
        f"**{s['copies']} kits**. Some lines of the 25-kit file go over that limit, so "
        f"split 25 kits into three orders ({s['copies']} + {s['copies']} + "
        f"{25 - 2 * s['copies']} kits).\n")
    add("**Sourcing evidence** (every part passes the Bestseller-only check in "
        "`export_parts.py`):\n")
    add("| Evidence | Lines |\n|---|---|")
    for k, v in s["evidence"].most_common():
        add(f"| {k} | {v} |")
    add("")
    watch = [f"{s['only22']} lines are backed only by LEGO's 2022 Bestseller list, so their "
             "range and price today are not confirmed."]
    if s["retry"]:
        watch.append(f"{s['retry']} lines have newer element IDs (retry file); an upload may "
                     "match either.")
    if s["few_sets"]:
        watch.append("Parts in fewer than 10 sets since 2024 (more likely to sell out): " +
                     "; ".join(f"{n} {col} ({k} sets)" for k, n, col in s["few_sets"][:6]) + ".")
    if s["unpriced"]:
        watch.append("No price seen for: " + ", ".join(s["unpriced"]) + ".")
    add("**Sourcing uncertainties:**\n")
    L += [f"- {x}" for x in watch]
    add("- LEGO pauses Standard parts in the US and Canada from November 2, 2026; this kit uses "
        "none, but check that no line shows a longer delivery time.\n")

    add("## Cost assumptions and resale scenarios\n")
    add("These are planning numbers, not quotes. Upload the 10-kit file to see today's prices: "
        "the bag total is the real parts cost.\n")
    add("| Assumption | Value |\n|---|---|")
    for a, b in pr.ASSUMPTIONS:
        if a == "Prices":
            b = b.replace("for each resort", "for this house")
        add(f"| {a} | {b} |")
    add("")
    add("| Per kit | Listed prices | 2026 estimate | Stress case |\n|---|---|---|---|")
    add(f"| Parts | {money(s['cost'])} | {money(c['parts'])} | {money(hi['parts'])} |")
    add(f"| Packaging | {money(pr.PACKAGING)} | {money(pr.PACKAGING)} | {money(pr.PACKAGING)} |")
    add(f"| Labour ({s['pieces']} pieces) | {money(c['labour'])} | {money(c['labour'])} | "
        f"{money(c['labour'])} |")
    add(f"| Before shipping | {money(s['cost'] + pr.PACKAGING + c['labour'])} | "
        f"{money(c['before_shipping'])} | {money(hi['before_shipping'])} |")
    add(f"| Seller-paid shipping | {money(pr.SHIP_SELLER_PAID)} | {money(pr.SHIP_SELLER_PAID)} | "
        f"{money(pr.SHIP_SELLER_PAID)} |\n")
    add("Biggest cost lines: " + ", ".join(
        f"{r['Quantity']}× {r['Description']} ({r['LEGO colour']}) "
        f"{money(float(r['Line cost (USD)']))}" for r in s["top_lines"]) + ".\n")
    add("| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | "
        "margin |")
    add("|---|---|---|---|---|")
    for p in prices:
        a, b = (pr.scenario(s["cost"], s["pieces"], p, True),
                pr.scenario(s["cost"], s["pieces"], p, False))
        add(f"| {money(p)} ({p / s['pieces'] * 100:.0f}¢/piece) | {money(a['profit'])} | "
            f"{a['margin']:.0%} | {money(b['profit'])} | {b['margin']:.0%} |")
    add(f"\nBreak-even price: {money(pr.break_even(s['cost'], s['pieces']))} with free shipping, "
        f"{money(pr.break_even(s['cost'], s['pieces'], False))} when the buyer pays postage "
        "(2026 estimate). The stress case adds about "
        f"{money(hi['parts'] - c['parts'])} per kit. With {s['pieces']} pieces and six 16×16 "
        "base plates, a boxed kit may weigh more than the 1-2 lb assumed for shipping; weigh "
        "the first one.\n")

    add("## Digital checks and physical prototype\n")
    add("`lego-kit/checks.py` checked the digital model ([`checks.md`](checks.md)):\n")
    add("| Check | Result |\n|---|---|")
    for k in ("Collisions", "Connections", "Assembly order", "Stability"):
        add(f"| {k} | {s['checks'].get(k, 'not run')} |")
    add("\nThe model was checked on the computer only: parts fit the stud grid without overlaps "
        "and every part is held by a stud. **No physical prototype has been built.** Before "
        "selling, build one kit from the uploaded parts and the printed booklet, to confirm the "
        "parts arrive as listed, the build holds together when handled, and each step is clear.\n")

    add("## Building notes\n")
    add("- **Sections:**")
    L += [f"  {i}. {plain(x)}" for i, x in enumerate(P["organisation"], 1)]
    add("- **Modules:** the garage, the house and the car are built on their own and then set "
        "on the lot. The garage's side wall also closes the house's ground floor where they "
        "meet.")
    add("- **Walls:** each storey is four courses of navy bricks, laid two at a time. The corners "
        "swap between the walls on every course; the white corner boards are 1×1×3 bricks.")
    add("- **Stone front:** masonry-profile 1×2 bricks in tan, dark tan and two greys, mixed "
        "like stacked stone, with light grey porch-base bricks running back under it.")
    add("- **Windows:** the two big windows are white 1×4×3 frames with clear glass and black "
        "bricks behind, so the glass looks dark; the small ones are clear 1×2×2 panels.")
    add("- **Roofs:** steep 45° gables. The two upstairs gables are built together: the rear one "
        "is set three studs back, and where they cross the slopes step around each other to "
        "form the valley. White slopes at the gable fronts are the bargeboards; a few hidden "
        "grey 1×1 bricks hold up the slopes in the valley.")
    add("- **Floors:** white plates between the storeys make the porch ceiling and a white band "
        "round the house; the house is hollow inside.")
    add(f"\n![Front-left view](images/{stem}_front_left.jpg)\n")
    add(f"![Aerial view](images/{stem}_aerial.jpg)\n")
    add(f"![Back view](images/{stem}_back.jpg)\n")

    add("## How it was made\n")
    add("The model is generated by [`design.py`](design.py) with the shared toolkit in "
        "[`../lego-kit`](../lego-kit), the same way as [`../house-lego`](../house-lego). "
        "`./build.sh` renders the steps with LeoCAD, maps every part to LEGO element IDs, writes "
        "the parts lists and upload files, runs the checks, prints the booklet and writes this "
        "README.\n")
    add("```bash\nRENDER_WORKERS=1 DATA_DIR=... xvfb-run -a ./build.sh   "
        "# DATA_DIR refreshes element IDs (see ../lego-kit/README.md)\n```\n")
    add("lego.com, BrickLink and Rebrickable could not be reached from the environment this was "
        "made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick "
        "listings from 2022 and late 2025. With internet access, "
        "`node ../lego-kit/pab_check.cjs .` checks every element live.\n")

    add("## Disclaimer\n")
    add("An unofficial fan design (MOC) made from a photo of a house. It is not affiliated "
        "with, sponsored or endorsed by The LEGO Group. LEGO® is a trademark of The LEGO Group. "
        "The car is a generic SUV with no brand, and the house number and licence plate in the "
        "photo are not reproduced.")
    with open(os.path.join(proj.root, "README.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print(f"README: {s['pieces']} pieces, {money(s['cost'])}, {s['pages']} pages, "
          f"{s['steps']} steps")
    return s


if __name__ == "__main__":
    proj = projects.load(sys.argv)
    extra_images(proj)
    write(proj)
