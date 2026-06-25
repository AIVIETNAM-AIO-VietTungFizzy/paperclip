import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const clientRequestMock = vi.fn();
const closeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../../modules/runtime/connector-client-pool.js", () => ({
  ConnectorClientPool: vi.fn().mockImplementation(function () {
    return {
      getOrCreateClient: vi.fn().mockResolvedValue({
        request: clientRequestMock,
        close: closeMock,
      }),
      teardown: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe("connector-gateway allowlist + enforce", () => {
  let app;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    originalFetch = globalThis.fetch;
    process.env.CP_URL = "http://cp.test";
    process.env.CP_SERVICE_TOKEN = "test-token";
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.CP_URL;
    delete process.env.CP_SERVICE_TOKEN;
    vi.restoreAllMocks();
  });

  async function createGatewayApp() {
    const express = (await import("express")).default;
    const { createConnectorGateway } = await import("../../../../src/connector-gateway.js");
    const app = express();
    app.use(express.json());
    app.use("/connector", createConnectorGateway());
    return app;
  }

  function mockFetch(responses) {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      for (const [pattern, response] of Object.entries(responses)) {
        if (urlStr.includes(pattern)) {
          return {
            ok: response.ok,
            status: response.ok ? 200 : 404,
            json: async () => response.json,
          };
        }
      }
      return { ok: false, status: 502, json: async () => ({ error: "no_mock" }) };
    });
  }

  it("filters connector tools by enabledTools allowlist in /tools/list", async () => {
    const request = (await import("supertest")).default;

    mockFetch({
      "enabled-connectors": {
        ok: true,
        json: [
          {
            connectorKey: "gmail",
            namespace: "gmail",
            resolvedEndpoint: "http://gmail:3001",
            enabledTools: ["gmail__send_email"],
            pendingTools: ["gmail__list_emails"],
          },
        ],
      },
      "mcp-sdk/tools/list": {
        ok: true,
        json: { tools: [{ name: "builtin_tool" }] },
      },
    });

    clientRequestMock.mockResolvedValue({
      tools: [
        { name: "send_email", description: "Send email" },
        { name: "list_emails", description: "List emails" },
      ],
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/list")
      .send({ tenant_id: "tenant-1" });

    expect(res.status).toBe(200);
    const toolNames = res.body.tools.map((t) => t.name);
    expect(toolNames).toContain("builtin_tool");
    expect(toolNames).toContain("gmail__send_email");
    expect(toolNames).not.toContain("gmail__list_emails");
  });

  it("passes through all connector tools when enabledTools is absent (empty-safe)", async () => {
    const request = (await import("supertest")).default;

    mockFetch({
      "enabled-connectors": {
        ok: true,
        json: [
          {
            connectorKey: "gmail",
            namespace: "gmail",
            resolvedEndpoint: "http://gmail:3001",
          },
        ],
      },
      "mcp-sdk/tools/list": {
        ok: true,
        json: { tools: [] },
      },
    });

    clientRequestMock.mockResolvedValue({
      tools: [
        { name: "send_email", description: "Send email" },
        { name: "list_emails", description: "List emails" },
      ],
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/list")
      .send({ tenant_id: "tenant-1" });

    expect(res.status).toBe(200);
    const toolNames = res.body.tools.map((t) => t.name);
    expect(toolNames).toContain("gmail__send_email");
    expect(toolNames).toContain("gmail__list_emails");
  });

  it("rejects a tool call not in enabledTools before calling connector", async () => {
    const request = (await import("supertest")).default;

    mockFetch({
      "connector-by-namespace/gmail": {
        ok: true,
        json: {
          connectorKey: "gmail",
          resolvedEndpoint: "http://gmail:3001",
          packageTier: "free",
          enabledTools: ["gmail__send_email"],
        },
      },
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__delete_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  it("allows a tool call that is in enabledTools and enforce passes", async () => {
    const request = (await import("supertest")).default;

    mockFetch({
      "connector-by-namespace/gmail": {
        ok: true,
        json: {
          connectorKey: "gmail",
          resolvedEndpoint: "http://gmail:3001",
          packageTier: "free",
          enabledTools: ["gmail__send_email"],
        },
      },
      "api/core/enforce": {
        ok: true,
        json: { decision: "allow" },
      },
    });

    clientRequestMock.mockResolvedValue({
      content: [{ type: "text", text: "sent" }],
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: { to: "x@y.com" },
      });

    expect(res.status).toBe(200);
    expect(res.body.content).toBeDefined();
  });

  it("fails closed when enforce returns non-OK", async () => {
    const request = (await import("supertest")).default;

    mockFetch({
      "connector-by-namespace/gmail": {
        ok: true,
        json: {
          connectorKey: "gmail",
          resolvedEndpoint: "http://gmail:3001",
          packageTier: "free",
          enabledTools: ["gmail__send_email"],
        },
      },
      "api/core/enforce": {
        ok: false,
        json: { decision: "deny" },
      },
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });
});