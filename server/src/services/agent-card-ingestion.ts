import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { tenantConnectors, connectorToolRegistry } from "@paperclipai/db";
import { fetchAgentCard } from "./agent-card-fetcher.js";
import type { AgentCardSkill } from "./agent-card-fetcher.js";

export interface IngestSkillsResult {
  success: boolean;
  ingestedSkillCount: number;
  error?: string;
}

export function agentCardIngestionService(db: Db) {
  return {
    ingestSkills: async (
      tenantId: string,
      connectorId: string,
      cardUrl: string,
      namespace: string,
      credentialHeaders?: Record<string, string>,
    ): Promise<IngestSkillsResult> => {
      try {
        const card = await fetchAgentCard(cardUrl, credentialHeaders);

        const tcRow = await db
          .select()
          .from(tenantConnectors)
          .where(
            and(
              eq(tenantConnectors.tenantId, tenantId),
              eq(tenantConnectors.connectorId, connectorId),
            ),
          )
          .limit(1)
          .then((r) => r[0]);

        if (!tcRow) {
          return { success: true, ingestedSkillCount: 0 };
        }

        let ingested = 0;
        for (const skill of card.skills) {
          const namespacedName = `${namespace}__${skill.id}`;
          await db
            .insert(connectorToolRegistry)
            .values(skillToRegistryRow(tcRow.id, namespace, skill, namespacedName))
            .onConflictDoUpdate({
              target: [connectorToolRegistry.tenantConnectorId, connectorToolRegistry.toolName],
              set: skillConflictSet(skill),
            });
          ingested += 1;
        }

        return { success: true, ingestedSkillCount: ingested };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, ingestedSkillCount: 0, error: errorMessage };
      }
    },
  };
}

function skillToRegistryRow(
  tenantConnectorId: string,
  namespace: string,
  skill: AgentCardSkill,
  namespacedName: string,
) {
  return {
    tenantConnectorId,
    toolName: skill.id,
    namespacedName,
    description: skill.description ?? null,
    toolType: "skill" as const,
    skillId: skill.id,
    skillName: skill.name,
    skillDescription: skill.description ?? null,
    inputModes: skill.inputModes ?? null,
    outputModes: skill.outputModes ?? null,
    tags: skill.tags ?? null,
    enabled: true,
    pending: false,
    riskClass: "connector",
    approvalClass: "auto",
    requiresApproval: false,
  };
}

function skillConflictSet(skill: AgentCardSkill) {
  return {
    // LLG-4.3 review fix: re-assert toolType on conflict so a row that
    // collided on (tenantConnectorId, toolName) — e.g. an MCP-tool row whose
    // name matched a skill id — is promoted to a skill row instead of staying
    // stale with tool_type='tool'.
    toolType: "skill" as const,
    skillName: skill.name,
    skillDescription: skill.description ?? null,
    description: skill.description ?? null,
    inputModes: skill.inputModes ?? null,
    outputModes: skill.outputModes ?? null,
    tags: skill.tags ?? null,
  };
}