/**
 * stdio — server (child process).
 *
 * This file is run as a child subprocess by the client. It instantiates
 * an ARCPServer and binds a StdioTransport to this process's
 * stdin/stdout, so the parent client can speak ARCP newline-delimited
 * JSON over our pipes.
 *
 * IMPORTANT: anything we write to stdout MUST be valid ARCP framing —
 * one JSON envelope per line. Diagnostic logs go to stderr.
 *
 * Run by the client via: `pnpm tsx examples/stdio/client.ts`
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  StdioTransport,
  silentLogger,
} from "@agentruntimecontrolprotocol/sdk";

const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "stdio-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["echo"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    logger: silentLogger,
  });

  server.registerAgent("echo", async (input, ctx) => {
    const opts = (input ?? {}) as { message?: string };
    const message = opts.message ?? "hello";
    await ctx.status("echoing");
    await ctx.log("info", `received: ${message}`);
    return { echoed: message };
  });

  const transport = StdioTransport.fromProcess();
  server.accept(transport);

  process.stderr.write("[child] stdio server ready\n");

  const shutdown = async (): Promise<void> => {
    process.stderr.write("[child] shutting down\n");
    await transport.close("shutdown");
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((err) => {
  process.stderr.write(`[child] failed: ${String(err)}\n`);
  process.exit(1);
});
