import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { eq, and, notInArray, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { connectors, tenantConnectors, connectorToolRegistry } from "@paperclipai/db";
import type { EntitlementStore } from "../services/entitlement-store.js";
import { secretService } from "../services/secrets.js";
import { connectorGuardrailService } from "../services/connector-guardrail.js";

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

export function internalRoutes(
  entitlementStore?: EntitlementStore,
  db?: Db,
) {
  const router = Router();

  router.post("/sync/entitlements", async (req, res) => {
    try {
      requireCpAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "cp_service_token_required" });
      return;
    }

    const {
      tenant_id,
      tenantId,
      subscription_tier,
      subscriptionTier,
      companies,
    } = req.body as Record<string, unknown>;

    const tid = (tenant_id ?? tenantId) as string | undefined;
    const tier = (subscription_tier ?? subscriptionTier) as string | undefined;

    if (!tid || !tier) {
      res.status(400).json({ error: "tenantId and subscriptionTier are required" });
      return;
    }

    if (entitlementStore) {
      const companyIds = Array.isArray(companies) ? (companies as string[]) : undefined;
      entitlementStore.setTenantTier(tid, tier, companyIds);
    }

    if (db && entitlementStore) {
      try {
        const connectorRows = await db
          .select({ id: connectors.id, allowedPackages: connectors.allowedPackages })
          .from(connectors)
          .where(eq(connectors.status, "active"));

        const entitledIds = connectorRows
          .filter((c) => c.allowedPackages.length === 0 || c.allowedPackages.includes(tier))
          .map((c) => c.id);

        if (entitledIds.length < connectorRows.length) {
          await db
            .update(tenantConnectors)
            .set({
              status: "disabled",
              lastError: "package_tier_changed",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(tenantConnectors.tenantId, tid),
                eq(tenantConnectors.status, "enabled"),
                notInArray(tenantConnectors.connectorId, entitledIds),
              ),
            );
        }
      } catch {
        // Non-fatal: entitlement sync should not fail due to connector pre-warming
      }
    }

    res.json({ status: "accepted" });
  });

  router.get("/tenants/:tenantId/enabled-connectors", async (req, res) => {
    try {
      requireCpAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "cp_service_token_required" });
      return;
    }

    if (!db) {
      res.status(503).json({ error: "database_not_available" });
      return;
    }

    const { tenantId } = req.params;

    const rows = await db
      .select({
        id: tenantConnectors.id,
        connectorKey: connectors.connectorKey,
        connectorName: connectors.connectorName,
        namespace: tenantConnectors.namespace,
        resolvedEndpoint: tenantConnectors.resolvedEndpoint,
        status: tenantConnectors.status,
      })
      .from(tenantConnectors)
      .innerJoin(connectors, eq(tenantConnectors.connectorId, connectors.id))
      .where(
        and(
          eq(tenantConnectors.tenantId, tenantId),
          eq(tenantConnectors.status, "enabled"),
          eq(connectors.status, "active"),
        ),
      );

    const tcIds = rows.map((r) => r.id);
    let toolRows: Array<{ tenantConnectorId: string; namespacedName: string; enabled: boolean; pending: boolean }> = [];
    if (tcIds.length > 0) {
      toolRows = await db
        .select({
          tenantConnectorId: connectorToolRegistry.tenantConnectorId,
          namespacedName: connectorToolRegistry.namespacedName,
          enabled: connectorToolRegistry.enabled,
          pending: connectorToolRegistry.pending,
        })
        .from(connectorToolRegistry)
        .where(inArray(connectorToolRegistry.tenantConnectorId, tcIds));
    }

    const toolsByTc = new Map<string, { enabled: string[]; pending: string[] }>();
    for (const tr of toolRows) {
      let bucket = toolsByTc.get(tr.tenantConnectorId);
      if (!bucket) {
        bucket = { enabled: [], pending: [] };
        toolsByTc.set(tr.tenantConnectorId, bucket);
      }
      if (tr.enabled) bucket.enabled.push(tr.namespacedName);
      if (tr.pending) bucket.pending.push(tr.namespacedName);
    }

    const result = rows.map((r) => {
      const bucket = toolsByTc.get(r.id);
      return {
        ...r,
        enabledTools: bucket?.enabled ?? [],
        pendingTools: bucket?.pending ?? [],
      };
    });

    res.json(result);
  });

  router.get("/tenants/:tenantId/connector-by-namespace/:namespace", async (req, res) => {
    try {
      requireCpAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "cp_service_token_required" });
      return;
    }

    if (!db || !entitlementStore) {
      res.status(503).json({ error: "database_not_available" });
      return;
    }

    const { tenantId, namespace } = req.params;

    const row = await db
      .select({
        id: tenantConnectors.id,
        connectorKey: connectors.connectorKey,
        connectorName: connectors.connectorName,
        namespace: tenantConnectors.namespace,
        resolvedEndpoint: tenantConnectors.resolvedEndpoint,
        allowedPackages: connectors.allowedPackages,
      })
      .from(tenantConnectors)
      .innerJoin(connectors, eq(tenantConnectors.connectorId, connectors.id))
      .where(
        and(
          eq(tenantConnectors.tenantId, tenantId),
          eq(tenantConnectors.namespace, namespace),
          eq(tenantConnectors.status, "enabled"),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!row) { res.status(404).json({ error: "connector_not_found" }); return; }

    const tier = entitlementStore.getTierForCompany(tenantId) ?? "free";
    const packageTier = row.allowedPackages?.includes(tier) ? tier : "denied";

    const toolRows = await db
      .select({
        namespacedName: connectorToolRegistry.namespacedName,
        enabled: connectorToolRegistry.enabled,
      })
      .from(connectorToolRegistry)
      .where(
        and(
          eq(connectorToolRegistry.tenantConnectorId, row.id),
          eq(connectorToolRegistry.enabled, true),
        ),
      );

    const enabledTools = toolRows.map((tr) => tr.namespacedName);

    res.json({ ...row, packageTier, enabledTools });
  });

  router.get("/tenants/:tenantId/connectors/:connectorId/credential-headers", async (req, res) => {
    try {
      requireCpAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "cp_service_token_required" });
      return;
    }

    if (!db) {
      res.status(503).json({ error: "database_not_available" });
      return;
    }

    const { tenantId, connectorId } = req.params;
    const secrets = secretService(db);
    const guardrail = connectorGuardrailService(db, secrets);
    const result = await guardrail.resolveConnectorCredentials(tenantId, connectorId);
    res.json(result);
  });

  return router;
}
