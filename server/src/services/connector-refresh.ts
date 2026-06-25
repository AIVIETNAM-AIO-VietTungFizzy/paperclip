import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { connectors } from "@paperclipai/db";

export interface ProbedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface RefreshResult {
  ok: boolean;
  tools?: ProbedTool[];
  error?: string;
}

export function connectorRefreshService(db: Db) {
  return {
    refreshConnectorTools: async (connectorId: string): Promise<RefreshResult> => {
      const connector = await db
        .select()
        .from(connectors)
        .where(eq(connectors.id, connectorId))
        .limit(1)
        .then((r) => r[0]);

      if (!connector) {
        return { ok: false, error: "connector_not_found" };
      }

      const endpointUrl = connector.endpointUrl;
      if (!endpointUrl) {
        return { ok: false, error: "no_endpoint_url" };
      }

      let client: Client | null = null;
      try {
        const { StreamableHTTPClientTransport } = await import(
          "@modelcontextprotocol/sdk/client/streamableHttp.js"
        );

        const transport = new StreamableHTTPClientTransport(new URL(endpointUrl));

        client = new Client(
          { name: "paperclip-connector-refresh", version: "1.0.0" },
          { capabilities: {} },
        );

        await client.connect(transport);

        const result = await client.request(
          { method: "tools/list", params: {} },
          z.object({}).passthrough(),
        );

        const tools = ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>) ?? [];
        const probed: ProbedTool[] = tools.map((t) => ({
          name: t.name as string,
          description: (t.description as string | undefined) ?? undefined,
          inputSchema: (t.inputSchema as Record<string, unknown> | undefined) ?? undefined,
        }));

        await db
          .update(connectors)
          .set({
            lastTestedAt: new Date(),
            lastError: null,
          })
          .where(eq(connectors.id, connectorId));

        return { ok: true, tools: probed };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await db
          .update(connectors)
          .set({ lastError: errorMessage.slice(0, 500) })
          .where(eq(connectors.id, connectorId));
        return { ok: false, error: errorMessage };
      } finally {
        if (client) {
          try { await client.close(); } catch { /* ignore close errors */ }
        }
      }
    },
  };
}