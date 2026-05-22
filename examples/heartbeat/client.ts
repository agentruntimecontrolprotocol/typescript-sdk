/**
 * heartbeat — client.
 *
 * Connects to the heartbeat-demo runtime and observes `session.ping`
 * arrivals (the SDK's client auto-responds with `session.pong`; this
 * demo just prints the round-trips). Stays connected for ~12 s — long
 * enough to see two pings at the 5 s cadence — then exits cleanly.
 */

import {
  ARCPClient,
  type FrameHandler,
  WebSocketTransport,
  type WireFrame,
} from "@agentruntimecontrolprotocol/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7885/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

// Helper: count inbound `session.ping` frames as the client receives them.
// (The client's built-in handler auto-responds before any user `on()` runs,
// so we observe pings at the transport layer.)
let pings = 0;
function instrument(transport: WebSocketTransport): void {
  const orig = transport.onFrame.bind(transport);
  transport.onFrame = (handler: FrameHandler): void => {
    orig((frame: WireFrame) => {
      if (
        typeof frame === "object" &&
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        frame !== null &&
        "type" in frame &&
        (frame as { type?: unknown }).type === "session.ping"
      ) {
        pings += 1;
        const nonce =
          (frame as { payload?: { nonce?: string } }).payload?.nonce ?? "";
        process.stdout.write(
          `received ping #${pings} nonce=${nonce.slice(0, 8)}\n`,
        );
      }
      return handler(frame);
    });
  };
}

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "heartbeat-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  const transport = await WebSocketTransport.connect(URL);
  instrument(transport);
  const welcome = await client.connect(transport);
  process.stdout.write(
    `connected: heartbeat_interval_sec=${welcome.heartbeat_interval_sec ?? "<none>"}\n`,
  );
  process.stdout.write(
    `negotiated features: ${client.negotiatedFeatures.join(", ")}\n`,
  );

  // Sanity round-trip — submit one job to prove the connection works.
  const handle = await client.submit({
    agent: "echo",
    input: { hello: "ping" },
  });
  const result = await handle.done;
  process.stdout.write(`echo result: ${JSON.stringify(result.result)}\n`);

  // Stay connected ~12 s to observe at least two pings.
  await sleep(12_000);
  process.stdout.write(`total pings observed: ${pings}\n`);

  await client.close();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
