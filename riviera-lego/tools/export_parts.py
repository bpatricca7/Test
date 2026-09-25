"""Write the shopping lists for the model.

  ../parts/pick_a_brick_list.csv    element IDs and quantities for LEGO Pick a Brick
  ../parts/bricklink_wanted_list.xml  BrickLink "Upload wanted list" format
  ../parts/rebrickable_parts.csv    Rebrickable part-list import (Part,Color,Quantity)
  ../parts/parts_by_section.csv     what each instruction section uses
"""
import csv
import os
import sys
from collections import Counter
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(__file__))
import riviera
from bricks import PARTS, SubRef

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "parts")
NAMES = {p.dat: p.name for p in PARTS.values()}
NAMES["2335.dat"] = "Flag 2 x 2 Square (design 80326)"


def load_elements():
    with open(os.path.join(ROOT, "data", "elements.csv"), newline="") as fh:
        return {(r["ldraw_part"], int(r["ldraw_color"])): r for r in csv.DictReader(fh)}


def price(r):
    p = r.get("pab_price_2025") or r.get("pab_price_2022")
    return float(p) if p else None


def main():
    main_m, models, problems = riviera.main()
    assert not problems
    el = load_elements()
    counts = main_m.parts_count()
    rows = sorted(counts.items(), key=lambda kv: (el[kv[0]]["lego_color"], NAMES[kv[0][0]]))
    os.makedirs(OUT, exist_ok=True)

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
        sections.insert(0, ("Grounds, porte-cochere, flowers and flags", main_m, 1))
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
    main()
