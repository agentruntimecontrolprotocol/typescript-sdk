/**
 * vendor-extensions — client.
 *
 * Receives a stream that interleaves the standard reserved kinds with
 * `x-vendor.acme.progress` vendor events. Shows two receiver behaviours that
 * are both valid per the spec:
 *
 *   - The naïve receiver only knows reserved kinds; everything else
 *     is logged at debug and skipped.
 *   - The acme-aware receiver renders `x-vendor.acme.progress` as a live
 *     percent bar.
 *
 * Both run in parallel against the same envelope stream.
 */

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7884/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

const RESERVED_KINDS = new Set([
  "status",
  "log",
  "thought",
  "metric",
  "tool_call",
  "tool_result",
  "artifact_ref",
  "delegate",
]);

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "vendor-extensions-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  let naiveSkipped = 0;
  let acmeRendered = 0;

  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    const kind = env.payload.kind;

    // Naïve handler: process reserved kinds, skip everything else.
    if (RESERVED_KINDS.has(kind)) {
      process.stdout.write(
        `[naive] event[seq=${env.event_seq}] ${kind} ${JSON.stringify(env.payload.body)}\n`,
      );
    } else {
      naiveSkipped += 1;
      process.stdout.write(
        `[naive] event[seq=${env.event_seq}] unknown kind "${kind}" — ignoring\n`,
      );
    }

    // Acme-aware handler: render x-vendor.acme.progress specifically.
    if (kind === "x-vendor.acme.progress") {
      // Vendor-aware path: we understand this kind specifically.
      const body = env.payload.body as { percent: number; eta_seconds: number };
      const bar = "#".repeat(Math.round(body.percent / 5)).padEnd(20, ".");
      process.stdout.write(
        `[acme]  [${bar}] ${body.percent}% (eta ${body.eta_seconds}s)\n`,
      );
      acmeRendered += 1;
    }
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const handle = await client.submit({
    agent: "render-job",
    input: { frames: 4 },
    lease: {
      "net.fetch": ["https://assets.example.com/**"],
      // Vendor capability namespace — opaque to the runtime, but a
      // policy-aware deployment could enforce it.
      "x-vendor.acme.metrics": ["acme:render/*"],
    },
  });
  process.stdout.write(`accepted: job_id=${handle.jobId}\n`);

  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);
  process.stdout.write(
    `summary: acme events rendered=${acmeRendered}, naive skipped=${naiveSkipped}\n`,
  );
  if (acmeRendered === 0) throw new Error("expected vendor events");
  if (naiveSkipped === 0) {
    throw new Error("expected the naive handler to skip at least one event");
  }

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
