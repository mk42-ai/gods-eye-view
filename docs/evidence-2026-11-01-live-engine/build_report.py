"""Builds the Section 22 report (Markdown + PDF) from the evidence folder. Run from repo root."""
import json, os, sys, datetime
sys.path.insert(0, "/home/appuser/.agents/skills/pdf-report-generator/scripts")
import pdf_primitives as pp

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = "/home/appuser/work/6692b763e851d28a036ab30e/6ae56302679e6131953805be"
D = ROOT
PREVIEW = "https://ondemand-agent-im9nrttj9-schoolhack-web-team.vercel.app"
DEPLOY_ID = "dpl_7qq4spST2e1W55hPSWuwVQqXmZ3o"
PR = "https://github.com/mk42-ai/gods-eye-view/pull/4"
TODAY = "2026-11-01"

def seg(start, end):
    """Markdown lines between the heading that starts with `start` and the one starting with `end`."""
    si = next(i for i, l in enumerate(md) if l.lstrip("\n").startswith(start))
    ei = next((i for i, l in enumerate(md) if i > si and l.lstrip("\n").startswith(end)), len(md))
    return "\n".join(md[si+1:ei])

import html as _html, re as _re
def md2html(text):
    """Small, predictable converter for the report's own bullet/paragraph Markdown
    (bold, code, links) so Story never sees raw ** or backticks."""
    def inline(t):
        t = _html.escape(t, quote=False)
        t = _re.sub(r"`([^`]+)`", lambda m: "<code>" + m.group(1) + "</code>", t)
        t = _re.sub(r"\*\*(.+?)\*\*", lambda m: "<b>" + m.group(1) + "</b>", t)
        t = _re.sub(r"\*(?!\*)([^*]+?)\*(?!\*)", lambda m: "<i>" + m.group(1) + "</i>", t)
        t = _re.sub(r"(https?://[^\s<)]+)", lambda m: str(pp.link(m.group(1), m.group(1))), t)
        return t
    out, items = [], []
    def flush():
        nonlocal items
        if items:
            out.append("<ul>" + "".join("<li>" + i + "</li>" for i in items) + "</ul>")
            items = []
    for line in text.split("\n"):
        l = line.strip()
        if not l:
            flush(); continue
        if l.startswith("* ") or l.startswith("- "):
            items.append(inline(l[2:]))
        else:
            flush(); out.append("<p>" + inline(l) + "</p>")
    flush()
    return "\n".join(out)

def J(p):
    return json.load(open(os.path.join(D, p)))

final = J("qa-live-final/qa-cinematic.json")
d4 = J("qa-live-final-deploy4/qa-cinematic.json")
d2 = J("qa-live-deploy2/qa-cinematic.json")
fF = J("qa-live-final-F/qa-cinematic.json")
trace = J("qa-live-final/demo-A-1440x900-sse-trace.json")
trace = trace if isinstance(trace, list) else trace["events"]

def demo(rep, i, vp="1440x900"):
    for d in rep["demos"]:
        if d["id"] == i and d["viewport"] == vp:
            return d
    return None

# ---------- metrics ----------
A3 = demo(final, "A"); A4 = demo(d4, "A"); A4m = demo(d4, "A", "390x844")
mA3 = A3["metrics"]["metrics"]; mA4 = A4["metrics"]["metrics"]; mA4m = A4m["metrics"]["metrics"]
Dd = demo(final, "D")["liveWeather"]; Dd2 = demo(d2, "D")["liveWeather"]
E4 = demo(d4, "E")["metrics"]; E4m = demo(d4, "E", "390x844")["metrics"]
F = fF["demos"][0]; Fm = F["modelProof"]["stateModel"]
G = demo(final, "G"); Gm = G["metrics"]
B = demo(final, "B"); Bm = B["metrics"]
acc = demo(final, "acceptance")
H = demo(final, "H")
I = demo(final, "I")
C = demo(final, "C")

def model_of(d):
    return ((d.get("runStateDetail") or {}).get("model") or {})

# ---------- Markdown ----------
md = []
w = md.append
w(f"# Gods Eye View — Live Cinematic Intelligence Engine: Section 22 Evidence Report")
w(f"\n**Date:** {TODAY} (UTC) · **Repository:** `mk42-ai/gods-eye-view` · **Branch:** `feat/scene-video-evidence` · **Commits this turn:** `5ee34c8` (recovered pre-existing work, byte-identical) → `3b71175` (this turn) · **Final preview:** {PREVIEW} (`{DEPLOY_ID}`) · **PR:** {PR} (existing; create returned GitHub 422 \"already exists\")\n")
w("> Every PASS below is backed by a file in `docs/evidence-2026-11-01-live-engine/` (committed) or `.ui-proof/` (attached). Nothing is marked PASS without execution evidence; blocked items say exactly what blocked them.\n")

