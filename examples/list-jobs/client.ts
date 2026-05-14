/**
 * list-jobs — client.
 *
 * Submits three slow-task jobs, then exercises `session.list_jobs`
 * with a status filter and pagination (limit=2 followed by a
 * follow-up page via `next_cursor`). Cleans up by cancelling all
 * three before exit.
 */

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7887/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "list-jobs-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);
  process.stdout.write(
    `negotiated features: ${client.negotiatedFeatures.join(", ")}\n`,
  );

  // Submit three slow tasks in parallel; each stays running.
  const handles = await Promise.all([
    client.submit({ agent: "slow-task", input: { label: "alpha" } }),
    client.submit({ agent: "slow-task", input: { label: "beta" } }),
    client.submit({ agent: "slow-task", input: { label: "gamma" } }),
  ]);
  for (const h of handles) {
    process.stdout.write(`submitted job_id=${h.jobId}\n`);
  }

  // Give the runtime a brief moment to flip them to "running".
  await sleep(150);

  // Page 1: filter by status=running, limit 2.
  const page1 = await client.listJobs({ status: ["running"] }, { limit: 2 });
  process.stdout.write(
    `page 1: ${page1.jobs.length} jobs, next_cursor=${page1.nextCursor ?? "null"}\n`,
  );
  for (const j of page1.jobs) {
    process.stdout.write(
      `  job_id=${j.job_id} agent=${j.agent} status=${j.status} last_event_seq=${j.last_event_seq}\n`,
    );
  }

  // Page 2: pass the cursor through.
  if (page1.nextCursor !== null) {
    const page2 = await client.listJobs(
      { status: ["running"] },
      { limit: 2, cursor: page1.nextCursor },
    );
    process.stdout.write(
      `page 2: ${page2.jobs.length} jobs, next_cursor=${page2.nextCursor ?? "null"}\n`,
    );
    for (const j of page2.jobs) {
      process.stdout.write(
        `  job_id=${j.job_id} agent=${j.agent} status=${j.status} last_event_seq=${j.last_event_seq}\n`,
      );
    }
  }

  // Clean up — cancel every job we submitted.
  for (const h of handles) {
    await client.cancelJob(h.jobId, { reason: "demo cleanup" });
  }
  // Wait for them to terminate.
  await Promise.allSettled(handles.map((h) => h.done));

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
