/**
 * lease-expires-at — server.
 *
 * Hosts a `long-indexer` agent that emits progress every second and
 * tries an `fs.read` lease op on each tick via `validateLeaseOp`. As
 * soon as the lease's `expires_at` elapses, the lease op throws
 * `LEASE_EXPIRED`. The agent surfaces it as a `tool_result` error;
 * the runtime's own expiration watchdog then emits the terminating
 * `job.error { code: "LEASE_EXPIRED" }`.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
  validateLeaseOp,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7890);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "lease-expires-at-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["long-indexer"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("long-indexer", async (input, ctx) => {
    const opts = (input ?? {}) as { tickMs?: number; ticks?: number };
    const tickMs = opts.tickMs ?? 1000;
    const ticks = opts.ticks ?? 20;

    for (let i = 1; i <= ticks; i++) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      const callId = `call_${i}`;
      const target = `/workspace/index/part-${i}.txt`;
      await ctx.toolCall({
        tool: "fs.read",
        args: { path: target },
        call_id: callId,
      });
      try {
        validateLeaseOp(ctx.lease, "fs.read", target, {
          constraints: ctx.leaseConstraints,
        });
        await ctx.toolResult({
          call_id: callId,
          result: { bytes: 1024 * i },
        });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        await ctx.toolResult({
          call_id: callId,
          error: {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            code: (e.code as never) ?? "INTERNAL_ERROR",
            message: e.message ?? "lease check failed",
            retryable: false,
          },
        });
        throw err;
      }
      await sleep(tickMs);
    }
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
