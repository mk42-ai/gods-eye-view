# Audit & Implementation Report: Snapchat Provider Fan-Out Ingestion & Tiering (Phase A)

**Date**: 2026-11-01  
**Agent**: Agent 1 (Phase A)  
**Repository**: `gods-eye-view`  
**Status**: Completed and fully verified with unit tests and live before/after probe

---

## 1. Audit of Snapchat Provider Call Sites

Grep audit covering all call sites and references to `fetchSnapchatVideosByPlace`, `plugin-1792945050`, and the scene footage pipeline across `server/` and `src/`:

| File : Line                                  | Component / Call Site        | Target & Parameters                                                                                             | Concurrency & Transport                                                              | Caching & Retries                                                                                                                   | Filter / Strict Boundary Impact                                                                                                                        |
| -------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/scene-footage/snapchat.js:28-29`     | Constants                    | `SNAPCHAT_PLUGIN_ID_DEFAULT = 'plugin-1792945050'`, `SNAPCHAT_OPERATION = 'fetchSnapchatVideosByPlace'`         | N/A (declarations)                                                                   | N/A                                                                                                                                 | N/A                                                                                                                                                    |
| `server/scene-footage/snapchat.js:73`        | `footageConfig()`            | `resultLimit: int(env.SNAPCHAT_RESULT_LIMIT, 25, 1, 50)` (raised default 3→25, cap 10→50)                       | Concurrency: sequential ladder in `snapchat.js`, concurrency pool (4) in `fanout.js` | Cache TTL: `SNAPCHAT_CACHE_TTL_MS` (5m); Retries: `SNAPCHAT_MAX_ATTEMPTS` (3) with jittered backoff `SNAPCHAT_BACKOFF_BASE_MS` (1s) | Strict recording time or radius filters dropped unverified records                                                                                     |
| `server/scene-footage/snapchat.js:744`       | `buildQuery()`               | Places array `places: step.names`, limit `cfg.resultLimit`, plugin `plugin-1792945050`                          | Synchronous OnDemand Chat API                                                        | Retries handle 408, 409, 425, 429, 5xx, timeouts                                                                                    | Generates agent prompt and strict structured context                                                                                                   |
| `server/scene-footage/snapchat.js:780`       | `retrieveSnapchatFootage()`  | Scene object (`locationId`, `placeName`, `lat`, `lon`, `bbox`, `radius`, `timeWindow`, `strictBounds`, `scope`) | Ladder queries narrow place; expands sequentially if `< minClips`                    | Cache checked by caller (`routes.js`)                                                                                               | Rejection in `normalizePluginResponse`: `strictLocation` drops with `verified-location-unknown`; `strictCaptureTime` drops with `capture-time-unknown` |
| `server/scene-footage/routes.js:40`          | `validateFootageRequest()`   | Route body validator: coordinates, radius, bbox, `scope: 'strict'                                               | 'balanced'                                                                           | 'wide'`(default`'balanced'`)                                                                                                        | Fast in-memory validation                                                                                                                              | Coalesces inflight identical requests | Validates boundaries; defaults non-strict requests to balanced  |
| `server/scene-footage/routes.js:240`         | `createSceneFootageRoutes()` | `POST /api/scenes/:locationId/footage/snapchat`                                                                 | Connect-style HTTP route handler                                                     | `createFootageCache` keyed by `locationId\|place\|maxLevel\|radius\|strict\|twKey\|scope`                                           | Emits `counts` and `variants[]` on response                                                                                                            |
| `server/serverless/app.js:240`               | Route Mount                  | Mounts `/api/scenes` router                                                                                     | Serverless HTTP handler                                                              | Express/Connect routing                                                                                                             | Delegates to `routes.js`                                                                                                                               |
| `src/app/tools.js:178`                       | App Wiring                   | References `/api/scenes/:locationId/footage/snapchat`                                                           | Application initialization                                                           | Client-side fetch                                                                                                                   | Standby until user trigger                                                                                                                             |
| `src/sceneFootage/controller.js:16`          | Browser Controller           | `POST /api/scenes/${locationId}/footage/snapchat` with `scope`, `fresh`, `timeWindow`, `radius`                 | AbortController on rapid scene switch                                                | Client refresh timer (min 30s)                                                                                                      | Merges clips by `id`, `sourceUrl`, and media blob path                                                                                                 |
| `src/sceneFootage/index.js:4`                | Application Wiring           | Wire Cesium viewer, custom events `gev:scene-evidence`, `gev:scene-footage`                                     | Event listener                                                                       | Optional polling off by default                                                                                                     | Explicit trigger rule: `Build scene` sets standby; only `Discover Snapchat` searches                                                                   |
| `src/incidents/ui/sceneFootageControls.js:2` | UI Controls                  | `snapchatRequestForScene()`: creates request with `scope: 'balanced'                                            | 'strict'                                                                             | 'wide'`                                                                                                                             | Browser UI dispatch                                                                                                                                    | N/A                                   | Separates explicit discovery from automated evidence collection |

---

## 2. Assumed-vs-Actual Schema Diff & Robustness Fixes

| Field                                     | Prior Assumed Schema (`PluginVideoSchema`)           | Actual Observed Schema (Live Plugin Probe)                                            | Fix Applied & Robustness Guarantee                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadDateMs`                            | Numeric epoch ms (`z.number().int()`)                | Human-readable string e.g. `"September 9, 2026 at 5:13:12 PM"`                        | `parsePublicationTime` parses human strings into UTC ISO string. Enhanced to support 4-letter month `'Sept'`, missing seconds (`5:13 PM`), ISO-8601 strings, and raw epoch numbers/strings. |
| `durationMs`                              | Strict number (`z.number().positive()`)              | May arrive as numeric string e.g. `'16100'`                                           | Coerced using `z.preprocess()` to ensure stringified numbers parse cleanly.                                                                                                                 |
| `viewCount`, `commentCount`, `shareCount` | Integer or null                                      | May arrive as numeric strings or null e.g. `'1'`, `'0'`                               | Coerced using `z.preprocess()`: string numbers convert to nonnegative integers; empty/null becomes `null`.                                                                                  |
| `hashtags`                                | Strict array of strings                              | May arrive as stringified JSON array (`"[\"#tag\"]"`) or comma/space-delimited string | Preprocessor coerces JSON array strings, comma-separated lists, and space-separated tags into `string[]`.                                                                                   |
| Coordinates / Geo                         | Assumed potentially geotagged or coordinates present | Completely absent in plugin output (`lat`/`lon` null; no geotag)                      | Missing geo treated as unknown (never rejected). Provider uncertainty disclosed honestly: `locationEvidence: 'hashtag-match'` or `'place-name-match'`, direct coordinates: false.           |
| `storyId`                                 | `z.string().regex(/^[A-Za-z0-9_-]{8,200}$/)`         | Alphanumeric Spotlight story ID                                                       | Standardized as source identifier; maps to `id: 'snap-' + storyId` and `sourceUrl: 'https://www.snapchat.com/spotlight/' + storyId`.                                                        |
| `storageUrl`                              | Azure Blob SAS URL (`se=...&sig=...`)                | HTTPS SAS URL on Azure Blob storage (`airevdev.blob.core.windows.net`)                | Verified via HEAD check; `redactMediaUrl` removes SAS tokens in logging and evidence exports.                                                                                               |
| `tier`                                    | Unspecified in clip schema                           | Tiering requirement: `'verified'` vs `'candidate'`                                    | Added `tier: z.enum(['verified', 'candidate']).default('candidate')` to `FootageClipSchema`. Plugin results default honestly to `'candidate'` because capture-time and geo are unverified.  |

