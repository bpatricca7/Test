"""Collection table and checklist for the compact resort kits.

    python3 collection_report.py ../resort-collection

Reads lineup.csv in the collection folder and each kit folder it names, then
writes comparison.csv and fills the marked blocks of the collection README:
<!-- lineup:start --> ... <!-- lineup:end -->,
<!-- checklist:start --> ... <!-- checklist:end --> and
<!-- comparison:start --> ... <!-- comparison:end -->.
"""
import csv
import json
import os
import re
import subprocess
import sys
from collections import Counter

KIT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, KIT)
import project as projects  # noqa: E402
import pricing as pr  # noqa: E402
from kit_readme import read_csv  # noqa: E402


def money(x):
    return f"${x:,.2f}"


def status(root, folder):
    d = os.path.join(root, folder)
    if not os.path.isdir(d):
        return None, {}
    proj = projects.Project(d)
    have = {
        "model": os.path.exists(proj.mpd),
        "checks": os.path.exists(os.path.join(d, "checks.md")),
        "renders": os.path.isdir(os.path.join(d, "images")),
        "booklet": os.path.exists(os.path.join(proj.instr_dir, proj.meta["pdf_name"])),
        "parts": all(os.path.exists(os.path.join(proj.parts_dir, f)) for f in (
            "pick_a_brick_upload.csv", "pick_a_brick_upload_x10.csv",
            "pick_a_brick_upload_x25.csv", "kit_cost.csv", "pick_a_brick_list.csv")),
        "readme": os.path.exists(os.path.join(d, "README.md")),
    }
    return proj, have


