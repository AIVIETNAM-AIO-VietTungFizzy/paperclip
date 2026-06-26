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
      .set("X-Service-Token", "test-token")
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
      .set("X-Service-Token", "test-token")
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
      .set("X-Service-Token", "test-token")
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
      .set("X-Service-Token", "test-token")
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
      .set("X-Service-Token", "test-token")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  // C2 regression: enforce can return HTTP 200 with decision "deny". The
  // gateway must parse the body and reject, not just check `ok`.
  it("fails closed when enforce returns 200 with decision deny", async () => {
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
        json: { decision: "deny", reason: "tool_disabled" },
      },
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .set("X-Service-Token", "test-token")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  // C2 regression: enforce returns 200 with requires_approval: true for tools
  // requiring an approval gate. The gateway must NOT dispatch the tool call;
  // it must return 403 so the caller can surface the pending-approval state.
  it("fails closed when enforce returns 200 with requires_approval true (no dispatch)", async () => {
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
        json: { decision: "allow", requires_approval: true },
      },
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .set("X-Service-Token", "test-token")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  // C2 regression: enforce returns HTTP 200 but the body is malformed /
  // unreadable (e.g. truncated JSON, non-JSON content). The gateway must
  // fail closed — 403, no dispatch — rather than treating an unreadable
  // decision as an implicit allow.
  it("fails closed when enforce returns 200 with unreadable body (malformed JSON)", async () => {
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

    // Override the enforce fetch response so .json() rejects, simulating a
    // malformed/unreadable body on an otherwise-OK (200) response.
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("connector-by-namespace/gmail")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            connectorKey: "gmail",
            resolvedEndpoint: "http://gmail:3001",
            packageTier: "free",
            enabledTools: ["gmail__send_email"],
          }),
        };
      }
      if (urlStr.includes("api/core/enforce")) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token in JSON");
          },
        };
      }
      return { ok: false, status: 502, json: async () => ({ error: "no_mock" }) };
    });

    // Silence the expected console.warn from the fail-closed path.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .set("X-Service-Token", "test-token")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  // C1 regression: enforce returns HTTP 200 with a well-formed JSON body that
  // lacks a `decision` field entirely (e.g. `200 {}`). The gateway must NOT
  // fall through to dispatch — only an explicit `decision === "allow"` with
  // no `requires_approval` may dispatch. Every other case → 403.
  it("fails closed when enforce returns 200 with no decision field", async () => {
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
        json: {},
      },
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .set("X-Service-Token", "test-token")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  // C1 regression: enforce returns HTTP 200 with an unknown `decision` string
  // (e.g. "allow_with_caveats"). The gateway must reject it — only the exact
  // value "allow" (and no requires_approval) may dispatch.
  it("fails closed when enforce returns 200 with unknown decision value", async () => {
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
        json: { decision: "allow_with_caveats" },
      },
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .set("X-Service-Token", "test-token")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  // I1 regression: the gateway must not trust a caller-supplied tenant_id
  // without authentication. Any request without a valid service token must
  // be rejected before reaching the CP or any connector.
  it("rejects unauthenticated /tools/call (no service token)", async () => {
    const request = (await import("supertest")).default;

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("service_token");
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  // I1 regression: spoofed x-tenant-id header with a valid service token
  // still works, but a valid service token with NO tenant_id in body or
  // header must be rejected (400), not silently trusted.
  it("rejects /tools/call with valid token but no tenant_id", async () => {
    const request = (await import("supertest")).default;

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .set("X-Service-Token", "test-token")
      .send({
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tenant_id");
  });

  // I3 regression: when packageTier is "denied", the gateway must hard-403
  // before calling enforce. Previously the gateway proceeded to enforce,
  // which returned allow for any enabled+non-pending tool, creating a
  // window where a denied-package tenant could still call tools.
  it("hard-403 when packageTier is denied, before calling enforce", async () => {
    const request = (await import("supertest")).default;

    mockFetch({
      "connector-by-namespace/gmail": {
        ok: true,
        json: {
          connectorKey: "gmail",
          resolvedEndpoint: "http://gmail:3001",
          packageTier: "denied",
          enabledTools: ["gmail__send_email"],
        },
      },
    });

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/call")
      .set("X-Service-Token", "test-token")
      .send({
        tenant_id: "tenant-1",
        name: "gmail__send_email",
        arguments: {},
      });

    expect(res.status).toBe(403);
    expect(res.body.isError).toBe(true);
    expect(res.body.content[0].text).toContain("package");
    // enforce must not have been called
    const fetchCalls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(fetchCalls.some((u) => u.includes("api/core/enforce"))).toBe(false);
    expect(clientRequestMock).not.toHaveBeenCalled();
  });

  // I4 regression: the gateway must not leak internal error details (stack
  // traces, connector endpoint URLs, raw error strings) to the caller. The
  // outer catch must return a static message, logging detail server-side.
  it("does not leak internal error details in 500 response", async () => {
    const request = (await import("supertest")).default;

    // Force the enabled-connectors fetch to throw a connector-URL-bearing
    // error so the outer catch path is exercised.
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("ECONNREFUSED http://internal-connector:3001/mcp secret_token=abc123");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    app = await createGatewayApp();

    const res = await request(app)
      .post("/connector/tools/list")
      .set("X-Service-Token", "test-token")
      .send({ tenant_id: "tenant-1" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("gateway_error");
    // The response message must NOT contain the internal URL or secret.
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("internal-connector");
    expect(bodyStr).not.toContain("secret_token");
    expect(bodyStr).not.toContain("ECONNREFUSED");
    // But the detail IS logged server-side.
    expect(errorSpy).toHaveBeenCalled();
  });
});
