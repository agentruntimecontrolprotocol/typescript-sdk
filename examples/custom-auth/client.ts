/**
 * custom-auth — client.
 *
 * Mints a stateless signed token, sends it as the `bearer` credential, and
 * runs one echo job through the server.
 */

import { createHmac } from "node:crypto";

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env["ARCP_DEMO_URL"] ?? "ws://127.0.0.1:7894/arcp";
const SECRET = process.env["ARCP_DEMO_SECRET"] ?? "demo-secret";

function mintToken(principal: string, ttlSec = 60): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${principal}.${exp}`;
  const sig = createHmac("sha256", SECRET).update(body).digest("hex");
  return `${body}.${sig}`;
}

async function main(): Promise<void> {
  const token = mintToken("alice");
  process.stdout.write(
    `minted token for principal=alice (truncated ${token.slice(0, 24)}...)\n`,
  );

  const client = new ARCPClient({
    client: { name: "custom-auth-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token,
  });

  const transport = await WebSocketTransport.connect(URL);
  const welcome = await client.connect(transport);
  process.stdout.write(
    `welcome: session=${client.state.id} runtime=${welcome.runtime.name}\n`,
  );

  const handle = await client.submit({
    agent: "echo",
    input: { hello: "world" },
  });
  process.stdout.write(`accepted: job_id=${handle.jobId}\n`);

  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);

  await client.close();

  // Demo: an invalid token is rejected during handshake.
  const badClient = new ARCPClient({
    client: { name: "custom-auth-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: "alice.0.deadbeef",
  });
  const badTransport = await WebSocketTransport.connect(URL);
  try {
    await badClient.connect(badTransport);
    process.stderr.write("expected bad token to be rejected\n");
    process.exit(1);
  } catch (err) {
    process.stdout.write(
      `bad token rejected as expected: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  } finally {
    await badClient.close().catch(() => undefined);
  }
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
