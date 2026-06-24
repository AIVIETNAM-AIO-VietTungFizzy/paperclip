import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { requireRuntimeAuth, handleRuntimeAuthError } from "./runtime-auth.js";

/**
 * Update the `package` field in every per-user openclaw.json under the
 * OCMT data directory for the given tenant.
 *
 * The directory layout is:
 *   $OCMT_DATA_DIR/<tenant_id>/<user-id>/openclaw.json
 *
 * Each file is a JSON object with a `package` field that controls which
 * OpenClaw package (L1, L3, etc.) the user's agent is entitled to.
 */
function updateOpenclawPackageField(tenantId: string, tier: string): void {
  const dataDir = process.env.OCMT_DATA_DIR;
  if (!dataDir) return;

  const tenantDir = join(dataDir, tenantId);
  if (!existsSync(tenantDir)) return;

  let userDirs: string[];
  try {
    userDirs = readdirSync(tenantDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const userId of userDirs) {
    const configPath = join(tenantDir, userId, "openclaw.json");
    if (!existsSync(configPath)) continue;

    try {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      config.package = tier;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch {
      // Skip files that can't be read or parsed
    }
  }
}

export function createEntitlementProxy(): Router {
  const router = Router();

  router.post("/sync/entitlements", async (req, res) => {
    try {
      requireRuntimeAuth(req);
    } catch (err: unknown) {
      const handled = handleRuntimeAuthError(err);
      if (handled) { res.status(handled.status).json(handled.body); return; }
      throw err;
    }

    const { tenant_id, subscription_tier, companies } = req.body as Record<string, unknown>;

    if (!tenant_id) {
      res.status(400).json({ error: "tenant_id is required" });
      return;
    }

    if (!subscription_tier) {
      res.status(400).json({ error: "subscription_tier is required" });
      return;
    }

    const paperclipUrl = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
    const cpToken = process.env.CP_SERVICE_TOKEN || "";

    try {
      const upstreamRes = await fetch(
        `${paperclipUrl}/api/runtime/internal/sync/entitlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Service-Token": cpToken,
          },
          body: JSON.stringify({
            tenant_id,
            subscription_tier,
            ...(Array.isArray(companies) ? { companies } : {}),
          }),
        },
      );

      const body = await upstreamRes.json();
      res.status(upstreamRes.status).json(body);
    } catch {
      res.status(502).json({ error: "upstream_unreachable" });
    }

    // Update openclaw.json package field for all users in this tenant
    updateOpenclawPackageField(tenant_id as string, subscription_tier as string);
  });

  return router;
}