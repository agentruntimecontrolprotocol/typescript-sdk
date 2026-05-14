import type { Server as HttpServer } from "node:http";
import {
  type ArcpUpgradeHandle,
  type AttachArcpUpgradeOptions,
  attachArcpUpgrade,
} from "@arcp/node";
import express, { type Express, type RequestHandler } from "express";

/**
 * Options for {@link createArcpExpressApp}.
 */
export interface CreateArcpExpressAppOptions {
  /**
   * If set, every HTTP request is rejected with 403 unless its `Host` header
   * (without port) matches an entry. Mirrors the WebSocket-side check in
   * {@link attachArcpToExpress} and protects against DNS rebinding.
   */
  allowedHosts?: readonly string[];

  /**
   * Disable Express's `x-powered-by` header. Default: `true`.
   */
  disablePoweredBy?: boolean;
}

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
