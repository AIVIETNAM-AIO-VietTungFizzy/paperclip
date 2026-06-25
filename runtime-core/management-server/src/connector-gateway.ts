import { Router } from "express";
import { z } from "zod";
import { ConnectorClientPool } from "../modules/runtime/connector-client-pool.js";

const AnyResult = z.object({}).passthrough();

const CP_BASE_URL = process.env.CP_URL || "http://localhost:3001";
const CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN || "";
const CONNECTOR_TIMEOUT_MS = 30_000;

interface ToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

const clientPool = new ConnectorClientPool({ timeoutMs: CONNECTOR_TIMEOUT_MS });

export function createConnectorGateway(): Router {
  const router = Router();

  router.post("/tools/list", async (req, res) => {
    try {
      const tenantId = req.body.tenant_id || req.headers["x-tenant-id"];
      if (!tenantId) { res.status(400).json({ error: "tenant_id_required" }); return; }

      const cpResponse = await fetch(
        `${CP_BASE_URL}/api/runtime/internal/tenants/${tenantId}/enabled-connectors`,
        {
          headers: { "X-Service-Token": CP_SERVICE_TOKEN },
        },
      );

      const cpTools = await fetchToolsFromCp(req, tenantId);
      const connectorTools: ToolDefinition[] = [];

      if (cpResponse.ok) {
        const enabledConnectors = await cpResponse.json() as Array<{
          connectorKey: string;
          namespace: string;
          resolvedEndpoint: string;
          enabledTools?: string[];
        }>;

        for (const conn of enabledConnectors) {
          try {
            const client = await clientPool.getOrCreateClient(
              tenantId,
              conn.connectorKey,
              conn.resolvedEndpoint,
            );

            const result = await client.request(
              { method: "tools/list", params: {} },
              AnyResult,
              { timeout: 10_000 },
            );

            const tools = ((result as Record<string, unknown>).tools as Array<Record<string, unknown>>) ?? [];
            const allowlist = conn.enabledTools;
            for (const tool of tools) {
              const namespacedName = `${conn.namespace}__${tool.name}`;
              if (allowlist !== undefined && !allowlist.includes(namespacedName)) {
                continue;
              }
              connectorTools.push({
                name: namespacedName,
                description: tool.description as string | undefined,
                input_schema: tool.inputSchema as Record<string, unknown> | undefined,
              });
            }
          } catch {
            // Down connector — skip, not fatal
          }
        }
      }

      res.json({
        tools: [...(cpTools.tools ?? []), ...connectorTools],
      });
    } catch (err) {
      res.status(500).json({ error: "gateway_error", message: String(err) });
    }
  });

  router.post("/tools/call", async (req, res) => {
    try {
      const tenantId = req.body.tenant_id || req.headers["x-tenant-id"];
      const toolName: string = req.body.name ?? req.body.tool;
      const args: Record<string, unknown> = req.body.arguments ?? {};

      if (!tenantId) { res.status(400).json({ error: "tenant_id_required" }); return; }
      if (!toolName) { res.status(400).json({ error: "tool_name_required" }); return; }

      const separatorIdx = toolName.indexOf("__");
      if (separatorIdx === -1) {
        return proxyToCp(req, res, "/api/runtime/mcp-sdk/tools/call");
      }

      const namespace = toolName.slice(0, separatorIdx);
      const actualToolName = toolName.slice(separatorIdx + 2);

      const infoResponse = await fetch(
        `${CP_BASE_URL}/api/runtime/internal/tenants/${tenantId}/connector-by-namespace/${namespace}`,
        {
          headers: { "X-Service-Token": CP_SERVICE_TOKEN },
        },
      );

      if (!infoResponse.ok) {
        res.status(404).json({
          isError: true,
          content: [{ type: "text", text: `Connector '${namespace}' not found or not enabled` }],
        });
        return;
      }

      const connInfo = await infoResponse.json() as {
        connectorKey: string;
        resolvedEndpoint: string;
        packageTier: string;
        enabledTools?: string[];
      };

      if (connInfo.enabledTools !== undefined && !connInfo.enabledTools.includes(toolName)) {
        res.status(403).json({
          isError: true,
          content: [{ type: "text", text: `Tool '${toolName}' is not enabled for this connector` }],
        });
        return;
      }

      const enforceResponse = await fetch(`${CP_BASE_URL}/api/core/enforce`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token": CP_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          tool_id: toolName,
          intent_kind: "connector_tool_call",
          caller_service: "connector-gateway",
          employee_id: (req.body.employee_id as string | undefined) ?? null,
          session_id: (req.body.session_id as string | undefined) ?? null,
          package: connInfo.packageTier,
        }),
      });

      if (!enforceResponse.ok) {
        res.status(403).json({
          isError: true,
          content: [{ type: "text", text: "Tool call denied by policy (enforce fail-closed)" }],
        });
        return;
      }

      // Parse the enforce decision body. A 200 can still carry decision "deny"
      // or requires_approval: true, both of which must block dispatch (C2).
      let enforceDecision: Record<string, unknown> = {};
      try {
        enforceDecision = await enforceResponse.json() as Record<string, unknown>;
      } catch (err) {
        // Malformed body — fail closed.
        console.warn("[connector-gateway] enforce response body unreadable, failing closed:", err instanceof Error ? err.message : String(err));
        res.status(403).json({
          isError: true,
          content: [{ type: "text", text: "Tool call denied by policy (enforce unreadable)" }],
        });
        return;
      }

      const decision = enforceDecision.decision;
      const requiresApproval =
        enforceDecision.requires_approval === true ||
        decision === "require_approval";

      if (decision === "deny") {
        res.status(403).json({
          isError: true,
          content: [{
            type: "text",
            text: `Tool call denied by policy${typeof enforceDecision.reason === "string" ? `: ${enforceDecision.reason}` : ""}`,
          }],
        });
        return;
      }

      if (requiresApproval) {
        res.status(403).json({
          isError: true,
          content: [{ type: "text", text: "Tool call requires approval before dispatch" }],
        });
        return;
      }

      try {
        const client = await clientPool.getOrCreateClient(
          tenantId,
          connInfo.connectorKey,
          connInfo.resolvedEndpoint,
        );

        const result = await client.request(
          { method: "tools/call", params: { name: actualToolName, arguments: args } },
          AnyResult,
          { timeout: CONNECTOR_TIMEOUT_MS },
        );

        res.json(result);
      } catch (err) {
        res.json({
          isError: true,
          content: [{ type: "text", text: `Connector error: ${err instanceof Error ? err.message : String(err)}` }],
        });
      }
    } catch (err) {
      res.status(500).json({ error: "gateway_error", message: String(err) });
    }
  });

  return router;
}

async function fetchToolsFromCp(
  req: import("express").Request,
  tenantId: string,
): Promise<{ tools: ToolDefinition[] }> {
  try {
    const cpResponse = await fetch(
      `${CP_BASE_URL}/api/runtime/mcp-sdk/tools/list`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token": CP_SERVICE_TOKEN,
        },
        body: JSON.stringify({ ...req.body, tenant_id: tenantId }),
      },
    );
    if (cpResponse.ok) return cpResponse.json() as Promise<{ tools: ToolDefinition[] }>;
  } catch {
    // CP unreachable
  }
  return { tools: [] };
}

function proxyToCp(
  req: import("express").Request,
  res: import("express").Response,
  path: string,
): Promise<void> {
  return fetch(`${CP_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": CP_SERVICE_TOKEN,
    },
    body: JSON.stringify(req.body),
  })
    .then(async (cpRes) => {
      const body = await cpRes.json();
      res.status(cpRes.status).json(body);
    })
    .catch(() => {
      res.status(502).json({ error: "cp_unreachable" });
    });
}
