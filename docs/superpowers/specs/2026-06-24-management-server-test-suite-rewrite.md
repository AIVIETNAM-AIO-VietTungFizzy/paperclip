# Management Server Test Suite Rewrite

## Problem

The Paperclip management server (`server/`) test suite has grown to **281 test files, ~2,318 tests, ~112k LOC** under `src/__tests__/`. A full `vitest run` does not complete within a 10-minute heartbeat budget (the previous attempt on TUN-221 timed out before printing a summary). The suite has several structural problems that make it slow, brittle, and hard to delegate:

1. **No shared test harness.** Every integration test re-implements its own company/agent/issue seeding inline (e.g. `seedCompanyAndPlugin` is copy-pasted across at least 22 files). Fixtures and factories live nowhere reusable.
2. **Mixed test styles without convention.** Route tests use hand-rolled `createDb(row)` stubs (`auth-routes.test.ts`), `vi.hoisted` mock soup (`connector-routes.test.ts`), and supertest against `express()` apps — each file picks its own pattern. 92 of 281 files use `vi.mock`, often with partially-mocked modules that drift from real schemas.
3. **Embedded-postgres cost is paid per-file.** 76 files spin up their own `startEmbeddedPostgresTestDatabase` instance in `beforeAll`. With `maxConcurrency: 1` and `pool: forks`, this serializes 76 cold Postgres boots and makes the full suite impractically slow.
4. **Giant files mix unit and integration concerns.** `issues-service.test.ts` (4,571 lines), `workspace-runtime.test.ts` (3,743), `company-portability.test.ts` (3,721), `heartbeat-process-recovery.test.ts` (3,613) each bundle pure helper unit tests, service integration tests, and route smoke tests in one file. There is no way to run "just the unit tests" without paying the integration cost.
5. **No test categorization.** `vitest.config.ts` defines a single global pool. There is no way to run fast unit tests in CI while gating slow integration tests behind a flag. CI either runs everything (timeout) or nothing (no coverage).
6. **Foreign-key noise leaks into logs.** Integration tests that don't seed the full parent graph produce `environment_leases_issue_id_issues_id_fk` and `heartbeat_run_events_run_id_heartbeat_runs_id_fk` violations during teardown. These are test-harness bugs, not product bugs, but they pollute run logs and make real failures hard to spot.

The goal of this rewrite is a test suite that **completes in under 4 minutes on a single worker**, is **categorized into unit vs. integration tiers**, shares **one seeding harness**, and is **small enough per file that a delegated agent can own one slice**.

## Design

### Tier model

Split the suite into three explicit tiers, each with its own vitest project config and run command. Tags are enforced by directory + filename convention, not by inline `describe.skip`.

| Tier | Directory pattern | DB | Target runtime | Example |
|------|-------------------|----|----------------|---------|
| `unit` | `src/**/__tests-unit__/*.test.ts` or `*.unit.test.ts` co-located | none | <5s for the whole tier | `body-limits.test.ts`, `access-validators.test.ts` |
| `route` | `src/**/__tests-route__/*.test.ts` | mocked DB | <60s | `auth-routes.test.ts`, `connector-routes.test.ts` |
| `integration` | `src/__tests__/` (keep current path) | embedded-postgres | <4min | `issues-service.test.ts`, `heartbeat-process-recovery.test.ts` |

**Co-location rule.** Unit tests for a single module live next to it (`src/services/recovery/successful-run-handoff.test.ts` already does this). Route tests for `src/routes/foo.ts` live in `src/routes/__tests-route__/foo.test.ts`. Only cross-module integration tests stay in `src/__tests__/`.

**Filename suffix alternative.** To minimize churn in the first phase, files may also stay where they are and adopt a `.unit.test.ts` / `.route.test.ts` / `.integration.test.ts` suffix. The vitest `include`/`exclude` globs in each project pick them up. The directory convention is the end state; the suffix is the migration bridge.

### Vitest workspace config

