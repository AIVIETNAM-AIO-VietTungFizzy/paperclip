import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createEntitlementProxy } from "../entitlement-proxy.js";

const ORIGINAL_RUNTIME_SERVICE_TOKEN = process.env.RUNTIME_SERVICE_TOKEN;
const ORIGINAL_CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN;
const ORIGINAL_PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL;

function createApp() {
  const proxy = createEntitlementProxy();
  const app = express();
  app.use(express.json());
  app.use("/api/runtime/internal", proxy);
  return { app, proxy };
}

describe("Management Server POST /api/runtime/internal/sync/entitlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUNTIME_SERVICE_TOKEN = "test-runtime-token";
    process.env.CP_SERVICE_TOKEN = "test-cp-token";
    process.env.PAPERCLIP_API_URL = "http://paperclip.local:3100";
  });

  afterEach(() => {
    if (ORIGINAL_RUNTIME_SERVICE_TOKEN === undefined) {
      delete process.env.RUNTIME_SERVICE_TOKEN;
    } else {
      process.env.RUNTIME_SERVICE_TOKEN = ORIGINAL_RUNTIME_SERVICE_TOKEN;
    }
    if (ORIGINAL_CP_SERVICE_TOKEN === undefined) {
      delete process.env.CP_SERVICE_TOKEN;
    } else {
      process.env.CP_SERVICE_TOKEN = ORIGINAL_CP_SERVICE_TOKEN;
    }
    if (ORIGINAL_PAPERCLIP_API_URL === undefined) {
      delete process.env.PAPERCLIP_API_URL;
    } else {
      process.env.PAPERCLIP_API_URL = ORIGINAL_PAPERCLIP_API_URL;
    }
    vi.restoreAllMocks();
  });

  it("returns 401 when no auth header is provided", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .send({ tenant_id: "tenant-1", subscription_tier: "pro" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "runtime_service_token_required" });
  });

  it("returns 401 when the token does not match RUNTIME_SERVICE_TOKEN", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "wrong-token")
      .send({ tenant_id: "tenant-1", subscription_tier: "pro" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "runtime_service_token_required" });
  });

  it("forwards entitlement push to Paperclip server and returns its response", async () => {
    const { app } = createApp();
    const fakePaperclipResponse = { status: "accepted" };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(fakePaperclipResponse), { status: 200 }),
    );

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-runtime-token")
      .send({ tenant_id: "tenant-1", subscription_tier: "pro" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakePaperclipResponse);
  });

  it("forwards payload with CP_SERVICE_TOKEN to Paperclip server", async () => {
    const { app } = createApp();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "accepted" }), { status: 200 }),
    );

    await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-runtime-token")
      .send({ tenant_id: "tenant-1", subscription_tier: "L3", companies: ["company-a"] });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://paperclip.local:3100/api/runtime/internal/sync/entitlements",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Service-Token": "test-cp-token",
        }),
        body: JSON.stringify({
          tenant_id: "tenant-1",
          subscription_tier: "L3",
          companies: ["company-a"],
        }),
      }),
    );
  });

  it("returns 502 when Paperclip server is unreachable", async () => {
    const { app } = createApp();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-runtime-token")
      .send({ tenant_id: "tenant-1", subscription_tier: "pro" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream_unreachable" });
  });

  it("returns 400 when tenantId is missing", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-runtime-token")
      .send({ subscription_tier: "pro" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tenant_id");
  });

  it("returns 400 when subscriptionTier is missing", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-runtime-token")
      .send({ tenant_id: "tenant-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("subscription_tier");
  });
});