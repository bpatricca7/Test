#!/usr/bin/env bash
# Rebuild everything for this model with the shared kit in ../lego-kit:
# model -> renders -> element IDs -> parts lists -> checks -> booklet -> README images.
# Needs: leocad, ldraw-parts, xvfb (apt), pillow/pymupdf (pip), node + playwright.
# DATA_DIR (optional) holds the Rebrickable dump and Pick a Brick listings used to
# refresh data/elements.csv (see ../lego-kit/README.md, "Element data").
# The README is written by hand (kit_readme.py is for the resort kits): after a design
# change, update its numbers from parts/kit_cost.csv, checks.md and the booklet.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
kit="$here/../lego-kit"
python3 "$kit/render.py" "$here"
if [ -n "${DATA_DIR:-}" ]; then python3 "$kit/element_lookup.py" "$here" "$DATA_DIR"; fi
python3 "$kit/export_parts.py" "$here"
python3 "$kit/checks.py" "$here"
python3 "$kit/make_booklet.py" "$here"
python3 "$kit/readme_images.py" "$here"
# the two views readme_images.py doesn't write: front left and back
python3 - "$here" <<'EOF'
import os, sys
from PIL import Image
here = sys.argv[1]
for src, dst in (("cover_front_left", "front_left"), ("back", "back")):
    im = Image.open(os.path.join(here, "build/renders/final", src + ".png")).convert("RGBA")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[3])
    bg.thumbnail((1400, 1000))
    bg.save(os.path.join(here, "images", f"craftsman_house_{dst}.jpg"), quality=85, optimize=True)
EOF
