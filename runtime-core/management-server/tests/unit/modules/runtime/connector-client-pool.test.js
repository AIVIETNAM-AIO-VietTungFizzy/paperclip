import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const closeMock = vi.fn().mockResolvedValue(undefined);

const StreamableHTTPClientTransportMock = vi.fn(function() { return {}; });
const ClientMock = vi.fn(function() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: closeMock,
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: ClientMock,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: StreamableHTTPClientTransportMock,
}));

describe("ConnectorClientPool", () => {
  let pool;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (pool) {
      await pool.teardown();
    }
    vi.restoreAllMocks();
  });

  it("creates and returns a client for a new (tenantId, connectorKey)", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool();
    const client = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    expect(client).toBeDefined();
    expect(ClientMock).toHaveBeenCalledTimes(1);
  });

  it("returns the same cached client for repeated calls", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool();
    const client1 = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    const client2 = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    expect(client1).toBe(client2);
    expect(ClientMock).toHaveBeenCalledTimes(1);
  });

  it("creates separate clients for different tenantIds", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool();
    const client1 = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    const client2 = await pool.getOrCreateClient("tenant-2", "deerflow", "http://deerflow.local:3000");
    expect(client1).not.toBe(client2);
    expect(ClientMock).toHaveBeenCalledTimes(2);
  });

  it("creates separate clients for different connectorKeys", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool();
    const client1 = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    const client2 = await pool.getOrCreateClient("tenant-1", "microfish", "http://microfish.local:3000");
    expect(client1).not.toBe(client2);
    expect(ClientMock).toHaveBeenCalledTimes(2);
  });

  it("passes headers to transport when provided", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool();
    await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000", {
      Authorization: "Bearer test-token",
    });
    expect(StreamableHTTPClientTransportMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: expect.objectContaining({
          headers: { Authorization: "Bearer test-token" },
        }),
      }),
    );
  });

  it("creates a new client after release", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool();
    const client1 = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    await pool.releaseClient("tenant-1", "deerflow");
    const client2 = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    expect(client1).not.toBe(client2);
    expect(ClientMock).toHaveBeenCalledTimes(2);
  });

  it("releases all clients on teardown", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool();
    await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    await pool.getOrCreateClient("tenant-1", "microfish", "http://microfish.local:3000");
    await pool.teardown();
    expect(closeMock).toHaveBeenCalledTimes(2);
  });

  it("applies custom timeout", async () => {
    const { ConnectorClientPool } = await import("../../../../modules/runtime/connector-client-pool.js");
    pool = new ConnectorClientPool({ timeoutMs: 5000 });
    const client = await pool.getOrCreateClient("tenant-1", "deerflow", "http://deerflow.local:3000");
    expect(client).toBeDefined();
  });
});
