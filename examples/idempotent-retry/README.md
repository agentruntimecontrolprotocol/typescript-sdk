# Idempotent retry (two-process)

Demonstrates the v1.0 `job.submit` idempotency contract: same key +
same parameters yields the same `job_id`; same key + conflicting
parameters yields `DUPLICATE_KEY`.

## Run

In one terminal:

```sh
pnpm tsx examples/idempotent-retry/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/idempotent-retry/client.ts
```

## What it demonstrates

- §13.5 / §7.2 `(principal, idempotency_key)` keyed dedupe.
- A retry with matching agent+input is a free re-submit; the runtime
  returns the existing `job_id` rather than spawning a second job.
- A submit with the same key but a different agent fails with
  `DUPLICATE_KEY` (retryable=false).

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7881`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7881/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
