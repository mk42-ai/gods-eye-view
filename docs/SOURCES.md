# Scene evidence sources — what is actually accessible (2026-10-24)

Scope: the BUILD SCENE evidence pipeline (`server/scene-evidence/*`, UI `src/sceneEvidence/*`).
Every row below was checked against the provider's **current official documentation** (fetched
2026-10-24 ~06:28 UTC) **and** a live probe from the agent container or the OnDemand platform.
Nothing in this table is assumed; where a source needs credentials we do not hold, the pipeline
reports `credentials required` in the SOURCE STATUS panel and returns **no** data for it.

## 1. Summary table

| Source | Status today | What we use it for | Needs | Evidence (live probe) |
|---|---|---|---|---|
| OnDemand AI Search (Tavily) `plugin-1740745780`, `site:youtube.com` | **WORKING** | YouTube video discovery (text query) | server `ONDEMAND_API_KEY` (present) | 10 youtube.com URLs, 5.3 s via the Cerebras endpoint / 17.2 s via gpt-6-luna |
| same, `site:tiktok.com` | **WORKING** | TikTok discovery | same | 10 tiktok.com/@…/video/… URLs, 5.0 s (Cerebras) / 16.3 s (luna) |
| same, `site:instagram.com` | **WORKING (partial)** | Instagram reels/posts discovery | same | 10 hits incl. reels + profile pages (profiles are dropped — not posts), 6.9 s |
| same, `site:x.com` | **WORKING (partial)** | X post discovery | same | 10 hits in the pipeline run; mostly older posts |
| OnDemand X Search Agent `plugin-1751872652` | **UNAVAILABLE** | real-time X search | plugin owner's X credits | plugin answered: *"the team has used all available credits or reached its monthly spending limit"* / `permission-denied` |
| OnDemand Twitter User Info & Tweets `plugin-1716326559` | **UNAVAILABLE** | — | plugin subscription | *"Twitter search is unavailable because the API subscription is not active."* (not wired) |
| OnDemand TikTok scraper `plugin-1716372717` | **UNAVAILABLE** | — | RapidAPI quota | monthly quota exhausted (cycle 11–12 log); kept out of the new pipeline |
| YouTube oEmbed `https://www.youtube.com/oembed` | **WORKING** (no key) | embed verification, title, channel name/URL | none | HTTP 200 in 0.07 s |
| TikTok oEmbed `https://www.tiktok.com/oembed` | **WORKING** (no key) | embed verification, title, author name/URL | none | HTTP 200 in 0.09 s |
| X oEmbed `https://publish.x.com/oembed` | **WORKING** (no key) | embed verification, post text, author name/URL | none | HTTP 200 in 0.14 s (`publish.twitter.com` now 301 → publish.x.com) |
| Instagram oEmbed `graph.facebook.com/v21.0/instagram_oembed` | **WORKING without token today (undocumented)** | embed verification only | officially: Meta app + **oEmbed Read** feature + App/Client token (`META_OEMBED_ACCESS_TOKEN`) | HTTP 200 with no token on 2026-10-24; returns no `author_name`/`thumbnail` without a token. We do **not** rely on it: embeds use the public `/{p|reel}/{code}/embed/` URL. |
| Official embeds (YouTube nocookie iframe, TikTok player v1, Instagram `/embed/`, X `platform.twitter.com/embed/Tweet.html`) | **WORKING** | playback in the player | none | loaded in headless Chromium (see TEST_RESULTS §19) |
| YouTube Data API v3 `search.list` (`location`, `locationRadius`, `publishedAfter`) | **CREDENTIALS REQUIRED** | geo-radius + time-window video search, `recordingDetails` geotags (→ EXACT), channel profile | `YOUTUBE_API_KEY` | adapter implemented; not configured in this deployment |
| X API v2 recent search (`point_radius`, `bounding_box`, `place:`, `has:geo`) | **CREDENTIALS REQUIRED** | geotagged / place-tagged posts, public user fields | `X_BEARER_TOKEN` (pay-per-use credits) | adapter implemented; not configured |
| Instagram Graph API (hashtag search / Business Discovery) | **CREDENTIALS REQUIRED** | hashtag recent media (no location search exists) | `IG_GRAPH_ACCESS_TOKEN` + `IG_BUSINESS_USER_ID` + App Review | adapter implemented; not configured |
| TikTok Research API | **CREDENTIALS REQUIRED (eligibility-gated)** | region/keyword video query | `TIKTOK_RESEARCH_CLIENT_KEY` + `_SECRET` (approved researchers only) | adapter implemented; not configured |
| Google News RSS (`news.google.com/rss/search`, `when:Nd`) | **WORKING** (no key) | public news signals naming the place | none | 10–12 items in 0.35–0.55 s |
| Official channels (Dubai Police, RTA, Dubai Media Office, WAM, Abu Dhabi Police) | **PARTIAL** | official statements as reported via the news index | none for the index; native channels need X/YouTube keys | 5–8 items in 0.33 s; YouTube channel RSS feeds return **404** today; `wam.ae/en/rss` returns an HTML app shell, not RSS |
| GDELT DOC 2.0 | **PARTIAL (slow / rate-limited)** | global news article list | none | first call 200 in 17 s; then **429 "one request every 5 seconds"**; frequently exceeds the 10 s budget → shown as `timed out` |
| ReliefWeb API v2 | **CREDENTIALS REQUIRED** | humanitarian/incident reports | `RELIEFWEB_APPNAME` (approved appname) | HTTP 403 *"You are not using an approved appname"* |
| Cerebras Inference (direct) | **CREDENTIALS REQUIRED** | intent parse + summary (inference only) | `CEREBRAS_API_KEY` | `api.cerebras.ai/v1/models` → 403 *Not authenticated* |
| Cerebras via OnDemand endpoint `predefined-cerebras-qwen-3.8-27b` | **WORKING** | intent parse, summary, and fast plugin answers | existing `ONDEMAND_API_KEY` | intent JSON in 2.5 s; summary in 2.2 s |

