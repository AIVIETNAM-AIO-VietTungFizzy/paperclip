import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let requestResult: unknown = null;
let shouldRejectConnect: string | null = null;

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
  update: vi.fn(),
}));

const mockConnectorsTable = vi.hoisted(() => ({}));

vi.mock("@paperclipai/db", () => ({
  connectors: mockConnectorsTable,
}));

function makeSelectChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain = Object.assign(promise, {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  });
  mockDb.select.mockReturnValue(chain);
  return chain;
}

function makeUpdateChain() {
  const promise = Promise.resolve([{ id: "c1" }]);
  const chain = Object.assign(promise, {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "c1" }]),
  });
  mockDb.update.mockReturnValue(chain);
  return chain;
}

describe("connectorRefreshService.refreshConnectorTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestResult = null;
    shouldRejectConnect = null;
    mockClient.instances.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("probes the connector endpoint and returns the tool list", async () => {
    makeSelectChain([
      {
        id: "c1",
        connectorKey: "deerflow",
        connectorName: "DeerFlow",
        endpointUrl: "http://localhost:9999/mcp",
        authType: null,
        capabilities: null,
      },
    ]);
    makeUpdateChain();
    requestResult = {
      tools: [
        { name: "research", description: "Research", inputSchema: {} },
        { name: "send_message", description: "Send", inputSchema: {} },
      ],
    };

    const { connectorRefreshService } = await import("../services/connector-refresh.js");
    const svc = connectorRefreshService(mockDb as any);
    const result = await svc.refreshConnectorTools("c1");

    expect(result.ok).toBe(true);
    expect(result.tools).toHaveLength(2);
    expect(result.tools?.[0].name).toBe("research");
    expect(result.error).toBeUndefined();
  });

  it("records lastTestedAt and clears lastError on a successful probe", async () => {
    makeSelectChain([
      {
        id: "c1",
        connectorKey: "deerflow",
        connectorName: "DeerFlow",
        endpointUrl: "http://localhost:9999/mcp",
        authType: null,
        capabilities: null,
      },
    ]);
    const updateChain = makeUpdateChain();

    requestResult = { tools: [{ name: "research", description: "d" }] };

    const { connectorRefreshService } = await import("../services/connector-refresh.js");
    const svc = connectorRefreshService(mockDb as any);
    await svc.refreshConnectorTools("c1");

    expect(mockDb.update).toHaveBeenCalled();
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.lastTestedAt).toBeInstanceOf(Date);
    expect(setArg.lastError).toBeNull();
  });

  it("returns ok:false with an error when the probe fails", async () => {
    makeSelectChain([
      {
        id: "c1",
        connectorKey: "deerflow",
        connectorName: "DeerFlow",
        endpointUrl: "http://invalid:9999/mcp",
        authType: null,
        capabilities: null,
      },
    ]);
    const updateChain = makeUpdateChain();
    shouldRejectConnect = "Connection refused";

    const { connectorRefreshService } = await import("../services/connector-refresh.js");
    const svc = connectorRefreshService(mockDb as any);
    const result = await svc.refreshConnectorTools("c1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Connection refused");
    expect(result.tools).toBeUndefined();
    expect(mockDb.update).toHaveBeenCalled();
    const setArg = updateChain.set.mock.calls[0][0];
    expect(setArg.lastError).toBe("Connection refused");
  });

  it("returns ok:false when the connector is not found", async () => {
    makeSelectChain([]);

    const { connectorRefreshService } = await import("../services/connector-refresh.js");
    const svc = connectorRefreshService(mockDb as any);
    const result = await svc.refreshConnectorTools("missing");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("connector_not_found");
  });

  it("returns ok:false when the connector has no endpointUrl", async () => {
    makeSelectChain([
      {
        id: "c1",
        connectorKey: "deerflow",
        connectorName: "DeerFlow",
        endpointUrl: null,
        authType: null,
        capabilities: null,
      },
    ]);

    const { connectorRefreshService } = await import("../services/connector-refresh.js");
    const svc = connectorRefreshService(mockDb as any);
    const result = await svc.refreshConnectorTools("c1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_endpoint_url");
  });
});