---

## 3. legacy multi-query transport Verification Outcome

Probed live OnDemand endpoint: `POST https://api.on-demand.iothe removed legacy multi-query transport  
Timestamp: `2026-11-01T07:37:58.214Z`

### Request Excerpt (Redacted):

```http
the removed legacy multi-query transport HTTP/1.1
Host: api.on-demand.io
apikey: [REDACTED_SERVER_KEY]
content-type: application/json

{"items":[{"query":"probe"}]}
```

### Response Excerpt:

```http
HTTP/1.1 405 Method Not Allowed
Content-Type: application/json; charset=utf-8
Date: Sun, 01 Nov 2026 07:37:58 GMT

{"message":"legacy multi-query transport creation is currently unavailable","errorCode":"method_not_allowed"}
```

- **Outcome**: The legacy multi-query transport creation endpoint is unavailable (`HTTP 405 method_not_allowed`). Additional path checks `/chat/v1/sessions/batch`, `/chat/v1/batch`, and `/chat/v1/sessions/query/batch` previously returned `404 Route not found`.
- **Capability Record**: `PROVIDER_CAPABILITIES.legacy multi-query transportApiVerified` updated to `'HTTP 405 method_not_allowed (the removed legacy multi-query transport: legacy multi-query transport creation is currently unavailable)'`.
- **Fallback Implementation**: `server/scene-footage/legacy multi-query transport.js` probes the removed legacy multi-query transport once, records `{ available: false, status: 405, body: "..." }` in response capabilities, and `runFanout` seamlessly executes bounded concurrent direct queries via `concurrency: 4`.

---

## 4. Fan-Out Ingestion & UAE Transliteration Module

Added `server/scene-footage/fanout.js` and `server/scene-footage/fanout.test.mjs`:

- `expandPlaceVariants({ placeName, anchorName, lat, lon, nearbyNames, scope, maxVariants = 15 })`:
  1. Primary names (`placeName`, `anchorName`).
  2. Ladder ancestors from `buildLadder` in `src/sceneFootage/places.js`.
  3. Spelling & apostrophe variants (`kanes` ↔ `kane's`, root facility stripping).
  4. Compact hashtag forms (`'#dubaimarina'` → `'dubaimarina'`).
  5. Static EN→AR transliterations (`UAE_TRANSLITERATIONS` in `src/sceneFootage/places.js`):
     - `Dubai Marina` → `مرسى دبي`
     - `Burj Al Arab` → `برج العرب`
     - `Burj Khalifa` → `برج خليفة`
     - `Downtown Dubai` → `وسط مدينة دبي`
     - `Palm Jumeirah` → `نخلة جميرا`
     - `Abu Dhabi` → `أبوظبي`
     - `Yas Island` → `جزيرة ياس`
     - `Sharjah` → `الشارقة`
     - `Al Zahiyah` → `الزاهية`
     - `JBR` → `جي بي آر`
  6. Caller-supplied nearby POI names.
