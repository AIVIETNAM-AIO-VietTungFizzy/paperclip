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