## 2. Per-source findings (official docs)

### Instagram (Meta)
- **oEmbed** — `GET graph.facebook.com/{v}/instagram_oembed?url=…`. Supports photo, video, Reel and feed posts of
  **public** accounts; not private/inactive/age-restricted accounts, not accounts with embeds disabled, **not Stories**.
  Rate limit 1,000 requests/hour. Officially requires a Meta app with the *oEmbed Read* feature and an App or Client token.
  **Terms:** "Using metadata and page, post, or video content (or their derivations) from the endpoint for any purpose other
  than providing a front-end view … is strictly prohibited … including … persisting the metadata." → our caches store only
  the permalink/id, the shortcode-derived timestamp and the geo label for Instagram items (`sanitizeForCache`).
- **Graph API (Instagram API with Facebook Login)** — *Business Discovery* returns public data of other **Business/Creator**
  accounts (requires `instagram_basic`, `instagram_manage_insights` or `pages_read_engagement`, a connected Page and App
  Review). *Hashtag Search* (`ig_hashtag_search` → `/recent_media`, last 24 h) requires the **Instagram Public Content
  Access** feature, max **30 unique hashtags per 7 days**.
- **Location search: none.** The Graph API has no location/places search for media. Place-level Instagram coverage is only
  possible by hashtag or by URL discovery through search engines.
- Media download: the existing `Instagram Content Downloader` plugin path is **not used** by the new pipeline (terms).

### X / Twitter
- **Recent search** `GET /2/tweets/search/recent` (7 days) — location operators `place:`, `place_country:`,
  `point_radius:[lon lat radius]` (radius ≤ 40 km), `bounding_box:[w s e n]` (≤ 25 mi per side), `has:geo`;
  query length 512 chars (self-serve) / 4,096 (enterprise). Only a small share of posts carry geo.
- **Pricing (docs, 2026-10-24):** pay-per-use credits, no subscription. *Posts: Read $0.005 per resource*,
  *User: Read $0.010*; cap of 3 M post reads per month on pay-per-use; Enterprise above that.
- **oEmbed** `publish.x.com/oembed` — no auth; returns `author_name`, `author_url`, post HTML.

### TikTok
- **Research API** — only for qualified non-commercial researchers (academic / not-for-profit in US, EEA, UK, CH, Canada,
  Brazil youth-safety); application with ethics review, ~4 weeks. Not available to a commercial workstation.
