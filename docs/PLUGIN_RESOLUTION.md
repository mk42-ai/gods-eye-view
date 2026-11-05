# Plugin resolution — status of the OnDemand agent registration

_Recorded 2026-09-18 (UTC) by the E2E verification pass against preview `https://sb-1dqoce558p0v.vercel.run`._

## Live registration was NOT performed

The six REST plugins described in `docs/registration/ONDEMAND_REGISTRATION_PACK.md` are **not registered on OnDemand**. Nothing was created, and no plugin id exists yet. Evidence: `GET /api/ondemand/selftest` step 4 ("built-in tool/plugin invocation") on 2026-09-18T16:57:28Z was **SKIP** with `skipReason: "no plugin id in env and the account's Agents API listing is empty (GET /plugin/v1/list -> HTTP 200, total=0); no documented chat agent id was invented"`, and `GET /api/ondemand/health` reports `env.sources.defaultPluginIds: "unset"`.

### Why

1. **Agent / REST-plugin creation has no public API.** `docs/ONDEMAND_API_CURRENT.md` §18.1 and §18.2 (b), re-validated live on 2026-09-18: creation is "My Agents → Create Agents" in the dashboard (`docs/rest-based-plugins.md`); the public plugin API is `GET /plugin/v1/list` only; the keyed operations index (40 operations) has no plugin/agent create, update or publish call. The platform-internal MCP tools `plugin_v1_plugin_create` / `plugin_v1_plugin_configuration_create` / `public_v1_plugin_ai_generated_tool_create` imply a private `POST /plugin/v1/…` surface, but it is not a public API surface, is not documented on any page, and was deliberately **not** used — an agent created through an undocumented path could not be reproduced by the project owner or supported.
2. **No OnDemand dashboard credentials exist in this environment.** Only the REST API key is present (as the `ONDEMAND_API_KEY` environment variable on the preview; its value was never printed). The API key authenticates `api.on-demand.io` calls; it does not sign in to `app.on-demand.io`.
3. **Browser automation of the dashboard would need the account login**, which was not provided. Exactly what a human (or a supervised browser session) needs to finish the registration:
   - the OnDemand dashboard login **e-mail + password** for the account that owns the API key (or the **SSO** provider login if the account uses Google/Microsoft sign-in),
   - the **2FA code / authenticator** if two-factor authentication is enabled on that account,
   - the six `docs/plugins/<id>/openapi.json` files (regenerated against the permanent host — see below).

### The alternative that was considered and rejected

`plugin_v1_plugin_create` (platform-internal MCP) would create a plugin record programmatically. It is not part of the public OnDemand API (`docs/ONDEMAND_API_CURRENT.md` §18.2 (b): "NOT FOUND IN LIVE DOCS"), so it was not used. If the project owner wants an API-driven path, the request should go to OnDemand for a documented `POST /plugin/v1/...` create operation; until then the dashboard is the only supported route.

## Ids pending

| Plugin      | Spec                                    | Tools (verified live 2026-09-18, `docs/plugins/<id>/TEST_PROOF.md`)                                    | OnDemand plugin id | Blocker                                               |
| ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------- |
| satellites  | `docs/plugins/satellites/openapi.json`  | `list_satellites_in_scene` 200 live, `satellite_passes` 200 live                                       | **pending**        | dashboard login                                       |
| flights     | `docs/plugins/flights/openapi.json`     | `flights_in_bbox` 200 degraded (adsb.lol regional fallback), `flight_by_icao24` 200 live               | **pending**        | dashboard login                                       |
| military    | `docs/plugins/military/openapi.json`    | `military_flights_in_bbox` 200 live                                                                    | **pending**        | dashboard login                                       |
| vessels     | `docs/plugins/vessels/openapi.json`     | `vessels_in_bbox` 200 degraded (demo replay), `vessel_by_mmsi` 200 degraded (demo replay)              | **pending**        | dashboard login                                       |
| traffic     | `docs/plugins/traffic/openapi.json`     | `traffic_flow_at_point` 503 `not_configured` (no `TOMTOM_API_KEY`), `road_network_status` 200 degraded | **pending**        | dashboard login (+ `TOMTOM_API_KEY` for live answers) |
| earthquakes | `docs/plugins/earthquakes/openapi.json` | `earthquake_search` 200 live                                                                           | **pending**        | dashboard login                                       |

