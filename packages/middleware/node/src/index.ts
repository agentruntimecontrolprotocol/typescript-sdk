import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketTransport } from "@arcp/core/transport";
import { WebSocketServer } from "ws";

/**
 * Options for {@link attachArcpUpgrade}.
 */
export interface AttachArcpUpgradeOptions {
  /**
   * Path the ARCP WebSocket endpoint is mounted at. Requests whose
   * `req.url` pathname does not match are left untouched (so multiple
   * upgrade handlers can coexist on the same server).
   *
   * Default: `/arcp`.
   */
  path?: string;

  /**
   * Allowed `Host` headers. When set, the request is rejected with HTTP 403
   * unless the `Host` header (without port) is in this list. This is the
   * defense against DNS rebinding attacks recommended by RFC 6455 §10.2.
   *
   * If omitted, the upgrade succeeds regardless of `Host`. Provide an
   * explicit list (e.g. `["localhost", "127.0.0.1"]`) when binding to
   * loopback.
   */
  allowedHosts?: readonly string[];

  /**
   * Called once per accepted WebSocket connection with a fresh
   * {@link WebSocketTransport}. The runtime is expected to call
   * `ARCPServer.accept(transport)` on it.
   */
  onTransport: (transport: WebSocketTransport, req: IncomingMessage) => void;
}

/**
 * Handle returned by {@link attachArcpUpgrade}. Closing detaches the upgrade
 * listener and closes all open WebSocket connections.
 */
export interface ArcpUpgradeHandle {
  /** Detach the upgrade listener and close open WS connections. */
  close(): Promise<void>;
}

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
export function attachArcpUpgrade(
  server: HttpServer,
  options: AttachArcpUpgradeOptions,
): ArcpUpgradeHandle {
  const path = options.path ?? "/arcp";
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = req.url ?? "";
    const pathname = url.split("?", 1)[0] ?? "";
    if (pathname !== path) {
      // Not for us — leave for other listeners. If nothing else handles it,
      // Node will eventually destroy the socket.
      return;
    }

    if (!hostHeaderAllowed(req, options.allowedHosts)) {
      writeUpgradeError(socket, 403, "Forbidden: Host header not allowed");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const transport = new WebSocketTransport(ws);
      options.onTransport(transport, req);
    });
  };

  server.on("upgrade", onUpgrade);

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.off("upgrade", onUpgrade);
        wss.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

function hostHeaderAllowed(
  req: IncomingMessage,
  allowed?: readonly string[],
): boolean {
  if (allowed === undefined) return true;
  const raw = req.headers.host;
  if (typeof raw !== "string") return false;
  // Strip port — `Host` can be `example.com:443`.
  const host = raw.split(":", 1)[0] ?? "";
  return allowed.includes(host);
}

function writeUpgradeError(socket: Duplex, status: number, body: string): void {
  const statusText = status === 403 ? "Forbidden" : "Bad Request";
  socket.write(
    [
      `HTTP/1.1 ${status} ${statusText}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body,
    ].join("\r\n"),
  );
  socket.destroy();
}
