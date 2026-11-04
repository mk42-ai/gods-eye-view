# Common brief for verify-cycle-4 subagents (read fully before acting)

REPO (already checked out, do NOT clone, do NOT switch branch, do NOT modify source files unless you are Agent 5):
  /home/appuser/work/6692b763e851d28a036ab30e/6ad7d892f922b50dc6673071/gods-eye-view   (branch integration/ondemand-native, HEAD 226217f, tag checkpoint-2026-10-21-verify-cycle4)

TARGET URLS (try in this order; record in every result which one you actually used):
  1. PRIMARY  https://ondemand-eand-spatial-qrli9v1uy-schoolhack-web-team.vercel.app   (Vercel deployment dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8, READY, commit d44264f) — verified 200 at 2026-10-21T04:17Z
  2. sandbox  https://sb-1dqoce558p0v.vercel.run  — returned 404 at 04:17Z (expired) → skip unless it comes back
  3. fallback https://ondemand-eand-spatial-opal.vercel.app (200)   4. https://ondemand-eand-spatial-3lmhl22k7-schoolhack-web-team.vercel.app (200, older commit)

APP FACTS (verified from source + a live probe at 04:25Z):
  - Vanilla JS + Vite + Cesium globe. Boot: `#loading-screen` (class `hidden` once booted, ~6 s headless with SwiftShader) with the network-graph backdrop
    (`background-image` contains `/assets/brand/backdrop-network.png`). Title/wordmark "OnDemand Intelligence Workstation".
  - `?welcome=0` suppresses the first-run/welcome screen (`#first-run-launcher`, `#first-run-title`); omit it (or `?welcome=1`) to capture the welcome/auth-style screen.
    Deep link used by the existing harness: `/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`
  - Debug handles after boot: `window.__godsEyeView` ({viewer, dataManager, miniChat, pluginPanel, entityChat}), `window.__odVoice` (voice pipeline:
    `submitText(text)`, `getState()`, `getDetail()`, `getHistory()`, `setMode('auto'|'workflow'|'chat')`), `window.__odPlugins` (`getSelectedPluginIds()`, `refresh()`).
  - MINI CHAT ("ASK ONDEMAND", contextual per object): open with
      window.dispatchEvent(new CustomEvent('gev:ask-object',{detail:{objectType:'earthquake',objectId:'earthquakes-global',label:'Global Earthquakes',fields:{count:42}}}))
    Panel `#ondemand-mini-chat[data-open="true"]`, header buttons `#ondemand-mini-chat-expand` (INVESTIGATE), `#ondemand-mini-chat-close`, status `#ondemand-mini-chat-status`,
    key state `.od-chat__key-state` (must read "server key"), transcript `#ondemand-mini-chat-transcript`, messages `.od-chat__msg`, `.od-chat__msg--assistant[data-streaming]`,
    `.od-chat__msg--error`, sources `#ondemand-mini-chat-sources`, citations `.od-chat__cite`, activity `#ondemand-mini-chat-activity` rows `.od-chat__activity-row` (virtualised: max 6 rendered),
    Developer details = `<details id="ondemand-mini-chat-dev">` (collapsed by default; ONE `<summary>` toggle "Developer details"; body `#ondemand-mini-chat-dev-lines` holds request/metrics/frames/provenance),
    composer `#ondemand-mini-chat-input`, `#ondemand-mini-chat-send`, `#ondemand-mini-chat-stop`. Empty states render inside the transcript as `.od-empty-state[data-empty-state="no-sessions"|"no-results"|"source-unavailable"]`
    (each has a brand illustration via CSS `background-image: /assets/brand/empty-*.png`). "no-sessions" appears when a fresh object is opened (no prior history);
    "source-unavailable" appears when a turn fails with 502/503/504/network error (the existing harness provokes it by intercepting `/api/ondemand/v2/chat` with a 502);
    "no-results" appears when a turn completes with an empty answer.
    Object types supported: organization/entity, intelligenceCard, mapMarker, timelineEvent, graphNode, graphEdge, chart, tableRow, newsArticle, alert, earthquake, fire, traffic, regionalBrief, hudSummary, providerBadge, aircraft/vessel/satellite/camera.
    Each (user, workspace, object) keeps its own session; reopening the same object restores the transcript (persistence), a different object gets a different session.
  - PLUGINS panel `#ondemand-plugin-panel` (docked in the mini-chat header slot `.od-chat__plugin-slot`, visible once the mini chat is open): rows `li.od-plugin__row[data-plugin-id]`,
    checkbox `input.od-plugin__toggle` (per-turn plugin selection, persisted in localStorage `ondemand.pluginSelection`), badge `.od-plugin__state[data-state]` with text
    DISCOVERED | INSTALLING | AUTHENTICATING | READY | FAILED | INVOKING, button `button.od-plugin__verify[data-plugin-name]` (POST /api/ondemand/v2/plugins/verify → real OnDemand
    session + probe query), `.od-plugin__error`, `.od-plugin__timing`, `.od-plugin__latency`, refresh `.od-plugins__refresh-btn`, summary count `.od-plugins__summary-count`.
    Known truth: `internet_web_search` verifies READY in ~5 s; `x_mcp_connector` verifies FAILED with `inactive_on_account`. INSTALLING/AUTHENTICATING are server-side transitions inside
    one verify call (the badge is only refreshed when the response lands) — to observe them you must poll GET /api/ondemand/v2/plugins concurrently (same serverless instance not guaranteed).
    INVOKING is set while a /chat turn that names that pluginId streams; `invocations` increments afterwards. Report exactly what you observe; never claim a state you did not see.
  - VOICE controls `#od-voice-control[data-state][data-route]`: `#od-voice-button` (press to talk), `#od-voice-route` (AUTO/WORKFLOW/CHAT), `#od-voice-status` (IDLE/LISTENING/THINKING/SPEAKING/ERROR),
    `#od-voice-detail`, `#od-voice-transcript`, `#od-voice-answer`, `#od-voice-workflow`. Headless: `await window.__odVoice.submitText('What is the local time in Austin, Texas?')` drives a
    real turn through POST /api/ondemand/v2/voice/turn (SSE events: turn, transcript?, session, status*, delta*, answer, tts|tts_error, done). Audio playback fails silently headless; that is fine.
    Per-turn plugin selection for voice: the pipeline sends `pluginIds` from its `getPluginIds` dependency — check whether the ticked PLUGINS checkbox actually reaches the /voice/turn request body
    (wrap `window.fetch` before the turn and record the parsed JSON body of the /voice/turn call). Report the truth.
  - HUD `#intel-hud` with summary `#hud-summary` (text starts "Awaiting telemetry..." then a live summary from POST /api/ondemand/v2/summaries/hud) and ASK button `#hud-ask-ondemand`;
    cockpit regional brief `#cockpit-brief-ask`. Left panel stack `#left-panel-stack` (`#data-panel`, `#control-panel`), right rail `<aside id="right-context-rail">` holding
    `#global-context-panel.panel-collapsible.collapsed` with disclosure `button.panel-collapse-btn[data-collapse-target="global-context-panel"]`; title bar `#title-bar`; command dock `#command-dock`.
    There is NO "Plan/Run tab" in this codebase — the chat panel has a composer plus an INVESTIGATE button (`#ondemand-mini-chat-expand`) that switches a turn from a streamed chat
    answer to a planned multi-source investigation (POST /api/ondemand/v2/investigate returns {plan, sources, objects, synthesis}). Treat "Plan/Run switching" as: a normal RUN turn
    (SEND) and a PLAN/INVESTIGATE turn (INVESTIGATE button) on the same object, and say so explicitly in the result.
  - Expected console noise on the deployed origin: ONE `GET /api/setup/status` 404 per page load (key-setup panel probe, serverless mode). Record it, do not hide it.

