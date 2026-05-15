import type { Server as HttpServer } from "node:http";
import { type ArcpUpgradeHandle, type AttachArcpUpgradeOptions } from "@arcp/node";
import { type Express } from "express";
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
export declare function createArcpExpressApp(options?: CreateArcpExpressAppOptions): Express;
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
export declare function attachArcpToExpress(server: HttpServer, options: AttachArcpUpgradeOptions): ArcpUpgradeHandle;
//# sourceMappingURL=index.d.ts.map