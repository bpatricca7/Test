"""Render instruction images with LeoCAD and write a build manifest.

For every step of every (sub)model this renders the model as it stands after
that step, with the new elements highlighted, from a camera framed on the
step.  It also renders one image per element (for the parts callouts) at a
common scale, and one image of each finished submodel.

Output: ../build/renders/... and ../build/manifest.json
"""
import json
import math
import os
import subprocess
import sys
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import riviera
from bricks import PARTS, COLOR_NAMES, SubRef
from ldraw_geom import geometry

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUILD = os.path.join(ROOT, "build")
RENDERS = os.path.join(BUILD, "renders")
MPD = os.path.join(ROOT, "model", "riviera_resort.mpd")
LDRAW = "/usr/share/ldraw"

LAT, LON = 28, 32          # camera: 28 deg above, 32 deg to the right of front
FOV = 22
HIGHLIGHT = "#FFFF8C00"    # orange edge lines on the elements added in a step
DAT_NAMES = {p.dat: p.name for p in PARTS.values()}


def leocad(args, retries=2):
    cmd = ["xvfb-run", "-a", "-s", "-screen 0 2600x2000x24", "leocad", "-l", LDRAW] + args
    for _ in range(retries + 1):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if "Saved" in r.stdout + r.stderr:
            return
    raise RuntimeError("leocad failed: " + " ".join(cmd) + "\n" + r.stdout + r.stderr)


def trim(path, pad=12):
    im = Image.open(path).convert("RGBA")
    box = im.split()[3].getbbox()
    if box:
        x0, y0, x1, y1 = box
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad),
                      min(im.width, x1 + pad), min(im.height, y1 + pad)))
    im.save(path, optimize=True)
    return im.size


# --------------------------------------------------------------------------
# bounding boxes in LDraw coordinates
# --------------------------------------------------------------------------
def _corners(bmin, bmax):
    for x in (bmin[0], bmax[0]):
        for y in (bmin[1], bmax[1]):
            for z in (bmin[2], bmax[2]):
                yield (x, y, z)


def item_points(it):
    if isinstance(it, SubRef):
        bmin, bmax = model_bbox(it.model)
        t = (20 * it.x, -8 * it.layer, 20 * it.z)
        return [(p[0] + t[0], p[1] + t[1], p[2] + t[2]) for p in _corners(bmin, bmax)]
    ox, oy, oz, m, dat = it.ldraw
    bmin, bmax, _ = geometry(dat)
    pts = []
    for (x, y, z) in _corners(bmin, bmax):
        pts.append((m[0] * x + m[1] * y + m[2] * z + ox,
                    m[3] * x + m[4] * y + m[5] * z + oy,
                    m[6] * x + m[7] * y + m[8] * z + oz))
    return pts


def bbox_of(items):
    pts = [p for it in items for p in item_points(it)]
    return (tuple(min(p[i] for p in pts) for i in range(3)),
            tuple(max(p[i] for p in pts) for i in range(3)))


_mb = {}


def model_bbox(model):
    if model.name not in _mb:
        _mb[model.name] = bbox_of(model.items)
    return _mb[model.name]


def camera_for(bmin, bmax, lat=LAT, lon=LON, fov=FOV, margin=1.04):
    c = [(bmin[i] + bmax[i]) / 2 for i in range(3)]
    r = 0.5 * math.sqrt(sum((bmax[i] - bmin[i]) ** 2 for i in range(3)))
    r = max(r, 40)
    d = margin * r / math.sin(math.radians(fov) / 2)
    la, lo = math.radians(lat), math.radians(lon)
    pos = (c[0] + d * math.sin(lo) * math.cos(la),
           c[1] - d * math.sin(la),
           c[2] - d * math.cos(lo) * math.cos(la))
    return ["--camera-position-ldraw"] + ["%.2f" % v for v in (*pos, *c, 0, -1, 0)] + \
           ["--fov", str(fov)]


