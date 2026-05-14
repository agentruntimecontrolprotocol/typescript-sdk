/**
 * idempotent retry
 *
 * Demonstrates the v1.0 idempotency contract for `job.submit`:
 *
 *   1. The first submit carries `idempotency_key`. The runtime accepts
 *      and creates a job. We pretend the response was lost in transit.
 *   2. The client retries the same agent + input + key. Per the
 *      runtime MUST return the same `job_id` and live events resume.
 *   3. A separate submit using the same key but a *different* agent
 *      MUST fail with `DUPLICATE_KEY`.
 *
 * Idempotency is keyed by `(principal, idempotency_key)` and persists
 * for ~24 hours in the default runtime configuration.
 *
 * Run:  pnpm tsx examples/idempotent-retry.ts
 */

import {
  ARCPClient,
  ARCPServer,
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
      agents: ["weekly-report", "different-agent"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    logger: silentLogger,
  });

  // The "report" agent simulates a long-running task.
  server.registerAgent("weekly-report", async (input) => {
    const opts = (input ?? {}) as { week?: string };
    return { week: opts.week ?? "?", emailed: true };
  });

  server.registerAgent("different-agent", async () => ({ unused: true }));

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
  process.stdout.write(`session: ${client.state.id}\n`);

  const KEY = "weekly-report-2026-W19";

  // Step 1: client submits with an idempotency_key. The runtime
  // accepts. In a real system, the transport might drop before
  // `job.accepted` arrives — but the runtime has already created the
  // job and cached the key.
  const h1 = await client.submit({
    agent: "weekly-report",
    input: { week: "2026-W19" },
    idempotencyKey: KEY,
  });
  process.stdout.write(`submit #1 accepted: job_id=${h1.jobId}\n`);
  await h1.done;
  process.stdout.write(`submit #1 result: success\n`);

  // Step 2: the client (or a replacement instance) retries the
  // submit with the same key, agent, and input. The runtime MUST
  // recognize the key and return the same job_id, NOT spawn a second
  // job.
  const h2 = await client.submit({
    agent: "weekly-report",
    input: { week: "2026-W19" },
    idempotencyKey: KEY,
  });
  process.stdout.write(`submit #2 accepted: job_id=${h2.jobId}\n`);
  if (h2.jobId !== h1.jobId) {
    throw new Error(
      `idempotency violation: submit #2 returned different job_id (${h2.jobId} ≠ ${h1.jobId})`,
    );
  }
  process.stdout.write(`same job_id returned: yes\n`);

  // Step 3: same key, different agent → DUPLICATE_KEY.
  try {
    await client.submit({
      agent: "different-agent",
      input: { week: "2026-W19" },
      idempotencyKey: KEY,
    });
    throw new Error("expected DUPLICATE_KEY error");
  } catch (err) {
    if (
      err instanceof Error &&
      (err as { code?: string }).code === "DUPLICATE_KEY"
    ) {
      process.stdout.write(`submit #3 rejected: DUPLICATE_KEY (correct)\n`);
    } else {
      throw err;
    }
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
