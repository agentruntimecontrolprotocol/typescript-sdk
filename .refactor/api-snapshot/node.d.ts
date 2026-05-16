import type { Server as HttpServer } from "node:http";
import type { ArcpUpgradeHandle, AttachArcpUpgradeOptions } from "./types.js";
export type { ArcpUpgradeHandle, AttachArcpUpgradeOptions } from "./types.js";
/**
 * Attach an ARCP WebSocket upgrade handler to an existing Node `http.Server`.
 *
 * Use this when you already have an HTTP server (Express, Hono, Fastify,
 * vanilla `http.createServer`, ...) and want to mount ARCP at a specific
 * path without giving up the rest of the server.
 *
 * Example:
 * ```ts
 * import { createServer } from "node:http";
 * import { ARCPServer } from "@arcp/runtime";
 * import { attachArcpUpgrade } from "@arcp/node";
 *
 * const httpServer = createServer((_, res) => res.end("hello"));
 * const arcpServer = new ARCPServer({ ... });
 *
 * attachArcpUpgrade(httpServer, {
 *   path: "/arcp",
 *   allowedHosts: ["localhost", "127.0.0.1"],
 *   onTransport: (transport) => arcpServer.accept(transport),
 * });
 *
 * httpServer.listen(7777);
 * ```
 */
export declare function attachArcpUpgrade(server: HttpServer, options: AttachArcpUpgradeOptions): ArcpUpgradeHandle;
//# sourceMappingURL=index.d.ts.map