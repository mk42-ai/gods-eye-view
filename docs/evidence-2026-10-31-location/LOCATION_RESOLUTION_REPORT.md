# Research-first location resolution — 2026-10-31 (UTC)

Base: `feat/scene-video-evidence` @ `bf9d347` (edited in place). Preview: https://ondemand-agent-56wy5f2wv-schoolhack-web-team.vercel.app (`dpl_4cHyhFAaizTqX9KrHczZo3pPUMbC`).

## Root cause
`/incidents/locate` found no OSM hit for "kanes boxing gym abu dhabi", so it fell back to model entity extraction (`verified:false`). The composer then either showed a picker or sent that candidate to `/scene-plans/construct`, whose `validateCandidate()` rejected anything not `verified:true` with a `source` and `sourceUrl` → HTTP 400 "A verified, attributed geocoder candidate is required." Snapchat strict scope was not involved in the failure; it only shared the panel.

## Changes
- `server/scene-plans/location.js` (new): Perplexity location-research prompt with a strict JSON schema (name, aliases, address, branch, district, city, sourced lat/lon or null, confidence, citations, nearby features). Resolution order: name variations → OSM Nominatim + Photon; researched address/host building; research-sourced coordinates; district centroid; city centroid; else a labelled unverified hint estimate. Matching is symmetric and transliteration-tolerant (Fotouh↔Foutouh).
- `server/scene-plans/index.js`: the candidate is now an optional hint. Verified hints are used as-is; everything else is resolved. `verification.status` gains `location_approximate`, with a limitation line giving precision, confidence and source count. The response adds `locationResolution` and `anchor`, and provenance carries the model.
- Model: `SCENE_PLAN_ENDPOINT_ID`, default `predefined-gpt-6.1-sol`; `SCENE_PLAN_REASONING_EFFORT`, default `medium`. Both are applied to every research and planning query. Narration is unchanged.
- Composer: with structured planning, any locate result builds, including unverified, ambiguous, empty or failed. There is no picker, and the hint is never upgraded to verified. The AOI gate applies to the resolved anchor.
- Legend: the badge reads "Approximate location – confidence X%, based on N sources", with precision, the matched OSM name, the researched address, and other branches. Resolved locations and branches are drawn as cited dots. Window recolouring still restyles without a new request.
- Snapchat: moved into a collapsed "Optional · Snapchat discovery (separate from scene build)" section, with copy saying strict bounds apply only to Snapchat results.
- Research requests may run up to 160–170 s, within the 300 s function limit. The first deploy showed Perplexity RAG exceeding the old 110 s bound.

## Limitations
- The Kane's scene has dots but no lines. Research names Airport Road, but OSM returned no road geometry for it, and lookalike shop names are rejected.
- The anchor is the host mall (Foutouh al Khair Centre). It is not the gym unit, so it is labelled APPROXIMATE (address precision, 78%).
- A build takes about 2 minutes, mostly in Perplexity RAG (60–110 s).
- "GPT 6.1 Ultra Fast" does not exist in the registry, so `gpt-6.1-sol` is used.
