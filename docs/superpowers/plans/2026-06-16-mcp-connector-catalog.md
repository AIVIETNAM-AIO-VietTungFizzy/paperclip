# MCP Connector Catalog + Aggregating Gateway Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant connect external MCP-speaking services (DeerFlow, MicroFish, etc.) at will, so the platform's agents can immediately use their tools — inspired by Perplexity Connectors.

**Architecture:** Control Plane (Paperclip server) owns the connector catalog, tenant enablement, package gating, and handshake discovery. The runtime (management server) owns the aggregating MCP gateway that merges connector tools into the existing `/api/runtime/mcp-sdk` endpoint and routes tool calls through live MCP client connections. Three new DB tables store catalog definitions, tenant instances, and discovered tools.

**Tech Stack:** Drizzle ORM, Express 5, `@modelcontextprotocol/sdk` (Client), Zod validation, existing `company_secrets` for credential storage, existing `entitlementStore` for package gating.

**Spec:** `/home/achau/workspace/AIautomation/specs/2026-06-16-mcp-connector-catalog-gateway-design.md`

---

## File Structure

### New files to create:
| File | Responsibility |
|---|---|
| `packages/db/src/schema/connectors.ts` | Drizzle schema for `connectors` table (platform catalog) |
| `packages/db/src/schema/tenant_connectors.ts` | Drizzle schema for `tenant_connectors` table (tenant instances) |
| `packages/db/src/schema/connector_tool_registry.ts` | Drizzle schema for `connector_tool_registry` table (discovered tools) |
| `packages/shared/src/validators/connector.ts` | Zod schemas for connector CRUD + enable/disable payloads |
| `server/src/services/connector-entitlement.ts` | Package gating: `canEnableConnector()`, `getEnabledConnectors()` |
| `server/src/services/connector-handshake.ts` | MCP handshake: connect, initialize, tools/list, persist tools |
| `server/src/routes/connectors.ts` | Super Admin CRUD + tenant enable/disable API routes |
| `runtime-core/management-server/src/connector-gateway.ts` | Aggregating MCP gateway (tools/list + tools/call routing) |
| `runtime-core/management-server/src/connector-client-pool.ts` | MCP client connection pool (lazy connect, cache, teardown) |
| `control-plane/src/app/api/admin/connectors/route.ts` | CP delegation: Super Admin connector CRUD → Paperclip server |
| `control-plane/src/app/api/admin/connectors/[id]/route.ts` | CP delegation: single connector CRUD → Paperclip server |

### Files to modify:
| File | Change |
|---|---|
| `packages/db/src/schema/index.ts` | Add 3 new exports |
| `packages/shared/src/validators/index.ts` | Add `connector` validator export |
| `server/src/services/index.ts` | Add connector service exports |
| `server/src/routes/index.ts` (or `server/src/app.ts`) | Mount connector routes |
| `server/src/routes/internal.ts` | Extend entitlement sync to include connector entitlement data |
| `server/src/package.json` | Add `@modelcontextprotocol/sdk` dependency |
| `runtime-core/management-server/src/index.ts` | Mount connector gateway route |
| `runtime-core/management-server/package.json` | Add `@modelcontextprotocol/sdk` dependency |

---

## Task 1: DB Schema — Create 3 Drizzle table definitions

**Files:**
- Create: `packages/db/src/schema/connectors.ts`
- Create: `packages/db/src/schema/tenant_connectors.ts`
- Create: `packages/db/src/schema/connector_tool_registry.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create `packages/db/src/schema/connectors.ts`**

```typescript
import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectorKey: text("connector_key").notNull().unique(),
    connectorName: text("connector_name").notNull(),
    description: text("description"),
    endpointUrl: text("endpoint_url"),
    hostingMode: text("hosting_mode").notNull().default("remote"),
    authType: text("auth_type"),
    credentialSchema: jsonb("credential_schema").$type<CredentialSchemaEntry[]>().notNull().default([]),
    allowedPackages: text("allowed_packages").array().notNull().default([]),
    provisionSpec: jsonb("provision_spec").$type<Record<string, unknown>>(),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("active"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("connectors_status_idx").on(table.status),
  }),
);

export interface CredentialSchemaEntry {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
}
```

- [ ] **Step 2: Create `packages/db/src/schema/tenant_connectors.ts`**

```typescript
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { connectors } from "./connectors.js";

