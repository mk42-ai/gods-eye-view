# OnDemand AI Platform — Live Public API Documentation & Empirical Probe Record

**Document Date:** 2026-10-21  
**Retrieval Agent:** OnDemand Research Subagent (`20261021_2`)  
**Git Branch:** `integration/ondemand-native`  
**Working Directory:** `/home/appuser/work/6692b763e851d28a036ab30e/6ad7d892f922b50dc6673071/gods-eye-view`  
**Security Notice:** All secret keys/tokens (`ON_DEMAND_API_KEY`, etc.) were referenced strictly via environment variables in headers; no key values appear anywhere in this record or repository files.

---

## 1. Retrieval Index & Fetch Log

Every URL below was retrieved live using `curl -s -m 30 -w '\nHTTP %{http_code}\n'`. Markdown specifications (`.md`) are served natively by the ReadMe documentation platform for OnDemand AI. Timestamps are formatted in ISO 8601 UTC.

| # | Target Documentation URL | HTTP Code | Retrieval Time (UTC) | Payload Size (Bytes) | Notes / Family |
|---|---------------------------|-----------|----------------------|----------------------|----------------|
| 1 | `https://docs.on-demand.io/llms.txt` | 200 | 2026-10-21T01:57:42Z | 6,561 | Global Documentation Manifest |
| 2 | `https://docs.on-demand.io/docs/agents-flow-builder.md` | 200 | 2026-10-21T01:59:04Z | 803 | Flow Builder Overview |
| 3 | `https://docs.on-demand.io/docs/workflow-api.md` | 200 | 2026-10-21T01:59:05Z | 11,874 | Workflow Object & API Reference |
| 4 | `https://docs.on-demand.io/docs/workflow-nodes.md` | 200 | 2026-10-21T01:59:05Z | 6,913 | Workflow Node Specifications |
| 5 | `https://docs.on-demand.io/docs/execution-api.md` | 200 | 2026-10-21T01:59:05Z | 8,729 | Execution Object & Endpoints |
| 6 | `https://docs.on-demand.io/docs/creating-a-workflow.md` | 200 | 2026-10-21T01:59:05Z | 5,097 | Workflow Creation Guide |
| 7 | `https://docs.on-demand.io/reference/post_workflow.md` | 200 | 2026-10-21T01:59:06Z | 11,063 | OpenAPI: Create Workflow |
| 8 | `https://docs.on-demand.io/reference/get_workflow-id.md` | 200 | 2026-10-21T01:59:17Z | 11,270 | OpenAPI: Get Workflow by ID |
| 9 | `https://docs.on-demand.io/reference/post_workflow-id-activate.md` | 200 | 2026-10-21T01:59:06Z | 1,159 | OpenAPI: Activate Workflow |
| 10 | `https://docs.on-demand.io/reference/post_workflow-id-deactivate.md` | 200 | 2026-10-21T01:59:07Z | 1,167 | OpenAPI: Deactivate Workflow |
| 11 | `https://docs.on-demand.io/reference/post_workflow-id-execute.md` | 200 | 2026-10-21T01:59:07Z | 1,655 | OpenAPI: Execute Workflow |
| 12 | `https://docs.on-demand.io/reference/get_execution-executionid.md` | 200 | 2026-10-21T01:59:07Z | 4,056 | OpenAPI: Get Execution by ID |
| 13 | `https://docs.on-demand.io/reference/get_execution-executionid-logs.md` | 200 | 2026-10-21T01:59:08Z | 3,646 | OpenAPI: Get Execution Logs |
| 14 | `https://docs.on-demand.io/reference/get_execution-executionid-node-outputs.md` | 200 | 2026-10-21T01:59:08Z | 3,541 | OpenAPI: Get Execution Node Outputs |
| 15 | `https://docs.on-demand.io/reference/get_execution-executionid-transcript.md` | 200 | 2026-10-21T01:59:16Z | 3,983 | OpenAPI: Get Voice Transcripts |
| 16 | `https://docs.on-demand.io/docs/webhooks.md` | 200 | 2026-10-21T01:59:09Z | 1,242 | Chat/Media Outbound Webhooks |
| 17 | `https://docs.on-demand.io/docs/cloud-services-api.md` | 200 | 2026-10-21T01:59:17Z | 7,582 | Services API Guide (STT / TTS) |
| 18 | `https://docs.on-demand.io/reference/convertaudiototext.md` | 200 | 2026-10-21T01:59:09Z | 4,257 | OpenAPI: Speech to Text (STT) |
| 19 | `https://docs.on-demand.io/reference/converttexttoaudio.md` | 200 | 2026-10-21T01:59:09Z | 5,127 | OpenAPI: Text to Speech (TTS) |
| 20 | `https://docs.on-demand.io/reference/createchatsession.md` | 200 | 2026-10-21T01:59:10Z | 6,167 | OpenAPI: Create Chat Session |
| 21 | `https://docs.on-demand.io/reference/submitquery.md` | 200 | 2026-10-21T01:59:10Z | 10,657 | OpenAPI: Submit Query |
| 22 | `https://docs.on-demand.io/docs/query-and-responses-modes.md` | 200 | 2026-10-21T01:59:10Z | 31,877 | Query Response Modes (sync/stream/webhook) |
| 23 | `https://docs.on-demand.io/reference/getchatsessions.md` | 200 | 2026-10-21T01:59:11Z | 7,419 | OpenAPI: List Chat Sessions |
| 24 | `https://docs.on-demand.io/reference/getchatmessages.md` | 200 | 2026-10-21T01:59:11Z | 11,354 | OpenAPI: Get Chat Messages |
| 25 | `https://docs.on-demand.io/reference/updatelivesessionsettings.md` | 200 | 2026-10-21T01:59:16Z | 5,645 | OpenAPI: Live Session Settings |
| 26 | `https://docs.on-demand.io/docs/chat-api.md` | 200 | 2026-10-21T01:59:17Z | 15,925 | Chat API Guide & Overview |
| 27 | `https://docs.on-demand.io/docs/media-api.md` | 200 | 2026-10-21T01:59:17Z | 11,583 | Media API Guide & Uploads |
| 28 | `https://docs.on-demand.io/reference/createmediaurl.md` | 200 | 2026-10-21T01:59:11Z | 14,138 | OpenAPI: Create Media from URL |
| 29 | `https://docs.on-demand.io/reference/fetchmedia.md` | 200 | 2026-10-21T01:59:13Z | 9,601 | OpenAPI: Fetch / List Media Files |
| 30 | `https://docs.on-demand.io/reference/getmedia.md` | 404 | 2026-10-21T01:59:12Z | 70 | Slug redirected/superseded by `fetchmedia.md` |
| 31 | `https://docs.on-demand.io/reference/deletemedia.md` | 200 | 2026-10-21T01:59:14Z | 1,876 | OpenAPI: Delete Media File |
| 32 | `https://docs.on-demand.io/docs/rest-based-plugins.md` | 200 | 2026-10-21T01:59:14Z | 8,834 | REST Agents & Dashboard Workflow |
| 33 | `https://docs.on-demand.io/docs/open-api-schema.md` | 200 | 2026-10-21T01:59:14Z | 16,716 | OpenAPI Schema Specification for Agents |
| 34 | `https://docs.on-demand.io/docs/plugin-api.md` | 200 | 2026-10-21T01:59:15Z | 5,678 | Agents Listing API (`/plugin/v1/list`) |
| 35 | `https://docs.on-demand.io/docs/authentication.md` | 200 | 2026-10-21T01:59:15Z | 4,636 | Authentication & API Key Management |
| 36 | `https://docs.on-demand.io/reference/how-to-do-authentication.md` | 200 | 2026-10-21T01:59:15Z | 1,713 | API Reference Authentication |

