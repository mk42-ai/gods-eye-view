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
| Current commit (cycle 11, 2026-10-23 scheduled) | **branch `feat/scene-video-evidence`** — cycle-11 commit (labelling rule v2: LIVE <6 h / RECENT <72 h + dated-outlet cross-match, per-plugin call log, verification lane, reload hash check) on top of `1da0cb8` (cycle-10 docs) ← … ← `f20fab6`; local tag `checkpoint-2026-10-23-scene-video-labels-v2`; bundle `gods-eye-view-scene-video.bundle` refreshed. Live preview `https://sb-3f7jy4mbzqe7.vercel.run` (`sbx_IyGvAqmHmnbgZnpfe3HcM5GtBeyy`, expires ≈06:15Z). Evidence TEST_RESULTS §16. |
| Previous commit (cycle 10, 2026-10-23) | **branch `feat/scene-video-evidence`** = `6f00211` ← `1aeba2d` ← `1769971` ← `1bd8f4d` ← `609b4fc` ← **`f20fab6` (baseline checkpoint = byte-exact source of the user-approved deployment `ondemand-agent-k8v6snzk7` / `dpl_H9yVA3kDuV8ekgs7xzj7AjDPgaSH`, built on `b698032`)** + the cycle-10 docs commit; local tag `checkpoint-2026-10-23-scene-video` (push blocked, B-25). Branch `baseline/approved-k8v6snzk7` points at `f20fab6`. |
| Previous commit (cycle 9) | **cycle-9 checkpoint commit** (docs) on top of `97f5b05` ← `1a82c71` ← `1fbb83e` ← `325b5cc` ← `b95a513` ← `124b5bb` ← `3be45e8` ← `7660136` ← `0dcf469` ← `b698032` (cycle 8 head) — local annotated tag `checkpoint/aoi-incident-scenes-v1` (push pending, N-34). Previous: `166101d` (cycle-8 checkpoint docs; parent `039fa2e` = embeddability fix on `6b49fe9`) — tag `checkpoint-2026-10-22-cycle8-preview`; cycle-6 checkpoint commit that carries this file (see §9; tag `checkpoint-2026-10-21-preview-retry`) on top of `712a552` (cycle-5 docs, tag `checkpoint-2026-10-21-post-sandbox-verification`) ← `aa3eb8d` (cycle-4 docs) ← `226217f` (cycle-3 docs, tag `checkpoint-2026-10-21-verify-cycle4`) — cycle 2 ended at `f89d3ca`, cycle 3 baseline tag `checkpoint-2026-10-21-pre-integration-audit` = `75a0792` (2026-10-21T01:22:13Z) |
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
Cycle **10** (2026-10-23T03:15Z–04:3xZ) — **scene video evidence**. Baseline: the approved deployment
`https://ondemand-agent-k8v6snzk7-schoolhack-web-team.vercel.app` is a goose-share CLI deploy with **no `githubCommitSha`**
(meta `source: ondemand-goose-execution-share`, created 2026-10-22T15:51:22Z); its `/src` tree (2,698 files) was sha1-diffed
against history → closest commit `b698032` + 13 changed / 49 added files (the unpushed cycle-9 AOI work). Branch
`baseline/approved-k8v6snzk7` + checkpoint commit `f20fab6` reproduce it byte-for-byte (2,165/2,165 source files, `.env` excluded);
the approved URL hash round-trips (27/27 keys, both viewports). New: `POST /api/ondemand/v2/scene/videos` (SSE) fans out in parallel to
YouTube / TikTok / Instagram **through OnDemand plugin sessions only**, EN+AR keyword/place/bbox/time-window planner, dedupe, recency+geo+keyword
ranking, VideoEvidence normalisation, LIVE/RECENT/ARCHIVAL tiering (undated ⇒ ARCHIVAL); `/scene/media` allow-listed Range proxy
(is.gd + Instagram CDN, 410 on expired URL); player rail with SEARCHING SOURCES chips, autoplay-muted queue, caption-offset seek, per-clip badge +
recording date + source link + provenance, persistent banner `REBUILT FROM ARCHIVAL FOOTAGE: recorded <date>, not live`, Cesium pins per clip,
ASK per clip (mini chat object context). Created plugins **plugin-1792727178** (YouTube oEmbed API) and **plugin-1792727179** (TikTok oEmbed API),
no credentials. Live run for "rebuild the car crash reported in Umm Suqeim": 13–14 clips (YouTube 6 · TikTok 6 · Instagram 1–2), all ARCHIVAL,
~40 s. Unit **4,286 (4,285 pass · 1 skip)** + scene-videos 16 + rail/evidence 24, foundation 77, ondemand 250, serverless 57; secrets ✓ src + dist.
Sandbox `sbx_FsiXEcFVjxA7tRJMiCIAGMstvv62` → https://sb-5c67af3inbu0.vercel.run (health 200 `configured:true` 04:19:13Z); headless proof
**10 / 10** (TEST_RESULTS §15). Push / tag push / PR / persistent `ondemand-agent` preview blocked (B-25, B-26).

Cycle **9** (2026-10-22T10:03Z–13:05Z) — **UAE AOI incident scenes**: scene playback restricted to UAE areas of interest
(editable `config/aoi/uae-interest.json`: Iran / Yemen / Somalia, Hormuz / Gulf of Oman / southern Red Sea / Bab el-Mandeb /
Gulf of Aden / Socotra, UAE land borders, UAE waters, 8 presence nodes; ray-casting + bbox + circle membership with
`OUT_OF_AOI: nearest AOI <name> at <km> km`); bundled out-of-AOI scenes (Nepal Flood, global demos) hidden with a reason but kept
in storage/export; normalized Incident/Scene model (sha1 dedupe on category·0.01°·6 h, 25 km/6 h clustering, approach→overhead→context
keyframes, 10 generated category icons in `public/icons/incidents/`); `/api/ondemand/v2/incidents/{ingest,list,aoi,refresh,locate}` on
the foundation proxy (shared-secret or session-scoped ingest, PluginContract-mediated live refresh + entity extraction/geocoding,
gazetteer fallback); seeded with 52 VIIRS N21 hotspots, 8 web incidents from the OnDemand research plugins and 8 presence nodes with
PlanetScope evidence (47 in AOI → 35 scenes, 18 rejected with reasons); map overlay + popover (sources, confidence badge, evidence,
PLAY SCENE, ASK ONDEMAND with incident context), AOI layer toggles + legend, PAUSE/RESUME/PREV/NEXT + scrub bar, REFRESH LIVE; fixed
bottom composer “Type an incident…” (locate → verify AOI → build scene, candidate picker, OUT_OF_AOI reason + “Add anyway (override)”,
session-scoped persistence, auto-play). `vercel.json` framing headers removed (embeddability now also enforced by
`src/tooling/embeddability.test.mjs`). Unit **4,264 (4,263 pass · 1 win32 skip)**, foundation 77, ondemand 250, serverless 57, secrets ✓
src+dist; new sandbox `sbx_cR56IE7EkAJY2OH7OWTAIdlWiDNC` → https://sb-69k15adlaiog.vercel.run (health 200 11:57:59Z); headless proof
**14 / 14** (checks a–g × 1440×900 + 390×844, TEST_RESULTS §14, `artifacts/aoi-incidents-2026-10-22/`). Live refresh verified against
OnDemand (perplexity_research + internet_web_search ok, +3 incidents in Hormuz/Yemen). Push/PR/tag blocked by the missing GitHub token
(N-34, git bundle hand-over in RESUME.md).

