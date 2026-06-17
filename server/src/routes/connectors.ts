import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { connectors as connectorsTable, tenantConnectors, connectorToolRegistry } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { connectorEntitlementService } from "../services/connector-entitlement.js";
import { connectorHandshakeService } from "../services/connector-handshake.js";
import { createConnectorSchema, updateConnectorSchema, enableConnectorSchema, updateTenantConnectorSchema } from "@paperclipai/shared";

export function connectorRoutes(db: Db) {
  const router = Router();
  const entitlement = connectorEntitlementService(db);
  const handshake = connectorHandshakeService(db);

  router.get("/connectors", async (_req, res) => {
    const all = await db.select().from(connectorsTable).orderBy(connectorsTable.connectorName);
    res.json(all);
  });

  router.post("/connectors", validate(createConnectorSchema), async (req, res) => {
    assertBoard(req);
    const data = req.body;
    const created = await db
      .insert(connectorsTable)
      .values({
        connectorKey: data.connectorKey,
        connectorName: data.connectorName,
        description: data.description ?? null,
        endpointUrl: data.endpointUrl ?? null,
        hostingMode: data.hostingMode ?? "remote",
        authType: data.authType ?? null,
        credentialSchema: data.credentialSchema ?? [],
        allowedPackages: data.allowedPackages ?? [],
      })
      .returning();

    const connector = created[0];
    await logActivity(db, {
      companyId: "system",
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.created",
      entityType: "connector",
      entityId: connector.id,
      details: { connectorKey: connector.connectorKey, connectorName: connector.connectorName },
    });

    res.status(201).json(connector);
  });

  router.get("/connectors/:id", async (req, res) => {
    const id = req.params.id as string;
    const connector = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, id))
      .limit(1)
      .then((r) => r[0]);

    if (!connector) { res.status(404).json({ error: "connector_not_found" }); return; }
    res.json(connector);
  });

  router.patch("/connectors/:id", validate(updateConnectorSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, id))
      .limit(1)
      .then((r) => r[0]);

    if (!existing) { res.status(404).json({ error: "connector_not_found" }); return; }

    const updated = await db
      .update(connectorsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(connectorsTable.id, id))
      .returning();

    await logActivity(db, {
      companyId: "system",
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.updated",
      entityType: "connector",
      entityId: id,
      details: { changes: Object.keys(req.body) },
    });

    res.json(updated[0]);
  });

  router.delete("/connectors/:id", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    const existing = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, id))
      .limit(1)
      .then((r) => r[0]);

    if (!existing) { res.status(404).json({ error: "connector_not_found" }); return; }

    await db.delete(connectorsTable).where(eq(connectorsTable.id, id));

    await logActivity(db, {
      companyId: "system",
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.deleted",
      entityType: "connector",
      entityId: id,
      details: { connectorKey: existing.connectorKey },
    });

    res.status(204).send();
  });

  router.get("/companies/:companyId/connectors", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const enabled = await db
      .select()
      .from(tenantConnectors)
      .where(eq(tenantConnectors.tenantId, companyId));

    const enabledConnectorIds = new Set(enabled.map((e) => e.connectorId));

    const allConnectors = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.status, "active"));

    const result = allConnectors.map((c) => ({
      ...c,
      enabled: enabledConnectorIds.has(c.id),
      tenantConnector: enabled.find((e) => e.connectorId === c.id) ?? null,
    }));

    res.json(result);
  });

  router.post(
    "/companies/:companyId/connectors/:connectorId/enable",
    validate(enableConnectorSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const connectorId = req.params.connectorId as string;
      assertCompanyAccess(req, companyId);

      const connector = await db
        .select()
        .from(connectorsTable)
        .where(eq(connectorsTable.id, connectorId))
        .limit(1)
        .then((r) => r[0]);

      if (!connector) { res.status(404).json({ error: "connector_not_found" }); return; }

      const namespace = req.body.namespace ?? connector.connectorKey;
      const endpointUrl = connector.endpointUrl ?? "";

      const [tc] = await db
        .insert(tenantConnectors)
        .values({
          tenantId: companyId,
          connectorId,
          status: "pending_config",
          credentialRefs: {},
          namespace,
          resolvedEndpoint: endpointUrl,
        })
        .onConflictDoUpdate({
          target: [tenantConnectors.tenantId, tenantConnectors.connectorId],
          set: { status: "pending_config", namespace, resolvedEndpoint: endpointUrl, updatedAt: new Date() },
        })
        .returning();

      const result = await handshake.handshake(companyId, connectorId, endpointUrl, namespace);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: result.success ? "connector.enabled" : "connector.enable_failed",
        entityType: "tenant_connector",
        entityId: tc.id,
        details: { connectorKey: connector.connectorKey, namespace, error: result.error },
      });

      res.status(result.success ? 200 : 502).json({ id: tc.id, status: result.success ? "enabled" : "failed", error: result.error });
    },
  );

  router.patch(
    "/companies/:companyId/connectors/:connectorId",
    validate(updateTenantConnectorSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const connectorId = req.params.connectorId as string;
      assertCompanyAccess(req, companyId);

      const existing = await db
        .select()
        .from(tenantConnectors)
        .where(
          and(
            eq(tenantConnectors.tenantId, companyId),
            eq(tenantConnectors.connectorId, connectorId),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (!existing) { res.status(404).json({ error: "tenant_connector_not_found" }); return; }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (req.body.namespace) patch.namespace = req.body.namespace;

      const updated = await db
        .update(tenantConnectors)
        .set(patch)
        .where(eq(tenantConnectors.id, existing.id))
        .returning();

      res.json(updated[0]);
    },
  );

  router.post("/companies/:companyId/connectors/:connectorId/disable", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    const connectorId = req.params.connectorId as string;
    assertCompanyAccess(req, companyId);

    const existing = await db
      .select()
      .from(tenantConnectors)
      .where(
        and(
          eq(tenantConnectors.tenantId, companyId),
          eq(tenantConnectors.connectorId, connectorId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!existing) { res.status(404).json({ error: "tenant_connector_not_found" }); return; }

    await db
      .delete(connectorToolRegistry)
      .where(eq(connectorToolRegistry.tenantConnectorId, existing.id));

    await db
      .update(tenantConnectors)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(tenantConnectors.id, existing.id));

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.disabled",
      entityType: "tenant_connector",
      entityId: existing.id,
      details: { connectorId },
    });

    res.json({ status: "disabled" });
  });

  return router;
}
