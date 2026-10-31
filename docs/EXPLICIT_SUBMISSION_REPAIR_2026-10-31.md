# Gods Eye View — explicit submission and public Snapchat repair

## Source and safety

This is an in-place repair of `mk42-ai/gods-eye-view` on `feat/scene-video-evidence`, starting at `5c56f4d11967ce78098311104224067a3c400ebc`. The exact platform message/build record `6ae4ca0e8901bb29007d402b` was fetched successfully on 2026-10-31 at 04:58 UTC. It identifies original commit `cca89df63c060930e046847931a32503b265acb2`. The supplied source archive matched all 2,362 non-environment project files in the recovered clean tree. No replacement was scaffolded and no dirty work was discarded. Checkpoint `f20fab68c6960a9dc95df494a358eb67237f2d48` remains an ancestor, with parent `b6980325699b4a9aadd6c9153bf00480a61c1308`; the historical approved branch is absent from the restored refs and was not reset or recreated. No SSH was used.

## Root causes and repaired contract

- `b6bbfb2` introduced a 300 ms `editPrompt` timer that called `submitText(input.value)`. It was deliberate previous behavior but is incorrect for this request. Draft events now only edit/invalidate; no timer admits generation.
- Build scene and unmodified Ctrl/Cmd+Enter explicitly admit a request. Enter, Shift/Alt+Enter, repeated keys and composing Enter remain editing actions. A synchronous per-run admission owner prevents overlapping form/keyboard/button duplicates; old `finally` blocks cannot unlock a newer owner.
- Cancel aborts local waits and invalidates identity/revision. It preserves the draft and does not claim upstream provider cancellation. Retry uses a frozen submitted prompt/time snapshot, not a subsequently edited draft. Successful scenes do not erase text.
- A separate location field can seed an empty or previously mirrored composer; it cannot overwrite an independently typed or focused composer.
- Voice AUTO is a reasoning-route selection, not scene auto-submit. Silence/cap stop capture and transcribe only; an explicit Send transcript is required before a command. Passive microphone barge-in is disabled; button barge-in remains. Use transcript as scene draft is an intentional action and cannot overwrite typed text or generate a scene.
- Author button display styles could override native `[hidden]`, exposing the oversized Cancel/Retry controls shown in the supplied screenshot. Scoped hidden handling and a small secondary action row fix that without a visual redesign.

## Snapchat historical finding

`git log -S promptDerivedActive -- src/sceneFootage/index.js` identifies `b6bbfb2` as the disappearance point. Its `onEvidence` closed the controller for every prompt-derived scene and its new `open` guard suppressed marker/camera fallbacks. `panel.js` hides when no controller scene exists. The explicit event/backend survived, but there was no visible entry point in the prompt composer. This was a mounting/context-suppression regression, not evidence that Snapchat was removed by the provider.

A completed scene now creates a visible standby panel with no request. The composer has explicit Snapchat discovery and a clearly labelled matching policy:

1. **Strict**: the selected UTC recording window and a visible 1 km radius. Unknown capture time or coordinates cannot qualify.
2. **Place mentions**: an intentional separate selection, with no claim of recording-time or geographic proximity. Changing the option alone never searches.

Automatic YouTube/TikTok/Instagram scene evidence remains a separate lane. Snapchat is not silently added to that automatic fan-out. Prompt edits/cancel close old footage. Standby and visibility changes cannot trigger discovery; auto-refresh starts off and remains an explicit operator choice.

## Verified integration boundary

The configured plugin remains `plugin-1792945050`, agent `agent-1792945050`, operation `fetchSnapchatVideosByPlace`. Current marketplace discovery returned its name “Snapchat video downloader” and description “It can download video from snachat by places name.” Its previously observed operation accepts `places: string[]` and `limit`; this is a multi-place operation input, **not** proof of a public Chat Batch API or Snap Map access.

The adapter accepts structured source records only, rejects generic model prose, validates each row, deduplicates provider IDs/canonical URLs/media hashes, and distinguishes per-item download errors from empty results. Returned rows, unique source IDs, accepted matches, result sets, actual query submissions, attempts, polls, possible truncation and partial failures are counted separately. A result set is counted only when returned, never before querying.

