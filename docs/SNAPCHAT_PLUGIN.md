# Snapchat footage plugin — `fetchSnapchatVideosByPlace`

Status: integrated 2026-10-26 (cycle 19). Route: `POST /api/scenes/:locationId/footage/snapchat`.
Code: `server/scene-footage/{snapchat,routes}.js`, `src/sceneFootage/{places,controller,panel,index}.js`,
ladder config `config/aoi/footage-places.json`, styles `src/ui/styles/scene-footage.css`.

## 1. Identity (discovered, not guessed)

| field | value | how it was obtained |
|---|---|---|
| plugin name | `Snapchat video downloader` | account plugin search (`public/v1 suggest_plugins`, queries `snapchat`, `fetchSnapchatVideosByPlace`, `snapchat spotlight videos by place`) on 2026-10-26 — the only Snapchat result in all three queries |
| **pluginId** | **`plugin-1792945050`** | same listing |
| agentId | `agent-1792945050` | same listing |
| identifier / type | `rest_api` / `chat` | same listing |
| description (verbatim) | "It can download video from snachat by places name." | same listing |
| operation | `fetchSnapchatVideosByPlace` | self-description returned by a live query through the plugin on 2026-10-26T23:43Z: "Operation: `fetchSnapchatVideosByPlace`; input schema: `places` (array of strings), `limit` (integer)." |

The ID can be overridden with `SNAPCHAT_PLUGIN_ID` (validated `^plugin-\d{6,16}$`); the default is the discovered ID.

## 2. Operation and input schema

```
fetchSnapchatVideosByPlace({ places: string[], limit: integer })
```

* **Explore / hashtag TEXT search by place name.** Results are Spotlight clips whose caption or hashtags mention the place name.
* **Not geotagged Snap Map results.** The plugin's own `note` says so on every response:
  "Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos."
* **No coordinate, radius or bounds input.** A map coordinate must first be translated to place names (section 5).
* Several place names can be sent in one call; each yields one `results[]` row.

## 3. Response shape (raw, observed live)

```json
{
  "limit": 3,
  "note": "Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.",
  "results": [
    {
      "matchType": "clip-text-match",
      "matchedQuery": "Dubai Marina",
      "place": "Dubai Marina",
      "uploaded": 1,
      "videos": [
        {
          "commentCount": 1,
          "description": "#dubaimarina",
          "durationMs": 16100,
          "hashtags": ["#dubaimarina"],
          "shareCount": 0,
          "storageUrl": "https://airevdev.blob.core.windows.net/on-demand-dev/<company>/agents/9EPiwAjlF9.mp4?se=2026-11-02T15%3A21%3A45Z&sig=<redacted>&...&sp=r&sr=b&sv=2025-05-05",
          "storyId": "W7_EDlXWTBiXAEEniNoMPwAAYd3NjcW1pc2toAaCHKa86AaCHKMiyAAAAAQ",
          "uploadDateMs": "September 9, 2026 at 5:13:12 PM",
          "viewCount": null
        }
      ]
    }
  ]
}
```

No-match row: `{ "note": "No spotlight videos matching this place name were found.", "place": "Abu Dhabi Corniche", "uploaded": 0, "videos": [] }`.

Per-item failure row (observed 2026-10-27T00:4xZ for Burj Khalifa, Downtown Dubai and the Dubai Marina clip): `{ "error": "Request failed with status code 500", "storyId": "W7_…" }` — the plugin found the match but failed to download/re-host it. The app treats this as a **plugin error**, never as "no footage" and never as a clip.

