"""Digital build checks for a project; writes <project>/checks.md.

    python3 checks.py <project-dir>

Checks every model (the main model and each submodel) on the stud grid:

  collisions     no two elements share space;
  connections    every element is held by at least one stud, and each model is
                 one connected piece, so it can be built and moved on its own;
  assembly order in step order, nothing is pressed on from below onto a part
                 that is already placed, and no part stays loose for more than
                 two steps before it is tied to the rest;
  stability      no element of 4 or more studs is held by a single stud.

These are checks of the digital model. They don't replace building a physical
prototype: clutch, clips, bars, side studs and weight are not tested.
Exit code 1 if a collision or a loose part is found.
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project as projects  # noqa: E402
from bricks import SubRef, PARTS, COLOR_NAMES, validate  # noqa: E402

LOOSE_STEPS = 2          # a part may wait this many steps to be tied in


def _parts(model):
    """Units of a model in build order: one per element, one per placed submodel."""
    units = []
    for it in model.items:
        if isinstance(it, SubRef):
            fl = it.model.flatten(it.x, it.z, it.layer)
            units.append((it.step, f"submodel {it.model.name}", fl))
        else:
            units.append((it.step, None, [dict(item=it, dx=0, dz=0, dlayer=0, rot=0)]))
    return units


def _geo(f):
    it, dx, dz, dl = f["item"], f["dx"], f["dz"], f["dlayer"]
    if it.layer is None:                       # bars, flags: held by their 'attached' note
        return None
    top = it.layer + dl + it.height
    return dict(
        cells={(cx + dx, cz + dz, h + dl) for (cx, cz) in it.cells
               for h in range(it.layer, it.layer + it.height)},
        studs={(sx + dx, sz + dz, top) for (sx, sz) in it.studs},
        bottoms={(bx + dx, bz + dz, it.layer + dl) for (bx, bz) in it.bottom},
        size=len(it.cells), name=f"{PARTS[it.key].name} ({COLOR_NAMES.get(it.color, it.color)})",
        where=(it.x + dx, it.z + dz, it.layer + dl))


def check_model(model):
    units = _parts(model)
    parts = []                                 # (unit index, geo)
    for ui, (step, label, fl) in enumerate(units):
        for f in fl:
            g = _geo(f)
            if g:
                parts.append((ui, g))
    stud_at, bottom_at = defaultdict(list), defaultdict(list)
    for pi, (ui, g) in enumerate(parts):
        for k in g["studs"]:
            stud_at[k].append(pi)
        for k in g["bottoms"]:
            bottom_at[k].append(pi)

    order, stab = [], []
    # --- stability: elements of 4+ studs held by a single stud -------------
    for pi, (ui, g) in enumerate(parts):
        links = sum(len(stud_at.get(k, [])) for k in g["bottoms"]) \
            + sum(len(bottom_at.get(k, [])) for k in g["studs"])
        if g["size"] >= 4 and links == 1:
            stab.append(f"{g['name']} at {g['where']} is held by one stud")

    # --- assembly order -----------------------------------------------------
    unit_of = [ui for ui, _ in parts]
    first_step = [units[ui][0] for ui in unit_of]
    steps = sorted({u[0] for u in units})
    for s in steps:
        new = [pi for pi in range(len(parts)) if first_step[pi] == s]
        for pi in new:
            ui, g = parts[pi]
            if units[ui][1]:                       # a whole submodel is set down at once
                continue
            for k in g["studs"]:
                for q in bottom_at.get(k, []):
                    if first_step[q] < s:
                        order.append(f"step {s}: {g['name']} at {g['where']} is pressed on from "
                                     f"below onto {parts[q][1]['name']} (step {first_step[q]})")
                        break
                else:
                    continue
                break
        # parts placed so far, grouped by their connections
        placed = [pi for pi in range(len(parts)) if first_step[pi] <= s]
        parent = {pi: pi for pi in placed}

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a
        for pi in placed:
            if units[unit_of[pi]][1]:              # submodel parts are one unit
                parent[find(pi)] = find(next(q for q in placed if unit_of[q] == unit_of[pi]))
        for k, lst in bottom_at.items():
            for b in lst:
                if b not in parent:
                    continue
                for t in stud_at.get(k, []):
                    if t in parent:
                        parent[find(b)] = find(t)
        groups = defaultdict(list)
        for pi in placed:
            groups[find(pi)].append(pi)
        if len(groups) > 1:
            main = max(groups.values(), key=len)
            for grp in groups.values():
                if grp is main:
                    continue
                oldest = min(first_step[pi] for pi in grp)
                if s - oldest == LOOSE_STEPS + 1 and s != steps[-1]:
                    pi = min(grp, key=lambda q: first_step[q])
                    order.append(f"step {oldest}: {parts[pi][1]['name']} at {parts[pi][1]['where']} "
                                 f"(and {len(grp) - 1} more) stays loose for more than "
                                 f"{LOOSE_STEPS} steps")
    return order, stab


def run(proj):
    main_m, models, problems = proj.build(verbose=False)
    rows, details = [], []
    ok = True
    total = 0
    for m in models:
        probs = validate(m, verbose=False)
        overlaps = [p for p in probs if p.startswith("overlap")]
        loose = [p for p in probs if p.startswith("loose")]
        order, stab = check_model(m)
        n = len(m.flatten())
        total = max(total, n)
        ok = ok and not overlaps and not loose
        rows.append((m.name, n, len(overlaps), len(loose), len(order), len(stab)))
        for title, lst in (("Collisions", overlaps), ("Loose parts", loose),
                           ("Assembly order", order), ("Stability", stab)):
            if lst:
                details.append(f"**{m.name}: {title}**\n\n" + "\n".join(f"- {x}" for x in lst[:30]))

    def res(i, warn=False):
        bad = sum(r[i] for r in rows)
        if not bad:
            return "Pass"
        return f"{bad} warning(s)" if warn else f"FAIL ({bad})"
    md = [f"# Digital checks: {proj.meta['title']}", "",
          f"Generated by `lego-kit/checks.py` from `model/{proj.meta['model_name']}.mpd`.",
          "These check the digital model only; see \"Digital checks and physical prototype\" "
          "in the README.", "",
          "| Check | What it means | Result |", "|---|---|---|",
          f"| Collisions | No two elements share space | {res(2)} |",
          f"| Connections | Every element is held by at least one stud, and each model is one "
          f"piece | {res(3)} |",
          f"| Assembly order | Nothing is pressed on from below onto a placed part; no part stays "
          f"loose for more than {LOOSE_STEPS} steps | {res(4, True)} |",
          f"| Stability | No element of 4 or more studs is held by a single stud | {res(5, True)} |",
          "", "| Model | Elements | Collisions | Loose groups | Order warnings | Stability "
          "warnings |", "|---|---|---|---|---|---|"]
    md += [f"| `{r[0]}` | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} |" for r in rows]
    md += ["", "Not checked digitally: clutch strength, clips, bars and side studs (taken as "
           "attached where the design says so), weight and balance, and how easy each step "
           "is for a person to build."]
    if details:
        md += ["", "## Details", ""] + details
    with open(os.path.join(proj.root, "checks.md"), "w") as fh:
        fh.write("\n".join(md) + "\n")
    print(f"checks: {'pass' if ok else 'FAIL'}; " + "; ".join(
        f"{r[0]} {r[1]} el, {r[2]} coll, {r[3]} loose, {r[4]} order, {r[5]} stab" for r in rows))
    return ok


if __name__ == "__main__":
    sys.exit(0 if run(projects.load(sys.argv)) else 1)
