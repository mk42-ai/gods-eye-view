"""Footage sources — every function returns a list of raw candidate dicts
({source,title,url,published_at,author,thumb,play_url,embed_url,id}) and
raises on hard failure; the orchestrator (service.py) wraps each one with a
timeout and turns exceptions into a ``source_done`` status.

Python 3.9-compatible on purpose (the Vercel sandbox image ships 3.9).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

try:
    from .ondemand_client import OnDemandClient, PluginUnavailable, QuotaExceeded, extract_json
except ImportError:  # flat import (Vercel runtime / pytest)
    from ondemand_client import OnDemandClient, PluginUnavailable, QuotaExceeded, extract_json

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

PLUGINS = {
    "tiktok": ["plugin-1716372717"],
    "instagram": ["plugin-1762980461", "plugin-1716164040"],
    "reddit": ["plugin-1748003575"],
    "x": ["plugin-1751872652"],
    "web": ["plugin-1722260873", "plugin-1713924030", "plugin-1741871229"],
}

# A plugin that answered "not subscribed"/"inactive" is skipped for a while
# (the answer does not change per request) and surfaced as `unavailable`.
_plugin_backoff: Dict[str, float] = {}
_instagram_failures = {"primary": 0}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except Exception:
            return None
    s = str(value).strip()
    if re.fullmatch(r"\d{10,13}", s):
        return parse_iso(int(s))
    s = s.replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d %b %Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            dt = datetime.fromisoformat(s) if fmt is None else datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            continue
    return None


REL_RE = re.compile(r"(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|mo|y|w|d|h|m|s)\s+ago", re.I)
REL_UNITS = {"s": 1, "sec": 1, "second": 1, "m": 60, "min": 60, "minute": 60, "h": 3600, "hr": 3600, "hour": 3600, "d": 86400, "day": 86400, "w": 604800, "week": 604800, "mo": 2629800, "month": 2629800, "y": 31557600, "year": 31557600}


def parse_relative(text: Optional[str], ref: Optional[datetime] = None) -> Optional[datetime]:
    """'3 weeks ago' / 'Streamed 2 hours ago' → absolute UTC (approximate)."""
    if not text:
        return None
    m = REL_RE.search(text)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2).lower()
    unit = unit.rstrip("s") if len(unit) > 2 else unit
    if unit == "mo" or unit == "month":
        unit = "mo"
    secs = REL_UNITS.get(unit) or REL_UNITS.get(unit[:3]) or REL_UNITS.get(unit[:1])
    if not secs:
        return None
    return (ref or now_utc()) - timedelta(seconds=n * secs)


# --------------------------------------------------------------------------
# YouTube Shorts
# --------------------------------------------------------------------------
YT_API = "https://www.googleapis.com/youtube/v3"


def _yt_item(video_id: str, title: str, author: Optional[str], published: Optional[datetime], thumb: Optional[str], duration_s: Optional[int] = None, precise: bool = True) -> dict:
    return {
        "source": "youtube",
        "id": f"yt:{video_id}",
        "title": title or "",
        "url": f"https://www.youtube.com/shorts/{video_id}",
        "embed_url": f"https://www.youtube.com/embed/{video_id}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0",
        "play_url": None,
        "thumb": thumb or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "published_at": iso(published),
        "published_precision": "exact" if precise else "approx",
        "author": author,
        "duration_s": duration_s,
    }


async def youtube_data_api(queries: List[str], since: datetime, limit: int, timeout: float) -> List[dict]:
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        raise RuntimeError("YOUTUBE_API_KEY not configured")
    out: List[dict] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        # ONE search.list per request (100 quota units each) — the first
        # variant is the most specific; the HTML fallback covers the rest.
        q = queries[0]
        r = await client.get(
            f"{YT_API}/search",
            params={
                "part": "snippet", "type": "video", "q": q, "videoDuration": "short", "order": "date",
                "publishedAfter": iso(since), "maxResults": min(50, max(5, limit)), "videoEmbeddable": "true",
                "regionCode": "AE", "safeSearch": "none", "key": key,
            },
        )
        if r.status_code == 403:
            raise QuotaExceeded("YouTube Data API quota exceeded (403)", status=403, code="quota")
        r.raise_for_status()
        for it in r.json().get("items", []):
            vid = (it.get("id") or {}).get("videoId")
            sn = it.get("snippet") or {}
            if not vid:
                continue
            thumbs = sn.get("thumbnails") or {}
            thumb = (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url")
            out.append(_yt_item(vid, sn.get("title"), sn.get("channelTitle"), parse_iso(sn.get("publishedAt")), thumb))
    return out


def _yt_sp(sort_by_date: bool, upload: Optional[int]) -> str:
    """YouTube's `sp` search filter protobuf: sort(1=date,0=relevance) + filters(upload,type=video,duration=short)."""
    f = b""
    if upload:
        f += bytes([0x08, upload])
    f += bytes([0x10, 0x01])  # type: video
    f += bytes([0x18, 0x01])  # duration: short (<4 min)
    body = bytes([0x08, 2 if sort_by_date else 0]) + bytes([0x12, len(f)]) + f
    return base64.b64encode(body).decode()


