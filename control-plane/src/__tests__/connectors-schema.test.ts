import { describe, it, expect } from "vitest";
import {
  connectors,
  tenantConnectors,
  connectorToolRegistry,
} from "@/lib/db/schema";

const FK_SYMBOL = Symbol.for("drizzle:PgInlineForeignKeys");

function getForeignKeys(table: Record<symbol, unknown>): unknown[] {
  return (table[FK_SYMBOL] as unknown[]) ?? [];
}

describe("connectors schema", () => {
  it("has the expected columns", () => {
    expect(connectors.id).toBeDefined();
    expect(connectors.name).toBeDefined();
    expect(connectors.displayName).toBeDefined();
    expect(connectors.description).toBeDefined();
    expect(connectors.iconUrl).toBeDefined();
    expect(connectors.configSchema).toBeDefined();
    expect(connectors.authType).toBeDefined();
    expect(connectors.isBuiltin).toBeDefined();
    expect(connectors.status).toBeDefined();
    expect(connectors.createdAt).toBeDefined();
    expect(connectors.updatedAt).toBeDefined();
  });

  it("has a unique index defined via ExtraConfigBuilder", () => {
    const EC = Symbol.for("drizzle:ExtraConfigBuilder");
    const builder = (connectors as never)[EC] as ((t: never) => Record<string, unknown>) | undefined;
    expect(builder).toBeDefined();
  });
});

describe("tenant_connectors schema", () => {
  it("has the expected columns", () => {
    expect(tenantConnectors.id).toBeDefined();
    expect(tenantConnectors.tenantId).toBeDefined();
    expect(tenantConnectors.connectorId).toBeDefined();
    expect(tenantConnectors.displayName).toBeDefined();
    expect(tenantConnectors.config).toBeDefined();
    expect(tenantConnectors.authConfig).toBeDefined();
    expect(tenantConnectors.enabled).toBeDefined();
    expect(tenantConnectors.createdAt).toBeDefined();
    expect(tenantConnectors.updatedAt).toBeDefined();
  });

  it("has foreign key references", () => {
    const fks = getForeignKeys(tenantConnectors as never);
    expect(fks.length).toBe(2);
  });
});

describe("connector_tool_registry schema", () => {
  it("has the expected columns", () => {
    expect(connectorToolRegistry.id).toBeDefined();
    expect(connectorToolRegistry.tenantConnectorId).toBeDefined();
    expect(connectorToolRegistry.name).toBeDefined();
    expect(connectorToolRegistry.displayName).toBeDefined();
    expect(connectorToolRegistry.description).toBeDefined();
    expect(connectorToolRegistry.toolSchema).toBeDefined();
    expect(connectorToolRegistry.enabled).toBeDefined();
    expect(connectorToolRegistry.createdAt).toBeDefined();
    expect(connectorToolRegistry.updatedAt).toBeDefined();
  });

  it("has a foreign key reference", () => {
    const fks = getForeignKeys(connectorToolRegistry as never);
    expect(fks.length).toBe(1);
  });
});
