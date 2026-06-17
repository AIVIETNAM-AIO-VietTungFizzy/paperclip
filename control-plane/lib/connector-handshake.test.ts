import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { performHandshake } from "./connector-handshake.js";

describe("performHandshake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns tools on successful handshake", async () => {
    const mockTools = [
      { name: "search", description: "Search tool", inputSchema: { type: "object", properties: {} } },
    ];

    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: mockTools }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
      Client: vi.fn(() => mockClient),
    }));

    vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: vi.fn(() => ({})),
    }));

    const { performHandshake: ph } = await import("./connector-handshake.js");
    const result = await ph("http://localhost:9999");

    expect(result.tools).toEqual(mockTools);
    expect(result.error).toBeUndefined();
  });

  it("returns error when connection fails", async () => {
    const mockClient = {
      connect: vi.fn().mockRejectedValue(new Error("Connection refused")),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
      Client: vi.fn(() => mockClient),
    }));

    vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: vi.fn(() => ({})),
    }));

    const { performHandshake: ph } = await import("./connector-handshake.js");
    const result = await ph("http://localhost:9999");

    expect(result.tools).toEqual([]);
    expect(result.error).toBe("Connection refused");
  });

  it("returns error on handshake timeout", async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockImplementation(() => new Promise(() => {})),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
      Client: vi.fn(() => mockClient),
    }));

    vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: vi.fn(() => ({})),
    }));

    const { performHandshake: ph } = await import("./connector-handshake.js");
    const result = await ph("http://localhost:9999", undefined, 100);

    expect(result.tools).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("passes headers to transport", async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const transportMock = vi.fn();

    vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
      Client: vi.fn(() => mockClient),
    }));

    vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: transportMock,
    }));

    const { performHandshake: ph } = await import("./connector-handshake.js");
    await ph("http://localhost:9999", { Authorization: "Bearer test" });

    expect(transportMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: expect.objectContaining({
          headers: { Authorization: "Bearer test" },
        }),
      }),
    );
  });

  it("closes client after handshake", async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      close: closeFn,
    };

    vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
      Client: vi.fn(() => mockClient),
    }));

    vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
      StreamableHTTPClientTransport: vi.fn(() => ({})),
    }));

    const { performHandshake: ph } = await import("./connector-handshake.js");
    await ph("http://localhost:9999");

    expect(closeFn).toHaveBeenCalled();
  });
});