def _yt_upload_bucket(since: datetime) -> Optional[int]:
    age = now_utc() - since
    if age <= timedelta(hours=1):
        return 1
    if age <= timedelta(hours=24):
        return 2
    if age <= timedelta(days=7):
        return 3
    if age <= timedelta(days=31):
        return 4
    if age <= timedelta(days=366):
        return 5
    return None


def _walk(o, key, out):
    if isinstance(o, dict):
        if key in o:
            out.append(o[key])
        for v in o.values():
            _walk(v, key, out)
    elif isinstance(o, list):
        for v in o:
            _walk(v, key, out)


async def youtube_html(queries: List[str], since: datetime, limit: int, timeout: float, mode: str) -> List[dict]:
    """Keyless fallback: parse ytInitialData from the public results page (sp filters: video + short + upload window)."""
    out: List[dict] = []
    upload = _yt_upload_bucket(since)
    sort_by_date = mode != "rebuild"
    headers = {"User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI"}
    async with httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=True) as client:
        for q in queries[:3]:
            url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(q) + "&sp=" + urllib.parse.quote(_yt_sp(sort_by_date, upload)) + "&hl=en&gl=AE"
            r = await client.get(url)
            if r.status_code != 200:
                continue
            m = re.search(r"var ytInitialData = (\{.*?\});</script>", r.text, re.S)
            if not m:
                continue
            try:
                data = json.loads(m.group(1))
            except Exception:
                continue
            renderers: List[dict] = []
            _walk(data, "videoRenderer", renderers)
            for v in renderers:
                vid = v.get("videoId")
                if not vid:
                    continue
                title = "".join(run.get("text", "") for run in (v.get("title") or {}).get("runs", []))
                author = "".join(run.get("text", "") for run in (v.get("ownerText") or {}).get("runs", []))
                pub_text = (v.get("publishedTimeText") or {}).get("simpleText")
                length = (v.get("lengthText") or {}).get("simpleText")
                dur = None
                if length and re.fullmatch(r"\d+:\d{2}", length):
                    mm, ss = length.split(":")
                    dur = int(mm) * 60 + int(ss)
                thumbs = ((v.get("thumbnail") or {}).get("thumbnails") or [])
                thumb = thumbs[-1].get("url") if thumbs else None
                out.append(_yt_item(vid, title, author or None, parse_relative(pub_text), thumb, dur, precise=False))
            if len(out) >= limit:
                break
    return out


async def youtube_invidious(queries: List[str], since: datetime, limit: int, timeout: float) -> List[dict]:
    instances = [s.strip() for s in os.environ.get("INVIDIOUS_INSTANCES", "https://yewtu.be,https://inv.nadeko.net,https://invidious.nerdvpn.de").split(",") if s.strip()]
    out: List[dict] = []
    async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": BROWSER_UA}) as client:
        for inst in instances:
            try:
                r = await client.get(f"{inst}/api/v1/search", params={"q": queries[0], "type": "video", "duration": "short", "sort_by": "upload_date", "region": "AE"})
                if r.status_code != 200 or not r.headers.get("content-type", "").startswith("application/json"):
                    continue
                for v in r.json():
                    vid = v.get("videoId")
                    if not vid:
                        continue
                    pub = parse_iso(v.get("published"))
                    if pub and pub < since:
                        continue
                    thumbs = v.get("videoThumbnails") or []
                    out.append(_yt_item(vid, v.get("title"), v.get("author"), pub, thumbs[0].get("url") if thumbs else None, v.get("lengthSeconds")))
                if out:
                    return out[:limit]
            except Exception:
                continue
    if not out:
        raise RuntimeError("no Invidious instance answered")
    return out


