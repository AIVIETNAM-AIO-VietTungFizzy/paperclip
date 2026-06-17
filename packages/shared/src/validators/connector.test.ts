import { describe, expect, it } from "vitest";
import {
  createConnectorSchema,
  updateConnectorSchema,
  enableConnectorSchema,
  updateTenantConnectorSchema,
} from "./connector.js";

describe("createConnectorSchema", () => {
  it("accepts a valid create connector payload with all fields", () => {
    const parsed = createConnectorSchema.parse({
      connectorKey: "deerflow",
      connectorName: "DeerFlow",
      description: "DeerFlow MCP connector",
      endpointUrl: "https://deerflow.example.com/mcp",
      hostingMode: "remote",
      authType: "api_key",
      credentialSchema: [
        { key: "api_key", label: "API Key", secret: true, required: true },
      ],
      allowedPackages: ["pro", "enterprise"],
    });

    expect(parsed.connectorKey).toBe("deerflow");
    expect(parsed.connectorName).toBe("DeerFlow");
    expect(parsed.hostingMode).toBe("remote");
    expect(parsed.credentialSchema).toHaveLength(1);
    expect(parsed.allowedPackages).toEqual(["pro", "enterprise"]);
  });

  it("applies defaults for optional fields", () => {
    const parsed = createConnectorSchema.parse({
      connectorKey: "minimal",
      connectorName: "Minimal",
    });

    expect(parsed.hostingMode).toBe("remote");
    expect(parsed.credentialSchema).toEqual([]);
    expect(parsed.allowedPackages).toEqual([]);
    expect(parsed.description).toBeUndefined();
    expect(parsed.endpointUrl).toBeUndefined();
    expect(parsed.authType).toBeUndefined();
  });

  it("rejects invalid connectorKey (uppercase)", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "DeerFlow",
      connectorName: "DeerFlow",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid connectorKey (special chars)", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "deer flow!",
      connectorName: "DeerFlow",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid endpointUrl", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "deerflow",
      connectorName: "DeerFlow",
      endpointUrl: "not-a-url",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields via strict mode", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "deerflow",
      connectorName: "DeerFlow",
      extraField: "should not be here",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects empty connectorKey", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "",
      connectorName: "DeerFlow",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects empty connectorName", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "deerflow",
      connectorName: "",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid hostingMode", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "deerflow",
      connectorName: "DeerFlow",
      hostingMode: "on_prem",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects credential schema entries without key", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "deerflow",
      connectorName: "DeerFlow",
      credentialSchema: [{ label: "API Key" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects credential schema entries without label", () => {
    const parsed = createConnectorSchema.safeParse({
      connectorKey: "deerflow",
      connectorName: "DeerFlow",
      credentialSchema: [{ key: "api_key" }],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("updateConnectorSchema", () => {
  it("accepts a partial update payload", () => {
    const parsed = updateConnectorSchema.parse({
      connectorName: "Updated Name",
      status: "inactive",
    });

    expect(parsed.connectorName).toBe("Updated Name");
    expect(parsed.status).toBe("inactive");
  });

  it("accepts an empty update payload", () => {
    const parsed = updateConnectorSchema.parse({});

    expect(Object.keys(parsed)).toHaveLength(0);
  });

  it("rejects unknown fields via strict mode", () => {
    const parsed = updateConnectorSchema.safeParse({
      connectorKey: "cannot-change-key",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid status value", () => {
    const parsed = updateConnectorSchema.safeParse({
      status: "deleted",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid hostingMode on update", () => {
    const parsed = updateConnectorSchema.safeParse({
      hostingMode: "hybrid",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts updating credential schema", () => {
    const parsed = updateConnectorSchema.parse({
      credentialSchema: [
        { key: "token", label: "Access Token", secret: true },
      ],
    });

    expect(parsed.credentialSchema).toHaveLength(1);
    expect(parsed.credentialSchema![0].key).toBe("token");
  });
});

describe("enableConnectorSchema", () => {
  it("accepts a valid enable payload with credentials", () => {
    const parsed = enableConnectorSchema.parse({
      credentialValues: { api_key: "sk-123" },
      namespace: "deerflow-prod",
    });

    expect(parsed.credentialValues).toEqual({ api_key: "sk-123" });
    expect(parsed.namespace).toBe("deerflow-prod");
  });

  it("applies defaults for optional fields", () => {
    const parsed = enableConnectorSchema.parse({});

    expect(parsed.credentialValues).toEqual({});
    expect(parsed.namespace).toBeUndefined();
  });

  it("rejects invalid namespace (uppercase)", () => {
    const parsed = enableConnectorSchema.safeParse({
      namespace: "DeerFlow-Prod",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid namespace (special chars)", () => {
    const parsed = enableConnectorSchema.safeParse({
      namespace: "deerflow prod!",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields via strict mode", () => {
    const parsed = enableConnectorSchema.safeParse({
      extraField: "not allowed",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("updateTenantConnectorSchema", () => {
  it("accepts a valid update payload", () => {
    const parsed = updateTenantConnectorSchema.parse({
      credentialValues: { api_key: "sk-456" },
      namespace: "deerflow-staging",
    });

    expect(parsed.credentialValues).toEqual({ api_key: "sk-456" });
    expect(parsed.namespace).toBe("deerflow-staging");
  });

  it("accepts an empty update payload", () => {
    const parsed = updateTenantConnectorSchema.parse({});

    expect(Object.keys(parsed)).toHaveLength(0);
  });

  it("rejects invalid namespace", () => {
    const parsed = updateTenantConnectorSchema.safeParse({
      namespace: "Invalid Namespace!",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields via strict mode", () => {
    const parsed = updateTenantConnectorSchema.safeParse({
      tenantId: "should-not-be-here",
    });

    expect(parsed.success).toBe(false);
  });
});
