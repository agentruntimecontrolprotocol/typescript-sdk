/**
 * agent-versions — server.
 *
 * Registers two versioned handlers for the same agent name and pins a
 * default via `setDefaultAgentVersion`. Bare-name submits resolve to
 * the default; pinned submits route to the specific version; pinning
 * an unregistered version yields `AGENT_VERSION_NOT_AVAILABLE`.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7889);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "agent-versions-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      // Rich v1.1 inventory shape: each entry lists the versions and the default.
      agents: [
        {
          name: "code-refactor",
          versions: ["1.0.0", "2.0.0"],
          default: "2.0.0",
        },
      ],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgentVersion("code-refactor", "1.0.0", async (input) => {
    return { handler: "v1", result: "v1 result", input };
  });
  server.registerAgentVersion("code-refactor", "2.0.0", async (input) => {
    return { handler: "v2", result: "v2 result", input };
  });
  server.setDefaultAgentVersion("code-refactor", "2.0.0");

  const wss = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (t) => {
      server.accept(t);
    },
  });
  console.log(`ARCP runtime listening on ${wss.url}`);
  console.log(
    "Registered code-refactor@1.0.0 and @2.0.0; default = code-refactor@2.0.0",
  );
  console.log(`Token: ${TOKEN}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down...");
    await wss.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