def stats(kit_dir):
    """kit_readme.kit_stats() in a process of its own: each kit's design.py may
    register parts or change size rules, and must not affect the next kit."""
    out = subprocess.run([sys.executable, os.path.join(KIT, "kit_readme.py"), "--stats-json",
                          kit_dir], capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def main(coll):
    root = os.path.dirname(os.path.abspath(coll))
    lineup = read_csv(os.path.join(coll, "lineup.csv"))
    rows, check_rows, elements = [], [], Counter()
    kits_with = Counter()
    for r in lineup:
        proj, have = status(root, r["folder"])
        mark = lambda k: "✅" if have.get(k) else "⬜"  # noqa: E731
        if not proj:
            check_rows.append(f"| {r['order']} | {r['title']} | {r['batch']} | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | "
                              "not started |")
            continue
        s = stats(proj.root) if have["parts"] else None
        passed = s and all(v == "Pass" or "warning" in v for v in s["checks"].values()) \
            and len(s["checks"]) == 4
        done = all(have.values()) and passed
        check_rows.append(
            f"| {r['order']} | [{r['title']}](../{r['folder']}/README.md) | {r['batch']} | "
            f"{mark('model')} | {'✅' if passed else '⬜'} | {mark('renders')} | {mark('booklet')} | "
            f"{mark('parts')} | {mark('readme')} | {'done (digital)' if done else 'in progress'} |")
        if not s:
            continue
        for e in read_csv(os.path.join(proj.parts_dir, "pick_a_brick_upload.csv")):
            elements[e["elementId"]] += 1
            kits_with[e["elementId"]] += 1
        c = pr.unit_costs(s["cost"], s["pieces"])
        mid = pr.price_points(s["cost"])[1]
        a = pr.scenario(s["cost"], s["pieces"], mid, True)
        b = pr.scenario(s["cost"], s["pieces"], mid, False)
        risk = []
        if s["only22"]:
            risk.append(f"{s['only22']}/{s['lines']} lines 2022-only")
        if s["retry"]:
            risk.append(f"{s['retry']} new IDs")
        if s["few_sets"]:
            risk.append(f"{len(s['few_sets'])} in <10 recent sets")
        rows.append(dict(
            order=r["order"], resort=r["title"], folder=r["folder"], category=r["category"],
            pieces=s["pieces"], lines=s["lines"], designs=s["designs"], colours=s["colours"],
            parts_listed=round(s["cost"], 2), parts_2026=round(c["parts"], 2),
            parts_stress=round(s["cost"] * (1 + pr.REPRICE_HIGH), 2),
            landed_seller_ships=round(c["before_shipping"] + pr.SHIP_SELLER_PAID, 2),
            break_even_free_ship=round(pr.break_even(s["cost"], s["pieces"]), 2),
            price=mid, profit_free_ship=round(a["profit"], 2), margin_free_ship=round(a["margin"], 3),
            profit_buyer_ship=round(b["profit"], 2), margin_buyer_ship=round(b["margin"], 3),
            kits_per_order=s["copies"], height_cm=s["dims"][2], pages=s["pages"], steps=s["steps"],
            sourcing=", ".join(risk) or "none flagged"))
    with open(os.path.join(coll, "comparison.csv"), "w", newline="") as fh:
        if rows:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)

    checklist = ["| # | Resort | Batch | Model | Checks pass | Renders | Booklet | BOM and upload "
                 "files | README | Status |", "|---|---|---|---|---|---|---|---|---|---|"] + check_rows
    n_done = sum(1 for x in check_rows if "done (digital)" in x)
    checklist.insert(0, f"**{n_done} of {len(lineup)} kits complete** (digital package; no "
                        "physical prototypes yet).\n")
    comp = ["| Resort | Category | Pieces | Part lines | Parts, listed | Parts, 2026 est. | Landed cost, "
            "free shipping | Break-even | Price (2× parts) | Profit / margin, free shipping | "
            "Profit / margin, buyer pays postage | Sourcing uncertainty |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for x in rows:
        comp.append(f"| [{x['resort']}](../{x['folder']}/README.md) | {x['category']} | {x['pieces']} | "
                    f"{x['lines']} | {money(x['parts_listed'])} | {money(x['parts_2026'])} | "
                    f"{money(x['landed_seller_ships'])} | {money(x['break_even_free_ship'])} | "
                    f"{money(x['price'])} | {money(x['profit_free_ship'])} / {x['margin_free_ship']:.0%} | "
                    f"{money(x['profit_buyer_ship'])} / {x['margin_buyer_ship']:.0%} | {x['sourcing']} |")
    if rows:
        tot_lines = sum(x["lines"] for x in rows)
        shared = sum(1 for k, v in kits_with.items() if v > 1)
        hi = max(rows, key=lambda x: x["parts_listed"])
        lo = min(rows, key=lambda x: x["parts_listed"])
        comp += ["", f"- **{len(rows)} kits**: parts from {money(lo['parts_listed'])} "
                 f"({lo['resort']}) to {money(hi['parts_listed'])} ({hi['resort']}) at listed prices; "
                 f"{min(x['pieces'] for x in rows)}–{max(x['pieces'] for x in rows)} pieces.",
                 f"- **Shared parts**: the kits use {len(kits_with)} distinct elements in "
                 f"{tot_lines} kit lines; {shared} elements appear in two or more kits, so mixed "
                 "orders combine well.",
                 f"- **Break-even** (2026 parts estimate, packaging, labour, fees): "
                 f"{money(min(x['break_even_free_ship'] for x in rows))}–"
                 f"{money(max(x['break_even_free_ship'] for x in rows))} with free shipping.",
                 f"- **At twice the parts cost** ({money(min(x['price'] for x in rows))}–"
                 f"{money(max(x['price'] for x in rows))}): profit "
                 f"{money(min(x['profit_free_ship'] for x in rows))}–"
                 f"{money(max(x['profit_free_ship'] for x in rows))} a kit "
                 f"({min(x['margin_free_ship'] for x in rows):.0%}–"
                 f"{max(x['margin_free_ship'] for x in rows):.0%}) with free shipping, "
                 f"{money(min(x['profit_buyer_ship'] for x in rows))}–"
                 f"{money(max(x['profit_buyer_ship'] for x in rows))} "
                 f"({min(x['margin_buyer_ship'] for x in rows):.0%}–"
                 f"{max(x['margin_buyer_ship'] for x in rows):.0%}) when the buyer pays postage.",
                 "- Outliers above $60 in parts are marked for simplification in the kit's README."
                 if any(x["parts_listed"] > 60 for x in rows) else
                 "- No kit is above $60 in parts at listed prices."]
    lineup_md = ["| # | Kit (folder) | Resort | Category | Also covers | Signature features in the "
                 "compact kit | Main colours |", "|---|---|---|---|---|---|---|"]
    for r in lineup:
        lineup_md.append(f"| {r['order']} | {r['title']} (`{r['folder']}`) | {r['resort']} | "
                         f"{r['category']} | {r['merged'] or '–'} | {r['signature']} | {r['colours']} |")
    readme = os.path.join(coll, "README.md")
    text = open(readme).read()
    for tag, block in (("lineup", lineup_md), ("checklist", checklist), ("comparison", comp)):
        text = re.sub(rf"(<!-- {tag}:start -->).*?(<!-- {tag}:end -->)",
                      lambda m: m.group(1) + "\n" + "\n".join(block) + "\n" + m.group(2), text,
                      flags=re.S)
    with open(readme, "w") as fh:
        fh.write(text)
    print(f"collection: {len(rows)} kits with parts; {n_done} complete")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../resort-collection")
