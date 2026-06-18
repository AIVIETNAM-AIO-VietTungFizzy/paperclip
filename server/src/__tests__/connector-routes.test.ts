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
const mockConnectorToolRegistryTable = vi.hoisted(() => ({}));

const mockLogActivity = vi.hoisted(() => vi.fn());

const mockCanEnableConnector = vi.hoisted(() => vi.fn().mockResolvedValue({ allowed: true }));
const mockHandshake = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));

const mockMCPClient = vi.hoisted(() => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    request: vi.fn(),
  };
  return {
    Client: vi.fn(function () { return mockClient; }),
    __mockClient: mockClient,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: mockMCPClient.Client,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  const MockTransport = class {
    constructor(url: URL, opts?: any) {}
  };
  return { StreamableHTTPClientTransport: MockTransport };
});

vi.mock("@paperclipai/db", () => ({
  connectors: mockConnectorsTable,
  tenantConnectors: mockTenantConnectorsTable,
  connectorToolRegistry: mockConnectorToolRegistryTable,
}));

vi.mock("../services/connector-entitlement.js", () => ({
  connectorEntitlementService: vi.fn(() => ({
    canEnableConnector: mockCanEnableConnector,
    getEnabledConnectorsForTenant: vi.fn(),
    getEntitledConnectorIds: vi.fn(),
  })),
}));

