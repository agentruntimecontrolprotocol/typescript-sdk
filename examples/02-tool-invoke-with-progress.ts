/**
 * Tool invocation with progress events and a streamed log.
 *
 * Demonstrates tool registration, progress emission, log streaming, and
 * receiving the final tool.result.
 */
import {
  ARCPClient,
  ARCPServer,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "../src/index.js";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { kind: "demo-runtime", version: "0.0.1" },
    capabilities: { streaming: true, durable_jobs: true },
    bearer: new StaticBearerVerifier(new Map([["t", { principal: "demo" }]])),
    logger: silentLogger,
  });

  server.registerTool("ingest", async (args, ctx) => {
    const total = (args["count"] as number) ?? 5;
    const writer = ctx.openStream({ kind: "log", contentType: "application/json" });
    for (let i = 1; i <= total; i++) {
      await ctx.emitProgress({ percent: (i / total) * 100, message: `Embedding ${i}/${total}` });
      await writer.write({ log: { level: "info", message: `processed ${i}` } });
    }
    await writer.close();
    return { processed: total };
  });

  const client = new ARCPClient({
    client: { kind: "demo-client", version: "0.0.1" },
    capabilities: { streaming: true },
    authScheme: "bearer",
    token: "t",
    logger: silentLogger,
  });

  const [c, s] = pairMemoryTransports();
  server.accept(s);
  await client.connect(c);

  process.stdout.write("Invoking ingest with count=4...\n");
  const out = await client.invoke("ingest", { count: 4 });
  process.stdout.write(`Result: ${JSON.stringify(out.result.value)}\n`);
  process.stdout.write(`Progress events received: ${out.progress.length}\n`);
  for (const p of out.progress) {
    process.stdout.write(`  ${p.percent}% — ${p.message ?? ""}\n`);
  }

  await client.close();
  await server.close();
}

await main();
