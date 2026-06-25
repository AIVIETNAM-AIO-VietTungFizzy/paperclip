import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { enforceRoutes } from "../routes/enforce.js";

const ORIGINAL_CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN;

function createApp(db?: unknown) {
  const app = express();
  app.use(express.json());
  app.use("/api/core", enforceRoutes(db as any));
  return { app };
}

interface MockQueryRecorder {
  whereCalls: unknown[][];
  joinCalls: unknown[];
}

/**
 * Returns true when a drizzle predicate references the
 * `connectorToolRegistry.namespacedName` column. Drizzle stores the DB
 * column name (`namespaced_name`) on the chunk object's `.name` property,
 * and the real schema contains circular references (`PgTable.id.table` →
 * table), so `JSON.stringify` throws. We walk the predicate tree with a
 * visited set and look for any chunk whose `name === "namespaced_name"`,
 * distinguishing the new query shape (and(... eq(namespacedName) ...)) from
 * the old buggy shape (eq(tenantId) alone) without depending on private
 * drizzle APIs.
 */
function predicateHasNamespacedName(predicate: unknown): boolean {
  const seen = new WeakSet();
  const stack: unknown[] = [predicate];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || node === undefined) continue;
    if (typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if ((node as { name?: unknown }).name === "namespaced_name") return true;
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
    } else {
      for (const value of Object.values(node as Record<string, unknown>)) {
        stack.push(value);
      }
    }
  }
  return false;
}

/**
 * Mock Db for the new enforce implementation. The mock is **predicate-aware**:
 * `where()` receives an `and(eq(tenantId), eq(namespacedName))` predicate on
 * the new query shape, but the old buggy code called `where(eq(tenantId))`
 * alone. We return `[]` (tool_not_registered) for tenantId-only predicates
 * and the canned `toolRows` only when a `namespacedName` predicate is
 * present, so the C1 regression test fails against the old code.
 *
 * Records `where`/`innerJoin` arguments so tests can assert the namespace
 * predicate is present (I2).
 */
function buildMockDb(toolRows: unknown[], recorder: MockQueryRecorder) {
  const whereFn = vi.fn().mockImplementation((predicate: unknown) => {
    recorder.whereCalls.push([predicate]);
    // Simulate DB semantics: a tenantId-only predicate (the old query
    // shape) never matches the namespaced tool row the test provides, so
    // the buggy code would see an empty result and deny with
    // tool_not_registered. Only the namespacedName-scoped predicate (the
    // new query shape) returns the canned row.
    return predicateHasNamespacedName(predicate) ? chainRows : chainEmpty;
  });
  const innerJoinFn = vi.fn().mockImplementation((...args: unknown[]) => {
    recorder.joinCalls.push(args);
    return chainRows;
  });
  const chainEmpty = Object.assign(Promise.resolve([]), {
    from: vi.fn().mockReturnThis(),
    innerJoin: innerJoinFn,
    where: whereFn,
    limit: vi.fn().mockReturnThis(),
  });
  const chainRows = Object.assign(Promise.resolve(toolRows), {
    from: vi.fn().mockReturnThis(),
    innerJoin: innerJoinFn,
    where: whereFn,
    limit: vi.fn().mockReturnThis(),
  });
  return {
    select: vi.fn().mockReturnValue(chainRows),
  } as unknown as Parameters<typeof enforceRoutes>[0];
}

