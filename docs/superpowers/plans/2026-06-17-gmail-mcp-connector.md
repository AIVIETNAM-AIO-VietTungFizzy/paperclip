# Gmail MCP Connector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Create a Gmail MCP connector package and wire it through the aggregating MCP gateway so agents can send/read/search emails and manage labels.

**Architecture:** A standalone packages/gmail-mcp-server/ package exposes 5 Gmail tools via the MCP protocol (stdio transport), authenticated via per-tenant OAuth2 credentials. The management server's connector gateway routes tool calls to the Gmail MCP server through a client connection pool. The connector is registered in the catalog via seed data.

**Tech Stack:** @modelcontextprotocol/sdk, googleapis, zod, Express 5, Drizzle ORM

**Spec:** docs/superpowers/specs/2026-06-17-gmail-mcp-connector-design.md

---

## File Structure

### New files:
| File | Responsibility |
|------|---------------|
| packages/gmail-mcp-server/package.json | Package manifest |
| packages/gmail-mcp-server/tsconfig.json | TypeScript config |
| packages/gmail-mcp-server/src/index.ts | MCP server entry point (stdio) |
| packages/gmail-mcp-server/src/auth.ts | OAuth2 token management with refresh |
| packages/gmail-mcp-server/src/gmail.ts | Gmail API service wrapping googleapis |
| packages/gmail-mcp-server/src/tools.ts | MCP tool definitions (5 tools) |
| runtime-core/management-server/src/connector-client-pool.ts | MCP client connection pool |
| runtime-core/management-server/src/connector-gateway.ts | Aggregating MCP gateway |
| server/src/seed/connectors.ts | Seed data for Gmail connector registration |

### Files to modify:
| File | Change |
|------|--------|
| pnpm-workspace.yaml | Add packages/gmail-mcp-server |
| runtime-core/management-server/src/index.ts | Mount connector gateway |
| server/src/routes/internal.ts | Add enabled-connectors and connector-by-namespace routes |
| server/src/services/connector-handshake.ts | Add real MCP SDK handshake with tool discovery |

---

## Task 1: Scaffold Gmail MCP Server Package

**Files:**
- Create: packages/gmail-mcp-server/package.json
- Create: packages/gmail-mcp-server/tsconfig.json
- Modify: pnpm-workspace.yaml

- [ ] Step 1: Create packages/gmail-mcp-server/package.json

