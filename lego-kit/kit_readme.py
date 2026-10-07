"""Write the README of a compact kit from its design, parts files, checks and booklet.

    python3 kit_readme.py <project>

Run it last in build.sh, after export_parts.py, checks.py, make_booklet.py and
readme_images.py. Every compact kit gets the same sections, with numbers taken
from the files the pipeline wrote, so the READMEs stay accurate after a change.
"""
import csv
import os
import re
import sys
from collections import Counter

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project as projects  # noqa: E402
import render  # noqa: E402
import pricing as pr  # noqa: E402

LDU_CM = 0.04


def plain(s):
    return re.sub(r"<[^>]+>", "", str(s)).replace("&reg;", "®").replace("&times;", "×") \
        .replace("&amp;", "&").replace("&asymp;", "≈").replace("&rsquo;", "’") \
        .replace("&ldquo;", "“").replace("&rdquo;", "”").replace("&ndash;", "–")


def read_csv(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def kit_stats(proj):
    """Numbers shared by the README and the collection table."""
    main_m, models, _ = proj.build(verbose=False, write=False)
    cost_rows = [r for r in read_csv(os.path.join(proj.parts_dir, "kit_cost.csv")) if r["Element ID"]]
    mapping = read_csv(os.path.join(proj.parts_dir, "pick_a_brick_mapping.csv"))
    elements = {(r["ldraw_part"], r["ldraw_color"]): r
                for r in read_csv(os.path.join(proj.data_dir, "elements.csv"))}
    by_el = {r["element_id"]: r for r in elements.values()}
    pieces = sum(int(r["Quantity"]) for r in cost_rows)
    cost = sum(float(r["Line cost (USD)"] or 0) for r in cost_rows)
    unpriced = [r["Description"] for r in cost_rows if not r["Unit price (USD)"]]
    designs = {r["Design ID"] for r in mapping}
    colours = {r["LEGO colour"] for r in mapping}
    max_q = max(int(r["Quantity"]) for r in cost_rows)
    evidence = Counter(r["Evidence"] for r in mapping)
    retry = sum(1 for r in mapping if r["If not found, try element ID"])
    few_sets = sorted((int(by_el[r["Element ID"]]["sets_since_2024"] or 0), r["Part (booklet name)"],
                       r["LEGO colour"]) for r in mapping
                      if r["Element ID"] in by_el and int(by_el[r["Element ID"]]["sets_since_2024"] or 0) < 10)
    only22 = sum(1 for r in mapping if "2022" in r["Evidence"])
    bmin, bmax = render.model_bbox(main_m)
    dims = tuple(round((bmax[i] - bmin[i]) * LDU_CM, 1) for i in (0, 2, 1))
    pdf = os.path.join(proj.instr_dir, proj.meta["pdf_name"])
    doc = pymupdf.open(pdf) if os.path.exists(pdf) else None
    pages = len(doc) if doc else None
    # sections as printed (small submodels share the previous section's pages)
    n_sections = sum(1 for p in doc if "elements in this section" in p.get_text()) if doc else None
    steps = sum(len(m.steps()) for m in models)
    checks = {}
    cpath = os.path.join(proj.root, "checks.md")
    if os.path.exists(cpath):
        for line in open(cpath):
            m = re.match(r"\| (Collisions|Connections|Assembly order|Stability) \|.*\| ([^|]+) \|$",
                         line.strip())
            if m:
                checks[m.group(1)] = m.group(2).strip()
    return dict(pieces=pieces, cost=cost, unpriced=unpriced, lines=len(cost_rows),
                designs=len(designs), colours=len(colours), max_q=max_q,
                copies=999 // max_q, evidence=evidence, retry=retry, few_sets=few_sets,
                only22=only22, dims=dims, pages=pages, steps=steps,
                sections=n_sections or len(proj.meta["organisation"]), checks=checks,
                top_lines=sorted(cost_rows, key=lambda r: -float(r["Line cost (USD)"] or 0))[:3])


def money(x):
    return f"${x:,.2f}"


def write(proj):
    P, s = proj.meta, kit_stats(proj)
    stem = P["model_name"]
    folder = os.path.basename(proj.root)
    size = P.get("size", "compact")
    label = {"compact": "compact", "midsize": "mid-size"}[size]
    bw, bd = P.get("base", (24, 16))
    stem_dir = folder.replace(f"-{size}-lego", "")
    siblings = [(f"{stem_dir}-{other}-lego" if other != "large" else f"{stem_dir}-lego", text)
                for other, text in (("compact", "Compact version"), ("midsize", "Mid-size version"),
                                    ("large", "Large version")) if other != size]
    siblings = [(d, t) for d, t in siblings
                if os.path.isdir(os.path.join(os.path.dirname(proj.root), d))]
    title = plain(P["title"])
    w, d, h = s["dims"]
    c = pr.unit_costs(s["cost"], s["pieces"])
    hi = pr.unit_costs(s["cost"], s["pieces"], pr.REPRICE_HIGH)
    prices = pr.price_points(s["cost"])
    L = []
    add = L.append
    add(f"# {title} ({label}): LEGO® display kit with build instructions\n")
    add(f"![The finished model](images/{stem}_front_right.jpg)\n")
    add(f"A {label} display model of {plain(P['resort'])} at Walt Disney World, part of the "
        "[resort collection](../resort-collection/README.md). " + plain(P["about"]) + "\n")
    if P.get("merged"):
        add("This kit covers " + ", ".join(P["merged"]) + " as well: they share the property, "
            f"and the {label} model shows the part that makes it recognisable.\n")
    add("**Signature features in this kit**\n")
    L += [f"- {plain(x)}" for x in P["features"]]
    add("\n**Left out to keep it compact**\n" if size == "compact" else "\n**Left out**\n")
    L += [f"- {plain(x)}" for x in P["omitted"]]
    add("")
    add("| | |\n|---|---|")
    add(f"| Pieces | **{s['pieces']}** ({s['lines']} part/colour lines, {s['designs']} kinds of part, "
        f"{s['colours']} colours) |")
    add(f"| Display base | {bw} × {bd} studs ({bw * 0.8:.1f} × {bd * 0.8:.1f} cm), the same for "
        f"every {label} kit in the collection |")
    add(f"| Overall size | {w} × {d} cm, {h} cm tall |")
    add(f"| Scale | {plain(P['facts'][1][1])} |")
    add(f"| Instructions | {s['pages']}-page PDF, {s['steps']} steps, {s['sections']} sections |")
    add(f"| Parts cost | **{money(s['cost'])} per kit** at the Pick a Brick prices last seen (2022 and "
        f"late 2025); about {money(c['parts'])} with 2026 price rises (see "
        "[Cost assumptions](#cost-assumptions-and-resale-scenarios)) |")
    for d, text in siblings:
        add(f"| {text} | [`../{d}`](../{d}) |")
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
        f"for **10 kits** ({s['pieces'] * 10:,} pieces) and **25 kits** ({s['pieces'] * 25:,} pieces) |")
    add("| [`parts/kit_cost.csv`](parts/kit_cost.csv) | Cost of one kit, line by line, with the price "
        "and when it was seen |")
    add("| [`parts/pick_a_brick_list.csv`](parts/pick_a_brick_list.csv) | Bill of materials: element "
        "ID, quantity, part, LEGO colour, design ID, BrickLink part and colour, alternate IDs |")
    add("| [`parts/pick_a_brick_mapping.csv`](parts/pick_a_brick_mapping.csv) | Part-by-part sourcing: "
        "Pick a Brick name, evidence it's sold, last price, the ID to try next, BrickLink backup |")
    add("| [`parts/pick_a_brick_upload_retry.csv`](parts/pick_a_brick_upload_retry.csv) | Newer "
        f"element IDs for {s['retry']} of the parts, for lines the upload doesn't match |")
    add("| [`parts/bricklink_wanted_list.xml`](parts/bricklink_wanted_list.xml), "
        "[`parts/rebrickable_parts.csv`](parts/rebrickable_parts.csv) | BrickLink wanted list and "
        "Rebrickable import (one kit) |")
    add("| [`parts/parts_by_section.csv`](parts/parts_by_section.csv) | Parts for each section, for "
        "bagging |")
    add(f"| [`model/{stem}.mpd`](model/{stem}.mpd) | The digital model (LDraw, with steps and "
        "submodels). Opens in BrickLink Studio, LeoCAD and LDCad |")
    add("| [`checks.md`](checks.md) | Results of the digital build checks |")
    add("| [`design.py`](design.py) | The design, written as code on the stud grid |\n")

    add("## Ordering the parts\n")
    add("1. On lego.com, open **Pick and Build → Pick a Brick** and choose **Upload list**.")
    add("2. Upload the file for 1, 10 or 25 kits.")
    add("3. Before you pay, check that every line shows the normal (Bestseller) delivery time "
        "and compare the bag total with the cost below.")
    add("4. If a line isn't matched, use the ID in the retry file or in the \"If not found\" column "
        "of the mapping, multiplied by the number of kits.\n")
    add(f"**Kits per order:** Pick a Brick sells up to 999 of one element per order. The part this "
        f"kit uses most is needed {s['max_q']} times, so one order holds up to **{s['copies']} kits**.\n")
    add("**Sourcing evidence** (every part must pass the Bestseller-only check in `export_parts.py`):\n")
    add("| Evidence | Lines |\n|---|---|")
    for k, v in s["evidence"].most_common():
        add(f"| {k} | {v} |")
    add("")
    watch = [f"{s['only22']} lines are backed only by LEGO's 2022 Bestseller list, so their range "
             "and price today are not confirmed."]
    if s["retry"]:
        watch.append(f"{s['retry']} lines have newer element IDs (retry file); an upload may match "
                     "either.")
    if s["few_sets"]:
        watch.append("Parts in fewer than 10 sets since 2024 (more likely to sell out): " + "; ".join(
            f"{n} {col} ({k} sets)" for k, n, col in s["few_sets"][:6]) + ".")
    if s["unpriced"]:
        watch.append("No price seen for: " + ", ".join(s["unpriced"]) + ".")
    add("**Sourcing uncertainties:**\n")
    L += [f"- {x}" for x in watch]
    add("- LEGO pauses Standard parts in the US and Canada from November 2, 2026; this kit uses "
        "none, but check that no line shows a longer delivery time.\n")

    add("## Cost assumptions and resale scenarios\n")
    add("These are planning numbers, not quotes. Upload the 10-kit file to see today's prices: the "
        "bag total is the real parts cost.\n")
    add("| Assumption | Value |\n|---|---|")
    L += [f"| {a} | {b} |" for a, b in pr.ASSUMPTIONS]
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
    add(f"Biggest cost lines: " + ", ".join(
        f"{r['Quantity']}× {r['Description']} ({r['LEGO colour']}) {money(float(r['Line cost (USD)']))}"
        for r in s["top_lines"]) + ".\n")
    add("| Price | Free shipping (seller pays): profit | margin | Buyer pays postage: profit | margin |")
    add("|---|---|---|---|---|")
    for p in prices:
        a, b = pr.scenario(s["cost"], s["pieces"], p, True), pr.scenario(s["cost"], s["pieces"], p, False)
        add(f"| {money(p)} ({p / s['pieces'] * 100:.0f}¢/piece) | {money(a['profit'])} | "
            f"{a['margin']:.0%} | {money(b['profit'])} | {b['margin']:.0%} |")
    add(f"\nBreak-even price: {money(pr.break_even(s['cost'], s['pieces']))} with free shipping, "
        f"{money(pr.break_even(s['cost'], s['pieces'], False))} when the buyer pays postage "
        "(2026 estimate). The stress case adds about "
        f"{money(hi['parts'] - c['parts'])} per kit.\n")

    add("## Digital checks and physical prototype\n")
    add("`lego-kit/checks.py` checked the digital model ([`checks.md`](checks.md)):\n")
    add("| Check | Result |\n|---|---|")
    for k in ("Collisions", "Connections", "Assembly order", "Stability"):
        add(f"| {k} | {s['checks'].get(k, 'not run')} |")
    add("\nThe model was checked on the computer only: parts fit the stud grid without overlaps and "
        "every part is held by a stud. **No physical prototype has been built.** Before selling, "
        "build one kit from the uploaded parts and the printed booklet, to confirm the parts "
        "arrive as listed, the build holds together when handled, and each step is clear.\n")

    add("## Building notes\n")
    add("- **Sections:**")
    L += [f"  {i}. {plain(x)}" for i, x in enumerate(P["organisation"], 1)]
    L += [f"- {plain(t)}" for t in P["tips"]]
    add(f"\n![Aerial view](images/{stem}_aerial.jpg)\n")

    add("## How it was made\n")
    add("The model is generated by [`design.py`](design.py) with the shared toolkit in "
        f"[`../lego-kit`](../lego-kit), in the collection's {label} format "
        "(`lego-kit/compact.py`). `./build.sh` renders the steps with LeoCAD, maps every part to "
        "LEGO element IDs, writes the parts lists and upload files, runs the checks, prints the "
        "booklet and writes this README.\n")
    add("```bash\n./build.sh            # set DATA_DIR to refresh element IDs (see ../lego-kit/README.md)\n```\n")
    add("lego.com, BrickLink and Rebrickable could not be reached from the environment this was "
        "made in. Availability comes from an August 2026 Rebrickable snapshot and Pick a Brick "
        "listings from 2022 and late 2025. With internet access, `node ../lego-kit/pab_check.cjs .` "
        "checks every element live.\n")
    add("## Disclaimer\n")
    add(f"An unofficial fan design (MOC) inspired by {plain(P['resort'])} at Walt Disney World. It is "
        "not affiliated with, sponsored or endorsed by The LEGO Group or Disney. LEGO® is a "
        "trademark of The LEGO Group. Resort names are trademarks of Disney; see the trademark "
        "note in the [collection README](../resort-collection/README.md) before selling.")
    with open(os.path.join(proj.root, "README.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print(f"README: {s['pieces']} pieces, {money(s['cost'])}, {s['pages']} pages, {s['steps']} steps")
    return s


if __name__ == "__main__":
    if sys.argv[1:2] == ["--stats-json"]:       # used by collection_report.py, one kit per process
        import json
        print(json.dumps(kit_stats(projects.Project(sys.argv[2])), default=list))
    else:
        write(projects.load(sys.argv))