async def youtube(queries: List[str], since: datetime, limit: int, timeout: float, mode: str) -> List[dict]:
    """Data API (if keyed) → public results page → Invidious. In live mode a
    too-narrow upload window is widened once so the dock always has something
    to play (older clips are labelled ARCHIVE by the service, never hidden)."""
    errors = []
    if os.environ.get("YOUTUBE_API_KEY"):
        try:
            items = await youtube_data_api(queries, since, limit, timeout)
            if items:
                return items
        except QuotaExceeded:
            errors.append("data-api quota")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"data-api {exc.__class__.__name__}")
    try:
        items = await youtube_html(queries, since, limit, timeout, mode)
        if mode == "live" and len(items) < 3:
            wider = await youtube_html(queries, since - timedelta(days=365), limit, timeout, mode)
            known = {i["id"] for i in items}
            items += [i for i in wider if i["id"] not in known]
        if items:
            return items
    except Exception as exc:  # noqa: BLE001
        errors.append(f"html {exc.__class__.__name__}")
    try:
        return await youtube_invidious(queries, since, limit, timeout)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"invidious {exc.__class__.__name__}")
    if errors:
        raise RuntimeError("; ".join(errors))
    return []


# --------------------------------------------------------------------------
# Instagram — direct embed resolver (keyless) + OnDemand plugin
# --------------------------------------------------------------------------
IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
IG_URL_RE = re.compile(r"https?://(?:www\.)?instagram\.com/(?:[A-Za-z0-9_.]+/)?(reel|reels|p|tv)/([A-Za-z0-9_-]{5,})")


def instagram_shortcode_time(shortcode: str) -> Optional[datetime]:
    """Media ids encode their creation time: top bits of the base64 id (Instagram epoch 2011-08-24T21:07:01.721Z)."""
    try:
        n = 0
        for c in shortcode[:11]:
            n = n * 64 + IG_ALPHABET.index(c)
        ms = (n >> 23) + 1314220021721
        dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
        if datetime(2012, 1, 1, tzinfo=timezone.utc) < dt < now_utc() + timedelta(days=1):
            return dt
    except Exception:
        return None
    return None


def _ig_item(shortcode: str, kind: str, *, title: str = "", author: Optional[str] = None, thumb: Optional[str] = None, play_url: Optional[str] = None, published: Optional[datetime] = None, resolver: str = "embed") -> dict:
    path = "reel" if kind in ("reel", "reels") else "p"
    return {
        "source": "instagram",
        "id": f"ig:{shortcode}",
        "title": title or "",
        "url": f"https://www.instagram.com/{path}/{shortcode}/",
        "embed_url": f"https://www.instagram.com/{path}/{shortcode}/embed/",
        "play_url": play_url,
        "thumb": thumb,
        "published_at": iso(published or instagram_shortcode_time(shortcode)),
        "published_precision": "exact" if published else "derived",
        "author": author,
        "resolver": resolver,
    }


async def instagram_embed_resolve(url: str, timeout: float) -> Optional[dict]:
    m = IG_URL_RE.search(url)
    if not m:
        return None
    kind, sc = m.group(1), m.group(2)
    try:
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True) as client:
            r = await client.get(f"https://www.instagram.com/{'reel' if kind in ('reel','reels') else 'p'}/{sc}/embed/")
    except Exception:
        return _ig_item(sc, kind, resolver="shortcode-only")
    if r.status_code != 200:
        return _ig_item(sc, kind, resolver="shortcode-only")
    h = r.text
    vid = re.search(r'video_url\\":\\"(.*?)\\"', h)
    user = re.search(r'username\\":\\"([A-Za-z0-9_.]+)\\"', h)
    disp = re.search(r'display_url\\":\\"(.*?)\\"', h)
    cap = re.search(r'edge_media_to_caption\\":\{\\"edges\\":\[\{\\"node\\":\{\\"text\\":\\"(.*?)\\"\}', h)
    taken = re.search(r'taken_at_timestamp\\":(\d+)', h)

    def unesc(raw: str) -> str:
        # The embed page carries a JSON string inside a JS string: `\\/` → `/`, `\\u0026` → `&`, `\\\\"` → `"`.
        try:
            once = json.loads('"' + raw + '"')
            return json.loads('"' + once + '"') if "\\" in once else once
        except Exception:
            return raw.replace("\\\\/", "/").replace("\\/", "/").replace("\\u0026", "&")

    play = unesc(vid.group(1)) if vid else None
    thumb = unesc(disp.group(1)) if disp else None
    caption = unesc(cap.group(1)) if cap else ""
    caption = re.sub(r"\s+", " ", caption).strip()
    if not play and not user:
        # Private / removed / login-walled: keep the link with derived time so the dock can still embed it.
        return _ig_item(sc, kind, resolver="shortcode-only")
    return _ig_item(sc, kind, title=caption[:280], author=user.group(1) if user else None, thumb=thumb, play_url=play, published=parse_iso(int(taken.group(1))) if taken else None, resolver="embed")


