# Observability (§11)

ARCP carries W3C trace context end to end. With
[`@arcp/middleware-otel`](../packages/middleware-otel.md), every
envelope generates a span and every job becomes a unit of work in
your tracing backend.

## Trace propagation

Every envelope can carry a `trace_id` at the top level and a
`traceparent`/`tracestate` pair inside
`extensions["x-vendor.opentelemetry.tracecontext"]`. The OTel
middleware injects these on send and extracts them on receive — so
the runtime side starts a child span linked to the client's span.

```ts
// envelope on the wire:
{
  arcp: "1",
  id: "01J…",
  type: "job.submit",
  trace_id: "0123456789abcdef0123456789abcdef",
  payload: { agent: "echo", input: {} },
  extensions: {
    "x-vendor.opentelemetry.tracecontext": {
      traceparent: "00-0123…-…",
      tracestate: "vendor=value",
    },
  },
}
```

## Setup

```ts
import { withTracing } from "@arcp/middleware-otel";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("arcp-client", "1.0.0");

const transport = await WebSocketTransport.connect("wss://…/arcp");
const traced = withTracing(transport, { tracer });

await client.connect(traced);
```

Same on the runtime side:

```ts
const tracer = trace.getTracer("arcp-runtime", "1.0.0");

startWebSocketServer({
  onTransport: (t) => server.accept(withTracing(t, { tracer })),
});
```

## Span shape

The middleware emits two span types per envelope:

| Span | Attributes |
| --- | --- |
| `arcp.send` | `arcp.type`, `arcp.id`, `arcp.session_id`, `arcp.job_id?`, `arcp.event_seq?` |
| `arcp.recv` | same |

For `job.submit` / `job.accepted` / `job.result` / `job.error`, the
middleware also attaches: `arcp.agent`, `arcp.lease`, `arcp.budget`
(v1.1).

Customize span names via options:

```ts
withTracing(transport, {
  tracer,
  sendSpanName: (frame) => `arcp.send.${frame.type}`,
  recvSpanName: (frame) => `arcp.recv.${frame.type}`,
});
```

## Per-job spans

A job is a useful boundary for application spans. Inside an agent:

```ts
server.registerAgent("report", async (input, ctx) => {
  // The current span context is set by the OTel middleware from the
  // incoming traceparent; child spans nest naturally.
  await tracer.startActiveSpan("collect-sources", async (span) => {
    span.setAttribute("source.count", input.sources.length);
    await collect(input.sources);
    span.end();
  });

  return { ok: true };
});
```

You don't have to thread the trace through manually — OTel context
follows async hops via `AsyncLocalStorage`, and the middleware sets
the context before invoking handlers.

## Delegation cascades

Children inherit the parent's `trace_id`, so delegate jobs become
child spans of the parent automatically:

```
client                  runtime
  span "submit"          span "job.run orchestrator"
                          ├─ span "job.run pdf-renderer"
                          └─ span "job.run summarizer"
```

See [delegation.md](./delegation.md#trace-propagation).

## Without OTel

If you don't want OTel, you can still set `trace_id` manually on every
`submit`:

```ts
import { newId } from "@arcp/core";

const traceId = newId({ length: 32 }) as TraceId; // 32 hex
await client.submit({
  agent: "x",
  input: {},
  traceId,
});
```

`trace_id` is just a 32-hex string; the runtime propagates it to all
events under that job and to any children spawned via delegate. Use
it for log correlation even without distributed tracing.

## Heartbeats vs spans

The v1.1 heartbeat (§6.4) is for keep-alive, not observability. Don't
emit a span per heartbeat — it's high-frequency, low-value noise. The
OTel middleware filters out `session.heartbeat` / `session.pong` by
default.

## Per-session log binding

`@arcp/core`'s logger is `pino`-shaped:

```ts
import { rootLogger, sessionLogger } from "@arcp/core";

const log = sessionLogger(rootLogger, { session_id: ctx.sessionId });
log.info({ job_id: ctx.jobId }, "starting");
```

`ctx.logger` is pre-bound to `session_id` and `job_id`. Log entries
naturally correlate with traces if you emit `trace_id` as a field —
recommended pattern:

```ts
const log = ctx.logger.child({ trace_id: ctx.traceId });
log.info("starting work");
```

## Sampling

OTel sampling is your call — the middleware just emits spans into
whatever tracer you pass. For high-throughput runtimes, sample at the
collector rather than at the SDK to keep parent/child relationships
intact.

## Runnable example

[`examples/tracing/`](../../examples/tracing/) — full client + runtime
with OTel SDK wired up to a console exporter, including delegation.
