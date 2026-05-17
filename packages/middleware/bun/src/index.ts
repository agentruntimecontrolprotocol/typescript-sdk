// Implementation note (Effect migration, issue #48):
// `@arcp/bun` is a single-file `Bun.serve({ websocket })` adapter that
// terminates ARCP connections on Bun's native WS server (no `ws` dep) and
// hands each accepted socket to `onTransport` as a `BunWebSocketTransport`.
// All runtime state — handshake, dispatch loop, back-pressure, resume — is
// owned by `ARCPServer.accept`; this package never holds it. The Bun socket
// is only available inside the `websocket.open` callback and is consumed by
// `BunWebSocketTransport` immediately, leaving no socket-level seam for an
// Effect-shape `TransportEffect` factory to slot into without rewriting the
// per-socket state machine. Adding a dedicated `effect` twin here would
// duplicate the legacy adapter and force a runtime `effect` dependency on
// the Bun package.
//
// Effect-graph consumers should keep using `serveArcp` and dispatch the
// legacy transport into their `ManagedRuntime` from `onTransport`:
//
//   import { Effect, ManagedRuntime } from "effect"
//   import {
//     ARCPRuntimeLayer,
//     ARCPServerService,
//   } from "@arcp/runtime"
//   import { serveArcp } from "@arcp/bun"
//
//   const runtime = ManagedRuntime.make(ARCPRuntimeLayer({ ... }))
//   const handle = serveArcp({
//     port: 7777,
//     onTransport: (transport) =>
//       runtime.runFork(
//         Effect.gen(function* () {
//           const { server } = yield* ARCPServerService
//           server?.accept(transport)
//         }),
//       ),
//   })
//
// `acceptSessionEffect` (from `@arcp/runtime`) remains the right call-site
// when the consumer is driving sessions from an already-Effect-shape
// transport (e.g. their own `TransportEffect` over a stdio pipe); it is not
// a better fit for the Bun adapter's `ServerWebSocket`-owned socket — that
// socket is already inside `BunWebSocketTransport` by the time `onTransport`
// fires.

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
  const host = options.host ?? "0.0.0.0";
  const server = Bun.serve<ArcpUpgradeData>({
    port: options.port ?? 0,
    hostname: host,
    fetch: buildFetchHandler(options, path),
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
  return {
    port,
    url: `ws://${host}:${port}${path}`,
    close: async (): Promise<void> => {
      await server.stop(true);
    },
  };
}

type BunFetchHandler = (
  req: Request,
  srv: { upgrade: (r: Request, opts: { data: ArcpUpgradeData }) => boolean },
) => Promise<Response | undefined>;

function buildFetchHandler(
  options: BunServeArcpOptions,
  path: string,
): BunFetchHandler {
  const allowed = options.allowedHosts;
  const fallback =
    options.fallback ??
    ((): Response => new Response("Not Found", { status: 404 }));
  return async (req, srv) => {
    const url = new URL(req.url);
    if (url.pathname !== path) return fallback(req);
    const hostGuardError = checkHostHeader(req, allowed);
    if (hostGuardError !== null) return hostGuardError;
    const data: ArcpUpgradeData = {
      origin: req,
      transport: null,
      onTransport: options.onTransport,
    };
    if (!srv.upgrade(req, { data })) {
      return new Response("Upgrade failed", { status: 426 });
    }
    return undefined;
  };
}

function checkHostHeader(
  req: Request,
  allowed: readonly string[] | undefined,
): Response | null {
  if (allowed === undefined) return null;
  const raw = req.headers.get("host");
  if (raw === null) return new Response("Missing Host header", { status: 400 });
  const hostOnly = raw.split(":", 1)[0] ?? "";
  if (allowed.includes(hostOnly)) return null;
  return new Response("Forbidden: Host header not allowed", { status: 403 });
}
