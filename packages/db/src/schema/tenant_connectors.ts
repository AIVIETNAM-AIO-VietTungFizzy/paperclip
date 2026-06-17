import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { connectors } from "./connectors.js";

export const tenantConnectors = pgTable(
  "tenant_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull().references(() => connectors.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    authConfig: jsonb("auth_config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyConnectorIdx: index("tenant_connectors_company_idx").on(table.companyId),
    connectorIdx: index("tenant_connectors_connector_idx").on(table.connectorId),
  }),
);
