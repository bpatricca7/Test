#!/usr/bin/env bash
# Contact sheet of rendered stills: lib/sheet.sh <stills-dir> <out.jpg> [cols]
set -euo pipefail
dir="$1"; out="$2"; cols="${3:-7}"
n=$(ls "$dir"/*.jpg | wc -l); rows=$(( (n + cols - 1) / cols ))
ffmpeg -v error -y -pattern_type glob -i "$dir/*.jpg" -vf "scale=432:768,tile=${cols}x${rows}:padding=6:color=0x222222" -frames:v 1 -q:v 3 "$out"
