import { describe, expect, it, vi } from "vitest";
import { connectorEntitlementService } from "../services/connector-entitlement.js";
import { createEntitlementStore } from "../services/entitlement-store.js";

function makeWhereResult(rows: unknown[]) {
  const then = vi.fn((fn: (r: unknown[]) => unknown) => fn(rows));
  const limit = vi.fn(() => ({ then }));
  const innerJoin = vi.fn(() => ({ then }));
  return { then, limit, innerJoin };
}

function mockDb() {
  const select = vi.fn();
  const from = vi.fn();
  const where = vi.fn();

  select.mockReturnValue({ from });
  from.mockReturnValue({ where });
  where.mockReturnValue(makeWhereResult([]));

  return { select, from, where };
}

function mockDbWithRows(rows: unknown[]) {
  const select = vi.fn();
  const from = vi.fn();
  const where = vi.fn();

  select.mockReturnValue({ from });
  from.mockReturnValue({ where });
  where.mockReturnValue(makeWhereResult(rows));

  return { select, from, where };
}

describe("connectorEntitlementService", () => {
  describe("canEnableConnector", () => {
    it("returns allowed=false when connector is not found", async () => {
      const db = mockDb();
      const store = createEntitlementStore();
      const service = connectorEntitlementService(db as never, store);

      const result = await service.canEnableConnector("company-1", "nonexistent-id");

      expect(result).toEqual({ allowed: false, reason: "connector_not_found" });
    });

    it("returns allowed=false when connector status is not active", async () => {
      const db = mockDbWithRows([{ id: "c1", status: "inactive", allowedPackages: [] }]);
      const store = createEntitlementStore();
      const service = connectorEntitlementService(db as never, store);

      const result = await service.canEnableConnector("company-1", "c1");

      expect(result).toEqual({ allowed: false, reason: "connector_not_active" });
    });

    it("returns allowed=true when connector has no package restrictions", async () => {
      const db = mockDbWithRows([{ id: "c1", status: "active", allowedPackages: [] }]);
      const store = createEntitlementStore();
      store.setTenantTier("tenant-1", "free", ["company-1"]);
      const service = connectorEntitlementService(db as never, store);

      const result = await service.canEnableConnector("company-1", "c1");

      expect(result).toEqual({ allowed: true });
    });

    it("returns allowed=true when company tier is in allowedPackages", async () => {
      const db = mockDbWithRows([{ id: "c1", status: "active", allowedPackages: ["pro", "enterprise"] }]);
      const store = createEntitlementStore();
      store.setTenantTier("tenant-1", "pro", ["company-1"]);
      const service = connectorEntitlementService(db as never, store);

      const result = await service.canEnableConnector("company-1", "c1");

      expect(result).toEqual({ allowed: true });
    });

    it("returns allowed=false when company tier is not in allowedPackages", async () => {
      const db = mockDbWithRows([{ id: "c1", status: "active", allowedPackages: ["enterprise"] }]);
      const store = createEntitlementStore();
      store.setTenantTier("tenant-1", "free", ["company-1"]);
      const service = connectorEntitlementService(db as never, store);

      const result = await service.canEnableConnector("company-1", "c1");

      expect(result).toEqual({ allowed: false, reason: "package free not in allowed packages" });
    });

    it("defaults to free tier when no entitlement is configured", async () => {
      const db = mockDbWithRows([{ id: "c1", status: "active", allowedPackages: ["pro"] }]);
      const store = createEntitlementStore();
      const service = connectorEntitlementService(db as never, store);

      const result = await service.canEnableConnector("company-1", "c1");

      expect(result).toEqual({ allowed: false, reason: "package free not in allowed packages" });
    });
  });

  describe("getEnabledConnectorsForTenant", () => {
    it("returns enabled connectors for a tenant", async () => {
      const db = mockDb();
      const mockRows = [
        {
          tenant_connectors: { id: "tc1", tenantId: "tenant-1", connectorId: "c1", status: "enabled", namespace: "my-connector" },
          connectors: { id: "c1", connectorKey: "my-connector", connectorName: "My Connector" },
        },
      ];
      const then = vi.fn((fn: (r: unknown[]) => unknown) => fn(mockRows));
      db.where.mockReturnValue({
        then: vi.fn((fn: (r: unknown[]) => unknown) => fn([])),
        innerJoin: vi.fn(() => ({ then })),
      });
      const store = createEntitlementStore();
      const service = connectorEntitlementService(db as never, store);

      const result = await service.getEnabledConnectorsForTenant("tenant-1");

      expect(result).toEqual(mockRows);
    });
  });

  describe("getEntitledConnectorIds", () => {
    it("returns all active connector IDs when no package restrictions", async () => {
      const db = mockDbWithRows([
        { id: "c1", allowedPackages: [] },
        { id: "c2", allowedPackages: [] },
      ]);
      const store = createEntitlementStore();
      const service = connectorEntitlementService(db as never, store);

      const result = await service.getEntitledConnectorIds("company-1");

      expect(result).toEqual(["c1", "c2"]);
    });

    it("filters connectors by tier match", async () => {
      const db = mockDbWithRows([
        { id: "c1", allowedPackages: ["pro", "enterprise"] },
        { id: "c2", allowedPackages: ["free"] },
        { id: "c3", allowedPackages: ["enterprise"] },
      ]);
      const store = createEntitlementStore();
      store.setTenantTier("tenant-1", "pro", ["company-1"]);
      const service = connectorEntitlementService(db as never, store);

      const result = await service.getEntitledConnectorIds("company-1");

      expect(result).toEqual(["c1"]);
    });

    it("defaults to free tier when no entitlement configured", async () => {
      const db = mockDbWithRows([
        { id: "c1", allowedPackages: ["free"] },
        { id: "c2", allowedPackages: ["pro"] },
      ]);
      const store = createEntitlementStore();
      const service = connectorEntitlementService(db as never, store);

      const result = await service.getEntitledConnectorIds("company-1");

      expect(result).toEqual(["c1"]);
    });
  });
});
