# subscribe example (v1.1)

Demonstrates ARCP v1.1's cross-session observation primitives:
`session.list_jobs` discovers in-flight jobs accessible to the
current principal, and `job.subscribe` attaches a live event stream
(with optional history replay) to a job submitted on a different
session.

The demo runs two `ARCPClient` instances in one process — Client A
submits a `timer` job, Client B discovers and subscribes to it
(replays history + tails live), then attempts to cancel (denied;
cancel is restricted to the submitting session).

## Run

In one terminal:

```sh
pnpm tsx examples/subscribe/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/subscribe/client.ts
```

## What it demonstrates

- §7.6 `job.subscribe` / `job.subscribed` / `job.unsubscribe`.
- §6.6 `session.list_jobs` discovers principal-visible jobs.
- §7.4 cancellation is reserved to the submitting session.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7888`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7888/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
