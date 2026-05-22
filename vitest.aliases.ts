import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

function fromRoot(relativePath: string): string {
  return path.join(workspaceRoot, relativePath);
}

export const arcpWorkspaceAliases = [
  {
    find: /^@agentruntimecontrolprotocol\/core$/,
    replacement: fromRoot("packages/core/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/core\/(.+)$/,
    replacement: fromRoot("packages/core/src/$1"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/client$/,
    replacement: fromRoot("packages/client/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/runtime$/,
    replacement: fromRoot("packages/runtime/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/sdk$/,
    replacement: fromRoot("packages/sdk/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/node$/,
    replacement: fromRoot("packages/middleware/node/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/express$/,
    replacement: fromRoot("packages/middleware/express/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/fastify$/,
    replacement: fromRoot("packages/middleware/fastify/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/hono$/,
    replacement: fromRoot("packages/middleware/hono/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/bun$/,
    replacement: fromRoot("packages/middleware/bun/src/index.ts"),
  },
  {
    find: /^@agentruntimecontrolprotocol\/middleware-otel$/,
    replacement: fromRoot("packages/middleware/otel/src/index.ts"),
  },
];
