import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  companies,
  authUsers,
  instanceUserRoles,
  companyMemberships,
  agents,
  projects,
  issues,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres auto-seed tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("autoSeed", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-auto-seed-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companyMemberships);
    await db.delete(companies);
    await db.delete(instanceUserRoles);
    await db.delete(authUsers);
    delete process.env.PAPERCLIP_AUTO_SEED;
    delete process.env.PAPERCLIP_AUTO_SEED_COMPANY_NAME;
    delete process.env.OPENCODE_CONFIG_CONTENT;
    delete process.env.LITELLM_GATEWAY_URL;
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  describe("basic", () => {
    it("should NOT create any company", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db });
      const rows = await db.select().from(companies);
      expect(rows.length).toBe(0);
    });

    it("should ensure local-board user exists with instance_admin role", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db });
      const user = await db
        .select()
        .from(authUsers)
        .where(eq(authUsers.id, "local-board"))
        .then((r) => r[0]);
      expect(user).toBeDefined();
      expect(user.name).toBe("Board");
      const role = await db
        .select({ id: instanceUserRoles.id })
        .from(instanceUserRoles)
        .where(
          and(
            eq(instanceUserRoles.userId, "local-board"),
            eq(instanceUserRoles.role, "instance_admin"),
          ),
        )
        .then((r) => r[0]);
      expect(role).toBeDefined();
    });

    it("should NOT create any company membership (no company to join)", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db });
      const mem = await db
        .select()
        .from(companyMemberships)
        .where(eq(companyMemberships.principalId, "local-board"))
        .then((r) => r[0]);
      expect(mem).toBeUndefined();
    });

    it("should be idempotent when called multiple times", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db });
      await autoSeed({ db });
      const users = await db.select().from(authUsers).where(eq(authUsers.id, "local-board"));
      expect(users.length).toBe(1);
    });
  });

  describe("board API key", () => {
    it("should create board API key when PAPERCLIP_BOARD_API_KEY is set", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      process.env.PAPERCLIP_BOARD_API_KEY = "test-board-key-123";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db });
      const { boardApiKeys } = await import("@paperclipai/db/schema");
      const { eq } = await import("drizzle-orm");
      const { createHash } = await import("node:crypto");
      const keyHash = createHash("sha256").update("test-board-key-123").digest("hex");
      const key = await db
        .select()
        .from(boardApiKeys)
        .where(eq(boardApiKeys.keyHash, keyHash))
        .then((r) => r[0]);
      expect(key).toBeDefined();
      expect(key.name).toBe("Management Server");
    });
  });

  describe("no LLM artifacts", () => {
    it("should never create agents, projects, or issues", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        provider: { openai: { options: { apiKey: "test" } } },
      });
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db });
      const agentRows = await db.select().from(agents);
      expect(agentRows.length).toBe(0);
      const projectRows = await db.select().from(projects);
      expect(projectRows.length).toBe(0);
      const issueRows = await db.select().from(issues);
      expect(issueRows.length).toBe(0);
    });
  });
});
