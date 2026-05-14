# Resume (two-process)

Demonstrates the disconnect → reconnect → replay flow. The client opens
a session, runs a job to completion (so all events sit in the runtime's
EventLog), drops the transport without `session.bye`, then opens a
fresh transport and resumes the same `session_id`. The client passes a
synthetic `last_event_seq=2` to prove the runtime replays the tail
(seq > 2) — the same code path that recovers from a real mid-stream
crash. The fresh `resume_token` is verified to differ from the prior
one.

## Run

In one terminal:

```sh
pnpm tsx examples/resume/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/resume/client.ts
```

## What it demonstrates

- §13.3 / §6.3 resume after disconnect using `session.hello.payload.resume`.
- §6.3 `resume_token` rotation on every welcome (old token single-use).
- §8.3 monotonic, gap-free `event_seq` across the reconnect; replayed
  events advance the local counter so live events resume from there.

## Configuration

| Env var | Default | Used by |
|---|---|---|
| `ARCP_DEMO_PORT` | `7880` | server |
| `ARCP_DEMO_URL`  | `ws://127.0.0.1:7880/arcp` | client |
| `ARCP_DEMO_TOKEN`| `demo-token` | both |
