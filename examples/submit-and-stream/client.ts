/**
 * submit-and-stream — client.
 *
 * Connects, submits a single job, prints every job.event as it arrives,
 * then prints the terminal job.result.
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env["ARCP_DEMO_URL"] ?? "ws://127.0.0.1:7879/arcp";
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "submit-and-stream-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    process.stdout.write(
      `event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });

  const transport = await WebSocketTransport.connect(URL);
  const welcome = await client.connect(transport);
  process.stdout.write(
    `welcome: session=${client.state.id} runtime=${welcome.runtime.name}\n`,
  );

  const handle = await client.submit({
    agent: "data-analyzer",
    input: { dataset: "s3://example/sales.csv" },
    lease: { "net.fetch": ["s3://example/**"] },
    idempotencyKey: "sales-q1-analysis",
  });
  process.stdout.write(`accepted: job_id=${handle.jobId}\n`);

  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
