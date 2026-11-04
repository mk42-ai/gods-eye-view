# RESUME — restart procedure for the ONDEMAND-NATIVE INTELLIGENCE PLATFORM mission

Repository `mk42-ai/gods-eye-view` · working branch `integration/ondemand-native` · latest checkpoint tag
`checkpoint/aoi-incident-scenes-v1` (cycle 9, 2026-10-22 — created locally; if `git ls-remote --tags` does not show it the push
is still pending, see "Cycle-9 hand-over" below) · recovery point
`recovery/pre-ondemand-rebuild-20261020` (tag + branch at `1c9558cde07fdddb8d7d01b64f7143f0bbc9d116`) · latest
cycle checkpoint tag `checkpoint-2026-10-21-preview-retry` (cycle 6; earlier: `checkpoint-2026-10-21-post-sandbox-verification` = `712a552`, `checkpoint-2026-10-21-verify-cycle4` = `226217f`, `checkpoint-2026-10-21-pre-integration-audit` = `75a0792`, see CHECKPOINTS.md).

## Mandatory restart trigger (paste verbatim to the agent)

```
RESUME ONDEMAND INTELLIGENCE MISSION. Read the repository's docs/agent-execution/RESUME.md and MASTER_STATE.md. Recover the latest valid checkpoint. Inspect the latest commits and integration matrix. Resume unfinished work immediately. Continue the build–test–fix cycle until all acceptance criteria are verified. Do not repeat completed work.
```

## The 10-step recovery protocol

