import type { Server as HttpServer } from "node:http";

import {
  type ArcpUpgradeHandle,
  type AttachArcpUpgradeOptions,
  attachArcpUpgrade,
} from "@arcp/node";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";

import type { CreateArcpHonoAppOptions } from "./types.js";

export type { CreateArcpHonoAppOptions } from "./types.js";

/**
 * Create a Hono app with safe defaults for ARCP deployments:
 *  - optional `Host` header allow-list (DNS rebinding protection)
 *
 * This does NOT attach the ARCP WebSocket upgrade. Hono runs on Web-standard
 * `Request`/`Response`, not on Node's `http.Server`, so the upgrade has to
 * be attached separately to the underlying server (typically the one
 * returned by `@hono/node-server`'s `serve()`).
 *
 * Example:
 * ```ts
 * import { serve } from "@hono/node-server";
 * import { createArcpHonoApp, attachArcpToHono } from "@arcp/hono";
 * import { ARCPServer } from "@arcp/runtime";
 *
 * const app = createArcpHonoApp({ allowedHosts: ["localhost"] });
 * const arcp = new ARCPServer({ ... });
 *
 * const server = serve({ fetch: app.fetch, port: 7777 });
 * attachArcpToHono(server, {
 *   path: "/arcp",
 *   allowedHosts: ["localhost"],
 *   onTransport: (transport) => arcp.accept(transport),
 * });
 * ```
 */
export function createArcpHonoApp(
  options: CreateArcpHonoAppOptions = {},
): Hono {
  const app = new Hono();
  if (options.allowedHosts !== undefined) {
    app.use("*", hostHeaderGuard(options.allowedHosts));
  }
  return app;
}

/**
 * Attach the ARCP WebSocket upgrade handler to the `http.Server` returned by
 * `@hono/node-server`'s `serve()`. The `serve()` return value implements
 * Node's `http.Server` interface, so this is the same call as for Express.
 */
export function attachArcpToHono(
  server: HttpServer,
  options: AttachArcpUpgradeOptions,
): ArcpUpgradeHandle {
  return attachArcpUpgrade(server, options);
}

function hostHeaderGuard(allowed: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const raw = c.req.header("host");
    if (typeof raw !== "string") {
      return c.text("Missing Host header", 400);
    }
    const host = raw.split(":", 1)[0] ?? "";
    if (!allowed.includes(host)) {
      return c.text("Forbidden: Host header not allowed", 403);
    }
    await next();
    return undefined;
  };
}
