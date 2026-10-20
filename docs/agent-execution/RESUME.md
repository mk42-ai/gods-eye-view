# RESUME — restart procedure for the ONDEMAND-NATIVE INTELLIGENCE PLATFORM mission

Repository `mk42-ai/gods-eye-view` · working branch `integration/ondemand-native` · recovery point
`recovery/pre-ondemand-rebuild-20261020` (tag + branch at `1c9558cde07fdddb8d7d01b64f7143f0bbc9d116`).

## Mandatory restart trigger (paste verbatim to the agent)

```
RESUME ONDEMAND INTELLIGENCE MISSION. Read the repository's docs/agent-execution/RESUME.md and MASTER_STATE.md. Recover the latest valid checkpoint. Inspect the latest commits and integration matrix. Resume unfinished work immediately. Continue the build–test–fix cycle until all acceptance criteria are verified. Do not repeat completed work.
```

## The 10-step recovery protocol

| step | action | command / file | pass condition |
|---|---|---|---|
| 1 | **Locate the repo** and the branch. Clone if absent (GitHub token from env, never printed); otherwise `git fetch --all --prune --tags`. | `git clone https://github.com/mk42-ai/gods-eye-view && cd gods-eye-view && git checkout integration/ondemand-native` | `git rev-parse --abbrev-ref HEAD` = `integration/ondemand-native`; `git tag -l 'recovery/*'` lists `recovery/pre-ondemand-rebuild-20261020`. |
| 2 | **Load MASTER_STATE.md** — current commit, cycle number, completed / in-progress / remaining, scorecard. | `docs/agent-execution/MASTER_STATE.md` | The `Branch + commit` row matches `git rev-parse HEAD` (if not, the last cycle died before its checkpoint commit — go to step 8). |
| 3 | **Load INTEGRATION_MATRIX.md** (+ `api-inventory.json`) — providers, call sites, bypass count, migration status per provider. | `docs/agent-execution/INTEGRATION_MATRIX.md`, `api-inventory.json` | `summary.callSites` equals the number of `entries`; counts are the denominators for the scorecard. |
| 4 | **Load TEST_RESULTS.md** — capability verification table, foundation live validation, gate results. Re-run the cheap gates to confirm the tree is still green. | `npm ci` (PUPPETEER_SKIP_DOWNLOAD=1) · `npm run check:boundaries` · `npm run check:secrets` · `npm run test:ondemand` · `npm run test:serverless` · `npm run test:foundation` | all exit 0 — otherwise the first failing gate is the resume point. |
| 5 | **Load NEXT_ACTIONS.md** — the ordered queue with acceptance evidence. | `docs/agent-execution/NEXT_ACTIONS.md` | Identify the first item whose status is not DONE. |
| 6 | **Inspect the latest commits** on the integration branch and compare against MASTER_STATE §Commits. | `git log --oneline -20 origin/integration/ondemand-native` · `git status --short` | Any commit newer than MASTER_STATE's "current commit" is work from an interrupted cycle: read its diff before continuing. |
| 7 | **Identify interrupted work**: uncommitted changes, stashes, half-written docs, failing gates, a NEXT_ACTIONS item marked IN-PROGRESS. | `git status`, `git stash list`, `grep -n "IN-PROGRESS" docs/agent-execution/*.md` | A single, named interrupted unit (or none). Never discard local modifications — `git stash` and re-apply if a branch switch is needed. |
| 8 | **Verify subagent outputs are integrated**: the five inventories exist, are non-empty, and their counts match MASTER_STATE. | `ARCHITECTURE_INVENTORY.md`, `INTEGRATION_MATRIX.md` + `api-inventory.json`, `BRANDING_AUDIT.md`, `INFRASTRUCTURE_INVENTORY.md`, `FRONTEND_RECON.md` | Each file ends with a `GENERATED_UTC:` line; counts (54 providers / 82 call sites / 4 bypasses / 2,902 brand lines / 38 infra components / 38 widgets) match MASTER_STATE or MASTER_STATE explains the delta. |
| 9 | **Reconcile incomplete operations**: re-run the live OnDemand validation to detect platform drift (endpoint retirements, plugin deactivations, workflow id changes) and update BLOCKERS.md. | `npm run ondemand:foundation:live` (needs `ONDEMAND_API_KEY` in env; prints redacted JSON) | 20/20 PASS, or new FAIL rows recorded in TEST_RESULTS §3 and a blocker opened. |
| 10 | **Resume** at the NEXT_ACTIONS item from step 5 (or the interrupted unit from step 7). Work in validated units: implement → gates (step 4 list + `npm run build`) → update TEST_RESULTS/MASTER_STATE/NEXT_ACTIONS → conventional commit → push. Never commit secrets (`npm run check:secrets` before every commit). | `git add <explicit paths> && git commit -m "<type>(<scope>): …" && git push origin integration/ondemand-native` | MASTER_STATE "current commit" == pushed HEAD at the end of every unit. |