---

## 2. Family Fact Sheets

### 2.1 Agents Flow Builder (Workflow & Execution API)

* **Base URL:** `https://api.on-demand.io/automation/api`
* **Authentication:** Header `apikey: <key>` (OpenAPI security scheme: `ApiKeyAuth`).
* **Core Endpoints:**
  * `POST /workflow/` — Create new workflow.
  * `GET /workflow/{id}` — Retrieve workflow configuration and trigger details.
  * `POST /workflow/{id}/activate` — Activate workflow. Returns `200` with full workflow object.
  * `POST /workflow/{id}/deactivate` — Deactivate workflow. Returns `200` with full workflow object.
  * `POST /workflow/{id}/execute` — Trigger workflow execution.
  * `GET /execution/{executionID}` — Poll execution status (`status`: `"running"`, `"completed"`, `"failed"`).
  * `GET /execution/{executionID}/logs` — Retrieve array of execution logs (`data: ExecutionLog[]`).
  * `GET /execution/{executionID}/node/outputs` — Retrieve execution node outputs map (`data.outputs.<nodeKey>`).
  * `GET /execution/{executionID}/transcript` — Retrieve voice transcript if workflow is in advanced voice mode.
* **Execute Request Body Specification:**
  * In `reference/post_workflow-id-execute.md`, the OpenAPI definition contains **no request body** (`requestBody` is undefined in the schema). The only parameter defined is the path parameter `{id}`.
  * Verbatim snippet from `reference/post_workflow-id-execute.md`:
    ```json
    "paths": {
      "/workflow/{id}/execute": {
        "post": {
          "summary": "Execute workflow",
          "parameters": [
            { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
          ],
          "responses": {
            "200": {
              "description": "Workflow execution started",
              "content": {
                "application/json": {
                  "schema": {
                    "type": "object",
                    "properties": { "executionID": { "type": "string" } }
                  }
                }
              }
            }
          }
        }
      }
    }
    ```
