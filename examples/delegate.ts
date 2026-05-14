/**
 * delegation
 *
 * A "code-refactor" parent agent performs some work and then delegates
 * a child "test-runner" job. Delegation in ARCP v1.0 is *not* a
 * separate envelope; it is a `job.event` of kind `"delegate"` emitted
 * on the parent's stream. The runtime intercepts that event,
 * spawns a child job, and the child's accept/events/result envelopes
 * flow through the *same* session — interleaved by `event_seq`.
 *
 * Two important invariants demonstrated here:
 *
 *   - / the child's `lease_request` MUST be a subset of the
 *     parent's effective lease. If it isn't, the runtime emits a
 *     `tool_result` on the parent with code `LEASE_SUBSET_VIOLATION`.
 *   - The child inherits the parent's `trace_id` so OTel spans
 *     stitch into the same trace tree.
 *
 * Run:  pnpm tsx examples/delegate.ts
 */

import {
  ARCPClient,
  ARCPServer,
  type Envelope,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "@arcp/sdk";

const TOKEN = "tok-demo";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "demo-runtime", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["code-refactor", "test-runner"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    logger: silentLogger,
  });

  // Parent agent does some "work", then delegates a child.
  server.registerAgent("code-refactor", async (_input, ctx) => {
    await ctx.status("analyzing");
    await ctx.toolCall({
      tool: "fs.read",
      args: { path: "/workspace/myapp/src/auth/index.ts" },
      call_id: "c1",
    });
    await ctx.toolResult({ call_id: "c1", result: { bytes: 1024 } });

    // Delegation as a job.event kind "delegate". The runtime
    // sees this event, spawns the child, and emits `job.accepted` for
    // the child with `parent_job_id = ctx.jobId` and `delegate_id`.
    await ctx.delegate({
      delegate_id: "del_T1",
      agent: "test-runner",
      input: { suite: "auth" },
      lease_request: {
        // Child lease is a SUBSET of parent: read same workspace,
        // write into a different subdir.
        "fs.read": ["/workspace/myapp/**"],
        "fs.write": ["/workspace/myapp/test-output/**"],
      },
    });

    // Give the child a beat to complete its async work before we
    // resolve the parent. In production agents would await the
    // delegated result via the event stream or via a promise the
    // runtime exposes; for clarity we use a small sleep.
    await new Promise<void>((r) => setTimeout(r, 50));

    await ctx.status("completing");
    return { tests_passed: true };
  });

  // The child agent simulates running a small test suite.
  server.registerAgent("test-runner", async (input, ctx) => {
    const opts = input as { suite?: string };
    await ctx.status("running");
    await ctx.log("info", `127/127 ${opts.suite ?? "?"} passed`);
    return { passed: 127, failed: 0 };
  });

  const [c, s] = pairMemoryTransports();
  server.accept(s);

  const client = new ARCPClient({
    client: { name: "demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
    logger: silentLogger,
  });

  // Collect every accepted job + event so we can print the interleaved
  // stream from the session's single seq-space.
  const acceptedJobs = new Map<string, Envelope>();
  client.on("job.accepted", (env) => {
    if (env.type !== "job.accepted") return;
    acceptedJobs.set(env.payload.job_id, env);
    const tag = env.payload.parent_job_id !== undefined ? "CHILD" : "PARENT";
    process.stdout.write(
      `${tag} accepted ${env.payload.job_id}` +
        (env.payload.parent_job_id !== undefined
          ? ` (parent=${env.payload.parent_job_id}, delegate_id=${env.payload.delegate_id})`
          : "") +
        `\n`,
    );
  });
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    process.stdout.write(
      `event[seq=${env.event_seq}] job=${env.job_id} ${env.payload.kind} ` +
        `${JSON.stringify(env.payload.body)}\n`,
    );
  });

  await client.connect(c);

  // Parent submits with a lease that authorizes delegation.
  const handle = await client.submit({
    agent: "code-refactor",
    lease: {
      "fs.read": ["/workspace/myapp/**"],
      "fs.write": [
        "/workspace/myapp/src/auth/**",
        "/workspace/myapp/test-output/**",
      ],
      "agent.delegate": ["test-runner"],
    },
  });
  const parentTraceId = handle.traceId;
  process.stdout.write(`parent trace_id=${parentTraceId ?? "<none>"}\n`);

  const result = await handle.done;
  process.stdout.write(`parent result: ${JSON.stringify(result)}\n`);

  // Allow a tick for any trailing child events to land before close.
  await new Promise<void>((r) => setTimeout(r, 20));

  // Verify the child inherited the parent's trace_id.
  const childAccept = [...acceptedJobs.values()].find(
    (env) =>
      env.type === "job.accepted" && env.payload.parent_job_id !== undefined,
  );
  if (childAccept !== undefined && childAccept.type === "job.accepted") {
    const childTrace = childAccept.payload.trace_id;
    process.stdout.write(
      `trace inheritance: parent=${parentTraceId} child=${childTrace} ` +
        `match=${parentTraceId !== undefined && childTrace === parentTraceId}\n`,
    );
  }

  await client.close();
  await server.close();
}

void main().catch((err) => {
  process.stderr.write(
    `example failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
