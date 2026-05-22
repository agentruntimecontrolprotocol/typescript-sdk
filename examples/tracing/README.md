# Tracing example (`@agentruntimecontrolprotocol/middleware-otel`)

End-to-end OpenTelemetry: every envelope on the wire (in either
direction) emits a span, and W3C trace context (`traceparent` /
`tracestate`) rides along inside `envelope.extensions["x.otel"]` so
the spans link into one distributed trace.

The middleware MUST be wired on **both** sides. If only one side wires
it, that side's spans are correct in isolation, but the peer creates
fresh root spans instead of linking — the trace splits.

## Run

In one terminal:

```sh
pnpm tsx examples/tracing/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/tracing/client.ts
```

Both processes use `ConsoleSpanExporter`, so spans land on stdout.

## What you see

On the client:

- `arcp.send job.submit` (PRODUCER)
- `arcp.recv job.accepted` (CONSUMER), parent of the corresponding
  server-side `arcp.send job.accepted`
- One `arcp.recv job.event` per event
- `arcp.recv job.result`

On the server:

- `arcp.recv job.submit` (CONSUMER), parent of the server's own
  delegation chain
- `arcp.send job.accepted`, then one `arcp.send job.event` per emitted
  event, then `arcp.send job.result`
- The same span tree spans the CHILD job — `trace_id` is inherited
  through delegation per §10.3, so the child's `arcp.send job.accepted`
  shares the same trace as the parent's `arcp.send job.submit`.

Each span carries `arcp.*` attributes — `arcp.session_id`,
`arcp.job_id`, `arcp.agent`, `arcp.event_seq`, `arcp.lease.capabilities`
— so the trace is searchable by ARCP identity in whatever backend you
ship them to.

The client also prints each event's `trace_id` so you can confirm at a
glance that the parent and child events share one trace id.

## Production

`ConsoleSpanExporter` is for demos. In production, swap the
`SimpleSpanProcessor(new ConsoleSpanExporter())` for a
`BatchSpanProcessor(new OTLPTraceExporter({ url }))` pointing at Jaeger,
Tempo, Honeycomb, or any OTLP receiver.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7895`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7895/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |

## Spec sections

- §11 Trace propagation (W3C context via `extensions["x.otel"]`)
- §10.3 trace inheritance on delegation