# --------------------------------------------------------------------------
def px_per_ldu(bmin, bmax, fov=FOV, margin=1.04, height=1400):
    r = max(0.5 * math.dist(bmin, bmax), 40)
    d = margin * r / math.sin(math.radians(fov) / 2)
    return height / (2 * d * math.tan(math.radians(fov) / 2))


def wants_highlight(items):
    """Outline new parts, except in steps that lay big plates (obvious anyway)."""
    for it in items:
        if isinstance(it, SubRef):
            continue
        if len(PARTS[it.key].cells) > 24:
            return False
    return True


def step_jobs(model, is_main):
    """One render per step.

    Submodels keep one camera for all their steps (constant scale); the main
    model frames each step on what changed.
    """
    jobs, scales = [], {}
    fixed = None if is_main else model_bbox(model)
    for s in model.steps():
        upto = [it for it in model.items if it.step <= s]
        new = [it for it in model.items if it.step == s]
        if fixed:
            bmin, bmax = fixed
        else:
            bmin, bmax = bbox_of(upto)
            nmin, nmax = bbox_of(new)
            r_all = 0.5 * math.dist(bmin, bmax)
            r_new = 0.5 * math.dist(nmin, nmax)
            if r_new < 0.4 * r_all:
                # zoom in on the new elements, keeping some context around them
                c = [(nmin[i] + nmax[i]) / 2 for i in range(3)]
                half = max(r_new * 1.25, 110)
                bmin = tuple(c[i] - half for i in range(3))
                bmax = tuple(c[i] + half for i in range(3))
        out = os.path.join(RENDERS, model.name[:-4], f"step_{s:03d}.png")
        args = ["-i", out, "-w", "1800", "-h", "1400", "-f", str(s), "-t", str(s),
                "--shading", "default", "--aa-samples", "8", "--line-width", "1.5"]
        if wants_highlight(new):
            args += ["--highlight", "--highlight-color", HIGHLIGHT]
        if not is_main:
            args += ["-s", model.name]
        args += camera_for(bmin, bmax) + [MPD]
        jobs.append((out, args))
        scales[s] = px_per_ldu(bmin, bmax)
    return jobs, scales


def part_key(dat, color):
    return f"{dat[:-4]}_{color}"


def part_jobs(counter):
    jobs = []
    tmp = os.path.join(BUILD, "tmp")
    os.makedirs(tmp, exist_ok=True)
    for (dat, color) in counter:
        bmin, bmax, _ = geometry(dat)
        size = max(bmax[0] - bmin[0], bmax[2] - bmin[2], bmax[1] - bmin[1])
        scale = 1.0 if size <= 170 else 0.5
        ldr = os.path.join(tmp, part_key(dat, color) + ".ldr")
        with open(ldr, "w") as fh:
            fh.write(f"0 part\n1 {color} 0 0 0 1 0 0 0 1 0 0 0 1 {dat}\n")
        c = [(bmin[i] + bmax[i]) / 2 for i in range(3)]
        d = 1100 / scale
        la, lo = math.radians(30), math.radians(35)
        pos = (c[0] + d * math.sin(lo) * math.cos(la), c[1] - d * math.sin(la),
               c[2] - d * math.cos(lo) * math.cos(la))
        out = os.path.join(RENDERS, "parts", part_key(dat, color) + ".png")
        args = ["-i", out, "-w", "900", "-h", "900", "--shading", "default",
                "--aa-samples", "8", "--line-width", "1.5",
                "--camera-position-ldraw"] + ["%.2f" % v for v in (*pos, *c, 0, -1, 0)] + \
               ["--fov", "20", ldr]
        jobs.append((out, args, scale))
    return jobs


