# Lease violation (two-process)

An agent is granted a narrow lease and attempts a tool call outside its
scope. The runtime's `validateLeaseOp` throws `PermissionDeniedError`;
the agent surfaces the failure as a `tool_result` with `body.error` and
continues. The job ultimately succeeds — lease violations are _not_
session-fatal.

## Run

In one terminal:

```sh
pnpm tsx examples/lease-violation/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/lease-violation/client.ts
```

## What it demonstrates

- §13.4 / §9.3 a denied lease op surfaces as a `tool_result` carrying
  the `PERMISSION_DENIED` error body, not a session-level error.
- The runtime grants the lease in `job.accepted.payload.lease`, which
  is also exposed on the agent's `ctx.lease`.
- Glob matching: `*` matches a single path segment, `**` matches zero
  or more. Targets are canonicalized before the check.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7882`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7882/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