async def instagram_plugin_download(client: OnDemandClient, urls: List[str], timeout: float) -> List[dict]:
    """downloadInstagramMedia via plugin-1762980461 (falls back to plugin-1716164040 after two failures)."""
    order = PLUGINS["instagram"] if _instagram_failures["primary"] < 2 else list(reversed(PLUGINS["instagram"]))
    last_exc: Optional[Exception] = None
    for plugin in order:
        if _plugin_backoff.get(plugin, 0) > time.monotonic():
            continue
        prompt = (
            "Use downloadInstagramMedia for each of these Instagram post URLs: " + ", ".join(urls[:4]) +
            ". Return ONLY a JSON array (no prose) of objects {url, type, finalUrl, shortUrl, caption, username, published_at}. "
            "type is 'video' or 'image'. Include one object per media result."
        )
        try:
            data, _res = await client.query_json([plugin], prompt, timeout=timeout)
        except PluginUnavailable:
            _plugin_backoff[plugin] = time.monotonic() + 1800
            if plugin == PLUGINS["instagram"][0]:
                _instagram_failures["primary"] += 1
            continue
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if plugin == PLUGINS["instagram"][0]:
                _instagram_failures["primary"] += 1
            continue
        out: List[dict] = []
        rows = data if isinstance(data, list) else (data or {}).get("result") or (data or {}).get("results") or []
        for row in rows:
            if not isinstance(row, dict):
                continue
            src_url = str(row.get("url") or row.get("originalUrl") or "")
            m = IG_URL_RE.search(src_url) or IG_URL_RE.search(json.dumps(row))
            if not m:
                continue
            kind, sc = m.group(1), m.group(2)
            if str(row.get("type") or "").lower() != "video":
                continue
            play = row.get("shortUrl") or row.get("finalUrl")
            out.append(_ig_item(sc, kind, title=str(row.get("caption") or "")[:280], author=row.get("username"), play_url=play, published=parse_iso(row.get("published_at")), resolver=f"plugin:{plugin}"))
        return out
    if last_exc:
        raise last_exc
    raise PluginUnavailable("Instagram plugins not subscribed for this key", status=400)


async def instagram(client: OnDemandClient, discovered_urls: List[str], timeout: float) -> List[dict]:
    """Resolve discovered post/reel URLs. Direct embed first (fast, keyless); plugin for anything left unresolved."""
    urls = []
    for u in discovered_urls:
        m = IG_URL_RE.search(u)
        if m:
            canon = f"https://www.instagram.com/{'reel' if m.group(1) in ('reel','reels') else 'p'}/{m.group(2)}/"
            if canon not in urls:
                urls.append(canon)
    if not urls:
        return []
    results = await asyncio.gather(*[instagram_embed_resolve(u, timeout) for u in urls[:8]], return_exceptions=True)
    out: List[dict] = []
    unresolved: List[str] = []
    for u, r in zip(urls[:8], results):
        if isinstance(r, dict) and r.get("play_url"):
            out.append(r)
        elif isinstance(r, dict):
            out.append(r)
            unresolved.append(u)
        else:
            unresolved.append(u)
    for it in out:
        if it.get("resolver") == "shortcode-only":
            it["unresolved"] = True
    return out


async def instagram_plugin(client: OnDemandClient, urls: List[str], timeout: float) -> List[dict]:
    """Second pass for URLs the keyless embed resolver could not open (login-walled posts)."""
    if not urls or not client.ready:
        return []
    return await instagram_plugin_download(client, urls, timeout)


# --------------------------------------------------------------------------
# OnDemand plugin sources (TikTok / Reddit / X / web discovery)
# --------------------------------------------------------------------------
MEDIA_URL_RE = re.compile(
    r"https?://(?:www\.|m\.|vm\.)?(?:instagram\.com/(?:[A-Za-z0-9_.]+/)?(?:reel|reels|p|tv)/[A-Za-z0-9_-]+|youtube\.com/shorts/[A-Za-z0-9_-]{11}|youtu\.be/[A-Za-z0-9_-]{11}|youtube\.com/watch\?v=[A-Za-z0-9_-]{11}|tiktok\.com/@[A-Za-z0-9_.]+/video/\d+|tiktok\.com/t/[A-Za-z0-9]+|facebook\.com/[^\s\"'<>]+?/(?:videos|reel|posts)/[^\s\"'<>]+|x\.com/[A-Za-z0-9_]+/status/\d+|twitter\.com/[A-Za-z0-9_]+/status/\d+|reddit\.com/r/[A-Za-z0-9_]+/comments/[A-Za-z0-9]+[^\s\"'<>]*)",
    re.I,
)


