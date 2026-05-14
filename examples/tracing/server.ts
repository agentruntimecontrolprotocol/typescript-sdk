/**
 * Tracing example — server.
 *
 * Wires `@arcp/middleware-otel` into the runtime side so every inbound
 * frame extracts the W3C trace context from `extensions["x.otel"]` and
 * every outbound frame injects one. Spans are exported to the console
 * via `ConsoleSpanExporter` — no collector required.
 */

import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@arcp/sdk";
import { withTracing } from "@arcp/middleware-otel";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7895);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: "arcp-tracing-demo-server",
    }),
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  });
  provider.register();
  const tracer = trace.getTracer("arcp-tracing-demo-server");

  const server = new ARCPServer({
    runtime: { name: "tracing-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["parent", "child"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  // Parent agent: emits a tool_call/tool_result pair then delegates to child.
  server.registerAgent("parent", async (input, ctx) => {
    const { item } = input as { item: string };

    await ctx.status("calling tool");
    await ctx.toolCall({
      call_id: "call_lookup",
      tool: "catalog.lookup",
      args: { item },
    });
    await sleep(20);
    await ctx.toolResult({
      call_id: "call_lookup",
      result: { price_usd: 42 },
    });

    await ctx.status("delegating child");
    await ctx.delegate({
      delegate_id: "del_child",
      agent: "child",
      input: { item, price_usd: 42 },
    });

    return { item, ok: true };
  });

  // Child agent: trivial work — exists so we can show trace_id inheritance.
  server.registerAgent("child", async (input, ctx) => {
    await ctx.log("info", `child processing ${JSON.stringify(input)}`);
    await sleep(15);
    return { received: input };
  });

  const wss = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (raw) => {
      // Wrap the raw transport BEFORE handing it to the runtime so every
      // envelope on this connection produces a span.
      server.accept(withTracing(raw, { tracer }));
    },
  });
  console.log(`ARCP runtime listening on ${wss.url}`);
  console.log("OTel spans → ConsoleSpanExporter (this stdout).");
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down...");
    await wss.close();
    await server.close();
    await provider.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
