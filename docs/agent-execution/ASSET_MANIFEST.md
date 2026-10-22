# ASSET_MANIFEST — shipped image assets (public/assets)

Every entry was downloaded from the platform's signed blob URL (never hot-linked), verified by HTTP 200 +
`content-type: image/png` + non-zero body, checked with Pillow (`PNG 1024×1024 RGB`) and hashed. Derived
WebP thumbnails are produced with Pillow 12 (LANCZOS, quality 82). Served under `/assets/...` (immutable
cache header in `vercel.json`). Brand set provenance: `BRAND_ASSETS.md`.

## UAE AOI group artwork (`public/assets/aoi/`, added 2026-10-22, cycle 9)

| file | bytes | px | sha256 | use |
| --- | --- | --- | --- | --- |
| iran-hormuz.png | 920,088 | 1024×1024 | 1a34dfd0ff55d26864a3d0bfd845646a349aef404fc3ade2965c24e74fc387e1 | IRAN group artwork (Strait of Hormuz) — source `agents/1vHX8Qloub.png` |
| yemen-bab-el-mandeb.png | 884,200 | 1024×1024 | c2164c4bf966be24b80cf81acd457772ce8dfaa3e8397d54ce25175b8716102c | YEMEN group artwork (Bab el-Mandeb) — source `agents/n8l53Ld0Es.png` |
| somalia-horn.png | 890,314 | 1024×1024 | cf5cd7c4fe021ee7c75fedb7d2aaec5838e818873cf25c5e2fb10e5e60926ca1 | SOMALIA group artwork (Horn of Africa) — source `agents/RjfNLBHUk3.png` |
| empty-calm.png | 862,128 | 1024×1024 | 89a5e056ef4737f19901925cdef84f3952545b05eb09c0c3031911dec66e90b8 | SCENES empty state (no incidents / calm) — source `agents/tGzCJhZKQ3.png` |
| uae-home-border.png | 566,020 | 1024×1024 | 519ada141ded03def2bb979fbbafbad3b658b55b1f439145a595c2429e37133d | UAE HOME BORDER artwork — **derived**: `iran-hormuz.png` grayscale-colourised toward emerald/teal (Pillow `ImageOps.colorize`, blend 0.65) |

Derived thumbnails (the ones the UI actually loads — `src/data/local_data/uae-aoi/uae-aoi.json` `groups[].artwork`,
`src/ui/styles/scenes.css` `.scene-shot-empty--calm`):

| file | bytes | sha256 |
| --- | --- | --- |
| iran-hormuz-384.webp | 5,530 | 371b2c8c3f5bc9eedf4bf9758f30422a1a315c6525b5df1154c5c507795811c2 |
| yemen-bab-el-mandeb-384.webp | 3,372 | beb918bac3ddf8f93cba906357f720dc47c061fb06bf68b55273eea97d81b2a4 |
| somalia-horn-384.webp | 4,198 | 3c5e162bec5614c414437eb6ce6489eaf368d6873f84be272a59ad7cc605cb41 |
| uae-home-border-384.webp | 4,762 | 42c758a517255ea6aaed61f2494f120630d14cb5bde06c2a4f1894e7d9a416a9 |
| empty-calm-384.webp | 2,708 | 9fc441fa1d811a340d6c5e0fbb7e5fd316937b8449d51f1cbd39f240090de176 |

Wiring: `src/data/uaeAoi.js#groupArtwork()` → `src/ui/incidentPanel.js` (`.scene-group-art` beside the LIVE badge, swaps
with the group dropdown); empty state class `.scene-shot-empty--calm`. Verified live on `https://sb-17suihbulexj.vercel.run`
(2026-10-22T10:14Z–10:19Z): all five `/assets/aoi/*-384.webp` referenced by the rendered panel; `dist/assets/aoi/` present in
the sandbox build (531 files).

## Brand set (`public/assets/brand/`, 2026-10-20)

See `BRAND_ASSETS.md` for the full table (8 generated PNGs + favicon/app-icon/og-image derivatives, sha256 per file).

GENERATED_UTC: 2026-10-22T10:20:00Z
