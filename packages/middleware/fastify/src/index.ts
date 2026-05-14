import {
  type ArcpUpgradeHandle,
  type AttachArcpUpgradeOptions,
  attachArcpUpgrade,
} from "@arcp/node";
import type { FastifyInstance } from "fastify";

export type { ArcpUpgradeHandle, AttachArcpUpgradeOptions } from "./types.js";

/**
 * Attach the ARCP WebSocket upgrade handler to a Fastify instance.
 *
 * Mounts a single upgrade listener on the underlying `http.Server`
 * (`app.server`) at the configured path (`/arcp` by default). DNS rebinding
 * protection is enforced via `allowedHosts` exactly as in `@arcp/express` and
 * `@arcp/node`.
 *
 * Fastify itself is NOT consulted for the upgrade — Node's `http.Server`
 * emits the `upgrade` event before Fastify's request pipeline runs. The HTTP
 * routes registered with Fastify remain untouched.
 *
 * Example:
 * ```ts
 * import Fastify from "fastify";
 * import { ARCPServer } from "@arcp/runtime";
 * import { attachArcpToFastify } from "@arcp/fastify";
 *
 * const app = Fastify();
 * const arcp = new ARCPServer({ ... });
 *
 * await app.listen({ port: 7777 });
 * attachArcpToFastify(app, {
 *   path: "/arcp",
 *   allowedHosts: ["localhost"],
 *   onTransport: (transport) => arcp.accept(transport),
 * });
 * ```
 *
 * The returned handle's `close()` detaches the upgrade listener and closes
 * all open WebSocket connections. Call it before `app.close()` if you want
 * deterministic shutdown ordering; otherwise the WS sockets will close as
 * a side effect of the HTTP server shutting down.
 */
export function attachArcpToFastify(
  app: FastifyInstance,
  options: AttachArcpUpgradeOptions,
): ArcpUpgradeHandle {
  return attachArcpUpgrade(app.server, options);
}
