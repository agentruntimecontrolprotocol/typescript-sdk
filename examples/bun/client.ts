/**
 * Bun example — client.
 *
 * Connects to the Bun-hosted ARCP runtime over WebSocket. Runs under
 * either Node (`pnpm tsx`) or Bun (`bun run`) — the wire protocol is
 * runtime-agnostic.
 */

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7898);
const URL = process.env.ARCP_DEMO_URL ?? `ws://127.0.0.1:${PORT}/arcp`;
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "bun-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    process.stdout.write(
      `event[seq=${env.event_seq}] ${env.payload.kind} ` +
        `${JSON.stringify(env.payload.body)}\n`,
    );
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const handle = await client.submit({
    agent: "echo",
    input: { msg: "hello from a client" },
  });
  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
