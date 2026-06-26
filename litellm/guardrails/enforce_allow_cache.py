"""Enforce-allow caching layer (LLG-1.4).

Design source of truth:
specs/2026-06-25-litellm-mcp-gateway-single-chokepoint.md §13 — the
"Guardrail latency per call" mitigation:

    Cache enforce allow within short TTL; reuse allow_token.

This module provides a thin in-process cache that sits between a LiteLLM
guardrail (``pre_mcp_call`` / ``async_pre_call_hook``) and the control-plane
``POST /api/core/enforce`` endpoint. Only ``allow`` decisions are cached;
``deny`` and ``require_approval`` are re-evaluated on every call so policy
changes take effect immediately. A cached ``allow`` reuses the
enforce-returned ``allow_token`` until its ``expires_at`` passes, at which
point the entry is evicted — no stale-allow can survive past TTL.

TTL
---
The cache entry TTL is the **minimum** of:

1. ``default_ttl_seconds`` (the guardrail's configured upper bound, default
   30s — comfortably below enforce's own 60s ``allow_token`` ceiling), and
2. the enforce response's ``expires_at`` (the allow_token's real expiry).

So an entry can never grant a token that enforce has already expired.

Thread safety
-------------
The cache uses a ``threading.Lock`` around reads + writes so concurrent
guardrail calls (LiteLLM is async + threaded) cannot corrupt the dict or
serve a half-written entry. The fetcher is invoked outside the lock to avoid
serializing enforce round-trips.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Mapping

FetchRequest = Callable[[Mapping[str, Any]], "Awaitable[Mapping[str, Any]]"]
Clock = Callable[[], float]

# Guardrail-side upper bound on how long we may reuse an allow without
# re-checking enforce. Enforce itself caps allow_token at 60s; we stay
# below that so a cached entry never outlives the token it carries.
DEFAULT_TTL_SECONDS = 30.0


@dataclass(frozen=True)
class AllowCacheEntry:
    """A cached ``allow`` decision plus the reused ``allow_token``."""

    response: Mapping[str, Any]
    # Absolute time on the cache clock's scale at which this entry must be
    # evicted. Bounded by the enforce allow_token's expires_at.
    expires_at: float

    def is_expired(self, now: float) -> bool:
        return now >= self.expires_at


def enforce_cache_key(request: Mapping[str, Any]) -> str:
    """Stable cache key for an allow decision.

    Identity + tool + intent only. ``session_id`` is intentionally excluded —
    it drives enforce's own idempotency replay, not the allow cache. Excluding
    it lets two different sessions for the same tenant/employee/tool reuse an
    allow within TTL (the latency win). ``intent_kind`` is included so a
    ``tool`` call and a ``dispatch`` call for the same resource cannot share
    an allow.
    """
    return "|".join(
        str(request.get(field, ""))
        for field in ("tenant_id", "employee_id", "tool_id", "intent_kind")
    )


def _parse_iso8601_utc(expires_at: str) -> float | None:
    try:
        # enforce returns e.g. "2026-06-25T22:51:23.888Z"
        cleaned = expires_at.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def _wall_now_for(clock: Clock, now: float) -> float:
    """Return the wall-clock value comparable to a parsed ``expires_at``.

    Production uses ``time.monotonic`` (arbitrary origin) as the cache clock,
    but enforce's ``expires_at`` is a wall-clock ISO-8601 string (epoch
    seconds). To derive the token's *remaining lifetime* we need both on the
    same scale: interpret ``expires_at`` against ``time.time`` and return
    that as the wall "now". For injected test clocks whose ``now`` is already
    in the epoch scale, return ``now`` directly so tests that build
    ``expires_at`` from the same clock stay consistent.
    """
    if clock is time.monotonic:
        return time.time()
    return now


class EnforceAllowCache:
    """In-process allow-decision cache wrapping an async enforce fetcher.

    Usage in a guardrail::

        cache = EnforceAllowCache(fetch_enforce, default_ttl_seconds=30)
        decision = await cache.enforce(enforce_request_body)
        if decision["decision"] == "allow":
            ...  # inject decision["allow_token"] via extra_headers
        elif decision["decision"] == "deny":
            block(decision["deny_reason"])
        elif decision["decision"] == "require_approval":
            block(...)  # structured approval surface
    """

    def __init__(
        self,
        fetch: FetchRequest,
        *,
        default_ttl_seconds: float = DEFAULT_TTL_SECONDS,
        clock: Clock | None = None,
    ) -> None:
        self._fetch = fetch
        self._default_ttl = default_ttl_seconds
        # ``time.monotonic`` (the default) is the right production clock — it's
        # immune to wall-clock jumps. enforce's ``expires_at`` is a wall-clock
        # ISO-8601 string, so the token's remaining lifetime is derived against
        # ``time.time`` (see ``_wall_now_for``) and the resulting *duration* is
        # added to this clock's ``now``, keeping the entry-TTL bound intact
        # regardless of the cache clock's origin. Tests inject a fake clock.
        self._clock: Clock = clock if clock is not None else time.monotonic
        self._entries: dict[str, AllowCacheEntry] = {}
        self._lock = threading.Lock()

    async def enforce(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        """Return an enforce decision, caching allows within TTL.

        ``deny`` and ``require_approval`` are never cached. An expired allow
        entry is evicted before lookup so no stale-allow is returned.

        The fetcher is awaited on the caller's event loop (no worker-thread
        bridge, no second ``asyncio.run`` loop) so a cache miss never blocks
        the LiteLLM event loop — concurrent async tasks keep running while the
        enforce round-trip is in flight (design spec §13 concurrency).
        """
        key = enforce_cache_key(request)
        now = self._clock()

        # Fast path: a live cached allow. The lock guards only the dict (no
        # I/O / await inside the critical section) so a plain ``threading``
        # lock is correct and cheap; it does not block the event loop.
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and not entry.is_expired(now):
                return entry.response
            if entry is not None:
                # expired — evict so the next fetch can replace it
                del self._entries[key]

        # Fetch outside the lock so concurrent calls don't serialize on the
        # enforce round-trip. A racing caller may also fetch; that's safe —
        # last writer wins, and the response is idempotent for an allow.
        # ``await`` runs the fetcher on the caller's event loop.
        response = await self._fetch(request)

        if response.get("decision") == "allow":
            ttl = self._entry_ttl(response, now)
            entry = AllowCacheEntry(response=dict(response), expires_at=now + ttl)
            with self._lock:
                self._entries[key] = entry

        return response

    def _entry_ttl(self, allow_response: Mapping[str, Any], now: float) -> float:
        """Return the TTL (a duration in seconds) for a cached allow.

        The TTL is the smaller of:
          * ``default_ttl_seconds`` (the guardrail's configured upper bound), and
          * the enforce allow_token's remaining lifetime, derived from its
            ``expires_at`` timestamp.

        The token's remaining lifetime is derived against the cache clock's
        own ``now``: production uses ``time.monotonic`` (arbitrary origin),
        and enforce returns ``expires_at`` as a wall-clock ISO-8601 string.
        To compare them we need a shared time scale — so when the clock is
        the default ``time.monotonic``, we interpret ``expires_at`` against
        ``time.time`` and then add the resulting *duration* to ``now``
        (monotonic). When tests inject a fake clock whose ``now`` is already
        in the epoch scale, we interpret ``expires_at`` directly against that
        ``now``. The shared scale is exposed by ``_wall_now_for(clock)``.
        """
        ttl = self._default_ttl
        expires_at_str = allow_response.get("expires_at")
        if isinstance(expires_at_str, str):
            token_expiry_epoch = _parse_iso8601_utc(expires_at_str)
            if token_expiry_epoch is not None:
                wall_now = _wall_now_for(self._clock, now)
                token_remaining = token_expiry_epoch - wall_now
                # Never grant a token past its own expiry.
                ttl = min(ttl, max(0.0, token_remaining))
        return ttl

    def invalidate(self, request: Mapping[str, Any]) -> None:
        """Drop a cached allow for a given request shape (e.g. on policy change)."""
        key = enforce_cache_key(request)
        with self._lock:
            self._entries.pop(key, None)

    def clear(self) -> None:
        """Drop all cached allows."""
        with self._lock:
            self._entries.clear()