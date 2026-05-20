import { defineConfig } from "vitest/config";

import { arcpWorkspaceAliases } from "../../vitest.aliases.js";

export default defineConfig({
  resolve: {
    alias: arcpWorkspaceAliases,
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // pool=forks + singleFork: vitest 2 has a known SIGSEGV on thread-pool
    // teardown under Node 24, surfaces in CI as exit 139 despite all tests passing.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/**/*.d.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
      },
    },
  },
});
