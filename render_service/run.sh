#!/bin/bash
# Host launcher (tmux-free, systemd-free: setsid+nohup). Secrets come from /localstorage/mk.thomas/gev/render_service.env (0600, never committed).
set -a; . /localstorage/mk.thomas/gev/render_service.env; set +a
cd /localstorage/mk.thomas/gev/render_service
exec python3 -m uvicorn app:app --host 0.0.0.0 --port 8791 --workers 1 --log-level info
