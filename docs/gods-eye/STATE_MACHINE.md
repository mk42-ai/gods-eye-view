# Scene state machine

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> parsing: buildFromPrompt(text)
  parsing --> geocoded: dictionary / register / Nominatim hit + AOI in register (or user accepts "Add site")
  parsing --> error: no place · declined
  geocoded --> routing: POST /footage/route/plan (≤ 4 s)
  routing --> flying: scenePath (agent or great-circle fallback → ROUTE: FALLBACK)
  flying --> fetching: SSE /footage/stream opened while S0→S4 flies
  fetching --> ranked: Web Worker rankScore
  ranked --> playing: S4 arrival → top clip autoplays
  playing --> saved: IndexedDB + /footage/scenes mirror
  saved --> routing: Recreate (replay from S0, re-call route agent, diff)
  saved --> playing: Open (zero-network, straight to S4, clip ARMED)
  error --> parsing: retry
  routing --> error
  flying --> error
  fetching --> error
```

Stage events (`gev:scene-stage`): S0 → S1 → S2 → S3 → S4, each bound to a `camera.flyTo` completion
(or a `setView` cut under `prefers-reduced-motion`). Reveal layers per stage are listed in
`src/gods-eye/camera/ladder.js`. Every scene owns an `AbortSignal` (`store.beginScene`); a newer
scene aborts the older one's route call, flight, stream and monitor, and `mapLayers.clear(oldId)`
removes its pins/routes before the new scene renders.