vi.mock("../services/connector-handshake.js", () => ({
  connectorHandshakeService: vi.fn(() => ({
    handshake: mockHandshake,
  })),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

let connectorRoutes: typeof import("../routes/connectors.js").connectorRoutes;
let errorHandler: typeof import("../middleware/index.js").errorHandler;

function createApp(actorOverrides: Partial<Express.Request["actor"]> = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
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

function setupSelect(rows: unknown[]) {
  const chain = makeChain(rows);
  mockDb.select.mockReturnValue(chain);
  return chain;
}

function setupSelectSequence(rowsArray: unknown[][]) {
  const chains = rowsArray.map((rows) => makeChain(rows));
  mockDb.select.mockImplementation(() => chains.shift()!);
}

function setupInsert(rows: unknown[]) {
  const chain: any = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
  };
  mockDb.insert.mockReturnValue(chain);
  return chain;
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

function setupDelete() {
  const chain: any = {
    where: vi.fn().mockReturnThis(),
  };
  mockDb.delete.mockReturnValue(chain);
  return chain;
}

describe("connector routes", () => {
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

  describe("GET /api/connectors", () => {
    it("returns all connectors ordered by name", async () => {
      const mockConnectors = [
        { id: "1", connectorKey: "deerflow", connectorName: "DeerFlow" },
        { id: "2", connectorKey: "microfish", connectorName: "MicroFish" },
      ];
      setupSelect(mockConnectors);

      const app = createApp();
      const res = await request(app).get("/api/connectors");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockConnectors);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe("POST /api/connectors", () => {
    it("creates a connector and returns 201", async () => {
      const newConnector = {
        id: "1",
        connectorKey: "deerflow",
        connectorName: "DeerFlow",
        description: null,
        endpointUrl: null,
        hostingMode: "remote",
        authType: null,
        credentialSchema: [],
        allowedPackages: [],
      };
      setupInsert([newConnector]);

      const app = createApp();
      const res = await request(app)
        .post("/api/connectors")
        .send({ connectorKey: "deerflow", connectorName: "DeerFlow" });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(newConnector);
      expect(mockLogActivity).toHaveBeenCalled();
    });

    it("rejects invalid connectorKey", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/connectors")
        .send({ connectorKey: "INVALID KEY!", connectorName: "Bad" });

      expect(res.status).toBe(400);
    });

    it("rejects missing connectorName", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/connectors")
        .send({ connectorKey: "deerflow" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/connectors/:id", () => {
    it("returns a connector by id", async () => {
      const connector = { id: "1", connectorKey: "deerflow", connectorName: "DeerFlow" };
      setupSelect([connector]);

      const app = createApp();
      const res = await request(app).get("/api/connectors/1");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(connector);
    });

    it("returns 404 for unknown connector", async () => {
      setupSelect([]);

      const app = createApp();
      const res = await request(app).get("/api/connectors/999");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("connector_not_found");
    });
  });

  describe("PATCH /api/connectors/:id", () => {
    it("updates a connector and returns it", async () => {
      const existing = { id: "1", connectorKey: "deerflow", connectorName: "DeerFlow" };
      const updated = { ...existing, connectorName: "DeerFlow Updated" };

      setupSelectSequence([[existing], [updated]]);
      setupUpdate([updated]);

      const app = createApp();
      const res = await request(app)
        .patch("/api/connectors/1")
        .send({ connectorName: "DeerFlow Updated" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(mockLogActivity).toHaveBeenCalled();
    });

    it("returns 404 for unknown connector", async () => {
      setupSelect([]);

      const app = createApp();
      const res = await request(app)
        .patch("/api/connectors/999")
        .send({ connectorName: "Nope" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/connectors/:id", () => {
    it("deletes a connector and returns 204", async () => {
      const existing = { id: "1", connectorKey: "deerflow", connectorName: "DeerFlow" };
      setupSelectSequence([[existing]]);
      setupDelete();

      const app = createApp();
      const res = await request(app).delete("/api/connectors/1");

      expect(res.status).toBe(204);
      expect(mockLogActivity).toHaveBeenCalled();
    });

    it("returns 404 for unknown connector", async () => {
      setupSelect([]);

      const app = createApp();
      const res = await request(app).delete("/api/connectors/999");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/companies/:companyId/connectors", () => {
    it("returns connectors with enabled status for tenant", async () => {
      const enabledConnectors = [
        { id: "tc1", tenantId: "company1", connectorId: "c1", status: "enabled" },
      ];
      const allConnectors = [
        { id: "c1", connectorKey: "deerflow", connectorName: "DeerFlow", status: "active" },
        { id: "c2", connectorKey: "microfish", connectorName: "MicroFish", status: "active" },
      ];

      setupSelectSequence([enabledConnectors, allConnectors]);

      const app = createApp({ companyIds: ["company1"] });
      const res = await request(app).get("/api/companies/company1/connectors");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const deerflow = res.body.find((c: any) => c.connectorKey === "deerflow");
      expect(deerflow).toBeDefined();
      expect(deerflow.enabled).toBe(true);
      const microfish = res.body.find((c: any) => c.connectorKey === "microfish");
      expect(microfish).toBeDefined();
      expect(microfish.enabled).toBe(false);
    });
  });

  describe("POST /api/companies/:companyId/connectors/:connectorId/enable", () => {
    it("enables a connector and returns 200 on success", async () => {
      const connector = { id: "c1", connectorKey: "deerflow", connectorName: "DeerFlow", status: "active", endpointUrl: "http://example.com/mcp" };
      const tc = { id: "tc1", tenantId: "company1", connectorId: "c1", status: "enabled" };

      setupSelectSequence([[connector]]);
      setupInsert([tc]);

      const app = createApp({ companyIds: ["company1"] });
      const res = await request(app)
        .post("/api/companies/company1/connectors/c1/enable")
        .send({ namespace: "deerflow" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("enabled");
    });

    it("returns 404 for unknown connector", async () => {
      setupSelectSequence([[]]);

      const app = createApp({ companyIds: ["company1"] });
      const res = await request(app)
        .post("/api/companies/company1/connectors/unknown/enable")
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/connectors/test-endpoint", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns error when endpointUrl is missing", async () => {
      const app = createApp();
      const res = await request(app)
        .post("/api/connectors/test-endpoint")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain("required");
    });

    it("returns tools on successful probe", async () => {
      const fakeTools = [
        { name: "get_weather", description: "Get weather data" },
        { name: "send_email", description: "Send an email" },
      ];
      mockMCPClient.__mockClient.listTools.mockResolvedValue({ tools: fakeTools });

      const app = createApp();
      const res = await request(app)
        .post("/api/connectors/test-endpoint")
        .send({ endpointUrl: "http://localhost:9999/mcp" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.tools).toEqual(fakeTools);
    });

    it("returns error on probe failure", async () => {
      mockMCPClient.__mockClient.connect.mockRejectedValue(new Error("Connection refused"));

      const app = createApp();
      const res = await request(app)
        .post("/api/connectors/test-endpoint")
        .send({ endpointUrl: "http://invalid:9999/mcp" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBeTruthy();
    });

    it("does NOT write to database", async () => {
      mockMCPClient.__mockClient.listTools.mockResolvedValue({ tools: [] });

      const app = createApp();
      await request(app)
        .post("/api/connectors/test-endpoint")
        .send({ endpointUrl: "http://localhost:9999/mcp" });

      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/companies/:companyId/connectors/:connectorId/disable", () => {
    it("disables a connector and returns disabled status", async () => {
      const existing = { id: "tc1", tenantId: "company1", connectorId: "c1", status: "enabled" };
      setupSelectSequence([[existing]]);
      setupDelete();

      const app = createApp({ companyIds: ["company1"] });
      const res = await request(app)
        .post("/api/companies/company1/connectors/c1/disable");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("disabled");
    });

    it("returns 404 for unknown tenant connector", async () => {
      setupSelectSequence([[]]);

      const app = createApp({ companyIds: ["company1"] });
      const res = await request(app)
        .post("/api/companies/company1/connectors/unknown/disable");

      expect(res.status).toBe(404);
    });
  });
});
