#!/usr/bin/env bash
# Builds the whole film: voices -> sound mix -> 3D render -> final MP4.
#   ./build.sh            full 1080p film  (about 2-3 hours on a 4-core CPU, no GPU needed)
#   ./build.sh preview    quick 640x360 preview at 12 fps
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-full}"
FFMPEG="$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
mkdir -p out
mkdir -p node_modules/imageio-ffmpeg-path
echo "module.exports = '$FFMPEG';" > node_modules/imageio-ffmpeg-path/index.js

echo "== 1/4 voices (Kokoro neural TTS)"
[ -f audio/build/voices/n01.wav ] || python3 audio/voices.py
echo "== 2/4 music + sound effects + mix"
node export-cues.mjs
(cd audio && python3 mix.py)

if [ "$MODE" = "preview" ]; then W=640; STEP=2; else W=1920; STEP=1; fi
END=$(node -e "import('./src/story/timeline.js').then(m => console.log(m.BEAT.end))")
HALF=$(python3 -c "print(round($END / 2))")
echo "== 3/4 rendering ${W}px frames in two parallel chunks"
node render.mjs video --w $W --step $STEP --from 0 --to $HALF --out out/part1.mp4 --crf 14 > out/render1.log 2>&1 &
node render.mjs video --w $W --step $STEP --from $HALF --to $END --out out/part2.mp4 --crf 14 > out/render2.log 2>&1 &
wait
echo "== 4/4 assembling"
printf "file 'part1.mp4'\nfile 'part2.mp4'\n" > out/parts.txt
OUT=out/bolt-and-luma.mp4
[ "$MODE" = "preview" ] && OUT=out/bolt-and-luma-preview.mp4
"$FFMPEG" -y -loglevel error -f concat -safe 0 -i out/parts.txt -i audio/build/soundtrack.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 19 -tune animation -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 256k -shortest "$OUT"
echo "done: $OUT"
