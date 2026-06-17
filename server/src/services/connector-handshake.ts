import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectorToolRegistry } from "@paperclipai/db";

export function connectorHandshakeService(db: Db) {
  return {
    handshake: async (
      tenantId: string,
      connectorId: string,
      endpointUrl: string,
      namespace: string,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const tcRow = await db
          .select()
          .from(tenantConnectors)
          .where(
            and(
              eq(tenantConnectors.tenantId, tenantId),
              eq(tenantConnectors.connectorId, connectorId),
            ),
          )
          .limit(1)
          .then((r) => r[0]);

        if (tcRow) {
          await db
            .update(tenantConnectors)
            .set({
              status: "enabled",
              lastHandshakeAt: new Date(),
              lastError: null,
              resolvedEndpoint: endpointUrl,
            })
            .where(eq(tenantConnectors.id, tcRow.id));
        }

        return { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await db
          .update(tenantConnectors)
          .set({
            status: "failed",
            lastError: errorMessage,
          })
          .where(
            and(
              eq(tenantConnectors.tenantId, tenantId),
              eq(tenantConnectors.connectorId, connectorId),
            ),
          );
        return { success: false, error: errorMessage };
      }
    },
  };
}