- **Display API** — returns the authenticated user's **own** profile and videos (Login Kit). It cannot search other
  creators' videos.
- **Embed Videos / oEmbed** `www.tiktok.com/oembed?url=` — public, no auth; "Embed Videos will be deprecated soon … use
  Embed Player" → we play through `https://www.tiktok.com/player/v1/{id}` (Embed Player).
- **Dates:** TikTok video ids embed the upload time (top 32 bits = Unix seconds) — used as `id-derived` dates.

### YouTube
- **Data API v3 `search.list`** — `location` + `locationRadius` (≤ 1000 km; requires `type=video`) restricts to videos
  whose metadata specify a location; `publishedAfter`/`publishedBefore` (RFC 3339); `order=date`. Quota: **100 units per
  call** (default 10,000 units/day → ~100 searches/day). `videos.list part=recordingDetails` gives the geotag.
- **oEmbed** — public, no key. Channel RSS (`/feeds/videos.xml?channel_id=`) returned **404** for every channel probed today.

### Public incident / context feeds
- **GDELT DOC 2.0** — free, no key; `mode=artlist`, `sort=datedesc`, `timespan`; enforced **1 request / 5 s**; latency 10–17 s.
- **ReliefWeb v2** — since 2025 an **approved `appname`** is mandatory (403 otherwise).
- **Google News RSS** — public RSS with `when:Nd`; fast and the most reliable fresh signal; outlet attribution in `<source>`.
- **Dubai Police / RTA / Dubai Media Office / WAM** — no public JSON/RSS that works today (YouTube RSS 404, WAM RSS returns
  HTML). Their posts are reachable through X API / YouTube Data API (credentials) or as reported in the news index
  (what the `official_channels` source does, labelled `OFFICIAL · <outlet>`).

### Cerebras
- Models (docs): `gpt-oss-120b` — $0.35 / M input, $0.75 / M output, ~3,000 tokens/s, free tier 30 RPM;
  `qwen-3.8-27b` — $0.99 / M input, $1.49 / M output, ~1,850 tokens/s, free trial 5 RPM, developer 300 RPM.
  OpenAI-compatible `POST https://api.cerebras.ai/v1/chat/completions` with `Authorization: Bearer $CEREBRAS_API_KEY`.
- **Role here: inference only, never a data source.** Uses: (1) place/intent/time-window parsing, (2) evidence summary,
  (3) as the endpoint that drives the OnDemand search-plugin sessions (it only formats the plugin's tool output — every URL
  still comes from the search tool). Deterministic fallbacks exist for (1) and (2).

## 3. Labels the UI shows (and why)

- **Geo precision** — `EXACT GEOTAG` (platform API returned coordinates: YouTube `recordingDetails`, X `geo.coordinates`),
  `PLACE TAG` (platform returned a named place, not coordinates), `TEXT-INFERRED` (the place name appears in the
  title/caption/snippet; the pin is drawn at the AOI centre, hollow, labelled `~TEXT`), `NO LOCATION`. Approximate pins are
  never drawn as exact. With today's working sources almost everything is `TEXT-INFERRED` — that is the honest result.
- **Freshness** — `LIVE` < 1 h, `RECENT` < 72 h, `STALE` < 30 d, `ARCHIVAL` ≥ 30 d **or undated**. Dates come from the API,
  from the post id (TikTok/X snowflake, Instagram shortcode — labelled "from post id"), or from the search engine
  ("search-reported", lower confidence).
- **Ranking** — geo precision first, then freshness, then recency.

## 4. Limits enforced (UI + code)

- Profiles show only the public fields an official API/oEmbed returned (name, handle, avatar, bio, follower count) plus a
  link to the profile; the popup lists exactly which fields were returned and from where.
- No scraping of private data, no login or rate-limit bypass, no Instagram media download, no identity resolution or
  cross-platform tracking of private individuals; the summary prompt forbids naming private individuals.
- Instagram metadata is not persisted (Meta oEmbed terms); YouTube/TikTok/X metadata is cached ≤ 15 min server-side and
  in the browser's scene cache for saved scenes.