Cycle **8** (2026-10-22T06:27Z–06:34Z) — **emergency preview redeploy**: the previously reported preview sandbox stopped serving, so a brand-new Vercel Sandbox `sbx_EdkizkMGv6ASKOnpEmUWOAlaQrRc` → `https://sb-1ek30lyxzsd3.vercel.run` was built from `6b49fe9` + the embeddability unit (`build/vite.js` framing headers removed, test updated); npm ci 7 s, vite build 8.27 s, secrets gate green with 0 key-value hits in `dist`/`.env`, health **200** `configured:true` `keySource:server`, `/` **200** with the neutral title, no `X-Frame-Options` / `frame-ancestors` on either response, iframe render proof pass at 1440×900 and 390×844 (TEST_RESULTS §13). Previous cycle 7 was an ASAP redeploy on the same commit.

Cycle **6** (2026-10-21T09:15Z–10:3xZ) — **preview retry** on a brand-new Vercel Sandbox from the clean tree `712a552`
(`sbx_C7YcHpK0v9hb018cNsHaEObsAyvi` → `https://sb-4asza5droe1u.vercel.run`, created 09:17:55Z, projected expiry
≈10:47:55Z; `npm ci` 7 s, `vite build` 8.4 s, `check-no-secrets --dist` ✓, 21 env keys by name, key only in the server
process). Health gate `GET /api/health` **200** + `GET /` 200 `<title>OnDemand Intelligence Workstation</title>` at
09:19:13Z. Five-agent swarm (A,B+parity · C,D+empty states · E,F,G+parity+3-way isolation · plugin lifecycle · branding+16
assets): A–G **14 / 14** (pre-fix and post-fix), 91 PASS / 8 DEFECT cells → 4 real defects fixed in source (serverless
banner occluding the mobile composer, deliverable media rendered as plain anchors, PLUGINS dock covered by the open chat,
`/plugins/verify` unknown name → 500) with 13 new unit tests, rebuilt on the same sandbox, 16 / 16 after-fix checks at both
viewports + ui-validator 15/15. Evidence TEST_RESULTS §11, `artifacts/sandbox-verify-2026-10-21/retry-0917/`.

