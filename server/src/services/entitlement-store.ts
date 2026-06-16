export interface EntitlementStore {
  /**
   * Record or update the subscription tier for a tenant, optionally
   * mapping which companies belong to that tenant.
   */
  setTenantTier(tenantId: string, tier: string, companyIds?: string[]): void;

  /**
   * Look up the subscription tier for a given company.
   * Falls back to using `companyId` as the tenant key directly.
   */
  getTierForCompany(companyId: string): string | undefined;

  /**
   * Clear all stored entitlements (for testing).
   */
  clear(): void;
}

export function createEntitlementStore(): EntitlementStore {
  const tierByTenant = new Map<string, string>();
  const tenantByCompany = new Map<string, string>();

  return {
    setTenantTier(tenantId: string, tier: string, companyIds?: string[]): void {
      tierByTenant.set(tenantId, tier);
      if (companyIds) {
        for (const companyId of companyIds) {
          tenantByCompany.set(companyId, tenantId);
        }
      }
    },

    getTierForCompany(companyId: string): string | undefined {
      const tenantId = tenantByCompany.get(companyId);
      if (tenantId) return tierByTenant.get(tenantId);
      return tierByTenant.get(companyId);
    },

    clear(): void {
      tierByTenant.clear();
      tenantByCompany.clear();
    },
  };
}