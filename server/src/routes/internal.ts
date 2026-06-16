import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { EntitlementStore } from "../services/entitlement-store.js";

function requireCpAuth(req: import("express").Request): void {
  const expectedToken = process.env.CP_SERVICE_TOKEN;
  if (!expectedToken) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }

  const authHeader = req.header("authorization");
  const serviceToken = req.header("x-service-token");
  const rawToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : serviceToken?.trim();

  if (!rawToken) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(rawToken);

  if (expected.length !== provided.length) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }

  if (!timingSafeEqual(expected, provided)) {
    throw Object.assign(new Error("cp_service_token_required"), { status: 401 });
  }
}

export function internalRoutes(entitlementStore?: EntitlementStore) {
  const router = Router();

  router.post("/sync/entitlements", (req, res) => {
    try {
      requireCpAuth(req);
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 401).json({ error: error.message ?? "cp_service_token_required" });
      return;
    }

    const {
      tenant_id,
      tenantId,
      subscription_tier,
      subscriptionTier,
      companies,
    } = req.body as Record<string, unknown>;

    const tid = (tenant_id ?? tenantId) as string | undefined;
    const tier = (subscription_tier ?? subscriptionTier) as string | undefined;

    if (!tid || !tier) {
      res.status(400).json({ error: "tenantId and subscriptionTier are required" });
      return;
    }

    if (entitlementStore) {
      const companyIds = Array.isArray(companies) ? (companies as string[]) : undefined;
      entitlementStore.setTenantTier(tid, tier, companyIds);
    }

    res.json({ status: "accepted" });
  });

  return router;
}