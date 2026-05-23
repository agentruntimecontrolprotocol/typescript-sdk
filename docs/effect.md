# Effect-native surface

Every part of the SDK ships an Effect-shaped twin alongside the
legacy class / callback API. The two surfaces share state — picking
one does not lock you out of the other. The legacy class API
(`ARCPClient`, `ARCPServer`, `SessionContext`, callback-style
`Transport`) is the wire-format source of truth and what the test
suite pins; the Effect surface is a thin layer that runs the same
underlying machinery through `Effect`, `Layer`, `Stream`, and
`ManagedRuntime`.

This page is the map. For each subsystem, the corresponding
[package page](./packages/) lists the imports.

## When to reach for it

- You already have an `Effect`/`Layer` graph and want ARCP to
  participate as a service instead of a Promise.
- You want `Stream`-based inbound frames instead of
  `transport.onFrame(handler)` callbacks.
- You want deterministic resource cleanup via
  `ManagedRuntime.dispose()` (the runtime layer binds the legacy
  `ARCPServer.close()` to the scope's finalizer).
- You want typed errors through `TaggedAgentNotAvailable` /
  `TaggedTimeout` / `TaggedTransportError` instead of `instanceof
  ARCPError` branches.

Mix and match — Effect-aware code can still hold a legacy
`ARCPClient` / `ARCPServer` instance via the bound service.

## Quick start

```ts
import { Effect, ManagedRuntime } from "effect";
import {
  ARCPRuntimeLayer,
  ARCPServerService,
  acceptSessionEffect,
} from "@agentruntimecontrolprotocol/runtime";
import { memoryTransportEffect } from "@agentruntimecontrolprotocol/core";

const runtime = ManagedRuntime.make(
  ARCPRuntimeLayer({
    runtime: { name: "demo", version: "0.1.0" },
    capabilities: { encodings: ["json"] },
    bearerTable: new Map([["tok", { principal: "alice" }]]),
  }),
);

// Register agents on the bound legacy server:
await runtime.runPromise(
  Effect.gen(function* () {
    const { server } = yield* ARCPServerService;
    server?.registerAgent("echo", async (input) => ({ echoed: input }));
  }),
);

// Accept a session driven by an Effect-shaped transport:
const [, serverHalf] = pairMemoryTransportsEffect();
await runtime.runPromise(acceptSessionEffect(serverHalf));

// ...later — closes the SQLite log + clears the resume sweep timer.
await runtime.dispose();
```

## Layers and services

### Runtime side — `@agentruntimecontrolprotocol/runtime`

| Symbol                                | Shape                                                       |
| ------------------------------------- | ----------------------------------------------------------- |
| `ARCPRuntimeLayer(opts)`              | `Layer` composing every Effect service below + the scoped `ARCPServer`. |
| `ARCPRuntimeLayerOptions`             | `ARCPServerOptions` extended with `bearerTable?`, `bearerVerifierLayer?`, `eventLogLayer?`. |
| `ARCPServerService`                   | Service that yields `{ server: ARCPServer \| null }`. Lifecycle bound to the layer's scope. |
| `makeARCPServerRuntime(opts)`         | Convenience: `ManagedRuntime.make(ARCPRuntimeLayer(opts))`. |
| `acceptSessionEffect(transport)`      | Adapts a `TransportEffect` to the legacy `Transport` and hands it to `server.accept`. |
| `resumeSweepDaemon(intervalMs)`       | Effect daemon that drives `ResumeStoreService.sweep` on a `Schedule.fixed`. `Effect.forkScoped` it inside the runtime. |
| `JobService` / `jobLayer`             | Per-job Effect. |
| `JobManagerService` / `jobManagerLayer` | Per-session job inventory. |
| `makeJobEffect` / `makeJobManagerEffect` / `watchdogEffect` | Building blocks reused by the runtime. |
| `SessionContextService` / `sessionContextLayer` / `makeSessionContextEffect` | Per-session machinery. |
| `validateLeaseOpEffect` / `validateLeaseConstraintsEffect` / `assertLeaseSubsetEffect` / `assertLeaseConstraintsSubsetEffect` | Effect-typed lease enforcement; failures land on the typed-error channel as `ValidateLeaseOpFailure`. |

### Client side — `@agentruntimecontrolprotocol/client`

| Symbol                          | Shape                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| `ARCPClientLayer`               | `Layer` wiring `ARCPClientService` to a transport.                 |
| `ARCPClientService` / `ARCPClientServiceShape` | Service holding the bound `ARCPClient`.             |
| `makeARCPClientRuntime(opts)`   | Convenience: `ManagedRuntime.make(ARCPClientLayer(opts))`.         |
| `subscribeEnvelopes(transport)` | `Stream<Envelope, ...>` replacement for `client.on("...", handler)`. |

### Core primitives — `@agentruntimecontrolprotocol/core`

| Subsystem | Effect-shaped twin |
| --------- | ------------------ |
| Logging   | `LoggerLayer`, `PinoLogger`, `makePinoEffectLogger`, `sessionLoggerEffect(sessionId, effect)` |
| Auth      | `BearerVerifierService`, `BearerVerifierEffect`, `staticBearerVerifierLayer(table)` |
| Sessions  | `SessionStateService`, `PendingRegistryService` |
| Storage   | `EventLogService`, `EventLogEffect`, `eventLogLayer` |
| IDs       | `IdGen` (Effect.Service yielding `next: Effect<string>`) |
| Transports | `TransportEffect`, `memoryTransportEffect()`, `stdioTransportEffect(...)`, `websocketTransportEffect(socket)` |
| Errors    | `errors-tagged.ts` — `TaggedAgentNotAvailable`, `TaggedTimeout`, `TaggedInternal`, `TaggedTransportError`, etc. Round-trip via `arcpFromTagged` / `taggedFromARCP`. |

### OTel middleware — `@agentruntimecontrolprotocol/middleware-otel`

| Symbol                                       | Shape                                                              |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `OtelTracerLayer(options)`                   | `Layer` providing the tracer used by an Effect-graph runtime.      |
| `OtelTracerLayerOptions`                     | Options passed to the layer.                                       |

`withTracing(inner, options)` is the legacy callback-shape entry
point and remains the primary API; the Effect-layer twin is for
consumers that wire tracing through a `ManagedRuntime` already.

## Mixing surfaces

The Effect runtime intentionally holds the *same* legacy
`ARCPServer` / `ARCPClient` instance that callback-shape callers
use. You can:

1. Build the runtime via `makeARCPServerRuntime`.
2. Reach into the bound service and call legacy methods directly
   (`server.registerAgent`, `client.submit`, etc.).
3. Drive sessions via `acceptSessionEffect(transport)` or pass a
   legacy transport into `server.accept(transport)`.

`ManagedRuntime.dispose()` runs the layer's finalizer, which calls
`server.close()` for you — clearing the SQLite event log and the
resume-sweep `setInterval`.

## Where the boundaries are

The Effect surface deliberately **does not** re-implement:

- The §6 handshake (`session.hello` → `session.welcome`).
- The §7 job lifecycle and back-pressure tracking.
- The §6.3 resume buffer.
- The §6.5 ack accounting.

All of those continue to live on the legacy classes — the Effect
layer just composes them, binds them to a scope, and exposes a
service-shaped handle. That keeps a single source of wire-shape
truth for both surfaces.
