import { eq } from "drizzle-orm";
import { db } from "./index";
import { tenantRuntimeInstances } from "./schema";

export async function getRuntimeInstancesByTenantId(tenantId: string) {
  return db
    .select()
    .from(tenantRuntimeInstances)
    .where(eq(tenantRuntimeInstances.tenantId, tenantId));
}
