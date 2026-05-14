/**
 * graceful lease violation
 *
 * The agent is granted a narrow lease and attempts a tool call that
 * falls outside its scope. The runtime's `validateLeaseOp` helper
 * throws a `PermissionDeniedError` against the lease; the agent
 * surfaces this to the parent via a `tool_result` event carrying the
 * error and continues. The job ultimately succeeds — lease violations
 * are *not* session-fatal.
 *
 * The mechanics:
 *
 *   - The runtime grants the lease in `job.accepted.payload.lease`,
 *     which is also exposed on the agent's `ctx.lease`.
 *   - Patterns use `*` (single segment) and `**` (zero+ segments)
 *     against canonicalized targets.
 *   - Lease check fails ⇒ `PermissionDeniedError` (code
 *     `PERMISSION_DENIED`, retryable=false).
 *   - The agent reports the failure as a `tool_result` event
 *     with `body.error`, then carries on.
 *
 * Run:  pnpm tsx examples/lease-violation.ts
 */

import {
  ARCPClient,
  ARCPServer,
  PermissionDeniedError,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
  validateLeaseOp,
} from "@arcp/sdk";

const TOKEN = "tok-demo";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "demo-runtime", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["code-refactor"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    logger: silentLogger,
  });

  // The agent attempts two reads. The first is inside the granted
  // lease and "succeeds"; the second is outside the lease, so the
  // runtime's `validateLeaseOp` throws `PermissionDeniedError`. The
  // agent catches it, emits a `tool_result` with the error body, logs
  // a warning, and continues.
  server.registerAgent("code-refactor", async (_input, ctx) => {
    async function tryRead(path: string, callId: string): Promise<void> {
      await ctx.toolCall({
        tool: "fs.read",
        args: { path },
        call_id: callId,
      });
      try {
        // Validate the operation against the lease BEFORE executing.
        validateLeaseOp(ctx.lease, "fs.read", path);
        // … in a real agent this is where the actual fs.read happens.
        await ctx.toolResult({
          call_id: callId,
          result: { path, bytes: 1024 },
        });
      } catch (err) {
        if (err instanceof PermissionDeniedError) {
          // Surface as a tool_result with the error body, not a
          // session-level error. Job continues.
          await ctx.toolResult({
            call_id: callId,
            error: err.toPayload(),
          });
          await ctx.log("warn", `Skipping unauthorized read: ${path}`);
          return;
        }
        throw err;
      }
    }

    await tryRead("/workspace/myapp/src/auth/handler.ts", "c1"); // Allowed
    await tryRead("/etc/passwd", "c2"); // Denied
    return { reviewed: ["/workspace/myapp/src/auth/handler.ts"] };
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
  await client.connect(c);

  // Track every job_event so we can prove both reads happened and the
  // bad one carried a PERMISSION_DENIED tool_result.
  const observed: Array<{ kind: string; body: unknown }> = [];
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    observed.push({ kind: env.payload.kind, body: env.payload.body });
    process.stdout.write(
      `event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });

  // Client submits with a lease that only authorizes reads
  // under `/workspace/myapp/src/**`.
  const handle = await client.submit({
    agent: "code-refactor",
    lease: {
      "fs.read": ["/workspace/myapp/src/**"],
      "fs.write": ["/workspace/myapp/src/**"],
    },
  });
  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);

  // Verify the bad call produced a tool_result with PERMISSION_DENIED.
  const denied = observed.find(
    (e) =>
      e.kind === "tool_result" &&
      typeof e.body === "object" &&
      e.body !== null &&
      (e.body as { error?: { code?: string } }).error?.code ===
        "PERMISSION_DENIED",
  );
  if (denied === undefined) {
    throw new Error("expected a PERMISSION_DENIED tool_result");
  }
  process.stdout.write(`saw PERMISSION_DENIED tool_result: yes\n`);
  process.stdout.write(
    `job completed despite violation: ${result.final_status}\n`,
  );

  await client.close();
  await server.close();
}

void main().catch((err) => {
  process.stderr.write(
    `example failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
