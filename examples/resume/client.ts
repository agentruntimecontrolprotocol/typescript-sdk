/**
 * resume — client.
 *
 * Drives two connections against the same runtime session:
 *
 *   1. Connect, submit, observe a few events, then close the transport.
 *   2. Open a fresh transport, call `client.resume()` with the previous
 *      session_id + resume_token + last_event_seq, and watch the
 *      runtime replay events seq > last_event_seq, then continue live.
 *
 * Asserts the resume_token rotated and the replayed seqs are strictly
 * greater than the cutoff.
 */

import { ARCPClient, type Envelope, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7880/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  // ---- Session 1: connect, submit, drop after the first few events.
  const client1 = new ARCPClient({
    client: { name: "resume-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  const seen1: Envelope[] = [];
  client1.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    seen1.push(env);
    process.stdout.write(
      `session1 event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });

  const t1 = await WebSocketTransport.connect(URL);
  const welcome1 = await client1.connect(t1);
  const sessionId = client1.state.id;
  if (sessionId === undefined) throw new Error("expected session id");
  process.stdout.write(`session1 welcome: session_id=${sessionId}\n`);
  process.stdout.write(`session1 resume_token=${welcome1.resume_token}\n`);

  const handle1 = await client1.submit({
    agent: "counter",
    input: { steps: 8 },
  });
  process.stdout.write(`session1 accepted: job_id=${handle1.jobId}\n`);
  // Let the runtime emit everything; we want the full event series in
  // the EventLog so resume has something to replay.
  await handle1.done;
  process.stdout.write(`session1 job finished; transport drop next\n`);

  // We pretend the client only saw the first two events. In reality
  // we observed all of them — but resume is parameterized by
  // `last_event_seq`, so on reconnect we will ask the runtime to
  // replay everything with seq > 2.
  const lastSeq = 2;
  process.stdout.write(
    `session1 simulated disconnect; will resume from last_event_seq=${lastSeq}\n`,
  );
  // Drop the transport WITHOUT session.bye. `client.close()` would
  // send session.bye and prevent further use of the session id.
  await t1.close("simulated disconnect");

  // ---- Session 2: resume the same session, observe the replay.
  const client2 = new ARCPClient({
    client: { name: "resume-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  const seen2: Envelope[] = [];
  client2.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    seen2.push(env);
    process.stdout.write(
      `session2 event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });
  client2.on("job.result", (env) => {
    if (env.type !== "job.result") return;
    process.stdout.write(
      `session2 job.result[seq=${env.event_seq}] ${JSON.stringify(env.payload)}\n`,
    );
  });

  const t2 = await WebSocketTransport.connect(URL);
  const welcome2 = await client2.resume(t2, {
    session_id: sessionId,
    resume_token: welcome1.resume_token,
    last_event_seq: lastSeq,
  });
  process.stdout.write(`session2 welcome: session_id=${client2.state.id}\n`);
  process.stdout.write(`session2 resume_token=${welcome2.resume_token}\n`);
  if (welcome2.resume_token === welcome1.resume_token) {
    throw new Error("resume_token was not rotated");
  }
  process.stdout.write(`resume_token rotated: yes\n`);

  // Wait for the rest of the job to play out.
  await sleep(1500);

  const replayedSeqs = seen2
    .map((e) => e.event_seq)
    .filter((s): s is number => s !== undefined);
  process.stdout.write(`session2 seqs: ${replayedSeqs.join(",")}\n`);
  const monotonic = replayedSeqs.every(
    (s, i) => i === 0 || s > (replayedSeqs[i - 1] ?? 0),
  );
  const afterCutoff = replayedSeqs.every((s) => s > lastSeq);
  process.stdout.write(
    `replay invariants: monotonic=${monotonic} all_after_cutoff=${afterCutoff}\n`,
  );

  await client2.close();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
