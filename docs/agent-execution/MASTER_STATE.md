# MASTER_STATE — ONDEMAND-NATIVE INTELLIGENCE PLATFORM · FULL ARCHITECTURAL REBUILD

Product (current brand) **OnDemand Spatial** — formerly "God's Eye View"; target neutral name **OnDemand Intelligence
Workstation** (configurable, BRANDING_AUDIT). Repository `mk42-ai/gods-eye-view`. This file is the single source of
truth for the mission state; `RESUME.md` tells an agent how to restart from it. All timestamps UTC.

## 1. Branch + commit

| item | value |
|---|---|
| Canonical repo | `https://github.com/mk42-ai/gods-eye-view` (private; cloned with the env token 2026-10-20T21:23:35Z) |
| Compared repo | `https://github.com/mk42-ai/ondemand-eand-spatial` (private; **unrelated history** — React/Tailwind e& executive brief imported from a source archive on 2026-09-11; no common ancestor with gods-eye-view; the Vercel project is still Git-linked to it) |
| Latest intended development branch (evidence) | `ondemand-serverless` — newest commit on the repo (2026-09-21T10:54:39Z, `1c9558c`, 72 commits ahead of `main`), contains the READY deployment SHA `0677f16` (2026-09-19), branch name matches the serverless/OnDemand direction; `main` (`0d41b6b`, 2026-09-16) is the upstream community line; `ondemand-serverless-svg-icons` is a 7-commit side branch whose work was re-applied onto `ondemand-serverless` (merge-tree: 0 conflicts, 0 unique source files except `scripts/check-icon-glyphs.mjs` + `public/icons/orbit.svg` + one audit doc) |
| **ORIGINAL_SHA** | `1c9558cde07fdddb8d7d01b64f7143f0bbc9d116` (HEAD of `origin/ondemand-serverless`) |
| Recovery tag + branch | `recovery/pre-ondemand-rebuild-20261020` → `1c9558c` (tag object `74a2609`), pushed 2026-10-20T21:26:36Z |
| Working branch | `integration/ondemand-native` (created from `1c9558c`, pushed 21:27:07Z) |
| Current commit (this checkpoint) | cycle-5 checkpoint commit that carries this file (see §9; tag `checkpoint-2026-10-21-post-sandbox-verification`) on top of `aa3eb8d` (cycle-4 docs) ← `226217f` (cycle-3 docs, tag `checkpoint-2026-10-21-verify-cycle4`) — cycle 2 ended at `f89d3ca`, cycle 3 baseline tag `checkpoint-2026-10-21-pre-integration-audit` = `75a0792` (2026-10-21T01:22:13Z) |
| Uncommitted changes / stashes at discovery | none (`git status` clean, `git stash list` empty) |
| Resume path taken | **Fresh discovery** — `docs/agent-execution/RESUME.md` and `MASTER_STATE.md` did not exist at `1c9558c` (the repo has a different checkpoint lineage: `docs/CLOSEOUT.md`, `docs/handover/*`, `docs/audit/*`, read as prior art) |

### Branch table (all refs, `git for-each-ref`, 2026-10-20T21:23:48Z)

