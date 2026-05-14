/**
 * Fastify example — server.
 *
 * Fastify owns the HTTP routes; `attachArcpToFastify` mounts the ARCP
 * upgrade handler on the underlying `app.server` (the Node `http.Server`
 * Fastify created). Fastify's structured logger and request-id generation
 * are shown by the `/health` route.
 */

import Fastify from "fastify";

import { attachArcpToFastify } from "@arcp/fastify";
import { ARCPServer, StaticBearerVerifier } from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7897);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";
const ALLOWED_HOSTS = ["localhost", "127.0.0.1"];

async function main(): Promise<void> {
  // Fastify's `genReqId` plus its pino logger give every HTTP request a
  // correlation id in stdout — visible alongside ARCP traffic.
  const app = Fastify({
    logger: { level: "info" },
    genReqId: () => `req_${Math.random().toString(36).slice(2, 10)}`,
  });

  app.get("/health", async (req, _reply) => {
    req.log.info({ route: "health" }, "health check");
    return { status: "ok", arcp: "/arcp", req_id: req.id };
  });

  const arcp = new ARCPServer({
    runtime: { name: "fastify-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["echo"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });
  arcp.registerAgent("echo", async (input, ctx) => {
    await ctx.log("info", "echoing");
    return { echoed: input };
  });

  await app.listen({ host: "127.0.0.1", port: PORT });

  const upgrade = attachArcpToFastify(app, {
    path: "/arcp",
    allowedHosts: ALLOWED_HOSTS,
    onTransport: (transport) => arcp.accept(transport),
  });

  app.log.info(`ARCP: ws://127.0.0.1:${PORT}/arcp`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down...");
    await upgrade.close();
    await arcp.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
