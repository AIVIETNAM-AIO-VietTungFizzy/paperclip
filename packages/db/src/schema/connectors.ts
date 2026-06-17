import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