## Invariants that must hold at every checkpoint
- Secrets only via `process.env` on the server; no `VITE_`/`NEXT_PUBLIC_` secret; `src/` never imports `server/ondemand/foundation/**` (enforced by `foundation.test.mjs` "source-level guards" and `check-import-directions.mjs`).
- The browser-held key path (`x-ondemand-key`) is reachable only with `ONDEMAND_ALLOW_CLIENT_KEY=1`.
- No fabricated capability: every "verified" claim has a TEST_RESULTS row with a timestamp.
- `recovery/pre-ondemand-rebuild-20261020` is never moved or deleted.
- No force-push; no history rewrite on `integration/ondemand-native`.

## Where things are
| artefact | path |
|---|---|
| Foundation client / contracts / store / route | `server/ondemand/foundation/{types,client,plugin-contract,contracts,conversation-store,proxy-route}.js` |
| Foundation tests | `server/ondemand/foundation/foundation.test.mjs` (`npm run test:foundation`) |
| Live validation script | `scripts/ondemand-foundation-live.mjs` (`npm run ondemand:foundation:live`) |
| Secrets gate | `scripts/check-no-secrets.mjs` (`npm run check:secrets`, `--dist` after build) |
| Route mount | `server/serverless/app.js` → `mountFoundationRoutes` → `/api/ondemand/v2/*` |
| Dev flag for legacy client key | `server/ondemand/client.js#clientKeyAllowed` (`ONDEMAND_ALLOW_CLIENT_KEY`) |
| Checkpoints | `docs/agent-execution/{MASTER_STATE,INTEGRATION_MATRIX,TEST_RESULTS,BLOCKERS,NEXT_ACTIONS,RESUME}.md`, `api-inventory.json` |
| Subagent inventories | `docs/agent-execution/{ARCHITECTURE_INVENTORY,BRANDING_AUDIT,INFRASTRUCTURE_INVENTORY,FRONTEND_RECON}.md` |

## Cycle-2 additions (2026-10-20T23:40Z)
- Step 4 gate list now also runs `npm run format:check` and `node scripts/check-no-secrets.mjs --dist` after `npm run build`; foundation tests are 48 (`phase-cdg.test.mjs` covers Phases C/D/E/G).
- Step 9 live validation is 26 rows (expect 26/26); rows 21–26 need ~70 s because `/investigate` performs a real plugin retrieval.
- Browser proof is produced with the `ui-validator` skill against the sandbox preview; the app is a WebGL globe, so launch Chromium through a wrapper adding `--use-gl=angle --use-angle=swiftshader` (see BLOCKERS B-11) and keep `--viewport-only`.
- The sandbox preview is redeployed IN PLACE (copy the changed-file tarball, `npm run build`, restart `node server/serverless/dev-server.mjs` with `ONDEMAND_API_KEY` in the process env only — never in `.env`).
- Relaunch workflow: `6ad7f961c2cfee207e8f3d07` (ACTIVE, every 6 h) re-emits the trigger sentence; it cannot start the agent itself.
- New artefacts: `docs/agent-execution/artifacts/foundation-live-*.json`, `artifacts/ui-2026-10-20/*`, `BRAND_ASSETS.md`, `INFRASTRUCTURE_DECISIONS.md`.

GENERATED_UTC: 2026-10-20T23:40:00Z
