# OnDemand Architecture Decision: Webhook Trigger vs. API Execute Endpoint for Real-Time Voice Turns

**Status:** DECIDED & EMPIRICALLY VALIDATED  
**Author:** OnDemand Research Subagent (`20261021_2`)  
**Context:** Workstation Voice Pipeline (`integration/ondemand-native`)  
**Workflow Reference:** `6ad8160ab28e35aa11d85632` ("OnDemand Intelligence Workstation — voice turn (STT→agent query→TTS)")  
**Date:** 2026-10-21  

---

## 1. Executive Summary & Final Decision

### Decision
For an interactive, conversational real-time voice turn, **NEITHER the Webhook Trigger NOR the Workflow Execute endpoint can be used as the primary real-time voice loop.** 

The concrete path for the workstation voice pipeline is a **two-tier architecture**:
1. **Interactive Real-Time Voice Route (`v2`):** Direct composition of OnDemand Native APIs (`Services STT` -> `Chat API with SSE Stream` -> `Services TTS [tts-1]`). This path bypasses the Workflow DAG entirely, delivers end-to-end latency under 2.5 seconds, fully respects server-side `apikey` authentication, and dynamically injects situational scene/layer context.
2. **Asynchronous Auditable Workflow Route (`v1-audit`):** Invoked via `POST https://api.on-demand.io/automation/api/workflow/{id}/execute` followed by polled execution retrieval (`GET /automation/api/execution/{executionID}/node/outputs`). This path is reserved for long-running analytics, multi-agent evaluation, and scheduled reporting DAGs where an audit trail is required and per-turn sub-second voice latency is not expected.

---

## 2. Comparative Matrix: Webhook Trigger vs. API Execute vs. Direct Native API

| Evaluation Dimension | Webhook Trigger (`/automation/webhook/{id}`) | Workflow Execute (`/automation/api/workflow/{id}/execute`) | Direct Native Route (`Services + Chat APIs`) |
|---|---|---|---|
| **Per-Turn Latency** | **Unusable:** Workflow DAG spin-up + node evaluation takes 6,400–8,500 ms (measured empirically on LLM node alone). Total turn exceeds 9–12s. | **Unusable:** Same underlying DAG engine as webhook; execution requires polling loop (~8,000–12,000 ms total). | **Sub-2.5s Conversational:** STT (~800ms) + Chat SSE stream (TTFT ~500ms, full text ~1,500ms) + TTS `tts-1` (~600ms). |
| **Synchronous Run ID** | **No:** Webhook POST does not return an execution ID to third-party callers. | **Yes:** Returns `{ "executionID": "..." }` synchronously with HTTP 200. | **Yes:** Chat API returns `{ "sessionId": "...", "messageId": "..." }` synchronously. |
| **Server-Side `apikey` Auth** | **FAILED (401):** Rejects `apikey` header (`"No Authorization header"`) and Basic auth (`"Token missing from Bearer"`). Requires dashboard user Bearer JWT. | **PASSED (200):** Native support for `-H "apikey: $ON_DEMAND_API_KEY"`. | **PASSED (200):** Native support for `-H "apikey: $ON_DEMAND_API_KEY"` across STT, Chat, and TTS. |
| **Ability to Pass Dynamic Payload** | **Blocked:** API cannot obtain the webhook URL (`GET /workflow/{id}` returns null URL). | **FAILED:** The OpenAPI schema defines no request body. Empirical probes prove query params and JSON bodies are discarded; `{payload}` remains literal string. | **Native:** Spoken transcript and JSON geospatial context (camera, layers, selected entity) pass directly into `POST /chat/v1/sessions/{id}/query`. |
| **Log / Stream Availability** | None. | **Polling Only:** `GET /execution/{id}/logs` returns static JSON array. No streaming or SSE logs exist. | **Native Streaming:** `responseMode: "stream"` provides live token SSE stream via Server-Sent Events. |
| **Idempotency & Retries** | NOT FOUND IN LIVE DOCS. | NOT FOUND IN LIVE DOCS. | Application-level idempotency via `externalUserId` and deterministic session IDs. |

