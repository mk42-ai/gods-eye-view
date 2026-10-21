# CHECKPOINTS — tagged recovery points on `integration/ondemand-native`

| tag | base commit | created (UTC) | purpose |
|---|---|---|---|
| `recovery/pre-ondemand-rebuild-20261020` | `1c9558c` | 2026-10-20T21:26:36Z | pre-rebuild protection point (never move) |
| `checkpoint-2026-10-21-pre-integration-audit` | `f89d3ca` (cycle-2 checkpoint) + this file | 2026-10-21T01:22:13Z | cycle-3 baseline before the integration audit, voice re-routing and UI upgrades |

Rules: tags are never moved or deleted; a checkpoint tag is created BEFORE any chat-UI change of a cycle and its SHA is recorded in MASTER_STATE §1.

GENERATED_UTC: 2026-10-21T01:22:13Z