| field | meaning / caveat |
|---|---|
| `storageUrl` | MP4 re-hosted on internal Azure Blob storage, read-only SAS URL; `se=` is the expiry (≈7 days after upload). `HEAD` returns `video/mp4`, `Accept-Ranges: bytes`, `Content-MD5`, `ETag`; `Access-Control-Allow-Origin: *`. Without the SAS the account answers `409 Public access is not permitted`. |
| `uploadDateMs` | **A human-readable string, not epoch ms** (e.g. `"September 9, 2026 at 5:13:12 PM"`). Parsed as **UTC**: the public Spotlight page of the Marina story carries JSON-LD `datePublished: 2026-09-09T17:13:12.114Z`, matching the plugin string exactly at UTC. A purely numeric value is also accepted as epoch ms. Unparseable → `publicationTime: null`. |
| `storyId` | Spotlight story id. `https://www.snapchat.com/spotlight/<storyId>` returned HTTP 200 and redirected to the creator's public Spotlight page for that story (checked 2026-10-26), so it is used as `sourceUrl`. |
| `viewCount` | nullable. |
| absent | **author handle, thumbnail, geotag, capture time, live flag.** The app sets `attribution: null`, `thumbnail: null`, `captureTime: null`, `isLive: false` and never enriches them. |

## 4. Transport (OnDemand Chat API, server-side only)

Live docs read 2026-10-26: `https://docs.on-demand.io/docs/chat-api.md`, `/reference/createchatsession.md`, `/reference/submitquery.md`, `/docs/query-and-responses-modes.md`, `/reference/rate-limits.md`, `/reference/errors.md`.

1. `POST https://api.on-demand.io/chat/v1/sessions` — header `apikey: <ONDEMAND_API_KEY>` (server env only), body `{"externalUserId":"gev-scene-footage","pluginIds":["plugin-1792945050"]}` → `201 {data:{id}}`.
2. `POST /chat/v1/sessions/{id}/query` — body
   `{"endpointId":"predefined-openai-gpt4.1-mini","query":"<instruction + scene context + call>","responseMode":"sync","pluginIds":["plugin-1792945050"]}` → `200 {data:{sessionId,messageId,answer,status:"completed",metrics}}`.

The `query` begins with the footage-retrieval agent instruction **verbatim** (constant `AGENT_INSTRUCTION`), followed by a structured JSON scene context (`locationId, lat, lon, placeName, bbox, clientTimeIso`, coverage level, supported/unsupported plugin inputs) and the exact call `fetchSnapchatVideosByPlace {"places":[…],"limit":3}`, asking for the plugin JSON unmodified in a fenced block. The model answer is parsed, then **validated by strict zod schemas** (plugin response → clip). Captions are sanitized (markup, control and bidi characters stripped, 500-char cap) and rendered only through `textContent`; they are data, never instructions.

### Timeouts, retries and rate limits

| item | value |
|---|---|
| documented plugin execution timeout | 150 s (HTTP 504 `plugin_execution_timeout`) |
| documented platform limit | 10,000 req/min per origin IP; free-plan RAG 100 calls/min |
| observed latency | session create 0.4–0.6 s; query 12–42 s (median ≈ 17 s); RAG time 10–27 s |
| app query timeout | `SNAPCHAT_QUERY_TIMEOUT_MS` (default 120 s) |
| app retries | `SNAPCHAT_MAX_ATTEMPTS` (default 3) on 408/409/425/429/5xx/timeout, **fresh session each attempt**, exponential backoff with jitter from `SNAPCHAT_BACKOFF_BASE_MS` (1 s), `Retry-After` honoured, 20 s cap. Transport-level retries in the foundation client are disabled for this client because re-submitting into a busy session returns 409. |
| app rate limit | `SNAPCHAT_RATE_LIMIT_PER_MIN` per client IP (default 12) → 429 + `Retry-After`; identical in-flight requests coalesce |
| app cache | per `locationId` + place + cap, `SNAPCHAT_CACHE_TTL_MS` (default 5 min); entries are evicted early if any SAS link expires within 10 minutes; `fresh:true` bypasses |
| UI refresh | server default `SNAPCHAT_DEFAULT_REFRESH_MS` (120 s), UI control clamped to `SNAPCHAT_MIN_REFRESH_MS` (30 s); pauses while `document.hidden` |

## 5. Place-name ladder

