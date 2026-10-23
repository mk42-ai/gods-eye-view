"""Thin async wrapper over OnDemand's public Chat API (live docs, 2026-10-23):

    POST https://api.on-demand.io/chat/v1/sessions              {externalUserId, pluginIds[]}
    POST https://api.on-demand.io/chat/v1/sessions/{id}/query   {endpointId, query, pluginIds[], responseMode:'sync', modelConfigs}

Auth is the ``apikey`` header. The key is read from ONDEMAND_API_KEY (or
ON_DEMAND_API_KEY) server-side only, never logged and never returned.

Observed quirks baked in:
  • a session created WITHOUT a User-Agent header occasionally 403s on the
    very next query from a serverless egress — always send one;
  • a plugin the account is not subscribed to / that is inactive fails at
    session creation with HTTP 400 {errorCode:'invalid_request',
    details.unsubscribedAgentIds | inactiveAgentIds} — surfaced as
    ``PluginUnavailable`` so a source can degrade gracefully;
  • answers come back as prose around a JSON block; ``extract_json`` pulls
    the first array/object out of fences or free text.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass

import httpx

BASE_URL = os.environ.get("ONDEMAND_BASE_URL", "https://api.on-demand.io").rstrip("/")
DEFAULT_ENDPOINT = os.environ.get("ONDEMAND_FOOTAGE_ENDPOINT_ID", "predefined-gpt-6-luna")
USER_AGENT = "gods-eye-footage-service/1.0 (+https://github.com/mk42-ai/gods-eye-view)"


class OnDemandError(Exception):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


class PluginUnavailable(OnDemandError):
    """The plugin is not subscribed / inactive for this API key (HTTP 400 at session create)."""


class QuotaExceeded(OnDemandError):
    """The upstream provider behind the plugin reports an exhausted quota."""


def api_key() -> str | None:
    return os.environ.get("ONDEMAND_API_KEY") or os.environ.get("ON_DEMAND_API_KEY") or None


def configured() -> bool:
    return bool(api_key())


@dataclass
class QueryResult:
    session_id: str
    message_id: str | None
    answer: str
    raw: dict
    elapsed_s: float


QUOTA_RE = re.compile(r"exceeded the (monthly|daily) quota|quota exceeded|rate limit", re.I)


def extract_json(text: str):
    """Return the first JSON array/object found in ``text`` (fenced or bare), else None."""
    if not text:
        return None
    s = text.strip()
    fence = re.search(r"```(?:json)?\s*([\[{].*?[\]}])\s*```", s, re.S)
    candidates = [fence.group(1)] if fence else []
    candidates.append(s)
    # bare scan: from the FIRST opener of either kind to its matching last closer
    first = min([i for i in (s.find("["), s.find("{")) if i != -1], default=-1)
    if first != -1:
        opener = s[first]
        closer = "]" if opener == "[" else "}"
        j = s.rfind(closer)
        if j > first:
            candidates.append(s[first : j + 1])
    for opener, closer in (("[", "]"), ("{", "}")):
        i, j = s.find(opener), s.rfind(closer)
        if i != -1 and j > i:
            candidates.append(s[i : j + 1])
    for c in candidates:
        try:
            return json.loads(c)
        except Exception:
            continue
    return None


class OnDemandClient:
    def __init__(self, *, key: str | None = None, timeout: float = 25.0, retries: int = 2):
        self._key = key or api_key()
        self.timeout = timeout
        self.retries = retries

    @property
    def ready(self) -> bool:
        return bool(self._key)

    def _headers(self) -> dict:
        return {
            "apikey": self._key or "",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }

    async def _post(self, client: httpx.AsyncClient, path: str, body: dict) -> dict:
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                r = await client.post(f"{BASE_URL}{path}", json=body, headers=self._headers())
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = OnDemandError(f"transport: {exc.__class__.__name__}")
                await asyncio.sleep(0.4 * (attempt + 1))
                continue
            if r.status_code in (200, 201):
                try:
                    return r.json()
                except Exception as exc:
                    raise OnDemandError(f"non-JSON response ({exc})", status=r.status_code)
            try:
                payload = r.json()
            except Exception:
                payload = {"message": r.text[:200]}
            msg = str(payload.get("message") or payload.get("error") or r.text[:200])
            code = payload.get("errorCode")
            details = payload.get("details") or {}
            if r.status_code == 400 and (details.get("unsubscribedAgentIds") or details.get("inactiveAgentIds")):
                raise PluginUnavailable(msg, status=400, code=code)
            if r.status_code in (401, 403):
                # 403 is sometimes transient right after session creation; retry once.
                last = OnDemandError(msg, status=r.status_code, code=code)
                if attempt < self.retries:
                    await asyncio.sleep(0.6 * (attempt + 1))
                    continue
                raise last
            if r.status_code == 429 or r.status_code >= 500:
                last = OnDemandError(msg, status=r.status_code, code=code)
                await asyncio.sleep(0.6 * (attempt + 1))
                continue
            raise OnDemandError(msg, status=r.status_code, code=code)
        raise last or OnDemandError("request failed")

    async def create_session(self, client: httpx.AsyncClient, plugin_ids: list[str], external_user_id: str = "gods-eye-footage") -> str:
        data = await self._post(client, "/chat/v1/sessions", {"externalUserId": external_user_id, "pluginIds": plugin_ids})
        sid = (data.get("data") or {}).get("id")
        if not sid:
            raise OnDemandError("session id missing in response")
        return sid

    async def query(
        self,
        plugin_ids: list[str],
        prompt: str,
        *,
        endpoint_id: str = DEFAULT_ENDPOINT,
        external_user_id: str = "gods-eye-footage",
        timeout: float | None = None,
    ) -> QueryResult:
        if not self.ready:
            raise OnDemandError("ONDEMAND_API_KEY not configured", code="not_configured")
        loop = asyncio.get_event_loop()
        t0 = loop.time()
        async with httpx.AsyncClient(timeout=timeout or self.timeout) as client:
            sid = await self.create_session(client, plugin_ids, external_user_id)
            data = await self._post(
                client,
                f"/chat/v1/sessions/{sid}/query",
                {
                    "endpointId": endpoint_id,
                    "query": prompt,
                    "pluginIds": plugin_ids,
                    "responseMode": "sync",
                    "modelConfigs": {"temperature": 0},
                },
            )
        d = data.get("data") or {}
        answer = str(d.get("answer") or "")
        if QUOTA_RE.search(answer):
            raise QuotaExceeded(answer[:200], code="quota")
        return QueryResult(session_id=sid, message_id=d.get("messageId"), answer=answer, raw=d, elapsed_s=round(loop.time() - t0, 2))

    async def query_json(self, plugin_ids: list[str], prompt: str, **kw):
        res = await self.query(plugin_ids, prompt, **kw)
        return extract_json(res.answer), res
