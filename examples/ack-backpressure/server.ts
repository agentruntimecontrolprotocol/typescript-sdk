/**
 * ack-backpressure — server.
 *
 * Hosts a `chatty` agent that rapidly emits ~2000 `metric` events as
 * fast as it can. The runtime tracks per-session unacked event lag and
 * once it crosses `backPressureThreshold` it emits a `status` event
 * with `phase: "back_pressure"`. We deliberately lower the threshold
 * so the demo is fast.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7886);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "ack-backpressure-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["chatty"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    // Surface back-pressure once 200 events are unacked (default 1000 would
    // take much longer to hit with 2000 metrics).
    backPressureThreshold: 200,
  });

  server.registerAgent("chatty", async (input, ctx) => {
    const opts = (input ?? {}) as { count?: number };
    const count = opts.count ?? 2000;
    for (let i = 1; i <= count; i++) {
      await ctx.metric({ name: "tick", value: i, unit: "count" });
    }
    return { emitted: count };
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
