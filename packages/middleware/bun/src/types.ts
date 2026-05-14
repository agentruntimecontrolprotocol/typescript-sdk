import type { Transport } from "@arcp/core/transport";

/**
 * Options for `serveArcp`.
 */
export interface BunServeArcpOptions {
  /** TCP port. Default `0` (Bun chooses a port). */
  port?: number;
  /** Bind host. Default `0.0.0.0`. */
  host?: string;
  /**
   * Path the ARCP WebSocket endpoint is mounted at. Requests whose pathname
   * does not match get a 404 (unless `fallback` is provided).
   *
   * Default `/arcp`.
   */
  path?: string;
  /**
   * Allowed `Host` headers (DNS rebinding protection, RFC 6455 §10.2). When
   * set, requests with any other Host header receive HTTP 403.
   */
  allowedHosts?: readonly string[];
  /**
   * Called once per accepted WebSocket connection with a fresh transport.
   * The runtime is expected to call `ARCPServer.accept(transport)` on it.
   */
  onTransport: (transport: Transport, req: Request) => void;
  /**
   * Optional fallback `fetch` handler invoked for non-ARCP requests. Default
   * returns a plain 404. Use this to serve HTTP routes alongside ARCP.
   */
  fallback?: (req: Request) => Response | Promise<Response>;
}

/**
 * Handle returned by `serveArcp`. Closing stops accepting new connections
 * and closes the existing ones.
 */
export interface ArcpServeHandle {
  /** Resolved port the server is bound to. */
  readonly port: number;
  /** Resolved URL clients should use to connect. */
  readonly url: string;
  /** Stop the server and close all open sockets. */
  close(): Promise<void>;
}
