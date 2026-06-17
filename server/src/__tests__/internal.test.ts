import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { internalRoutes } from "../routes/internal.js";
import { createEntitlementStore } from "../services/entitlement-store.js";

const ORIGINAL_CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN;

function createApp(db?: unknown) {
  const store = createEntitlementStore();
  const app = express();
  app.use(express.json());
  app.use("/api/runtime/internal", internalRoutes(store, db));
  return { app, store };
}

describe("POST /api/runtime/internal/sync/entitlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CP_SERVICE_TOKEN = "test-cp-token";
  });

  afterEach(() => {
    if (ORIGINAL_CP_SERVICE_TOKEN === undefined) {
      delete process.env.CP_SERVICE_TOKEN;
    } else {
      process.env.CP_SERVICE_TOKEN = ORIGINAL_CP_SERVICE_TOKEN;
    }
    vi.restoreAllMocks();
  });

  it("returns 401 when no auth header is provided", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .send({ tenantId: "tenant-1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("returns 401 when the token does not match CP_SERVICE_TOKEN", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer wrong-token")
      .send({ tenantId: "tenant-1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("returns 200 with accepted status when the token matches", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenantId: "tenant-1",
        subscriptionTier: "pro",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
  });

  it("stores subscription tier and makes it queryable by tenantId", async () => {
    const { app, store } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenantId: "tenant-1",
        subscriptionTier: "pro",
        companies: ["company-a", "company-b"],
      });

    expect(res.status).toBe(200);
    expect(store.getTierForCompany("company-a")).toBe("pro");
    expect(store.getTierForCompany("company-b")).toBe("pro");
  });

  it("stores subscription tier keyed by tenantId directly when no companies", async () => {
    const { app, store } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenantId: "mega-corp",
        subscriptionTier: "enterprise",
      });

    expect(res.status).toBe(200);
    expect(store.getTierForCompany("mega-corp")).toBe("enterprise");
  });

  it("accepts snake_case CP payload and stores it", async () => {
    const { app, store } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({
        tenant_id: "tenant-2",
        subscription_tier: "L3",
      });

    expect(res.status).toBe(200);
    expect(store.getTierForCompany("tenant-2")).toBe("L3");
  });

  it("returns 400 when tenantId is missing", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ subscriptionTier: "pro" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tenantId");
  });

  it("returns 400 when subscriptionTier is missing", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("subscriptionTier");
  });

  it("returns 200 with X-Service-Token header (CP→runtime auth style)", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-cp-token")
      .send({ tenant_id: "tenant-1", subscription_tier: "pro" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
  });

  it("returns 401 with wrong X-Service-Token header", async () => {
    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "wrong-token")
      .send({ tenant_id: "tenant-1" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "cp_service_token_required" });
  });

  it("updates tier on subsequent calls", async () => {
    const { app, store } = createApp();

    // Initial: L3
    await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "L3", companies: ["company-a"] });
    expect(store.getTierForCompany("company-a")).toBe("L3");

    // Downgrade: L1
    await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "L1", companies: ["company-a"] });
    expect(store.getTierForCompany("company-a")).toBe("L1");
  });

  it("disables tenant connectors when package tier downgrade removes entitlement", async () => {
    const mockDb = buildMockDb([
      { id: "conn-1", allowedPackages: ["pro", "enterprise"] },
      { id: "conn-2", allowedPackages: [] },
      { id: "conn-3", allowedPackages: ["enterprise"] },
    ]);

    const { app, store } = createApp(mockDb);

    store.setTenantTier("tenant-1", "enterprise", ["company-a"]);

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "free", companies: ["company-a"] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.updateSetMock).toHaveBeenCalledWith({
      status: "disabled",
      lastError: "package_tier_changed",
      updatedAt: expect.any(Date),
    });
  });

  it("does not disable connectors when all connectors are entitled for the tier", async () => {
    const mockDb = buildMockDb([
      { id: "conn-1", allowedPackages: ["pro", "enterprise"] },
      { id: "conn-2", allowedPackages: [] },
    ]);

    const { app, store } = createApp(mockDb);

    store.setTenantTier("tenant-1", "pro", ["company-a"]);

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "pro", companies: ["company-a"] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("does not fail when no db is provided (backward compat)", async () => {
    const { app, store } = createApp();

    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("Authorization", "Bearer test-cp-token")
      .send({ tenantId: "tenant-1", subscriptionTier: "free" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "accepted" });
  });
});

function buildMockDb(connectorsResult: Array<{ id: string; allowedPackages: string[] }>) {
  const whereMock = vi.fn().mockReturnThis();
  const thenMock = vi.fn().mockResolvedValue(connectorsResult);
  const updateSetMock = vi.fn().mockReturnThis();
  const updateWhereMock = vi.fn().mockReturnThis();

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: whereMock.mockReturnValue({ then: thenMock }),
      }),
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    then: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: updateSetMock.mockReturnValue({
        where: updateWhereMock.mockReturnValue({}),
      }),
    }),
    set: vi.fn().mockReturnThis(),
    updateSetMock,
    updateWhereMock,
  };
}