- Provider keys are read server-side only (`process.env`); none are bundled (verified by `check-no-secrets --dist`).

## 5. Credentials needed to turn the `credentials required` rows on

| Env var (server-side only) | Provider / access | How to obtain |
|---|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 | Google Cloud project → enable YouTube Data API v3 → API key (restrict to the API). 10,000 units/day default; geo search = 100 units/call. |
| `X_BEARER_TOKEN` | X API v2 recent search (pay-per-use) | developer.x.com → project/app → Bearer token; buy credits ($0.005 per post read, $0.010 per user read). |
| `IG_GRAPH_ACCESS_TOKEN`, `IG_BUSINESS_USER_ID` | Instagram Graph API (hashtag search / business discovery) | Meta app + Instagram Business account linked to a Facebook Page; App Review for `instagram_basic` + **Instagram Public Content Access**; long-lived user token. |
| `META_OEMBED_ACCESS_TOKEN` | Instagram oEmbed (official) | Meta app with **oEmbed Read** feature; App token `APPID|CLIENTTOKEN`. |
| `TIKTOK_RESEARCH_CLIENT_KEY`, `TIKTOK_RESEARCH_CLIENT_SECRET` | TikTok Research API | Eligible academic / non-profit researchers only; application + ethics review (~4 weeks). |
| `RELIEFWEB_APPNAME` | ReliefWeb API v2 | Request an approved appname at apidoc.reliefweb.int. |
| `CEREBRAS_API_KEY` (optional) | Cerebras Inference direct | cloud.cerebras.ai → API key. Without it the pipeline uses the Cerebras model through the OnDemand endpoint, or the deterministic fallback (`SCENE_EVIDENCE_CEREBRAS=off`). |
| OnDemand X Search Agent credits | plugin-1751872652 | top up the plugin owner's X credits in OnDemand (currently exhausted). |

GENERATED_UTC: 2026-10-24T07:05:00Z


## Cycle 18 correction — 2026-10-24 (current policy)

The original source descriptions above document an earlier implementation. Production scene research now exclusively calls the existing OnDemand server plugin layer; direct YouTube/Meta/TikTok/X/RSS/GDELT HTTP and automatic oEmbed enrichment were removed from this path. Instagram and other search results are **unverified URL candidates**. A model-generated JSON object or permalink, a caption, an upload timestamp, an oEmbed response or a profile place is never recording evidence. No derived post-id timestamp is promoted to a recording time.

Live OnDemand public OpenAPI was retrieved for createchatsession/submitquery/getchatmessage on 2026-10-24: authentication is `apikey`; body uses `pluginIds`; response `data.answer` is model text and does not provide a raw verified plugin execution. This prevents claims that the current connector can attest source metadata. Instagram Graph/oEmbed requires authorized application permissions and tokens; TikTok Display is user-scoped, Research is approval-scoped; YouTube recordingDetails (not search/oEmbed) is needed for recording facts; X created_at is post creation, not video recording. Sources and field absence are reported honestly.

Current implementation: `src/sceneEvidence/qualification.js`, `server/scene-evidence/{sources,pipeline,routes,safety}.js`. Six mediated attempts have 18s individual / 24s total deadlines. Four raw-metadata adapters are explicitly unavailable, not simulated. Optional direct Cerebras inference is not invoked because no app-owned direct key was available or needed; deterministic parsing/admission is the normal fast path. The configured Cerebras-hosted **OnDemand fulfillment endpoint** formats discovery responses only, never certifies facts.

Official references checked/read for this cycle:
- https://docs.on-demand.io/ and live `/config/v1/public/docs/reference/api/submitquery`
- https://developers.google.com/youtube/v3/docs/search/list
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/instagram-oembed
- https://developers.tiktok.com/doc/embed-player
- https://developers.tiktok.com/doc/research-api-specs-query-videos/
- https://docs.x.com/x-api/posts/recent-search
- https://inference-docs.cerebras.ai/api-reference/chat-completions

Raw social-provider success behind the OnDemand answer cannot be independently audited from the documented response. Current live results, transport codes, exact UTC windows, exclusions and blockers are in the root repair report/evidence JSON. Prior archival playback evidence is not a current-footage demonstration.