w("## 1. Phase timestamps (ISO-8601, UTC)\n")
phases = [
 ("P1 forensics + baseline verification", "2026-11-01T14:46Z–14:52Z"),
 ("P2 OnDemand live docs / registry / stream probe", "15:09Z–15:21Z (registry 98/29/1 Cerebras; probe `ondemand-runtime-live.txt`)"),
 ("P4 asset registry (batch B keyed, manifest v4)", "14:55Z–15:00Z"),
 ("P3/P5/P6/P7/P8 engine defects reproduced + fixed", "15:12Z–15:47Z (local Demo A `partially_completed` → fixed; camera interrupt fix)"),
 ("P9 Snapchat / batch re-probe", "15:11Z (POST /chat/v1/batches → 405); live Demo E 16:33Z & 17:12Z"),
 ("P10 Open-Meteo live-intelligence source", "15:05Z–15:09Z (route + tests + local probe 148 ms)"),
 ("P11/P12 Q&A + playback verified live", "16:08Z–16:22Z (acceptance 10/10 confirmed commands)"),
 ("Tests / gates / build (first + re-run)", "15:21Z–15:27Z and 16:50Z–16:54Z"),
 ("Deploys #1–#4", "15:27Z, 15:47Z, 16:07Z, 16:55Z (final)"),
 ("P13 live QA (A–I + acceptance)", "15:29Z–16:22Z (deploy #2: 9/10 → deploy #3: 10/10), 17:06Z–17:33Z (deploy #4: A/E/I both viewports + F)"),
 ("27-key hash reload check", "16:37Z–16:44Z (27/27 on 1440×900 and 390×844)"),
 ("Commit + push", "17:27Z–17:34Z (5ee34c8, 3b71175 pushed)"),
 ("Report", "17:40Z"),
]
w("| Phase | When |\n|---|---|")
for a, b in phases: w(f"| {a} | {b} |")

w("\n## 2. Build-to-source verification\n")
w("* Workspace repo `gods-eye-view/` on `feat/scene-video-evidence`, HEAD `faa88cf` = `origin/feat/scene-video-evidence` (`git ls-remote` 14:46Z). `f20fab6` (baseline/approved-k8v6snzk7 = `b698032` + cycle-9) and `b698032` are ancestors of HEAD — verified with `git merge-base --is-ancestor` before and after the push; the baseline was never reset, rewritten or force-pushed (the branch `baseline/approved-k8v6snzk7` does not exist on origin; the checkpoint commit is preserved in history).")
w("* The latest supplied archive `code-files-20261101-112705_v1.zip` (3,200 files, no `.git`) was diffed against `faa88cf`: **683/683 `src/**/*.js` files byte-identical**, 0 different — the archive IS commit `faa88cf`; it does not contain `src/cinematic/` (the parallel-agent phase was uncommitted in the workspace only).")
w("* Working tree at start: 53 modified + 147 untracked files (the earlier agent phase; `docs/evidence-2026-11-01-cinematic/baseline-git.txt` says it started from a clean tree). Preserved as `pre-existing-uncommitted-work.patch` and committed byte-identical as `5ee34c8` (verified: `git diff-tree` against a snapshot commit of the original tree is empty). Twelve of those untracked files were also edited this turn and therefore appear only in `3b71175`; the per-file deltas are listed in §4.")

w("\n## 3. Root causes (traced this turn, with file:line)\n")
rc = [
 ("RC9 — every live build ended `partially_completed`", "`server/scene-plans/director.js:86-88` taught the model only the v3 asset ids, yet the model emitted the newly supplied ids (e.g. `sprite.vehicle.police_motorcycle`), which `src/cinematic/sceneSchema.js` (`z.enum(ASSET_IDS)`) rejected → `state.invalid` non-empty → `runtimeReducer.js:556`. Fixed by registering the 10 batch-B ids in `assetIds.js` + manifest v4 and teaching them to the director. Evidence: `/tmp` local run 15:14Z (`invalid[0].data.assetId = sprite.vehicle.police_motorcycle`) → Demo A `succeeded` on deploy #3."),
 ("RC10 — Q&A camera commands never confirmed on the live preview", "`src/cinematic/cameraDirector.js:372-380` compared the request against `currentShot(0)` (the FIRST scheduled shot, priority 100) instead of the shot on screen, and never yielded when playback was paused/finished → `wide_aerial`, `camera_above_entity`, `replay_section` all `Camera interrupt not accepted` (deploy #1 Demo H/acceptance). Fixed: compare against the current shot at the playback position, yield when paused/finished, keep an active interrupt protected, explain refusals, `requestRender` when paused; Q&A commands use `QA_CAMERA_PRIORITY = 100`. Regression test `cameraDirector.test.mjs` ('paused or finished timeline yields…')."),
 ("RC11 — Demo B `ZodError` on the live preview", "`src/cinematic/debugApi.js:95-106` put the test road-closure sign at the centroid of `routes[0]` — Sheikh Zayed Road's researched route (~55 km) has a centroid far outside the 5 km `LocalPositionSchema` bound. Fixed: nearest vertex to the origin + clamp; regression test in `debugApi.test.mjs`."),
 ("RC12 — glyph gate / package boundaries", "`src/iconGlyphBoundary.test.mjs` failed on `►/✓/✗` in `src/cinematic/index.js:7-12` and `cinematicPanel.js:422-432`; `check-package-boundaries` rejected `src/cinematic/*` as unowned. Both fixed (ASCII, ownership entries)."),
 ("RC1–RC8 (previous phase)", "Documented in `docs/evidence-2026-11-01-cinematic/root-causes.md` (sync polling with synthetic tokens, 300 s serial Perplexity chain, hard geocoder gate, Snapchat strict filter, detached labels, no model registry, non-deterministic playback, no evidence→scene link). All eight are addressed by the recovered `src/cinematic/*` + `server/ondemand/runtime/*` code that this turn integrated, tested and verified live."),
]
for a, b in rc: w(f"**{a}** — {b}\n")