## What happens once the ids exist

1. Put them on Vercel as `ONDEMAND_DEFAULT_PLUGIN_IDS=<id1>,<id2>,…` (comma-separated; the proxy passes them as `pluginIds` on chat sessions / queries — max 20 per the session schema).
2. `GET /api/ondemand/health` → `env.sources.defaultPluginIds` switches from `unset` to the env name; `GET /api/ondemand/selftest` step 4 switches from SKIP to PASS/FAIL with a real tool invocation.
3. Fill the "Record ids here" table in `docs/registration/ONDEMAND_REGISTRATION_PACK.md` §5.

## Server URL caveat (must be fixed before registering)

The committed specs carry `servers[0].url = https://sb-1dqoce558p0v.vercel.run`, the **ephemeral Vercel Sandbox preview** used for this verification. It will expire. Regenerate against the permanent deployment first — `node scripts/generate-tool-openapi.mjs --server https://<permanent-host>` — or edit the server URL of each agent in the dashboard afterwards; a plugin registered against the sandbox host will fail as soon as the sandbox is gone.

## Plugin lifecycle (2026-10-21)

An honest plugin lifecycle coordinator (`server/ondemand/foundation/plugin-lifecycle.js`) and UI management panel (`src/ondemand/pluginPanel.js`) replace optimistic checks with real upstream verification.

### State Machine

```
  [ Contract Registered ]
            │
            ▼
       discovered
            │
            ▼  (verify initiated)
        installing       ─── (sessions.create failure) ───┐
            │                                             │
            ▼  (session accepted)                         │
      authenticating     ─── (query.sync failure) ────────┼──► failed {code, httpStatus, message, retryable, failedAt}
            │                                             │      ▲
            ▼  (probe query answered)                     │      │
          ready                                           │      │  (inactive contract fails immediately without probe)
       │         ▲                                        │      │
(turn) │         │ (turn ended ok)                        │      │
       ▼         │                                        │      │
      invoking ──┴────────── (turn error) ────────────────┘──────┘
```

- **`discovered`**: Contract is registered in `contractRegistry`, but has not yet been verified live.
- **`installing`**: Attaching plugin to a new session via `sessions.create({ pluginIds: [id] })`.
- **`authenticating`**: Session accepted; running 1-shot probe query (`query.sync`) with `pluginIds: [id]`. This is where account-level entitlement and agent-activation issues surface.
- **`ready`**: Probe answered with valid response; records `verifiedAt`, `latencyMs`, `answerPreview` (≤120 chars), and `executedAgents` if present. Cached for 10 minutes.
- **`invoking`**: A user turn is currently executing with this plugin attached.
- **`failed`**: Upstream error occurred. Inactive contracts (`availability: 'inactive'`) fail immediately with `inactive_on_account` without making network calls.

### Error Codes

| Code                   | Upstream status / Condition                                             | Retryable | Description                                                       |
| ---------------------- | ----------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `inactive_on_account`  | Contract `availability: 'inactive'` or HTTP 400 with `inactiveAgentIds` | No        | Plugin agent is disabled or missing configuration on the account. |
| `rejected_by_session`  | HTTP 400 with `invalidAgentIds`                                         | No        | Upstream rejected agent as invalid for the session.               |
| `auth_failed`          | HTTP 401 / 403                                                          | No        | OnDemand API key is invalid or unauthorized.                      |
| `rate_limited`         | HTTP 429                                                                | Yes       | OnDemand rate limit reached; backoff and retry.                   |
| `upstream_unavailable` | HTTP 5xx / timeout / network abort                                      | Yes       | Upstream API timeout or temporary service unavailability.         |
| `not_configured`       | Missing server key or client                                            | No        | Server is not configured with OnDemand credentials.               |

### Live Probe Result

- **Target**: `internet_web_search` (`plugin-1713924030`)
- **Timestamp**: `2026-10-21T02:29:02.924Z`
- **Result State**: `ready`
- **Latency**: `4724 ms`
- **Answer Preview**: `"READY"`
- **Transitions**: `discovered` → `installing` (session `6ad8231ff922b50dc667340f` created) → `authenticating` (1-shot probe query) → `ready` (response received).
