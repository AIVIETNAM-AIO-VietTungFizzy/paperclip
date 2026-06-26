import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const mockConnectorsTable = vi.hoisted(() => ({}));
const mockTenantConnectorsTable = vi.hoisted(() => ({}));
const mockConnectorToolRegistryTable = vi.hoisted(() => ({
  tenantConnectorId: Symbol("col.tenantConnectorId"),
  tenantId: Symbol("col.tenantId"),
  connectorId: Symbol("col.connectorId"),
  toolName: Symbol("col.toolName"),
  toolType: Symbol("col.toolType"),
}));

// Tagged predicate captures so tests can assert which column/value the route
// filters on without depending on drizzle's internal SQL shape.
const predCalls: Array<{ column: unknown; value: unknown }> = [];
const andCalls: unknown[] = [];
const mockEq = vi.hoisted(() => vi.fn((column: unknown, value: unknown) => {
  predCalls.push({ column, value });
  return { kind: "eq", column, value };
}));
const mockAnd = vi.hoisted(() => vi.fn((...args: unknown[]) => {
  andCalls.push(args);
  return { kind: "and", args };
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockProjection = vi.hoisted(() => vi.fn().mockResolvedValue({}));

const mockMCPClient = vi.hoisted(() => ({
  Client: vi.fn(function () { return { connect: vi.fn(), listTools: vi.fn(), close: vi.fn(), request: vi.fn() }; }),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: mockMCPClient.Client }));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  class MockTransport { constructor(_url: URL, _opts?: any) {} }
  return { StreamableHTTPClientTransport: MockTransport };
});

vi.mock("@paperclipai/db", () => ({
  connectors: mockConnectorsTable,
  tenantConnectors: mockTenantConnectorsTable,
  connectorToolRegistry: mockConnectorToolRegistryTable,
}));

vi.mock("drizzle-orm", () => ({ eq: mockEq, and: mockAnd }));

vi.mock("../services/connector-entitlement.js", () => ({
  connectorEntitlementService: vi.fn(() => ({
    canEnableConnector: vi.fn().mockResolvedValue({ allowed: true }),
    getEnabledConnectorsForTenant: vi.fn(),
    getEntitledConnectorIds: vi.fn(),
  })),
}));

vi.mock("../services/connector-handshake.js", () => ({
  connectorHandshakeService: vi.fn(() => ({ handshake: vi.fn().mockResolvedValue({ success: true }) })),
}));

vi.mock("../services/skill-permissions-projection.js", () => ({
  skillPermissionsProjectionService: vi.fn(() => ({ projectSkillPermissions: mockProjection })),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

let connectorRoutes: typeof import("../routes/connectors.js").connectorRoutes;
let errorHandler: typeof import("../middleware/index.js").errorHandler;

function createApp(actorOverrides: Partial<Express.Request["actor"]> = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = {
      type: "board",
      userId: "local-board",
      companyIds: [],
      source: "local_implicit",
      isInstanceAdmin: false,
      ...actorOverrides,
    };
    next();
  });
  app.use("/api", connectorRoutes(mockDb as any));
  app.use(errorHandler);
  return app;
}

function makeChain(rows: unknown[]) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn((fn: any) => Promise.resolve(fn(rows))),
  };
  return chain;
}

function setupSelectSequence(rowsArray: unknown[][]) {
  const chains = rowsArray.map((rows) => makeChain(rows));
  mockDb.select.mockImplementation(() => chains.shift()!);
}

function setupUpdate(rows: unknown[]) {
  const chain: any = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  mockDb.update.mockReturnValue(chain);
  return chain;
}

describe("PATCH /api/companies/:companyId/connectors/:connectorId/skills/:skillId", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const [routes, middleware] = await Promise.all([
      import("../routes/connectors.js"),
      import("../middleware/index.js"),
    ]);
    connectorRoutes = routes.connectorRoutes;
    errorHandler = middleware.errorHandler;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enables a skill and persists the change on connector_tool_registry", async () => {
    // First select: tenant_connector lookup. Second select: registry row lookup.
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    const registryRow = { id: "reg-1", tenantConnectorId: "tc-1", toolName: "search", toolType: "skill", enabled: false };
    setupSelectSequence([[tcRow], [registryRow]]);
    const updateChain = setupUpdate([{ ...registryRow, enabled: true }]);

    const app = createApp();
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/search")
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skillId: "search", enabled: true });
    // The persistence write must target the specific registry row by its id.
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(mockLogActivity).toHaveBeenCalled();
  });

  it("disables a skill and persists enabled=false", async () => {
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    const registryRow = { id: "reg-1", tenantConnectorId: "tc-1", toolName: "search", toolType: "skill", enabled: true };
    setupSelectSequence([[tcRow], [registryRow]]);
    const updateChain = setupUpdate([{ ...registryRow, enabled: false }]);

    const app = createApp();
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/search")
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("returns 404 when the tenant connector does not exist", async () => {
    setupSelectSequence([[], []]);

    const app = createApp();
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/search")
      .send({ enabled: true });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "tenant_connector_not_found" });
  });

  it("returns 404 when the skill is not in the registry", async () => {
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    setupSelectSequence([[tcRow], []]);

    const app = createApp();
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/missing")
      .send({ enabled: true });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "skill_not_found" });
  });

  it("rejects non-board actors", async () => {
    const app = createApp({ type: "agent", userId: "agent-1", isInstanceAdmin: false });
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/search")
      .send({ enabled: true });

    expect(res.status).toBe(403);
  });

  it("rejects enabled values other than boolean", async () => {
    const app = createApp();
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/search")
      .send({ enabled: "yes" });

    expect(res.status).toBe(400);
  });

  it("filters the registry lookup by tool_type='skill' so MCP-tool rows cannot be toggled through the skills endpoint", async () => {
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    predCalls.length = 0;
    andCalls.length = 0;
    setupSelectSequence([[tcRow], []]);

    const app = createApp();
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/search")
      .send({ enabled: true });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "skill_not_found" });

    // The second and() group is the registry-row lookup; it must include a
    // toolType='skill' predicate alongside the tenantConnectorId and toolName ones.
    const registryAnd = andCalls[1] as unknown[];
    expect(registryAnd).toBeDefined();
    const predValues = registryAnd.map((p: any) => p.value);
    expect(predValues).toContain("skill");
    expect(predValues).toContain("search");
  });

  it("returns 404 skill_not_found when a row with a matching toolName exists but toolType='tool'", async () => {
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    setupSelectSequence([[tcRow], []]);

    const app = createApp();
    const res = await request(app)
      .patch("/api/companies/company-1/connectors/conn-1/skills/search")
      .send({ enabled: true });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "skill_not_found" });
  });
});