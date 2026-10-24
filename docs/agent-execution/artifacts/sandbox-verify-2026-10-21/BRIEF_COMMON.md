# sandbox-verify-2026-10-21 — common brief for the five verification agents

Target: live Vercel Sandbox preview `https://sb-72vtzc1c6cf8.vercel.run` (sandbox `sbx_pZgfovEYwxtQu48zPwIg0rVujhWO`,
serverless preview server `node server/serverless/dev-server.mjs`, port 5173, workspace head `aa3eb8d`).
`GET /api/health` returned 200 at 2026-10-21T07:33Z before the swarm started.

Rules shared by every agent
- Only the sanctioned browser drivers: `scripts/qa-chat-intelligent-ui.mjs` (Puppeteer + SwiftShader, process-group hardKill),
  the other `scripts/qa-verify-*.mjs` harnesses, or the ui-validator `ui_validate.py`. Any extra focused Puppeteer script must
  copy the launch + `hardKill` + global-timeout block from `scripts/qa-chat-intelligent-ui.mjs` verbatim and live under /tmp.
- Every result carries the URL used and ISO-8601 UTC timestamps; every scenario × viewport cell has a PNG screenshot.
- No secrets are printed, read or written (the OnDemand key lives only in the sandbox server process).
- Agents write only inside their own `agentN/` directory; no git operations; no source edits (fixes are the orchestrator's job).
- Screenshots are PNG; filenames `<scenario>-<viewport>.png` for A–G cells, `check-<name>-<viewport>.png` for extra checks.
