#!/usr/bin/env bash
# Builds ECHO (animated cut): timeline -> voice -> score -> mix -> 3D frames -> film.
set -euo pipefail
cd "$(dirname "$0")/../.."

FFMPEG=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
export NODE_PATH=${NODE_PATH:-$(npm root -g)}

python3 movie/timeline.py >/dev/null            # the shared 1,679-bit picture
python3 movie/animated/timeline.py
[ -f movie/build/voice.wav ] || python3 movie/audio/voice.py
python3 movie/animated/audio/score.py
python3 movie/animated/audio/mix.py

(cd movie/animated && npm install --silent)
rm -rf movie/animated/build/frames
node movie/animated/render.js

"$FFMPEG" -y -loglevel warning -stats \
  -framerate 24 -i movie/animated/build/frames/%05d.png \
  -i movie/animated/build/soundtrack.wav \
  -vf "noise=alls=3:allf=t,format=yuv420p" \
  -c:v libx264 -preset medium -crf 21 -maxrate 6M -bufsize 12M \
  -c:a aac -b:a 256k \
  -movflags +faststart -shortest \
  movie/ECHO_animated.mp4

echo "done: movie/ECHO_animated.mp4"