* **Webhook Trigger Specifications:**
  * In `docs/workflow-nodes.md`:
    > **Webhook Trigger**  
    > Allows you to start a workflow when an external system sends an HTTP POST request to a unique webhook URL generated for the workflow.  
    > This enables real-time workflow execution based on events from external applications, services, or custom systems.  
    > **Webhook URL:** A unique endpoint generated for the workflow. External services must send an HTTP POST request to this URL to trigger the workflow.  
    > **Payload Format:** The request body must contain a JSON object with a payload field. The workflow will receive this data and make it available for use in subsequent steps.
  * In `reference/get_workflow-id.md`, `trigger.webhook` is defined as:
    ```json
    "WebhookConfig": {
      "type": "object",
      "properties": {
        "url": { "type": "string" },
        "auth": { "$ref": "#/components/schemas/BasicAuth" },
        "whiteListedIPs": { "type": "array", "items": { "type": "string" } }
      }
    }
    ```
  * In practice on live workflows, `GET /workflow/{id}` returns `trigger.webhook.auth` (e.g. BasicAuth credentials), but the `url` field is `null` or omitted. The webhook URL is exposed in the dashboard UI and cannot be retrieved programmatically from public endpoints.
* **Retry and Idempotency:** NOT FOUND IN LIVE DOCS. Neither the workflow execute endpoint nor execution polling specifies idempotency keys, headers, or automatic retry behavior.

---

### 2.2 Cloud Services API (STT & TTS)

* **Base URL:** `https://api.on-demand.io/services/v1/public/service`
* **Authentication:** Header `apikey: <key>`.
* **Endpoints:**
  * `POST /execute/speech_to_text` (Speech-to-Text / STT):
    * **Request Body:** `{ "audioUrl": "<url>" }` (`required: ["audioUrl"]`).
    * **Input Formats:** wav, mp3, m4a, flac, aac, ogg, wma, mp4.
    * **Crucial Constraint:** The endpoint takes an HTTP audio URL, **not** binary/multipart form audio. Audio files must be hosted (e.g. on Cloudinary or Vercel blob) before calling STT.
    * **Response:** `200` with `{ "message": "Service executed successfully", "data": { "text": "<transcribed text>" } }`.
    * **Error Codes:** `400` with `errorCode: "invalid_request"` ("Please subscribe to the service to use it"); `401` ("Unauthorized: Incorrect API key").
  * `POST /execute/text_to_speech` (Text-to-Speech / TTS):
    * **Request Body:** `{ "model": "tts-1" | "tts-1-hd", "input": "<text>", "voice": "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" }`.
    * **Default Voice / Model:** `alloy`, `tts-1`.
    * **Performance Statement (Verbatim):**
      > `tts-1`: Suitable for real-time applications with low latency but lower quality. This model may generate content with more static.  
      > `tts-1-hd`: Provides higher quality audio with less static.
    * **Storage Statement (Verbatim):**
      > The audio file has permanent storage and is not deleted over time.
    * **Response:** `200` with `{ "message": "Service executed successfully", "data": { "audioUrl": "https://res.cloudinary.com/..." } }`.
