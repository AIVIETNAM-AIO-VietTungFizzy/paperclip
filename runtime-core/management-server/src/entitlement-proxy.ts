import { Router } from "express";
import { timingSafeEqual } from "node:crypto";

function requireRuntimeAuth(req: import("express").Request): void {
  const expectedToken = process.env.RUNTIME_SERVICE_TOKEN;
  if (!expectedToken) {
    throw Object.assign(new Error("runtime_service_token_required"), { status: 401 });
  }

  const serviceToken = req.header("x-service-token");
  if (!serviceToken) {
    throw Object.assign(new Error("runtime_service_token_required"), { status: 401 });
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(serviceToken);

  if (expected.length !== provided.length) {
    throw Object.assign(new Error("runtime_service_token_required"), { status: 401 });
  }

  if (!timingSafeEqual(expected, provided)) {
    throw Object.assign(new Error("runtime_service_token_required"), { status: 401 });
  }
}

export function createEntitlementProxy(): Router {
  const router = Router();

  router.post("/sync/entitlements", async (req, res) => {
    try {
      requireRuntimeAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "runtime_service_token_required" });
      return;
    }

    const { tenant_id, subscription_tier, companies } = req.body as Record<string, unknown>;

    if (!tenant_id) {
      res.status(400).json({ error: "tenant_id is required" });
      return;
    }

    if (!subscription_tier) {
      res.status(400).json({ error: "subscription_tier is required" });
      return;
    }

    const paperclipUrl = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
    const cpToken = process.env.CP_SERVICE_TOKEN || "";

    try {
      const upstreamRes = await fetch(
        `${paperclipUrl}/api/runtime/internal/sync/entitlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Service-Token": cpToken,
          },
          body: JSON.stringify({
            tenant_id,
            subscription_tier,
            ...(Array.isArray(companies) ? { companies } : {}),
          }),
        },
      );

      const body = await upstreamRes.json();
      res.status(upstreamRes.status).json(body);
    } catch {
      res.status(502).json({ error: "upstream_unreachable" });
    }
  });

  return router;
}