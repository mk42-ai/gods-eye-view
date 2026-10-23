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

## 8. Cycle 3 (2026-10-21T01:17Z–) — integration audit, voice re-route, plugin lifecycle, tool wrappers

Checkpoint before any chat-UI change: tag `checkpoint-2026-10-21-pre-integration-audit` → commit `75a0792f47ff8c6016ca8845c27d472a00a2303f` (2026-10-21T01:22:13Z, pushed).

### 8.1 Baseline (checkpoint 75a0792, before changes)

| gate | result | timestamp (UTC) |
|---|---|---|
| `npm run test:foundation` | 48 / 48 | 2026-10-21T01:22:28Z |
| `npm run test:ondemand` | 246 / 246 | 01:22:29Z |
| `npm run test:serverless` | 58 / 58 | 01:22:30Z |
| `npm run ondemand:foundation:live` (real API) | **52 / 52 PASS** (26 client + 26 route rows) | 01:22:40Z–01:24:15Z |
| `npx vite build` | OK — reproduced the Vercel warning `src/ondemand/entityContext.js (56:17): "default" is not exported by node_modules/mgrs/dist/mgrs.esm.js` | 01:46Z |
| Requested spec `web/tests/chat-intelligent-ui-payloads.spec.ts` | **did not exist** in the repo at 75a0792, in `code-files-20261020-233921_v1.zip` (2,184 entries) or in `code-files-20261020-221619_v1.zip` (2,323 entries) — searched for `spec.ts`, `web/tests`, `playwright`, `interactive-ui`, `GROWTH`, `Plan/Run` → 0 hits. Authored this cycle (see 8.3). | 01:40Z |
| Browser scenarios A–G (new harness `scripts/qa-chat-intelligent-ui.mjs`) against the checkpoint deployed to the REAL Vercel project (`dpl_6MnJQzCAvrgomj7UeG7BcFByNmqx`, https://ondemand-eand-spatial-3lmhl22k7-schoolhack-web-team.vercel.app) | **12 / 14** — A FAIL at 1440×900 and 390×844 (serverless notice text still named "voice control (OpenAI Realtime)"); B–G PASS at both viewports | 02:20Z–02:30Z · `artifacts/ui-2026-10-21/baseline/{A..G}-{1440x900,390x844}.jpg`, `chat-intelligent-ui.json` |

### 8.2 Post-change gates (working tree of this cycle, before the docs commit)

| gate | result | timestamp (UTC) |
|---|---|---|
| `npm run test:foundation` | **75 / 75** (+13 plugin-lifecycle, +9 voice-route, +5 tool-contracts) | 2026-10-21T03:34Z |
| `npm run test:ondemand` | **250 / 250** (+4 config `voiceFlowId`) | 03:34Z |
| `npm run test:serverless` | **56 / 56** (−2 retired `/api/realtime/*` expectations) | 03:34Z |
| `node --test server/tools/*.test.mjs src/ondemand/*.test.mjs src/brand/*.test.mjs src/voice/*.test.mjs src/voice/ondemand/*.test.mjs` | **473 / 473** | 03:35Z |
| full `npm test` (Node 22.23.3) | **4,188 / 4,188 pass, 0 fail** (2 allocation micro-benchmarks skipped — calibrated for Node 24, B-8) | 03:41:35Z–03:45Z |
| `node scripts/format.mjs --check` · `check-import-directions` · `check-package-boundaries` · `check-brand-marks` · `check-no-secrets` (+ `--dist`) | all exit 0 (965 files formatted; 764 modules; brand marks 2 files) | 03:36Z–03:47Z |
| `npx vite build` | OK in 5.7 s, **mgrs warning gone** | 03:47Z |
| `npm run ondemand:foundation:live` (real API) | **34 / 34 PASS** — 26 cycle-2 rows + 8 new: `/voice/health`, `/voice/turn` transcript → `turn, session, 12× delta, answer, tts (https), done` in 7,860 ms, `/voice/turn` 400 validation, 403 user_mismatch, `/plugins` snapshot (32 entries, all `discovered`, none READY before a probe), `/plugins/verify` → `internet_web_search` READY (4,706 ms, session+probe) and `x_mcp_connector` FAILED `inactive_on_account`, `/contracts` 33 (21 `ondemand-tool`), `/investigate` on an earthquake object → `earthquake_search:ok` **in-process** + `internet_web_search:ok` (22.3 s; B-13 closed) | 03:46:44Z–03:49:30Z · `artifacts/foundation-live-2026-10-21T03-49Z.json` |
| Platform drift found while re-running: `POST …/query` with the literal probe text "Reply with exactly: FOUNDATION-LIVE-OK" → **403 `content_policy_violation`** upstream (03:37:14Z, 03:41:36Z, reproduced by curl 03:46:02Z; "Reply with exactly: ISO-A" / "STREAM-OK" / "READY" pass). Script re-phrased to "Respond with only this text: …" → passes. Recorded as BLOCKERS B-14. | — | 03:46Z |
| Browser scenarios A–G against the local serverless preview of the post-change build (`node server/serverless/dev-server.mjs`, port 4317, real key in process env) | **14 / 14 PASS** (A 6/6, B 5/5, C 2/2, D 3/3, E 2/2, F 3/3, G 3/3 at both 1440×900 and 390×844); console errors 7 / failed requests 9 — all the expected `/api/setup/status` 404s, `/messages` 404 on a never-queried object and the synthetic 502s injected by scenario G | 03:47:30Z–03:48:20Z · `artifacts/ui-2026-10-21/after-local/*` |

### 8.3 Scenario definitions (web/tests/chat-intelligent-ui-payloads.spec.ts ↔ scripts/qa-chat-intelligent-ui.mjs)

| id | scenario | checks |
|---|---|---|
| A | deliverables | boot (loading hidden / globe canvas), title "OnDemand Intelligence Workstation", no "God's Eye"/"GEV MIC"/"OpenAI" visible text, brand mark, `/v2/health` ok, `/v2/contracts` ≥ 13 |
| B | pipeline and waiting | mini chat opens for an earthquake object, status leaves IDLE, STOP visible mid-turn, assistant message, settles ≤ 90 s, `X-OnDemand-Key-Source: server`, no key in localStorage |
| C | citations | news question completes; SOURCES strip or honest no-sources/confidence label |
| D | root-first UI | 390×844: panel inside viewport, input visible, no horizontal scroll; 1440×900: no brand-mark overlap; close → `data-open=false`; re-open restores transcript |
| E | summarization vs history | same object replays ≥ 2 prior messages; a different object is isolated |
| F | settings and plugin caps | `activePlugins ≤ 10`, every `pluginId` matches `plugin-\d+`, `/v2/plugins` states ∈ allowed set, no READY without `verifiedAt` |
| G | failure/retry + cross-app regression | synthetic 502 → `.od-chat__msg--error` + TURN FAILED; retry recovers; HUD still interactive, no page errors |

### 8.4 OnDemand platform actions (2026-10-21)

| action | evidence | UTC |
|---|---|---|
| Voice workflow created (`POST /automation/api/workflow/`) — webhook trigger, `voice_turn_input` (inputText `{payload}`) → `voice_agent_answer` (llm `predefined-gpt-6-luna`, plugin `plugin-1713924030`) → `o_analyzer` | id `6ad8160ab28e35aa11d85632` | 01:31:54Z |
| Activated (`/activate`) | `GET /workflow/{id}` → `isActive: true` | 01:31:58Z |
| Sample execution via API trigger (`/execute`) | `6ad81615c2cfee207e8f3e12` → `status: success`, 7,399 ms; node outputs show the API trigger carries no payload (`voice_turn_input.value === "{payload}"`) — see TRIGGER_DECISION.md | 01:32:05Z |
| Webhook trigger URL discovery | `GET /workflow/{id}` returns no URL; `/automation/webhook/{id}` → 401 (Bearer JWT only); `/automation/api/webhook/{id}` → 404 — 11 probes in ONDEMAND_LIVE_DOCS_2026-10-21.md | 01:33Z–02:00Z |
| Plugin registration via API | MCP `plugin_v1_plugin_create` → no plugin created (list total 0); `POST /plugin/v1` → 500; `public_v1_plugin_ai_generated_tool_create` → HTTP 524 — dashboard-only (B-15) | 01:28Z–01:31Z |
| Vercel env `ONDEMAND_VOICE_WORKFLOW_ID` added (production+preview, plain) | `POST /v10/projects/{id}/env?upsert=true` → created | 02:08:54Z |
| Checkpoint preview on the real project via REST (`POST /v13/deployments` with `gitSource` repoId 1375642703 ref `integration/ondemand-native`) | `dpl_6MnJQzCAvrgomj7UeG7BcFByNmqx` READY, `/api/ondemand/v2/health` ok, title "OnDemand Intelligence Workstation" | 02:07:06Z → 02:08:40Z |

### 8.5 Post-change preview on the REAL Vercel project (commit `d44264f`)

| item | value | UTC |
|---|---|---|
| Feature commit | `d44264fddfc4d561c3ad5f9fd0cf7d38a530cfda` (130 files, +16,103 / −11,859) pushed to `origin/integration/ondemand-native` | 2026-10-21T04:04:17Z |
| Deployment (`POST /v13/deployments`, `gitSource` repoId 1375642703, sha d44264f) | `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8` → READY · https://ondemand-eand-spatial-qrli9v1uy-schoolhack-web-team.vercel.app | created 04:04:31Z, READY 04:05:00Z |
| `GET /api/ondemand/v2/health` | `ok, configured, contracts 33, activePlugins 10, defaultEndpointId predefined-gpt-6-luna, workflowId source ONDEMAND_SPATIAL_WORKFLOW_ID valid` | 04:06:07Z |
| `GET /api/ondemand/v2/voice/health` + alias `/api/voice/health` | `ok, configured, voiceFlowId.resolvedVia ONDEMAND_VOICE_WORKFLOW_ID, services [speech_to_text, text_to_speech]`; alias 200 | 04:06:08Z |
| `GET /api/ondemand/v2/plugins` | 32 entries, all `discovered` (no fabricated READY) | 04:06:09Z |
| `GET /api/tools/geocode_place?q=Eiffel+Tower` (new tool, live) | 200 `status OK`, lat 48.8582599 lng 2.294… | 04:06:10Z |
| `GET /site.webmanifest` | 200 `application/manifest+json` | 04:06:11Z |
| `GET /api/realtime/token` (retired OpenAI path) | **404** | 04:06:11Z |
| `POST /api/voice/turn` (transcript, tts:true) on the preview | SSE `turn ×1, session ×1, delta ×22, answer ×1, tts ×1, done ×1` | 04:06:24Z |
| Browser scenarios A–G (`scripts/qa-chat-intelligent-ui.mjs`) against the preview | **14 / 14 PASS** (A 6/6, B 5/5, C 2/2, D 3/3, E 2/2, F 3/3, G 3/3 × {1440×900, 390×844}); failed requests 10 = `/api/setup/status` 404s, unqueried-object `/messages` 404s, scenario-G synthetic 502s | 04:06:12Z–04:07:04Z · `artifacts/ui-2026-10-21/after/{A..G}-*.jpg`, `chat-intelligent-ui.json` |
| ui-validator `cycle3-startup` (1440×900 + 390×844) | title "OnDemand Intelligence Workstation"; text "OnDemand Intelligence" present; "God's Eye" / "GEV MIC" / "OpenAI" absent; `#loading-screen` background-image contains `backdrop-network`; manifest link present — **PASS** | 04:08Z · `artifacts/ui-2026-10-21/proof/cycle3-startup-*.jpg` |
| ui-validator `cycle3-minichat-plugins` (both viewports) | `gev:ask-object` opens `#ondemand-mini-chat` (`data-open=true`); `#ondemand-mini-chat-dev` is a collapsed `<details>` "Developer details"; no-sessions empty state rendered for a fresh object; `#ondemand-plugin-panel` visible with ≥ 10 state badges all ∈ {DISCOVERED, INSTALLING, AUTHENTICATING, INVOKING, READY, FAILED} and **none READY before a probe**; `localStorage['ondemand.apiKey']` absent; `#gev-voice-control` gone, `od-voice-*` present — **PASS** | 04:10Z · `proof/cycle3-minichat-plugins-*.jpg` |
| ui-validator `cycle3-plugin-verify` (1440×900) | click VERIFY on `internet_web_search` → badge becomes **READY** with verified-time/latency text (real session + probe through `/plugins/verify`); click VERIFY on `x_mcp_connector` → **FAILED** with `.od-plugin__error` text (inactive_on_account) — **PASS** | 04:10Z · `proof/cycle3-plugin-verify-1440x900.jpg` |
| ui-validator `cycle3-voice-turn` (1440×900) | `#od-voice-button` visible, `#gev-voice-control` absent; `window.__odVoice.submitText(...)` drives a real turn through `/api/ondemand/v2/voice/turn`: pipeline states include `thinking` and reach `speaking`/transcript/metrics with no `error`; history length ≥ 1 — **PASS** | 04:11Z · `proof/cycle3-voice-turn-1440x900.jpg` |

20-point checklist status after cycle 3: startup ✅ · auth n/a (anonymous workspace user, server-side principal binding) · dashboard/HUD ✅ · navigation ✅ · OnDemand data flow ✅ · search/filtering/maps/graphs/timelines — unchanged code, not separately exercised (N-15) · cards ✅ · mini chat opens from objects ✅ · context received ✅ (grounded answers, provenance) · streaming + persistence ✅ (B, E) · session isolation ✅ (E + live row 26) · source references ✅ (C) · data refresh — unchanged · failure states ✅ (G + empty states) · browser refresh — resume via re-open + `/messages` replay (D/E) · responsive ✅ (every scenario at 390×844) · voice ✅ (turn-based on OnDemand) · plugin lifecycle ✅ (honest badges).

## 9. Cycle 4 (2026-10-21T04:17Z–07:28Z) — verification swarm on the real-project preview + sandbox resume

### 9.1 Five-agent verification of preview `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8` (commit `d44264f`) — artefacts `artifacts/verify-2026-10-21/`
| agent | scope | result | artefact |
|---|---|---|---|
| 1 | desktop 1440×900 walkthrough (`scripts/qa-verify-walkthrough.mjs`) | 15 PASS / 1 FAIL / 2 PARTIAL of 18 — FAIL `1g_voice_plugin_selection` (voice turn did not forward ticked plugin ids) | `desktop/RESULTS.md` |
| 2 | mobile 390×844 walkthrough (`scripts/qa-verify-mobile.mjs`) | 15 PASS / 4 FAIL of 19 — `2c` investigate turn > 60 s, `2m3` touch targets < 44 px, `2m5` voice button covered by open chat, `2g` plugin-id forwarding | `mobile/RESULTS.md` |
| 3 | live API matrix (`scripts/qa-verify-api.mjs`) | 47 PASS / 6 EXPECTED-DEGRADED / 2 UNSUPPORTED / 0 FAIL of 55 (`GET /api/health` → 404 recorded UNSUPPORTED) | `api/RESULTS.md`, `api-log.json` |
| 4 | scenarios A–G + perf + no-fake-content audit (`scripts/qa-verify-perf.mjs`) | 32 PASS / 2 FAIL of 34 — follow-up pinning after the user scrolled up | `scenarios/RESULTS.md` |
| 5 | fixes for the above (uncommitted at the end of cycle 4's first run; landed in this checkpoint) | see §9.2 | this commit |

### 9.2 Fixes landed in this checkpoint (interrupted work recovered from the working tree, re-tested 2026-10-21T07:15Z)
| fix | file(s) | test |
|---|---|---|
| Investigate deadline budget: per-plugin timeout = min(configured, 60 % of budget), `Promise.allSettled`, `status:"timeout"` / `retrieval_timeout` rows, synthesis gets the remaining budget (low effort when < 20 s); `budgetMs` accepted by `POST /investigate` (`ONDEMAND_INVESTIGATE_BUDGET_MS` default 50 s < Vercel 60 s) | `server/ondemand/foundation/orchestrator.js`, `proxy-route.js` | `phase-cdg.test.mjs` "enforces deadline budget" (76/76 foundation) |
| Mini chat shows the `source-unavailable` empty state on a 504/timeout investigation | `src/ondemand/miniChat.js` | `miniChat*.test.mjs` 10/10 |
| Voice turn forwards the PLUGINS panel selection (`win.__odPlugins.getSelectedPluginIds`, max 4) | `src/voice/ondemand/index.js` | `ui.test.mjs` "wires plugin selection" |
| `GET/HEAD /api/health` liveness alias → foundation `/api/ondemand/v2/health` (pure URL rewrite, GET/HEAD only; POST still 404) | `server/serverless/app.js` | `app.test.mjs` "liveness alias" (57/57 serverless) |

Gates re-run 2026-10-21T07:16Z–07:20Z: `format:check` ✓ (965 files) · `check:boundaries` ✓ · `check:secrets` ✓ (1,591 files) · `test:foundation` 76/76 · `test:serverless` 57/57 · `test:ondemand` 250/250.

### 9.3 Fresh ephemeral preview (Vercel Sandbox, node22) — resume after `sb-6pg586b0uu6v` refused connections
| item | value |
|---|---|
| sandbox | `sbx_pZgfovEYwxtQu48zPwIg0rVujhWO` → `https://sb-72vtzc1c6cf8.vercel.run` (brand-new, 90 min) |
| install / build | `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` (129 packages, 5 s) · `npm run build` 5.4 s, `dist/index.html` `<title>OnDemand Intelligence Workstation</title>` · `check-no-secrets.mjs --dist` ✓ |
| env | 21 keys from the Vercel project (plain values copied; sensitive ones use the repo's documented defaults) in the sandbox `.env` (gitignored); `ONDEMAND_API_KEY` only in the server process environment |
| server | `node server/serverless/dev-server.mjs` PID 248, started 2026-10-21T07:24:30Z, `0.0.0.0:5173` |
| `GET /api/health` | **200** on the first poll (07:24:47Z): `{"ok":true,"configured":true,"conversationBackend":"memory","contracts":33,"activePlugins":10,"defaultEndpointId":"predefined-gpt-6-luna","workflowId":{"configured":true,"source":"ONDEMAND_SPATIAL_WORKFLOW_ID","valid":true},"guards":{"rateLimitPerMinute":60,"userHeaderRequired":false,"promptInjectionFencing":true},"keySource":"server"}` |
| brand assets | `/assets/brand/favicon.ico` 200 `image/x-icon` · `/assets/brand/mark-mono.png` 200 `image/png` 882,285 B · `/assets/brand/mark-primary.png` 200 `image/png` 828,607 B |
| headless Chromium (ui-validator) 1440×900 | 15/15: `#hud-ask-ondemand` click opens `#ondemand-mini-chat[data-open=true]`, text "OnDemand Intelligence" + "ASK ONDEMAND" present, "God's Eye" / "GEV MIC" / "Gods Eye" / `\bGEV\b` absent, `document.title` exact, favicon link → `/assets/brand/favicon.ico`, no eye-motif asset; 0 page errors; console: expected `/api/setup/status` 404 + `/messages` 404 on a never-queried object |
| headless Chromium 390×844 | 8/8 (same branding assertions) |
| verified_at | 2026-10-21T07:27:54Z — screenshots `root-verify-1440x900.png`, `root-verify-390x844.png` (turn attachments) |

Known gaps carried to NEXT_ACTIONS: `2m3` touch targets, `2m5` voice button overlap, follow-up pinning (N-22…N-24); `ONDEMAND_INVESTIGATE_BUDGET_MS` should be set on the Vercel project (N-25).

## 10. Cycle 5 (2026-10-21T07:33Z–08:55Z) — vigorous headless-browser verification of the live sandbox (five-agent swarm)

Target: the cycle-4 sandbox `sbx_pZgfovEYwxtQu48zPwIg0rVujhWO` → `https://sb-72vtzc1c6cf8.vercel.run` (workspace head `aa3eb8d`, serverless preview server PID 248, 21 env keys, `ONDEMAND_API_KEY` only in the process env). `GET /api/health` → **200** at 07:33:11Z before the swarm started (same body as §9.3). Artefacts: `artifacts/sandbox-verify-2026-10-21/` (`results-matrix.json`, `RESULTS.md`, per-agent `agentN/RESULTS.md`, PNG proof for every cell).

### 10.1 Scenario × viewport matrix — `scripts/qa-chat-intelligent-ui.mjs` (Puppeteer + SwiftShader, `--format png`), **14 / 14 PASS**
Agents: 1 → A,B · 2 → C,D · 3 → E,F · 4 → G (each at 1440×900 then 390×844) · 5 → consolidation. Every cell has a PNG screenshot.

| scenario | viewport | status | ms | checks | run_at (UTC) | screenshot (under `docs/agent-execution/`) |
|---|---|---|---|---|---|---|
| A | 1440x900 | **PASS** | 235 | 6/6 | 2026-10-21T08:24:30.972Z | `artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-1440x900.png` |
| B | 1440x900 | **PASS** | 5992 | 5/5 | 2026-10-21T08:01:03.173Z | `artifacts/sandbox-verify-2026-10-21/agent1/ab/B-1440x900.png` |
| C | 1440x900 | **PASS** | 8699 | 2/2 | 2026-10-21T08:02:15.521Z | `artifacts/sandbox-verify-2026-10-21/agent2/cd/C-1440x900.png` |
| D | 1440x900 | **PASS** | 98 | 4/4 | 2026-10-21T08:02:27.088Z | `artifacts/sandbox-verify-2026-10-21/agent2/cd/D-1440x900.png` |
| E | 1440x900 | **PASS** | 7314 | 2/2 | 2026-10-21T08:03:38.512Z | `artifacts/sandbox-verify-2026-10-21/agent3/ef/E-1440x900.png` |
| F | 1440x900 | **PASS** | 401 | 3/3 | 2026-10-21T08:03:47.291Z | `artifacts/sandbox-verify-2026-10-21/agent3/ef/F-1440x900.png` |
| G | 1440x900 | **PASS** | 7409 | 3/3 | 2026-10-21T08:03:03.425Z | `artifacts/sandbox-verify-2026-10-21/agent4/g/G-1440x900.png` |
| A | 390x844 | **PASS** | 211 | 6/6 | 2026-10-21T08:24:40.765Z | `artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-390x844.png` |
| B | 390x844 | **PASS** | 6022 | 5/5 | 2026-10-21T08:01:16.419Z | `artifacts/sandbox-verify-2026-10-21/agent1/ab/B-390x844.png` |
| C | 390x844 | **PASS** | 7039 | 2/2 | 2026-10-21T08:02:36.371Z | `artifacts/sandbox-verify-2026-10-21/agent2/cd/C-390x844.png` |
| D | 390x844 | **PASS** | 161 | 4/4 | 2026-10-21T08:02:46.022Z | `artifacts/sandbox-verify-2026-10-21/agent2/cd/D-390x844.png` |
| E | 390x844 | **PASS** | 3978 | 2/2 | 2026-10-21T08:03:52.517Z | `artifacts/sandbox-verify-2026-10-21/agent3/ef/E-390x844.png` |
| F | 390x844 | **PASS** | 79 | 3/3 | 2026-10-21T08:03:57.204Z | `artifacts/sandbox-verify-2026-10-21/agent3/ef/F-390x844.png` |
| G | 390x844 | **PASS** | 6315 | 3/3 | 2026-10-21T08:03:16.821Z | `artifacts/sandbox-verify-2026-10-21/agent4/g/G-390x844.png` |

Harness changes this cycle (harness only, no app change): scenario D/E now **self-seed** one real earthquake turn when run on a fresh page (`ensureEarthquakeHistory`, so `--scenarios E,F` is order-independent), `--format png`, and the boot wait now waits for `#loading-screen.hidden` **before** the canvas fallback and logs `Boot [vp]: loader hidden=… after N ms` (5–6.4 s on the sandbox).

### 10.2 Before/after evidence (the only fix needed)
The original boot wait returned as soon as a canvas + `dataManager` existed, so the Scenario A screenshots — taken ~1 s after boot — showed the `#loading-screen` overlay (backdrop + wordmark) rather than the UI under test; the DOM checks had passed regardless. Scenario A was re-run at both viewports after the fix; the agents' focused scripts got the same wait and their extra-check screenshots were recaptured (pre-fix captures kept under `fixes/overlay-before/`).

| cell | issue | before | after | fix |
|---|---|---|---|---|
| A@1440x900 | Harness boot-wait originally returned as soon as a canvas + dataManager existed, so Scenario A screenshot (~1s post-boot) captured #loading-screen ove… | `artifacts/sandbox-verify-2026-10-21/fixes/A-before/A-1440x900-before.png` (2026-10-21T08:01:01.357Z) | `artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-1440x900.png` (2026-10-21T08:24:30.972Z) | scripts/qa-chat-intelligent-ui.mjs boot wait (loader hidden first) — harness-only, no app change |
| A@390x844 | Harness boot-wait originally returned as soon as a canvas + dataManager existed, so Scenario A screenshot (~1s post-boot) captured #loading-screen ove… | `artifacts/sandbox-verify-2026-10-21/fixes/A-before/A-390x844-before.png` (2026-10-21T08:01:13.963Z) | `artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-390x844.png` (2026-10-21T08:24:40.765Z) | scripts/qa-chat-intelligent-ui.mjs boot wait (loader hidden first) — harness-only, no app change |
| agent2/empty-states-backdrop | Focused script (/tmp/agent2-empty.mjs) boot wait captured loading screen backdrop rather than settled UI states; recaptured with #loading-screen.hidde… | `artifacts/sandbox-verify-2026-10-21/fixes/overlay-before/check-backdrop-1440x900.png` (2026-10-21T08:18:03.646Z) | `artifacts/sandbox-verify-2026-10-21/agent2/check-backdrop-1440x900.png` (2026-10-21T08:27:40.612Z) | Applied loader hidden check to /tmp/agent2-empty.mjs — harness-only, no app change |
| agent3/plugin-badges | Focused script (/tmp/agent3-plugins.mjs) captured plugin panel while initial overlay was still fading; recaptured with loader hidden wait… | `artifacts/sandbox-verify-2026-10-21/fixes/overlay-before/check-plugins-ready-1440x900.png` (2026-10-21T08:21:34.810Z) | `artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-1440x900.png` (2026-10-21T08:27:40.606Z) | Applied loader hidden check to /tmp/agent3-plugins.mjs — harness-only, no app change |
| agent4/regression-failure-reload | Focused script (/tmp/agent4-regression.mjs) captured failure and reload states before loading overlay had completely cleared; recaptured with loader h… | `artifacts/sandbox-verify-2026-10-21/fixes/overlay-before/check-failure-1440x900.png` (2026-10-21T08:18:20.956Z) | `artifacts/sandbox-verify-2026-10-21/agent4/check-failure-1440x900.png` (2026-10-21T08:28:42.240Z) | Applied loader hidden check to /tmp/agent4-regression.mjs — harness-only, no app change |

### 10.3 Additional checks (both viewports)
| check | viewport | status | checks | run_at (UTC) | screenshot | evidence |
|---|---|---|---|---|---|---|
| parity-streaming | both | **PASS** | 4/4 | 2026-10-21T08:08:00.204Z | `artifacts/sandbox-verify-2026-10-21/agent1/check-streaming-1440x900.png` | sameKeySource=true (server); bothStreamed=true; stopButtonVisible=true; TTFT desktop=3332ms, mobile=4417ms, |diff|=1085ms; localStorageApiKeyIsNull=true; finalStatus="READY · inferred"; assistantChars: desktop=96, mobile=147 |
| parity-hud-summary | both | **PASS** | 3/3 | 2026-10-21T08:08:12.606Z | `artifacts/sandbox-verify-2026-10-21/agent1/check-hud-summary-1440x900.png` | hudSummaryPopulated=true (active telemetry, isAwaitingTelemetry=false); bothHudOpenable=true (objectType="hudSummary", kind="HUD SUMMARY · global"); mobile bounding box fits 390x844 with zero horizontal scroll (scrollWidth 390 <= innerWidth 390) |
| parity-failure-retry | both | **PASS** | 4/4 | 2026-10-21T08:28:53.874Z | `artifacts/sandbox-verify-2026-10-21/agent4/check-recovery-1440x900.png` | sameFailureUiElement=true (.od-chat__msg--error + status TURN FAILED + .od-empty-state--source-unavailable); sameRecoveryKeySource=true (server); assistant characters desktop=386, mobile=367; retryAffordanceExists=false on both (retry conducted via composer) |
| parity-cancel | both | **PASS** | 2/2 | 2026-10-21T08:28:58.182Z | `artifacts/sandbox-verify-2026-10-21/agent4/check-cancel-1440x900.png` | statusText="CANCELLED" within 5s after clicking stop; noFurtherTextArrivedFor3s=true (0 tokens received over 3s window on both desktop and mobile) |
| parity-session-isolation | both | **PASS** | 2/2 | 2026-10-21T08:29:08.276Z | `artifacts/sandbox-verify-2026-10-21/agent4/check-isolation-1440x900.png` | bothIsolated=true; alertMessageCount=0, alertEmptyState="No prior investigation for this object", alertContainsFire=false; fireReopenedMessageCount=4 restored without message bleed |
| parity-reload-persistence | both | **PASS** | 2/2 | 2026-10-21T08:29:18.317Z | `artifacts/sandbox-verify-2026-10-21/agent4/check-reload-persist-1440x900.png` | bothPersistedAfterReload=true; full page.reload() restored all 4 conversation turns from server conversation store (/api/ondemand/v2/messages) on both desktop and mobile |
| plugin-lifecycle-api | both | **PASS** | 8/8 | 2026-10-21T08:06:05.434Z | — (API / grep) | GET plugins before: 32 discovered; POST verify websearch: ready (6075ms); POST verify xmcp: failed inactive_on_account (400); POST verify all: 10 active ready (latencies 4712-11391ms, avg 6186.2ms); GET plugins after: 10 ready, 1 failed, 21 discovered; POST us |
| plugin-lifecycle-badges | 1440x900 | **PASS** | 4/4 | 2026-10-21T08:27:40.606Z | `artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-1440x900.png` | initialBadgesCount=32; websearch click transitioned to VERIFYING… (disabled) then READY (latency 4526ms, 6m ago); xmcp transitioned to FAILED ("This research source is currently inactive on the OnDemand account."); summaryCount="10 ready" |
| plugin-lifecycle-badges | 390x844 | **PASS** | 4/4 | 2026-10-21T08:27:40.606Z | `artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-390x844.png` | initialBadgesCount=32; websearch click transitioned to VERIFYING… (disabled) then READY (latency 4526ms, just now); xmcp transitioned to FAILED ("This research source is currently inactive on the OnDemand account."); summaryCount="10 ready" |
| branding-title-wordmark | 1440x900 | **PASS** | 3/3 | 2026-10-21T08:02:08.763Z | `artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-1440x900.png` | document.title="OnDemand Intelligence Workstation"; #title-bar [data-product-wordmark] contains "OnDemand Intelligence"; brand mark SVG 52x34.88px rendered at (x:49, y:43) |
| branding-title-wordmark | 390x844 | **PASS** | 3/3 | 2026-10-21T08:02:08.763Z | `artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-390x844.png` | document.title="OnDemand Intelligence Workstation"; #title-bar [data-product-wordmark] contains "OnDemand Intelligence"; brand mark SVG 36x24.14px rendered at (x:29, y:25) |
| branding-no-legacy-terms | 1440x900 | **PASS** | 2/2 | 2026-10-21T08:02:08.763Z | `artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-1440x900.png` | 0 forbidden terms in document.body.innerText (case-insensitive check for "God's Eye", "GEV MIC", "Gods Eye", "OpenAI"); no eye motif in DOM tags or attributes |
| branding-no-legacy-terms | 390x844 | **PASS** | 2/2 | 2026-10-21T08:02:08.763Z | `artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-390x844.png` | 0 forbidden terms in document.body.innerText (case-insensitive check for "God's Eye", "GEV MIC", "Gods Eye", "OpenAI"); no eye motif in DOM tags or attributes |
| legacy-openai-realtime-grep | both | **PASS** | 4/4 | 2026-10-21T08:24:30.000Z | — (API / grep) | runtime OpenAI/Realtime references: 0; non-test grep hits: 45 across 19 files (GTFS-realtime=20, docs/comments/settings metadata=21, symbol identifiers=4); production bundle 0 runtime calls; provider directory removed in d44264f |

Plugin lifecycle detail (agent 3, `artifacts/sandbox-verify-2026-10-21/agent3/api/*.json`): `GET /plugins` 32 entries all `discovered` → `POST /plugins/verify internet_web_search` → `ready` (6,075 ms, `answerPreview:"READY"`) → `x_mcp_connector` → `failed` `inactive_on_account` (400, non-retryable) → verify-all → 10/10 active plugins `ready` (4,712–11,391 ms) → `GET /plugins` 10 ready · 1 failed · 21 tools `discovered` (route-level) → header/body principal mismatch → **403 `user_mismatch`**. In the DOM the badge goes DISCOVERED → `VERIFYING…` (button disabled) → READY (+latency, "just now") or FAILED (+`.od-plugin__error`), summary "10 ready"; `installing`/`authenticating` are server-side states inside one verify request (audited `plugin_state from→to`, unit test "happy path transitions in order").

Desktop/mobile parity (agents 1 + 4): streaming TTFT 3,332 ms vs 4,417 ms, both `X-OnDemand-Key-Source: server`, no `localStorage.ondemand.apiKey`; HUD summary populated ("NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM | …") and `#hud-ask-ondemand` opens `hudSummary:global` on both; synthetic 502 → `.od-chat__msg--error` + `TURN FAILED` + `source-unavailable` empty state on both; STOP → `CANCELLED` with no further tokens; recovery turn settles READY (server key) on both; a fresh `alert` object shows 0 messages / "No prior investigation for this object" while the `fire` object keeps 4; hard reload restores the 4 messages from the server-side store on both; globe camera finite after all of it. No explicit RETRY button exists (retry = send again) — recorded, not a failure.

### 10.4 Branding + generated assets (agent 2)
`document.title === "OnDemand Intelligence Workstation"`, wordmark present, 0 hits for "God's Eye"/"GEV MIC"/"Gods Eye"/"OpenAI" in `body.innerText`, favicon link → `/assets/brand/favicon.ico`, no `eye` in any image/svg/background-image reference, header mark `/brand/mark-light.svg` 52×35 px (desktop) / 36×24 px (mobile).

| asset | HTTP | sha256 | rendered desktop | rendered mobile | no text / eye motif |
|---|---|---|---|---|---|
| `/assets/brand/backdrop-network.png` | 200 `image/png` 1,243,829 B | Catalog: MATCH (cba96745...); Original: N/A | YES (#loading-screen background-image) | YES (#loading-screen background-image) | FAIL on strict automated OCR threshold (10 alnum chars noise from graph nodes/lines); PASS on visual inspection (abstract network constellation graph; no text; no eye motif) |
| `/assets/brand/empty-no-results.png` | 200 `image/png` 854,662 B | Catalog: MATCH (91c63a81...); Original: N/A | YES (.od-empty-state--no-results::before) | YES (.od-empty-state--no-results::before) | PASS (noise <= 3 chars; 0 concentric circles) |
| `/assets/brand/empty-no-sessions.png` | 200 `image/png` 833,892 B | Catalog: MATCH (99986406...); Original: MATCH (p2UMfLtxCv.png) | YES (.od-empty-state--no-sessions::before) | YES (.od-empty-state--no-sessions::before) | PASS (noise <= 3 chars; 0 concentric circles; palette verified) |
| `/assets/brand/empty-source-unavailable.png` | 200 `image/png` 851,438 B | Catalog: MATCH (9722bbf3...); Original: N/A | YES (.od-empty-state--source-unavailable::before) | YES (.od-empty-state--source-unavailable::before) | PASS (noise <= 3 chars; 0 concentric circles) |
| `/assets/brand/mark-primary.png` | 200 `image/png` 828,607 B | Catalog: MATCH (43abf5cc...); Original: N/A | Not rendered directly in UI | Not rendered directly in UI | PASS (noise <= 3 chars; 0 concentric circles) |
| `/assets/brand/mark-mono.png` | 200 `image/png` 882,285 B | Catalog: MATCH (e38da23a...); Original: N/A | Not rendered directly in UI | Not rendered directly in UI | PASS (noise <= 3 chars; 0 concentric circles) |
| `/assets/brand/mark-variant-a.png` | 200 `image/png` 770,292 B | Catalog: MATCH (0556ca19...); Original: MATCH (8dxSOsnbYr.png) | Not rendered in UI | Not rendered in UI | PASS (noise <= 3 chars; 0 concentric circles) |
| `/assets/brand/mark-variant-b.png` | 200 `image/png` 848,084 B | Catalog: MATCH (f7ea09b7...); Original: MATCH (QUKWX8jhhC.png) | Not rendered in UI | Not rendered in UI | PASS (noise <= 3 chars; 0 concentric circles) |
| `/assets/brand/favicon.ico` | 200 `image/x-icon` 655 B | Catalog: MATCH (fdd1dc86...); Original: N/A | YES (browser tab / bookmark icon via <link rel="icon">) | YES (browser tab / bookmark icon via <link rel="icon">) | PASS |
| `/assets/brand/favicon-32.png` | 200 `image/png` 1,714 B | Catalog: MATCH (c6666d54...); Original: N/A | YES (head link sizes="32x32") | YES (head link sizes="32x32") | PASS |
| `/assets/brand/apple-touch-icon.png` | 200 `image/png` 30,314 B | Catalog: MATCH (ca5a07dc...); Original: N/A | YES (head link <link rel="apple-touch-icon">) | YES (iOS bookmark/home screen icon) | PASS |
| `/brand/mark-light.svg` | 200 `image/svg+xml` 653 B | Source: MATCH (ee640260...); Catalog: N/A | YES (renders inside #title-bar and #loading-screen) | YES (renders inside #title-bar) | PASS |

OCR (tesseract psm 6/11) + Pillow palette + OpenCV HoughCircles over the 8 generated PNGs: 0 concentric (eye-like) structures; `empty-no-sessions.png` background `#071226` (target `#0B1526`, Δ ≤ 4), 16,097 slate `#8A94A6` px, 1,042 emerald `#0AC985` px. The three attached originals (`p2UMfLtxCv.png`, `8dxSOsnbYr.png`, `QUKWX8jhhC.png`) are byte-identical to the served `empty-no-sessions.png`, `mark-variant-a.png`, `mark-variant-b.png`.

### 10.5 Legacy OpenAI / Realtime audit (agent 4 + follow-up cleanup)
`grep -rn -i -E "openai|realtime|/api/realtime" server src api` (non-test): 45 hits in 19 files — 0 runtime OpenAI/Realtime transport, 20 GTFS-Realtime transit naming, 21 historical comments / legacy error code (`OPENAI_NOT_CONFIGURED` still recognised), 4 internal symbols (`GEV_REALTIME_TOOLS`, `realtimeInstructions`). `server/providers/openai` is gone (d44264f), `src/voice` has no realtime module, `dist/` has 0 `api.openai.com` / `realtime/token` hits. The one residue the audit surfaced — the dead **OPENAI** row in the Provider Settings registry (`src/keySetupCore.mjs`, which also put `OPENAI_API_KEY` into the production bundle) — was removed this cycle together with the OpenAI wording in `scripts/setup-doctor.mjs`, `scripts/dev-fresh.sh`, README/TESTING/SECURITY/CONTRIBUTING/docs/CLOSEOUT and three stale code comments; a regression test now asserts the row and the env var stay out of the registry. After the rebuild: **0** files in `dist/assets` match `api.openai.com|realtime/token|OPENAI_API_KEY`.

### 10.6 Unit suites (Node 22.23.3) — before and after the cleanup
| run | result | when |
|---|---|---|
| `npm test` (src) before cleanup | 4,190 tests → **4,189 pass / 0 fail / 1 skipped** (`Windows production hardener … native tools`, win32-only) + 2 allocation files skipped (Node-24 calibrated, B-8) | 08:02:11Z–08:03:13Z |
| foundation / ondemand / serverless / tools / providers+sources | 76 / 250 / 57 / 45 / 56 — all pass | 08:03Z–08:05Z |
| **total before** | **4,674 tests · 4,673 pass · 0 fail · 1 skipped** | |
| `npm test` (src) after cleanup | 4,191 tests → **4,190 pass / 0 fail / 1 skipped** (+1 regression test) | 08:51:37Z–08:52:30Z |
| all server suites after cleanup | 484 / 484 | 08:52Z |
| **total after** | **4,675 tests · 4,674 pass · 0 fail · 1 skipped** | |
| gates | `format:check` 965 files ✓ · `check:boundaries` ✓ (brand marks 2 files) · `check:secrets` ✓ · `vite build` 5.4 s · `check-no-secrets --dist` ✓ · `<title>OnDemand Intelligence Workstation</title>` | 08:53Z |

### 10.7 Sandboxes
| sandbox | URL | role | health |
|---|---|---|---|
| `sbx_pZgfovEYwxtQu48zPwIg0rVujhWO` | `https://sb-72vtzc1c6cf8.vercel.run` | verification target (all 14 cells + extra checks) | 200 at 07:33:11Z … 08:36:13Z; **410 at 08:53:29Z** (90-min sandbox lifetime reached) |
| `sbx_5nzv1jxgsXOEfEknNB6MTQhA2Xgk` | `https://sb-6p9xpg654ouc.vercel.run` | successor started 08:37:11Z from the same tree (`npm ci`, `vite build` 6.3 s, `check-no-secrets --dist` ✓, same 21 env keys, key only in the process env); A–G re-run **14 / 14** at 08:38:32Z–08:39:31Z (`artifacts/sandbox-verify-2026-10-21/successor-ag/`) | 200 at 08:38:13Z (first poll) |

Known-benign console/network lines in every run: `GET /api/setup/status` 404 (no key-setup wizard in the serverless build), `GET /api/ondemand/v2/messages` 404 on a never-queried object (renders the no-sessions empty state), and the synthetic `POST /api/ondemand/v2/chat` 502 injected by scenario G / the failure checks. Nothing unexpected.

## 11. Cycle 6 (2026-10-21T09:15Z–10:3xZ) — preview retry on a brand-new sandbox + five-agent A–G verification + defect fixes

Pre-flight 09:15:18Z: `git status` clean, HEAD `712a552150784bbaddf46f3cc4ead10e56fcf5eb` on `integration/ondemand-native`, tag `checkpoint-2026-10-21-post-sandbox-verification` → `712a552` (no restore from the code-files zips was needed). Deploy source = `712a552`.

### 11.1 Sandbox, build, env, health gate
| item | value |
|---|---|
| sandbox | `sbx_C7YcHpK0v9hb018cNsHaEObsAyvi` → **https://sb-4asza5droe1u.vercel.run** (brand-new; node22 v22.22.2; `--timeout 90m`; `--publish-port 5173`) |
| created / projected expiry (UTC) | **2026-10-21T09:17:55Z** / **≈2026-10-21T10:47:55Z** |
| tree | tgz of the working tree without `node_modules/.git/dist/docs/.ui-proof` (1,622 entries, 19 MB) |
| install / build | `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` 09:18:25Z–09:18:32Z · `vite build` **8.41 s** (09:18:32Z–09:18:46Z) · `dist/index.html` `<title>OnDemand Intelligence Workstation</title>` · `check-no-secrets.mjs --dist` ✓ (1,697 files) |
| env | the repo's gitignored `.env` (21 keys by name: VITE_SERVERLESS_MODE, SERVERLESS_MODE, HOST, PORT, CI, PRODUCT_NAME, ASK_ENABLED, ASK_THE_DEAL_ALLOWED_ORIGIN, ONDEMAND_ALLOW_CLIENT_KEY=0, ONDEMAND_BASE_URL, ONDEMAND_API_BASE, ONDEMAND_ENDPOINT_ID, ONDEMAND_FULFILLMENT_ENDPOINT_ID, ONDEMAND_REASONING_ENDPOINT_ID, ONDEMAND_REASONING_MODE, ONDEMAND_SPATIAL_WORKFLOW_ID, ONDEMAND_SPATIAL_FLOW_VERSION, GODS_EYE_FLOW_VERSION, ONDEMAND_VOICE_WORKFLOW_ID, ONDEMAND_SELFTEST_TOKEN, PUPPETEER_SKIP_DOWNLOAD); `ONDEMAND_API_KEY` injected ONLY into the server process (temp file sourced and deleted before the server started; `grep -c ONDEMAND_API_KEY .env` = 0 real entries, `/tmp/od-secret.env` absent afterwards) |
| server | `node server/serverless/dev-server.mjs` PID 176, `0.0.0.0:5173`, started 09:19:05Z; restarted PID 294 at 10:19:03Z after the fix rebuild |
| `GET /api/health` | **200** on the first poll **2026-10-21T09:19:13Z** — `{"ok": true, "configured": true, "conversationBackend": "memory", "contracts": 33, "activePlugins": 10, "defaultEndpointId": "predefined-gpt-6-luna", "workflowId": {"configured": true, "source": "ONDEMAND_SPATIAL_WORKFLOW_ID", "valid": true}, "guards": {"rateLimitPerMinute": 60, "userHeaderRequired": false, "promptInjectionFencing": true}, "keySource": "server"}` · header `x-ondemand-key-source: server` · re-polled 200 at 2026-10-21T09:33:33Z and 10:19:03Z (post-fix) |
| `GET /` | **200** at 2026-10-21T09:19:13Z — `<title>OnDemand Intelligence Workstation</title>` |
| ui-validator (headless Chromium, pre-fix) | 14/14 assertions at 1440×900 + 390×844 (`retry0917-health-*.png`): title exact, "OnDemand Intelligence" + "ASK ONDEMAND" present, no "God's Eye"/"GEV MIC"/"OpenAI", brand mark visible, favicon link → `/assets/brand/`, `#hud-ask-ondemand` opens `#ondemand-mini-chat[data-open=true]`, `localStorage.ondemand.apiKey` null; 0 page errors |

### 11.2 Scenario × viewport matrix — PRE-FIX (clean tree `712a552`), `scripts/qa-chat-intelligent-ui.mjs --format png`, **14 / 14 PASS** (boot: loader hidden after 9,033 ms desktop / 5,054 ms mobile)
| scenario | viewport | status | ms | checks | run_at (UTC) | screenshot (under `docs/agent-execution/`) |
|---|---|---|---|---|---|---|
| A | 1440x900 | **PASS** | 320 | 6/6 | 2026-10-21T09:26:20.320Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/A-1440x900.png` |
| B | 1440x900 | **PASS** | 5678 | 5/5 | 2026-10-21T09:26:27.154Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/B-1440x900.png` |
| C | 1440x900 | **PASS** | 6948 | 2/2 | 2026-10-21T09:26:34.558Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/C-1440x900.png` |
| D | 1440x900 | **PASS** | 11 | 4/4 | 2026-10-21T09:26:34.916Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/D-1440x900.png` |
| E | 1440x900 | **PASS** | 9 | 2/2 | 2026-10-21T09:26:35.258Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/E-1440x900.png` |
| F | 1440x900 | **PASS** | 82 | 3/3 | 2026-10-21T09:26:35.745Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/F-1440x900.png` |
| G | 1440x900 | **PASS** | 10799 | 3/3 | 2026-10-21T09:26:46.886Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/G-1440x900.png` |
| A | 390x844 | **PASS** | 134 | 6/6 | 2026-10-21T09:26:55.626Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/A-390x844.png` |
| B | 390x844 | **PASS** | 6598 | 5/5 | 2026-10-21T09:27:02.519Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/B-390x844.png` |
| C | 390x844 | **PASS** | 5838 | 2/2 | 2026-10-21T09:27:08.518Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/C-390x844.png` |
| D | 390x844 | **PASS** | 17 | 4/4 | 2026-10-21T09:27:08.676Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/D-390x844.png` |
| E | 390x844 | **PASS** | 7 | 2/2 | 2026-10-21T09:27:08.947Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/E-390x844.png` |
| F | 390x844 | **PASS** | 136 | 3/3 | 2026-10-21T09:27:09.375Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/F-390x844.png` |
| G | 390x844 | **PASS** | 7957 | 3/3 | 2026-10-21T09:27:17.492Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/orchestrator-ag/G-390x844.png` |

### 11.3 Five-agent swarm (09:32Z–10:03Z) — 99 cells: **91 PASS · 0 FAIL · 8 DEFECT · 0 UNSUPPORTED**
Agents: 1 → A,B + streaming/HUD parity + media-rendering audit · 2 → C,D + citations + empty-state assets + root-first · 3 → E,F,G + failure/retry/cancel/isolation/reload parity + 3-way concurrent isolation · 4 → plugin lifecycle (9 API probes + badge transitions) · 5 → branding + 16 brand assets. Per-agent `RESULTS.md` + `results.json` under `artifacts/sandbox-verify-2026-10-21/retry-0917/agentN/`.

| agent | check | viewport | status | run_at (UTC) | screenshot | evidence (truncated) |
|---|---|---|---|---|---|---|
| 1 | harness-scenario-A | 1440x900 | **PASS** | 2026-10-21T09:32:18.301Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/ab/A-1440x900.png` | harness 6/6 checks: app_boots=ok (Loading screen hidden or globe canvas active); title_contains_product_name=ok (document.title="OnDemand Intelligence Workstation"); no_legacy_brand_terms=ok (No forbidden terms visible); |
| 1 | harness-scenario-B | 1440x900 | **PASS** | 2026-10-21T09:32:19.381Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/ab/B-1440x900.png` | harness 5/5 checks: mini_chat_opens_earthquake=ok (Mini chat opened with data-open="true"); status_streaming_and_stop_visible=ok (streamingStatusSeen=true, stopButtonSeen=true); assistant_message_and_settle=ok (settled w |
| 1 | harness-scenario-A | 390x844 | **PASS** | 2026-10-21T09:32:35.469Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/ab/A-390x844.png` | harness 6/6 checks: app_boots=ok (Loading screen hidden or globe canvas active); title_contains_product_name=ok (document.title="OnDemand Intelligence Workstation"); no_legacy_brand_terms=ok (No forbidden terms visible); |
| 1 | harness-scenario-B | 390x844 | **PASS** | 2026-10-21T09:32:36.946Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/ab/B-390x844.png` | harness 5/5 checks: mini_chat_opens_earthquake=ok (Mini chat opened with data-open="true"); status_streaming_and_stop_visible=ok (streamingStatusSeen=true, stopButtonSeen=true); assistant_message_and_settle=ok (settled w |
| 1 | streaming-parity | 1440x900 | **PASS** | 2026-10-21T09:40:49.439Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-streaming-1440x900.png` | send-button hit-test={"rect":{"x":1195,"y":769,"w":208,"h":32},"inViewport":true,"disabled":false,"topAtCenter":"ondemand-mini-chat-send","hitsButton":true,"inputRect":{"x":1003,"y":769,"w":186,"h":32},"inputTop":"ondema |
| 1 | hud-summary-parity | 1440x900 | **PASS** | 2026-10-21T09:40:50.934Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-hud-summary-1440x900.png` | #hud-summary="NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM \| NORTH AMERICA \| ALT 627M \| WINDOW 2x1KM \| SUN -42° \| ONA 50° \| UTC-7" (ok=true); #hud-ask-ondemand present=true; chat opened=true; data-object-type=hudSummar |
| 1 | media-rendering-audit | 1440x900 | **DEFECT** | 2026-10-21T09:40:54.763Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-media-rendering-1440x900.png` | intercepted POST /api/ondemand/v2/chat=1; assistant node class="od-chat__msg od-chat__msg--assistant"; <a>=3 (.od-chat__cite=3) <img>=0 <video>=0 <picture>=0 <iframe>=0; lightbox/dialog in node=0, lightbox-ish in documen |
| 1 | streaming-parity | 390x844 | **PASS** | 2026-10-21T09:41:12.025Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-streaming-390x844.png` | send-button hit-test={"rect":{"x":205,"y":801,"w":166,"h":32},"inViewport":true,"disabled":false,"topAtCenter":"SPAN","hitsButton":false,"inputRect":{"x":13,"y":801,"w":186,"h":32},"inputTop":"SPAN","inputHit":false}; ba |
| 1 | hud-summary-parity | 390x844 | **PASS** | 2026-10-21T09:41:13.369Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-hud-summary-390x844.png` | #hud-summary="NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM \| NORTH AMERICA \| ALT 627M \| WINDOW 2x3KM \| SUN -42° \| ONA 50° \| UTC-7" (ok=true); #hud-ask-ondemand present=true; chat opened=true; data-object-type=hudSummar |
| 1 | media-rendering-audit | 390x844 | **DEFECT** | 2026-10-21T09:41:17.230Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-media-rendering-390x844.png` | intercepted POST /api/ondemand/v2/chat=1; assistant node class="od-chat__msg od-chat__msg--assistant"; <a>=3 (.od-chat__cite=3) <img>=0 <video>=0 <picture>=0 <iframe>=0; lightbox/dialog in node=0, lightbox-ish in documen |
| 1 | mobile-composer-occlusion | 390x844 | **DEFECT** | 2026-10-21T09:41:56Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-mobile-send-occlusion-390x844.png` | At 390x844 with the mini chat open (panel rect 0,484,390,360), document.elementFromPoint at the centre of #ondemand-mini-chat-send (205,801,166x32) and #ondemand-mini-chat-input (13,801,186x32) returns the serverless not |
| 2 | harness-scenario | 1440x900 | **PASS** | 2026-10-21T09:32:40.377Z | `cd/C-1440x900.png` | {"checks": [{"name": "citations_query_completed", "pass": true, "detail": "Turn completed within 90s"}, {"name": "citations_or_honest_state", "pass": true, "detail": "links=0, sourcesVisible=false, confidenceAttr=inferre |
| 2 | harness-scenario | 1440x900 | **PASS** | 2026-10-21T09:32:50.502Z | `cd/D-1440x900.png` | {"checks": [{"name": "earthquake_history_available", "pass": true, "detail": "transcript messages=2 (from earlier scenario)"}, {"name": "desktop_no_hud_brand_mark_overlap", "pass": true, "detail": "overlap=false, checked |
| 2 | harness-scenario | 390x844 | **PASS** | 2026-10-21T09:32:59.326Z | `cd/C-390x844.png` | {"checks": [{"name": "citations_query_completed", "pass": true, "detail": "Turn completed within 90s"}, {"name": "citations_or_honest_state", "pass": true, "detail": "links=0, sourcesVisible=false, confidenceAttr=inferre |
| 2 | harness-scenario | 390x844 | **PASS** | 2026-10-21T09:33:08.509Z | `cd/D-390x844.png` | {"checks": [{"name": "earthquake_history_available", "pass": true, "detail": "transcript messages=4 (from earlier scenario)"}, {"name": "mobile_viewport_fit_and_input_visible", "pass": true, "detail": "fitsViewport=true, |
| 2 | loading-screen-backdrop | 1440x900 | **PASS** | 2026-10-21T09:35:57.261Z | — | {"present": true, "hidden": false, "backgroundImage": "linear-gradient(rgba(11, 21, 38, 0.72), rgba(11, 21, 38, 0.82)), url(\"https://sb-4asza5droe1u.vercel.run/assets/brand/backdrop-network.png\")"} |
| 2 | citations-deep-check | 1440x900 | **PASS** | 2026-10-21T09:36:07.395Z | `check-citations-1440x900.png` | {"finalStatus": "READY \u00b7 inferred", "waitMs": 7363, "citeCount": 0, "hrefs": [], "allHttp": true, "sourcesVisible": false, "sourcesText": "SOURCES \u00b7 0", "sourcesCount": 0, "confidence": "inferred", "emptyState" |
| 2 | empty-state-no-sessions | 1440x900 | **PASS** | 2026-10-21T09:36:21.305Z | `check-empty-no-sessions-1440x900.png` | {"objectId": "fresh-1792575381305", "present": true, "text": "No prior investigation for this object", "before": "url(\"https://sb-4asza5droe1u.vercel.run/assets/brand/empty-no-sessions.png\")", "rect": {"w": 406, "h": 1 |
| 2 | empty-state-source-unavailable | 1440x900 | **PASS** | 2026-10-21T09:36:25.053Z | `check-empty-source-unavailable-1440x900.png` | {"waitMs": 376, "emptyPresent": true, "emptyText": "upstream_timeout (HTTP 504)", "before": "url(\"https://sb-4asza5droe1u.vercel.run/assets/brand/empty-source-unavailable.png\")", "errorMsgPresent": true, "errorText": " |
| 2 | root-first-responsive | 1440x900 | **PASS** | 2026-10-21T09:36:27.542Z | `check-rootfirst-1440x900.png` | {"vw": 1440, "vh": 900, "scrollWidth": 1440, "mini": {"x": 990, "y": 449.53125, "w": 432, "h": 362.46875, "fits": true}, "input": {"x": 1003, "y": 768.703125, "w": 186, "h": 32.296875, "visible": true}, "marks": [{"id":  |
| 2 | loading-screen-backdrop | 390x844 | **PASS** | 2026-10-21T09:39:49.260Z | — | {"present": true, "hidden": false, "backgroundImage": "linear-gradient(rgba(11, 21, 38, 0.72), rgba(11, 21, 38, 0.82)), url(\"https://sb-4asza5droe1u.vercel.run/assets/brand/backdrop-network.png\")"} |
| 2 | citations-deep-check | 390x844 | **PASS** | 2026-10-21T09:39:59.724Z | `check-citations-390x844.png` | {"finalStatus": "READY \u00b7 inferred", "waitMs": 7039, "newMsgs": 2, "citeCount": 0, "hrefs": [], "allHttp": true, "sourcesVisible": false, "sourcesText": "SOURCES \u00b7 0", "sourcesCount": 0, "confidence": "inferred" |
| 2 | empty-state-no-sessions | 390x844 | **PASS** | 2026-10-21T09:40:09.927Z | `check-empty-no-sessions-390x844.png` | {"objectId": "fresh-1792575609927", "present": true, "text": "No prior investigation for this object", "before": "url(\"https://sb-4asza5droe1u.vercel.run/assets/brand/empty-no-sessions.png\")", "rect": {"w": 364, "h": 1 |
| 2 | empty-state-source-unavailable | 390x844 | **PASS** | 2026-10-21T09:40:11.907Z | `check-empty-source-unavailable-390x844.png` | {"waitMs": 6, "newMsgs": 2, "emptyPresent": true, "emptyText": "upstream_timeout (HTTP 504)", "before": "url(\"https://sb-4asza5droe1u.vercel.run/assets/brand/empty-source-unavailable.png\")", "errorMsgPresent": true, "e |
| 2 | root-first-responsive | 390x844 | **PASS** | 2026-10-21T09:40:13.056Z | `check-rootfirst-390x844.png` | {"vw": 390, "vh": 844, "scrollWidth": 390, "mini": {"x": 0, "y": 481.53125, "w": 390, "h": 362.46875, "fits": true}, "input": {"x": 13, "y": 800.703125, "w": 186, "h": 32.296875, "visible": true}, "marks": [{"id": "title |
| 2 | composer-pointer-hit-test | 1440x900 | **PASS** | 2026-10-21T09:41:26.185Z | `check-send-hittest-1440x900.png` | {"send_rect": {"x": 1195, "y": 768.703125, "w": 208, "h": 32.296875, "bottom": 801}, "input_rect": {"x": 1003, "y": 768.703125, "w": 186, "h": 32.296875, "bottom": 801}, "send_center_hits_send": true, "input_center_hits_ |
| 2 | composer-pointer-hit-test | 390x844 | **DEFECT** | 2026-10-21T09:41:26.185Z | `check-send-hittest-390x844.png` | {"send_rect": {"x": 205, "y": 800.703125, "w": 166, "h": 32.296875, "bottom": 833}, "input_rect": {"x": 13, "y": 800.703125, "w": 186, "h": 32.296875, "bottom": 833}, "send_center_hits_send": false, "input_center_hits_in |
| 3 | harness-scenario | 1440x900 | **PASS** | 2026-10-21T09:33:09.332Z | `agent3/efg/E-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "checks": [{"name": "history_messages_present_before_switch", "pass": true, "detail": "Found 2 prior messages in transcript"}, {"name": "session_isolated_for_different_object |
| 3 | harness-scenario | 1440x900 | **PASS** | 2026-10-21T09:33:16.712Z | `agent3/efg/F-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "checks": [{"name": "active_plugins_cap_and_id_regex", "pass": true, "detail": "activePlugins=10/10, validPluginIds=33/33"}, {"name": "plugin_panel_lifecycle_states", "pass": |
| 3 | harness-scenario | 1440x900 | **PASS** | 2026-10-21T09:33:17.998Z | `agent3/efg/G-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "checks": [{"name": "synthetic_502_error_ui", "pass": true, "detail": "Rendered .od-chat__msg--error and status TURN FAILED / source-unavailable"}, {"name": "retry_recovery_t |
| 3 | harness-scenario | 390x844 | **PASS** | 2026-10-21T09:33:32.944Z | `agent3/efg/E-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "checks": [{"name": "history_messages_present_before_switch", "pass": true, "detail": "Found 7 prior messages in transcript"}, {"name": "session_isolated_for_different_object |
| 3 | harness-scenario | 390x844 | **PASS** | 2026-10-21T09:33:38.219Z | `agent3/efg/F-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "checks": [{"name": "active_plugins_cap_and_id_regex", "pass": true, "detail": "activePlugins=10/10, validPluginIds=33/33"}, {"name": "plugin_panel_lifecycle_states", "pass": |
| 3 | harness-scenario | 390x844 | **PASS** | 2026-10-21T09:33:38.439Z | `agent3/efg/G-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "checks": [{"name": "synthetic_502_error_ui", "pass": true, "detail": "Rendered .od-chat__msg--error and status TURN FAILED / source-unavailable"}, {"name": "retry_recovery_t |
| 3 | failure | 1440x900 | **PASS** | 2026-10-21T09:41:16.988Z | `agent3/check-failure-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "intercepted": 1, "status": "TURN FAILED", "emptyState": {"kind": "source-unavailable", "text": "upstream_error \u00b7 Synthetic 502 (HTTP 502)"}, "errorMsgs": 1, "transcript |
| 3 | retry-recovery | 1440x900 | **PASS** | 2026-10-21T09:41:22.633Z | `agent3/check-recovery-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "status": "READY \u00b7 inferred", "chatResponse": {"status": 200, "keySource": "server", "at": "2026-10-21T09:41:24.112Z"}, "assistantLen": 107, "assistantPreview": "Parity  |
| 3 | cancel | 1440x900 | **PASS** | 2026-10-21T09:41:29.940Z | `agent3/check-cancel-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "status": "CANCELLED", "cancel_latency_ms": 2, "lenAfterCancel": 9, "lenAfter3s": 9, "run_log": "agent3/parity-run1-desktop.log"} |
| 3 | isolation | 1440x900 | **PASS** | 2026-10-21T09:41:33.313Z | `agent3/check-isolation-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "alertMsgs": 0, "alertEmptyState": {"kind": "no-sessions", "text": "No prior investigation for this object"}, "alertContainsFire": false, "fireMsgsBefore": 6, "fireMsgsReplay |
| 3 | reload-persistence | 1440x900 | **PASS** | 2026-10-21T09:41:42.563Z | `agent3/check-reload-persist-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "restoredMsgs": 2, "historyAttr": 2, "messagesResponses": [{"status": 200, "at": "2026-10-21T09:41:51.123Z"}], "preview": ["Recover: summarize this object in one sentence.",  |
| 3 | failure | 390x844 | **PASS** | 2026-10-21T09:52:05.550Z | `agent3/check-failure-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "intercepted": 1, "status": "TURN FAILED", "emptyState": {"kind": "source-unavailable", "text": "upstream_error \u00b7 Synthetic 502 (HTTP 502)"}, "errorMsgs": 1, "transcript |
| 3 | retry-recovery | 390x844 | **PASS** | 2026-10-21T09:52:08.491Z | `agent3/check-recovery-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "status": "READY \u00b7 inferred", "chatResponse": {"status": 200, "keySource": "server", "at": "2026-10-21T09:52:09.093Z"}, "assistantLen": 104, "assistantPreview": "Confirm |
| 3 | cancel | 390x844 | **PASS** | 2026-10-21T09:52:14.645Z | `agent3/check-cancel-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "status": "CANCELLED", "cancel_latency_ms": 5, "lenAfterCancel": 9, "lenAfter3s": 9, "run_log": "agent3/parity-run2-mobile.log"} |
| 3 | isolation | 390x844 | **PASS** | 2026-10-21T09:52:17.811Z | `agent3/check-isolation-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "alertMsgs": 0, "alertEmptyState": {"kind": "no-sessions", "text": "No prior investigation for this object"}, "alertContainsFire": false, "fireMsgsBefore": 6, "fireMsgsReplay |
| 3 | reload-persistence | 390x844 | **PASS** | 2026-10-21T09:52:26.645Z | `agent3/check-reload-persist-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "restoredMsgs": 2, "historyAttr": 2, "messagesResponses": [{"status": 200, "at": "2026-10-21T09:52:34.924Z"}], "preview": ["Recover: summarize this object in one sentence.",  |
| 3 | 3way-isolation | 1440x900 | **PASS** | 2026-10-21T09:52:37.462Z | `agent3/check-3way-isolation-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "storageKey": "ondemand.v2.externalUserId.default", "externalUserIds": ["iso-user-1-0917", "iso-user-2-0917", "iso-user-3-0917"], "perPage": [{"page": 1, "userId": "iso-user- |
| 3 | composer-hit-testable-under-serverless-banner | 1440x900 | **PASS** | 2026-10-21T10:03:00Z | `agent3/check-banner-occlusion-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "bannerPresent": true, "banner": {"x": 400, "y": 813, "w": 640, "h": 75}, "send": {"x": 1195, "y": 769, "w": 208, "h": 32}, "input": {"x": 1003, "y": 769, "w": 186, "h": 32}, |
| 3 | composer-hit-testable-under-serverless-banner | 390x844 | **DEFECT** | 2026-10-21T10:03:00Z | `agent3/check-banner-occlusion-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run", "bannerPresent": true, "banner": {"x": 12, "y": 739, "w": 366, "h": 93}, "send": {"x": 205, "y": 801, "w": 166, "h": 32}, "input": {"x": 13, "y": 801, "w": 186, "h": 32}, "se |
| 4 | A1 GET /api/ondemand/v2/health | n/a | **PASS** | 2026-10-21T09:33:47Z | — | {"http": 200, "contracts": 33, "activePlugins": 10, "keySource": "server", "configured": true, "raw": "agent4/api/01-health-v2.json"} |
| 4 | A1 GET /api/health | n/a | **PASS** | 2026-10-21T09:33:47Z | — | {"http": 200, "contracts": 33, "activePlugins": 10, "keySource": "server", "configured": true, "raw": "agent4/api/01-health.json"} |
| 4 | A2 GET /api/ondemand/v2/contracts — kind counts, pluginId format, acti | n/a | **PASS** | 2026-10-21T09:33:47Z | — | {"http": 200, "total": 33, "byKind": {"ondemand-plugin": 11, "ondemand-tool": 21, "ondemand-workflow": 1}, "nonNullPluginIds": 11, "badPluginIds": [], "activePluginCount": 10, "activePlugins": ["perplexity_research", "in |
| 4 | A3 GET /plugins (before) | n/a | **PASS** | 2026-10-21T09:33:47Z | — | {"http": 200, "count": 32, "byState": {"discovered": 32}, "generatedAt": "2026-10-21T09:33:47.449Z", "raw": "agent4/api/03-plugins-before.json"} |
| 4 | A4 POST /plugins/verify internet_web_search (X-Workstation-User: agent | n/a | **PASS** | 2026-10-21T09:34:07Z | — | {"http": 200, "state": "ready", "latencyMs": 4788, "verifiedAt": "2026-10-21T09:34:11.946Z", "pluginId": "plugin-1713924030", "answerPreview": "READY", "raw": "agent4/api/04-verify-internet.json"} |
| 4 | A5 POST /plugins/verify x_mcp_connector → failed/inactive_on_account | n/a | **PASS** | 2026-10-21T09:34:11Z | — | {"http": 200, "state": "failed", "error": {"code": "inactive_on_account", "httpStatus": 400, "message": "This research source is currently inactive on the OnDemand account.", "retryable": false, "failedAt": "2026-10-21T0 |
| 4 | A6 POST /plugins/verify names:[] → all active plugins | n/a | **PASS** | 2026-10-21T09:34:12Z | — | {"http": 200, "count": 10, "ready": 10, "perPlugin": [{"name": "perplexity_research", "pluginId": "plugin-1722260873", "state": "ready", "latencyMs": 5048}, {"name": "internet_web_search", "pluginId": "plugin-1713924030" |
| 4 | A7 GET /plugins (after) — 10 ready / 1 failed / 21 discovered + diff v | n/a | **PASS** | 2026-10-21T09:34:18Z | — | {"http": 200, "byStateBefore": {"discovered": 32}, "byStateAfter": {"ready": 10, "failed": 1, "discovered": 21}, "diff": [{"name": "perplexity_research", "from": "discovered", "to": "ready"}, {"name": "internet_web_searc |
| 4 | A8 POST /plugins/verify header someone-else vs body agent4-probe → 403 | n/a | **PASS** | 2026-10-21T09:34:18Z | — | {"http": 403, "body": {"error": "user_mismatch"}, "raw": "agent4/api/08-verify-mismatch.json"} |
| 4 | A9 POST /plugins/verify names:["does_not_exist"] → honest error (expec | n/a | **DEFECT** | 2026-10-21T09:34:18Z | — | {"http": 500, "body": {"error": "internal_error"}, "assessment": "Honest (no fake ready, no plugins array) but wrong status/code: verify() throws Error(\"Unknown plugin contract: \u2026\") inside handle() with no try/cat |
| 4 | B1 panel located + initial badge counts | 1440x900 | **PASS** | 2026-10-21T09:35:08.007Z | `agent4/browser/check-plugins-initial-1440x900.png` | {"mountedIn": "#ondemand-plugin-dock (floating dock; mini chat not yet in DOM at install time)", "detailsOpen": true, "toggleNeeded": false, "summary": "10 ready", "rows": 32, "countsByState": {"ready": 10, "failed": 1,  |
| 4 | B2 click VERIFY internet_web_search → READY + latency | 1440x900 | **PASS** | 2026-10-21T09:58:13.072Z | `agent4/browser/check-plugins-dock-ready-1440x900.png` | {"run": "run5 (dock only, mini chat closed, real page.click)", "clicked_at": "2026-10-21T09:58:13.072Z", "hitTestReachesTarget": true, "mutation_sequence(t_ms,button,data-state,badge)": [[0, "VERIFY", "ready", "READY"],  |
| 4 | B3 click VERIFY x_mcp_connector → FAILED inactive-on-account | 1440x900 | **PASS** | 2026-10-21T09:58:19.220Z | `agent4/browser/check-plugins-dock-failed-1440x900.png` | {"run": "run5", "clicked_at": "2026-10-21T09:58:19.220Z", "mutation_sequence(t_ms,button,data-state,badge)": [[0, "VERIFY", "failed", "FAILED"], [27, "VERIFYING\u2026", "failed", "FAILED"], [43, "VERIFY", "failed", "FAIL |
| 4 | B4 window.__odPlugins.getSelectedPluginIds() ≤10 ids /^plugin-\d{10}$/ | 1440x900 | **PASS** | 2026-10-21T09:35:08.007Z | `agent4/browser/check-plugins-initial-1440x900.png` | {"defaultSelection": [], "afterCheckingEveryEnabledToggle": {"count": 31, "pluginIds": ["plugin-1722260873", "plugin-1713924030", "plugin-1741871229", "plugin-1751872652", "plugin-1716372717", "plugin-1716164040", "plugi |
| 4 | B5 pointer reachability of PLUGINS panel while mini chat is open | 1440x900 | **DEFECT** | 2026-10-21T09:48:25.426Z | `agent4/browser/check-plugins-overlay-1440x900.png` | {"run": "run4 overlay + run3 click comparison", "panel": {"sel": "section#ondemand-plugin-panel.od-plugins", "rect": {"x": 1038, "y": 500, "w": 384, "h": 376}, "position": "static", "zIndex": "auto", "pointerEvents": "au |
| 4 | B1 panel located + initial badge counts | 390x844 | **PASS** | 2026-10-21T09:36:25.145Z | `agent4/browser/check-plugins-initial-390x844.png` | {"mountedIn": "#ondemand-plugin-dock (floating dock; mini chat not yet in DOM at install time)", "detailsOpen": true, "toggleNeeded": false, "summary": "10 ready", "rows": 32, "countsByState": {"ready": 10, "failed": 1,  |
| 4 | B2 click VERIFY internet_web_search → READY + latency | 390x844 | **PASS** | 2026-10-21T09:58:29.362Z | `agent4/browser/check-plugins-dock-ready-390x844.png` | {"run": "run5 (dock only, mini chat closed, real page.click)", "clicked_at": "2026-10-21T09:58:29.362Z", "hitTestReachesTarget": true, "mutation_sequence(t_ms,button,data-state,badge)": [[0, "VERIFY", "ready", "READY"],  |
| 4 | B3 click VERIFY x_mcp_connector → FAILED inactive-on-account | 390x844 | **PASS** | 2026-10-21T09:58:29.964Z | `agent4/browser/check-plugins-dock-failed-390x844.png` | {"run": "run5", "clicked_at": "2026-10-21T09:58:29.964Z", "mutation_sequence(t_ms,button,data-state,badge)": [[0, "VERIFY", "failed", "FAILED"], [24, "VERIFYING\u2026", "failed", "FAILED"], [45, "VERIFY", "failed", "FAIL |
| 4 | B4 window.__odPlugins.getSelectedPluginIds() ≤10 ids /^plugin-\d{10}$/ | 390x844 | **PASS** | 2026-10-21T09:36:25.145Z | `agent4/browser/check-plugins-initial-390x844.png` | {"defaultSelection": [], "afterCheckingEveryEnabledToggle": {"count": 31, "pluginIds": ["plugin-1722260873", "plugin-1713924030", "plugin-1741871229", "plugin-1751872652", "plugin-1716372717", "plugin-1716164040", "plugi |
| 4 | B5 pointer reachability of PLUGINS panel while mini chat is open | 390x844 | **DEFECT** | 2026-10-21T09:48:37.608Z | `agent4/browser/check-plugins-overlay-390x844.png` | {"run": "run4 overlay + run3 click comparison", "panel": {"sel": "section#ondemand-plugin-panel.od-plugins", "rect": {"x": 14, "y": 444, "w": 358, "h": 376}, "position": "static", "zIndex": "auto", "pointerEvents": "auto |
| 5 | identity | 1440x900 | **PASS** | 2026-10-21T09:34:42.545Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "title": "OnDemand Intelligence Workstation", "wordmark": "OnDemand Intelligence Worksta |
| 5 | loading-screen-backdrop | 1440x900 | **PASS** | 2026-10-21T09:34:54.752Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "backgroundImage": "linear-gradient(rgba(11, 21, 38, 0.72), rgba(11, 21, 38, 0.82)), url |
| 5 | legacy-terms | 1440x900 | **PASS** | 2026-10-21T09:34:54.788Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "user_facing_hits": 0, "hits": [], "internal_identifiers_allowed": ["style[id=\"gev-scre |
| 5 | eye-motif | 1440x900 | **PASS** | 2026-10-21T09:34:54.890Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "assets_scanned": 54, "flagged": [{"kind": "svg", "url": "scan-eye", "title": "", "desc" |
| 5 | mini-chat-open | 1440x900 | **PASS** | 2026-10-21T09:34:59.776Z | `agent5/check-branding-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "chatOpen": true, "pluginPanel": {"present": true, "open": true, "rows": 32, "summary":  |
| 5 | legacy-terms | 1440x900 | **PASS** | 2026-10-21T09:34:59.776Z | `agent5/check-branding-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "user_facing_hits": 0, "hits": [], "internal_identifiers_allowed": ["style[id=\"gev-scre |
| 5 | eye-motif | 1440x900 | **PASS** | 2026-10-21T09:34:59.776Z | `agent5/check-branding-1440x900.png` | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "assets_scanned": 56, "flagged": [{"kind": "svg", "url": "scan-eye", "title": "", "desc" |
| 5 | identity | 390x844 | **PASS** | 2026-10-21T09:35:00.337Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "title": "OnDemand Intelligence Workstation", "wordmark": "OnDemand Intelligence Worksta |
| 5 | loading-screen-backdrop | 390x844 | **PASS** | 2026-10-21T09:35:09.898Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "backgroundImage": "linear-gradient(rgba(11, 21, 38, 0.72), rgba(11, 21, 38, 0.82)), url |
| 5 | legacy-terms | 390x844 | **PASS** | 2026-10-21T09:35:09.925Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "user_facing_hits": 0, "hits": [], "internal_identifiers_allowed": ["style[id=\"gev-scre |
| 5 | eye-motif | 390x844 | **PASS** | 2026-10-21T09:35:10.006Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "assets_scanned": 54, "flagged": [{"kind": "svg", "url": "scan-eye", "title": "", "desc" |
| 5 | mini-chat-open | 390x844 | **PASS** | 2026-10-21T09:35:13.722Z | `agent5/check-branding-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "chatOpen": true, "pluginPanel": {"present": true, "open": true, "rows": 32, "summary":  |
| 5 | legacy-terms | 390x844 | **PASS** | 2026-10-21T09:35:13.722Z | `agent5/check-branding-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "user_facing_hits": 0, "hits": [], "internal_identifiers_allowed": ["style[id=\"gev-scre |
| 5 | eye-motif | 390x844 | **PASS** | 2026-10-21T09:35:13.722Z | `agent5/check-branding-390x844.png` | {"url": "https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical", "assets_scanned": 56, "flagged": [{"kind": "svg", "url": "scan-eye", "title": "", "desc" |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:02Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/mark-primary.png", "http_status": 200, "content_type": "image/png", "bytes": 828607, "sha256": "43abf5cc21779088c665d9b9b3d9e58f28d08e20974d75716304b637b919bd3d",  |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:03Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/mark-mono.png", "http_status": 200, "content_type": "image/png", "bytes": 882285, "sha256": "e38da23ac4f292dc57555af16258f7c22e54cfc50545e6d59c499afbb7133b5a", "ca |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:05Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/empty-no-results.png", "http_status": 200, "content_type": "image/png", "bytes": 854662, "sha256": "91c63a81ed15f52ade8dff2bca6a8d03888eae88c2aca72bbb58b24b28f2363 |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:10Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/empty-no-sessions.png", "http_status": 200, "content_type": "image/png", "bytes": 833892, "sha256": "99986406498b95f24f70557a203369b71d2a65921196fac8decfe3c2d4add7 |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:20Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/empty-source-unavailable.png", "http_status": 200, "content_type": "image/png", "bytes": 851438, "sha256": "9722bbf35ca0dfcdffd1598378751f2f405a7a86ac100d2a84c0cb4 |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:21Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/backdrop-network.png", "http_status": 200, "content_type": "image/png", "bytes": 1243829, "sha256": "cba96745119c9aa84b8383aed402f3349788d8896d5d2753e246448df5710b |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:22Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/mark-variant-a.png", "http_status": 200, "content_type": "image/png", "bytes": 770292, "sha256": "0556ca19503c624cce8670cfd17aa9d9ea69e2d2e3ba37ef14aea0cb73aaeb51" |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:23Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/mark-variant-b.png", "http_status": 200, "content_type": "image/png", "bytes": 848084, "sha256": "f7ea09b785ea93a3897241b805584852be3dc67ebc04ed1d978e22855bea8efa" |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:24Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/favicon.ico", "http_status": 200, "content_type": "image/x-icon", "bytes": 655, "sha256": "fdd1dc86e6bfcf25f22df8edf59af02bf979b38fb99a6dbbbf4cc6c3fe8757d0", "cata |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:25Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/apple-touch-icon.png", "http_status": 200, "content_type": "image/png", "bytes": 30314, "sha256": "ca5a07dc2d5a3ab67546837dcd3ba9526112ad1f44f6b12d360cc877422e13c6 |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:25Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/android-chrome-192.png", "http_status": 200, "content_type": "image/png", "bytes": 34284, "sha256": "0d8df8839bdda401a4e605120f7bc4d8de3735469c18e9e09e73bb9d1d87a2 |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:26Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/android-chrome-512.png", "http_status": 200, "content_type": "image/png", "bytes": 231053, "sha256": "bc5d55abb81cd40ec72759fea9ba6f23e77fe35322fbf350fecd618b731a2 |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:26Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/favicon-16.png", "http_status": 200, "content_type": "image/png", "bytes": 638, "sha256": "e9cab6f53df06debf1d6f9482996c6c0b784c1f438a2127ac8e8e741f0fdd068", "cata |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:27Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/favicon-32.png", "http_status": 200, "content_type": "image/png", "bytes": 1714, "sha256": "c6666d54405b2c41652e9d26d24b34980301aec28e0c8cc56a8a69b588eed281", "cat |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:28Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/favicon-48.png", "http_status": 200, "content_type": "image/png", "bytes": 3143, "sha256": "b561065689cfc438ff27c8520da3a6f6ef3d68387eac731474a79d984b7b35fd", "cat |
| 5 | brand-asset | n/a | **PASS** | 2026-10-21T09:36:28Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/og-image.png", "http_status": 200, "content_type": "image/png", "bytes": 515862, "sha256": "93ddea86633a972d9481f60d17a3d21e3d555aa639c63b57cbeb75cb65a5e9d9", "cat |
| 5 | webmanifest | n/a | **PASS** | 2026-10-21T09:37:16Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/brand/site.webmanifest", "http_status": 200, "content_type": "application/octet-stream", "name": "OnDemand Intelligence Workstation", "icons": {"/assets/brand/android-chrome-19 |
| 5 | favicon-resolves | n/a | **PASS** | 2026-10-21T09:37:16Z | — | {"url": "https://sb-4asza5droe1u.vercel.run/assets/brand/favicon.ico", "http_status": 200, "content_type": "image/x-icon", "bytes": 655} |
| 5 | css-empty-state-wiring | n/a | **PASS** | 2026-10-21T09:38:28Z | — | {"lines": {"549-551": ".od-empty-state--no-results::before { background-image: url(/assets/brand/empty-no-results.png) }", "552-554": ".od-empty-state--no-sessions::before { background-image: url(/assets/brand/empty-no-s |

### 11.4 Defects → fixes (all four fixed in source, re-verified on the same sandbox after `vite build` 7.67 s + `check-no-secrets --dist` ✓ + server restart 10:19:03Z)
| id | severity | defect | found by | fix | evidence |
|---|---|---|---|---|---|
| R17-D1 | medium | Serverless notice banner occluded the mini-chat composer at 390×844 | agents 1,2,3 | banner z-index 180 (below both chat panels 185/186 and key setup 190) + syncWithChatPanels(): hidden while #ondemand-mini-chat / #ondemand-entity-chat is open, restored on close (MutationObserver on the panels + gev:ask-object fast path); unit tests src/server | before: `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-mobile-send-occlusion-390x844.png`, `artifacts/sandbox-verify-2026-10-21/retry-0917/agent2/check-send-hittest-390x844.png` · after: `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-composer-hittest-390x844.png`, `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-composer-hittest-1440x900.png` |
| R17-D2 | medium | Deliverable media rendered as plain anchors (no thumbnails/lightbox/poster/side pane) | agents 1 | tokenizeAnswer/classifyMediaUrl/renderDeliverables: documents side by side in a .od-chat__deliverables grid, images as lazy <img> thumbnails that open #ondemand-mini-chat-lightbox, videos as a muted preload=metadata poster (no autoplay, no controls) that opens | before: `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-media-rendering-1440x900.png`, `artifacts/sandbox-verify-2026-10-21/retry-0917/agent1/check-media-rendering-390x844.png` · after: `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-media-rendering-1440x900.png`, `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-media-rendering-390x844.png` |
| R17-D3 | medium | Open mini chat (z 186) covered the PLUGINS dock (z 184) — VERIFY/REFRESH unreachable by pointer | agents 4 | src/ui/styles/plugin-panel.css: body:has(#ondemand-mini-chat[data-open=true]) moves the dock left of the chat (and left of the media pane when open); at ≤640px it stacks above the chat sheet. | before: `artifacts/sandbox-verify-2026-10-21/retry-0917/agent4/browser/check-plugins-overlay-1440x900.png`, `artifacts/sandbox-verify-2026-10-21/retry-0917/agent4/browser/check-plugins-overlay-390x844.png` · after: `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-plugin-dock-hittest-1440x900.png`, `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-plugin-dock-hittest-390x844.png` |
| R17-D4 | low | POST /plugins/verify with an unknown plugin name answered 500 internal_error | agents 4 | server/ondemand/foundation/plugin-lifecycle.js: names outside the registry → 404 {error:"unknown_plugin", unknown:[…]} before any verify() runs; unit test added (plugin-lifecycle.test.mjs 14/14). | before: `artifacts/sandbox-verify-2026-10-21/retry-0917/agent4/api/` · after: `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/verify-unknown-plugin-after.json` |

Unit tests added: `src/serverlessMode.test.mjs` (5), `src/ondemand/miniChat.media.test.mjs` (7), `plugin-lifecycle.test.mjs` +1 (14/14). Gates after the fixes: `format:check` 965 ✓ · `check:boundaries` ✓ · `check:secrets` ✓ · `npm test` src **4,203 → 4,202 pass / 0 fail / 1 win32-only skip** · foundation 77/77 · ondemand 250/250 · serverless 57/57 · tools 45/45 · providers+sources 56/56 (**4,688 · 4,687 pass · 0 fail · 1 skipped**).

### 11.5 Scenario × viewport matrix — POST-FIX (same sandbox, rebuilt tree), **14 / 14 PASS**
| scenario | viewport | status | ms | checks | run_at (UTC) | screenshot (under `docs/agent-execution/`) |
|---|---|---|---|---|---|---|
| A | 1440x900 | **PASS** | 254 | 6/6 | 2026-10-21T10:22:15.832Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/A-1440x900.png` |
| B | 1440x900 | **PASS** | 11273 | 5/5 | 2026-10-21T10:22:28.320Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/B-1440x900.png` |
| C | 1440x900 | **PASS** | 26205 | 2/2 | 2026-10-21T10:22:54.967Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/C-1440x900.png` |
| D | 1440x900 | **PASS** | 10 | 4/4 | 2026-10-21T10:22:55.342Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/D-1440x900.png` |
| E | 1440x900 | **PASS** | 22 | 2/2 | 2026-10-21T10:22:55.705Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/E-1440x900.png` |
| F | 1440x900 | **PASS** | 80 | 3/3 | 2026-10-21T10:22:56.233Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/F-1440x900.png` |
| G | 1440x900 | **PASS** | 7206 | 3/3 | 2026-10-21T10:23:03.817Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/G-1440x900.png` |
| A | 390x844 | **PASS** | 155 | 6/6 | 2026-10-21T10:23:12.547Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/A-390x844.png` |
| B | 390x844 | **PASS** | 5604 | 5/5 | 2026-10-21T10:23:18.651Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/B-390x844.png` |
| C | 390x844 | **PASS** | 6499 | 2/2 | 2026-10-21T10:23:25.299Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/C-390x844.png` |
| D | 390x844 | **PASS** | 11 | 4/4 | 2026-10-21T10:23:25.478Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/D-390x844.png` |
| E | 390x844 | **PASS** | 18 | 2/2 | 2026-10-21T10:23:25.622Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/E-390x844.png` |
| F | 390x844 | **PASS** | 69 | 3/3 | 2026-10-21T10:23:26.013Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/F-390x844.png` |
| G | 390x844 | **PASS** | 5893 | 3/3 | 2026-10-21T10:23:32.037Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/ag/G-390x844.png` |

### 11.6 After-fix checks (`/tmp/after-fixes.mjs`, sanctioned Puppeteer launch block, real pointer: `mouse.click` desktop / `touchscreen.tap` mobile), **16 / 16 PASS**
| check | viewport | status | run_at (UTC) | screenshot | evidence |
|---|---|---|---|---|---|
| mobile_composer_not_occluded_by_banner | 1440x900 | **PASS** | 2026-10-21T10:23:54.380Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-composer-hittest-1440x900.png` | bannerBefore={"present":true,"hidden":false,"z":"180"} bannerWhileChatOpen={"present":true,"hidden":true,"display":"flex"} hit={"ondemand-mini-chat-input":{"rect":{"x":1003,"y":769,"w":186,"h":32},"to |
| real_pointer_send_delivers_message | 1440x900 | **PASS** | 2026-10-21T10:23:54.719Z | `—` | pointer=mouse.click userMessages=1 settled=true |
| media_deliverables_render_thumb_poster_doc_no_autoplay | 1440x900 | **PASS** | 2026-10-21T10:23:56.293Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-media-rendering-1440x900.png` | {"anchors":4,"imgs":1,"videos":1,"autoplayVideos":0,"videoAutoplayProp":false,"videoControls":false,"videoPaused":true,"gridDisplay":"grid","gridCols":3,"cards":[{"media":"document","x":1013,"y":610," |
| image_thumbnail_opens_lightbox | 1440x900 | **PASS** | 2026-10-21T10:23:57.776Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-lightbox-1440x900.png` | lightbox={"open":"true","hidden":false,"display":"grid","src":"https://example.com/figure.png","z":"188","role":"dialog"} closedAfterX=true |
| video_poster_opens_side_pane_no_autoplay | 1440x900 | **PASS** | 2026-10-21T10:23:59.488Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-video-sidepane-1440x900.png` | {"open":"true","display":"flex","media":"video","hasVideo":true,"controls":true,"autoplay":false,"paused":true,"rect":{"x":498,"y":504,"w":480,"h":308},"overlapsChat":false,"streamAutoplay":0} |
| document_card_opens_pdf_preview | 1440x900 | **PASS** | 2026-10-21T10:24:01.102Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-doc-preview-1440x900.png` | {"open":"true","media":"document","iframe":true,"iframeSrc":"https://example.com/brief.pdf","sandbox":""} |
| plugin_dock_reachable_while_chat_open | 1440x900 | **PASS** | 2026-10-21T10:24:02.307Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-plugin-dock-hittest-1440x900.png` | {"present":true,"dockRect":{"x":594,"y":500,"w":384,"h":376},"chatRect":{"x":990,"y":436,"w":432,"h":376},"verifyHitsSelf":true,"topId":"od-plugin__verify","overlapsChat":false,"right":"462px"} |
| banner_restored_after_chat_close | 1440x900 | **PASS** | 2026-10-21T10:24:02.611Z | `—` | {"hidden":false} |
| mobile_composer_not_occluded_by_banner | 390x844 | **PASS** | 2026-10-21T10:24:11.977Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-composer-hittest-390x844.png` | bannerBefore={"present":true,"hidden":false,"z":"180"} bannerWhileChatOpen={"present":true,"hidden":true,"display":"flex"} hit={"ondemand-mini-chat-input":{"rect":{"x":13,"y":801,"w":186,"h":32},"topI |
| real_pointer_send_delivers_message | 390x844 | **PASS** | 2026-10-21T10:24:12.137Z | `—` | pointer=touchscreen.tap userMessages=1 settled=true |
| media_deliverables_render_thumb_poster_doc_no_autoplay | 390x844 | **PASS** | 2026-10-21T10:24:12.464Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-media-rendering-390x844.png` | {"anchors":4,"imgs":1,"videos":1,"autoplayVideos":0,"videoAutoplayProp":false,"videoControls":false,"videoPaused":true,"gridDisplay":"grid","gridCols":3,"cards":[{"media":"document","x":23,"y":652,"w" |
| image_thumbnail_opens_lightbox | 390x844 | **PASS** | 2026-10-21T10:24:13.186Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-lightbox-390x844.png` | lightbox={"open":"true","hidden":false,"display":"grid","src":"https://example.com/figure.png","z":"188","role":"dialog"} closedAfterX=true |
| video_poster_opens_side_pane_no_autoplay | 390x844 | **PASS** | 2026-10-21T10:24:13.838Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-video-sidepane-390x844.png` | {"open":"true","display":"flex","media":"video","hasVideo":true,"controls":true,"autoplay":false,"paused":true,"rect":{"x":0,"y":17,"w":390,"h":236},"overlapsChat":false,"streamAutoplay":0} |
| document_card_opens_pdf_preview | 390x844 | **PASS** | 2026-10-21T10:24:14.269Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-doc-preview-390x844.png` | {"open":"true","media":"document","iframe":true,"iframeSrc":"https://example.com/brief.pdf","sandbox":""} |
| plugin_dock_reachable_while_chat_open | 390x844 | **PASS** | 2026-10-21T10:24:14.437Z | `artifacts/sandbox-verify-2026-10-21/retry-0917/fixes-after/check-plugin-dock-hittest-390x844.png` | {"present":true,"dockRect":{"x":0,"y":17,"w":390,"h":236},"chatRect":{"x":0,"y":462,"w":390,"h":382},"verifyHitsSelf":true,"topId":"od-plugin__verify","overlapsChat":false,"right":"0px"} |
| banner_restored_after_chat_close | 390x844 | **PASS** | 2026-10-21T10:24:14.739Z | `—` | {"hidden":false} |

ui-validator post-fix (`retry0917-after-fixes-*.png`): 15/15 at both viewports — banner `hidden === true` while the chat is open, `elementFromPoint` on `#ondemand-mini-chat-send` / `-input` hits the composer, `#ondemand-plugin-dock` does not overlap `#ondemand-mini-chat`, title exact, no legacy terms, no browser key; 0 page errors. `POST /plugins/verify names:["does_not_exist"]` → **404** `unknown_plugin` at 10:26:15Z (was 500).

### 11.7 Observations (not defects)
- Scenario-A deliverable media requirement did not exist in the app before this cycle; it is now implemented and covered by unit tests + browser checks (11.4 R17-D2, 11.6).
- Lucide `scan-eye` glyph is the DISPLAY › HUD toggle icon (a viewfinder pictogram from the icon set) — not an eye-motif brand asset.
- `/brand/site.webmanifest` is served as `application/octet-stream` by the dev server (cosmetic; Vercel serves the right type).
- `__odPlugins.getSelectedPluginIds()` also returns tool-route names when tool toggles are checked (no functional impact; ids still ≤ 10 and regex-valid).
- Known-benign console/network lines unchanged (`/api/setup/status` 404, `/messages` 404 on a never-queried object).

GENERATED_UTC: 2026-10-21T10:35:00Z

## 12. Cycle 7 (2026-10-21T12:28Z–12:37Z) — ASAP redeploy + verify (do-not-return-until-live)

Old preview `https://sb-4asza5droe1u.vercel.run` checked 12:28:02Z: HTTP 410 SANDBOX_STOPPED (expired) → brand-new sandbox per RESUME recipe. Source = clean tree `a16b8d9` on `integration/ondemand-native` (also fallback zip code-files-20261021-103540_v1.zip).

| item | value |
|---|---|
| sandbox | `sbx_USYsCwFiUaGGciwp11ULdOh9o8HA` → **https://sb-3zg3okfus095.vercel.run** (node22 v22.22.2, `--timeout 90m`, `--publish-port 5173`, created 2026-10-21T12:29:55Z, expiry ≈14:29:55Z) |
| tree | tgz of working tree without node_modules/.git/dist/docs/.ui-proof (1,624 entries, 19 MB) |
| install/build | `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` 12:30:26Z (129 pkgs) · `vite build` 6.04s 12:30:31Z · dist title `OnDemand Intelligence Workstation` · `check-no-secrets --dist` OK (1,699 files) |
| env | 21 keys by name from repo `.env`; `ONDEMAND_API_KEY` server-only via temp file sourced+deleted before server start (`/tmp/od-secret.env` absent after; 0 assignments in .env/tgz; not in dist per secrets check) |
| server | `node server/serverless/dev-server.mjs` PID 164, 0.0.0.0:5173, 12:31:10Z |
| `GET /api/health` | **200 at 2026-10-21T12:31:17Z** `{"ok":true,"configured":true,"contracts":33,"activePlugins":10,"defaultEndpointId":"predefined-gpt-6-luna","keySource":"server"}` · re-polled 200 12:34:54Z, 12:36:37Z |
| `GET /` | **200** `<title>OnDemand Intelligence Workstation</title>` 12:31:17Z, 12:36:37Z |
| A–G harness | **14/14 PASS** (`scripts/qa-chat-intelligent-ui.mjs`, 1440x900 + 390x844, 12:32:41Z–12:33:36Z) — covers streaming, HUD, isolation, reload persistence, plugin caps, failure/retry |
| after-fix media script | **16/16 PASS** 12:36:03Z–12:36:23Z: composer hit-test (banner hidden while chat open), real-pointer send, deliverables side-by-side grid (3 cols), image thumbnail→lightbox, video poster→side pane (controls, autoplay=false, paused), PDF doc→side-pane iframe, plugin dock reachable beside chat, banner restored |
| plugin lifecycle (live API) | verify internet_web_search→ready (plugin-1713924030, 5038ms), x_mcp_connector→failed inactive_on_account, unknown→404 unknown_plugin, user mismatch→403; badge states transition pending/discovered→ready/failed |
| ui-validator | redeploy-health + redeploy-chat: title exact, ASK ONDEMAND, mini-chat opens, composer SEND hit-testable, `localStorage.ondemand.apiKey===null`, no God's Eye/GEV MIC/OpenAI, 0 page errors |
| unit | miniChat.media + plugin-lifecycle 21/21 pass |
| media persistence note | artifacts persist `mediaId` + unsigned `sourceUrl` via OnDemand media API (`entityChat.js` attachment{mediaId}, `entityContext.js` frame.mediaId); deliverable URLs in answers are rendered directly (no signed URL is stored) — re-sign-on-open is N/A in this build, honestly recorded |

GENERATED_UTC: 2026-10-21T12:37:00Z

## 13. Cycle 8 (2026-10-22T06:27Z–06:34Z) — emergency preview redeploy (sb-2s5by0bbr2ix dead)

Trigger: the previously reported preview `sb-2s5by0bbr2ix.vercel.run` no longer serves the app (its sandbox
stopped). A fresh Vercel Sandbox was created from the current working tree and fully re-gated.

| item | value |
|---|---|
| source | `integration/ondemand-native` @ `6b49fe9` (fetched: `origin/integration/ondemand-native` = `6b49fe9`, no newer commit) + the uncommitted cycle-7 in-place edit to `build/vite.js` (removal of `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` and the now-empty `headers` block in `createBrowserViteConfig`) and the matching assertion update in `src/tooling/viteBuild.test.mjs` |
| sandbox | `sbx_EdkizkMGv6ASKOnpEmUWOAlaQrRc` → **https://sb-1ek30lyxzsd3.vercel.run** (node22 v22.23.4, `--timeout 90m`, `--publish-port 5173`, created 2026-10-22T06:29:0xZ, expiry ≈07:59Z) |
| install | `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` — 129 packages, **7 s**, 06:29:25Z |
| build | `npm run build` (prebuild refresh + `vite build`) rc=0, **8.27 s** vite, 14 s wall, 06:29:43Z; `dist/` 39 MB / **521 files** |
| secrets gate | `node scripts/check-no-secrets.mjs` rc=0 (1,431 files) · `--dist` rc=0 (1,699 files). Explicit value grep with the real key: **0 occurrences in `dist/`** and **0 in `.env` / `.env.example`**. Literal substring `ONDEMAND_API_KEY`: 2 occurrences in `dist/assets/index-*.js` (UI status copy "ONDEMAND_API_KEY is not set on the server") + 1 comment line in `.env` — no value, no secret |
| env | 21 keys by name from repo `.env`; `ONDEMAND_API_KEY` injected from `/tmp/od-secret.env`, sourced into the server process, temp file **deleted before the server start** (`SECRET_FILE_GONE`), never written into `.env` (`KEY_NOT_IN_ENV_FILE`) |
| server | `node server/serverless/dev-server.mjs` PID 231, `0.0.0.0:5173`, log `[dev-server] listening on http://0.0.0.0:5173` 06:30:22Z |
| `GET /api/health` | **200** 06:30:24Z and re-checked 06:33:17Z — `{"ok":true,"configured":true,"contracts":33,"activePlugins":10,"keySource":"server","defaultEndpointId":"predefined-gpt-6-luna","workflowId":{"configured":true,"valid":true}}`; response header `x-ondemand-key-source: server` |
| `GET /` | **200** 06:30:24Z / 06:33:17Z, `<title>OnDemand Intelligence Workstation</title>`, 77,632 bytes |
| framing headers | absent on **both** responses: `x-frame-options` 0 hits, `frame-ancestors` 0 hits, no CSP header emitted at all |
| iframe proof | `/iframe-proof.html` wrapper (no `sandbox` attribute) served from `dist/`, iframe loads `/` same-origin; `ui_validate.py` (CDP socket-timeout patch for WebGL pages) **PASS 7/7 assertions** at **1440x900** and **390x844**: `IFRAME_TITLE=OnDemand…`, `contentDocument` non-null, `innerText` length > 0, `document.title` contains `OnDemand`; screenshots `.ui-proof/iframe-after-1440x900.png`, `.ui-proof/iframe-after-390x844.png` |
| unit | `node --test src/tooling/viteBuild.test.mjs` **4/4 pass** after updating the framing assertion to `config.server.headers === undefined` |
| known (pre-existing) console noise | `GET /api/setup/status` 404 — the loopback-only key-setup surface is intentionally not registered in prod builds (`apply: 'serve'`), client removes the panel; not a regression |

## 14. Cycle 9 (2026-10-22T10:03Z–13:05Z) — UAE AOI incident scenes (restriction, live ingest, composer)

Source: `integration/ondemand-native` from `b698032` (cycle 8 head; the uncommitted `build/vite.js`
embeddability edit was already committed there as `039fa2e` together with the updated viteBuild
assertion) → `0dcf469` … `97f5b05` (9 conventional commits, this section's checkpoint commit follows).

### 14.1 Unit / gate results

| gate | command | result | when (UTC) |
|---|---|---|---|
| full unit suite (Node 22) | `npm test` | **4,264 tests · 4,263 pass · 0 fail · 1 skipped** (win32-only DACL test); 2 allocation micro-benchmarks still Node-24 calibrated (B-8) | 12:58Z (re-run after the last fix) |
| foundation | `npm run test:foundation` | **77 / 77** | 11:33Z |
| ondemand | `npm run test:ondemand` | **250 / 250** | 11:34Z |
| serverless | `npm run test:serverless` | **57 / 57** | 11:35Z |
| incidents routes (new) | `node --test server/incidents/*.test.mjs` | **15 / 15** | 12:38Z |
| new browser-side units | `src/aoi/membership.test.mjs` 22 · `src/incidents/model.test.mjs` 15 · `src/scenes/aoiScenes.test.mjs` 11 · `src/incidents/composer.test.mjs` 13 · `src/tooling/embeddability.test.mjs` 1 (all inside the 4,264 above) | **62 / 62** | 12:58Z |
| secrets | `node scripts/check-no-secrets.mjs` (1,702 files) · `--dist` | ✓ / ✓ (0 key material; `grep -c ^ONDEMAND_API_KEY= .env` = 0 in the sandbox) | 11:35Z / 12:51Z |
| format / boundaries | `npm run format:check` (977 files) · `check-import-directions` (776 modules, 53 portable entries) · `check-package-boundaries` · `check-brand-marks` | all exit 0 | 11:20Z–11:30Z |
| build | `npm run build` (prebuild + vite) | rc=0, 5.4–11.4 s | 11:36Z, 12:51Z |

### 14.2 Deploy (new Vercel Sandbox)

| item | value |
|---|---|
| sandbox | `sbx_cR56IE7EkAJY2OH7OWTAIdlWiDNC` → **https://sb-69k15adlaiog.vercel.run** (node22 v22.23.4, `--timeout 90m`, `--publish-port 5173`, created **2026-10-22T11:57:06Z**, projected expiry ≈ **13:27Z**) |
| install / build | `PUPPETEER_SKIP_DOWNLOAD=1 npm ci` 129 packages **4 s**; `set -a; . ./.env; npm run build` vite **5.60 s**; build complete **11:57:38Z**; `check-no-secrets --dist` ✓ |
| env | 21 keys by name from the gitignored `.env`; `ONDEMAND_API_KEY` + `INCIDENT_INGEST_SECRET` sourced from `/tmp/od-secret.env` into the server process and the file deleted before the server started (`SECRET_FILE_GONE`, `KEY_ASSIGNMENTS_IN_ENV_FILE=0`) |
| `GET /api/health` | first **200** at **2026-10-22T11:57:59Z** — `configured:true, contracts:33, activePlugins:10, keySource:server` |
| `GET /` | 200 at 11:57:59Z, `<title>OnDemand Intelligence Workstation</title>`; **no** `x-frame-options`, **no** `content-security-policy` |
| redeploys on the same sandbox (patches) | 12:10:12Z, 12:15:29Z, 12:17:36Z, 12:21:31Z, 12:27:24Z, 12:38:56Z, 12:51:26Z (each: tgz copy → restart → health 200) |
| **delivered preview (fresh sandbox from the final tree `afaaf21`)** | `sbx_RmqjwffD7WcOsGCWQLqomRdBSUqT` → **https://sb-2gpu373q6qzj.vercel.run** — created **13:02:12Z**, `npm ci` 6 s, vite build 7.28 s (complete **13:02:42Z**), secrets `--dist` ✓, first `GET /api/health` **200 at 13:02:58Z**, `GET /` 200 with the neutral title and no framing headers, `/list` 47 / 35 / 18; a–g re-run **14 / 14** 13:03:15Z–13:08:00Z (`/tmp/qa-final`, same PNG set); projected expiry ≈ **14:32Z**. The patch sandbox `sbx_cR56IE7EkAJY2OH7OWTAIdlWiDNC` was stopped afterwards. |

### 14.3 Incident / scene counts (GET /api/ondemand/v2/incidents/list at first load, before any refresh)

| AOI | incidents | scenes |
|---|---|---|
| yemen | 16 | 13 |
| iran | 9 | 5 |
| gulf-of-oman | 7 | 3 |
| somalia | 5 | 5 |
| uae-gulf-waters | 4 | 4 |
| strait-of-hormuz | 3 | 2 |
| socotra | 1 | 1 |
| al-ain-buraimi | 1 | 1 |
| musandam-approaches | 1 | 1 |
| **total in AOI** | **47** | **35** (25 km / 6 h clustering) |

Per category: thermal_hotspot 33 · protected_asset_presence_node 8 · ied_terror (cyber) 3 · protest_unrest (political) 2 · missile_drone_strike 1.
**Rejected at seed: 18** — 16× `OUT_OF_AOI: nearest AOI Southern Red Sea at 67–105 km` (Ethiopia/Djibouti VIIRS cluster near 11.26 N 41.52 E + Yanbu/Riyadh Houthi item at 809 km), 1× `OUT_OF_AOI: nearest AOI Iran at 1641.9 km` (Falcon Shield 2026, Hotan), 1× `OUT_OF_AOI: nearest AOI Hatta border at 4.2 km` (hotspot 24.990 N 55.627 E, just outside the 50 km land-border buffer). Scenes hidden by the AOI policy: `Nepal Flood Incident` (`OUT_OF_AOI: nearest AOI Iran at 1754.3 km`), `Global Flights Radar`, `Orbital Watch`, `Thermal Threat Board`, `City Overload`, `Omniscience Pullback` — kept in storage and export.

Live refresh (`POST /refresh`, OnDemand plugins through the PluginContract registry): 12:27:24Z–12:29:40Z pulled **4**, inserted **3** (`Tanker struck by rocket-propelled grenade from small boat` → strait-of-hormuz/confirmed; `Ballistic missile attack reported near Aden International Airport` → yemen; `Missile attacks reported at al-Rayyan Airport` → yemen), sources `perplexity_research:ok(2)`, `internet_web_search:ok(2)`, `fire_detection_search:*:error(not_configured)` (NASA_FIRMS_MAP_KEY absent — N-19). Earlier pulls at 11:58Z inserted `Al Dasma damaged in second attack in the Strait of Hormuz` and `Iran claims supertanker struck a naval mine south of the Strait`, and rejected `Chloe reported damaged off Oman — OUT_OF_AOI: nearest AOI Gulf of Oman at 457.7 km`.

### 14.4 Headless browser proof (`scripts/qa-aoi-incident-scenes.mjs`, puppeteer + /usr/bin/chromium, PNG per check) — **14 / 14**

Artefacts: `artifacts/aoi-incidents-2026-10-22/{<check>-<viewport>.png, results.json}` (run 12:51:27Z–12:56:45Z, final tree).

| check | 1440×900 | 390×844 | evidence |
|---|---|---|---|
| (a) only AOI scenes in list/map, Nepal Flood absent | PASS 12:51:37Z — 35 scenes listed, 47 markers, hidden reason `OUT_OF_AOI: nearest AOI Iran at 1754.3 km` | PASS 12:54:39Z — 36 scenes, 48 markers | `a-aoi-only-*.png` |
| (b) playback plays and scrubs | PASS 12:51:48Z — running, clock 0.046→0.284; scrub→0.950 lands on shot 2, camera moved | PASS 12:54:48Z — 0.037→0.243; scrub ok | `b-playback-*.png` |
| (c) type “drone strike reported near Hodeidah port” → new scene auto-plays, camera near 14.80, 42.95 | PASS 12:52:01Z — chips locating/verifying/building = done, camera **14.23, 42.73** (approach keyframe), running, scenes 35→36 | PASS 12:54:58Z — camera 14.23, 42.73, dedupe reuse of the same 6 h cell | `c-compose-hodeidah-*.png` |
| (d) Paris incident rejected with OUT_OF_AOI + override offered | PASS 12:52:07Z — state=error, `OUT_OF_AOI: nearest AOI Iran at 3236.6 km`, button “Add anyway (override)” | PASS 12:55:01Z | `d-compose-paris-*.png` |
| (e) POST /refresh adds live incidents, list count never shrinks | PASS 12:54:18Z — sources ok 2/5 (perplexity + internet search), 48→48 (all pulled items already known from the 12:27Z pull → duplicates) ; the 12:41Z run of the same check inserted +2 (48→50) and the 12:37Z run +3 (51→54) | PASS 12:56:34Z | `e-refresh-*.png` |
| (f) mini chat opens from a scene marker with incident context pre-filled | PASS 12:54:20Z — popover (title, UNVERIFIED badge, sources/provenance, AOI reason), ASK ONDEMAND → `#ondemand-mini-chat[data-open=true]` `data-object-type=alert`, kind `ALERT · inc-2cc579e061a1` | PASS 12:56:36Z | `f-mini-chat-*.png` |
| (g) app loads inside an iframe on a harness page | PASS 12:54:32Z — `/embed-harness.html` iframe title “OnDemand Intelligence Workstation”, innerText 4,836 chars, canvas present, no framing headers | PASS 12:56:45Z — innerText 4,682 | `g-iframe-*.png` |

Layout contract (elementFromPoint on the composer input + submit at 1440×900, 1024×768, 390×844): composer never overlaps the command dock, the serverless notice or the PLUGINS dock; on ≤720 px the PLUGINS dock is lifted above the composer.

Defects found and fixed during the cycle: OnDemand `409 session_busy` on reused refresh sessions (now one fresh session + principal per call with bounded backoff); model answers naming a place without coordinates were dropped as invalid (gazetteer geocode added); same place from gazetteer + model produced a spurious picker (≤15 km merge); second identical composer submission inside the 6 h dedupe window errored (server returns `existing` + scene, composer reuses it); geometric glyphs in the new UI failed the icon-glyph boundary gate (text labels).

Not done in this cycle: push / PR / tag (no `GITHUB_TOKEN` in the execution environment — see RESUME.md hand-over), scheduled OnDemand workflow → `/refresh` (N-33), FIRMS live pulls (N-19 operator key).

GENERATED_UTC: 2026-10-22T13:05:00Z

## 15. Cycle 10 (2026-10-23T03:15Z–04:3xZ) — scene video evidence (Umm Suqeim test prompt)

### 15.1 Unit / gate results (Node 22.23.3 local; 2 allocation microbenchmarks skipped off Node 24 as before)
| suite | result | timestamp |
|---|---|---|
| `npm test` (all src/**/*.test.mjs) | **4,286 tests · 4,285 pass · 1 skip · 0 fail** (baseline before the change 4,264 / 4,263) | 2026-10-23T04:02:05Z |
| `node --test server/scene-videos/*.test.mjs` (planner, parsing, orchestrator fan-out/concurrency/breaker/lane failure, SSE route, media allow-list/proxy) | 16 / 16 | 04:02Z |
| `src/sceneVideos/{evidence,rail}.test.mjs` (tiering, URL parsing, TikTok snowflake, IG efg, normalise, dedupe, ranking, labels, banner, rail queue, SSE parser regression) | 24 / 24 | 04:15Z |
| `src/tooling/viteBuild.test.mjs` — stale X-Frame-Options expectation replaced by an embeddability guard (server + preview headers) | pass | 04:00Z |
| foundation / ondemand / serverless / incidents | 77 / 250 / 57 / 15 — all pass | 04:02Z |
| `npm run build` | ok (5.6 s local, 8.9 s sandbox) | 04:03:30Z / 04:18:59Z |
| `check-no-secrets` src + `--dist` | ✓ / ✓ ; literal key value in `dist/` or `.env`: **0 files** | 04:03:41Z |
| `check:boundaries` (package-boundaries.json updated for src/sceneVideos/* + scene-videos.css) | ✓ | 04:02Z |

### 15.2 Live orchestration (prompt `rebuild the car crash reported in Umm Suqeim`, scene hash anchor 25.14 / 55.20)
| run | clips | YouTube | TikTok | Instagram | tiers | duration |
|---|---|---|---|---|---|---|
| local node 03:54:50Z | 14 | 6 | 6 | 2 | ARCHIVAL 14 | 43.7 s |
| local server SSE 04:04:04Z | 13 | 6 | 6 | 1 | ARCHIVAL 13 | 41.3 s |
| sandbox QA 1440×900 04:19:36Z | 14 | 6 | 6 | 2 | ARCHIVAL 14 | ≈40 s |
| sandbox QA 390×844 04:20:41Z | 13 | 6 | 6 | 1 | ARCHIVAL 13 | ≈35 s |
First Instagram reel streams at ≈9 s; ≥2 platforms visible while the stream is still running (rail `data-state=searching`). TikTok primary =
`quota_exhausted` (breaker) → search + oEmbed fallback. No clip is LIVE: the incident is 2026-09-26 and the freshest footage is ≈25 days old.
Media proxy: `GET /scene/media?u=https://is.gd/…` + `Range: bytes=0-200000` → **206 video/mp4** (ISO BMFF).

### 15.3 Deploy (new Vercel Sandbox)
`sbx_FsiXEcFVjxA7tRJMiCIAGMstvv62` → **https://sb-5c67af3inbu0.vercel.run** (created 04:18:29Z, node22, 90 m). npm ci 9 s, build 8.86 s, server key
injected via a temp file that `start-server.sh` sources and deletes (verified absent). `GET /api/health` **200** `configured:true`; `GET /` **200**
title "OnDemand Intelligence Workstation"; neither response carries `X-Frame-Options` or `Content-Security-Policy` (04:19:13Z).

### 15.4 Headless browser proof (`scripts/qa-scene-videos.mjs`, puppeteer + /usr/bin/chromium) — **10 / 10** on the sandbox
| check | 1440×900 | 390×844 |
|---|---|---|
| 1 boot with the approved URL hash; all 27 keys round-trip | PASS 04:19:36Z | PASS 04:20:41Z |
| 2 clips from ≥2 platforms appear while the scene builds | PASS — youtube+instagram, 8 clips, stream still running | PASS — 7 clips, stream running |
| 3 a `<video>` plays (readyState ≥ 3, currentTime advancing, muted) | PASS — instagram:Ddyb6fvQ-Yn rs=4, 29.34→30.84 s | PASS — rs=4, 23.30→24.80 s |
| 4 every clip badged; banner `REBUILT FROM ARCHIVAL FOOTAGE: recorded 26 Sep 2026, not live`; source link per clip | PASS 14/14 | PASS 13/13 |
| 5 app loads inside an iframe (`/embed-harness.html`), composer + rail present | PASS | PASS |
Screenshots: `artifacts/scene-video-2026-10-23/{1-boot,2a-searching,2b-clips-arriving,3-playback,4-archival-labels,5-iframe}-{1440x900,390x844}.png`,
`results.json`. First local run (04:05Z) failed 6/10 because the rail reused the mini-chat SSE parser (wrong event shape) → fixed with
`createSceneSseParser` + regression test; second local run 10/10 (04:17Z). `ui-validator/ui_validate.py` exits 2 on this WebGL page
(Page.captureScreenshot timeout — known), so the repo puppeteer harness is the proof.

## 16. Cycle 11 (scheduled, 2026-10-23T04:31:39Z–04:5xZ) — labelling rule v2 + live re-check (Umm Suqeim, 26 Sep 2026 incident)

### 16.1 Labelling rule (changed this cycle)
`src/sceneVideos/evidence.js` → `labelEvidence(clip, {now, outletRecords})`. **LIVE** only if the platform create/upload time is
**< 6 h** before the run, **RECENT** only if **< 72 h** (both exclusive) — AND the clip's source handle or URL cross-matches a **dated**
outlet record (`config/scene-videos/incident-hints.json` → `outletRecords`, step-1 records: Gulf Today 2026-09-26, Khaleej Times
2026-09-26T14:51Z, Dubai Police IG `DdvxagPqlbL`, net_ad IG `Ddv2o82MKZU`; nasnews.ae is undated → never matches). Everything else is
**ARCHIVAL** with a `tierReason`. Banner text: `REBUILT FROM ARCHIVAL FOOTAGE – recorded <date>, not live` (en dash). Each clip now
carries `ageTier`, `tierReason`, `verification{matched,by,record}`, `sourceHandle`; rail rows expose `data-age-tier`,
`data-verified`, `data-published-at` so the browser check can recompute the expected badge.
New unit tests: every boundary (5 h 59 m 59 s LIVE / 6 h RECENT / 71 h 59 m 59 s RECENT / 72 h ARCHIVAL), missing timestamp,
unmatched-but-fresh source, matched-but-old source (the 26 Sep Dubai Police post), undated outlet record, helper parsing.

### 16.2 Gates (Node 22.23.3 local)
| gate | result | timestamp |
|---|---|---|
| `npm test` (src) | **4,295 tests · 4,294 pass · 0 fail · 1 skip** (baseline 4,286 / 4,285 pass / 1 skip → +9 tests) | 2026-10-23T04:55:39Z–04:56:32Z |
| foundation / ondemand / serverless / scene-videos / incidents | 77/77 · 250/250 · 57/57 · 16/16 · 15/15 | 04:56:59Z |
| `format:check` · `check:boundaries` | ✓ (984 files) · ✓ | 04:56:59Z |
| `vite build` (local / sandbox) | ✓ 5.5 s / ✓ 11.9 s, then 10.0 s rebuild | 04:44:34Z / 04:45:39Z / 04:47:5xZ |
| `check-no-secrets` src + `--dist` (local + sandbox) | ✓ / ✓ ; literal key value in `dist/`: 0 files | 04:44:21Z / 04:45:39Z |

### 16.3 Deploy
`sbx_IyGvAqmHmnbgZnpfe3HcM5GtBeyy` → **https://sb-3f7jy4mbzqe7.vercel.run** (created 2026-10-23T04:45:09Z, node22, `--timeout 90m` → expires ≈06:15Z).
`npm ci` 6.5 s; 21 env keys by name from the gitignored `.env` (0 `ONDEMAND_API_KEY` lines); key copied to `/tmp/od-secret.env`,
sourced by `/tmp/start-server.sh` and deleted before `node server/serverless/dev-server.mjs` starts (`SECRET_FILE_GONE`, `ls` →
No such file). `GET /api/health` 200 `{"ok":true,"configured":true,…,"keySource":"server"}` (04:45:53Z, again 04:48:07Z after the
orchestrator update). Raw headers for `/` (200, title "OnDemand Intelligence Workstation") and `/api/health`: no `X-Frame-Options`,
no `Content-Security-Policy` (`grep -ic` → 0) — `artifacts/scene-video-cycle11-2026-10-23/*.headers`.

### 16.4 Live `/api/ondemand/v2/scene/videos` (sandbox, prompt "rebuild the car crash reported in Umm Suqeim (Umm Suqeim Street towards
Jumeirah Street, driver fainted) حادث أم سقيم", 04:49:49Z → 04:51:17Z, 87.1 s; first run 04:48:16Z → 04:49:02Z kept as run1)
| plugin | calls | ok | first → last (UTC) | exact error |
|---|---|---|---|---|
| plugin-1740745780 AI Search (site: search) | 5 | 5 | 04:49:49.991Z → 04:50:17.599Z | — |
| plugin-1792727178 YouTube oEmbed | 1 | 1 | 04:50:10.482Z → 04:50:29.307Z | — |
| plugin-1792727179 TikTok oEmbed | 1 | 1 | 04:50:17.599Z → 04:50:32.036Z | — |
| plugin-1716372717 TikTok scraper | 1 | 0 | 04:49:49.987Z → 04:49:59.318Z | `You have exceeded the MONTHLY quota for Scraping API on your current plan, BASIC. Upgrade your plan at https://rapidapi.com/tikwm-tikwm-default/api/tiktok-scraper7` |
| plugin-1784356219 YouTube captions | 1 | 0 | 04:50:29.307Z → 04:50:36.527Z | `field key is missing in agent plugin config` |
| plugin-1716164040 Instagram user info | 3 | 3 | 04:49:49.983Z → 04:50:03.498Z | — (dubaipolicehq verified 1,117,822; `net_ad`, `dubaipolice` returned no profile) |
| plugin-1762980461 Instagram download | 6 | 6 | 04:49:49.991Z → 04:50:16.210Z | — (2 videos, 4 image posts skipped) |
| plugin-1722260873 Perplexity | 2 | 1 | 04:49:49.975Z → 04:51:17.030Z | 1st `ondemand_http_409` (session busy) → retry ok, **0 dated rows** (no newer incident) |
Result: 14 clips (YouTube 6 · TikTok 6 · Instagram 2) — **LIVE 0 · RECENT 0 · ARCHIVAL 14**; no clip cross-matches a dated outlet
record, and the freshest dated clip (TikTok @nasnews_ar, 2026-09-26T12:38Z, ≈640 h) is > 72 h. Raw SSE: `live-scene-videos-sse.json`.

| platform | URL (shortUrl for videos) | handle | create_time_utc | age_h | label | evidence | played |
|---|---|---|---|---|---|---|---|
| instagram | https://is.gd/M5lK6b | — | 2026-09-28T04:50:02.501Z | 599.7 | ARCHIVAL | instagram-asset-age-days; outlet match=no; via plugin-1762980461 | yes |
| instagram | https://is.gd/6KEhmp | — | 2026-04-04T04:50:03.741Z | 4847.7 | ARCHIVAL | instagram-asset-age-days; outlet match=no; via plugin-1762980461 | no |
| tiktok | https://www.tiktok.com/@emirates_news/video/7627044985581374741 | emirates_news | 2026-04-10T08:29:53.000Z | 4700.0 | ARCHIVAL | tiktok-id-snowflake; outlet match=no; via plugin-1792727179 | no |
| tiktok | https://www.tiktok.com/@60v_benji/video/7621530117717658902 | 60v_benji | 2026-03-26T11:49:22.000Z | 5056.7 | ARCHIVAL | tiktok-id-snowflake; outlet match=no; via plugin-1792727179 | no |
| tiktok | https://www.tiktok.com/@kumar_tharesh/video/7458690515530157330 | kumar_tharesh | 2025-01-11T16:08:33.000Z | 15588.4 | ARCHIVAL | tiktok-id-snowflake; outlet match=no; via plugin-1792727179 | no |
| tiktok | https://www.tiktok.com/@affordablegroupofficial/video/7351875077924801808 | affordablegroupofficial | 2024-03-29T19:50:06.000Z | 22496.7 | ARCHIVAL | tiktok-id-snowflake; outlet match=no; via plugin-1792727179 | no |
| tiktok | https://www.tiktok.com/@71c4ddg/video/7657080194712341790 | 71c4ddg | 2026-06-30T07:01:50.000Z | 2757.5 | ARCHIVAL | tiktok-id-snowflake; outlet match=no; via plugin-1792727179 | no |
| tiktok | https://www.tiktok.com/@nasnews_ar/video/7689822370613169415 | nasnews_ar | 2026-09-26T12:38:12.000Z | 639.9 | ARCHIVAL | tiktok-id-snowflake; outlet match=no; via plugin-1792727179 | no |
| youtube | https://www.youtube.com/watch?v=tyZCXRV9Cgw | Times Of India | unknown | n/a | ARCHIVAL | no timestamp; outlet match=no; via plugin-1792727178 | no |
| youtube | https://www.youtube.com/watch?v=RHjCaPIWJVc | Suhaib Sells Dubai | unknown | n/a | ARCHIVAL | no timestamp; outlet match=no; via plugin-1792727178 | no |
| youtube | https://www.youtube.com/watch?v=8CEx-SDkw_A | DailyDrivenExotics | unknown | n/a | ARCHIVAL | no timestamp; outlet match=no; via plugin-1792727178 | no |
| youtube | https://www.youtube.com/watch?v=dV4uVkinbEI | Dr. Sharik Ali - Spinal Health Centre, Dubai | unknown | n/a | ARCHIVAL | no timestamp; outlet match=no; via plugin-1792727178 | no |
| youtube | https://www.youtube.com/watch?v=NRJg0AMv8dE | Times Now | 2026-03-18T00:00:00.000Z | 5260.5 | ARCHIVAL | plugin; outlet match=no; via plugin-1792727178 | no |
| youtube | https://www.youtube.com/watch?v=NP_D_tApFks | المنشد محمد العباسي تسجيلات العباسي | unknown | n/a | ARCHIVAL | no timestamp; outlet match=no; via plugin-1792727178 | no |

### 16.5 Headless browser (`scripts/qa-scene-videos.mjs`, puppeteer + /usr/bin/chromium) — **10 / 10** on the sandbox (04:51:56Z–04:54:57Z)
`ui_validate.py` exited 2 (`TimeoutError: timed out` on Page.captureScreenshot, WebGL page, 04:51:44Z) → repo harness used.
| check | 1440×900 | 390×844 |
|---|---|---|
| 1 approved camera hash: 27/27 keys at boot AND after a full reload | PASS 04:52:20Z | PASS 04:53:25Z |
| 2 clips from ≥2 platforms while the build streams | PASS tiktok+instagram, 7 clips, rail searching | PASS youtube+instagram, 4 clips, searching |
| 3 muted clip playing (readyState **4**, currentTime advancing) | PASS instagram:Ddyb6fvQ-Yn 21.20→22.70 s | PASS 0.00→1.43 s |
| 4 badges correct (recomputed from data-published-at + data-verified; wrong=0), banner `REBUILT FROM ARCHIVAL FOOTAGE – recorded 26 Sep 2026, not live` | PASS 13/13 ARCHIVAL | PASS 10/10 ARCHIVAL |
| 5 iframe embed (`/embed-harness.html`), composer + rail inside | PASS | PASS |
PNGs: `artifacts/scene-video-cycle11-2026-10-23/{1-boot,2a-searching,2b-clips-arriving,3-playback,4-archival-labels,5-iframe}-{1440x900,390x844}.png`, `results.json`.

### 16.6 Change vs the cycle-10 baseline
No material change: no LIVE/RECENT clip; TikTok scraper still quota-blocked; YouTube captions still `field key is missing in agent plugin
config`; Instagram top posts not exercised by the orchestrator (step-3 evidence: 0 posts for 5 accounts). Confirmed deltas are limited to
the rule change (24 h/7 d → 6 h/72 h + outlet cross-match), the per-plugin call log + verification lane, and the reload check.

GENERATED_UTC: 2026-10-23T04:57:00Z
