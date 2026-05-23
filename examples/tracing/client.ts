/**
 * Tracing example — client.
 *
 * Wires `@agentruntimecontrolprotocol/middleware-otel` into the client transport so spans on
 * the submit path link end-to-end with the server's spans via W3C trace
 * context carried in `extensions["x-vendor.opentelemetry.tracecontext"]`.
 *
 * Run after `server.ts`:
 *   pnpm tsx examples/tracing/client.ts
 */

import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { ARCPClient, type Envelope, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";
import { withTracing } from "@agentruntimecontrolprotocol/middleware-otel";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7895/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: "arcp-tracing-demo-client",
    }),
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  });
  provider.register();
  const tracer = trace.getTracer("arcp-tracing-demo-client");

  const client = new ARCPClient({
    client: { name: "tracing-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  client.on("job.accepted", (env) => {
    if (env.type !== "job.accepted") return;
    const tag = env.payload.parent_job_id !== undefined ? "CHILD " : "PARENT";
    process.stdout.write(
      `${tag} accepted job=${env.payload.job_id} trace_id=${env.payload.trace_id ?? "<none>"}\n`,
    );
  });

  client.on("job.event", (env: Envelope) => {
    if (env.type !== "job.event") return;
    process.stdout.write(
      `event[seq=${env.event_seq}] job=${env.job_id} ` +
        `trace_id=${env.trace_id ?? "<none>"} kind=${env.payload.kind}\n`,
    );
  });

  const raw = await WebSocketTransport.connect(URL);
  const transport = withTracing(raw, { tracer });
  await client.connect(transport);

  const handle = await client.submit({
    agent: "parent",
    input: { item: "widget-42" },
    lease: { "agent.delegate": ["child"] },
  });

  const parentResult = await handle.done;
  process.stdout.write(`parent result: ${JSON.stringify(parentResult)}\n`);

  // Let trailing child events flush before close.
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  await client.close();
  await provider.shutdown();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
