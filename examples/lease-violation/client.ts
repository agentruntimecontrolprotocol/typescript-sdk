/**
 * lease-violation — client.
 *
 * Submits a "code-refactor" job with a narrow lease, watches the
 * tool_call/tool_result stream, and asserts that one tool_result
 * carries a PERMISSION_DENIED error and the job still finishes
 * successfully.
 */

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7882/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "lease-violation-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });
  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const observed: { kind: string; body: unknown }[] = [];
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    observed.push({ kind: env.payload.kind, body: env.payload.body });
    process.stdout.write(
      `event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });

  const handle = await client.submit({
    agent: "code-refactor",
    lease: {
      "fs.read": ["/workspace/myapp/src/**"],
      "fs.write": ["/workspace/myapp/src/**"],
    },
  });
  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);

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
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
