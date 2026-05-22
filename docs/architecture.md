# Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/architecture-dark.svg">
  <img alt="ARCP TypeScript SDK architecture" src="../diagrams/architecture-light.svg">
</picture>

## Layering

The SDK is a pnpm monorepo. Every package is ESM-only and strictly
typed against TypeScript 5.6 with `exactOptionalPropertyTypes`.

```
@agentruntimecontrolprotocol/sdk           — meta, re-exports the three below; ships `arcp` CLI
├── @agentruntimecontrolprotocol/client    — ARCPClient (consumer side)
├── @agentruntimecontrolprotocol/runtime   — ARCPServer + Job + Lease + BearerVerifier
└── @agentruntimecontrolprotocol/core      — wire primitives shared by client + runtime
```

Middleware packages are optional adapters around `@agentruntimecontrolprotocol/core`'s
`Transport` contract:

```
@agentruntimecontrolprotocol/node          — Node http.Server WS upgrade
@agentruntimecontrolprotocol/express       — Express app + DNS-rebind protection
@agentruntimecontrolprotocol/fastify       — Fastify upgrade
@agentruntimecontrolprotocol/hono          — Hono app for @hono/node-server
@agentruntimecontrolprotocol/bun           — Bun.serve({ websocket }) wrapper
@agentruntimecontrolprotocol/middleware-otel — OTel span emission + W3C trace propagation
```

## `@agentruntimecontrolprotocol/core`

The shared kernel: nothing in here knows about being a client or a
runtime. It exports:

- **Envelope schema** — Zod definitions for every message type, plus
  `Envelope` as a discriminated union and helpers like `buildEnvelope()`,
  `messageEnvelope()`, `isPreSessionType()`.
- **Branded IDs** — `JobId`, `SessionId`, `MessageId`, `TraceId`, and
  `EventSeq` are brand types; you cannot mix them up by accident, and
  schema validation enforces format constraints (e.g., `TraceId` must
  be 32 lowercase hex chars).
- **Error taxonomy** — one class per code in `ERROR_CODES`; the base
  is `ARCPError`. All errors carry a structured `ErrorPayload` for
  wire emission.
- **Transports** — `Transport` interface plus three implementations:
  `MemoryTransport` (pair via `pairMemoryTransports()`),
  `StdioTransport`, `WebSocketTransport` + `startWebSocketServer()`.
- **Session state** — `SessionState` is the phase machine
  (`pre-handshake` → `awaiting-welcome` → `accepted` → `closed`), and
  `PendingRegistry` tracks awaiting request/response correlations.
- **Event log** — `EventLog` interface with a SQLite-backed default
  for replay during resume (§6.3).
- **Auth verifier** — `BearerVerifier` interface and
  `StaticBearerVerifier` for tests.
- **Capability negotiation** — `negotiateCapabilities()` computes the
  intersection of advertised features, with `V1_1_FEATURES` as the
  default opt-in set.

See [packages/core.md](./packages/core.md).

## `@agentruntimecontrolprotocol/client`

A single class: `ARCPClient`. It owns one transport at a time, drives
the handshake, manages the pending-request map, dispatches inbound
envelopes to registered handlers, and exposes:

- `connect(transport)` — handshake; returns the welcome payload.
- `resume(transport, resumeInfo)` — single-use token, replay events.
- `submit(opts)` — issue `job.submit`, await `job.accepted`, return a
  `JobHandle` whose `.done` resolves on the terminal result.
- `subscribe(jobId, opts)` — v1.1, attach to a job from a second
  session (§6.6).
- `listJobs(filter)` — v1.1, paginated listing (§6.6).
- `cancelJob(jobId)` — cooperative cancellation with 30-second grace.
- `ack(seq)` — v1.1 back-pressure ack.

See [packages/client.md](./packages/client.md).

## `@agentruntimecontrolprotocol/runtime`

Two main classes: `ARCPServer` and `SessionContext`. `ARCPServer`
holds the agent registry and shared resources (event log, bearer
verifier, idempotency cache); `SessionContext` is created per
accepted transport and runs the per-session machinery (dispatch,
heartbeat, ack tracking, subscription set).

Agents are functions registered by name:

```ts
server.registerAgent("name", async (input, ctx) => {
  await ctx.status("running");
  await ctx.log("info", "starting");
  return { ok: true };
});
```

The `JobContext` (`ctx`) is the agent's window into the runtime: it
emits all eight reserved `job.event` kinds plus vendor extensions,
exposes the immutable `lease`, surfaces the cancellation `AbortSignal`,
and (v1.1) provides budget tracking, lease constraints, and a
streaming `ResultStream` for chunked results (§8.4).

`Job` is a value object describing a single in-flight job. The
runtime transitions it through
`pending → running → {success|error|cancelled|timed_out}` (§7.3).

See [packages/runtime.md](./packages/runtime.md).

## `@agentruntimecontrolprotocol/sdk`

Meta-package. Drop-in replacement for the pre-split
`@agentruntimecontrolprotocol/sdk`:

```ts
import { ARCPClient, ARCPServer, pairMemoryTransports } from "@agentruntimecontrolprotocol/sdk";
```

It also ships the `arcp` CLI binary — see [cli.md](./cli.md).

## Middleware

Middleware packages don't add protocol semantics; they're adapters
that produce a `Transport` from a host framework. The runtime never
knows it's running inside Express vs Fastify vs Bun — it just sees
transports flow through `server.accept(transport)`.

The OTel middleware is different: it wraps an existing transport,
injecting W3C trace context into envelope extensions on send and
emitting spans for each frame. Use it when you want per-job spans in
your observability stack.

See [packages/](./packages/) for one page per middleware.

## Wire format

Every message is one JSON object with a small fixed envelope:

| Field        | Required                                 | Notes                                                |
| ------------ | ---------------------------------------- | ---------------------------------------------------- |
| `arcp`       | always                                   | `"1.1"` (the v1.1 wire-format version literal)       |
| `id`         | always                                   | ULID or UUIDv7, unique per message                   |
| `type`       | always                                   | discriminator (`"session.hello"`, `"job.submit"`, …) |
| `payload`    | always                                   | type-specific body                                   |
| `session_id` | after handshake                          | absent on pre-session frames                         |
| `job_id`     | job-scoped envelopes                     | set on `job.*` types                                 |
| `event_seq`  | `job.event` / `job.result` / `job.error` | strictly monotonic per session                       |
| `trace_id`   | optional                                 | W3C 32-hex                                           |
| `extensions` | optional                                 | `x-vendor.*`-keyed extension object                  |

Anything else on the wire is ignored. Unknown `x-vendor.*` types are
round-tripped per §15 — see [vendor-extensions.md](./guides/vendor-extensions.md).

## Where to read the code

- Envelope schemas: [`packages/core/src/envelope.ts`](../packages/core/src/envelope.ts) and [`packages/core/src/messages/`](../packages/core/src/messages/)
- Transports: [`packages/core/src/transport/`](../packages/core/src/transport/)
- Client: [`packages/client/src/client.ts`](../packages/client/src/client.ts)
- Server + dispatch: [`packages/runtime/src/server.ts`](../packages/runtime/src/server.ts)
- Job + JobContext: [`packages/runtime/src/job.ts`](../packages/runtime/src/job.ts)
- Lease validation: [`packages/runtime/src/lease.ts`](../packages/runtime/src/lease.ts)
