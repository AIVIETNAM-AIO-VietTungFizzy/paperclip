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

function buildMockDbForEnforce(toolRows: unknown[]) {
  const selectFn = vi.fn().mockImplementation(() => {
    const promise = Promise.resolve(toolRows);
    return Object.assign(promise, {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    });
  });
  return {
    select: selectFn,
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

function buildMockDbForEnforceWithTc(tcRows: unknown[], toolRows: unknown[]) {
  let selectCallCount = 0;
  const selectFn = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      const promise = Promise.resolve(tcRows);
      return Object.assign(promise, {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
    }
    const toolPromise = Promise.resolve(toolRows);
    return Object.assign(toolPromise, {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    });
  });
  return {
    select: selectFn,
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
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
    const mockDb = buildMockDbForEnforceWithTc([{ id: "tc-1" }], toolRows);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .post("/api/core/enforce")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenant_id: "t-1", tool_id: "gmail__send_email" });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("allow");
    expect(res.body.risk_class).toBe("connector");
    expect(res.body.approval_class).toBe("auto");
  });

  it("denies namespaced tool that is disabled in the registry", async () => {
    const toolRows = [
      { namespacedName: "gmail__delete_email", enabled: false, pending: false, riskClass: "connector", approvalClass: "auto", requiresApproval: false },
    ];
    const mockDb = buildMockDbForEnforceWithTc([{ id: "tc-1" }], toolRows);
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
    const mockDb = buildMockDbForEnforceWithTc([{ id: "tc-1" }], toolRows);
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
    const mockDb = buildMockDbForEnforceWithTc([{ id: "tc-1" }], []);
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
});