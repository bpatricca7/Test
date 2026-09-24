#!/usr/bin/env bash
# Builds ECHO (characters cut): timeline -> voices -> score -> mix -> 3D frames -> film.
set -euo pipefail
cd "$(dirname "$0")/../.."

FFMPEG=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
export NODE_PATH=${NODE_PATH:-$(npm root -g)}

python3 movie/timeline.py >/dev/null            # the shared 1,679-bit picture
python3 movie/characters/audio/voices_ai.py --no-sheets      # Kokoro-82M, run locally (see voices_ai.py for setup)
python3 movie/characters/timeline.py            # picks up the real line durations and phonemes
python3 movie/characters/audio/score.py
python3 movie/characters/audio/mix.py

(cd movie/characters && npm install --silent)
rm -rf movie/characters/build/frames
node movie/characters/render.js

"$FFMPEG" -y -loglevel warning -stats \
  -framerate 24 -i movie/characters/build/frames/%05d.png \
  -i movie/characters/build/soundtrack.wav \
  -vf "noise=alls=3:allf=t,format=yuv420p" \
  -c:v libx264 -preset medium -crf 21 -maxrate 6M -bufsize 12M \
  -c:a aac -b:a 256k -movflags +faststart -shortest \
  movie/ECHO_characters.mp4

echo "done: movie/ECHO_characters.mp4"