```json
{
  "name": "@paperclipai/gmail-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "googleapis": "^144.0.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^24.6.0",
    "typescript": "^5.7.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] Step 2: Create packages/gmail-mcp-server/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] Step 3: Add to pnpm-workspace.yaml (add packages/gmail-mcp-server after packages/* line)

- [ ] Step 4: Install dependencies
  cd packages/gmail-mcp-server && pnpm install

- [ ] Step 5: Commit
  git add packages/gmail-mcp-server/ pnpm-workspace.yaml pnpm-lock.yaml
  git commit -m "feat(gmail): scaffold gmail-mcp-server package"

---

## Task 2: Implement Gmail Auth Service

**Files:**
- Create: packages/gmail-mcp-server/src/auth.ts

- [ ] Step 1: Create packages/gmail-mcp-server/src/auth.ts

```typescript
import { google } from "googleapis";

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function createGmailAuth(credentials: GmailCredentials) {
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
  );
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  return oauth2Client;
}
```

- [ ] Step 2: Commit
  git add packages/gmail-mcp-server/src/auth.ts
  git commit -m "feat(gmail): add OAuth2 auth service with token refresh"

---

## Task 3: Implement Gmail API Service

**Files:**
- Create: packages/gmail-mcp-server/src/gmail.ts

- [ ] Step 1: Create packages/gmail-mcp-server/src/gmail.ts

```typescript
import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export interface SendEmailInput {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

export interface MessageListItem {
  id: string; threadId: string; snippet?: string;
  from?: string; subject?: string; date?: string; labelIds?: string[];
}

export interface MessageDetail {
  id: string; threadId: string; labelIds: string[]; snippet?: string;
  from?: string; to?: string[]; subject?: string; date?: string; body?: string;
}

export interface Label {
  id: string; name: string; type?: string;
  messageListVisibility?: string; labelListVisibility?: string;
  color?: { textColor?: string; backgroundColor?: string };
}

export function createGmailService(auth: OAuth2Client) {
  const gmail = google.gmail({ version: "v1", auth });
  return {
    sendEmail: async (input: SendEmailInput): Promise<{ id: string }> => {
      const toHeader = input.to.join(", ");
      const ccHeader = input.cc?.length ? `Cc: ${input.cc.join(", ")}\r\n` : "";
      const bccHeader = input.bcc?.length ? `Bcc: ${input.bcc.join(", ")}\r\n` : "";
      const message = [
        "From: me", `To: ${toHeader}`, ccHeader, bccHeader,
        `Subject: ${input.subject}`, "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8", "", input.body,
      ].filter(Boolean).join("\r\n");
      const encodedMessage = Buffer.from(message).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const response = await gmail.users.messages.send({
        userId: "me", requestBody: { raw: encodedMessage },
      });
      return { id: response.data.id! };
    },
    listMessages: async (params: {
      maxResults?: number; labelIds?: string[]; query?: string;
    }): Promise<MessageListItem[]> => {
      const response = await gmail.users.messages.list({
        userId: "me", maxResults: params.maxResults ?? 20,
        labelIds: params.labelIds, q: params.query,
      });
      const messages = response.data.messages ?? [];
      if (messages.length === 0) return [];
      return Promise.all(messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me", id: msg.id!, format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = detail.data.payload?.headers ?? [];
        return {
          id: msg.id!, threadId: msg.threadId!,
          snippet: detail.data.snippet ?? undefined,
          from: headers.find((h) => h.name === "From")?.value,
          subject: headers.find((h) => h.name === "Subject")?.value,
          date: headers.find((h) => h.name === "Date")?.value,
          labelIds: detail.data.labelIds ?? [],
        };
      }));
    },
    getMessage: async (id: string, format: string = "full"): Promise<MessageDetail> => {
      const response = await gmail.users.messages.get({
        userId: "me", id, format: format as any,
      });
      const headers = response.data.payload?.headers ?? [];
      let body: string | undefined;
      const payload = response.data.payload;
      if (payload?.body?.data) {
        body = Buffer.from(payload.body.data, "base64").toString("utf-8");
      } else if (payload?.parts) {
        const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
        if (textPart?.body?.data) body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
      }
      return {
        id: response.data.id!, threadId: response.data.threadId!,
        labelIds: response.data.labelIds ?? [],
        snippet: response.data.snippet ?? undefined,
        from: headers.find((h) => h.name === "From")?.value,
        to: headers.filter((h) => h.name === "To").map((h) => h.value!).flatMap((v) => v.split(",").map((s) => s.trim())),
        subject: headers.find((h) => h.name === "Subject")?.value,
        date: headers.find((h) => h.name === "Date")?.value, body,
      };
    },
    searchMessages: async (params: { query: string; maxResults?: number }): Promise<MessageListItem[]> => {
      return this.listMessages({ query: params.query, maxResults: params.maxResults });
    },
    listLabels: async (): Promise<Label[]> => {
      const response = await gmail.users.labels.list({ userId: "me" });
      return (response.data.labels ?? []).map((label) => ({
        id: label.id!, name: label.name!, type: label.type ?? undefined,
        messageListVisibility: label.messageListVisibility ?? undefined,
        labelListVisibility: label.labelListVisibility ?? undefined,
        color: label.color ? { textColor: label.color.textColor ?? undefined, backgroundColor: label.color.backgroundColor ?? undefined } : undefined,
      }));
    },
  };
}

