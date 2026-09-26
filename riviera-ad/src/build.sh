#!/usr/bin/env bash
# Full rebuild of the Riviera brick-model ad: voice-over, music, SFX, mix, video (9:16 + 4:5), mux.
# Usage: bash src/build.sh            (everything)
#        SKIP_AUDIO=1 bash src/build.sh (re-render video only)
set -euo pipefail
cd "$(dirname "$0")/.."
FFMPEG="${FFMPEG:-$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')}"
export FFMPEG
mkdir -p build/audio out

if [ -z "${SKIP_AUDIO:-}" ]; then
  echo "== voice-over";  python3 src/voice.py
  echo "== music";       python3 src/music.py
  echo "== sfx";         python3 src/sfx.py
  echo "== mix";         python3 src/mix.py
fi

DUR=$(python3 -c 'import json; print(json.load(open("storyboard.json"))["duration"])')

render() { # $1 variant, $2 width, $3 height
  echo "== video $1 (${2}x$3)"
  node src/capture.mjs --page src/ad.html --query "variant=$1" --w "$2" --h "$3" --duration "$DUR" \
       --workers "${WORKERS:-4}" --out "build/video-$1.mp4"
  "$FFMPEG" -y -hide_banner -loglevel error -i "build/video-$1.mp4" -i build/audio/mix.wav \
    -map 0:v -map 1:a -c:v libx264 -preset slow -crf 19 -profile:v high -pix_fmt yuv420p \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest "out/riviera-ad-$1.mp4"
  echo "   -> out/riviera-ad-$1.mp4"
}
render 9x16 1080 1920
[ -z "${ONLY_9x16:-}" ] && render 4x5 1080 1350

# cover / thumbnail frame
node src/capture.mjs --page src/ad.html --query variant=9x16 --stills "${COVER_T:-12}" --outdir build/cover >/dev/null
cp build/cover/*.jpg out/riviera-ad-cover.jpg
echo "done"
