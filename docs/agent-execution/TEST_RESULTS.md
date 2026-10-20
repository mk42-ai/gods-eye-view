# TEST_RESULTS — OnDemand capability verification + foundation validation

Branch `integration/ondemand-native` · repo `mk42-ai/gods-eye-view` · all timestamps UTC · every request carried the server key as the `apikey` header; values are **redacted** (`<redacted>`, `<redacted-id>`, `<redacted-long-token>`). Nothing below is from memory: every row is the output of a real HTTP call made on 2026-10-20.

## 1. Live documentation read (skill: ondemand-api-docs)

`GET https://gateway.on-demand.io/config/v1/public/docs/categories` → 200 at 2026-10-20T21:25:38Z — 7 services / 40 operations; each slug's OpenAPI 3.0 reference fetched at 21:26Z. Services: Media API (3), Services API (3), MQTT User Management (2), Projects Management (6), Agents Flow Builder (19), Chat API (7). **Not present in the live docs**: REST API-key management, reasoning-modes, endpoints registry, plugin registration/listing, workflow log *streaming* — see UNSUPPORTED rows.

## 2. Capability verification table (task 5)

| # | capability | endpoint + method | verified | redacted request | redacted response excerpt | timestamp |
|---|---|---|---|---|---|---|
| 1 | Authentication (apikey header) + Endpoints registry | `GET /config/v1/public/endpoints (gateway)` | YES | `{"headers": {"apikey": "<redacted>"}}` | `{"status": 200, "ms": 410, "count": 92, "sample": [[null, "active"], [null, "inactive"], [null, "inactive"], [null, "inactive"], [null, "inactive"]]}` | 2026-10-20T21:30:10Z |
| 2 | Authentication rejects bad key | `GET /config/v1/public/endpoints (bad apikey)` | YES | `{"headers": {"apikey": "invalid-key-test"}}` | `{"status": 401, "body": "{\"message\":\"Invalid API Key\",\"errorCode\":\"unauthenticated\"}\n"}` | 2026-10-20T21:30:11Z |
| 3 | Endpoint id predefined-gpt-5.6-luna present | `GET /config/v1/public/endpoints` | NO | `{}` | `{"matches": [[null, "inactive", null], [null, "inactive", null], [null, "inactive", null], [null, "inactive", null], [null, "inactive", null], [null, "inactive", null]]}` | 2026-10-20T21:30:11Z |
| 4 | Reasoning modes | `GET /config/v1/public/reasoning_modes (gateway, undocumented in categories)` | YES | `{}` | `{"status": 200, "ms": 540, "count": null, "sample": null}` | 2026-10-20T21:30:11Z |
| 5 | Chat session creation (externalUserId + 11 pluginIds) | `POST /chat/v1/sessions` | NO (400) | `{"externalUserId": "gev-foundation-verify", "pluginIds": ["plugin-1722260873", "plugin-1713924030", "plugin-1741871229", "plugin-1751872652", "plugin-1785777296` | `{"status": 400, "ms": 489, "sessionId": null, "pluginIdsEcho": null, "err": {"message": "One or more agents are inactive or missing configuration: X", "errorCode": "invalid_request", "details": {"inactiveAgentIds": ["agent-1785777296"]}}}` | 2026-10-20T21:30:12Z |
| 6 | List sessions (pagination by externalUserId) | `GET /chat/v1/sessions?externalUserId&limit&cursor` | YES | `{"params": {"externalUserId": "gev-foundation-verify", "limit": 2}}` | `{"status": 200, "ms": 746, "count": 0, "pagination": {"next": "", "limit": 2}}` | 2026-10-20T21:30:13Z |
| 7 | Media fetch (list) | `GET /media/v1/public/file` | YES | `{"params": {"limit": 2}}` | `{"status": 200, "ms": 278, "count": 0}` | 2026-10-20T21:30:13Z |
| 8 | Media create (from URL) | `POST /media/v1/public/file` | NO (500) | `{"url": "https://raw.githubusercontent.com/mk42-ai/gods-eye-view/ondemand-serverless/README.md", "name": "gev-foundation-verify-readme.md", "plugins": [], "resp` | `{"status": 500, "ms": 499, "id": null, "err": {"message": "errors.no.executable.plugin.found", "errorCode": "server_error"}}` | 2026-10-20T21:30:13Z |
| 9 | Media delete | `DELETE /media/v1/public/file/{fileId}` | NOT RUN (no media created) | `{}` | `{}` | 2026-10-20T21:30:13Z |
| 10 | Workflow get by id (ONDEMAND_SPATIAL_WORKFLOW_ID) | `GET /automation/api/workflow/{id}` | NO (404) | `{"id": "6aace534859f9f7b0abb53d99a"}` | `{"status": 404, "ms": 306, "name": null, "isActive": null, "nodes": 0, "trigger": null}` | 2026-10-20T21:30:14Z |
| 11 | Workflow list | `GET /automation/api/workflow/` | YES | `{"limit": 3}` | `{"status": 200, "ms": 282, "keys": ["message", "data", "pagination"], "count": 3}` | 2026-10-20T21:30:14Z |
| 12 | Workflow execute | `POST /automation/api/workflow/{id}/execute` | NO (404) | `{"id": "6aace534859f9f7b0abb53d99a"}` | `{"status": 404, "ms": 248, "executionID": null, "err": {"message": "Resource not found", "errorCode": "not_found"}}` | 2026-10-20T21:30:14Z |
| 13 | REST API key management (list probe) | `<gateway>/config/v1/public/api-keys` | UNSUPPORTED | `{}` | `{"status": 404, "body": "Not Found"}` | 2026-10-20T21:30:15Z |
| 14 | REST API key management (list probe) | `<gateway>/config/v1/public/apikey` | UNSUPPORTED | `{}` | `{"status": 404, "body": "Not Found"}` | 2026-10-20T21:30:15Z |
| 15 | REST API key management (list probe) | `<api>/config/v1/public/api-keys` | UNSUPPORTED | `{}` | `{"status": 404, "body": "Not Found"}` | 2026-10-20T21:30:15Z |
| 16 | REST API key management (list probe) | `<gateway>/config/v1/public/api_key` | UNSUPPORTED | `{}` | `{"status": 404, "body": "Not Found"}` | 2026-10-20T21:30:15Z |
| 17 | Plugin registration/listing (probe) | `<api>/plugin/v1/list` | YES | `{}` | `{"status": 200, "body": "{\"message\": \"Agent fetched successfully\", \"page\": 1, \"limit\": 100, \"data\": {\"total\": 0}}"}` | 2026-10-20T21:30:16Z |
| 18 | Plugin registration/listing (probe) | `<gateway>/plugin/v1/list` | YES | `{}` | `{"status": 200, "body": "{\"message\": \"Agent fetched successfully\", \"page\": 1, \"limit\": 100, \"data\": {\"total\": 0}}"}` | 2026-10-20T21:30:16Z |
| 19 | Plugin registration/listing (probe) | `<api>/plugin/v1/public/plugins` | UNSUPPORTED | `{}` | `{"status": 404, "body": "Not Found"}` | 2026-10-20T21:30:16Z |
| 20 | Plugin registration/listing (probe) | `<gateway>/config/v1/public/plugins` | UNSUPPORTED | `{}` | `{"status": 404, "body": "Not Found"}` | 2026-10-20T21:30:16Z |
| 21 | Chat session creation (externalUserId + 10 pluginIds; plugin-1785777296 X MCP excluded — inactive) | `POST /chat/v1/sessions` | YES | `{"externalUserId": "gev-foundation-verify", "pluginIds": ["plugin-1722260873", "plugin-1713924030", "plugin-1741871229", "plugin-1751872652", "plugin-1716372717` | `{"status": 201, "ms": 708, "sessionId": "<redacted-id>", "pluginIdsEcho": ["plugin-1722260873", "plugin-1713924030", "plugin-1741871229", "plugin-1751872652", "plugin-1716372717", "plugin-1716164040", "plugin-1785987361", "plugin-1784356219", "plugin-174800357` | 2026-10-20T21:31:45Z |
| 22 | Plugin accepted at session creation: plugin-1722260873 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1722260873"]}` | `{"status": 201, "ms": 334, "err": null}` | 2026-10-20T21:31:45Z |
| 23 | Plugin accepted at session creation: plugin-1713924030 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1713924030"]}` | `{"status": 201, "ms": 325, "err": null}` | 2026-10-20T21:31:46Z |
| 24 | Plugin accepted at session creation: plugin-1741871229 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1741871229"]}` | `{"status": 201, "ms": 292, "err": null}` | 2026-10-20T21:31:46Z |
| 25 | Plugin accepted at session creation: plugin-1751872652 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1751872652"]}` | `{"status": 201, "ms": 282, "err": null}` | 2026-10-20T21:31:46Z |
| 26 | Plugin accepted at session creation: plugin-1716372717 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1716372717"]}` | `{"status": 201, "ms": 313, "err": null}` | 2026-10-20T21:31:46Z |
| 27 | Plugin accepted at session creation: plugin-1716164040 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1716164040"]}` | `{"status": 201, "ms": 220, "err": null}` | 2026-10-20T21:31:47Z |
| 28 | Plugin accepted at session creation: plugin-1785987361 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1785987361"]}` | `{"status": 201, "ms": 257, "err": null}` | 2026-10-20T21:31:47Z |
| 29 | Plugin accepted at session creation: plugin-1784356219 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1784356219"]}` | `{"status": 201, "ms": 313, "err": null}` | 2026-10-20T21:31:47Z |
| 30 | Plugin accepted at session creation: plugin-1748003575 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1748003575"]}` | `{"status": 201, "ms": 270, "err": null}` | 2026-10-20T21:31:48Z |
| 31 | Plugin accepted at session creation: plugin-1718116202 | `POST /chat/v1/sessions pluginIds=[one]` | YES | `{"pluginIds": ["plugin-1718116202"]}` | `{"status": 201, "ms": 207, "err": null}` | 2026-10-20T21:31:48Z |
| 32 | Sync query (fulfillmentOnly, predefined-gpt-6-luna — active successor of inactive predefined-gpt-5.6-luna) | `POST /chat/v1/sessions/{id}/query responseMode=sync` | YES | `{"query": "Reply with exactly: FOUNDATION-OK", "endpointId": "predefined-gpt-6-luna", "responseMode": "sync", "fulfillmentOnly": true, "reasoningEffort": "low",` | `{"status": 200, "ms": 2752, "answer": "FOUNDATION-OK", "status_field": "completed", "err": null}` | 2026-10-20T21:31:51Z |
| 33 | Sync query on predefined-gpt-5.6-luna (registry says inactive) | `POST /chat/v1/sessions/{id}/query` | YES | `{"query": "Reply with exactly: LEGACY-OK", "endpointId": "predefined-gpt-5.6-luna", "responseMode": "sync", "fulfillmentOnly": true, "sessionId": "<redacted-id>` | `{"status": 200, "ms": 3401, "body": "{\"message\": \"Chat query submitted successfully\", \"data\": {\"sessionId\": \"<redacted-id>\", \"messageId\": \"<redacted-id>\", \"answer\": \"LEGACY-OK\", \"metrics\": {\"inputTokens\": 999, \"outp` | 2026-10-20T21:31:54Z |
| 34 | Get chat messages | `GET /chat/v1/sessions/{id}/messages` | YES | `{"sessionId": "<redacted-id>"}` | `{"status": 200, "ms": 229, "count": 2, "pagination": {"next": "", "limit": 5}}` | 2026-10-20T21:31:54Z |
| 35 | Get chat session by id | `GET /chat/v1/sessions/{id}` | YES | `{"sessionId": "<redacted-id>"}` | `{"status": 200, "ms": 205, "title": "Foundation Acknowledgment Response", "keys": ["id", "companyId", "externalUserId", "agentIds", "pluginIds", "contextMetadata", "title", "status", "createdBy", "createdAt"]}` | 2026-10-20T21:31:55Z |
| 36 | SSE streaming query | `POST /chat/v1/sessions/{id}/query responseMode=stream` | YES | `{"query": "In one short sentence, what is spatial intelligence?", "endpointId": "predefined-gpt-6-luna", "responseMode": "stream", "fulfillmentOnly": true, "rea` | `{"status": 200, "contentType": "text/event-stream; charset=utf-8", "ttfbMs": 2562, "totalMs": 4793, "lines": 46, "eventTypes": ["heartbeat", "message"], "head": ["event:message", "data:{\"sessionId\": \"<redacted-id>\", \"messageId\": \"6ad7ddcb7bb8` | 2026-10-20T21:31:59Z |
| 37 | Query with agent tool/plugin (Internet web search plugin-1713924030) | `POST /chat/v1/sessions/{id}/query pluginIds=[plugin-1713924030]` | YES | `{"query": "What is one current news headline about Abu Dhabi this week? Cite the source URL.", "endpointId": "predefined-gpt-6-luna", "responseMode": "sync", "p` | `{"status": 200, "ms": 13361, "answer": "**\u201cLargest edition of Global Food Week opens in Abu Dhabi.\u201d** The report says the event was held at ADNEC Centre Abu Dhabi. Source: https://www.eqs-news.com/news/corporate/<redacted-long-token>", "err": null}` | 2026-10-20T21:32:13Z |
| 38 | Query with the 10 session-default plugins | `POST /chat/v1/sessions/{id}/query (session pluginIds)` | NO (400) | `{"query": "Using your research tools, give two sourced facts about Yas Island, Abu Dhabi.", "endpointId": "predefined-gpt-6-luna", "responseMode": "sync", "reas` | `{"status": 400, "ms": 850, "answer": "", "err": {"message": "One or more agents are invalid: agent-1722260873, agent-1713924030, agent-1741871229, agent-1751872652, agent-1716372717, agent-1716164040, agent-1785987361, agent-1784356219, agent-1748003575, agent` | 2026-10-20T21:32:14Z |
| 39 | Media create (from URL, plugins=['plugin-1716472791']) | `POST /media/v1/public/file` | NO (524) | `{"url": "https://raw.githubusercontent.com/mk42-ai/gods-eye-view/ondemand-serverless/README.md", "name": "gev-foundation-verify-readme.md", "plugins": ["plugin-` | `{"status": 524, "ms": 125094, "id": null, "mimeType": null, "err": {"text": "<!DOCTYPE html>\n<!--[if lt IE 7]> <html class=\"no-js ie6 oldie\" lang=\"en-US\"> <![endif]-->\n<!--[if IE 7]>    <html class=\"no-js ie7 oldie\" lang=\"en-US\"> <![endif]-->\n<!--[i` | 2026-10-20T21:34:19Z |
| 40 | Workflow get by id (real id 6aace534859f7b0abb53d99a; Vercel var holds 26-hex typo) | `GET /automation/api/workflow/{id}` | YES | `{"id": "6aace534859f7b0abb53d99a"}` | `{"status": 200, "ms": 386, "name": "OnDemand Spatial Advanced Workflow", "isActive": true, "nodes": 9, "trigger": "webhook"}` | 2026-10-20T21:34:19Z |
| 41 | Workflow execute | `POST /automation/api/workflow/{id}/execute` | YES | `{"id": "6aace534859f7b0abb53d99a"}` | `{"status": 200, "ms": 510, "executionID": "<redacted-id>", "err": null}` | 2026-10-20T21:34:20Z |
| 42 | Workflow execution status (poll) | `GET /automation/api/execution/{executionID}` | YES | `{"executionID": "<redacted-id>"}` | `{"status": 200, "finalStatus": "executing", "polls": 25, "keys": ["id", "workflowID", "trigger", "status", "startedAtInMilliseconds", "endedAtInMilliseconds", "timeTakenInMilliseconds"]}` | 2026-10-20T21:36:07Z |
| 43 | Workflow execution logs (polling; no SSE log endpoint in live docs) | `GET /automation/api/execution/{executionID}/logs` | YES | `{"executionID": "<redacted-id>"}` | `{"status": 200, "ms": 320, "count": 23, "sample": [["", "starting workflow execution"], ["session_context", "all dependencies satisfied, proceeding to task exe"], ["session_context", "triggering next task execution"]]}` | 2026-10-20T21:36:07Z |
| 44 | Workflow node outputs | `GET /automation/api/execution/{executionID}/node/outputs` | YES | `{"executionID": "<redacted-id>"}` | `{"status": 200, "ms": 262, "body": "{\"message\": \"execution node outputs fetched successfully\", \"data\": {\"outputs\": {\"capability_resolver\": {\"id\": \"<redacted-id>\", \"executionID\": \"<redacted-id>\", \"nodeType\": \"llm\", \"` | 2026-10-20T21:36:07Z |
| 45 | Workflow execution list | `GET /automation/api/execution/list?workflowID` | YES | `{"workflowID": "6aace534859f7b0abb53d99a"}` | `{"status": 200, "count": 14}` | 2026-10-20T21:36:08Z |
| 46 | Workflow log STREAMING (probe — not in live docs) | `/automation/api/execution/{executionID}/logs/stream` | UNSUPPORTED | `{}` | `{"status": 404, "ct": "text/plain; charset=utf-8", "body": "Not Found"}` | 2026-10-20T21:36:08Z |
| 47 | Workflow log STREAMING (probe — not in live docs) | `/automation/api/execution/{executionID}/stream` | UNSUPPORTED | `{}` | `{"status": 404, "ct": "text/plain; charset=utf-8", "body": "Not Found"}` | 2026-10-20T21:36:08Z |
| 48 | Workflow log STREAMING (probe — not in live docs) | `/automation/api/execution/{executionID}/logs?stream=true` | PROBE 200 (not SSE) | `{}` | `{"status": 200, "ct": "application/json; charset=utf-8", "body": "{\"message\":\"execution logs fetched successfully\",\"data\":[{\"executionID\":\"<redacted-id>\",\""}` | 2026-10-20T21:36:08Z |

