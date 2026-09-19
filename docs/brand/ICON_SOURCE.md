# OnDemand Spatial UI icons — evidence ledger (ICON_SOURCE)

| Field | Value |
|---|---|
| Generated (UTC) | 2026-09-19 (inventory 04:08:13Z–04:30:17Z, package install 04:14:14Z, icon sync 04:21:33Z / 04:34:49Z / 2026-09-19T04:40:19Z) |
| Scope | Every emoji code point and every text glyph used as an icon in the rendered UI — DATA LAYERS rows (all groups, not only MOVEMENT), panel chrome, VISUAL PRESETS, DISPLAY toggles, LOCATION tray, HUD, key setup, radio transport, mission/event panels, ASK ONDEMAND, OD VOICE readouts — replaced by inline SVG icons from one outline family. |
| Method | Inventory by script (Python, Unicode ranges below) over `src/`, `index.html`, `style.css`, `public/*.html`; icons copied from the pinned npm package (never hand-drawn, never fetched from a CDN at runtime), optimised with SVGO, normalised by `scripts/sync-lucide-icons.mjs`; brand documents read offline with PyMuPDF (page text + image inventory). No web search. |
| Citation format | `(src: <origin host/path>, retrieved <UTC>)` — as in `docs/brand/BRAND_SOURCE.md` and `docs/ONDEMAND_API_CURRENT.md`. Azure Blob SAS query strings are stripped; those paths are provenance only. |
| Evidence labels | **DOCUMENTED** = printed in a source · **PACKAGE** = read from the installed npm package / registry metadata · **REPORTED** = stated in the task brief, not re-verified this run · **DERIVED** = this repo's choice, the sources are silent · **NOT DOCUMENTED** = absent from every source. |
| Not-found rule | Whatever the brand guideline does not state is listed under §2.3 (MISSING) and is never presented as brand policy. |

## 1. Icon set (chosen, pinned, licensed)

