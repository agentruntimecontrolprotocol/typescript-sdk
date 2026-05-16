// Implementation note (Effect migration, issue #48):
// `@arcp/express` is a re-export of `attachArcpUpgrade` from `@arcp/node`
// wrapped with a tiny Host-header guard middleware. The upgrade event is
// emitted by Node's `http.Server` before Express's request pipeline runs, so
// nothing here owns runtime state. Effect-graph consumers should keep using
// `attachArcpToExpress`; see the Effect-integration note in
// `@arcp/node/src/index.ts` for the recommended `ManagedRuntime` wiring.
// Adding a dedicated `effect` twin here would only re-wrap the Node helper
// it already delegates to.

import type { Server as HttpServer } from "node:http";

import {
  type ArcpUpgradeHandle,
  type AttachArcpUpgradeOptions,
  attachArcpUpgrade,
} from "@arcp/node";
import express, { type Express, type RequestHandler } from "express";

import type { CreateArcpExpressAppOptions } from "./types.js";

export type { CreateArcpExpressAppOptions } from "./types.js";

/**
 * Create an Express app with safe defaults for ARCP deployments:
 *  - `x-powered-by` is disabled
 *  - optional `Host` header allow-list (DNS rebinding protection)
 *  - `trust proxy` is *not* set (be explicit at the deployment layer)
 *
 * This does NOT attach the ARCP WebSocket upgrade. Call
 * {@link attachArcpToExpress} on the underlying `http.Server` once you have
 * one.
 */
export function createArcpExpressApp(
  options: CreateArcpExpressAppOptions = {},
): Express {
  const app = express();
  if (options.disablePoweredBy !== false) {
    app.disable("x-powered-by");
  }
  if (options.allowedHosts !== undefined) {
    app.use(hostHeaderGuard(options.allowedHosts));
  }
  return app;
}

/**
 * Attach the ARCP WebSocket upgrade handler to the `http.Server` backing an
 * Express app. Pass the result of `app.listen(...)` or your own
 * `http.createServer(app)` instance.
 *
 * Example:
 * ```ts
 * import { createArcpExpressApp, attachArcpToExpress } from "@arcp/express";
 * import { ARCPServer } from "@arcp/runtime";
 *
 * const app = createArcpExpressApp({ allowedHosts: ["localhost"] });
 * const arcp = new ARCPServer({ ... });
 * const server = app.listen(7777);
 *
 * attachArcpToExpress(server, {
 *   path: "/arcp",
 *   allowedHosts: ["localhost"],
 *   onTransport: (transport) => arcp.accept(transport),
 * });
 * ```
 */
export function attachArcpToExpress(
  server: HttpServer,
  options: AttachArcpUpgradeOptions,
): ArcpUpgradeHandle {
  return attachArcpUpgrade(server, options);
}

function hostHeaderGuard(allowed: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const raw = req.headers.host;
    if (typeof raw !== "string") {
      res.status(400).type("text/plain").send("Missing Host header");
      return;
    }
    const host = raw.split(":", 1)[0] ?? "";
    if (!allowed.includes(host)) {
      res
        .status(403)
        .type("text/plain")
        .send("Forbidden: Host header not allowed");
      return;
    }
    next();
  };
}
