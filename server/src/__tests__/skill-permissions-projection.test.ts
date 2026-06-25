import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

const mockTenantConnectorsTable = vi.hoisted(() => ({}));
const mockConnectorsTable = vi.hoisted(() => ({}));
const mockConnectorToolRegistryTable = vi.hoisted(() => ({}));

vi.mock("@paperclipai/db", () => ({
  tenantConnectors: mockTenantConnectorsTable,
  connectors: mockConnectorsTable,
  connectorToolRegistry: mockConnectorToolRegistryTable,
}));

import { eq, and } from "drizzle-orm";
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return { ...actual, eq: vi.fn(), and: vi.fn() };
});

function makeSelectChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return Object.assign(promise, {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  });
}

function makeUpdateChain() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };
}

describe("skillPermissionsProjectionService", () => {
  let projection: ReturnType<typeof import("../services/skill-permissions-projection.js").skillPermissionsProjectionService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../services/skill-permissions-projection.js");
    projection = mod.skillPermissionsProjectionService(mockDb as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("projects enabled skills into mcp_tool_permissions { server: [namespaced tools] }", async () => {
    // One tenant connector (the A2A bridge "mcp server") with two enabled skills
    // and one disabled skill.
    const rows = [
      { tenantConnectorId: "tc-1", namespace: "research", namespacedName: "research__search", toolType: "skill", enabled: true },
      { tenantConnectorId: "tc-1", namespace: "research", namespacedName: "research__summarize", toolType: "skill", enabled: true },
      { tenantConnectorId: "tc-1", namespace: "research", namespacedName: "research__draft", toolType: "skill", enabled: false },
    ];
    mockDb.select.mockReturnValue(makeSelectChain(rows));

    const result = await projection.projectSkillPermissions("tenant-1");

    // mcp_tool_permissions groups by server name; the bridge server is the connector namespace.
    expect(result).toEqual({
      "research": ["research__search", "research__summarize"],
    });
  });

  it("only includes tool_type=skill rows (plain MCP tools are handled by the tool projection)", async () => {
    const rows = [
      { tenantConnectorId: "tc-1", namespace: "research", namespacedName: "research__search", toolType: "skill", enabled: true },
      { tenantConnectorId: "tc-1", namespace: "research", namespacedName: "research__send_email", toolType: "tool", enabled: true },
    ];
    mockDb.select.mockReturnValue(makeSelectChain(rows));

    const result = await projection.projectSkillPermissions("tenant-1");

    expect(result).toEqual({ "research": ["research__search"] });
  });

  it("returns empty object when tenant has no enabled skills", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const result = await projection.projectSkillPermissions("tenant-1");

    expect(result).toEqual({});
  });
});