import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
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

// C2: validate the enforce request body with zod. A non-string tool_id (e.g.
// an object {"__":"x"}) must 400, not fall through to the builtin-tool short
// circuit via String(tool_id) → "[object Object]". I2: employee_id is
// optional but accepted so the policy matrix can make per-employee decisions.
const enforceRequestSchema = z.object({
  tenant_id: z.string().min(1),
  tool_id: z.string().min(1),
  intent_kind: z.string().optional(),
  caller_service: z.string().optional(),
  employee_id: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  package: z.string().optional(),
});

// I5: the enforce response decision is a closed enum. Validating on the
// producer side closes C1's root cause — the gateway can rely on the
// decision field being one of allow/deny/require_approval.
const ALLOWED_DECISIONS = new Set(["allow", "deny", "require_approval"]);

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

    const parsed = enforceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue?.path?.[0] ?? "input";
      res.status(400).json({ error: `${field}_invalid`, message: firstIssue?.message ?? "invalid request body" });
      return;
    }

    const { tenant_id, tool_id } = parsed.data;

    const separatorIdx = tool_id.indexOf("__");
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
            eq(tenantConnectors.tenantId, tenant_id),
            eq(connectorToolRegistry.namespacedName, tool_id),
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

      // I5: validate the decision is in the closed enum before sending. This
      // is belt-and-suspenders — the three paths above all emit known values,
      // but this guards against future regressions.
      const decision = toolRow.requiresApproval ? "require_approval" : "allow";
      if (!ALLOWED_DECISIONS.has(decision)) {
        res.status(500).json({ error: "enforce_internal_error" });
        return;
      }

      res.json({
        decision,
        risk_class: toolRow.riskClass ?? "connector",
        approval_class: toolRow.approvalClass ?? "auto",
        requires_approval: toolRow.requiresApproval,
      });
    } catch (err) {
      console.error("[enforce] internal error:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: "enforce_error" });
    }
  });

  return router;
}