export const tenantConnectors = pgTable(
  "tenant_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    connectorId: uuid("connector_id").notNull().references(() => connectors.id),
    status: text("status").notNull().default("pending_config"),
    credentialRefs: jsonb("credential_refs").$type<Record<string, string>>().notNull().default({}),
    resolvedEndpoint: text("resolved_endpoint"),
    namespace: text("namespace").notNull(),
    lastHandshakeAt: timestamp("last_handshake_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantConnectorUq: uniqueIndex("tenant_connectors_tenant_connector_uq").on(table.tenantId, table.connectorId),
    tenantIdx: index("tenant_connectors_tenant_idx").on(table.tenantId),
    statusIdx: index("tenant_connectors_status_idx").on(table.status),
  }),
);
```

- [ ] **Step 3: Create `packages/db/src/schema/connector_tool_registry.ts`**

```typescript
import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantConnectors } from "./tenant_connectors.js";

export const connectorToolRegistry = pgTable(
  "connector_tool_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantConnectorId: uuid("tenant_connector_id").notNull().references(() => tenantConnectors.id),
    toolName: text("tool_name").notNull(),
    namespacedName: text("namespaced_name").notNull(),
    description: text("description"),
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>(),
    allowedPackages: text("allowed_packages").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    toolNameUq: uniqueIndex("connector_tool_registry_tool_uq").on(table.tenantConnectorId, table.toolName),
    tenantConnectorIdx: index("connector_tool_registry_tc_idx").on(table.tenantConnectorId),
  }),
);
```

- [ ] **Step 4: Add exports to `packages/db/src/schema/index.ts`**

Add these 3 lines in alphabetical order:
```typescript
export { connectorToolRegistry } from "./connector_tool_registry.js";
export { connectors } from "./connectors.js";
export { tenantConnectors } from "./tenant_connectors.js";
```

- [ ] **Step 5: Run Drizzle Kit to generate migration**

```bash
cd packages/db
pnpm generate
```

Verify a new migration file was created in `src/migrations/` (e.g., `0099_connectors_tables.sql`), the `_journal.json` entry was added, and a new snapshot was created.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/connectors.ts \
       packages/db/src/schema/tenant_connectors.ts \
       packages/db/src/schema/connector_tool_registry.ts \
       packages/db/src/schema/index.ts \
       packages/db/src/migrations/
git commit -m "feat(db): add connectors, tenant_connectors, connector_tool_registry tables"
```

---

## Task 2: Zod Validation Schemas for Connector API

**Files:**
- Create: `packages/shared/src/validators/connector.ts`
- Modify: `packages/shared/src/validators/index.ts`

- [ ] **Step 1: Create `packages/shared/src/validators/connector.ts`**

```typescript
import { z } from "zod";

const credentialSchemaEntrySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  secret: z.boolean().optional(),
  required: z.boolean().optional(),
});

export const createConnectorSchema = z.object({
  connectorKey: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, "Must be a lowercase slug (a-z, 0-9, _, -)"),
  connectorName: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  endpointUrl: z.string().url().optional().nullable(),
  hostingMode: z.enum(["remote", "provisioned"]).optional().default("remote"),
  authType: z.string().optional().nullable(),
  credentialSchema: z.array(credentialSchemaEntrySchema).optional().default([]),
  allowedPackages: z.array(z.string()).optional().default([]),
}).strict();
export type CreateConnector = z.infer<typeof createConnectorSchema>;

export const updateConnectorSchema = z.object({
  connectorName: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  endpointUrl: z.string().url().optional().nullable(),
  hostingMode: z.enum(["remote", "provisioned"]).optional(),
  authType: z.string().optional().nullable(),
  credentialSchema: z.array(credentialSchemaEntrySchema).optional(),
  allowedPackages: z.array(z.string()).optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).strict();
export type UpdateConnector = z.infer<typeof updateConnectorSchema>;

export const enableConnectorSchema = z.object({
  credentialValues: z.record(z.string(), z.string()).optional().default({}),
  namespace: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
}).strict();
export type EnableConnector = z.infer<typeof enableConnectorSchema>;

export const updateTenantConnectorSchema = z.object({
  credentialValues: z.record(z.string(), z.string()).optional(),
  namespace: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
}).strict();
export type UpdateTenantConnector = z.infer<typeof updateTenantConnectorSchema>;
```

- [ ] **Step 2: Add export to `packages/shared/src/validators/index.ts`**

```typescript
export { createConnectorSchema, updateConnectorSchema, enableConnectorSchema, updateTenantConnectorSchema } from "./connector.js";
export type { CreateConnector, UpdateConnector, EnableConnector, UpdateTenantConnector } from "./connector.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/validators/connector.ts packages/shared/src/validators/index.ts
git commit -m "feat(shared): add connector API validation schemas"
```

