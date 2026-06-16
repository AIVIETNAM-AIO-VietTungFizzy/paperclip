import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/db/queries", () => ({
  getRuntimeInstancesByTenantId: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b })),
}));

import { PATCH } from "@/app/api/admin/tenants/[id]/route";

function makeDbChain(returnValue: unknown) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue({
      then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([returnValue])),
    }),
  };
}

function createRequest(body: unknown, id: string): Request {
  return new Request(`http://localhost/api/admin/tenants/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const existingTenant = { id: "tenant-1", name: "Test", subscriptionTier: "free", createdAt: new Date(), updatedAt: new Date() };
const updatedTenant = { id: "tenant-1", name: "Test", subscriptionTier: "pro", createdAt: new Date(), updatedAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RUNTIME_SERVICE_TOKEN = "test-token";
});

describe("PATCH /api/admin/tenants/[id]", () => {
  it("returns 404 when tenant does not exist", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([])),
        }),
      }),
    } as never);

    const response = await PATCH(createRequest({ name: "test" }, "nonexistent-id"), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Tenant not found");
  });

  it("updates tenant and returns the updated record", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);
    vi.mocked(db.update).mockReturnValue(makeDbChain(updatedTenant) as never);

    const response = await PATCH(createRequest({ subscriptionTier: "pro" }, "tenant-1"), { params: Promise.resolve({ id: "tenant-1" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Test");
    expect(body.subscriptionTier).toBe("pro");
  });

  it("pushes entitlement to runtime instances when subscription_tier changes", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);
    vi.mocked(db.update).mockReturnValue(makeDbChain(updatedTenant) as never);

    const instances = [
      { id: "instance-1", tenantId: "tenant-1", managementServerUrl: "https://ms1.example.com", status: "active", createdAt: new Date(), updatedAt: new Date() },
      { id: "instance-2", tenantId: "tenant-1", managementServerUrl: "https://ms2.example.com", status: "active", createdAt: new Date(), updatedAt: new Date() },
    ];

    const { getRuntimeInstancesByTenantId } = await import("@/lib/db/queries");
    vi.mocked(getRuntimeInstancesByTenantId).mockResolvedValue(instances);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const response = await PATCH(createRequest({ subscription_tier: "pro" }, "tenant-1"), { params: Promise.resolve({ id: "tenant-1" }) });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const callArg = fetchSpy.mock.calls[0];
    expect(callArg[0]).toBe("https://ms1.example.com/api/runtime/internal/sync/entitlements");
    expect(callArg[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Token": "test-token" },
      body: JSON.stringify({ tenant_id: "tenant-1", subscription_tier: "pro" }),
    });
    expect(fetchSpy.mock.calls[1][0]).toBe("https://ms2.example.com/api/runtime/internal/sync/entitlements");
    fetchSpy.mockRestore();
  });

  it("does not push entitlement when subscription_tier is unchanged", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);
    vi.mocked(db.update).mockReturnValue(makeDbChain({ ...existingTenant, name: "Renamed", updatedAt: new Date() }) as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await PATCH(createRequest({ name: "Renamed" }, "tenant-1"), { params: Promise.resolve({ id: "tenant-1" }) });
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("logs warning but does not fail when runtime push fails", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);
    vi.mocked(db.update).mockReturnValue(makeDbChain(updatedTenant) as never);

    const instances = [{ id: "instance-1", tenantId: "tenant-1", managementServerUrl: "https://ms1.example.com", status: "active", createdAt: new Date(), updatedAt: new Date() }];

    const { getRuntimeInstancesByTenantId } = await import("@/lib/db/queries");
    vi.mocked(getRuntimeInstancesByTenantId).mockResolvedValue(instances);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await PATCH(createRequest({ subscription_tier: "enterprise" }, "tenant-1"), { params: Promise.resolve({ id: "tenant-1" }) });
    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to push entitlement to https://ms1.example.com"));
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });
});