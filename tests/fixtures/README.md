# Test fixtures (FIXTURES — not live data)

Deterministic payloads used by the Playwright acceptance tests and by the app
ONLY when `?fixtures=1` is in the URL (test mode). At runtime the live OnDemand
plugins are tried first; these files never load in production.

`step1-fixtures.json` — verified facts for the Umm Suqeim crash (2026-10-23 web
verification): every `verified:true` value comes from an HTTP response received
during the check; unverifiable values are `verified:false` and listed under
`blockers`. It is the source of the expected date/publisher values asserted by
acceptance tests 2 and 3.