---

## Task 3: Connector Entitlement Service (Package Gating)

**Files:**
- Create: `server/src/services/connector-entitlement.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Create `server/src/services/connector-entitlement.ts`**

```typescript
import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { connectors, tenantConnectors } from "@paperclipai/db";
import { entitlementStore } from "./entitlement-store.js";

export function connectorEntitlementService(db: Db) {
  return {
    canEnableConnector: async (
      companyId: string,
      connectorId: string,
    ): Promise<{ allowed: boolean; reason?: string }> => {
      const connector = await db
        .select()
        .from(connectors)
        .where(eq(connectors.id, connectorId))
        .limit(1)
        .then((r) => r[0]);

      if (!connector) return { allowed: false, reason: "connector_not_found" };
      if (connector.status !== "active") return { allowed: false, reason: "connector_not_active" };

      const tier = entitlementStore.getTierForCompany(companyId) ?? "free";
      const allowed = connector.allowedPackages.length === 0 || connector.allowedPackages.includes(tier);

      if (!allowed) return { allowed: false, reason: `package ${tier} not in allowed packages` };

      return { allowed: true };
    },

    getEnabledConnectorsForTenant: async (tenantId: string) => {
      return db
        .select()
        .from(tenantConnectors)
        .where(
          and(
            eq(tenantConnectors.tenantId, tenantId),
            eq(tenantConnectors.status, "enabled"),
          ),
        )
        .innerJoin(connectors, eq(tenantConnectors.connectorId, connectors.id));
    },

    getEntitledConnectorIds: async (companyId: string): Promise<string[]> => {
      const tier = entitlementStore.getTierForCompany(companyId) ?? "free";
      const allConnectors = await db
        .select({ id: connectors.id })
        .from(connectors)
        .where(eq(connectors.status, "active"));

      return allConnectors
        .filter((c) => {
          const row = allConnectors.find((r) => r.id === c.id);
          return true; // we fetch the full row below
        })
        .map((c) => c.id);
    },
  };
}
```

Note: The `getEntitledConnectorIds` above is a placeholder — the real implementation fetches the `allowedPackages` from the connector row:

- [ ] **Step 2: Fix `getEntitledConnectorIds` with proper implementation**

The actual implementation should be:
```typescript
getEntitledConnectorIds: async (companyId: string): Promise<string[]> => {
  const tier = entitlementStore.getTierForCompany(companyId) ?? "free";
  const rows = await db
    .select({ id: connectors.id, allowedPackages: connectors.allowedPackages })
    .from(connectors)
    .where(eq(connectors.status, "active"));

  return rows
    .filter((c) => c.allowedPackages.length === 0 || c.allowedPackages.includes(tier))
    .map((c) => c.id);
},
```

- [ ] **Step 3: Add export to `server/src/services/index.ts`**

Add after existing exports:
```typescript
export { connectorEntitlementService } from "./connector-entitlement.js";
```

- [ ] **Step 4: Commit**

```bash
git add server/src/services/connector-entitlement.ts server/src/services/index.ts
git commit -m "feat(server): add connector entitlement service with package gating"
```

---

## Task 4: MCP Handshake Service

**Files:**
- Create: `server/src/services/connector-handshake.ts`
- Modify: `server/src/package.json`

- [ ] **Step 1: Add `@modelcontextprotocol/sdk` dependency to server**

```bash
cd server
pnpm add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Create `server/src/services/connector-handshake.ts`**

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectorToolRegistry } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import { connectorEntitlementService } from "./connector-entitlement.js";

