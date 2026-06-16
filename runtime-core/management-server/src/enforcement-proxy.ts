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

export function createEnforcementProxy(): Router {
  const router = Router();

  const cpBaseUrl = process.env.CP_URL || "http://localhost:3001";

  router.post("/enforce", async (req, res) => {
    try {
      requireRuntimeAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "runtime_service_token_required" });
      return;
    }

    const { tenant_id, user_id, tool, risk_class, package_tier } = req.body as Record<string, unknown>;

    if (!tenant_id || !tool) {
      res.status(400).json({ error: "tenant_id and tool are required" });
      return;
    }

    try {
      const upstreamRes = await fetch(
        `${cpBaseUrl}/api/core/enforce`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Service-Token": process.env.CP_SERVICE_TOKEN || "",
          },
          body: JSON.stringify({ tenant_id, user_id, tool, risk_class, package_tier }),
        },
      );

      const body = await upstreamRes.json();
      res.status(upstreamRes.status).json(body);
    } catch {
      res.status(502).json({ error: "cp_unreachable" });
    }
  });

  router.post("/approvals/resume", async (req, res) => {
    try {
      requireRuntimeAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "runtime_service_token_required" });
      return;
    }

    const { trace_id, tenant_id, user_id, decision } = req.body as Record<string, unknown>;

    if (!trace_id || !decision) {
      res.status(400).json({ error: "trace_id and decision are required" });
      return;
    }

    try {
      const upstreamRes = await fetch(
        `${cpBaseUrl}/api/core/approvals/resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Service-Token": process.env.CP_SERVICE_TOKEN || "",
          },
          body: JSON.stringify({ trace_id, tenant_id, user_id, decision }),
        },
      );

      const body = await upstreamRes.json();
      res.status(upstreamRes.status).json(body);
    } catch {
      res.status(502).json({ error: "cp_unreachable" });
    }
  });

  return router;
}