import { companies, authUsers, instanceUserRoles, companyMemberships, agents, projects, issues } from "@paperclipai/db/schema";
import { eq, and } from "drizzle-orm";

export async function autoSeed(dependencies: {
  db: any;
  companyService: { create: (data: any) => Promise<any> };
  agentService: { create: (companyId: string, data: any) => Promise<any> };
}) {
  const { db, companyService, agentService } = dependencies;

  const existing = await db.select({ id: companies.id }).from(companies).limit(1);
  if (existing.length > 0) return;

  const LOCAL_BOARD_USER_ID = "local-board";

  const existingUser = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, LOCAL_BOARD_USER_ID))
    .then((rows: any[]) => rows[0] ?? null);
  if (!existingUser) {
    await db.insert(authUsers).values({
      id: LOCAL_BOARD_USER_ID,
      name: "Board",
      email: "local@paperclip.local",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const existingRole = await db
    .select({ id: instanceUserRoles.id })
    .from(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, LOCAL_BOARD_USER_ID), eq(instanceUserRoles.role, "instance_admin")))
    .then((rows: any[]) => rows[0] ?? null);
  if (!existingRole) {
    await db.insert(instanceUserRoles).values({ userId: LOCAL_BOARD_USER_ID, role: "instance_admin" });
  }

  const companyName = process.env.PAPERCLIP_AUTO_SEED_COMPANY_NAME || "My Company";
  const company = await companyService.create({ name: companyName });

  const existingMembership = await db
    .select({ id: companyMemberships.id })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, company.id), eq(companyMemberships.principalId, LOCAL_BOARD_USER_ID)))
    .then((rows: any[]) => rows[0] ?? null);
  if (!existingMembership) {
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: LOCAL_BOARD_USER_ID,
      status: "active",
      membershipRole: "owner",
    });
  }

  const hasLlm = !!(process.env.OPENCODE_CONFIG_CONTENT || process.env.LITELLM_GATEWAY_URL);
  if (!hasLlm) return;

  const agent = await agentService.create(company.id, {
    name: "CEO",
    role: "ceo",
    status: "idle",
    adapterType: "opencode_local",
    adapterConfig: { dangerouslySkipPermissions: true },
    runtimeConfig: {
      heartbeat: { enabled: false, intervalSec: 300, wakeOnDemand: true, cooldownSec: 10, maxConcurrentRuns: 10 },
    },
  });

  const [project] = await db.insert(projects).values({
    companyId: company.id,
    name: "Onboarding",
    status: "in_progress",
  }).returning();

  await db.insert(issues).values({
    companyId: company.id,
    title: "Explore Paperclip",
    description: [
      "You are the CEO. You set the direction for the company.",
      "",
      "- hire a founding engineer",
      "- write a hiring plan",
      "- break the roadmap into concrete tasks and start delegating work",
    ].join("\n"),
    assigneeAgentId: agent.id,
    projectId: project.id,
    status: "todo",
  });
}