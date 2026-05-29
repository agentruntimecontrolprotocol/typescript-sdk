/**
 * result-chunk — client.
 *
 * Submits the report-builder, counts incoming `result_chunk` events,
 * awaits the terminal `job.result`, then assembles the full payload
 * via `handle.collectChunks()`.
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env["ARCP_DEMO_URL"] ?? "ws://127.0.0.1:7893/arcp";
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "result-chunk-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  let chunkCount = 0;
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    if (env.payload.kind !== "result_chunk") return;
    chunkCount += 1;
    const body = env.payload.body as {
      result_id: string;
      chunk_seq: number;
      more: boolean;
    };
    if (chunkCount === 1) {
      process.stdout.write(
        `first chunk: result_id=${body.result_id} chunk_seq=${body.chunk_seq}\n`,
      );
    }
    if (!body.more) {
      process.stdout.write(
        `final chunk: chunk_seq=${body.chunk_seq} more=false\n`,
      );
    }
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const handle = await client.submit({
    agent: "report-builder",
    input: { chunks: 30 },
  });
  process.stdout.write(`accepted job_id=${handle.jobId}\n`);

  const result = await handle.done;
  process.stdout.write(
    `job.result: result_id=${result.result_id} result_size=${result.result_size} summary="${result.summary}"\n`,
  );

  const assembled = await handle.collectChunks();
  const len =
    typeof assembled === "string" ? assembled.length : assembled.byteLength;
  process.stdout.write(
    `assembled: ${chunkCount} chunks, ${len} bytes (matches result_size=${len === (result.result_size ?? -1)})\n`,
  );

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
