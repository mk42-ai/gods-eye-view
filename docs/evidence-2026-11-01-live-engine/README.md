# Evidence — Live Cinematic Intelligence Engine turn (2026-11-01, 14:46Z–17:35Z UTC)

All artefacts in this folder were produced in this turn against the EXISTING
`mk42-ai/gods-eye-view` repository on `feat/scene-video-evidence`.

| File | What it proves |
|---|---|
| `pre-existing-uncommitted-work.patch` | The 53 modified files found uncommitted at session start (text diff; binary sprites excluded). Committed as-is in `5ee34c8` together with the 147 untracked files. |
| `ondemand-live-endpoints.json` | `GET /config/v1/public/endpoints` at 15:21Z — 98 endpoints, 29 active, 1 Cerebras (`predefined-cerebras-qwen-3.8-27b`). |
| `ondemand-runtime-live.txt` | Live streaming probe (Cerebras TTFT 2.2 s, director build 11.6 s, GPT-6.1-sol 29 s, Q&A 4.8 s). |
| `legacy multi-query transport-probe.txt` | `the removed legacy multi-query transport → **405 "legacy multi-query transport creation is currently unavailable"** (re-probed 15:11Z). |
| `elevenlabs-retest.txt` | Narration route → **503 narration_provider_payment_required** (14.05 s). BLOCKED, no audio substituted. |
| `open-meteo-probe.txt` | New `/intel/weather` route — real Open-Meteo observation → validated scene patch (148 ms). |
| `frontend-tests.txt`, `backend-tests.txt`, `checks.txt`, `build.txt` | Timestamped suites + gates (first run and the re-run after the live-QA fixes). |
| `env-reconciliation.txt` | Browser/server env reconciliation before deploy (no new variable; no platform credential). |
| `deploy-output.txt` | All four `deploy-permanent` runs with ids/URLs and why each redeploy happened. |
| `qa-live-deploy2/` | Full A–I + acceptance against deploy #2: 9/10 (Demo B failed — injected sign outside 5 km bound → fixed). |
| `qa-live-final/` | Full A–I + acceptance against deploy #3: **10/10**, SSE traces, screenshots. |
| `qa-live-final-deploy4/` | A/E/I on both viewports against the FINAL deploy #4: 6/6, real Snapchat metrics. |
| `qa-live-final-F/` | Demo F re-run against deploy #4 with request-level proof of GPT-6.1-sol vs Cerebras. |
| `qa-scene-videos/` + `.log` | 27/27 URL-hash keys survive reload on 1440×900 and 390×844 (deploy #3). Legacy `/scene/videos` rail checks 2–4 fail by design since b6bbfb2 (the rail is no longer auto-started). |
| `live-demo-matrix.json` | Machine-readable per-demo matrix (status, run state, TTFT, first playable shot, heap, model). |
