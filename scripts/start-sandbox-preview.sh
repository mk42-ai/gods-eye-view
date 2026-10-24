#!/bin/bash
# Sandbox preview boot: Vite dist + Node serverless emulator on $PORT (5173) and
# the FastAPI footage service on 127.0.0.1:8787 (proxied by FOOTAGE_UPSTREAM).
# Secrets: `.env` holds credential-free defaults; a real ONDEMAND_API_KEY is
# loaded from an operator-only file (/tmp/od-secret.env, 0600) AFTER .env so the
# empty placeholder never overrides it, and that file is deleted once read. The
# key therefore lives only in the two server processes' environments.
cd /vercel/sandbox
set -a; . ./.env; set +a
# The served build id is read from dist/index.html (stamped by scripts/build-fresh.sh);
# dist/BUILD_ID is the same value for shell checks. Refuse to boot without a build.
if [ ! -f dist/index.html ]; then echo "start-sandbox-preview: dist/ missing — run scripts/build-fresh.sh first" >&2; exit 2; fi
export BUILD_COMMIT="${BUILD_COMMIT:-$(cat dist/BUILD_ID 2>/dev/null || true)}"
if [ -f /tmp/od-secret.env ]; then set -a; . /tmp/od-secret.env; set +a; rm -f /tmp/od-secret.env; fi
export PORT="${PORT:-5173}" FOOTAGE_UPSTREAM="${FOOTAGE_UPSTREAM:-http://127.0.0.1:8787}"
pkill -f "server/serverless/dev-server.mjs" 2>/dev/null
pkill -f "uvicorn api.footage" 2>/dev/null
sleep 1
setsid nohup python3 -m uvicorn api.footage.index:app --host 127.0.0.1 --port 8787 > /tmp/footage.log 2>&1 < /dev/null &
sleep 3
setsid nohup node server/serverless/dev-server.mjs > /tmp/dev.log 2>&1 < /dev/null &
sleep 4
curl -s -o /dev/null -w "root %{http_code}\n" "http://127.0.0.1:${PORT}/"
curl -s -o /dev/null -w "health %{http_code}\n" "http://127.0.0.1:${PORT}/footage/health"
curl -s -o /dev/null -w "api-health %{http_code}\n" "http://127.0.0.1:${PORT}/api/health"
curl -s "http://127.0.0.1:${PORT}/api/version"; echo
curl -s -D - -o /dev/null "http://127.0.0.1:${PORT}/" | grep -i -E "^(HTTP|cache-control|x-build-id)"
