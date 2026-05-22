/**
 * subscribe — client.
 *
 * Two ARCPClient instances in the same process, both authenticated as
 * the `demo` principal.
 *
 *   Client A: submits the job. Owns it.
 *   Client B: discovers it via `session.list_jobs`, then subscribes
 *             with `history: true` so the events it missed are
 *             replayed, followed by the live tail.
 *
 * Client B also attempts to `cancelJob` to demonstrate that
 * cancellation is restricted to the submitter (the runtime returns
 * `PERMISSION_DENIED` as a `job.error`-style result, though in this
 * SDK the cancel arrives without an immediate reply — instead the
 * runtime simply ignores it from a non-owning session, per §7.4).
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7888/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  // -------- Client A (submitter) --------
  const clientA = new ARCPClient({
    client: { name: "subscribe-demo-A", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });
  await clientA.connect(await WebSocketTransport.connect(URL));
  process.stdout.write("[A] connected\n");

  const handle = await clientA.submit({
    agent: "timer",
    input: { ticks: 6, tickMs: 200 },
  });
  process.stdout.write(`[A] submitted job_id=${handle.jobId}\n`);

  // Let a few events accrue before B subscribes.
  await sleep(350);

  // -------- Client B (observer) --------
  const clientB = new ARCPClient({
    client: { name: "subscribe-demo-B", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });
  let replayedEvents = 0;
  let liveEvents = 0;
  let subscribedFrom = 0;
  clientB.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    const isReplay =
      env.event_seq !== undefined && env.event_seq <= subscribedFrom;
    if (isReplay) replayedEvents += 1;
    else liveEvents += 1;
    process.stdout.write(
      `[B] ${isReplay ? "replay" : "live"} event[seq=${env.event_seq}] ${env.payload.kind}\n`,
    );
  });
  clientB.on("job.result", (env) => {
    if (env.type !== "job.result") return;
    process.stdout.write(
      `[B] job.result[seq=${env.event_seq}] ${JSON.stringify(env.payload.result)}\n`,
    );
  });
  clientB.on("job.error", (env) => {
    if (env.type !== "job.error") return;
    process.stdout.write(
      `[B] job.error code=${env.payload.code} message="${env.payload.message}"\n`,
    );
  });
  await clientB.connect(await WebSocketTransport.connect(URL));
  process.stdout.write("[B] connected\n");

  // Discover the job via list_jobs (same principal scope).
  const listing = await clientB.listJobs({ status: ["running"] });
  process.stdout.write(
    `[B] sees ${listing.jobs.length} job(s) in the principal's scope\n`,
  );

  const sub = await clientB.subscribe(handle.jobId, { history: true });
  subscribedFrom = sub.subscribedFrom;
  process.stdout.write(
    `[B] subscribed: subscribed_from=${sub.subscribedFrom} replayed=${sub.replayed}\n`,
  );

  // Attempt to cancel from B (the non-owning session).
  try {
    await clientB.cancelJob(handle.jobId, { reason: "B tries to cancel" });
    process.stdout.write("[B] cancel sent (expecting it to be ignored)\n");
  } catch (err) {
    const e = err as { code?: string };
    process.stdout.write(`[B] cancel rejected code=${e.code}\n`);
  }

  // Wait for the job to finish from A's perspective.
  const result = await handle.done;
  process.stdout.write(
    `[A] result: ${JSON.stringify(result.result)} (cancel from B was ignored)\n`,
  );

  // Allow trailing replayed/live events on B to flush.
  await sleep(150);
  await sub.unsubscribe();
  process.stdout.write(
    `[B] totals: replayed=${replayedEvents} live=${liveEvents}\n`,
  );

  await clientA.close();
  await clientB.close();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