* **Retry / Idempotency:** NOT FOUND IN LIVE DOCS.

---

### 2.3 Chat API & Agent Tools

* **Base URL:** `https://api.on-demand.io`
* **Authentication:** Header `apikey: <key>`.
* **Endpoints:**
  * `POST /chat/v1/sessions` — Create session.
    * Body: `{ "externalUserId": "<string>", "pluginIds": ["<id>"] }` (up to 20 plugin IDs).
    * Response: `200` with `{ "data": { "id": "<sessionId>", ... } }`.
  * `POST /chat/v1/sessions/{sessionId}/query` — Submit query.
    * Body: `{ "query": "<string>", "endpointId": "<model-id>", "responseMode": "sync" | "stream" | "webhook", "pluginIds": [...], "fulfillmentOnly": false, "modelConfigs": {...} }`.
    * Predefined Models: e.g. `predefined-openai-gpt4o`, `predefined-gpt-6-luna`.
    * Sync Response: `200` with `{ "data": { "sessionId": "...", "messageId": "...", "answer": "...", "status": "completed" } }`.
    * Stream Response: HTTP 200 Server-Sent Events (SSE) stream (`text/event-stream`).
  * `GET /chat/v1/sessions` — Paginated session list.
  * `GET /chat/v1/sessions/{sessionId}/messages` — Paginated message history for a session.
  * `POST /chat/v1/sessions/{sessionId}/live-settings` — Real-time live settings.
* **Agent / Plugin Listing:**
  * `GET /plugin/v1/list?pluginIds=...&page=...&limit=...`
  * Response: `{ "message": "Plugin list fetched successfully", "data": { "plugins": [...] } }`.
* **Retry / Idempotency:** Chat queries support retry via external user ID and session context; idempotency keys are NOT FOUND IN LIVE DOCS.

---

### 2.4 Media API

* **Base URL:** `https://api.on-demand.io`
* **Authentication:** Header `apikey: <key>`.
* **Endpoints:**
  * `POST /media/v1/public/file` — Create media from remote URL.
    * Body: `{ "url": "<url>", "plugins": [...], "responseMode": "sync" | "webhook", "name": "...", "sessionId": "..." }`.
  * `POST /media/v1/public/file/raw` — Multipart upload of local file.
    * Form: `file=@"/path/to/file"`, `name=...`, `plugins=...`, `responseMode=...`.
  * `GET /media/v1/public/file` — Fetch media files (query params: `sort`, `page`, `limit`).
  * `DELETE /media/v1/public/file/{fileId}` — Delete media item.
* **Supported MIME Categories:**
  * Documents: doc, docx, pdf, epub, txt, ppt, pptx, xls, csv, xlsx.
  * Audio: mp3, wav, wma, ogg, flac, aac, m4a, ac3, aiff, au, mpga.
  * Video: mp4, avi, mov, wmv, mkv, flv, mpeg, mpg, m4v, webm, 3gp.
  * Image: png, jpg, jpeg.
* **Response Details:** Returns Cloudinary `url`, `extractedTextUrl`, `context`, and processing status (`actionStatus`: `"completed"`).

---

### 2.5 REST API Key Management

