"""Tests for the enforce-allow caching layer (LLG-1.4).

Design source of truth:
specs/2026-06-25-litellm-mcp-gateway-single-chokepoint.md §13 (guardrail latency
mitigation: "Cache enforce allow within short TTL; reuse allow_token").

The cache sits between a LiteLLM guardrail and POST /api/core/enforce. Only
``allow`` decisions are cached; ``deny`` and ``require_approval`` are never
cached (they must re-evaluate every call so policy changes take effect
immediately). An ``allow`` entry reuses the enforce-returned ``allow_token``
until its ``expires_at`` passes, then the entry is evicted so no stale-allow
survives TTL.

The fetcher is async and awaited on the caller's event loop so a cache miss
never blocks the LiteLLM event loop (design spec §13 concurrency).
"""
import asyncio
import time
import threading
from typing import Any, Awaitable, Callable, Mapping

import pytest

from guardrails.enforce_allow_cache import (
    AllowCacheEntry,
    EnforceAllowCache,
    enforce_cache_key,
)


class _FakeClock:
    """Deterministic clock so tests don't depend on wall time.

    Returns epoch-style seconds (so ISO-8601 ``expires_at`` strings built
    against ``time.gmtime(clock())`` compare correctly with the clock).
    """

    def __init__(self, start: float = 1_700_000_000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _allow_response(
    trace_id: str = "trace-1",
    ttl_seconds: int = 60,
    clock: Callable[[], float] | None = None,
) -> Mapping[str, Any]:
    base = clock() if clock is not None else time.time()
    expires_at = time.strftime(
        "%Y-%m-%dT%H:%M:%S.000Z",
        time.gmtime(base + ttl_seconds),
    )
    return {
        "decision": "allow",
        "trace_id": trace_id,
        "lane": "L2",
        "runtime_seconds": 120,
        "budget_remaining": 100,
        "expires_at": expires_at,
        "allow_token": f"allow-token-{trace_id}",
    }


def _deny_response(trace_id: str = "trace-d") -> Mapping[str, Any]:
    return {
        "decision": "deny",
        "trace_id": trace_id,
        "deny_reason": "package_not_allowed_for_tool",
        "deny_detail": "Package L0 is not permitted to use this tool.",
    }


def _require_approval_response(trace_id: str = "trace-a") -> Mapping[str, Any]:
    return {
        "decision": "require_approval",
        "trace_id": trace_id,
        "approval_request_id": "ap-1",
        "approval_class": "A2",
        "sla_seconds": 900,
        "responder_surface": "openclaw_hold",
        "routing": {"rule_id": "r1", "paperclip_approval_type": None, "escalation_role": None},
    }


def _req(**overrides) -> Mapping[str, Any]:
    base = {
        "tenant_id": "t-1",
        "employee_id": "e-1",
        "tool_id": "gmail__messages_send",
        "intent_kind": "tool",
        "session_id": "s-1",
    }
    base.update(overrides)
    return base


def _async_fetch(response: Mapping[str, Any]) -> Callable[[Mapping[str, Any]], Awaitable[Mapping[str, Any]]]:
    """Build an async fetcher that records calls and returns ``response``."""

    async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
        return response

    return fetch


# ---------------------------------------------------------------------------
# Cache key
# ---------------------------------------------------------------------------


class TestCacheKey:
    def test_key_is_stable_for_same_identity_and_tool(self) -> None:
        assert enforce_cache_key(_req()) == enforce_cache_key(dict(_req()))

    def test_key_changes_when_tool_changes(self) -> None:
        assert enforce_cache_key(_req()) != enforce_cache_key(_req(tool_id="gmail__messages_list"))

    def test_key_changes_when_employee_changes(self) -> None:
        assert enforce_cache_key(_req()) != enforce_cache_key(_req(employee_id="e-2"))

    def test_key_changes_when_tenant_changes(self) -> None:
        assert enforce_cache_key(_req()) != enforce_cache_key(_req(tenant_id="t-2"))

    def test_key_changes_when_intent_kind_changes(self) -> None:
        assert enforce_cache_key(_req()) != enforce_cache_key(_req(intent_kind="dispatch"))

    def test_key_is_independent_of_session_id(self) -> None:
        """Session id drives enforce idempotency, not the allow cache key.

        Two different sessions for the same tenant/employee/tool may reuse an
        allow decision within TTL — that is the latency win. The session id
        must NOT be part of the cache key, otherwise every new session pays a
        full enforce round-trip.
        """
        assert enforce_cache_key(_req()) == enforce_cache_key(_req(session_id="s-2"))


# ---------------------------------------------------------------------------
# EnforceAllowCache — allow caching
# ---------------------------------------------------------------------------


class TestAllowCaching:
    @pytest.mark.asyncio
    async def test_first_call_hits_fetcher_and_caches_allow(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _allow_response(clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        result = await cache.enforce(_req())
        assert result["decision"] == "allow"
        assert result["allow_token"] == "allow-token-trace-1"
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_second_call_within_ttl_reuses_cached_allow_without_fetching(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _allow_response(clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        await cache.enforce(_req())
        clock.advance(20)  # within both the 30s cache TTL and the 60s allow_token TTL
        result = await cache.enforce(_req(session_id="s-2"))
        assert result["decision"] == "allow"
        assert result["allow_token"] == "allow-token-trace-1"
        assert len(calls) == 1, "second call within TTL must not hit the fetcher"

    @pytest.mark.asyncio
    async def test_cached_response_is_a_copy_not_the_live_fetch_reference(self) -> None:
        clock = _FakeClock()
        mutable: list[dict[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            resp = dict(_allow_response(clock=clock))
            mutable.append(resp)
            return resp

        cache = EnforceAllowCache(fetch, clock=clock)
        first = await cache.enforce(_req())
        assert isinstance(first, Mapping)
        # Mutating the fetched dict must not change the cached entry.
        mutable[0]["allow_token"] = "tampered"
        second = await cache.enforce(_req())
        assert second["allow_token"] == "allow-token-trace-1", (
            "cached entry must be an immutable copy, not a live reference"
        )

    @pytest.mark.asyncio
    async def test_call_after_ttl_expiry_refetches(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _allow_response(trace_id=f"trace-{len(calls)}", clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        first = await cache.enforce(_req())
        assert first["allow_token"] == "allow-token-trace-1"
        clock.advance(61)  # past the 60s allow_token TTL (also > 30s cache default)
        second = await cache.enforce(_req(session_id="s-2"))
        assert second["decision"] == "allow"
        assert second["allow_token"] == "allow-token-trace-2"
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_no_stale_allow_past_ttl_when_fetcher_now_denies(self) -> None:
        """After TTL expires, a policy change that now denies must take effect.

        This is the core acceptance criterion: 'no stale-allow past TTL'.
        """
        clock = _FakeClock()
        allow_then_deny: list[bool] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            if not allow_then_deny:
                allow_then_deny.append(True)
                return _allow_response(clock=clock)
            return _deny_response()

        cache = EnforceAllowCache(fetch, clock=clock)
        first = await cache.enforce(_req())
        assert first["decision"] == "allow"
        clock.advance(61)  # past TTL
        second = await cache.enforce(_req(session_id="s-2"))
        assert second["decision"] == "deny", "stale allow must not survive past TTL"


# ---------------------------------------------------------------------------
# Non-allow decisions are never cached
# ---------------------------------------------------------------------------


class TestNonAllowDecisionsAreNeverCached:
    @pytest.mark.asyncio
    async def test_deny_is_not_cached(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _deny_response()

        cache = EnforceAllowCache(fetch, clock=clock)
        await cache.enforce(_req())
        await cache.enforce(_req(session_id="s-2"))
        assert len(calls) == 2, "deny must be re-evaluated every call"

    @pytest.mark.asyncio
    async def test_require_approval_is_not_cached(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _require_approval_response()

        cache = EnforceAllowCache(fetch, clock=clock)
        await cache.enforce(_req())
        await cache.enforce(_req(session_id="s-2"))
        assert len(calls) == 2, "require_approval must be re-evaluated every call"


# ---------------------------------------------------------------------------
# Concurrency safety
# ---------------------------------------------------------------------------


class TestConcurrencySafety:
    @pytest.mark.asyncio
    async def test_cache_is_concurrent_safe_under_parallel_async_reads(self) -> None:
        """Concurrent async callers must never corrupt the cache or raise."""
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []
        lock = asyncio.Lock()

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            async with lock:
                calls.append(req)
            return _allow_response(clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        results = await asyncio.gather(
            *(cache.enforce(_req(session_id=f"s-{i}")) for i in range(20))
        )

        assert all(r["decision"] == "allow" for r in results)
        # Concurrent first calls may race and fetch more than once, but the
        # cache must never corrupt or raise.
        assert len(results) == 20

    @pytest.mark.asyncio
    async def test_preseeded_cache_serves_concurrent_reads_without_fetch(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _allow_response(clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        await cache.enforce(_req())  # seed the cache

        results = await asyncio.gather(
            *(cache.enforce(_req(session_id=f"s-{i}")) for i in range(50))
        )

        assert all(r["decision"] == "allow" for r in results)
        assert len(calls) == 1, "concurrent reads after seeding must not refetch"

    def test_cache_thread_safe_under_parallel_thread_reads(self) -> None:
        """The threading.Lock must keep the dict safe under true thread
        parallelism (LiteLLM mixes async + threads). Run ``enforce`` in a
        throwaway loop per thread so the async fetcher resolves."""
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []
        tlock = threading.Lock()

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            with tlock:
                calls.append(req)
            return _allow_response(clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        results: list[Mapping[str, Any]] = []
        rlock = threading.Lock()
        threads = []

        def worker() -> None:
            loop = asyncio.new_event_loop()
            try:
                resp = loop.run_until_complete(
                    cache.enforce(_req(session_id=f"s-{threading.get_ident()}"))
                )
                with rlock:
                    results.append(resp)
            finally:
                loop.close()

        for _ in range(20):
            threads.append(threading.Thread(target=worker))
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert all(r["decision"] == "allow" for r in results)
        assert len(results) == 20


# ---------------------------------------------------------------------------
# Latency acceptance
# ---------------------------------------------------------------------------


class TestLatency:
    @pytest.mark.asyncio
    async def test_cached_call_is_faster_than_fetch(self) -> None:
        """Acceptance: measured per-call overhead within target.

        A cache hit must be O(1) relative to the fetch round-trip. We assert a
        generous but real bound: a cache hit is at least 10x faster than a
        fetch that awaits a 50ms sleep (§13 target is "per-call overhead
        within target" — a 10x floor comfortably proves the cache, not the
        fetch, is on the hot path).
        """
        fetch_count = 0

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            nonlocal fetch_count
            fetch_count += 1
            await asyncio.sleep(0.05)  # simulate a 50ms enforce round-trip
            return _allow_response()  # built from real time.time()

        # Default (monotonic) clock so the entry persists across the real sleep.
        cache = EnforceAllowCache(fetch)

        t0 = time.perf_counter()
        await cache.enforce(_req())  # cold
        cold_ms = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        await cache.enforce(_req(session_id="s-warm"))  # warm
        warm_ms = (time.perf_counter() - t0) * 1000

        assert warm_ms < cold_ms / 10, (
            f"cache hit ({warm_ms:.3f}ms) must be >10x faster than cold fetch ({cold_ms:.3f}ms)"
        )
        assert fetch_count == 1


# ---------------------------------------------------------------------------
# Entry TTL bound — no stale-allow past the enforce allow_token's expires_at
# ---------------------------------------------------------------------------


class TestEntryTtlBound:
    @pytest.mark.asyncio
    async def test_entry_ttl_is_capped_at_enforce_expires_at(self) -> None:
        """The cache entry must expire no later than the enforce allow_token's
        expires_at — it cannot grant a token that enforce already expired."""
        clock = _FakeClock()

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            return _allow_response(ttl_seconds=30, clock=clock)  # token good 30s

        cache = EnforceAllowCache(fetch, clock=clock)
        await cache.enforce(_req())
        entry = cache._entries[enforce_cache_key(_req())]  # type: ignore[attr-defined]
        assert isinstance(entry, AllowCacheEntry)
        # The entry's expiry must be bounded by the fetched allow_token expiry,
        # not by the cache's own default TTL (which may be longer).
        assert entry.expires_at <= clock() + 30 + 1  # 1s slack for ISO parsing

    @pytest.mark.asyncio
    async def test_entry_ttl_under_default_monotonic_clock_is_bounded_by_token(self) -> None:
        """Production path: default ``time.monotonic`` clock + an enforce
        ``expires_at`` built from ``time.time()``. The entry TTL must still be
        bounded by the (shorter) token expiry, never the 30s default.
        """
        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            # enforce says the allow_token is good for only 5s
            return _allow_response(ttl_seconds=5)

        cache = EnforceAllowCache(fetch)  # default monotonic clock
        await cache.enforce(_req())
        entry = cache._entries[enforce_cache_key(_req())]  # type: ignore[attr-defined]
        assert isinstance(entry, AllowCacheEntry)
        # default_ttl is 30s, token expires in ~5s → entry must be ≤ ~5s, not 30s.
        now_monotonic = time.monotonic()
        assert entry.expires_at - now_monotonic <= 5.5


# ---------------------------------------------------------------------------
# Invalidation
# ---------------------------------------------------------------------------


class TestInvalidation:
    @pytest.mark.asyncio
    async def test_invalidate_drops_a_cached_allow(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _allow_response(clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        await cache.enforce(_req())
        assert len(calls) == 1

        cache.invalidate(_req())
        await cache.enforce(_req())  # must refetch after invalidation
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_clear_drops_all_cached_allows(self) -> None:
        clock = _FakeClock()
        calls: list[Mapping[str, Any]] = []

        async def fetch(req: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(req)
            return _allow_response(clock=clock)

        cache = EnforceAllowCache(fetch, clock=clock)
        await cache.enforce(_req())
        await cache.enforce(_req(tool_id="gmail__messages_list"))
        assert len(calls) == 2

        cache.clear()
        await cache.enforce(_req())
        await cache.enforce(_req(tool_id="gmail__messages_list"))
        assert len(calls) == 4, "clear() must evict all entries"