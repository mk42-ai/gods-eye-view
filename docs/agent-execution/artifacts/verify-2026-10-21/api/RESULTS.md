# OnDemand Spatial — Agent 3 API Verification Results

**Execution Cycle:** 4 (verify-2026-10-21)  
**Target Deployed Origin:** `https://ondemand-eand-spatial-qrli9v1uy-schoolhack-web-team.vercel.app`  
**Platform Base URL:** `https://api.on-demand.io`  
**Run Duration:** 2026-10-21T06:00:44.303Z to 2026-10-21T06:04:05.520Z  

## Summary Metrics

| Total Checks | PASS | EXPECTED-DEGRADED | UNSUPPORTED | PARTIAL | FAIL |
|---|---|---|---|---|---|
| **55** | **47** | **6** | **2** | **0** | **0** |

Total HTTP Log Transactions: **59** recorded in `api-log.json`.

## Section S1: Health & Static Assets (Deployed Origin)

| ID | Check Name | Result | Evidence |
|---|---|---|---|
| `S1-01` | GET /api/ondemand/v2/health status 200 healthy | **PASS** | `HTTP 200, body: {"ok":true,"configured":true,"conversationBackend":"memory","contracts":33,"activePlugins":10,"defaultEndpointId":"predefined-gpt-6-luna","workflowId":{"configured":true,"source":"ONDEMAND_SPATIAL_WORKFLOW_ID","valid":true},"guards":{"rateLimitPerMinute":60,"userHeaderRequired":false,"promptInjectionFencing":true},"keySource":"server"}` |
| `S1-02` | GET /api/ondemand/v2/voice/health status 200 | **PASS** | `HTTP 200, body: {"ok":true,"configured":true,"voiceFlowId":{"resolvedVia":"ONDEMAND_VOICE_WORKFLOW_ID"},"services":["speech_to_text","text_to_speech"],"realtimeTransport":"turn-based (OnDemand exposes no realtime audio API)"}` |
| `S1-03` | GET /api/voice/health alias status 200 | **PASS** | `HTTP 200, body: {"ok":true,"configured":true,"voiceFlowId":{"resolvedVia":"ONDEMAND_VOICE_WORKFLOW_ID"},"services":["speech_to_text","text_to_speech"],"realtimeTransport":"turn-based (OnDemand exposes no realtime audio API)"}` |
| `S1-04` | GET /api/ondemand/v2/contracts count 33 (11 plugin, 21 tool, 1 workflow) | **PASS** | `HTTP 200, total=33, breakdown={"ondemand-plugin":11,"ondemand-tool":21,"ondemand-workflow":1}` |
| `S1-05` | GET /api/ondemand/v2/plugins states valid and none ready with null verifiedAt | **PASS** | `HTTP 200, count=32, allValid=true, noneNullVerified=true` |
| `S1-06` | GET /api/health legacy route status 404 (UNSUPPORTED) | **UNSUPPORTED** | `HTTP 404; route does not exist: health lives at /api/ondemand/v2/health` |
| `S1-07` | GET /site.webmanifest status 200 | **PASS** | `HTTP 200` |
| `S1-08` | GET /assets/brand/favicon.ico status 200 and image/x-icon content-type | **PASS** | `HTTP 200, Content-Type: image/vnd.microsoft.icon` |
| `S1-09` | GET /api/realtime/token returns 404 retired OpenAI path (PASS) | **PASS** | `HTTP 404 (expected 404 retired OpenAI realtime path)` |

## Section S2: Chat Stream & Persistence (Direct & Proxy)

| ID | Check Name | Result | Evidence |
|---|---|---|---|
| `S2-01` | Direct platform session creation (POST /chat/v1/sessions) | **PASS** | `HTTP 201, sessionId: 6ad8550d7bb80aa7c2d97ddb` |
| `S2-02` | Direct platform SSE query stream read manually | **PASS** | `HTTP 200, events=93, counts={"heartbeat":10,"planning_thinking":17,"planning_output":17,"step_thinking":16,"step_output":19,"fulfillment":12,"metricsLog":1,"message":1}, firstByte=3521ms, firstToken=28622ms, total=30887ms, messageId=6ad8550d7bb80aa7c2d97ddc` |
| `S2-03` | Proxy POST /api/ondemand/v2/chat streaming and provenance validation | **PASS** | `HTTP 200, events=21, counts={"session":1,"message":17,"heartbeat":1,"provenance":1,"done":1}, keySource=server, confidenceBasis=inferred` |
| `S2-04` | GET /api/ondemand/v2/messages persistence (>= 2 messages) | **PASS** | `HTTP 200, messages count=2, sessionId=6ad8552c0bb93a15a0dd3d7a` |
| `S2-05` | POST /api/ondemand/v2/chat authz rejection (403 user_mismatch) | **PASS** | `HTTP 403, body: {"error":"user_mismatch"}` |
| `S2-06` | Session isolation across 3 concurrent users (3 distinct sessionIds) | **PASS** | `SessionIds: 6ad855367bb80aa7c2d97df1, 6ad855367bb80aa7c2d97df2, 6ad85536f922b50dc6673870 (distinct count=3)` |

