# Live Cinematic Intelligence Engine — Browser QA Harness

## Overview

The cinematic browser QA harness (`scripts/qa-cinematic.mjs`) drives end-to-end automated verification of the Live Cinematic Intelligence Engine across desktop and mobile viewports (`1440x900` and `390x844`). It interacts exclusively with the production DOM (`#incident-composer-input`, `#incident-composer-submit`, `#cinematic-panel`) and the exposed debug API (`window.__gevCinematic`).

## Prerequisites & Puppeteer Hygiene

- **Runtime**: Node 22 (ES modules).
- **Dependencies**: Puppeteer (repo `devDependency`).
- **Browser Binary**: System Chromium at `/usr/bin/chromium` (configurable via `PUPPETEER_EXECUTABLE_PATH`).
- **Process Isolation**: Puppeteer runs in its own process group with `--no-sandbox` and `--disable-dev-shm-usage`.
- **Teardown & Crash Safety**: Registers signal handlers on `SIGINT`, `SIGTERM`, `SIGHUP`, and process `exit` to issue a SIGKILL to the entire browser process group. Includes an overarching 45-minute wall-clock cap to guarantee no stranded Chromium instances.
- **Exit Code Policy**: Always exits `0` if the test harness ran to completion. Test failures or blocked demos are recorded in the machine-readable output artifact (`qa-cinematic.json`).

## How to Run

```bash
# Run all demos against local development server
node scripts/qa-cinematic.mjs --url http://127.0.0.1:5173

# Run against a deployed preview URL with custom timeout and output directory
node scripts/qa-cinematic.mjs \
  --url https://preview.example.app \
  --out docs/evidence-2026-11-01-cinematic \
  --timeout-sec 240 \
  --viewports 1440x900,390x844

# Filter to specific demos (e.g. Demo B, H, and Acceptance)
node scripts/qa-cinematic.mjs --demos B,H,acceptance
```

## Supported CLI Flags

- `--url`: Base application URL (default: `http://127.0.0.1:5173`).
- `--out`: Directory where screenshots, traces, and reports are saved (default: `docs/evidence-2026-11-01-cinematic`).
- `--viewports`: Comma-separated viewport dimensions (default: `1440x900,390x844`).
- `--timeout-sec`: Maximum wait duration per scenario construction (default: `240`).
- `--demos`: Comma-separated demo identifiers to run (`A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`, `I`, `acceptance`).
- `--cap-min`: Hard process termination cap in minutes (default: `45`).

## Demo Specifications

- **Demo A — Police Response Simulation**:
  Prompt: `Police response simulation at Burj Khalifa, Downtown Dubai`.
  Verifies terminal `runState` is `succeeded`, captures screenshots (first playable shot, final), exports `<demo>-sse-trace.json`.

- **Demo B — Marathon with Test Road Closure**:
  Prompt: `Dubai Marathon on Sheikh Zayed Road with runners, spectators, barriers and traffic`.
  Following successful build, triggers `window.__gevCinematic.inject('road_closure')`, waits 3 seconds, captures post-injection snapshot, and verifies route closure and `sprite.signage.road_closed` insertion.

- **Demo C — Air-Raid Hypothetical Visualization**:
  Prompt: `Hypothetical air-raid visualization over Dubai Marina for training — clearly labelled hypothetical`.
  Verifies that hypothetical classification flags and labels are properly assigned.

- **Demo D — Live Intelligence Injections**:
  Issues three successive injections with increasing relevance; validates that playback position never regresses and `sceneVersion` strictly increments.

- **Demo E — Snapchat Discover Evidence**:
  Clicks the Snapchat Discover button (`#scene-snapchat-discover` or button text match) and checks `#scene-snapchat-metrics`.

- **Demo F — Model Picker Switching**:
  Selects a secondary active endpoint from `getModels()`, updates `scene_direction` task via `setModel()`, and verifies model selection in the subsequent SSE trace.

- **Demo G — Instrumented Latency & Throughput**:
  Computes true Time-To-First-Token (TTFT = `first answer.delta t − run.started t`) and tokens/sec throughput from the SSE trace.

- **Demo H — Grounded Q&A Execution**:
  Executes `qa('Show a wide aerial view')` and `qa('Add another simulated emergency vehicle')`. Verifies state confirmation lines (`✓ confirmed ...`).

- **Demo I — Negative Test (Forced Provider Failure)**:
  Sets `forceModel('predefined-does-not-exist')`, submits build prompt, and verifies that `runState` transitions to `failed` and never prematurely reports `succeeded`.

- **Acceptance Workflow**:
  Comprehensive prompt: `Open Downtown Dubai around Burj Khalifa and create a cinematic marathon with crowds, police roadblocks and moving traffic`.
  Chains test closure injection followed by three sequential Q&A commands:
  1. `Show me the intersection that changed`
  2. `Why did that road close?`
  3. `Replay the last section from a helicopter perspective`

## Status Outcomes

- `passed`: Scenario completed all steps and satisfied all assertions.
- `failed`: Scenario execution or assertion failed (details recorded in `reason`).
- `blocked`: Required UI controls (e.g. Snapchat button) or endpoints were unavailable in the live environment.
- `not_run`: Scenario could not run, typically because `window.__gevCinematic` was missing within the 60-second window.

## Output Artifacts

- `<out>/qa-cinematic.json`: Full machine-readable report with per-demo status, metrics, and error logs.
- `<out>/qa-cinematic.md`: Human-readable summary table and execution metadata.
- `<out>/demo-*-final.png`: Visual proof screenshots at terminal states.
- `<out>/demo-*-sse-trace.json`: Monotonic SSE event ring buffer dumps for post-hoc inspection.