| step | action | command / file | pass condition |
|---|---|---|---|
| 1 | **Locate the repo** and the branch. Clone if absent (GitHub token from env, never printed); otherwise `git fetch origin --prune --tags`. | `git clone https://github.com/mk42-ai/gods-eye-view && cd gods-eye-view && git checkout integration/ondemand-native` | `git rev-parse --abbrev-ref HEAD` = `integration/ondemand-native`; `git tag -l` lists `recovery/pre-ondemand-rebuild-20261020`, `checkpoint-2026-10-21-pre-integration-audit`, `checkpoint-2026-10-21-post-sandbox-verification` and `checkpoint-2026-10-21-preview-retry`. |
| 2 | **Load MASTER_STATE.md** — current commit, cycle number, completed / in-progress / remaining, scorecard. | `docs/agent-execution/MASTER_STATE.md` | The `Current commit` row matches `git rev-parse HEAD` (if not, the last cycle died before its checkpoint commit — go to step 7). |
| 3 | **Load INTEGRATION_MATRIX.md + INTEGRATION_AUDIT.md** (+ `api-inventory.json`, `integration-audit.json`). | `docs/agent-execution/*` | `integration-audit.json summary.callSites === entries.length` (161 at the 2026-10-21 audit). |
| 4 | **Load TEST_RESULTS.md** (§11 is the newest cycle) and re-run the cheap gates. | `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` (then `node node_modules/esbuild/install.js` if esbuild's postinstall was blocked) · `npm run format:check` · `npm run check:boundaries` · `npm run check:secrets` · `npm run test:foundation` · `npm run test:ondemand` · `npm run test:serverless` · `npm run build` · `node scripts/check-no-secrets.mjs --dist` | all exit 0 — otherwise the first failing gate is the resume point. |
| 5 | **Load NEXT_ACTIONS.md** — the ordered queue. | `docs/agent-execution/NEXT_ACTIONS.md` | First item whose status is not DONE. |
| 6 | **Inspect the latest commits** vs MASTER_STATE §9. | `git log --oneline -20 origin/integration/ondemand-native` · `git status --short` | Any commit newer than MASTER_STATE's current commit is interrupted work: read its diff first. |
| 7 | **Identify interrupted work**: uncommitted changes, stashes, IN-PROGRESS items. | `git status`, `git stash list`, `grep -n "IN-PROGRESS" docs/agent-execution/*.md` | One named unit or none. Never discard local modifications. |
| 8 | **Verify subagent outputs are integrated**: inventories + audit + registry docs exist and end with `GENERATED_UTC:`. | `ARCHITECTURE_INVENTORY.md`, `INTEGRATION_MATRIX.md`, `INTEGRATION_AUDIT.md`, `BRANDING_AUDIT.md`, `INFRASTRUCTURE_INVENTORY.md`, `FRONTEND_RECON.md`, `ONDEMAND_LIVE_DOCS_2026-10-21.md`, `TRIGGER_DECISION.md`, `docs/plugins/REGISTRY.md` | counts match MASTER_STATE or MASTER_STATE explains the delta. |
| 9 | **Live validation** against the real platform (detects drift: endpoint retirements, plugin deactivations, content-policy changes — see B-14). | `ONDEMAND_API_KEY=… ONDEMAND_BASE_URL=https://api.on-demand.io npm run ondemand:foundation:live` | **34/34 PASS** (rows 29–36 are voice, plugin lifecycle, contracts, in-process tool investigate; ~3 min). New FAIL rows → TEST_RESULTS + BLOCKERS. |
| 10 | **Resume** at the NEXT_ACTIONS item from step 5. Work in validated units: implement → gates (step 4) → live (step 9) → browser harness (`node scripts/qa-chat-intelligent-ui.mjs --url <preview> --out docs/agent-execution/artifacts/ui-<date>/after`) → update TEST_RESULTS/MASTER_STATE/NEXT_ACTIONS → conventional commit → push. | `git add <explicit paths> && git commit -m "<type>(<scope>): …" && git push origin integration/ondemand-native` | MASTER_STATE current commit == pushed HEAD. |

## Invariants that must hold at every checkpoint
- Secrets only via `process.env` on the server; no `VITE_`/`NEXT_PUBLIC_` secret; `src/` never imports `server/ondemand/foundation/**`.
- The browser-held key path (`x-ondemand-key`) is reachable only with `ONDEMAND_ALLOW_CLIENT_KEY=1`; `/api/ondemand/v2/*` (incl. `/voice/*`, `/plugins*`) never reads it.
- **No third-party AI bypass**: `grep -rnE "api.openai.com|realtime/token|OPENAI_API_KEY" src server api --exclude='*.test.mjs'` → 0 hits (OpenAI Realtime removed 2026-10-21; the Provider-Settings OPENAI row removed in cycle 5) and `grep -l -iE "api\.openai\.com|realtime/token|OPENAI_API_KEY" dist/assets/*.js` → none.
- No fabricated capability: plugin states come from `plugin-lifecycle.js` (real session + probe); every "verified" claim has a TEST_RESULTS row with a timestamp.
- `recovery/pre-ondemand-rebuild-20261020` and checkpoint tags are never moved or deleted; no force-push, no history rewrite on `integration/ondemand-native`.

## Where things are
| artefact | path |
|---|---|
| Foundation client / contracts / store / route / guards / orchestrator | `server/ondemand/foundation/{types,client,plugin-contract,contracts,tool-contracts,conversation-store,proxy-route,guards,orchestrator,intelligence-object}.js` |
| Voice turn route (STT → chat SSE → TTS) | `server/ondemand/foundation/voice-route.js` (`/api/ondemand/v2/voice/{turn,health}`, alias `/api/voice/*`) · client `src/voice/ondemand/*` · prompts `server/voice/*` |
| Plugin lifecycle (server) / PLUGINS panel (client) | `server/ondemand/foundation/plugin-lifecycle.js` (`/plugins`, `/plugins/verify`) · `src/ondemand/pluginPanel.js` |
| Repo tools callable by OnDemand | `server/tools/*.js` (registry) → `/api/tools/<name>` · OpenAPI `docs/plugins/<plugin>/openapi.json` · live table `docs/plugins/REGISTRY.md` |
| Live validation script | `scripts/ondemand-foundation-live.mjs` (34 rows) |
| Browser harness (scenarios A–G) | `scripts/qa-chat-intelligent-ui.mjs --url <preview> --out <dir> [--viewports 1440x900,390x844] [--scenarios A-G] [--format png]` (self-seeding D/E, loader-aware boot wait; spec `web/tests/chat-intelligent-ui-payloads.spec.ts`); newest evidence `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/results-matrix.json` (`runs[]`, latest `retry-0917`) and `retry-0917/{BRIEF_COMMON.md,agentN/RESULTS.md,fixes-after/}` |
| Checkpoints | `docs/agent-execution/{MASTER_STATE,INTEGRATION_MATRIX,INTEGRATION_AUDIT,TEST_RESULTS,BLOCKERS,NEXT_ACTIONS,RESUME,CHECKPOINTS,TRIGGER_DECISION,ONDEMAND_LIVE_DOCS_2026-10-21}.md`, `api-inventory.json`, `integration-audit.json`, `artifacts/` |

## Cycle-9 hand-over (2026-10-22) — AOI incident scenes

- The execution container had **no `GITHUB_TOKEN`**, so commits `0dcf469`…cycle-9 checkpoint and the annotated tag
  `checkpoint/aoi-incident-scenes-v1` exist locally and in the git bundle `gods-eye-view-cycle9.bundle` delivered with the run.
  To land them: `git fetch <bundle> integration/ondemand-native:cycle9 && git push origin cycle9:integration/ondemand-native &&
  git push origin checkpoint/aoi-incident-scenes-v1`, then update PR #2 (`integration/ondemand-native` → `ondemand-serverless`).
- Where things are: AOI config `config/aoi/uae-interest.json` (edit buffers/radii there) · membership `src/aoi/membership.js` ·
  model `src/incidents/model.js` · routes `server/incidents/{routes,store,seed}.js` (mounted under `/api/ondemand/v2/incidents` by
  `proxy-route.js`) · scene policy `src/scenes/aoiScenePolicy.js` · adapter `src/scenes/incidentScenes.js` · UI
  `src/incidents/ui/{index,overlay,composer}.js` + `src/ui/styles/incidents.css` · proof harness
  `scripts/qa-aoi-incident-scenes.mjs --url <preview> --out docs/agent-execution/artifacts/aoi-incidents-<date>` · embed harness
  `public/embed-harness.html`.
- Sandbox recipe unchanged (below) plus: write `INCIDENT_INGEST_SECRET=<random>` into the same temp secret file as
  `ONDEMAND_API_KEY` (never into `.env`), copy `public/embed-harness.html` into `dist/` after the build, and run the a–g harness
  (≈5 min for both viewports; check (e) needs ~2 min because the research plugins answer in 30–90 s).
- Known: FIRMS live pulls report `not_configured` until `NASA_FIRMS_MAP_KEY` is set (N-19); OnDemand answers `409 session_busy`
  when a query overlaps on the same session — `/refresh` uses one fresh session per call with backoff; the incident ledger is
  per-instance until KV is provisioned (N-35).

## Platform facts to remember (verified 2026-10-21)
- Voice workflow `6ad8160ab28e35aa11d85632` (ACTIVE, webhook trigger). The API `execute` endpoint carries no body and the webhook URL is not returned by the API (dashboard-only, Bearer-JWT gated) → the interactive voice path is the direct Services+Chat chain; the workflow is the auditable/async path (TRIGGER_DECISION.md).
- Relaunch workflow `6ad7f961c2cfee207e8f3d07` (ACTIVE, cron every 6 h) re-emits the trigger sentence; it cannot start the agent (B-12).
- Plugin creation from OpenAPI is dashboard-only (API create → 500/524, B-15); 17 OpenAPI documents are ready to paste.
- Ephemeral previews: `vercel` CLI is blocked but the Vercel **Sandbox** CLI works (`sandbox create --scope $VERCEL_TEAM_ID --project $VERCEL_PROJECT_ID --runtime node22 --timeout 90m --publish-port 5173`; the create JSON is printed on stderr-style lines — read the `5173 -> https://sb-….vercel.run` route, `jq` is absent; copy a tgz of the tree without `node_modules/.git/dist/docs/.ui-proof` (the repo `.env` with 21 non-secret keys rides along), `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`, `set -a; . ./.env; npm run build`, `node scripts/check-no-secrets.mjs --dist`, then `node server/serverless/dev-server.mjs` with `ONDEMAND_API_KEY` sourced from a temp file that is deleted before the server starts — never written to `.env`; `pkill` + restart after a rebuild). Cycle-8 recipe in TEST_RESULTS §13; newest sandbox `sbx_EdkizkMGv6ASKOnpEmUWOAlaQrRc` → `https://sb-1ek30lyxzsd3.vercel.run` (created 2026-10-22T06:29Z, expires ≈07:59Z) — assume it is gone and create a new one. Cycle-8 helper files used in the sandbox: `/tmp/start-server.sh` (sources `.env`, adds `/tmp/od-secret.env`, deletes it, then `setsid nohup node server/serverless/dev-server.mjs`) and `dist/iframe-proof.html` (no-`sandbox`-attribute wrapper that reports `IFRAME_TITLE`/`TEXT_LEN`), verified with `ui_validate.py` at 1440×900 and 390×844. `GET /api/health` is a liveness alias of `/api/ondemand/v2/health` since cycle 4. If a prior sandbox refuses connections or answers 410 it has expired (90-min lifetime, B-18) — create a new one from the current tree, restore the same env keys by name (key only in the process env), poll `/api/health` until 200 and re-run A–G; never reuse the old URL.
- Vercel CLI is blocked in the agent container; deploy previews with `POST https://api.vercel.com/v13/deployments` (`gitSource` repoId 1375642703) against project `prj_VbHbEhFSDFkdXCqlq8XqONoFWQHO` (B-6 workaround).

GENERATED_UTC: 2026-10-22T13:05:00Z

- **Cycle 20 supersedes the temp-key-file recipe above.** `ONDEMAND_API_KEY` now lives in the Vercel project env (encrypted, all targets) and in the git-ignored 0600 app-root `.env`; `server/serverless/dev-server.mjs` loads it itself, so start with `PORT=5173 setsid nohup node server/serverless/dev-server.mjs` (no `/tmp/od-secret.env`). `/api/health` must show `keySource:"env:persistent"`.