export type GmailService = ReturnType<typeof createGmailService>;
```

- [ ] Step 2: Commit
  git add packages/gmail-mcp-server/src/gmail.ts
  git commit -m "feat(gmail): add Gmail API service with send, list, get, search, labels"

---

## Task 4: Implement MCP Tool Definitions

**Files:**
- Create: packages/gmail-mcp-server/src/tools.ts

- [ ] Step 1: Create packages/gmail-mcp-server/src/tools.ts

```typescript
import { z } from "zod";
import type { GmailService } from "./gmail.js";

export function createToolDefinitions(gmail: GmailService) {
  return [
    {
      name: "gmail_send",
      description: "Send an email via Gmail",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body text" },
          cc: { type: "array", items: { type: "string" }, description: "CC recipients" },
          bcc: { type: "array", items: { type: "string" }, description: "BCC recipients" },
        },
        required: ["to", "subject", "body"],
      },
      handler: async (args: Record<string, unknown>) => {
        const parsed = z.object({
          to: z.array(z.string().email()),
          subject: z.string().min(1),
          body: z.string(),
          cc: z.array(z.string().email()).optional(),
          bcc: z.array(z.string().email()).optional(),
        }).parse(args);
        const result = await gmail.sendEmail(parsed);
        return { content: [{ type: "text", text: `Email sent. Message ID: ${result.id}` }] };
      },
    },
    {
      name: "gmail_list",
      description: "List Gmail inbox messages",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: { type: "number", description: "Maximum results to return (default 20)" },
          labelIds: { type: "array", items: { type: "string" }, description: "Filter by label IDs" },
          query: { type: "string", description: "Gmail search query" },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const parsed = z.object({
          maxResults: z.number().optional(),
          labelIds: z.array(z.string()).optional(),
          query: z.string().optional(),
        }).parse(args);
        const messages = await gmail.listMessages(parsed);
        return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
      },
    },
    {
      name: "gmail_get",
      description: "Get a single Gmail message by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Message ID" },
          format: { type: "string", enum: ["full", "metadata", "minimal", "raw"], description: "Message format (default full)" },
        },
        required: ["id"],
      },
      handler: async (args: Record<string, unknown>) => {
        const parsed = z.object({
          id: z.string().min(1),
          format: z.enum(["full", "metadata", "minimal", "raw"]).optional().default("full"),
        }).parse(args);
        const message = await gmail.getMessage(parsed.id, parsed.format);
        return { content: [{ type: "text", text: JSON.stringify(message, null, 2) }] };
      },
    },
    {
      name: "gmail_search",
      description: "Search Gmail messages using Gmail search syntax",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query" },
          maxResults: { type: "number", description: "Maximum results to return (default 20)" },
        },
        required: ["query"],
      },
      handler: async (args: Record<string, unknown>) => {
        const parsed = z.object({
          query: z.string().min(1),
          maxResults: z.number().optional(),
        }).parse(args);
        const messages = await gmail.searchMessages(parsed);
        return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
      },
    },
    {
      name: "gmail_labels",
      description: "List all Gmail labels",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const labels = await gmail.listLabels();
        return { content: [{ type: "text", text: JSON.stringify(labels, null, 2) }] };
      },
    },
  ];
}
```

- [ ] Step 2: Commit
  git add packages/gmail-mcp-server/src/tools.ts
  git commit -m "feat(gmail): add MCP tool definitions for Gmail"

---

## Task 5: Implement MCP Server Entry Point

**Files:**
- Create: packages/gmail-mcp-server/src/index.ts

- [ ] Step 1: Create packages/gmail-mcp-server/src/index.ts

```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGmailAuth } from "./auth.js";
import { createGmailService } from "./gmail.js";
import { createToolDefinitions } from "./tools.js";

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("Missing required env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN");
  process.exit(1);
}

const auth = createGmailAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN });
const gmail = createGmailService(auth);
const tools = createToolDefinitions(gmail);

