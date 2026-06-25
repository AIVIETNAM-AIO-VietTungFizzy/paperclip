import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectorToolRegistry } from "@paperclipai/db";

const HANDSHAKE_TIMEOUT_MS = 15_000;

export function connectorHandshakeService(db: Db) {
  return {
    handshake: async (
      tenantId: string,
      connectorId: string,
      endpointUrl: string,
      namespace: string,
      credentialHeaders?: Record<string, string>,
    ): Promise<{ success: boolean; error?: string }> => {
      let client: Client | null = null;
      const abortController = new AbortController();
      const handshakeTimer = setTimeout(() => abortController.abort(), HANDSHAKE_TIMEOUT_MS);
      try {
        const { StreamableHTTPClientTransport } = await import(
          "@modelcontextprotocol/sdk/client/streamableHttp.js"
        );

        const transport = new StreamableHTTPClientTransport(
          new URL(endpointUrl),
          {
            requestInit: {
              signal: abortController.signal,
              ...(credentialHeaders ? { headers: credentialHeaders } : {}),
            },
          },
        );

        client = new Client(
          { name: "paperclip-connector-handshake", version: "1.0.0" },
          { capabilities: {} },
        );

        await client.connect(transport);

        const result = await client.request(
          { method: "tools/list", params: {} },
          z.object({}).passthrough(),
          { signal: abortController.signal },
        );

        const tools = ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>) ?? [];

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
          for (const tool of tools) {
            const namespacedName = `${namespace}__${tool.name}`;
            await db
              .insert(connectorToolRegistry)
              .values({
                tenantConnectorId: tcRow.id,
                toolName: tool.name as string,
                namespacedName,
                description: (tool.description as string | null) ?? null,
                inputSchema: tool.inputSchema as Record<string, unknown> | null ?? null,
                enabled: true,
                pending: false,
                riskClass: "connector",
                approvalClass: "auto",
                requiresApproval: false,
              })
              .onConflictDoNothing({ target: [connectorToolRegistry.tenantConnectorId, connectorToolRegistry.toolName] });
          }

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
      } finally {
        clearTimeout(handshakeTimer);
        if (client) {
          try { await client.close(); } catch { /* ignore close errors */ }
        }
      }
    },
  };
}