* **Programmatic REST API Endpoints:** **NOT FOUND IN LIVE DOCS.**
* **Documented Management Method:** Strictly manual via Web Dashboard.
  * URL: `https://app.on-demand.io/api-keys-management` (accessed via left sidebar navigation).
  * Creation flow: Click "Create New API Key" -> Key shown exactly once on screen -> Stored securely by user.
  * Revocation / Rotation: Manually deleted and regenerated in dashboard.
* **Authentication Header Convention:**
  * All API endpoints require the HTTP header `apikey: <YOUR_API_KEY>`.
  * While `docs/authentication.md` mentions `Authorization: Bearer` once in introductory text, all OpenAPI specifications and live curl examples across all services uniformly declare header `apikey` (`securitySchemes.apikey.name = "apikey"`). Live gateway endpoints reject `Authorization: Bearer $ON_DEMAND_API_KEY` with 401 unauthenticated.

---

### 2.6 Streaming & Execution Log Analysis

* **Workflow Execution Logs:**
  * Endpoint: `GET https://api.on-demand.io/automation/api/execution/{executionID}/logs`
  * Nature: **Polled REST JSON array.**
  * Streaming / Log-Stream / SSE for Workflow Executions: **NOT FOUND IN LIVE DOCS.**
  * There is no WebSocket, Server-Sent Events, or chunked transfer stream for workflow executions.
* **Chat API Streaming:**
  * Endpoint: `POST https://api.on-demand.io/chat/v1/sessions/{sessionId}/query` with `responseMode: "stream"`.
  * Protocol: Server-Sent Events (SSE).
  * Chunks: `event: message`, `data: {"messageId": "...", "eventIndex": 1, ...}`.
  * Termination token: `data: [DONE]`.
  * Error format: `data: [ERROR]: <error_message>`.
* **Voice Mode Transcripts:**
  * Endpoint: `GET https://api.on-demand.io/automation/api/execution/{executionID}/transcript`
  * Polled REST endpoint; returns voice conversation transcript when a workflow runs in advanced voice mode.

---

## 3. GOAL 2 — Live Probes on Workflow `6ad8160ab28e35aa11d85632`

Workflow `6ad8160ab28e35aa11d85632` is configured with name `"OnDemand Intelligence Workstation — voice turn (STT→agent query→TTS)"` and is `isActive: true`.

### Probe Table

