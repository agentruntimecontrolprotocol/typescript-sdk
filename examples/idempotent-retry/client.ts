/**
 * idempotent-retry — client.
 *
 * Submits three jobs against the same runtime:
 *
 *   1. With idempotency_key K, agent "weekly-report" — accepted.
 *   2. Same K and same (agent, input) — runtime returns the SAME job_id.
 *   3. Same K, different agent — runtime rejects with DUPLICATE_KEY.
 *
 * Idempotency is keyed by (principal, idempotency_key) and persists for
 * ~24 h in the default runtime configuration.
 */

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7881/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "idempotent-retry-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });
  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);
  process.stdout.write(`session: ${client.state.id}\n`);

  const KEY = "weekly-report-2026-W19";

  const h1 = await client.submit({
    agent: "weekly-report",
    input: { week: "2026-W19" },
    idempotencyKey: KEY,
  });
  process.stdout.write(`submit #1 accepted: job_id=${h1.jobId}\n`);
  await h1.done;
  process.stdout.write(`submit #1 result: success\n`);

  const h2 = await client.submit({
    agent: "weekly-report",
    input: { week: "2026-W19" },
    idempotencyKey: KEY,
  });
  process.stdout.write(`submit #2 accepted: job_id=${h2.jobId}\n`);
  if (h2.jobId !== h1.jobId) {
    throw new Error(
      `idempotency violation: submit #2 returned different job_id (${h2.jobId} != ${h1.jobId})`,
    );
  }
  process.stdout.write(`same job_id returned: yes\n`);

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
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
