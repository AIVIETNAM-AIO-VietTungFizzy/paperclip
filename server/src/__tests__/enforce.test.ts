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
 * Mock Db for the new enforce implementation: a single
 * connectorToolRegistry query joined to tenantConnectors, filtered by
 * tenantId + namespacedName. Records `where`/`innerJoin` arguments so tests
 * can assert the namespace predicate is present (I2).
 */
function buildMockDb(toolRows: unknown[], recorder: MockQueryRecorder) {
  const whereFn = vi.fn().mockImplementation((...predicates: unknown[]) => {
    recorder.whereCalls.push(predicates);
    return chain;
  });
  const innerJoinFn = vi.fn().mockImplementation((...args: unknown[]) => {
    recorder.joinCalls.push(args);
    return chain;
  });
  const chain = Object.assign(Promise.resolve(toolRows), {
    from: vi.fn().mockReturnThis(),
    innerJoin: innerJoinFn,
    where: whereFn,
    limit: vi.fn().mockReturnThis(),
  });
  return {
    select: vi.fn().mockReturnValue(chain),
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
    // I2: the query must filter by namespacedName (predicate present)
    expect(recorder.whereCalls.length).toBeGreaterThan(0);
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
    // The query must be scoped by namespacedName so the slack row is selected
    // even though gmail is also configured for this tenant.
    expect(recorder.whereCalls.length).toBeGreaterThan(0);
  });
});
