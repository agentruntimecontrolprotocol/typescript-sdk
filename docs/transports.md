# Transports

A `Transport` is a duplex frame channel. The SDK ships three; you can
write your own by implementing the
[`Transport` interface](../packages/core/src/transport/types.ts).

```ts
interface Transport {
  send(frame: SendableFrame): Promise<void>;
  onFrame(handler: FrameHandler): void;
  onClose(handler: (err?: Error) => void): void;
  close(reason?: string): Promise<void>;
  readonly closed: boolean;
}
```

Frames are JSON-encoded envelopes (text); v0.1 transports discard
binary frames. The transport preserves order per logical stream
(session-scoped, or job-scoped for streaming results). Handlers are
awaited before the next inbound frame is dispatched.

Each built-in transport also ships an Effect-shaped twin returning a
`TransportEffect` whose `incoming` is a
`Stream<WireFrame, TaggedTransportError>` —
`memoryTransportEffect()`, `stdioTransportEffect(...)`, and
`websocketTransportEffect(socket)`. Use these from
`acceptSessionEffect` / `subscribeEnvelopes` when composing the
Effect-native runtime.

## WebSocket

Production default. Bidirectional, framed, fits naturally over TLS.

### Server

```ts
import { startWebSocketServer } from "@agentruntimecontrolprotocol/sdk";

const wss = await startWebSocketServer({
  host: "127.0.0.1", // optional, default "127.0.0.1"
  port: 7777,         // optional, default 0 (ephemeral)
  onTransport: (t) => server.accept(t),
});
console.log(wss.url); // ws://127.0.0.1:7777
await wss.close();
```

`startWebSocketServer` accepts every connection on the root path and
does not implement path-routing or `Host`-header filtering. For those
features — including DNS-rebind protection via `allowedHosts` and a
custom `path` — use [`attachArcpUpgrade`](./packages/node.md) on an
existing Node `http.Server`:

```ts
import { attachArcpUpgrade } from "@agentruntimecontrolprotocol/node";

const handle = attachArcpUpgrade(httpServer, {
  path: "/arcp", // default "/arcp"
  allowedHosts: ["api.example.com"], // DNS-rebind protection
  onTransport: (t) => server.accept(t),
});
```

### Client

```ts
import { WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const transport = await WebSocketTransport.connect(
  "wss://runtime.example.com/arcp",
);
await client.connect(transport);
```

`WebSocketTransport.connect(url)` opens a single WebSocket and resolves
once the socket is OPEN. In Node it uses the [`ws`][ws] package, which
is a direct dependency of `@agentruntimecontrolprotocol/core` and
`@agentruntimecontrolprotocol/node`. For browser bundles use the
global `WebSocket` and pass it through `new WebSocketTransport(socket)`.

[ws]: https://www.npmjs.com/package/ws

### When to use

- Remote runtimes, hosted services.
- Long-lived streaming workloads.
- When you want resume + reconnection (the resume token only matters
  if the transport can drop, which it can on the network).

### DNS-rebind protection

When attaching to an existing HTTP server you can browse to from a
DNS-pinned name, the WS upgrade handshake should validate `Host`.
Pass `allowedHosts: string[]` to `attachArcpUpgrade` (from
`@agentruntimecontrolprotocol/node`), or to the framework adapters
that wrap it (`@agentruntimecontrolprotocol/express`, `/fastify`,
`/hono`). The check strips the port and matches the bare hostname.

## stdio

A pair of pipes. The runtime reads envelopes from `stdin`, writes them
to `stdout`. Useful for subprocess agents.

### As a subprocess (parent is the client)

```sh
# Spawn the runtime as a child
pnpm tsx packages/sdk/src/cli.ts serve --transport stdio \
  --token tok --principal me
```

```ts
import { StdioTransport, ARCPClient } from "@agentruntimecontrolprotocol/sdk";
import { spawn } from "node:child_process";

const child = spawn("pnpm", [
  "tsx",
  "packages/sdk/src/cli.ts",
  "serve",
  "--transport",
  "stdio",
  "--token",
  "tok",
  "--principal",
  "me",
]);

const transport = new StdioTransport({
  input: child.stdout!,
  output: child.stdin!,
});

const client = new ARCPClient({
  /* ... */
});
await client.connect(transport);
```

### When to use

- Local-only agents (security-sandboxed by the OS).
- Tools spawned from a parent process (editor extensions, CLI agents).
- Tests where you want zero network.

### Limitations

- One client per process. There is no multiplexing.
- Logs must go to `stderr` (or be silenced). Anything on `stdout` that
  isn't a valid envelope breaks the channel.

## In-memory

`pairMemoryTransports()` returns two `MemoryTransport` halves
connected to each other:

```ts
import { pairMemoryTransports } from "@agentruntimecontrolprotocol/sdk";

const [c, s] = pairMemoryTransports();
await server.accept(s);
await client.connect(c);
```

No serialization, no copy. Frames are object-identical between sides.

### When to use

- Unit and integration tests — the entire SDK test suite uses this.
- Single-process demos and tutorials.
- Embedding the runtime inside the same process as the client (e.g.,
  a SaaS app that runs agents inline).

### Caveats

- You lose the JSON round-trip, which can hide schema-mismatch bugs.
  When in doubt, run the integration tests over WebSocket too.

## Writing your own

Implement the four methods, preserve order, and respect `closed`. A
useful reference is `MemoryTransport`
([`packages/core/src/transport/memory.ts`](../packages/core/src/transport/memory.ts)) —
it's about 60 lines.

The runtime calls `onClose` once when the peer hangs up; you must call
it exactly once even if `close()` is called on your side first.

## With OTel tracing

Wrap any transport with `withTracing()` from
[`@agentruntimecontrolprotocol/middleware-otel`](./packages/middleware-otel.md):

```ts
import { withTracing } from "@agentruntimecontrolprotocol/middleware-otel";
import { trace } from "@opentelemetry/api";

const traced = withTracing(transport, {
  tracer: trace.getTracer("arcp-client"),
});
await client.connect(traced);
```

W3C trace context is injected into the envelope's
`extensions["x-vendor.opentelemetry.tracecontext"]` so spans propagate
across the runtime.
