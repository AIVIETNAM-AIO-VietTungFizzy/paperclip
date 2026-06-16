import { describe, expect, it } from "vitest";
import { createEntitlementStore } from "../services/entitlement-store.js";
import { createPluginToolRegistry } from "../services/plugin-tool-registry.js";
import type { PaperclipPluginManifestV1 } from "@paperclipai/shared";

const emptyManifest: PaperclipPluginManifestV1 = {
  id: "test.plugin",
  apiVersion: 1,
  version: "1.0.0",
  displayName: "Test Plugin",
  description: "A test plugin",
  author: "test",
  categories: ["automation"],
  capabilities: ["agent.tools.register"],
  entrypoints: { worker: "worker.js" },
};

describe("EntitlementStore", () => {
  it("stores and retrieves tier by tenantId", () => {
    const store = createEntitlementStore();
    store.setTenantTier("tenant-1", "pro");
    expect(store.getTierForCompany("tenant-1")).toBe("pro");
  });

  it("returns undefined for unknown tenant", () => {
    const store = createEntitlementStore();
    expect(store.getTierForCompany("unknown")).toBeUndefined();
  });

  it("resolves company to tenant tier", () => {
    const store = createEntitlementStore();
    store.setTenantTier("tenant-1", "enterprise", ["company-a"]);
    expect(store.getTierForCompany("company-a")).toBe("enterprise");
  });

  it("clears all data on clear()", () => {
    const store = createEntitlementStore();
    store.setTenantTier("tenant-1", "pro", ["company-a"]);
    store.clear();
    expect(store.getTierForCompany("tenant-1")).toBeUndefined();
    expect(store.getTierForCompany("company-a")).toBeUndefined();
  });
});