BROWSER RULES (shared pod, 8 cores; be a good citizen):
  - Preferred single-page assertions: `python3 /home/appuser/.agents/skills/ui-validator/scripts/ui_validate.py --url <url> --label <name> --viewport WxH --viewport-only --allow-console-errors --wait-ms 9000 --timeout 90 --eval "<js>" ...`
    (screenshots land in the CWD's ./.ui-proof — run it from the repo root and MOVE/COPY the PNGs into your artifact dir afterwards; convert to JPEG q60 with Pillow to keep the repo small).
  - Multi-step walkthroughs: write ONE Node puppeteer script under `scripts/` (name given in your brief) modelled on `scripts/qa-chat-intelligent-ui.mjs`: same `puppeteer.launch` args
    (`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader --hide-scrollbars`), same `hardKill()` process-group kill on exit/SIGTERM/SIGINT,
    a global 15-minute cap, `protocolTimeout: 300000`, pause the Cesium render loop before each `page.screenshot` (see `captureScreenshot` in that file). Never leave Chromium running:
    after your run, `pgrep -fa chromium | grep -v grep` must show nothing you started. Never install Playwright/Puppeteer (already in node_modules). Run `node scripts/<yours>.mjs --url ... --out ...`.
  - Do not use chrome-devtools MCP tools (none is provisioned).

EVIDENCE RULES:
  - Write results to your own artifact directory under `docs/agent-execution/artifacts/verify-2026-10-21/<area>/` ONLY (desktop/ mobile/ api/ scenarios/ fixes/). Never write outside the repo
    except /tmp. Never write to docs/agent-execution/*.md top-level files (the orchestrator owns them).
  - Produce `results.json` = {"agent":N,"urlUsed":"…","startedUtc":"…","finishedUtc":"…","checks":[{"id":"1a","name":"…","result":"PASS|FAIL|PARTIAL|UNSUPPORTED","evidence":"…","screenshot":"relative/path.jpg","utc":"…"}]}
    and `RESULTS.md` (a human table with the same rows). Timestamps ISO-8601 UTC. Every FAIL/PARTIAL needs the concrete observed value.
  - NEVER fabricate a passing result, a screenshot, a plugin state, a citation or an execution id. If something cannot be exercised, mark it UNSUPPORTED/PARTIAL with the reason.
  - NEVER print, log or save secret values (ONDEMAND_API_KEY / ON_DEMAND_API_KEY, VERCEL_TOKEN, GITHUB_TOKEN, webhook basic-auth password from the workflow JSON, any `apikey` header). Redact if a response echoes one.
  - Finish with a concise summary in your final message: counts (PASS/FAIL/PARTIAL/UNSUPPORTED), the list of FAILs with the exact observed symptom and the file:line you suspect (if any), and the artifact paths.
