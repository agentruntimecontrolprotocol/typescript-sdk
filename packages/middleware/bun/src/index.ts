import { BunWebSocketTransport } from "./transport.js";
import type { ArcpServeHandle, BunServeArcpOptions } from "./types.js";

export { BunWebSocketTransport } from "./transport.js";
export type { ArcpServeHandle, BunServeArcpOptions } from "./types.js";

/**
 * Per-socket data attached on `server.upgrade`.
 *
 * `transport` is allocated up-front but bound to the `ServerWebSocket` only
 * after `websocket.open` fires — that's the first point at which the socket
 * handle is available.
 */
interface ArcpUpgradeData {
  origin: Request;
  transport: BunWebSocketTransport | null;
  onTransport: BunServeArcpOptions["onTransport"];
}

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
export function serveArcp(options: BunServeArcpOptions): ArcpServeHandle {
  if (typeof Bun === "undefined") {
    throw new TypeError(
      "@arcp/bun requires the Bun runtime (`Bun.serve` is unavailable in Node)",
    );
  }
  const path = options.path ?? "/arcp";
  const allowed = options.allowedHosts;
  const fallback =
    options.fallback ??
    ((): Response => new Response("Not Found", { status: 404 }));

  const server = Bun.serve<ArcpUpgradeData>({
    port: options.port ?? 0,
    hostname: options.host ?? "0.0.0.0",
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname !== path) {
        return fallback(req);
      }
      // DNS-rebinding guard.
      if (allowed !== undefined) {
        const raw = req.headers.get("host");
        if (raw === null) {
          return new Response("Missing Host header", { status: 400 });
        }
        const hostOnly = raw.split(":", 1)[0] ?? "";
        if (!allowed.includes(hostOnly)) {
          return new Response("Forbidden: Host header not allowed", {
            status: 403,
          });
        }
      }
      const data: ArcpUpgradeData = {
        origin: req,
        transport: null,
        onTransport: options.onTransport,
      };
      const ok = srv.upgrade(req, { data });
      if (!ok) {
        return new Response("Upgrade failed", { status: 426 });
      }
      // Returning undefined is valid for upgraded requests; Bun handles the
      // rest of the response. The `await` keyword above is for `fallback`
      // returning a Promise.
      return undefined;
    },
    websocket: {
      open(ws) {
        const transport = new BunWebSocketTransport(ws);
        ws.data.transport = transport;
        ws.data.onTransport(transport, ws.data.origin);
      },
      message(ws, message) {
        const t = ws.data.transport;
        if (t === null) return;
        t.deliverMessage(
          typeof message === "string" ? message : Buffer.from(message),
        );
      },
      close(ws) {
        ws.data.transport?.deliverClose();
      },
    },
  });

  const port = server.port ?? options.port ?? 0;
  const host = options.host ?? "0.0.0.0";
  return {
    port,
    url: `ws://${host}:${port}${path}`,
    close: async (): Promise<void> => {
      await server.stop(true);
    },
  };
}