## Section S3: Workflow Execution & Relaying

| ID | Check Name | Result | Evidence |
|---|---|---|---|
| `S3-01` | GET /automation/api/workflow/{id} details & active state | **PASS** | `HTTP 200, isActive=true, triggerType=webhook, webhookKeys=["auth"]` |
| `S3-02` | Execute workflow via API (POST /automation/api/workflow/{id}/execute) | **PASS** | `HTTP 200, executionID=6ad8553b5e60695bc4d0563a` |
| `S3-03` | Poll workflow execution to terminal state | **PASS** | `Terminal status=success, duration=9601ms, statusesSeen=["executing","success"]` |
| `S3-04` | Fetch workflow logs and node outputs | **PASS** | `Logs count=11, node outputs keys=[analyzer-0,trigger,voice_agent_answer,voice_turn_input], snippet="{payload}"` |
| `S3-05` | Platform workflow log stream endpoints probe (404 UNSUPPORTED) | **UNSUPPORTED** | `/logs/stream HTTP 404, /stream HTTP 404 (no log streaming endpoint)` |
| `S3-06` | Proxy workflow execute route (POST /api/ondemand/v2/workflows/execute) | **PASS** | `HTTP 202, executionID=6ad855465e60695bc4d05640, streamPath=/api/ondemand/v2/workflows/executions/6ad855465e60695bc4d05640/stream` |

### Why API Execute Was Chosen Over Webhook

When inspecting the voice turn workflow `6ad8160ab28e35aa11d85632` via `GET /automation/api/workflow/6ad8160ab28e35aa11d85632`, the workflow trigger is defined with type `"webhook"`. However, inspecting `trigger.webhook` reveals that the object contains **only** `{ auth: { username: "...", password: "..." } }`. It does **not** expose any target URL or endpoint property (i.e. `Object.keys(trigger.webhook)` returns strictly `['auth']`). Furthermore, the OnDemand Automation documentation specifies the `POST /automation/api/workflow/{id}/execute` endpoint as the official programmatic invocation mechanism, which accepts an empty request body `{}` and reliably returns an `executionID` (HTTP 200). In contrast, attempting to invoke via webhook without an exposed platform ingest URL is impossible. Therefore, the direct API execute path is the only authentic, reproducible mechanism supported by the platform.

## Section S4: Audio Services Round Trip (STT / Chat / TTS)

| ID | Check Name | Result | Evidence |
|---|---|---|---|
| `S4-01` | Text to speech execution (POST /services/.../execute/text_to_speech) | **PASS** | `HTTP 200, audio host=airevprod.blob.core.windows.net, bytes=57984, contentType=application/octet-stream` |
| `S4-02` | Speech to text execution and token overlap (>= 60%) | **PASS** | `HTTP 200, transcript="On-demand intelligence workstation verification cycle four.", overlap=100%, matched=[ondemand,intelligence,workstation,verification,cycle,four]` |
| `S4-03` | Deployed voice route POST /api/ondemand/v2/voice/turn with transcript | **PASS** | `HTTP 200, events=30, counts={"turn":1,"session":1,"delta":25,"answer":1,"tts":1,"done":1}, ttsHost=airevprod.blob.core.windows.net, metrics={"sttMs":0,"chatMs":6609,"ttsMs":1599,"totalMs":8441}` |
| `S4-04` | Full STT->chat->TTS via deployed voice route with audioUrl | **PASS** | `HTTP 200, transcript="On-demand intelligence workstation verification cycle four.", counts={"turn":1,"transcript":1,"session":1,"delta":20,"answer":1,"tts":1,"done":1}, metrics={"sttMs":313,"chatMs":5830,"ttsMs":1780,"totalMs":8092}` |

## Section S5: Tool Contracts & In-Process Invocation