- `runFanout({ variants, callOne, limit = 25, concurrency = 4, timeoutMs, backoff, signal, onProgress })`:
  - Concurrency pool bounded at `concurrency` (default 4).
  - Jittered exponential backoff for transient 429/409/5xx errors.
  - Per-variant timeout handling.
  - Two-stage deduplication: first by `storyId`, second by SAS-independent storage blob pathname.
  - Truncation detection: sets `truncated: true` on variants returning `raw === limit`.
  - Error isolation: failures on one variant do not fail the batch.

---

## 5. Re-Tiering & Scope Selector Implementation

- **Tiering**:
  - `verified`: Source-backed capture time AND coordinates inside bounds (0 for this provider; never faked).
  - `candidate`: Place/caption match with time/location unverified.
- **Scopes**:
  - `strict`: Strict 1 km + selected UTC recording window. Preserves prior hard-gate behavior; unknown capture-time/location items are rejected.
  - `balanced` (DEFAULT): Candidate clips are retained and playable, labelled with visible "unverified" badges.
  - `wide`: Expands radius to 5 km, window × 3, and includes transliterations and city-level ancestors.
  - Legacy `'place-mentions'` maps cleanly to `'balanced'`.
- **Response Format**:
  - Added `counts: { verified, candidate, raw, unique, variantsTried, truncatedVariants }`.
  - Added `variants[]` per-call performance and truncation statistics.
- **UI Panels & Controls**:
  - `src/incidents/ui/sceneFootageControls.js`: Dropdown with `balanced`, `strict`, `wide` options; defaults to `balanced`.
  - `src/sceneFootage/panel.js`: Displays honest header `"N verified · M unverified candidates · K variants"`.
  - Candidate clips carry visible `.sfp__badge--unverified` badges.

---

## 6. Live Before/After Validation Counts

Ran live probe `scripts/qa-snapchat-fanout.mjs` against OnDemand live API on 2026-11-01 between `07:37:57Z` and `07:40:03Z`.