Cycle **7** (2026-10-21T12:28Z–12:37Z) — ASAP redeploy: old preview `sb-4asza5droe1u` expired (410 SANDBOX_STOPPED 12:28:02Z) → new sandbox `sbx_USYsCwFiUaGGciwp11ULdOh9o8HA` → `https://sb-3zg3okfus095.vercel.run` from clean `a16b8d9`; health 200 12:31:17Z; A–G 14/14 + after-fix media 16/16 + plugin lifecycle ready/failed/404/403. Evidence TEST_RESULTS §12.

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
- Cycle 9 hand-over: push + tag + PR update (N-34, needs `GITHUB_TOKEN`); scheduled OnDemand workflow → `/refresh` (N-33).
- (previous) None at checkpoint time. Post-change preview `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8` (https://ondemand-eand-spatial-qrli9v1uy-schoolhack-web-team.vercel.app, commit `d44264f`) READY with 14/14 browser scenarios + 4 ui-validator passes (TEST_RESULTS §8.5). Next cycle starts at NEXT_ACTIONS N-18 (dashboard plugin registration) / N-5b / N-16 / N-21.

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

## 3f. Completed in cycle 6 (evidence TEST_RESULTS §11, artefacts `artifacts/sandbox-verify-2026-10-21/retry-0917/`)
- Fresh sandbox preview health-gated and verified: A–G 14/14 (both viewports, PNG per cell, loader-aware boot wait), streaming/HUD/failure/cancel/retry/isolation/reload parity, 3-way concurrent-user isolation (storage key `ondemand.v2.externalUserId.<workspace>`), plugin lifecycle API 9 probes + badge transitions (VERIFY → VERIFYING… → READY / FAILED inactive_on_account), branding 0 legacy terms + no eye motif, 16/16 brand assets (HTTP 200, sha256 = catalogue, OCR ≤ 3 chars, 0 concentric pairs).
- Defects fixed: `src/serverlessMode.js` banner z-index 2147483000 → 180 and auto-hidden while a chat panel is open (`syncWithChatPanels`, 5 tests); `src/ondemand/miniChat.js` deliverable media (documents side by side, image thumbnails → lightbox, video poster → side pane, PDF iframe preview, **no autoplay** in the transcript; 7 tests); `src/ui/styles/plugin-panel.css` dock relocates beside the open chat; `plugin-lifecycle.js` unknown plugin → 404 `unknown_plugin` (1 test).
- Unit suites after the fixes: src 4,203 (4,202 pass · 0 fail · 1 win32-only skip) · foundation 77 · ondemand 250 · serverless 57 · tools 45 · providers+sources 56 → **4,688 tests · 4,687 pass · 0 fail · 1 skipped** on Node 22; gates green.

## 3e. Completed in cycle 5 (evidence TEST_RESULTS §10, artefacts `artifacts/sandbox-verify-2026-10-21/`)
- Live sandbox `sb-72vtzc1c6cf8` verified end-to-end: A–G 14/14 at 1440×900 + 390×844 (PNG per cell), parity 6/6 groups, plugin lifecycle API 8/8 probes (READY / FAILED `inactive_on_account` / 403 `user_mismatch`) + badge transitions on both viewports, branding 0 legacy terms, 12/12 assets HTTP 200 + sha256 match, 0 eye motifs (OCR + Hough), 3 attached originals byte-identical to the served files.
- Harness fixes (no app change): boot wait on `#loading-screen.hidden` (Scenario A screenshots had captured the loader overlay — before/after kept), self-seeding D/E, `--format png`.
- Legacy residue removed: `OPENAI` Provider-Settings row (`src/keySetupCore.mjs`) + `OPENAI_API_KEY` out of the bundle, `setup-doctor`/`dev-fresh` now report `ONDEMAND_API_KEY`, README/TESTING/SECURITY/CONTRIBUTING/CLOSEOUT rewritten (OD VOICE, OnDemand key), regression test added; `dist/` 0 hits for `api.openai.com|realtime/token|OPENAI_API_KEY`.
- Unit suites: 4,675 tests · 4,674 pass · 0 fail · 1 skipped (win32-only) on Node 22; gates green.
- Successor sandbox `sbx_5nzv1jxgsXOEfEknNB6MTQhA2Xgk` → `https://sb-6p9xpg654ouc.vercel.run` (A–G 14/14 again) after the primary hit its 90-min lifetime (410 at 08:53:29Z).

## 9. Commits on `integration/ondemand-native` (this cycle)
| sha | message | timestamp |
|---|---|---|
| f20fab6 | chore(checkpoint): restore approved deployment dpl_H9yVA3kDuV8ekgs7xzj7AjDPgaSH source tree (branch `baseline/approved-k8v6snzk7`) | 2026-10-23T03:19:15Z |
| 609b4fc | feat(scene-videos): VideoEvidence model with LIVE/RECENT/ARCHIVAL tiering, dedupe and recency+geo+keyword ranking | 2026-10-23T04:23:13Z |
| 1bd8f4d | feat(server): /api/ondemand/v2/scene/videos SSE orchestrator + /scene/media proxy | 2026-10-23T04:23:13Z |
| 1769971 | feat(ui): scene video evidence rail — autoplay-muted queue, archival banner, per-clip badges, map pins, ASK per clip | 2026-10-23T04:23:13Z |
| 1aeba2d | test(build): replace the stale viteBuild X-Frame-Options expectation with an embeddability guard | 2026-10-23T04:23:13Z |
| 6f00211 | test(qa): headless scene-video proof (Umm Suqeim, 1440x900 + 390x844) — 10/10 on sb-5c67af3inbu0 | 2026-10-23T04:23:13Z |
| (cycle-11) | feat(scene-videos): labelling rule v2 + per-plugin call log + verification lane; test(qa) reload hash check; docs TEST_RESULTS §16 | 2026-10-23T04:57Z |
| (cycle-10 docs) | docs(agent-execution): cycle-10 checkpoint — MASTER_STATE, INTEGRATION_MATRIX, TEST_RESULTS §15, BLOCKERS B-25…B-28, NEXT_ACTIONS N-38…N-42 | 2026-10-23T04:3xZ |
| 0dcf469 | fix(deploy): drop X-Frame-Options/frame-ancestors from vercel.json so the document stays iframe-embeddable | 2026-10-22T11:1xZ |
| 7660136 | feat(aoi): editable UAE areas-of-interest config + point-in-polygon membership with OUT_OF_AOI reasons | 2026-10-22 |
| 3be45e8 | feat(incidents): normalized Incident/Scene model — sha1 dedupe, 25 km/6 h clustering, keyframes, 10 category icons | 2026-10-22 |
| 124b5bb | feat(server): /api/ondemand/v2/incidents ingest/list/refresh/locate/aoi on the foundation proxy | 2026-10-22 |
| b95a513 | feat(scenes): restrict the Scene panel + playback to UAE AOIs, incident-scene adapter, pause/resume | 2026-10-22 |
| 325b5cc | feat(composer): bottom 'Type an incident…' composer, incident overlay, popover with ASK ONDEMAND, AOI toggles + legend | 2026-10-22 |
| 1fbb83e | fix(composer): replace geometric glyphs with text labels (icon-glyph boundary gate) | 2026-10-22 |
| 1a82c71 | test(qa): headless proof for AOI incident scenes (checks a–g, two viewports) + same-origin embed harness | 2026-10-22 |
| 97f5b05 | fix(incidents): robust live refresh + composer dedupe reuse (verified on the sandbox) | 2026-10-22T12:58Z |
| (this commit) | docs(agent-execution): cycle-9 checkpoint — TEST_RESULTS §14, INTEGRATION_MATRIX incident rows, NEXT_ACTIONS N-33…N-37, RESUME, artefacts | 2026-10-22T13:05Z |
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
| (cycle 6) | fix(ui): serverless notice never covers the ASK ONDEMAND composer · feat(ask-ondemand): deliverable media (thumbnails + lightbox, video poster + side pane, document previews, no autoplay) · fix(plugins): dock beside the open chat + 404 unknown_plugin · test(qa): retry-0917 swarm artefacts · docs(agent-execution): cycle-6 checkpoint (tag `checkpoint-2026-10-21-preview-retry`) | 2026-10-21T10:3xZ |
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
| Contextual mini chat | **10 / 9 designated object types** (+12 globe types) with starters; empty states + Developer details added; deliverable media (thumbnail/lightbox, poster/side pane, document previews, no autoplay) added in cycle 6; per-turn plugin selection from the PLUGINS panel | miniChat.js, pluginPanel.js |
| Session isolation | 3 / 3 concurrent users × same object → 3 distinct sessions (live row 26, re-run 03:48Z); browser E: same object replays 4 messages, different object isolated (both viewports) | TEST_RESULTS §8 |
| Source traceability | 34 / 34 live rows + 14 / 14 browser scenarios carry timestamps + artefacts; every v2 answer and every voice `answer` event carries `provenance{provider,endpointId,pluginIds,keySource:'server',fetchedAt}` + `citations[]` + `confidenceBasis` | TEST_RESULTS §8 |
| Integration tests (real endpoints) | **34 / 34** live (`npm run ondemand:foundation:live`, 03:46:44Z–03:49:30Z) | artifacts/foundation-live-2026-10-21T03-49Z.json |
| Unit tests | cycle 11: src **4,295 · 4,294 pass · 0 fail · 1 skip** (+ foundation 77 · ondemand 250 · serverless 57 · scene-videos 16 · incidents 15, all pass). Earlier: **4,688 tests · 4,687 pass · 0 fail · 1 skipped** (win32-only DACL test) on Node 22 (cycle 6: src 4,203 · foundation 77 · ondemand 250 · serverless 57 · tools 45 · providers+sources 56; cycle 5 was 4,675); 2 allocation micro-benchmark files skipped (Node-24 calibrated, B-8) | TEST_RESULTS §10.6 |
| UI tests | **14 / 14** scenario×viewport passes on the live sandbox (cycle 6 `sb-4asza5droe1u`, pre-fix AND post-fix, PNG proof per cell; + 16/16 after-fix media/composer/dock checks; cycle 5 14/14 + successor 14/14) and post-change preview (cycle 3; baseline 12 / 14); harness `scripts/qa-chat-intelligent-ui.mjs`; spec `web/tests/chat-intelligent-ui-payloads.spec.ts`; extra parity/plugin/branding rows in `artifacts/sandbox-verify-2026-10-21/results-matrix.json` | artifacts/ui-2026-10-21 |
| Branding replacement | **0** user-facing legacy occurrences (scenario A + ui-validator assert no "God's Eye"/"GEV MIC"/"OpenAI" visible text at both viewports; cycle 5 also removed the OPENAI Provider-Settings row and the OpenAI wording from README/TESTING/SECURITY/CONTRIBUTING/CLOSEOUT/doctor/dev-fresh; 12/12 brand assets 200 + sha256, 0 eye motifs) | brandAssets.test.mjs, scenario A |
| Infrastructure consolidation | OpenAI Realtime provider removed (component 7/38 DONE); voice, plugin lifecycle and tool invoker run in-process — Vercel function count unchanged; redundant AI orchestrators remaining: **0** | INFRASTRUCTURE_DECISIONS.md |
| Deployment | real-project previews via the Vercel REST API: checkpoint `dpl_6MnJQzCAvrgomj7UeG7BcFByNmqx` (02:08Z) and post-change `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8` READY 04:05Z (`/api/ondemand/v2/health` ok, voice/health ok, 14/14 scenarios, `/api/realtime/token` 404); production still Git-linked to the sibling repo (B-6) | TEST_RESULTS §8.4/§8.5 |


### Cycle 12 — 2026-10-23T05:09:41Z (scene-video delta verify)
- Sandbox sbx_IyGvAqmHmnbgZnpfe3HcM5GtBeyy https://sb-3f7jy4mbzqe7.vercel.run still alive: /api/health 200 configured:true keySource:server at 05:13:55Z; no XFO/CSP → no successor needed.
- Live scene/videos: 11 clips (YT 4 · TikTok 6 · IG 1), LIVE 0 · RECENT 0 · ARCHIVAL 11, 0 new vs cycle 11. TikTok scraper quota-blocked, YouTube captions `field key is missing in agent plugin config` (both unchanged).
- Step-3 Instagram MP4 is.gd/AJUOzUE: proxy 206 video/mp4, muted playback readyState 4 at 1440×900 + 390×844, asset 225 d → ARCHIVAL; repost of cycle-11 is.gd/e8p3nB (229 d). Download ratio 3/12 (cycle 11: 6/7).
- No code change; docs only (TEST_RESULTS §17). Verdict: no material change.

GENERATED_UTC: 2026-10-23T05:24:00Z (cycle 12; previous 2026-10-23T04:57:00Z)


## Cycle 13 — AOI query submission repair — 2026-10-24T01:38:42.714629+00:00

Continued `feat/scene-video-evidence` from `ffe6d3505f734335df4d6bfca77094df0b65d4d7` in place. Prior preview returned HTTP 410. Original keyboard/click baseline at both viewports reproduced the cause: questions were ingested as unverified operator incidents instead of being searched; the form controls and original OnDemand coordinate extraction themselves worked.

Implemented shared intent/place extraction, registered-geocoder-first lookup and same-origin `/api/ondemand/v2/incidents/search` through existing research contracts. Queries now expose scope, dated sources and distinct partial/unavailable states; they are not ingested. Publication time remains distinct from incident time. Video queries receive the resolved anchor; existing freshness rules unchanged.

Current preview: https://sb-2nei6kyp3xva.vercel.run (`sbx_gvBKmP4qburZYYp7g3EAD8wBWtxw`, port 5173). Final health/root at 01:28:34Z: HTTP 200, configured true/server key, expected title, no framing headers. Runtime-only OnDemand secret transported and removed; no key in source/dist/evidence.

Final source tests: 4,308 pass / 0 fail / 1 skip of 4,309; two additional Node-24 allocation files not run under Node 22. Server suites: 434 pass / 0 fail. Focused sandbox AOI regressions: 60 pass / 0 fail. Build and source/dist secret gates pass. Full sandbox suite did not produce a final summary within the tool cap; not counted as passed.

Final browser matrix 2026-10-24T01:28:34.721Z–2026-10-24T01:34:38.750Z: 94/96 assertions, 6/8 UI cases pass. All 8 submit, locate Burj Khalifa (25.19703,55.27413), search a 5 km / 72 h scope and show an honest unavailable state. TWO MOBILE FAILURES REMAIN: natural query + button, bare place + Enter; `od-plugin__row` overlaps the input/button for long diagnostic results despite measured-height spacing. Three post-change matrices performed; no fourth repair loop. All final live research coverage blocked (409, 499 or provider-reported unavailable), so no no-incident claim is warranted.

Video smoke: mobile muted MP4 readyState 4 advances 4.577753→5.153424 s; desktop sampled an ended clip and advancing playback is unproven. Observed label checks pass. TikTok primary scraper quota-blocked; fallback observed; YouTube still searching at smoke snapshots. ui_validate.py before/after exited 2 with TimeoutError; real Chromium/Puppeteer proof used.

Detailed deliverables at workspace root: `aoi-query-repair-test-report.md`, `aoi-query-repair-sanitized-evidence.json`, selected `aoi-*.png` proof. No remote push/PR/tag claimed. The next fix should investigate plugin-dock descendant overflow/min-size; do not treat this checkpoint as fully passing.


## Cycle 14 — Dubai Marina scene / clean sidebar — 2026-10-24T02:01:41.592632+00:00

Continued the existing `feat/scene-video-evidence` working tree at `ffe6d3505f734335df4d6bfca77094df0b65d4d7`, preserving all 17 pre-existing modified/untracked source paths in an external pre-edit tar/patch. No rollback or scaffold. Original preview remained live and is being updated in place.

### Geographic scene and gate contract
- `config/aoi/scene-aois.json` is the editable **scene allowlist**, separate from the historical broad external-interest catalog. AOIs carry id/name/group/kind, circle center + radius or bbox, source/license/observed timestamp. UAE, Iran and Oman OSM masks enforce geography; only explicit UAE border planning zones may cross into Oman. The generous fallback bbox `[51.3,22.5,56.65,26.25]` is intersected with UAE geography, never treated as an unrestricted rectangle. These are planning boundaries, not legal boundaries.
- Pure `resolveIncidentGate(text, coords)` fails closed for invalid coordinates or external geography and returns allowed/aoiId/reason/code. Iran, Yemen and Somalia are external context; there is no playable override in the composer. Existing foreign historical scenes are retained in storage/diagnostics, not played.
- Live original `/locate` returned generic Dubai for Dubai Marina. Independent OSM/Nominatim validation resolved **25.0786415, 55.1352524**, relation **11912728**, observed 2026-10-24T01:49:10.669805Z. Generic city substrings no longer suppress more specific geocoding. Registered `geocode_place` remains server-mediated; a verified OSM cache is explicitly labelled if live geocoding is unavailable.
- `GeographicScene` is a versioned JSDoc model with stable id, geographic flag, anchor, AOI, four keyframes/steps, authored timing, separate location confidence/provenance, and no incident evidence claims. The four views are Basin overview, Marina Walk waterfront, Inlet/JBR waterfront, Orbit closure; intermediate points are illustrative camera views, not independently verified POIs.
- Browser storage helper validates and read-back checks named geographic scene saves. The existing SceneDirector performs playback and stores compatible shots. Refreshing optional incident feeds must not remove geographic plans. Reopening saved scenes uses the cached id without a new geocode.

### Prompt, UI and data integrity
Native form Enter and visible submit share one path; generation/AbortController guards prevent stale results. Cancel/Retry are explicit. Geographic-only requests do not ingest fabricated incidents and do not auto-query footage. Scenes/Layers use distinct tabs; secondary authoring and verbose OUT_OF_AOI diagnostics are collapsed. Mobile drawer, plugin descendant clipping, safe-area composer and bounded playback are implemented; browser verification is recorded separately below, not assumed from CSS. AIS is not labelled live merely because a toggle is enabled.

### Live API documentation
Fetched authenticated categories, `createchatsession` and `submitquery` OpenAPI docs (HTTP 200) on this run. Documented session body requires externalUserId and supports pluginIds; query requires query/endpointId/responseMode (sync/stream/webhook) and supports pluginIds/modelConfigs. No undocumented claim about 409 semantics was made. Local deadline/cancellation is distinguished from real upstream HTTP errors; refresh no longer treats normal IncomingMessage close as cancellation.

### Baseline evidence and provider observations
ui-validator first failed with `TimeoutError: timed out`; a minimal CDP socket deadline fix in a temporary helper produced actual `before-1440x900.png` and `before-375x739.png`. Existing scene save selector was absent. Agent15 made one real video request (01:52:21.074–01:54:37.301 UTC): HTTP 200 SSE with explicit done; 10 ARCHIVAL clips (5 YouTube, 3 TikTok, 2 Instagram); TikTok quota/captions configuration failures and two real Perplexity 409s remained visible. Video playback is not claimed until final browser evidence.

20 actual specialist runs were launched in dependency-aware waves (tool cap: 5 simultaneous). Roles, tool task ids, UTC timestamps, owned files, outcomes, integration changes and incomplete capped reviews are included in the final evidence manifest. No credentials are included.


### Cycle 14 final browser/recording evidence — 2026-10-24T02:32:08.800483+00:00

Final live build reference: **marina-20261024-d6b3cceb0593**, same sandbox/URL as baseline. The save-confirmation reentrancy bug and the mobile sticky-header hit-test obstruction discovered during actual UI testing were fixed, not dismissed. Test-harness-only issues (combined Puppeteer Control+A, textContent paragraph-boundary assertion and Chrome viewport-triggered reload) were corrected separately.

- Latest selected real-browser lanes: **50/50 assertions pass**: desktop8, mobile18, equivalent iframe18, cancellation/retry/external4, existing video2. No page errors in selected suites. Real 375×739 touch input, safe hit targets, drawer tabs, playback containment, save/reload and control-driven camera change passed.
- Host chat was inaccessible; the iframe test is the existing same-origin `embed-harness.html`, not proof of the host chat itself.
- Continuous final recording: **16/16 checks pass**, started before typing at2026-10-24T02:29:30.862Z; actual typing began02:29:32.467Z; recording ended02:30:33.190Z. Source viewport375×739; H264 MP4 padded1px right/bottom to376×740,20fps,61.2s,9,716,594bytes. Full local AND published-URL decode passed. No fabricated frames, mocked network or internal-state injection.
- Exact entered request: `Create a waterfront orbit scene around Dubai Marina`. The scene was named/saved `Dubai Marina — Waterfront Orbit` using visible controls. Browser-local persistence survived a real reload and native selection. This is not a multi-user cloud library.
- Live incident query retried through actual services: partial coverage, one factual HTTP409 and a second no-results source. No no-incident conclusion was emitted. Video regression latest9clips, allARCHIVAL (YouTube5/TikTok3/Instagram1). An actual proxied Instagram MP4 played muted at readyState4, currentTime22.357901→22.759926. Counts differ from the earlier10clip API probe; no fixed13–14 count assumed.
- Latest source suite **4435total/4434pass/0fail/1skip**; server451/451pass. Combined4886total/4885pass/0fail/1skip. Two additional Node24 allocation files not run underNode22.
- Source/dist secret gates pass after documentation:1768/2037textfiles scanned. Every published evidence file returnedHTTP200 and matched its local SHA256; videoContent-Type video/mp4.
- Published video: https://sb-2nei6kyp3xva.vercel.run/proof/dubai-marina-waterfront-orbit.mp4
- Published manifest: https://sb-2nei6kyp3xva.vercel.run/proof/dubai-marina-evidence.json

20 actual specialist tasks ran under a five-concurrent-task cap. Eighteen wrote reports; two action-capped read-only tasks did not. Missing start/end timestamps are recorded as null rather than invented. Per-agent task IDs, ownership, partial outcomes and coordinator integration are in the manifest. Existing uncommitted work was preserved; no branch reset, remote push or production deployment was performed.


## Cycle 15 — Exact AOI BUILD SCENE repair — 2026-10-24T02:59:34.798087+00:00

Preserved the existing `feat/scene-video-evidence` tree at `ffe6d3505f734335df4d6bfca77094df0b65d4d7`; 71 pre-existing changed/untracked files were hash-manifested and checkpointed before editing. No recovery archive, reset, scaffold or architecture migration. Twenty actual read-only specialist tasks ran; the integration owner alone edited.

Fresh direct-preview baseline: original URL returned HTTP 410. Unchanged source was rebuilt in `sbx_bx0AMF9m7fhl1rahb8TIlEtxtfw2` at `https://sb-2b4qpbcnpg5o.vercel.run`. Native `Dubai Marina` typing and click/touch/Enter reached `/locate` at both 1440x900 and 375x739, with verified geocode 25.0786415,55.1352524. The form wrongly inherited the general parser `incident_search` default, then called unavailable research instead of building any scene. Explicit geographic generation during running Abu Dhabi playback produced a Marina label/anchor but left the camera over Abu Dhabi; LOAD was rejected while playback owned the camera. The original embedded host was not accessible; no host focus/pointer claim is made.

Minimal repair: parser accepts a caller-specific default, and this BUILD SCENE form uses `build_scene` while preserving explicit incident searches and general parser behavior. Pending requests accept replacement AOIs, coalesce duplicates, bound all asynchronous stages, reject stale responses and restore retry controls on timeouts. Invalid JSON becomes an actionable request error. Scene activation stops and awaits prior playback ownership before applying the new AOI. No new provider calls or credentials in client code.

Focused regression result so far: 73 passed / 0 failed. Final full-suite, build, source/dist secret-gate and deployed-browser results are appended below only after those runs. Evidence log: `aoi-rebuild-evidence.json` in this turn. Browser screenshots and traces carry `aoi-before-*` / `aoi-after-*` labels; recordings are direct compositor streams, not image slideshows.

Cycle 15 target-framing refinement: the real browser exposed that the original geographic adapter put an oblique camera directly above its ground target, leaving the anchor offscreen. `src/scenes/incidentScenes.js` now applies a spherical backward camera offset only for geographic scenes; original target/keyframes, scene IDs, stored scene schema and ordinary incident camera semantics stay intact. The direct-preview DOM/scene assertion now also requires the real rendered ground center, a ready imagery tile covering the target, six real Cesium overlay entities and a visible anchor.

### Cycle 15 final direct-preview verification — 2026-10-24T03:12:18.451926+00:00

- Core native browser suite: **20/20 passed**, 2026-10-24T03:05:56.933Z to 2026-10-24T03:08:42.955Z, at **1440×900 and 375×739**. Each viewport typed exact `Dubai Marina`, submitted by Enter and real BUILD SCENE click/touch, built Abu Dhabi between Marina builds, rebuilt during active playback, injected a separately labelled HTTP503, and recovered through a real `/locate` request. No successful response was mocked and no input value was set through JavaScript.
- Additional clear-map suite: **20/20 passed**, 2026-10-24T03:09:39.266Z to 2026-10-24T03:12:01.386Z. Side panels were collapsed through their own native controls. The actual anchor foreground hit-test was CANVAS at both viewports, and ready rendered imagery tiles covered the real geocode. Final Marina ground centers were approximately 17.7m from 25.0786415,55.1352524. This is ground geometry and actual raster imagery, not just a toast or label.
- Continuous compositor recordings: core 48.6s and clear-map 52.4s, source viewport375×739, encoded376×740 (one-pixel padding for H264). Both full-stream ffmpeg decodes passed. PNGs and Chrome traces are under workspace `.ui-proof/`; all download links, UTC events, source hashes, and twenty actual read-only task IDs are in `aoi-rebuild-evidence.json`.
- Original URL returned410; unchanged source was restored before edits. Native typing itself worked, but BUILD SCENE routed bare locations to research and active playback could retain the old camera. The stock ui-validator final attempt returned `TimeoutError: timed out` after HTTP200 and provided no final screenshots; it is not counted as passing. The independent real Chromium suites provide the proof. Actual embedded-host focus/iframe/pointer behavior and on-device virtual keyboards remain untested.
- Current preview: https://sb-2b4qpbcnpg5o.vercel.run; sandbox sbx_bx0AMF9m7fhl1rahb8TIlEtxtfw2; port5173; buildReference `aoi-rebuild-20261024-2ad171fc8c42`. Health was200 with configured:true/keySource:server. Server temporary key file was removed before start; no credentials are in deliverables.

## Cycle 16 — Embedded AOI BUILD SCENE (chat-canvas) — 2026-10-24T05:47:49Z
- Root cause (measured in a cross-origin sandboxed iframe harness): the AOI box did receive focus, typing, Enter and clicks — nothing intercepted pointer events — but (1) a submission rendered **no visible feedback** until the server's `/locate` round-trip returned (chips only; result area empty), (2) non-place text such as 'hi' was sent to the geocoder/LLM, which returned an arbitrary non-UAE place, so the bar showed "Outside UAE AOI" and the camera jumped elsewhere (Mexico at 375 px) or stayed on Austin, (3) 'Burj Khalifa' had no offline gazetteer entry, so it depended entirely on the live geocoder, (4) platform error bodies `{error:{code,message}}` became "[object Object]". The user's screenshots also came from older builds (serverless banner text removed in b55c938); the stopped sandbox (HTTP 410) explains "nothing happens" for any request made against an expired preview.
- Fixes: local conversational hint (`CONVERSATIONAL_HINT`), trailing-noise stripping ('Dubai Marina r' → 'Dubai Marina'), synchronous pending spinner on every submission, discreet retry notice that resubmits the original text, `onUnresolved` flies to the UAE overview, server skips providers for conversational text, verified Burj Khalifa gazetteer entry (OSM way 446646206), voice/mic failures isolated (no unhandled rejection), decorative overlays forced `pointer-events:none`, desktop gap under the AOI bar, nested error message extraction.
- Preview: https://sb-7gcltu6u15nc.vercel.run (sbx_eTHvnHNQ6FtMjfZDghk8ugPERDjm, port 5173). Stock ui-validator ok at both viewports; frame harness 110/0. The real OnDemand host was NOT available — only the mirrored harness was tested.

## Cycle 17 — Scene evidence pipeline — 2026-10-24T08:05Z
- New: `server/scene-evidence/{sources,pipeline,inference,routes}.js` (mounted at `/api/ondemand/v2/scene/evidence[/sources|/cache]`),
  `src/sceneEvidence/{model,store,panel,index}.js`, `src/ui/styles/scene-evidence.css`, `docs/SOURCES.md`, `scripts/qa-scene-evidence.mjs`.
  Wiring: `src/incidents/ui/index.js` dispatches `gev:scene-evidence` on BUILD SCENE / scoped search / saved-scene reopen (reopen = cache only).
  The legacy `/api/ondemand/v2/scene/videos` endpoint, media proxy and ARCHIVAL rail are unchanged and still reachable via `gev:scene-videos`.
- Sources live today: OnDemand Tavily site-search (YouTube/TikTok/Instagram/X), Google News RSS, official-channel news index, oEmbed
  (YouTube/TikTok/X; Instagram oEmbed answers without a token today but is not relied on). Credentials required: YOUTUBE_API_KEY,
  X_BEARER_TOKEN, IG_GRAPH_ACCESS_TOKEN+IG_BUSINESS_USER_ID, TIKTOK_RESEARCH_CLIENT_KEY+SECRET, RELIEFWEB_APPNAME, optional CEREBRAS_API_KEY.
  Unavailable: OnDemand X Search Agent (credits exhausted), GDELT (rate-limited, usually times out at 10 s).
- Cerebras: inference only. Engine `cerebras-ondemand` (OnDemand endpoint `predefined-cerebras-qwen-3.8-27b`) halves time-to-first-video-card
  (median 7.9 s vs 15.8 s Marina; 4.3 s vs 17.6 s Burj) and full results (16.4 vs 24.5 s; 11.5 vs 20.9 s). `SCENE_EVIDENCE_CEREBRAS=off` → deterministic.
- Gates: unit 4,484 pass / 0 fail / 1 skipped; server scene-evidence 24/0; build ✓; secrets src+dist ✓; boundaries ✓; health 200; no framing headers.
- Browser: cross-origin mirror harness 57/0 (both viewports); stock ui-validator exit 0 at both viewports via the harness page.
- Preview: https://sb-2n7tqzp6l1g2.vercel.run (`sbx_JMh0ppiU1zIEdEo7AgH9EzHuCvwZ`). Sandbox recipe unchanged (temp secret file deleted before start).
- Open: YouTube embed playback blocked by YouTube bot-check on datacenter IPs (unverified on residential); no EXACT geotags until API keys exist.


## Cycle 18 — Strict recording evidence and visible AOI repair — 2026-10-24T10:20:56.699Z

**This section supersedes Cycle 17's live-footage interpretation.** Prior counts and playback demonstrations are historical, not evidence from this run.

- Continuity: existing `mk42-ai/gods-eye-view`, branch `feat/scene-video-evidence`, base `f3093e81a927ed39c32e5788438505aff0cdb5d9` (remote branch checked live). Working tree started clean. Prior previews `sb-7gcltu6u15nc`, `sb-2b4qpbcnpg5o`, `sb-2nei6kyp3xva`, and `sb-2n7tqzp6l1g2` all returned HTTP 410. Existing app, map, timeline, scene library, plugin architecture, deployment server and historical docs retained.
- Visible AOI: Enter/click/touch continue through the existing composer. Greetings return local guidance without network. The production BUILD action also constructs a geographic scene for research wording (e.g. Burj Khalifa incident question), without inventing an incident. Explicit UTC recording-window selector defaults to one hour; 24-hour and historical inputs are separate from the camera plan. Edits, rebuilds, time changes and cancellation invalidate previous generations.
- Evidence contract: `src/sceneEvidence/qualification.js` admits a video only with an authenticated provider-record contract, explicit recording-location geometry/basis, explicit recording-time source/precision, exact selected UTC interval, contained AOI geometry and authorized official embed. `publishedAt`, `recordedAt`, `retrievedAt` are distinct. Unknown remains unknown. Haversine is used for points; area-to-AOI tests use polygon edges and maximum vertex distance, never a place centroid. Broad/uncertain overlap is rejected. No LIVE label is inferred from a publication timestamp.
- OnDemand integration: server configuration now accepts runtime `ON_DEMAND_API_KEY` as an alias of canonical `ONDEMAND_API_KEY`. Six mediated discovery/provider attempts run concurrently (Instagram prioritized in the list, TikTok, YouTube, X); each has an 18-second deadline, overall deadline 24 seconds. Child aborts close source acceptance; late callbacks cannot emit. Session creation also receives the abort signal. Transport events carry request/generation identity, plugin ID, operation, UTC timestamp, endpoint, HTTP code and duration only. Public API docs were fetched live: `pluginIds`, `apikey` header, session id, `answer/status` response. The documented response does NOT expose raw social-source execution records. Therefore its answer text is unverified discovery only, NOT authenticated social metadata.
- Truthful UI: `items` means eligible verified footage; `candidates` means excluded discovery leads. Only eligible items can have Play or map pins. Candidates are in a separately labelled disclosure with reasons; authors are shown only from source metadata. No verified footage was found in this run. All actual playback-time values are unavailable, not zero/success. Camera motion was tested separately and is not video playback.
- Security: removed the legacy social downloader/fixture request graph; `/scene/videos` and `/scene/media` return explicit HTTP 410 with no outgoing request, for all URL/redirect/Range inputs. Official embeds only. No arbitrary returned embed HTML. Player messages require exact origin and the selected iframe's source window. Historical incident seeds are now explicit test injection only; model research answers cannot be promoted/geocoded into the live incident ledger. Added credential-name coverage and non-value-printing secret errors. Framing permits self and OnDemand HTTPS parents, limits child frames to supported official players, with no X-Frame-Options and no `frame-ancestors 'none'`.
- Gates (current): unit suite **4,517 pass / 0 fail / 1 skipped**; two Node-24-only allocation benchmark files additionally skipped on Node 22 (explicit runner warning). Server regression suites **462 pass / 0 fail / 0 skipped**. Targeted post-repair regression **162 pass / 0 fail**, overlapping the full suites. Production build passed locally and in sandbox; source/dist secret gates and module/brand boundary gates passed. Existing large-bundle and Node-engine warnings remain, not build errors.
- Final live browser run **92 pass / 0 fail**, 2026-10-24T10:14:08.721Z → 2026-10-24T10:20:56.699Z, using the existing Puppeteer/Chromium tooling at 1440×900 and 375×739. Every primary build used trusted visible input/Enter or click/touch. Covered greeting, Dubai Marina, same-AOI rebuild, 24-hour control, exact Burj research text, Abu Dhabi, in-flight replacement, external Iran marker, isolated microphone failure and no idle social requests. Eight measured submit-to-first-feedback values were 28.5–51.5 ms. Camera scene motion verified separately. Raw provider HTTP beneath OnDemand, real footage playback, real author popup, real device keyboards and the actual authenticated OnDemand host were NOT verified.
- Built-in `ui_validate.py` was explicitly run twice (normal and viewport-only); both returned exit 2, `TimeoutError: timed out`, after HTTP 200, no screenshots. They are not counted as passes. Initial custom harness had 78 passes and two mis-targeted voice-selector checks; a corrected focused pass was 12/0, then the final full pass was 92/0.
- Public host `https://app.on-demand.io/` returned HTTP 200 but no authenticated host session was supplied. No mirrored harness is represented as a real-host test in this cycle.
- Preview: **https://sb-2q4q1hsrtxg0.vercel.run**, sandbox `sbx_60sLmxqxzlcvmWWSqkEMxHEHpqSS`, port 5173, buildReference `strict-evidence-20261024`. Health and root returned 200, app title `OnDemand Intelligence Workstation`, `configured:true`, `keySource:server`. A transient OnDemand credential file was deleted before server startup; no value is in source, dist, reports, or committed `.env`. Restart/Share needs the platform to reinject the runtime credential; absent it the app runs with truthful unavailable source states.
- Deliverables in workspace root: `gods-eye-view-repair-verification.md`, `gods-eye-view-verification-evidence.json`, `gods-eye-view-repair-demo.mp4` (48-second continuous, real-browser excerpt, not staged playback); full modified source is the platform-generated ZIP. Screenshots: current `strict-*` PNGs at both viewports under `.ui-proof/`. Authoritative per-provider/AOI/window counts and HTTP transport records are in the JSON evidence.


### Cycle 18 final publication addendum — 2026-10-24T10:22:02Z

- Code committed and pushed: `dfa77399534968af545fcf7a0e095a5817d40a21` on `feat/scene-video-evidence`. Existing PR #4 is retained; the PR helper returned HTTP 422 “A pull request already exists for mk42-ai:feat/scene-video-evidence.” No duplicate PR was created; its branch diff was updated by the successful push.
- Runtime identity updated to `buildReference:dfa7739`. Current health/root verification at `2026-10-24T10:22:02.569432+00:00`: HTTP 200, configured true, server key source, correct application title, no X-Frame-Options, restrictive non-none frame-ancestors. Subsequent post-commit browser smoke: 8 passed / 0 failed at 1440×900 and 375×739.
- Final full live browser run: 92/0, `2026-10-24T10:14:08.721Z` → `2026-10-24T10:20:56.699Z`. Its twelve completed AOI/window observations returned 247 unverified candidate occurrences (69 distinct post IDs): Instagram 27, TikTok 70, YouTube 60, X 90. These are mediated-answer URL leads, NOT verified source footage. Eligible videos 0; playback-verified videos 0. Source transport: 72 session-create HTTP 201 responses, 65 query HTTP 200 responses. Ultimate provider HTTP/raw metadata is unavailable from the documented response; no assertion of underlying provider success is made.
- Genuine final browser recording `gods-eye-view-repair-demo.mp4`: 48.000s, 1440×900 H.264, continuous excerpt, full ffmpeg decode passed. No archival clip or fabricated successful video playback.


## Cycle 19 — Snapchat scene footage (plugin-1792945050) — 2026-10-27T01:50Z

- Continuity: workspace on `feat/scene-video-evidence` (PR #4), clean tree at `492d952`; empty checkpoint commit `77b8066` made before any change. Baseline branch `baseline/approved-k8v6snzk7` (`f20fab6`) untouched. Previous preview `sb-2q4q1hsrtxg0` returned HTTP 410 → fresh sandbox. Camera URL-hash code, scene evidence pipeline (13 sources), docs/SOURCES.md history, AOI composer fixes ('hi' guard, pending feedback, gazetteer) and sidebar layout unchanged.
- Parallel read-only subagents: (1) plugin/schema research — live OnDemand docs (chat-api, createchatsession, submitquery, rate-limits, errors) + plugin discovery; (2) security review; (3) test planning. All code edits by the single coordinating agent.
- **Real plugin id discovered (not guessed): `plugin-1792945050`** ("Snapchat video downloader", agent `agent-1792945050`) — the only Snapchat match in three account plugin-search queries. Live self-description: operation `fetchSnapchatVideosByPlace`, inputs `places: string[]`, `limit: integer`. Details: `docs/SNAPCHAT_PLUGIN.md`.
- Backend: `server/scene-footage/{snapchat,routes}.js`, mounted at `/api/scenes` in `server/serverless/app.js` → `POST /api/scenes/:locationId/footage/snapchat` (body `{locationId, lat, lon, placeName, bbox, clientTimeIso}`). Server-only key via a dedicated foundation client (transport retries off; pipeline retries with a fresh session, exponential backoff + jitter on 408/409/425/429/5xx, Retry-After honoured). Agent instruction sent verbatim + structured scene context. Strict zod schemas (plugin response + `FootageClipSchema`, `.strict()`, `isLive` requires `liveConfirmedBy`). Place-name ladder (`config/aoi/footage-places.json`, landmark → neighborhood → district → city, cap `SNAPCHAT_MAX_COVERAGE_LEVEL`, ≤ 2 plugin calls). Media allowlist (`https://*.blob.core.windows.net/*.mp4` with `se`+`sig`), HEAD verification (Content-MD5/ETag → media hash), dedupe (storyId / sourceUrl / hash / SAS-independent blob path), caption sanitization, weak-text-match rejection (`#jbrtvusa` ≠ JBR), plugin per-item `{error}` rows → `plugin_error` (never "empty"), per-IP rate limit, in-flight coalescing, per-location cache with SAS-expiry eviction. Logs/traces never contain the SAS signature or the key.
- Frontend: `src/sceneFootage/{places,controller,panel,index}.js`, `src/ui/styles/scene-footage.css`. Triggers: location open / BUILD SCENE / saved-scene reopen (existing `gev:scene-evidence`), explicit `gev:scene-footage`, map-marker select (incident / scene anchor / evidence pins), camera `moveEnd` into a configured place (≤ 60 km altitude). Generation token + AbortController + locationId check discard stale replies. Refresh: server default 120 s, UI select clamped to the 30 s minimum, paused on `document.hidden`, current clip and its `<video>` src preserved, merge without duplicates. States: loading, empty ("No relevant Snapchat footage found for this area" + searched/capped ladder), plugin error, credentials required, rate limited, timeout, expired link (one automatic re-fetch, then message), unsupported playback (open-original link). Honest times: "published Nd ago (UTC stamp)", "capture time unknown", "retrieved …", "last checked …", "not live"; attribution "author handle not returned".
- Playback mechanism: native `<video muted playsinline autoplay loop controls>` on the storage MP4 (CORS `*`, byte ranges); no proxy (the legacy media proxy stays retired at HTTP 410).
- Gates (final, 2026-10-27T01:5xZ, Node 22.23.3, no key in env): unit **4,531 tests · 4,530 pass · 0 fail · 1 skipped** (baseline 4,517 pass → +13 new `src/sceneFootage/controller.test.mjs`). Server: **footage 26/0** (new `server/scene-footage/snapchat.test.mjs`), scene-evidence+videos 23/0, serverless 57/0, ondemand 250/0, foundation 77/0, incidents 55/0 → **488 pass / 0 fail**. Build ✓ (local + sandbox). `check-no-secrets` src ✓ and `--dist` ✓; literal key value in dist/src/server/api/config/docs/scripts: 0 files. `check:boundaries` ✓. Note: running the ondemand suites with a live key exported in the shell makes 14 'unconfigured' tests fail by design; they pass with the key unset (as in CI).
- Browser (real plugin, cross-origin mirror harness served as `https://canvas.on-demand.io` via request interception so the app's real CSP `frame-ancestors` applies): **77 pass / 0 fail**, 2026-10-27T01:36:55Z → 01:43:05Z, 1440×900 (Marina, Burj, JBR, Corniche, race, forced states) and 375×739 (Marina, Corniche, race, forced states). Key scan: 1,399 browser requests/responses, 0 hits.
- Stock `ui_validate.py`: 375×739 exit 0 (after, harness page, footage panel + composer present in frame); 1440×900 exit 2 `TimeoutError: timed out` twice and one exit 1 run (`chrome=0` collapsed the frame to zero size) — not counted as passes.
- Preview: **https://sb-5nqbbabiczlf.vercel.run**, sandbox `sbx_YKsxkm8145nAnFcN6LKwlb7TK6so`, port 5173, buildReference `snapchat-footage-20261027`; health 200 `configured:true`; no X-Frame-Options; CSP `frame-ancestors 'self' https://on-demand.io https://*.on-demand.io` (not 'none'). Transient key file deleted before start (`SECRET_FILE_GONE`).
- Per-location real-plugin results (1440×900 final run): **Dubai Marina** ok, 1 clip, district, `#dubaimarina` hashtag-match, published 2026-09-09 17:13 UTC, playback readyState 4, currentTime 0.01→2.47 s, muted. **Burj Khalifa** ok, 3 clips, landmark (one 2023 UAE National Day clip — old content), playback 0.04→2.55 s. **Jumeirah Beach Residence** — narrow level returned only `#jbrtvusa` meme clips → rejected as weak text matches; ladder expanded to Dubai Marina and disclosed ("Coverage expanded"), playback 0→2.38 s. **Abu Dhabi Corniche** — plugin "No spotlight videos matching this place name were found."; city level capped by `SNAPCHAT_MAX_COVERAGE_LEVEL=district` → explicit empty state. Refresh tick (UI select 30 s): last-checked 01:37:47Z → 01:38:37Z, same clip, no duplicates (375×739: CHECK NOW 01:38:56Z → 01:42:06Z). The 375×739 Marina and Corniche loads were served from the per-location server cache of the 1440×900 plugin queries (trace `cache_hit`); the refresh tick there issued a fresh plugin query. Expired link (INJECTED 403 on the storage MP4) → one automatic re-fetch, playback resumed; second injected expiry → message, no loop. Race A→B→A→C: 0 mismatches between rendered clip nodes and the active locationId. Forced `plugin_error` / `credentials_required` (INJECTED API responses, labelled) render their states with no video. Displayed publication stamps equal the parsed raw `uploadDateMs`; nothing labelled LIVE.
- Observed plugin instability (real, 2026-10-27T00:4xZ): the plugin intermittently returned `{error:"Request failed with status code 500", storyId}` for every match (Burj, Downtown, Marina) and one session answered HTTP 409; both are now handled (plugin_error state / fresh-session retry). 
- Evidence: `docs/agent-execution/artifacts/snapchat-footage-cycle19/` (QA reports with every stage timestamp and server trace, SAS signatures redacted; sample route response; recording log). Screenshots `before-*` / `after-*` in workspace `.ui-proof/`; recording `snapchat-scene-footage-flow.mp4` (72.1 s, 1440×900 H.264, full decode ✓) in the workspace root.
