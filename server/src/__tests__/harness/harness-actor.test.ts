import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { boardActor, agentActor, instanceAdminActor } from "./actor.js";
import { buildApp } from "./app.js";
import { mockDb } from "./mocks.js";

describe("harness/actor", () => {
  it("boardActor builds a board actor for a company", () => {
    const actor = boardActor("company-1");
    expect(actor.type).toBe("board");
    expect(actor.companyIds).toContain("company-1");
    expect(actor.isInstanceAdmin).toBeFalsy();
  });

  it("agentActor builds an agent actor", () => {
    const actor = agentActor("agent-1");
    expect(actor.type).toBe("agent");
    expect(actor.agentId).toBe("agent-1");
  });

  it("instanceAdminActor builds an instance admin actor", () => {
    const actor = instanceAdminActor();
    expect(actor.type).toBe("board");
    expect(actor.isInstanceAdmin).toBe(true);
  });
});

describe("harness/app", () => {
  it("buildApp mounts a route module under /api with actor middleware and errorHandler", async () => {
    const router = express.Router();
    router.get("/ping", (req, res) => res.json({ ok: true, actorType: req.actor.type }));

    const app = buildApp({ routes: (db: unknown) => router, db: {}, actor: boardActor("company-1") });

    const res = await request(app).get("/api/ping");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, actorType: "board" });
  });

  it("buildApp uses a default board actor when none is provided", async () => {
    const router = express.Router();
    router.get("/who", (req, res) => res.json({ type: req.actor.type }));
    const app = buildApp({ routes: () => router });
    const res = await request(app).get("/api/who");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: "board" });
  });

  it("buildApp surfaces errors through errorHandler as json", async () => {
    const router = express.Router();
    router.get("/boom", () => {
      throw new Error("boom");
    });
    const app = buildApp({ routes: () => router });
    const res = await request(app).get("/api/boom");
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe("harness/mocks", () => {
  it("mockDb exposes chainable select/from/where returning rows", async () => {
    const db = mockDb();
    (db.select as any).mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ id: "row-1" }]) }),
    });
    const rows = await db.select().from({} as any).where();
    expect(rows).toEqual([{ id: "row-1" }]);
  });

  it("mockDb insert returns returning rows", async () => {
    const db = mockDb();
    (db.insert as any).mockReturnValue({
      values: () => ({ returning: () => Promise.resolve([{ id: "new" }]) }),
    });
    const rows = await db.insert({} as any).values({}).returning();
    expect(rows).toEqual([{ id: "new" }]);
  });

  it("mockDb update/delete are chainable stubs", async () => {
    const db = mockDb();
    (db.update as any).mockReturnValue({
      set: () => ({ where: () => Promise.resolve([{ id: "upd" }]) }),
    });
    const updated = await db.update({} as any).set({}).where();
    expect(updated).toEqual([{ id: "upd" }]);
    (db.delete as any).mockReturnValue({ where: () => Promise.resolve(undefined) });
    const deleted = await db.delete({} as any).where();
    expect(deleted).toBeUndefined();
  });

  it("mockDb default delete chain is thenable and resolves to undefined", async () => {
    const db = mockDb();
    const result = await db.delete({} as any).where();
    expect(result).toBeUndefined();
  });
});