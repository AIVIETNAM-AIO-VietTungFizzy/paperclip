import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  agents,
  companies,
  heartbeatRuns,
  issues,
  projects,
  type Db,
} from "@paperclipai/db";

type DbRow<T> = T extends Promise<(infer U)[]> ? U : never;

function issuePrefixFor(companyId: string): string {
  return `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export async function seedCompany(
  db: Db,
  overrides: Partial<typeof companies.$inferInsert> = {},
) {
  const id = overrides.id ?? randomUUID();
  const [row] = await db
    .insert(companies)
    .values({
      id,
      name: `Test Company ${id.slice(0, 8)}`,
      issuePrefix: issuePrefixFor(id),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedAgent(
  db: Db,
  companyId: string,
  overrides: Partial<typeof agents.$inferInsert> = {},
) {
  const [row] = await db
    .insert(agents)
    .values({
      companyId,
      name: `Test Agent ${randomUUID().slice(0, 8)}`,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedProject(
  db: Db,
  companyId: string,
  overrides: Partial<typeof projects.$inferInsert> = {},
) {
  const [row] = await db
    .insert(projects)
    .values({
      companyId,
      name: `Test Project ${randomUUID().slice(0, 8)}`,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedIssue(
  db: Db,
  companyId: string,
  overrides: Partial<typeof issues.$inferInsert> = {},
) {
  const [company] = await db
    .update(companies)
    .set({ issueCounter: sql`${companies.issueCounter} + 1` })
    .where(sql`${companies.id} = ${companyId}`)
    .returning({ issueCounter: companies.issueCounter, issuePrefix: companies.issuePrefix });
  const issueNumber = company?.issueCounter ?? 1;
  const issuePrefix = company?.issuePrefix ?? issuePrefixFor(companyId);
  const identifier = overrides.identifier ?? `${issuePrefix}-${issueNumber}`;
  const [row] = await db
    .insert(issues)
    .values({
      companyId,
      title: `Test Issue ${randomUUID().slice(0, 8)}`,
      issueNumber,
      identifier,
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedRun(
  db: Db,
  companyId: string,
  agentId: string,
  overrides: Partial<typeof heartbeatRuns.$inferInsert> = {},
) {
  const [row] = await db
    .insert(heartbeatRuns)
    .values({
      companyId,
      agentId,
      status: "queued",
      ...overrides,
    })
    .returning();
  return row!;
}