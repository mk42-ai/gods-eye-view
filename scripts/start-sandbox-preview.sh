#!/bin/bash
cd /vercel/sandbox
set -a; . ./.env; set +a
export PORT=5173 FOOTAGE_UPSTREAM=http://127.0.0.1:8787
pkill -f "server/serverless/dev-server.mjs" 2>/dev/null
pkill -f "uvicorn api.footage" 2>/dev/null
sleep 1
setsid nohup python3 -m uvicorn api.footage.index:app --host 127.0.0.1 --port 8787 > /tmp/footage.log 2>&1 < /dev/null &
sleep 3
setsid nohup node server/serverless/dev-server.mjs > /tmp/dev.log 2>&1 < /dev/null &
sleep 4
curl -s -o /dev/null -w "root %{http_code}\n" http://127.0.0.1:5173/
curl -s -o /dev/null -w "health %{http_code}\n" http://127.0.0.1:5173/footage/health
