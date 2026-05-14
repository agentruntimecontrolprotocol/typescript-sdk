# Delegation example (two-process)

Unlike the other examples — which pair a runtime and a client in the
same Node process over an in-memory transport — this one runs the
runtime and the client as **two separate processes** talking over
WebSocket. That matches how production deployments actually look.

## Run

In one terminal:

```sh
pnpm tsx examples/delegate/server.ts
```

It listens on `ws://127.0.0.1:7878/arcp` and registers two agents:

- `build` (parent): runs a fake build, then delegates the test suite.
- `test` (child): runs a fake test suite.

In a second terminal:

```sh
pnpm tsx examples/delegate/client.ts
```

The client submits a `build` job, prints the interleaved parent +
child event stream (one `event_seq` space, two jobs), and verifies
the child inherited the parent's `trace_id`. Stop the server with
`Ctrl+C`.

## What it demonstrates

- §10.1 `delegate` as a `job.event` kind, not a separate envelope.
- §10.3 child inherits parent's `trace_id`.
- §8.3 session-scoped monotonic `event_seq` across concurrent jobs.
- §9.4 child's `lease_request` is enforced as a subset of the parent's
  effective lease at delegation time.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7878`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7878/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
