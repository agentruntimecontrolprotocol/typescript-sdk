# Job events (§8)

Every signal an agent emits during a job is one `job.event` envelope.
There are eight reserved kinds plus the `x-vendor.*` extension
namespace.

## The eight kinds

| Kind           | Body                                            | Purpose                                    |
| -------------- | ----------------------------------------------- | ------------------------------------------ |
| `log`          | `{ level, message, attributes? }`               | Plain log line.                            |
| `thought`      | `{ text }`                                      | Model reasoning / internal monologue.      |
| `tool_call`    | `{ tool, args, call_id }`                       | Agent invoked a tool.                      |
| `tool_result`  | `{ call_id, result? \| error? }`                | Result for a `tool_call`.                  |
| `status`       | `{ phase, message? }`                           | Lifecycle hint (`running`, `fetching`, …). |
| `metric`       | `{ name, value, unit?, attributes? }`           | Numeric measurement.                       |
| `artifact_ref` | `{ uri, content_type, byte_size?, sha256? }`    | Reference to an artifact.                  |
| `delegate`     | `{ delegate_id, agent, input, lease_request? }` | Spawn a child job (§10).                   |

`tool_result` carries either `result` or `error` (mutually exclusive).
`artifact_ref` is a reference; storage is out of scope for ARCP. The
client is expected to fetch from `uri` separately.

## Emitting from an agent

`JobContext` (`ctx`) exposes one method per kind:

```ts
server.registerAgent("research", async (input, ctx) => {
  await ctx.status("running");
  await ctx.log("info", "search start", { query: input.query });
  await ctx.thought("breaking the query into sub-tasks");

  await ctx.toolCall({
    tool: "web.search",
    args: { q: input.query },
    call_id: "s1",
  });
  // …
  await ctx.toolResult({
    call_id: "s1",
    result: {
      hits: [
        /* … */
      ],
    },
  });

  await ctx.metric({ name: "tokens.in", value: 1284, unit: "tokens" });
  await ctx.artifactRef({
    uri: "s3://reports/2026-W19.md",
    content_type: "text/markdown",
    byte_size: 11_482,
    sha256: "abc…",
  });

  return { ok: true };
});
```

Each emission is awaited because the runtime may apply back-pressure
when the client falls behind on ack (see [sessions.md#back-pressure-ack-v11-65](./sessions.md#back-pressure-ack-v11-65)).

## Receiving on the client

```ts
client.on("job.event", (env) => {
  if (env.job_id !== myJobId) return;
  const { kind, body } = env.payload;
  switch (kind) {
    case "log":
      console.log(`[${body.level}] ${body.message}`);
      break;
    case "status":
      console.log(`status → ${body.phase}`);
      break;
    case "metric":
      metrics[body.name] = (metrics[body.name] ?? 0) + body.value;
      break;
    case "artifact_ref":
      queueDownload(body.uri);
      break;
  }
});
```

For typed dispatch you can narrow with `asEnvelopeOfType`:

```ts
import { asEnvelopeOfType } from "@arcp/client";

client.on("job.event", (env) => {
  const e = asEnvelopeOfType(env, "job.event");
  if (!e) return;
  // e.payload is typed
});
```

## Sequence numbers (§8.3)

`event_seq` is **session-scoped**, not job-scoped. One counter spans
every concurrent job in the session:

```
session S, two concurrent jobs A and B:

  A: event_seq = 1
  B: event_seq = 2
  A: event_seq = 3
  A: event_seq = 4
  B: event_seq = 5
```

The counter is strictly monotonic and gap-free. Across resume the
sequence preserves both properties: replay starts from
`last_event_seq + 1` with no holes.

This is what lets a single ack value (`last_event_seq`) carry
information about every job in the session — that's how
[back-pressure](./sessions.md#back-pressure-ack-v11-65) is built.

## Progress events (v1.1, §8.2.1)

`ctx.progress(current, opts)` is a convenience wrapper around `status`
that includes a structured numeric tracker:

```ts
for (let i = 0; i < urls.length; i++) {
  await ctx.progress(i + 1, {
    total: urls.length,
    units: "urls",
    message: `processed ${urls[i]}`,
  });
}
```

The body shape is a `status` with `phase: "progress"` and a payload
that conforms to the v1.1 progress schema.

## Result streaming (v1.1, §8.4)

For results too large to send in a single `job.result`, use the result
stream:

```ts
server.registerAgent("big-report", async (input, ctx) => {
  const stream = ctx.streamResult({});
  for await (const chunk of generateChunks()) {
    await stream.write(chunk, { encoding: "utf8" });
  }
  await stream.finalize(undefined, {
    summary: "monthly report",
    resultSize: totalBytes,
  });
  // No explicit return — finalize() emits job.result.
});
```

Client side:

```ts
const handle = await client.submit({ agent: "big-report", input: {} });
const buf = await handle.collectChunks(); // assembles result_chunk events
```

`result_chunk` events carry `{ result_id, seq, encoding, data, final? }`
in a sub-stream within the larger job. Same overall `event_seq`
ordering applies — chunks interleave normally with other events.

## Vendor extension events

Kinds outside the reserved eight must use the `x-vendor.<vendor>.<kind>`
namespace:

```ts
await ctx.emitEvent("x-vendor.acme.confidence", { score: 0.87 });
```

See [vendor-extensions.md](./vendor-extensions.md) for namespacing
rules and round-trip guarantees.

## Lease enforcement on emission

`tool_call`, `delegate`, and any vendor event that interacts with the
outside world is gated by the lease. The runtime calls
`validateLeaseOp(lease, capability, target)` before forwarding:

- `tool_call` checks `tool.call:<tool-name>`.
- `delegate` validates the child's `lease_request` is a subset of the
  parent's effective lease (§10).
- `artifact_ref` does not check the lease — references are purely
  informational.

A violation surfaces as a `tool_result` event on the **parent** with
`error.code: "PERMISSION_DENIED"`, not as a session error. See
[leases.md](./leases.md) and [delegation.md](./delegation.md).

## Back-pressure interaction

When the `ack` feature is negotiated, the runtime tracks
`event_seq - last_acked_event_seq`. Once it exceeds
`backPressureThreshold` (default 1000), `ctx.*` emission methods stall
on a per-session semaphore until the client acks more events.

This means slow consumers throttle agent emission rather than dropping
events or queueing unboundedly. Tune with `backPressureThreshold` on
`ARCPServerOptions`.

## Runnable examples

- [`examples/submit-and-stream/`](../../examples/submit-and-stream/) — emit and observe all eight kinds.
- [`examples/progress/`](../../examples/progress/) — v1.1 progress wrapper.
- [`examples/result-chunk/`](../../examples/result-chunk/) — chunked result streaming.
- [`examples/ack-backpressure/`](../../examples/ack-backpressure/) — observe stall + drain.
- [`examples/vendor-extensions/`](../../examples/vendor-extensions/) — custom event kinds.
