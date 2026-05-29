/**
 * idempotent-retry — server.
 *
 * Hosts two agents:
 *   - "weekly-report" (the canonical request).
 *   - "different-agent" (used to drive the DUPLICATE_KEY path).
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env["ARCP_DEMO_PORT"] ?? 7881);
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "idempotent-retry-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["weekly-report", "different-agent"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("weekly-report", async (input) => {
    const opts = (input ?? {}) as { week?: string };
    return { week: opts.week ?? "?", emailed: true };
  });

  server.registerAgent("different-agent", async () => ({ unused: true }));

  const wss = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (t) => {
      server.accept(t);
    },
  });
  console.log(`ARCP runtime listening on ${wss.url}`);
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
