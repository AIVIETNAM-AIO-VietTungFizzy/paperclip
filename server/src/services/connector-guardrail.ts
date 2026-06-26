import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectors } from "@paperclipai/db";
import { HttpError, unprocessable } from "../errors.js";

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
    if (username ?? password) {
      throw unprocessable("Incomplete basic-auth credentials");
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

const CONNECTOR_GUARDRAIL_CONSUMER_ID = "connector-guardrail";

function credentialConfigPath(tenantConnectorId: string, key: string): string {
  return `tenantConnectors.${tenantConnectorId}.credentialRefs.${key}`;
}

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
        consumerId: CONNECTOR_GUARDRAIL_CONSUMER_ID,
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
        id: tenantConnectors.id,
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

    const tenantConnectorId = row.id;
    const entries = Object.entries(refs);
    const resolved = await Promise.all(
      entries.map(async ([key, ref]) => [
        key,
        await resolveCredentialRef(ref, tenantId, credentialConfigPath(tenantConnectorId, key)),
      ] as const),
    );
    const resolvedConfig: Record<string, string> = {};
    for (const [key, value] of resolved) resolvedConfig[key] = value;

    const headers = buildAuthHeaders(row.authType, resolvedConfig);
    return { headers };
  }

  async function resolveConnectorCredentialsByNamespace(
    tenantId: string,
    namespace: string,
  ): Promise<{ headers: Record<string, string> }> {
    const row = await db
      .select({
        id: tenantConnectors.id,
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

    const tenantConnectorId = row.id;
    const entries = Object.entries(refs);
    const resolved = await Promise.all(
      entries.map(async ([key, ref]) => [
        key,
        await resolveCredentialRef(ref, tenantId, credentialConfigPath(tenantConnectorId, key)),
      ] as const),
    );
    const resolvedConfig: Record<string, string> = {};
    for (const [key, value] of resolved) resolvedConfig[key] = value;

    const headers = buildAuthHeaders(row.authType, resolvedConfig);
    return { headers };
  }

  return {
    resolveConnectorCredentials,
    resolveConnectorCredentialsByNamespace,
  };
}

export { isSecretRef, parseSecretRef, credentialConfigPath, CONNECTOR_GUARDRAIL_CONSUMER_ID };

export function isCredentialResolutionError(err: unknown): { status: number } | null {
  if (err instanceof HttpError) {
    if (err.status === 422 || err.status === 404) return { status: err.status };
  }
  return null;
}