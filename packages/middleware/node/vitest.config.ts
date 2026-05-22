import { defineConfig } from "vitest/config";

import { arcpWorkspaceAliases } from "../../../vitest.aliases.js";

export default defineConfig({
  resolve: {
    alias: arcpWorkspaceAliases,
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts", "src/**/*.d.ts"],
    },
  },
});
