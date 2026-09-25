#!/usr/bin/env bash
# Rebuild everything: model -> renders -> element IDs -> parts lists -> booklet.
# Needs: leocad, ldraw-parts, xvfb (apt), numpy/pillow (pip), node + playwright.
# DATA_DIR must hold the Rebrickable CSV dump (rb/), pab2022.json, pab2025.json
# and the BrickLink Studio ElementId.json (see README, "Where the element IDs come from").
set -euo pipefail
cd "$(dirname "$0")"
python3 riviera.py
python3 render.py
if [ -n "${DATA_DIR:-}" ]; then python3 element_lookup.py "$DATA_DIR"; fi
python3 export_parts.py
python3 make_booklet.py