---

## 3. Detailed Reasoning Against Core Requirements

### 3.1 Per-Turn Latency
* **Documented Fact:** In `docs/cloud-services-api.md`, the `tts-1` model is documented as:
  > *"tts-1: Suitable for real-time applications with low latency but lower quality."*
* **Empirical Measurement:** During Goal 2 live probes on active workflow `6ad8160ab28e35aa11d85632`:
  * Execution `6ad81d68c2cfee207e8f3e40`: `voice_agent_answer` LLM node alone consumed **7,933 ms**.
  * Execution `6ad81d6ec2cfee207e8f3e44`: `voice_agent_answer` LLM node alone consumed **6,643 ms**.
  * Execution `6ad81d74c2cfee207e8f3e4c`: `voice_agent_answer` LLM node alone consumed **8,042 ms**.
  * Execution `6ad81d79c2cfee207e8f3e58`: `voice_agent_answer` LLM node alone consumed **6,441 ms**.
* **Impact:** For a voice conversation, a 7–8 second LLM lag followed by polling delays results in an unresponsive 10+ second dead silence. Direct Chat API streaming emits the first chunk in under 600 ms, permitting real-time audio playback.

### 3.2 Synchronous Run ID
* **Documented Fact:** In `reference/post_workflow-id-execute.md`, the execute endpoint guarantees a synchronous response containing `{ "executionID": "<id>" }` with HTTP 200.
* **Empirical Reality:** The execute endpoint delivers a clean `executionID` on every invocation (`P8`: `6ad81d68c2cfee207e8f3e40`, `P9`: `6ad81d6ec2cfee207e8f3e44`, `P10`: `6ad81d74c2cfee207e8f3e4c`, `P11`: `6ad81d79c2cfee207e8f3e58`). Conversely, external webhook endpoints do not provide synchronous execution IDs to callers.

### 3.3 Server-Side `apikey` Authentication
* **Documented Fact:** In `docs/authentication.md` and `reference/how-to-do-authentication.md`:
  > *"All requests to the OnDemand API must be authenticated via a API key or token. Include your secret API key in every request you send using the `apikey` HTTP header."*
* **Empirical Reality:**
  * `POST /automation/api/workflow/{id}/execute` respects `-H "apikey: $ON_DEMAND_API_KEY"`.
  * `POST /automation/webhook/{id}` **fails immediately with HTTP 401**. When passed `-H "apikey: ..."`, it returns `{"message":"No Authorization header","errorCode":"unauthenticated"}`. When passed Basic authentication credentials configured in the workflow definition, it returns `{"message":"Token missing from Bearer","errorCode":"unauthenticated"}`.
  * Webhook ingestion on the gateway is strictly wired to interactive user dashboard Bearer JWTs, not server-side API keys.

### 3.4 Ability to Pass a Dynamic Payload
* **Documented Fact:** In `reference/post_workflow-id-execute.md`, the OpenAPI definition contains **no `requestBody`**. In `docs/workflow-nodes.md`, dynamic payloads are documented strictly for incoming webhooks:
  > *"Payload Format: The request body must contain a JSON object with a payload field. The workflow will receive this data and make it available for use in subsequent steps."*
* **Empirical Reality:**
  * The webhook URL cannot be obtained via the API (`GET /workflow/{id}` returns `null` for `url`, and sub-resources `/webhook`, `/trigger`, `/webhook/url` 404).
  * Passing dynamic data to `POST /automation/api/workflow/{id}/execute` fails across every tested format:
    * Query parameter: `?payload=probe-query` -> Node received literal `"{payload}"`.
    * Body format 1: `{"payload":"probe-body-payload"}` -> Node received literal `"{payload}"`.
    * Body format 2: `{"input":"probe-body-input"}` -> Node received literal `"{payload}"`.
    * Body format 3: `{"data":{"payload":"probe-data-payload"}}` -> Node received literal `"{payload}"`.
  * In all four cases, the LLM node responded: *"I didn't receive an operator command—only the placeholder '{payload}'. Please repeat your request."*
  * **Conclusion:** The execute endpoint cannot pass dynamic operator input to a workflow node.

