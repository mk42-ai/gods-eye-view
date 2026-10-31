# Validated scene plans (Agent 3 boundary)

Parent owns mounting; this directory does not change routes/config, dependencies, or UI.

```js
import { createScenePlanMiddleware } from './server/scene-plans/index.js';
// Connect-compatible, handles prefix-stripped req.url OR full prefix:
app.use('/api/ondemand/v2/scene-plans', createScenePlanMiddleware());
```

## Stable shared contract for map/video consumers (Agent 5)

`src/scenes/structuredPlan.js` exports `SCENE_PLAN_VERSION = 1`,
`SCENE_PLAN_SCHEMA`, `SCENE_ENTITY_TYPES`, and `validateScenePlan(plan)`.
The validator returns a fresh JSON value or throws `ScenePlanValidationError`
with `code: invalid_scene_plan`, `path`, and a bounded field-oriented message.
Unknown fields/types, nonfinite/coerced numbers, duplicate IDs, invalid references,
quantity >100/group or >300 total, >5 km local radius, invalid public source URLs,
nonchronological/out-of-duration beats, and factual-staging claims are rejected.
The first beat starts at zero; every beat starts strictly before durationSec.
Optional beat cameras use the same **complete** camera shape as the root camera.

Positions are local `eastM,northM` offsets from the verified `location.lat,lon`;
headings are degrees. Quantities represent renderer instances, not factual counts.
All generated scene staging has `illustrative: true`.

Verification's closed vocabulary is:
`{status:'location_verified'|'event_verified',locationSource,checkedAt,limitations:[],eventName?,edition?,eventDate?}`.
`event_verified` means the event/edition/location citation was checked, **not**
that actor placement, counts, camera positions, or an exact course were observed.

## HTTP contract

- `GET /health`: configuration presence only, schema version, default narration settings.
- `POST /construct`: `{prompt,candidate,previousPlan?,selectedTime?,revision?}`.
  Candidate is **exactly** `{name,lat,lon,verified:true,source,sourceUrl}`.
  `sourceUrl` is required at this request boundary. Coordinates must be numbers.
  `revision` is a nonnegative safe integer or short identifier and is echoed.
  Success: `{ok:true,plan,revision,requestId,research,provenance}`.
- `POST /narration`: `{plan,config?,revision?}`. Success contains `audioUrl`,
  `mimeType`, `byteLength`, `durationSec` (number or null), `durationStatus`,
  `transcript`, `speechSchedule`, `requestedConfig`, `synchronization`,
  `verification`, `warnings`, `revision`.
- Failure: `{ok:false,error:{code,message,details?}}`, proper HTTP status.
  `422 needs_clarification`: event edition/location not established.
  `502 scene_plan_validation_failed`: initial output and one correction failed.
  `503 narration_audio_unavailable`: no fresh session-correlated audio proven.

Narration config accepts only `voiceId,modelId,stability,similarityBoost,style,
useSpeakerBoost,speed`. Defaults: George `JBFqnCBsd6RMkjVDRZzb`,
`eleven_multilingual_v2`. These are requests to the plugin, not claims that the
plugin honored settings; `verification.configurationVerified` remains false.

`speechSchedule[] = {beatIndex,atSec,endSec,title,text,entityIds}` is the requested
scene cue schedule, **not forced-aligned audio timestamps**. Browser code must
read actual `audio.duration`, handle `requiresTimingReview`, and not promise
text-length synchronization. MPEG layer-III/PCM WAV duration is measured from
actual bytes when supported; other recognized audio needs browser metadata.

## Provider and evidence boundaries

- Imports existing `server/ondemand/client.js` and `config.js`; no browser keys,
  new secrets, environment changes, or provider endpoint guesses.
- Live docs retrieved successfully through the existing server credential:
  `GET /config/v1/public/docs/categories`, then references for
  `createchatsession`, `submitquery`, and `fetchmedia`.
- Documented integration: `POST /chat/v1/sessions` with `externalUserId,pluginIds`,
  then `POST /chat/v1/sessions/{id}/query` with `query,endpointId,responseMode`,
  `pluginIds`, `fulfillmentOnly`, and documented `modelConfigs`.
  `pluginIds` is the HTTP API field (not the MCP tool's `agentIds`).
- Perplexity plugin `plugin-1722260873`: fresh, bounded, revision-aware research
  cache; no plan-response cache. Named recurring events without edition reject.
  Verified event citations must include an actual retrieved excerpt mentioning
  the edition year, event, and venue. Missing/inaccessible evidence fails closed.
- ElevenLabs plugin `plugin-1789123753`: a fresh session per narration; no old
  sample fallback. A prose URL alone is not proof of generation. Only a media
  record returned by the documented Fetch Media operation matching this session
  and plugin is eligible; actual downloaded bytes must be recognized audio.
- Downloads are public-host/DNS validated, bounded, timed, redirect-revalidated,
  and carry **no** platform credentials. Structured responses never include
  provider error bodies, stack traces, or raw credential-bearing request data.

## Verification

`node --test src/scenes/structuredPlan.test.mjs server/scene-plans/scene-plans.test.mjs`

These are explicitly synthetic fixtures, not evidence of live LLM/TTS success.

## Live checks completed this turn

- Fresh Nominatim candidate → Perplexity classification → actual LLM scene JSON:
  success on first attempt, candidate coordinates preserved, 3 beats,
  person/organizer entities. See `live-verification.json` (real provider output).
- Named Dubai Marathon without edition: real provider path returned
  `422 needs_clarification`. See `live-checks.json`.
- ElevenLabs invocation: **blocked by the connected provider account's payment**.
  The real plugin returned `payment_issue` / `payment_required` with the message
  that its latest invoice must be completed. No new audio was generated and
  Fetch Media returned no matching record. The API now returns a safe,
  actionable `503 narration_provider_payment_required` for this response.
  No old audio or sample is substituted. This is not a successful audio test.
