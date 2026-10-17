"""Check parts before designing: element ID, last set year and Pick a Brick evidence.

    DATA_DIR=/path/to/data python3 avail.py 3001,3003:15,19 3062b:47

Each argument is PARTS:COLOURS (LDraw part numbers and LDraw colour codes).
A part is fit for a Bestseller-only kit when it is on the live Bestseller list
(live=yes, from pab_live.json when the data folder has it), or else shows
p22=yes and a last year of 2025 or later (export_parts.py enforces the same
rule). "OK" means on the live list; "ok" means it passes only the older rule. DATA_DIR is the
offline data folder described in README.md ("Element data").
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import element_lookup as el  # noqa: E402

DATA = os.environ.get("DATA_DIR")
if not DATA:
    sys.exit("set DATA_DIR to the element data folder")
combos = []
for a in sys.argv[1:]:
    parts, cols = a.split(":")
    for p in parts.split(","):
        for c in cols.split(","):
            combos.append((p + ".dat", int(c)))
for r in el.main(DATA, combos):
    old = r["pab_2022"] == "yes" and str(r["last_set_year"]) >= "2025"
    mark = "OK " if r["pab_live"] else ("ok " if old else "-- ")
    price = r["pab_price_live"] or r.get("pab_price_2022") or ""
    print(f"{mark}{r['ldraw_part']:10s} {r['bricklink_color']:20s} "
          f"{r['element_id']:8s} live={r['pab_live'] or '-':3s} last={str(r['last_set_year']):5s} "
          f"n24={str(r['sets_since_2024']):4s} p25={r['pab_2025']:3s} p22={r['pab_2022']:3s} "
          f"price={price:5} {r['pab_name']}")
