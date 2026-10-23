"""Footage orchestrator: fan out to every source concurrently, normalise,
dedupe, rank (relevance x recency decay), classify freshness and cache.

Streaming: ``stream_events`` yields SSE-ready dicts as each source settles
(source_start / item / source_done / done) so the dock can start playing the
first clip long before the slowest plugin answers.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Dict, List, Optional

try:
    from . import sources as S
    from .geo import Place, build_query_variants, haversine_km, lookup_place_name, relevance_score, reverse_geocode
    from .ondemand_client import OnDemandClient, PluginUnavailable, QuotaExceeded, configured as ondemand_configured
    from .seeds import matching_seed_urls
except ImportError:  # flat import (Vercel runtime / pytest)
    import sources as S
    from geo import Place, build_query_variants, haversine_km, lookup_place_name, relevance_score, reverse_geocode
    from ondemand_client import OnDemandClient, PluginUnavailable, QuotaExceeded, configured as ondemand_configured
    from seeds import matching_seed_urls

SOURCE_TIMEOUT_S = float(os.environ.get("FOOTAGE_SOURCE_TIMEOUT_S", "6"))
PLUGIN_TIMEOUT_S = float(os.environ.get("FOOTAGE_PLUGIN_TIMEOUT_S", "12"))
STREAM_PLUGIN_TIMEOUT_S = float(os.environ.get("FOOTAGE_STREAM_PLUGIN_TIMEOUT_S", "28"))
CACHE_TTL_S = 60.0
LIVE_WINDOW = timedelta(minutes=15)
RECENT_WINDOW = timedelta(hours=24)
SOURCES = ["youtube", "tiktok", "instagram", "reddit", "x", "web"]

_cache: Dict[str, Dict[str, Any]] = {}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_since(value: Optional[str], mode: str) -> datetime:
    """ISO-8601 or relative ('24h', '7d', '15m', '2y'); mode defaults: live=24h, rebuild=2y."""
    n = now_utc()
    if value:
        v = value.strip().lower()
        m = re.fullmatch(r"(\d+)\s*(m|min|h|hr|d|w|mo|y)", v)
        if m:
            qty = int(m.group(1))
            unit = m.group(2)
            secs = {"m": 60, "min": 60, "h": 3600, "hr": 3600, "d": 86400, "w": 604800, "mo": 2629800, "y": 31557600}[unit]
            return n - timedelta(seconds=qty * secs)
        dt = S.parse_iso(value)
        if dt:
            return dt
    return n - (timedelta(days=730) if mode == "rebuild" else timedelta(hours=24))


def classify_freshness(published_at: Optional[str], ref: Optional[datetime] = None) -> str:
    dt = S.parse_iso(published_at)
    if not dt:
        return "ARCHIVE"
    age = (ref or now_utc()) - dt
    if age <= LIVE_WINDOW:
        return "LIVE"
    if age <= RECENT_WINDOW:
        return "RECENT"
    return "ARCHIVE"


def recency_weight(published_at: Optional[str], mode: str, ref: Optional[datetime] = None) -> float:
    dt = S.parse_iso(published_at)
    if not dt:
        return 0.35 if mode == "rebuild" else 0.2
    hours = max(0.0, ((ref or now_utc()) - dt).total_seconds() / 3600.0)
    half_life_h = 24 * 30 * 6 if mode == "rebuild" else 24.0  # 6 months vs 1 day
    return 0.25 + 0.75 * math.exp(-math.log(2) * hours / half_life_h)


def canonical_key(item: dict) -> str:
    url = (item.get("url") or "").lower()
    m = re.search(r"(?:youtube\.com/(?:shorts/|watch\?v=|embed/)|youtu\.be/)([a-z0-9_-]{11})", url)
    if m:
        return f"yt:{m.group(1)}"
    m = re.search(r"instagram\.com/(?:[a-z0-9_.]+/)?(?:reel|reels|p|tv)/([a-z0-9_-]+)", url)
    if m:
        return f"ig:{m.group(1)}"
    m = re.search(r"tiktok\.com/@[a-z0-9_.]+/video/(\d+)", url)
    if m:
        return f"tt:{m.group(1)}"
    m = re.search(r"(?:x|twitter)\.com/[a-z0-9_]+/status/(\d+)", url)
    if m:
        return f"x:{m.group(1)}"
    m = re.search(r"reddit\.com/r/[a-z0-9_]+/comments/([a-z0-9]+)", url)
    if m:
        return f"rd:{m.group(1)}"
    m = re.search(r"facebook\.com/.*?(\d{12,})", url)
    if m:
        return f"fb:{m.group(1)}"
    return "u:" + re.sub(r"[?#].*$", "", url).rstrip("/")


def source_of(url: str, fallback: str) -> str:
    u = (url or "").lower()
    if "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    if "instagram.com" in u:
        return "instagram"
    if "tiktok.com" in u:
        return "tiktok"
    if "x.com" in u or "twitter.com" in u:
        return "x"
    if "reddit.com" in u:
        return "reddit"
    if "facebook.com" in u or "fb.watch" in u:
        return "facebook"
    return fallback


def embed_for(item: dict) -> Optional[str]:
    if item.get("embed_url"):
        return item["embed_url"]
    key = canonical_key(item)
    if key.startswith("yt:"):
        return f"https://www.youtube.com/embed/{key[3:]}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0"
    if key.startswith("tt:"):
        return f"https://www.tiktok.com/embed/v2/{key[3:]}"
    if key.startswith("ig:"):
        kind = "reel" if "/reel" in (item.get("url") or "") else "p"
        return f"https://www.instagram.com/{kind}/{key[3:]}/embed/"
    return None


def normalise(item: dict, variants: List[str], place: Optional[Place], mode: str, ref: datetime, keywords: str = "") -> dict:
    url = item.get("url") or ""
    key = canonical_key(item)
    published_at = item.get("published_at")
    if not published_at and key.startswith("ig:"):
        published_at = S.iso(S.instagram_shortcode_time(key[3:]))
    text = " ".join(str(x or "") for x in (item.get("title"), item.get("author"), url))
    rel = relevance_score(text, variants, place, keywords)
    if item.get("seeded"):
        rel = max(rel, 0.8)
    rec = recency_weight(published_at, mode, ref)
    media_bonus = 0.08 if (item.get("play_url") or key.startswith(("yt:", "tt:", "ig:"))) else -0.15
    score = round(max(0.0, min(1.0, rel * 0.6 + rec * 0.4 + media_bonus)), 4)
    return {
        "source": source_of(url, item.get("source") or "web"),
        "title": (item.get("title") or "").strip()[:280] or None,
        "url": url,
        "embed_url": embed_for(item),
        "play_url": item.get("play_url"),
        "thumb": item.get("thumb"),
        "published_at": published_at,
        "published_precision": item.get("published_precision") or ("unknown" if not published_at else "exact"),
        "freshness": classify_freshness(published_at, ref),
        "relevance": rel,
        "score": score,
        "author": item.get("author"),
        "duration_s": item.get("duration_s"),
        "resolver": item.get("resolver"),
        "seeded": bool(item.get("seeded")),
        "canonical": key,
    }


def playable(item: dict) -> bool:
    return bool(item.get("play_url") or item.get("embed_url"))


class Query:
    def __init__(self, *, lat: Optional[float], lon: Optional[float], radius_km: float, keywords: str, since: Optional[str], mode: str, limit: int, place_hint: Optional[str] = None, plugin_timeout: Optional[float] = None):
        self.plugin_timeout = float(plugin_timeout or PLUGIN_TIMEOUT_S)
        self.lat = lat
        self.lon = lon
        self.radius_km = radius_km
        self.keywords = (keywords or "").strip()[:200]
        self.mode = "rebuild" if mode == "rebuild" else "live"
        self.since = parse_since(since, self.mode)
        self.since_raw = since
        self.limit = max(1, min(40, int(limit or 12)))
        self.place_hint = (place_hint or "").strip()[:120] or None

    def cache_key(self) -> str:
        parts = [
            f"{round(self.lat, 2) if self.lat is not None else 'x'}",
            f"{round(self.lon, 2) if self.lon is not None else 'x'}",
            self.keywords.lower(),
            self.since.strftime("%Y%m%d%H%M"),
            self.mode,
            str(self.limit),
            self.place_hint or "",
        ]
        return hashlib.sha1("|".join(parts).encode()).hexdigest()

    def to_dict(self, place: Optional[Place], variants: List[str]) -> dict:
        return {
            "lat": self.lat,
            "lon": self.lon,
            "radius_km": self.radius_km,
            "keywords": self.keywords,
            "since": S.iso(self.since),
            "since_raw": self.since_raw,
            "mode": self.mode,
            "limit": self.limit,
            "place": place.to_dict() if place else None,
            "query_variants": variants,
        }


async def resolve_place(q: Query) -> Optional[Place]:
    if q.place_hint:
        p = lookup_place_name(q.place_hint)
        if p:
            return p
    p = lookup_place_name(q.keywords)
    if p and (q.lat is None or q.lon is None or haversine_km(q.lat, q.lon, p.lat, p.lon) < 400):
        return p
    if q.lat is not None and q.lon is not None:
        return await reverse_geocode(q.lat, q.lon, timeout=4.0, nominatim_ua=os.environ.get("NOMINATIM_USER_AGENT"))
    return p


def _status_for(exc: BaseException) -> dict:
    if isinstance(exc, asyncio.TimeoutError):
        return {"status": "error", "error": "timeout"}
    if isinstance(exc, QuotaExceeded):
        return {"status": "quota", "error": str(exc)[:160]}
    if isinstance(exc, PluginUnavailable):
        return {"status": "unavailable", "error": str(exc)[:160]}
    return {"status": "error", "error": f"{exc.__class__.__name__}: {str(exc)[:140]}"}


async def _run_source(name: str, coro, timeout: float):
    t0 = time.monotonic()
    try:
        items = await asyncio.wait_for(coro, timeout=timeout)
        return name, list(items or []), {"status": "ok", "count": len(items or []), "ms": int((time.monotonic() - t0) * 1000)}
    except BaseException as exc:  # noqa: BLE001
        st = _status_for(exc)
        st["ms"] = int((time.monotonic() - t0) * 1000)
        st["count"] = 0
        return name, [], st


async def stream_events(q: Query) -> AsyncIterator[dict]:
    """Yield {event, data} dicts. Also populates the 60 s cache with the final aggregate."""
    ref = now_utc()
    key = q.cache_key()
    cached = _cache.get(key)
    if cached and cached["expires"] > time.monotonic():
        payload = dict(cached["payload"])
        payload["cached"] = True
        yield {"event": "query", "data": dict(payload["query"], reported_at=payload.get("reported_at"), seed_article=payload.get("seed_article"))}
        for s in payload["sources"]:
            yield {"event": "source_start", "data": {"source": s["source"], "cached": True}}
        for it in payload["items"]:
            yield {"event": "item", "data": it}
        for s in payload["sources"]:
            yield {"event": "source_done", "data": s}
        yield {"event": "done", "data": {k: v for k, v in payload.items() if k != "items"}}
        return

    place = await resolve_place(q)
    variants = build_query_variants(place, q.keywords)
    place_name = place.name if place else ""
    plugin_timeout = q.plugin_timeout
    client = OnDemandClient(timeout=plugin_timeout)
    seeds = matching_seed_urls(place_name, q.keywords)
    seed_urls = [u for s in seeds for u in s["urls"]]

    query_meta = dict(q.to_dict(place, variants), reported_at=seeds[0].get("reported_at") if seeds else None, seed_article=seeds[0]["article"] if seeds else None)
    yield {"event": "query", "data": query_meta}

    tasks = {}
    loop = asyncio.get_event_loop()
    tasks["youtube"] = loop.create_task(_run_source("youtube", S.youtube(variants, q.since, q.limit, SOURCE_TIMEOUT_S, q.mode), SOURCE_TIMEOUT_S + 1))
    if client.ready:
        for name in ("tiktok", "reddit", "x", "web"):
            tasks[name] = loop.create_task(_run_source(name, S.plugin_search(client, name, variants, q.since, place_name, plugin_timeout), plugin_timeout + 1))
    # Instagram runs on the discovered URL pool: curated seeds immediately (keyless embed resolver),
    # web-discovered URLs when `web` settles, and the OnDemand download plugin for login-walled posts.
    tasks["instagram"] = loop.create_task(_run_source("instagram", S.instagram(client, seed_urls, SOURCE_TIMEOUT_S), SOURCE_TIMEOUT_S + 1))
    seed_set = set(seed_urls)

    for name in tasks:
        yield {"event": "source_start", "data": {"source": name, "plugin": S.PLUGINS.get(name)}}
    for name in SOURCES:
        if name not in tasks:
            yield {"event": "source_done", "data": {"source": name, "status": "unavailable", "error": "ONDEMAND_API_KEY not configured" if name != "youtube" else "disabled", "count": 0, "ms": 0}}

    seen: Dict[str, dict] = {}
    statuses: List[dict] = []
    extra_discovered: List[str] = []
    pending = set(tasks.values())
    instagram_second_pass = False

    def accept(raw: dict) -> Optional[dict]:
        if raw.get("url") in seed_set or (raw.get("url") or "").rstrip("/") + "/" in seed_set:
            raw["seeded"] = True
        it = normalise(raw, variants, place, q.mode, ref, q.keywords)
        k = it["canonical"]
        if k in seen:
            prev = seen[k]
            for fld in ("title", "author", "thumb", "play_url", "published_at", "duration_s"):
                if not prev.get(fld) and it.get(fld):
                    prev[fld] = it[fld]
            if it["published_at"] and prev.get("published_precision") in ("derived", "approx", "unknown") and it.get("published_precision") == "exact":
                prev["published_at"] = it["published_at"]
                prev["published_precision"] = "exact"
                prev["freshness"] = it["freshness"]
            prev["relevance"] = max(prev["relevance"], it["relevance"])
            prev["score"] = max(prev["score"], it["score"])
            return None
        if not playable(it) and it["source"] not in ("facebook", "reddit", "x"):
            return None
        if q.keywords and not raw.get("seeded") and it["relevance"] < 0.2:
            return None
        if q.mode == "rebuild" and not raw.get("seeded") and it["published_at"] and S.parse_iso(it["published_at"]) < q.since - timedelta(days=30):
            return None  # rebuild window is explicit (default 2 y); keep only clips inside it
        seen[k] = it
        return it

    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            name, items, st = t.result()
            emitted = 0
            discovered_here: List[str] = []
            for raw in items:
                if raw.get("discovered"):
                    discovered_here.append(raw["url"])
                    if source_of(raw["url"], "web") in ("instagram",):
                        continue  # resolved by the Instagram pass below
                it = accept(raw)
                if it:
                    emitted += 1
                    yield {"event": "item", "data": it}
            st = dict(st, source=name, emitted=emitted)
            if name.startswith("instagram") and client.ready and name != "instagram-plugin":
                unresolved = [raw["url"] for raw in items if raw.get("unresolved")]
                if unresolved:
                    t3 = loop.create_task(_run_source("instagram-plugin", S.instagram_plugin(client, unresolved[:4], plugin_timeout), plugin_timeout + 1))
                    pending.add(t3)
                    yield {"event": "source_start", "data": {"source": "instagram-plugin", "urls": len(unresolved[:4]), "plugin": S.PLUGINS["instagram"]}}
            if name == "web" and discovered_here:
                ig_urls = [u for u in discovered_here if "instagram.com" in u]
                extra_discovered.extend(ig_urls)
                if ig_urls and not instagram_second_pass:
                    instagram_second_pass = True
                    t2 = loop.create_task(_run_source("instagram+web", S.instagram(client, ig_urls, SOURCE_TIMEOUT_S), SOURCE_TIMEOUT_S + 1))
                    pending.add(t2)
                    yield {"event": "source_start", "data": {"source": "instagram+web", "urls": len(ig_urls)}}
            statuses.append(st)
            yield {"event": "source_done", "data": st}

    items = sorted(seen.values(), key=lambda i: (-i["score"], i["published_at"] or ""))
    if q.mode == "live":
        # prefer LIVE/RECENT first, but never hide archive entirely when nothing fresh exists
        fresh = [i for i in items if i["freshness"] != "ARCHIVE"]
        items = fresh + [i for i in items if i["freshness"] == "ARCHIVE"]
    items = items[: q.limit]
    summary = {"live": sum(1 for i in items if i["freshness"] == "LIVE"), "recent": sum(1 for i in items if i["freshness"] == "RECENT"), "archive": sum(1 for i in items if i["freshness"] == "ARCHIVE")}
    dated = sorted([i["published_at"] for i in items if i["published_at"]])
    all_failed = bool(statuses) and all(s["status"] != "ok" or s.get("count", 0) == 0 for s in statuses)
    payload = {
        "query": q.to_dict(place, variants),
        "generated_at": S.iso(ref),
        "mode": q.mode,
        "freshness_summary": summary,
        "earliest_published_at": dated[0] if dated else None,
        "latest_published_at": dated[-1] if dated else None,
        "sources": statuses,
        "all_sources_failed": all_failed,
        "seed_article": seeds[0]["article"] if seeds else None,
        # The verified first report of the incident (curated seed) — the dock's
        # archive banner prefers this over the earliest clip timestamp.
        "reported_at": seeds[0].get("reported_at") if seeds else None,
        "cached": False,
        "items": items,
    }
    _cache[key] = {"expires": time.monotonic() + CACHE_TTL_S, "payload": payload}
    if len(_cache) > 64:
        for k in sorted(_cache, key=lambda k: _cache[k]["expires"])[:16]:
            _cache.pop(k, None)
    yield {"event": "done", "data": {k: v for k, v in payload.items() if k != "items"}}


async def search(q: Query) -> dict:
    final = None
    items: List[dict] = []
    query_meta = None
    async for ev in stream_events(q):
        if ev["event"] == "item":
            items.append(ev["data"])
        elif ev["event"] == "done":
            final = ev["data"]
        elif ev["event"] == "query":
            query_meta = ev["data"]
    payload = dict(final or {})
    # The cached path yields already-ranked items; the live path ranked them before `done`.
    cached = _cache.get(q.cache_key())
    payload["items"] = cached["payload"]["items"] if cached else items
    payload.setdefault("query", query_meta)
    return payload


def health() -> dict:
    return {
        "ok": True,
        "service": "gods-eye-footage-service",
        "generated_at": S.iso(now_utc()),
        "configured": {
            "ONDEMAND_API_KEY": ondemand_configured(),
            "YOUTUBE_API_KEY": bool(os.environ.get("YOUTUBE_API_KEY")),
            "NOMINATIM_USER_AGENT": bool(os.environ.get("NOMINATIM_USER_AGENT")),
        },
        "sources": {
            "youtube": {"available": True, "mode": "data-api" if os.environ.get("YOUTUBE_API_KEY") else "html+invidious fallback"},
            "tiktok": {"available": ondemand_configured(), "plugin": S.PLUGINS["tiktok"], "backoff": _backoff_state(S.PLUGINS["tiktok"])},
            "instagram": {"available": True, "plugin": S.PLUGINS["instagram"], "resolver": "embed+plugin", "backoff": _backoff_state(S.PLUGINS["instagram"])},
            "reddit": {"available": ondemand_configured(), "plugin": S.PLUGINS["reddit"], "backoff": _backoff_state(S.PLUGINS["reddit"])},
            "x": {"available": ondemand_configured(), "plugin": S.PLUGINS["x"], "backoff": _backoff_state(S.PLUGINS["x"])},
            "web": {"available": ondemand_configured(), "plugin": S.PLUGINS["web"], "backoff": _backoff_state(S.PLUGINS["web"])},
        },
        "cache": {"entries": len(_cache), "ttl_s": CACHE_TTL_S},
        "timeouts": {"source_s": SOURCE_TIMEOUT_S, "plugin_s": PLUGIN_TIMEOUT_S},
    }


def _backoff_state(plugins: List[str]) -> dict:
    now = time.monotonic()
    return {p: bool(S._plugin_backoff.get(p, 0) > now) for p in plugins}