w("## 4. Files changed\n")
w("**Commit `5ee34c8` (pre-existing, recovered as-is, 188 files):** `src/cinematic/*` (14 modules + tests + CONTRACT.md), `server/ondemand/runtime/{model-registry,sessions,stream-adapter}.js`, `server/scene-plans/{qa,legacy-plan}.js`, `server/scene-footage/{metrics,evidence-pipeline}.js`, modified `server/scene-plans/index.js`, `src/incidents/ui/index.js`, Snapchat fan-out/metrics changes, 14 keyed sprites (manifest v3), `public/models/cinematic/*.glb`, `scripts/qa-cinematic*.mjs`, `src/sharelink.hashKeys.test.mjs`, `docs/evidence-2026-11-01-cinematic/`.\n")
w("**Commit `3b71175` (this turn):**\n")
mine = [
 ("tools/scene-icons/sources/*.png (10 new), tools/scene-icons/build-icons.mjs", "batch-B sources + KEY_DEFINITIONS; manifest version 4"),
 ("public/scene-icons/{png,svg}/* (10 keys × 3 sizes + SVG), sprite*.png/json, manifest.json", "keyed sprites, rebuilt atlases, 40-key manifest with sha256"),
 ("src/cinematic/assetIds.js", "+10 asset ids (49 total), category defaults/fallbacks"),
 ("server/scene-plans/director.js", "scenario rules teach the new ids; evidence-entity rule"),
 ("server/scene-plans/weather-intel.js (+test)", "NEW Open-Meteo ingestion → normalisation → validated ScenePatch"),
 ("server/scene-plans/cinematic-routes.js, server/scene-plans/index.js", "NEW `POST /intel/weather` route, mounted"),
 ("src/cinematic/index.js", "`pullLiveWeather()` → Live Intelligence Director, intelligence.received/validated + evidence-to-visual metric; ASCII diagram"),
 ("src/cinematic/debugApi.js (+test)", "`pullLiveWeather` on `window.__gevCinematic`; road-closure sign nearest-vertex + clamp"),
 ("src/cinematic/ui/cinematicPanel.js (+test)", "'Pull live weather (Open-Meteo)' button, failures to feed; ASCII status words"),
 ("src/cinematic/cameraDirector.js (+test)", "interrupt scoring vs current shot; paused/finished timeline yields; explained refusals"),
 ("src/cinematic/qaExecutor.js", "`QA_CAMERA_PRIORITY = 100`"),
 ("src/sceneFootage/index.js", "`getState().metrics` exposes server execution metrics"),
 ("src/scenes/iconManifest.test.mjs, scripts/package-boundaries.json", "manifest v4 / 40 keys; cinematic modules owned"),
 ("scripts/qa-cinematic.mjs", "truthful run-state detail, build gating, real Open-Meteo update in Demo D, Snapchat gated on a built scene, Demo F active-endpoint proof, model reset between demos"),
 ("docs/evidence-2026-11-01-live-engine/", "all evidence listed in its README.md"),
]
w("| Path | Change |\n|---|---|")
for a, b in mine: w(f"| `{a}` | {b} |")

w("\n## 5. On-Demand integration proof\n")
w("* **Docs read live:** `GET /config/v1/public/docs/categories` (15:21Z) lists Chat API slugs `createchatsession, getchatsessions, getchatsession, getchatmessages, getchatmessage, submitquery, updatelivesessionsettings` — no batch slug. `submitquery` OpenAPI (cached copy `docs/evidence-2026-11-01-cinematic/ondemand-docs-chat-openapi.json`): body `{query, endpointId, responseMode: sync|stream|webhook, pluginIds?, …}` on `POST /chat/v1/sessions/{sessionId}/query`; session id ≠ model id is enforced by `server/ondemand/runtime/sessions.js`.")
w("* **Model registry (live, 15:21Z):** `GET /config/v1/public/endpoints` → 98 endpoints, 29 active, exactly one Cerebras-backed: `predefined-cerebras-qwen-3.8-27b` (streaming, ctx 128k). `GET /api/ondemand/v2/scene-plans/models` on the final preview returns `source: live`, 98 models, `cerebrasAvailable: true`, `scene_direction → predefined-cerebras-qwen-3.8-27b`. No direct Cerebras bypass (`CEREBRAS_API_KEY` is not configured anywhere).")
w(f"* **Streaming trace (live probe 15:09Z):** Cerebras TTFT 2,182 ms / 22.6 tok/s on a short query; director build 11.6 s (TTFT 8.6 s, 13,643 output tokens); GPT-6.1-sol director 29.0 s (TTFT 6.0 s); Q&A 4.8 s.")
w(f"* **Model switching (Demo F, deploy #4):** picker set `scene_direction` to `predefined-gpt-6.1-sol` → run completed with `state.model.endpointId = predefined-gpt-6.1-sol` (TTFT {Fm['ttftMs']} ms, {Fm['tokensPerSec']} tok/s, {Fm['outputTokens']} tokens, 11 entities); default runs carry `predefined-cerebras-qwen-3.8-27b` (`model.selected` seq 2, reason `task_default`). Switching to the BYOI `gemma4-e2b` endpoint (deploy #2/#3 run) produced `run.failed: Stream completed with 0 deltas and no [DONE]` — reported truthfully, not hidden.")
w("* **Chat batches:** `POST /chat/v1/batches` → HTTP 405 `Chat batch creation is currently unavailable` (15:11Z, `chat-batch-probe.txt`); the UI shows `batch: unavailable (405)`.")

