"""Write the shopping lists for the model.

  <project>/parts/pick_a_brick_upload.csv  ready for Pick a Brick's "Upload list" (elementId,quantity)
  <project>/parts/pick_a_brick_upload_retry.csv  same parts with each element's newest
                                    alternate ID, for anything the first upload misses
  <project>/parts/pick_a_brick_mapping.csv how each part maps to Pick a Brick, with evidence
  <project>/parts/pick_a_brick_list.csv    element IDs and quantities for LEGO Pick a Brick
  <project>/parts/bricklink_wanted_list.xml  BrickLink "Upload wanted list" format
  <project>/parts/rebrickable_parts.csv    Rebrickable part-list import (Part,Color,Quantity)
  <project>/parts/parts_by_section.csv     what each instruction section uses
  <project>/parts/pick_a_brick_upload_x<N>.csv  N copies of the model in one order, for
                                    each N in the project's "batch_sizes"
  <project>/parts/kit_cost.csv             cost of one copy at the last Pick a Brick prices

A project can set "bestseller_only": True. The export then stops if any part was
not in Pick a Brick's Bestseller range (2022 listing) or has not been in a LEGO
set since 2025, so everything ships from the fast warehouse.
"""
import csv
import os
import sys
from collections import Counter
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project as projects
from bricks import PARTS, SubRef, DatNames

ROOT = OUT = None                  # set by main() for the project
NAMES = DatNames({p.dat: p.name for p in PARTS.values()})
NAMES["2335.dat"] = "Flag 2 x 2 Square (design 80326)"


def load_elements():
    with open(os.path.join(ROOT, "data", "elements.csv"), newline="") as fh:
        return {(r["ldraw_part"], int(r["ldraw_color"])): r for r in csv.DictReader(fh)}


def price(r):
    p = r.get("pab_price_live") or r.get("pab_price_2025") or r.get("pab_price_2022")
    return float(p) if p else None


def price_seen(r):
    """When the price in price(r) was seen."""
    if r.get("pab_price_live"):
        return f"live {r['pab_live_date']}"
    if r.get("pab_price_2025"):
        return "late 2025"
    return "2022" if r.get("pab_price_2022") else ""


PAB_SEARCH = "https://www.lego.com/en-us/pick-and-build/pick-a-brick?query={}"
ORDER_CAP_STANDARD = 10     # many "Standard" range elements: max 10 per order (2025+)


def newest_alt(r):
    """Newest element ID for the same part and colour, if newer than the main one.

    LEGO re-issues element IDs (for example the 2025 change of white), and Pick a
    Brick may list the newer number.
    """
    alts = [a for a in r["alt_element_ids"].split()
            if a.isdigit() and int(a) > int(r["element_id"])]
    return max(alts, key=int) if alts else ""


SNAPSHOT_YEAR = 2026        # the Rebrickable data also lists some sets announced for later


def _sets_year(y):
    if y and int(y) > SNAPSHOT_YEAR:
        return "%d (including sets listed for %s)" % (SNAPSHOT_YEAR, y)
    return y


def evidence(r):
    if r.get("pab_live"):
        return f"On the US Pick a Brick Bestseller list, available ({r['pab_live_date']} snapshot)"
    if r["pab_2025"]:
        return "On Pick a Brick (late-2025 listing)"
    if r["pab_2022"]:
        return ("In Pick a Brick Bestseller range (2022 listing); still in LEGO sets in %s"
                % _sets_year(r["last_set_year"]))
    return "Not on the Pick a Brick listings checked; in LEGO sets in %s" % _sets_year(r["last_set_year"])


