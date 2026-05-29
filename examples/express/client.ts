/**
 * Express example — client.
 *
 * Hits the HTTP `/health` route and then submits an ARCP job to the same
 * server, to demonstrate the two co-exist on one port.
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env["ARCP_DEMO_PORT"] ?? 7896);
const URL = process.env["ARCP_DEMO_URL"] ?? `ws://127.0.0.1:${PORT}/arcp`;
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  // HTTP first — same port.
  const httpRes = await fetch(`http://127.0.0.1:${PORT}/health`);
  const healthBody = (await httpRes.json()) as { status: string; arcp: string };
  process.stdout.write(
    `GET /health → ${httpRes.status} ${JSON.stringify(healthBody)}\n`,
  );

  // ARCP next — same port.
  const client = new ARCPClient({
    client: { name: "express-demo-client", version: "1.0.0" },
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
    input: { msg: "hello over express" },
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
