/**
 * submit-and-stream — server.
 *
 * Hosts a single "data-analyzer" agent that demonstrates 7 of the 8
 * reserved job.event kinds (delegate has its own example). On submit
 * the agent emits, in order:
 *
 *   status → log → thought → metric → tool_call → tool_result →
 *   artifact_ref → return
 *
 * Start:
 *   pnpm tsx examples/submit-and-stream/server.ts
 *
 * In another terminal:
 *   pnpm tsx examples/submit-and-stream/client.ts
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7879);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "submit-and-stream-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["data-analyzer"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("data-analyzer", async (input, ctx) => {
    const opts = (input ?? {}) as { dataset?: string };

    await ctx.status("fetching");
    await ctx.log("info", "12,408 rows loaded", { dataset: opts.dataset });
    await ctx.thought("Outlier in column 'revenue' row 4421");
    await ctx.metric({ name: "rows", value: 12_408, unit: "row" });

    await ctx.toolCall({
      tool: "stats.summarize",
      args: { column: "revenue" },
      call_id: "c1",
    });
    await ctx.toolResult({
      call_id: "c1",
      result: { mean: 348.12, p95: 1102.4 },
    });

    await ctx.artifactRef({
      uri: `arcp://artifacts/${ctx.sessionId}/${ctx.jobId}/report.html`,
      content_type: "text/html",
      byte_size: 38_291,
    });

    return { outliers: 3, total_usd: 42_000 };
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
