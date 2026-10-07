"""Check parts before designing: element ID, last set year and Pick a Brick evidence.

    DATA_DIR=/path/to/data python3 avail.py 3001,3003:15,19 3062b:47

Each argument is PARTS:COLOURS (LDraw part numbers and LDraw colour codes).
A part is fit for a Bestseller-only kit when it shows p22=yes and a last year
of 2025 or later (export_parts.py enforces the same rule). DATA_DIR is the
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
    ok = r["pab_2022"] == "yes" and str(r["last_set_year"]) >= "2025"
    print(f"{'OK ' if ok else '-- '}{r['ldraw_part']:10s} {r['bricklink_color']:20s} "
          f"{r['element_id']:8s} last={str(r['last_set_year']):5s} n24={str(r['sets_since_2024']):4s} "
          f"p25={r['pab_2025']:3s} p22={r['pab_2022']:3s} price22={r.get('pab_price_2022') or '':5} "
          f"{r['pab_name']}")
