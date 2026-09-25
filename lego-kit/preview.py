"""Quick look at a design while working on it.

Builds and validates the project, then renders the finished model (or one
submodel) from a few angles at low resolution. Much faster than render.py.

Usage:  python3 lego-kit/preview.py <project folder> [model.ldr] [--out DIR]
Output: <project>/build/preview/<view>.png
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project as projects
import render

VIEWS = [("front_right", 24, 32), ("front", 8, 0), ("front_left", 24, -32),
         ("high", 55, 20), ("back", 26, 150)]


def main(argv):
    proj = projects.load(argv)
    args = argv[2:]
    out_dir = os.path.join(proj.build_dir, "preview")
    if "--out" in args:
        i = args.index("--out")
        out_dir = args[i + 1]
        del args[i:i + 2]
    main_m, models, problems = proj.build()
    target = main_m
    if args:
        target = {m.name: m for m in models}[args[0]]
    render.setup(proj)
    os.makedirs(out_dir, exist_ok=True)
    jobs = []
    for name, lat, lon in VIEWS:
        out = os.path.join(out_dir, f"{target.name[:-4]}_{name}.png")
        a = ["-i", out, "-w", "1500", "-h", "1000", "--shading", "full", "--aa-samples", "4"]
        if target is not main_m:
            a += ["-s", target.name]
        a += render.camera_for(*render.model_bbox(target), lat=lat, lon=lon, margin=0.95)
        jobs.append((out, a + [proj.mpd]))
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda j: render.leocad(j[1]), jobs))
    for out, _ in jobs:
        render.trim(out)
        print(out)
    if problems:
        print(f"{len(problems)} problem(s); see above")


if __name__ == "__main__":
    main(sys.argv)
