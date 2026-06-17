import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantConnectors } from "./tenant_connectors.js";

export const connectorToolRegistry = pgTable(
  "connector_tool_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantConnectorId: uuid("tenant_connector_id").notNull().references(() => tenantConnectors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    toolSchema: jsonb("tool_schema").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantConnectorToolIdx: index("connector_tool_registry_tenant_connector_idx").on(table.tenantConnectorId),
  }),
);
