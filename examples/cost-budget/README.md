# cost-budget example (v1.1)

Demonstrates ARCP v1.1's `cost.budget` lease capability and the
`BUDGET_EXHAUSTED` error. The lease grants `USD:1.00`; the agent
charges 0.30 per iteration via a `cost.*` metric (decremented by
the runtime); after ~4 iterations the next pre-call authorization
hits zero remaining and throws.

The runtime emits debounced `cost.budget.remaining` metrics so the
client can plot the trajectory.

## Run

In one terminal:

```sh
pnpm tsx examples/cost-budget/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/cost-budget/client.ts
```

## What it demonstrates

- §9.6 `cost.budget` lease capability and per-currency counters.
- Runtime auto-decrement on `cost.*` metrics with matching `unit`.
- Runtime-emitted `cost.budget.remaining` metric (debounced).
- §12 `BUDGET_EXHAUSTED` error code (non-retryable).

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7891`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7891/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
