# CEO UI as Default — Implementation Summary

## Goal

Make the ceo-ui the default UI served at `/` (replacing the original full UI) while exposing the original UI at `/debug-ui` for debugging/development access.

## Source Changes (4 files)

| File | Change |
|------|--------|
| `ceo-ui/vite.config.ts` | `base: "/ceo/"` → `base: "/"` — so built assets resolve at root |
| `ui/vite.config.ts` | Added `base: "/debug-ui/"` — so built assets resolve under `/debug-ui/` |
| `ui/src/main.tsx` | Added `routerBasename` from `import.meta.env.BASE_URL`; updated `sw.js` registration path to use `BASE_URL` prefix (mirrors ceo-ui pattern) |
| `server/src/app.ts` | Renamed `CEO_UI_MOUNT_PATH` → `DEBUG_UI_MOUNT_PATH = "/debug-ui"`. **Static mode**: original UI mounted at `/debug-ui`, ceo-ui at `/`. **Vite-dev mode**: ceo-ui served via Vite HMR middleware, original UI served from static build at `/debug-ui` |

### Verification

- The ceo-ui `main.tsx` already handles `BASE_URL === "/"` gracefully (sets `routerBasename = undefined`)
- The original UI `index.html` favicon paths are root-relative and work unchanged
- Each dynamically created workspace runs its own complete server instance with the same mount paths — no per-workspace changes needed
- `Dockerfile` already builds both `ui` and `ceo-ui` — no changes needed

## Docker Images

### Problem

Initial `workspace-ai/paperclip:patched` image had `USER node` at end of Dockerfile, causing entrypoint error: `failed switching to "node": operation not permitted`

### Root Cause

`scripts/docker-entrypoint.sh` expects to run as **root** so it can:
1. Remap `node` user UID/GID (`usermod`/`groupmod`)
2. Fix volume ownership (`chown -R node:node /paperclip`)
3. Drop privileges via `exec gosu node "$@"`

`USER node` at the end of the Dockerfile overrides the entrypoint's initial user, making `gosu` fail.

### Fix

Removed `USER node` from `Dockerfile.patch`. The image now inherits root from `FROM workspace-ai/paperclip:latest`.

### Result

| Image Tag | Status | Notes |
|-----------|--------|-------|
| `workspace-ai/paperclip:patched` | ✅ Built, fixed | Patch over `latest` — 3 packages recompiled |
| `workspace-ai/paperclip:rebuild` | ⏳ Background | Full clean rebuild from `Dockerfile` |
| `workspace-ai/paperclip:latest` | 🟡 Untouched | Not modified or retagged |

### Commands

```bash
# Patch image (7 min build)
docker build -f Dockerfile.patch -t workspace-ai/paperclip:patched .

# Full rebuild (background)
nohup docker build -t workspace-ai/paperclip:rebuild . > /tmp/docker-rebuild.log 2>&1 &
```

## Files Created

- `doc/plans/2026-06-11-ceo-ui-default-debug-ui.md` — initial plan
- `doc/plans/2026-06-11-ceo-ui-default-debug-ui-summary.md` — this summary
- `Dockerfile.patch` — patch Dockerfile for fast layered build