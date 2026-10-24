"""FIXTURE replay for the footage stream (test mode only).

When a request carries ``fixtures=1`` the service answers from the
deterministic payloads in ``api/footage/fixtures/*.json`` instead of the
live OnDemand plugins — the Playwright acceptance tests depend on stable
items, timestamps and per-source statuses. Every fixture file is labelled
``"_fixture": true`` and is never consulted without the flag.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Optional

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
_PLACEHOLDER = re.compile(r"^__NOW-(\d+)__$")


def _load(name: str) -> Optional[dict]:
    path = os.path.join(_DIR, f"{name}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return data if data.get("_fixture") else None


def pick_fixture(place: Optional[str], keywords: str, lat: Optional[float], lon: Optional[float]) -> Optional[dict]:
    """Choose the fixture for a query: Umm Suqeim → rebuild file, otherwise the Burj Khalifa live file."""
    text = f"{place or ''} {keywords or ''}".lower()
    if "umm suqeim" in text or "أم سقيم" in text:
        return _load("umm-suqeim-rebuild")
    if lat is not None and lon is not None and abs(lat - 25.147) < 0.02 and abs(lon - 55.199) < 0.02:
        return _load("umm-suqeim-rebuild")
    return _load("burj-khalifa-live")


def _expand(item: dict, now: datetime) -> dict:
    out = dict(item)
    m = _PLACEHOLDER.match(str(item.get("published_at") or ""))
    if m:
        out["published_at"] = (now - timedelta(seconds=int(m.group(1)))).strftime("%Y-%m-%dT%H:%M:%SZ")
    return out


def fixture_payload(fx: dict, mode: str, now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    items = [_expand(i, now) for i in fx.get("items", [])]
    for it in items:
        it.setdefault("thumb", "/assets/states/state-flyin-building.png")
        it.setdefault("fixture", True)
    times = sorted(i["published_at"] for i in items if i.get("published_at"))
    return {
        "fixture": True,
        "query": {**fx.get("query", {}), "mode": mode, "fixture": True},
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": mode,
        "freshness_summary": {
            "live": sum(1 for i in items if i.get("freshness") == "LIVE"),
            "recent": sum(1 for i in items if i.get("freshness") == "RECENT"),
            "archive": sum(1 for i in items if i.get("freshness") == "ARCHIVE"),
        },
        "earliest_published_at": times[0] if times else None,
        "latest_published_at": times[-1] if times else None,
        "reported_at": fx.get("query", {}).get("reported_at"),
        "sources": fx.get("sources", []),
        "items": items,
        "all_sources_failed": False,
        "ground_routes": fx.get("groundRoutes", []),
        "alerts": fx.get("alerts", []),
    }


async def fixture_events(fx: dict, mode: str, delay_s: float = 0.25) -> AsyncIterator[dict]:
    """Yield the same event sequence as the live stream, paced so an abort is observable."""
    payload = fixture_payload(fx, mode)
    yield {"event": "query", "data": payload["query"]}
    by_source: dict = {}
    for it in payload["items"]:
        by_source.setdefault(it.get("source"), []).append(it)
    for src in payload["sources"]:
        yield {"event": "source_start", "data": {"source": src["source"]}}
    for src in payload["sources"]:
        name = src["source"]
        for it in by_source.get(name, []):
            await asyncio.sleep(delay_s)
            yield {"event": "item", "data": it}
        yield {
            "event": "source_done",
            "data": {"source": name, "status": src.get("status", "ok"), "count": src.get("count", len(by_source.get(name, []))), "ms": src.get("ms", 0), "error": src.get("error")},
        }
    yield {"event": "done", "data": {k: v for k, v in payload.items() if k != "items"}}
