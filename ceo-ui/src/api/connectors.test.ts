import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { connectorsApi } from "./connectors";

describe("connectorsApi", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    mockApi.patch.mockReset();
    mockApi.delete.mockReset();
    mockApi.get.mockResolvedValue({});
    mockApi.post.mockResolvedValue({});
    mockApi.patch.mockResolvedValue({});
    mockApi.delete.mockResolvedValue({});
  });

  describe("list", () => {
    it("calls GET /connectors", async () => {
      await connectorsApi.list();
      expect(mockApi.get).toHaveBeenCalledWith("/connectors");
    });
  });

  describe("get", () => {
    it("calls GET /connectors/:id", async () => {
      await connectorsApi.get("conn-1");
      expect(mockApi.get).toHaveBeenCalledWith("/connectors/conn-1");
    });
  });

  describe("create", () => {
    it("calls POST /connectors with the input body", async () => {
      const input = {
        connectorKey: "my-connector",
        connectorName: "My Connector",
        description: "A test connector",
        endpointUrl: "https://example.com/mcp",
        hostingMode: "remote" as const,
        authType: "none",
        credentialSchema: [],
        allowedPackages: [],
      };
      await connectorsApi.create(input);
      expect(mockApi.post).toHaveBeenCalledWith("/connectors", input);
    });
  });

  describe("update", () => {
    it("calls PATCH /connectors/:id with the partial body", async () => {
      await connectorsApi.update("conn-1", { connectorName: "Updated Name" });
      expect(mockApi.patch).toHaveBeenCalledWith("/connectors/conn-1", {
        connectorName: "Updated Name",
      });
    });
  });

  describe("delete", () => {
    it("calls DELETE /connectors/:id", async () => {
      await connectorsApi.delete("conn-1");
      expect(mockApi.delete).toHaveBeenCalledWith("/connectors/conn-1");
    });
  });

  describe("testEndpoint", () => {
    it("calls POST /connectors/:id/test", async () => {
      await connectorsApi.testEndpoint("conn-1");
      expect(mockApi.post).toHaveBeenCalledWith("/connectors/conn-1/test");
    });
  });
});
