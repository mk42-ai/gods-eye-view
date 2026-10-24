"""Curated discovery seeds — verified incident → public post URLs.

These are NOT returned as results by themselves: they are fed into the same
media resolvers as URLs discovered by web search, so every item the dock
plays still carries a live-resolved author / timestamp / play URL. A seed
matches when the scene's place and incident keywords both match.
"""
from __future__ import annotations

SEEDS = [
    {
        "id": "umm-suqeim-faint-crash-2026-09",
        "place_aliases": ["umm suqeim", "um suqeim", "jumeirah", "أم سقيم"],
        "keyword_any": ["crash", "accident", "collision", "faint", "حادث"],
        "reported_at": "2026-09-26T00:00:00Z",
        "article": "https://www.gulftoday.ae/news/2026/09/26/dubai-police-warn-of-dangers-of-driving-while-fatigued-after-a-driver-faints-causing-an-accident-in-umm-suqeim",
        "urls": [
            "https://www.instagram.com/p/DdyBfSdl-zh/",
            "https://www.instagram.com/p/Ddv9evCDLQp/",
            "https://www.instagram.com/p/DXgVj3djDAR/",
            "https://www.instagram.com/reel/DW8khmCg4CY/",
            "https://www.instagram.com/reel/DWqtTHDgSdN/",
            "https://www.youtube.com/shorts/pu6shIJmb5s",
            "https://www.facebook.com/khaleejtimes/posts/1634956428291176",
            "https://www.reddit.com/r/dubai/comments/1ph9l65/",
        ],
    },
]


def matching_seed_urls(place_name: str, keywords: str) -> list[dict]:
    p = (place_name or "").lower()
    k = (keywords or "").lower()
    hits = []
    for seed in SEEDS:
        if any(a in p or a in k for a in seed["place_aliases"]) and any(w in k for w in seed["keyword_any"]):
            hits.append(seed)
    return hits
