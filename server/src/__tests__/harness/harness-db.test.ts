import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, createDb, issues, projects } from "@paperclipai/db";
import { startTestDb, withTestDb, truncateAll, type TestDb } from "./db.js";
import { seedCompany, seedAgent, seedIssue, seedProject, seedRun } from "./seed.js";

describe("harness", () => {
  let testDb!: TestDb;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    testDb = await startTestDb("harness-shared-");
    db = testDb.db;
  }, 120_000);

  afterEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await testDb.cleanup();
  }, 120_000);

  describe("db", () => {
    it("startTestDb returns a connection string and a usable db", () => {
      expect(typeof testDb.connectionString).toBe("string");
      expect(testDb.connectionString).toContain("127.0.0.1:");
      expect(db).toBeDefined();
    });

    it("truncateAll clears rows and resets identity across tables", async () => {
      const company = await seedCompany(db);
      await seedAgent(db, company.id);
      await seedProject(db, company.id);
      await seedIssue(db, company.id);

      const before = await db.select().from(companies);
      expect(before.length).toBeGreaterThan(0);

      await truncateAll(db);

      const afterCompanies = await db.select().from(companies);
      const afterAgents = await db.select().from(agents);
      const afterIssues = await db.select().from(issues);
      const afterProjects = await db.select().from(projects);
      expect(afterCompanies).toHaveLength(0);
      expect(afterAgents).toHaveLength(0);
      expect(afterIssues).toHaveLength(0);
      expect(afterProjects).toHaveLength(0);
    });

    it("withTestDb runs a callback with a fresh db and cleans up", async () => {
      const result = await withTestDb("harness-withdb-", async (client) => {
        const company = await client
          .insert(companies)
          .values({ name: "WithDb Co" })
          .returning()
          .then((r) => r[0]!);
        return company.name;
      });
      expect(result).toBe("WithDb Co");
    }, 120_000);
  });

  describe("seed", () => {
    it("seedCompany creates a company row with a unique issue prefix", async () => {
      const company = await seedCompany(db);
      expect(company.id).toBeTruthy();
      expect(company.name).toBeTruthy();
      expect(company.issuePrefix).toMatch(/^[A-Z0-9]+$/);
      const [found] = await db.select().from(companies).where(eq(companies.id, company.id));
      expect(found).toBeDefined();
    });

    it("seedAgent creates an agent scoped to a company", async () => {
      const company = await seedCompany(db);
      const agent = await seedAgent(db, company.id);
      expect(agent.id).toBeTruthy();
      expect(agent.companyId).toBe(company.id);
      const [found] = await db.select().from(agents).where(eq(agents.id, agent.id));
      expect(found).toBeDefined();
    });

    it("seedProject creates a project scoped to a company", async () => {
      const company = await seedCompany(db);
      const project = await seedProject(db, company.id);
      expect(project.id).toBeTruthy();
      expect(project.companyId).toBe(company.id);
    });

    it("seedIssue creates an issue scoped to a company with an identifier", async () => {
      const company = await seedCompany(db);
      const issue = await seedIssue(db, company.id);
      expect(issue.id).toBeTruthy();
      expect(issue.companyId).toBe(company.id);
      expect(issue.identifier).toBeTruthy();
    });

    it("seedRun creates a heartbeat run scoped to a company and agent", async () => {
      const company = await seedCompany(db);
      const agent = await seedAgent(db, company.id);
      const run = await seedRun(db, company.id, agent.id);
      expect(run.id).toBeTruthy();
      expect(run.companyId).toBe(company.id);
      expect(run.agentId).toBe(agent.id);
    });

    it("seed functions apply overrides", async () => {
      const company = await seedCompany(db, { name: "Override Co" });
      expect(company.name).toBe("Override Co");
      const agent = await seedAgent(db, company.id, { name: "Override Agent", role: "engineer" });
      expect(agent.name).toBe("Override Agent");
      expect(agent.role).toBe("engineer");
      const issue = await seedIssue(db, company.id, { title: "Override Issue", status: "in_progress" });
      expect(issue.title).toBe("Override Issue");
      expect(issue.status).toBe("in_progress");
    });
  });
});