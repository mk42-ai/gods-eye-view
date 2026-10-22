# CHECKPOINTS — tagged recovery points on `integration/ondemand-native`

| tag | base commit | created (UTC) | purpose |
|---|---|---|---|
| `recovery/pre-ondemand-rebuild-20261020` | `1c9558c` | 2026-10-20T21:26:36Z | pre-rebuild protection point (never move) |
| `checkpoint-2026-10-21-preview-retry` | cycle-6 checkpoint commit (on top of the cycle-6 fix/feat/test commits; deploy source of the retry sandbox was `712a552`) | 2026-10-21T10:3xZ (see `git tag -n`) | preview retry: fresh sandbox `sb-4asza5droe1u` health-gated, A–G 14/14 pre- and post-fix, 4 defects fixed (B-21…B-24) with before/after evidence, 4,688 units |
| `checkpoint-2026-10-21-post-sandbox-verification` | `712a552` (cycle-5 checkpoint commit on top of `7b669a3` artefacts + `eb4ec15` legacy cleanup) | 2026-10-21T09:0xZ (see `git tag -n`) | post-verification baseline: 14/14 A–G on the live sandbox with PNG proof, parity/plugin/branding/asset checks green, 4,674/4,675 units — taken BEFORE any further Signal Engine chat-UI change |
| `checkpoint-2026-10-21-verify-cycle4` | `226217f` (cycle-3 checkpoint docs) | 2026-10-21T04:12:28Z | cycle-4 baseline before the five-agent verification swarm and the sandbox resume |
| `checkpoint-2026-10-21-pre-integration-audit` | `f89d3ca` (cycle-2 checkpoint) + this file | 2026-10-21T01:22:13Z | cycle-3 baseline before the integration audit, voice re-routing and UI upgrades |

Rules: tags are never moved or deleted; a checkpoint tag is created BEFORE any chat-UI change of a cycle and its SHA is recorded in MASTER_STATE §1.

GENERATED_UTC: 2026-10-22T06:35:00Z
| `checkpoint-2026-10-22-cycle8-preview` | cycle-8 docs commit (on top of `6b49fe9` + the embeddability unit) | 2026-10-22T06:35Z | emergency preview redeploy: fresh sandbox `sbx_EdkizkMGv6ASKOnpEmUWOAlaQrRc` → `sb-1ek30lyxzsd3.vercel.run`, health 200 `configured:true` `keySource:server`, embeddings proven by iframe render at both viewports (TEST_RESULTS §13) |
