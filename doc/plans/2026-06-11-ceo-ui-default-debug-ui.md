# CEO UI as Default, Original UI as Debug

## Goal

Make the ceo-ui the default UI served at `/` while exposing the original full-featured UI at `/debug-ui` for debugging/development access.

## Changes

| # | File | Change |
|---|------|--------|
| 1 | `ceo-ui/vite.config.ts` | `base: "/ceo/"` → `base: "/"` |
| 2 | `ui/vite.config.ts` | Add `base: "/debug-ui/"` |
| 3 | `ui/src/main.tsx` | Add `routerBasename` from `import.meta.env.BASE_URL`; fix `sw.js` path to use `BASE_URL` |
| 4 | `server/src/app.ts` | **Static**: swap mounts — ceo-ui at `/`, original UI at `/debug-ui`. **Vite-dev**: serve ceo-ui as main vite middleware; add second vite instance for original UI at `/debug-ui`. |
| 5 | `server/src/vite-html-renderer.ts` | Accept optional `indexHtmlPath` parameter so we can point to a different `index.html` location. |

The Dockerfile already builds both `ui` and `ceo-ui` — no change needed.