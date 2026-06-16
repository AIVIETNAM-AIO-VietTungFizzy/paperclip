import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createEntitlementProxy } from "../entitlement-proxy.js";

const ORIGINAL_RUNTIME_SERVICE_TOKEN = process.env.RUNTIME_SERVICE_TOKEN;
const ORIGINAL_CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN;
const ORIGINAL_PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL;
const ORIGINAL_OCMT_DATA_DIR = process.env.OCMT_DATA_DIR;

function createApp() {
  const proxy = createEntitlementProxy();
  const app = express();
  app.use(express.json());
  app.use("/api/runtime/internal", proxy);
  return { app, proxy };
}

function createOcmtDir(tenantId: string, users: Record<string, Record<string, unknown>>): string {
  const base = join(tmpdir(), `ocmt-test-${randomUUID()}`);
  for (const [userId, config] of Object.entries(users)) {
    const userDir = join(base, tenantId, userId);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "openclaw.json"), JSON.stringify(config, null, 2) + "\n");
  }
  return base;
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
    if (ORIGINAL_OCMT_DATA_DIR === undefined) {
      delete process.env.OCMT_DATA_DIR;
    } else {
      process.env.OCMT_DATA_DIR = ORIGINAL_OCMT_DATA_DIR;
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

  describe("openclaw.json package field update", () => {
    let ocmtDir: string;
    const tenantId = "test-tenant-1";

    beforeEach(() => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "accepted" }), { status: 200 }),
      );
    });

    afterEach(() => {
      if (ocmtDir && existsSync(ocmtDir)) {
        rmSync(ocmtDir, { recursive: true, force: true });
      }
    });

    it("updates package field for all users in the tenant when OCMT_DATA_DIR is set", async () => {
      ocmtDir = createOcmtDir(tenantId, {
        "user-1": { gateway: { mode: "local" }, package: "L3" },
        "user-2": { gateway: { mode: "local" }, package: "L3" },
      });
      process.env.OCMT_DATA_DIR = ocmtDir;

      const { app } = createApp();
      await request(app)
        .post("/api/runtime/internal/sync/entitlements")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: tenantId, subscription_tier: "L1" });

      const user1Config = JSON.parse(readFileSync(join(ocmtDir, tenantId, "user-1", "openclaw.json"), "utf-8"));
      const user2Config = JSON.parse(readFileSync(join(ocmtDir, tenantId, "user-2", "openclaw.json"), "utf-8"));
      expect(user1Config.package).toBe("L1");
      expect(user2Config.package).toBe("L1");
    });

    it("preserves other fields when updating package", async () => {
      ocmtDir = createOcmtDir(tenantId, {
        "user-1": { gateway: { mode: "local", auth: { token: "abc" } }, package: "L3", env: { KEY: "val" } },
      });
      process.env.OCMT_DATA_DIR = ocmtDir;

      const { app } = createApp();
      await request(app)
        .post("/api/runtime/internal/sync/entitlements")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: tenantId, subscription_tier: "L1" });

      const config = JSON.parse(readFileSync(join(ocmtDir, tenantId, "user-1", "openclaw.json"), "utf-8"));
      expect(config.package).toBe("L1");
      expect(config.gateway.mode).toBe("local");
      expect(config.gateway.auth.token).toBe("abc");
      expect(config.env.KEY).toBe("val");
    });

    it("does nothing when OCMT_DATA_DIR is not set", async () => {
      delete process.env.OCMT_DATA_DIR;

      const { app } = createApp();
      const res = await request(app)
        .post("/api/runtime/internal/sync/entitlements")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: tenantId, subscription_tier: "L1" });

      expect(res.status).toBe(200);
    });

    it("does nothing when tenant directory does not exist", async () => {
      ocmtDir = createOcmtDir("other-tenant", { "user-1": { package: "L3" } });
      process.env.OCMT_DATA_DIR = ocmtDir;

      const { app } = createApp();
      await request(app)
        .post("/api/runtime/internal/sync/entitlements")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: "nonexistent-tenant", subscription_tier: "L1" });

      // Other tenant's files should be untouched
      const config = JSON.parse(readFileSync(join(ocmtDir, "other-tenant", "user-1", "openclaw.json"), "utf-8"));
      expect(config.package).toBe("L3");
    });

    it("skips users without openclaw.json", async () => {
      ocmtDir = createOcmtDir(tenantId, { "user-1": { package: "L3" } });
      const emptyUserDir = join(ocmtDir, tenantId, "user-2");
      mkdirSync(emptyUserDir, { recursive: true });
      process.env.OCMT_DATA_DIR = ocmtDir;

      const { app } = createApp();
      await request(app)
        .post("/api/runtime/internal/sync/entitlements")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: tenantId, subscription_tier: "L1" });

      const config = JSON.parse(readFileSync(join(ocmtDir, tenantId, "user-1", "openclaw.json"), "utf-8"));
      expect(config.package).toBe("L1");
    });

    it("updates package within 5 seconds (timeliness check)", async () => {
      ocmtDir = createOcmtDir(tenantId, { "user-1": { package: "L3" } });
      process.env.OCMT_DATA_DIR = ocmtDir;

      const { app } = createApp();
      const start = Date.now();
      await request(app)
        .post("/api/runtime/internal/sync/entitlements")
        .set("X-Service-Token", "test-runtime-token")
        .send({ tenant_id: tenantId, subscription_tier: "L1" });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5000);
      const config = JSON.parse(readFileSync(join(ocmtDir, tenantId, "user-1", "openclaw.json"), "utf-8"));
      expect(config.package).toBe("L1");
    });
  });
});