| name | sha | date | author | merged into integration? | decision |
|---|---|---|---|---|---|
| origin/ondemand-serverless | 1c9558c | 2026-09-21 10:54:39 +0000 | ondemand-agent | **base** (identical) | source of `integration/ondemand-native` |
| origin/ondemand-serverless-svg-icons | b183fd5 | 2026-09-19 05:50:49 +0000 | goose-bot | effectively yes (content re-applied in `9ce49cd`…`b183fd5` equivalents; 0 conflicts) | **no action** — only `scripts/check-icon-glyphs.mjs`, `public/icons/orbit.svg`, `docs/audit/svg-icons-2026-09-19.md` are unique; cherry-pick deferred to Phase C hygiene (NEXT_ACTIONS N-14 scope) |
| main / origin/main | 0d41b6b | 2026-09-16 11:57:56 -0700 | Sameh Khamis | yes (merge-base of ondemand-serverless) | upstream community line; nothing newer than the base |
| origin/codex/wind-weather-lovable | 61f2a64 | 2026-09-16 01:13:43 -0500 | Bilawal Sidhu | **no** | 65 commits ahead of main (weather/cyclone/lightning prototype, "Lovable" draft); merge-tree vs integration → conflicts in `style.css`, `src/voice/actionSchemas.test.mjs` and a 621-file / −99,663-line divergence (pre-rebrand tree). **Not merged**: experimental, would revert the rebrand + serverless work. Revisit as a feature port, not a merge. |
| origin/codex/community-weather-base | fa69852 | 2026-09-15 22:31:01 -0500 | Bilawal Sidhu | **no** | base of the weather draft (54 ahead of main, 7 conflicts). Same decision. |
| origin/codex/spatial-conversations | 85a187f | 2026-09-15 03:45:38 -0500 | Bilawal Sidhu | **no** | 1 commit: "spatial building conversations" — an **OpenAI**-backed answerer (`server/providers/openai/spatial-answer.js`) + Gemini review script; conflicts in `src/voice/gevActions.js`, `style.css`. Valuable UX idea but adds a third-party AI bypass → re-implement on the foundation (`/api/ondemand/v2/chat`) in Phase C instead of merging. |
| origin/refactor/context-controls | 43db5c1 | 2026-09-13 02:18:04 -0700 | Sameh Khamis | yes (0 ahead of main) | nothing to do |
| recovery/pre-ondemand-rebuild-20261020 | 1c9558c | 2026-10-20 (created) | — | — | protection point, never move |
| integration/ondemand-native | 34319fb → see §9 | 2026-10-20 | terminal-bot | — | working branch |
| tags v0.1.0 / v0.1.1 | 003e726 / 451b0f6 | — | — | — | historical |

Cross-check of `ondemand-eand-spatial` (12 refs, newest `feat/exec-brief-v1.4-b7c0d3d` 2026-09-12): valuable, non-overlapping work = build gates `check-no-secrets.mjs` (**ported this cycle**), `check-forbidden-terms.mjs`, `check-remote-assets.mjs`, `check-contrast.mjs` (N-14), and a React "Ask the deal" SSE drawer (`api/_lib/deal.ts`) that the new foundation supersedes. The two repos share no code and must not be merged.

## 2. Engineering cycle
Cycle **5** (2026-10-21T07:33Z–08:58Z) — vigorous headless-browser verification of the live sandbox before any further
Signal Engine chat-UI change: five-agent swarm (A,B · C,D · E,F · G+regression · consolidation), **14 / 14**
scenario×viewport cells with PNG proof, desktop/mobile parity (streaming, HUD summary, failure/cancel/retry, isolation,
reload persistence), plugin lifecycle probes (API + badges), branding + 12 generated-asset checks (HTTP/sha256/OCR/Hough),
legacy OpenAI/Realtime audit (0 runtime refs) followed by removal of the last user-facing OpenAI residue (Provider Settings
row, doctor/dev-fresh, docs), full unit suite 4,675 (4,674 pass · 0 fail · 1 win32-only skip), successor sandbox after the
90-min expiry. Evidence TEST_RESULTS §10, `artifacts/sandbox-verify-2026-10-21/`.

Cycle **3** (2026-10-21T01:17Z–) — integration audit (161 call sites), OpenAI Realtime removed and voice re-routed
through `/api/ondemand/v2/voice/turn` (OnDemand Services STT/TTS + Chat SSE), honest plugin lifecycle
(`/plugins`, `/plugins/verify`, PLUGINS panel), 11 new OnDemand REST tool wrappers (21 tools / 17 plugins, 33
contracts, in-process tool invoker → B-13 closed), UI upgrades (brand backdrop, empty states, Developer details,
mgrs warning), live OnDemand docs re-read (36 pages) + trigger decision, voice workflow `6ad8160ab28e35aa11d85632`
created/activated/executed, real-project preview via the Vercel REST API. Resume path taken: RESUME.md 10-step
protocol from `f89d3ca` (gates green, live 52/52); 9 parallel subagents with non-overlapping file ownership; see
TEST_RESULTS §8 and §3c below.

