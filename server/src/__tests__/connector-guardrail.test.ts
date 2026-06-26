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
        credentialRefs: { username: "alice", password: "secret" },
        authType: "basic",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { Authorization: "Basic YWxpY2U6c2VjcmV0" } });
    });

    it("resolves secret:<uuid> refs via secrets service", async () => {
      mockResolveSecretValue.mockImplementation((_companyId, secretId, _version, _context) => {
        if (secretId === "secret-uuid-1") return Promise.resolve("resolved-api-key");
        if (secretId === "secret-uuid-2") return Promise.resolve("resolved-header");
        return Promise.reject(new Error("unexpected"));
      });

      setupGuardrailSelect({
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
        "tenant-1", "secret-uuid-1", "latest", expect.objectContaining({ consumerType: "system" }),
      );
    });

    it("mixes plain and secret refs", async () => {
      mockResolveSecretValue.mockResolvedValue("decrypted-token");

      setupGuardrailSelect({
        credentialRefs: { token: "secret:token-uuid", headerName: "X-Auth" },
        authType: "bearer",
        credentialSchema: [],
      });

      const { connectorGuardrailService } = await import("../services/connector-guardrail.js");
      const guardrail = connectorGuardrailService(mockDb as any, { resolveSecretValue: mockResolveSecretValue } as any);
      const result = await guardrail.resolveConnectorCredentials("tenant-1", "conn-1");

      expect(result).toEqual({ headers: { Authorization: "Bearer decrypted-token" } });
    });

    it("returns different headers for different tenants (same connector)", async () => {
      const tenantARow = {
        credentialRefs: { token: "tenant-a-token" },
        authType: "bearer",
        credentialSchema: [],
      };
      const tenantBRow = {
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

    it("returns empty headers for unsupported auth type", async () => {
      setupGuardrailSelect({
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
    it("resolves credentials by namespace", async () => {
      mockResolveSecretValue.mockResolvedValue("api-key-from-namespace");

      const chain: any = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((fn: any) => Promise.resolve(fn([{
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
