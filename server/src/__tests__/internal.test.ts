import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// Tagged captures for the `eq`/`and`/`inArray` predicates the routes build, so
// tests can assert which column/value each `where(...)` filters on without
// depending on drizzle's internal SQL shape (mirrors the pattern in
// connector-skill-toggle-routes.test.ts). The most recent and(...) group is
// recorded in `lastAndArgs` for the registry-query assertion below.
const predCalls: Array<{ column: unknown; value: unknown }> = [];
let lastAndArgs: unknown[] = [];
const mockEq = vi.hoisted(() => vi.fn((column: unknown, value: unknown) => {
  predCalls.push({ column, value });
  return { kind: "eq", column, value };
}));
const mockAnd = vi.hoisted(() => vi.fn((...args: unknown[]) => {
  lastAndArgs = args;
  return { kind: "and", args };
}));
const mockInArray = vi.hoisted(() => vi.fn((column: unknown, values: unknown[]) => ({
  kind: "inArray", column, values,
})));

vi.mock("drizzle-orm", () => ({ eq: mockEq, and: mockAnd, inArray: mockInArray, notInArray: mockInArray }));

const mockConnectorsTable = vi.hoisted(() => ({}));
const mockTenantConnectorsTable = vi.hoisted(() => ({}));
const mockConnectorToolRegistryTable = vi.hoisted(() => ({
  tenantConnectorId: "tenantConnectorId",
  tenantId: "tenantId",
  connectorId: "connectorId",
  toolName: "toolName",
  toolType: "toolType",
  enabled: "enabled",
  pending: "pending",
  namespacedName: "namespacedName",
}));

vi.mock("@paperclipai/db", () => ({
  connectors: mockConnectorsTable,
  tenantConnectors: mockTenantConnectorsTable,
  connectorToolRegistry: mockConnectorToolRegistryTable,
}));

import { internalRoutes } from "../routes/internal.js";
import { createEntitlementStore } from "../services/entitlement-store.js";

const ORIGINAL_CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN;

function createApp(db?: unknown) {
  const store = createEntitlementStore();
  const app = express();
  app.use(express.json());
  app.use("/api/runtime/internal", internalRoutes(store, db));
  return { app, store };
}

describe("POST /api/runtime/internal/sync/entitlements", () => {
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
      .post("/api/runtime/internal/sync/entitlements")
      .send({ tenantId: "tenant-1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("returns 401 when the token does not match CP_SERVICE_TOKEN", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer wrong-token")
      .send({ tenantId: "tenant-1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("returns 200 with accepted status when the token matches", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenantId: "tenant-1",
        subscriptionTier: "pro",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
  });

  it("stores subscription tier and makes it queryable by tenantId", async () => {
    const { app, store } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenantId: "tenant-1",
        subscriptionTier: "pro",
        companies: ["company-a", "company-b"],
      });

    expect(res.status).toBe(200);
    expect(store.getTierForCompany("company-a")).toBe("pro");
    expect(store.getTierForCompany("company-b")).toBe("pro");
  });

  it("stores subscription tier keyed by tenantId directly when no companies", async () => {
    const { app, store } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenantId: "mega-corp",
        subscriptionTier: "enterprise",
      });

    expect(res.status).toBe(200);
    expect(store.getTierForCompany("mega-corp")).toBe("enterprise");
  });

  it("accepts snake_case CP payload and stores it", async () => {
    const { app, store } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenant_id: "tenant-2",
        subscription_tier: "L3",
      });

    expect(res.status).toBe(200);
    expect(store.getTierForCompany("tenant-2")).toBe("L3");
  });

  it("returns 400 when tenantId is missing", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ subscriptionTier: "pro" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tenantId");
  });

  it("returns 400 when subscriptionTier is missing", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("subscriptionTier");
  });

  it("returns 200 with X-Service-Token header (CP→runtime auth style)", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-cp-token")
      .send({ tenant_id: "tenant-1", subscription_tier: "pro" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
  });

  it("returns 401 with wrong X-Service-Token header", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "wrong-token")
      .send({ tenant_id: "tenant-1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("updates tier on subsequent calls", async () => {
    const { app, store } = createApp();

    // Initial: L3
    await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "L3", companies: ["company-a"] });
    expect(store.getTierForCompany("company-a")).toBe("L3");

    // Downgrade: L1
    await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "L1", companies: ["company-a"] });
    expect(store.getTierForCompany("company-a")).toBe("L1");
  });

  it("disables tenant connectors when package tier downgrade removes entitlement", async () => {
    const mockDb = buildMockDb([
      { id: "conn-1", allowedPackages: ["pro", "enterprise"] },
      { id: "conn-2", allowedPackages: [] },
      { id: "conn-3", allowedPackages: ["enterprise"] },
    ]);

    const { app, store } = createApp(mockDb);

    store.setTenantTier("tenant-1", "enterprise", ["company-a"]);

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "free", companies: ["company-a"] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.updateSetMock).toHaveBeenCalledWith({
      status: "disabled",
      lastError: "package_tier_changed",
      updatedAt: expect.any(Date),
    });
  });

  it("does not disable connectors when all connectors are entitled for the tier", async () => {
    const mockDb = buildMockDb([
      { id: "conn-1", allowedPackages: ["pro", "enterprise"] },
      { id: "conn-2", allowedPackages: [] },
    ]);

    const { app, store } = createApp(mockDb);

    store.setTenantTier("tenant-1", "pro", ["company-a"]);

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "pro", companies: ["company-a"] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not fail when no db is provided (backward compat)", async () => {
    const { app, store } = createApp();

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "free" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
  });
});

