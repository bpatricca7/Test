"""Map every LDraw part/colour in the model to LEGO element IDs.

Uses offline copies of Rebrickable's database (elements, parts, set
inventories) and two scrapes of LEGO Pick a Brick (2022 and late 2025) to
choose the most current element ID and to flag how likely each element is
to be stocked by Pick a Brick.

  python3 lego-kit/element_lookup.py <project folder> <data dir> [part.dat:colour ...]

The data dir holds rb/*.csv (Rebrickable dump), pab2022.json, pab2025.json and
repos/vaultcrest_moc-source/cache/studio_reference_files/ElementId.json.
"""
import csv
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


# LDraw colour -> (LEGO colour name, BrickLink colour id, BrickLink name)
COLORS = {
    15: ("White", 1, "White"), 0: ("Black", 11, "Black"),
    72: ("Dark Stone Grey", 85, "Dark Bluish Gray"),
    71: ("Medium Stone Grey", 86, "Light Bluish Gray"),
    4: ("Bright Red", 5, "Red"), 2: ("Dark Green", 6, "Green"),
    288: ("Earth Green", 80, "Dark Green"), 19: ("Brick Yellow", 2, "Tan"),
    70: ("Reddish Brown", 88, "Reddish Brown"), 1: ("Bright Blue", 7, "Blue"),
    28: ("Sand Yellow", 69, "Dark Tan"), 10: ("Bright Green", 36, "Bright Green"),
    5: ("Bright Purple", 47, "Dark Pink"), 26: ("Bright Reddish Violet", 71, "Magenta"),
    29: ("Light Purple", 104, "Bright Pink"), 308: ("Dark Brown", 120, "Dark Brown"),
    47: ("Transparent", 12, "Trans-Clear"), 46: ("Transparent Yellow", 19, "Trans-Yellow"),
    31: ("Lavender", 154, "Lavender"), 30: ("Medium Lavender", 157, "Medium Lavender"),
    25: ("Bright Orange", 4, "Orange"), 14: ("Bright Yellow", 3, "Yellow"),
    320: ("New Dark Red", 59, "Dark Red"), 226: ("Cool Yellow", 103, "Bright Light Yellow"),
    297: ("Warm Gold", 115, "Pearl Gold"),
}
# LDraw part -> Rebrickable part numbers to consider (first = preferred)
RB_ALIASES = {"3023b": ["3023"], "3040b": ["3040b", "3040a", "3040"], "6141": ["6141", "4073"],
              "30374": ["30374"], "2335": ["2335"], "3062b": ["3062b"],
              "15254": ["15254"], "3960": ["3960"], "4589": ["4589", "59900"],
              # the LDraw library in use predates the current 2x2 flag (80326);
              # 2335 has the same shape and is drawn in its place
              "2335": ["80326"]}
# LDraw part -> BrickLink catalogue number
BL_PART = {"3023b": "3023", "3040b": "3040", "6141": "4073", "3062b": "3062b",
           "3069b": "3069b", "3068b": "3068b", "3070b": "3070b", "87079": "87079",
           "4589": "4589", "2335": "80326", "30374": "30374", "87580": "87580"}


def load(src):
    rb = os.path.join(src, "rb")
    elements = defaultdict(list)            # (part, color) -> [(element, design)]
    for r in csv.DictReader(open(os.path.join(rb, "elements.csv"))):
        elements[(r["part_num"], int(r["color_id"]))].append((r["element_id"], r["design_id"]))
    parts = {r["part_num"]: r["name"] for r in csv.DictReader(open(os.path.join(rb, "parts.csv")))}
    years = {r["set_num"]: int(r["year"]) for r in csv.DictReader(open(os.path.join(rb, "sets.csv")))}
    inv_year = {}
    for r in csv.DictReader(open(os.path.join(rb, "inventories.csv"))):
        if r["set_num"] in years:
            inv_year[r["id"]] = years[r["set_num"]]
    pab22 = json.load(open(os.path.join(src, "pab2022.json")))
    pab25 = {}
    for fam in json.load(open(os.path.join(src, "pab2025.json"))):
        for c in fam["colors"]:
            if c.get("element_id"):
                pab25[c["element_id"]] = (fam["brick_type"], c["color_name"], c.get("price"))
    bl = {}
    studio = os.path.join(src, "repos", "vaultcrest_moc-source", "cache",
                          "studio_reference_files", "ElementId.json")
    if os.path.exists(studio):
        for r in json.load(open(studio)):
            bl[str(r["ElementId"])] = (r["BLItemNo"], r["BLColorId"])
    return elements, parts, inv_year, pab22, pab25, bl


