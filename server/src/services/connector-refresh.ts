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

export interface ProbeOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Probe an arbitrary MCP endpoint and return the discovered tool list.
 * Shared by `test-endpoint` (pre-save connectivity test, no DB write) and
 * `refreshConnectorTools` (persisted re-sync for a saved connector).
 */
export async function probeConnectorTools(
  endpointUrl: string,
  opts: ProbeOptions = {},
): Promise<RefreshResult> {
  let client: Client | null = null;
  try {
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(endpointUrl),
      opts.headers ? { requestInit: { headers: opts.headers } } : undefined,
    );

    client = new Client(
      { name: "paperclip-connector-probe", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), opts.timeoutMs ?? 10_000);
    try {
      const result = await client.request(
        { method: "tools/list", params: {} },
        z.object({}).passthrough(),
        { signal: abortController.signal },
      );

      const tools = ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>) ?? [];
      const probed: ProbedTool[] = tools.map((t) => ({
        name: t.name as string,
        description: (t.description as string | undefined) ?? undefined,
        inputSchema: (t.inputSchema as Record<string, unknown> | undefined) ?? undefined,
      }));

      return { ok: true, tools: probed };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMessage };
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore close errors */ }
    }
  }
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

      const result = await probeConnectorTools(endpointUrl);

      if (result.ok) {
        await db
          .update(connectors)
          .set({
            lastTestedAt: new Date(),
            lastError: null,
          })
          .where(eq(connectors.id, connectorId));
      } else {
        await db
          .update(connectors)
          .set({ lastError: (result.error ?? "").slice(0, 500) })
          .where(eq(connectors.id, connectorId));
      }

      return result;
    },
  };
}