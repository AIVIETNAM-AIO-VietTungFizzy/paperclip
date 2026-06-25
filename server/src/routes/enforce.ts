import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { and, eq } from "drizzle-orm";
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
      // Resolve the registry row scoped to the tenant + namespaced tool name.
      // Joining tenantConnectors ensures we only match rows belonging to the
      // tenant, and filtering by namespacedName pins the exact tool so a
      // multi-connector tenant resolves the correct connector's registry
      // (C1: previously we picked any tenant_connector row by tenantId alone).
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
        .innerJoin(
          tenantConnectors,
          eq(connectorToolRegistry.tenantConnectorId, tenantConnectors.id),
        )
        .where(
          and(
            eq(tenantConnectors.tenantId, tenant_id as string),
            eq(connectorToolRegistry.namespacedName, String(tool_id)),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

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