describe("GET /api/runtime/internal/tenants/:tenantId/enabled-connectors", () => {
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
      .get("/api/runtime/internal/tenants/tenant-1/enabled-connectors");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("returns 503 when no db is provided", async () => {
    const { app } = createApp();
    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/enabled-connectors")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "database_not_available" });
  });

  it("returns enabled connectors for a tenant", async () => {
    const mockRows = [
      { id: "tc-1", connectorKey: "gmail", connectorName: "Gmail", namespace: "gmail", resolvedEndpoint: "http://gmail:3001", status: "enabled" },
    ];
    const mockDb = buildMockDbForInternalRoutes(mockRows);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/enabled-connectors")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { ...mockRows[0], enabledTools: [], pendingTools: [] },
    ]);
  });

  it("returns empty array when no connectors are enabled", async () => {
    const mockDb = buildMockDbForInternalRoutes([]);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/enabled-connectors")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("includes enabledTools and pendingTools from connector_tool_registry", async () => {
    const connectorRows = [
      { id: "tc-1", connectorKey: "gmail", connectorName: "Gmail", namespace: "gmail", resolvedEndpoint: "http://gmail:3001", status: "enabled" },
    ];
    const toolRows = [
      { tenantConnectorId: "tc-1", namespacedName: "gmail__send_email", enabled: true, pending: false },
      { tenantConnectorId: "tc-1", namespacedName: "gmail__list_emails", enabled: false, pending: true },
    ];
    const mockDb = buildMockDbWithTools(connectorRows, toolRows);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/enabled-connectors")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      connectorKey: "gmail",
      namespace: "gmail",
      enabledTools: ["gmail__send_email"],
      pendingTools: ["gmail__list_emails"],
    });
  });

  it("omits enabledTools/pendingTools when registry has no rows (pass-through)", async () => {
    const connectorRows = [
      { id: "tc-1", connectorKey: "gmail", connectorName: "Gmail", namespace: "gmail", resolvedEndpoint: "http://gmail:3001", status: "enabled" },
    ];
    const mockDb = buildMockDbWithTools(connectorRows, []);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/enabled-connectors")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ connectorKey: "gmail" });
    expect(res.body[0].enabledTools).toEqual([]);
    expect(res.body[0].pendingTools).toEqual([]);
  });

  it("excludes tool_type='skill' rows from enabledTools/pendingTools (LLG-4.3 I2: no double-count with skill projection)", async () => {
    // A skill row (tool_type='skill') and an MCP-tool row (tool_type='tool')
    // sharing the same tenantConnectorId must not both surface in
    // enabledTools — only MCP-tool rows belong on the gateway MCP-tool
    // allowlist; skill rows are projected via skill-permissions-projection.
    const connectorRows = [
      { id: "tc-1", connectorKey: "gmail", connectorName: "Gmail", namespace: "gmail", resolvedEndpoint: "http://gmail:3001", status: "enabled" },
    ];
    const toolRows = [
      { tenantConnectorId: "tc-1", namespacedName: "gmail__send_email", enabled: true, pending: false, toolType: "tool" },
      { tenantConnectorId: "tc-1", namespacedName: "gmail__summarize_skill", enabled: true, pending: false, toolType: "skill" },
      { tenantConnectorId: "tc-1", namespacedName: "gmail__draft_skill", enabled: false, pending: true, toolType: "skill" },
    ];
    const mockDb = buildMockDbWithTools(connectorRows, toolRows);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/enabled-connectors")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // Only the MCP-tool row appears in enabledTools; skill rows are excluded.
    expect(res.body[0].enabledTools).toEqual(["gmail__send_email"]);
    expect(res.body[0].pendingTools).toEqual([]);
  });
});

