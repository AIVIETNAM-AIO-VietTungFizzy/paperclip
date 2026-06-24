# Implementation Plan — Management Server Test Suite Rewrite

Source spec: `docs/superpowers/specs/2026-06-24-management-server-test-suite-rewrite.md`
Issue: TUN-221

Each phase is independently shippable. Each phase is a delegation unit (one child issue, one engineer, verifiable on its own). Phases are ordered by dependency; phases 2–5 can partially parallelize once phase 1 lands.

## Phase 1 — Harness + vitest workspace config

**Goal:** Three-tier vitest config + shared harness scaffold, no test moves. Suite still green.

**Tasks (2–5 min each):**

1. Replace `server/vitest.config.ts` with the three-project config from the spec (`unit`, `route`, `integration`). Verify `npx vitest run --project unit` returns "no tests found" without error (tier is empty), `--project route` same, `--project integration` runs the existing `src/__tests__/**` suite.
2. Add `server/package.json` scripts: `test:unit`, `test:route`, `test:integration`, and keep `test` as `vitest run`. Verify `pnpm test:unit` exits 0.
3. Create `server/src/__tests__/harness/db.ts` exporting `startTestDb(prefix?)`, `withTestDb(fn)`, and `truncateAll(db)`. `startTestDb` wraps `startEmbeddedPostgresTestDatabase`; `truncateAll` issues `TRUNCATE ... RESTART IDENTITY CASCADE` across all tables in dependency order.
4. Create `server/src/__tests__/harness/seed.ts` exporting `seedCompany`, `seedAgent`, `seedIssue`, `seedProject`, `seedRun`. Each takes `db` + overrides, returns the row. Reuse the patterns already in `plugin-managed-agents.test.ts` and `access-service.test.ts`.
5. Create `server/src/__tests__/harness/actor.ts` exporting `boardActor(companyId)`, `agentActor(agentId)`, `instanceAdminActor()`. Match the `req.actor` shape from `connector-routes.test.ts` and `auth-routes.test.ts`.
6. Create `server/src/__tests__/harness/app.ts` exporting `buildApp({ routes, db?, actor? })` that mounts a single route module on `express()` with `errorHandler` and the actor middleware. Mirror the `createApp` pattern from `connector-routes.test.ts`.
7. Create `server/src/__tests__/harness/mocks.ts` exporting `mockDb(tables?)` returning a typed chainable stub (select/insert/update/delete) typed against `ReturnType<typeof createDb>`. Mirror `createSelectChain`/`createUpdateChain` from `auth-routes.test.ts`.
8. Move `server/src/__tests__/setup-supertest.ts` content into `server/src/__tests-route__/setup-supertest.ts` for the route tier; keep the integration tier copy as a re-export. Verify `pnpm test:route` still has supertest patched.
9. Make `server/src/__tests__/helpers/embedded-postgres.ts` re-export from `harness/db.ts` so existing files keep working.

**Verification:**
- `pnpm test:unit`, `pnpm test:route` exit 0 (near-empty tiers).
- `pnpm test:integration` runs the existing suite with no new failures vs. baseline.
- `pnpm typecheck` clean.

## Phase 2 — Extract unit tests

**Goal:** ~60 pure-helper test files moved to the `unit` tier. `pnpm test:unit` runs in <5s.

**Tasks:** For each file identified as pure-unit (no `embedded-postgres`, no `supertest`, no `vi.mock` of db/services):

1. Identify the file's import set. If it imports only from `src/` non-test modules and `vitest`, it's a unit candidate.
2. Move the file to `src/<module>/__tests-unit__/<name>.test.ts` (co-located) or rename to `<name>.unit.test.ts` in place.
3. Run `pnpm test:unit` after each batch of ~10 files to confirm they land in the `unit` project.
4. Confirm `pnpm test:integration` no longer lists them (they moved out of `src/__tests__/`).

**Candidate files (sample, verify by import scan):** `body-limits`, `access-validators`, `agent-permissions-service`, `agent-skill-contract`, `app-hmr-port`, `app-private-hostname-gate`, `app-vite-dev-routing`, `company-search-rate-limit-routes` (if no DB), `dev-runner-output`, `dev-runner-paths`, `dev-runner-snapshot`, `dev-runner-worktree`, `dev-server-status`, `dev-watch-ignore`, `environment-config` (helpers only), `environment-probe` (helpers only), `error-handler`, `express5-auth-wildcard`, `feedback-flush-controller`, `forbidden-tokens`, `grok-local-skill-sync`, `http-log-policy`, `instance-settings-service` (if pure), `invite-expiry`, `issue-tree-control-service-unit`, `logger-tz`, `paperclip-env`, `paperclip-skill-utils`, `project-list-metrics`, `project-shortname-resolution`, `quota-windows`, `quota-windows-service`, `recovery-classifiers`, `redaction`, `source-trust`, `static-index-html`, `trust-preset-resolver`, `vite-html-renderer`, `worktree-config`, plus the six co-located `*.test.ts` files under `src/services/`, `src/adapters/`.

**Verification:**
- `pnpm test:unit` <5s, all moved tests pass.
- `pnpm test:integration` unchanged pass rate, file count dropped by ~60.

## Phase 3 — Extract route tests

**Goal:** ~89 mocked-DB supertest tests moved to `route` tier. `pnpm test:route` runs in <60s.