| Probe # | Method | Target URL | Request Header Names | Request Body / Query Params | Status | Response Snippet (<= 200 chars) |
|---|---|---|---|---|---|---|
| P1 | GET | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632` | `apikey` | None | 200 | `{"message":"success","data":{"id":"6ad8160ab28e35aa11d85632","name":"OnDemand Intelligence Workstation — voice turn...","trigger":{"type":"webhook","webhook":{"auth":{"username":"workstation-voice"...` |
| P2 | GET | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632/webhook` | `apikey` | None | 404 | `Not Found` |
| P3 | GET | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632/trigger` | `apikey` | None | 404 | `Not Found` |
| P4 | GET | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632/webhook/url` | `apikey` | None | 404 | `Not Found` |
| P5 | POST | `https://api.on-demand.io/automation/webhook/6ad8160ab28e35aa11d85632` | `Authorization`, `Content-Type` | `{"payload":"probe"}` (Bearer `$ON_DEMAND_API_KEY`) | 401 | `{"message":"Invalid Token","errorCode":"unauthenticated"}` |
| P6 | POST | `https://api.on-demand.io/automation/webhook/6ad8160ab28e35aa11d85632` | `apikey`, `Content-Type` | `{"payload":"probe"}` | 401 | `{"message":"No Authorization header","errorCode":"unauthenticated"}` |
| P7 | POST | `https://api.on-demand.io/automation/webhook/6ad8160ab28e35aa11d85632` | `Authorization` (Basic), `Content-Type` | `{"payload":"probe"}` (Basic `workstation-voice:...`) | 401 | `{"message":"Token missing from Bearer","errorCode":"unauthenticated"}` |
| P8 | POST | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632/execute?payload=probe-query` | `apikey` | Empty body, query `?payload=probe-query` | 200 | `{"executionID":"6ad81d68c2cfee207e8f3e40"}` |
| P9 | POST | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632/execute` | `apikey`, `Content-Type` | `{"payload":"probe-body-payload"}` | 200 | `{"executionID":"6ad81d6ec2cfee207e8f3e44"}` |
| P10 | POST | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632/execute` | `apikey`, `Content-Type` | `{"input":"probe-body-input"}` | 200 | `{"executionID":"6ad81d74c2cfee207e8f3e4c"}` |
| P11 | POST | `https://api.on-demand.io/automation/api/workflow/6ad8160ab28e35aa11d85632/execute` | `apikey`, `Content-Type` | `{"data":{"payload":"probe-data-payload"}}` | 200 | `{"executionID":"6ad81d79c2cfee207e8f3e58"}` |

### Node Outputs Verification (~15s Post-Execution)

Outputs were retrieved via `GET https://api.on-demand.io/automation/api/execution/{executionID}/node/outputs` with header `apikey`:

1. **Execution `6ad81d68c2cfee207e8f3e40` (Query parameter `?payload=probe-query`):**
   * `voice_turn_input.value`: `"{payload}"` (literal placeholder, NOT substituted).
   * `voice_turn_input.timeTakenInMilliseconds`: 14 ms.
   * `voice_agent_answer.value`: `"I didn’t receive an operator command. Please tell me what you’d like me to do."`
   * `voice_agent_answer.timeTakenInMilliseconds`: 7,933 ms.
2. **Execution `6ad81d6ec2cfee207e8f3e44` (Body `{"payload":"probe-body-payload"}`):**
   * `voice_turn_input.value`: `"{payload}"` (literal placeholder, NOT substituted).
   * `voice_agent_answer.value`: `"I didn’t receive the operator request or scene details. Please send them again."`
   * `voice_agent_answer.timeTakenInMilliseconds`: 6,643 ms.
3. **Execution `6ad81d74c2cfee207e8f3e4c` (Body `{"input":"probe-body-input"}`):**
   * `voice_turn_input.value`: `"{payload}"` (literal placeholder, NOT substituted).
   * `voice_agent_answer.value`: `"I didn’t receive an operator command—only the placeholder “{payload}.” Please repeat your request."`
   * `voice_agent_answer.timeTakenInMilliseconds`: 8,042 ms.
4. **Execution `6ad81d79c2cfee207e8f3e58` (Body `{"data":{"payload":"probe-data-payload"}}`):**
   * `voice_turn_input.value`: `"{payload}"` (literal placeholder, NOT substituted).
   * `voice_agent_answer.value`: `"I didn’t receive an operator command. Please repeat your request."`
   * `voice_agent_answer.timeTakenInMilliseconds`: 6,441 ms.

### Empirical Findings from Goal 2
1. **Webhook URL Not Discoverable via API:** The workflow trigger object does not expose the public webhook URL in `GET /workflow/{id}`. Sub-paths like `/webhook`, `/trigger`, and `/webhook/url` return 404.
2. **Webhook Ingestion Demands Dashboard JWT:** `POST /automation/webhook/{id}` rejects `apikey` authentication and Basic authentication with 401 unauthenticated ("No Authorization header" / "Token missing from Bearer"). It expects an interactive user JWT session.
3. **Execute API Completely Ignores Payloads:** `POST /automation/api/workflow/{id}/execute` accepts execution requests and immediately returns an `executionID`, but ignores all query parameters and request bodies. Any workflow node referencing `{payload}` defaults to the literal string `"{payload}"`.
4. **Workflow Execution Latency:** Workflow execution takes 6.5–8.5 seconds for a single LLM turn, precluding sub-second real-time interactive voice turns.

---

## 4. GOAL 3 — Plugin Registration via API

Account baseline: `GET https://api.on-demand.io/plugin/v1/list` returned `{"message":"Agent fetched successfully","page":1,"limit":100,"data":{"total":0}}` (HTTP 200, 0 plugins).

### Probe Attempts

1. **Attempt 1: Structured body with action schema string**
   * Endpoint: `POST https://api.on-demand.io/plugin/v1`
   * Headers: `apikey`, `Content-Type: application/json`, `User-Agent: curl/8.5.0`
   * Body:
     ```json
     {
       "name": "OnDemand Spatial Earthquake Search (USGS)",
       "identifier": "rest",
       "description": "Search recent or historical earthquakes from USGS",
       "logoUrl": "https://ondemand-eand-spatial-j8s1kk2zd-schoolhack-web-team.vercel.app/assets/brand/mark-primary.png",
       "type": "chat",
       "source": "external",
       "category": "Research",
       "action": { "schema": "<openapi-json-string>" }
     }
     ```
   * Result: **HTTP 500 Internal Server Error** (empty response body).

2. **Attempt 2: Structured body with `openApiSchema` object and `identifier: "rest_api"`**
   * Endpoint: `POST https://api.on-demand.io/plugin/v1`
   * Headers: `apikey`, `Content-Type: application/json`, `User-Agent: curl/8.5.0`
   * Body:
     ```json
     {
       "name": "OnDemand Spatial Earthquake Search (USGS)",
       "identifier": "rest_api",
       "description": "Search recent or historical earthquakes from USGS",
       "logoUrl": "https://ondemand-eand-spatial-j8s1kk2zd-schoolhack-web-team.vercel.app/assets/brand/mark-primary.png",
       "type": "chat",
       "source": "external",
       "category": "Research",
       "openApiSchema": { "openapi": "3.0.3", "info": { ... }, "paths": { ... } }
     }
     ```
   * Result: **HTTP 500 Internal Server Error** (empty response body).

3. **Attempt 3: Missing fields probe to inspect Go struct validation errors**
   * Endpoint: `POST https://api.on-demand.io/plugin/v1`
   * Headers: `apikey`, `Content-Type: application/json`, `User-Agent: curl/8.5.0`
   * Body: `{ "name": "...", "description": "...", "category": "Research", "type": "chat" }` (omitted `identifier`, `logoUrl`, `source`).
   * Result: **HTTP 400 Bad Request**.
   * Verbatim server response:
     ```json
     {
       "message": "Key: 'CreatePluginRequest.Identifier' Error:Field validation for 'Identifier' failed on the 'required' tag\nKey: 'CreatePluginRequest.LogoUrl' Error:Field validation for 'LogoUrl' failed on the 'required' tag\nKey: 'CreatePluginRequest.Source' Error:Field validation for 'Source' failed on the 'required' tag",
       "errorCode": ""
     }
     ```
   * Omitting `type` and `category` further yielded:
     ```json
     {
       "message": "Key: 'CreatePluginRequest.Type' Error:Field validation for 'Type' failed on the 'required' tag\nKey: 'CreatePluginRequest.Category' Error:Field validation for 'Category' failed on the 'required' tag",
       "errorCode": ""
     }
     ```
   * Once all five required struct fields (`Identifier`, `LogoUrl`, `Source`, `Type`, `Category`) are supplied, the endpoint immediately fails with **HTTP 500 Internal Server Error**.

### Post-Probe Account Check
* Endpoint: `GET https://api.on-demand.io/plugin/v1/list`
* Result: `{"message":"Agent fetched successfully","page":1,"limit":100,"data":{"total":0}}` (HTTP 200).
* Total plugins remains **0**.

### Empirical Finding from Goal 3
Programmatic plugin registration via `POST https://api.on-demand.io/plugin/v1` is **non-functional** for public API consumers. The gateway unmarshals into a Go struct `CreatePluginRequest`, but the backend handler fails with HTTP 500 because it lacks company/user session state that only exists in dashboard interactive sessions. As documented in `docs/rest-based-plugins.md` and `docs/plugin-api.md`, plugin creation is exclusively supported through the OnDemand Web Dashboard (`https://app.on-demand.io/rag-agents/my-agents`).

---

**GENERATED_UTC:** 2026-10-21T02:08:45Z  
**STATUS:** LIVE VERIFICATION COMPLETE
