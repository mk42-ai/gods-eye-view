# RESUME — restart procedure for the ONDEMAND-NATIVE INTELLIGENCE PLATFORM mission

Repository `mk42-ai/gods-eye-view` · working branch `integration/ondemand-native` · recovery point
`recovery/pre-ondemand-rebuild-20261020` (tag + branch at `1c9558cde07fdddb8d7d01b64f7143f0bbc9d116`) · latest
cycle checkpoint tag `checkpoint-2026-10-21-pre-integration-audit` (`75a0792`, see CHECKPOINTS.md).

## Mandatory restart trigger (paste verbatim to the agent)

```
RESUME ONDEMAND INTELLIGENCE MISSION. Read the repository's docs/agent-execution/RESUME.md and MASTER_STATE.md. Recover the latest valid checkpoint. Inspect the latest commits and integration matrix. Resume unfinished work immediately. Continue the build–test–fix cycle until all acceptance criteria are verified. Do not repeat completed work.
```

## The 10-step recovery protocol

| step | action | command / file | pass condition |
|---|---|---|---|
| 1 | **Locate the repo** and the branch. Clone if absent (GitHub token from env, never printed); otherwise `git fetch origin --prune --tags`. | `git clone https://github.com/mk42-ai/gods-eye-view && cd gods-eye-view && git checkout integration/ondemand-native` | `git rev-parse --abbrev-ref HEAD` = `integration/ondemand-native`; `git tag -l` lists `recovery/pre-ondemand-rebuild-20261020` and `checkpoint-2026-10-21-pre-integration-audit`. |
| 2 | **Load MASTER_STATE.md** — current commit, cycle number, completed / in-progress / remaining, scorecard. | `docs/agent-execution/MASTER_STATE.md` | The `Current commit` row matches `git rev-parse HEAD` (if not, the last cycle died before its checkpoint commit — go to step 7). |
| 3 | **Load INTEGRATION_MATRIX.md + INTEGRATION_AUDIT.md** (+ `api-inventory.json`, `integration-audit.json`). | `docs/agent-execution/*` | `integration-audit.json summary.callSites === entries.length` (161 at the 2026-10-21 audit). |
| 4 | **Load TEST_RESULTS.md** (§8 is the newest cycle) and re-run the cheap gates. | `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` (then `node node_modules/esbuild/install.js` if esbuild's postinstall was blocked) · `npm run format:check` · `npm run check:boundaries` · `npm run check:secrets` · `npm run test:foundation` · `npm run test:ondemand` · `npm run test:serverless` · `npm run build` · `node scripts/check-no-secrets.mjs --dist` | all exit 0 — otherwise the first failing gate is the resume point. |
| 5 | **Load NEXT_ACTIONS.md** — the ordered queue. | `docs/agent-execution/NEXT_ACTIONS.md` | First item whose status is not DONE. |
| 6 | **Inspect the latest commits** vs MASTER_STATE §9. | `git log --oneline -20 origin/integration/ondemand-native` · `git status --short` | Any commit newer than MASTER_STATE's current commit is interrupted work: read its diff first. |
| 7 | **Identify interrupted work**: uncommitted changes, stashes, IN-PROGRESS items. | `git status`, `git stash list`, `grep -n "IN-PROGRESS" docs/agent-execution/*.md` | One named unit or none. Never discard local modifications. |
| 8 | **Verify subagent outputs are integrated**: inventories + audit + registry docs exist and end with `GENERATED_UTC:`. | `ARCHITECTURE_INVENTORY.md`, `INTEGRATION_MATRIX.md`, `INTEGRATION_AUDIT.md`, `BRANDING_AUDIT.md`, `INFRASTRUCTURE_INVENTORY.md`, `FRONTEND_RECON.md`, `ONDEMAND_LIVE_DOCS_2026-10-21.md`, `TRIGGER_DECISION.md`, `docs/plugins/REGISTRY.md` | counts match MASTER_STATE or MASTER_STATE explains the delta. |
| 9 | **Live validation** against the real platform (detects drift: endpoint retirements, plugin deactivations, content-policy changes — see B-14). | `ONDEMAND_API_KEY=… ONDEMAND_BASE_URL=https://api.on-demand.io npm run ondemand:foundation:live` | **34/34 PASS** (rows 29–36 are voice, plugin lifecycle, contracts, in-process tool investigate; ~3 min). New FAIL rows → TEST_RESULTS + BLOCKERS. |
| 10 | **Resume** at the NEXT_ACTIONS item from step 5. Work in validated units: implement → gates (step 4) → live (step 9) → browser harness (`node scripts/qa-chat-intelligent-ui.mjs --url <preview> --out docs/agent-execution/artifacts/ui-<date>/after`) → update TEST_RESULTS/MASTER_STATE/NEXT_ACTIONS → conventional commit → push. | `git add <explicit paths> && git commit -m "<type>(<scope>): …" && git push origin integration/ondemand-native` | MASTER_STATE current commit == pushed HEAD. |

## Invariants that must hold at every checkpoint
- Secrets only via `process.env` on the server; no `VITE_`/`NEXT_PUBLIC_` secret; `src/` never imports `server/ondemand/foundation/**`.
- The browser-held key path (`x-ondemand-key`) is reachable only with `ONDEMAND_ALLOW_CLIENT_KEY=1`; `/api/ondemand/v2/*` (incl. `/voice/*`, `/plugins*`) never reads it.
- **No third-party AI bypass**: `rg -n "api.openai.com|realtime/token|OPENAI_API_KEY" src server api --glob '!**/*.test.mjs'` → 0 runtime hits (OpenAI Realtime removed 2026-10-21).
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
| Browser harness (scenarios A–G) | `scripts/qa-chat-intelligent-ui.mjs` (+ spec `web/tests/chat-intelligent-ui-payloads.spec.ts`) |
| Checkpoints | `docs/agent-execution/{MASTER_STATE,INTEGRATION_MATRIX,INTEGRATION_AUDIT,TEST_RESULTS,BLOCKERS,NEXT_ACTIONS,RESUME,CHECKPOINTS,TRIGGER_DECISION,ONDEMAND_LIVE_DOCS_2026-10-21}.md`, `api-inventory.json`, `integration-audit.json`, `artifacts/` |

## Platform facts to remember (verified 2026-10-21)
- Voice workflow `6ad8160ab28e35aa11d85632` (ACTIVE, webhook trigger). The API `execute` endpoint carries no body and the webhook URL is not returned by the API (dashboard-only, Bearer-JWT gated) → the interactive voice path is the direct Services+Chat chain; the workflow is the auditable/async path (TRIGGER_DECISION.md).
- Relaunch workflow `6ad7f961c2cfee207e8f3d07` (ACTIVE, cron every 6 h) re-emits the trigger sentence; it cannot start the agent (B-12).
- Plugin creation from OpenAPI is dashboard-only (API create → 500/524, B-15); 17 OpenAPI documents are ready to paste.
- Vercel CLI is blocked in the agent container; deploy previews with `POST https://api.vercel.com/v13/deployments` (`gitSource` repoId 1375642703) against project `prj_VbHbEhFSDFkdXCqlq8XqONoFWQHO` (B-6 workaround).

GENERATED_UTC: 2026-10-21T03:55:00Z
