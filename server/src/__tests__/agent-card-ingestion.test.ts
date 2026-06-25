import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

const mockTenantConnectorsTable = vi.hoisted(() => ({}));
const mockConnectorToolRegistryTable = vi.hoisted(() => ({}));

vi.mock("@paperclipai/db", () => ({
  tenantConnectors: mockTenantConnectorsTable,
  connectorToolRegistry: mockConnectorToolRegistryTable,
}));

const mockFetchAgentCard = vi.hoisted(() => vi.fn());

vi.mock("../services/agent-card-fetcher.js", () => ({
  fetchAgentCard: mockFetchAgentCard,
}));

function makeSelectChain(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return Object.assign(promise, {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  });
}

function makeInsertChain() {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
  };
}

describe("agentCardIngestionService", () => {
  let ingestion: ReturnType<typeof import("../services/agent-card-ingestion.js").agentCardIngestionService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetchAgentCard.mockReset();
    const mod = await import("../services/agent-card-ingestion.js");
    ingestion = mod.agentCardIngestionService(mockDb as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps card.skills[] into structured connector_tool_registry rows (tool_type=skill)", async () => {
    mockFetchAgentCard.mockResolvedValue({
      name: "research-agent",
      description: "A research agent",
      skills: [
        {
          id: "search",
          name: "Search",
          description: "Search the web",
          tags: ["search"],
          inputModes: ["text"],
          outputModes: ["text"],
        },
        {
          id: "summarize",
          name: "Summarize",
          description: "Summarize content",
          tags: ["summary"],
          inputModes: ["text"],
          outputModes: ["text"],
        },
      ],
    });

    const tcRow = { id: "tc-1", tenantId: "tenant-1", connectorId: "conn-1", namespace: "research" };
    mockDb.select.mockReturnValue(makeSelectChain([tcRow]));

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    const result = await ingestion.ingestSkills("tenant-1", "conn-1", "http://agent.example/.well-known/agent.json", "research");

    expect(result.success).toBe(true);
    expect(result.ingestedSkillCount).toBe(2);
    expect(insertChain.values).toHaveBeenCalledTimes(2);

    const firstInsert = insertChain.values.mock.calls[0][0] as Record<string, unknown>;
    expect(firstInsert.tenantConnectorId).toBe("tc-1");
    expect(firstInsert.toolName).toBe("search");
    expect(firstInsert.namespacedName).toBe("research__search");
    expect(firstInsert.toolType).toBe("skill");
    expect(firstInsert.skillId).toBe("search");
    expect(firstInsert.skillName).toBe("Search");
    expect(firstInsert.skillDescription).toBe("Search the web");
    expect(firstInsert.inputModes).toEqual(["text"]);
    expect(firstInsert.outputModes).toEqual(["text"]);
    expect(firstInsert.tags).toEqual(["search"]);
    expect(firstInsert.enabled).toBe(true);
  });

  it("returns success with zero skills when card has no skills[]", async () => {
    mockFetchAgentCard.mockResolvedValue({ name: "empty-agent", description: "no skills", skills: [] });

    const tcRow = { id: "tc-1", tenantId: "tenant-1", connectorId: "conn-1", namespace: "empty" };
    mockDb.select.mockReturnValue(makeSelectChain([tcRow]));

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    const result = await ingestion.ingestSkills("tenant-1", "conn-1", "http://agent.example/.well-known/agent.json", "empty");

    expect(result.success).toBe(true);
    expect(result.ingestedSkillCount).toBe(0);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns failure when card fetch errors", async () => {
    mockFetchAgentCard.mockRejectedValue(new Error("network down"));

    const result = await ingestion.ingestSkills("tenant-1", "conn-1", "http://agent.example/.well-known/agent.json", "research");

    expect(result.success).toBe(false);
    expect(result.error).toBe("network down");
  });

  it("returns success with zero skills when no tenant connector row exists", async () => {
    mockFetchAgentCard.mockResolvedValue({ name: "x", description: "x", skills: [{ id: "s1", name: "S1", description: "d" }] });
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const result = await ingestion.ingestSkills("tenant-1", "conn-1", "http://agent.example/.well-known/agent.json", "x");

    expect(result.success).toBe(true);
    expect(result.ingestedSkillCount).toBe(0);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("upserts skills (onConflictDoUpdate) so re-ingestion refreshes description/tags without dropping enabled", async () => {
    mockFetchAgentCard.mockResolvedValue({
      name: "agent", description: "d",
      skills: [{ id: "s", name: "S", description: "new desc", tags: ["t"], inputModes: ["text"], outputModes: ["text"] }],
    });

    const tcRow = { id: "tc-1", tenantId: "tenant-1", connectorId: "conn-1", namespace: "agent" };
    mockDb.select.mockReturnValue(makeSelectChain([tcRow]));

    const insertChain = makeInsertChain();
    mockDb.insert.mockReturnValue(insertChain);

    await ingestion.ingestSkills("tenant-1", "conn-1", "http://agent.example/.well-known/agent.json", "agent");

    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
  });
});