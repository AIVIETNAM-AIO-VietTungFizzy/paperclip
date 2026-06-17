import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
    toolUniqueIdx: uniqueIndex("connector_tool_registry_tool_uq").on(table.tenantConnectorId, table.toolName),
    tenantConnectorIdx: index("connector_tool_registry_tc_idx").on(table.tenantConnectorId),
  }),
);
