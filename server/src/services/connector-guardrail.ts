import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectors } from "@paperclipai/db";

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

interface SecretService {
  resolveSecretValue(
    companyId: string,
    secretId: string,
    version: number | "latest",
    context?: {
      consumerType: string;
      consumerId: string;
      configPath?: string | null;
    },
  ): Promise<string>;
}

export type ConnectorGuardrailService = ReturnType<typeof connectorGuardrailService>;

export function connectorGuardrailService(
  db: Db,
  secretService: SecretService,
) {
  async function resolveCredentialRef(
    ref: string,
    tenantId: string,
    configPath: string,
  ): Promise<string> {
    if (isSecretRef(ref)) {
      const secretId = parseSecretRef(ref);
      return secretService.resolveSecretValue(tenantId, secretId, "latest", {
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
          eq(tenantConnectors.status, "enabled"),
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

  async function resolveConnectorCredentialsByNamespace(
    tenantId: string,
    namespace: string,
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
          eq(tenantConnectors.namespace, namespace),
          eq(tenantConnectors.status, "enabled"),
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
    resolveConnectorCredentialsByNamespace,
  };
}
