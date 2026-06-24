import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    isolate: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.{unit,}.test.ts", "src/**/__tests-unit__/**/*.test.ts"],
          exclude: [
            "src/__tests__/**",
            "src/**/__tests-route__/**",
            "**/*.route.test.ts",
            "**/*.integration.test.ts",
            ".worktrees/**",
            "node_modules/**",
          ],
          pool: "forks",
          maxConcurrency: 4,
          passWithNoTests: true,
          setupFiles: [],
        },
      },
      {
        extends: true,
        test: {
          name: "route",
          include: ["src/**/__tests-route__/**/*.test.ts", "src/**/*.route.test.ts"],
          exclude: [
            "src/__tests__/**",
            "src/**/__tests-unit__/**",
            ".worktrees/**",
            "node_modules/**",
          ],
          pool: "forks",
          maxConcurrency: 2,
          passWithNoTests: true,
          setupFiles: ["./src/__tests-route__/setup-supertest.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/__tests__/**/*.test.ts"],
          exclude: ["**/*.unit.test.ts", "**/*.route.test.ts", ".worktrees/**", "node_modules/**"],
          pool: "forks",
          maxConcurrency: 1,
          maxWorkers: 1,
          minWorkers: 1,
          sequence: { concurrent: false, hooks: "list" },
          setupFiles: ["./src/__tests__/setup-supertest.ts"],
        },
      },
    ],
  },
});