# Submit and stream (two-process)

The minimum useful ARCP v1.0 flow: a client submits a one-shot job to a
runtime, the runtime streams events back, and the client prints them.

This example demonstrates 7 of the 8 reserved `job.event` kinds in a
single run: `status`, `log`, `thought`, `metric`, `tool_call`,
`tool_result`, and `artifact_ref`. The eighth (`delegate`) has its own
example under `examples/delegate/`.

## Run

In one terminal:

```sh
pnpm tsx examples/submit-and-stream/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/submit-and-stream/client.ts
```

## What it demonstrates

- §13.1 the canonical submit → events → result flow.
- §7.1 `job.submit` carrying `agent`, `input`, `lease_request`,
  `idempotency_key`.
- §8.2 seven of the eight reserved event kinds emitted in one job.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7879`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7879/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
