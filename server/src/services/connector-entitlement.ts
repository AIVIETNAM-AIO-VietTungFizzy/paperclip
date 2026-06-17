import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { connectors, tenantConnectors } from "@paperclipai/db";

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
      const rows = await db
        .select({ id: connectors.id, allowedPackages: connectors.allowedPackages })
        .from(connectors)
        .where(eq(connectors.status, "active"));

      return rows
        .filter((c) => c.allowedPackages.length === 0)
        .map((c) => c.id);
    },
  };
}
