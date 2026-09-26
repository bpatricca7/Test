#!/usr/bin/env bash
# Build an Instagram intro reel from the phone clips in footage/.
#   ./build.sh              -> intro_v2 (IMG_3567-3576), out/intro_v2/*.mp4
#   ./build.sh intro_v1     -> the first cut (IMG_3540-3551), out/intro_v1/*.mp4
# Needs: ffmpeg (with libx264), python3 + requirements.txt, and REEL_ASSETS
# (default /tmp/claude-0) holding fonts/, emoji/, models/ and bin/ - see README.
set -euo pipefail
export REEL_PROJECT="${1:-intro_v2}"
cd "$(dirname "$0")/reel"
python3 analyze.py     # audio extract, optional DeepFilterNet denoise, word timestamps, face track
python3 timeline.py    # edit decision list -> timeline.json
python3 voice.py       # dialogue cut + cleanup
python3 music.py       # original score + sfx, composed to the cut
python3 mix.py         # ducking, mix, -14 LUFS master
python3 render.py      # picture + encode
