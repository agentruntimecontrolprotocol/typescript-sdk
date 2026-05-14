# lease-expires-at example (v1.1)

Demonstrates ARCP v1.1's `lease_constraints.expires_at`: a hard
upper bound on lease lifetime. Both the agent's per-op
`validateLeaseOp` and the runtime's expiration watchdog enforce it;
either one trips `LEASE_EXPIRED` (non-retryable) once the deadline
passes.

The agent in this demo loops once per second issuing `fs.read`
lease ops. The client submits with `expires_at = now + 5s`, so
after ~5 iterations the lease check throws and the runtime emits
the terminal `job.error` with code `LEASE_EXPIRED`.

## Run

In one terminal:

```sh
pnpm tsx examples/lease-expires-at/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/lease-expires-at/client.ts
```

## What it demonstrates

- §9.5 `lease_constraints.expires_at` enforcement.
- §12 `LEASE_EXPIRED` error code (non-retryable).
- Agent uses `validateLeaseOp` with the constraints context.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7890`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7890/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
