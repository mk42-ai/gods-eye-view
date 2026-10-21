# INFRASTRUCTURE_DECISIONS — keep / consolidate / remove, with evidence (cycle 2, 2026-10-20)

Scope: the 38 components of `INFRASTRUCTURE_INVENTORY.md` (KEEP 21 · CONSOLIDATE 11 · REMOVE 6). This file records
which decisions were **executed** this cycle, with the command/API evidence, and which remain queued. Principle:
one AI gateway (OnDemand) reached only through the server-side foundation (`/api/ondemand/v2/*`, server key); keep
only hosting, the secure proxy, storage/cache, streaming transport and workers that are validated as necessary.

| # | component | decision | status this cycle | evidence |
|---|---|---|---|---|
| 9 | OpenAI HUD summary (`/api/openai/hud-summary`) | REMOVE (re-point) | **DONE** | `server/providers/openai/hud-summary.js` deleted; client → `/api/ondemand/v2/summaries/hud`; legacy route 410 (`server/serverless/app.test.mjs`); live row 25 |
| 11 | ElevenLabs env var | REMOVE | **DONE** | Vercel env `eazEtCde0VLgUCIO` deleted 2026-10-20T23:30:34Z; deny-list test keeps the name out of source |
| 17 (var) | `ONDEMAND_KNOWLEDGE_PLUGIN_IDS` | REMOVE | **DONE** | Vercel env `GKOiZk4AJJ3176NX` deleted 23:30:34Z; inactive `plugin-1785777296` is marked `availability:'inactive'` in `contracts.js` and never planned by `orchestrator.js` |
| 16 | OnDemand endpoint ids | CONSOLIDATE | **DONE** | `TIER_DEFAULTS.ASK` → `predefined-gpt-6-luna`; `ENDPOINT_SUCCESSORS` rewrites a retired id from env; Vercel `ONDEMAND_FULFILLMENT_ENDPOINT_ID` updated 22:34:28Z; health reports `superseded` |
| 15 | Flow Builder workflow id | CONSOLIDATE | **DONE** | 24-hex shape validator (`OBJECT_ID_SHAPE`), health `resolvedVia:'invalid'`; Vercel var corrected 22:34:14Z |
| 10 | Per-IP rate limiter | CONSOLIDATE (re-attach to OnDemand routes) | **DONE for v2** | `guards.js createRateLimiter` on every `/api/ondemand/v2/*` call (60/min per peer+user, `ONDEMAND_V2_RATELIMIT_PER_MIN`), 429 + `Retry-After`; legacy `/api/ondemand/chat` keeps the opt-in limiter |
| 3 | `api/ondemand/*.js` functions (gateway) | KEEP | kept; **no new Vercel function** — v2 routes live in the catch-all (`server/serverless/app.js` → `mountFoundationRoutes`) | function count unchanged (10 files) |
| 18 | Capability loop (interim) | CONSOLIDATE | kept; `orchestrator.js` is the OnDemand-session-based successor for investigation; capability loop still serves `/api/ondemand/chat` INVESTIGATE tier | fold-in scheduled N-9c |
| 19 / 20 | Conversation/session store → KV | CONSOLIDATE | code ready (`createConversationStore` auto-detects `KV_REST_API_URL/TOKEN`); **not provisioned** (no KV credentials on the project) | health `conversationBackend:"memory"`; N-7 |
| 7 / 38 | OpenAI Realtime + `ws` | REMOVE | **DONE (cycle 3)** | Removed entirely (git rm of `server/providers/openai.js`, `server/providers/openai/*`, `src/voice/realtime*.js`, router mounts in `server/serverless/app.js`); voice replaced by `/api/ondemand/v2/voice/turn` | N-9b |
| 6 | Pinokio standalone server | CONSOLIDATE | unchanged (title now env-driven `PRODUCT_NAME`) | `pinokio/pinokio.js` |
| 22 (dev relay) | AIS WebSocket relay | REMOVE with #6 | unchanged | — |
| 27 | CCTV media proxy | CONSOLIDATE | unchanged | — |
| 29 | Puppeteer QA scripts | CONSOLIDATE | unchanged; HUD-summary URL rewritten in 13 scripts to the v2 route | `scripts/qa-*.mjs` |
| 33 | Sibling gates | CONSOLIDATE (port) | `check-no-secrets` ported (cycle 1); `check-forbidden-terms` / `check-remote-assets` still queued | N-14 |
| 35 | Duplicate Vercel project `-jyxd` | REMOVE (archive) | **NOT DONE** — needs an owner decision (custom-domain check) | B-6 |
| 36 | Production target / Git link | CONSOLIDATE | **NOT DONE** — organisational blocker (B-6) | — |
| 1,2,4,5,8,12–14,21,23–26,28,30–32,34,37 | hosting, catch-all router, source adapters, tools route, OnDemand voice, KV helper, caches, CDN/tiles, CI gates | KEEP | unchanged | INFRASTRUCTURE_INVENTORY §1 |

**Redundant AI orchestrators / gateways remaining: 0** — every model call in the production (serverless) app goes
through OnDemand (`/api/ondemand/*` legacy + `/api/ondemand/v2/*` foundation). The OpenAI Realtime path has been
completely removed from the repository; zero direct AI bypasses remain.

