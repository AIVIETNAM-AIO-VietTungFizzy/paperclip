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
import { companyService } from "../services/companies.js";
import { agentService } from "../services/agents.js";

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
    it("should create a company with default name when AUTO_SEED is enabled and no companies exist", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const rows = await db.select().from(companies);
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("My Company");
    });

    it("should create a company with custom name from PAPERCLIP_AUTO_SEED_COMPANY_NAME", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      process.env.PAPERCLIP_AUTO_SEED_COMPANY_NAME = "Acme Corp";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const rows = await db.select().from(companies);
      expect(rows[0].name).toBe("Acme Corp");
    });

    it("should ensure local-board user exists with instance_admin role", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
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

    it("should add local-board as owner member of the created company", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const mem = await db
        .select()
        .from(companyMemberships)
        .where(eq(companyMemberships.principalId, "local-board"))
        .then((r) => r[0]);
      expect(mem).toBeDefined();
      expect(mem.membershipRole).toBe("owner");
    });

    it("should be idempotent when companies already exist", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      await db.insert(companies).values({ name: "Existing Co" });
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const rows = await db.select().from(companies);
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("Existing Co");
    });
  });

  describe("with LLM configured", () => {
    it("should create a CEO agent with opencode_local adapter when OPENCODE_CONFIG_CONTENT is set", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        provider: { openai: { options: { apiKey: "test" } } },
      });
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const agentRows = await db.select().from(agents);
      expect(agentRows.length).toBe(1);
      expect(agentRows[0].name).toBe("CEO");
      expect(agentRows[0].role).toBe("ceo");
      expect(agentRows[0].adapterType).toBe("opencode_local");
      expect(agentRows[0].status).toBe("idle");
    });

    it("should create an Onboarding project", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        provider: { openai: { options: { apiKey: "test" } } },
      });
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const projectRows = await db.select().from(projects);
      expect(projectRows.length).toBe(1);
      expect(projectRows[0].name).toBe("Onboarding");
    });

    it("should create an issue assigned to the CEO agent with CEO prompt", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        provider: { openai: { options: { apiKey: "test" } } },
      });
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const issueRows = await db.select().from(issues);
      expect(issueRows.length).toBe(1);
      expect(issueRows[0].assigneeAgentId).toBeDefined();
      expect(issueRows[0].title).toBe("Explore Paperclip");
      expect(issueRows[0].description).toContain("You are the CEO");
    });

    it("should create CEO agent when LITELLM_GATEWAY_URL is set instead of OPENCODE_CONFIG_CONTENT", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      process.env.LITELLM_GATEWAY_URL = "https://litellm.example.com";
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const agentRows = await db.select().from(agents);
      expect(agentRows.length).toBe(1);
      expect(agentRows[0].adapterType).toBe("opencode_local");
    });
  });

  describe("without LLM", () => {
    it("should skip agent/project/issue creation when no LLM is configured", async () => {
      process.env.PAPERCLIP_AUTO_SEED = "true";
      delete process.env.OPENCODE_CONFIG_CONTENT;
      delete process.env.LITELLM_GATEWAY_URL;
      const { autoSeed } = await import("../auto-seed.js");
      await autoSeed({ db, companyService: companyService(db), agentService: agentService(db) });
      const agentRows = await db.select().from(agents);
      expect(agentRows.length).toBe(0);
      const projectRows = await db.select().from(projects);
      expect(projectRows.length).toBe(0);
      const issueRows = await db.select().from(issues);
      expect(issueRows.length).toBe(0);
    });
  });
});