# Gods-Eye design tokens

Source of truth: `src/gods-eye/ui/tokens.css` (every `ui/*` sheet reads only these; no new hex
values appear outside that file). Brand greens come from `src/brand/tokens.css`.

| token | value | role |
|---|---|---|
| `--ge-space-1…6` | 4 / 8 / 16 / 24 / 32 / 48 px | 8-pt grid (1 = half step) |
| `--ge-fs-xs/sm/md/lg/xl` | 10 / 11 / 12 / 14 / 18 px | the single type scale |
| `--ge-font-mono` | JetBrains Mono → ui-monospace | identifiers, coords, timestamps, chips |
| `--ge-font-sans` | Inter → system-ui | prose (captions) |
| `--ge-bg` / `--ge-bg-raised` / `--ge-glass` | #070f16 / #0b1820 / rgba(7,15,22,.92) | surfaces |
| `--ge-ink` / `-muted` / `-dim` | #f3f3f3 / 68 % / 42 % | text (AA on --ge-bg: 17.8:1 / 11.4:1 / 6.5:1) |
| `--ge-teal` | #3bb795 | accent, OK, exact confidence, focus ring (7.9:1 on bg) |
| `--ge-amber` | #f5a623 | RECENT, restricted, quota, fallback, inferred (10.2:1) |
| `--ge-red` | #ff5a4e | closed, error (6.1:1) |
| `--ge-grey` | #8a9a99 | ARCHIVE, unknown, inactive (5.9:1) |
| `--ge-live` / `--ge-recent` / `--ge-archive` | #35d07f / #f5a623 / #8a9a99 | recency badges + pin colours |
| `--ge-status-open/restricted/closed/unknown` | green / amber / red / grey | ground-route layer |
| `--ge-conf-exact/inferred/unknown` | teal / amber / grey | geo-confidence ring (solid / dashed / greyed fan) |
| `--ge-radius` / `--ge-radius-pill` | 8 px / 999 px | panels / chips+buttons |
| `--ge-motion` / `--ge-ease` | 180 ms / cubic-bezier(.2,.8,.2,1) | every UI transition (camera excepted); 0 ms under `prefers-reduced-motion` |
| `--ge-z-scene / -sidebar / -modal` | 160 / 184 / 192 | z-order contract (command dock 145 · composer 150 · banner 180) |

Focus: `outline: 2px solid var(--ge-teal); outline-offset: 2px` on every `[id^='ge-'] :focus-visible`.
Skeletons: header 56 px, player 16:9, timeline 48 px, evidence 24 px are reserved before data arrives (CLS 0).

Posters: `src/gods-eye/ui/scene/posters.js` is the single source of the designed-state artwork
(`/assets/states/state-*.png`, 1280×720): idle/fetching → `state-live-acquiring`, loading/flying →
`state-flyin-building`, empty → `state-no-footage`, archive → `state-archive-rebuild`, quota →
`state-source-quota`, error → `state-source-inactive-error`, routeFallback → `state-route-fallback`,
outsideRegister → `state-outside-aoi`, recreateDiff → `state-saved-recreate-diff`. `applyPosterTokens()`
publishes them as `--ge-poster-<state>` custom properties; no component or stylesheet carries a path.
