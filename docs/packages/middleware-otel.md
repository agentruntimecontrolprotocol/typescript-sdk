# @arcp/middleware-otel

OpenTelemetry middleware. Wraps any `Transport` to emit spans for
every frame and propagate W3C trace context end-to-end. Implements
ARCP §11 trace propagation.

## Install

```sh
pnpm add @arcp/middleware-otel @arcp/core @opentelemetry/api
```

You also need an OTel SDK setup (`@opentelemetry/sdk-node` or
`@opentelemetry/sdk-trace-web`) elsewhere — this package only emits
spans; it doesn't bootstrap exporters.

## Use

```ts
import { withTracing } from "@arcp/middleware-otel";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("arcp-client", "1.0.0");

// Wrap any transport:
const traced = withTracing(transport, { tracer });
await client.connect(traced);
```

Same pattern on the runtime side:

```ts
startWebSocketServer({
  onTransport: (t) => server.accept(withTracing(t, { tracer })),
});
```

## API

### `withTracing(inner, options): Transport`

| Option                             | Notes                                              |
| ---------------------------------- | -------------------------------------------------- |
| `tracer: Tracer`                   | OpenTelemetry `Tracer` instance.                   |
| `sendSpanName?: (frame) => string` | Custom span name on send. Default: `arcp.send`.    |
| `recvSpanName?: (frame) => string` | Custom span name on receive. Default: `arcp.recv`. |

Returns a new `Transport` that wraps `inner`. Calls
`inner.send`/`inner.onFrame` underneath; transparent to the rest of
the SDK.

## What it does

### On send

1. Starts a `Span` named per `sendSpanName(frame)`.
2. Injects the active span's W3C trace context into
   `frame.extensions["x-vendor.opentelemetry.tracecontext"]`.
3. Sets attributes (`arcp.type`, `arcp.id`, `arcp.session_id`,
   `arcp.job_id?`, `arcp.event_seq?`, plus type-specific attributes
   like `arcp.agent`, `arcp.lease`, `arcp.budget`).
4. Calls `inner.send(frame)`.
5. Ends the span.

### On receive

1. Reads `traceparent`/`tracestate` from
   `frame.extensions["x-vendor.opentelemetry.tracecontext"]`.
2. Starts a `Span` named per `recvSpanName(frame)` as a child of the
   extracted context.
3. Sets the OTel context for downstream handlers via
   `context.with(ctx, handler)`.
4. Ends the span when the handler resolves.

This means handler code (inside agents, inside client `on(...)`
callbacks) runs with the correct OTel context active — child spans
nest correctly without manual threading.

## Filtered frame types

Heartbeat-class frames are noisy and low-value for tracing. The
middleware suppresses spans for:

- `session.heartbeat`
- `session.pong`

Override by passing custom `sendSpanName` / `recvSpanName` that
return a non-empty name for those types (a returned empty string
suppresses the span).

## Composing with other transport wrappers

`withTracing` is a transport-in, transport-out function. You can
stack it:

```ts
const traced = withTracing(loggingWrapper(rateLimitWrapper(transport)), {
  tracer,
});
```

Order matters — tracing should usually be outermost so spans cover
the inner wrappers' work.

## Per-job span hierarchy

A typical span tree for a single job:

```
client: arcp.send (job.submit)
  ├── runtime: arcp.recv (job.submit)
  │     └── runtime: arcp.send (job.accepted)
  │            └── client: arcp.recv (job.accepted)
  ├── runtime: arcp.send (job.event ×N)
  │     └── client: arcp.recv (job.event ×N)
  └── runtime: arcp.send (job.result)
         └── client: arcp.recv (job.result)
```

Adding user-defined spans inside an agent (`tracer.startActiveSpan`)
nests under the `runtime: arcp.recv (job.submit)` span automatically.

## Delegation cascades

Children inherit the parent's `trace_id`, so a `delegate` event
becomes a child span of the parent job's `arcp.recv (job.submit)`
span. See [delegation guide](../guides/delegation.md).

## Source

[`packages/middleware/otel/src/`](../../packages/middleware/otel/src/).

## Runnable example

[`examples/tracing/`](../../examples/tracing/).
