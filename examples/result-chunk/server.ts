/**
 * result-chunk — server.
 *
 * Hosts a `report-builder` agent that streams a large textual report
 * via `ctx.streamResult()`. Each chunk is a numbered paragraph; the
 * agent calls `finalize()` to emit the terminating `job.result` with
 * `result_id` and `result_size`.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7893);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "result-chunk-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["report-builder"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("report-builder", async (input, ctx) => {
    const opts = (input ?? {}) as { chunks?: number };
    const total = opts.chunks ?? 30;

    const stream = ctx.streamResult();
    let bytes = 0;
    for (let i = 1; i < total; i++) {
      const para = `Section ${i}: ${"lorem ipsum dolor sit amet ".repeat(8)}\n`;
      bytes += Buffer.byteLength(para, "utf8");
      await stream.write(para);
    }
    const last = `Section ${total}: final paragraph.\n`;
    bytes += Buffer.byteLength(last, "utf8");
    await stream.finalize(last, {
      summary: `report with ${total} chunks`,
      resultSize: bytes,
    });
    // After finalize the runtime emits job.result automatically; the
    // returned value here is ignored because chunkedResultStarted is
    // already true.
    return undefined;
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
