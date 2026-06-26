import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  connectors as connectorsTable,
  companySecretBindings,
  companySecretVersions,
  companySecrets,
  companySecretProviderConfigs,
  connectors,
  createDb,
  secretAccessEvents,
  tenantConnectors,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { secretService } from "../services/secrets.js";
import { connectorGuardrailService, credentialConfigPath, CONNECTOR_GUARDRAIL_CONSUMER_ID } from "../services/connector-guardrail.js";
import { HttpError } from "../errors.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping connector guardrail real-DB tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("connectorGuardrailService (real DB)", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const secretsTmpDir = path.join(os.tmpdir(), `paperclip-guardrail-real-${randomUUID()}`);

  beforeAll(async () => {
    mkdirSync(secretsTmpDir, { recursive: true });
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = path.join(secretsTmpDir, "master.key");
    const started = await startEmbeddedPostgresTestDatabase("connector-guardrail-real");
    stopDb = started.cleanup;
    db = createDb(started.connectionString);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(secretAccessEvents);
    await db.delete(companySecretBindings);
    await db.delete(companySecretVersions);
    await db.delete(companySecrets);
    await db.delete(companySecretProviderConfigs);
    await db.delete(tenantConnectors);
    await db.delete(connectorsTable);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
    if (previousKeyFile === undefined) {
      delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    } else {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    }
    rmSync(secretsTmpDir, { recursive: true, force: true });
  });

  async function seedCompany(name = "Acme") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      issuePrefix: `T${companyId.slice(0, 7)}`.toUpperCase(),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return companyId;
  }

  async function seedConnector(authType: string | null = "apikey") {
    const [connector] = await db
      .insert(connectorsTable)
      .values({
        connectorKey: `conn-${randomUUID().slice(0, 8)}`,
        connectorName: `Connector ${randomUUID().slice(0, 4)}`,
        authType,
        status: "active",
      })
      .returning();
    return connector!;
  }

  async function seedTenantConnector(tenantId: string, connectorId: string, credentialRefs: Record<string, string>) {
    const [tc] = await db
      .insert(tenantConnectors)
      .values({
        tenantId,
        connectorId,
        status: "enabled",
        credentialRefs,
        namespace: `ns-${randomUUID().slice(0, 6)}`,
      })
      .returning();
    return tc!;
  }

  it("resolves a secret:<uuid> ref end-to-end through the real vault when a binding exists", async () => {
    const companyId = await seedCompany();
    const svc = secretService(db);
    const secret = await svc.create(companyId, {
      name: `guardrail-key-${randomUUID()}`,
      provider: "local_encrypted",
      value: "super-secret-api-key",
    });

    const connector = await seedConnector("apikey");
    const tc = await seedTenantConnector(companyId, connector.id, {
      apiKey: `secret:${secret.id}`,
      headerName: "X-API-Key",
    });

    await svc.syncSecretRefsForTarget(
      companyId,
      { targetType: "system", targetId: CONNECTOR_GUARDRAIL_CONSUMER_ID },
      [
        {
          secretId: secret.id,
          configPath: credentialConfigPath(tc.id, "apiKey"),
          versionSelector: "latest",
        },
      ],
    );

    const guardrail = connectorGuardrailService(db, svc);
    const result = await guardrail.resolveConnectorCredentials(companyId, connector.id);

    expect(result).toEqual({ headers: { "X-API-Key": "super-secret-api-key" } });
  });

  it("throws binding_missing (422) when no binding row exists for the secret ref", async () => {
    const companyId = await seedCompany();
    const svc = secretService(db);
    const secret = await svc.create(companyId, {
      name: `unbound-key-${randomUUID()}`,
      provider: "local_encrypted",
      value: "unreachable",
    });

    const connector = await seedConnector("apikey");
    await seedTenantConnector(companyId, connector.id, {
      apiKey: `secret:${secret.id}`,
    });

    const guardrail = connectorGuardrailService(db, svc);
    await expect(guardrail.resolveConnectorCredentials(companyId, connector.id)).rejects.toThrow(/not bound/i);

    await expect(
      guardrail.resolveConnectorCredentials(companyId, connector.id).catch((err) => {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).status).toBe(422);
        throw err;
      }),
    ).rejects.toBeTruthy();
  });

  it("isolates two connectors in the same tenant sharing a credentialRefs key via tcId-scoped bindings", async () => {
    const companyId = await seedCompany();
    const svc = secretService(db);
    const secretX = await svc.create(companyId, {
      name: `conn-x-key-${randomUUID()}`,
      provider: "local_encrypted",
      value: "key-for-conn-x",
    });
    const secretY = await svc.create(companyId, {
      name: `conn-y-key-${randomUUID()}`,
      provider: "local_encrypted",
      value: "key-for-conn-y",
    });

    const connectorX = await seedConnector("apikey");
    const connectorY = await seedConnector("apikey");
    const tcX = await seedTenantConnector(companyId, connectorX.id, { apiKey: `secret:${secretX.id}` });
    const tcY = await seedTenantConnector(companyId, connectorY.id, { apiKey: `secret:${secretY.id}` });

    await svc.syncSecretRefsForTarget(
      companyId,
      { targetType: "system", targetId: CONNECTOR_GUARDRAIL_CONSUMER_ID },
      [
        { secretId: secretX.id, configPath: credentialConfigPath(tcX.id, "apiKey"), versionSelector: "latest" },
        { secretId: secretY.id, configPath: credentialConfigPath(tcY.id, "apiKey"), versionSelector: "latest" },
      ],
    );

    const guardrail = connectorGuardrailService(db, svc);
    const resultX = await guardrail.resolveConnectorCredentials(companyId, connectorX.id);
    const resultY = await guardrail.resolveConnectorCredentials(companyId, connectorY.id);

    expect(resultX).toEqual({ headers: { "X-API-Key": "key-for-conn-x" } });
    expect(resultY).toEqual({ headers: { "X-API-Key": "key-for-conn-y" } });
    expect(resultX).not.toEqual(resultY);
  });

  it("records a secretAccessEvents audit row with tcId-scoped configPath (I2 audit context)", async () => {
    const companyId = await seedCompany();
    const svc = secretService(db);
    const secret = await svc.create(companyId, {
      name: `audit-key-${randomUUID()}`,
      provider: "local_encrypted",
      value: "audited-value",
    });

    const connector = await seedConnector("apikey");
    const tc = await seedTenantConnector(companyId, connector.id, { apiKey: `secret:${secret.id}` });

    await svc.syncSecretRefsForTarget(
      companyId,
      { targetType: "system", targetId: CONNECTOR_GUARDRAIL_CONSUMER_ID },
      [{ secretId: secret.id, configPath: credentialConfigPath(tc.id, "apiKey"), versionSelector: "latest" }],
    );

    const guardrail = connectorGuardrailService(db, svc);
    await guardrail.resolveConnectorCredentials(companyId, connector.id);

    const events = await db
      .select()
      .from(secretAccessEvents)
      .where(/* scoping omitted; table cleared between tests */);
    const relevant = events.filter((e) => e.configPath?.includes(`tenantConnectors.${tc.id}.credentialRefs.apiKey`));
    expect(relevant.length).toBeGreaterThanOrEqual(1);
    const successEvent = relevant.find((e) => e.outcome === "success");
    expect(successEvent).toBeDefined();
    expect(successEvent?.consumerType).toBe("system");
    expect(successEvent?.consumerId).toBe(CONNECTOR_GUARDRAIL_CONSUMER_ID);
  });
});