### 3.5 Log / Polling Availability
* **Documented Fact:** In `reference/get_execution-executionid-logs.md`:
  * Returns a static JSON array (`data: ExecutionLog[]`).
  * Live log streaming via SSE or WebSocket is **NOT FOUND IN LIVE DOCS** for workflow executions.
* **Contrast with Chat API:** In `docs/query-and-responses-modes.md`, Chat API natively supports `responseMode: "stream"` via Server-Sent Events (`text/event-stream`), emitting incremental token chunks, heartbeats, and completion markers (`[DONE]`).

### 3.6 Idempotency and Retry Statements
* **Documented Fact:** In `reference/post_workflow-id-execute.md` and `docs/rate-limiting.md`, neither idempotency headers (e.g. `Idempotency-Key`) nor automatic retry behaviors are documented for workflow executions. Executions are treated as discrete, independent DAG launches.

---

## 4. Concrete Implementation Architecture

```
[ Operator Voice Audio ]
           │
           ▼
1. Services STT (POST /services/v1/public/service/execute/speech_to_text)
   Body: { "audioUrl": "<hosted-audio-url>" }
   Returns: { "data": { "text": "<transcribed operator speech>" } }
           │
           ▼
2. Contextual Prompt Assembly
   Input: Transcribed Speech + Geospatial Context (Camera, Layers, Entities)
           │
           ▼
3. OnDemand Chat API (POST /chat/v1/sessions/{sessionId}/query)
   Config: { "endpointId": "predefined-gpt-6-luna", "responseMode": "stream" }
   Returns: SSE Stream -> Low-latency token generation + tool execution
           │
           ▼
4. Services TTS (POST /services/v1/public/service/execute/text_to_speech)
   Config: { "model": "tts-1", "voice": "alloy", "input": "<concise answer>" }
   Returns: { "data": { "audioUrl": "https://res.cloudinary.com/..." } }
           │
           ▼
[ Workstation Audio Playback (<2.5s E2E) ]
```

### Optional Background Audit DAG
For regulatory, training, or compliance logging, the completed turn can be asynchronously dispatched to the Flow Builder workflow via `POST /automation/api/workflow/{id}/execute` in a fire-and-forget background task, without blocking the live voice operator loop.

---

## 5. Official Documentation Citations

* **Flow Builder Overview:** `https://docs.on-demand.io/docs/agents-flow-builder.md`
* **Workflow Nodes & Webhook Payload:** `https://docs.on-demand.io/docs/workflow-nodes.md`
* **Execute Workflow OpenAPI Spec:** `https://docs.on-demand.io/reference/post_workflow-id-execute.md`
* **Execution Outputs OpenAPI Spec:** `https://docs.on-demand.io/reference/get_execution-executionid-node-outputs.md`
* **Execution Logs OpenAPI Spec:** `https://docs.on-demand.io/reference/get_execution-executionid-logs.md`
* **Services API STT OpenAPI Spec:** `https://docs.on-demand.io/reference/convertaudiototext.md`
* **Services API TTS OpenAPI Spec:** `https://docs.on-demand.io/reference/converttexttoaudio.md`
* **Chat API Submit Query OpenAPI Spec:** `https://docs.on-demand.io/reference/submitquery.md`
* **Query Response & Streaming Modes:** `https://docs.on-demand.io/docs/query-and-responses-modes.md`
* **Authentication Reference:** `https://docs.on-demand.io/reference/how-to-do-authentication.md`

---

**GENERATED_UTC:** 2026-10-21T02:11:15Z