w("\n## 6. Real SSE event trace (Demo A, deploy #3, 1440×900)\n")
counts = {}
for e in trace: counts[e["event"]] = counts.get(e["event"], 0) + 1
w("Event counts: " + ", ".join(f"`{k}`×{v}" for k, v in sorted(counts.items(), key=lambda x: -x[1])) + ". Sequence numbers monotonic 1…140 (verified).\n")
w("| elapsed ms | event | detail |\n|---|---|---|")
seen = set()
for e in trace:
    ev = e["event"]; d = e.get("data") or {}
    if ev in ("run.started","model.selected","scene.planning","cinematic.started","answer.completed","scene.ready","run.completed") and ev not in seen:
        seen.add(ev)
        det = d.get("endpointId") or (f"entities {d.get('entities')} shots {d.get('shots')} beats {d.get('beats')}" if ev=="scene.ready" else "") or (json.dumps(d.get("metrics")) if ev=="run.completed" else "")
        w(f"| {d.get('elapsedMs','')} | `{ev}` | {det} |")
    elif ev == "scene.object.created" and d.get("entity"):
        w(f"| {d.get('elapsedMs','')} | `scene.object.created` | `{d['entity'].get('id')}` → {d['entity'].get('assetId')} |")
w("\nStage A (anchor + geometry) 60 ms → Stage B (planning) 62 ms → first `scene.object.created` 7,549 ms → `cinematic.started` → Stage E staging/finalising 82–84 s (Overpass/OSRM enrichment after the playable scene; the browser was already playing). Resulting scene change: 11 entities created, 3 shots, 3 beats, `scene.ready` at 10.1 s.")

w("\n## 7. Metrics table (live preview)\n")
w("| Metric | Value | Source |\n|---|---|---|")
rows = [
 ("TTFT (director first delta)", f"{mA3['ttftMs']} ms (deploy #3) · {mA4['ttftMs']} ms / {mA4m['ttftMs']} ms (deploy #4 desktop/mobile) · Demo G computed {Gm['computedTtftMs']} vs reported {Gm['reportedMetrics']['ttftMs']} ms", "Demo A/G traces"),
 ("First scene instruction", f"{mA3['firstSceneInstructionMs']} / {mA4['firstSceneInstructionMs']} / {mA4m['firstSceneInstructionMs']} ms", "reducer metrics"),
 ("First rendered object", f"{mA3['firstRenderedObjectMs']} / {mA4['firstRenderedObjectMs']} / {mA4m['firstRenderedObjectMs']} ms", "reducer.markRendered"),
 ("First playable shot", f"{mA3['firstPlayableShotMs']} / {mA4['firstPlayableShotMs']} / {mA4m['firstPlayableShotMs']} ms", "cinematic.started"),
 ("Director run.completed", f"{mA3['totalMs']} / {mA4['totalMs']} / {mA4m['totalMs']} ms (legacy `done` with staging enrichment 84 s)", "run.completed.metrics"),
 ("Evidence-to-visual (Open-Meteo → patch applied)", f"{Dd['evidenceToVisualMs']} ms (deploy #3) · {Dd2['evidenceToVisualMs']} ms (deploy #2); provider fetch {Dd['latencyMs']} / {Dd2['latencyMs']} ms", "Demo D liveWeather"),
 ("Heap (JS, MB)", f"{A3['metrics']['heap']} / {A4['metrics']['heap']} / {A4m['metrics']['heap']}", "performance.memory"),
 ("FPS", "NOT MEASURED — the harness's `fps()` sampler returns null in headless SwiftShader; no number is claimed", "—"),
 ("Director throughput", f"Cerebras {model_of(A3).get('tokensPerSec')} tok/s ({model_of(A3).get('outputTokens')} tokens, reasoning included) · GPT-6.1-sol {Fm['tokensPerSec']} tok/s", "run.completed.model"),
 ("Snapchat (Dubai Marina, balanced, deploy #4)", E4["snapchatMetrics"], "#scene-snapchat-metrics"),
 ("Snapchat status", E4["status"] + " · " + E4["matchedPlace"], "#scene-footage-status"),
 ("27 URL-hash keys after reload", "27/27 on 1440×900 and 27/27 on 390×844 (deploy #3, 16:37Z–16:44Z)", "qa-scene-videos.log"),
]
for a, b, c in rows: w(f"| {a} | {b} | {c} |")

w("\n## 8. Cinematic engine stats (live)\n")
stats = []
for rep, lbl in ((final, "deploy #3"), (d4, "deploy #4")):
    for d in rep["demos"]:
        rd = d.get("runStateDetail") or {}
        if rd.get("runState") == "succeeded":
            m = rd.get("model") or {}
            stats.append((lbl, d["id"], d["viewport"], rd.get("entities") if rd.get("entities") is not None else "—", rd.get("sceneVersion"), m.get("endpointId"), m.get("ttftMs"), m.get("latencyMs")))