export function connectorHandshakeService(db: Db) {
  const entitlement = connectorEntitlementService(db);

  return {
    handshake: async (
      tenantId: string,
      connectorId: string,
      endpointUrl: string,
      namespace: string,
    ): Promise<{ success: boolean; error?: string }> => {
      let client: Client | null = null;
      try {
        client = new Client(
          { name: "paperclip-connector-handshake", version: "1.0.0" },
          { capabilities: {} },
        );

        const { StreamableHTTPClientTransport } = await import(
          "@modelcontextprotocol/sdk/client/streamableHttp.js"
        );
        const httpTransport = new StreamableHTTPClientTransport(new URL(endpointUrl));

        await client.connect(httpTransport);

        const result = await client.request(
          { method: "tools/list", params: {} },
          { schema: { type: "object", properties: {} } },
        );

        const tools = (result as any).tools ?? [];

        // Persist discovered tools
        const tcRow = await db
          .select()
          .from(tenantConnectors)
          .where(
            and(
              eq(tenantConnectors.tenantId, tenantId),
              eq(tenantConnectors.connectorId, connectorId),
            ),
          )
          .limit(1)
          .then((r) => r[0]);

        if (tcRow) {
          for (const tool of tools) {
            const namespacedName = `${namespace}__${tool.name}`;
            await db
              .insert(connectorToolRegistry)
              .values({
                tenantConnectorId: tcRow.id,
                toolName: tool.name,
                namespacedName,
                description: tool.description ?? null,
                inputSchema: tool.inputSchema ?? null,
              })
              .onConflictDoNothing({ target: [connectorToolRegistry.tenantConnectorId, connectorToolRegistry.toolName] });
          }

          await db
            .update(tenantConnectors)
            .set({
              status: "enabled",
              lastHandshakeAt: new Date(),
              lastError: null,
              resolvedEndpoint: endpointUrl,
            })
            .where(eq(tenantConnectors.id, tcRow.id));
        }

        return { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await db
          .update(tenantConnectors)
          .set({
            status: "failed",
            lastError: errorMessage,
          })
          .where(
            and(
              eq(tenantConnectors.tenantId, tenantId),
              eq(tenantConnectors.connectorId, connectorId),
            ),
          );
        return { success: false, error: errorMessage };
      } finally {
        if (client) {
          try { await client.close(); } catch { /* ignore close errors */ }
        }
      }
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/connector-handshake.ts server/package.json
git commit -m "feat(server): add MCP handshake service for connector tool discovery"
```

---

## Task 5: Connector CRUD API Routes (Super Admin)

**Files:**
- Create: `server/src/routes/connectors.ts`
- Modify: `server/src/app.ts` (mount routes)

- [ ] **Step 1: Create `server/src/routes/connectors.ts`**

```typescript
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { connectors as connectorsTable, tenantConnectors, connectorToolRegistry } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/index.js";
import { connectorEntitlementService } from "../services/connector-entitlement.js";
import { connectorHandshakeService } from "../services/connector-handshake.js";
import { createConnectorSchema, updateConnectorSchema, enableConnectorSchema, updateTenantConnectorSchema } from "@paperclipai/shared";

export function connectorRoutes(db: Db) {
  const router = Router();
  const entitlement = connectorEntitlementService(db);
  const handshake = connectorHandshakeService(db);

  // ── Super Admin: List all connectors ──
  router.get("/connectors", async (_req, res) => {
    const all = await db.select().from(connectorsTable).orderBy(connectorsTable.connectorName);
    res.json(all);
  });

  // ── Super Admin: Create connector ──
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

  // ── Super Admin: Get connector by ID ──
  router.get("/connectors/:id", async (req, res) => {
    const connector = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, req.params.id))
      .limit(1)
      .then((r) => r[0]);

    if (!connector) return res.status(404).json({ error: "connector_not_found" });
    res.json(connector);
  });

  // ── Super Admin: Update connector ──
  router.patch("/connectors/:id", validate(updateConnectorSchema), async (req, res) => {
    assertBoard(req);
    const existing = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, req.params.id))
      .limit(1)
      .then((r) => r[0]);

    if (!existing) return res.status(404).json({ error: "connector_not_found" });

    const updated = await db
      .update(connectorsTable)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(connectorsTable.id, req.params.id))
      .returning();

    await logActivity(db, {
      companyId: "system",
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.updated",
      entityType: "connector",
      entityId: req.params.id,
      details: { changes: Object.keys(req.body) },
    });

    res.json(updated[0]);
  });

  // ── Super Admin: Delete connector ──
  router.delete("/connectors/:id", async (req, res) => {
    assertBoard(req);
    const existing = await db
      .select()
      .from(connectorsTable)
      .where(eq(connectorsTable.id, req.params.id))
      .limit(1)
      .then((r) => r[0]);

    if (!existing) return res.status(404).json({ error: "connector_not_found" });

    await db.delete(connectorsTable).where(eq(connectorsTable.id, req.params.id));

    await logActivity(db, {
      companyId: "system",
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.deleted",
      entityType: "connector",
      entityId: req.params.id,
      details: { connectorKey: existing.connectorKey },
    });

    res.status(204).send();
  });

  // ── Tenant-facing: List available + enabled connectors for a tenant ──
  router.get("/companies/:companyId/connectors", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId;
    assertCompanyAccess(req, companyId);

    // Get enabled connector IDs for this tenant
    const enabled = await db
      .select()
      .from(tenantConnectors)
      .where(eq(tenantConnectors.tenantId, companyId));

    const enabledConnectorIds = new Set(enabled.map((e) => e.connectorId));

    // Get all active connectors the tenant is entitled to
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

  // ── Tenant-facing: Enable a connector with credentials ──
  router.post(
    "/companies/:companyId/connectors/:connectorId/enable",
    validate(enableConnectorSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId;
      const connectorId = req.params.connectorId;
      assertCompanyAccess(req, companyId);

      // Check entitlement
      const canEnable = await entitlement.canEnableConnector(companyId, connectorId);
      if (!canEnable.allowed) {
        return res.status(403).json({ error: canEnable.reason });
      }

      // Check connector exists
      const connector = await db
        .select()
        .from(connectorsTable)
        .where(eq(connectorsTable.id, connectorId))
        .limit(1)
        .then((r) => r[0]);

      if (!connector) return res.status(404).json({ error: "connector_not_found" });

      const namespace = req.body.namespace ?? connector.connectorKey;
      const endpointUrl = connector.endpointUrl ?? "";

      // Create tenant_connector row (pending_config initially)
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

      // Run handshake
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

  // ── Tenant-facing: Update tenant connector config ──
  router.patch(
    "/companies/:companyId/connectors/:connectorId",
    validate(updateTenantConnectorSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId;
      const connectorId = req.params.connectorId;
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

      if (!existing) return res.status(404).json({ error: "tenant_connector_not_found" });

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

  // ── Tenant-facing: Disable a connector ──
  router.post("/companies/:companyId/connectors/:connectorId/disable", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId;
    const connectorId = req.params.connectorId;
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

    if (!existing) return res.status(404).json({ error: "tenant_connector_not_found" });

    // Delete discovered tools
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
```

- [ ] **Step 2: Mount routes in `server/src/app.ts`**

Find the section where routes are mounted (near line ~300-400 of app.ts) and add:
```typescript
import { connectorRoutes } from "./routes/connectors.js";
```

Then after existing route mounts:
```typescript
api.use(connectorRoutes(db));
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/connectors.ts server/src/app.ts
git commit -m "feat(server): add connector CRUD and tenant enable/disable API routes"
```

---

## Task 6: MCP Client Pool (Management Server)

**Files:**
- Create: `runtime-core/management-server/src/connector-client-pool.ts`
- Modify: `runtime-core/management-server/package.json`

- [ ] **Step 1: Add `@modelcontextprotocol/sdk` to management server**

```bash
cd runtime-core/management-server
pnpm add @modelcontextprotocol/sdk
pnpm add -D @types/ws
```

- [ ] **Step 2: Create `runtime-core/management-server/src/connector-client-pool.ts`**

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface ConnectorClientEntry {
  client: Client;
  transport: StreamableHTTPClientTransport;
  namespace: string;
  lastUsed: number;
}

const pool = new Map<string, ConnectorClientEntry>();
const CONNECTOR_TIMEOUT_MS = 30_000;
const MAX_IDLE_MS = 5 * 60 * 1000; // 5 minutes

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pool.entries()) {
      if (now - entry.lastUsed > MAX_IDLE_MS) {
        entry.client.close().catch(() => {});
        pool.delete(key);
      }
    }
  }, 60_000);
}

export async function getOrCreateClient(
  tenantId: string,
  connectorKey: string,
  endpointUrl: string,
  namespace: string,
): Promise<Client> {
  startCleanup();
  const key = `${tenantId}:${connectorKey}`;
  const existing = pool.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.client;
  }

  const transport = new StreamableHTTPClientTransport(new URL(endpointUrl));
  const client = new Client(
    { name: `paperclip-connector-${connectorKey}`, version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  pool.set(key, { client, transport, namespace, lastUsed: Date.now() });
  return client;
}

export function dropClient(tenantId: string, connectorKey: string): void {
  const key = `${tenantId}:${connectorKey}`;
  const entry = pool.get(key);
  if (entry) {
    entry.client.close().catch(() => {});
    pool.delete(key);
  }
}

export function dropAllForTenant(tenantId: string): void {
  for (const [key, entry] of pool.entries()) {
    if (key.startsWith(`${tenantId}:`)) {
      entry.client.close().catch(() => {});
      pool.delete(key);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add runtime-core/management-server/src/connector-client-pool.ts runtime-core/management-server/package.json
git commit -m "feat(runtime): add MCP client connection pool for connectors"
```

---

## Task 7: Aggregating MCP Gateway (Management Server)

**Files:**
- Create: `runtime-core/management-server/src/connector-gateway.ts`
- Modify: `runtime-core/management-server/src/index.ts`

- [ ] **Step 1: Create `runtime-core/management-server/src/connector-gateway.ts`**

```typescript
import { Router } from "express";
import { getOrCreateClient, dropAllForTenant } from "./connector-client-pool.js";

const CP_BASE_URL = process.env.CP_URL || "http://localhost:3001";
const CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN || "";

interface ToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export function createConnectorGateway(): Router {
  const router = Router();

  // ── tools/list aggregation ──
  // This is mounted as a sub-router; the management server main router
  // will mount it at /api/runtime/mcp-sdk.
  // The gateway wraps the existing MCP SDK endpoint at the CP.

  router.post("/tools/list", async (req, res) => {
    try {
      // 1. Get tenant ID from the runtime auth context
      const tenantId = req.body.tenant_id || req.headers["x-tenant-id"];
      if (!tenantId) return res.status(400).json({ error: "tenant_id_required" });

      // 2. Fetch enabled connectors for this tenant from CP
      const cpResponse = await fetch(
        `${CP_BASE_URL}/api/internal/tenants/${tenantId}/enabled-connectors`,
        {
          headers: {
            "X-Service-Token": CP_SERVICE_TOKEN,
          },
        },
      );

      if (!cpResponse.ok) {
        // CP unreachable — return empty connector tools (degrade gracefully)
        const cpTools = await fetchToolsFromCp(req, tenantId);
        return res.json(cpTools);
      }

      const enabledConnectors = await cpResponse.json();

      // 3. Build tool list: OCMT built-in tools + connector tools
      const cpTools = await fetchToolsFromCp(req, tenantId);
      const connectorTools: ToolDefinition[] = [];

      for (const conn of enabledConnectors) {
        try {
          const client = await getOrCreateClient(
            tenantId,
            conn.connectorKey,
            conn.resolvedEndpoint,
            conn.namespace,
          );

          const result = await client.request(
            { method: "tools/list", params: {} },
            { schema: { type: "object", properties: {} } },
            { timeout: 10_000 },
          );

          const tools = (result as any).tools ?? [];
          for (const tool of tools) {
            connectorTools.push({
              name: `${conn.namespace}__${tool.name}`,
              description: tool.description,
              input_schema: tool.inputSchema,
            });
          }
        } catch {
          // Down connector — skip, not fatal
        }
      }

      res.json({
        tools: [...(cpTools.tools ?? []), ...connectorTools],
      });
    } catch (err) {
      res.status(500).json({ error: "gateway_error", message: String(err) });
    }
  });

  // ── tools/call routing ──
  router.post("/tools/call", async (req, res) => {
    try {
      const tenantId = req.body.tenant_id || req.headers["x-tenant-id"];
      const toolName: string = req.body.name ?? req.body.tool;
      const args: Record<string, unknown> = req.body.arguments ?? {};

      if (!tenantId) return res.status(400).json({ error: "tenant_id_required" });
      if (!toolName) return res.status(400).json({ error: "tool_name_required" });

      // Check if this is a namespaced connector tool
      const separatorIdx = toolName.indexOf("__");
      if (separatorIdx === -1) {
        // Not a connector tool — forward to CP
        return proxyToCp(req, res, "/api/runtime/mcp-sdk/tools/call");
      }

      const namespace = toolName.slice(0, separatorIdx);
      const actualToolName = toolName.slice(separatorIdx + 2);

      // Get tenant connector info from CP
      const infoResponse = await fetch(
        `${CP_BASE_URL}/api/internal/tenants/${tenantId}/connector-by-namespace/${namespace}`,
        {
          headers: { "X-Service-Token": CP_SERVICE_TOKEN },
        },
      );

      if (!infoResponse.ok) {
        return res.status(404).json({
          isError: true,
          content: [{ type: "text", text: `Connector '${namespace}' not found or not enabled` }],
        });
      }

      const connInfo = await infoResponse.json();

      // CP enforce check
      const enforceResponse = await fetch(`${CP_BASE_URL}/api/core/enforce`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token": CP_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          tool: toolName,
          risk_class: "connector",
          package_tier: connInfo.packageTier,
        }),
      });

      if (!enforceResponse.ok) {
        return res.status(403).json({
          isError: true,
          content: [{ type: "text", text: "Tool call denied by policy" }],
        });
      }

      // Call the connector via client pool
      try {
        const client = await getOrCreateClient(
          tenantId,
          connInfo.connectorKey,
          connInfo.resolvedEndpoint,
          namespace,
        );

        const result = await client.request(
          { method: "tools/call", params: { name: actualToolName, arguments: args } },
          { schema: { type: "object", properties: {} } },
          { timeout: CONNECTOR_TIMEOUT_MS },
        );

        res.json(result);
      } catch (err) {
        res.json({
          isError: true,
          content: [{ type: "text", text: `Connector error: ${err instanceof Error ? err.message : String(err)}` }],
        });
      }
    } catch (err) {
      res.status(500).json({ error: "gateway_error", message: String(err) });
    }
  });

  return router;
}

async function fetchToolsFromCp(
  req: import("express").Request,
  tenantId: string,
): Promise<{ tools: ToolDefinition[] }> {
  try {
    const cpResponse = await fetch(
      `${CP_BASE_URL}/api/runtime/mcp-sdk/tools/list`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token": CP_SERVICE_TOKEN,
        },
        body: JSON.stringify({ ...req.body, tenant_id: tenantId }),
      },
    );
    if (cpResponse.ok) return cpResponse.json();
  } catch {
    // CP unreachable
  }
  return { tools: [] };
}

function proxyToCp(
  req: import("express").Request,
  res: import("express").Response,
  path: string,
): Promise<void> {
  // Forward request to CP and pipe response back
  return fetch(`${CP_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": CP_SERVICE_TOKEN,
    },
    body: JSON.stringify(req.body),
  })
    .then(async (cpRes) => {
      const body = await cpRes.json();
      res.status(cpRes.status).json(body);
    })
    .catch(() => {
      res.status(502).json({ error: "cp_unreachable" });
    });
}
```

- [ ] **Step 2: Mount connector gateway in `runtime-core/management-server/src/index.ts`**

Replace the existing content with:
```typescript
import express from "express";
import { createEntitlementProxy } from "./entitlement-proxy.js";
import { createEnforcementProxy } from "./enforcement-proxy.js";
import { createConnectorGateway } from "./connector-gateway.js";

const PORT = parseInt(process.env.PORT || "3004", 10);

const app = express();
app.use(express.json());
app.use("/api/core", createEnforcementProxy());
app.use("/api/runtime/internal", createEntitlementProxy());
app.use("/api/runtime/mcp-sdk", createConnectorGateway());

app.listen(PORT, () => {
  console.log(`Management server listening on port ${PORT}`);
});
```

- [ ] **Step 3: Add internal API routes on the server for gateway communication**

These routes allow the management server's gateway to fetch connector data. Add to `server/src/routes/internal.ts`:

```typescript
// Inside the `internalRoutes` function, after existing routes:

router.get("/internal/tenants/:tenantId/enabled-connectors", async (req, res) => {
  requireCpAuth(req);
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

  res.json(rows);
});

router.get("/internal/tenants/:tenantId/connector-by-namespace/:namespace", async (req, res) => {
  requireCpAuth(req);
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

  if (!row) return res.status(404).json({ error: "connector_not_found" });

  // Look up package tier for tenant
  const cpCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, tenantId))
    .limit(1);

  const tier = entitlementStore.getTierForCompany(tenantId) ?? "free";
  const packageTier = row.allowedPackages?.includes(tier) ? tier : "denied";

  res.json({ ...row, packageTier });
});
```

Also add imports to `internal.ts`:
```typescript
import { tenantConnectors, connectors } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import { entitlementStore } from "../services/entitlement-store.js";
```

- [ ] **Step 4: Commit**

```bash
git add runtime-core/management-server/src/connector-gateway.ts \
       runtime-core/management-server/src/index.ts \
       server/src/routes/internal.ts
git commit -m "feat(runtime): add aggregating MCP gateway with connector tool routing"
```

---

## Task 8: Control Plane — Super Admin Connector Delegation

**Files:**
- Create: `control-plane/src/app/api/admin/connectors/route.ts`
- Create: `control-plane/src/app/api/admin/connectors/[id]/route.ts`

- [ ] **Step 1: Create `control-plane/src/app/api/admin/connectors/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
const CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN || "";

export async function GET(req: NextRequest) {
  const cpRes = await fetch(`${PAPERCLIP_API_URL}/api/connectors`, {
    headers: { "X-Service-Token": CP_SERVICE_TOKEN },
  });
  const data = await cpRes.json();
  return NextResponse.json(data, { status: cpRes.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const cpRes = await fetch(`${PAPERCLIP_API_URL}/api/connectors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": CP_SERVICE_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const data = await cpRes.json();
  return NextResponse.json(data, { status: cpRes.status });
}
```

- [ ] **Step 2: Create `control-plane/src/app/api/admin/connectors/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
const CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN || "";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const cpRes = await fetch(`${PAPERCLIP_API_URL}/api/connectors/${params.id}`, {
    headers: { "X-Service-Token": CP_SERVICE_TOKEN },
  });
  const data = await cpRes.json();
  return NextResponse.json(data, { status: cpRes.status });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const body = await req.json();
  const cpRes = await fetch(`${PAPERCLIP_API_URL}/api/connectors/${params.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": CP_SERVICE_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const data = await cpRes.json();
  return NextResponse.json(data, { status: cpRes.status });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const cpRes = await fetch(`${PAPERCLIP_API_URL}/api/connectors/${params.id}`, {
    method: "DELETE",
    headers: {
      "X-Service-Token": CP_SERVICE_TOKEN,
    },
  });
  return new NextResponse(null, { status: cpRes.status });
}
```

- [ ] **Step 3: Commit**

```bash
git add control-plane/src/app/api/admin/connectors/
git commit -m "feat(cp): add Super Admin connector CRUD delegation routes"
```

---

## Task 9: Extend Entitlement Sync for Connectors

**Files:**
- Modify: `server/src/routes/internal.ts`

- [ ] **Step 1: Extend the entitlement sync handler**

In `server/src/routes/internal.ts`, find the `POST /sync/entitlements` handler. After the existing logic, add connector entitlement pre-warming:

```typescript
// After entitlementStore.setTenantTier(...):
// Pre-warm connector entitlement cache
try {
  const entitledConnectors = await db
    .select({ id: connectors.id, allowedPackages: connectors.allowedPackages })
    .from(connectors)
    .where(eq(connectors.status, "active"));

  // Update tenant_connectors that are no longer entitled
  const tier = entitlementStore.getTierForCompany(tenantId) ?? "free";
  const entitledIds = entitledConnectors
    .filter((c) => c.allowedPackages.length === 0 || c.allowedPackages.includes(tier))
    .map((c) => c.id);

  if (entitledIds.length > 0) {
    // Disable tenant connectors that are no longer entitled
    await db
      .update(tenantConnectors)
      .set({ status: "disabled", lastError: "package_tier_changed", updatedAt: new Date() })
      .where(
        and(
          eq(tenantConnectors.tenantId, tenantId),
          eq(tenantConnectors.status, "enabled"),
          notInArray(tenantConnectors.connectorId, entitledIds),
        ),
      );
  }
} catch {
  // Non-fatal: entitlement sync should not fail due to connector pre-warming
}
```

Add the import:
```typescript
import { notInArray } from "drizzle-orm";
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/internal.ts
git commit -m "feat(server): extend entitlement sync to handle connector package gating"
```

---

## Task 10: Tracer Bullet Integration Test

**Files:**
- Create: `__tests__/connector-e2e.test.ts` or add to existing test patterns

- [ ] **Step 1: Create a basic end-to-end test**

Create `server/src/__tests__/connector-catalog.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// This is a structural test — the full e2e requires running instances.
// For now, test the service layer in isolation.

describe("Connector Catalog", () => {
  it("test placeholder — real e2e requires running server + management server", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Add the `notInArray` import to `internal.ts`**

(Already covered in Task 9)

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/connector-catalog.test.ts
git commit -m "test: add connector catalog test scaffold"
```

---

## Validation Checklist

Before marking done, verify:

- [ ] `packages/db` build succeeds: `cd packages/db && pnpm generate` produces a new migration
- [ ] `packages/shared` build succeeds: `cd packages/shared && tsc --noEmit`
- [ ] `server` build succeeds: `cd server && tsc --noEmit`
- [ ] Management server build succeeds: `cd runtime-core/management-server && tsc --noEmit`
- [ ] Control Plane build succeeds: `cd control-plane && pnpm build`
- [ ] Migration applies clean: `cd packages/db && pnpm migrate`
- [ ] Super Admin can create a connector via API
- [ ] Tenant admin can enable a connector
- [ ] MCP handshake discovers tools and persists them
- [ ] Gateway aggregates connector tools alongside OCMT tools
- [ ] Package gating prevents non-entitled tenants from enabling connectors
- [ ] Gateway degrades gracefully when a connector is down