#!/usr/bin/env bash
# Builds ECHO from nothing: timeline -> voice -> score -> mix -> frames -> film.
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
export NODE_PATH=${NODE_PATH:-$(npm root -g)}

python3 movie/timeline.py
python3 movie/audio/voice.py
python3 movie/audio/score.py
python3 movie/audio/mix.py

rm -rf movie/build/frames
node movie/visuals/render.js

"$FFMPEG" -y -loglevel warning -stats \
  -framerate 24 -i movie/build/frames/%05d.png \
  -i movie/build/soundtrack.wav \
  -vf "noise=alls=5:allf=t,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -tune film \
  -c:a aac -b:a 256k \
  -movflags +faststart -shortest \
  movie/ECHO.mp4

echo "done: movie/ECHO.mp4"
