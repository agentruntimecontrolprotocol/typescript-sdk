/**
 * resume — server.
 *
 * Hosts a "counter" agent that emits N metric events with a small delay
 * between each. The delay is what makes a meaningful resume window: the
 * client can disconnect mid-stream, reconnect, and still observe the
 * tail of the event series replayed from the runtime's EventLog.
 */

import {
  ARCPServer,
  EventLog,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7880);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const eventLog = new EventLog();
  const server = new ARCPServer({
    runtime: { name: "resume-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["counter"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    eventLog,
    resumeWindowSeconds: 60,
  });

  server.registerAgent("counter", async (input, ctx) => {
    const opts = (input ?? {}) as { steps?: number };
    const steps = opts.steps ?? 8;
    for (let i = 1; i <= steps; i++) {
      await ctx.metric({ name: "step", value: i, unit: "count" });
    }
    return { steps };
  });

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