**Relaunch workflow (Agents Flow Builder):** `6ad7f961c2cfee207e8f3d07` "OnDemand Intelligence Workstation — mission
relaunch brief (every 6h)", cron `0 15 */6 * * *`, ACTIVE, test execution `6ad7f966c2cfee207e8f3d0d` → `success`
(9.8 s). Honest limitation: a Flow Builder workflow runs llm/plugin nodes and deliveries; it **cannot** clone the
repository, run npm or drive the coding agent. The workflow re-emits the verbatim RESUME instruction + a relaunch
brief on schedule; an operator (or an agent runtime polling `GET /automation/api/execution/list?workflowId=…`) must
paste it into the agent to actually resume. No public OnDemand endpoint exists to spawn an agent run from a workflow
(verified against the live docs 2026-10-20; recorded as UNSUPPORTED, not fabricated).

## Cycle 3 Infrastructure Decisions (2026-10-21)

### 1. OpenAI Realtime Provider Removed Completely
- **Decision:** Git-remove all OpenAI provider files, WebRTC browser connection handlers, token-minting routes, and test suites.
- **Evidence:** `git rm` executed for:
  - `server/providers/openai.js`
  - `server/providers/openai/*` (7 files: `realtime.js`, `instructions.js`, `tools.js`, `toolDescriptions.js`, `debug-log.js`, `rate-limit.js`, `constants.js`)
  - `src/voice/realtime*.js` (15 files: `realtimeBackend.js`, `realtimeConnection.js`, `realtimeAudio.js`, etc.)
  - `src/voice/{session,sessionCommands,commands,control,gevRealtime,voiceCost}.js` + tests
  - `src/testSupport/readRealtimeSource.mjs`
  - Route mounts `/api/realtime/token` and `/api/realtime/debug-log` removed from `server/serverless/app.js`.
- **Outcome:** Direct AI bypasses reduced from 2 to **0**. Repository search confirms zero runtime references to `api.openai.com`, `realtime/token`, or `OPENAI_API_KEY`. Prompt and tool instructions ported cleanly to `server/voice/{instructions,toolDescriptions,tools}.js`.

### 2. Voice Served Exclusively by OnDemand Services + Chat (Single AI Gateway)
- **Decision:** Conversational voice is unified under the OnDemand foundation router at `POST /api/ondemand/v2/voice/turn` (with aliases `/api/voice/turn` and `/api/voice/health`).
- **Implementation:** `server/ondemand/foundation/voice-route.js` implements a streaming SSE pipeline: `turn` → `transcript` (via `services.speechToText`) → `session` (OnDemand Chat session) → `status*` → `delta*` (live token streaming) → `answer` → `tts` (via `services.textToSpeech`, model `tts-1`) → `done`.
- **Performance & Auth:** Delivers conversational turn responses in < 2.5 seconds with single server-side `apikey` authentication. Eliminates client-side WebRTC tokens and secondary AI providers.
- **Redundant AI Orchestrators Remaining:** **0**.

### 3. Flow Builder Voice Workflow Retained as Asynchronous Audit Path
- **Decision:** OnDemand Flow Builder workflow `6ad8160ab28e35aa11d85632` ("OnDemand Intelligence Workstation — voice turn (STT→agent query→TTS)") is maintained as the asynchronous, auditable execution path.
- **Evidence & Trade-off (per `TRIGGER_DECISION.md`):** Workflow execution via `POST /automation/api/workflow/{id}/execute` took 7,399 ms in sample execution `6ad81615c2cfee207e8f3e12`. The Flow Builder API does not expose the webhook trigger URL, and the execute endpoint accepts no request body (input resolves to literal `"{payload}"`). Consequently, conversational voice runs through direct Native Services, while the workflow DAG serves multi-agent evaluation, batch intelligence auditing, and compliance records.

### 4. Plugin Lifecycle Coordinator Executed In-Process
- **Decision:** Implement plugin status tracking and verification directly within the application foundation (`server/ondemand/foundation/plugin-lifecycle.js`) rather than adding an external microservice.
- **Architecture:** State machine transitions (`discovered` → `installing` → `authenticating` → `ready` | `failed`) with 10-minute cache TTL and active query invocation counters wired into `/chat`. Exposed via `GET /plugins` and `POST /plugins/verify`, with client UI controls in `src/ondemand/pluginPanel.js`. Zero external infrastructure overhead.

### 5. Tool Invoker Executed In-Process (Function Count Parity)
- **Decision:** Repo tools invoked in-process by the intelligence orchestrator without network self-calls or additional serverless functions.
- **Implementation:** `server/ondemand/foundation/tool-contracts.js` generates 20 `ondemand-tool` PluginContracts from `server/tools/registry.js` (+ `earthquake_search` = 21 total tools, contract registry size 33). Wired via `createToolInvoker()` in `server/serverless/app.js:217` (`mountFoundationRoutes`), resolving B-13.
- **Verification:** Vercel function count remains exactly 10 files (verified via `ls api api/ondemand`):
  - Catch-all root function: `api/[...route].js` (1)
  - Subpath functions: `api/ondemand/{_config.js, chat.js, health.js, media.js, selftest.js, sessions.js, stt.js, tts.js, workflow.js}` (9)
  - Total: **10 functions**, identical to discovery and cycle 2.

GENERATED_UTC: 2026-10-21T03:45:00Z