describe("POST /api/core/enforce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CP_SERVICE_TOKEN = "test-cp-token";
  });

  afterEach(() => {
    if (ORIGINAL_CP_SERVICE_TOKEN === undefined) {
      delete process.env.CP_SERVICE_TOKEN;
    } else {
      process.env.CP_SERVICE_TOKEN = ORIGINAL_CP_SERVICE_TOKEN;
    }
    vi.restoreAllMocks();
  });

  it("returns 401 when no auth header is provided", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .send({ tenant_id: "t-1", tool_id: "gmail__send_email" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("returns 400 when tenant_id or tool_id is missing", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tool_id");
  });

  it("allows built-in tools (no __ separator)", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "builtin_tool" });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("allow");
  });

  it("allows namespaced tool that is enabled in the registry", async () => {
    const toolRows = [
      { namespacedName: "gmail__send_email", enabled: true, pending: false, riskClass: "connector", approvalClass: "auto", requiresApproval: false },
    ];
    const recorder: MockQueryRecorder = { whereCalls: [], joinCalls: [] };
    const mockDb = buildMockDb(toolRows, recorder);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "gmail__send_email" });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("allow");
    expect(res.body.risk_class).toBe("connector");
    expect(res.body.approval_class).toBe("auto");
    // I2: the query must be scoped by namespacedName, not just tenantId.
    expect(recorder.whereCalls.length).toBeGreaterThan(0);
    expect(predicateHasNamespacedName(recorder.whereCalls[0])).toBe(true);
  });

  it("denies namespaced tool that is disabled in the registry", async () => {
    const toolRows = [
      { namespacedName: "gmail__delete_email", enabled: false, pending: false, riskClass: "connector", approvalClass: "auto", requiresApproval: false },
    ];
    const recorder: MockQueryRecorder = { whereCalls: [], joinCalls: [] };
    const mockDb = buildMockDb(toolRows, recorder);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "gmail__delete_email" });

    expect(res.status).toBe(403);
    expect(res.body.decision).toBe("deny");
    expect(res.body.reason).toContain("disabled");
  });

  it("denies pending tools", async () => {
    const toolRows = [
      { namespacedName: "gmail__new_tool", enabled: true, pending: true, riskClass: "connector", approvalClass: "manual", requiresApproval: true },
    ];
    const mockDb = buildMockDb(toolRows, { whereCalls: [], joinCalls: [] });
    const { app } = createApp(mockDb);

    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "gmail__new_tool" });

    expect(res.status).toBe(403);
    expect(res.body.decision).toBe("deny");
    expect(res.body.reason).toContain("pending");
  });

  it("fail-closed: denies namespaced tool with no registry row", async () => {
    const mockDb = buildMockDb([], { whereCalls: [], joinCalls: [] });
    const { app } = createApp(mockDb);

    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "unknownns__tool_x" });

    expect(res.status).toBe(403);
    expect(res.body.decision).toBe("deny");
    expect(res.body.reason).toContain("not_registered");
  });

  it("returns 503 when no db is provided for namespaced tool", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "gmail__send_email" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "database_not_available" });
  });

  // C1 regression: a tenant with two connectors must resolve the registry row
  // for the connector that actually owns the tool, not whichever
  // tenant_connector row the DB returns first. Previously the query filtered
  // tenantConnectors only by tenantId and took the first row, so a tool on a
  // second connector was wrongly denied as tool_not_registered.
  it("resolves the correct tenant_connector for multi-connector tenants (tool on second connector)", async () => {
    const toolRows = [
      { namespacedName: "slack__post_message", enabled: true, pending: false, riskClass: "connector", approvalClass: "auto", requiresApproval: false },
    ];
    const recorder: MockQueryRecorder = { whereCalls: [], joinCalls: [] };
    const mockDb = buildMockDb(toolRows, recorder);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "slack__post_message" });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("allow");
    // C1 + I2: the query must be scoped by namespacedName so the slack row is
    // selected even though gmail is also configured for this tenant. The
    // predicate-aware mock returns [] for tenantId-only queries (the old
    // shape), so this assertion only passes when the new query shape is used.
    expect(recorder.whereCalls.length).toBeGreaterThan(0);
    expect(predicateHasNamespacedName(recorder.whereCalls[0])).toBe(true);
  });

  // C2 regression: a caller posting tool_id as a non-string (e.g. an object
  // {"__":"x"}) must get 400, not fall through to the builtin-tool short-
  // circuit via String(tool_id) → "[object Object]" (no "__"). Enforce is
  // directly exposed behind only a service token, so input validation matters.
  it("returns 400 when tool_id is a non-string value (object)", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: { __: "x" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tool_id");
  });

  // C2 regression: tenant_id must also be a string; a number must 400.
  it("returns 400 when tenant_id is a non-string value (number)", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: 12345, tool_id: "gmail__send_email" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tenant_id");
  });

  // C2 regression: tool_id as an array must also be rejected with 400.
  it("returns 400 when tool_id is a non-string value (array)", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: ["gmail__send_email"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tool_id");
  });

  // I2 regression: enforce must accept and pass through employee_id so the
  // policy matrix can make per-employee decisions. The gateway forwards
  // employee_id; enforce must not drop it silently. We verify it's accepted
  // without error and the allow decision still works (the mock db ignores it,
  // but the route must not 400 on its presence).
  it("accepts employee_id in the request body without error", async () => {
    const toolRows = [
      { namespacedName: "gmail__send_email", enabled: true, pending: false, riskClass: "connector", approvalClass: "auto", requiresApproval: false },
    ];
    const mockDb = buildMockDb(toolRows, { whereCalls: [], joinCalls: [] });
    const { app } = createApp(mockDb);

    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "gmail__send_email", employee_id: "emp-42" });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("allow");
  });
});