def usage(src, wanted, inv_year):
    """(part, color) -> (last year in a set, number of sets since 2024)."""
    out = {}
    path = os.path.join(src, "rb", "inventory_parts.csv")
    for r in csv.DictReader(open(path)):
        k = (r["part_num"], int(r["color_id"]))
        if k not in wanted or r["is_spare"] == "True":
            continue
        y = inv_year.get(r["inventory_id"])
        if y is None:
            continue
        last, n = out.get(k, (0, 0))
        out[k] = (max(last, y), n + (1 if y >= 2024 else 0))
    return out


def main(src, combos):
    elements, parts, inv_year, pab22, pab25, bl = load(src)
    cands = {}
    for dat, color in combos:
        ld = dat[:-4]
        opts = RB_ALIASES.get(ld, [ld, ld.rstrip("abcdefgh")])
        cands[(dat, color)] = [(p, color) for p in opts if p in parts]
    wanted = {k for v in cands.values() for k in v}
    use = usage(src, wanted, inv_year)
    rows = []
    for (dat, color) in combos:
        ld = dat[:-4]
        best = None
        for rbk in cands[(dat, color)]:
            last, n = use.get(rbk, (0, 0))
            for eid, design in elements.get(rbk, []):
                score = (eid in pab25, eid in pab22, last, n, int(eid))
                if best is None or score > best[0]:
                    best = (score, rbk, eid, design, last, n)
        lego_color, bl_color, bl_name = COLORS[color]
        row = dict(ldraw_part=dat, ldraw_color=color, lego_color=lego_color,
                   bricklink_part=BL_PART.get(ld, ld), bricklink_color_id=bl_color,
                   bricklink_color=bl_name, rebrickable_part="", design_id="",
                   element_id="", alt_element_ids="", last_set_year="", sets_since_2024="",
                   pab_2025="", pab_2022="", pab_price_2025="", pab_price_2022="",
                   pab_name="", availability="")
        if best:
            (_, rbk, eid, design, last, n) = best
            alts = sorted({e for k in cands[(dat, color)] for e, _ in elements.get(k, [])} - {eid})
            row.update(rebrickable_part=rbk[0], design_id=design or rbk[0], element_id=eid,
                       alt_element_ids=" ".join(alts), last_set_year=last or "",
                       sets_since_2024=n, pab_2025="yes" if eid in pab25 else "",
                       pab_2022="yes" if eid in pab22 else "",
                       pab_price_2025=(pab25.get(eid) or (None, None, ""))[2] or "",
                       pab_price_2022=(pab22.get(eid) or [None] * 4)[3] or "")
            if eid in pab22:
                row["pab_name"] = pab22[eid][2]
            elif eid in pab25:
                row["pab_name"] = pab25[eid][0]
            if eid in bl:
                bl_part, bl_col = bl[eid]
                if bl_col != bl_color:
                    print("  ! BrickLink colour mismatch", dat, color, eid, bl_col, bl_color)
                row["bricklink_part"] = bl_part
            if eid in pab25:
                row["availability"] = "listed on Pick a Brick (2025)"
            elif eid in pab22 and last >= 2024:
                row["availability"] = "likely (current, listed 2022)"
            elif last >= 2024:
                row["availability"] = "likely (in current sets)"
            elif last >= 2020:
                row["availability"] = "check (last in sets %d)" % last
            else:
                row["availability"] = "unlikely (last in sets %s)" % (last or "never")
        else:
            row["availability"] = "no element id"
        rows.append(row)
    return rows


if __name__ == "__main__":
    import project as projects
    proj = projects.load(sys.argv)
    m, models, _ = proj.build(verbose=False)
    combos = sorted(m.parts_count())
    extra = [tuple(x.split(":")) for x in sys.argv[3:]]
    combos += [(d, int(c)) for d, c in extra]
    rows = main(sys.argv[2], combos)
    os.makedirs(proj.data_dir, exist_ok=True)
    out = os.path.join(proj.data_dir, "elements.csv")
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(f"{r['ldraw_part']:10s} {r['bricklink_color']:18s} {r['element_id']:8s} "
              f"{str(r['last_set_year']):5s} {str(r['sets_since_2024']):4s} {r['availability']}")
