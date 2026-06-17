import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface HandshakeResult {
  tools: Tool[];
  error?: string;
}

export async function performHandshake(
  endpointUrl: string,
  headers?: Record<string, string>,
  timeoutMs: number = 10_000,
): Promise<HandshakeResult> {
  const transport = new StreamableHTTPClientTransport(new URL(endpointUrl), {
    requestInit: headers ? { headers } : undefined,
  });

  const client = new Client(
    { name: "paperclip-connector-handshake", version: "1.0.0" },
    { capabilities: {} },
  );

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    await client.connect(transport);

    const result = await client.listTools(undefined, {
      signal: abortController.signal,
    });

    return { tools: result.tools as Tool[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { tools: [], error: message };
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => {});
  }
}
