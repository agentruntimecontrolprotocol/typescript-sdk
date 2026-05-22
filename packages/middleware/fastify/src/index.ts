// Implementation note (Effect migration, issue #48):
// `@agentruntimecontrolprotocol/fastify` is a single-line delegation to `attachArcpUpgrade` from
// `@agentruntimecontrolprotocol/node` against `app.server` — Fastify's own request pipeline is not
// consulted for the upgrade event. There is no runtime state, no scoped
// lifecycle, and no concurrent resource graph that an `Effect`/`Layer` twin
// would help compose. Effect-graph consumers should keep using
// `attachArcpToFastify`; see the Effect-integration note in
// `@agentruntimecontrolprotocol/node/src/index.ts` for the recommended `ManagedRuntime` wiring.

import {
  type ArcpUpgradeHandle,
  type AttachArcpUpgradeOptions,
  attachArcpUpgrade,
} from "@agentruntimecontrolprotocol/node";
import type { FastifyInstance } from "fastify";

export type { ArcpUpgradeHandle, AttachArcpUpgradeOptions } from "./types.js";

/**
 * Attach the ARCP WebSocket upgrade handler to a Fastify instance.
 *
 * Mounts a single upgrade listener on the underlying `http.Server`
 * (`app.server`) at the configured path (`/arcp` by default). DNS rebinding
 * protection is enforced via `allowedHosts` exactly as in `@agentruntimecontrolprotocol/express` and
 * `@agentruntimecontrolprotocol/node`.
 *
 * Fastify itself is NOT consulted for the upgrade — Node's `http.Server`
 * emits the `upgrade` event before Fastify's request pipeline runs. The HTTP
 * routes registered with Fastify remain untouched.
 *
 * Example:
 * ```ts
 * import Fastify from "fastify";
 * import { ARCPServer } from "@agentruntimecontrolprotocol/runtime";
 * import { attachArcpToFastify } from "@agentruntimecontrolprotocol/fastify";
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
