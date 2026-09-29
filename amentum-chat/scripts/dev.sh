#!/usr/bin/env bash
# Set up and run Amentum AI on macOS / Linux (no Docker required).
#
#   ./scripts/dev.sh                 # demo mode - no API key needed
#   ./scripts/dev.sh openai          # test with your OpenAI API key (prompts for it)
#   DEV=1 ./scripts/dev.sh           # also run the Vite dev server with hot reload on :5173
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$ROOT/.venv"
ENV_FILE="$BACKEND/.env"
PORT="${PORT:-8000}"
PROFILE="${1:-}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

case "$PROFILE" in
  ""|demo) TEMPLATE=demo ;;
  openai) TEMPLATE=dev-openai ;;
  azure) TEMPLATE=azure-commercial ;;
  gcc-high) TEMPLATE=gcc-high ;;
  *) echo "Unknown profile '$PROFILE' (demo | openai | azure | gcc-high)"; exit 1 ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/env/$TEMPLATE.env.example" "$ENV_FILE"
  step "Created backend/.env from env/$TEMPLATE.env.example"
elif [[ -n "$PROFILE" ]]; then
  echo "backend/.env already exists - keeping it. Delete it to switch to '$PROFILE'."
fi

if grep -q 'OPENAI_API_KEY=sk-\.\.\.your-key\.\.\.' "$ENV_FILE"; then
  read -rsp "Paste your OpenAI API key (input hidden): " KEY; echo
  python3 - "$ENV_FILE" "$KEY" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace("OPENAI_API_KEY=sk-...your-key...", "OPENAI_API_KEY=" + sys.argv[2]))
PY
  echo "Saved key to backend/.env (git-ignored)."
fi

PY_BIN=""
for c in python3.12 python3.13 python3.11 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then
    PY_BIN="$c"; break
  fi
done
[[ -n "$PY_BIN" ]] || { echo "Python 3.11+ is required."; exit 1; }

if [[ ! -x "$VENV/bin/python" ]]; then
  step "Creating Python virtual environment (.venv)"
  "$PY_BIN" -m venv "$VENV"
fi
HASH="$(shasum -a 256 "$BACKEND/requirements.txt" 2>/dev/null || sha256sum "$BACKEND/requirements.txt")"
if [[ ! -f "$VENV/.requirements.sha" || "$(cat "$VENV/.requirements.sha")" != "$HASH" ]]; then
  step "Installing Python dependencies (first run takes a few minutes)"
  "$VENV/bin/python" -m pip install --upgrade pip >/dev/null
  "$VENV/bin/python" -m pip install -r "$BACKEND/requirements.txt"
  echo "$HASH" > "$VENV/.requirements.sha"
fi

command -v npm >/dev/null || { echo "Node.js 22 LTS is required for the web UI (https://nodejs.org)."; exit 1; }
cd "$FRONTEND"
[[ -d node_modules ]] || { step "Installing web UI dependencies"; npm ci --no-audit --no-fund; }
if [[ "${REBUILD:-0}" == "1" || ! -f dist/index.html ]]; then step "Building web UI"; npm run build; fi

command -v soffice >/dev/null || [[ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]] || \
  echo "Tip: install LibreOffice to enable Office preview + print-to-PDF."

cd "$BACKEND"
if [[ "${DEV:-0}" == "1" ]]; then
  step "Starting Vite dev server on http://localhost:5173"
  (cd "$FRONTEND" && npm run dev) &
  trap 'kill 0' EXIT
  exec_args=(--reload)
else
  exec_args=()
fi
step "Starting Amentum AI on http://localhost:$PORT  (Ctrl+C to stop)"
"$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" "${exec_args[@]}"
