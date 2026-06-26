import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
}));

const mockConnectorsTable = vi.hoisted(() => ({}));
const mockTenantConnectorsTable = vi.hoisted(() => ({}));
const mockResolveSecretValue = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/db", () => ({
  tenantConnectors: mockTenantConnectorsTable,
  connectors: mockConnectorsTable,
}));

function makeSingleRowChain(row: unknown) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn((fn: any) => Promise.resolve(fn(row !== undefined ? [row].filter(Boolean) : []))),
  };
  return chain;
}

function setupGuardrailSelect(row: unknown) {
  const chain = makeSingleRowChain(row);
  mockDb.select.mockReturnValue(chain);
  return chain;
}

describe("connectorGuardrailService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveConnectorCredentials", () => {
    it("returns empty headers when tenant connector not found", async () => {
      setupGuardrailSelect(undefined);

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: {} });
      expect(mockResolveSecretValue).not.toHaveBeenCalled();
    });

    it("returns empty headers when credentialRefs is empty", async () => {
      setupGuardrailSelect({
        id: "tc-1",
        credentialRefs: {},
        authType: "apikey",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: {} });
      expect(mockResolveSecretValue).not.toHaveBeenCalled();
    });

    it("returns empty headers when authType is none", async () => {
      setupGuardrailSelect({
        id: "tc-1",
        credentialRefs: { apiKey: "plain-key-123" },
        authType: "none",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: {} });
      expect(mockResolveSecretValue).not.toHaveBeenCalled();
    });

    it("builds apikey auth from plain-text credentialRefs", async () => {
      setupGuardrailSelect({
        id: "tc-1",
        credentialRefs: { apiKey: "my-key", headerName: "X-Custom-Key" },
        authType: "apikey",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { "X-Custom-Key": "my-key" } });
    });

    it("builds apikey auth with default header name", async () => {
      setupGuardrailSelect({
        id: "tc-1",
        credentialRefs: { apiKey: "my-key" },
        authType: "apikey",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { "X-API-Key": "my-key" } });
    });

    it("builds bearer auth from plain-text credentialRefs", async () => {
      setupGuardrailSelect({
        id: "tc-1",
        credentialRefs: { token: "my-token" },
        authType: "bearer",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { Authorization: "Bearer my-token" } });
    });

    it("builds basic auth from plain-text credentialRefs", async () => {
      setupGuardrailSelect({
        id: "tc-1",
        credentialRefs: { username: "alice", password: "secret" },
        authType: "basic",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { Authorization: "Basic YWxpY2U6c2VjcmV0" } });
    });

    it("resolves secret:<uuid> refs via secrets service with row.id-scoped configPath", async () => {
      mockResolveSecretValue.mockImplementation((_companyId, secretId, _version, _context) => {
        if (secretId === "secret-uuid-1") return Promise.resolve("resolved-api-key");
        return Promise.reject(new Error("unexpected"));
      });

      setupGuardrailSelect({
        id: "tc-42",
        credentialRefs: { apiKey: "secret:secret-uuid-1", headerName: "X-API-Key" },
        authType: "apikey",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { "X-API-Key": "resolved-api-key" } });
      expect(mockResolveSecretValue).toHaveBeenCalledTimes(1);
      expect(mockResolveSecretValue).toHaveBeenCalledWith(
        "tenant-1", "secret-uuid-1", "latest",
        {
          consumerType: "system",
          consumerId: "connector-guardrail",
          configPath: "tenantConnectors.tc-42.credentialRefs.apiKey",
        },
      );
    });

    it("mixes plain and secret refs", async () => {
      mockResolveSecretValue.mockResolvedValue("decrypted-token");

      setupGuardrailSelect({
        id: "tc-7",
        credentialRefs: { token: "secret:token-uuid", headerName: "X-Auth" },
        authType: "bearer",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { Authorization: "Bearer decrypted-token" } });
      expect(mockResolveSecretValue).toHaveBeenCalledWith(
        "tenant-1", "token-uuid", "latest",
        expect.objectContaining({ configPath: "tenantConnectors.tc-7.credentialRefs.token" }),
      );
    });

    it("returns different headers for different tenants (same connector)", async () => {
      const tenantARow = {
        id: "tc-a",
        credentialRefs: { token: "tenant-a-token" },
        authType: "bearer",
        credentialSchema: [],
      };
      const tenantBRow = {
        id: "tc-b",
        credentialRefs: { token: "tenant-b-token" },
        authType: "bearer",
        credentialSchema: [],
      };

      mockDb.select
        .mockReturnValueOnce(makeSingleRowChain(tenantARow))
        .mockReturnValueOnce(makeSingleRowChain(tenantBRow));

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);

      const resultA = await guardrail.resolveConnectorCredentials("tenant-a", "conn-1");
      const resultB = await guardrail.resolveConnectorCredentials("tenant-b", "conn-1");

      expect(resultA).toEqual({ headers: { Authorization: "Bearer tenant-a-token" } });
      expect(resultB).toEqual({ headers: { Authorization: "Bearer tenant-b-token" } });
      expect(resultA).not.toEqual(resultB);
    });

    it("returns different secrets for two connectors in the SAME tenant sharing a credentialRefs key (no collision)", async () => {
      const resolveByConfigPath = vi.fn((_companyId, _secretId, _version, context) => {
        if (context?.configPath === "tenantConnectors.tc-x.credentialRefs.apiKey") {
          return Promise.resolve("secret-for-conn-x");
        }
        if (context?.configPath === "tenantConnectors.tc-y.credentialRefs.apiKey") {
          return Promise.resolve("secret-for-conn-y");
        }
        return Promise.reject(new Error(`unexpected configPath ${context?.configPath}`));
      });
      mockResolveSecretValue.mockImplementation(resolveByConfigPath);

      const connXRow = {
        id: "tc-x",
        credentialRefs: { apiKey: "secret:secret-x" },
        authType: "apikey",
        credentialSchema: [],
      };
      const connYRow = {
        id: "tc-y",
        credentialRefs: { apiKey: "secret:secret-y" },
        authType: "apikey",
        credentialSchema: [],
      };

      mockDb.select
        .mockReturnValueOnce(makeSingleRowChain(connXRow))
        .mockReturnValueOnce(makeSingleRowChain(connYRow));

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);

      const resultX = await guardrail.resolveConnectorCredentials("tenant-1", "conn-x");
      const resultY = await guardrail.resolveConnectorCredentials("tenant-1", "conn-y");

      expect(resultX).toEqual({ headers: { "X-API-Key": "secret-for-conn-x" } });
      expect(resultY).toEqual({ headers: { "X-API-Key": "secret-for-conn-y" } });
      expect(resultX).not.toEqual(resultY);
    });

    it("returns empty headers for unsupported auth type", async () => {
      setupGuardrailSelect({
        id: "tc-1",
        credentialRefs: { apiKey: "key" },
        authType: "unknown_type",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: {} });
    });
  });

  describe("resolveConnectorCredentialsByNamespace", () => {
    it("resolves credentials by namespace with row.id-scoped configPath", async () => {
      mockResolveSecretValue.mockResolvedValue("api-key-from-namespace");

      const chain: any = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((fn: any) => Promise.resolve(fn([{
          id: "tc-ns-1",
          credentialRefs: { apiKey: "secret:key-uuid" },
          authType: "apikey",
          credentialSchema: [],
        }]))),
      };
      mockDb.select.mockReturnValue(chain);

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentialsByNamespace("tenant-1", "gmail");

      expect(result).toEqual({ headers: { "X-API-Key": "api-key-from-namespace" } });
      expect(mockResolveSecretValue).toHaveBeenCalledWith(
        "tenant-1", "key-uuid", "latest",
        expect.objectContaining({ configPath: "tenantConnectors.tc-ns-1.credentialRefs.apiKey" }),
      );
    });

    it("returns empty headers when namespace not found", async () => {
      const chain: any = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((fn: any) => Promise.resolve(fn([]))),
      };
      mockDb.select.mockReturnValue(chain);

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentialsByNamespace("tenant-1", "unknown");

      expect(result).toEqual({ headers: {} });
      expect(mockResolveSecretValue).not.toHaveBeenCalled();
    });
  });
});