def write_pick_a_brick(rows, el):
    """Pick a Brick upload files and the part-by-part mapping."""
    with open(os.path.join(OUT, "pick_a_brick_upload.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["elementId", "quantity"])
        for (dat, color), n in rows:
            w.writerow([el[(dat, color)]["element_id"], n])
    with open(os.path.join(OUT, "pick_a_brick_upload_retry.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["elementId", "quantity"])
        for (dat, color), n in rows:
            alt = newest_alt(el[(dat, color)])
            if alt:
                w.writerow([alt, n])
    with open(os.path.join(OUT, "pick_a_brick_mapping.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Line", "Element ID", "Quantity", "Pick a Brick name", "LEGO colour",
                    "Design ID", "Part (booklet name)", "Evidence", "Last Pick a Brick price (USD)",
                    "Price seen", "Over 10 needed", "If not found, try element ID",
                    "Other element IDs", "Backup: BrickLink item / colour", "Pick a Brick search"])
        for i, ((dat, color), n) in enumerate(rows, start=1):
            r = el[(dat, color)]
            p = price(r)
            price_txt, when = ("" if p is None else f"{p:.2f}"), price_seen(r)
            alt = newest_alt(r)
            others = " ".join(a for a in r["alt_element_ids"].split() if a != alt)
            w.writerow([i, r["element_id"], n, r["pab_name"] or "(not listed)", r["lego_color"],
                        r["design_id"], NAMES[dat], evidence(r), price_txt, when,
                        "yes" if n > ORDER_CAP_STANDARD else "", alt, others,
                        f'{r["bricklink_part"]} / {r["bricklink_color"]}',
                        PAB_SEARCH.format(r["element_id"])])


BESTSELLER_SINCE = 2025      # last year in a LEGO set for "still current"
PAB_MAX_PER_ELEMENT = 999    # more than this per element needs LEGO customer service


def check_bestseller_only(rows, el):
    """Stop if any part is outside the Bestseller range.

    A part on the live Bestseller list (pab_live.json, when the element data was
    built with it) passes. Otherwise the older rule applies: on the 2022
    Bestseller list and still in LEGO sets in 2025 or later. With live data,
    parts that pass only by the older rule are listed as a warning: they were not
    on the list, or not in stock, on the snapshot date.
    """
    bad, not_live = [], []
    have_live = any(el[k].get("pab_live_date") for k, _ in rows)
    for (dat, color), n in rows:
        r = el[(dat, color)]
        if r.get("pab_live"):
            continue
        last = int(r["last_set_year"] or 0)
        label = f"{NAMES[dat]} / {r['lego_color']} ({r['element_id'] or 'no ID'}, last set {last or 'none'})"
        if not r["pab_2022"] or last < BESTSELLER_SINCE:
            bad.append(label)
        elif have_live:
            not_live.append(label)
    if not_live:
        print("warning: not on the live Bestseller list (passes the 2022 rule):\n  "
              + "\n  ".join(not_live))
    if bad:
        raise SystemExit("not Bestseller-only:\n  " + "\n  ".join(bad))


def write_batches(rows, el, sizes):
    """Upload files for N copies; returns the most copies one order can hold."""
    most = max(n for _, n in rows)
    for k in sizes:
        with open(os.path.join(OUT, f"pick_a_brick_upload_x{k}.csv"), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["elementId", "quantity"])
            for (dat, color), n in rows:
                w.writerow([el[(dat, color)]["element_id"], n * k])
    return PAB_MAX_PER_ELEMENT // most


def write_kit_cost(rows, el):
    with open(os.path.join(OUT, "kit_cost.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Element ID", "Quantity", "Description", "LEGO colour",
                    "Unit price (USD)", "Price seen", "Line cost (USD)"])
        total = 0.0
        for (dat, color), n in rows:
            r = el[(dat, color)]
            p = price(r)
            when = price_seen(r)
            cost = (p or 0.0) * n
            total += cost
            w.writerow([r["element_id"], n, NAMES[dat], r["lego_color"],
                        "" if p is None else f"{p:.2f}", when, f"{cost:.2f}"])
        w.writerow(["", sum(n for _, n in rows), "Total for one copy", "", "", "", f"{total:.2f}"])
    return total


def main(proj):
    global ROOT, OUT
    ROOT, OUT = proj.root, proj.parts_dir
    main_m, models, problems = proj.build(verbose=False)
    assert not problems
    el = load_elements()
    counts = main_m.parts_count()
    rows = sorted(counts.items(), key=lambda kv: (el[kv[0]]["lego_color"], NAMES[kv[0][0]]))
    os.makedirs(OUT, exist_ok=True)
    if proj.meta.get("bestseller_only"):
        check_bestseller_only(rows, el)

    total_price, priced, unpriced = 0.0, 0, []
    with open(os.path.join(OUT, "pick_a_brick_list.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Element ID", "Quantity", "Description", "LEGO colour", "Design ID",
                    "BrickLink part", "BrickLink colour", "Alternate element IDs",
                    "Last year in a set", "Availability (from data)",
                    "Pick a Brick unit price seen (USD)"])
        for (dat, color), n in rows:
            r = el[(dat, color)]
            p = price(r)
            if p is None:
                unpriced.append(NAMES[dat])
            else:
                total_price += p * n
                priced += n
            w.writerow([r["element_id"], n, NAMES[dat], r["lego_color"], r["design_id"],
                        r["bricklink_part"], r["bricklink_color"], r["alt_element_ids"],
                        r["last_set_year"], r["availability"], "" if p is None else f"{p:.2f}"])

    write_pick_a_brick(rows, el)
    if proj.meta.get("batch_sizes"):
        per_order = write_batches(rows, el, proj.meta["batch_sizes"])
        print(f"batch files for {proj.meta['batch_sizes']} copies; up to {per_order} copies "
              f"fit in one order ({PAB_MAX_PER_ELEMENT} per element)")
        write_kit_cost(rows, el)

    with open(os.path.join(OUT, "bricklink_wanted_list.xml"), "w") as fh:
        fh.write("<INVENTORY>\n")
        for (dat, color), n in rows:
            r = el[(dat, color)]
            fh.write("  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n"
                     f"    <ITEMID>{escape(r['bricklink_part'])}</ITEMID>\n"
                     f"    <COLOR>{r['bricklink_color_id']}</COLOR>\n"
                     f"    <MINQTY>{n}</MINQTY>\n    <CONDITION>N</CONDITION>\n"
                     "  </ITEM>\n")
        fh.write("</INVENTORY>\n")

    with open(os.path.join(OUT, "rebrickable_parts.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Part", "Color", "Quantity"])
        for (dat, color), n in rows:
            r = el[(dat, color)]
            w.writerow([r["rebrickable_part"] or dat[:-4], color, n])

    # parts per instruction section (submodels multiplied by how often they are used)
    uses = Counter()
    for it in main_m.items:
        if isinstance(it, SubRef):
            uses[it.model.name] += 1
    with open(os.path.join(OUT, "parts_by_section.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Section", "Element ID", "Quantity", "Description", "LEGO colour"])
        sections = [(m.title, m, uses.get(m.name, 1)) for m in models if m is not main_m]
        sections.insert(0, (proj.meta.get("main_parts_label", "Base and parts added on it"),
                            main_m, 1))
        for title, m, mult in sections:
            c = Counter()
            for it in m.items:
                if not isinstance(it, SubRef):
                    c[(PARTS[it.key].dat, it.color)] += mult
            for (dat, color), n in sorted(c.items(), key=lambda kv: (el[kv[0]]["lego_color"], NAMES[kv[0][0]])):
                r = el[(dat, color)]
                w.writerow([title, r["element_id"], n, NAMES[dat], r["lego_color"]])

    n_total = sum(counts.values())
    print(f"{n_total} elements, {len(rows)} line items")
    print(f"priced {priced} elements: ${total_price:.2f}; unpriced lines: {unpriced}")
    return n_total, len(rows), total_price, priced


if __name__ == "__main__":
    main(projects.load(sys.argv))
