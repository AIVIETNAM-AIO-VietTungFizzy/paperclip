import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";

export interface CredentialSchemaEntry {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
}

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectorKey: text("connector_key").notNull(),
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
    connectorKeyUnique: unique("connectors_connector_key_unique").on(table.connectorKey),
    statusIdx: index("connectors_status_idx").on(table.status),
  }),
);
