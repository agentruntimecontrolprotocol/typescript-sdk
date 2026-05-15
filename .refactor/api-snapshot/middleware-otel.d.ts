import type { Transport } from "@arcp/core/transport";
import type { WithTracingOptions } from "./types.js";
export type { WithTracingOptions } from "./types.js";
/**
 * Wrap a {@link Transport} so each frame produces a span and W3C trace
 * context is propagated through `envelope.extensions["x.otel"]`.
 *
 * The returned transport satisfies the same interface, so it is a drop-in
 * for `ARCPServer.accept(...)` / `ARCPClient.connect(...)`.
 */
export declare function withTracing(inner: Transport, options: WithTracingOptions): Transport;
//# sourceMappingURL=index.d.ts.map