/**
 * submit-and-stream
 *
 * The minimum useful ARCP v1.0 flow:
 *
 *   1. The client opens a session via `session.hello`.
 *   2. The runtime accepts with `session.welcome` carrying a fresh
 *      `resume_token` and `resume_window_sec`.
 *   3. The client submits a one-shot job via `job.submit`.
 *   4. The runtime emits `job.accepted`, then a stream of `job.event`
 *      payloads, and finishes with a terminal `job.result`.
 *
 * The agent here ("data-analyzer") simulates a small data analysis: it
 * emits a `status`, a `log`, a `thought`, a `metric`, and an
 * `artifact_ref`, then returns. The client subscribes to every event,
 * prints them as they arrive, and exits when the terminal `job.result`
 * is observed.
 *
 * Run:  pnpm tsx examples/submit-and-stream.ts
 */

import {
  ARCPClient,
  ARCPServer,
  type JobEventPayload,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "@arcp/sdk";

const TOKEN = "tok-demo";

async function main(): Promise<void> {
  // The runtime needs a bearer verifier to authenticate hello.
  const bearer = new StaticBearerVerifier(
    new Map([[TOKEN, { principal: "demo-user" }]]),
  );

  const server = new ARCPServer({
    runtime: { name: "demo-runtime", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["data-analyzer"] },
    bearer,
    logger: silentLogger,
  });

  // Agents are registered by name; handlers receive `(input, ctx)`.
  // The `ctx` object exposes the eight reserved event kinds as typed
  // helpers (log, thought, tool_call, tool_result, status, metric,
  // artifact_ref, delegate).
  server.registerAgent("data-analyzer", async (input, ctx) => {
    const opts = (input ?? {}) as { dataset?: string };
    await ctx.status("fetching");
    await ctx.log("info", "12,408 rows loaded", { dataset: opts.dataset });
    await ctx.thought("Outlier in column 'revenue' row 4421");
    await ctx.metric({ name: "rows", value: 12_408, unit: "row" });
    await ctx.artifactRef({
      uri: `arcp://artifacts/${ctx.sessionId}/${ctx.jobId}/report.html`,
      content_type: "text/html",
      byte_size: 38_291,
    });
    return { outliers: 3, total_usd: 42_000 };
  });

  // Paired in-memory transports drive a runtime + client in-process.
  const [clientSide, serverSide] = pairMemoryTransports();
  server.accept(serverSide);

  const client = new ARCPClient({
    client: { name: "demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
    logger: silentLogger,
  });

  // Connect() drives session.hello → session.welcome.
  const welcome = await client.connect(clientSide);
  process.stdout.write(
    `welcome: session=${client.state.id} runtime=${welcome.runtime.name}\n`,
  );
  process.stdout.write(`resume window: ${welcome.resume_window_sec}s\n`);

  // Collect events as the runtime emits them.
  const events: JobEventPayload[] = [];
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    events.push(env.payload);
    process.stdout.write(
      `event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });

  // Client submits a one-shot job with a small lease.
  const handle = await client.submit({
    agent: "data-analyzer",
    input: { dataset: "s3://example/sales.csv" },
    // Lease_request: capability → list of glob patterns.
    lease: { "net.fetch": ["s3://example/**"] },
    idempotencyKey: "sales-q1-analysis",
  });
  process.stdout.write(`accepted: job_id=${handle.jobId}\n`);

  // `handle.done` resolves with the terminal job.result payload.
  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);
  process.stdout.write(`total events observed: ${events.length}\n`);

  // Clean close via session.bye.
  await client.close();
  await server.close();
}

void main().catch((err) => {
  process.stderr.write(
    `example failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
