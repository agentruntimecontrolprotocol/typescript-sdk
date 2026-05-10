/**
 * Observer pattern: a third client subscribes and watches another client's
 * job emit logs and progress events. Demonstrates §13 subscriptions.
 *
 * NOTE: Subscriptions in v0.1 are scoped to the subscriber's own session
 * (per PLAN.md §4 question 6). For a true cross-session observer pattern,
 * the runtime would need to authorize a wider entitlement set; this example
 * shows the active client tailing its own session's events.
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
    capabilities: { streaming: true, subscriptions: true },
    bearer: new StaticBearerVerifier(new Map([["t", { principal: "demo" }]])),
    logger: silentLogger,
  });

  server.registerTool("count", async (_args, ctx) => {
    for (let i = 1; i <= 3; i++) {
      await ctx.log("info", `tick ${i}`);
    }
    return { ticks: 3 };
  });

  const client = new ARCPClient({
    client: { kind: "demo-client", version: "0.0.1" },
    capabilities: { streaming: true, subscriptions: true },
    authScheme: "bearer",
    token: "t",
    logger: silentLogger,
  });

  const [c, s] = pairMemoryTransports();
  server.accept(s);
  await client.connect(c);

  const sub = await client.subscribe({ filter: { types: ["log"] } });
  process.stdout.write(`Subscribed: ${sub.subscriptionId}\n`);

  // Drive the tool, then drain the feed for a short window.
  void client.invoke("count", {});

  let collected = 0;
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && collected < 3) {
    const next = await Promise.race([
      sub.feed.next(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), 100),
      ),
    ]);
    if (next.done) break;
    process.stdout.write(`[observed ${next.value.type}] ${JSON.stringify(next.value.payload)}\n`);
    collected += 1;
  }

  await sub.close();
  await client.close();
  await server.close();
}

await main();
