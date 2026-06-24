import { vi } from "vitest";
import type { Db } from "@paperclipai/db";

type Chainable = Record<string, ReturnType<typeof vi.fn>>;

function chainable(returnValue?: unknown): Chainable {
  const obj: Chainable = {};
  const handler: ProxyHandler<Chainable> = {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = vi.fn().mockReturnValue(target);
      }
      return target[prop];
    },
  };
  const proxied = new Proxy(obj, handler);
  obj.then = vi.fn((onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve(onFulfilled ? onFulfilled(returnValue) : returnValue),
  );
  return proxied;
}

export interface MockDb extends Db {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  $client: { end: ReturnType<typeof vi.fn> };
}

export function mockDb(_tables?: Record<string, unknown>): MockDb {
  const db = {
    select: vi.fn(() => chainable([])),
    insert: vi.fn(() => chainable([{ id: "mock-row" }])),
    update: vi.fn(() => chainable([{ id: "mock-row" }])),
    delete: vi.fn(() => chainable(undefined)),
    execute: vi.fn(() => Promise.resolve(undefined)),
    $client: { end: vi.fn(() => Promise.resolve(undefined)) },
  } as unknown as MockDb;
  return db;
}