**Tasks:** For each route-style file (uses `supertest` + mocked or stubbed db, no embedded-postgres):

1. Move to `src/routes/__tests-route__/<name>.test.ts` or rename `<name>.route.test.ts`.
2. Replace the file's hand-rolled `createApp`/`createDb` with `harness/app.ts` + `harness/actor.ts` + `harness/mocks.ts`. Keep the assertions identical.
3. Run `pnpm test:route` after each batch of ~10 files.

**Candidate files (sample):** `auth-routes`, `connector-routes`, `agent-instructions-routes`, `agent-live-run-routes`, `agent-permissions-routes`, `agent-skills-routes`, `agent-test-environment-routes`, `approval-routes-idempotency`, `auth-session-route`, `board-claim`, `bootstrap-claim-routes`, `cli-auth-routes`, `companies-route-path-guard`, `company-branding-route`, `company-portability-routes`, `company-search-rate-limit-routes`, `company-skills-routes`, `company-user-directory-route`, `document-annotation-routes`, `environment-routes`, `environment-selection-route-guards`, `execution-workspaces-routes`, `feedback-routes`, `health-dev-server-token`, `instance-database-backups-routes`, `instance-settings-routes`, `internal`, `invite-*` routes, `issue-*` routes (route subset), `llms-routes`, `multilingual-issues-routes`, `openapi-routes`, `openclaw-invite-prompt-route`, `permissions-upgrade-boundary-routes`, `plugin-routes-authz`, `plugin-scoped-api-routes`, `private-hostname-guard`, `project-routes-env`, `resource-memberships-routes`, `routines-routes`, `secrets-routes`, `sidebar-preferences-routes`, `teams-catalog-routes`, `user-profile-routes`, `workspace-runtime-routes-authz`.

**Verification:**
- `pnpm test:route` <60s, all moved tests pass.
- `pnpm test:integration` file count dropped by ~89.

## Phase 4 — Migrate integration tests to shared harness

**Goal:** All 76 embedded-postgres files use `harness/seed.ts` + `truncateAll`. No inline `db.insert(companies)` seeding. Zero FK violation log lines.

**Tasks:** Per file:

1. Replace inline `db.insert(companies).values(...)` / `db.insert(agents).values(...)` / etc. with `seedCompany(db, ...)`, `seedAgent(db, companyId, ...)`, etc.
2. Replace the `afterEach` per-table `db.delete(...)` chain with `await truncateAll(db)`.
3. Replace `startEmbeddedPostgresTestDatabase` direct calls with `startTestDb()`.
4. Run the single file to confirm green, then move to the next.

**Verification:**
- `pnpm test:integration` pass rate unchanged.
- `grep -rE "db\.insert\(companies\)" src/__tests__/` returns 0 matches outside `harness/seed.ts`.
- `grep -rE "environment_leases_issue_id_issues_id_fk|heartbeat_run_events_run_id_heartbeat_runs_id_fk" /tmp/vitest_integration.log` returns 0 matches.

## Phase 5 — Split the four giant files

**Goal:** No integration test file >1,500 lines.

**Tasks:** For each of `issues-service.test.ts`, `workspace-runtime.test.ts`, `company-portability.test.ts`, `heartbeat-process-recovery.test.ts`:

1. Inventory the `describe` blocks in the file.
2. Group describes by concern (list/mutations/relations, lifecycle/policy/routes, export/import/roundtrip, stranded/continuation/delegation).
3. Create the new target files (names in spec). Copy each `describe` block verbatim into the appropriate new file, including its helpers if any.
4. Delete the moved blocks from the original file (or delete the original entirely if fully split).
5. Run each new file individually to confirm the test count matches the original.
6. Confirm `pnpm test:integration` still passes.

**Verification:**
- `find src/__tests__ -name "*.test.ts" | xargs wc -l | sort -rn | head -5` shows no file >1,500 lines.
- Total test count across split files equals the original file's test count (no dropped tests).

## Phase 6 — CI wiring

**Goal:** CI runs `unit` + `route` on every PR; `integration` on nightly or labeled PRs.

**Tasks:**

1. Add `.github/workflows/server-tests.yml` (or extend the existing workflow) with three jobs: `unit`, `route`, `integration`.
2. `unit` and `route` run on `pull_request` for `server/**` paths.
3. `integration` runs on `schedule: cron(0 4 * * *)` and on `pull_request` with `labeled: server-integration`.
4. All jobs use `pnpm --filter @paperclipai/server test:<tier>`.

**Verification:**
- A PR touching `server/src/routes/foo.ts` triggers `unit` + `route` jobs, not `integration`.
- A nightly run triggers `integration` and reports a pass/fail status.
- A PR with the `server-integration` label triggers `integration`.

## Delegation matrix

| Phase | Owner | Depends on | Parallelizable? |
|-------|-------|-----------|-----------------|
| 1 | Lead Engineer | — | No (foundation) |
| 2 | Lead Engineer | 1 | Yes after 1 |
| 3 | Lead Engineer | 1 | Yes after 1, parallel with 2 |
| 4 | Lead Engineer | 1 | Yes after 1, parallel with 2/3 |
| 5 | Lead Engineer | 4 (for giant integration files) | Partially after 4 |
| 6 | Release Engineer | 1 | Yes after 1 |

Phases 2, 3, 4 can be split across multiple engineers once phase 1 lands. Phase 6 can run in parallel with 2–5.