import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const originalFetch = globalThis.fetch;
const ORIGINAL_RUNTIME_SERVICE_TOKEN = process.env.RUNTIME_SERVICE_TOKEN;

async function createApp() {
  const { createConnectorDefinitionsProxy } = await import("../connector-definitions-proxy.js");
  const app = express();
  app.use(express.json());
  app.use("/api/runtime", createConnectorDefinitionsProxy());
  return app;
}

describe("Management Server POST /api/runtime/connector-definitions/:id/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CP_URL = "http://cp.test";
    process.env.CP_SERVICE_TOKEN = "test-cp-token";
    process.env.RUNTIME_SERVICE_TOKEN = "test-runtime-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.CP_URL;
    delete process.env.CP_SERVICE_TOKEN;
    if (ORIGINAL_RUNTIME_SERVICE_TOKEN === undefined) {
      delete process.env.RUNTIME_SERVICE_TOKEN;
    } else {
      process.env.RUNTIME_SERVICE_TOKEN = ORIGINAL_RUNTIME_SERVICE_TOKEN;
    }
  });

  it("returns 401 when no auth header is provided", async () => {
    const app = await createApp();
    const res = await request(app).post("/api/runtime/connector-definitions/c1/sync");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "runtime_service_token_required" });
  });

  it("returns 401 when the token does not match RUNTIME_SERVICE_TOKEN", async () => {
    const app = await createApp();
    const res = await request(app)
      .post("/api/runtime/connector-definitions/c1/sync")
      .set("X-Service-Token", "wrong-token");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "runtime_service_token_required" });
  });

  it("proxies to CP /api/connectors/:id/sync and returns the result", async () => {
    const syncResult = { ok: true, added: ["new_tool"], removed: [], tools: [{ name: "new_tool" }] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => syncResult,
    }) as any;

    const app = await createApp();
    const res = await request(app)
      .post("/api/runtime/connector-definitions/c1/sync")
      .set("X-Service-Token", "test-runtime-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(syncResult);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://cp.test/api/connectors/c1/sync",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns 502 when CP responds with an error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "connector_not_found",
    }) as any;

    const app = await createApp();
    const res = await request(app)
      .post("/api/runtime/connector-definitions/missing/sync")
      .set("X-Service-Token", "test-runtime-token");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Control plane error");
  });

  it("returns 500 when the upstream fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

    const app = await createApp();
    const res = await request(app)
      .post("/api/runtime/connector-definitions/c1/sync")
      .set("X-Service-Token", "test-runtime-token");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to sync connector tools");
  });
});

describe("Management Server PATCH /api/runtime/connector-definitions/:id/tools/:toolId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CP_URL = "http://cp.test";
    process.env.CP_SERVICE_TOKEN = "test-cp-token";
    process.env.RUNTIME_SERVICE_TOKEN = "test-runtime-token";
    process.env.TENANT_ID = "tenant-1";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.CP_URL;
    delete process.env.CP_SERVICE_TOKEN;
    delete process.env.TENANT_ID;
    if (ORIGINAL_RUNTIME_SERVICE_TOKEN === undefined) {
      delete process.env.RUNTIME_SERVICE_TOKEN;
    } else {
      process.env.RUNTIME_SERVICE_TOKEN = ORIGINAL_RUNTIME_SERVICE_TOKEN;
    }
  });

  it("returns 401 when no auth header is provided", async () => {
    const app = await createApp();
    const res = await request(app)
      .patch("/api/runtime/connector-definitions/c1/tools/research")
      .send({ enabled: true });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "runtime_service_token_required" });
  });

  it("returns 401 when the token does not match RUNTIME_SERVICE_TOKEN", async () => {
    const app = await createApp();
    const res = await request(app)
      .patch("/api/runtime/connector-definitions/c1/tools/research")
      .set("X-Service-Token", "wrong-token")
      .send({ enabled: true });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "runtime_service_token_required" });
  });

  it("proxies the tool-enable PATCH to CP and returns the result", async () => {
    const cpResult = { ok: true, tool: { id: "tool1", enabled: true } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => cpResult,
    }) as any;

    const app = await createApp();
    const res = await request(app)
      .patch("/api/runtime/connector-definitions/c1/tools/research")
      .set("X-Service-Token", "test-runtime-token")
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cpResult);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://cp.test/api/companies/tenant-1/connectors/c1/tools/research",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Service-Token": "test-cp-token",
        }),
        body: JSON.stringify({ enabled: true }),
      }),
    );
  });

  it("returns 502 when CP responds with an error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "tool_not_found",
    }) as any;

    const app = await createApp();
    const res = await request(app)
      .patch("/api/runtime/connector-definitions/c1/tools/unknown")
      .set("X-Service-Token", "test-runtime-token")
      .send({ enabled: true });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Control plane error");
  });

  it("returns 500 when the upstream fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

    const app = await createApp();
    const res = await request(app)
      .patch("/api/runtime/connector-definitions/c1/tools/research")
      .set("X-Service-Token", "test-runtime-token")
      .send({ enabled: true });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update tool");
  });

  it("returns 500 when TENANT_ID is not configured", async () => {
    delete process.env.TENANT_ID;

    const app = await createApp();
    const res = await request(app)
      .patch("/api/runtime/connector-definitions/c1/tools/research")
      .set("X-Service-Token", "test-runtime-token")
      .send({ enabled: true });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("TENANT_ID not configured");
  });
});