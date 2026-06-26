# Paperclip LiteLLM guardrails

Control-plane guardrails for the LiteLLM MCP/model gateway. Design source of
truth: `specs/2026-06-25-litellm-mcp-gateway-single-chokepoint.md`.

## Modules

| Module | Owner | Purpose |
|---|---|---|
| `identity.py` | LLG-1.1 | Map `UserAPIKeyAuth` → enforce body (tenant/employee/package/role). |
| `enforce_client.py` | LLG-1.1 | Async HTTP client for `POST /api/core/enforce`. |
| `pre_mcp_call.py` | LLG-1.1 | `pre_mcp_call` guardrail → enforce → allow/deny/require_approval. |
| `litellm_adapter.py` | LLG-1.1 | LiteLLM `CustomGuardrail` adapter wiring. |
| `enforce_allow_cache.py` | LLG-1.4 | In-process allow-decision cache (§13 latency mitigation). |
| `caching_enforce_client.py` | LLG-1.4 | `EnforceClient` wrapper that reuses the allow_token within TTL. |

## Enforce-allow caching (LLG-1.4)

Spec §13 mitigation: *"Cache enforce allow within short TTL; reuse
`allow_token`."*

`EnforceAllowCache` sits between a guardrail and `POST /api/core/enforce`.
Only `allow` decisions are cached; `deny` and `require_approval` are
re-evaluated on every call so policy changes take effect immediately.

### TTL

The cache entry TTL is the **minimum** of:

1. `DEFAULT_TTL_SECONDS = 30.0` (the guardrail's configured upper bound),
   configurable via `EnforceAllowCache(fetch, default_ttl_seconds=...)`, and
2. the enforce response's `expires_at` (the `allow_token`'s real expiry).

So an entry can never grant a token that enforce has already expired — no
stale-allow past TTL. The 30s default is comfortably below enforce's own 60s
`allow_token` ceiling.

### Cache key

`enforce_cache_key(request)` = `tenant_id | employee_id | tool_id | intent_kind`.

`session_id` is intentionally excluded — it drives enforce's idempotency
replay, not the allow cache. Two different sessions for the same
tenant/employee/tool reuse an allow within TTL (the latency win).
`intent_kind` is included so a `tool` call and a `dispatch` call for the
same resource cannot share an allow.

### Wiring

`CachingEnforceClient` wraps an `EnforceClient` and is a drop-in for
`PreMcpCallGuardrail(enforce_client=...)`:

```python
from guardrails import CachingEnforceClient, EnforceClient

client = CachingEnforceClient(EnforceClient.from_env(), default_ttl_seconds=30)
guard = PreMcpCallGuardrail(enforce_client=client)
```

Within TTL, repeated `allow` calls for the same tenant/employee/tool reuse the
cached `allow_token` (no enforce round-trip). `invalidate(body)` / `clear()`
evict entries on policy change.

### Thread safety

The cache uses a `threading.Lock` around reads + writes. The fetcher runs
outside the lock so concurrent guardrail calls don't serialize on the enforce
round-trip. Last writer wins on a race; an `allow` response is idempotent so
this is safe.

## Running tests

```sh
python3 -m pytest litellm/guardrails/tests/ -q
```