w("| Deploy | Demo | Viewport | Entities | Scene version | Endpoint | TTFT ms | Director ms |\n|---|---|---|---|---|---|---|---|")
for s in stats: w("| " + " | ".join(str(x) for x in s) + " |")
w(f"\nDemo B injection: routes {Bm['routesBefore']}→{Bm['routesAfter']}, closed `{Bm['closedRouteIds']}`, entities {Bm['entitiesBefore']}→{Bm['entitiesAfter']}, road-closed sign {Bm['roadClosedSign']}, scene version {Bm['sceneVersionBefore']}→{Bm['sceneVersionAfter']} (3 ops applied, 0 rejected). Demo D: three updates (1 real Open-Meteo + 2 labelled test injections), playback position never rewound, scene version strictly increased. Demo C: 7 entities, all `hypothetical: true` with HYPOTHETICAL labels. Asset registry: 49 ids (39 sprites + 10 models), 40 manifest keys, 4 Cesium sample GLBs + 9 pre-existing CC-BY aircraft/ship models (licences in `public/models/README.md`).")

w("\n## 9. Geographic correctness\n")
w("* Burj Khalifa anchor resolved live to `25.1970336, 55.2741329` (`https://www.openstreetmap.org/way/446646206`, precision exact, confidence 0.95). Wikipedia's infobox gives 25°11′50″N 55°16′27″E = 25.1972, 55.2742 — 32 m apart, well inside the building footprint. Dubai Marina anchor `25.0786415, 55.1352524`.")
w("* Entities are placed in a local ENU frame from `Cesium.Transforms.eastNorthUpToFixedFrame` (`src/cinematic/geoSceneContext.js`, round-trip tests < 1e-6 m), the 5 km placement bound is enforced by zod, terrain sampling flags `terrainSampled:false` when unavailable (origin above shows it honestly).")

w("\n## 10. Executed Q&A commands (grounded, live, deploy #3)\n")
w("| Demo | Question | Commands → runtime confirmation |\n|---|---|---|")
for lbl, d, keys in (("H", H, ("qaAerial","qaAdd")), ("acceptance", acc, ("q1","q2","q3"))):
    for k in keys:
        q = d["metrics"][k]
        qtxt = {"qaAerial":"Show a wide aerial view","qaAdd":"Add another simulated emergency vehicle","q1":"Show me the intersection that changed","q2":"Why did that road close?","q3":"Replay the last section from a helicopter perspective"}[k]
        cmds = "; ".join(f"`{r['command']}` {'✔ confirmed' if r.get('confirmed') else '✘ ' + str(r.get('reason'))}" for r in q["results"])
        w(f"| {lbl} | {qtxt} | {cmds} |")
w(f"\nAcceptance Q2 answer (excerpt): *{acc['metrics']['q2']['answer'][:220]}…* — the model attributes the closure to the labelled test injection, not to a real event.")

w("\n## 11. Snapchat\n")
w(f"* Provider: OnDemand plugin `plugin-1792945050` (Spotlight by place). Schema has no cursor/offset/time filter (`docs/evidence-2026-11-01-cinematic/snapchat-batching.md`); fan-out across place-name variants with bounded concurrency, storyId dedupe, retry/backoff.")
w(f"* Live (deploy #4, Dubai Marina, balanced): {E4['snapchatMetrics']}. Mobile run identical. Verified tier is 0 because the provider supplies no capture time or coordinates — the UI says so (`unverified: no capture time / coordinates`) and never upgrades a clip.")
w("* Batch: `POST /chat/v1/batches` → 405; no official public-content API exists (Marketing API / Snap Kit are OAuth/partner gated) — nothing was assumed authorised.")

w("\n## 12. Testing\n")
w("| Suite / gate | Result | File |\n|---|---|---|")
w("| Frontend unit (`npm test`, Node 22) | 4,887 pass / 0 fail / 1 pre-existing skip (15:22Z); re-run 4,889 pass (16:52Z) | `frontend-tests.txt` |")
w("| Backend (`node --test server api`) | 699 pass / 0 fail (15:24Z, 16:53Z) — run with the live key unset, as the suite expects | `backend-tests.txt` |")
w("| boundaries / secrets / format | all exit 0 after fixes (15:26Z, 16:53Z) | `checks.txt` |")
w("| Production build (`vite build`) | exit 0, 8.2 s / 23.4 s; `check:secrets:dist` clean | `build.txt` |")
w("| Live QA A–I + acceptance (deploy #3) | **10/10 passed** | `qa-live-final/` |")
w("| Live QA A/E/I ×2 viewports + F (deploy #4) | 6/6 + F passed | `qa-live-final-deploy4/`, `qa-live-final-F/` |")
w("| 27 hash keys + reload | 27/27 both viewports | `qa-scene-videos.log` |")
w("| ui-validator smoke | 9/9 assertions at 1024×640 and 800×600 (composer, Build scene, `__gevCinematic`, balanced scope, manifest v4); at 1440×900/390×844 all assertions passed but the validator's screenshot step timed out under pod load (load avg 13–19) — no screenshot for those two sizes | `.ui-proof/after-smoke-*.png` |")
w("| ElevenLabs narration (live) | **BLOCKED** — 503 `narration_provider_payment_required` in 14.05 s; no audio, no sample | `elevenlabs-retest.txt` |")
w("\nGenuine live-provider tests: everything under `qa-live-*`, the OnDemand/Open-Meteo/ElevenLabs/batch probes. Mocked: every `*.test.mjs` (fetch mocked, no network).")

