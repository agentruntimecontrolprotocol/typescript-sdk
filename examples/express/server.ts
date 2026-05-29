/**
 * Express example — server.
 *
 * One Node `http.Server` handles both HTTP routes (`GET /health`) and the
 * ARCP WebSocket upgrade (`/arcp`). The Express request pipeline is
 * untouched by the WS upgrade — `attachArcpToExpress` listens on the
 * `upgrade` event of the underlying `http.Server`.
 */

import { attachArcpToExpress, createArcpExpressApp } from "@agentruntimecontrolprotocol/express";
import { ARCPServer, StaticBearerVerifier } from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env["ARCP_DEMO_PORT"] ?? 7896);
const TOKEN = process.env["ARCP_DEMO_TOKEN"] ?? "demo-token";
const ALLOWED_HOSTS = ["localhost", "127.0.0.1"];

async function main(): Promise<void> {
  const app = createArcpExpressApp({ allowedHosts: ALLOWED_HOSTS });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", arcp: "/arcp" });
  });

  const arcp = new ARCPServer({
    runtime: { name: "express-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["echo"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });
  arcp.registerAgent("echo", async (input, ctx) => {
    await ctx.log("info", "echoing");
    return { echoed: input };
  });

  const httpServer = app.listen(PORT, "127.0.0.1");
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));

  const upgrade = attachArcpToExpress(httpServer, {
    path: "/arcp",
    allowedHosts: ALLOWED_HOSTS,
    onTransport: (transport) => arcp.accept(transport),
  });

  console.log(`Express HTTP listening at http://127.0.0.1:${PORT}`);
  console.log(`  HTTP: GET /health`);
  console.log(`  ARCP: ws://127.0.0.1:${PORT}/arcp`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down...");
    await upgrade.close();
    await arcp.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve())),
    );
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
