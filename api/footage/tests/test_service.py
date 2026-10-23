"""Unit tests for the footage service (no network): geo, ranking, freshness,
SSE framing and the cache. Run: python3 -m pytest -q api/footage/tests"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

import geo  # noqa: E402
import service  # noqa: E402
import sources as S  # noqa: E402
from ondemand_client import extract_json  # noqa: E402


def test_offline_reverse_umm_suqeim():
    p = geo.offline_reverse(25.147, 55.199)
    assert p.name == "Umm Suqeim" and p.city == "Dubai" and p.country == "AE"


def test_offline_reverse_yemen_scene_is_handled_generically():
    p = geo.offline_reverse(13.9425, 48.9231)
    assert p is not None and p.country == "YE"


def test_lookup_place_name_english_and_arabic():
    assert geo.lookup_place_name("rebuild the car crash reported in Umm Suqeim").name == "Umm Suqeim"
    assert geo.lookup_place_name("حادث أم سقيم").name == "Umm Suqeim"
    assert geo.lookup_place_name("fire in JVC").name == "Jumeirah Village Circle"


def test_query_variants_include_arabic_and_police():
    v = geo.build_query_variants(geo.lookup_place_name("Umm Suqeim"), "car crash")
    assert v[0] == "Umm Suqeim car crash"
    assert any("Dubai Police" in x for x in v)
    assert any("حادث" in x for x in v)


def test_freshness_windows():
    now = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)
    assert service.classify_freshness("2026-10-23T11:50:00Z", now) == "LIVE"
    assert service.classify_freshness("2026-10-23T01:00:00Z", now) == "RECENT"
    assert service.classify_freshness("2026-09-26T11:46:39Z", now) == "ARCHIVE"
    assert service.classify_freshness(None, now) == "ARCHIVE"


def test_since_parsing_defaults():
    live = service.parse_since(None, "live")
    rebuild = service.parse_since(None, "rebuild")
    assert timedelta(hours=23) < service.now_utc() - live < timedelta(hours=25)
    assert timedelta(days=700) < service.now_utc() - rebuild < timedelta(days=760)
    assert timedelta(days=6) < service.now_utc() - service.parse_since("7d", "live") < timedelta(days=8)
    assert service.parse_since("2026-09-01T00:00:00Z", "live").year == 2026


def test_canonical_dedupe_keys():
    assert service.canonical_key({"url": "https://youtu.be/pu6shIJmb5s"}) == service.canonical_key({"url": "https://www.youtube.com/shorts/pu6shIJmb5s?feature=share"})
    assert service.canonical_key({"url": "https://www.instagram.com/gulftoday/p/DdyBfSdl-zh/?hl=bg"}) == "ig:ddybfsdl-zh"


def test_instagram_shortcode_time():
    assert S.instagram_shortcode_time("Ddv9evCDLQp").strftime("%Y-%m-%d") == "2026-09-26"


def test_relative_time_parsing():
    assert S.parse_relative("3 weeks ago") is not None
    assert S.parse_relative("12y ago") is not None
    assert S.parse_relative("Streamed 2 hours ago") is not None


def test_ranking_prefers_place_and_incident_match():
    place = geo.lookup_place_name("Umm Suqeim")
    variants = geo.build_query_variants(place, "car crash")
    good = geo.relevance_score("Dubai Police: driver faints, crashes on Umm Suqeim Street", variants, place, "car crash")
    bad = geo.relevance_score("4 Bedroom Villa for rent in Umm Suqeim", variants, place, "car crash")
    assert good > 0.7 > bad


def test_extract_json_from_prose():
    assert extract_json('Here you go:\n```json\n[{"a":1}]\n```') == [{"a": 1}]
    assert extract_json('result {"x": [1,2]} done') == {"x": [1, 2]}
    assert extract_json("nothing") is None


def test_health_shape():
    h = service.health()
    assert h["service"] == "gods-eye-footage-service"
    assert set(h["configured"]) == {"ONDEMAND_API_KEY", "YOUTUBE_API_KEY", "NOMINATIM_USER_AGENT"}
    assert all(isinstance(v, bool) for v in h["configured"].values())


def test_stream_events_without_network(monkeypatch):
    async def fake_youtube(*a, **k):
        return [S._yt_item("pu6shIJmb5s", "Umm Suqeim car crash Dubai Police", "CRUX", datetime(2026, 3, 8, tzinfo=timezone.utc), None, 60)]

    async def fake_instagram(client, urls, timeout):
        return [S._ig_item("Ddv9evCDLQp", "p", title="Umm Suqeim Street crash", author="gulfnews", play_url="https://cdn.example/v.mp4")]

    monkeypatch.setattr(S, "youtube", fake_youtube)
    monkeypatch.setattr(S, "instagram", fake_instagram)
    monkeypatch.delenv("ONDEMAND_API_KEY", raising=False)
    monkeypatch.delenv("ON_DEMAND_API_KEY", raising=False)
    service._cache.clear()
    q = service.Query(lat=25.147, lon=55.199, radius_km=5, keywords="car crash", since=None, mode="rebuild", limit=10)
    events = asyncio.get_event_loop().run_until_complete(_collect(service.stream_events(q)))
    kinds = [e["event"] for e in events]
    assert kinds[0] == "query" and kinds[-1] == "done"
    items = [e["data"] for e in events if e["event"] == "item"]
    assert len(items) == 2
    assert items[0]["freshness"] == "ARCHIVE" and items[0]["published_at"]
    done = events[-1]["data"]
    assert done["freshness_summary"]["archive"] == 2
    assert done["earliest_published_at"].startswith("2026-03-08")
    assert {s["source"] for s in done["sources"]} >= {"youtube", "instagram"}
    # second call is served from cache
    events2 = asyncio.get_event_loop().run_until_complete(_collect(service.stream_events(q)))
    assert events2[-1]["data"]["cached"] is True


async def _collect(agen):
    out = []
    async for ev in agen:
        out.append(ev)
    return out
