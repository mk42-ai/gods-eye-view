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
| Current commit (this checkpoint) | `c97a3655ef40cfbd895ce335713be75b62795485` + the checkpoint-docs commit that carries this file (see §9) |
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
| integration/ondemand-native | c97a365 → see §9 | 2026-10-20 | goose-bot | — | working branch |
| tags v0.1.0 / v0.1.1 | 003e726 / 451b0f6 | — | — | — | historical |

Cross-check of `ondemand-eand-spatial` (12 refs, newest `feat/exec-brief-v1.4-b7c0d3d` 2026-09-12): valuable, non-overlapping work = build gates `check-no-secrets.mjs` (**ported this cycle**), `check-forbidden-terms.mjs`, `check-remote-assets.mjs`, `check-contrast.mjs` (N-14), and a React "Ask the deal" SSE drawer (`api/_lib/deal.ts`) that the new foundation supersedes. The two repos share no code and must not be merged.

## 2. Engineering cycle
Cycle **1** — Phase A (Recovery & Discovery) **complete**, Phase B (OnDemand Foundation) **complete for the server
side**, UI adoption of the foundation is Phase C. Start 2026-10-20T21:23:05Z · checkpoint 2026-10-20T22:15Z.

## 3. Completed (with evidence)
- Repo location, state, protection tag/branch, integration branch (TEST_RESULTS §0 timeline in the run report; `git ls-remote` shows all three refs).
- Live OnDemand docs read (40 operations) + **48 live probes** → capability table TEST_RESULTS §2.
- Five parallel subagent inventories integrated (§6).
- Foundation implemented and validated: `server/ondemand/foundation/*`, `/api/ondemand/v2/*` mounted, 25 unit tests, **20/20 live tests**, gates green (TEST_RESULTS §3–4).
- Browser-held key replaced: `x-ondemand-key` honoured only with `ONDEMAND_ALLOW_CLIENT_KEY=1`; `/api/ondemand/v2/*` never reads it.
- `check-no-secrets` gate ported and passing on source + `dist/`.

## 4. In progress
- None at checkpoint time (every unit is committed). The next cycle starts at NEXT_ACTIONS N-2.

## 5. Remaining (summary — full queue in NEXT_ACTIONS.md)
N-2 workflow-id validation + Vercel fix · N-3 endpoint default → `predefined-gpt-6-luna` · N-4 server-driven plugin prefill · N-5 migrate entity/camera chat to v2 + rAF coalescing/virtualised activity · N-6 typecheck+lint · N-7 KV-backed conversations · N-8 six P0 "Ask OnDemand" widgets · N-9 retire OpenAI bypasses · N-10 PRODUCT_NAME branding · N-11 register 38 geodata tools · N-12 media verification · N-13 Node-24 full suite + preview/production re-link · N-14 port remaining sibling gates.

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
Not run this cycle — no UI consumes `/api/ondemand/v2` yet (Phase C, N-5/N-8). Existing UI untouched; `npm run build`
green; `src/` never imports the foundation (guard test).

## 9. Commits on `integration/ondemand-native` (this cycle)
| sha | message | timestamp |
|---|---|---|
| 17a7b24 | docs(agent-execution): Phase A discovery inventories — architecture, external-API (54 providers/82 call sites/4 bypasses), branding, infrastructure, frontend recon | 2026-10-20T22:07:47Z |
| c97a365 | feat(ondemand): Phase B foundation — typed server-side client, PluginContract registry, object-context conversation store and /api/ondemand/v2 proxy (server key only) | 2026-10-20T22:07:47Z |
| (next) | docs(agent-execution): checkpoint — MASTER_STATE, TEST_RESULTS, BLOCKERS, NEXT_ACTIONS, RESUME | see `git log` |

## 10. Blockers
See `BLOCKERS.md` — B-1 Vercel workflow-id typo (S1), B-6 production Git-link (S1), B-2 inactive endpoint default, B-3 plugin-set rejections (mitigated), B-4 media create, B-5 no log SSE (mitigated), B-7 OpenAI bypasses, B-8 Node 24 suite, B-9 no typecheck/lint, B-10 `/fallbacks` n/a.

## 11. Key handling (security finding → resolution)
Before: browser stored the OnDemand key in `localStorage['ondemand.apiKey']` and forwarded it as `x-ondemand-key`
through `/api/ondemand/{chat,sessions}`; server substituted it for the upstream `apikey`. After this cycle: the
override is **off by default** (`clientKeyAllowed()` requires `ONDEMAND_ALLOW_CLIENT_KEY=1`), the legacy routes
otherwise always use the server key, and the new `/api/ondemand/v2/*` never reads the header
(`X-OnDemand-Key-Source: server` always). The Settings-drawer key field becomes a no-op until N-5 removes it.

## 12. Scorecard (denominators are the ACTUAL inventory counts)

| metric | numerator / denominator | source |
|---|---|---|
| External API discovery | 82 / 82 call sites inventoried (54 providers) | api-inventory.json |
| OnDemand migration | 13 / 82 call sites OnDemand-native (27 keep-direct by design → 13 / 55 migratable) | INTEGRATION_MATRIX |
| Plugin invocation validation | 10 / 11 Settings plugins accepted at session creation; 1 / 11 exercised end-to-end with a sourced answer (web search); 1 / 1 workflow executed; 1 / 3 registered tools contract-expressed | TEST_RESULTS §2–3 |
| Direct API bypasses | 4 remaining / 4 found (0 removed this cycle; foundation makes removal possible) | INTEGRATION_MATRIX |
| Critical navigation workflows | 0 / 6 P0 widgets wired (Phase C) | FRONTEND_RECON |
| Contextual mini chat | 2 / 38 widgets actionable through the OLD route (entity + camera); 0 / 38 on the v2 foundation; foundation route proven live | FRONTEND_RECON + TEST_RESULTS §3 |
| Session isolation | 3 / 3 live isolation tests PASS (same user+object reuses, other user differs, object key differs) | TEST_RESULTS §3 rows 13–16 |
| Source traceability | 48 / 48 capability probes + 20 / 20 live tests carry timestamps + redacted evidence | TEST_RESULTS |
| Critical integration tests | 25 / 25 foundation · 243 / 243 ondemand · 58 / 58 serverless · 5 / 5 deny-list · 2 / 2 no-key-in-bundle | TEST_RESULTS §4 |
| Critical UI workflows | 0 / 6 (not started) | — |
| Branding replacement | 0 / 45 user-facing lines replaced (plan ready; 2,902 total lines classified) | BRANDING_AUDIT |
| Infrastructure consolidation | 0 / 17 CONSOLIDATE+REMOVE decisions executed (21 KEEP) | INFRASTRUCTURE_INVENTORY |
| Deployment | integration branch pushed; preview of the branch on the real Vercel project not yet created; production BLOCKED (B-6) | BLOCKERS |

GENERATED_UTC: 2026-10-20T22:15:00Z