describe("GET /api/runtime/internal/tenants/:tenantId/connector-by-namespace/:namespace", () => {
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
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/gmail");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("returns 503 when no db is provided", async () => {
    const { app } = createApp();
    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/gmail")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "database_not_available" });
  });

  it("returns 404 when connector is not found", async () => {
    const mockDb = buildMockDbForInternalRoutes([]);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/unknown")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "connector_not_found" });
  });

  it("returns connector info with packageTier when found", async () => {
    const mockRow = {
      id: "tc-1",
      connectorKey: "gmail",
      connectorName: "Gmail",
      namespace: "gmail",
      resolvedEndpoint: "http://gmail:3001",
      allowedPackages: ["starter", "growth", "enterprise"],
    };
    const mockDb = buildMockDbForInternalRoutes([mockRow]);
    const { app, store } = createApp(mockDb);
    store.setTenantTier("tenant-1", "growth", []);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/gmail")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...mockRow, packageTier: "growth", enabledTools: [] });
  });

  it("returns denied packageTier when tenant tier is not in allowedPackages", async () => {
    const mockRow = {
      id: "tc-1",
      connectorKey: "gmail",
      connectorName: "Gmail",
      namespace: "gmail",
      resolvedEndpoint: "http://gmail:3001",
      allowedPackages: ["enterprise"],
    };
    const mockDb = buildMockDbForInternalRoutes([mockRow]);
    const { app, store } = createApp(mockDb);
    store.setTenantTier("tenant-1", "free", []);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/gmail")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body.packageTier).toBe("denied");
  });

  it("defaults to free tier when no entitlement is configured", async () => {
    const mockRow = {
      id: "tc-1",
      connectorKey: "gmail",
      connectorName: "Gmail",
      namespace: "gmail",
      resolvedEndpoint: "http://gmail:3001",
      allowedPackages: ["free", "starter"],
    };
    const mockDb = buildMockDbForInternalRoutes([mockRow]);
    const { app } = createApp(mockDb);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/gmail")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body.packageTier).toBe("free");
  });

  it("includes enabledTools from connector_tool_registry when found", async () => {
    const mockRow = {
      id: "tc-1",
      connectorKey: "gmail",
      connectorName: "Gmail",
      namespace: "gmail",
      resolvedEndpoint: "http://gmail:3001",
      allowedPackages: ["free"],
    };
    const toolRows = [
      { tenantConnectorId: "tc-1", namespacedName: "gmail__send_email", enabled: true, pending: false },
    ];
    const mockDb = buildMockDbWithTools([mockRow], toolRows);
    const { app, store } = createApp(mockDb);
    store.setTenantTier("tenant-1", "free", []);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/gmail")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connectorKey: "gmail", packageTier: "free" });
    expect(res.body.enabledTools).toEqual(["gmail__send_email"]);
  });

  it("excludes tool_type='skill' rows from connector-by-namespace enabledTools (LLG-4.3 I2)", async () => {
    const mockRow = {
      id: "tc-1",
      connectorKey: "gmail",
      connectorName: "Gmail",
      namespace: "gmail",
      resolvedEndpoint: "http://gmail:3001",
      allowedPackages: ["free"],
    };
    const toolRows = [
      { tenantConnectorId: "tc-1", namespacedName: "gmail__send_email", enabled: true, pending: false, toolType: "tool" },
      { tenantConnectorId: "tc-1", namespacedName: "gmail__summarize_skill", enabled: true, pending: false, toolType: "skill" },
    ];
    const mockDb = buildMockDbWithTools([mockRow], toolRows);
    const { app, store } = createApp(mockDb);
    store.setTenantTier("tenant-1", "free", []);

    const res = await request(app)
      .get("/api/runtime/internal/tenants/tenant-1/connector-by-namespace/gmail")
      .set("Authorization", "Bearer test-cp-token");

    expect(res.status).toBe(200);
    // Only the MCP-tool row surfaces in enabledTools; the skill row is excluded
    // (it is projected via skill-permissions-projection, not the gateway allowlist).
    expect(res.body.enabledTools).toEqual(["gmail__send_email"]);
  });
});

