# subscriptions

One producing session, three Observer clients, three different sinks.
None of them ever issue a command.

## Before ARCP

Most teams sidecar the agent with a tee: agent emits to stdout, a
shipper tails the log, a second tail re-parses for metrics, a third
process writes to SQLite for replay. Three pipelines diverge over
time, none of them know about each other, and adding a fourth
consumer means another sidecar.

## With ARCP

```ts
const client = new ARCPClient({ /* ... observer client ... */ });
const sub = await client.subscribe({ filter: { session_id: [target], types: ["metric"] } });
for (;;) {
  const next = await sub.feed.next();
  if (next.done) break;
  await sink.handle(next.value);
}
```

Three observers. One transport each. Filters declared inline. The
agent never knows they exist.

## ARCP primitives

- Subscriptions, filters, Observer role — RFC §13, §5.
- `since.after_message_id` backfill + the synthetic
  `subscription.backfill_complete` marker — §13.3.
- Standard metrics + trace spans — §17.
- Stream-kind filtering for `kind: thought` redaction — §11.4.

## File tour

- `main.ts` — boots three clients in parallel.
- `sinks/stdout_sink.ts` — log-summarizer.
- `sinks/sqlite_sink.ts` — uses the SDK's `EventLog` schema.
- `sinks/otlp_sink.ts` — `metric` and `trace.span` → OTLP.

## Variations

- Replace SQLite with ClickHouse for fleet-wide replay.
- Tee stdout into Slack via a `min_priority: critical` filter.
- A fourth subscriber on `kind: thought` only, gated by stricter
  access control.