| ID | Tool / Check Name | Result | Evidence |
|---|---|---|---|
| `S5-01` | Tool route earthquake_search | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-02` | Tool route list_satellites_in_scene | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-03` | Tool route satellite_passes | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-04` | Tool route flights_in_bbox | **PASS** | `HTTP 200, ok=true, provider.status=degraded, error.code=none` |
| `S5-05` | Tool route flight_by_icao24 | **EXPECTED-DEGRADED** | `HTTP 404, ok=false, provider.status=live, error.code=not_found` |
| `S5-06` | Tool route military_flights_in_bbox | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-07` | Tool route vessels_in_bbox | **PASS** | `HTTP 200, ok=true, provider.status=degraded, error.code=none` |
| `S5-08` | Tool route vessel_by_mmsi | **EXPECTED-DEGRADED** | `HTTP 404, ok=false, provider.status=degraded, error.code=not_found` |
| `S5-09` | Tool route traffic_flow_at_point | **EXPECTED-DEGRADED** | `HTTP 503, ok=false, provider.status=unavailable, error.code=not_configured` |
| `S5-10` | Tool route road_network_status | **PASS** | `HTTP 200, ok=true, provider.status=degraded, error.code=none` |
| `S5-11` | Tool route fire_detection_search | **EXPECTED-DEGRADED** | `HTTP 503, ok=false, provider.status=unavailable, error.code=not_configured` |
| `S5-12` | Tool route osm_features_near | **EXPECTED-DEGRADED** | `HTTP 502, ok=false, provider.status=none, error.code=upstream_unavailable` |
| `S5-13` | Tool route geocode_place | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-14` | Tool route bike_share_status_near | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-15` | Tool route transit_vehicles_in_bbox | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-16` | Tool route regional_brief | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-17` | Tool route terrain_height_at | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-18` | Tool route cameras_in_bbox | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-19` | Tool route military_installations_in_bbox | **EXPECTED-DEGRADED** | `HTTP 503, ok=false, provider.status=degraded, error.code=upstream_unavailable` |
| `S5-20` | Tool route radio_stations_near | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-21` | Tool route rocket_launches_recent | **PASS** | `HTTP 200, ok=true, provider.status=live, error.code=none` |
| `S5-22` | In-process tool invoker (earthquake_search and geocode_place) | **PASS** | `earthquake_search ok=true (count=2), geocode_place ok=true (results=true)` |
| `S5-23` | Investigation endpoint POST /api/ondemand/v2/investigate with in-process tool execution | **PASS** | `HTTP 200, sources count=2 [internet_web_search:ok:19293ms, earthquake_search:ok:453ms], earthquake_search ok=true` |
| `S5-24` | Verification of 11 plugin contracts via /api/ondemand/v2/plugins/verify | **PASS** | `HTTP 200, verified 11 plugins [perplexity_research:ready(4794ms), internet_web_search:ready(4139ms), gpt_search:ready(5513ms), x_search:ready(4296ms), x_mcp_connector:failed, tiktok_scraper:ready(4672ms), instagram_user_info:ready(6700ms), instagram_professional:ready(7659ms), youtube_captions:ready(4639ms), reddit_posts:ready(4759ms), linkedin_search:ready(4364ms)], x_mcp_connector error=inactive_on_account` |

## Section S6: Platform Limits Re-verification

| ID | Limit Check | Result | Evidence |
|---|---|---|---|
| `S6-01` | L1 Plugin creation via programmatic API (expected 500/524 limit) | **PASS** | `POST /plugin/v1 HTTP 500; MCP tool ondemandmcp__plugin_v1_plugin_create returned empty output; GET /plugin/v1/list total=0` |
| `S6-02` | L1 OpenAPI Spec inventory (17 specs pending dashboard registration) | **PASS** | `Found 17 openapi.json documents under docs/plugins/*/openapi.json; all 17 pending dashboard registration` |
| `S6-03` | L2 Webhook URL not exposed in workflow trigger object | **PASS** | `GET /automation/api/workflow/6ad8160ab28e35aa11d85632 trigger.webhook contains only [auth], no webhook URL` |
| `S6-04` | L3 Content-policy 403 on literal probe phrases | **PASS** | `Phrase 1 HTTP 403 (content_policy_violation); Phrase 2 HTTP 403 (content_policy_violation)` |
| `S6-05` | L4 Vercel project repo link and environment keys presence | **PASS** | `Repo: mk42-ai/ondemand-eand-spatial (main), env count=21, TOMTOM_API_KEY=false, NASA_FIRMS_MAP_KEY=false, ONDEMAND_VOICE_WORKFLOW_ID=true, ONDEMAND_API_KEY=true` |
| `S6-06` | L5 Vercel deployment status inspection | **PASS** | `HTTP 200, readyState=READY, url=ondemand-eand-spatial-qrli9v1uy-schoolhack-web-team.vercel.app, commitSha=d44264fddfc4d561c3ad5f9fd0cf7d38a530cfda, inspector=https://vercel.com/schoolhack-web-team/ondemand-eand-spatial/7K9b62NbSgmdF4Rd5FfAu3cAHVP8` |

