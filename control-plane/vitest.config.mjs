import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
    server: {
      deps: {
        inline: ["drizzle-orm"],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@\/(.+)/, replacement: new URL("src/$1", import.meta.url).pathname },
    ],
  },
});