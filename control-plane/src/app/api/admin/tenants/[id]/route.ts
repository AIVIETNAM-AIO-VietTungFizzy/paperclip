import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { getRuntimeInstancesByTenantId } from "@/lib/db/queries";

function getRuntimeServiceToken(): string {
  return process.env.RUNTIME_SERVICE_TOKEN ?? "";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body: Record<string, unknown> = await request.json();

  const existingTenant = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, id))
    .then((rows) => rows[0] ?? null);

  if (!existingTenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const updatedTenant = await db
    .update(tenants)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(tenants.id, id))
    .returning()
    .then((rows) => rows[0] ?? null);

  if (!updatedTenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const tierChanged =
    body.subscription_tier !== undefined &&
    body.subscription_tier !== existingTenant.subscriptionTier;

  if (tierChanged) {
    const instances = await getRuntimeInstancesByTenantId(id);
    for (const instance of instances) {
      try {
        await fetch(
          `${instance.managementServerUrl}/api/runtime/internal/sync/entitlements`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Service-Token": getRuntimeServiceToken(),
            },
            body: JSON.stringify({
              tenant_id: id,
              subscription_tier: updatedTenant.subscriptionTier,
            }),
          },
        );
      } catch (err) {
        console.warn(
          `Failed to push entitlement to ${instance.managementServerUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return NextResponse.json(updatedTenant);
}