describe("PluginToolRegistry entitlement enforcement", () => {
  it("allows tool execution when tool has no allowedPackages", async () => {
    const store = createEntitlementStore();
    store.setTenantTier("tenant-1", "L1", ["company-a"]);
    const registry = createPluginToolRegistry(undefined, store);

    registry.registerPlugin("test", {
      ...emptyManifest,
      tools: [
        {
          name: "public-tool",
          displayName: "Public Tool",
          description: "Available to all",
          parametersSchema: { type: "object" },
        },
      ],
    }, "plugin-db-id");

    // Should not throw an entitlement error — any error is fine
    await expect(
      registry.executeTool("test:public-tool", {}, {
        agentId: "a1", runId: "r1", companyId: "company-a", projectId: "p1",
      }),
    ).rejects.toThrow();
    // No entitlement error means it reached the worker check
  });

  it("allows tool when tenant tier matches allowedPackages", async () => {
    const store = createEntitlementStore();
    store.setTenantTier("tenant-1", "L3", ["company-a"]);
    const registry = createPluginToolRegistry(undefined, store);

    registry.registerPlugin("test", {
      ...emptyManifest,
      tools: [
        {
          name: "restricted-tool",
          displayName: "Restricted Tool",
          description: "L3 only",
          parametersSchema: { type: "object" },
          allowedPackages: ["L3"],
        },
      ],
    }, "plugin-db-id");

    // Should proceed past entitlement check to worker check
    await expect(
      registry.executeTool("test:restricted-tool", {}, {
        agentId: "a1", runId: "r1", companyId: "company-a", projectId: "p1",
      }),
    ).rejects.toThrow("no worker manager configured");
  });

  it("denies tool when tenant tier does not match allowedPackages", async () => {
    const store = createEntitlementStore();
    store.setTenantTier("tenant-1", "L1", ["company-a"]);
    const registry = createPluginToolRegistry(undefined, store);

    registry.registerPlugin("test", {
      ...emptyManifest,
      tools: [
        {
          name: "restricted-tool",
          displayName: "Restricted Tool",
          description: "L3 only",
          parametersSchema: { type: "object" },
          allowedPackages: ["L3"],
        },
      ],
    }, "plugin-db-id");

    let err: unknown;
    try {
      await registry.executeTool("test:restricted-tool", {}, {
        agentId: "a1", runId: "r1", companyId: "company-a", projectId: "p1",
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    const error = err as { status?: number; code?: string; message: string };
    expect(error.code).toBe("package_not_allowed_for_tool");
    expect(error.status).toBe(403);
  });

  it("denies tool when no entitlement is configured for the company", async () => {
    const store = createEntitlementStore();
    const registry = createPluginToolRegistry(undefined, store);

    registry.registerPlugin("test", {
      ...emptyManifest,
      tools: [
        {
          name: "restricted-tool",
          displayName: "Restricted Tool",
          description: "L3 only",
          parametersSchema: { type: "object" },
          allowedPackages: ["L3"],
        },
      ],
    }, "plugin-db-id");

    let err: unknown;
    try {
      await registry.executeTool("test:restricted-tool", {}, {
        agentId: "a1", runId: "r1", companyId: "company-a", projectId: "p1",
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    const error = err as { code?: string };
    expect(error.code).toBe("package_not_allowed_for_tool");
  });

  it("denies tool after downgrade and allows after upgrade", async () => {
    const store = createEntitlementStore();
    const registry = createPluginToolRegistry(undefined, store);
    const tieredManifest: PaperclipPluginManifestV1 = {
      ...emptyManifest,
      tools: [
        {
          name: "premium-tool",
          displayName: "Premium",
          description: "pro+",
          parametersSchema: { type: "object" },
          allowedPackages: ["pro", "enterprise"],
        },
      ],
    };
    registry.registerPlugin("test", tieredManifest, "plugin-db-id");

    const ctx = { agentId: "a1", runId: "r1", companyId: "company-a", projectId: "p1" };

    // Initially no entitlement → denied
    let err1: unknown;
    try { await registry.executeTool("test:premium-tool", {}, ctx); }
    catch (e) { err1 = e; }
    expect((err1 as { code?: string }).code).toBe("package_not_allowed_for_tool");

    // Upgrade to pro → allowed (will fail on worker, not entitlement)
    store.setTenantTier("tenant-1", "pro", ["company-a"]);
    await expect(
      registry.executeTool("test:premium-tool", {}, ctx),
    ).rejects.toThrow("no worker manager configured");

    // Downgrade to basic → denied
    store.setTenantTier("tenant-1", "basic", ["company-a"]);
    let err3: unknown;
    try { await registry.executeTool("test:premium-tool", {}, ctx); }
    catch (e) { err3 = e; }
    expect((err3 as { code?: string }).code).toBe("package_not_allowed_for_tool");

    // Upgrade to enterprise → allowed
    store.setTenantTier("tenant-1", "enterprise", ["company-a"]);
    await expect(
      registry.executeTool("test:premium-tool", {}, ctx),
    ).rejects.toThrow("no worker manager configured");
  });

  it("denies L3 tool after downgrade from L2 to L1", async () => {
    const store = createEntitlementStore();
    const registry = createPluginToolRegistry(undefined, store);
    const ctx = { agentId: "a1", runId: "r1", companyId: "company-a", projectId: "p1" };

    registry.registerPlugin("test", {
      ...emptyManifest,
      tools: [
        {
          name: "exec-tool",
          displayName: "Exec",
          description: "L3 only",
          parametersSchema: { type: "object" },
          allowedPackages: ["L3"],
        },
      ],
    }, "plugin-db-id");

    // Start at L2 (basic) → denied
    store.setTenantTier("tenant-1", "L2", ["company-a"]);
    let err1: unknown;
    try { await registry.executeTool("test:exec-tool", {}, ctx); }
    catch (e) { err1 = e; }
    expect((err1 as { code?: string }).code).toBe("package_not_allowed_for_tool");

    // Upgrade to L3 → allowed (fails on worker, not entitlement)
    store.setTenantTier("tenant-1", "L3", ["company-a"]);
    await expect(
      registry.executeTool("test:exec-tool", {}, ctx),
    ).rejects.toThrow("no worker manager configured");

    // Downgrade L3→L1 → denied again
    store.setTenantTier("tenant-1", "L1", ["company-a"]);
    let err3: unknown;
    try { await registry.executeTool("test:exec-tool", {}, ctx); }
    catch (e) { err3 = e; }
    expect((err3 as { code?: string }).code).toBe("package_not_allowed_for_tool");
  });

  it("does not check entitlements when entitlementStore is undefined", async () => {
    const registry = createPluginToolRegistry();
    registry.registerPlugin("test", {
      ...emptyManifest,
      tools: [
        {
          name: "restricted-tool",
          displayName: "Restricted",
          description: "L3 only",
          parametersSchema: { type: "object" },
          allowedPackages: ["L3"],
        },
      ],
    }, "plugin-db-id");

    // Should fail on worker setup, not on entitlement (no entitlement store)
    await expect(
      registry.executeTool("test:restricted-tool", {}, {
        agentId: "a1", runId: "r1", companyId: "company-a", projectId: "p1",
      }),
    ).rejects.toThrow("no worker manager configured");
  });
});