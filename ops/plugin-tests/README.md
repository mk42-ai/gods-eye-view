# Phase D — OnDemand plugin for the render service (raw record)

All timestamps UTC, 2026-11-03.

## Created (verified)
- `create_tool_job.py create` → job `d69c153d-cdc8-4de2-9843-1a9c00f8daf1` (queued 09:37Z) → `AI_TOOL_CREATED` at 09:42:18Z
- Plugin **plugin-1793698938** / agent **agent-1793698938** / mongo id `6ae9ac7a6456bc25b8865df0`, name "Gods-Eye View Render Service", status private, `isAutoSave:true`
- Operations in the generated OpenAPI: `renderScene` (POST /render), `getRenderStatus` (GET /status/{jid}); `getStream` is expressed as an `x-tool-aliases` projection of getRenderStatus (OpenAPI cannot hold two GET operations on one path) — full definition in `plugin-created.json`.
- Generator fetched the live service manifest (`/openapi.json`, `/docs`, `/redoc`, `/` all HTTP 200) through the cloudflared tunnel.
- The plugin declares one required credential field: `Authorization` (HEADER, masked).

## Credential binding (BLOCKED — platform side)
`ondemandmcp__plugin_v1_plugin_configuration_create(pluginId=plugin-1793698938, active=true, fields={Authorization:"Bearer <token>"})`
answered `"Plugin Configuration created successfully"` (config id `6ae9ac7a6456bc25b8865df1`) **but the stored record shows `fields: null`**, and every
subsequent live call through the plugin fails with:

    {"error":"field Authorization is missing in agent plugin config"}

Attempts (all recorded in `live-calls.jsonl`): fields as `{Authorization: value}`, `{Authorization:{site,value}}`, with an extra `fields:[{key,site,value}]`
array, pluginId as the agent id and as the mongo id (HTTP 500 `server_error`), and raw REST PUT/PATCH/POST to
`/plugin/v1/configurations*` variants (404 / 400 `plugin not found`). Updating the plugin itself (`PUT /plugin/v1/<mongo-id>`) succeeds but strips the
field `value`. The public docs index (`/config/v1/public/docs/categories`) lists no plugin-configuration endpoint, so there is no documented
alternative to try. **Result: the plugin exists and is registered, but cannot authenticate against the service from this environment.**

## Live test calls through the plugin (3 attempts, all failed with the same error)
See `live-calls.jsonl` (session ids, traceIds, answers verbatim). The render pipeline itself was exercised directly against the
service's REST API instead (ops/render-service/ and ops/phase-f/) — those are real runs; the plugin-mediated runs are NOT.