### 2a. Interpretation of the non-YES rows

| row(s) | finding | consequence |
|---|---|---|
| 3 | `predefined-gpt-5.6-luna` is **inactive** in the endpoints registry (92 endpoints, 23 active) — but row 32 shows it still answers a sync query. | Foundation default stays `ONDEMAND_FULFILLMENT_ENDPOINT_ID` → fall back to **`predefined-gpt-6-luna`** (active successor, verified rows 31/35). Recorded as BLOCKERS B-2. |
| 5 | Session creation with all 11 Settings-panel plugins → **400** `One or more agents are inactive or missing configuration: X` (`inactiveAgentIds: ["agent-1785777296"]`). | plugin-1785777296 (X MCP connector) is marked `availability: inactive` in `server/ondemand/foundation/contracts.js`; the other 10 are each accepted (rows 21–30). BLOCKERS B-3. |
| 37 | A query that relies on the **session-level** list of 10 plugins → **400** `One or more agents are invalid: agent-…` (all 10 listed), whereas naming ONE plugin per query (row 36) works. | Foundation passes an explicit, short `pluginIds` per query and defaults `fulfillmentOnly=true` when none are given. Platform behaviour to clarify with OnDemand (BLOCKERS B-3). |
| 8, 38 | `POST /media/v1/public/file` by URL → 500 `errors.no.executable.plugin.found` with `plugins: []`; with the documented ingest plugin `plugin-1716472791` → Cloudflare **524** after 125 s. Media **fetch** (list) works (row 7). | Media create/delete are **implemented in the client** (`media.createFromUrl`, `media.remove`) but could not be verified end-to-end this run → BLOCKERS B-4. Documented, not fabricated. |
| 10, 12 | `GET/POST /automation/api/workflow/6aace534859f9f7b0abb53d99a` → **404**. The Vercel var `ONDEMAND_SPATIAL_WORKFLOW_ID` holds a **26-hex typo**; the real active workflow id is `6aace534859f7b0abb53d99a` (rows 39–44 all YES). | BLOCKERS B-1 (config fix on Vercel). |
| 13–16 | REST API key management: 4 candidate paths → 404; not in the live docs categories. | **UNSUPPORTED** via public API — keys are managed in the dashboard. |
| 17–20 | Plugin listing: `GET /plugin/v1/list` → 200 `{"data":{"total":0}}` (account has no custom agents); `/plugin/v1/public/plugins` and `/config/v1/public/plugins` → 404. Plugin **registration** is not in the live docs (the repo's docs/registration/API_RECHECK_2026-09-19.md reached the same conclusion). | Registration = dashboard paste-back (`src/registry/capabilities.json`). |
| 45–47 | Workflow log **streaming**: `/execution/{id}/logs/stream` and `/execution/{id}/stream` → 404; `?stream=true` is ignored (plain JSON). | **UNSUPPORTED** upstream → the foundation relays a 3 s polling loop as same-origin SSE (`/api/ondemand/v2/workflows/executions/:id/stream`). |
| 42 | Execution polled 25 × 4 s and was still `executing` (23 log lines by then). | Not a failure — the 9-node workflow simply takes > 100 s; `follow()` caps per request at 50 s to respect `maxDuration 60`. |

## 3. Foundation client validation against the real API (task 7) — `npm run ondemand:foundation:live`

Run started 2026-10-20T22:02:00Z, finished 2026-10-20T22:03:30Z — **20 PASS / 0 FAIL**. The script drives `server/ondemand/foundation/{client,conversation-store,proxy-route}.js` with the REAL server key from the environment and NO client key (a bogus `x-ondemand-key` header is sent on one call to prove it is ignored).

| # | test | result | evidence (redacted) | timestamp |
|---|---|---|---|---|
| 1 | client.sessions.create (externalUserId + 1 pluginId) | PASS | `{"ms":395,"pluginIds":["plugin-1713924030"]}` | 2026-10-20T22:02:01Z |
| 2 | client.sessions.list pagination | PASS | `{"count":0,"pagination":{"next":"","limit":2}}` | 2026-10-20T22:02:01Z |
| 3 | client.sessions.get | PASS | `{"keys":["id","companyId","externalUserId","agentIds","pluginIds","contextMetadata","title","status","createdBy","createdAt","updatedAt","liveSettings","isProcessing"]}` | 2026-10-20T22:02:01Z |
| 4 | client.query.sync fulfillmentOnly (predefined-gpt-6-luna) | PASS | `{"ms":2668,"answer":"FOUNDATION-LIVE-OK","status":"completed"}` | 2026-10-20T22:02:04Z |
| 5 | client.query.stream SSE parse (deltas, metricsLog, heartbeat, [DONE]) | PASS | `{"ttfbMs":2246,"totalMs":5134,"events":47,"distinct":["thinking","message","heartbeat","done"],"text":"A spatial intelligence workstation is a computing environment that combines spat"}` | 2026-10-20T22:02:09Z |
| 6 | client.query.stream abort propagation (caller abort stops upstream read) | PASS | `{"eventsBeforeAbort":3,"abortedError":true}` | 2026-10-20T22:02:11Z |
| 7 | client.query.sync with plugin-1713924030 (Internet web search) | PASS | `{"ms":19401,"answer":"I don’t have an Abu Dhabi-specific current headline in the available results; the Reuters Middle East headlines are here: https://www.reuters.com/world/middle-e"}` | 2026-10-20T22:02:31Z |
| 8 | client: inactive plugin-1785777296 → OnDemandHttpError 400 (not retried) | PASS | `{"status":400,"message":"One or more agents are inactive or missing configuration: X"}` | 2026-10-20T22:02:31Z |
| 9 | client.workflows.get (ONDEMAND_SPATIAL_WORKFLOW_ID real id) | PASS | `{"name":"OnDemand Spatial Advanced Workflow","isActive":true,"nodes":9,"trigger":"webhook"}` | 2026-10-20T22:02:31Z |
| 10 | client.workflows.execute + follow (status + logs polling) | PASS | `{"status":"executing","terminal":false,"logLines":14}` | 2026-10-20T22:03:17Z |
| 11 | route GET /api/ondemand/v2/health | PASS | `{"ok":true,"configured":true,"conversationBackend":"memory","contracts":13,"activePlugins":10,"defaultEndpointId":"predefined-gpt-5.6-luna","keySource":"server"}` | 2026-10-20T22:03:17Z |
| 12 | route GET /api/ondemand/v2/contracts | PASS | `{"contracts":13}` | 2026-10-20T22:03:17Z |
| 13 | route POST /chat sync — object-context grounded, client key header ignored | PASS | `{"ms":3467,"status":200,"reused":false,"objectContextKey":"aircraft:live-A6-EVN","answer":"You’re looking at aircraft **EK203 (test object)**, at an altitude of **10,668**; the altitude unit isn’t specified."}` | 2026-10-20T22:03:20Z |
| 14 | route POST /chat sync — second turn reuses the SAME session (isolation key user+object) | PASS | `{"reused":true,"sameSession":true}` | 2026-10-20T22:03:22Z |
| 15 | route POST /chat sync — different externalUserId gets a DIFFERENT session | PASS | `{"different":true}` | 2026-10-20T22:03:25Z |
| 16 | route POST /chat stream — SSE relay (session preamble, message events, done) | PASS | `{"ms":4385,"bytes":981,"head":"event: session\ndata: {\"sessionId\":\"<redacted-id>\",\"objectContextKey\":\"camera:live-cam-1\",\"reused\":false,\"endpointId\":\"predefined-gpt-6-luna\"}\n\nevent:"}` | 2026-10-20T22:03:29Z |
| 17 | route GET /messages (history via conversation key) | PASS | `{"count":2}` | 2026-10-20T22:03:29Z |
| 18 | route GET /conversations (per-user listing) | PASS | `{"conversations":2}` | 2026-10-20T22:03:29Z |
| 19 | route DELETE /conversations (close mapping) | PASS | `{"closed":true}` | 2026-10-20T22:03:29Z |
| 20 | route POST /workflows/execute | PASS | `{"status":202,"streamPath":"/api/ondemand/v2/workflows/executions/<id>/stream"}` | 2026-10-20T22:03:30Z |

## 4. Repository gates run on the integration branch (2026-10-20)

| gate | command | result |
|---|---|---|
| boundaries + brand marks | `npm run check:boundaries` | ✓ (exit 0; 2 brand-mark files) |
| OnDemand proxy unit tests | `npm run test:ondemand` | ✓ 243 / 243 (key-override suite now runs with `ONDEMAND_ALLOW_CLIENT_KEY=1`) |
| serverless router tests | `npm run test:serverless` | ✓ 58 / 58 |
| foundation unit tests (new) | `npm run test:foundation` | ✓ 25 / 25 (mocked fetch: retries/429/timeout/abort/SSE parse/contract registry/conversation isolation/route) |
| deny-list (ELEVENLABS / KNOWLEDGE_PLUGIN_IDS never read) | `node --test server/ondemand/deny-list.test.mjs` | ✓ 5 / 5 |
| no key in bundle | `node --test src/ondemand/noKeyInBundle.test.mjs` | ✓ 2 / 2 |
| secrets gate (new, ported from ondemand-eand-spatial) | `npm run check:secrets` and `node scripts/check-no-secrets.mjs --dist` | ✓ 1,528 source files + dist clean |
| format | `npm run format:check` | ✓ 974 files |
| production build | `npm run build` | ✓ `vite build` 5.5 s, `dist/` emitted (chunk-size warning pre-existing) |
| full unit suite | `npm test` | not run this cycle (4,352 tests, calibrated for Node 24; container is Node 22 — allocation-budget tests require Node 24, see TESTING.md). Run in the next cycle on Node 24. |
| typecheck / lint | — | **do not exist in this repo** (no tsconfig, no eslint) — recorded in ARCHITECTURE_INVENTORY §1 and NEXT_ACTIONS. |

## 5. Not verified / out of scope this cycle
- Media create + delete end-to-end (upstream 500/524, see §2a).
- Workflow terminal state within one request window (workflow runs > 100 s).
- UI tests in a real browser for the new `/api/ondemand/v2` route (no UI consumes it yet — Phase C).

## 6. Ephemeral preview deployment of the integration branch (Vercel Sandbox, 2026-10-20T22:10:36Z)

Working tree at `9067843` copied into a Vercel Sandbox (node22), `npm ci` + `npm run build` (vite, 11 s, `dist/index.html` emitted), served by `server/serverless/dev-server.mjs` on 0.0.0.0:5173 with `ONDEMAND_API_KEY` injected only into the process environment (never written to disk).

| probe | result | evidence (redacted) |
|---|---|---|
| `GET /` | 200 | SPA shell served from `dist/` |
| `GET /api/ondemand/v2/health` | 200 | `{"ok":true,"configured":true,"conversationBackend":"memory","contracts":13,"activePlugins":10,"defaultEndpointId":"predefined-gpt-6-luna","keySource":"server"}` |
| `GET /api/ondemand/v2/contracts` | 200 | 13 contracts (10 active plugins, 1 inactive, 1 tool, 1 workflow) |
| `POST /api/ondemand/v2/chat` sync with `objectContext` and a bogus `x-ondemand-key` header | 200, `x-ondemand-key-source: server` | answer "The object in your context is "Preview object at Yas Island."", `objectContextKey: demo:1`, `reused:false`, metrics totalTimeSec 2.41 |

Preview URL and sandbox id are recorded in the run report (ephemeral, 90 min). This is NOT the real Vercel project (`ondemand-eand-spatial`); see NEXT_ACTIONS N-13.


## 7. Cycle 2 (2026-10-20T22:20Z–23:35Z) — Phase C/D/E/F/G validation

### 7.1 Live validation against the real OnDemand API — `npm run ondemand:foundation:live` (26/26 PASS, artefact `artifacts/foundation-live-2026-10-20T23-07Z.json`)

| # | test | result | evidence (redacted) | timestamp |
|---|---|---|---|---|
| 1 | client.sessions.create (externalUserId + 1 pluginId) | PASS | `{"ms":321,"pluginIds":["plugin-1713924030"]}` | 2026-10-20T23:07:37Z |
| 2 | client.sessions.list pagination | PASS | `{"count":2,"pagination":{"next":"6ad7e5257bb80aa7c2d976a5","limit":2}}` | 2026-10-20T23:07:38Z |
| 3 | client.sessions.get | PASS | `{"keys":["id","companyId","externalUserId","agentIds","pluginIds","contextMetadata","title","status","createdBy","createdAt","updatedAt","liveSettings","isProcessing"]}` | 2026-10-20T23:07:38Z |
| 4 | client.query.sync fulfillmentOnly (predefined-gpt-6-luna) | PASS | `{"ms":1797,"answer":"FOUNDATION-LIVE-OK","status":"completed"}` | 2026-10-20T23:07:40Z |
| 5 | client.query.stream SSE parse (deltas, metricsLog, heartbeat, [DONE]) | PASS | `{"ttfbMs":2733,"totalMs":5588,"events":41,"distinct":["thinking","heartbeat","message","done"],"text":"A spatial intelligence workstation is a computer system designed to analyze, vis"}` | 2026-10-20T23:07:45Z |
| 6 | client.query.stream abort propagation (caller abort stops upstream read) | PASS | `{"eventsBeforeAbort":3,"abortedError":true}` | 2026-10-20T23:07:48Z |
| 7 | client.query.sync with plugin-1713924030 (Internet web search) | PASS | `{"ms":13073,"answer":"“Why Abu Dhabi Police are confiscating e-scooters” — Gulf News: https://gulfnews.com/"}` | 2026-10-20T23:08:01Z |
| 8 | client: inactive plugin-1785777296 → OnDemandHttpError 400 (not retried) | PASS | `{"status":400,"message":"One or more agents are inactive or missing configuration: X"}` | 2026-10-20T23:08:02Z |
| 9 | client.workflows.get (ONDEMAND_SPATIAL_WORKFLOW_ID real id) | PASS | `{"name":"OnDemand Spatial Advanced Workflow","isActive":true,"nodes":9,"trigger":"webhook"}` | 2026-10-20T23:08:02Z |
| 10 | client.workflows.execute + follow (status + logs polling) | PASS | `{"status":"executing","terminal":false,"logLines":14}` | 2026-10-20T23:08:50Z |
| 11 | route GET /api/ondemand/v2/health | PASS | `{"ok":true,"configured":true,"conversationBackend":"memory","contracts":13,"activePlugins":10,"defaultEndpointId":"predefined-gpt-6-luna","workflowId":{"configured":true,"source":"default","valid":true},"guards":{"rateLi` | 2026-10-20T23:08:50Z |
| 12 | route GET /api/ondemand/v2/contracts | PASS | `{"contracts":13}` | 2026-10-20T23:08:50Z |
| 13 | route POST /chat sync — object-context grounded, client key header ignored | PASS | `{"ms":3753,"status":200,"reused":false,"objectContextKey":"aircraft:live-A6-EVN","answer":"You’re looking at **EK203 (test object)**, an aircraft. Its altitude is **10,668**; the units aren’t specified in the provided da` | 2026-10-20T23:08:53Z |
| 14 | route POST /chat sync — second turn reuses the SAME session (isolation key user+object) | PASS | `{"reused":true,"sameSession":true}` | 2026-10-20T23:08:57Z |
| 15 | route POST /chat sync — different externalUserId gets a DIFFERENT session | PASS | `{"different":true}` | 2026-10-20T23:09:00Z |
| 16 | route POST /chat stream — SSE relay (session preamble, message events, done) | PASS | `{"ms":3819,"bytes":1292,"head":"event: session\ndata: {\"sessionId\":\"6ad7f48cf922b50dc6673296\",\"objectContextKey\":\"camera:live-cam-1\",\"reused\":false,\"endpointId\":\"predefined-gpt-6-luna\",\"pluginI"}` | 2026-10-20T23:09:04Z |
| 17 | route GET /messages (history via conversation key) | PASS | `{"count":2}` | 2026-10-20T23:09:04Z |
| 18 | route GET /conversations (per-user listing) | PASS | `{"conversations":2}` | 2026-10-20T23:09:04Z |
| 19 | route DELETE /conversations (close mapping) | PASS | `{"closed":true}` | 2026-10-20T23:09:04Z |
| 20 | route POST /workflows/execute | PASS | `{"status":202,"streamPath":"/api/ondemand/v2/workflows/executions/<id>/stream"}` | 2026-10-20T23:09:04Z |
| 21 | route POST /chat sync with objectContext → provenance.keySource=server, confidenceBasis present | PASS | `{"ms":3090,"status":200,"basis":"inferred","answerChars":116,"injectionFlags":[]}` | 2026-10-20T23:09:07Z |
| 22 | route POST /chat with mismatching X-Workstation-User → 403 user_mismatch | PASS | `{"error":"user_mismatch"}` | 2026-10-20T23:09:07Z |
| 23 | route POST /summaries/hud → five-word summary from the fulfilment endpoint | PASS | `{"ms":3384,"status":200,"summary":"Al Maryah Island Live Flights","error":null}` | 2026-10-20T23:09:11Z |
| 24 | isolation: 3 concurrent users × same object → 3 distinct sessions, answers not crossed, same user reuses | PASS | `{"ms":5157,"distinctSessions":3,"answers":["ISO-A","ISO-B","ISO-C"]}` | 2026-10-20T23:09:16Z |
| 25 | route POST /investigate → plan + sources + objects + synthesis (live plugin retrieval) | PASS | `{"ms":40668,"status":200,"plan":[{"name":"perplexity_research","pluginId":"plugin-1722260873"}],"sources":["perplexity_research:ok"],"counts":{"objects":1,"confirmed":0,"inferred":1,"unverified":0},"citations":[],"synthe` | 2026-10-20T23:09:57Z |
| 26 | route POST /chat stream → session, deltas, provenance, done (in order) | PASS | `{"ms":3864,"bytes":1470,"events":["session","message","heartbeat","provenance","done"]}` | 2026-10-20T23:10:00Z |

Rows 21–26 are new this cycle (Phase C/D/E/G): object-context sync chat with provenance, 403 on a mismatching
`X-Workstation-User`, HUD summary on OnDemand (replaces the OpenAI bypass), **3 concurrent users × same object → 3
distinct sessions with answers not crossed and same-user reuse**, a live `/investigate` (Perplexity plugin retrieval
+ synthesis), and the stream relay emitting `session → message → provenance → done` in order.

### 7.2 Repository gates (all exit 0, 2026-10-20T23:05Z–23:12Z)

| gate | command | result |
|---|---|---|
| boundaries (import directions + package ownership + brand marks) | `npm run check:boundaries` | PASS (775 modules; `scripts/package-boundaries.json` extended for `src/brand`, `server/brand`, `build/product-name.js`, `src/ondemand/miniChat.js`; `hud-summary.js` removed) |
| secrets (source) | `npm run check:secrets` | PASS — 1,542 files |
| secrets (dist) | `node scripts/check-no-secrets.mjs --dist` | PASS — 1,810 files incl. `dist/` (local and in the sandbox) |
| foundation unit | `npm run test:foundation` | **48 / 48** (25 Phase B + 23 new in `phase-cdg.test.mjs`: intelligence objects, guards, orchestrator incl. parallel/isolated/partial-failure, v2 route rate limit / authz / sanitised context / stream provenance / investigate / hud / 3-user isolation, miniChat helpers) |
| ondemand unit | `npm run test:ondemand` | **246 / 246** (243 + 3: workflow-id shape B-1, endpoint successor B-2, v1 tier snapshot) |
| serverless unit | `npm run test:serverless` | 58 / 58 (HUD route now asserts 410 + replacement) |
| touched suites | `node --test src/ondemand/*.test.mjs src/brand/productName.test.mjs src/hudSummaryResponse.test.mjs src/radioMarkup.test.mjs src/firstRunExperience.test.mjs src/pinokioLauncherContract.test.mjs src/voice/actionSchemas.test.mjs src/tooling/applicationHtml.test.mjs src/iconGlyphBoundary.test.mjs src/reasonableDefaults.test.mjs src/ui/layerPanel.test.mjs src/ui/cockpitController.test.mjs src/hudAltitudeDatum.test.mjs src/tooling/brandMarks.test.mjs` | PASS (voice tool-schema digests re-derived for the PRODUCT_NAME wording: `3306b0e0…`, `c699fac0a9d2ea28`, `d418ad65…`/26,266 chars) |
| formatting | `npm run format:check` | PASS — 979 files |
| build | `npm run build` | PASS (5.4 s local / 10.3 s sandbox); `dist/index.html` `<title>OnDemand Intelligence Workstation</title>`; `dist/brand/site.webmanifest` stamped |
| full `npm test` on Node 24 | — | NOT RUN (container is Node 22; B-8 unchanged) |

### 7.3 Browser validation of the live preview (ui-validator → headless Chromium 1440×900 + 390×844; artefacts `artifacts/ui-2026-10-20/*.jpg|*-report.json`)

Preview: `https://sb-74qv32j82zmp.vercel.run` (sandbox `sbx_uvCelLuL0ADycaUJzgqhrB7b4S0K`, build of this cycle's tree copied in place, `node server/serverless/dev-server.mjs` with `ONDEMAND_API_KEY` in the process env only). Chromium needed the SwiftShader GL backend (the app is a Cesium/WebGL globe); the validator's socket-timeout handling was patched locally for `captureScreenshot` on WebGL pages.

| # | checklist item | assertion(s) | 1440×900 | 390×844 | artefact |
|---|---|---|---|---|---|
| 1 | startup / brand | `#title-bar` renders, text contains "OnDemand Intelligence", no "OnDemand Spatial" / "GEV MIC", `.title-accent` visible, `document.title === 'OnDemand Intelligence Workstation'`, favicon link `/assets/brand/favicon.ico` | PASS | PASS | `cycle2-startup-*.jpg` |
| 2 | mini chat opens from a data-layer row (earthquakes) | after clicking the row's ASK button: `#ondemand-mini-chat` visible, `data-object-type="earthquake"`, kind line names `earthquakes`, starters rendered, `localStorage['ondemand.apiKey']` absent, `ondemand.v2.externalUserId.default` = `ws-default-…`, key-state "server key" | PASS | PASS | `cycle2-minichat-*.jpg` |
| 3 | context received by OnDemand + streaming | traffic row → starter click → turn completes (139 SSE events, first token 4,259 ms, total 7,887 ms), assistant message > 20 chars, status `READY · … · inferred`, `data-confidence` set, no browser key | PASS | PASS | `cycle2-minichat-stream-*.jpg` |
| 4 | persistence + session isolation + object coverage | graphEdge → ask → newsArticle → ask → reopen graphEdge: 2 distinct sessions, same session resumed, 2 history rows replayed, "EDGE-ONE" visible and "NEWS-ONE" absent; `#hud-ask-ondemand` and `#cockpit-brief-ask` present | PASS | — | `cycle2-persist-isolation-1440x900.jpg` |
| 5 | failure + cancel states | injected 502 → `.od-chat__msg--error`, status `TURN FAILED`; STOP during a stream → turn `cancelled`, status `CANCELLED`, STOP hidden, SEND re-enabled | PASS | — | `cycle2-failure-cancel-1440x900.jpg` |
| 6 | `/api/ondemand/v2/health` (page) | contains `predefined-gpt-6-luna` | PASS | — | `cycle2-health-1440x900.jpg` |

Console: the only error on every run is the expected `GET /api/setup/status` 404 (serverless mode has no key-setup route — pre-existing). No page errors, no failed `/api/ondemand/v2/*` requests.

20-point checklist status: startup ✅ · auth n/a (anonymous workspace user; header binding enforced server-side when `ONDEMAND_V2_REQUIRE_USER_HEADER=1`) · dashboard/HUD ✅ (ASK affordance) · navigation ✅ (layer panel) · OnDemand data flow ✅ · search/filtering/maps/graphs/timelines — not separately exercised this cycle (unchanged code; covered by the existing `scripts/qa-*.mjs` harnesses, see N-15) · cards ✅ · mini chat opens from objects ✅ · context received ✅ · streaming + persistence ✅ · session isolation ✅ · source references ✅ (provenance event, `SOURCES` strip renders when citations exist) · data refresh — unchanged · failure states ✅ · browser refresh — resume path proven via re-open + `/messages` replay · responsive ✅ (390×844 on items 1–3).

### 7.4 Platform-side changes made this cycle (Vercel project `prj_VbHbEhFSDFkdXCqlq8XqONoFWQHO`)

| action | evidence | timestamp |
|---|---|---|
| `ONDEMAND_SPATIAL_WORKFLOW_ID` corrected from the 26-hex typo to `6aace534859f7b0abb53d99a` (PATCH env `lTU2obzhz3oJXEMI`) | API returned `updatedAt 1792535654031`, value length 24 | 22:34:14Z |
| `ONDEMAND_FULFILLMENT_ENDPOINT_ID` set to `predefined-gpt-6-luna` (sensitive var kept sensitive) | `updatedAt 1792535668814` | 22:34:28Z |
| `ELEVENLABS_API_KEY`, `ONDEMAND_KNOWLEDGE_PLUGIN_IDS` deleted | DELETE 200 for both ids | 23:30:34Z |
| Flow Builder relaunch workflow `6ad7f961c2cfee207e8f3d07` created (cron `0 15 */6 * * *`), activated, test execution `6ad7f966c2cfee207e8f3d0d` | `POST /automation/api/workflow/` → id; `/activate` → 200; `/execute` → executionID | 23:30Z |

GENERATED_UTC: 2026-10-20T23:35:00Z