def run_jobs(jobs, workers=4):
    def one(job):
        out, args = job[0], job[1]
        os.makedirs(os.path.dirname(out), exist_ok=True)
        leocad(args)
        # LeoCAD appends the step number when rendering a step range
        if not os.path.exists(out):
            base, ext = os.path.splitext(out)
            cands = [f for f in os.listdir(os.path.dirname(out))
                     if f.startswith(os.path.basename(base)) and f.endswith(ext)]
            os.replace(os.path.join(os.path.dirname(out), sorted(cands)[-1]), out)
        return trim(out)
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(one, jobs))


def main(only=None):
    main_m, models, problems = riviera.main()
    if problems:
        raise SystemExit("model has problems; not rendering")
    by_name = {m.name: m for m in models}
    manifest = OrderedDict(models=OrderedDict(), parts=OrderedDict(), totals=[])

    all_jobs = []
    for m in models:
        is_main = m is main_m
        jobs, scales = step_jobs(m, is_main)
        if only and m.name not in only:
            jobs = []
        all_jobs += jobs
        steps = []
        for s in m.steps():
            items = [it for it in m.items if it.step == s]
            parts = Counter((PARTS[it.key].dat, it.color) for it in items if not isinstance(it, SubRef))
            subs = Counter(it.model.name for it in items if isinstance(it, SubRef))
            steps.append(dict(
                step=s,
                image=os.path.relpath(os.path.join(RENDERS, m.name[:-4], f"step_{s:03d}.png"), BUILD),
                parts=[dict(key=part_key(d, c), dat=d, color=c, qty=n) for (d, c), n in sorted(
                    parts.items(), key=lambda kv: (COLOR_NAMES[kv[0][1]], kv[0][0]))],
                subs=[dict(model=k, qty=n) for k, n in subs.items()],
                px_per_ldu=scales[s], fixed_camera=not is_main,
                note=m.step_notes.get(s)))
        manifest["models"][m.name] = dict(title=m.title, steps=steps,
                                          image=f"renders/final/{m.name[:-4]}.png",
                                          count=sum(m.parts_count().values()))

    # finished submodels and overall views
    final_jobs = []
    for m in models:
        out = os.path.join(RENDERS, "final", m.name[:-4] + ".png")
        args = ["-i", out, "-w", "1800", "-h", "1400", "--shading", "full",
                "--aa-samples", "8"]
        if m is not main_m:
            args += ["-s", m.name]
        args += camera_for(*model_bbox(m)) + [MPD]
        final_jobs.append((out, args))
    hero = [("cover_front_right", 24, 32), ("cover_front_left", 24, -32),
            ("cover_front", 12, 0), ("cover_high", 50, 20), ("back", 26, 150)]
    for name, la, lo in hero:
        out = os.path.join(RENDERS, "final", name + ".png")
        args = ["-i", out, "-w", "2400", "-h", "1600", "--shading", "full", "--aa-samples", "8"]
        args += camera_for(*model_bbox(main_m), lat=la, lon=lo, margin=0.93) + [MPD]
        final_jobs.append((out, args))

    totals = main_m.parts_count()
    pj = part_jobs(totals)
    for (dat, color), n in sorted(totals.items(), key=lambda kv: (COLOR_NAMES[kv[0][1]], kv[0][0])):
        manifest["parts"][part_key(dat, color)] = dict(
            dat=dat, color=color, color_name=COLOR_NAMES[color], name=DAT_NAMES[dat],
            qty=n, image=f"renders/parts/{part_key(dat, color)}.png")
    for out, args, scale in pj:
        key = os.path.basename(out)[:-4]
        manifest["parts"][key]["scale"] = scale

    print(f"rendering {len(all_jobs)} steps, {len(final_jobs)} finals, {len(pj)} parts")
    sizes = run_jobs(all_jobs + final_jobs + [(o, a) for o, a, _ in pj])
    # record image sizes for layout
    for (out, *_), size in zip(all_jobs + final_jobs + [(o, a) for o, a, _ in pj], sizes):
        rel = os.path.relpath(out, BUILD)
        manifest.setdefault("sizes", {})[rel] = size
    with open(os.path.join(BUILD, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print("done")


if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
