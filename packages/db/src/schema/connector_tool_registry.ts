import {
  pgTable,
  uuid,
  text,
  boolean,
  varchar,
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
    enabled: boolean("enabled").notNull().default(true),
    riskClass: varchar("risk_class", { length: 20 }),
    approvalClass: varchar("approval_class", { length: 10 }),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    pending: boolean("pending").notNull().default(false),
    // LLG-4.3: structured skill promotion. A2A Agent Card skills and MCP-agent
    // tools (where "tools already are the skills") share this one table. `toolType`
    // discriminates a plain MCP tool ("tool") from a promoted A2A skill ("skill").
    // The skill_* columns carry the structured skill object (id/name/description/IO
    // modes/tags) sourced from the Agent Card's `skills[]`, replacing the earlier
    // free-form `card.skills:[strings]`.
    toolType: varchar("tool_type", { length: 16 }).notNull().default("tool"),
    skillId: text("skill_id"),
    skillName: text("skill_name"),
    skillDescription: text("skill_description"),
    inputModes: text("input_modes").array(),
    outputModes: text("output_modes").array(),
    tags: text("tags").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    toolUniqueIdx: uniqueIndex("connector_tool_registry_tool_uq").on(table.tenantConnectorId, table.toolName),
    tenantConnectorIdx: index("connector_tool_registry_tc_idx").on(table.tenantConnectorId),
  }),
);
