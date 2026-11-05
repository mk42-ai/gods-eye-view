# Snapchat Plugin Batching & Pagination Investigation Report

**Investigation Date:** 2026-11-01T13:36:00.944Z  
**Target Region:** Dubai Marina & surrounding neighbourhoods (JBR, Jumeirah Beach Residence)  
**Total Calls:** 8 calls (cap: <= 12)  
**Total Runtime:** 129.9 s (cap: <= 8 min)  
**Final Unique Records (storyId):** 2  

---

## 1. Executive Summary & Honest Conclusion

- **Pagination & Cursors:** **None / Limit Only**.
  Across all limit tests (5, 25, 50), the plugin `plugin-1792945050` returns only `{ "limit", "note", "results" }`. Inside `results[]`, keys are `{ "matchType", "matchedQuery", "place", "uploaded", "videos" }`. No cursor, `next`, `offset`, or pagination token is ever exposed by the API or model output.
- **Limit Escalation:**
  Passing `limit: 5`, `limit: 25`, and `limit: 50` succeeds with HTTP 200. The plugin reflects the requested limit integer in its `"limit"` field. The number of actual videos returned depends on available cached Spotlight stories for the text query.
- **Time-Window Partitioning:**
  The plugin schema does not accept any date or time range parameters. When prompted with "last 24 hours" vs "last 7 days", the underlying plugin execution remains `fetchSnapchatVideosByPlace({places, limit})`. Any temporal filtering is purely post-retrieval text matching by the agent model, but because capture time is unavailable in Spotlight metadata, true temporal filtering cannot be guaranteed by the provider.
- **Geographic Partitioning:**
  Querying place-name variants (`Dubai Marina`, `JBR`, `Jumeirah Beach Residence`) in parallel via bounded concurrency (`runFanout`) yields additional distinct stories. StoryId deduplication successfully filters out cross-posted and overlapping clips.

---

## 2. Per-Call Execution Ledger

| Call / Test | Limit | Status | Duration (ms) | Raw Count | Unique Count | Dup Count | Keys Exposed |
|---|---|---|---|---|---|---|---|
| `limit_escalation_5` | 5 | 200 | 23627 | 1 | 1 | 0 | `limit, note, results` |
| `limit_escalation_25` | 25 | 200 | 19401 | 1 | 0 | 1 | `limit, note, results` |
| `limit_escalation_50` | 50 | 200 | 19451 | 1 | 0 | 1 | `limit, note, results` |
| `time_window_24h` | 25 | 200 | 25807 | 1 | 0 | 1 | `limit, note, results` |
| `time_window_7d` | 25 | 200 | 24912 | 1 | 0 | 1 | `limit, note, results` |
| `geo_partition_Jumeirah Beach Residence` | 25 | 200 | 13559 | 0 | 0 | 0 | `limit, note, results` |
| `geo_partition_Dubai Marina` | 25 | 200 | 16371 | 1 | 0 | 1 | `limit, note, results` |
| `geo_partition_JBR` | 25 | 200 | 16652 | 1 | 1 | 0 | `limit, note, results` |

---

## 3. Final Accounting

- **Total Requests Attempted:** 8
- **Total Requests Succeeded:** 8
- **Total Requests Failed:** 0
- **Total Raw Videos Returned:** 7
- **Total Unique Story IDs:** 2
- **Duplicates Identified & Dropped:** 5