| Field | Value | Evidence |
|---|---|---|
| Set | **Lucide** (`lucide-static`) — one consistent outline family: 24 × 24 grid, 2 px round-capped strokes, `currentColor` | PACKAGE — `node_modules/lucide-static/package.json` (`name`, `version`, `license`, `homepage https://lucide.dev`, `repository https://github.com/lucide-icons/lucide.git`) |
| Exact version | **1.47.0**, pinned exactly in `package.json` (`"lucide-static": "1.47.0"`, devDependency, no caret) and locked in `package-lock.json` | PACKAGE — `npm install --save-dev --save-exact lucide-static@1.47.0`, 2026-09-19T04:14:14Z–04:14:16Z |
| Licence | **ISC** (SPDX-License-Identifier: `ISC`) — `public/icons/LICENSE` is a byte copy of the package `LICENSE` (sha256 `b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57`); the package also states that part of the set derives from Feather (MIT), which the same file carries | PACKAGE — `lucide-static@1.47.0/LICENSE` |
| Source URL | https://github.com/lucide-icons/lucide (repository) · https://lucide.dev/icons/<name> (per icon) · tarball `https://registry.npmjs.org/lucide-static/-/lucide-static-1.47.0.tgz` | PACKAGE — `npm view lucide-static@1.47.0` (src: `registry.npmjs.org/lucide-static`, retrieved 2026-09-19T04:13:43Z) |
| Tarball integrity | `sha512-yWIrkdXc688Feq5VjOktsKmV5Ikc7y5Nu3rrdtbr8nWjkJWk8QlnZfVtIak22Af+fNhZ7k4cTJpZo1zmj7X5sA==` (shasum `ad0520340308bc22b719e88f037a014866e5fe1f`); registry publish time 2026-09-17T07:30:02.340Z | PACKAGE — `npm view` as above |
| Icons available / shipped | 2,112 SVGs in the package; **57 shipped** in `public/icons/` (one per inventoried role + the `layers` fallback + five transit-mode names reserved for DOM surfaces) | PACKAGE — `ls node_modules/lucide-static/icons | wc -l`; manifest `src/ui/icons/lucide-manifest.json` |
| Fallback considered | Tabler Icons (`@tabler/icons`, MIT, 24 grid, 2 px stroke) — not installed; Lucide covered every inventoried role | REPORTED (task brief) |
| Optimiser | `svgo@4.0.0` run through `npx --yes --package svgo@4.0.0 -- svgo --config <cfg> -f <raw dir> -o <optimised dir> --quiet` with the config `export default {   multipass: true,   plugins: ['preset-default'], };` (viewBox is kept by SVGO 4's preset-default; `normalizeSvg()` then rewrites the root element to the contract below, strips `class`, drops `width`/`height` from the body and re-adds the fixed 24 × 24 root). Runs: 04:21:33Z, 04:21:55Z, 04:34:49Z, 04:40:19Z, 2026-09-19T05:00:37Z | PACKAGE — `svgo@4.0.0 (preset-default, multipass)` |

**Normalised file contract** (`scripts/sync-lucide-icons.mjs → normalizeSvg`, asserted per file by `src/iconGlyphBoundary.test.mjs`): one licence comment line, then a single-line `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">…</svg>`; no `class`, no ids, no hard-coded colour inside the body (the script refuses any `fill`/`stroke` other than `none`/`currentColor`). Re-run `node scripts/sync-lucide-icons.mjs` after editing the manifest; the script fails if the installed package version drifts from the manifest pin.

### 1.1 Mapping table — emoji / glyph → Lucide icon → file → usage

57 icons. Each `public/icons/<name>.svg` is the SVGO-optimised, normalised copy of `node_modules/lucide-static/icons/<name>.svg` (lucide-static 1.47.0). The "before" digest is `sha256` of the package file exactly as installed from the registry tarball (PACKAGE, read 2026-09-19T05:00:35Z); the "after" digest is the shipped file. Full per-site detail is §3.1; re-running `node scripts/sync-lucide-icons.mjs` reproduces both columns (`JSON` on stdout).

| Emoji / glyph replaced | Lucide icon | File (bytes) | sha256 before optimisation (package file) | sha256 after (shipped) | Usage location(s) |
|---|---|---|---|---|---|
| 🛰️ U+1F6F0 U+FE0F | `satellite` | `public/icons/satellite.svg` (661 B; source 747 B) | `dce2d180f1710e1de94bae2f21453195c76a35847d88864ef0251f2ee25ac6fc` | `74ab482bffca8945a1059ac2897a2a0d2879fa265148dcff2d9ba502ac66e9b0` | DATA LAYERS › Movement › Satellites (src/layers/satellites/controls.js) |
| ✈️ U+2708 U+FE0F · &#x2708; | `plane` | `public/icons/plane.svg` (468 B; source 497 B) | `c9f34e0746b8b26a832c9d1fc3de2d6ef36e8970617e67409fb10067fa4b0fb9` | `b3fe5ab2eeae688d973e171a84b650d6e244ab5371e2f5d45ea0036a01cbd0d2` | DATA LAYERS › Movement › Live Flights (src/layers/flights/queries.js); DISPLAY › 3D aircraft toggle (src/ui/templates/display-controls.html) |
| 🎖️ U+1F396 U+FE0F | `shield` | `public/icons/shield.svg` (435 B; source 463 B) | `b04359184b2deb45f3f6e0bd425ff1bd48e7a4f1a49a9ce46b2b26d791e8b5be` | `6be252933a7b75274a42c9e0dc14165a9d9a17d35d17365ef8b642780cf78b61` | DATA LAYERS › Movement › Military Flights (src/layers/military/queries.js) |
| ◭ U+25ED | `ship` | `public/icons/ship.svg` (550 B; source 614 B) | `38e0ab9841e2b2d840029543ac8dd9feca1dcac1853b76fdfe1f883e59a6ec23` | `7ff737e60c3a5d80b5bebc5ae827d17e3f2561d8edb0e6070e195db8c0d1fd71` | DATA LAYERS › Movement › Live Vessels (src/layers/vessels/queries.js); transit ferry mode (src/data/transitFeeds.js) |
| 🚗 U+1F697 | `car` | `public/icons/car.svg` (520 B; source 560 B) | `0de0858240d0f110a9bab14cbe1245603650ce64c5d3a9b41d36ba517426a618` | `02ef93902b6483aaa8b803c1afdea30d32550f675dacf8488d67d2211d2d5ac7` | DATA LAYERS › Movement › Street Traffic (src/layers/traffic/controls.js); Directions DRIVE mode (src/layers/directions/index.js) |
| 🚌 U+1F68C | `bus` | `public/icons/bus.svg` (473 B; source 566 B) | `d8b3470db0b71233f05687ddb48060c38e42f976d14c11cb84133ca5ce3b7793` | `b55cae3d769cf2f5035a3c289ec1fbb269fe321e25dc069cb38788131e7d8444` | DATA LAYERS › Movement › Transit (src/layers/transit/lifecycle.js); transit bus mode (src/data/transitFeeds.js) |
| 🚲 U+1F6B2 | `bike` | `public/icons/bike.svg` (400 B; source 440 B) | `469c4453b17c86e3f8babff5224235fc17ebf9a8088cbdbc6f71b0a14c231e49` | `1404dc2e9acbfc096cb5e5c757420c4b38771ffc9e48cdcec3384b13271e39be` | DATA LAYERS › Movement › Bike Share (src/layers/bikeshare/controls.js); Directions BIKE mode (src/layers/directions/index.js) |
| 📹 U+1F4F9 | `cctv` | `public/icons/cctv.svg` (537 B; source 630 B) | `9c7efd7d117d01d672875a9abfe02cd348cf8dba9fa163c36cba425d320d2d16` | `cfeb6ca98b170c40cc526ffbf74e96594c6e6987b2f4e33a45f687c732cecc4e` | DATA LAYERS › Cameras › Cameras (src/layers/cctv/controls.js) |
| 📷 U+1F4F7 | `camera` | `public/icons/camera.svg` (482 B; source 514 B) | `2ed1c06316a7e29e41c091ab771332483e6cd8622a5ca0403d420377981cec05` | `312e1030953024f9d7837f6f6fbad7a92bf0c71e6e1a41d2bcf59b5d0f90f7e5` | DATA LAYERS › Cameras › Mapped ALPR Cameras (src/layers/alpr/index.js) |
| ⌖ U+2316 | `radar` | `public/icons/radar.svg` (494 B; source 603 B) | `bd61dd0d894db3c7dff95aef120f78ef21d67d26fcb6d9c68fdb4973618fa01d` | `c820c6fc8484d9e129adc7ff83b971cf5f095aa52e135eec72297c2780362070` | DATA LAYERS › Infrastructure › Military Installations (src/layers/installations/controls.js) |
| ▣ U+25A3 | `server` | `public/icons/server.svg` (401 B; source 490 B) | `295bcac93ca3d2b8565a4cf25b50c79cc034e14db2bebf4adc52c997985f9615` | `e0b5ecf557b2ae79e916f8e337adc27d65fbcd7165c1e71c11c3896644c06f6b` | DATA LAYERS › Infrastructure › Data Centers (src/data/infrastructure.js) |
| ≋ U+224B | `cable` | `public/icons/cable.svg` (506 B; source 608 B) | `90befc72f302bbfd8b043a19b0ea87ec8f3702fe3b1ed2c4e0c4e55af94aac89` | `7f25023b13863435f0690cbedf78f29a812e8ec5d9313b91c98a114f240d9f13` | DATA LAYERS › Infrastructure › Submarine Cables (src/layers/submarineCables/lifecycle.js) |
| ▰ U+25B0 | `dam` | `public/icons/dam.svg` (513 B; source 625 B) | `07877da8f1dde58caa49217d99106be47edcf389065a87eefa27b1c71c60f10d` | `0360f28e17c99ead5ea6bfb1ec3f6b97fd2973ed813fe326d05f97be51aa27bf` | DATA LAYERS › Infrastructure › Dams (src/data/infrastructure.js) |
| 🚀 U+1F680 | `rocket` | `public/icons/rocket.svg` (554 B; source 606 B) | `09686fcfcec7cf5b54ee5b88f14ab2c3cdfd3f058ab18310b249c6d032df1b8c` | `47ba8c10e77c126feae3d53ff04dda443247e8e92ac2dadf16296d7cd59ab6ff` | DATA LAYERS › Events › Rocket Launches (src/layers/launches/controls.js) |
| 🌋 U+1F30B | `activity` | `public/icons/activity.svg` (397 B; source 425 B) | `9c3a08400fbcf93f2a3d7e0c7a7a605a88d5e647dc78b72e15415a80e80e5ca5` | `36bec5b57fe8b421220d84d0fcfa7568d7b0a23e0b1cf8446ca430b9b492dd7a` | DATA LAYERS › Events › Earthquakes (src/layers/earthquakes/index.js) |
| ▲ U+25B2 | `flame` | `public/icons/flame.svg` (362 B; source 390 B) | `8117cf7b3f5b6ae91473a0c57704510f5e402056e0d38f9786780ac7aba046d7` | `5f9797952e65d0827ef78f999f17f61ba1080e71fd038cb2c4cbde8a24c33a62` | DATA LAYERS › Events › Active Fires (src/app/constructCatalog.js, src/data/localLayers.js, src/app/layers/firms.js) |
| 🧭 U+1F9ED | `compass` | `public/icons/compass.svg` (397 B; source 429 B) | `297705d21db3a22ae65958b2ca0b99fc9a8716faea0b1f0176c3f94ecf8cd4f9` | `65a1ec424fb0642856ca9aa7b1357f5118c0abdccb30832e9b0dc6189b594f03` | DATA LAYERS › Utilities › Directions (src/layers/directions/index.js) |
| ◉ U+25C9 | `radio` | `public/icons/radio.svg` (429 B; source 513 B) | `2da20e5413377c768777fe71f2c44370e3158d8cc5beb83b0ca18a9bbd623f8c` | `84e2e2b94ab27f0ff686e27ecca9dd41072ff6be38ffa836bde79ec7b1830a3f` | DATA LAYERS › Utilities › Radio (src/layers/radio/controls.js) |
| ◎ U+25CE | `globe` | `public/icons/globe.svg` (359 B; source 407 B) | `b67c4a2ef01ef04ac729977fe3d614a8104e0551ba53594d55604236ee913fe2` | `9f1d7afca87f1c377b55a1a20dbe2808d73bbbb1950724982f24885463760258` | Global Context awareness layer (src/layers/awareness/controls.js) |
| 🌊 U+1F30A | `waves` | `public/icons/waves.svg` (352 B; source 412 B) | `26eb3162e37ae7ed1be9856f894707036d1a68148c8018a89b3e1287fda7e8e9` | `0a584eac77ec0e3569fe7cdc6aa676b68e8372764a43af2f43c2a64b47d18b56` | Bhote Koshi event layer (src/data/bhoteKoshiEvent.js) |
| ◎ U+25CE | `locate` | `public/icons/locate.svg` (332 B; source 488 B) | `868234c34a58d5f2c945ae1d5b24d9b0bda66d0b5636ec958f1c4b8f467fd251` | `30c0647ad6d4341fd3f87cad9c641cf498ac2b4151a0561a9fa424ed8a5b79c9` | Bhote Koshi locator layer (src/data/bhoteKoshiLocator.js) |
| 📍 U+1F4CD | `map-pin` | `public/icons/map-pin.svg` (405 B; source 437 B) | `91d38541f40d499f6ba472b384c89da08cbb4d9c2fe68ad35c50b458e47265c4` | `0048bdba66c7019156b3b67593305f8d4c9978a0285204804a193604e03b7242` | Local GeoJSON layer default (src/data/localGeojsonCore.js); LOCATION tray city line (src/ui/templates/command-dock.html, src/ui/locationControls.js) |
| 🚶 U+1F6B6 | `footprints` | `public/icons/footprints.svg` (521 B; source 601 B) | `3355b2fda28a9c8ec0be38cb664be55a7cfb0479a12d0c665119916ebc5e0a49` | `62c3cbd135756272222c3c34dca5bfcfb8aed4943b8123e649f7a6d6d01da1d7` | Directions WALK mode (src/layers/directions/index.js) |
| 🚊 U+1F68A | `tram-front` | `public/icons/tram-front.svg` (378 B; source 491 B) | `a0308b0968879694eb6726fc2bc7c04c67c6c7b7fa23fe2e0a2baf78436f2779` | `51e8570797d5c6575b3a408e42cc00bc6355aa1317cffb9353136ae713e4e11b` | transit tram mode (src/data/transitFeeds.js) |
| 🚇 U+1F687 · 🚆 U+1F686 | `train-front` | `public/icons/train-front.svg` (411 B; source 509 B) | `520db04be3e841614ba615c8f3de5ca04c60a321c010872c19073765f68cdc68` | `4b6f94cdedcc02e694c4262c54ebbb3147729cf54ff65c0c85baafe9ef3bfd7d` | transit subway / rail modes (src/data/transitFeeds.js) |
| 🚏 U+1F68F | `signpost` | `public/icons/signpost.svg` (479 B; source 539 B) | `73329d47e81e747ead8178800b865c1d050fabe9449f124a0c1743a94b33fadd` | `a0c5f594f9e439b6a31e4256e588d78178f35be1edcf0fd902264b7887d6b552` | transit unknown mode (src/data/transitFeeds.js) |
| — | `layers` | `public/icons/layers.svg` (551 B; source 587 B) | `15d0350e08058e736632a774d7de4136c39659963a67612f8a274e25f6ac4838` | `320623140799602afdc75dc9e412f66410dbe72a5545df16ed60db208fa154d9` | Fallback for an unregistered icon name (src/ui/icons/layerIcon.js) — never a glyph |
| ◀ U+25C0 · &#x25C0; · ‹ U+2039 | `chevron-left` | `public/icons/chevron-left.svg` (293 B; source 321 B) | `4a6ec61e17068836f3399349533d79d34ed7a533dd62ffd71bd33e2b108e2fa3` | `427a1784d42d6e724fa82d6cda76459d51e88c1445f2268a0499798e5bdcc311` | Right-rail collapse buttons (src/ui/panelChrome.js, src/ui/templates/display-controls.html); Cockpit display/radio tray toggles (src/ui/templates/cockpit.html, src/ui/radioBindings.js); Mission prev (src/layers/launches/panel.js); Previous story beat (src/data/bhoteKoshiEvent.js); Command-dock compact chevrons (src/ui/styles/command-dock-compact.css) |
| ▶ U+25B6 · › U+203A | `chevron-right` | `public/icons/chevron-right.svg` (293 B; source 321 B) | `240094983bc0ee26da77a8f7b1f87106e9f3b9bf34ac89127449140f8d96f718` | `38ce755c891d0bea9d6342dd8b7faac8b5c51bd398dd0ac8a13c00fe82908b3b` | Right-rail expand buttons (src/ui/panelChrome.js, src/ui/templates/context.html); Cockpit tray toggles (src/ui/radioBindings.js); Mission roster chevron / next (src/layers/launches/panel.js); Next story beat (src/data/bhoteKoshiEvent.js); Command-dock compact chevrons (src/ui/styles/command-dock-compact.css) |
| + U+002B (collapse-button glyph) | `plus` | `public/icons/plus.svg` (287 B; source 331 B) | `b0c6dc396b96741954b4ac7aaa247b9df73628e877826924e5d622e2677e2960` | `1cb37c1fa8ec68ff2db27f723029332053a37b2aa7e8f1be440b71c683562de3` | Collapsed panel expand buttons (src/ui/panelChrome.js, src/ui/templates/layer-panels.html, command-dock.html, context.html) |
| − U+2212 | `minus` | `public/icons/minus.svg` (280 B; source 308 B) | `ac7b7fa077469ddcf2fe811d8a8d8184e3e7380bf8a299c9c4838a9296d1501f` | `fc045ebc15b4db0afbb15a330b932a56b302ef9c6bcd897224db849c2da52495` | Expanded panel collapse buttons (src/ui/panelChrome.js, src/ui/templates/display-controls.html) |
| ◀◀ U+25C0×2 | `skip-back` | `public/icons/skip-back.svg` (371 B; source 415 B) | `64a3b682a80f0674295d1cf040979940de47573273c24399b13f0a4c5327074f` | `800a49b993105e30ea38cfef1677d003512faf7951ee9e9b0ae9c277011bd32b` | Radio previous station (src/ui/templates/cockpit.html, context.html) |
| ▶▶ U+25B6×2 | `skip-forward` | `public/icons/skip-forward.svg` (372 B; source 416 B) | `d842be66c1039ceeb4b1826eb6acb6da5cf8fc61203877d1b9dd0ea7860addde` | `4dbaf78ecc20b627949b82abc7d9994d8afb525262e6e2c2d7647af22b3ae367` | Radio next station (src/ui/templates/cockpit.html, context.html) |
| ▶ U+25B6 | `play` | `public/icons/play.svg` (353 B; source 381 B) | `3c210a3983b60e95727e9c909cf905634214f24baac51f837f77ef33598d4dfb` | `f0e0e8a057739753c27c82b0864d0c26e319bac27bcde32810fb21d617e8d040` | Radio play (src/ui/radioPresentation.js, templates); Mission replay resume (src/layers/launches/replay.js); Bhote Koshi PLAY / PLAY SHOT / PLAY SCENE (src/data/bhoteKoshiEvent.js) |
| Ⅱ U+2161 | `pause` | `public/icons/pause.svg` (357 B; source 389 B) | `d5baf971714d5dbb1c0542cbeff7316c3a37e2929ce28dee39dc401557158fe0` | `4ee0f5963c06f4d5713dd06affe88d51dc114e0acdf794e4bf3a56e61f88c529` | Radio pause (src/ui/radioPresentation.js); Mission replay pause (src/layers/launches/panel.js, replay.js); Bhote Koshi PAUSE (src/data/bhoteKoshiEvent.js) |
| × U+00D7 (close-button glyph) | `x` | `public/icons/x.svg` (288 B; source 332 B) | `3fb7f6004b7d52fb5019d11dff0d3ebc4236aab0651315742ea2fa5bfd6711a2` | `55472117ca8da59ea423f95af2c3fd8084e2c175bf16c9edc6d7a3ee41e78a9b` | ASK ONDEMAND close (src/ondemand/entityChat.js); Mission deselect / cancel replay (src/layers/launches/panel.js); Bhote Koshi close (src/data/bhoteKoshiEvent.js) |
| ● U+25CF · ◯ U+25EF · 🔴 U+1F534 · 🟡 U+1F7E1 | `circle` | `public/icons/circle.svg` (293 B; source 321 B) | `14347bd325951a3050f629cbed62f3638e3635b0beb6c1dcb1653583e82cabd2` | `0c9a8ea8ca61c31fc9ff96e326bc972ceaa7d6a9ea98be1c9a5c1ca6607faad2` | HUD REC dot, solid via CSS (src/hud.js); VISUAL PRESETS › Normal (src/ui/templates/command-dock.html); Key setup tier dots, coloured via CSS (src/keySetup.js) |
| ◉ U+25C9 | `circle-dot` | `public/icons/circle-dot.svg` (328 B; source 360 B) | `87bdfef51344aa3519db77abbadf8b78e6aaad96d39988900b32517c6bd0d391` | `bc200b2c45fb1fffa1a429e72420b54cc4442fb5f726d41ed4d90bccc898f855` | Bhote Koshi CINEMATIC (src/data/bhoteKoshiEvent.js) |
| ■ U+25A0 · □ U+25A1 · &#x25A1; | `square` | `public/icons/square.svg` (310 B; source 338 B) | `6c807c0e62375a76442a9ae6bef581d517bc2458f9a201e6e6f8628dc24b00d2` | `c5af508da6fa58f5214bf9e98b890df76e7a33de513eb5d25da10858b5e5bfc2` | Bhote Koshi RELEASE CAMERA (src/data/bhoteKoshiEvent.js); DISPLAY › Clean UI (src/ui/templates/display-controls.html) |
| ↺ U+21BA | `rotate-ccw` | `public/icons/rotate-ccw.svg` (346 B; source 378 B) | `2119964e59f745a42e755e8d82259b6ba13d46d90e45752e4a478f5fbdd49ddb` | `380fab74a75ee5b96ff430a7582de0ceae9013018aa953cfd6a2fe22b6a82cc9` | Bhote Koshi REPLAY / FULL STORY (src/data/bhoteKoshiEvent.js) |
| ↗ U+2197 | `external-link` | `public/icons/external-link.svg` (356 B; source 416 B) | `9b447da6766cb87ec13d113eeb1be645e21cc253c64dcb8211436f627df2414b` | `dec6c61db7079642bfe9a5e4ec7e3d7d6ed9d0c28e15fc7eaac6c45cdf0f4a3e` | Key setup GET KEY / MANAGE (src/keySetup.js); Bhote Koshi OPEN ORIGINAL / OPEN PUBLIC MAP (src/data/bhoteKoshiEvent.js, bhoteKoshiEmbeddedMedia.js) |
| ⌖ U+2316 | `crosshair` | `public/icons/crosshair.svg` (339 B; source 492 B) | `6d4f48244f89c502c190c823a87240ac88bbb4401846066ea9dfc72df5c99018` | `3cd068d2f3861e0fc80b46db519f95f8d1bf46fef1ee5d9038492bd75ebbe8bb` | Bhote Koshi LOWER GORGE corridor (src/data/bhoteKoshiEvent.js) |
| ↔ U+2194 | `move-horizontal` | `public/icons/move-horizontal.svg` (316 B; source 375 B) | `2dbc593d41f8d6dab59b8a5f66b86204fd48f045c2d40b9beee600a24d266837` | `64b05521e316e5fee7db819d8479ea7ff98b12a431e732037cba147baf402948` | Bhote Koshi split-view handle (src/data/bhoteKoshiEvent.js) |
| ➜ U+279C | `arrow-right` | `public/icons/arrow-right.svg` (299 B; source 343 B) | `dca2d26401c0b66cb7e82156492f0a24fd3e33f5379ef715d79d790f0b1993a8` | `bc98729f894f4f9be15836705c906ec6b3dea96f83f20a9d55578b4753c90b8f` | Global Context off-screen direction markers, rotated per bearing (src/layers/awareness/rendering.js) |
| 🔎 &#x1F50E; | `search` | `public/icons/search.svg` (320 B; source 352 B) | `5523ab5ec4d821183ad2b43b18142f36ea5080f1c90ffbf980c96a2b6cbbe5c6` | `50a789bd574920d2a7a3d50d29338ccac98ba055f60f6bcb78240980df4cfdce` | LOCATION search toggle (src/ui/templates/command-dock.html) |
| 🔗 &#x1F517; | `link` | `public/icons/link.svg` (402 B; source 434 B) | `b888b63ba7a04c6c431686844162cbe5f6ed1807f15fa0299de7aa5a1c4c0502` | `7a3eae0d64c10d8f2e33a26c18fbe9517a69dc69b5be4f7c86bf63acf2edcdbc` | Copy share link (src/ui/templates/scene-chrome.html) |
| ▦ U+25A6 | `tv` | `public/icons/tv.svg` (331 B; source 363 B) | `f72048a9476950bf19e317b1e7bbfd39a22b03eb987f287c3d58793e4049af73` | `900a7a1b94619a3b6b3f937488fd6e28a02104ee474af453ce8f2436ffddbaed` | VISUAL PRESETS › CRT (src/ui/templates/command-dock.html) |
| 🌙 U+1F319 | `moon` | `public/icons/moon.svg` (381 B; source 409 B) | `9fa6d5d11478335302d3006385ce45fe09a05a403a83b7ddfea7d7ceaeca2a13` | `2a02aa71fba1fd70025707fb3d3e31550b90226fbd660a414dce06909b694c64` | VISUAL PRESETS › NVG (src/ui/templates/command-dock.html) |
| 🌡️ U+1F321 U+FE0F | `thermometer` | `public/icons/thermometer.svg` (319 B; source 348 B) | `1644abeb67b1fc2bc6224cd06c124765115c45fa1be0c8c65a6217fdf1f037f7` | `eff7d425a2bb020d23f2e760e6fffeb6586e5ca454122c4127899253d4bc0bc7` | VISUAL PRESETS › FLIR (src/ui/templates/command-dock.html) |
| ✦ U+2726 | `sparkles` | `public/icons/sparkles.svg` (581 B; source 646 B) | `b6398bc0c005340918475369e80921db0f6781a91af48d45f9cb85ec444a30d8` | `b95081e8e4f6081f64102856aea09aebbc437f8e29114132ad492fb430984e46` | VISUAL PRESETS › Anime (src/ui/templates/command-dock.html) |
| ◐ U+25D0 | `contrast` | `public/icons/contrast.svg` (329 B; source 364 B) | `e5fcd40fbd16f64125f5e08480877363e50ce7823985d97f0c7164f04da12b38` | `51e608f71f958c84ee25bf7937340ed7fbd782ac53de0aee9b210131bf2bbd91` | VISUAL PRESETS › Noir (src/ui/templates/command-dock.html) |
| ❄ U+2744 | `snowflake` | `public/icons/snowflake.svg` (493 B; source 676 B) | `1cd1aeb5b3705bd592e899b391d9873622c9345900a3a5c6cd979430bd4a1597` | `13eb478209c40109bb192f47a8d6146eedb264619f717daed74577e07995b678` | VISUAL PRESETS › Snow (src/ui/templates/command-dock.html) |
| 🛸 U+1F6F8 | `triangle` | `public/icons/triangle.svg` (342 B; source 370 B) | `bc6e51d8c396d71a069a805979b34b66ca75b3104c9d84ca18a935ac50105b7f` | `c21d57b18daaab17be7d7945cc315b17c891780f67e76489c212e888eaf89446` | Reclassify tracked contact as TR-3B (src/ui/templates/context.html) |
| ◎ &#x25CE; | `scan-eye` | `public/icons/scan-eye.svg` (502 B; source 587 B) | `437a3554217e00d1129f364e6892723c1b4bac73c369fb8e08cca893866798c2` | `1c7a618a32384788a849c5bd715dc9ebbced3e92d2a237c5a2a1395341e3e042` | DISPLAY › HUD toggle (src/ui/templates/display-controls.html) |
| ▣ &#x25A3; | `scan` | `public/icons/scan.svg` (364 B; source 441 B) | `8e41c74c2e8f46b8b853d3dd00012e507a77229d28dee0b312a3d608e654d3d5` | `bb4ba8ccb8a6fe69c02988c733a84d89df9409525bf91f27b4cce071fa2eed97` | DISPLAY › DETECT toggle (src/ui/templates/display-controls.html) |
| ✨ &#x2728; | `sun` | `public/icons/sun.svg` (415 B; source 559 B) | `892bbb96eb38c2711f857d9f968a65e9833c1d0141af7cb319d8cc04b10363a3` | `b4678c670363e9d923bb28c49f7dde1a9a9f0a64637a9de334319102834671d5` | DISPLAY › Bloom toggle (src/ui/templates/display-controls.html) |
| 🔍 &#x1F50D; | `focus` | `public/icons/focus.svg` (396 B; source 477 B) | `6fe145d7f5c217baf494c7d25ab289e678724e7714e871f205222d6685968437` | `f7e0cfdb1b52370a59ad936398ec622073e89444ecf143e7c622d023e41f8f7d` | DISPLAY › Sharpen toggle (src/ui/templates/display-controls.html) |

## 2. Brand-guideline evidence

### 2.1 Documents read this run

| File (as named in the brief) | Origin host/path (SAS stripped) | Retrieved (UTC) | Bytes | sha256 | Pages |
|---|---|---|---|---|---|
| `BrandGuidelines.pdf` (uploaded original, the PRIMARY of `docs/brand/BRAND_SOURCE.md` §1) | `airevprod.blob.core.windows.net/on-demand-prod/media/6692b763e851d28a036ab30e/BrandGuidelines.pdf` | 2026-09-19T05:00:10Z | 580,590 | `2992badc47a6b137e3337124de45ec21c35876700e52614e88171bb008c5fe6a` | 9 |
| `ondemand_brand.pdf` | `airevprod.blob.core.windows.net/on-demand-agent/agent-outputs/6692b763e851d28a036ab30e/6a3c31cfc459c8a8dbb627ee/6a3c7699c7150ad48800dfa6/generated/ondemand_brand_v1.pdf` | 2026-09-19T05:00:10Z | 580,590 | identical | 9 |
| `brand_guidelines.pdf` | `airevprod.blob.core.windows.net/on-demand-agent/agent-outputs/6692b763e851d28a036ab30e/6a38a92d5e5e6970ca97e071/6a38a9357136611a337783a9/generated/brand_guidelines_v1.pdf` | 2026-09-19T04:13:54Z and 05:00:10Z | 580,590 | identical | 9 |
| `ondemand_brand.pdf` (earlier copy) | `airevprod.blob.core.windows.net/on-demand-agent/agent-outputs/6692b763e851d28a036ab30e/6a349bcd64c53d8c058fd676/6a349d3864c53d8c058fd67f/generated/ondemand_brand_v1.pdf` | 2026-09-19T04:13:55Z | 580,590 | identical | 9 |

All four downloads are **byte-identical** to each other and to the primary `BrandGuidelines.pdf` ledgered in `docs/brand/BRAND_SOURCE.md` §1 (same sha256). Text was extracted per page with PyMuPDF 1.28.2 (`page.get_text("text")`); pages 1–3 and 6–8 carry running headers only, page 5 embeds one image. `docs/brand/BRAND_SOURCE.md` records **no iconography rule** either (its §3 assigns the "icons" role to `--od-neutral-400` as a DERIVED choice), so that repo file — the higher authority — adds no constraint beyond the palette.

### 2.2 What the guideline says that bears on icons (DOCUMENTED)

| Rule | Quote | Page | How this work honours it |
|---|---|---|---|
| Colour palette | "Primary / HEX: #0D5849 / HEX: #108B70 / HEX: #3BB795 / HEX: #ADEDD6 / HEX: #EDFCF6" and "Neutrals / HEX: #5B5B5B / HEX: #999999 / HEX: #C6C6C6 / HEX: #D8D8D8 / HEX: #F3F3F3" | p9 | Icons are `currentColor`: a live DATA LAYERS row icon takes `--od-green-500` (#3BB795), an off row `--od-neutral-400` (#999999 — the role BRAND_SOURCE assigns to icons), loading `--od-green-200`; no icon carries a colour of its own (`src/ui/styles/icons.css`). |
| Compact "icon" lockup | "Icon version is used wherever long version would not be reconizable because of size or where icon version is visually more appealing. Example: Social Media Profile Icons" | p4 | A **logo-lockup** rule, not a pictogram rule; it is not applied to UI icons. The favicon/mark work in `public/brand/` (BRAND_SOURCE §4) is untouched. |
| Contrast | "Wrong / Not enough contrast between background and logo" | p5 | Logo-specific, adopted for icons anyway: every icon colour pair above is the tokens' documented dark-ground pairing (#3BB795 7.88:1, #999999 6.35:1 on #161616). |
| Proportions / rotation / clear space | "Wrong / The logo proportions should be kept intact" · "Wrong / The logo should not be rotated" · "Wrong / The logo should have enough space around it" | p5 | Logo-specific. Icons keep the 24-unit box (never stretched: `width = height = 1em`); the only rotated icon is the Global Context direction arrow, which rotates by design (a bearing), not the logo. |
| Typeface | "Söhne / Download Font" | p7 | Not applicable to icons. |

### 2.3 MISSING — what the guideline does not say (NOT DOCUMENTED)

The guideline contains **no iconography rule**: searched (both files, case-insensitive) for *icon, iconography, pictogram, glyph, emoji, stroke, outline, line weight, symbol, corner radius, grid, monoline, pixel, geometric* — the only hit is the p4 lockup sentence above. It documents no icon style (outline vs filled), no stroke weight, no grid size, no corner radius, no icon colour role and no emoji policy; its text layer makes no statement about the mark's construction (pp.1–3 are vector artwork with running headers only). **The 2 px outline family is therefore a DERIVED choice**, justified by:

- the repo's existing iconography — the cockpit and context panels already use the outline icon font *Material Symbols Outlined* at weight 400 / grade 0 / fill 0 (`index.html` `icon_names=…`, `src/materialSymbolsSubset.test.mjs`), i.e. a thin, unfilled, geometric style (DOCUMENTED in this repo);
- the prior brand icon exports (satellite, plane, navigation, send, ship, globe, layers, map, compass, flag, wind, battery, factory, mountain, `brand-icons.html`) described in the task brief as Lucide-style 2 px outline icons — REPORTED, those files were not in this run's media and were not re-verified;
- `docs/brand/BRAND_SOURCE.md` §3, which assigns the "icons" role to `--od-neutral-400` and the accent role to `--od-green-500` (DERIVED there, reused here unchanged).

Nothing in this document should be read as the guideline endorsing Lucide; it is silent, and the choice is the repo's.

## 3. Inventory method and result

Ranges scanned (code points, HTML numeric entities `&#x…;`/`&#…;`, and JS escapes `\u{…}` / surrogate pairs / `\uXXXX`): U+1F300–U+1FAFF and U+1F1E6–U+1F1FF (scanned as U+1F000–U+1FAFF), U+2600–U+27BF, U+2B00–U+2BFF, U+FE0F, U+200D, plus the glyph blocks this UI drew icons with — Geometric Shapes U+25A0–U+25FF (▲ ▼ ● ○ ■ □ ◆ ◇ ► ◄ ◉ ◎ ◐ ◭ ◯ ▦ ▣ ▰ ▶ ◀), Miscellaneous Technical U+2300–U+23FF (⌖), Roman numerals U+2160–U+216F (Ⅱ as a pause mark), U+224B (≋), the arrows used as button glyphs (↗ ↺ ↔ ➜), the typographic chevrons ‹ › (U+2039/U+203A) used as button content, the close-button × (U+00D7) and the collapse-button + / − (U+002B / U+2212). Files: every `src/**/*.{js,mjs,html,css}` that is not a test, `index.html`, `style.css`, `public/*.html`. Scan of the pre-change tree (`18e2a68`): 04:08:13Z (first pass, emoji ranges + named glyph set), 04:17Z–04:30Z (widened pass).

**Result: 137 rendered emoji / glyph icon sites** (a variation selector U+FE0F is counted with the emoji it modifies; an HTML entity counts as one site), across 46 files; plus 8 comment-only occurrences (§3.2) cleaned so the boundary test can be strict. The full table is §3.1. After the change the same scan over the same files reports **0** occurrences in the forbidden blocks; the only remaining non-ASCII characters in those files are punctuation and prose (→ · — … ×-as-multiplier ≈ ∓ ↔ in comments, and the `▍` typing caret in `ondemand-chat.css` / `voice-ondemand.css`, which is a text cursor, not an icon — §5).

### 3.1 Full inventory (pre-change line numbers at `18e2a68`; `file:line → component → label → replacement`)

| # | file:line (at 18e2a68) | glyph | code point | component | label / role | replaced by |
|---|---|---|---|---|---|---|
| 1 | `src/app/constructCatalog.js:137` | ▲ | U+25B2 | DATA LAYERS › Events | FIRMS Active Fires row icon | flame |
| 2 | `src/app/layers/firms.js:22` | ▲ | U+25B2 | DATA LAYERS › Events | fires layer default icon | flame |
| 3 | `src/data/bhoteKoshiEmbeddedMedia.js:995` | ↗ | U+2197 | Bhote Koshi embedded media card | OPEN ORIGINAL link | external-link |
| 4 | `src/data/bhoteKoshiEvent.js:824` | × | U+00D7 | Bhote Koshi event panel | close event layer | x |
| 5 | `src/data/bhoteKoshiEvent.js:848` | ‹ | U+2039 | Bhote Koshi event panel | previous story beat | chevron-left |
| 6 | `src/data/bhoteKoshiEvent.js:854` | › | U+203A | Bhote Koshi event panel | next story beat | chevron-right |
| 7 | `src/data/bhoteKoshiEvent.js:857` | ▶ | U+25B6 | Bhote Koshi event panel | PLAY | play |
| 8 | `src/data/bhoteKoshiEvent.js:858` | ▶ | U+25B6 | Bhote Koshi event panel | PLAY SCENE | play |
| 9 | `src/data/bhoteKoshiEvent.js:859` | ◉ | U+25C9 | Bhote Koshi event panel | CINEMATIC | circle-dot |
| 10 | `src/data/bhoteKoshiEvent.js:860` | ↺ | U+21BA | Bhote Koshi event panel | FULL STORY | rotate-ccw |
| 11 | `src/data/bhoteKoshiEvent.js:861` | ↗ | U+2197 | Bhote Koshi event panel | OPEN ORIGINAL | external-link |
| 12 | `src/data/bhoteKoshiEvent.js:862` | ⌖ | U+2316 | Bhote Koshi event panel | LOWER GORGE corridor | crosshair |
| 13 | `src/data/bhoteKoshiEvent.js:871` | ↗ | U+2197 | Bhote Koshi event panel | OPEN PUBLIC MAP | external-link |
| 14 | `src/data/bhoteKoshiEvent.js:2581` | ↔ | U+2194 | Bhote Koshi imagery split | divider handle | move-horizontal |
| 15 | `src/data/bhoteKoshiEvent.js:2661` | ■ | U+25A0 | Bhote Koshi event panel | RELEASE CAMERA / CINEMATIC toggle | square / circle-dot |
| 16 | `src/data/bhoteKoshiEvent.js:2661` | ◉ | U+25C9 | Bhote Koshi event panel | RELEASE CAMERA / CINEMATIC toggle | square / circle-dot |
| 17 | `src/data/bhoteKoshiEvent.js:3047` | ▶ | U+25B6 | Bhote Koshi event panel | PLAY SHOT | play |
| 18 | `src/data/bhoteKoshiEvent.js:3049` | Ⅱ | U+2161 | Bhote Koshi event panel | PAUSE | pause |
| 19 | `src/data/bhoteKoshiEvent.js:3052` | ↺ | U+21BA | Bhote Koshi event panel | REPLAY CINEMATIC | rotate-ccw |
| 20 | `src/data/bhoteKoshiEvent.js:3053` | ↺ | U+21BA | Bhote Koshi event panel | REPLAY | rotate-ccw |
| 21 | `src/data/bhoteKoshiEvent.js:3054` | ▶ | U+25B6 | Bhote Koshi event panel | PLAY | play |
| 22 | `src/data/bhoteKoshiEvent.js:3061` | ▶ | U+25B6 | Bhote Koshi event panel | PLAY SCENE | play |
| 23 | `src/data/bhoteKoshiEvent.js:3082` | ↺ | U+21BA | Bhote Koshi event panel | FULL STORY | rotate-ccw |
| 24 | `src/data/bhoteKoshiEvent.js:3804` | 🌊 | U+1F30A | Events layer catalog | Bhote Koshi event layer icon | waves |
| 25 | `src/data/bhoteKoshiLocator.js:1093` | ◎ | U+25CE | Events layer catalog | Bhote Koshi locator layer icon | locate |
| 26 | `src/data/infrastructure.js:23` | ▣ | U+25A3 | DATA LAYERS › Infrastructure | Data Centers row icon | server |
| 27 | `src/data/infrastructure.js:38` | ▰ | U+25B0 | DATA LAYERS › Infrastructure | Dams row icon | dam |
| 28 | `src/data/localGeojsonCore.js:323` | 📍 | U+1F4CD | Local GeoJSON layers | default row icon | map-pin |
| 29 | `src/data/localLayers.js:14` | ▲ | U+25B2 | DATA LAYERS › Events | FIRMS Active Fires row icon (standalone catalog) | flame |
| 30 | `src/data/transitFeeds.js:41` | 🚌 | U+1F68C | Transit selection card / labels | bus mode glyph | bus (name only; card title is text) |
| 31 | `src/data/transitFeeds.js:42` | 🚊 | U+1F68A | Transit selection card / labels | tram mode glyph | tram-front (name only) |
| 32 | `src/data/transitFeeds.js:43` | 🚇 | U+1F687 | Transit selection card / labels | subway mode glyph | train-front (name only) |
| 33 | `src/data/transitFeeds.js:44` | 🚆 | U+1F686 | Transit selection card / labels | rail mode glyph | train-front (name only) |
| 34 | `src/data/transitFeeds.js:45` | ⛴️ | U+26F4 U+FE0F | Transit selection card / labels | ferry mode glyph | ship (name only) |
| 35 | `src/data/transitFeeds.js:46` | 🚏 | U+1F68F | Transit selection card / labels | unknown mode glyph | signpost (name only) |
| 36 | `src/hud.js:202` | ● | U+25CF | HUD (top-right) | REC blinking dot | circle (od-icon--solid, label "Recording") |
| 37 | `src/keySetup.js:62` | 🔴 | U+1F534 | Key setup panel | tier dot metered (red) / free (amber) | circle + data-tier colour |
| 38 | `src/keySetup.js:62` | 🟡 | U+1F7E1 | Key setup panel | tier dot metered (red) / free (amber) | circle + data-tier colour |
| 39 | `src/keySetup.js:111` | ↗ | U+2197 | Key setup panel | GET KEY / MANAGE external link | external-link |
| 40 | `src/keySetup.js:111` | ↗ | U+2197 | Key setup panel | GET KEY / MANAGE external link | external-link |
| 41 | `src/layers/alpr/index.js:237` | 📷 | U+1F4F7 | DATA LAYERS › Cameras | Mapped ALPR Cameras row icon | camera |
| 42 | `src/layers/awareness/controls.js:13` | ◎ | U+25CE | Global Context layer | row icon | globe |
| 43 | `src/layers/awareness/rendering.js:52` | ➜ | U+279C | Global Context off-screen markers | direction arrow (rotated) | arrow-right |
| 44 | `src/layers/bikeshare/controls.js:9` | 🚲 | U+1F6B2 | DATA LAYERS › Movement | Bike Share row icon | bike |
| 45 | `src/layers/bikeshare/queries.js:19` | 🚲 | U+1F6B2 | HUD detection label (Cesium label) | bike-share dock label | text "BIKES …" (label) |
| 46 | `src/layers/bikeshare/selection.js:36` | 🚲 | U+1F6B2 | Bike-share selection card | availability line | text "BIKES …" |
| 47 | `src/layers/bikeshare/selection.js:41` | ⚠️ | U+26A0 U+FE0F | Bike-share selection card | Not installed warning | text "WARNING Not installed" |
| 48 | `src/layers/bikeshare/selection.js:42` | ⚠️ | U+26A0 U+FE0F | Bike-share selection card | Not renting warning | text "WARNING Not renting" |
| 49 | `src/layers/bikeshare/selection.js:43` | ⚠️ | U+26A0 U+FE0F | Bike-share selection card | Not returning warning | text "WARNING Not returning" |
| 50 | `src/layers/cctv/controls.js:18` | 📹 | U+1F4F9 | DATA LAYERS › Cameras | Cameras row icon | cctv |
| 51 | `src/layers/directions/index.js:34` | 🚗 | U+1F697 | Directions row chips | DRIVE mode icon name | car |
| 52 | `src/layers/directions/index.js:35` | 🚶 | U+1F6B6 | Directions row chips | WALK mode icon name | footprints |
| 53 | `src/layers/directions/index.js:36` | 🚲 | U+1F6B2 | Directions row chips | BIKE mode icon name | bike |
| 54 | `src/layers/directions/index.js:118` | ✓ | U+2713 | Directions row chips | SET A confirmed chip | text "A SET" |
| 55 | `src/layers/directions/index.js:129` | ✓ | U+2713 | Directions row chips | SET B confirmed chip | text "B SET" |
| 56 | `src/layers/directions/index.js:1251` | 🧭 | U+1F9ED | DATA LAYERS › Utilities | Directions row icon | compass |
| 57 | `src/layers/earthquakes/index.js:30` | 🌋 | U+1F30B | DATA LAYERS › Events | Earthquakes row icon | activity |
| 58 | `src/layers/firms/model.js:383` | ▲ | U+25B2 | World overlay (canvas) | ambient fire card title | text "FIRE <frp> MW" (canvas) |
| 59 | `src/layers/flights/queries.js:267` | ✈️ | U+2708 U+FE0F | DATA LAYERS › Movement | Live Flights row icon | plane |
| 60 | `src/layers/installations/controls.js:11` | ⌖ | U+2316 | DATA LAYERS › Infrastructure | Military Installations row icon | radar |
| 61 | `src/layers/launches/controls.js:7` | 🚀 | U+1F680 | DATA LAYERS › Events | Rocket Launches row icon | rocket |
| 62 | `src/layers/launches/panel.js:311` | › | U+203A | Space mission roster | row chevron | chevron-right |
| 63 | `src/layers/launches/panel.js:455` | ‹ | U+2039 | Selected space mission panel | PREV / NEXT mission chevrons | chevron-left / chevron-right |
| 64 | `src/layers/launches/panel.js:455` | › | U+203A | Selected space mission panel | PREV / NEXT mission chevrons | chevron-left / chevron-right |
| 65 | `src/layers/launches/panel.js:455` | × | U+00D7 | Selected space mission panel | Deselect mission close | x |
| 66 | `src/layers/launches/panel.js:461` | Ⅱ | U+2161 | Mission replay transport | pause toggle | pause |
| 67 | `src/layers/launches/panel.js:462` | × | U+00D7 | Mission replay transport | Cancel replay | x |
| 68 | `src/layers/launches/replay.js:218` | ▶ | U+25B6 | Mission replay transport | play / pause toggle | play / pause |
| 69 | `src/layers/launches/replay.js:218` | Ⅱ | U+2161 | Mission replay transport | play / pause toggle | play / pause |
| 70 | `src/layers/military/queries.js:201` | 🎖️ | U+1F396 U+FE0F | DATA LAYERS › Movement | Military Flights row icon | shield |
| 71 | `src/layers/radio/controls.js:7` | ◉ | U+25C9 | DATA LAYERS › Utilities | Radio row icon | radio |
| 72 | `src/layers/satellites/controls.js:95` | 🛰️ | U+1F6F0 U+FE0F | DATA LAYERS › Movement | Satellites row icon | satellite |
| 73 | `src/layers/satellites/controls.js:508` | ✕ | U+2715 | DATA LAYERS › Movement › Satellites | DENSE chip failed state | text "DENSE FAILED" |
| 74 | `src/layers/submarineCables/lifecycle.js:10` | ≋ | U+224B | DATA LAYERS › Infrastructure | Submarine Cables row icon | cable |
| 75 | `src/layers/traffic/controls.js:15` | 🚗 | U+1F697 | DATA LAYERS › Movement | Street Traffic row icon | car |
| 76 | `src/layers/transit/lifecycle.js:120` | 🚌 | U+1F68C | DATA LAYERS › Movement | Transit row icon | bus |
| 77 | `src/layers/vessels/queries.js:254` | ◭ | U+25ED | DATA LAYERS › Movement | Live Vessels row icon | ship |
| 78 | `src/locationStatus.js:13` | 📍 | U+1F4CD | LOCATION tray mini-status | "Location: --" pin | map-pin (rendered by locationControls.js) |
| 79 | `src/locationStatus.js:46` | 📍 | U+1F4CD | LOCATION tray mini-status | preset city pin | map-pin |
| 80 | `src/locationStatus.js:54` | 📍 | U+1F4CD | LOCATION tray mini-status | searched place pin | map-pin |
| 81 | `src/ondemand/entityChat.js:511` | × | U+00D7 | ASK ONDEMAND overlay | close button | x |
| 82 | `src/overlays/worldOverlayAllocation.worker.mjs:464` | ▲ | U+25B2 | World overlay (canvas) allocation probe | synthetic fire card title | text "FIRE <n> MW" (canvas) |
| 83 | `src/overlays/worldOverlayAllocation.worker.mjs:554` | ▲ | U+25B2 | World overlay (canvas) allocation probe | synthetic fire card title | text "FIRE <n> MW" (canvas) |
| 84 | `src/ui/panelChrome.js:293` | ◀ | U+25C0 | Right-rail panel collapse buttons | collapsed / expanded | chevron-left / chevron-right |
| 85 | `src/ui/panelChrome.js:293` | ▶ | U+25B6 | Right-rail panel collapse buttons | collapsed / expanded | chevron-left / chevron-right |
| 86 | `src/ui/panelChrome.js:295` | + / − | U+002B / U+2212 | Left/other panel collapse buttons | expand / collapse | plus / minus |
| 87 | `src/ui/radioBindings.js:51` | ▶ | U+25B6 | Cockpit utility tray | display options toggle | chevron-right / chevron-left |
| 88 | `src/ui/radioBindings.js:51` | ◀ | U+25C0 | Cockpit utility tray | display options toggle | chevron-right / chevron-left |
| 89 | `src/ui/radioBindings.js:60` | ▶ | U+25B6 | Cockpit utility tray | radio controls toggle | chevron-right / chevron-left |
| 90 | `src/ui/radioBindings.js:60` | ◀ | U+25C0 | Cockpit utility tray | radio controls toggle | chevron-right / chevron-left |
| 91 | `src/ui/radioPresentation.js:130` | ● | U+25CF | Radio category <select> | option swatch bullet | text only (<option> cannot hold markup; colour stays) |
| 92 | `src/ui/radioPresentation.js:243` | Ⅱ | U+2161 | Context radio mini controls | play / pause | pause / play |
| 93 | `src/ui/radioPresentation.js:243` | ▶ | U+25B6 | Context radio mini controls | play / pause | pause / play |
| 94 | `src/ui/radioPresentation.js:258` | Ⅱ | U+2161 | Cockpit radio controls | play / pause | pause / play |
| 95 | `src/ui/radioPresentation.js:258` | ▶ | U+25B6 | Cockpit radio controls | play / pause | pause / play |
| 96 | `src/ui/styles/command-dock-compact.css:92` | › | U+203A | Command dock tray titles (CSS ::after) | expand chevron | chevron-right.svg as currentColor mask |
| 97 | `src/ui/styles/command-dock-compact.css:99` | ‹ | U+2039 | Command dock VISUAL PRESETS title (CSS ::after) | expand chevron | chevron-left.svg as currentColor mask |
| 98 | `src/ui/templates/cockpit.html:241` | ◀ | U+25C0 | Cockpit utility tray | display options toggle (initial) | chevron-left |
| 99 | `src/ui/templates/cockpit.html:254` | ◀ | U+25C0 | Cockpit utility tray | radio controls toggle (initial) | chevron-left |
| 100 | `src/ui/templates/cockpit.html:260` | ◀ | U+25C0 | Cockpit radio controls | previous station | skip-back |
| 101 | `src/ui/templates/cockpit.html:260` | ◀ | U+25C0 | Cockpit radio controls | previous station | skip-back |
| 102 | `src/ui/templates/cockpit.html:261` | ▶ | U+25B6 | Cockpit radio controls | play | play |
| 103 | `src/ui/templates/cockpit.html:262` | ▶ | U+25B6 | Cockpit radio controls | next station | skip-forward |
| 104 | `src/ui/templates/cockpit.html:262` | ▶ | U+25B6 | Cockpit radio controls | next station | skip-forward |
| 105 | `src/ui/templates/command-dock.html:17` | ◯ | U+25EF | VISUAL PRESETS | Normal | circle |
| 106 | `src/ui/templates/command-dock.html:22` | ▦ | U+25A6 | VISUAL PRESETS | CRT | tv |
| 107 | `src/ui/templates/command-dock.html:27` | 🌙 | U+1F319 | VISUAL PRESETS | NVG | moon |
| 108 | `src/ui/templates/command-dock.html:32` | 🌡️ | U+1F321 U+FE0F | VISUAL PRESETS | FLIR | thermometer |
| 109 | `src/ui/templates/command-dock.html:37` | ✦ | U+2726 | VISUAL PRESETS | Anime | sparkles |
| 110 | `src/ui/templates/command-dock.html:42` | ◐ | U+25D0 | VISUAL PRESETS | Noir | contrast |
| 111 | `src/ui/templates/command-dock.html:47` | ❄ | U+2744 | VISUAL PRESETS | Snow | snowflake |
| 112 | `src/ui/templates/command-dock.html:75` | + | U+002B | LOCATION tray | collapse button (initial) | plus |
| 113 | `src/ui/templates/command-dock.html:78` | 📍 | U+1F4CD | LOCATION tray mini-status | Location: -- pin (initial markup) | map-pin |
| 114 | `src/ui/templates/command-dock.html:89` | &#x1F50E; | HTML entity | LOCATION tray | search toggle | search |
| 115 | `src/ui/templates/context.html:28` | ◀ | U+25C0 | Context radio mini controls | previous station | skip-back |
| 116 | `src/ui/templates/context.html:28` | ◀ | U+25C0 | Context radio mini controls | previous station | skip-back |
| 117 | `src/ui/templates/context.html:29` | ▶ | U+25B6 | Context radio mini controls | play | play |
| 118 | `src/ui/templates/context.html:30` | ▶ | U+25B6 | Context radio mini controls | next station | skip-forward |
| 119 | `src/ui/templates/context.html:30` | ▶ | U+25B6 | Context radio mini controls | next station | skip-forward |
| 120 | `src/ui/templates/context.html:39` | ▶ | U+25B6 | Global context panel | expand (collapse button) | chevron-right |
| 121 | `src/ui/templates/context.html:62` | 🛸 | U+1F6F8 | Global context actions | Reclassify as TR-3B | triangle |
| 122 | `src/ui/templates/context.html:97` | + | U+002B | Radio section | expand button (initial) | plus |
| 123 | `src/ui/templates/display-controls.html:6` | &#x25C0; | HTML entity | DISPLAY panel | collapse button | chevron-left |
| 124 | `src/ui/templates/display-controls.html:10` | &#x25CE; | HTML entity | DISPLAY panel | HUD toggle | scan-eye |
| 125 | `src/ui/templates/display-controls.html:24` | &#x25A3; | HTML entity | DISPLAY panel | DETECT toggle | scan |
| 126 | `src/ui/templates/display-controls.html:55` | − | U+2212 | Parameter slider panel | collapse button (initial) | minus |
| 127 | `src/ui/templates/display-controls.html:65` | &#x2708; | HTML entity | DISPLAY panel | 3D aircraft toggle | plane |
| 128 | `src/ui/templates/display-controls.html:125` | &#x25A1; | HTML entity | DISPLAY panel | Clean UI toggle | square |
| 129 | `src/ui/templates/display-controls.html:130` | &#x2728; | HTML entity | DISPLAY panel | Bloom toggle | sun |
| 130 | `src/ui/templates/display-controls.html:140` | &#x1F50D; | HTML entity | DISPLAY panel | Sharpen toggle | focus |
| 131 | `src/ui/templates/layer-panels.html:9` | + | U+002B | DATA LAYERS panel | collapse button (initial) | plus |
| 132 | `src/ui/templates/layer-panels.html:22` | + | U+002B | CAMERAS panel | collapse button (initial) | plus |
| 133 | `src/ui/templates/layer-panels.html:78` | + | U+002B | SCENES panel | collapse button (initial) | plus |
| 134 | `src/ui/templates/scene-chrome.html:30` | &#x1F517; | HTML entity | Globe actions | Copy share link | link |
| 135 | `src/voice/ondemand/ui.js:190` | › | U+203A | OD VOICE readout | transcript speaker mark | chevron-right |
| 136 | `src/voice/ondemand/ui.js:195` | ‹ | U+2039 | OD VOICE readout | answer speaker mark | chevron-left |
| 137 | `src/voice/ondemand/ui.js:206` | ✗ | U+2717 | OD VOICE workflow telemetry | failed intent mark | text "(failed)" |

### 3.2 Comment-only occurrences (not rendered; cleaned for hygiene)

| file:line | glyph | treatment |
|---|---|---|
| `src/keySetupCore.mjs:26` | 🔴 🟡 | doc comment → "red dot" / "amber dot" |
| `src/voice/voiceCost.js:25` | ⚠️ ×2 | doc comment → "WARNING —" |
| `src/layers/satellites/controls.js:427` | ✕ | comment → "DENSE FAILED" |
| `src/layers/firms/model.js:358` | ▲ | doc comment → "FIRE 47 MW" |
| `src/app/tools.js:52` | ▸ | comment breadcrumb → ">" |
| `src/annotations/drawTool.js:4` | ▸ | doc comment breadcrumb → ">" |
| `src/ui/styles/controls.css:825` | ▸ | CSS comment breadcrumb → ">" |
| `src/ui/styles/ondemand-chat.css:6` | ▸ | CSS comment breadcrumb → ">" |

## 4. Rendering contract (`src/ui/icons/layerIcon.js`, `src/ui/styles/icons.css`)

| Concern | Contract |
|---|---|
| Registry | `src/ui/icons/lucide-manifest.json` (names + what each replaces) → `scripts/sync-lucide-icons.mjs` → `public/icons/<name>.svg` + `src/ui/icons/lucideIcons.generated.js` (inner markup per icon; works in the browser and under `node --test` without a bundler). |
| API | `iconMarkup(name, {label, className, size})` for templates / `innerHTML`; `createIcon(name, options, document)` for a live `<svg>`; `setIconContent(element, name, {text, label})` to replace a glyph (optionally followed by visible text: "PLAY", "PAUSE"); `appendIcon(element, name)` to add a trailing external-link mark. Unknown names render `layers` and warn once — never a glyph. |
| Layer rows | `layer.icon` is now a Lucide name (`'satellite'`, `'plane'`, `'shield'`, `'ship'`, `'car'`, …); `LayerPanel` renders it as an inline `<svg data-icon=…>` inside `.data-icon` and mirrors the toggle's feed state onto the row (`data-feed-state`). |
| Size / stroke | 1 em of the host (`.od-icon { width: 1em; height: 1em }`); DATA LAYERS rows pin 18 px; presets 20 px (16 px in the compact dock); DISPLAY toggles 14 px; collapse buttons 14 px; stroke 2 px round (2.5 px for the rotated direction arrow). |
| Colour | `currentColor`. DATA LAYERS: live/nominal `--od-green-500` #3BB795 · loading `--od-green-200` · stale / partial / fallback `#ffd27a` · degraded `#ffad72` · unavailable `#ff8585` (the same three status colours the toggle chip already uses) · off / enabling / disabling / uncertain `--od-neutral-400` #999999. HUD REC: solid (`od-icon--solid`) red with a drop-shadow glow. Key-setup tier dots: red (metered) / amber (free) via `data-tier`. |
| Accessibility | Icon beside a visible label, or inside a control that already has `aria-label` → `aria-hidden="true" focusable="false"`, no `<title>` (the label is read once). Standalone icon (HUD REC dot, key tier dot) → `role="img"`, `aria-label`, `<title>`. Icon-only buttons that had no accessible name (search toggle, collapse buttons in templates) received `aria-label`s. |
| Non-DOM surfaces | Canvas-drawn overlay card titles and Cesium label strings cannot hold SVG; their glyph prefixes became words: fire cards "FIRE 47 MW", transit cards "Route 17" (the mode is already said in words on the next line), bike-share "BIKES …" / "WARNING Not renting", the satellites DENSE chip "DENSE FAILED", directions "A SET" / "B SET", OD VOICE "(failed)". A `<select>` option cannot hold markup: the radio category bullet was dropped (the option keeps its colour). |
| CSS pseudo-elements | The command-dock tray chevrons (`::after`) use `public/icons/chevron-right.svg` / `chevron-left.svg` as a `currentColor` mask instead of `content: '›'`. |

## 5. Retained characters that are not icons (by decision)

| Character | Where | Why kept |
|---|---|---|
| `▍` U+258D | `src/ui/styles/ondemand-chat.css`, `src/ui/styles/voice-ondemand.css` (`content:`) | A blinking typing caret — a text cursor, not an icon; Block Elements are outside the audited ranges. |
| `×` U+00D7 | "1×" replay speed, "×3" payload counts | Multiplication sign in numeric text. Close-button `×` glyphs were replaced (§3.1). |
| `→ ↔ ⇒ ∓ ≈ ≤ ≥ −` | Code comments and log strings | Prose punctuation; none is rendered as an icon. |
| `— · …` | UI copy separators ("UNAVAILABLE · CelesTrak", "—" for no count) | Typography, not iconography. |
| Material Symbols Outlined ligatures (`radar`, `flight`, `chevron_left`, …) | Cockpit / context panels, `index.html` font subset | An existing outline icon *font*, not an emoji or text glyph; out of this change's scope. Migrating those 34 glyph names to the same Lucide set is the natural follow-up and would remove the Google Fonts request. |

## 6. Guard

`scripts/check-icon-glyphs.mjs` runs inside `npm run check:boundaries` (third check, after the import-direction and package-boundary checks) and fails the gate on any emoji / glyph code point, entity or JS escape in UI source; `src/iconGlyphBoundary.test.mjs` (8 tests, discovered by `npm test`, reusing that scanner — the repo keeps unit tests beside the code under `src/`, so the file lives there rather than in a `test/boundaries/` tree) fails when: a UI source file (`src/**`, `index.html`, `style.css`, `public/*.html`, tests excluded) contains a code point, entity or JS escape in the forbidden blocks; the assembled application markup (`index.html` + templates) contains one, or lacks the expected inline icons; an `icon:` declared in source is not a registered Lucide name; the manifest, the generated registry, `public/icons/*.svg` (57 files, normalised root attributes) and the exact `package.json` pin disagree; or the rendered DATA LAYERS panel (mounted headlessly with the seven MOVEMENT layers in live / stale / degraded / unavailable states) has a row without an inline `<svg>`, a text node with a glyph, or a legacy emoji value that renders anything but the fallback icon. A further test walks every mapped icon name and asserts `iconMarkup()` / `createIcon()` produce an `<svg>` on `stroke="currentColor"` / `fill="none"` / `stroke-width="2"` / `viewBox="0 0 24 24"` with `role="img"`, `aria-label` and a `<title>` in the standalone form, and `aria-hidden="true"` without a `<title>` in the decorative form.

## 7. Ledger (UTC)

| When | Action |
|---|---|
| 2026-09-19T04:06:56Z | Workspace inspected; repo on disk at `ondemand-serverless` tip `18e2a68` (three commits ahead of the brief's `7a24c7a`) |
| 04:08:13Z | Inventory pass 1 (emoji ranges + named glyph set) — 2,089 raw hits repo-wide, 85 non-arrow hits in UI source |
| 04:13:43Z | `npm view lucide-static` — 1.47.0 (ISC) |
| 04:13:54Z–04:13:55Z | Brand PDFs retrieved and hashed (sub-agent) |
| 04:14:14Z–04:14:16Z | `lucide-static@1.47.0` installed exact, lock updated (+8 lines) |
| 04:21:33Z / 04:21:55Z / 04:34:49Z / 2026-09-19T04:40:19Z | `scripts/sync-lucide-icons.mjs` runs (56 → 57 icons after `arrow-right` was added) |
| 04:24:10Z–04:35:01Z | Replacements in 61 source/template/CSS files; 12 tests updated; boundary test written (7 tests) |
| 04:35:43Z–04:38:57Z | Gates: format ✓ (966 files) · boundaries ✓ (109 groups) · unit 4,358 pass / 0 fail / 1 skip ✓ · ondemand 219 ✓ · serverless 58 ✓ · build ✓ · 9 serverless functions ✓ |