Cycle **2** (history) — Phase A/B complete (cycle 1); this cycle delivered Phase C (migration: HUD bypass → OnDemand, env
hygiene, contracts fixed), Phase D (orchestrator on OnDemand sessions), Phase E (ASK ONDEMAND mini chat for every
object type on the v2 foundation), Phase F branding (env-driven PRODUCT_NAME, 45/45 P0 lines, brand asset set),
Phase G guards (rate limit, principal binding, prompt-injection fencing, tool-arg validation, audit) and Phase H
validation (26/26 live, 48 foundation units, 5 browser passes). Resume path taken: `RESUME.md` 10-step protocol
from `0f5341e` (MASTER_STATE matched HEAD; gates green; first non-DONE NEXT_ACTIONS item N-2). Start
2026-10-20T22:20Z · checkpoint 2026-10-20T23:40Z.

## 3. Completed (with evidence)
- Repo location, state, protection tag/branch, integration branch (TEST_RESULTS §0 timeline in the run report; `git ls-remote` shows all three refs).
- Live OnDemand docs read (40 operations) + **48 live probes** → capability table TEST_RESULTS §2.
- Five parallel subagent inventories integrated (§6).
- Foundation implemented and validated: `server/ondemand/foundation/*`, `/api/ondemand/v2/*` mounted, 25 unit tests, **20/20 live tests**, gates green (TEST_RESULTS §3–4).
- Browser-held key replaced: `x-ondemand-key` honoured only with `ONDEMAND_ALLOW_CLIENT_KEY=1`; `/api/ondemand/v2/*` never reads it.
- `check-no-secrets` gate ported and passing on source + `dist/`.

## 3b. Completed in cycle 2 (evidence in TEST_RESULTS §7, INTEGRATION_MATRIX "Cycle-2 migration evidence")
- B-1/B-2 fixed in code AND on the Vercel project (workflow-id shape validator; endpoint successor map; vars corrected 22:34Z).
- Branding: `src/brand` + `server/brand` + build-time stamping; 45/45 user-facing P0 lines replaced (`src/brand/productName.test.mjs` guards 0 legacy strings in rendered markup); brand assets (BRAND_ASSETS.md) wired into favicons/manifest/og; NOTICE carries the upstream MIT credit.
- Phase D/G: `foundation/{intelligence-object,orchestrator,guards}.js`; `/api/ondemand/v2/{investigate,summaries/hud}`; provenance + citations + confidence on every v2 answer; UNTRUSTED fencing of object context and plugin output.
- Phase E: `src/ondemand/miniChat.js` (rAF coalescing, virtualised activity, scroll anchoring, abort, history resume, investigate) + ASK affordances on data-layer rows, HUD summary, regional brief; 10 designated object types + globe types covered by one panel.
- Bypasses 4 → 2 (HUD summary migrated, ElevenLabs var removed); `ONDEMAND_KNOWLEDGE_PLUGIN_IDS` removed.
- Live validation 26/26 (incl. 3 concurrent users × same object → 3 sessions, answers not crossed); browser validation 5 passes at 1440×900 (+390×844).
- Flow Builder relaunch workflow `6ad7f961c2cfee207e8f3d07` created + activated (limitation recorded: it cannot drive the agent).

