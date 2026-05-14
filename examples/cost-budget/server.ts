/**
 * cost-budget — server.
 *
 * Hosts a `web-research` agent. Each iteration:
 *   1. emits a `tool_call` for `search.web`,
 *   2. authorizes the call via `validateLeaseOp` with the current
 *      `budgetRemaining` map (so when budget hits zero the next
 *      authorization throws BUDGET_EXHAUSTED),
 *   3. emits a `metric { name: "cost.search", value: 0.30, unit: "USD" }`
 *      which the runtime decrements against the lease's `cost.budget`,
 *   4. emits the matching `tool_result`.
 *
 * The runtime debounces and emits `cost.budget.remaining` metrics as
 * the counter falls.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
  validateLeaseOp,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7891);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "cost-budget-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["web-research"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("web-research", async (input, ctx) => {
    const opts = (input ?? {}) as { iterations?: number; perCallUSD?: number };
    const iterations = opts.iterations ?? 8;
    const perCallUSD = opts.perCallUSD ?? 0.3;

    for (let i = 1; i <= iterations; i++) {
      const callId = `call_${i}`;
      const target = `search.web`;
      await ctx.toolCall({
        tool: target,
        args: { query: `topic ${i}` },
        call_id: callId,
      });
      try {
        validateLeaseOp(ctx.lease, "tool.call", target, {
          constraints: ctx.leaseConstraints,
          budgetRemaining: ctx.budget,
        });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        await ctx.toolResult({
          call_id: callId,
          error: {
            code: (e.code as never) ?? "INTERNAL_ERROR",
            message: e.message ?? "lease check failed",
            retryable: false,
          },
        });
        throw err;
      }
      // Charge the budget.
      await ctx.metric({
        name: "cost.search",
        value: perCallUSD,
        unit: "USD",
      });
      await ctx.toolResult({
        call_id: callId,
        result: { hits: 10 },
      });
    }
    return { iterations };
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