w("\n## 13. Status matrix\n")
matrix = [
 ("P1 repository forensics / baseline preserved", "PASS", "§2; f20fab6 & b698032 ancestors verified after push"),
 ("P2 OnDemand session/model/stream integration", "PASS", "registry live, stream adapter, Demo F/G/I live"),
 ("P3 Cesium pipeline at displayed WGS84 location", "PASS", "GeoSceneContext round-trip tests; live scenes at Burj Khalifa/Marina"),
 ("P3 geocoder gate (attributed candidate, no hard fail)", "PASS", "live origins carry OSM sourceUrl; forbid-text assertion passes"),
 ("P4 asset registry (19 icons + models)", "PASS", "40 keys / 49 ids; all 19 supplied icons located (x6ysUfJoEe = alert sheet, 9 named = pre-existing sources, 10 URLs downloaded)"),
 ("P5 Cinematic Director schema-validated spec", "PASS", "0 invalid lines on every live succeeded run"),
 ("P6 Camera director (shots, interrupts, priority)", "PASS", "fixed this turn; Q&A/replay confirmed live"),
 ("P7 persistent stateful runtime + validated patches", "PASS", "scene versions 17→18 on patch, stale-seq drops, Demo D"),
 ("P8 typed SSE pipeline + metrics", "PASS", "21 typed events, monotonic seq, TTFT/first-shot measured"),
 ("P9 Snapchat plugin repair / real metrics", "PARTIAL", "real counts shown; verified tier 0 by provider; batch 405"),
 ("P10 Live Intelligence Director (real source)", "PASS", "Open-Meteo observation → patch live, 5–12 ms to visual; injected closures"),
 ("P11 grounded Q&A + state machine", "PASS", "10/10 confirmed commands in acceptance; `failed` surfaced in Demo I"),
 ("P12 playback controller / modes", "PASS", "deterministic clock, never rewinds (Demo D), three labelled modes"),
 ("P12 cinematic quality 60 FPS", "PARTIAL", "FPS not measured in headless SwiftShader; adaptive quality not claimed"),
 ("P13 Demo A police response", "PASS", "deploy #3 + #4 both viewports"),
 ("P13 Demo B marathon + injected closure", "PASS", "deploy #3 (fixed from deploy #2 fail)"),
 ("P13 Demo C hypothetical air raid", "PASS", "7 entities, all HYPOTHETICAL"),
 ("P13 Demo D multi-update live intelligence", "PASS", "1 real + 2 injected updates"),
 ("P13 Demo E Snapchat retrieval", "PASS (measured)", "3/3 requests, 1 unique, 0 verified"),
 ("P13 Demo F model switching (request-level)", "PASS", "gpt-6.1-sol vs cerebras in run.completed.model"),
 ("P13 Demo G Cerebras streaming latency", "PASS", "TTFT 5.7 s director / 2.2 s short query"),
 ("P13 Demo H Q&A camera + object", "PASS", "wide_aerial + add_entity confirmed"),
 ("P13 Demo I controlled failure", "PASS", "model_unavailable → `failed`, never `succeeded`"),
 ("P13 Section 23 acceptance workflow", "PASS", "Burj Khalifa marathon → closure → 3 questions, 10/10 confirmed"),
 ("27 URL-hash keys + reload", "PASS", "27/27 × 2 viewports"),
 ("Scene chat panel / scene saving", "PASS", "scene chat (Q&A panel) exercised live; saving verified last turn, unchanged code paths, regression suite green — not re-driven in a browser this turn"),
 ("ElevenLabs narration", "BLOCKED", "provider billing (payment_required)"),
 ("PR", "PARTIAL", "pushed; PR #4 exists (422 on create), description not updated via API"),
 ("Deployment", "PASS", f"{PREVIEW}"),
]
w("| Component | Status | Evidence |\n|---|---|---|")
for a, b, c in matrix: w(f"| {a} | **{b}** | {c} |")

w("\n## 14. Remaining blockers\n")
w("**Application defects:** FPS/adaptive-quality instrumentation unmeasured in headless; legacy `/scene/videos` rail is no longer auto-started (by design since b6bbfb2) so `qa-scene-videos` checks 2–4 fail; the final `done` frame waits for Overpass/OSRM staging (84 s) after the scene is already playable.")
w("**Missing API permissions / credentials:** ElevenLabs billing (payment_required); `CEREBRAS_API_KEY` not configured (OnDemand Cerebras endpoint used instead — no bypass); PR description update needs a token with PR write scope (create returned 422 only).")
w("**Unsupported third-party capabilities:** Snapchat provides no capture time/coordinates/cursor; OnDemand chat batches 405; `predefined-gpt-6.1-sol-ultra-fast` does not exist; BYOI gemma endpoint streams 0 deltas.")
w("**Missing assets:** none — all 19 icons located. Kenney CC0 car kit unreachable (HTTP 403 earlier), so vehicles stay sprites + Cesium Milk Truck.")
w("**Performance limitations:** director TTFT 4–8 s is model-bound; staging enrichment 70–80 s is Overpass-bound; storage is browser-local only.")

md_text = "\n".join(md) + "\n"
os.makedirs(OUT_DIR, exist_ok=True)
md_path = os.path.join(OUT_DIR, "gods-eye-view-live-cinematic-engine-report.md")
open(md_path, "w").write(md_text)
print("md", md_path, len(md_text))

# ---------- PDF ----------
style = pp.theme("slate", brand="#0f766e", accent="#0f766e", brand_2="#134e4a",
                 chart_palette=["#0f766e", "#f59e0b", "#1d4ed8", "#9f1239"])
