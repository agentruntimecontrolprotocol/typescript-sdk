import { defineConfig } from "vitest/config";

import { arcpWorkspaceAliases } from "../../../vitest.aliases.js";

export default defineConfig({
  resolve: {
    alias: arcpWorkspaceAliases,
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Keep the old singleFork behavior under Vitest 4 to avoid Node 24
    // worker-pool teardown crashes while still using child processes.
    pool: "forks",
    maxWorkers: 1,
    isolate: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
