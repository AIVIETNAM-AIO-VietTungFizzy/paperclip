import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const hoisted = vi.hoisted(() => {
  const requestMock = vi.fn();
  const getOrCreateClientMock = vi.fn();
  const ConnectorClientPoolMock = vi.fn(function () {
    return {
      getOrCreateClient: getOrCreateClientMock,
      releaseClient: vi.fn().mockResolvedValue(undefined),
      releaseAll: vi.fn().mockResolvedValue(undefined),
      teardown: vi.fn().mockResolvedValue(undefined),
    };
  });
  return { requestMock, getOrCreateClientMock, ConnectorClientPoolMock };
});

vi.mock("../../modules/runtime/connector-client-pool.js", () => ({
  ConnectorClientPool: hoisted.ConnectorClientPoolMock,
}));

const { requestMock, getOrCreateClientMock, ConnectorClientPoolMock } = hoisted;

import { createConnectorGateway } from "../connector-gateway.js";

const ORIGINAL_RUNTIME_SERVICE_TOKEN = process.env.RUNTIME_SERVICE_TOKEN;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/runtime/mcp-sdk", createConnectorGateway());
  return { app };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Connector Gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    requestMock.mockResolvedValue({ content: [{ type: "text", text: "default" }] });
    getOrCreateClientMock.mockReset();
    getOrCreateClientMock.mockResolvedValue({ request: requestMock });
    ConnectorClientPoolMock.mockClear();
    ConnectorClientPoolMock.mockImplementation(function () {
      return {
        getOrCreateClient: getOrCreateClientMock,
        releaseClient: vi.fn().mockResolvedValue(undefined),
        releaseAll: vi.fn().mockResolvedValue(undefined),
        teardown: vi.fn().mockResolvedValue(undefined),
      };
    });
    process.env.RUNTIME_SERVICE_TOKEN = "test-runtime-token";
  });

  afterEach(() => {
    if (ORIGINAL_RUNTIME_SERVICE_TOKEN === undefined) {
      delete process.env.RUNTIME_SERVICE_TOKEN;
    } else {
      process.env.RUNTIME_SERVICE_TOKEN = ORIGINAL_RUNTIME_SERVICE_TOKEN;
    }
    vi.restoreAllMocks();
  });

  describe("POST /tools/list auth", () => {
    it("returns 401 when no auth header is provided", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/list")
        .send({ tenant_id: "tenant-1" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "runtime_service_token_required" });
    });

    it("returns 401 when the token does not match RUNTIME_SERVICE_TOKEN", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/list")
        .set("X-Service-Token", "wrong-token")
        .send({ tenant_id: "tenant-1" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "runtime_service_token_required" });
    });
  });

  describe("POST /tools/call auth", () => {
    it("returns 401 when no auth header is provided", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .send({ tenant_id: "tenant-1", name: "some_tool" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "runtime_service_token_required" });
    });

    it("returns 401 when the token does not match RUNTIME_SERVICE_TOKEN", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "wrong-token")
        .send({ tenant_id: "tenant-1", name: "some_tool" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "runtime_service_token_required" });
    });

    it("returns 400 when tenant_id is missing", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({ name: "some_tool" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "tenant_id_required" });
    });

    it("returns 400 when tool name is missing", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: "tenant-1" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "tool_name_required" });
    });
  });

  describe("POST /tools/call namespaced tool splits namespace/name", () => {
    it("looks up connector by namespace and calls the underlying tool name", async () => {
      const { app } = createApp();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          jsonResponse({
            connectorKey: "deerflow",
            resolvedEndpoint: "http://deerflow.local:3000",
            packageTier: "L3",
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      requestMock.mockResolvedValueOnce({
        content: [{ type: "text", text: "result-data" }],
      });

      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({
          tenant_id: "tenant-1",
          name: "deerflow__search",
          arguments: { query: "hello" },
        });

      expect(res.status).toBe(200);
      expect(res.body.content[0].text).toBe("result-data");

      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        "http://localhost:3001/api/runtime/internal/tenants/tenant-1/connector-by-namespace/deerflow",
        expect.objectContaining({ headers: expect.objectContaining({ "X-Service-Token": "" }) }),
      );

      expect(requestMock).toHaveBeenCalledWith(
        { method: "tools/call", params: { name: "search", arguments: { query: "hello" } } },
        expect.anything(),
        expect.objectContaining({ timeout: 30_000 }),
      );
    });
  });

  describe("POST /tools/call non-namespaced tool proxies to CP", () => {
    it("proxies to /api/runtime/mcp-sdk/tools/call when tool name has no __ separator", async () => {
      const { app } = createApp();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(jsonResponse({ proxied: true, status: "ok" }));

      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: "tenant-1", name: "plain_tool", arguments: { x: 1 } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ proxied: true, status: "ok" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3001/api/runtime/mcp-sdk/tools/call",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Service-Token": "",
          }),
          body: JSON.stringify({ tenant_id: "tenant-1", name: "plain_tool", arguments: { x: 1 } }),
        }),
      );
    });
  });

  describe("POST /tools/call enforce deny -> 403", () => {
    it("returns 403 when /api/core/enforce responds non-ok", async () => {
      const { app } = createApp();

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          jsonResponse({
            connectorKey: "deerflow",
            resolvedEndpoint: "http://deerflow.local:3000",
            packageTier: "L3",
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ decision: "deny" }, 403));

      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: "tenant-1", name: "deerflow__search" });

      expect(res.status).toBe(403);
      expect(res.body.isError).toBe(true);
      expect(res.body.content[0].text).toBe("Tool call denied by policy");
    });
  });

  describe("POST /tools/call forwards user_id to /api/core/enforce", () => {
    it("includes user_id in the enforce POST body when present in req.body", async () => {
      const { app } = createApp();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          jsonResponse({
            connectorKey: "deerflow",
            resolvedEndpoint: "http://deerflow.local:3000",
            packageTier: "L3",
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      requestMock.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }] });

      await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({
          tenant_id: "tenant-1",
          user_id: "user-42",
          name: "deerflow__search",
        });

      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        "http://localhost:3001/api/core/enforce",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            tenant_id: "tenant-1",
            tool: "deerflow__search",
            risk_class: "connector",
            package_tier: "L3",
            user_id: "user-42",
          }),
        }),
      );
    });

    it("omits user_id from enforce body when not present in req.body", async () => {
      const { app } = createApp();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          jsonResponse({
            connectorKey: "deerflow",
            resolvedEndpoint: "http://deerflow.local:3000",
            packageTier: "L3",
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      requestMock.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }] });

      await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: "tenant-1", name: "deerflow__search" });

      const enforceCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(enforceCall[1].body as string);
      expect(body).not.toHaveProperty("user_id");
    });
  });

  describe("POST /tools/call connector throws -> isError response", () => {
    it("returns an isError response when the connector client throws", async () => {
      const { app } = createApp();

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          jsonResponse({
            connectorKey: "deerflow",
            resolvedEndpoint: "http://deerflow.local:3000",
            packageTier: "L3",
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      requestMock.mockRejectedValueOnce(new Error("connector blew up"));

      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/call")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: "tenant-1", name: "deerflow__search" });

      expect(res.status).toBe(200);
      expect(res.body.isError).toBe(true);
      expect(res.body.content[0].text).toContain("Connector error: connector blew up");
    });
  });

  describe("POST /tools/list successful aggregation", () => {
    it("aggregates CP tools and connector tools, namespacing connector tool names", async () => {
      const { app } = createApp();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          jsonResponse([
            { connectorKey: "deerflow", namespace: "df", resolvedEndpoint: "http://df.local:3000" },
          ]),
        )
        .mockResolvedValueOnce(jsonResponse({ tools: [{ name: "cp_tool", description: "CP tool" }] }));

      requestMock.mockResolvedValueOnce({
        tools: [{ name: "search", description: "DeerFlow search", inputSchema: { type: "object" } }],
      });

      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/list")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: "tenant-1" });

      expect(res.status).toBe(200);
      expect(res.body.tools).toEqual([
        { name: "cp_tool", description: "CP tool" },
        { name: "df__search", description: "DeerFlow search", input_schema: { type: "object" } },
      ]);

      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        "http://localhost:3001/api/runtime/internal/tenants/tenant-1/enabled-connectors",
        expect.objectContaining({ headers: expect.objectContaining({ "X-Service-Token": "" }) }),
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        "http://localhost:3001/api/runtime/mcp-sdk/tools/list",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("returns 400 when tenant_id is missing", async () => {
      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/mcp-sdk/tools/list")
        .set("X-Service-Token", "test-runtime-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "tenant_id_required" });
    });
  });
});