The configured operation exposes no verified capture timestamp, exact coordinate/radius/bbox filter, history cursor, or pagination contract. Publication is never capture. Query-level granularity is not measured proximity. Strict unknowns are excluded; unverified place matches are only visible after an intentional mode choice. The result-limit flag means additional results may exist, not that exhaustive coverage is known. The adapter has sequential bounded calls/retries, honors Retry-After, uses bounded status polling and a 250-second shared job lifetime. Coalesced callers cannot cancel each other's jobs.

## Live official documentation consulted

Retrieved on 2026-10-31 at 04:58–05:01 UTC:

- https://api.on-demand.io/config/v1/public/docs/categories
- https://api.on-demand.io/config/v1/public/docs/reference/api/createchatsession
- https://api.on-demand.io/config/v1/public/docs/reference/api/submitquery
- https://api.on-demand.io/config/v1/public/docs/reference/api/getchatmessage
- https://docs.on-demand.io/llms.txt
- https://docs.on-demand.io/docs/chat-api.md
- https://docs.on-demand.io/reference/rate-limits.md
- https://docs.on-demand.io/reference/errors.md
- https://docs.on-demand.io/reference/how-to-paginate.md
- https://docs.on-demand.io/docs/query-and-responses-modes.md

The authoritative operation specs document `POST /chat/v1/sessions`, `POST /chat/v1/sessions/{sessionId}/query`, and `GET /chat/v1/sessions/{sessionId}/messages/{messageId}`, authenticated server-side via `apikey`. Session creation returns `data.id`; query output carries `data.status`, `answer`, `messageId`; processing is polled by message identity, never by resubmitting. Supported terminal statuses are completed/failed. `pagination.next` applies to documented session/message listing; the client now follows that exact field. Listing defaults/maxima are 10/50; plugin arrays have a maximum of 20. The reference lists 10,000 requests/minute per origin IP and a 2.5-minute plugin execution timeout; these do not establish Snapchat quotas.

Neither the current categories index nor the official llms index exposed a Chat Batch operation/reference. The installed batch-named skill is `file-batch-processor`, for files, not OnDemand retrieval batches. No usable installed Chat Batch API skill/contract was found. No endpoint, execution/poll schema, page token or Snapchat batch authorization was invented. Guides and generated OpenAPI differ on some required fields; the operation spec takes precedence, so externalUserId and responseMode are always supplied.

## Reproducible validation

Use Node 22 for the deployed build (the deployment command pins it); the repository's two allocation budgets require Node 24 and are explicitly skipped on Node 22. Install the existing lockfile with `PUPPETEER_SKIP_DOWNLOAD=1 npm ci --include=dev`. Zod is now declared directly instead of accidentally relying on Puppeteer's transitive copy.

- `npm test`
- `find server -name '*.test.mjs' -print0 | xargs -0 node --test`
- `npm run check:boundaries`
- `npm run check:secrets`
- `npm run build`
- `npm run check:secrets:dist`

Run mocked suites without inherited real provider keys (unset ON_DEMAND_API_KEY and ONDEMAND_API_KEY). Test fixtures are not live provider success.

`ui-validator` can execute `scripts/qa-explicit-submit-page.js` against the deployment with `--eval "$(cat scripts/qa-explicit-submit-page.js)"`, then assert `window.__gevSubmitAudit.ok` and collect `window.__gevSubmitAudit`. It performs real DOM handler interactions and real application API requests. It is not physical keyboard/IME hardware automation. Run once at 1440×900 and independently at a true 390×844 viewport. The execution report records exact observed results, failures, browser driver qualifications and provider boundaries; this document does not replace those live results.

## Secrets and storage

No platform key is copied into source, .env, screenshot or logs. The existing deployment reports server-only persistent key configuration; rotation of the earlier exposed runtime credential cannot be established from presence-only health metadata. The old exposed value was not recovered or embedded. GitHub publication may still be blocked by authentication. Existing scene storage remains browser-local and origin-specific, not cloud/cross-device. A new preview hostname cannot access the old origin's saved scenes. Existing ElevenLabs billing failure is not considered resolved and no playback claim is made without fresh audio evidence.
