# Snapchat direct-plugin live probe

Started 2026-11-02T16:40:08.357Z · finished 2026-11-02T16:42:59.463Z · plugin `plugin-1792945050` · endpoint `predefined-openai-gpt4.1-mini` · transport direct-plugin-query (reused session pool ≤3, ≤3 in flight, 30000 ms per request)

## "Dubai Marina raid" → Dubai Marina

state **ok** · sessions created 3 · direct queries 6 · max in flight 3 · verified 0 · approximate 1 · 60240 ms

| timestamp (UTC) | endpoint | places | HTTP | latency ms | note |
|---|---|---|---|---|---|
| 2026-11-02T16:40:08.363Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:40:08.952Z | POST /chat/v1/sessions/{id}/query | Dubai Marina | 200 | 18771 |  |
| 2026-11-02T16:40:27.149Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:40:27.150Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:40:27.150Z | POST /chat/v1/sessions/{id}/query | Dubai Marina raid | 200 | 18180 | session reused |
| 2026-11-02T16:40:27.543Z | POST /chat/v1/sessions/{id}/query | Dubai Marina Walk | 200 | 14442 |  |
| 2026-11-02T16:40:27.609Z | POST /chat/v1/sessions/{id}/query | Marina Dubai | 200 | 15655 |  |
| 2026-11-02T16:40:41.592Z | POST /chat/v1/sessions/{id}/query | JBR Dubai Marina | 200 | 17412 | session reused |
| 2026-11-02T16:40:42.804Z | POST /chat/v1/sessions/{id}/query | Marina | 200 | 25795 | session reused |

| timestamp (UTC) | places | HTTP | latency ms | upstream status | raw plugin answer excerpt |
|---|---|---|---|---|---|
| 2026-11-02T16:40:27.132Z | ["Dubai Marina"] | 200 | 18180 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"matchType":"clip-text-m |
| 2026-11-02T16:40:41.591Z | ["Dubai Marina Walk"] | 200 | 14048 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:40:42.804Z | ["Marina Dubai"] | 200 | 15195 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:40:45.328Z | ["Dubai Marina raid"] | 200 | 18178 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:40:59.004Z | ["JBR Dubai Marina"] | 200 | 17412 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:41:08.599Z | ["Marina"] | 200 | 25795 | completed | I couldn’t retrieve results for “Marina”: the Snapchat plugin call wasn’t available, so I can’t provide a verified footage result or an empty-results response. |

Result count 1 unique (1 raw) · verified 0 / approximate 1

Raw plugin answer excerpt (last message of the run session):

```
```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"matchType":"clip-text-match","matchedQuery":"Dubai Marina","place":"Dubai Marina","uploaded":1,"videos":[{"commentCount":1,"description":"#dubaimarina","durationMs":16100,"hashtags":["#dubaimarina"],"sha
```

## "boxing gym" → Kane's Boxing Gym Abu Dhabi

state **ok** · sessions created 3 · direct queries 6 · max in flight 3 · verified 0 · approximate 2 · 56139 ms

| timestamp (UTC) | endpoint | places | HTTP | latency ms | note |
|---|---|---|---|---|---|
| 2026-11-02T16:41:08.601Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:41:09.009Z | POST /chat/v1/sessions/{id}/query | Kane's Boxing Gym Abu Dhabi | 200 | 17122 |  |
| 2026-11-02T16:41:25.725Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:41:25.726Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:41:25.727Z | POST /chat/v1/sessions/{id}/query | boxing gym | 200 | 20934 | session reused |
| 2026-11-02T16:41:26.032Z | POST /chat/v1/sessions/{id}/query | Abu Dhabi | 200 | 23512 |  |
| 2026-11-02T16:41:26.244Z | POST /chat/v1/sessions/{id}/query | Al Zahiyah | 200 | 14091 |  |
| 2026-11-02T16:41:39.816Z | POST /chat/v1/sessions/{id}/query | boxing gym Abu Dhabi | 200 | 13923 | session reused |
| 2026-11-02T16:41:46.659Z | POST /chat/v1/sessions/{id}/query | Kanes Boxing Gym Abu Dhabi | 200 | 18078 | session reused |

| timestamp (UTC) | places | HTTP | latency ms | upstream status | raw plugin answer excerpt |
|---|---|---|---|---|---|
| 2026-11-02T16:41:25.723Z | ["Kane's Boxing Gym Abu Dhabi"] | 200 | 16714 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:41:39.816Z | ["Al Zahiyah"] | 200 | 13572 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:41:46.659Z | ["boxing gym"] | 200 | 20932 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:41:49.236Z | ["Abu Dhabi"] | 200 | 23204 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"matchType":"clip-text-m |
| 2026-11-02T16:41:53.739Z | ["boxing gym Abu Dhabi"] | 200 | 13923 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:42:04.737Z | ["Kanes Boxing Gym Abu Dhabi"] | 200 | 18078 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |

Result count 4 unique (4 raw) · verified 0 / approximate 2

Raw plugin answer excerpt (last message of the run session):

```
```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found.","place":"Kane's Boxing Gym Abu Dhabi","uploaded":0,"videos":[]}]} ```
```

## "Yas Mall crash" → Yas Mall

state **ok** · sessions created 3 · direct queries 6 · max in flight 3 · verified 0 · approximate 3 · 54723 ms

| timestamp (UTC) | endpoint | places | HTTP | latency ms | note |
|---|---|---|---|---|---|
| 2026-11-02T16:42:04.741Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:42:05.002Z | POST /chat/v1/sessions/{id}/query | Yas Mall | 200 | 15854 |  |
| 2026-11-02T16:42:20.596Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:42:20.596Z | POST /chat/v1/sessions |  | 201 | - | session created |
| 2026-11-02T16:42:20.596Z | POST /chat/v1/sessions/{id}/query | Yas Mall crash | 200 | 19152 | session reused |
| 2026-11-02T16:42:20.907Z | POST /chat/v1/sessions/{id}/query | Yas Mall Abu Dhabi | 200 | 14731 |  |
| 2026-11-02T16:42:21.126Z | POST /chat/v1/sessions/{id}/query | Yas Island | 200 | 24488 |  |
| 2026-11-02T16:42:35.327Z | POST /chat/v1/sessions/{id}/query | Ya's Mall | 200 | 21963 | session reused |
| 2026-11-02T16:42:39.748Z | POST /chat/v1/sessions/{id}/query | Yas | 200 | 19712 | session reused |

| timestamp (UTC) | places | HTTP | latency ms | upstream status | raw plugin answer excerpt |
|---|---|---|---|---|---|
| 2026-11-02T16:42:20.595Z | ["Yas Mall"] | 200 | 15593 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:42:35.327Z | ["Yas Mall Abu Dhabi"] | 200 | 14420 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:42:39.748Z | ["Yas Mall crash"] | 200 | 19152 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight vid |
| 2026-11-02T16:42:45.084Z | ["Yas Island"] | 200 | 23958 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"matchType":"clip-text-m |
| 2026-11-02T16:42:57.290Z | ["Ya's Mall"] | 200 | 21963 | completed | ```json {"limit":25,"note":"Snapchat plugin call could not be made; no verified footage results are available.","results":[]} ``` |
| 2026-11-02T16:42:59.460Z | ["Yas"] | 200 | 19712 | completed | I couldn’t call the Snapchat plugin for this request, so I can’t provide a verified JSON result. |

Result count 4 unique (4 raw) · verified 0 / approximate 3

Raw plugin answer excerpt (last message of the run session):

```
```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found.","place":"Yas Mall","uploaded":0,"videos":[]}]} ```
```

