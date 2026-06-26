import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectors } from "@paperclipai/db";
import { secretService } from "./secrets.js";

const SECRET_REF_PREFIX = "secret:";

function isSecretRef(value: string): boolean {
  return value.startsWith(SECRET_REF_PREFIX);
}

function parseSecretRef(value: string): string {
  return value.slice(SECRET_REF_PREFIX.length);
}

function buildAuthHeaders(
  authType: string | null,
  config: Record<string, string>,
): Record<string, string> {
  if (!authType || authType === "none") return {};

  if (authType === "apikey") {
    const apiKey = config.apiKey;
    const headerName = config.headerName || "X-API-Key";
    if (apiKey) return { [headerName]: apiKey };
  } else if (authType === "bearer") {
    const token = config.token;
    if (token) return { Authorization: `Bearer ${token}` };
  } else if (authType === "basic") {
    const username = config.username;
    const password = config.password;
    if (username && password) {
      return {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      };
    }
  }

  return {};
}

export type ConnectorGuardrailService = ReturnType<typeof connectorGuardrailService>;

/**
 * LLG-4.3 review fix (spec §8a point 3): resolves a tenant connector's
 * credentialRefs into upstream auth headers, decrypting `secret:<uuid>` refs
 * through the CP vault. Private Agent Cards behind securitySchemes need these
 * headers to be ingested. Mirrors the LLG-1.3 guardrail pattern; secret refs
 * never leak to the caller — only the resolved { headers } shape is returned.
 */
export function connectorGuardrailService(db: Db) {
  const secrets = secretService(db);

  async function resolveCredentialRef(
    ref: string,
    tenantId: string,
    configPath: string,
  ): Promise<string> {
    if (isSecretRef(ref)) {
      const secretId = parseSecretRef(ref);
      return secrets.resolveSecretValue(tenantId, secretId, "latest", {
        consumerType: "system",
        consumerId: "connector-guardrail",
        configPath,
      });
    }
    return ref;
  }

  async function resolveConnectorCredentials(
    tenantId: string,
    connectorId: string,
  ): Promise<{ headers: Record<string, string> }> {
    const row = await db
      .select({
        credentialRefs: tenantConnectors.credentialRefs,
        authType: connectors.authType,
        credentialSchema: connectors.credentialSchema,
      })
      .from(tenantConnectors)
      .innerJoin(connectors, eq(tenantConnectors.connectorId, connectors.id))
      .where(
        and(
          eq(tenantConnectors.tenantId, tenantId),
          eq(tenantConnectors.connectorId, connectorId),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (!row) return { headers: {} };

    const refs = row.credentialRefs ?? {};
    if (Object.keys(refs).length === 0) return { headers: {} };

    const resolved: Record<string, string> = {};
    for (const [key, ref] of Object.entries(refs)) {
      resolved[key] = await resolveCredentialRef(ref, tenantId, `credentialRefs.${key}`);
    }

    const headers = buildAuthHeaders(row.authType, resolved);
    return { headers };
  }

  return {
    resolveConnectorCredentials,
  };
}