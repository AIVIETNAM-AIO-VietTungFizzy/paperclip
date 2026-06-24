import type { Express } from "express";

type Actor = Express.Request["actor"];

export function boardActor(companyId?: string, overrides: Partial<Actor> = {}): Actor {
  return {
    type: "board",
    userId: "local-board",
    companyIds: companyId ? [companyId] : [],
    source: "local_implicit",
    isInstanceAdmin: false,
    ...overrides,
  };
}

export function agentActor(agentId: string, overrides: Partial<Actor> = {}): Actor {
  return {
    type: "agent",
    agentId,
    source: "agent_jwt",
    isInstanceAdmin: false,
    ...overrides,
  };
}

export function instanceAdminActor(overrides: Partial<Actor> = {}): Actor {
  return {
    type: "board",
    userId: "local-board",
    companyIds: [],
    source: "local_implicit",
    isInstanceAdmin: true,
    ...overrides,
  };
}