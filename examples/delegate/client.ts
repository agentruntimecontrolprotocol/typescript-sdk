/**
 * Delegation example — client.
 *
 * Connects to the delegate-demo runtime (`examples/delegate/server.ts`)
 * over WebSocket, submits a `build` job, and prints the interleaved
 * parent + child event stream from the session's single seq space.
 *
 * The runtime stamps every outbound event with a strictly monotonic
 * `event_seq` (one counter per session), regardless of which job
 * emitted it. The child job inherits the parent's `trace_id`, which
 * this client verifies and prints.
 *
 * Start the server first:
 *   pnpm tsx examples/delegate/server.ts
 *
 * Then run:
 *   pnpm tsx examples/delegate/client.ts
 */

import { ARCPClient, type Envelope, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7878/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "delegate-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  // Collect every accepted job so we can confirm the parent/child link.
  const accepted = new Map<string, Envelope>();
  client.on("job.accepted", (env) => {
    if (env.type !== "job.accepted") return;
    accepted.set(env.payload.job_id, env);
    const tag = env.payload.parent_job_id !== undefined ? "CHILD" : "PARENT";
    process.stdout.write(
      `${tag} accepted ${env.payload.job_id}` +
        (env.payload.parent_job_id !== undefined
          ? ` (parent=${env.payload.parent_job_id}, delegate_id=${env.payload.delegate_id})`
          : "") +
        "\n",
    );
  });
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    process.stdout.write(
      `event[seq=${env.event_seq}] job=${env.job_id} ${env.payload.kind} ` +
        `${JSON.stringify(env.payload.body)}\n`,
    );
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const handle = await client.submit({
    agent: "build",
    input: { project: "myapp" },
    lease: {
      "fs.read": ["/workspace/myapp/**"],
      "fs.write": [
        "/workspace/myapp/src/**",
        "/workspace/myapp/test-output/**",
      ],
      "agent.delegate": ["test"],
    },
  });
  const parentTraceId = handle.traceId;
  process.stdout.write(`parent trace_id=${parentTraceId ?? "<none>"}\n`);

  const parentResult = await handle.done;
  process.stdout.write(`parent result: ${JSON.stringify(parentResult)}\n`);

  // Allow a tick for any trailing child events to land before close.
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  // Verify the child inherited the parent's trace_id.
  const child = [...accepted.values()].find(
    (env) =>
      env.type === "job.accepted" && env.payload.parent_job_id !== undefined,
  );
  if (child?.type === "job.accepted") {
    const childTrace = child.payload.trace_id;
    process.stdout.write(
      `trace inheritance: parent=${parentTraceId} child=${childTrace} ` +
        `match=${parentTraceId !== undefined && childTrace === parentTraceId}\n`,
    );
  }

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
