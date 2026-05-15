import type { ArcpServeHandle, BunServeArcpOptions } from "./types.js";
export { BunWebSocketTransport } from "./transport.js";
export type { ArcpServeHandle, BunServeArcpOptions } from "./types.js";
/**
 * Stand up a Bun-native ARCP listener.
 *
 * Uses `Bun.serve({ websocket: ... })` — no `ws` dependency. Per-connection
 * state flows through `server.upgrade(req, { data })` so each
 * `ServerWebSocket` is paired with its own {@link BunWebSocketTransport}.
 *
 * Example:
 * ```ts
 * import { serveArcp } from "@arcp/bun";
 * import { ARCPServer } from "@arcp/runtime";
 *
 * const arcp = new ARCPServer({ ... });
 * const handle = serveArcp({
 *   port: 7777,
 *   allowedHosts: ["localhost"],
 *   onTransport: (t) => arcp.accept(t),
 * });
 * console.log(`listening at ${handle.url}`);
 * ```
 */
export declare function serveArcp(options: BunServeArcpOptions): ArcpServeHandle;
//# sourceMappingURL=index.d.ts.map