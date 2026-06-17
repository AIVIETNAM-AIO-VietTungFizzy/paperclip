import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subscriptionTier: text("subscription_tier").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantRuntimeInstances = pgTable("tenant_runtime_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  managementServerUrl: text("management_server_url").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    iconUrl: text("icon_url"),
    configSchema: jsonb("config_schema").$type<Record<string, unknown>>().notNull().default({}),
    authType: text("auth_type").notNull().default("none"),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameUniqueIdx: uniqueIndex("connectors_name_idx").on(table.name),
  }),
);

export const tenantConnectors = pgTable(
  "tenant_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull().references(() => connectors.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    authConfig: jsonb("auth_config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantConnectorIdx: index("tenant_connectors_tenant_idx").on(table.tenantId),
    connectorIdx: index("tenant_connectors_connector_idx").on(table.connectorId),
  }),
);

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
