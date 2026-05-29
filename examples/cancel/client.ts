/**
 * cancel — client.
 *
 * Submits a long-running "slow-walk" job, lets a few events arrive,
 * then sends `job.cancel`. The runtime aborts the job's cancellation
 * signal; the agent observes it and exits, producing a terminal
 * `job.error` with `final_status: "cancelled"` and `code: "CANCELLED"`.
 *
 * `handle.done` rejects with that error.
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env["ARCP_DEMO_URL"] ?? "ws://127.0.0.1:7883/arcp";
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "cancel-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  let observed = 0;
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    observed += 1;
    process.stdout.write(
      `event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const handle = await client.submit({
    agent: "slow-walk",
    input: { steps: 60, tickMs: 100 },
  });
  process.stdout.write(`accepted: job_id=${handle.jobId}\n`);

  // Let a few events flow before we cancel.
  await sleep(350);
  process.stdout.write(`sending job.cancel reason="user wants to stop"\n`);
  await client.cancelJob(handle.jobId, { reason: "user wants to stop" });

  try {
    await handle.done;
    throw new Error("expected job.error from cancellation");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "CANCELLED") {
      process.stdout.write(
        `cancelled cleanly: code=${e.code} message=${e.message}\n`,
      );
    } else {
      throw err;
    }
  }
  process.stdout.write(`events observed before cancel: ${observed}\n`);

  await client.close();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
