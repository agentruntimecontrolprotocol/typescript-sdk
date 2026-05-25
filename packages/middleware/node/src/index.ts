// Implementation note (Effect migration, issue #48):
// `@agentruntimecontrolprotocol/node` is a thin adapter (~30 lines of upgrade-handler glue) that
// hands each accepted WebSocket to a user-supplied `onTransport` callback as
// a legacy `WebSocketTransport`. The runtime contract — handshake, dispatch
// loop, back-pressure — lives entirely inside `ARCPServer.accept` and the
// transport class; this package never owns it. There is no concurrent
// resource graph, no error pipeline, and no scoped lifecycle that benefits
// from a dedicated `Effect`/`Layer` twin here. Adding one would force a
// runtime `effect` dependency on a package whose entire job is a single
// `server.on('upgrade', ...)` registration.
//
// Effect-graph consumers should keep using `attachArcpUpgrade` and dispatch
// the legacy transport into their `ManagedRuntime` from `onTransport`:
//
//   import { ManagedRuntime } from "effect"
//   import {
//     ARCPRuntimeLayer,
//     ARCPServerService,
//   } from "@agentruntimecontrolprotocol/runtime"
//   import { attachArcpUpgrade } from "@agentruntimecontrolprotocol/node"
//
//   const runtime = ManagedRuntime.make(ARCPRuntimeLayer({ ... }))
//   attachArcpUpgrade(httpServer, {
//     path: "/arcp",
//     onTransport: (transport) =>
//       runtime.runFork(
//         Effect.gen(function* () {
//           const { server } = yield* ARCPServerService
//           server?.accept(transport)
//         }),
//       ),
//   })
//
// `acceptSessionEffect` (from `@agentruntimecontrolprotocol/runtime`) is the right call-site when
// the consumer is driving sessions from an already-Effect-shape transport
// (e.g. `websocketTransportEffect` over their own socket); it is NOT a
// better fit for this adapter's `ws`-server-owned socket — that socket is
// already inside the legacy `WebSocketTransport` by the time `onTransport`
// fires.

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocketTransport } from "@agentruntimecontrolprotocol/core/transport";
import { WebSocketServer } from "ws";

import { parseHostHeader } from "./host.js";
import type { ArcpUpgradeHandle, AttachArcpUpgradeOptions } from "./types.js";

export { parseHostHeader } from "./host.js";
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
 * import { ARCPServer } from "@agentruntimecontrolprotocol/runtime";
 * import { attachArcpUpgrade } from "@agentruntimecontrolprotocol/node";
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
  return allowed.includes(parseHostHeader(raw));
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
