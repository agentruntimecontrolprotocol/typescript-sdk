import { defineConfig } from "vitest/config";

import { arcpWorkspaceAliases } from "../../../vitest.aliases.js";

export default defineConfig({
  resolve: {
    alias: arcpWorkspaceAliases,
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
