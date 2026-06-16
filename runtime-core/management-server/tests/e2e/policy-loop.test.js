import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createEnforcementProxy } from "../../src/enforcement-proxy.js";
import { createEntitlementProxy } from "../../src/entitlement-proxy.js";

const ORIGINAL_RUNTIME_SERVICE_TOKEN = process.env.RUNTIME_SERVICE_TOKEN;
const ORIGINAL_CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/core", createEnforcementProxy());
  app.use("/api/runtime/internal", createEntitlementProxy());
  return { app };
}

describe("Policy Loop E2E Smoke Test (Steps 3–5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUNTIME_SERVICE_TOKEN = "test-runtime-token";
    process.env.CP_SERVICE_TOKEN = "test-cp-token";
  });

  afterEach(() => {
    if (ORIGINAL_RUNTIME_SERVICE_TOKEN === undefined) {
      delete process.env.RUNTIME_SERVICE_TOKEN;
    } else {
      process.env.RUNTIME_SERVICE_TOKEN = ORIGINAL_RUNTIME_SERVICE_TOKEN;
    }
    if (ORIGINAL_CP_SERVICE_TOKEN === undefined) {
      delete process.env.CP_SERVICE_TOKEN;
    } else {
      process.env.CP_SERVICE_TOKEN = ORIGINAL_CP_SERVICE_TOKEN;
    }
    vi.restoreAllMocks();
  });

  it("Step 3: Bob's exec call → deny from enforce", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          decision: "deny",
          reason: "package_not_allowed_for_tool",
          tool: "exec",
          required_package: "L3",
          user_package: "L1",
        }),
        { status: 200 },
      ),
    );

    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("X-Service-Token", "test-runtime-token")
      .send({
        tenant_id: "acme",
        user_id: "bob-uuid",
        tool: "exec",
        risk_class: "high",
        package_tier: "L1",
      });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("deny");
    expect(res.body.reason).toBe("package_not_allowed_for_tool");
  });

  it("Step 4a: Bob's gateway call → require_approval from paperclip_board", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          decision: "require_approval",
          responder_surface: "paperclip_board",
          trace_id: "trace-123",
        }),
        { status: 200 },
      ),
    );

    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/enforce")
      .set("X-Service-Token", "test-runtime-token")
      .send({
        tenant_id: "acme",
        user_id: "bob-uuid",
        tool: "gateway",
        risk_class: "medium",
        package_tier: "L1",
      });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("require_approval");
    expect(res.body.responder_surface).toBe("paperclip_board");
    expect(res.body.trace_id).toBeDefined();
  });

  it("Step 4b: Alice approves → resume callback → action completes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ decision: "allow", trace_id: "trace-123" }),
        { status: 200 },
      ),
    );

    const { app } = createApp();
    const res = await request(app)
      .post("/api/core/approvals/resume")
      .set("X-Service-Token", "test-runtime-token")
      .send({
        trace_id: "trace-123",
        tenant_id: "acme",
        user_id: "bob-uuid",
        decision: "approved",
      });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe("allow");
    expect(res.body.trace_id).toBe("trace-123");
  });

  it("Step 5: Entitlement sync carries workspace isolation metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "accepted",
          entitlements: {
            personal_workspace: { path: "/workspace/bob", type: "personal" },
            shared_workspace: { path: "/workspace/shared", type: "shared" },
          },
        }),
        { status: 200 },
      ),
    );

    const { app } = createApp();
    const res = await request(app)
      .post("/api/runtime/internal/sync/entitlements")
      .set("X-Service-Token", "test-runtime-token")
      .send({
        tenant_id: "acme",
        subscription_tier: "L1",
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
  });
});