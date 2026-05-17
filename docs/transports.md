# Transports

A `Transport` is a duplex frame channel. The SDK ships three; you can
write your own by implementing the
[`Transport` interface](../packages/core/src/transport/types.ts).

```ts
interface Transport {
  send(frame: WireFrame): Promise<void>;
  onFrame(handler: FrameHandler): void;
  onClose(handler: (reason?: string) => void): void;
  close(reason?: string): Promise<void>;
  readonly closed: boolean;
}
```

Frames are JSON-encoded envelopes (text) or binary. The transport
preserves order per logical stream (session-scoped, or job-scoped for
streaming results). Handlers are awaited before the next inbound frame
is dispatched.

## WebSocket

Production default. Bidirectional, framed, fits naturally over TLS.

### Server

```ts
import { startWebSocketServer } from "@arcp/sdk";

const wss = await startWebSocketServer({
  host: "127.0.0.1",
  port: 7777,
  path: "/arcp", // optional, default "/arcp"
  allowedHosts: ["api.example.com"], // optional DNS-rebind protection
  onTransport: (t) => server.accept(t),
});
console.log(wss.url); // ws://127.0.0.1:7777/arcp
await wss.close();
```

For an existing Node `http.Server`, use the
[`@arcp/node` middleware](./packages/node.md):

```ts
import { attachArcpUpgrade } from "@arcp/node";

const handle = attachArcpUpgrade(httpServer, {
  path: "/arcp",
  onTransport: (t) => server.accept(t),
});
```

### Client

```ts
import { WebSocketTransport } from "@arcp/sdk";

const transport = await WebSocketTransport.connect(
  "wss://runtime.example.com/arcp",
  {
    headers: {
      /* optional, browsers ignore */
    },
  },
);
await client.connect(transport);
```

In browsers, `WebSocketTransport` uses the global `WebSocket`. In Node,
the standard library's `WebSocket` (Node ≥22) is used; no `ws` dep.

### When to use

- Remote runtimes, hosted services.
- Long-lived streaming workloads.
- When you want resume + reconnection (the resume token only matters
  if the transport can drop, which it can on the network).

### DNS-rebind protection

When attaching to an existing HTTP server you can browse to from a
DNS-pinned name, the WS upgrade handshake should validate `Host`. The
`@arcp/express` helper does this for you; pass `allowedHosts` to the
others.

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
import { StdioTransport, ARCPClient } from "@arcp/sdk";
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
  /* … */
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
import { pairMemoryTransports } from "@arcp/sdk";

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
[`@arcp/middleware-otel`](./packages/middleware-otel.md):

```ts
import { withTracing } from "@arcp/middleware-otel";
import { trace } from "@opentelemetry/api";

const traced = withTracing(transport, {
  tracer: trace.getTracer("arcp-client"),
});
await client.connect(traced);
```

W3C trace context is injected into the envelope's
`extensions["x-vendor.opentelemetry.tracecontext"]` so spans propagate
across the runtime.
