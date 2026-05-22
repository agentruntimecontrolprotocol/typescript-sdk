import type { IncomingMessage } from "node:http";

import type { WebSocketTransport } from "@agentruntimecontrolprotocol/core/transport";

/**
 * Options for `attachArcpUpgrade`.
 */
export interface AttachArcpUpgradeOptions {
  /**
   * Path the ARCP WebSocket endpoint is mounted at. Requests whose
   * `req.url` pathname does not match are left untouched.
   *
   * Default: `/arcp`.
   */
  path?: string;

  /**
   * Allowed `Host` headers. When set, the request is rejected with HTTP 403
   * unless the `Host` header (without port) is in this list. RFC 6455 §10.2
   * defense against DNS rebinding.
   */
  allowedHosts?: readonly string[];

  /**
   * Called once per accepted WebSocket connection with a fresh
   * `WebSocketTransport`. The runtime is expected to call
   * `ARCPServer.accept(transport)` on it.
   */
  onTransport: (transport: WebSocketTransport, req: IncomingMessage) => void;
}

/**
 * Handle returned by `attachArcpUpgrade`. Closing detaches the upgrade
 * listener and closes all open WebSocket connections.
 */
export interface ArcpUpgradeHandle {
  /** Detach the upgrade listener and close open WS connections. */
  close(): Promise<void>;
}