| Scene                          | Coordinates                 | BEFORE (Single Name, Limit 5) | AFTER (Fan-Out, Limit 25, Concurrency 4) | Delta                                  | Variants Tried                                                                                                                                                                        | Story IDs Found (SAS Redacted)                                                                                                                                                                  |
| ------------------------------ | --------------------------- | ----------------------------- | ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dubai Marina**               | 25.0805, 55.1403            | 1 raw / 1 unique (18.7s)      | 2 raw / 1 unique (22.6s)                 | +1 raw / +0 unique (duplicate deduped) | `Dubai Marina` (1 raw, 1 unique)<br>`dubaimarina` (1 raw, 0 unique - dup)<br>`مرسى دبي` (0 raw)                                                                                       | `W7_EDlXWTBiXAEEniNoMPwAAYd3NjcW1pc2toAaCHKa86AaCHKMiyAAAAAQ` (`#dubaimarina`)                                                                                                                  |
| **Burj Al Arab**               | 25.1412, 55.1853            | 2 raw / 2 unique (21.3s)      | 3 raw / 3 unique (18.8s)                 | **+1 raw / +1 unique**                 | `Burj Al Arab` (2 raw, 2 unique)<br>`burjalarab` (1 raw, 1 unique - new)<br>`برج العرب` (0 raw)                                                                                       | `W7_EDlXWTBiXAEEniNoMPwAAYa3RqaWtxanNqAZp-PivlAZp-PisRAAAAAQ`<br>`W7_EDlXWTBiXAEEniNoMPwAAYa3VqZHZtZHRoAaEOB4lVAaEOB4lCAAAAAw`<br>`W7_EDlXWTBiXAEEniNoMPwAAYcHBqdmJnb3h4AZ2QAP1HAZ2QAP0SAAAAAQ` |
| **kanes boxing gym abu dhabi** | 24.4950, 54.3780 _(approx)_ | 0 raw / 0 unique (12.7s)      | 3 raw / 3 unique (30.9s)                 | **+3 raw / +3 unique**                 | `kanes boxing gym abu dhabi` (0)<br>`kane's boxing gym abu dhabi` (0)<br>`kanes boxing gym` (0)<br>`kane's boxing gym` (0)<br>`kanes` (1 raw, 1 unique)<br>`kane's` (2 raw, 2 unique) | `W7_EDlXWTBiXAEEniNoMPwAAYcWVqcnJzYnN5AZ_eyL6zAZ_ex__5AAAAAQ`<br>`W7_EDlXWTBiXAEEniNoMPwAAYdWFhcHlzeHRtAaGIJG7yAaGIJG3tAAAAAA`<br>`W7_EDlXWTBiXAEEniNoMPwAAYb3FxaGF4d2VoAZ1o4UzjAZ1o3enlAAAAAQ` |

_Evidence artifacts stored in_:

- `docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.json`
- `docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.txt`

---

## 7. Files Changed / Created

### New Files Created:

1. `server/scene-footage/fanout.js`: Place-name variant expansion, bounded concurrency pool, retry backoff, and dedupe logic.
2. `server/scene-footage/fanout.test.mjs`: Unit tests for variant generation, deduplication, truncation detection, error isolation, and concurrency bounds.
3. `server/scene-footage/legacy multi-query transport.js`: legacy multi-query transport (removed 2026-11-02) probe client with direct session fallback.
4. `server/scene-footage/legacy multi-query transport.test.mjs`: Unit tests for legacy multi-query transport probe and status handling.
5. `scripts/qa-snapchat-fanout.mjs`: Live Before/After counter script.
6. `docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.json`: Live probe JSON output with redacted SAS URLs.
7. `docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.txt`: Live probe text summary with redacted SAS URLs.
8. `docs/evidence-2026-11-01-fanout-sse/phase-a/REPORT.md`: This comprehensive audit and verification report.

### Existing Files Modified:

1. `server/scene-footage/snapchat.js`: Result limit default 25 (cap 50), robust `parsePublicationTime` ('Sept', missing seconds, ISO), coerced schema numeric strings & hashtags, `tier: 'candidate'` assignment, updated `PROVIDER_CAPABILITIES`.
2. `server/scene-footage/routes.js`: Scope validation (`strict`, `balanced`, `wide`), scope-aware cache key, `capabilities.legacy multi-query transport`, and `counts`/`variants` response fields.
3. `server/scene-footage/snapchat.test.mjs`: Added tests for robust date parsing, numeric/hashtag coercion, clip tiering, scope validation, and route counts/variants.
4. `src/sceneFootage/places.js`: Added static `UAE_TRANSLITERATIONS` map with `'static-transliteration'` provenance.
5. `src/sceneFootage/controller.js`: Scope support in request bodies, `counts` and `variants` state tracking.
6. `src/sceneFootage/panel.js`: Honest summary format (`'N verified · M unverified candidates · K variants'`), `.sfp__badge` for candidate clips.
7. `src/incidents/ui/sceneFootageControls.js`: Scope selector with `'balanced'` default, `'strict'`, and `'wide'`; legacy `'place-mentions'` mapped to `'balanced'`.
8. `src/incidents/sceneFootageControls.test.mjs`: Unit tests for balanced and wide scope request generation.
9. `src/ui/styles/scene-footage.css`: Badges styling for candidate and verified clips.
10. `docs/SNAPCHAT_PLUGIN.md`: Documented Phase A additions, legacy multi-query transport 405 verification, fan-out, tiering, and scopes.

