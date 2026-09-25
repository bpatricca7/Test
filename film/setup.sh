#!/usr/bin/env bash
# One-time setup: JS deps, Python deps and the Kokoro text-to-speech model (~330 MB).
set -euo pipefail
cd "$(dirname "$0")"
npm install
python3 -m pip install -r requirements.txt
MODELS="${KOKORO_DIR:-$HOME/.cache/bolt-and-luma}"
mkdir -p "$MODELS"
base=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f "$MODELS/kokoro-v1.0.onnx" ] || curl -L -o "$MODELS/kokoro-v1.0.onnx" "$base/kokoro-v1.0.onnx"
[ -f "$MODELS/voices-v1.0.bin" ] || curl -L -o "$MODELS/voices-v1.0.bin" "$base/voices-v1.0.bin"
echo "Models in $MODELS  (export KOKORO_DIR=$MODELS before running build.sh)"