## 3c. Completed in cycle 3 (evidence TEST_RESULTS §8, INTEGRATION_MATRIX "Cycle-3 migration evidence", BLOCKERS B-14…B-17)
- Checkpoint tag `checkpoint-2026-10-21-pre-integration-audit` (`75a0792`) before any chat-UI change; baseline 48/246/58 units, 52/52 live, browser A–G 12/14 (A failed on the "OpenAI Realtime" notice).
- `INTEGRATION_AUDIT.md` + `integration-audit.json`: 161 call sites (32 ondemand-native · 10 proxied-tool · 53 direct-provider · 17 direct-browser · 4 bypass-ai · 25 stub · 20 test-only) with file:line and replacement per row.
- `ONDEMAND_LIVE_DOCS_2026-10-21.md` (36 live pages, probe log) + `TRIGGER_DECISION.md`: interactive voice = direct STT → chat stream → TTS (per-turn `pluginIds`); Flow Builder workflow = auditable async path (`execute` has no body; webhook URL dashboard-only).
- OpenAI Realtime removed entirely (35 files incl. `server/providers/openai*`, `src/voice/realtime*`); `src/voice/gevActions.js` map-action layer kept; `/api/realtime/*` mounts gone; direct AI bypasses **4 → 0**.
- `voice-route.js`: `POST /api/ondemand/v2/voice/turn` SSE (`turn, transcript, session, status*, delta*, answer, tts|tts_error, done|error`, heartbeats, abort propagation, server key only), `GET /voice/health`, alias `/api/voice/*`; live turn 7.9 s with https TTS (live row 30); client pipeline `voiceTurn` with barge-in; `ONDEMAND_VOICE_WORKFLOW_ID` (default `6ad8160ab28e35aa11d85632`) in config + Vercel env.
- `plugin-lifecycle.js` + `pluginPanel.js`: discovered → installing → authenticating → ready | failed driven by real session+probe calls; invoking counters from `/chat`; live: `internet_web_search` READY 4.7 s, `x_mcp_connector` FAILED `inactive_on_account`.
- `tool-contracts.js`: 20 registry-derived `ondemand-tool` contracts (+ earthquake) → 33 contracts; `createToolInvoker()` wired into the serverless app and the live script; `/investigate` on an earthquake runs `earthquake_search:ok` in-process.
- 11 new tool modules (`fires, overpass, places, gbfs, transit, regional, terrain, cctv, military_installations, radio, space`), OpenAPI regenerated for 17 plugins (0 drift), `docs/plugins/REGISTRY.md` with the live table (14 ok · 2 not_found · 2 not_configured · 2 upstream_unavailable · 1 vessel not_found).
- UI: `backdrop-network.png` on loading + first-run screens; empty states (no-sessions / no-results / source-unavailable) in mini + entity chat; `#ondemand-mini-chat-dev` "Developer details" holding activity/metrics/frames/provenance; `site.webmanifest`; mgrs build warning fixed; `BRAND_ASSETS.md` re-verified (16 files, sha256).
- Gates: full `npm test` 4,188/4,188 (Node 22), live 34/34, browser A–G 14/14 on the post-change local preview; package exports/boundaries pruned of the retired voice modules.
- Platform: voice workflow created 01:31:54Z, activated, execution `6ad81615c2cfee207e8f3e12` success 7.4 s; plugin API creation proven dashboard-only (B-15); content-policy drift (B-14) recorded and the live script re-phrased.

