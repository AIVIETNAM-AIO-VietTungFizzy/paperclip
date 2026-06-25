import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { connectorToolRegistry, tenantConnectors } from "@paperclipai/db";

function requireCpAuth(req: import("express").Request): void {
  const expectedToken = process.env.CP_SERVICE_TOKEN;
  if (!expectedToken) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }

  const authHeader = req.header("authorization");
  const serviceToken = req.header("x-service-token");
  const rawToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : serviceToken?.trim();

  if (!rawToken) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(rawToken);

  if (expected.length !== provided.length) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }

  if (!timingSafeEqual(expected, provided)) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }
}

export function enforceRoutes(db?: Db) {
  const router = Router();

  router.post("/enforce", async (req, res) => {
    try {
      requireCpAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "cp_service_token_required" });
      return;
    }

    const { tenant_id, tool_id } = req.body as Record<string, unknown>;

    if (!tenant_id || !tool_id) {
      res.status(400).json({ error: "tenant_id and tool_id are required" });
      return;
    }

    const separatorIdx = String(tool_id).indexOf("__");
    if (separatorIdx === -1) {
      res.json({ decision: "allow", reason: "builtin_tool" });
      return;
    }

    if (!db) {
      res.status(503).json({ error: "database_not_available" });
      return;
    }

    try {
      const tcRow = await db
        .select({ id: tenantConnectors.id })
        .from(tenantConnectors)
        .where(eq(tenantConnectors.tenantId, tenant_id as string))
        .limit(1)
        .then((r) => r[0]);

      if (!tcRow) {
        res.status(403).json({ decision: "deny", reason: "tenant_connector_not_found" });
        return;
      }

      const toolRow = await db
        .select({
          namespacedName: connectorToolRegistry.namespacedName,
          enabled: connectorToolRegistry.enabled,
          pending: connectorToolRegistry.pending,
          riskClass: connectorToolRegistry.riskClass,
          approvalClass: connectorToolRegistry.approvalClass,
          requiresApproval: connectorToolRegistry.requiresApproval,
        })
        .from(connectorToolRegistry)
        .where(eq(connectorToolRegistry.tenantConnectorId, tcRow.id))
        .limit(100)
        .then((r) => r.find((t) => t.namespacedName === tool_id));

      if (!toolRow) {
        res.status(403).json({ decision: "deny", reason: "tool_not_registered" });
        return;
      }

      if (!toolRow.enabled) {
        res.status(403).json({ decision: "deny", reason: "tool_disabled" });
        return;
      }

      if (toolRow.pending) {
        res.status(403).json({ decision: "deny", reason: "tool_pending_approval" });
        return;
      }

      res.json({
        decision: "allow",
        risk_class: toolRow.riskClass ?? "connector",
        approval_class: toolRow.approvalClass ?? "auto",
        requires_approval: toolRow.requiresApproval,
      });
    } catch (err) {
      res.status(500).json({ error: "enforce_error", message: String(err) });
    }
  });

  return router;
}