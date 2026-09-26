#!/usr/bin/env bash
# Build the Instagram intro reel from the phone clips in footage/.
#   ./build.sh            full build -> out/chelsea-packs-the-magic-intro.mp4 (+ -cover.jpg)
# Needs: ffmpeg (with libx264), python3 + requirements.txt, and REEL_ASSETS
# (default /tmp/claude-0) holding fonts/, emoji/ and models/ - see README.
set -euo pipefail
cd "$(dirname "$0")/reel"
python3 analyze.py     # audio extract, word timestamps, face positions
python3 timeline.py    # edit decision list -> timeline.json
python3 voice.py       # dialogue cut + cleanup
python3 music.py       # original score + sfx, composed to the cut
python3 mix.py         # ducking, mix, -14 LUFS master
python3 render.py      # picture + encode
