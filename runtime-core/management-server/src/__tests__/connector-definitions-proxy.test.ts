import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const originalFetch = globalThis.fetch;

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.CP_URL;
    delete process.env.CP_SERVICE_TOKEN;
  });

  it("proxies to CP /api/connectors/:id/sync and returns the result", async () => {
    const syncResult = { ok: true, added: ["new_tool"], removed: [], tools: [{ name: "new_tool" }] };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => syncResult,
    }) as any;

    const app = await createApp();
    const res = await request(app).post("/api/runtime/connector-definitions/c1/sync");

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
    const res = await request(app).post("/api/runtime/connector-definitions/missing/sync");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Control plane error");
  });

  it("returns 500 when the upstream fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

    const app = await createApp();
    const res = await request(app).post("/api/runtime/connector-definitions/c1/sync");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to sync connector tools");
  });
});