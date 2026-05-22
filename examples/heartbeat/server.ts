/**
 * heartbeat — server.
 *
 * Demonstrates the v1.1 heartbeat keepalive. The runtime advertises a
 * 5-second `heartbeat_interval_sec` in `session.welcome` and emits
 * `session.ping` envelopes on that cadence (a much shorter interval
 * than the 30 s default, so the demo finishes quickly).
 *
 * Hosts a trivial `echo` agent; the demo doesn't require running jobs
 * to observe heartbeats, but having an agent lets the client verify a
 * normal job round-trip too.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7885);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "heartbeat-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["echo"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    // Five-second cadence so the demo is observable in a handful of
    // seconds. Production deployments default to 30 s.
    heartbeatIntervalSeconds: 5,
  });

  server.registerAgent("echo", async (input) => input);

  const wss = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (t) => {
      server.accept(t);
    },
  });
  console.log(`ARCP runtime listening on ${wss.url}`);
  console.log(`heartbeat_interval_sec=5`);
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
