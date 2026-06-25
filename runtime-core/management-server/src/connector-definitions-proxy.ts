import { Router } from "express";

const CP_BASE_URL = process.env.CP_URL || "http://localhost:3001";
const CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN || "";

function cpHeaders(): Record<string, string> {
  return { "X-Service-Token": CP_SERVICE_TOKEN };
}

export function createConnectorDefinitionsProxy(): Router {
  const router = Router();

  // POST /connector-definitions/:id/sync — re-probe the connector's live MCP
  // server and refresh the stored tool list. Proxies to CP /api/connectors/:id/sync.
  router.post("/connector-definitions/:id/sync", async (req, res) => {
    try {
      const id = req.params.id;
      const cpRes = await fetch(
        `${CP_BASE_URL}/api/connectors/${id}/sync`,
        {
          method: "POST",
          headers: cpHeaders(),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!cpRes.ok) {
        return res.status(502).json({ error: "Control plane error" });
      }
      return res.json(await cpRes.json());
    } catch (err) {
      return res.status(500).json({ error: "Failed to sync connector tools" });
    }
  });

  // PATCH /connector-definitions/:id/tools/:toolId — persist per-tool enable
  // state to the connector_tool_registry. Proxies to CP.
  router.patch("/connector-definitions/:id/tools/:toolId", async (req, res) => {
    try {
      const { id, toolId } = req.params;
      const tenantId = process.env.TENANT_ID;
      if (!tenantId) {
        return res.status(500).json({ error: "TENANT_ID not configured" });
      }
      const cpRes = await fetch(
        `${CP_BASE_URL}/api/companies/${tenantId}/connectors/${id}/tools/${toolId}`,
        {
          method: "PATCH",
          headers: { ...cpHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!cpRes.ok) {
        return res.status(502).json({ error: "Control plane error" });
      }
      return res.json(await cpRes.json());
    } catch (err) {
      return res.status(500).json({ error: "Failed to update tool" });
    }
  });

  return router;
}