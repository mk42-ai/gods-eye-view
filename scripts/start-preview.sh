#!/usr/bin/env bash
# Existing Node API/static frontend + separate FastAPI service, one managed start.
# Keeps the repository's backend/frontend separation and same-origin API routes.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
[ ! -f .env ] || . ./.env
set +a
export PORT="${PORT:-5173}"
export FOOTAGE_UPSTREAM="${FOOTAGE_UPSTREAM:-http://127.0.0.1:8787}"
export VITE_SERVERLESS_MODE="${VITE_SERVERLESS_MODE:-true}"
if ! python3 -c 'import fastapi, httpx, uvicorn' 2>/dev/null; then
  python3 -m pip --version >/dev/null 2>&1 || python3 -m ensurepip --user
  python3 -m pip install --user -q -r requirements.txt uvicorn
fi
[ -f dist/index.html ] || npm run build
python3 -m uvicorn api.footage.index:app --host 127.0.0.1 --port 8787 &
footage_pid=$!
node server/serverless/dev-server.mjs &
frontend_pid=$!
cleanup() { kill "$frontend_pid" "$footage_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait -n "$frontend_pid" "$footage_pid"
