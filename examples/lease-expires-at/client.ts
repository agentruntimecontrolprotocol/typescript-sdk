/**
 * lease-expires-at — client.
 *
 * Submits a long-indexer job whose lease carries
 * `expires_at = now + 5 s`. The agent's per-tick lease check starts
 * succeeding and then trips `LEASE_EXPIRED` once the deadline
 * passes; the runtime watchdog emits the terminal `job.error` with
 * code `LEASE_EXPIRED`.
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env["ARCP_DEMO_URL"] ?? "ws://127.0.0.1:7890/arcp";
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "lease-expires-at-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    const kind = env.payload.kind;
    if (kind === "tool_result") {
      const body = env.payload.body as {
        call_id: string;
        result?: unknown;
        error?: { code: string; message: string };
      };
      if (body.error !== undefined) {
        process.stdout.write(
          `tool_result error[seq=${env.event_seq}] call_id=${body.call_id} code=${body.error.code} message="${body.error.message}"\n`,
        );
      } else {
        process.stdout.write(
          `tool_result ok[seq=${env.event_seq}] call_id=${body.call_id} ${JSON.stringify(body.result)}\n`,
        );
      }
    } else if (kind === "tool_call") {
      const body = env.payload.body as { tool: string; call_id: string };
      process.stdout.write(
        `tool_call[seq=${env.event_seq}] ${body.tool} call_id=${body.call_id}\n`,
      );
    }
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const expiresAt = new Date(Date.now() + 5000).toISOString();
  process.stdout.write(`submitting with expires_at=${expiresAt}\n`);

  try {
    const handle = await client.submit({
      agent: "long-indexer",
      input: { tickMs: 1000, ticks: 30 },
      lease: { "fs.read": ["/workspace/index/**"] },
      leaseConstraints: { expires_at: expiresAt },
    });
    process.stdout.write(`accepted job_id=${handle.jobId}\n`);
    await handle.done;
    throw new Error("expected LEASE_EXPIRED from job");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "LEASE_EXPIRED") {
      process.stdout.write(`job.error code=${e.code} message="${e.message}"\n`);
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
