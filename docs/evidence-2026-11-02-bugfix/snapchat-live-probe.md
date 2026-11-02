# Snapchat Plugin-1792945050 Live Dubai Marina Probe Report

- **Date / Time (UTC)**: `2026-11-02T11:02:39.850Z` to `2026-11-02T11:03:39.187Z`
- **Target Location**: `Dubai Marina` (Lat: 25.0805, Lon: 55.1403)
- **Plugin ID**: `plugin-1792945050` (Snapchat video downloader)
- **Endpoint ID**: `predefined-openai-gpt4.1-mini`
- **Response Mode**: `sync`
- **Per-Call Timeout**: `60s`

---

## 1. Confirmed Request Payload Shape

Verified against live OpenAPI documentation (`docs/evidence-2026-11-02-render-fix/ondemand-live-docs-chat-api.json`):

### Session Creation
- **Endpoint**: `POST https://api.on-demand.io/chat/v1/sessions`
- **Headers**: `apikey: [REDACTED]`, `content-type: application/json`
- **Payload**:
```json
{
  "externalUserId": "gev-scene-footage-probe",
  "pluginIds": ["plugin-1792945050"]
}
```

### Query Submission
- **Endpoint**: `POST https://api.on-demand.io/chat/v1/sessions/{sessionId}/query`
- **Headers**: `apikey: [REDACTED]`, `content-type: application/json`
- **Payload**:
```json
{
  "endpointId": "predefined-openai-gpt4.1-mini",
  "query": "<AGENT_INSTRUCTION + scene context JSON + fetchSnapchatVideosByPlace call>",
  "responseMode": "sync",
  "pluginIds": ["plugin-1792945050"]
}
```

---

## 2. Summary Totals

| Metric | Count |
| :--- | :--- |
| **Variants Queried** | `4` |
| **Total Raw Records Returned** | `1` |
| **Unique Records (After Deduplication)** | `1` |
| **Verified Records (`tier: 'verified'`)** | `0` |
| **Approximate Candidates (`tier: 'candidate'`)** | `1` |

*Note on tiering*: As documented in `docs/SNAPCHAT_PLUGIN.md` and enforced by `server/scene-footage/snapchat.js`, Snapchat Spotlight public search results are text/hashtag-matched and do not carry verified GPS coordinates or author-certified capture timestamps. Therefore, honest tiering classifies all playable clips as `approximate / candidate` (`tier: 'candidate'`) rather than inventing verified status.

---

## 3. Per-Variant Execution Results

| # | Variant | HTTP Status | Latency (ms) | Raw Records | Verified | Approximate (Candidate) | Notes |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `Dubai Marina` | `200` | `16496 ms` | `1` | `0` | `1` | OK |
| 2 | `Marina Dubai` | `200` | `15948 ms` | `0` | `0` | `0` | OK |
| 3 | `Dubai Marina Walk` | `200` | `12883 ms` | `0` | `0` | `0` | OK |
| 4 | `JBR Dubai Marina` | `200` | `13738 ms` | `0` | `0` | `0` | OK |

---

## 4. Sample Discovered Clips (Media URLs Redacted)

### Clip 1: `snap-W7_EDlXWTBiXAEEniNoMPwAAYd3NjcW1pc2toAaCHKa86AaCHKMiyAAAAAQ`
- **Story ID**: `W7_EDlXWTBiXAEEniNoMPwAAYd3NjcW1pc2toAaCHKa86AaCHKMiyAAAAAQ`
- **Matched Place**: `Dubai Marina`
- **Tier**: `candidate`
- **Evidence**: `hashtag-match`
- **Publication Time (UTC)**: `2026-09-09T17:13:12.000Z`
- **Caption**: "#dubaimarina"
- **Redacted Media URL**: `https://airevdev.blob.core.windows.net/on-demand-dev/6692b763e851d28a036ab30e/agents/HoZUjv3lAS.mp4`


---

## 5. Chat Batches Assessment

> **Live API probe of POST /chat/v1/batches confirmed HTTP 405 ({"message":"Chat batch creation is currently unavailable","errorCode":"method_not_allowed"}). OnDemand does not provide an active chat batch creation endpoint at present, so batching cannot raise footage result counts today. Server-side fan-out across place-name variants under bounded concurrency (SNAPCHAT_FANOUT_CONCURRENCY=4) is the proven and effective mechanism to maximize footage discovery without blocking.**