doc = pp.Doc(style=style)
doc.cover(title="Gods Eye View — Live Cinematic Intelligence Engine",
          subtitle="Section 22 evidence report · feat/scene-video-evidence · commits 5ee34c8 → 3b71175",
          author="OnDemand autonomous engineering run", date=TODAY)

s = doc.section("Executive summary")
s.p(f"The EXISTING Gods Eye View Cesium application (repo <b>mk42-ai/gods-eye-view</b>, branch <b>feat/scene-video-evidence</b>) was inspected, repaired, redeployed four times and verified against the LIVE preview with a headless-Chromium harness. The final deployment is {pp.link(PREVIEW, PREVIEW)} ({DEPLOY_ID}). Live demos A–I plus the Section 23 acceptance workflow pass 10/10 on deploy #3 and the re-run subset passes on deploy #4; all 27 camera URL-hash keys survive reload on both viewports; the Snapchat panel shows real execution metrics; a real external intelligence source (Open-Meteo) now drives validated scene patches. ElevenLabs narration remains <b>BLOCKED</b> by provider billing and is reported as such — no audio was faked.")
s.html('<div class="callout">Honesty rule applied throughout: every PASS cites an execution artefact; FPS is reported as NOT MEASURED; Demo F with a BYOI endpoint that streamed nothing is recorded as a failed run; the ui-validator screenshot timeout at 1440×900/390×844 is disclosed.</div>')
s.table([[a, b] for a, b in phases], header=["Phase", "UTC timestamps"])

s = doc.section("Build-to-source verification and baseline")
s.html(md2html(seg("## 2. Build-to-source verification", "## 3. Root causes (traced this turn, with file:line)")))

s = doc.section("Root causes")
for a, b in rc:
    s.h3(a); s.p(b)

s = doc.section("Files changed")
s.p("Commit 5ee34c8 preserves the pre-existing uncommitted work byte-for-byte (188 files). Commit 3b71175 contains only this turn's changes:")
s.table([[a, b] for a, b in mine], header=["Path", "Change"])

s = doc.section("On-Demand integration proof")
s.html(md2html(seg("## 5. On-Demand integration proof", "## 6. Real SSE event trace (Demo A, deploy #3, 1440×900)")))
s.chart(kind="bar", title="Director model TTFT per live demo (ms)", xlabel="Demo", ylabel="ms",
        data={"x": ["A", "B", "C", "D", "G", "H", "acceptance", "F gpt-6.1-sol"],
              "y": [model_of(A3).get("ttftMs"), model_of(B).get("ttftMs"), model_of(C).get("ttftMs"), model_of(demo(final,"D")).get("ttftMs"), model_of(G).get("ttftMs"), model_of(H).get("ttftMs"), model_of(acc).get("ttftMs"), Fm["ttftMs"]]},
        filename="ttft_per_demo.png")

s = doc.section("Real SSE event trace and resulting scene changes")
trows = []
seen = set()
for e in trace:
    ev = e["event"]; d = e.get("data") or {}
    if ev in ("run.started","model.selected","scene.planning","cinematic.started","answer.completed","scene.ready","run.completed") and ev not in seen:
        seen.add(ev)
        det = d.get("endpointId") or (f"entities {d.get('entities')} shots {d.get('shots')} beats {d.get('beats')}" if ev=="scene.ready" else "") or (json.dumps(d.get("metrics")) if ev=="run.completed" else "")
        trows.append([d.get("elapsedMs",""), ev, det])
    elif ev == "scene.object.created" and d.get("entity"):
        trows.append([d.get("elapsedMs",""), "scene.object.created", f"{d['entity'].get('id')} → {d['entity'].get('assetId')}"])
s.p("Event counts: " + ", ".join(f"{k}×{v}" for k, v in sorted(counts.items(), key=lambda x: -x[1])) + ". Sequence numbers monotonic 1…140.")
s.table(trows, header=["elapsed ms", "event", "detail"])
s.chart(kind="bar", title="Demo A milestone latency (ms after run.started)", xlabel="Milestone", ylabel="ms",
        data={"x": ["TTFT", "First scene instruction", "First rendered object", "First playable shot", "run.completed"],
              "series": {"deploy #3 1440×900": [mA3["ttftMs"], mA3["firstSceneInstructionMs"], mA3["firstRenderedObjectMs"], mA3["firstPlayableShotMs"], mA3["totalMs"]],
                         "deploy #4 1440×900": [mA4["ttftMs"], mA4["firstSceneInstructionMs"], mA4["firstRenderedObjectMs"], mA4["firstPlayableShotMs"], mA4["totalMs"]],
                         "deploy #4 390×844": [mA4m["ttftMs"], mA4m["firstSceneInstructionMs"], mA4m["firstRenderedObjectMs"], mA4m["firstPlayableShotMs"], mA4m["totalMs"]]}},
        filename="milestones.png")

s = doc.section("Metrics table")
s.table([[a, b, c] for a, b, c in rows], header=["Metric", "Value", "Source"])
s.chart(kind="bar", title="Open-Meteo live intelligence: provider fetch vs evidence-to-visual (ms)", xlabel="Run", ylabel="ms",
        data={"x": ["local 15:08Z", "Demo D deploy #2", "Demo D deploy #3"],
              "series": {"provider fetch": [148, Dd2["latencyMs"], Dd["latencyMs"]], "evidence→visual": [12, Dd2["evidenceToVisualMs"], Dd["evidenceToVisualMs"]]}},
        filename="open_meteo.png")