---

## 8. Test Command Outputs

### Backend Tests (`npm run test:scene-footage`):

```text
TAP version 13
# tests 56
# suites 0
# pass 56
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 250.672367
```

### Frontend Tests (`node --test src/sceneFootage/*.test.mjs src/incidents/sceneFootageControls.test.mjs`):

```text
TAP version 13
# tests 23
# suites 0
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1229.734918
```

### Secret Scan (`node scripts/check-no-secrets.mjs`):

```text
check-no-secrets: scanned 1985 text files under src, public, api, server, scripts, tools, docs, config, build, index.html, package.json, README.md, CHANGELOG.md, SECURITY.md, TESTING.md, DATA_SOURCES.md, .env.example, vercel.json, vite.config.js
✓ no key material in the source tree
```

---

## 9. ISO Timestamps for Each Action

| Action                                                              | UTC Timestamp (ISO-8601)         | Status              |
| ------------------------------------------------------------------- | -------------------------------- | ------------------- |
| Grep audit of call sites and limits                                 | 2026-11-01T07:15:30Z             | Complete            |
| Parsing fixes (`parsePublicationTime`, schemas, `snapchat.js`)      | 2026-11-01T07:22:15Z             | Complete            |
| UAE transliterations added to `places.js`                           | 2026-11-01T07:24:40Z             | Complete            |
| Fan-out module created (`fanout.js` + `fanout.test.mjs`)            | 2026-11-01T07:28:10Z             | Complete            |
| Live legacy multi-query transport probe executed (`the removed legacy multi-query transport)            | 2026-11-01T07:33:05Z             | Complete (HTTP 405) |
| legacy multi-query transport client created (`legacy multi-query transport.js` + test)                  | 2026-11-01T07:35:20Z             | Complete            |
| Tiering & scope routes updates (`routes.js`, controls, panel)       | 2026-11-01T07:36:50Z             | Complete            |
| Live Before/After probe executed (`scripts/qa-snapchat-fanout.mjs`) | 2026-11-01T07:37:57Z – 07:40:03Z | Complete            |
| Code formatting with Prettier & secret validation                   | 2026-11-01T07:41:10Z             | Complete            |
| Documentation and REPORT.md finalized                               | 2026-11-01T07:43:00Z             | Complete            |

---

## 10. Honest Unverified / Blocked List

1. **Unverified Geolocation**: The Snapchat Spotlight plugin (`plugin-1792945050`, `fetchSnapchatVideosByPlace`) returns text-matched Spotlight clips only. It provides **no latitude, no longitude, no geographic bounding box, and no geotags**. All clips are therefore tiered as `'candidate'` and labelled `'unverified'` in the UI.
2. **Unverified Capture Time**: The provider provides only `uploadDateMs` (a human-readable publication time string), not the time the video was recorded. Under strict temporal filters (`strictCaptureTime`), candidate clips cannot prove they were recorded within the incident window and are honestly rejected. Under `balanced` and `wide` scopes, clips are admitted as unverified candidates with uncertainty explicitly disclosed.
3. **legacy multi-query transport Creation Unavailable**: `the removed legacy multi-query transport returns `HTTP 405 Method Not Allowed` with message `"legacy multi-query transport creation is currently unavailable"`. Batch querying is therefore blocked upstream on the platform side; bounded concurrent direct calls (`concurrency: 4`) serve as the verified operational fallback.
4. **Keyword Collision on Short Names**: Short variants like `"kanes"` or `"kane's"` match sports figures (e.g. footballer Harry Kane). Because the plugin performs global text search without spatial constraints, broad place names will match non-local social posts. This uncertainty is honestly tagged as `unverified candidate`.
