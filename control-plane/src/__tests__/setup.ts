import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/db/queries", () => ({
  getRuntimeInstancesByTenantId: vi.fn(),
}));