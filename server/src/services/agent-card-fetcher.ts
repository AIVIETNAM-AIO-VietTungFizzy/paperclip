export interface AgentCardSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCard {
  name: string;
  description?: string;
  skills: AgentCardSkill[];
}

const CARD_FETCH_TIMEOUT_MS = 15_000;

export async function fetchAgentCard(cardUrl: string, headers?: Record<string, string>): Promise<AgentCard> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CARD_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(cardUrl, {
      signal: controller.signal,
      headers: { accept: "application/json", ...(headers ?? {}) },
    });
    if (!response.ok) {
      throw new Error(`agent_card_fetch_failed: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as Partial<AgentCard>;
    const skills = Array.isArray(body.skills) ? body.skills : [];
    return {
      name: typeof body.name === "string" ? body.name : "",
      description: typeof body.description === "string" ? body.description : undefined,
      skills: skills
        .filter((s): s is AgentCardSkill => s != null && typeof s.id === "string")
        .map((s) => ({
          id: s.id,
          name: typeof s.name === "string" ? s.name : s.id,
          description: typeof s.description === "string" ? s.description : undefined,
          tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === "string") : undefined,
          inputModes: Array.isArray(s.inputModes) ? s.inputModes.filter((m): m is string => typeof m === "string") : undefined,
          outputModes: Array.isArray(s.outputModes) ? s.outputModes.filter((m): m is string => typeof m === "string") : undefined,
        })),
    };
  } finally {
    clearTimeout(timer);
  }
}