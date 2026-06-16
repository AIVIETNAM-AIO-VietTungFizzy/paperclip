import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/admin/tenants/[id]/route";
import { db } from "@/lib/db";
import { getRuntimeInstancesByTenantId } from "@/lib/db/queries";

const mockDb = vi.mocked(db);
const mockGetRuntimeInstances = vi.mocked(getRuntimeInstancesByTenantId);

function createRequest(body: unknown, id: string): Request {
  return new Request(`http://localhost/api/admin/tenants/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RUNTIME_SERVICE_TOKEN = "test-token";
});

describe("PATCH /api/admin/tenants/[id]", () => {
  it("returns 404 when tenant does not exist", async () => {
    mockDb.select.mockReturnValue({
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
    const existingTenant = {
      id: "tenant-1",
      name: "Old Name",
      subscriptionTier: "free",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedTenant = {
      ...existingTenant,
      name: "New Name",
      updatedAt: new Date(),
    };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);

    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([updatedTenant])),
          }),
        }),
      }),
    } as never);

    const response = await PATCH(
      createRequest({ name: "New Name" }, "tenant-1"),
      { params: Promise.resolve({ id: "tenant-1" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("New Name");
    expect(body.subscriptionTier).toBe("free");
  });

  it("pushes entitlement to runtime instances when subscription_tier changes", async () => {
    const existingTenant = {
      id: "tenant-1",
      name: "Test",
      subscriptionTier: "free",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedTenant = {
      ...existingTenant,
      subscriptionTier: "pro",
      updatedAt: new Date(),
    };

    const instances = [
      {
        id: "instance-1",
        tenantId: "tenant-1",
        managementServerUrl: "https://ms1.example.com",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "instance-2",
        tenantId: "tenant-1",
        managementServerUrl: "https://ms2.example.com",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);

    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([updatedTenant])),
          }),
        }),
      }),
    } as never);

    mockGetRuntimeInstances.mockResolvedValue(instances);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
    } as Response);

    const response = await PATCH(
      createRequest({ subscription_tier: "pro" }, "tenant-1"),
      { params: Promise.resolve({ id: "tenant-1" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://ms1.example.com/api/runtime/internal/sync/entitlements",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Service-Token": "test-token",
        }),
        body: JSON.stringify({
          tenant_id: "tenant-1",
          subscription_tier: "pro",
        }),
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://ms2.example.com/api/runtime/internal/sync/entitlements",
      expect.any(Object),
    );

    fetchSpy.mockRestore();
  });

  it("does not push entitlement when subscription_tier is unchanged", async () => {
    const existingTenant = {
      id: "tenant-1",
      name: "Test",
      subscriptionTier: "free",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedTenant = {
      ...existingTenant,
      name: "Renamed",
      updatedAt: new Date(),
    };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);

    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([updatedTenant])),
          }),
        }),
      }),
    } as never);

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await PATCH(
      createRequest({ name: "Renamed" }, "tenant-1"),
      { params: Promise.resolve({ id: "tenant-1" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("logs warning but does not fail when runtime push fails", async () => {
    const existingTenant = {
      id: "tenant-1",
      name: "Test",
      subscriptionTier: "free",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updatedTenant = {
      ...existingTenant,
      subscriptionTier: "enterprise",
      updatedAt: new Date(),
    };

    const instances = [
      {
        id: "instance-1",
        tenantId: "tenant-1",
        managementServerUrl: "https://ms1.example.com",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([existingTenant])),
        }),
      }),
    } as never);

    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            then: vi.fn((cb: (rows: unknown[]) => unknown) => cb([updatedTenant])),
          }),
        }),
      }),
    } as never);

    mockGetRuntimeInstances.mockResolvedValue(instances);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Connection refused"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await PATCH(
      createRequest({ subscription_tier: "enterprise" }, "tenant-1"),
      { params: Promise.resolve({ id: "tenant-1" }) },
    );

    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to push entitlement to https://ms1.example.com"),
    );

    fetchSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
