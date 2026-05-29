/**
 * cancel — server.
 *
 * Hosts a "slow-walk" agent that emits a metric per tick and checks its
 * cancellation signal between ticks. When the client sends `job.cancel`,
 * the runtime aborts `ctx.signal`; the agent observes it and throws,
 * yielding a terminal `job.error` with `final_status: "cancelled"`.
 */

import {
  ARCPServer,
  CancelledError,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env["ARCP_DEMO_PORT"] ?? 7883);
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "cancel-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["slow-walk"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("slow-walk", async (input, ctx) => {
    const opts = (input ?? {}) as { steps?: number; tickMs?: number };
    const steps = opts.steps ?? 60;
    const tickMs = opts.tickMs ?? 100;

    await ctx.status("walking");
    for (let i = 1; i <= steps; i++) {
      if (ctx.signal.aborted) {
        throw new CancelledError("cancellation observed by agent");
      }
      await ctx.metric({ name: "step", value: i, unit: "count" });
      await sleep(tickMs);
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
