import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

function fromRoot(relativePath: string): string {
  return path.join(workspaceRoot, relativePath);
}

export const arcpWorkspaceAliases = [
  {
    find: /^@arcp\/core$/,
    replacement: fromRoot("packages/core/src/index.ts"),
  },
  {
    find: /^@arcp\/core\/(.+)$/,
    replacement: fromRoot("packages/core/src/$1"),
  },
  {
    find: /^@arcp\/client$/,
    replacement: fromRoot("packages/client/src/index.ts"),
  },
  {
    find: /^@arcp\/runtime$/,
    replacement: fromRoot("packages/runtime/src/index.ts"),
  },
  {
    find: /^@arcp\/sdk$/,
    replacement: fromRoot("packages/sdk/src/index.ts"),
  },
  {
    find: /^@arcp\/node$/,
    replacement: fromRoot("packages/middleware/node/src/index.ts"),
  },
  {
    find: /^@arcp\/express$/,
    replacement: fromRoot("packages/middleware/express/src/index.ts"),
  },
  {
    find: /^@arcp\/fastify$/,
    replacement: fromRoot("packages/middleware/fastify/src/index.ts"),
  },
  {
    find: /^@arcp\/hono$/,
    replacement: fromRoot("packages/middleware/hono/src/index.ts"),
  },
  {
    find: /^@arcp\/bun$/,
    replacement: fromRoot("packages/middleware/bun/src/index.ts"),
  },
  {
    find: /^@arcp\/middleware-otel$/,
    replacement: fromRoot("packages/middleware/otel/src/index.ts"),
  },
];
