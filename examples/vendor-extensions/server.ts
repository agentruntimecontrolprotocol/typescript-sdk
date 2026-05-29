/**
 * vendor-extensions — server.
 *
 * Hosts a "render-job" agent that mixes reserved event kinds with a
 * custom vendor namespace `x-vendor.acme.*`:
 *
 *   - reserved: status, log.
 *   - vendor:   x-vendor.acme.progress (percent + eta_seconds).
 *
 * The agent also requests a custom lease namespace `x-vendor.acme.metrics`
 * alongside the standard `net.fetch`, to demonstrate that capability
 * namespaces follow the same `x-vendor.<vendor>.<name>` extension rule.
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env["ARCP_DEMO_PORT"] ?? 7884);
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "vendor-extensions-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["render-job"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("render-job", async (input, ctx) => {
    const opts = (input ?? {}) as { frames?: number };
    const frames = opts.frames ?? 4;

    await ctx.status("rendering");
    for (let i = 1; i <= frames; i++) {
      const percent = Math.round((i / frames) * 100);
      const etaSeconds = (frames - i) * 1;
      // Reserved kind alongside a vendor kind — receivers MAY understand
      // the vendor kind, MUST tolerate it if they do not.
      await ctx.log("info", `rendered frame ${i}/${frames}`);
      await ctx.emitEvent("x-vendor.acme.progress", {
        percent,
        eta_seconds: etaSeconds,
      });
      await sleep(40);
    }
    return { frames, format: "mp4" };
  });

  const wss = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (t) => {
      server.accept(t);
    },
  });
  console.log(`ARCP runtime listening on ${wss.url}`);
  console.log(`Token: ${TOKEN}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down...");
    await wss.close();
    await server.close();
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
