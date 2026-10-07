"""Render a close-up of part of a model while designing.

    xvfb-run -a python3 zoom.py <project> <out.png> LAT LON x0 x1 z0 z1 layer0 layer1

The box is in stud (x, z) and plate (layer) coordinates; LAT must be below 89.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import project  # noqa: E402
import render  # noqa: E402

proj = project.Project(sys.argv[1])
main_m, models, _ = proj.build(verbose=False)
render.setup(proj)
out = sys.argv[2]
lat, lon = float(sys.argv[3]), float(sys.argv[4])
x0, x1, z0, z1, l0, l1 = map(float, sys.argv[5:11])
bmin = (20 * x0, -8 * l1, 20 * z0)
bmax = (20 * x1, -8 * l0, 20 * z1)
a = ["-i", out, "-w", "1600", "-h", "1200", "--shading", "full", "--aa-samples", "4"]
a += render.camera_for(bmin, bmax, lat=lat, lon=lon, margin=0.9) + [proj.mpd]
render.leocad(a)
render.trim(out)
print(out)