s = doc.section("Cinematic engine stats, geography, Q&A")
s.table([list(x) for x in stats], header=["Deploy", "Demo", "Viewport", "Entities", "Scene v", "Endpoint", "TTFT ms", "Director ms"])
s.html(md2html(seg("## 9. Geographic correctness", "## 10. Executed Q&A commands (grounded, live, deploy #3)")))
qrows = []
for lbl, d, keys in (("H", H, ("qaAerial","qaAdd")), ("acceptance", acc, ("q1","q2","q3"))):
    for k in keys:
        q = d["metrics"][k]
        qtxt = {"qaAerial":"Show a wide aerial view","qaAdd":"Add another simulated emergency vehicle","q1":"Show me the intersection that changed","q2":"Why did that road close?","q3":"Replay the last section from a helicopter perspective"}[k]
        qrows.append([lbl, qtxt, pp.raw("<br/>".join(f"{r['command']} — {'confirmed' if r.get('confirmed') else 'NOT confirmed: ' + str(r.get('reason'))}" for r in q["results"]))])
s.table(qrows, header=["Demo", "Question", "Commands → runtime confirmation"])

s = doc.section("Snapchat")
s.html(md2html(seg("## 11. Snapchat", "## 12. Testing")))
s.chart(kind="bar", title="Snapchat discovery — real execution metrics (Dubai Marina, balanced, deploy #4)", xlabel="Metric", ylabel="count",
        data={"x": ["attempted", "succeeded", "failed", "results", "unique", "duplicates", "relevant", "verified"], "y": [3, 3, 0, 2, 1, 1, 1, 0]}, filename="snapchat.png")

s = doc.section("Testing, screenshots and recordings")
test_rows = [
 ["Frontend unit (npm test, Node 22)", "4,887 pass / 0 fail / 1 pre-existing skip (15:22Z); re-run 4,889 pass (16:52Z)", "frontend-tests.txt"],
 ["Backend (node --test server api)", "699 pass / 0 fail (15:24Z, 16:53Z) — run with the live key unset, as the suite expects", "backend-tests.txt"],
 ["boundaries / secrets / format", "all exit 0 after fixes (15:26Z, 16:53Z)", "checks.txt"],
 ["Production build (vite build)", "exit 0, 8.2 s / 23.4 s; check:secrets:dist clean", "build.txt"],
 ["Live QA A–I + acceptance (deploy #3)", "10/10 passed", "qa-live-final/"],
 ["Live QA A/E/I ×2 viewports + F (deploy #4)", "6/6 + F passed", "qa-live-final-deploy4/, qa-live-final-F/"],
 ["27 hash keys + reload", "27/27 both viewports", "qa-scene-videos.log"],
 ["ui-validator smoke", "9/9 assertions at 1024×640 and 800×600; at 1440×900/390×844 all assertions passed but the validator's screenshot step timed out under pod load (load avg 13–19) — no screenshot for those two sizes", ".ui-proof/after-smoke-*.png"],
 ["ElevenLabs narration (live)", "BLOCKED — 503 narration_provider_payment_required in 14.05 s; no audio, no sample", "elevenlabs-retest.txt"],
]
s.table(test_rows, header=["Suite / gate", "Result", "Evidence file"])
s.p("Genuine live-provider tests: everything under qa-live-*, the OnDemand/Open-Meteo/ElevenLabs/batch probes. Mocked: every *.test.mjs (fetch mocked, no network).")
shots = [
 ("after-demo-A-police-burj-khalifa-1440x900.png", "Demo A — illustrative police response at Burj Khalifa, final state (deploy #3)"),
 ("after-demo-B-marathon-road-closure-1440x900.png", "Demo B — marathon on Sheikh Zayed Road after the labelled test road-closure injection"),
 ("after-demo-H-qa-wide-aerial-1440x900.png", "Demo H — Q&A 'Show a wide aerial view' confirmed"),
 ("after-acceptance-burj-khalifa-marathon-1440x900.png", "Section 23 acceptance workflow — final state after three Q&A commands"),
 ("after-demo-E-snapchat-metrics-1440x900.png", "Demo E — Snapchat panel with real execution metrics (deploy #4)"),
]
for f, cap in shots:
    p = os.path.join("/tmp/gev-figs", f)
    if os.path.exists(p):
        s.figure(p, caption=cap, width="100%")
s.p("SSE trace recordings: docs/evidence-2026-11-01-live-engine/qa-live-final/demo-A-1440x900-sse-trace.json and qa-live-final-deploy4/demo-A-*-sse-trace.json (full monotonic event ring). No video recording was produced (headless SwiftShader; stills + traces only).")

s = doc.section("Status matrix")
s.table([[a, b, c] for a, b, c in matrix], header=["Component", "Status", "Evidence"])

s = doc.section("Remaining blockers")
s.html(md2html(seg("## 14. Remaining blockers", "## 99")))

doc.toc()
doc.footer("Gods Eye View · Live Cinematic Intelligence Engine · evidence report 2026-11-01")
pdf_path = os.path.join(OUT_DIR, "gods-eye-view-live-cinematic-engine-report.pdf")
doc.save(pdf_path)
rep = pp.verify(pdf_path)
print("verify markup(non-advisory):", [i for i in rep["markup"] if not i.get("advisory")][:5])
print("verify geometry:", rep["geometry"][:8])
