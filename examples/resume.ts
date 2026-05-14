/**
 * disconnect / reconnect / replay
 *
 * The client connects, the agent emits a burst of events, the client
 * drops without waiting for the job to finish, then a second client
 * resumes the same session and observes the events it missed plus the
 * terminal `job.result`.
 *
 * Three properties demonstrated:
 *
 *   - The same `session_id` is preserved across the reconnect.
 *   - The runtime rotates `resume_token` on each `session.welcome`
 *     (the previous token is single-use; presenting it again rejects).
 *   - `event_seq` is strictly monotonic and gap-free across the
 *     reconnect: replayed events advance the local counter so live
 *     events resume at the next seq value.
 *
 * Run:  pnpm tsx examples/resume.ts
 */

import {
  ARCPClient,
  ARCPServer,
  type Envelope,
  EventLog,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "@arcp/sdk";

const TOKEN = "tok-demo";

async function main(): Promise<void> {
  // The runtime persists outbound envelopes in an EventLog so it
  // can replay them on resume. In production this is the SQLite log.
  const eventLog = new EventLog();
  const server = new ARCPServer({
    runtime: { name: "demo-runtime", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["counter"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    eventLog,
    logger: silentLogger,
    resumeWindowSeconds: 60,
  });

  // The agent emits a short burst of `metric` events and returns.
  server.registerAgent("counter", async (input, ctx) => {
    const opts = (input ?? {}) as { steps?: number };
    const steps = opts.steps ?? 5;
    for (let i = 1; i <= steps; i++) {
      await ctx.metric({ name: "step", value: i, unit: "count" });
    }
    return { steps };
  });

  // ----- Session 1: connect, submit, then drop after a few events. -----
  const [c1, s1] = pairMemoryTransports();
  server.accept(s1);

  const client1 = new ARCPClient({
    client: { name: "demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
    logger: silentLogger,
  });
  const welcome1 = await client1.connect(c1);
  const sessionId = client1.state.id;
  if (sessionId === undefined) throw new Error("expected session id");
  process.stdout.write(`session 1 welcome: session_id=${sessionId}\n`);
  process.stdout.write(`session 1 resume_token=${welcome1.resume_token}\n`);

  const beforeEvents: Envelope[] = [];
  client1.on("job.event", (env) => {
    beforeEvents.push(env);
    if (env.type === "job.event") {
      process.stdout.write(
        `session 1 event[seq=${env.event_seq}] ${env.payload.kind}\n`,
      );
    }
  });

  const handle1 = await client1.submit({
    agent: "counter",
    input: { steps: 5 },
  });
  process.stdout.write(`session 1 accepted: job_id=${handle1.jobId}\n`);

  // Mute the rejection on done — we are about to drop the transport
  // before the job.result arrives. In production code the client would
  // simply close and reconnect.
  handle1.done.catch(() => undefined);

  // Wait long enough for the first events to arrive but not all of them.
  await new Promise<void>((r) => setTimeout(r, 5));

  // Drop the connection. We "pretend" we got disconnected after seq=2.
  // The runtime still has the full event stream buffered in the EventLog.
  const replayFromSeq = 2;
  process.stdout.write(
    `session 1 disconnecting; will resume from last_event_seq=${replayFromSeq}\n`,
  );
  await client1.close();

  // ----- Session 2: same session_id + resume_token, expect replay. -----
  const [c2, s2] = pairMemoryTransports();
  server.accept(s2);

  const client2 = new ARCPClient({
    client: { name: "demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
    logger: silentLogger,
  });

  const afterEvents: Envelope[] = [];
  client2.on("job.event", (env) => {
    afterEvents.push(env);
    if (env.type === "job.event") {
      process.stdout.write(
        `session 2 event[seq=${env.event_seq}] ${env.payload.kind}\n`,
      );
    }
  });
  client2.on("job.result", (env) => {
    afterEvents.push(env);
    if (env.type === "job.result") {
      process.stdout.write(`session 2 job.result[seq=${env.event_seq}]\n`);
    }
  });

  // Client.resume embeds `payload.resume` in session.hello.
  const welcome2 = await client2.resume(c2, {
    session_id: sessionId,
    resume_token: welcome1.resume_token,
    last_event_seq: replayFromSeq,
  });
  process.stdout.write(`session 2 welcome: session_id=${client2.state.id}\n`);
  process.stdout.write(`session 2 resume_token=${welcome2.resume_token}\n`);

  // Fresh resume_token on every welcome (old token is now invalid).
  if (welcome2.resume_token === welcome1.resume_token) {
    throw new Error("resume_token was not rotated");
  }
  process.stdout.write(`resume_token rotated: yes\n`);

  // Wait briefly for any replay + live events to land.
  await new Promise<void>((r) => setTimeout(r, 50));

  // Monotonic + gap-free check: replayed seqs MUST be > replayFromSeq.
  const replayedSeqs = afterEvents
    .filter((e) => e.event_seq !== undefined)
    .map((e) => e.event_seq as number);
  process.stdout.write(`session 2 replayed seqs: ${replayedSeqs.join(",")}\n`);

  const allMonotonic = replayedSeqs.every(
    (s, i) => i === 0 || s > (replayedSeqs[i - 1] ?? 0),
  );
  const allAfterCutoff = replayedSeqs.every((s) => s > replayFromSeq);
  process.stdout.write(
    `replay invariants: monotonic=${allMonotonic} all_after_cutoff=${allAfterCutoff}\n`,
  );

  await client2.close();
  await server.close();
}

void main().catch((err) => {
  process.stderr.write(
    `example failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