## 4. In progress
- None at checkpoint time. Post-change preview `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8` (https://ondemand-eand-spatial-qrli9v1uy-schoolhack-web-team.vercel.app, commit `d44264f`) READY with 14/14 browser scenarios + 4 ui-validator passes (TEST_RESULTS §8.5). Next cycle starts at NEXT_ACTIONS N-18 (dashboard plugin registration) / N-5b / N-16 / N-21.

## 5. Remaining (summary — full queue in NEXT_ACTIONS.md)
N-18 register the 17 OpenAPI plugins in the dashboard (API create is 500/524) · N-19 operator keys (`TOMTOM_API_KEY`, `NASA_FIRMS_MAP_KEY`) · N-20 webhook trigger URL → `ONDEMAND_VOICE_WEBHOOK_URL` · N-21 Node-24 CI · B-6 production re-link. Older: N-5b port entity/camera chat onto miniChat · N-6 typecheck+lint · N-7 KV conversations · N-9b remove OpenAI Realtime (last 2 bypass call sites) · N-9c fold capability loop into the orchestrator · N-11 register 38 geodata tools + wire `toolInvoker` live · N-12 media verification · N-13 Node-24 full suite + real-project preview + production re-link (B-6) · N-14 sibling gates · N-15 remaining browser checklist rows via the Puppeteer harnesses · N-16 workflow v2 definition · N-17 enforce user header + KV.

## 6. Subagent deliverables (Phase A, parallel, non-overlapping)

| agent | deliverable | key counts | generated |
|---|---|---|---|
| (a) Architectural inventory | `ARCHITECTURE_INVENTORY.md` | Node ≥24 / Vite 6 / vanilla JS (778 .js + 483 .mjs, 0 .ts); 33 catch-all mount prefixes; 8 Vercel function files (+`_config.js` helper caught by the glob = 10 files under `api/`); 0 browser workers; no crons; 33 env names in `.env.example` + ~55 undeclared; **no eslint / typecheck** | 21:38:13Z |
| (b) External-API inventory | `api-inventory.json` + `INTEGRATION_MATRIX.md` | **54 providers · 82 call sites · 13 OnDemand-native · 4 direct AI bypasses · 38 planned tool wraps · 27 keep-direct · 120 env vars read** | 21:52:27Z |
| (c) Branding audit | `BRANDING_AUDIT.md` | **2,902 occurrence lines (2,784 unique) in 286 files**; legacy marks 1,610 lines/160 files; **45 user-facing lines in 17 files** (2 legacy "God's Eye"/"GEV MIC", 43 hard-coded current brand) ; 1,210 persisted keys + 122 env alias + 73 frozen prompts + 32 client ids = do-not-rename | 21:39:41Z |
| (d) Infrastructure inventory | `INFRASTRUCTURE_INVENTORY.md` | **38 components — KEEP 21 · CONSOLIDATE 11 · REMOVE 6**; AI paths: OnDemand (chat/media/services/workflow) vs BYPASS OpenAI Realtime, OpenAI HUD summary, ElevenLabs (env-only, no reader) | 21:39:37Z |
| (e) Frontend reconnaissance | `FRONTEND_RECON.md` | **38 widgets — 7 already actionable · P0 6 · P1 12 · P2 13**; no rAF coalescing / virtualisation / scroll-anchoring exists in the chat overlay (bottom-pin only) → must be ADDED in N-5, "GATE HELD" indicator does not exist in code | 21:40:47Z |

## 7. Validated coverage (OnDemand)
| surface | verified | notes |
|---|---|---|
| auth (`apikey` header, bad key → 401) | ✅ | TEST_RESULTS §2 rows 1–2 |
| endpoints registry / reasoning modes | ✅ (undocumented `GET /config/v1/public/{endpoints,reasoning_modes}`) | 92 endpoints / 23 active; `predefined-gpt-5.6-luna` inactive, `predefined-gpt-6-luna` active |
| chat session create (externalUserId + pluginIds), list, get, messages | ✅ | 10 of 11 plugins accepted; X MCP inactive |
| query sync / SSE stream (deltas, metricsLog, heartbeat, [DONE]) | ✅ | ttfb ≈ 2.5 s |
| query with plugin (web search) | ✅ | sourced answer |
| media list | ✅ · media create/delete | ⚠️ unverified (500/524) |
| workflow get / execute / status / logs / node outputs / list | ✅ (real id) · log **streaming** | UNSUPPORTED upstream (polling relay) |
| REST API key management · plugin registration | UNSUPPORTED via public API (dashboard only) |
| Foundation live validation | ✅ 20/20 |

## 8. UI validation
Browser-level UI validation not run this cycle — no UI consumes `/api/ondemand/v2` yet (Phase C, N-5/N-8). Existing UI untouched; `npm run build` green locally and in the sandbox preview (`GET /` 200); `src/` never imports the foundation (guard test).

## 3d. Completed in cycle 4 (evidence TEST_RESULTS §9, artefacts `artifacts/verify-2026-10-21/`)
- Five-agent verification of the real-project preview `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8`: desktop 15/18, mobile 15/19, API 47 PASS + 6 expected-degraded + 2 unsupported / 55, scenarios A–G 14/14 + perf 4/6 + no-fake-content 14/14.
- Fixes landed: investigate deadline budget (`timeout` rows, synthesis within budget, `budgetMs`), mini-chat 504 → `source-unavailable` empty state, voice turn forwards the PLUGINS selection, `GET /api/health` liveness alias. Gates green (foundation 76, serverless 57, ondemand 250).
- Fresh ephemeral preview `https://sb-72vtzc1c6cf8.vercel.run` (sandbox `sbx_pZgfovEYwxtQu48zPwIg0rVujhWO`): `/api/health` 200 (`keySource:"server"`, 33 contracts), brand assets 200, headless-Chromium 15/15 at 1440×900 and 8/8 at 390×844 with zero legacy branding.
- Open: N-22…N-25 (mobile touch targets, voice-button overlap, follow-up pinning, `ONDEMAND_INVESTIGATE_BUDGET_MS` on the Vercel project).

## 3e. Completed in cycle 5 (evidence TEST_RESULTS §10, artefacts `artifacts/sandbox-verify-2026-10-21/`)
- Live sandbox `sb-72vtzc1c6cf8` verified end-to-end: A–G 14/14 at 1440×900 + 390×844 (PNG per cell), parity 6/6 groups, plugin lifecycle API 8/8 probes (READY / FAILED `inactive_on_account` / 403 `user_mismatch`) + badge transitions on both viewports, branding 0 legacy terms, 12/12 assets HTTP 200 + sha256 match, 0 eye motifs (OCR + Hough), 3 attached originals byte-identical to the served files.
- Harness fixes (no app change): boot wait on `#loading-screen.hidden` (Scenario A screenshots had captured the loader overlay — before/after kept), self-seeding D/E, `--format png`.
- Legacy residue removed: `OPENAI` Provider-Settings row (`src/keySetupCore.mjs`) + `OPENAI_API_KEY` out of the bundle, `setup-doctor`/`dev-fresh` now report `ONDEMAND_API_KEY`, README/TESTING/SECURITY/CONTRIBUTING/CLOSEOUT rewritten (OD VOICE, OnDemand key), regression test added; `dist/` 0 hits for `api.openai.com|realtime/token|OPENAI_API_KEY`.
- Unit suites: 4,675 tests · 4,674 pass · 0 fail · 1 skipped (win32-only) on Node 22; gates green.
- Successor sandbox `sbx_5nzv1jxgsXOEfEknNB6MTQhA2Xgk` → `https://sb-6p9xpg654ouc.vercel.run` (A–G 14/14 again) after the primary hit its 90-min lifetime (410 at 08:53:29Z).

## 9. Commits on `integration/ondemand-native` (this cycle)
| sha | message | timestamp |
|---|---|---|
| 17a7b24 | docs(agent-execution): Phase A discovery inventories — architecture, external-API (54 providers/82 call sites/4 bypasses), branding, infrastructure, frontend recon | 2026-10-20T22:07:47Z |
| c97a365 | feat(ondemand): Phase B foundation — typed server-side client, PluginContract registry, object-context conversation store and /api/ondemand/v2 proxy (server key only) | 2026-10-20T22:07:47Z |
| 9067843 | docs(agent-execution): cycle-1 checkpoint | 2026-10-20T22:12Z |
| 0f5341e | docs(agent-execution): sandbox preview verification of /api/ondemand/v2 | 2026-10-20T22:18Z |
| 6cdbcf9 | fix(ondemand): validate the workflow-id shape and retire predefined-gpt-5.6-luna (B-1, B-2) | 2026-10-20T23:38Z |
| 132fced | feat(brand): env-driven product identity, neutral brand asset set and P0 rename | 2026-10-20T23:38Z |
| 99c9ed7 | feat(ondemand): intelligence orchestration, provenance objects and Phase G guards on /api/ondemand/v2 | 2026-10-20T23:39Z |
| f7dff65 | chore(ondemand): remove the retired OpenAI HUD-summary provider file | 2026-10-20T23:39Z |
| 34319fb | feat(ask-ondemand): contextual mini chat for every object type on the v2 foundation | 2026-10-20T23:39Z |
| f89d3ca | docs(agent-execution): cycle-2 checkpoint | 2026-10-20T23:36:39Z |
| 75a0792 | chore(checkpoint): cycle-3 baseline (tag `checkpoint-2026-10-21-pre-integration-audit`) | 2026-10-21T01:22:13Z |
| d44264f | feat(ondemand): voice turn on OnDemand (OpenAI Realtime removed), plugin lifecycle, 21 tool contracts + in-process invoker, 11 tool wrappers, UI upgrades, A–G harness | 2026-10-21T04:04:17Z |
| 226217f | docs(agent-execution): cycle-3 checkpoint (tag `checkpoint-2026-10-21-verify-cycle4`) | 2026-10-21T04:12:28Z |
| 9e26be5 · 844bf45 · aa3eb8d | cycle 4: fix(ondemand) investigate budget / 504 empty state / voice plugin forwarding / `/api/health` alias · test(qa) verification harness + artefacts · docs cycle-4 checkpoint | 2026-10-21T07:2xZ |
| 7b669a3 · eb4ec15 · (this commit) | test(qa): sandbox verification swarm artefacts + harness boot-wait/self-seed/png · chore(legacy): remove the OpenAI Provider-Settings row and OpenAI wording (doctor, dev-fresh, docs) · docs(agent-execution): cycle-5 checkpoint (tag `checkpoint-2026-10-21-post-sandbox-verification`) | 2026-10-21T08:59Z–09:0xZ |
| (cycle 3 docs) | docs(agent-execution): cycle-3 checkpoint — INTEGRATION_AUDIT, live docs, trigger decision, TEST_RESULTS §8, BLOCKERS B-14…17, NEXT_ACTIONS N-18…21, RESUME | see `git log` |

## 10. Blockers
See `BLOCKERS.md` — B-1 Vercel workflow-id typo (S1), B-6 production Git-link (S1), B-2 inactive endpoint default, B-3 plugin-set rejections (mitigated), B-4 media create, B-5 no log SSE (mitigated), B-7 OpenAI bypasses, B-8 Node 24 suite, B-9 no typecheck/lint, B-10 `/fallbacks` n/a.

## 11. Key handling (security finding → resolution)
Before: browser stored the OnDemand key in `localStorage['ondemand.apiKey']` and forwarded it as `x-ondemand-key`
through `/api/ondemand/{chat,sessions}`; server substituted it for the upstream `apikey`. After this cycle: the
override is **off by default** (`clientKeyAllowed()` requires `ONDEMAND_ALLOW_CLIENT_KEY=1`), the legacy routes
otherwise always use the server key, and the new `/api/ondemand/v2/*` never reads the header
(`X-OnDemand-Key-Source: server` always). The Settings-drawer key field becomes a no-op until N-5 removes it.

## 12. Scorecard (denominators are the ACTUAL inventory counts — cycle 3, 2026-10-21)

| metric | numerator / denominator | source |
|---|---|---|
| External API discovery | **161 / 161** call sites inventoried file:line (integration-audit.json, 2026-10-21T02:15:18Z); the earlier provider inventory (54 providers / 85 call sites) is kept in api-inventory.json | INTEGRATION_AUDIT.md |
| OnDemand migration | 34 OnDemand-native call sites · **21 / 21** repo tools exposed as OnDemand REST tools (17 plugins, OpenAPI generated, 0 drift) fronting 47 of the 53 direct-provider rows · UNSUPPORTED by design: persistent AIS websocket relay, browser tiles/3D-tiles/Cesium ion, fonts CDN (INTEGRATION_MATRIX "UNSUPPORTED") | INTEGRATION_MATRIX cycle-3 section |
| Plugin invocation validation | 10 / 11 account plugins accepted at session creation; **3 / 10 exercised end-to-end live** (web search rows 7/30/34, Perplexity via `/investigate` row 27, lifecycle probe); 2 / 2 workflows executed (`6aace534…`, voice `6ad8160a…` execution `6ad81615c2cfee207e8f3e12`); **33 / 33** contracts registered (11 plugins · 21 tools · 1 workflow); 21 / 21 tool routes live-checked (14 ok · 7 honest failures: not_found/not_configured/upstream_unavailable); platform-side plugin registration of the 17 OpenAPI docs: **0 / 17** (dashboard-only, B-15) | TEST_RESULTS §8.2, docs/plugins/REGISTRY.md |
| Direct API bypasses | **0** remaining / 4 found (HUD summary migrated cycle 2; ElevenLabs removed cycle 2; OpenAI Realtime token + WebRTC pair removed cycle 3 — 35 files deleted; grep in RESUME invariants → 0 runtime hits) | INTEGRATION_MATRIX, B-7 RESOLVED |
| Critical navigation workflows | 6 / 6 P0 widgets carry an ASK affordance; browser scenarios A–G **14 / 14** at 1440×900 + 390×844 on the post-change preview (startup/branding, pipeline+waiting, citations, root-first layout, history vs isolation, plugin caps, failure/retry + cross-app regression) | TEST_RESULTS §8.2 |
| Contextual mini chat | **10 / 9 designated object types** (+12 globe types) with starters; empty states + Developer details added; per-turn plugin selection from the PLUGINS panel | miniChat.js, pluginPanel.js |
| Session isolation | 3 / 3 concurrent users × same object → 3 distinct sessions (live row 26, re-run 03:48Z); browser E: same object replays 4 messages, different object isolated (both viewports) | TEST_RESULTS §8 |
| Source traceability | 34 / 34 live rows + 14 / 14 browser scenarios carry timestamps + artefacts; every v2 answer and every voice `answer` event carries `provenance{provider,endpointId,pluginIds,keySource:'server',fetchedAt}` + `citations[]` + `confidenceBasis` | TEST_RESULTS §8 |
| Integration tests (real endpoints) | **34 / 34** live (`npm run ondemand:foundation:live`, 03:46:44Z–03:49:30Z) | artifacts/foundation-live-2026-10-21T03-49Z.json |
| Unit tests | **4,675 tests · 4,674 pass · 0 fail · 1 skipped** (win32-only DACL test) on Node 22 — src 4,191 · foundation 76 · ondemand 250 · serverless 57 · tools 45 · providers+sources 56; 2 allocation micro-benchmark files skipped (Node-24 calibrated, B-8) | TEST_RESULTS §10.6 |
| UI tests | **14 / 14** scenario×viewport passes on the live sandbox (cycle 5, PNG proof per cell, + 14/14 on the successor sandbox) and post-change preview (cycle 3; baseline 12 / 14); harness `scripts/qa-chat-intelligent-ui.mjs`; spec `web/tests/chat-intelligent-ui-payloads.spec.ts`; extra parity/plugin/branding rows in `artifacts/sandbox-verify-2026-10-21/results-matrix.json` | artifacts/ui-2026-10-21 |
| Branding replacement | **0** user-facing legacy occurrences (scenario A + ui-validator assert no "God's Eye"/"GEV MIC"/"OpenAI" visible text at both viewports; cycle 5 also removed the OPENAI Provider-Settings row and the OpenAI wording from README/TESTING/SECURITY/CONTRIBUTING/CLOSEOUT/doctor/dev-fresh; 12/12 brand assets 200 + sha256, 0 eye motifs) | brandAssets.test.mjs, scenario A |
| Infrastructure consolidation | OpenAI Realtime provider removed (component 7/38 DONE); voice, plugin lifecycle and tool invoker run in-process — Vercel function count unchanged; redundant AI orchestrators remaining: **0** | INFRASTRUCTURE_DECISIONS.md |
| Deployment | real-project previews via the Vercel REST API: checkpoint `dpl_6MnJQzCAvrgomj7UeG7BcFByNmqx` (02:08Z) and post-change `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8` READY 04:05Z (`/api/ondemand/v2/health` ok, voice/health ok, 14/14 scenarios, `/api/realtime/token` 404); production still Git-linked to the sibling repo (B-6) | TEST_RESULTS §8.4/§8.5 |

GENERATED_UTC: 2026-10-21T08:58:00Z
