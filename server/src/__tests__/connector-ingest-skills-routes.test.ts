import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
const mockConnectorsTable = vi.hoisted(() => ({}));
const mockTenantConnectorsTable = vi.hoisted(() => ({}));
const mockConnectorToolRegistryTable = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockIngest = vi.hoisted(() => vi.fn());

const mockMCPClient = vi.hoisted(() => ({ Client: vi.fn(function () { return { connect: vi.fn(), listTools: vi.fn(), close: vi.fn(), request: vi.fn() }; }) }));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: mockMCPClient.Client }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => { class T { constructor() {} } return { StreamableHTTPClientTransport: T }; });
vi.mock("@paperclipai/db", () => ({ connectors: mockConnectorsTable, tenantConnectors: mockTenantConnectorsTable, connectorToolRegistry: mockConnectorToolRegistryTable }));
vi.mock("../services/connector-entitlement.js", () => ({ connectorEntitlementService: vi.fn(() => ({ canEnableConnector: vi.fn(), getEnabledConnectorsForTenant: vi.fn(), getEntitledConnectorIds: vi.fn() })) }));
vi.mock("../services/connector-handshake.js", () => ({ connectorHandshakeService: vi.fn(() => ({ handshake: vi.fn() })) }));
vi.mock("../services/agent-card-ingestion.js", () => ({ agentCardIngestionService: vi.fn(() => ({ ingestSkills: mockIngest })) }));
vi.mock("../services/skill-permissions-projection.js", () => ({ skillPermissionsProjectionService: vi.fn(() => ({ projectSkillPermissions: vi.fn().mockResolvedValue({}) })) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: mockLogActivity }));

let connectorRoutes: typeof import("../routes/connectors.js").connectorRoutes;
let errorHandler: typeof import("../middleware/index.js").errorHandler;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = { type: "board", userId: "local-board", companyIds: [], source: "local_implicit", isInstanceAdmin: false };
    next();
  });
  app.use("/api", connectorRoutes(mockDb as any));
  app.use(errorHandler);
  return app;
}

function makeChain(rows: unknown[]) {
  const chain: any = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(rows), limit: vi.fn().mockReturnThis(), then: vi.fn((fn: any) => Promise.resolve(fn(rows))) };
  return chain;
}
function setupSelectSequence(rowsArray: unknown[][]) {
  const chains = rowsArray.map((rows) => makeChain(rows));
  mockDb.select.mockImplementation(() => chains.shift()!);
}

describe("POST /api/companies/:companyId/connectors/:connectorId/ingest-skills", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockIngest.mockReset();
    const [routes, middleware] = await Promise.all([import("../routes/connectors.js"), import("../middleware/index.js")]);
    connectorRoutes = routes.connectorRoutes;
    errorHandler = middleware.errorHandler;
  });
  afterEach(() => vi.clearAllMocks());

  it("ingests structured skills and returns 200 with the count", async () => {
    const connector = { id: "conn-1", connectorKey: "research", endpointUrl: "http://agent/.well-known/agent.json" };
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    setupSelectSequence([[connector], [tcRow]]);
    mockIngest.mockResolvedValue({ success: true, ingestedSkillCount: 3 });

    const app = createApp();
    const res = await request(app).post("/api/companies/company-1/connectors/conn-1/ingest-skills").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, ingestedSkillCount: 3 });
    expect(mockIngest).toHaveBeenCalledWith("company-1", "conn-1", "http://agent/.well-known/agent.json", "research");
  });

  it("uses cardUrl from the request body when provided", async () => {
    const connector = { id: "conn-1", connectorKey: "research", endpointUrl: "http://default/.well-known/agent.json" };
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    setupSelectSequence([[connector], [tcRow]]);
    mockIngest.mockResolvedValue({ success: true, ingestedSkillCount: 1 });

    const app = createApp();
    const res = await request(app).post("/api/companies/company-1/connectors/conn-1/ingest-skills").send({ cardUrl: "http://override/.well-known/agent.json" });

    expect(res.status).toBe(200);
    expect(mockIngest).toHaveBeenCalledWith("company-1", "conn-1", "http://override/.well-known/agent.json", "research");
  });

  it("returns 404 when the connector does not exist", async () => {
    setupSelectSequence([[], []]);
    const app = createApp();
    const res = await request(app).post("/api/companies/company-1/connectors/conn-1/ingest-skills").send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "connector_not_found" });
  });

  it("returns 404 when the tenant connector does not exist", async () => {
    const connector = { id: "conn-1", connectorKey: "research", endpointUrl: "http://x/.well-known/agent.json" };
    setupSelectSequence([[connector], []]);
    const app = createApp();
    const res = await request(app).post("/api/companies/company-1/connectors/conn-1/ingest-skills").send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "tenant_connector_not_found" });
  });

  it("returns 502 when ingestion fails", async () => {
    const connector = { id: "conn-1", connectorKey: "research", endpointUrl: "http://x/.well-known/agent.json" };
    const tcRow = { id: "tc-1", tenantId: "company-1", connectorId: "conn-1", namespace: "research" };
    setupSelectSequence([[connector], [tcRow]]);
    mockIngest.mockResolvedValue({ success: false, ingestedSkillCount: 0, error: "boom" });

    const app = createApp();
    const res = await request(app).post("/api/companies/company-1/connectors/conn-1/ingest-skills").send({});
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false, error: "boom" });
  });
});