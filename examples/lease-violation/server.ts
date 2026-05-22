/**
 * lease-violation — server.
 *
 * Hosts a "code-refactor" agent that performs two `fs.read` tool calls:
 *
 *   1. /workspace/myapp/src/auth/handler.ts — inside the lease.
 *   2. /etc/passwd                          — outside the lease.
 *
 * Before each "read", the agent calls `validateLeaseOp`. The first
 * passes; the second throws `PermissionDeniedError`. The agent surfaces
 * the error as a `tool_result` carrying `body.error` and continues —
 * lease violations are NOT session-fatal.
 */

import {
  ARCPServer,
  PermissionDeniedError,
  StaticBearerVerifier,
  startWebSocketServer,
  validateLeaseOp,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7882);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "lease-violation-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["code-refactor"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  server.registerAgent("code-refactor", async (_input, ctx) => {
    async function tryRead(path: string, callId: string): Promise<void> {
      await ctx.toolCall({
        tool: "fs.read",
        args: { path },
        call_id: callId,
      });
      try {
        validateLeaseOp(ctx.lease, "fs.read", path);
        await ctx.toolResult({
          call_id: callId,
          result: { path, bytes: 1024 },
        });
      } catch (err) {
        if (err instanceof PermissionDeniedError) {
          await ctx.toolResult({
            call_id: callId,
            error: err.toPayload(),
          });
          await ctx.log("warn", `Skipping unauthorized read: ${path}`);
          return;
        }
        throw err;
      }
    }

    await tryRead("/workspace/myapp/src/auth/handler.ts", "c1");
    await tryRead("/etc/passwd", "c2");
    return { reviewed: ["/workspace/myapp/src/auth/handler.ts"] };
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

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
