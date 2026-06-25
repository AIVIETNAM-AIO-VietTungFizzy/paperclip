import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { connectors as connectorsTable, tenantConnectors, connectorToolRegistry } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { connectorEntitlementService } from "../services/connector-entitlement.js";
import { connectorHandshakeService } from "../services/connector-handshake.js";
import { connectorRefreshService, probeConnectorTools } from "../services/connector-refresh.js";
import { createConnectorSchema, updateConnectorSchema, enableConnectorSchema, updateTenantConnectorSchema, setToolEnabledSchema } from "@paperclipai/shared";

export function connectorRoutes(db: Db) {
  const router = Router();
  const entitlement = connectorEntitlementService(db);
  const handshake = connectorHandshakeService(db);
  const refresh = connectorRefreshService(db);

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

  router.post("/connectors/test-endpoint", async (req, res) => {
    const { endpointUrl, authType, configuration } = req.body as {
      endpointUrl?: string;
      authType?: string | null;
      configuration?: Record<string, unknown> | null;
    };

    if (!endpointUrl || typeof endpointUrl !== "string") {
      res.status(400).json({ ok: false, error: "Endpoint URL is required" });
      return;
    }

    let headers: Record<string, string> | undefined;
    if (authType && authType !== "none") {
      const config = configuration ?? {};
      if (authType === "apikey") {
        const apiKey = config.apiKey as string | undefined;
        const headerName = (config.headerName as string) || "X-API-Key";
        if (apiKey) {
          headers = { [headerName]: apiKey };
        }
      } else if (authType === "bearer") {
        const token = config.token as string | undefined;
        if (token) {
          headers = { Authorization: `Bearer ${token}` };
        }
      } else if (authType === "basic") {
        const username = config.username as string | undefined;
        const password = config.password as string | undefined;
        if (username && password) {
          headers = { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
        }
      }
    }

    const result = await probeConnectorTools(endpointUrl, headers ? { headers } : {});
    res.json(result);
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

    // Fetch per-tool registry rows for each enabled tenant connector so the
    // UI can render the pending-approval banner and persist enable toggles.
    const registryByTenantConnector = new Map<string, unknown[]>();
    await Promise.all(
      enabled.map(async (tc) => {
        const rows = await db
          .select()
          .from(connectorToolRegistry)
          .where(eq(connectorToolRegistry.tenantConnectorId, tc.id));
        registryByTenantConnector.set(tc.id, rows);
      }),
    );

    const result = allConnectors.map((c) => {
      const tc = enabled.find((e) => e.connectorId === c.id) ?? null;
      const tools = tc ? (registryByTenantConnector.get(tc.id) ?? []) : [];
      return {
        ...c,
        enabled: enabledConnectorIds.has(c.id),
        tenantConnector: tc,
        tools,
      };
    });

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

  router.post("/connectors/:id/sync", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;

    const connector = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, id))
      .limit(1)
      .then((r) => r[0]);

    if (!connector) { res.status(404).json({ ok: false, error: "connector_not_found" }); return; }

    const priorCapabilities = (connector.capabilities ?? {}) as Record<string, unknown>;
    const priorTools = Array.isArray(priorCapabilities.tools) ? (priorCapabilities.tools as Array<{ name: string }>) : [];
    const priorNames = new Set(priorTools.map((t) => t.name));

    const result = await refresh.refreshConnectorTools(id);

    if (!result.ok) {
      res.json({ ok: false, error: result.error });
      return;
    }

    const tools = result.tools ?? [];
    const newNames = new Set(tools.map((t) => t.name));
    const added = tools.filter((t) => !priorNames.has(t.name));
    const addedNames = added.map((t) => t.name);
    const removed = [...priorNames].filter((n) => !newNames.has(n));

    const capabilities = { ...(priorCapabilities as Record<string, unknown>), tools: tools.map((t) => ({ name: t.name, description: t.description })) };
    await db
      .update(connectorsTable)
      .set({ capabilities, updatedAt: new Date() })
      .where(eq(connectorsTable.id, id));

    // Reconcile per-tenant registry: for each tenant connector enabled on this
    // connector, insert pending rows for newly-discovered tools so the tenant
    // can approve them. Existing registry rows are left untouched (re-sync must
    // not flip enabled/pending state of already-approved tools).
    if (addedNames.length > 0) {
      const enabledTenantConnectors = await db
        .select({
          id: tenantConnectors.id,
          namespace: tenantConnectors.namespace,
        })
        .from(tenantConnectors)
        .where(
          and(
            eq(tenantConnectors.connectorId, id),
            eq(tenantConnectors.status, "enabled"),
          ),
        );

      if (enabledTenantConnectors.length > 0) {
        const registryRows = [];
        for (const tc of enabledTenantConnectors) {
          const ns = tc.namespace ?? connector.connectorKey;
          for (const tool of added) {
            registryRows.push({
              tenantConnectorId: tc.id,
              toolName: tool.name,
              namespacedName: `${ns}__${tool.name}`,
              description: tool.description ?? null,
              inputSchema: tool.inputSchema ?? null,
              enabled: true,
              pending: true,
              riskClass: "connector",
              approvalClass: "auto",
              requiresApproval: false,
            });
          }
        }
        if (registryRows.length > 0) {
          await db
            .insert(connectorToolRegistry)
            .values(registryRows)
            .onConflictDoNothing({ target: [connectorToolRegistry.tenantConnectorId, connectorToolRegistry.toolName] });
        }
      }
    }

    await logActivity(db, {
      companyId: "system",
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.synced",
      entityType: "connector",
      entityId: id,
      details: { added: addedNames, removed, toolCount: tools.length },
    });

    res.json({ ok: true, added: addedNames, removed, tools });
  });

  router.patch(
    "/companies/:companyId/connectors/:connectorId/tools/:toolId",
    validate(setToolEnabledSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const connectorId = req.params.connectorId as string;
      const toolId = req.params.toolId as string;
      assertCompanyAccess(req, companyId);
      const { enabled } = req.body as { enabled: boolean };

      const tcRow = await db
        .select({ id: tenantConnectors.id })
        .from(tenantConnectors)
        .where(
          and(
            eq(tenantConnectors.tenantId, companyId),
            eq(tenantConnectors.connectorId, connectorId),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (!tcRow) { res.status(404).json({ error: "tenant_connector_not_found" }); return; }

      const toolRow = await db
        .select()
        .from(connectorToolRegistry)
        .where(
          and(
            eq(connectorToolRegistry.tenantConnectorId, tcRow.id),
            eq(connectorToolRegistry.toolName, toolId),
          ),
        )
        .limit(1)
        .then((r) => r[0]);

      if (!toolRow) { res.status(404).json({ error: "tool_not_found" }); return; }

      const updated = await db
        .update(connectorToolRegistry)
        .set({ enabled })
        .where(eq(connectorToolRegistry.id, toolRow.id))
        .returning();

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "connector.tool_enabled_toggled",
        entityType: "connector_tool",
        entityId: toolRow.id,
        details: { connectorId, toolId, enabled },
      });

      res.json({ ok: true, tool: updated[0] });
    },
  );

  return router;
}
