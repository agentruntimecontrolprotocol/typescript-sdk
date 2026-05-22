/**
 * Bun example — server.
 *
 * Uses `serveArcp({...})` from `@agentruntimecontrolprotocol/bun`. Bun's native WebSocket
 * support means no `ws` dependency — `Bun.serve({ websocket })` is
 * doing the work under the hood.
 *
 * Run with Bun (NOT Node):
 *   bun run examples/bun/server.ts
 *
 * The client (`client.ts`) can run under either Node or Bun — the wire
 * protocol is runtime-agnostic.
 */

import { serveArcp } from "@agentruntimecontrolprotocol/bun";
import { ARCPServer, StaticBearerVerifier } from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7898);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

function main(): void {
  const arcp = new ARCPServer({
    runtime: { name: "bun-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["echo"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  arcp.registerAgent("echo", async (input, ctx) => {
    await ctx.log(
      "info",
      `echoing from bun ${typeof Bun !== "undefined" ? Bun.version : "?"}`,
    );
    return { echoed: input, runtime: "bun" };
  });

  const handle = serveArcp({
    port: PORT,
    host: "127.0.0.1",
    allowedHosts: ["localhost", "127.0.0.1"],
    onTransport: (transport) => arcp.accept(transport),
  });

  console.log(`Bun ARCP runtime listening on ${handle.url}`);
  console.log(`Token: ${TOKEN}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down...");
    await handle.close();
    await arcp.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main();
