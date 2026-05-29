/**
 * ack-backpressure — client.
 *
 * Submits a job that emits ~2000 metric events. The client uses
 * `autoAck: { intervalMs: 5000, minSeqDelta: 100000 }` — an
 * intentionally slow ack cadence — so the runtime sees the consumer
 * fall behind and emits a `status { phase: "back_pressure" }` event.
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env["ARCP_DEMO_URL"] ?? "ws://127.0.0.1:7886/arcp";
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "ack-backpressure-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
    // Auto-ack, but on a cadence too slow to keep up.
    autoAck: { intervalMs: 5000, minSeqDelta: 100_000 },
  });

  let metricCount = 0;
  let backPressure = false;
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    const kind = env.payload.kind;
    if (kind === "metric") {
      metricCount += 1;
    } else if (kind === "status") {
      const body = env.payload.body as { phase: string; message?: string };
      process.stdout.write(
        `status[seq=${env.event_seq}] phase=${body.phase}` +
          (body.message !== undefined ? ` message="${body.message}"` : "") +
          "\n",
      );
      if (body.phase === "back_pressure") {
        backPressure = true;
        process.stdout.write("back-pressure observed\n");
      }
    }
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);
  process.stdout.write(
    `negotiated features: ${client.negotiatedFeatures.join(", ")}\n`,
  );

  const handle = await client.submit({
    agent: "chatty",
    input: { count: 2000 },
  });
  process.stdout.write(`submitted job_id=${handle.jobId}\n`);

  const result = await handle.done;
  process.stdout.write(
    `result: ${JSON.stringify(result.result)} metrics-observed=${metricCount} back_pressure=${backPressure}\n`,
  );

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!backPressure) {
    throw new Error("expected a back_pressure status event");
  }

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
