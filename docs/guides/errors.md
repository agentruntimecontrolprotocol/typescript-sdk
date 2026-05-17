# Errors (§12)

ARCP defines twelve error codes. Each has a corresponding TypeScript
class in `@arcp/core`. Errors carry a structured payload and serialize
to the wire identically whether they surface as `session.error`,
`job.error`, or as the `error` body inside a `tool_result`.

## Codes

| Code                          | Class                           | Meaning                                           | Retryable |
| ----------------------------- | ------------------------------- | ------------------------------------------------- | --------- |
| `INVALID_REQUEST`             | `InvalidRequestError`           | Malformed envelope or arguments.                  | No        |
| `UNAUTHENTICATED`             | `UnauthenticatedError`          | Bad or missing bearer token.                      | No        |
| `PERMISSION_DENIED`           | `PermissionDeniedError`         | Lease check failed.                               | No        |
| `JOB_NOT_FOUND`               | `JobNotFoundError`              | Unknown `job_id`.                                 | No        |
| `AGENT_NOT_AVAILABLE`         | `AgentNotAvailableError`        | Agent name not registered.                        | No        |
| `AGENT_VERSION_NOT_AVAILABLE` | `AgentVersionNotAvailableError` | Pinned version absent (v1.1).                     | No        |
| `CANCELLED`                   | `CancelledError`                | Job cancelled via `job.cancel`.                   | No        |
| `TIMEOUT`                     | `TimeoutError`                  | Wall-clock `max_runtime_sec` tripped.             | Yes       |
| `INTERNAL_ERROR`              | `InternalError`                 | Unhandled runtime error.                          | Yes       |
| `LEASE_SUBSET_VIOLATION`      | `LeaseSubsetViolationError`     | Child lease wider than parent (§10).              | No        |
| `LEASE_EXPIRED`               | `LeaseExpiredError`             | `lease_constraints.expires_at` reached (v1.1).    | No        |
| `BUDGET_EXHAUSTED`            | `BudgetExhaustedError`          | `lease_constraints.budgets` depleted (v1.1).      | No        |
| `RESUME_WINDOW_EXPIRED`       | `ResumeWindowExpiredError`      | Resume past `resume_window_sec`.                  | No        |
| `HEARTBEAT_LOST`              | `HeartbeatLostError`            | Two consecutive missed pongs (v1.1).              | Yes       |
| `DUPLICATE_KEY`               | `DuplicateKeyError`             | Idempotency key collision with conflicting input. | No        |

`isRetryableByDefault(code)` reflects the column above. Per-error
overrides ride on the payload's `retryable` field.

## Wire shape

```ts
type ErrorPayload = {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};
```

Every wire emission of an error — `session.error.payload`,
`job.error.payload`, `tool_result.body.error` — uses this shape.
`details` is a free-form record for transport-specific context (e.g.,
`{ host, capability, target }` on a permission denial).

## Throwing from an agent

```ts
import { ARCPError, PermissionDeniedError } from "@arcp/core";

server.registerAgent("strict", async (input, ctx) => {
  if (!input.allowed) {
    throw new PermissionDeniedError("input.allowed is false");
  }
  if (!input.url) {
    throw new ARCPError("INVALID_REQUEST", "url is required");
  }
  // …
});
```

Throwing an `ARCPError` produces a `job.error` envelope with the
error's code. Throwing anything else (a generic `Error`, a string)
becomes `INTERNAL_ERROR` and is logged on the runtime.

To carry structured detail:

```ts
throw new PermissionDeniedError("net.fetch denied for s3://other/", {
  details: { capability: "net.fetch", target: "s3://other/" },
});
```

## Catching on the client

`handle.done` rejects with an `ARCPError` on terminal `job.error`:

```ts
import { ARCPError, isRetryableByDefault } from "@arcp/core";

try {
  const result = await handle.done;
  // success path
} catch (err) {
  if (err instanceof ARCPError) {
    if (err.code === "TIMEOUT" || isRetryableByDefault(err.code)) {
      // retry with backoff
    } else if (err.code === "PERMISSION_DENIED") {
      // request broader lease
    } else {
      // surface to user
    }
  } else {
    throw err; // not an ARCP error
  }
}
```

## Session-level errors

`session.error` is fatal — the transport closes after the runtime
emits it. The client's `connect()` or `resume()` promise rejects with
the corresponding `ARCPError`. Common reasons:

- `UNAUTHENTICATED` — token failed verification.
- `INVALID_REQUEST` — malformed `session.hello`.
- `RESUME_WINDOW_EXPIRED` — resume past the window.

Recovery is always "start a new session." There is no
`session.warning` or recoverable session-level state.

## Errors on a `tool_result`

When an agent's tool call fails for application reasons, encode the
failure in the `tool_result.body.error` field rather than throwing:

```ts
await ctx.toolResult({
  call_id: "fetch-1",
  error: {
    code: "INVALID_REQUEST",
    message: "404 from upstream",
    details: { status: 404, url: input.url },
  },
});
```

The job stays alive; the agent decides what to do next.

## Lease violations look like `tool_result.error`

When the runtime denies a lease check on `tool_call` or `delegate`, it
emits a `tool_result` on the **parent job** with
`error.code: "PERMISSION_DENIED"` (or `LEASE_SUBSET_VIOLATION` for
delegate subset failures). This is intentional: the agent decides
whether to recover. Use this pattern instead of throwing.

See [leases.md](./leases.md) and [delegation.md](./delegation.md).

## Retry guidance

`INTERNAL_ERROR`, `TIMEOUT`, and `HEARTBEAT_LOST` are retryable by
default. Combine retries with idempotency keys (§7.2) so a duplicate
submit collapses to the same `job_id`:

```ts
const key = `weekly-report-2026-W19`;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const handle = await client.submit({
      agent: "weekly-report",
      input: { week: "2026-W19" },
      idempotencyKey: key,
    });
    return await handle.done;
  } catch (err) {
    if (!(err instanceof ARCPError) || !isRetryableByDefault(err.code)) {
      throw err;
    }
    await sleep(2 ** attempt * 1000);
  }
}
```

## Adding context to a client-side rethrow

```ts
try {
  return await handle.done;
} catch (err) {
  if (err instanceof ARCPError) {
    err.details = { ...err.details, jobId: handle.jobId };
  }
  throw err;
}
```

The class isn't sealed — extend the `details` field freely on the way
out.

## Runnable example

[`examples/lease-violation/`](../../examples/lease-violation/) —
permission denial surfaces as `tool_result.error`, not `job.error`.