`config/aoi/footage-places.json` (editable) lists places with `level` (landmark → neighborhood → district → city), `names` (all sent together, e.g. `["Jumeirah Beach Residence","JBR"]`), a planning `center`/`radius_km`, and a `parent`. The ladder starts at the place named by the operator (or the narrowest place whose radius contains the coordinate / bbox centre) and follows parents. Levels wider than `SNAPCHAT_MAX_COVERAGE_LEVEL` (default `district`) are reported as `capped` and **never queried**. At most two plugin calls per retrieval: the requested level, then (only if it produced no relevant clip) all remaining allowed levels in one batched call. The response carries `coverageLevel`, `coverageLabel`, `expanded` and the full `ladder` (queried / capped / clip counts); the UI shows a "Coverage expanded" notice whenever a wider level supplied the clips.

## 6. Validated clip schema (`FootageClipSchema`, strict)

`id, sourcePlatform:'snapchat', mediaUrl|embedUrl, thumbnail(null), sourceUrl, attribution(null), matchedPlaceName, coverageLevel, locationEvidence ('geotag'|'place-name-match'|'hashtag-match'|'unknown'), locationEvidenceDetail, captureTime(null), publicationTime, publicationTimeRaw, publicationTimezoneAssumption:'UTC', retrievalTime, isLive(false; true requires liveConfirmedBy), liveConfirmedBy, mediaExpiresAt (from se=), mediaHash (Content-MD5/ETag from a HEAD check), mediaVerified, durationMs, caption, hashtags, storyId, metrics{views,comments,shares}`.

Rejected (with a reason in `rejected[]`, never repaired): schema-invalid items, non-allowlisted media hosts (only `https://<account>.blob.core.windows.net/…mp4?…se=…&sig=…`), already-expired links, rows for places that were not requested, plugin per-item errors, duplicates (storyId, sourceUrl, media hash, SAS-independent blob path), and **weak text matches** — a clip is admitted only when a hashtag equals the place name (`hashtag-match`) or the caption names it as whole words (`place-name-match`). Example: `#jbrtvusa` is returned by the plugin for "JBR" and is rejected.

## 7. Playback mechanism

Native `<video muted playsinline autoplay loop controls>` pointed directly at the storage-hosted MP4. Justification: the plugin already returns a playable H.264 MP4 on storage that serves `Accept-Ranges` and `Access-Control-Allow-Origin: *`; muted inline video autoplays inside the cross-origin chat-canvas iframe without a user gesture; no third-party player or embed script is needed (Snapchat offers no official Spotlight embed for these items); the existing CSP has no `media-src`/`default-src`, so nothing blocks it. The media proxy was **not** used: the legacy `/scene/media` proxy is intentionally retired (HTTP 410) for SSRF reasons and a serverless byte proxy would hit the 60 s function limit and break range requests. The server only issues a `HEAD` per clip to the allowlisted storage host. Expired/forbidden links trigger exactly one re-fetch per clip, then a message with the original link; browsers that cannot play MP4 get an "open original" link.

## 8. Limitations

* Place-name / hashtag text matching only — not geotags; a clip may be filmed anywhere.
* No coordinate or bounds input; coverage depends on the curated ladder names.
* No capture time and no author handle in the plugin output.
* Storage SAS URLs expire (≈7 days); cached responses are evicted before expiry.
* Old content matches (e.g. a Burj Khalifa clip dated 2023 National Day, another dated 16 Nov 2025).
* Promotional or irrelevant matches (restaurant promos for Downtown Dubai; `#jbrtvusa` meme channel for JBR).
* Latency 12–42 s per query; the plugin intermittently fails per item with HTTP 500 and sessions can answer 409 when busy.
* The OnDemand answer is model-mediated: the app validates the JSON it returns but cannot independently audit the raw plugin execution.

## Cycle 20 additions (2026-10-27)
- Key: server-only `server/ondemand/server-key.js`, persistent env (`keySource:"env:persistent"`); no temp file.
- One fresh-session retry when every candidate fails media HEAD verification (model-transcribed `storageUrl` corruption observed live).
- Near-identical re-upload dedupe (normalised caption ≥12 chars + 1 s duration bucket), server and client.
- `plugin-text-match` evidence for untitled clips the plugin itself reported as a `clip-text-match` for the requested place (no caption/hashtags to re-check).
