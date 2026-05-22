/**
 * subscribe — server.
 *
 * Hosts a `timer` agent that emits a status, a few logs, then an
 * artifact_ref before returning. The demo uses two clients (one as
 * submitter, one as observer) sharing the same principal; the
 * observer subscribes to the live job and replays history.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7888);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "subscribe-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["timer"],
    },
    // Both clients authenticate as the same principal so the default
    // (same-principal-only) authorization policy admits the subscriber.
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("timer", async (input, ctx) => {
    const opts = (input ?? {}) as { ticks?: number; tickMs?: number };
    const ticks = opts.ticks ?? 4;
    const tickMs = opts.tickMs ?? 250;
    await ctx.status("running");
    for (let i = 1; i <= ticks; i++) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      await ctx.log("info", `tick ${i}/${ticks}`);
      await sleep(tickMs);
    }
    await ctx.artifactRef({
      uri: "memory://timer/result",
      content_type: "application/json",
    });
    return { ticks };
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
