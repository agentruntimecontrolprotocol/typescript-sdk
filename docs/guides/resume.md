# Resume (§6.3)

A resume token lets a client recover an existing session after the
transport drops. The runtime buffers events; the client replays them
strictly after a last-seen sequence number, then continues streaming
live. No work is lost as long as the resume happens inside the
advertised window.

## Mechanics

1. Every `session.welcome` carries a fresh `resume_token` and a
   `resume_window_sec`.
2. The client persists `(session_id, resume_token, last_event_seq)`
   somewhere durable enough to outlive the disconnect (memory is fine
   for tab refreshes; disk for crashes).
3. On reconnect, the client opens a fresh transport and issues
   `session.hello` with `payload.resume = { session_id, resume_token,
   last_event_seq }`.
4. The runtime validates the token, **rotates it** (single-use), and
   replays buffered events with `event_seq > last_event_seq`, then
   resumes live streaming.

Past the window, resume is rejected with `RESUME_WINDOW_EXPIRED` and
the client must start a new session.

## API

```ts
import { WebSocketTransport } from "@arcp/sdk";

// Original connect
const welcome = await client.connect(transport);
const stash = {
  session_id: welcome.session_id,
  resume_token: welcome.resume_token,
  last_event_seq: 0,
};

client.on("job.event", (env) => {
  stash.last_event_seq = env.event_seq!; // monotonic, gap-free
});

// …transport drops…

const fresh = await WebSocketTransport.connect("wss://…/arcp");
const resumed = await client.resume(fresh, stash);
// new resume_token returned on the welcome — replace stash.resume_token
stash.resume_token = resumed.resume_token;
```

`client.resume()` returns the new welcome. Replace your stashed token
with the rotated one.

## Tracking `last_event_seq`

Sequence numbers are **session-scoped** — one counter across every
concurrent job. The client just records the highest `event_seq` it
has handled on any inbound envelope, regardless of job:

```ts
let lastSeq = client.lastEventSeqObserved;

client.on("job.event", (env) => {
  lastSeq = Math.max(lastSeq, env.event_seq!);
});
client.on("job.result", (env) => {
  lastSeq = Math.max(lastSeq, env.event_seq!);
});
client.on("job.error", (env) => {
  lastSeq = Math.max(lastSeq, env.event_seq!);
});
```

`client.lastEventSeqObserved` does this for you.

## Replay guarantees

The runtime replays in strict sequence order, gap-free. After replay
completes, live events resume from `latestSeq + 1`. The client cannot
observe duplicates or holes during resume:

```
buffer:     5 6 7 8 9 10        live: 11 12 13 …
last seen:        ^7
replay:       8 9 10  →  11 12 13 …
```

If `last_event_seq` is **higher** than what the runtime has buffered,
the runtime treats this as a malformed resume (the client claimed to
have seen events that don't exist) and rejects with
`INVALID_REQUEST`.

## Window expiry

`resume_window_sec` defaults to 600 (10 min). Configure it on the
runtime:

```ts
new ARCPServer({
  // …
  resumeWindowSeconds: 1800, // 30 min
});
```

Past the window, the runtime sweeps the session's buffered events and
discards the resume token. A subsequent resume attempt returns
`RESUME_WINDOW_EXPIRED`; the client must start fresh.

## Auth invariants

Resume must come from the **same principal** that opened the session.
The runtime verifies the bearer token on `session.hello` (same as
initial connect) and additionally checks that the principal matches
the session owner. A token leak is therefore still bounded to the
principal's authority.

## When jobs are pending across a resume

Jobs do not pause during disconnect. They continue running on the
runtime; their events buffer in the session's event log waiting for
the client to reconnect. On resume, you see the events that
accumulated, then live ones as they happen.

If a job terminates while the client is disconnected (within the
window), the `job.result` or `job.error` envelope is in the replay
buffer too — the client sees a synthetic-looking "buffered" terminal
event on resume.

## Idempotent submit + resume

For jobs you don't want to double-submit on retry, set
`idempotencyKey`:

```ts
const handle = await client.submit({
  agent: "weekly-report",
  input: { week: "2026-W19" },
  idempotencyKey: "weekly-report-2026-W19",
});
```

The runtime caches the `(principal, idempotency_key)` tuple for
`idempotencyTtlMs` (default 24h). A duplicate submit returns the
existing job's `job.accepted` and replays events from `event_seq = 0`,
even if you've never seen this job before. Combine with resume to
implement crash-safe submission.

## Runnable example

[`examples/resume/`](../../examples/resume/) — drop the connection
mid-stream and recover all events.
