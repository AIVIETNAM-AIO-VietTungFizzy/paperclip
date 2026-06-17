export class ConnectorClientPool {
  constructor(opts?: { timeoutMs?: number; idleCleanupIntervalMs?: number; clientTtlMs?: number });
  getOrCreateClient(tenantId: string, connectorKey: string, endpointUrl: string, headers?: Record<string, string>): Promise<import("@modelcontextprotocol/sdk/client/index.js").Client>;
  releaseClient(tenantId: string, connectorKey: string): Promise<void>;
  releaseAll(): Promise<void>;
  teardown(): Promise<void>;
}