function buildMockDb(connectorsResult: Array<{ id: string; allowedPackages: string[] }>) {
  const whereMock = vi.fn().mockReturnThis();
  const thenMock = vi.fn((resolve: (value: unknown) => void) => resolve(connectorsResult));
  const updateSetMock = vi.fn().mockReturnThis();
  const updateWhereMock = vi.fn().mockReturnThis();

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: whereMock.mockReturnValue({ then: thenMock }),
      }),
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    then: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: updateSetMock.mockReturnValue({
        where: updateWhereMock.mockReturnValue({}),
      }),
    }),
    set: vi.fn().mockReturnThis(),
    updateSetMock,
    updateWhereMock,
  };
}

function buildMockDbForInternalRoutes(rows: unknown[]) {
  let selectCallCount = 0;
  const selectFn = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      const promise = Promise.resolve(rows);
      return Object.assign(promise, {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
    }
    const toolPromise = Promise.resolve([]);
    return Object.assign(toolPromise, {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      inArray: vi.fn().mockReturnThis(),
    });
  });
  return {
    select: selectFn,
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    inArray: vi.fn().mockReturnThis(),
    then: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  };
}

function buildMockDbWithTools(connectorRows: unknown[], toolRows: unknown[]) {
  let selectCallCount = 0;
  const selectFn = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      const promise = Promise.resolve(connectorRows);
      return Object.assign(promise, {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      });
    }
    // Second select: the connector_tool_registry query. Honor the toolType
    // predicate the route passes so tests prove the filter is wired (rather
    // than returning rows verbatim regardless of `where`). Predicates here are
    // the tagged {kind:"and", args:[{kind:"eq",column,value},...]} objects
    // emitted by the mocked drizzle-orm above.
    const whereMock = vi.fn().mockImplementation((predicate: any) => {
      const filtered = applyPredicateFilter(toolRows, predicate);
      const promise = Promise.resolve(filtered);
      return Object.assign(promise, {
        from: vi.fn().mockReturnThis(),
        inArray: vi.fn().mockReturnThis(),
      });
    });
    return Object.assign(Promise.resolve([]), {
      from: vi.fn().mockReturnThis(),
      where: whereMock,
      inArray: vi.fn().mockReturnThis(),
    });
  });
  return {
    select: selectFn,
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    inArray: vi.fn().mockReturnThis(),
    then: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  };
}

// Apply a tagged `and(eq(...), inArray(...), ...)` predicate to the row set.
// Only filters on `toolType` (the LLG-4.3 I2 column) and falls back to the
// full row set when no toolType predicate is present.
function applyPredicateFilter(rows: unknown[], predicate: any): unknown[] {
  const args = predicate?.kind === "and" ? predicate.args : [predicate];
  const toolTypePred = args.find((a: any) => isEqOn(a, "toolType"));
  if (!toolTypePred) return rows;
  return rows.filter((r: any) => (r.toolType ?? "tool") === toolTypePred.value);
}

function isEqOn(pred: any, columnName: string): any | undefined {
  if (!pred || pred.kind !== "eq") return undefined;
  const col = pred.column;
  const colName = typeof col === "string" ? col : (col?.name ?? col?.columnName ?? (typeof col === "symbol" ? col.description : undefined));
  if (colName === columnName) return pred;
  return undefined;
}