/**
 * progress — server.
 *
 * Hosts an `indexer` agent that emits `progress` events as it walks a
 * synthetic 100-file workspace.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env["ARCP_DEMO_PORT"] ?? 7892);
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "progress-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["indexer"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("indexer", async (input, ctx) => {
    const opts = (input ?? {}) as { total?: number; tickMs?: number };
    const total = opts.total ?? 100;
    const tickMs = opts.tickMs ?? 40;

    await ctx.status("indexing");
    for (let i = 1; i <= total; i++) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      await ctx.progress(i, {
        total,
        units: "files",
        message: `file-${i}.ts`,
      });
      await sleep(tickMs);
    }
    return { indexed: total };
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
