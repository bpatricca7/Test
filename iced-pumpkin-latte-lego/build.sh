#!/usr/bin/env bash
# Rebuild everything for this model with the shared kit in ../lego-kit:
# model -> renders -> element IDs -> parts lists -> booklet.
# Needs: leocad, ldraw-parts, xvfb (apt), pillow/pymupdf (pip), node + playwright.
# DATA_DIR (optional) holds the Rebrickable dump and Pick a Brick listings used to
# refresh data/elements.csv (see the README, "Where the element IDs come from").
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
kit="$here/../lego-kit"
python3 "$kit/render.py" "$here"
if [ -n "${DATA_DIR:-}" ]; then python3 "$kit/element_lookup.py" "$here" "$DATA_DIR"; fi
python3 "$kit/export_parts.py" "$here"
python3 "$kit/make_booklet.py" "$here"
