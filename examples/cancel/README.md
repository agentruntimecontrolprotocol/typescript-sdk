# Cancel (two-process)

Demonstrates cooperative cancellation. The client submits a long-running
job, observes a few events, and sends `job.cancel { reason }`. The
runtime aborts the agent's `ctx.signal`; the agent observes the signal
between ticks, throws `CancelledError`, and the runtime emits a
terminal `job.error` with `final_status: "cancelled"`.

Cancellation is *cooperative* in v1.0 — the runtime cannot force-kill
the agent function. Instead it gives the agent a 30 s grace period
(§7.4) to observe the signal and bail. If the grace expires, the
runtime emits the cancelled error anyway. The agent here checks
`ctx.signal.aborted` between ticks so cancellation is observed within
one tick (~100 ms).

## Run

In one terminal:

```sh
pnpm tsx examples/cancel/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/cancel/client.ts
```

## What it demonstrates

- §7.4 `job.cancel` → cooperative abort via `ctx.signal`.
- Terminal `job.error { final_status: "cancelled", code: "CANCELLED" }`.
- `handle.done` rejects with the error (the client awaits it inside a
  `try` block).
- The 30 s grace timer is configurable on `ARCPServer` via
  `cancelGraceMs`.

## Configuration

| Env var | Default | Used by |
|---|---|---|
| `ARCP_DEMO_PORT` | `7883` | server |
| `ARCP_DEMO_URL`  | `ws://127.0.0.1:7883/arcp` | client |
| `ARCP_DEMO_TOKEN`| `demo-token` | both |
