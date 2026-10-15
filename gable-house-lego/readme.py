"""Write this kit's README.md (and two extra README images) from the build outputs.

    python3 readme.py

Run it last in build.sh. ../lego-kit/kit_readme.py writes the resort kits' READMEs
(it assumes the resort collection's format and Disney notes), so this kit has its
own text here, in the style of ../house-lego/README.md, with the numbers taken from
the same places: kit_readme.kit_stats() (parts files, checks, booklet) and
../lego-kit/pricing.py (cost and resale assumptions).
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lego-kit"))
import project as projects  # noqa: E402
import kit_readme  # noqa: E402
import pricing as pr  # noqa: E402
import render  # noqa: E402

plain, money = kit_readme.plain, kit_readme.money
EXTRA_VIEWS = {"cover_front_left": "front_left", "back": "back"}


def extra_images(proj):
    """front_left and back views; readme_images.py writes the other three."""
    out = os.path.join(proj.root, "images")
    for src, dst in EXTRA_VIEWS.items():
        im = Image.open(os.path.join(proj.renders, "final", src + ".png")).convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        bg.thumbnail((1400, 1000))
        bg.save(os.path.join(out, f"{proj.meta['model_name']}_{dst}.jpg"), quality=85,
                optimize=True)


def write(proj):
    P, s = proj.meta, kit_readme.kit_stats(proj)
    main_m, _, _ = proj.build(verbose=False, write=False)
    ref = next(it for it in main_m.items if getattr(it, "model", None) is not None
               and it.model.name == "house.ldr")
    house_cm = round((8 * ref.layer - render.model_bbox(ref.model)[0][1]) * kit_readme.LDU_CM, 1)
    stem, pdf = P["model_name"], P["pdf_name"]
    w, d, h = s["dims"]
    c = pr.unit_costs(s["cost"], s["pieces"])
    hi = pr.unit_costs(s["cost"], s["pieces"], pr.REPRICE_HIGH)
    L = []
    add = L.append
    add("# Gable House: LEGO® model kit with build instructions\n")
    add(f"![The finished model](images/{stem}_front_right.jpg)\n")
    add("A buildable LEGO model of a small one-and-a-half-storey house under one steep front "
        "gable, designed from a photo of an imagined home. It includes:")
    add("- the steep black roof facing the street, with white trim along both rakes and the "
        "eaves")
    add("- the half-storey in the gable, clad in warm wood (Medium Nougat), with a black "
        "balcony door and a white-trimmed window either side")
    add("- the small entry porch on four square white columns; its flat roof is the balcony, "
        "with a white spindle railing")
    add("- charcoal siding on a white skirt, two white double windows either side of the black "
        "front door, two white steps, tall white-trimmed windows down the sides and a black "
        "downspout")
    add("- the lawn, the concrete walk to the sidewalk and the street, flower beds with shrubs "
        "and daffodils, a wooden privacy fence running back from the right side, three tall "
        "pines and a young tree\n")
    add("The model is sold as a pack of parts with a PDF booklet. Every part is a real LEGO "
        "element from Pick a Brick's Bestseller range, and one file uploads the whole list "
        "for 1, 10 or 25 kits.\n")
    add("| | |\n|---|---|")
    add(f"| Pieces | **{s['pieces']}** ({s['lines']} part/colour lines, {s['designs']} kinds of "
        f"part, {s['colours']} colours) |")
    add("| Base | 32 × 32 studs (25.6 × 25.6 cm): four 16 × 16 plates |")
    top = ("the peak of the gable" if house_cm >= h - 0.05 else
           f"the tops of the pines; the house is {house_cm} cm tall to the peak of its gable")
    add(f"| Overall size | {w} × {d} cm, {h} cm tall ({top}) |")
    add("| House | 16 × 14 studs (32 × 28 ft), 18 studs wide across the eaves; a 45° roof |")
    add(f"| Scale | {plain(P['facts'][1][1])} |")
    add(f"| Instructions | {s['pages']}-page PDF, {s['steps']} steps, {s['sections']} sections |")
    add(f"| Parts cost | **{money(s['cost'])} per kit** at the Pick a Brick prices last seen "
        f"(2022 and late 2025); about {money(c['parts'])} with 2026 price rises (see "
        "[Cost assumptions](#cost-assumptions-and-resale-scenarios)) |")
    add(f"| Kits per order | up to **{s['copies']}** (the most-used part is needed "
        f"{s['max_q']} times; Pick a Brick sells up to 999 of an element) |")
    add(f"\n![Front view](images/{stem}_front.jpg)\n")

    add("## What's in this folder\n")
    add("| Path | What it is |\n|---|---|")
    add(f"| [`instructions/{pdf}`](instructions/{pdf}) | **The instruction booklet**: cover, "
        f"section intros with parts lists, {s['steps']} numbered steps, gallery, parts inventory "
        "with element IDs, ordering guide |")
    add("| [`parts/pick_a_brick_upload.csv`](parts/pick_a_brick_upload.csv) | Pick a Brick "
        f"upload file for **one kit** ({s['lines']} element IDs) |")
    add("| [`parts/pick_a_brick_upload_x10.csv`](parts/pick_a_brick_upload_x10.csv), "
        "[`parts/pick_a_brick_upload_x25.csv`](parts/pick_a_brick_upload_x25.csv) | Upload "
        f"files for **10 kits** ({s['pieces'] * 10:,} pieces) and **25 kits** "
        f"({s['pieces'] * 25:,} pieces) |")
    add("| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the "
        "price and when it was seen |")
    add("| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: "
        "element ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, "
        "alternate IDs |")
    add("| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part "
        "sourcing: Pick a Brick name, evidence it's sold, last price, the ID to try next, "
        "BrickLink backup |")
    add("| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | "
        f"Newer element IDs for {s['retry']} of the parts, for lines the upload doesn't match |")
    add("| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), "
        "[`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list "
        "and Rebrickable import (one kit) |")
    add("| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, "
        "for bagging |")
    add(f"| [`model/{stem}.mpd`](model/{stem}.mpd) | The digital model (LDraw, with steps and "
        "submodels). Opens in BrickLink Studio, LeoCAD and LDCad |")
    add("| [`checks.md`](checks.md) | Results of the digital build checks |")
    add("| [`design.py`](design.py) | The design, written as code on the stud grid |")
    add("| [`readme.py`](readme.py) | Writes this README from the build outputs |\n")

    add("## Ordering the parts\n")
    add("1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.")
    add("2. Upload the file for 1, 10 or 25 kits.")
    add("3. Before you pay, check that every line shows the normal (Bestseller) delivery time "
        "and compare the bag total with the cost below.")
    add("4. If a line isn't matched, use the ID in the retry file or in the \"If not found\" "
        "column of the mapping, multiplied by the number of kits.\n")
    more = (" (the 25-kit file needs two orders, or ask LEGO customer service)"
            if s["copies"] < 25 else "")
    add(f"**Kits per order:** the part this kit uses most is needed {s['max_q']} times, so one "
        f"order holds up to **{s['copies']} kits**{more}.\n")
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
        watch.append("Parts in fewer than 10 sets since 2024 (more likely to sell out): "
                     + "; ".join(f"{n} {col} ({k} sets)" for k, n, col in s["few_sets"][:6]) + ".")
    if s["unpriced"]:
        watch.append("No price seen for: " + ", ".join(s["unpriced"]) + ".")
    watch.append("LEGO pauses Standard parts in the US and Canada from November 2, 2026; this "
                 "kit uses none, but check that no line shows a longer delivery time.")
    add("**Sourcing uncertainties:**\n")
    L.extend(f"- {x}" for x in watch)
    add("")

    add("## Cost assumptions and resale scenarios\n")
    add("These are planning numbers, not quotes. Upload the 10-kit file to see today's prices: "
        "the bag total is the real parts cost.\n")
    add("| Assumption | Value |\n|---|---|")
    for a, b in pr.ASSUMPTIONS:
        add(f"| {a} | {b.replace('for each resort', 'for this kit')} |")
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
    for p in pr.price_points(s["cost"]):
        a = pr.scenario(s["cost"], s["pieces"], p, True)
        b = pr.scenario(s["cost"], s["pieces"], p, False)
        add(f"| {money(p)} ({p / s['pieces'] * 100:.0f}¢/piece) | {money(a['profit'])} | "
            f"{a['margin']:.0%} | {money(b['profit'])} | {b['margin']:.0%} |")
    add(f"\nBreak-even price: {money(pr.break_even(s['cost'], s['pieces']))} with free "
        f"shipping, {money(pr.break_even(s['cost'], s['pieces'], False))} when the buyer pays "
        "postage (2026 estimate). The stress case adds about "
        f"{money(hi['parts'] - c['parts'])} per kit. The 32 × 32 base makes a box of about "
        "28 × 28 cm; check the shipping weight and size band before setting a free-shipping "
        "price.\n")

    add("## Digital checks and physical prototype\n")
    add("`lego-kit/checks.py` checked the digital model ([`checks.md`](checks.md)):\n")
    add("| Check | Result |\n|---|---|")
    for k in ("Collisions", "Connections", "Assembly order", "Stability"):
        add(f"| {k} | {s['checks'].get(k, 'not run')} |")
    add("\nThe model was checked on the computer only: parts fit the stud grid without overlaps "
        "and every part is held by a stud. **No physical prototype has been built.** Before "
        "selling, build one kit from the uploaded parts and the printed booklet, to confirm the "
        "parts arrive as listed, the build holds together when handled, and each step is "
        "clear. Give the front gable extra attention: it is a single-brick-thick wall in front "
        "of the roof, held by the studs below it.\n")

    add("## Building notes\n")
    add("- **Sections:**")
    L.extend(f"  {i}. {plain(x)}" for i, x in enumerate(P["organisation"], 1))
    add("- **Modules:** the house, the pines and the front tree are built on their own and then "
        "set on the lot.")
    add("- **Ground floor:** four courses of charcoal bricks on a white skirt. The corners swap "
        "between the two walls on every course and the joints are staggered, so the walls lock "
        "together. The porch stands on the same foundation plates as the walls, and its white "
        "roof plate reaches back onto the front wall.")
    add("- **Gable and roof:** the wood gable stands on the front wall and the roof starts one "
        "stud behind it. The white 1×1 slopes on the gable's end steps and the white 45° slopes "
        "at the ends of the roof make the rake trim; the white eave plates make the fascia.")
    add("- **Interior:** the house is hollow, so the windows show into it.")
    L.extend(f"- {plain(t)}" for t in P["tips"][1:2])
    add(f"\n![Front left view](images/{stem}_front_left.jpg)\n")
    add(f"![Aerial view](images/{stem}_aerial.jpg)\n")
    add(f"![Back view](images/{stem}_back.jpg)\n")

    add("## How it was made\n")
    add("The model is generated by [`design.py`](design.py) with the shared toolkit in "
        "[`../lego-kit`](../lego-kit), at the scale of the Family Home in "
        "[`../house-lego`](../house-lego). The toolkit builds on the stud grid using the real "
        "part shapes from the LDraw library and checks that no two elements overlap and that "
        "every element is held by at least one stud, within the house, pine and tree "
        "submodels too. `./build.sh` renders the steps with LeoCAD, maps every part to LEGO "
        "element IDs, writes the parts lists and upload files, runs the checks, prints the "
        "booklet and writes this README.\n")
    add("```bash\n./build.sh            # set DATA_DIR to refresh element IDs (see "
        "../lego-kit/README.md)\n```\n")
    add("lego.com, BrickLink and Rebrickable could not be reached from the environment this was "
        "made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick "
        "listings from 2022 and late 2025. With internet access, "
        "`node ../lego-kit/pab_check.cjs .` checks every element live.\n")
    add("## Disclaimer\n")
    add("An unofficial fan design (MOC) of a generic house, designed from a photo of an imagined "
        "home concept. It is not affiliated with, sponsored or endorsed by The LEGO Group. "
        "LEGO® is a trademark of The LEGO Group.")
    with open(os.path.join(proj.root, "README.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print(f"README: {s['pieces']} pieces, {money(s['cost'])}, {s['pages']} pages, "
          f"{s['steps']} steps")


if __name__ == "__main__":
    proj = projects.Project(HERE)
    extra_images(proj)
    write(proj)
