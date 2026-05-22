/**
 * list-jobs — server.
 *
 * Hosts a `slow-task` agent that emits a status event then sleeps for
 * a long time (or until cancelled). With three concurrent invocations
 * the demo can exercise `session.list_jobs` filtering + pagination
 * while the jobs are all still in `running`.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7887);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "list-jobs-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["slow-task"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("slow-task", async (input, ctx) => {
    const opts = (input ?? {}) as { label?: string; durationMs?: number };
    const label = opts.label ?? "task";
    const durationMs = opts.durationMs ?? 30_000;
    await ctx.status("running", `${label} in progress`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, durationMs);
      ctx.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(ctx.signal.reason);
        },
        { once: true },
      );
    });
    return { label, done: true };
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
