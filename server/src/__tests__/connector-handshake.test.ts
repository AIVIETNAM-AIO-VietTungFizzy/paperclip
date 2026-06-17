import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let shouldRejectConnect: string | null = null;
let requestResult: unknown = null;

const mockClient = vi.hoisted(() => {
  const instances: Array<{ close: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }> = [];
  class Client {
    close = vi.fn().mockResolvedValue(undefined);
    connect = vi.fn().mockImplementation(() => {
      if (shouldRejectConnect) return Promise.reject(new Error(shouldRejectConnect));
      return Promise.resolve(undefined);
    });
    request = vi.fn().mockImplementation(() => {
      if (requestResult !== null) return Promise.resolve(requestResult);
      return Promise.resolve({ tools: [] });
    });
    constructor() {
      instances.push(this);
    }
  }
  return { Client, instances };
});

const mockStreamableHTTPClientTransport = vi.hoisted(() =>
  vi.fn().mockImplementation(function () {
    return {};
  }),
);

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: mockClient.Client,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: mockStreamableHTTPClientTransport,
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

const mockTenantConnectorsTable = vi.hoisted(() => ({}));
const mockConnectorToolRegistryTable = vi.hoisted(() => ({}));

vi.mock("@paperclipai/db", () => ({
  tenantConnectors: mockTenantConnectorsTable,
  connectorToolRegistry: mockConnectorToolRegistryTable,
}));

function makeSelectChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain = Object.assign(promise, {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  });
  return chain;
}

function makeInsertChain() {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
  };
}

function makeUpdateChain() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  };
}

describe("connectorHandshakeService", () => {
  let handshakeService: ReturnType<typeof import("../services/connector-handshake.js").connectorHandshakeService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient.instances.length = 0;
    shouldRejectConnect = null;
    requestResult = null;
    const mod = await import("../services/connector-handshake.js");
    handshakeService = mod.connectorHandshakeService(mockDb as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("performs a successful handshake and persists tools", async () => {
    requestResult = {
      tools: [
        { name: "send_email", description: "Send an email", inputSchema: { type: "object", properties: {} } },
        { name: "list_emails", description: "List emails", inputSchema: { type: "object", properties: {} } },
      ],
    };

    const tcRow = { id: "tc-1", tenantId: "tenant-1", connectorId: "conn-1" };
    const selectChain = makeSelectChain([tcRow]);
    mockDb.select.mockReturnValue(selectChain);

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    const result = await handshakeService.handshake(
      "tenant-1", "conn-1", "http://example.com/mcp", "gmail",
    );

    const client = mockClient.instances[0];

    expect(result).toEqual({ success: true });
    expect(client.constructor).toBe(mockClient.Client);
    expect(client.connect).toHaveBeenCalled();
    expect(client.request).toHaveBeenCalledTimes(1);
    const callArgs = client.request.mock.calls[0];
    expect(callArgs[0]).toEqual({ method: "tools/list", params: {} });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(insertChain.values).toHaveBeenCalledTimes(2);
    expect(mockDb.update).toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  });

  it("passes credential headers when provided", async () => {
    requestResult = { tools: [] };

    const tcRow = { id: "tc-1", tenantId: "tenant-1", connectorId: "conn-1" };
    const selectChain = makeSelectChain([tcRow]);
    mockDb.select.mockReturnValue(selectChain);

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    await handshakeService.handshake(
      "tenant-1", "conn-1", "http://example.com/mcp", "gmail",
      { Authorization: "Bearer token-123" },
    );

    expect(mockStreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL("http://example.com/mcp"),
      { requestInit: { headers: { Authorization: "Bearer token-123" } } },
    );
  });

  it("returns success with empty tools when no tools are returned", async () => {
    requestResult = { tools: [] };

    const tcRow = { id: "tc-1", tenantId: "tenant-1", connectorId: "conn-1" };
    const selectChain = makeSelectChain([tcRow]);
    mockDb.select.mockReturnValue(selectChain);

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    const result = await handshakeService.handshake(
      "tenant-1", "conn-1", "http://example.com/mcp", "gmail",
    );

    expect(result).toEqual({ success: true });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns success when no tenant connector row exists", async () => {
    requestResult = { tools: [{ name: "test_tool" }] };

    const selectChain = makeSelectChain([]);
    mockDb.select.mockReturnValue(selectChain);

    const result = await handshakeService.handshake(
      "tenant-1", "conn-1", "http://example.com/mcp", "gmail",
    );

    expect(result).toEqual({ success: true });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns failure when handshake errors and updates status to failed", async () => {
    shouldRejectConnect = "Connection refused";

    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    const result = await handshakeService.handshake(
      "tenant-1", "conn-1", "http://example.com/mcp", "gmail",
    );

    expect(result).toEqual({ success: false, error: "Connection refused" });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockClient.instances[0].close).toHaveBeenCalled();
  });

  it("closes the client in finally block even on success", async () => {
    requestResult = { tools: [] };

    const tcRow = { id: "tc-1", tenantId: "tenant-1", connectorId: "conn-1" };
    const selectChain = makeSelectChain([tcRow]);
    mockDb.select.mockReturnValue(selectChain);

    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    await handshakeService.handshake(
      "tenant-1", "conn-1", "http://example.com/mcp", "gmail",
    );

    expect(mockClient.instances[0].close).toHaveBeenCalled();
  });

  it("closes the client in finally block even on error", async () => {
    shouldRejectConnect = "Timeout";

    const updateChain = makeUpdateChain();
    mockDb.update.mockReturnValue(updateChain);

    await handshakeService.handshake(
      "tenant-1", "conn-1", "http://example.com/mcp", "gmail",
    );

    expect(mockClient.instances[0].close).toHaveBeenCalled();
  });
});