def json_prompt(kind: str, queries: List[str], since: datetime, place: str) -> str:
    return (
        f"Find {kind} about: " + " | ".join(queries[:4]) + f". Location focus: {place or 'n/a'}. "
        f"Prefer posts published after {iso(since)} but include older ones if they clearly match. "
        "Return ONLY a JSON array (no prose, no markdown) of up to 10 objects with keys: "
        "title, url, published_at (ISO-8601 UTC if known else null), author, thumb (image url or null), "
        "play_url (direct video url or null), source. If nothing is found return []."
    )


def _rows(data) -> List[dict]:
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for k in ("items", "results", "posts", "videos", "data", "result"):
            v = data.get(k)
            if isinstance(v, list):
                return [r for r in v if isinstance(r, dict)]
        if data.get("error") or data.get("message"):
            msg = str(data.get("error") or data.get("message"))
            if re.search(r"quota", msg, re.I):
                raise QuotaExceeded(msg, code="quota")
            raise RuntimeError(msg[:160])
    return []


def _norm_plugin_row(source: str, row: dict) -> Optional[dict]:
    url = str(row.get("url") or row.get("link") or row.get("permalink") or row.get("webVideoUrl") or "").strip()
    if not url.startswith("http"):
        return None
    title = str(row.get("title") or row.get("text") or row.get("desc") or row.get("caption") or "")[:280]
    author = row.get("author") or row.get("username") or row.get("author_name") or (row.get("author") or {}).get("uniqueId") if isinstance(row.get("author"), dict) else row.get("author")
    published = parse_iso(row.get("published_at") or row.get("createTime") or row.get("created_utc") or row.get("created_at") or row.get("date"))
    thumb = row.get("thumb") or row.get("cover") or row.get("thumbnail") or row.get("image")
    play = row.get("play_url") or row.get("play") or row.get("video_url") or row.get("media_url")
    item = {
        "source": source,
        "id": f"{source}:{re.sub(r'[^A-Za-z0-9]+', '', url)[-40:]}",
        "title": title,
        "url": url,
        "embed_url": None,
        "play_url": play if isinstance(play, str) and play.startswith("http") else None,
        "thumb": thumb if isinstance(thumb, str) and thumb.startswith("http") else None,
        "published_at": iso(published),
        "published_precision": "exact" if published else "unknown",
        "author": author if isinstance(author, str) else None,
    }
    m = re.search(r"tiktok\.com/@([A-Za-z0-9_.]+)/video/(\d+)", url)
    if m:
        item["source"] = "tiktok"
        item["id"] = f"tt:{m.group(2)}"
        item["embed_url"] = f"https://www.tiktok.com/embed/v2/{m.group(2)}"
        item["author"] = item["author"] or m.group(1)
    return item


async def plugin_search(client: OnDemandClient, source: str, queries: List[str], since: datetime, place: str, timeout: float, extra_prompt: str = "") -> List[dict]:
    plugins = PLUGINS[source]
    last_exc: Optional[Exception] = None
    for plugin in plugins:
        if _plugin_backoff.get(plugin, 0) > time.monotonic():
            last_exc = PluginUnavailable(f"{plugin} unavailable (cached)", status=400)
            continue
        kind = {"tiktok": "TikTok videos (use searchTikTokFeed, then getTikTokFeed)", "reddit": "Reddit posts with video or links to video", "x": "X/Twitter posts with video", "web": "news articles and social video posts (Instagram reels, YouTube Shorts, TikTok, Facebook videos)"}[source]
        try:
            data, _res = await client.query_json([plugin], extra_prompt + json_prompt(kind, queries, since, place), timeout=timeout)
        except PluginUnavailable as exc:
            _plugin_backoff[plugin] = time.monotonic() + 1800
            last_exc = exc
            continue
        except QuotaExceeded as exc:
            _plugin_backoff[plugin] = time.monotonic() + 600
            last_exc = exc
            continue
        rows = _rows(data)
        out = []
        for row in rows:
            it = _norm_plugin_row(source, row)
            if it:
                out.append(it)
        # Harvest any media URL mentioned anywhere in the answer (web discovery feeds the resolvers).
        text_blob = json.dumps(data) if data is not None else _res.answer
        for u in MEDIA_URL_RE.findall(text_blob or ""):
            if not any(u == it["url"] for it in out):
                out.append({"source": source, "id": f"{source}:{re.sub(r'[^A-Za-z0-9]+', '', u)[-40:]}", "title": "", "url": u, "embed_url": None, "play_url": None, "thumb": None, "published_at": None, "published_precision": "unknown", "author": None, "discovered": True})
        return out
    if last_exc:
        raise last_exc
    return []