Replace `vitest.config.ts` with `vitest.config.ts` that defines three `test` projects via `defineProject`/`projects`:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    isolate: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.{unit,}.test.ts", "src/**/__tests-unit__/**/*.test.ts"],
          exclude: ["src/__tests__/**", "src/**/__tests-route__/**", "**/*.route.test.ts", "**/*.integration.test.ts", ".worktrees/**", "node_modules/**"],
          pool: "forks",
          maxConcurrency: 4,
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: "route",
          include: ["src/**/__tests-route__/**/*.test.ts", "src/**/*.route.test.ts"],
          exclude: ["src/__tests__/**", "src/**/__tests-unit__/**", ".worktrees/**", "node_modules/**"],
          pool: "forks",
          maxConcurrency: 2,
          setupFiles: ["./src/__tests-route__/setup-supertest.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: ["**/*.unit.test.ts", "**/*.route.test.ts", ".worktrees/**", "node_modules/**"],
          pool: "forks",
          maxConcurrency: 1,
          maxWorkers: 1,
          minWorkers: 1,
          sequence: { concurrent: false, hooks: "list" },
          setupFiles: ["./src/__tests__/setup-supertest.ts"],
        },
      },
    ],
  },
});
```

Run targets in `package.json`:

- `test:unit` → `vitest run --project unit`
- `test:route` → `vitest run --project route`
- `test:integration` → `vitest run --project integration`
- `test` → `vitest run` (runs all projects in sequence by default; CI can call the tiers in parallel jobs)

### Shared seeding harness

Create `src/__tests__/harness/` (replaces ad-hoc `helpers/`):

- `db.ts` — exports `startTestDb()` (thin wrapper over `startEmbeddedPostgresTestDatabase` with a tagged prefix per tier) and `withTestDb(perFileSetup)` helper.
- `seed.ts` — exports `seedCompany(db, overrides?)`, `seedAgent(db, companyId, overrides?)`, `seedIssue(db, companyId, overrides?)`, `seedProject(db, companyId, overrides?)`, `seedRun(db, agentId, issueId, overrides?)`. Each returns the created row plus the db. These are the **only** seeding functions; integration tests compose them instead of inlining `db.insert(companies).values(...)`.
- `actor.ts` — exports `boardActor(companyId)`, `agentActor(agentId)`, `instanceAdminActor()` — single source of truth for the `req.actor` shape used by route tests.
- `app.ts` — exports `buildApp({ routes, db?, actor? })` that mounts a single route module on `express()` with `errorHandler` and the actor middleware. Replaces the per-file `createApp` pattern.
- `mocks.ts` — exports `mockDb(tables)` that returns a typed `vi.mocked` db stub with the chainable select/insert/update/delete shape route tests need. Replaces hand-rolled `createSelectChain`/`createUpdateChain`.

All 76 integration files migrate to `seed.ts` + `db.ts`. All 89 route-style files migrate to `app.ts` + `actor.ts` + `mocks.ts`.

### File splitting for the giants

Four files are too large to delegate or run quickly. Split each by concern, keeping the integration tier:

| Current | Split into |
|---------|-----------|
| `issues-service.test.ts` (4,571) | `issues-service-helpers.unit.test.ts` (clamp/derive helpers), `issues-service-list.integration.test.ts`, `issues-service-mutations.integration.test.ts`, `issues-service-relations.integration.test.ts` |
| `workspace-runtime.test.ts` (3,743) | `workspace-runtime-lifecycle.integration.test.ts`, `workspace-runtime-policy.integration.test.ts`, `workspace-runtime-routes.route.test.ts` |
| `company-portability.test.ts` (3,721) | `company-portability-export.integration.test.ts`, `company-portability-import.integration.test.ts`, `company-portability-roundtrip.integration.test.ts` |
| `heartbeat-process-recovery.test.ts` (3,613) | `heartbeat-process-recovery-stranded.integration.test.ts`, `heartbeat-process-recovery-continuation.integration.test.ts`, `heartbeat-process-recovery-delegation.integration.test.ts` |

Each split file targets <1,500 lines and one responsibility so a single delegated agent can own it end-to-end.

### Foreign-key noise fix

Add a `truncateAll(db)` helper in `harness/db.ts` that issues `TRUNCATE ... RESTART IDENTITY CASCADE` in dependency order, and call it from `afterEach` instead of per-table `db.delete` calls that miss FK parents. This eliminates the `environment_leases_issue_id_issues_id_fk` and `heartbeat_run_events_run_id_heartbeat_runs_id_fk` log noise.

### Migration phasing

The rewrite is mechanical but large. Phase it so each phase leaves the suite green and the CI story improves incrementally:

1. **Phase 1 — Harness + config (no test moves).** Add `harness/`, add the three-project `vitest.config.ts`, add `package.json` scripts. All existing files still run under `integration` because they live in `src/__tests__/`. Verify `test:unit`, `test:route`, `test:integration` each work (unit/route will be near-empty initially).
2. **Phase 2 — Extract unit tests.** Move pure-helper tests (no DB, no supertest) to `*.unit.test.ts` or `__tests-unit__/`. Target: ~60 files. Verify `test:unit` runs in <5s.
3. **Phase 3 — Extract route tests.** Move mocked-DB supertest tests to `__tests-route__/` or `*.route.test.ts`. Target: ~89 files. Verify `test:route` runs in <60s.
4. **Phase 4 — Migrate integration tests to harness.** Replace inline seeding with `harness/seed.ts` in all 76 embedded-postgres files. Replace per-file `afterEach` deletes with `truncateAll`. No file moves.
5. **Phase 5 — Split the giants.** Split the four >3,500-line files into the targets above.
5. **Phase 6 — CI wiring.** Add CI jobs: `unit` (fast, every PR), `route` (fast, every PR), `integration` (gated, nightly or on label).

Each phase is independently shippable and independently delegatable to a single agent.

### Out of scope

- Rewriting test assertions or changing what is tested. This is a structural rewrite, not a coverage change.
- Adding new tests for untested code paths. That is a follow-up initiative.
- Migrating off vitest or embedded-postgres. Both stay.
- Changing the product code under test to make it more testable. The harness absorbs current friction; product refactors are separate work.

## Acceptance criteria

- `pnpm test:unit` completes in under 5 seconds with zero DB dependencies.
- `pnpm test:route` completes in under 60 seconds with mocked DB only.
- `pnpm test:integration` completes in under 4 minutes on a single worker.
- `pnpm test` (all tiers) completes in under 5 minutes.
- No integration test file exceeds 1,500 lines.
- No `vi.hoisted` mock soup or hand-rolled `createDb` stub duplicated across files; all route tests use `harness/app.ts` + `harness/mocks.ts`.
- No inline `db.insert(companies).values(...)` seeding in integration tests; all use `harness/seed.ts`.
- Zero `*_fk` violation log lines during a clean `test:integration` run.
- CI runs `unit` and `route` on every PR; `integration` on nightly or labeled PRs.

## Files touched

1. `server/vitest.config.ts` — replace with three-project config
2. `server/package.json` — add `test:unit`, `test:route`, `test:integration` scripts
3. `server/src/__tests__/harness/db.ts` — new shared DB setup + `truncateAll`
4. `server/src/__tests__/harness/seed.ts` — new `seedCompany/Agent/Issue/Project/Run`
5. `server/src/__tests__/harness/actor.ts` — new `boardActor/agentActor/instanceAdminActor`
6. `server/src/__tests__/harness/app.ts` — new `buildApp` for route tests
7. `server/src/__tests__/harness/mocks.ts` — new `mockDb` chainable stub
8. `server/src/__tests__/helpers/embedded-postgres.ts` — re-export from `harness/db.ts` for backward compat
9. `server/src/__tests__/setup-supertest.ts` — move shared copy to `src/__tests-route__/setup-supertest.ts`; integration keeps its own
10. ~281 test files migrated across phases 2–5 (mechanical moves + seeding refactor + splits)

## Risks and mitigations

- **Risk:** Moving files breaks imports in non-test code that references test helpers. **Mitigation:** Phase 1 keeps `helpers/embedded-postgres.ts` as a re-export shim; grep for external consumers before each move.
- **Risk:** Splitting giant files drops tests. **Mitigation:** Each split copies the `describe` blocks verbatim into the new file and deletes from the old; the per-file test count is checked before/after.
- **Risk:** `mockDb` chainable stub doesn't match the real drizzle API surface for new tests. **Mitigation:** `mocks.ts` is typed against `ReturnType<typeof createDb>` so missing methods are compile errors, not runtime surprises.
- **Risk:** Integration tier still too slow after phase 4 because embedded-postgres boot dominates. **Mitigation:** Phase 4 also introduces a shared single-postgres-per-worker mode where `startTestDb()` caches the server and only creates/drops a schema per test file, cutting 76 boots to 1.