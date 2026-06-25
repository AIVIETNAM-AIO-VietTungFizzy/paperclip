import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectorToolRegistry } from "@paperclipai/db";

/**
 * LLG-4.3 projection seam.
 *
 * Produces the `mcp_tool_permissions: { server: [tools] }` projection for a
 * tenant's *skills* (tool_type='skill'). This is the data the LLG-2.3
 * CP->LiteLLM reconciler writes via `POST /key/update`. Plain MCP tools
 * (tool_type='tool') are projected by the existing tool projection path; this
 * service only emits promoted skills, so the two do not double-count.
 */
export function skillPermissionsProjectionService(db: Db) {
  return {
    projectSkillPermissions: async (tenantId: string): Promise<Record<string, string[]>> => {
      const rows = await db
        .select({
          namespace: tenantConnectors.namespace,
          namespacedName: connectorToolRegistry.namespacedName,
          toolType: connectorToolRegistry.toolType,
          enabled: connectorToolRegistry.enabled,
        })
        .from(connectorToolRegistry)
        .innerJoin(tenantConnectors, eq(connectorToolRegistry.tenantConnectorId, tenantConnectors.id))
        .where(
          and(
            eq(tenantConnectors.tenantId, tenantId),
            eq(connectorToolRegistry.toolType, "skill"),
            eq(connectorToolRegistry.enabled, true),
          ),
        );

      const permissions: Record<string, string[]> = {};
      for (const row of rows) {
        // Defensive double-filter: the DB `where` already restricts to enabled
        // skills, but re-check here so the projection is correct independent of
        // query-builder semantics.
        if (row.toolType !== "skill" || !row.enabled) continue;
        const server = row.namespace;
        if (!permissions[server]) permissions[server] = [];
        permissions[server].push(row.namespacedName);
      }
      return permissions;
    },
  };
}