const server = new Server(
  { name: "paperclip-gmail-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler({ method: "tools/list" }, async () => ({
  tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler({ method: "tools/call" }, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
  try {
    return await tool.handler(request.params.arguments ?? {});
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] Step 2: Commit
  git add packages/gmail-mcp-server/src/index.ts
  git commit -m "feat(gmail): add MCP server entry point with stdio transport"

---

## Task 6: Implement Connector Client Pool

**Files:**
- Create: runtime-core/management-server/src/connector-client-pool.ts

- [ ] Step 1: Create runtime-core/management-server/src/connector-client-pool.ts

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface ConnectorClientEntry {
  client: Client;
  transport: StreamableHTTPClientTransport;
  namespace: string;
  lastUsed: number;
}

const pool = new Map<string, ConnectorClientEntry>();
const MAX_IDLE_MS = 5 * 60 * 1000;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pool.entries()) {
      if (now - entry.lastUsed > MAX_IDLE_MS) {
        entry.client.close().catch(() => {});
        pool.delete(key);
      }
    }
  }, 60_000);
}

export async function getOrCreateClient(
  tenantId: string, connectorKey: string, endpointUrl: string, namespace: string,
): Promise<Client> {
  startCleanup();
  const key = `${tenantId}:${connectorKey}`;
  const existing = pool.get(key);
  if (existing) { existing.lastUsed = Date.now(); return existing.client; }
  const transport = new StreamableHTTPClientTransport(new URL(endpointUrl));
  const client = new Client(
    { name: `paperclip-connector-${connectorKey}`, version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  pool.set(key, { client, transport, namespace, lastUsed: Date.now() });
  return client;
}

export function dropClient(tenantId: string, connectorKey: string): void {
  const key = `${tenantId}:${connectorKey}`;
  const entry = pool.get(key);
  if (entry) { entry.client.close().catch(() => {}); pool.delete(key); }
}

export function dropAllForTenant(tenantId: string): void {
  for (const [key, entry] of pool.entries()) {
    if (key.startsWith(`${tenantId}:`)) { entry.client.close().catch(() => {}); pool.delete(key); }
  }
}
```

- [ ] Step 2: Commit
  git add runtime-core/management-server/src/connector-client-pool.ts
  git commit -m "feat(runtime): add MCP client connection pool for connectors"

---

## Task 7: Implement Aggregating MCP Gateway

**Files:**
- Create: runtime-core/management-server/src/connector-gateway.ts
- Modify: runtime-core/management-server/src/index.ts

- [ ] Step 1: Create runtime-core/management-server/src/connector-gateway.ts

```typescript
import { Router } from "express";
import { getOrCreateClient } from "./connector-client-pool.js";

const CP_BASE_URL = process.env.CP_URL || "http://localhost:3001";
const CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN || "";
const CONNECTOR_TIMEOUT_MS = 30_000;

export function createConnectorGateway(): Router {
  const router = Router();

  router.post("/tools/list", async (req, res) => {
    try {
      const tenantId = req.body.tenant_id || req.headers["x-tenant-id"];
      if (!tenantId) return res.status(400).json({ error: "tenant_id_required" });
      const cpResponse = await fetch(
        `${CP_BASE_URL}/api/internal/tenants/${tenantId}/enabled-connectors`,
        { headers: { "X-Service-Token": CP_SERVICE_TOKEN } },
      );
      if (!cpResponse.ok) return res.json(await fetchToolsFromCp(req, tenantId));
      const enabledConnectors = await cpResponse.json();
      const cpTools = await fetchToolsFromCp(req, tenantId);
      const connectorTools: any[] = [];
      for (const conn of enabledConnectors) {
        try {
          const client = await getOrCreateClient(tenantId, conn.connectorKey, conn.resolvedEndpoint, conn.namespace);
          const result = await client.request(
            { method: "tools/list", params: {} },
            { schema: { type: "object", properties: {} } },
            { timeout: 10_000 },
          );
          for (const tool of ((result as any).tools ?? [])) {
            connectorTools.push({ name: `${conn.namespace}__${tool.name}`, description: tool.description, input_schema: tool.inputSchema });
          }
        } catch { /* skip */ }
      }
      res.json({ tools: [...(cpTools.tools ?? []), ...connectorTools] });
    } catch (err) { res.status(500).json({ error: "gateway_error", message: String(err) }); }
  });

  router.post("/tools/call", async (req, res) => {
    try {
      const tenantId = req.body.tenant_id || req.headers["x-tenant-id"];
      const toolName: string = req.body.name ?? req.body.tool;
      const args: Record<string, unknown> = req.body.arguments ?? {};
      if (!tenantId) return res.status(400).json({ error: "tenant_id_required" });
      if (!toolName) return res.status(400).json({ error: "tool_name_required" });
      const sep = toolName.indexOf("__");
      if (sep === -1) return proxyToCp(req, res, "/api/runtime/mcp-sdk/tools/call");
      const namespace = toolName.slice(0, sep);
      const actualToolName = toolName.slice(sep + 2);
      const infoResponse = await fetch(
        `${CP_BASE_URL}/api/internal/tenants/${tenantId}/connector-by-namespace/${namespace}`,
        { headers: { "X-Service-Token": CP_SERVICE_TOKEN } },
      );
      if (!infoResponse.ok) return res.status(404).json({ isError: true, content: [{ type: "text", text: `Connector '${namespace}' not found` }] });
      const connInfo = await infoResponse.json();
      const enforceResponse = await fetch(`${CP_BASE_URL}/api/core/enforce`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Service-Token": CP_SERVICE_TOKEN },
        body: JSON.stringify({ tenant_id: tenantId, tool: toolName, risk_class: "connector", package_tier: connInfo.packageTier }),
      });
      if (!enforceResponse.ok) return res.status(403).json({ isError: true, content: [{ type: "text", text: "Tool call denied by policy" }] });
      try {
        const client = await getOrCreateClient(tenantId, connInfo.connectorKey, connInfo.resolvedEndpoint, namespace);
        const result = await client.request(
          { method: "tools/call", params: { name: actualToolName, arguments: args } },
          { schema: { type: "object", properties: {} } },
          { timeout: CONNECTOR_TIMEOUT_MS },
        );
        res.json(result);
      } catch (err) {
        res.json({ isError: true, content: [{ type: "text", text: `Connector error: ${err instanceof Error ? err.message : String(err)}` }] });
      }
    } catch (err) { res.status(500).json({ error: "gateway_error", message: String(err) }); }
  });

  return router;
}

async function fetchToolsFromCp(req: any, tenantId: string): Promise<{ tools: any[] }> {
  try {
    const cpResponse = await fetch(`${CP_BASE_URL}/api/runtime/mcp-sdk/tools/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Token": CP_SERVICE_TOKEN },
      body: JSON.stringify({ ...req.body, tenant_id: tenantId }),
    });
    if (cpResponse.ok) return cpResponse.json();
  } catch { /* CP unreachable */ }
  return { tools: [] };
}

function proxyToCp(req: any, res: any, path: string): Promise<void> {
  return fetch(`${CP_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Service-Token": CP_SERVICE_TOKEN },
    body: JSON.stringify(req.body),
  }).then(async (cpRes) => res.status(cpRes.status).json(await cpRes.json()))
    .catch(() => res.status(502).json({ error: "cp_unreachable" }));
}
```

- [ ] Step 2: Update runtime-core/management-server/src/index.ts

```typescript
import express from "express";
import { createEntitlementProxy } from "./entitlement-proxy.js";
import { createEnforcementProxy } from "./enforcement-proxy.js";
import { createConnectorGateway } from "./connector-gateway.js";

const PORT = parseInt(process.env.PORT || "3004", 10);
const app = express();
app.use(express.json());
app.use("/api/core", createEnforcementProxy());
app.use("/api/runtime/internal", createEntitlementProxy());
app.use("/api/runtime/mcp-sdk", createConnectorGateway());
app.listen(PORT, () => { console.log(`Management server listening on port ${PORT}`); });
```

- [ ] Step 3: Commit
  git add runtime-core/management-server/src/connector-gateway.ts runtime-core/management-server/src/index.ts
  git commit -m "feat(runtime): add aggregating MCP gateway with connector tool routing"

---

## Task 8: Add Internal API Routes for Gateway Communication

**Files:**
- Modify: server/src/routes/internal.ts

- [ ] Step 1: Add imports and routes to server/src/routes/internal.ts

Add imports at top:
```typescript
import { connectors, tenantConnectors } from "@paperclipai/db";
import { entitlementStore } from "../services/entitlement-store.js";
```

Add routes inside internalRoutes() before return router;:
```typescript
  router.get("/internal/tenants/:tenantId/enabled-connectors", async (req, res) => {
    try { requireCpAuth(req); } catch (err: any) { res.status(err.status ?? 401).json({ error: err.message ?? "cp_service_token_required" }); return; }
    const { tenantId } = req.params;
    const rows = await db!
      .select({ id: tenantConnectors.id, connectorKey: connectors.connectorKey, connectorName: connectors.connectorName, namespace: tenantConnectors.namespace, resolvedEndpoint: tenantConnectors.resolvedEndpoint, status: tenantConnectors.status })
      .from(tenantConnectors).innerJoin(connectors, eq(tenantConnectors.connectorId, connectors.id))
      .where(and(eq(tenantConnectors.tenantId, tenantId), eq(tenantConnectors.status, "enabled"), eq(connectors.status, "active")));
    res.json(rows);
  });

  router.get("/internal/tenants/:tenantId/connector-by-namespace/:namespace", async (req, res) => {
    try { requireCpAuth(req); } catch (err: any) { res.status(err.status ?? 401).json({ error: err.message ?? "cp_service_token_required" }); return; }
    const { tenantId, namespace } = req.params;
    const row = await db!
      .select({ id: tenantConnectors.id, connectorKey: connectors.connectorKey, connectorName: connectors.connectorName, namespace: tenantConnectors.namespace, resolvedEndpoint: tenantConnectors.resolvedEndpoint, allowedPackages: connectors.allowedPackages })
      .from(tenantConnectors).innerJoin(connectors, eq(tenantConnectors.connectorId, connectors.id))
      .where(and(eq(tenantConnectors.tenantId, tenantId), eq(tenantConnectors.namespace, namespace), eq(tenantConnectors.status, "enabled")))
      .limit(1).then((r: any[]) => r[0]);
    if (!row) { res.status(404).json({ error: "connector_not_found" }); return; }
    const tier = entitlementStore?.getTierForCompany(tenantId) ?? "free";
    res.json({ ...row, packageTier: row.allowedPackages?.includes(tier) ? tier : "denied" });
  });
```

- [ ] Step 2: Commit
  git add server/src/routes/internal.ts
  git commit -m "feat(server): add internal API routes for connector gateway communication"

---

## Task 9: Update Handshake Service with Real MCP SDK

**Files:**
- Modify: server/src/services/connector-handshake.ts

- [ ] Step 1: Replace server/src/services/connector-handshake.ts

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectorToolRegistry } from "@paperclipai/db";

export function connectorHandshakeService(db: Db) {
  return {
    handshake: async (tenantId: string, connectorId: string, endpointUrl: string, namespace: string): Promise<{ success: boolean; error?: string }> => {
      let client: Client | null = null;
      try {
        client = new Client({ name: "paperclip-connector-handshake", version: "1.0.0" }, { capabilities: {} });
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        await client.connect(new StreamableHTTPClientTransport(new URL(endpointUrl)));
        const result = await client.request({ method: "tools/list", params: {} }, { schema: { type: "object", properties: {} } });
        const tools = (result as any).tools ?? [];
        const tcRow = await db.select().from(tenantConnectors).where(and(eq(tenantConnectors.tenantId, tenantId), eq(tenantConnectors.connectorId, connectorId))).limit(1).then((r) => r[0]);
        if (tcRow) {
          for (const tool of tools) {
            await db.insert(connectorToolRegistry).values({ tenantConnectorId: tcRow.id, toolName: tool.name, namespacedName: `${namespace}__${tool.name}`, description: tool.description ?? null, inputSchema: tool.inputSchema ?? null }).onConflictDoNothing({ target: [connectorToolRegistry.tenantConnectorId, connectorToolRegistry.toolName] });
          }
          await db.update(tenantConnectors).set({ status: "enabled", lastHandshakeAt: new Date(), lastError: null, resolvedEndpoint: endpointUrl }).where(eq(tenantConnectors.id, tcRow.id));
        }
        return { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await db.update(tenantConnectors).set({ status: "failed", lastError: errorMessage }).where(and(eq(tenantConnectors.tenantId, tenantId), eq(tenantConnectors.connectorId, connectorId)));
        return { success: false, error: errorMessage };
      } finally {
        if (client) { try { await client.close(); } catch { /* ignore */ } }
      }
    },
  };
}
```

- [ ] Step 2: Commit
  git add server/src/services/connector-handshake.ts
  git commit -m "feat(server): add real MCP SDK handshake with tool discovery"

---

## Task 10: Add Seed Data for Gmail Connector

**Files:**
- Create: server/src/seed/connectors.ts

- [ ] Step 1: Create server/src/seed/connectors.ts

```typescript
import type { Db } from "@paperclipai/db";
import { connectors } from "@paperclipai/db";
import { eq } from "drizzle-orm";

export async function seedConnectors(db: Db): Promise<void> {
  const existing = await db.select().from(connectors).where(eq(connectors.connectorKey, "gmail")).limit(1).then((r) => r[0]);
  if (existing) return;
  await db.insert(connectors).values({
    connectorKey: "gmail",
    connectorName: "Gmail",
    description: "Access Gmail inbox, send emails, search messages, and manage labels",
    endpointUrl: process.env.GMAIL_MCP_URL ?? "http://gmail-mcp-server:3001",
    hostingMode: "remote",
    authType: "oauth2",
    credentialSchema: [
      { key: "client_id", label: "OAuth2 Client ID", required: true },
      { key: "client_secret", label: "OAuth2 Client Secret", secret: true, required: true },
      { key: "refresh_token", label: "OAuth2 Refresh Token", secret: true, required: true },
    ],
    allowedPackages: ["starter", "growth", "enterprise"],
    status: "active",
  });
}
```

- [ ] Step 2: Commit
  git add server/src/seed/connectors.ts
  git commit -m "feat(server): add seed data for Gmail connector registration"

---

## Task 11: TypeScript Compilation Check

- [ ] Step 1: Run typecheck on all affected packages
  cd packages/gmail-mcp-server && pnpm typecheck
  cd runtime-core/management-server && pnpm typecheck
  cd server && pnpm typecheck

- [ ] Step 2: Commit fixes
  git add -A && git commit -m "fix: resolve type errors in connector packages"

---

## Validation Checklist

- [ ] packages/gmail-mcp-server builds: cd packages/gmail-mcp-server && pnpm typecheck
- [ ] Management server builds: cd runtime-core/management-server && pnpm typecheck
- [ ] Server builds: cd server && pnpm typecheck
- [ ] Gmail MCP server starts with valid credentials
- [ ] Connector gateway mounts without error
- [ ] Internal API routes respond to CP service token auth
- [ ] Seed data creates Gmail connector in the catalog
