#!/usr/bin/env bash
# Start the built app the way the sandbox preview runs it: the Node
# serverless emulator (dist/ + api/*.js) on $PORT (default 5173) with the
# Python LIVE FOOTAGE service (api/footage/index.py) on 127.0.0.1:8787 behind
# it. Reads ./.env (git-ignored) for ONDEMAND_API_KEY / YOUTUBE_API_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
[ -f .env ] && . ./.env
set +a
export PORT="${PORT:-5173}"
export FOOTAGE_UPSTREAM="${FOOTAGE_UPSTREAM:-http://127.0.0.1:8787}"
export VITE_SERVERLESS_MODE="${VITE_SERVERLESS_MODE:-true}"
if ! python3 -c "import fastapi, httpx, uvicorn" 2>/dev/null; then
  python3 -m pip install --user -q -r requirements.txt uvicorn
fi
[ -d dist ] || npm run build
nohup python3 -m uvicorn api.footage.index:app --host 127.0.0.1 --port 8787 > /tmp/footage.log 2>&1 &
exec node server/serverless/dev-server.mjs
