# Phase C — SSE streaming scene builds (2026-11-01)

_Subagent delivered the server stream module, client reader, typewriter view,
progressive map layer, client method and composer hooks, then was cancelled at
133 min while re-running the large composer suite (it had reached the `index.js`
wiring step). The orchestrator finished the wiring, fixed a timer leak that kept
the Node test runner alive, added the JSON-fallback policy + test, and ran the
local and live smoke tests below._

## Event contract (`server/scene-plans/stream.js` → `POST /api/ondemand/v2/scene-plans/construct/stream`)

| event | data | when |
|---|---|---|
| (open) | `retry: 3000` | immediately; headers `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no` |
| `status` | `{stage: locating\|classifying\|researching\|geometry\|staging\|planning\|finalizing, text}` | each pipeline stage |
| `thinking` | `{note}` | short stage notes (no model chain-of-thought is exposed) |
| `plan` | `{spec, model, latencyMs}` | as soon as the tier-1 Scene Spec resolves (does not wait for the planner) |
| `element_added` | `{layer, feature, properties, geometry}` | one per deterministic staging feature (areas → lines → points → labels) as soon as the engine resolves — before the planner LLM returns |
| `snap_batch_progress` | `{available:false, reason}` | once; Snapchat discovery stays explicit-only |
| `narration_token` | `{token, index, synthetic:true}` | the validated plan's narration/beat text in ~2–6-char chunks, server-paced ≤ 1 event / 8 ms. **Synthetic**: the planner returns one JSON document synchronously, so these are not provider deltas |
| `usage` | `{tokensEstimated, method:'chars/4 estimate', modelId, plannerMs}` | after narration |
| `done` | `{result}` — the full, unchanged `/construct` JSON | last |
| `error` | `{code, message}` | then close |
| `resume_unavailable` | `{}` | `Last-Event-ID` names a request this instance does not hold → client re-submits |

Every event carries `id: <requestId>:<n>` (monotonic), `t` (ISO-8601 UTC) and
`elapsedMs`; a `: heartbeat` comment is written every 15 s. Client abort
(`req 'aborted'` / `res 'close'`) aborts the shared `AbortController` that is
threaded through `specModel`, `resolveLocation`, `engine.stage` and the planner
`transport`, so upstream model calls stop. A per-process ring (20 requests × 10 min)
replays missed events for `Last-Event-ID`; on Vercel this is **best-effort per
warm instance** — a cold instance answers `resume_unavailable` and the client falls
back to the JSON `/construct` route (`shouldFallBackToJsonConstruct`, only for
transport failures: 404/405/non-SSE/resume_unavailable/network; scene errors and
cancellations are never silently re-run). `api/[...route].js` now exports
`config = { supportsResponseStreaming: true }` so Vercel flushes `res.write()`.

## Client

* `src/incidents/client.js` `constructSceneStream(payload, {signal, onEvent, lastEventId})` — fetch + ReadableStream SSE parser (id/event/data/comment lines, multi-line data, `Last-Event-ID` header), resolves with the `done` result.
* `src/incidents/ui/streamClient.js` — standalone reconnecting reader (capped backoff, resume header) with tests.
* `src/incidents/ui/streamView.js` — rAF-paced typewriter: per frame reveals `clamp(backlog/8, 1, 12)` chars (never a whole chunk), `flush()` on done, live chip `model · ~N tok/s (est.) · M.M s` (timer `unref`'d; reset on each `connecting`), skeleton rows, connecting/reconnecting/streaming/complete/error states, stable auto-scroll + "↓ Jump to latest" pill, `aria-live="polite"` summary line only.
* `src/incidents/ui/sceneStreamLayer.js` — progressive Cesium preview (`CustomDataSource 'scene-stream-preview'`) using the staging visual language (outline #0B1220 casing, teal/mint cores, glow routes, dashed cordons, `/scene-icons/png/<icon>.png` billboards); cleared when the final scene is set, on prompt start/cancel and on external context.
* `src/incidents/ui/index.js` `constructWithStream()` — feature flag `window.__gevSceneStream !== false`, event dispatch to view + layer, one resume attempt, JSON fallback, measured `scene.streamTimings = {ttftMs, firstElementMs, planMs, doneMs, tokens, tokensPerSec, elements, transport}` exposed as `data-stream-timings` on `#incident-composer` and `window.__gevLastStreamTimings`.
* `src/incidents/ui/composer.js` — stream view mounted in the result slot while building; large failure banner replaced by a one-line notice + discreet `⟳ Retry · <reason>` pill (same `#incident-composer-retry` element, resubmits the identical snapshot); Cancel aborts the stream; telemetry chip kept after completion.
* `src/ui/styles/composer-stream.css` (imported from `composer-evidence.css`; `style.css` stays a ≤ 42-line import shim as `drawTool.test.mjs` requires).

## Tests (2026-11-01T09:54Z run)

`server/scene-plans/stream.test.mjs` 6, `scene-plans.test.mjs` +1 (`/construct/stream` order status→plan→element_added→narration_token→done), `src/incidents/ui/streamClient.test.mjs` 5, `streamView.test.mjs` 4, `sceneStreamLayer.test.mjs` 1, `src/incidents/client.test.mjs` +2, `src/incidents/streamFallback.test.mjs` 2 — all pass inside the full suites (frontend 4,788 pass / 1 skipped; backend 736 pass).

## Local smoke (dev-server, 2026-11-01T09:48:43Z → 09:50:43Z, "im doing a raid in the dubai marina")

`sse-local-smoke/dubai-marina-stream.txt`: 7 status, 4 thinking, 1 plan (+3.5 s), 261 element_added (first at +107 s — gated by Perplexity location research + Overpass/OSRM), 226 narration_token (first at +118 s), 1 usage, 1 done (+120 s), 8 heartbeats.

## Live smoke (Vercel preview, curl, 2026-11-01T09:57:37Z, "police raid at Burj Al Arab")

plan +2.9 s · first element_added +103 s · first narration_token +116 s · done +118 s; 134 element_added, 284 narration_token. Browser-measured timings per prompt are in `after/qa-fanout-sse.json` (`streamTimings`).

## Limitations (honest)

* `narration_token` events are **synthetic** chunks of the finished plan's text (the OnDemand planner answer is one JSON document); tokens/s is therefore a pacing figure, labelled "est." in the chip.
* First `element_added` is bounded by the slowest upstream (Perplexity research ~60–100 s on the live key); the typewriter starts after the planner. The `plan` event (~3 s) and stage/thinking events are the early feedback.
* Resume is per warm serverless instance; cross-instance resume falls back to a JSON re-submit.
* Vercel function `maxDuration` for `api/*.js` is 300 s (unchanged); a build slower than that would end the stream with an error event and the client falls back.
